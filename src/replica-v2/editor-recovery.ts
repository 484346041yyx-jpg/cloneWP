import path from 'node:path';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { chromium, type Cookie } from 'playwright';
import sharp from 'sharp';
import { createScopedContext } from '../verification/capture-target.js';
import { navigateOwnedPreview } from '../verification/owned-preview.js';
import { collectNativeCatalogRender } from '../fidelity/catalog-browser.js';
import type { TargetCatalogEvidence } from '../fidelity/catalog-contract.js';
import type { DraftSnapshot, LegacySchema, WordPressClient } from '../wordpress/client.js';
import { compileEditorElements } from '../wordpress/editor-serialization.js';
import { retainRegisteredInactiveDefaults } from '../fidelity/revision.js';
import { compileReplicaV2 } from './compile.js';
import { validateProgramV2 } from './validate.js';
import { beginEditorAttemptV2, persistEditorAttemptV2, expectedEditorSnapshotV2, type EditorReceiptV2 } from './editor.js';
import { canonicalV2, documentHashV2, ensureDiskSpaceV2, hashV2, readSnapshotRefV2, restoreSnapshotV2, retryReadV2, safeErrorV2, saveJournalV2, writeSnapshotRefV2, type RuntimeJournalV2 } from './journal.js';
import { prepareRestoredRenderingV2 } from './render-preparation.js';
import { normalizePreviewChromeV2 } from './verify.js';
import { walkComponentsV2, type CompiledReplicaV2, type FileRef, type ImportedAssetV2, type ProgramV2 } from './types.js';

const flatten = (nodes: DraftSnapshot['elements']): DraftSnapshot['elements'] => nodes.flatMap(node => [node, ...flatten(node.elements)]);
const norm = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const unresolved = new Set(['intent', 'write-unknown', 'restore-pending', 'conflict']);
const within = (root: string, filename: string) => { const relative = path.relative(path.resolve(root), path.resolve(filename)); if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('Late editor evidence escaped its owned directory'); };
const snapshotIdentity = (snapshot: DraftSnapshot, journal: RuntimeJournalV2) => { if (snapshot.pageId !== journal.pageId || snapshot.runId !== journal.runId || snapshot.status !== 'draft' || documentHashV2(snapshot.elements, snapshot.settings) !== snapshot.hash) throw Error('Late editor recovery needs an exact current-run draft snapshot'); };

export interface LateProductRecoveryCandidateV2 { originReceipt: FileRef; baseline: DraftSnapshot; pendingIntentId: string }
/** Local-only discovery. A before hash cannot establish that the timed-out UI save happened. */
export async function loadLateProductEditorRecoveryCandidateV2(runDir: string, journal: RuntimeJournalV2, current: DraftSnapshot, identity?: Partial<Pick<RuntimeJournalV2, 'programHash' | 'componentPlanHash' | 'sourceFactsHash' | 'assetsManifestHash'>>): Promise<LateProductRecoveryCandidateV2 | undefined> {
  if (path.resolve(runDir) !== path.resolve(journal.runDir)) throw Error('Late editor recovery run identity differs'); snapshotIdentity(current, journal);
  for (const [key, expected] of Object.entries(identity ?? {})) if (journal[key as keyof RuntimeJournalV2] !== expected) throw Error('Late editor recovery input identity changed');
  const pending = journal.mutations.filter(intent => unresolved.has(intent.status));
  if (!pending.length) return undefined;
  if (pending.length !== 1 || pending[0].kind !== 'editor-test' || pending[0].checkpoint !== 'native-product-query' || pending[0].status !== 'restore-pending') throw Error('Late editor recovery requires one unresolved native product-query UI save');
  const intent = pending[0]; if (current.hash === intent.beforeHash) return undefined;
  if (current.hash !== intent.expectedAfterHash) throw Error('Late editor recovery found third-state concurrent content');
  const latestPath = path.join(runDir, 'verification', 'editor-v2', 'receipt.json'), latestBytes = await readFile(latestPath), latest = JSON.parse(latestBytes.toString('utf8')) as EditorReceiptV2;
  if (!latest.reportPath || !latest.attemptId) throw Error('Late editor recovery needs an immutable origin attempt');
  within(path.join(runDir, 'verification', 'editor-v2', 'attempts'), await realpath(latest.reportPath));
  const bytes = await readFile(latest.reportPath); if (hashV2(bytes) !== hashV2(latestBytes)) throw Error('Late editor origin alias and immutable bytes differ');
  const baseline = await readSnapshotRefV2(runDir, path.join(runDir, 'mutations', `${intent.id}-before.json`)); snapshotIdentity(baseline, journal); if (baseline.hash !== intent.beforeHash) throw Error('Late editor baseline differs from its pending intent');
  return { originReceipt: { path: latest.reportPath, sha256: hashV2(bytes) }, baseline, pendingIntentId: intent.id };
}

export interface LateProductEditorRecoveryOptionsV2 {
  originReceipt: FileRef; programRef: FileRef; program: ProgramV2; compiled: CompiledReplicaV2; schemas: Record<string, LegacySchema>; assets: ImportedAssetV2[]; catalog: TargetCatalogEvidence;
  baseline: DraftSnapshot; actual: DraftSnapshot; client: Pick<WordPressClient, 'snapshotDraft' | 'restoreDraft' | 'verifyEditable'> & Partial<Pick<WordPressClient, 'diagnostics'>>; journal: RuntimeJournalV2; cookies: Cookie[]; previewUrl: string; runDir: string;
}
export interface ValidatedLateProductEditorSaveV2 { origin: EditorReceiptV2; pendingIntentId: string; elementId: string; componentKey: string; countField: string; beforeCount: number; alteredCount: number; productIds: number[]; originSha256: string }

/** Full local provenance and exact one-field delta validation occurs before creating any browser. */
export async function validateLateProductEditorSaveV2(options: Omit<LateProductEditorRecoveryOptionsV2, 'client' | 'cookies' | 'previewUrl'>): Promise<ValidatedLateProductEditorSaveV2> {
  const { journal, baseline, actual, program, compiled, schemas } = options;
  if (path.resolve(options.runDir) !== path.resolve(journal.runDir) || program.taskId !== journal.taskId || program.sourceUrl !== journal.sourceUrl || journal.completed) throw Error('Late editor recovery task/run identity changed');
  snapshotIdentity(baseline, journal); snapshotIdentity(actual, journal);
  const programBytes = await readFile(options.programRef.path); if (options.programRef.sha256 !== journal.programHash || hashV2(programBytes) !== options.programRef.sha256 || canonicalV2(validateProgramV2(JSON.parse(programBytes.toString('utf8')))) !== canonicalV2(program)) throw Error('Late editor recovery program bytes differ from the frozen run');
  for (const [ref, expected] of [[program.sourceFacts, journal.sourceFactsHash], [program.componentPlan, journal.componentPlanHash], [program.assetsManifest, journal.assetsManifestHash]] as const) {
    const filename = path.resolve(path.dirname(options.programRef.path), ref.path); if (ref.sha256 !== expected || hashV2(await readFile(filename)) !== expected) throw Error('Late editor recovery frozen source/plan/assets bytes changed');
  }
  within(path.join(options.runDir, 'verification', 'editor-v2', 'attempts'), await realpath(options.originReceipt.path));
  const originBytes = await readFile(options.originReceipt.path); if (hashV2(originBytes) !== options.originReceipt.sha256) throw Error('Late editor origin receipt bytes changed');
  const origin = JSON.parse(originBytes.toString('utf8')) as EditorReceiptV2;
  if (origin.version !== 2 || origin.passed || origin.restorePending !== true || origin.editorSessions !== 1 || origin.pages !== 2 || origin.baselineHash !== baseline.hash || path.resolve(origin.reportPath ?? '') !== path.resolve(options.originReceipt.path) || !origin.attemptId || path.basename(path.dirname(options.originReceipt.path)) !== origin.attemptId || !/save POST did not finish/.test(origin.error ?? '')) throw Error('Late editor origin is not the supported failed immutable UI-save attempt');
  if (origin.sections.length !== compiled.sections.length || origin.sections.some((section, index) => !section.selected || !section.controls.length || section.elementId !== compiled.sections[index].targetId || section.key !== compiled.sections[index].key)) throw Error('Late editor origin lacks complete actual section selections');
  const groups = ['html-code-text-media-style', 'native-text', 'native-layout-field', 'native-carousel-display', 'native-product-query'];
  if (origin.checks.length !== 5 || origin.checks.some((check, index) => (index === 0 ? !['html-code-text-media-style', 'html-code-text-style'].includes(check.group) : check.group !== groups[index]) || !check.selected || !check.changed || check.beforeHash !== baseline.hash)) throw Error('Late editor origin has missing or unsupported edit groups');
  const ownedNodes = flatten(baseline.elements), types = ['html', 'heading', 'container', 'nested-carousel'];
  for (let index = 0; index < 4; index++) { const check = origin.checks[index], node = ownedNodes.find(node => node.id === check.elementId), mapped = index === 0 ? compiled.htmlProofs.find(proof => proof.componentKey === check.componentKey)?.elementId : compiled.elementMap[check.componentKey]; if (!node || (node.widgetType ?? node.elType) !== types[index] || mapped !== node.id) throw Error('Late editor prior group has no matching actual compiled native identity'); }
  if (origin.checks[0].group === 'html-code-text-media-style' && !compiled.bindings.some(binding => binding.elementId === origin.checks[0].elementId && binding.kind === 'media')) throw Error('Late editor media edit group has no actual typed media binding');
  for (const check of origin.checks.slice(0, 4)) {
    if (!check.saved || !check.frontendConfirmed || !check.restored || check.restoredHash !== baseline.hash || !check.modifiedHash || check.modifiedHash === baseline.hash || !check.screenshot || check.error) throw Error('Late editor prior groups do not prove actual save/frontend/restoration');
    within(path.dirname(options.originReceipt.path), await realpath(check.screenshot)); const pixels = await sharp(await readFile(check.screenshot)).metadata(); if (!pixels.width || !pixels.height) throw Error('Late editor prior group screenshot has no pixels');
    if (!journal.mutations.some(intent => intent.kind === 'editor-test' && intent.checkpoint === check.group && intent.status === 'confirmed' && intent.beforeHash === baseline.hash && intent.expectedAfterHash === check.modifiedHash && canonicalV2(intent.affectedBlockKeys) === canonicalV2([check.componentKey])) || !journal.mutations.some(intent => intent.kind === 'restore' && intent.checkpoint === check.group && intent.status === 'confirmed' && intent.beforeHash === check.modifiedHash && intent.expectedAfterHash === baseline.hash)) throw Error('Late editor prior group has no confirmed save/restoration journal proof');
  }
  const last = origin.checks[4]; if (last.saved || last.frontendConfirmed || last.restored || last.modifiedHash || last.restoredHash || !/save POST did not finish/.test(last.error ?? '')) throw Error('Late editor pending group does not match the failed UI-save boundary');
  const pending = journal.mutations.filter(intent => unresolved.has(intent.status));
  if (pending.length !== 1 || pending[0].kind !== 'editor-test' || pending[0].checkpoint !== last.group || pending[0].status !== 'restore-pending' || pending[0].pageId !== baseline.pageId || pending[0].runId !== baseline.runId || pending[0].beforeHash !== baseline.hash || canonicalV2(pending[0].affectedBlockKeys) !== canonicalV2([last.componentKey])) throw Error('Late editor recovery requires the exact unique pending product-query intent');
  if (actual.hash === baseline.hash || actual.hash !== pending[0].expectedAfterHash) throw Error('Late editor save is not proved by the exact expected-after snapshot');
  const rebuilt = compileReplicaV2(program, schemas, options.assets, options.catalog, 'final');
  for (const key of ['composition', 'sectionIds', 'sections', 'elementMap', 'queryReceipts'] as const) if (canonicalV2(rebuilt[key]) !== canonicalV2(compiled[key])) throw Error('Late editor compiled program does not match the frozen registered compilation');
  const desired = compileEditorElements(compiled.composition.elements, schemas), authored = new Map(flatten(compiled.composition.elements).map(node => [node.id, node])), saved = new Map(flatten(baseline.elements).map(node => [node.id, node]));
  for (const node of flatten(desired)) { const original = authored.get(node.id), prior = saved.get(node.id); if (original && prior && node.elType === prior.elType && node.widgetType === prior.widgetType) node.settings = retainRegisteredInactiveDefaults({ authored: [{ ...original, elements: [] }], serialized: [{ ...node, elements: [] }], baseline: [{ ...prior, elements: [] }], schemas }).elements[0].settings; }
  for (const root of desired) { const matches = baseline.elements.filter(node => node.id === root.id); if (matches.length !== 1 || canonicalV2(matches[0]) !== canonicalV2(root)) throw Error('Late editor baseline owned subtree differs from the compiled program'); }
  const node = flatten(baseline.elements).find(node => node.id === last.elementId), query = compiled.queryReceipts.find(item => item.elementId === last.elementId), component = walkComponentsV2(program.blocks).find(item => item.key === query?.componentKey);
  if (!node || node.widgetType !== 'wd_products' || component?.kind !== 'native-products' || !query || compiled.elementMap[last.componentKey] !== node.id || schemas.wd_products?.class !== 'XTS\\Elementor\\Products' || options.catalog.targetOrigin !== journal.targetUrl && options.catalog.targetOrigin !== new URL(journal.targetUrl).origin || query.targetOrigin !== options.catalog.targetOrigin) throw Error('Late editor group is not the registered frozen target product query');
  const countField = ['items_per_page', 'posts_per_page', 'products_per_page'].find(key => schemas.wd_products.controls[key]?.type === 'number' && node.settings[key] !== undefined);
  if (!countField) throw Error('Late editor query count is not an actual registered numeric control');
  const beforeCount = Number(node.settings[countField]), alteredCount = beforeCount > 1 ? beforeCount - 1 : beforeCount + 1;
  if (!Number.isSafeInteger(beforeCount) || beforeCount < 2 || beforeCount !== component.query.count || Number(query.settings[countField]) !== beforeCount || query.productIds.length !== beforeCount) throw Error('Late editor count cannot be derived from its frozen query');
  const expected = expectedEditorSnapshotV2(baseline, [{ id: node.id, setting: countField, value: alteredCount }], schemas);
  if (expected.hash !== pending[0].expectedAfterHash || expected.hash !== actual.hash || canonicalV2(expected.elements) !== canonicalV2(actual.elements) || canonicalV2(expected.settings) !== canonicalV2(actual.settings)) throw Error('Late editor current document changes more than the one registered query-count field');
  return { origin, pendingIntentId: pending[0].id, elementId: node.id, componentKey: last.componentKey, countField, beforeCount, alteredCount, productIds: query.productIds.slice(0, alteredCount), originSha256: options.originReceipt.sha256 };
}

export interface LateProductEditorRecoveryResultV2 { snapshot: DraftSnapshot; aggregate: EditorReceiptV2 & Record<string, unknown>; reportPath: string; reconciliationRef: FileRef; additionalMetrics: { browserRequests: number; frontendRecoveryPages: number; editorSessions: 0; editorLoads: 0 } }

/** Reconcile a late UI commit without reopening Elementor or repeating its successful edit groups. */
export async function reconcileLateProductEditorSaveV2(options: LateProductEditorRecoveryOptionsV2): Promise<LateProductEditorRecoveryResultV2> {
  const validated = await validateLateProductEditorSaveV2(options), { journal, baseline } = options;
  const preview = new URL(options.previewUrl); if (preview.origin !== new URL(journal.targetUrl).origin || preview.searchParams.get('page_id') !== String(baseline.pageId)) throw Error('Late editor frontend must be the exact owned preview');
  await ensureDiskSpaceV2(path.resolve(options.runDir, '..', '..'));
  const attempt = await beginEditorAttemptV2(options.runDir, baseline.hash), reconciliationPath = path.join(attempt.directory, 'late-product-reconciliation.json');
  if (attempt.previousHash !== options.originReceipt.sha256) throw Error('Late editor latest attempt changed before reconciliation');
  const intentPath = path.join(attempt.directory, 'origin-intent.json'), beforePath = path.join(options.runDir, 'mutations', `${validated.pendingIntentId}-before.json`), modifiedPath = path.join(attempt.directory, 'late-saved-snapshot.json'), validationPath = path.join(attempt.directory, 'validation-context.json');
  await writeFile(intentPath, JSON.stringify(journal.mutations.find(intent => intent.id === validated.pendingIntentId), null, 2) + '\n', { flag: 'wx' }); await writeSnapshotRefV2(options.runDir, modifiedPath, options.actual);
  // Seal the exact in-memory registered/catalog inputs once, so another process can replay the full one-field proof.
  await writeFile(validationPath, JSON.stringify({ schemas: options.schemas, assets: options.assets, catalog: options.catalog, journal: { version: journal.version, workflow: journal.workflow, runDir: journal.runDir, runId: journal.runId, pageId: journal.pageId, taskId: journal.taskId, sourceUrl: journal.sourceUrl, targetUrl: journal.targetUrl, programHash: journal.programHash, componentPlanHash: journal.componentPlanHash, sourceFactsHash: journal.sourceFactsHash, assetsManifestHash: journal.assetsManifestHash, completed: journal.completed, mutations: journal.mutations } }, null, 2) + '\n', { flag: 'wx' });
  const aggregate = structuredClone(validated.origin) as EditorReceiptV2 & Record<string, unknown>;
  Object.assign(aggregate, { passed: false, restorePending: true, originRef: options.originReceipt, reconciliationKind: 'late-product-ui-save', actualOriginEditorSessions: 1, additionalEditorSessions: 0, extraFrontendPages: 0, additionalBrowserRequests: 0 }); delete aggregate.error; delete aggregate.finalHash;
  const receipt: Record<string, any> = { version: 2, kind: 'late-product-editor-save-reconciliation', passed: false, originRef: options.originReceipt, originalAttemptId: validated.origin.attemptId, identity: { taskId: journal.taskId, runId: journal.runId, pageId: baseline.pageId, programHash: journal.programHash, componentPlanHash: journal.componentPlanHash, sourceFactsHash: journal.sourceFactsHash, assetsManifestHash: journal.assetsManifestHash }, pendingIntentId: validated.pendingIntentId, baselineHash: baseline.hash, actualOriginEditorSessions: 1, additionalEditorSessions: 0, extraFrontendPages: 0, browserRequests: 0, blockedMutationRequests: 0, alteredQuery: { elementId: validated.elementId, componentKey: validated.componentKey, field: validated.countField, before: validated.beforeCount, after: validated.alteredCount, productIds: validated.productIds, documentHash: options.actual.hash }, startedAt: new Date().toISOString() };
  receipt.programRef = options.programRef; receipt.intentRef = { path: intentPath, sha256: hashV2(await readFile(intentPath)) }; receipt.validationContextRef = { path: validationPath, sha256: hashV2(await readFile(validationPath)) }; receipt.beforeSnapshotRef = { path: beforePath, sha256: hashV2(await readFile(beforePath)) }; receipt.modifiedSnapshotRef = { path: modifiedPath, sha256: hashV2(await readFile(modifiedPath)) }; const apiBefore = options.client.diagnostics?.();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, context: Awaited<ReturnType<typeof createScopedContext>> | undefined, snapshot = options.actual, failure: unknown;
  try {
    const current = await retryReadV2(() => options.client.snapshotDraft(baseline.pageId)); if (current.hash !== options.actual.hash) throw Error('Late editor current draft changed before frontend verification'); snapshot = current;
    browser = await chromium.launch({ headless: true }); context = await createScopedContext(browser, options.previewUrl, { cookies: options.cookies }, { readOnly: true });
    context.on('request', request => { if (new URL(request.url()).origin === preview.origin) receipt.browserRequests++; });
    await context.route('**/*', async route => { if (['GET', 'HEAD'].includes(route.request().method())) await route.fallback(); else { receipt.blockedMutationRequests++; await route.abort('blockedbyclient'); } });
    const page = await context.newPage(); receipt.extraFrontendPages = 1; aggregate.extraFrontendPages = 1; await page.setViewportSize({ width: 1920, height: 1080 }); await page.emulateMedia({ reducedMotion: 'no-preference' });
    await navigateOwnedPreview(page, options.previewUrl); aggregate.previewChromeAdjusted = await normalizePreviewChromeV2(page) || aggregate.previewChromeAdjusted;
    const nodes = flatten(baseline.elements), rendering = { rootIds: options.compiled.sectionIds, nativeCarouselIds: nodes.filter(node => node.widgetType === 'nested-carousel').map(node => node.id), productCarouselIds: options.compiled.queryReceipts.filter(query => query.settings.layout === 'carousel').map(query => query.elementId) };
    receipt.temporaryRendering = await prepareRestoredRenderingV2(page, { ...rendering, documentHash: snapshot.hash });
    const query = options.compiled.queryReceipts.find(item => item.elementId === validated.elementId)!;
    const observed = await collectNativeCatalogRender({ page, blockId: validated.componentKey, widgetKey: validated.componentKey, elementId: validated.elementId, viewport: 'late-product-ui-save', catalog: options.catalog, carouselExpected: query.settings.layout === 'carousel', timeoutMs: 15_000 });
    const ids = observed.products.map(product => product.id); if (canonicalV2(ids) !== canonicalV2(validated.productIds)) throw Error('Late editor actual product IDs/order differ from the altered native query');
    for (const actual of observed.products) { const expected = options.catalog.products.find(product => product.id === actual.id); if (!expected || norm(actual.name) !== norm(expected.name) || actual.permalink !== expected.permalink || ![expected.imageUrl, ...(expected.imageVariants ?? [])].includes(actual.imageUrl) || !expected.priceText || norm(actual.priceText) !== norm(expected.priceText)) throw Error('Late editor actual product fields differ from the target catalog'); }
    if (query.settings.layout === 'carousel' && !observed.runtime.initialized) throw Error('Late editor actual product carousel did not initialize');
    const catalogPath = path.join(attempt.directory, 'altered-query-frontend.json'); await writeFile(catalogPath, JSON.stringify(observed, null, 2) + '\n', { flag: 'wx' }); receipt.frontend = { path: catalogPath, sha256: hashV2(await readFile(catalogPath)) };
    const alteredScreenshotPath = path.join(attempt.directory, 'native-product-query-late-confirmed.png'), alteredBytes = await page.screenshot({ path: alteredScreenshotPath, fullPage: true }); receipt.temporaryScreenshot = { path: alteredScreenshotPath, sha256: hashV2(alteredBytes) };
    const confirmed = await retryReadV2(() => options.client.snapshotDraft(baseline.pageId)); if (confirmed.hash !== options.actual.hash) throw Error('Late editor document changed while verifying the actual altered query');
    Object.assign(aggregate.checks[4], { saved: true, frontendConfirmed: true, modifiedHash: confirmed.hash, screenshot: alteredScreenshotPath }); delete aggregate.checks[4].error; receipt.lateSaveConfirmed = true;
    const confirmationPath = path.join(attempt.directory, 'late-query-confirmation.json'); await writeFile(confirmationPath, JSON.stringify({ version: 2, kind: 'late-product-ui-save-confirmation', originRef: options.originReceipt, pendingIntentId: validated.pendingIntentId, documentHash: confirmed.hash, alteredQuery: receipt.alteredQuery, modifiedSnapshotRef: receipt.modifiedSnapshotRef, frontend: receipt.frontend, temporaryScreenshot: receipt.temporaryScreenshot, confirmedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' }); receipt.confirmationRef = { path: confirmationPath, sha256: hashV2(await readFile(confirmationPath)) };
    snapshot = await restoreSnapshotV2(options.client, baseline, confirmed, journal, 'late-product-ui-save-recovery', [validated.componentKey], options.compiled.htmlProofs);
    receipt.restoreIntentId = [...journal.mutations].reverse().find(intent => intent.kind === 'restore' && intent.checkpoint === 'late-product-ui-save-recovery')?.id;
    const pending = journal.mutations.find(intent => intent.id === validated.pendingIntentId)!; pending.status = 'confirmed'; pending.observedHash = snapshot.hash; journal.documentHash = snapshot.hash; aggregate.restorePending = false; Object.assign(aggregate.checks[4], { restored: true, restoredHash: snapshot.hash }); await saveJournalV2(journal);
    await navigateOwnedPreview(page, options.previewUrl); aggregate.previewChromeAdjusted = await normalizePreviewChromeV2(page) || aggregate.previewChromeAdjusted;
    if (await page.locator('[data-cwp-editor-check]').count()) throw Error('Late editor restored frontend contains a temporary editor marker');
    const prepared = await prepareRestoredRenderingV2(page, { ...rendering, documentHash: baseline.hash }), restoredPath = path.join(attempt.directory, 'restored-frontend.png'), pixels = await page.screenshot({ path: restoredPath, fullPage: true }), dimensions = await sharp(pixels).metadata();
    aggregate.restoredScreenshot = { path: restoredPath, sha256: hashV2(pixels), width: dimensions.width!, height: dimensions.height! };
    const after = await retryReadV2(() => options.client.snapshotDraft(baseline.pageId)); if (after.hash !== baseline.hash) throw Error('Late editor restored document differs after rendering preparation'); snapshot = after;
    const restoredSnapshotPath = path.join(attempt.directory, 'restored-snapshot.json'); await writeSnapshotRefV2(options.runDir, restoredSnapshotPath, after); receipt.restoredSnapshotRef = { path: restoredSnapshotPath, sha256: hashV2(await readFile(restoredSnapshotPath)) };
    const editable = await retryReadV2(() => options.client.verifyEditable(baseline.pageId, options.compiled.htmlProofs)); if (!editable.editable || editable.status !== 'draft') throw Error('Late editor restored document is not an editable native draft'); receipt.nativeEditable = editable;
    const preparationPath = path.join(attempt.directory, 'restored-render-preparation.json'); await writeFile(preparationPath, JSON.stringify({ ...prepared, screenshot: aggregate.restoredScreenshot, afterDocumentHash: after.hash, markerAbsent: true }, null, 2) + '\n', { flag: 'wx' }); aggregate.restoredRendering = { path: preparationPath, sha256: hashV2(await readFile(preparationPath)) };
    receipt.restoredRendering = aggregate.restoredRendering; receipt.restoredScreenshot = aggregate.restoredScreenshot; receipt.finalHash = after.hash; aggregate.finalHash = after.hash; aggregate.passed = true; receipt.passed = true;
  } catch (error) {
    failure = error; receipt.error = safeErrorV2(error); aggregate.error = receipt.error;
    try { const actual = await retryReadV2(() => options.client.snapshotDraft(baseline.pageId)); if (actual.hash !== baseline.hash && actual.hash !== options.actual.hash) throw Error('Late editor restoration found third-state concurrent content'); snapshot = await restoreSnapshotV2(options.client, baseline, actual, journal, 'late-product-ui-save-failure-recovery', [validated.componentKey], options.compiled.htmlProofs); const pending = journal.mutations.find(intent => intent.id === validated.pendingIntentId)!; pending.status = 'confirmed'; journal.documentHash = snapshot.hash; aggregate.restorePending = false; Object.assign(aggregate.checks[4], { restored: true, restoredHash: snapshot.hash }); await saveJournalV2(journal); }
    catch (restoreError) { aggregate.restorePending = true; journal.status = 'restore-pending'; receipt.restoreError = safeErrorV2(restoreError); await saveJournalV2(journal); }
  } finally {
    await context?.close().catch(error => { receipt.closeError = safeErrorV2(error); }); await browser?.close().catch(error => { receipt.closeError = safeErrorV2(error); });
    receipt.finishedAt = new Date().toISOString(); receipt.durationMs = Date.parse(receipt.finishedAt) - Date.parse(receipt.startedAt); receipt.restorePending = aggregate.restorePending; receipt.additionalMetrics = { browserRequests: receipt.browserRequests, frontendRecoveryPages: receipt.extraFrontendPages, editorSessions: 0, editorLoads: 0 };
    const apiAfter = options.client.diagnostics?.(); if (apiBefore && apiAfter) receipt.apiDelta = Object.fromEntries(Object.entries(apiAfter).filter(([key, value]) => typeof value === 'number' && typeof (apiBefore as any)[key] === 'number').map(([key, value]) => [key, Number(value) - Number((apiBefore as any)[key])]));
    aggregate.additionalBrowserRequests = receipt.browserRequests; aggregate.browserRequests = validated.origin.browserRequests + receipt.browserRequests; aggregate.reconciliationRef = { path: reconciliationPath, sha256: '' };
    await writeFile(reconciliationPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' }); aggregate.reconciliationRef = { path: reconciliationPath, sha256: hashV2(await readFile(reconciliationPath)) };
    await persistEditorAttemptV2(attempt, aggregate);
  }
  const result = { snapshot, aggregate, reportPath: attempt.reportPath, reconciliationRef: aggregate.reconciliationRef as FileRef, additionalMetrics: receipt.additionalMetrics };
  if (failure) throw Object.assign(Error(safeErrorV2(failure)), { evidence: result }); return result;
}
