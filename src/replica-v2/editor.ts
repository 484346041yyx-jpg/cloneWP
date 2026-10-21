import path from 'node:path';
import { mkdir, readFile, writeFile, realpath, link, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, type Cookie, type Page } from 'playwright';
import sharp from 'sharp';
import { writeJson } from '../core/files.js';
import { createScopedContext } from '../verification/capture-target.js';
import { selectNativeWidget, saveDraftThroughUI } from '../verification/editability.js';
import { attachEditorStartupNetwork, awaitNativeEditorReady } from '../verification/editor-readiness.js';
import { navigateOwnedPreview } from '../verification/owned-preview.js';
import { compileEditorElements } from '../wordpress/editor-serialization.js';
import { waitForNativeCarouselReady, chooseNativeCarouselOption, exposeNativeProductQuerySection, trackNativeEditorPosts } from '../fidelity/acceptance.js';
import type { WordPressClient, DraftSnapshot, ElementorElement, LegacySchema } from '../wordpress/client.js';
import type { ProgramV2, CompiledReplicaV2, ImportedAssetV2 } from './types.js';
import { canonicalV2, hashV2, documentHashV2, newMutationIntentV2, saveJournalV2, retryReadV2, restoreSnapshotV2, safeErrorV2, ensureDiskSpaceV2, writeSnapshotRefV2, type RuntimeJournalV2 } from './journal.js';
import { normalizePreviewChromeV2 } from './verify.js';
import { prepareRestoredRenderingV2 } from './render-preparation.js';

export interface EditorPostEventV2 { event: 'started' | 'finished' | 'failed'; at: string; location: string; actions: string[]; status?: number }
export interface EditorSaveWaitV2 { phase: 'save' | 'failure-recovery'; startedAt: string; finishedAt: string; durationMs: number; timeoutMs: 45000; outcome: 'quiet' | 'timeout' | 'failed'; pendingCount: number; eventCount: number }
export interface EditorSaveLifecycleV2 { observedAt: string; pendingCount: number; events: EditorPostEventV2[]; waits: EditorSaveWaitV2[] }
export interface EditorCheckV2 { group: string; componentKey: string; elementId: string; selected: boolean; changed: boolean; saved: boolean; frontendConfirmed: boolean; restored: boolean; beforeHash?: string; modifiedHash?: string; restoredHash?: string; screenshot?: string; error?: string; saveLifecycle?: EditorSaveLifecycleV2 }
type EditorPostTrackerV2 = Pick<ReturnType<typeof trackNativeEditorPosts>, 'events' | 'pendingCount' | 'waitForQuiet'>;
/** Persist only endpoint/action metadata already exposed by the tracker; never retain request payloads or URL query/session data. */
export function captureEditorSaveLifecycleV2(tracker: EditorPostTrackerV2, check: EditorCheckV2, eventOffset: number): EditorSaveLifecycleV2 {
  const events = tracker.events.slice(eventOffset).filter(event => ['started', 'finished', 'failed'].includes(event.event)).map(event => {
    let location = '[invalid native endpoint]'; try { const url = new URL(event.location); if (['http:', 'https:'].includes(url.protocol)) location = url.origin + url.pathname; } catch { /* No raw invalid URL may enter evidence. */ }
    const timestamp = Date.parse(event.at), status = event.status;
    return { event: event.event as EditorPostEventV2['event'], at: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '[invalid timestamp]', location, actions: event.actions.filter(action => typeof action === 'string' && /^[a-z0-9_/-]{1,80}$/i.test(action)), ...(Number.isInteger(status) && status! >= 100 && status! <= 599 ? { status } : {}) };
  });
  const lifecycle: EditorSaveLifecycleV2 = { observedAt: new Date().toISOString(), pendingCount: tracker.pendingCount(), events, waits: check.saveLifecycle?.waits ?? [] }; check.saveLifecycle = lifecycle; return lifecycle;
}
/** Observation wrapper only: preserve the real tracker quiet rule, the fixed 45s deadline and the original thrown failure. */
export async function waitForEditorSaveV2(tracker: EditorPostTrackerV2, check: EditorCheckV2, phase: EditorSaveWaitV2['phase'], eventOffset: number): Promise<void> {
  const startedAt = new Date().toISOString(), started = performance.now(); let outcome: EditorSaveWaitV2['outcome'] = 'quiet';
  try { await tracker.waitForQuiet(45_000); }
  catch (error) { outcome = /bounded save\/restoration deadline|timed? ?out/i.test(error instanceof Error ? error.message : '') ? 'timeout' : 'failed'; throw error; }
  finally { const lifecycle = captureEditorSaveLifecycleV2(tracker, check, eventOffset); lifecycle.waits.push({ phase, startedAt, finishedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), timeoutMs: 45_000, outcome, pendingCount: lifecycle.pendingCount, eventCount: lifecycle.events.length }); }
}
export interface EditorReceiptV2 { version: 2; passed: boolean; editorSessions: 1; editorLoads: number; browserRequests: number; pages: 2; sections: Array<{ key: string; elementId: string; selected: boolean; controls: string[]; error?: string }>; checks: EditorCheckV2[]; finalHash?: string; restorePending: boolean; error?: string; previewChromeAdjusted?: boolean; attemptId?: string; reportPath?: string; startedAt?: string; finishedAt?: string; baselineHash?: string; restoredRendering?: { path: string; sha256: string }; restoredScreenshot?: { path: string; sha256: string; width: number; height: number } }
export interface EditorAttemptV2 { id: string; directory: string; reportPath: string; latestPath: string; previousHash?: string; startedAt: string; baselineHash: string }
const insideEditorRun = (root: string, filename: string) => { const relative = path.relative(root, filename); if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('Editor attempt evidence escaped its owned run'); };
/** Preserve historical receipts before a new session; screenshots always use their immutable attempt directory. */
export async function beginEditorAttemptV2(runDir: string, baselineHash: string): Promise<EditorAttemptV2> {
  const root = path.join(runDir, 'verification', 'editor-v2'); await mkdir(root, { recursive: true }); insideEditorRun(runDir, await realpath(root));
  const latestPath = path.join(root, 'receipt.json'); let previousHash: string | undefined;
  let previousBytes: Buffer | undefined; try { previousBytes = await readFile(latestPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (previousBytes) {
    const bytes = previousBytes; insideEditorRun(runDir, await realpath(latestPath)); previousHash = hashV2(bytes); const previous = JSON.parse(bytes.toString('utf8')) as EditorReceiptV2;
    if (previous.reportPath) { insideEditorRun(root, await realpath(previous.reportPath)); if (hashV2(await readFile(previous.reportPath)) !== previousHash) throw Error('Prior editor receipt alias differs from its immutable attempt'); }
    else { const history = path.join(root, 'history', previousHash); await mkdir(history, { recursive: true }); const filename = path.join(history, 'receipt.json'); try { await writeFile(filename, bytes, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } if (hashV2(await readFile(filename)) !== previousHash) throw Error('Legacy editor receipt history bytes changed'); }
  }
  const id = randomUUID(), directory = path.join(root, 'attempts', id); await mkdir(directory, { recursive: true }); insideEditorRun(root, await realpath(directory));
  return { id, directory, reportPath: path.join(directory, 'receipt.json'), latestPath, previousHash, baselineHash, startedAt: new Date().toISOString() };
}
/** Immutable attempt plus a compatible exact-byte latest copy; edits to that alias cannot mutate the original inode. */
export async function persistEditorAttemptV2(attempt: EditorAttemptV2, report: EditorReceiptV2): Promise<void> {
  Object.assign(report, { attemptId: attempt.id, reportPath: attempt.reportPath, startedAt: attempt.startedAt, baselineHash: attempt.baselineHash, finishedAt: new Date().toISOString() });
  const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n'), digest = hashV2(bytes); await writeFile(attempt.reportPath, bytes, { flag: 'wx' });
  const displaced = path.join(path.dirname(attempt.latestPath), `.receipt-${attempt.id}-before.tmp`); let moved = false;
  try {
    if (attempt.previousHash) { await rename(attempt.latestPath, displaced); moved = true; if (hashV2(await readFile(displaced)) !== attempt.previousHash) throw Error('Latest editor receipt changed concurrently; preserved the independent attempt'); }
    try { await writeFile(attempt.latestPath, bytes, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Error('Latest editor receipt was created concurrently; preserved both attempts'); throw error; }
    if (hashV2(await readFile(attempt.latestPath)) !== digest) throw Error('Latest editor receipt alias changed during readback');
    if (moved) { await unlink(displaced); moved = false; }
  } catch (error) { if (moved) { try { await link(displaced, attempt.latestPath); await unlink(displaced); } catch { /* Never replace a third-party receipt; retain the displaced bytes too. */ } } throw error; }
}
const flatten = (nodes: ElementorElement[]): ElementorElement[] => nodes.flatMap(node => [node, ...flatten(node.elements)]);
const find = (nodes: ElementorElement[], id: string) => flatten(nodes).find(node => node.id === id);
export function expectedEditorSnapshotV2(before: DraftSnapshot, edits: Array<{ id: string; setting: string; value: unknown }>, schemas: Record<string, LegacySchema>): DraftSnapshot {
  const elements = structuredClone(before.elements);
  for (const edit of edits) { const node = find(elements, edit.id); if (!node || !schemas[node.widgetType ?? node.elType]?.controls[edit.setting]) throw Error('Editor test may change only a registered field on the owned tree'); node.settings[edit.setting] = edit.value; }
  const serialized = compileEditorElements(elements, schemas); return { ...before, elements: serialized, hash: documentHashV2(serialized, before.settings) };
}
export function assertEditorDeltaV2(actual: DraftSnapshot, expected: DraftSnapshot): void {
  if (actual.runId !== expected.runId || actual.pageId !== expected.pageId || actual.status !== 'draft' || actual.hash !== expected.hash || documentHashV2(actual.elements, actual.settings) !== actual.hash) throw Error('Temporary editor save differs from its exact permitted setting changes; preserve concurrent content');
}
async function panelIdentity(page: Page, id: string): Promise<string[]> {
  await page.waitForFunction(targetId => { const editor = (window as any).elementor; const model = editor?.getPanelView?.()?.getCurrentPageView?.()?.model; return String(model?.get?.('id') ?? model?.id ?? '') === targetId; }, id, { timeout: 15_000 });
  return page.locator('#elementor-panel [data-setting]').evaluateAll(elements => [...new Set(elements.map(element => element.getAttribute('data-setting') ?? '').filter(Boolean))]);
}
export async function editCodeV2(page: Page, value: string): Promise<void> {
  const plain = page.locator('#elementor-panel textarea[data-setting="html"]').filter({ visible: true }).first();
  if (await plain.isVisible()) { await plain.fill(value); await plain.press('Tab'); return; }
  const editor = page.locator('#elementor-panel .elementor-control-html .ace_editor,#elementor-panel .elementor-control-html .CodeMirror').first();
  await editor.waitFor({ state: 'visible', timeout: 10_000 }); await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(value);
  // Ace consumes Tab as an edit command. Its normal change event updates Elementor;
  // the caller must still obtain the exact container-model acknowledgment before saving.
}
/** One context, one editor page and one frontend page for all actual native edit tests. */
export async function verifyReplicaEditorV2(options: { program: ProgramV2; compiled: CompiledReplicaV2; schemas: Record<string, LegacySchema>; assets: ImportedAssetV2[]; client: WordPressClient; snapshot: DraftSnapshot; cookies: Cookie[]; editUrl: string; previewUrl: string; runDir: string; journal: RuntimeJournalV2; onProgress?: (message: string) => void | Promise<void> }): Promise<EditorReceiptV2> {
  const attempt = await beginEditorAttemptV2(options.runDir, options.snapshot.hash), directory = attempt.directory;
  const report: EditorReceiptV2 = { version: 2, passed: false, editorSessions: 1, editorLoads: 0, browserRequests: 0, pages: 2, sections: [], checks: [], restorePending: false };
  const editorUrl = new URL(options.editUrl); if (editorUrl.origin !== new URL(options.previewUrl).origin || editorUrl.searchParams.get('post') !== String(options.snapshot.pageId) || editorUrl.searchParams.get('action') !== 'elementor') throw Error('Editor verification requires the exact owned draft');
  const browser = await chromium.launch({ headless: true }), context = await createScopedContext(browser, options.previewUrl, { cookies: options.cookies });
  context.on('request', request => { if (new URL(request.url()).origin === new URL(options.previewUrl).origin) report.browserRequests++; });
  const page = await context.newPage(), frontend = await context.newPage(); let tracker: ReturnType<typeof trackNativeEditorPosts> | undefined;
  let active: { intent: RuntimeJournalV2['mutations'][number]; before: DraftSnapshot; expected: DraftSnapshot; eventOffset: number } | undefined;
  try {
    await page.setViewportSize({ width: 1440, height: 1000 }); await frontend.setViewportSize({ width: 1920, height: 1080 }); await frontend.emulateMedia({ reducedMotion: 'no-preference' });
    const network = attachEditorStartupNetwork(page);
    const loadEditor = async () => { report.editorLoads++; await page.goto(options.editUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }); await awaitNativeEditorReady({ page, editorUrl: options.editUrl, rootIds: options.compiled.sectionIds, runDir: options.runDir, label: 'v2', requirePanelAPI: true, responses: network }); };
    await loadEditor(); tracker = trackNativeEditorPosts(page); const frame = page.frameLocator('#elementor-preview-iframe');
    for (const section of options.compiled.sections) {
      const record: EditorReceiptV2['sections'][number] = { key: section.key, elementId: section.targetId, selected: false, controls: [] }; report.sections.push(record);
      try { await selectNativeWidget(frame.locator(`[data-id="${section.targetId}"]`).first(), page); record.controls = await panelIdentity(page, section.targetId); record.selected = record.controls.length > 0; if (!record.selected) throw Error('Selected native block exposes no editable controls'); }
      catch (error) { record.error = safeErrorV2(error); }
    }
    const baseline = options.snapshot, nodes = flatten(baseline.elements), marker = `cloneWP-v2-editor-${Date.now()}`;
    const tests: Array<{ group: string; key: string; id: string; edits: Array<{ id: string; setting: string; value: unknown }>; fill: () => Promise<void>; confirm: () => Promise<boolean> }> = [];
    const html = options.compiled.htmlProofs[0];
    if (html) {
      const original = String(find(nodes, html.elementId)?.settings.html ?? ''), media = options.compiled.bindings.find(binding => binding.elementId === html.elementId && binding.kind === 'media'), currentAsset = options.assets.find(asset => asset.key === media?.assetKey), replacement = options.assets.find(asset => asset.url !== currentAsset?.url);
      let changed = original + `<span data-cwp-editor-check="${marker}">${marker}</span>`;
      if (currentAsset && replacement) changed = changed.split(currentAsset.url).join(replacement.url);
      changed += `<style>[data-cwp-editor-check="${marker}"]{color:rgb(18,171,125)}</style>`;
      tests.push({ group: currentAsset && replacement ? 'html-code-text-media-style' : 'html-code-text-style', key: html.componentKey, id: html.elementId, edits: [{ id: html.elementId, setting: 'html', value: changed }], fill: () => editCodeV2(page, changed), confirm: async () => { const target = frontend.locator(`[data-cwp-editor-check="${marker}"]`); return await target.count() === 1 && await target.evaluate(element => element.textContent === element.getAttribute('data-cwp-editor-check') && getComputedStyle(element).color === 'rgb(18, 171, 125)') && (!currentAsset || !replacement || await frontend.locator(`[data-id="${html.elementId}"] img`).evaluateAll((images, url) => images.some(image => (image as HTMLImageElement).currentSrc === url), replacement.url)); } });
    }
    const heading = nodes.find(node => node.widgetType === 'heading');
    if (heading) tests.push({ group: 'native-text', key: Object.keys(options.compiled.elementMap).find(key => options.compiled.elementMap[key] === heading.id) ?? heading.id, id: heading.id, edits: [{ id: heading.id, setting: 'title', value: marker }], fill: async () => { const field = page.locator('#elementor-panel textarea[data-setting="title"],#elementor-panel input[data-setting="title"]').first(); await field.fill(marker); await field.press('Tab'); }, confirm: async () => norm(await frontend.locator(`[data-id="${heading.id}"]`).textContent()) === marker });
    const container = nodes.find(node => node.elType === 'container' && options.schemas.container?.controls.min_height?.type === 'slider');
    if (container) { const previous = container.settings.min_height as { size?: number; unit?: string } | undefined, value = { unit: 'px', size: Number(previous?.size ?? 0) + 35, sizes: [] }; tests.push({ group: 'native-layout-field', key: Object.keys(options.compiled.elementMap).find(key => options.compiled.elementMap[key] === container.id) ?? container.id, id: container.id, edits: [{ id: container.id, setting: 'min_height', value }], fill: async () => { const field = page.locator('#elementor-panel .elementor-control-min_height input[data-setting="size"]').filter({ visible: true }).first(); await field.fill(String(value.size)); await field.press('Tab'); }, confirm: async () => await frontend.locator(`[data-id="${container.id}"]`).evaluate((element, expected) => Math.abs(parseFloat(getComputedStyle(element).minHeight) - expected) <= 1, value.size) }); }
    const carousel = nodes.find(node => node.widgetType === 'nested-carousel' && (node.elements?.length ?? 0) > 1);
    if (carousel) { const old = Number(carousel.settings.slides_to_show ?? 1), value = String(old === 1 ? 2 : 1); tests.push({ group: 'native-carousel-display', key: Object.keys(options.compiled.elementMap).find(key => options.compiled.elementMap[key] === carousel.id) ?? carousel.id, id: carousel.id, edits: [{ id: carousel.id, setting: 'slides_to_show', value }], fill: async () => { const control = page.locator('#elementor-panel .elementor-control-slides_to_show select').first(); await chooseNativeCarouselOption(control, value); }, confirm: async () => { const state = (await waitForNativeCarouselReady(frontend.locator(`[data-id="${carousel.id}"]`).first())).state; return state.visibleSlides === Number(value) && state.initialized; } }); }
    const products = nodes.find(node => node.widgetType === 'wd_products');
    if (products) { const controlKey = ['items_per_page', 'posts_per_page', 'products_per_page'].find(key => options.schemas.wd_products?.controls[key] && products.settings[key] !== undefined); if (!controlKey) throw Error('No verified native product-count query control is available for editor save test'); const original = Number(products.settings[controlKey]), value = original > 1 ? original - 1 : original + 1; tests.push({ group: 'native-product-query', key: Object.keys(options.compiled.elementMap).find(key => options.compiled.elementMap[key] === products.id) ?? products.id, id: products.id, edits: [{ id: products.id, setting: controlKey, value }], fill: async () => { const tab = page.locator('#elementor-panel [data-tab="style"],#elementor-panel .elementor-tab-control-style').first(); await tab.click(); if (controlKey === 'items_per_page') await exposeNativeProductQuerySection(page, products.id, 'layout_style_section', 'items_per_page', options.schemas.wd_products); const field = page.locator(`#elementor-panel [data-setting="${controlKey}"]`).filter({ visible: true }).first(); await field.fill(String(value)); await field.press('Tab'); }, confirm: async () => (await frontend.locator(`[data-id="${products.id}"] .product-grid-item.product[data-id]`).evaluateAll(elements => new Set(elements.filter(element => !element.closest('.swiper-slide-duplicate,.slick-cloned')).map(element => element.getAttribute('data-id'))).size)) === value }); }
    if (!tests.length) throw Error('Program has no actual editable representative fields');
    for (const test of tests) {
      await options.onProgress?.(`editor-${test.group}`);
      const check: EditorCheckV2 = { group: test.group, componentKey: test.key, elementId: test.id, selected: false, changed: false, saved: false, frontendConfirmed: false, restored: false }; report.checks.push(check);
      const eventOffset = tracker.events.length; captureEditorSaveLifecycleV2(tracker, check, eventOffset);
      const before = await retryReadV2(() => options.client.snapshotDraft(baseline.pageId)); if (before.hash !== baseline.hash) throw Error('Draft changed before editor group; preserve concurrent edit');
      await ensureDiskSpaceV2(path.resolve(options.runDir, '..', '..'));
      await selectNativeWidget(frame.locator(`[data-id="${test.id}"]`).first(), page); await panelIdentity(page, test.id); check.selected = true;
      let expected = expectedEditorSnapshotV2(before, test.edits, options.schemas); const intent = newMutationIntentV2({ kind: 'editor-test', checkpoint: test.group, pageId: before.pageId, runId: before.runId, beforeHash: before.hash, expectedAfterHash: expected.hash, affectedBlockKeys: [test.key] });
      await writeSnapshotRefV2(options.runDir, path.join(options.runDir, 'mutations', `${intent.id}-before.json`), before); options.journal.mutations.push(intent); options.journal.status = 'restore-pending'; await saveJournalV2(options.journal); active = { intent, before, expected, eventOffset }; report.restorePending = true;
      check.beforeHash = before.hash; await test.fill(); check.changed = true;
      await page.waitForFunction(edits => edits.every(edit => { const value = (window as any).elementor?.getContainer?.(edit.id)?.settings?.get?.(edit.setting); if (typeof edit.value === 'string') return String(value) === edit.value; if (typeof edit.value === 'number') return Number(value) === edit.value; if (edit.value && typeof edit.value === 'object' && 'size' in edit.value) return value && Number(value.size) === Number((edit.value as any).size) && value.unit === (edit.value as any).unit; return value !== undefined; }), test.edits, { timeout: 15_000 });
      const entered = await page.evaluate(edits => edits.map(edit => { const container = (window as any).elementor?.getContainer?.(edit.id); return { ...edit, value: container?.settings?.get?.(edit.setting) }; }), test.edits);
      for (let i = 0; i < entered.length; i++) { if (entered[i].value === undefined || typeof test.edits[i].value === 'string' && String(entered[i].value) !== test.edits[i].value || typeof test.edits[i].value === 'number' && Number(entered[i].value) !== test.edits[i].value) throw Error('Actual native container did not acknowledge the entered control value'); }
      expected = expectedEditorSnapshotV2(before, entered, options.schemas); intent.expectedAfterHash = expected.hash; active.expected = expected; await saveJournalV2(options.journal);
      await saveDraftThroughUI(page, () => tracker!.markSaveClick()); await waitForEditorSaveV2(tracker, check, 'save', eventOffset);
      let modified = await retryReadV2(() => options.client.snapshotDraft(before.pageId));
      for (let attempt = 0; modified.hash === before.hash && attempt < 8; attempt++) { await page.waitForTimeout(350); modified = await retryReadV2(() => options.client.snapshotDraft(before.pageId)); }
      assertEditorDeltaV2(modified, expected); check.saved = true; check.modifiedHash = modified.hash;
      await navigateOwnedPreview(frontend, options.previewUrl); report.previewChromeAdjusted = await normalizePreviewChromeV2(frontend) || report.previewChromeAdjusted; check.frontendConfirmed = await test.confirm(); if (!check.frontendConfirmed) throw Error('Temporary editor field did not change the actual frontend');
      check.screenshot = path.join(directory, `${test.group}.png`); await frontend.screenshot({ path: check.screenshot, fullPage: false });
      const restored = await restoreSnapshotV2(options.client, before, modified, options.journal, test.group, [test.key]); if (restored.hash !== before.hash) throw Error('Editor restoration did not match the original document');
      intent.status = 'confirmed'; options.journal.documentHash = restored.hash; options.journal.status = 'running'; await saveJournalV2(options.journal); active = undefined; report.restorePending = false; check.restored = true; check.restoredHash = restored.hash;
      await loadEditor();
    }
    const final = await retryReadV2(() => options.client.snapshotDraft(baseline.pageId)); if (final.hash !== baseline.hash) throw Error('Final editor document differs from baseline'); report.finalHash = final.hash;
    await navigateOwnedPreview(frontend, options.previewUrl); report.previewChromeAdjusted = await normalizePreviewChromeV2(frontend) || report.previewChromeAdjusted; if (await frontend.locator(`[data-cwp-editor-check="${marker}"]`).count()) throw Error('Restored frontend still contains the temporary editor test marker');
    const preparationPath = path.join(directory, 'restored-render-preparation.json'); let preparation: Record<string, any> = { version: 2, documentHash: baseline.hash, passed: false };
    try {
      preparation = await prepareRestoredRenderingV2(frontend, { rootIds: options.compiled.sectionIds, nativeCarouselIds: nodes.filter(node => node.widgetType === 'nested-carousel').map(node => node.id), productCarouselIds: options.compiled.queryReceipts.filter(query => query.settings.layout === 'carousel').map(query => query.elementId), documentHash: baseline.hash });
      if (await frontend.locator(`[data-cwp-editor-check="${marker}"]`).count()) throw Error('Prepared restored frontend still contains the temporary editor marker');
      const screenshotPath = path.join(directory, 'restored-frontend.png'), screenshotBytes = await frontend.screenshot({ path: screenshotPath, fullPage: true }), dimensions = await sharp(screenshotBytes).metadata();
      const after = await retryReadV2(() => options.client.snapshotDraft(baseline.pageId)); if (after.hash !== baseline.hash) throw Error('Document changed while preparing the final restored screenshot'); report.finalHash = after.hash;
      report.restoredScreenshot = { path: screenshotPath, sha256: hashV2(screenshotBytes), width: dimensions.width!, height: dimensions.height! }; preparation.screenshot = report.restoredScreenshot; preparation.afterDocumentHash = after.hash; preparation.markerAbsent = true;
    } catch (error) { preparation = (error as { evidence?: Record<string, any> }).evidence ?? preparation; preparation.passed = false; preparation.error = safeErrorV2(error); throw error; }
    finally { await writeJson(preparationPath, preparation); report.restoredRendering = { path: preparationPath, sha256: hashV2(await readFile(preparationPath)) }; }
    report.passed = report.sections.length === options.compiled.sections.length && report.sections.every(section => section.selected) && report.checks.every(check => check.selected && check.changed && check.saved && check.frontendConfirmed && check.restored);
  } catch (error) {
    report.error = safeErrorV2(error);
    const check = report.checks.at(-1); if (check) check.error = report.error;
    if (active) {
      try { if (tracker && check) await waitForEditorSaveV2(tracker, check, 'failure-recovery', active.eventOffset); const current = await retryReadV2(() => options.client.snapshotDraft(active!.before.pageId)); if (current.hash !== active.before.hash) assertEditorDeltaV2(current, active.expected); const restored = await restoreSnapshotV2(options.client, active.before, current, options.journal, active.intent.checkpoint, active.intent.affectedBlockKeys); active.intent.status = 'confirmed'; options.journal.documentHash = restored.hash; options.journal.status = 'running'; report.restorePending = false; if (check) { check.restored = true; check.restoredHash = restored.hash; } await saveJournalV2(options.journal); }
      catch (restoreError) { report.restorePending = true; options.journal.status = 'restore-pending'; active.intent.error = safeErrorV2(restoreError); await saveJournalV2(options.journal); }
    }
  } finally { await context.close(); await browser.close(); if (active && tracker && report.checks.at(-1)) captureEditorSaveLifecycleV2(tracker, report.checks.at(-1)!, active.eventOffset); await persistEditorAttemptV2(attempt, report); }
  return report;
}
const norm = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
