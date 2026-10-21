import path from 'node:path';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, type Cookie } from 'playwright';
import sharp from 'sharp';
import { loadConfig, readJson, redactor } from './config.js';
import { acquireLock, makeRunId, writeJson } from './files.js';
import { captureSource, hydrateFrozenRenderedFonts, inferFrozenSvgPaint } from '../capture/index.js';
import { assertPublicUrl } from '../capture/url-safety.js';
import { downloadAssets } from '../assets/index.js';
import { CodexPlanner, staticPageSchemas } from '../planning/codex.js';
import { validatePlan, type ModelPlan, type WidgetSchemas } from '../planning/plan.js';
import type { SourceCapture } from '../capture/types.js';
import type { AssetManifest } from '../assets/index.js';
import { WordPressClient, type DraftSnapshot, type ImportedAsset } from '../wordpress/client.js';
import { verifyPage, verifyNativeEditor } from '../verification/index.js';
import { handleScopedRoute } from '../verification/capture-target.js';
import type { NativeEditabilityReport, VerificationReport } from '../verification/types.js';
import type { AuthorizedEditorEdit } from '../verification/editability.js';
import { compileEditorElements } from '../wordpress/editor-serialization.js';
import type { LegacySchema } from '../wordpress/types.js';
import type { CanvasShellProof } from '../wordpress/canvas-shell.js';

export interface RunResult {
  version: 1; runId: string; sourceUrl: string; targetUrl: string;
  status: 'running' | 'completed' | 'needs-review' | 'failed'; stage: string;
  startedAt: string; finishedAt?: string; runDir: string;
  pageId?: number; editUrl?: string; previewUrl?: string;
  mode?: string; rounds?: number; limitations: string[]; error?: string;
  restored?: boolean; verificationPath?: string;
  /** Exact canonical baseline after guarded recovery of our recorded UI fields. */ recoverySnapshotHash?: string;
}
export interface RunOptions {
  root?: string; onProgress?: (message: string) => void;
  /** Internal continuation of an owned failed task; daily CLI remains URL-only. */ resumeRunId?: string;
  /** Internal fresh acceptance check of the same owned task, guarded against concurrent edits. */
  revalidateRun?: { runId: string; pageId: number; expectedHash: string };
}

export class ConcurrentDraftChangeError extends Error {
  constructor() { super('The owned draft changed during continuation; concurrent edits must not be overwritten'); this.name = 'ConcurrentDraftChangeError'; }
}
export function assertDraftHash(actual: string, expected: string): void {
  if (actual !== expected) throw new ConcurrentDraftChangeError();
}
export function mayRecoverDraft(error: unknown, actualHash: string, expectedHashes: string[]): boolean {
  return !isConcurrentDraftError(error) && expectedHashes.includes(actualHash);
}
function isConcurrentDraftError(error: unknown): boolean { return error instanceof ConcurrentDraftChangeError || (!!error && typeof error === 'object' && 'code' in error && error.code === 'concurrent_document_change'); }
const canonicalDocument = (value: unknown): string => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(child => JSON.parse(canonicalDocument(child))) : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, JSON.parse(canonicalDocument(child))])) : value);
function editorTree(nodes: DraftSnapshot['elements']): unknown {
  return nodes.map(node => { const copy = { ...node, elements: editorTree(node.elements ?? []) }; if (!copy.isInner) delete copy.isInner; return copy; });
}
function colorIdentity(value: unknown): string {
  if (typeof value !== 'string') return '';
  const hex = /^#([a-f0-9]{6})$/i.exec(value.trim());
  if (hex) return [...[0, 2, 4].map(index => parseInt(hex[1].slice(index, index + 2), 16)), 1].join(',');
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d*\.?\d+))?\s*\)$/i.exec(value.trim());
  return rgb ? [...rgb.slice(1, 4).map(Number), Number(rgb[4] ?? 1)].join(',') : value.toLowerCase();
}
/** Verify exact UI-generated edits before restoring; unrelated changes are never discarded. */
export function assertAuthorizedEditorChanges(before: DraftSnapshot, current: DraftSnapshot, edits: AuthorizedEditorEdit[] = [], schemas?: Record<string, LegacySchema>): void {
  if (before.pageId !== current.pageId || before.runId !== current.runId || before.status !== current.status || before.title !== current.title) throw new ConcurrentDraftChangeError();
  const patched = structuredClone(before.elements);
  const find = (nodes: DraftSnapshot['elements'], id: string): DraftSnapshot['elements'][number] | undefined => { for (const node of nodes) { if (node.id === id) return node; const child = find(node.elements ?? [], id); if (child) return child; } };
  for (const edit of edits) {
    const original = find(patched, edit.targetId), actual = find(current.elements, edit.targetId);
    if (!original || !actual || !['title', 'editor', 'image', 'title_color', 'text_color', 'background_color'].includes(edit.setting)) throw new ConcurrentDraftChangeError();
    const value = actual.settings[edit.setting];
    let matches = canonicalDocument(value ?? null) === canonicalDocument(edit.value ?? null);
    if (edit.setting === 'image') {
      const expected = edit.value as { id?: unknown; url?: unknown }, image = value as { id?: unknown; url?: unknown } | undefined;
      matches = !!image && image.id === expected.id && image.url === expected.url;
    } else if (edit.setting.endsWith('_color')) matches = colorIdentity(value) === colorIdentity(edit.value);
    if (!matches) throw new ConcurrentDraftChangeError();
    original.settings[edit.setting] = value;
  }
  let expected = patched;
  if (schemas) {
    expected = compileEditorElements(patched, schemas);
    // Current flags must already match actual structural nesting. Never mask a human flag change.
    const check = (nodes: DraftSnapshot['elements'], depth: number) => { for (const node of nodes) { if (node.elType === 'container' && Boolean(node.isInner) !== (depth > 0)) throw new ConcurrentDraftChangeError(); check(node.elements ?? [], depth + 1); } };
    check(current.elements, 0);
  }
  if (canonicalDocument(editorTree(expected)) !== canonicalDocument(editorTree(current.elements)) || canonicalDocument(before.settings) !== canonicalDocument(current.settings)) throw new ConcurrentDraftChangeError();
}

export function validateContinuation(previous: RunResult | undefined, sourceUrl: string, targetUrl: string, revalidateRun?: RunOptions['revalidateRun']): void {
  if (previous && (previous.sourceUrl !== sourceUrl || previous.targetUrl !== targetUrl || !previous.pageId)) throw new Error('Continuation must retain the same owned source, target and draft');
  if (previous && !revalidateRun && (previous.status !== 'failed' || previous.restored !== true)) throw new Error('Only a restored owned failed draft can be continued');
  const recovered = previous?.status === 'failed' && previous.restored === true && previous.recoverySnapshotHash === revalidateRun?.expectedHash;
  if (revalidateRun && (!previous || (!['completed', 'needs-review'].includes(previous.status) && !recovered) || previous.runId !== revalidateRun.runId || previous.pageId !== revalidateRun.pageId || !/^[a-f0-9]{64}$/.test(revalidateRun.expectedHash))) throw new Error('Revalidation requires a finished or explicitly recovered owned draft and its exact saved snapshot hash');
}

async function latestSavedPlan(runDir: string): Promise<{ round: number; plan: ModelPlan } | undefined> {
  const names = await readdir(path.join(runDir, 'plan')).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; });
  const rounds = names.flatMap(name => { const match = /^round-(\d+)\.json$/.exec(name); return match ? [Number(match[1])] : []; });
  if (!rounds.length) return undefined;
  const round = Math.max(...rounds);
  return { round, plan: (await readJson<{ plan: ModelPlan }>(path.join(runDir, `plan/round-${round}.json`))).plan };
}

export async function previewCookies(adminAccessUrl: string | undefined, targetUrl: string): Promise<Cookie[]> {
  if (!adminAccessUrl) throw new Error('The target did not expose one-time authenticated preview access; draft browser verification is unavailable');
  const target = new URL(targetUrl), access = new URL(adminAccessUrl);
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || access.origin !== target.origin || access.username || access.password) throw new Error('Preview authentication must remain on the credential-free configured target origin');
  const browser = await chromium.launch({ headless: true });
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    context = await browser.newContext({ serviceWorkers: 'block' });
    // The shared route policy catches request errors without serializing cookie-bearing call logs,
    // stops authenticated navigation redirects at this origin, and strips external resource credentials.
    await context.route('**/*', route => handleScopedRoute(route, target));
    const page = await context.newPage();
    await page.goto(access.href, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => { throw new Error('One-time owned preview login navigation failed; authentication details omitted'); });
    if (new URL(page.url()).origin !== target.origin) throw new Error('One-time preview login did not remain on the configured target origin');
    const cookies = (await context.cookies()).filter(cookie => cookie.name.startsWith('wordpress_') && cookie.domain.replace(/^\./, '') === target.hostname);
    if (!cookies.some(cookie => cookie.name.startsWith('wordpress_logged_in_'))) throw new Error('One-time preview login did not establish a WordPress session');
    return cookies.map(cookie => ({ ...cookie, domain: target.hostname }));
  } finally { await context?.close().catch(() => undefined); await browser.close().catch(() => undefined); }
}

export function capabilityFingerprint(value: { versions: unknown; mode: string; legacySchemas: unknown; sourceProof?: Record<string, unknown> }) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
  return createHash('sha256').update(JSON.stringify(canonical({ versions: value.versions, mode: value.mode, schemas: value.legacySchemas, responsiveDevices: value.sourceProof?.responsiveDevices ?? null }))).digest('hex');
}
export function assertCanvasShellEvidence(report: Pick<VerificationReport, 'measurements'>, proof: CanvasShellProof): void {
  if (!proof.enabled) return;
  if (!report.measurements.length) throw new Error('The owned Canvas shell has no browser evidence');
  for (const viewport of report.measurements) {
    const actual = viewport.canvasShell;
    if (!actual || actual.bodyPageId !== proof.pageId || actual.visibleToolbarCount !== 0 || (viewport.width <= 1024 && actual.bodyPaddingBottom !== '0px')) throw new Error('The owned Canvas shell did not remove the source-absent toolbar and body padding');
  }
}
async function requireEnvironmentLock(root: string, capabilities: Parameters<typeof capabilityFingerprint>[0]) {
  const file = path.join(root, 'config/environment-lock.json');
  const fingerprint = capabilityFingerprint(capabilities);
  let old: { fingerprint: string } | undefined;
  try { old = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (old && old.fingerprint !== fingerprint) throw new Error('Target plugin/schema environment changed. Run the explicit live capability smoke test before accepting a new environment lock.');
  if (!old) await writeJson(file, { version: 1, fingerprint, versions: capabilities.versions, mode: capabilities.mode, establishedAt: new Date().toISOString(), verifiedBy: 'live schema discovery; editor acceptance remains separately required' });
}

function compactSchemas(schemas: WidgetSchemas): WidgetSchemas {
  return Object.fromEntries(Object.entries(schemas).map(([type, schema]) => [type, {
    controls: Object.fromEntries(Object.entries(schema.controls ?? {}).map(([key, value]) => [key, Object.fromEntries(Object.entries(value).filter(([name]) => ['type', 'default', 'options', 'condition', 'conditions', 'responsive', 'fields', 'range', 'size_units', 'min', 'max', 'step'].includes(name)))])),
  }]));
}

export async function runClone(sourceUrl: string, options: RunOptions = {}): Promise<RunResult> {
  // Reject bad source URLs before loading credentials or making authenticated requests.
  await assertPublicUrl(sourceUrl);
  const { root, config, credentials } = await loadConfig(options.root);
  const redact = redactor(credentials);
  if (options.resumeRunId && options.revalidateRun) throw new Error('Only one internal continuation guard is accepted');
  const revalidating = options.revalidateRun;
  const runId = options.resumeRunId ?? revalidating?.runId ?? makeRunId(sourceUrl), runDir = path.join(root, 'runs', runId);
  if (!/^[a-zA-Z0-9_-]{4,100}$/.test(runId)) throw new Error('Invalid owned task identifier');
  const previous = options.resumeRunId || revalidating ? await readJson<RunResult>(path.join(runDir, 'result.json')) : undefined;
  validateContinuation(previous, sourceUrl, config.targetUrl, revalidating);
  const savedPlan = previous ? await latestSavedPlan(runDir) : undefined;
  const release = await acquireLock(root);
  await mkdir(runDir, { recursive: true });
  const result: RunResult = { version: 1, runId, sourceUrl, targetUrl: config.targetUrl, status: 'running', stage: 'preflight', startedAt: new Date().toISOString(), runDir, limitations: [], ...(previous ? { pageId: previous.pageId, editUrl: previous.editUrl, previewUrl: previous.previewUrl, restored: previous.restored } : {}) };
  const log = (message: string) => options.onProgress?.(redact(message));
  if (previous) await writeJson(path.join(runDir, `prior-result-${Date.now()}.json`), previous);
  const update = async (stage: string) => { result.stage = stage; log(stage); await writeJson(path.join(runDir, 'result.json'), result); if (Date.now() - Date.parse(result.startedAt) > config.maxTotalMs) throw new Error('Total clone task time budget exhausted'); };
  const client = new WordPressClient({ targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password, networkRoute:config.wordpressNetworkRoute });
  let initial: DraftSnapshot | undefined;
  let lastVerified: DraftSnapshot | undefined;
  let acceptedSnapshot: DraftSnapshot | undefined;
  let recoveryExpected: DraftSnapshot | undefined;
  let planner: CodexPlanner | undefined;
  let writeAttempted = false;
  try {
    await update('preflight');
    const preflight = await client.preflight();
    await writeJson(path.join(runDir, 'target/preflight.json'), preflight);
    if (preflight.blockers.length) throw new Error(preflight.blockers.join(' '));
    const capabilities = await client.discoverCapabilities(['container', 'heading', 'text-editor', 'image', 'button', 'icon', 'icon-list', 'divider', 'spacer', 'accordion', 'tabs', 'image-carousel', 'nav-menu']);
    await writeJson(path.join(runDir, 'target/capabilities.json'), capabilities);
    if (capabilities.mode === 'unavailable') throw new Error('No verified native Elementor construction capability is available');
    await requireEnvironmentLock(root, capabilities);
    result.mode = capabilities.mode;
    result.limitations.push(...capabilities.limitations);

    await update('source-capture');
    let source = previous ? await readJson<SourceCapture>(path.join(runDir, 'source/capture.json')) : await captureSource({ url: sourceUrl, runDir, viewports: config.viewports, maxSections: config.maxSourceSections, maxPageHeight: config.maxPageHeight, maxElements: config.maxSourceElements });
    if (source.complete !== true || !source.viewports.length) throw new Error('Continuation needs complete immutable source evidence');
    if (previous) {
      const supplemented = await hydrateFrozenRenderedFonts(source);
      source = supplemented.source;
      await writeJson(path.join(runDir, 'source/rendered-font-proof.json'), { ...supplemented.proof, fontsByViewport: Object.fromEntries(source.viewports.map(viewport => [viewport.name, Object.fromEntries(viewport.elements.filter(element => element.renderedFonts?.length).map(element => [element.id, element.renderedFonts]))])) });
      result.limitations.push(...supplemented.proof.warnings);
    }
    result.limitations.push(...source.warnings);
    await update('asset-download');
    const deadlineAt = Date.parse(result.startedAt) + config.maxTotalMs;
    const manifest = previous ? await readJson<AssetManifest>(path.join(runDir, 'assets/manifest.json')) : await downloadAssets({ assets: source.assets, runDir, maxAssets: config.maxAssets, maxBytes: config.maxAssetBytes, deadlineAt });
    if (previous) {
      const paintProofs: unknown[] = [];
      for (const entry of manifest.entries) {
        if (entry.bakedOpacity !== undefined) continue;
        const facts = inferFrozenSvgPaint(entry, source);
        if (!facts) continue;
        Object.assign(entry, facts);
        const sourceAsset = source.assets.find(asset => asset.url === entry.url);
        if (sourceAsset) Object.assign(sourceAsset, facts);
        paintProofs.push({ sourceNodeIds: entry.sourceNodeIds, sourceHash: entry.originalSha256, importedHash: entry.sha256, ...facts, proof: 'Exact frozen SVG root inline style matched captured opacity in every declared viewport; image bytes were unchanged.' });
      }
      if (paintProofs.length) await writeJson(path.join(runDir, 'assets/frozen-paint-proof.json'), paintProofs);
    }
    result.limitations.push(...manifest.warnings);
    for (const entry of manifest.entries.filter(entry => entry.status === 'failed')) result.limitations.push(`Asset unavailable: ${entry.sourceUrl} (${entry.error})`);
    if (source.assets.some(asset => asset.kind === 'font')) result.limitations.push('Custom source fonts require separately verified native font registration; inaccessible/unregistered fonts are reported in typography checks.');

    await update('create-draft');
    const created = await client.createDraft(runId, `Clone — ${source.title.slice(0, 160)}`, previous ? { requireExistingPageId: previous.pageId! } : undefined);
    result.pageId = created.pageId; result.editUrl = created.editUrl;
    initial = await client.snapshotDraft(created.pageId);
    if (previous) {
      const original = await readJson<DraftSnapshot>(path.join(runDir, 'target/initial-snapshot.json'));
      assertDraftHash(initial.hash, revalidating?.expectedHash ?? original.hash);
      await writeJson(path.join(runDir, `continuation-${Date.now()}.json`), { previousResult: previous, startedAt: result.startedAt, verifiedSnapshotHash: initial.hash });
    }
    if (!revalidating) await writeJson(path.join(runDir, 'target/initial-snapshot.json'), initial);
    else await writeJson(path.join(runDir, `target/revalidation-start-${Date.now()}.json`), initial);
    await update('asset-import');
    const assets: ImportedAsset[] = [];
    const cachedAssets = previous ? await readJson<ImportedAsset[]>(path.join(runDir, 'assets/imported.json')).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }) : [];
    if (cachedAssets.length) {
      for (const asset of cachedAssets) {
        const entry = manifest.entries.find(entry => entry.sourceUrl === asset.sourceUrl && entry.sha256 === asset.sha256 && entry.path);
        if (!entry?.path || createHash('sha256').update(await readFile(entry.path)).digest('hex') !== asset.sha256) throw new Error('Cached image lacks matching immutable download proof');
      }
      await client.verifyImportedAssets(created.pageId, cachedAssets);
      await writeJson(path.join(runDir, `assets/reuse-proof-${Date.now()}.json`), { records: cachedAssets.length, proof: 'Local immutable file hashes, own attachment identity, URL and original upload bytes verified in one read-only operation' });
    }
    for (const entry of manifest.entries) {
      if (Date.now() > deadlineAt) throw new Error('Total clone task time budget exhausted during media import');
      if (entry.status === 'failed' || !entry.path || !entry.mime || !entry.mime.startsWith('image/') || entry.kind === 'font') continue;
      const asset = cachedAssets.find(asset => asset.sourceUrl === entry.sourceUrl && asset.sha256 === entry.sha256) ?? await client.importAsset(entry.path, { runId, pageId: created.pageId, sourceUrl: entry.sourceUrl, mimeType: entry.mime, alt: entry.alt, originalSha256: entry.originalSha256, verifiedSha256: entry.sha256 });
      if (entry.bakedOpacity !== undefined) asset.bakedOpacity = entry.bakedOpacity;
      if (entry.bakedEffects) asset.bakedEffects = [...entry.bakedEffects];
      assets.push(asset);
    }
    await writeJson(path.join(runDir, 'assets/imported.json'), assets);
    const expectedMediaURLs: Record<string, string[]> = {};
    for (const resource of source.assets) {
      const imported = assets.find(asset => asset.sourceUrl === resource.url);
      if (!imported) continue;
      for (const sourceId of resource.sourceNodeIds) expectedMediaURLs[sourceId] = [...new Set([...(expectedMediaURLs[sourceId] ?? []), imported.url, ...((imported as ImportedAsset & { variants?: string[] }).variants ?? [])])];
    }
    const access = await client.getPreviewAccess(created.pageId);
    result.previewUrl = access.previewUrl;
    const cookies = await previewCookies(access.adminAccessUrl, config.targetUrl);
    const sourceDOM = await Promise.all(source.viewports.map(viewport => readFile(viewport.domPath, 'utf8')));
    const shellProof = await client.configureCanvasShell(created.pageId, sourceDOM.every(dom => !/\bwd-toolbar\b/.test(dom)));
    // Track the exact owned baseline even if planning fails before construction.
    acceptedSnapshot = await client.snapshotDraft(created.pageId);
    writeAttempted = true;
    await writeJson(path.join(runDir, 'target/canvas-shell-proof.json'), { ...shellProof, sourceUrl, sourceAbsence: sourceDOM.every(dom => !/\bwd-toolbar\b/.test(dom)), sourceDOMHashes: sourceDOM.map(dom => createHash('sha256').update(dom).digest('hex')) });
    planner = new CodexPlanner({ runDir, mode: capabilities.mode, timeoutMs: config.agentTimeoutMs, deadlineAt, maxElements: config.maxElements, firstArtifactRound: savedPlan ? savedPlan.round + 1 : 0, log });
    const widgetSchemas = compactSchemas(staticPageSchemas(capabilities.legacySchemas));
    const capabilityEvidence = { mode: capabilities.mode, versions: capabilities.versions, responsiveDevices: capabilities.sourceProof?.responsiveDevices, canvasShell: shellProof, availableWidgetTypes: Object.keys(capabilities.legacySchemas), abilities: capabilities.abilities.filter(ability => ability.name.startsWith('elementor/')), schemas: capabilities.schemas };
    let current: ModelPlan | undefined;
    let report: VerificationReport | undefined;
    let previousIssues: unknown;
    let elementMap: Record<string, string> = {};
    const sourceIds = new Set(source.viewports.flatMap(viewport => viewport.elements.map(element => element.id)));
    const sourceAliases = Object.fromEntries([
      ...source.sections.map(section => [section.id, section.sourceNodeId]),
      ...source.viewports.flatMap(viewport => viewport.elements.filter(element => element.primaryOwnerId && element.primaryOwnerId !== element.id).map(element => [element.id, element.primaryOwnerId!])),
    ]);
    const expectedSourceIds = [...new Set(source.viewports.flatMap(viewport => [
      ...viewport.elements.filter(element => element.kind !== 'container' && (!element.primaryOwnerId || element.primaryOwnerId === element.id)).map(element => element.id),
      ...viewport.sections.map(section => section.sourceNodeId),
      ...viewport.elements.filter(element => element.kind === 'container' && (!element.primaryOwnerId || element.primaryOwnerId === element.id) && (
        ['grid', 'flex'].includes(element.style.display) ||
        (element.style['background-image'] && element.style['background-image'] !== 'none') ||
        (element.style['background-color'] && !['rgba(0, 0, 0, 0)', 'transparent'].includes(element.style['background-color']))
      )).map(element => element.id),
    ]))];
    if (revalidating && savedPlan) {
      const planned = validatePlan(savedPlan.plan, { mode: capabilities.mode, maxElements: config.maxElements, widgetSchemas, sourceIds, sourceAliases, allowedMedia: assets });
      current = planned.plan; elementMap = planned.elementMap;
      if (shellProof.enabled && initial.settings.custom_css !== shellProof.css) {
        await update('owned-canvas-shell');
        writeAttempted = true;
        initial = await client.buildDraft(created.pageId, { elements: initial.elements, pageSettings: initial.settings }, assets, { expectedCurrent: initial });
        acceptedSnapshot = initial; recoveryExpected = initial;
        await writeJson(path.join(runDir, `target/canvas-shell-snapshot-${Date.now()}.json`), initial);
      }
      await update('fresh-browser-revalidation');
      report = await verifyPage({ previewUrl: access.previewUrl, runDir: path.join(runDir, `revalidation-${Date.now()}`), viewports: config.viewports, source, plan: current, elementMap, auth: { cookies }, expectedSourceIds, assetMap: assets, expectedMediaURLs });
      assertCanvasShellEvidence(report, shellProof);
      await writeJson(path.join(runDir, 'verification/revalidation-baseline.json'), report);
      if (report.visualPassed) lastVerified = initial;
      previousIssues = { issues: report.issues, measurements: report.measurements, repairSummary: report.repairSummary };
    }
    acceptedSnapshot = initial;
    recoveryExpected = initial;
    const artifactOffset = savedPlan ? savedPlan.round + 1 : 0;
    for (let round = revalidating ? 1 : 0; round <= config.maxCorrectionRounds && (!report?.visualPassed || !!current?.unsupported.length); round++) {
      await update(round === 0 ? 'codex-planning' : `codex-correction-${round}`);
      let planned: Awaited<ReturnType<CodexPlanner['plan']>> | undefined;
      if (savedPlan && round === 0) {
        planned = validatePlan(savedPlan.plan, { mode: capabilities.mode, maxElements: config.maxElements, widgetSchemas, sourceIds, sourceAliases, allowedMedia: assets });
        log('Continuing this owned task with its already-generated validated Codex plan');
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        if (planned) break;
        try { planned = await planner.plan({ source, widgetSchemas, capabilities: capabilityEvidence, assets, previous: current, issues: previousIssues, targetScreenshots: report?.measurements.map(viewport => viewport.screenshotPath) }); break; }
        catch (error) {
          if (attempt === 2 || /timeout|authentication|unauthorized|external action|turn failed|exceeded.*context/i.test(redact(error))) throw error;
          previousIssues = { planValidationError: redact(error), priorVisualIssues: previousIssues };
          log(`Plan rejected before site write: ${redact(error)}`);
        }
      }
      if (!planned) throw new Error('No valid native plan');
      current = planned.plan; elementMap = planned.elementMap;
      await update(`native-build-${round}`);
      assertDraftHash((await client.snapshotDraft(created.pageId)).hash, acceptedSnapshot!.hash);
      writeAttempted = true;
      const snapshot = await client.buildDraft(created.pageId, planned.composition, assets, { expectedCurrent: acceptedSnapshot! });
      acceptedSnapshot = snapshot;
      recoveryExpected = snapshot;
      const artifactRound = artifactOffset + round;
      await writeJson(path.join(runDir, `target/snapshot-${artifactRound}.json`), snapshot);
      const rawPlanRound = savedPlan && !revalidating && round === 0 ? savedPlan.round : artifactOffset + round - (revalidating ? 1 : 0);
      await writeJson(path.join(runDir, `target/compiled-${artifactRound}.json`), { version: 1, rawPlanArtifact: `plan/round-${rawPlanRound}.json`, snapshotHash: snapshot.hash, elements: snapshot.elements, settings: snapshot.settings, compilerEvidence: { editorDefaults: 'Actual registered defaults; Elementor BaseSettingsModel initialize/removeDataDefaults (3.33.2)', nestedContainerFlags: 'Actual tree nesting; Elementor ContainerView.onRender (3.33.2). Requires browser acceptance at all declared viewports.', canvasShell: shellProof } });
      await update(`browser-verification-${round}`);
      report = await verifyPage({ previewUrl: access.previewUrl, runDir: path.join(runDir, `round-${artifactRound}`), viewports: config.viewports, source, plan: current, elementMap, auth: { cookies }, expectedSourceIds, assetMap: assets, expectedMediaURLs });
      assertCanvasShellEvidence(report, shellProof);
      await writeJson(path.join(runDir, `verification/round-${artifactRound}.json`), report);
      result.rounds = round;
      if (report.visualPassed) { lastVerified = snapshot; if (!current.unsupported.length) break; }
      previousIssues = { issues: report.issues, measurements: report.measurements, repairSummary: report.repairSummary };
      if (round === config.maxCorrectionRounds) break;
    }
    if (!current || !report) throw new Error('No browser verification result');
    await update('native-editor-verification');
    const finalSnapshot = await client.snapshotDraft(created.pageId);
    assertDraftHash(finalSnapshot.hash, acceptedSnapshot!.hash);
    let imageReplacement: { attachmentId: number; url: string } | undefined;
    if (assets.length) {
      const replacementPath = path.join(runDir, 'assets/editor-check.png');
      const bytes = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#a319cc' } }).png().toBuffer();
      const { writeFile } = await import('node:fs/promises');
      await writeFile(replacementPath, bytes);
      const imported = await client.importAsset(replacementPath, { runId, pageId: created.pageId, sourceUrl: `data:image/png;base64,${bytes.toString('base64')}`, mimeType: 'image/png', alt: 'Temporary owned cloneWP native editor verification image' });
      imageReplacement = { attachmentId: imported.attachmentId, url: imported.url };
    }
    writeAttempted = true;
    const editability: NativeEditabilityReport = await verifyNativeEditor({
      editorUrl: access.editUrl, previewUrl: access.previewUrl, pageId: created.pageId, runDir,
      cookies, widgetMap: elementMap, imageReplacement,
      restore: async edits => {
        await writeJson(path.join(runDir, 'verification/editor/authorized-edits.json'), edits);
        const modified = await client.snapshotDraft(created.pageId);
        assertAuthorizedEditorChanges(finalSnapshot, modified, edits, capabilities.legacySchemas);
        recoveryExpected = modified;
        const restored = await client.restoreDraft(created.pageId, finalSnapshot, { expectedCurrent: modified });
        recoveryExpected = restored;
        return restored.hash === finalSnapshot.hash;
      },
    });
    await writeJson(path.join(runDir, 'verification/editability.json'), editability);
    if (editability.issues.some(issue => issue.code === 'editor-restoration-failed')) {
      result.restored = false;
      throw new Error('Native editor verification could not restore the owned document and frontend exactly');
    }
    if (editability.status === 'verified') {
      await update('final-browser-verification');
      report = await verifyPage({ previewUrl: access.previewUrl, runDir: path.join(runDir, `final-render-${Date.now()}`), viewports: config.viewports, source, plan: current, elementMap, auth: { cookies }, expectedSourceIds, assetMap: assets, expectedMediaURLs, editability });
      assertCanvasShellEvidence(report, shellProof);
    } else {
      report.editability = editability;
      report.issues = [...report.issues.filter(issue => !issue.code.startsWith('editor-')), ...editability.issues];
    }
    const finalReadback = await client.snapshotDraft(created.pageId);
    assertDraftHash(finalReadback.hash, finalSnapshot.hash);
    await writeJson(path.join(runDir, 'target/final-snapshot.json'), finalReadback);
    result.restored = true;
    report.passed = report.visualPassed && editability.status === 'verified' && current.unsupported.length === 0;
    report.status = report.passed ? 'passed' : 'needs-review';
    result.limitations.push(...current.unsupported);
    result.limitations = [...new Set(result.limitations)];
    result.status = report.passed ? 'completed' : 'needs-review';
    result.stage = 'finished'; result.finishedAt = new Date().toISOString();
    result.verificationPath = path.join(runDir, 'verification/final.json');
    await writeJson(result.verificationPath, report);
    await writeJson(path.join(runDir, 'result.json'), result);
    log(`${result.status}: native draft ${created.pageId}`);
    return result;
  } catch (error) {
    result.status = 'failed'; result.error = redact(error); result.finishedAt = new Date().toISOString();
    result.restored = false;
    if (writeAttempted && !isConcurrentDraftError(error) && result.pageId && (lastVerified || initial)) {
      try {
        // Recovery is allowed only while the draft still matches our last accepted save.
        // A human edit after a failed measurement is preserved even if the original error was unrelated.
        const currentSnapshot = await client.snapshotDraft(result.pageId);
        if (!mayRecoverDraft(error, currentSnapshot.hash, [acceptedSnapshot!.hash, recoveryExpected?.hash ?? acceptedSnapshot!.hash])) throw new ConcurrentDraftChangeError();
        const restore = lastVerified || initial!;
        result.restored = (await client.restoreDraft(result.pageId, restore, { expectedCurrent: currentSnapshot })).hash === restore.hash;
      }
      catch (restoreError) { result.restored = false; result.limitations.push(`Recovery failed: ${redact(restoreError)}`); }
    }
    await writeJson(path.join(runDir, 'result.json'), result);
    log(`failed: ${result.error}`);
    return result;
  } finally { await planner?.dispose().catch(() => undefined); await client.close().catch(() => undefined); await release(); }
}
