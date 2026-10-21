import path from 'node:path';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { loadConfig, readJson, redactor } from '../core/config.js';
import { assertCreationTaskMode } from '../core/creation-mode.js';
import { acquireLock, writeJson } from '../core/files.js';
import { assertAuthorizedEditorChanges, assertDraftHash, previewCookies } from '../core/runner.js';
import { WordPressClient, type DraftSnapshot } from '../wordpress/client.js';
import type { CapabilityReport, LegacySchema } from '../wordpress/types.js';
import type { AuthorizedEditorEdit } from '../verification/editability.js';
import { auditFidelityProgram, flattenNative, sha256 } from './check.js';
import { compileFidelity, preflightNativeControls, referencedFidelityAssets, type FidelityImportedAsset } from './native.js';
import { checkFidelityDraft } from './acceptance.js';
import { writeFidelityBlocks } from './block-writer.js';
import { createRuntimeTrace } from './runtime.js';
import { assertNativeCapabilityPlan, planNativeCapabilities, type NativeResponsiveEnvironment } from './capability-plan.js';
import type { FidelityAudit } from './types.js';

/** A review draft is an intermediate artifact, never a fidelity pass. Missing,
 * stale or unfrozen source inventories still stop before target authentication. */
export function assertFidelityDraftReady(audit: FidelityAudit, reviewDraft?: { reason: string }): void {
  if (audit.passed) return;
  const coverage = audit.sourceCoverage;
  const invalidEvidence = !coverage || coverage.counts.inventories < 3 || coverage.counts.required < 1 || coverage.issues.some(issue => /(?:inventory-missing|provenance-mismatch|bytes-changed|unfrozen|invented-feature|invalid)/.test(issue.code));
  if (!reviewDraft?.reason.trim() || invalidEvidence) throw new Error(`Source evidence completeness requires review before target authentication: ${coverage?.issues.map(issue => issue.code).join(', ') ?? 'unverified source coverage'}. See fidelity-audit.json`);
}

export interface FidelityRunResult {
  version: 1; workflow: 'block-replication'; mode?: 'replica'; runId: string; sourceUrl: string; targetUrl: string;
  status: 'running' | 'completed' | 'needs-review' | 'failed'; stage: string; runDir: string;
  startedAt: string; finishedAt?: string; pageId?: number; editUrl?: string; previewUrl?: string;
  blocksBuilt: number; nativeElements: number; importedAssets: number; limitations: string[];
  verificationPath?: string; finalHash?: string; restored?: boolean; error?: string;
  programSha256: string; contractSha256: string; assetsManifestSha256: string;
}
type EnvironmentLock = { mode: string; versions: Record<string, string>; responsiveDevices?: unknown };
const canonical = (value: unknown): string => {
  const normalize = (input: unknown): unknown => input && typeof input === 'object' ? Array.isArray(input) ? input.map(child => normalize(child) ?? null) : Object.fromEntries(Object.entries(input).filter(([, child]) => child !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, normalize(child)])) : input;
  return JSON.stringify(normalize(value)) ?? 'null';
};

/** The used native subset is discovered afresh; the historical all-widget fingerprint is not reusable for expanded programs. */
export function assertFidelityEnvironment(capabilities: CapabilityReport, lock: EnvironmentLock, usedTypes: string[]) {
  if (capabilities.mode !== 'legacy-verified' || lock.mode !== capabilities.mode) throw new Error('This native block compiler requires the configured verified legacy Elementor environment');
  if (!lock.versions || !Object.keys(lock.versions).length) throw new Error('The configured environment has no verified native version contract');
  for (const [name, version] of Object.entries(lock.versions)) if (capabilities.versions[name] !== version) throw new Error(`Configured native environment version changed: ${name}; fresh source and editor verification is required before a new draft`);
  if (lock.responsiveDevices && canonical(capabilities.sourceProof?.responsiveDevices) !== canonical(lock.responsiveDevices)) throw new Error('Configured native responsive devices or breakpoints changed');
  for (const name of ['save', 'get_elements_data', 'responsiveRegistration', 'responsiveCSSExpansion']) {
    const evidence = capabilities.sourceProof?.[name] as { sha256?: string; source?: string } | undefined;
    if (!evidence || !/^[a-f\d]{64}$/.test(evidence.sha256 ?? '') || typeof evidence.source !== 'string' || !evidence.source.trim()) throw new Error(`The live native registry lacks actual source proof: ${name}`);
  }
  const widgets = Object.fromEntries([...new Set(usedTypes)].map(type => {
    const schema = capabilities.legacySchemas[type];
    if (!schema?.class?.trim() || !schema.controls || !Object.keys(schema.controls).length) throw new Error(`Source program uses an unavailable registered native widget: ${type}`);
    if (schema.nativeChildren && !/^[a-f\d]{64}$/.test(schema.nativeChildren.sourceSha256)) throw new Error(`Native nested widget lacks its actual child source proof: ${type}`);
    return [type, { class: schema.class, controlsSha256: sha256(canonical(schema.controls)), nativeChildren: schema.nativeChildren }];
  }));
  return { version: 1, passed: true, mode: capabilities.mode, versions: capabilities.versions, responsiveDevices: capabilities.sourceProof?.responsiveDevices, widgets, discoveredSubsetSha256: sha256(canonical({ versions: capabilities.versions, widgets, sourceProof: capabilities.sourceProof })), fullHistoricalSchemaFingerprintUsed: false };
}

function assertSameNativeRoots(actual: DraftSnapshot, expected: Array<{ id: string }>) {
  if (actual.elements.length !== expected.length || actual.elements.some((element, index) => element.id !== expected[index].id || element.elType !== 'container')) throw new Error('Saved native source blocks do not match the complete ordered cumulative program');
}

/** One shared guarded writer for a frozen source-block program; no old clone planner or original-business transformation. */
export async function runFidelity(filename: string, options: { root?: string; onProgress?: (message: string) => void; reviewDraft?: { reason: string } } = {}): Promise<FidelityRunResult> {
  const projectRoot = path.resolve(options.root ?? process.cwd());
  await assertCreationTaskMode(projectRoot, filename, 'replica');
  // Whole local source identity, exact text/block bindings, evidence and image bytes are checked before credentials.
  const assetMetadataCache = new Map<string, { format?: string; width?: number; height?: number; pages?: number }>();
  const checkedInput = await auditFidelityProgram(filename, { root: projectRoot, assetMetadataCache });
  const { program, contract, manifest, audit } = checkedInput, jobDir = path.dirname(audit.programPath);
  assertFidelityDraftReady(audit, options.reviewDraft);
  const environmentLock = await readJson<EnvironmentLock>(path.join(projectRoot, 'config/environment-lock.json'));
  const { root, config, credentials } = await loadConfig(projectRoot);
  const redact = redactor(credentials), release = await acquireLock(root);
  const sourceHost = new URL(program.sourceUrl).hostname.replace(/[^a-z\d]/gi, '-').slice(0, 30);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-blocks-${sourceHost}-${randomUUID().slice(0, 8)}`, runDir = path.join(root, 'runs', runId);
  const result: FidelityRunResult = { version: 1, workflow: 'block-replication', mode: 'replica', runId, sourceUrl: program.sourceUrl, targetUrl: config.targetUrl, status: 'running', stage: 'source-block-contract', runDir, startedAt: new Date().toISOString(), blocksBuilt: 0, nativeElements: audit.nativeElements, importedAssets: 0, limitations: [...audit.limitations], programSha256: audit.programSha256, contractSha256: audit.contractSha256, assetsManifestSha256: audit.assetsManifestSha256 };
  const runtime=createRuntimeTrace();
  const update = async (stage: string) => { runtime.phase(stage.toLowerCase().replace(/[^a-z\d-]/g,'-').slice(0,150));result.stage = stage; await writeJson(path.join(runDir, 'result.json'), result);await writeJson(path.join(runDir,'runtime.json'),{...runtime.snapshot(),targetRequests:client.diagnostics()}); options.onProgress?.(stage); };
  const receipt = async () => { await writeJson(path.join(runDir, 'result.json'), result); await writeJson(path.join(jobDir, 'build-result.json'), { ...result, fidelityAuditPath: path.join(jobDir, 'fidelity-audit.json') }); };
  const client = new WordPressClient({ targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password, networkRoute:config.wordpressNetworkRoute });
  let initial: DraftSnapshot | undefined, accepted: DraftSnapshot | undefined, editorStarted = false;
  let schemas: Record<string, LegacySchema> | undefined;
  try {
    await mkdir(runDir, { recursive: true });
    await writeJson(path.join(runDir, 'source-block-contract.json'), contract);
    await writeJson(path.join(runDir, 'native-program.json'), program);
    await writeJson(path.join(runDir, 'source-asset-manifest.json'), manifest);
    await writeJson(path.join(runDir, 'fidelity-input-audit.json'), audit);
    if(options.reviewDraft)await writeJson(path.join(runDir,'review-draft-intent.json'),{version:1,reason:options.reviewDraft.reason,sourceAuditPassed:audit.passed,completionPassGranted:false,notice:'User-authorized review draft for real browser/editor iteration; every unresolved fidelity requirement remains in the final completion report.'});
    await update('preflight-and-used-native-control-discovery');
    const preflight = await client.preflight(); await writeJson(path.join(runDir, 'target/preflight.json'), preflight);
    if (preflight.blockers.length) throw new Error(preflight.blockers.join(' '));
    const usedTypes = [...new Set(flattenNative(program.elements).map(element => element.type))];
    const capabilities = await client.discoverCapabilities(usedTypes); schemas = capabilities.legacySchemas;
    await writeJson(path.join(runDir, 'target/capabilities.json'), capabilities);
    const compatibility = assertFidelityEnvironment(capabilities, environmentLock, usedTypes);
    await writeJson(path.join(runDir, 'target/native-source-proof.json'), { ...compatibility, sourceProof: capabilities.sourceProof });
    const controlsPreflight=preflightNativeControls(program,capabilities.legacySchemas);
    await writeJson(path.join(runDir,'target/registered-controls-preflight.json'),controlsPreflight);
    const capabilityPlan = planNativeCapabilities(contract, capabilities.legacySchemas, program, undefined, capabilities.sourceProof?.responsiveDevices as NativeResponsiveEnvironment | undefined);
    await writeJson(path.join(runDir, 'target/native-capability-plan.json'), capabilityPlan);
    assertNativeCapabilityPlan(capabilityPlan,{reviewDraft:!!options.reviewDraft});
    result.limitations.push(...capabilities.limitations);
    const catalog = program.blocks.some(block => block.productQuery) ? await client.readTargetCatalog(200) : undefined;
    if (catalog) {
      if (!catalog.products.length) throw new Error('The configured target has no published visible WooCommerce products; source product copies are not a fallback');
      catalog.evidence = [path.join(runDir, 'target/catalog.json')];
      await writeJson(path.join(runDir, 'target/catalog.json'), catalog);
    }
    // Recheck current input hashes and files after read-only discovery, before any target mutation.
    const current = await auditFidelityProgram(filename, { root, writeAudit: false, assetMetadataCache });
    assertFidelityDraftReady(current.audit, options.reviewDraft);
    if (current.audit.programSha256 !== audit.programSha256 || current.audit.contractSha256 !== audit.contractSha256 || current.audit.assetsManifestSha256 !== audit.assetsManifestSha256) throw new Error('Frozen source program changed during native preflight; no draft was created');
    await update('create-new-owned-source-block-draft');
    const draft = await client.createDraft(runId, program.title);
    result.pageId = draft.pageId;
    if (new URL(draft.editUrl).origin !== new URL(config.targetUrl).origin) throw new Error('Owned draft editor link left the configured target origin');
    result.editUrl = draft.editUrl;
    initial = await client.snapshotDraft(draft.pageId); accepted = initial;
    if (initial.elements.length) throw new Error('The new owned source-block draft is not empty');
    await writeJson(path.join(runDir, 'target/initial-snapshot.json'), initial);
    await update('import-current-downloaded-source-media');
    const assets: FidelityImportedAsset[] = [];
    const requiredAssetKeys = referencedFidelityAssets(program.elements);
    const requiredAssets = manifest.assets.filter(asset => requiredAssetKeys.has(asset.key));
    for (const asset of requiredAssets) {
      const assetPath = await realpath(path.resolve(jobDir, asset.localPath)), relative = path.relative(jobDir, assetPath);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Current source asset escaped its frozen reference job');
      const bytes = await readFile(assetPath);
      if (sha256(bytes) !== asset.sha256) throw new Error(`Downloaded source image bytes changed before import: ${asset.key}`);
      const metadata = await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata(), mimeType = metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'webp' ? 'image/webp' : metadata.format === 'png' ? 'image/png' : '';
      if (!mimeType || mimeType !== asset.mediaType || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new Error(`Downloaded source image format changed before import: ${asset.key}`);
      const imported = await client.importAsset(assetPath, { runId, pageId: draft.pageId, sourceUrl: asset.sourceUrl, mimeType, alt: asset.alt, verifiedSha256: asset.sha256 });
      assets.push({ ...imported, key: asset.key }); result.importedAssets = assets.length;
      if (assets.length % 10 === 0 || assets.length === requiredAssets.length) await update(`imported-source-media-${assets.length}-of-${requiredAssets.length}`);
    }
    // The existing owned-media verifier is deliberately bounded to 100 records per read-only request.
    for (let offset = 0; offset < assets.length; offset += 100) await client.verifyImportedAssets(draft.pageId, assets.slice(offset, offset + 100));
    await writeJson(path.join(runDir, 'assets/imported.json'), assets.map(asset => ({ ...asset, provenance: manifest.assets.find(source => source.key === asset.key)?.provenance })));
    const shell = await client.configureCanvasShell(draft.pageId, true);
    await writeJson(path.join(runDir, 'target/canvas-shell-proof.json'), { ...shell, reason: 'The source block contract supplies its own page header/footer; suppress only this Canvas draft\'s target Woodmart mobile toolbar and inherited bottom padding' });
    const beforeBuild = await auditFidelityProgram(filename, { root, writeAudit: false, assetMetadataCache });
    assertFidelityDraftReady(beforeBuild.audit, options.reviewDraft);
    if (beforeBuild.audit.programSha256 !== audit.programSha256 || beforeBuild.audit.contractSha256 !== audit.contractSha256 || beforeBuild.audit.assetsManifestSha256 !== audit.assetsManifestSha256) throw new Error('Frozen source program changed during owned media import; no source blocks were saved');
    const compiled = compileFidelity(program, capabilities.legacySchemas, assets, catalog);
    await writeJson(path.join(runDir, 'native-plan.json'), compiled);
    const written=await writeFidelityBlocks({client,snapshot:accepted,compiled,runDir,blockIds:contract.blocks.map(block=>block.id),identity:{programSha256:audit.programSha256,contractSha256:audit.contractSha256,assetsManifestSha256:audit.assetsManifestSha256,environmentSha256:compatibility.discoveredSubsetSha256},onProgress:async(index,blockId)=>{await update(`native-block-${index+1}-${blockId}`);},onSnapshot:snapshot=>{accepted=snapshot;result.blocksBuilt=snapshot.elements.length;}});
    accepted=written.snapshot;
    const access = await client.getPreviewAccess(draft.pageId);
    for (const url of [access.editUrl, access.previewUrl]) if (new URL(url).origin !== new URL(config.targetUrl).origin || new URL(url).username || new URL(url).password) throw new Error('Owned draft verification links must remain on the configured target origin');
    result.previewUrl = access.previewUrl;
    // One-time authentication URLs and cookies stay only in memory, never in receipts or progress output.
    const cookies = await previewCookies(access.adminAccessUrl, config.targetUrl);
    const acceptanceContract = { ...contract, referenceReport: { ...contract.referenceReport, path: path.resolve(jobDir, contract.referenceReport.path) } };
    const checked = await checkFidelityDraft({
      program, contract: acceptanceContract, compiled, client, snapshot: accepted, schemas: capabilities.legacySchemas, assets,
      editUrl: access.editUrl, previewUrl: access.previewUrl, cookies, runDir, catalog,
      onProgress: async message => { if (/save-and-guarded-restore|native-carousel-editor/i.test(message)) editorStarted = true; await update(message); },
      onSnapshot: snapshot => { accepted = snapshot; },
    });
    accepted = checked.snapshot;
    await writeJson(path.join(runDir, 'target/final-snapshot.json'), accepted);
    await writeJson(path.join(runDir, 'elementor-document.json'), { elements: accepted.elements, pageSettings: accepted.settings });
    await writeJson(path.join(runDir, 'elementor-template.json'), { version: '0.4', title: program.title, type: 'page', content: accepted.elements, page_settings: accepted.settings });
    result.restored = true; result.finalHash = accepted.hash; result.verificationPath = checked.verificationPath;
    result.status = checked.passed ? 'completed' : checked.report.completion?.status === 'failed' || checked.report.fidelity?.structurePassed === false ? 'failed' : 'needs-review';
    if (!checked.passed) result.limitations.push('The saved block comparison, state or native editor report contains unresolved checks');
    const exports = ['elementor-document.json', 'elementor-template.json', 'target/final-snapshot.json', 'verification/final.json'];
    await writeJson(path.join(runDir, 'export-receipt.json'), { version: 1, workflow: 'block-replication', draftPageId: draft.pageId, published: false, finalHash: accepted.hash, programSha256: audit.programSha256, contractSha256: audit.contractSha256, assetsManifestSha256: audit.assetsManifestSha256, files: await Promise.all(exports.map(async name => ({ path: name, sha256: createHash('sha256').update(await readFile(path.join(runDir, name))).digest('hex') }))) });
    result.stage = 'finished'; result.finishedAt = new Date().toISOString(); result.limitations = [...new Set(result.limitations)];
    runtime.finish();await writeJson(path.join(runDir,'runtime.json'),{...runtime.snapshot(),targetRequests:client.diagnostics(),blockCheckpoint:written.checkpointPath});
    await receipt(); options.onProgress?.(`${result.status}: native source-block draft ${draft.pageId}`); return result;
  } catch (error) {
    result.status = 'failed'; result.error = redact(error); result.finishedAt = new Date().toISOString(); result.restored = false;
    if (result.pageId && initial && accepted) {
      try {
        const current = await client.snapshotDraft(result.pageId);
        if (current.hash !== accepted.hash) {
          if (!editorStarted || !schemas || result.blocksBuilt !== program.blocks.length) throw new Error('Owned draft differs from the accepted save; concurrent edits are preserved');
          const edits = await readJson<AuthorizedEditorEdit[]>(path.join(runDir, 'verification/editor/authorized-edits.json'));
          assertAuthorizedEditorChanges(accepted, current, edits, schemas);
        }
        const baseline = result.blocksBuilt === program.blocks.length ? accepted : initial;
        result.restored = (await client.restoreDraft(result.pageId, baseline, { expectedCurrent: current })).hash === baseline.hash;
        if (result.restored) { result.finalHash = baseline.hash; await writeJson(path.join(runDir, 'target/recovery-snapshot.json'), baseline); }
      } catch (restoreError) { result.limitations.push(`Guarded recovery: ${redact(restoreError)}`); }
    }
    if (editorStarted && result.restored !== true) result.limitations.push('Temporary native editor changes lack exact restoration proof');
    runtime.finish('failed');await writeJson(path.join(runDir,'runtime.json'),{...runtime.snapshot(),targetRequests:client.diagnostics()});
    await receipt(); options.onProgress?.(`failed: ${result.error}`); return result;
  } finally { await client.close().catch(() => undefined); await release(); }
}
