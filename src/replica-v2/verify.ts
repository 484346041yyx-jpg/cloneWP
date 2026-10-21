import path from 'node:path';
import { readFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, type Cookie, type Page } from 'playwright';
import sharp from 'sharp';
import { writeJson } from '../core/files.js';
import { createScopedContext } from '../verification/capture-target.js';
import { navigateOwnedPreview } from '../verification/owned-preview.js';
import { carouselState, waitForNativeCarouselReady, sameLogicalCarouselPosition } from '../fidelity/acceptance.js';
import { collectNativeCatalogRender, waitForNativeCatalogReady, nativeCatalogRuntime } from '../fidelity/catalog-browser.js';
import type { TargetCatalogEvidence } from '../fidelity/catalog-contract.js';
import type { ProgramV2, CompiledReplicaV2, ImportedAssetV2 } from './types.js';
import type { CapabilitySampleV2 } from './capability-sample.js';
import { verifyProductCarouselInteractionV2 } from './product-interaction.js';
import { resolveNativeCarouselV2, nativeAutoplayV2, revealNativeMediaV2 } from './native-carousel.js';
import { scrollWholePageV2 } from './render-preparation.js';
import type { NativeCheckpointProof } from '../wordpress/types.js';
import { hashV2, canonicalV2, isHashV2, safeErrorV2 } from './journal.js';

export type VisualCheckpointV2 = 'desktop-firstfold' | 'desktop' | 'responsive';
export interface MeasurementRefV2 { path: string; sha256: string; pointer?: string }
export interface ReviewResumeSealV2 { version: 1; environmentHash: string; environmentLockHash: string; assetsManifestHash: string; capabilitiesRef: MeasurementRefV2; checkpointProof: NativeCheckpointProof }
export interface RequirementCheckV2 { id: string; viewport: string; kind: string; status: 'passed' | 'failed' | 'unverified'; expected?: unknown; /** Historical receipts keep inline actual; new receipts reference one raw store. */ actual?: unknown; actualRef?: MeasurementRefV2; error?: string }
export interface CaptureReceiptV2 { version: 2; checkpoint: VisualCheckpointV2; documentHash: string; programHash: string; componentPlanHash: string; sourceFactsHash: string; createdAt: string; checks: RequirementCheckV2[]; automatedPassed: boolean; screenshots: Array<{ viewport: string; path: string; sha256: string; width: number; height: number; previewChromeAdjusted?: boolean }>; evidence: string[]; editorSessions: 0; browserRequests?: number; blockedMutationRequests?: number; motionPreference?: 'no-preference'; reportPath?: string; viewports?: Array<{ name: string; width: number; height: number }>; reviewResume?: ReviewResumeSealV2 }
export interface VisualReviewV2 { version: 2; checkpoint: VisualCheckpointV2; documentHash: string; captureHash: string; screenshotHashes: string[]; reviewer: 'codex'; verdict: 'passed' | 'failed'; notes: string; createdAt: string }
const norm = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const checkpointPath = (runDir: string, checkpoint: VisualCheckpointV2) => path.join(runDir, 'verification', checkpoint);
export function captureViewsV2(program: ProgramV2, checkpoint: VisualCheckpointV2): ProgramV2['viewports'] { const desktop = program.viewports.filter(view => view.stage === 'desktop'); return checkpoint === 'responsive' ? [...desktop, ...program.viewports.filter(view => view.stage === 'responsive')] : checkpoint === 'desktop-firstfold' ? desktop.slice(0, 1) : desktop; }
export function hasViewportCoverageV2(capture: CaptureReceiptV2, program: ProgramV2, checkpoint: VisualCheckpointV2): boolean { return captureViewsV2(program, checkpoint).every(view => capture.viewports?.some(actual => actual.name === view.name && actual.width === view.width && actual.height === view.height) && capture.screenshots.some(shot => shot.viewport === view.name && shot.width === view.width) && capture.checks.some(check => check.viewport === view.name && check.id === 'page-health' && check.status === 'passed')); }
/** Full-page Chromium rasters may exclude a real scrollbar; accept only exact hash-bound browser/client/PNG measurements. */
export async function hasVerifiedViewportCoverageV2(capture: CaptureReceiptV2, program: ProgramV2, checkpoint: VisualCheckpointV2, runDir: string): Promise<boolean> {
  for (const view of captureViewsV2(program, checkpoint)) {
    if (!capture.viewports?.some(actual => actual.name === view.name && actual.width === view.width && actual.height === view.height)) return false;
    const shots = capture.screenshots.filter(shot => shot.viewport === view.name), checks = capture.checks.filter(check => check.viewport === view.name && check.id === 'page-health');
    if (shots.length !== 1 || checks.length !== 1 || checks[0].status !== 'passed') return false;
    const shot = shots[0]; if (shot.width === view.width) continue;
    const cache = new Map<string, unknown>(), actual = await readCheckActualV2(checks[0], runDir, cache) as { viewport?: number; clientWidth?: number; scrollWidth?: number } | undefined;
    if (!actual || actual.viewport !== view.width || !Number.isInteger(actual.clientWidth) || actual.clientWidth! <= 0 || actual.clientWidth! >= view.width || actual.clientWidth !== shot.width || !Number.isFinite(actual.scrollWidth) || actual.scrollWidth! > actual.clientWidth! + 2) return false;
    const ref = checks[0].actualRef;
    if (ref) { const store = cache.get(canonicalV2({ path: ref.path, sha256: ref.sha256 })) as { storage?: string; documentHash?: string; viewport?: string } | undefined; if (store?.storage === 'measurement-store' && (store.documentHash !== capture.documentHash || store.viewport !== view.name)) return false; }
    const relative = path.relative(path.resolve(runDir), path.resolve(shot.path)); if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('Viewport screenshot escaped its owned run');
    const bytes = await readFile(shot.path); if (hashV2(bytes) !== shot.sha256) throw Error('Viewport screenshot bytes changed'); const metadata = await sharp(bytes).metadata();
    if (metadata.width !== shot.width || metadata.height !== shot.height) return false;
  }
  return true;
}
/** Browser-only exclusion of authenticated WordPress chrome, never site or editor UI. */
export async function normalizePreviewChromeV2(page: Page): Promise<boolean> {
  const adjusted = await page.locator('#wpadminbar').count() > 0;
  if (adjusted) await page.addStyleTag({ content: '#wpadminbar{display:none!important}html{margin-top:0!important}' });
  return adjusted;
}
/** A viewport's raw states are content-addressed once, including shared interactions. */
export async function persistViewportMeasurementsV2(directory: string, viewport: string, documentHash: string, checks: RequirementCheckV2[]): Promise<MeasurementRefV2> {
  const measurements: Record<string, unknown> = {}, requirements: Record<string, string> = {};
  for (const check of checks) if (check.viewport === viewport && Object.hasOwn(check, 'actual')) { const id = hashV2(canonicalV2(check.actual)); measurements[id] = check.actual; requirements[check.id] = id; }
  const filename = path.join(directory, `${viewport}.json`); await writeJson(filename, { version: 2, storage: 'measurement-store', documentHash, viewport, measurements, requirements });
  const sha256 = hashV2(await readFile(filename));
  for (const check of checks) if (check.viewport === viewport && Object.hasOwn(check, 'actual')) { check.actualRef = { path: filename, sha256, pointer: `/measurements/${hashV2(canonicalV2(check.actual))}` }; delete check.actual; }
  return { path: filename, sha256 };
}
/** Reads both old inline receipts and hash-checked new references. */
export async function readCheckActualV2(check: RequirementCheckV2, runDir: string, cache = new Map<string, unknown>()): Promise<unknown> {
  if (Object.hasOwn(check, 'actual')) return check.actual;
  const ref = check.actualRef; if (!ref) return undefined;
  const relative = path.relative(path.resolve(runDir), path.resolve(ref.path)); if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('Raw measurement reference escaped its run');
  const key = canonicalV2({ path: ref.path, sha256: ref.sha256 });
  if (!cache.has(key)) { const bytes = await readFile(ref.path); if (hashV2(bytes) !== ref.sha256) throw Error('Raw measurement bytes changed'); cache.set(key, JSON.parse(bytes.toString('utf8'))); }
  let value: any = cache.get(key);
  if (ref.pointer) { if (!ref.pointer.startsWith('/')) throw Error('Invalid measurement pointer'); for (const part of ref.pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) { if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) throw Error('Raw measurement pointer is missing'); value = value[part]; } }
  return value;
}
async function verifyMeasurementRefsV2(capture: CaptureReceiptV2, runDir: string): Promise<void> {
  const verified = new Set<string>(), cache = new Map<string, unknown>(); for (const check of capture.checks ?? []) if (check.actualRef) { const key = canonicalV2(check.actualRef); if (!verified.has(key)) { const actual = await readCheckActualV2(check, runDir, cache); const catalogRef = actual && typeof actual === 'object' ? (actual as { catalogRef?: MeasurementRefV2 }).catalogRef : undefined; if (catalogRef) await readCheckActualV2({ id: 'catalog-evidence', viewport: check.viewport, kind: 'target-catalog', status: 'passed', actualRef: catalogRef }, runDir, cache); verified.add(key); } }
}
async function catalogReferenceV2(catalog: TargetCatalogEvidence, runDir: string): Promise<MeasurementRefV2> {
  const filename = catalog.evidence[0]; if (!filename) throw Error('Current target catalog has no immutable local evidence');
  const relative = path.relative(runDir, filename); if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('Target catalog evidence escaped its owned run');
  return { path: filename, sha256: hashV2(await readFile(filename)) };
}
function renderedCatalogOnlyV2(actual: unknown, catalogRef: MeasurementRefV2): Record<string, unknown> {
  const { catalog: _catalog, ...rendered } = actual as Record<string, unknown>; return { ...rendered, catalogRef };
}
async function waitForVisibleCatalogImagesV2(widget: import('playwright').Locator): Promise<void> {
  await widget.evaluate(async root => { const frame = root.getBoundingClientRect(); await Promise.all(Array.from(root.querySelectorAll('img')).filter(image => { const box = image.getBoundingClientRect(), css = getComputedStyle(image); return box.width > 0 && box.height > 0 && box.right > frame.left && box.left < frame.right && box.bottom > frame.top && box.top < frame.bottom && css.display !== 'none' && css.visibility !== 'hidden'; }).map(image => new Promise<void>(resolve => { if (image.complete) { resolve(); return; } const timeout = setTimeout(resolve, 8_000); const done = () => { clearTimeout(timeout); resolve(); }; image.addEventListener('load', done, { once: true }); image.addEventListener('error', done, { once: true }); }))); });
}
/** Decode actual CSS backgrounds, or reveal a genuinely deferred image and restore its real browser scroll owners. */
export async function probeDeferredMediaV2(page: Page, selector: string, expectedURL: string, allowDeferred = true): Promise<Record<string, unknown> | undefined> {
  const target = page.locator(selector); if (await target.count() !== 1) return;
  const background = await target.evaluate(root => { const backgroundImage = getComputedStyle(root).backgroundImage, urls = Array.from(backgroundImage.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g), match => { try { return new URL((match[1] ?? match[2] ?? match[3]).trim(), document.baseURI).href; } catch { return ''; } }); return { backgroundImage, urls, typedBackground: root.hasAttribute('data-cwp-background') }; });
  if (background.urls.includes(expectedURL)) {
    const evidence: Record<string, unknown> = { kind: 'css-background', url: expectedURL, backgroundImage: background.backgroundImage };
    try {
      const decoded = await target.evaluate(async (root, { url, backgroundImage }) => {
        if (getComputedStyle(root).backgroundImage !== backgroundImage) throw Error('Registered CSS background changed before decode');
        const image = new Image(); await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error('Registered CSS background did not decode within its bounded deadline')), 10_000); image.onload = () => { clearTimeout(timer); image.naturalWidth > 0 && image.naturalHeight > 0 ? resolve() : reject(Error('Registered CSS background has no decodable pixels')); }; image.onerror = () => { clearTimeout(timer); reject(Error('Registered CSS background has no decodable pixels')); }; image.src = url; });
        await image.decode(); const box = root.getBoundingClientRect(); if (!root.isConnected || getComputedStyle(root).backgroundImage !== backgroundImage) throw Error('Registered CSS background changed during decode');
        return { decoded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, ownerWidth: box.width, ownerHeight: box.height };
      }, { url: expectedURL, backgroundImage: background.backgroundImage });
      return { ...evidence, ...decoded };
    } catch (error) { throw Object.assign(Error(safeErrorV2(error)), { evidence }); }
  }
  // A declared background must be judged from its own CSS; its foreground img may use a different legitimate asset.
  if (background.typedBackground || !allowDeferred) return;
  const initial = await target.evaluate(root => {
    const images = root instanceof HTMLImageElement ? [root] : Array.from(root.querySelectorAll('img')); if (images.length !== 1) return;
    const image = images[0], box = image.getBoundingClientRect(); let rendered = box.width > 0 && box.height > 0;
    for (let parent: Element | null = image; parent; parent = parent.parentElement) { const css = getComputedStyle(parent); if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0 || css.contentVisibility === 'hidden') rendered = false; if (parent !== image && parent.tagName === 'DETAILS' && !parent.hasAttribute('open') && getComputedStyle(parent, '::details-content').contentVisibility !== 'visible' && !Array.from(parent.children).find(child => child.tagName === 'SUMMARY')?.contains(image)) rendered = false; }
    return { src: image.currentSrc, complete: image.complete, naturalWidth: image.naturalWidth, rendered };
  });
  if (!initial?.rendered || initial.src === expectedURL && initial.complete && initial.naturalWidth > 0) return;
  const saved = await target.evaluateHandle(root => { const owners: Array<{ element: Element; left: number; top: number }> = []; for (let element: Element | null = root; element; element = element.parentElement) if (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight || element.scrollLeft || element.scrollTop) owners.push({ element, left: element.scrollLeft, top: element.scrollTop }); return { x: scrollX, y: scrollY, owners }; });
  const evidence: Record<string, unknown> = { kind: 'deferred-image', before: initial, beforeScroll: await saved.evaluate(state => ({ x: state.x, y: state.y, owners: state.owners.map(owner => ({ tag: owner.element.tagName, left: owner.left, top: owner.top })) })) };
  let nativeReveal: Awaited<ReturnType<typeof revealNativeMediaV2>>;
  try {
    nativeReveal = await revealNativeMediaV2(target); if (nativeReveal) evidence.nativeCarousel = nativeReveal.evidence;
    await target.scrollIntoViewIfNeeded({ timeout: 5_000 });
    await page.waitForFunction(({ selector, expectedURL }) => { const root = document.querySelector(selector), image = root instanceof HTMLImageElement ? root : root?.querySelector('img'); if (image?.currentSrc === expectedURL && image.complete && image.naturalWidth <= 0) throw Error('Deferred registered image completed without decodable pixels'); return image?.currentSrc === expectedURL; }, { selector, expectedURL }, { timeout: 10_000 });
    const decoded = await target.evaluate(async (root, expectedURL) => {
      const image = root instanceof HTMLImageElement ? root : root.querySelector('img')!;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([image.decode(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('Deferred registered image did not decode within its bounded deadline')), 10_000); })]); }
      catch { throw Error('Deferred registered image has no decodable pixels'); } finally { if (timer) clearTimeout(timer); }
      if (!image.isConnected || image.currentSrc !== expectedURL || image.naturalWidth <= 0 || image.naturalHeight <= 0) throw Error('Deferred registered image changed or has no decodable pixels');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d'); if (!context) throw Error('Deferred image drawable pixel probe is unavailable'); context.drawImage(image, 0, 0, 1, 1);
      return { decoded: true, drawable: true, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
    }, expectedURL);
    const after = await target.evaluate(root => {
      const image = root instanceof HTMLImageElement ? root : root.querySelector('img')!, box = image.getBoundingClientRect(); let left = Math.max(0, box.left), right = Math.min(innerWidth, box.right), top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom);
      for (let parent = image.parentElement; parent; parent = parent.parentElement) { const css = getComputedStyle(parent), clip = parent.getBoundingClientRect(); if (/^(hidden|clip|auto|scroll)$/.test(css.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); } if (/^(hidden|clip|auto|scroll)$/.test(css.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); } }
      return { src: image.currentSrc, complete: image.complete, naturalWidth: image.naturalWidth, paintedWidth: Math.max(0, right - left), paintedHeight: Math.max(0, bottom - top), x: scrollX, y: scrollY };
    }); evidence.after = { ...after, ...decoded };
    if (after.src !== expectedURL || !decoded.decoded || !decoded.drawable || after.naturalWidth <= 0 || after.paintedWidth <= 1 || after.paintedHeight <= 1) throw Error('Deferred media did not draw its registered image inside the actual scroll window');
  } catch (error) { const failedNative = (error as { evidence?: unknown }).evidence; if (failedNative && !evidence.nativeCarousel) evidence.nativeCarousel = failedNative; throw Object.assign(Error(safeErrorV2(error)), { evidence }); }
  finally {
    let nativeRestoreError: unknown;
    try { await nativeReveal?.restore(); } catch (error) { nativeRestoreError = error; }
    try { evidence.restored = await saved.evaluate(async state => { for (const owner of [...state.owners].reverse()) { owner.element.scrollLeft = owner.left; owner.element.scrollTop = owner.top; } scrollTo(state.x, state.y); await new Promise(resolve => setTimeout(resolve, 150)); const owners = state.owners.map(owner => ({ connected: owner.element.isConnected, beforeLeft: owner.left, beforeTop: owner.top, left: owner.element.scrollLeft, top: owner.element.scrollTop })); return { x: scrollX, y: scrollY, owners, exact: Math.abs(scrollX - state.x) <= 1 && Math.abs(scrollY - state.y) <= 1 && owners.every(owner => owner.connected && Math.abs(owner.left - owner.beforeLeft) <= 1 && Math.abs(owner.top - owner.beforeTop) <= 1) }; }); if (!(evidence.restored as { exact: boolean }).exact) throw Error('Deferred media probe failed to restore its original scroll owners'); }
    catch (error) { throw Object.assign(Error(safeErrorV2(error)), { evidence }); }
    finally { await saved.dispose(); }
    if (nativeRestoreError) throw Object.assign(Error(safeErrorV2(nativeRestoreError)), { evidence });
  }
  return evidence;
}
/** Archive only summary files; immutable raw files keep their original paths and hashes. */
export async function archiveCaptureReceiptV2(directory: string): Promise<void> {
  const filename = path.join(directory, 'capture.json'); let bytes: Buffer;
  try { bytes = await readFile(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const digest = hashV2(bytes); let immutable: string | undefined;
  try { const previous = JSON.parse(bytes.toString('utf8')) as CaptureReceiptV2, candidate = previous.reportPath; if (candidate) { const relative = path.relative(directory, candidate); if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) && hashV2(await readFile(candidate)) === digest) immutable = candidate; } } catch { /* Preserve legacy or malformed summaries below without rewriting their bytes. */ }
  const destination = immutable ? path.dirname(immutable) : path.join(directory, 'history', `${digest.slice(0, 16)}-${randomUUID().slice(0, 8)}`); await mkdir(destination, { recursive: true });
  const entries: Array<{ from: string; path: string; sha256: string }> = [{ from: filename, path: immutable ?? path.join(destination, 'capture.json'), sha256: digest }];
  let reviewBytes: Buffer | undefined; try { reviewBytes = await readFile(path.join(directory, 'visual-review.json')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (reviewBytes) entries.push({ from: path.join(directory, 'visual-review.json'), path: path.join(destination, 'visual-review.json'), sha256: hashV2(reviewBytes) });
  let index: { version: 2; relocations: typeof entries }; try { index = JSON.parse(await readFile(path.join(directory, 'history-index.json'), 'utf8')); if (index.version !== 2 || !Array.isArray(index.relocations)) throw Error('Capture history index is invalid'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; index = { version: 2, relocations: [] }; }
  // Persist the exact relocation intent before moving any prior evidence.
  index.relocations.push(...entries); await writeJson(path.join(directory, 'history-index.json'), index);
  for (const entry of entries) if (entry.path !== immutable) await rename(entry.from, entry.path);
}

export async function verifyProductCapabilityProbeV2(options: { compiled: CompiledReplicaV2; catalog?: TargetCatalogEvidence; sample?: CapabilitySampleV2; previewUrl: string; cookies: Cookie[]; runDir: string; documentHash: string }): Promise<{ version: 2; passed: boolean; documentHash: string; evidence: string; error?: string }> {
  const directory = path.join(options.runDir, 'verification', options.sample ? 'capability-mixed' : 'capability-product'); await mkdir(directory, { recursive: true }); const evidence = path.join(directory, 'receipt.json'), report: any = { version: 2, passed: false, documentHash: options.documentHash, evidence, editorSessions: 0, queries: [] };
  const browser = await chromium.launch({ headless: true }), context = await createScopedContext(browser, options.previewUrl, { cookies: options.cookies }, { readOnly: true });
  try {
    const page = await context.newPage(); await page.emulateMedia({ reducedMotion: 'no-preference' }); report.motionPreference = 'no-preference'; await page.setViewportSize({ width: 1920, height: 1080 }); await navigateOwnedPreview(page, options.previewUrl); report.previewChromeAdjusted = await normalizePreviewChromeV2(page); await page.evaluate(async () => { await document.fonts.ready; });
    if (options.sample?.html) {
      const expected = options.sample.html, node = page.locator(expected.selector); await node.waitFor({ state: 'visible', timeout: 15_000 });
      const actual = await node.evaluate(element => { const css = getComputedStyle(element), cta = element.querySelector('.cta'), button = cta ? getComputedStyle(cta) : null; return { text: element.querySelector('[data-cwp-text="copy"]')?.textContent, ctaText: cta?.textContent, display: css.display, columns: css.gridTemplateColumns.split(/\s+/).filter(Boolean), padding: parseFloat(css.paddingTop), backgroundColor: css.backgroundColor, cta: button ? { backgroundColor: button.backgroundColor, paddingTop: parseFloat(button.paddingTop), paddingLeft: parseFloat(button.paddingLeft), borderRadius: parseFloat(button.borderTopLeftRadius) } : null }; });
      if (norm(actual.text) !== norm(expected.text) || norm(actual.ctaText) !== norm(expected.ctaText) || actual.display !== 'grid' || actual.columns.length !== expected.gridColumns || actual.columns.some(value => !Number.isFinite(parseFloat(value)) || parseFloat(value) <= 0) || actual.padding !== expected.padding || actual.backgroundColor !== expected.backgroundColor || actual.cta?.backgroundColor !== 'rgb(255, 203, 0)' || actual.cta.paddingTop !== 12 || actual.cta.paddingLeft !== 24 || actual.cta.borderRadius !== 8) throw Error('Typed HTML capability sample lost its text, scoped Grid, background or CTA paint');
      report.html = { expected, actual, passed: true };
    }
    if (options.sample?.carousel) {
      const expected = options.sample.carousel, selector = `[data-id="${expected.elementId}"]`, widget = page.locator(selector), slides = widget.locator('.swiper-wrapper > .swiper-slide:not(.swiper-slide-duplicate)'); await widget.scrollIntoViewIfNeeded(); await waitForNativeCarouselReady(widget);
      if (await slides.count() !== 2) throw Error('Mixed native carousel sample did not retain exactly two actual native slides');
      for (let index = 0; index < expected.slideElementIds.length; index++) if (await slides.nth(index).locator(`[data-id="${expected.slideElementIds[index]}"]`).count() !== 1) throw Error('Mixed native carousel sample lost its planned child/container identity');
      const heading = slides.nth(1).locator(`[data-id="${expected.headingElementId}"] .elementor-heading-title`); if (await heading.count() !== 1 || norm(await heading.textContent()) !== norm(expected.text)) throw Error('Mixed native carousel sample did not render its actual native heading');
      if (expected.htmlElementId && await slides.nth(0).locator(`[data-id="${expected.htmlElementId}"] [data-cwp-component]`).count() !== 1) throw Error('Mixed native carousel sample did not render its scoped static HTML slide');
      const actual = await runInteraction(page, selector, 'carousel', { manual: true, pagination: expected.pagination }) as { after?: { activeSourceIds?: string[] } };
      if (!actual.after?.activeSourceIds?.some(id => id === 'index:1' || id === 'original:1')) throw Error('Mixed carousel arrow did not expose the actual second native heading slide'); report.carousel = { expected, actual, passed: true };
    }
    for (const query of options.compiled.queryReceipts) {
      if (!options.catalog) throw Error('Native capability sample has no actual target catalog evidence');
      const widget = page.locator(`[data-id="${query.elementId}"]`); await widget.scrollIntoViewIfNeeded(); await widget.locator('.product-grid-item.product[data-id]').first().waitFor({ state: 'visible', timeout: 15_000 });
      if (query.settings.layout === 'carousel') await waitForNativeCatalogReady(widget, 15_000);
      await widget.locator('img').evaluateAll(async images => { await Promise.all(images.map(image => new Promise<void>(resolve => { const img = image as HTMLImageElement; if (img.complete && img.naturalWidth > 0) { resolve(); return; } const timeout = setTimeout(resolve, 15_000); const done = () => { clearTimeout(timeout); resolve(); }; img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }))); });
      const actual = await collectNativeCatalogRender({ page, blockId: query.componentKey, widgetKey: query.componentKey, elementId: query.elementId, viewport: 'desktop', catalog: options.catalog });
      const ids = [...new Set(actual.products.map(product => product.id))]; if (canonicalV2(ids) !== canonicalV2(query.productIds)) throw Error('Native product capability sample returned different target IDs/order');
      for (const product of actual.products) { const expected = options.catalog.products.find(item => item.id === product.id); if (!expected || norm(product.name) !== norm(expected.name) || product.permalink !== expected.permalink || ![expected.imageUrl, ...(expected.imageVariants ?? [])].includes(product.imageUrl) || expected.priceText && norm(product.priceText) !== norm(expected.priceText)) throw Error('Native product capability sample differs from actual WooCommerce fields'); }
      const styles = await widget.evaluate(root => { const box = root.getBoundingClientRect(), card = root.querySelector('.product-grid-item.product[data-id]'), css = card ? getComputedStyle(card) : null, cardBox = card?.getBoundingClientRect(); return { registeredWidget: root.getAttribute('data-widget_type') === 'wd_products.default', rect: { width: box.width, height: box.height }, cardRect: cardBox ? { width: cardBox.width, height: cardBox.height } : null, cardColor: css?.color, cardDisplay: css?.display }; });
      if (!styles.registeredWidget || !styles.cardRect || styles.cardRect.width <= 0 || styles.cardRect.height <= 0 || styles.cardDisplay === 'none' || !styles.cardColor) throw Error('Native product capability sample has no actual styled card paint'); report.queries.push({ query, actual: renderedCatalogOnlyV2(actual, await catalogReferenceV2(options.catalog, options.runDir)), styles });
    }
    if (!report.queries.length && !report.html && !report.carousel) throw Error('Native capability probe has no actual HTML, carousel or product sample'); const screenshot = path.join(directory, 'sample.png'), bytes = await page.screenshot({ path: screenshot, fullPage: true }); report.screenshot = { path: screenshot, sha256: hashV2(bytes) }; report.passed = true;
  } catch (error) { report.error = safeErrorV2(error); }
  finally { await context.close(); await browser.close(); await writeJson(evidence, report); }
  return report;
}
export { verifyProductCapabilityProbeV2 as verifyCapabilitySampleV2 };

export async function loadValidReviewV2(runDir: string, checkpoint: VisualCheckpointV2, documentHash: string): Promise<VisualReviewV2 | undefined> {
  try {
    const directory = checkpointPath(runDir, checkpoint), bytes = await readFile(path.join(directory, 'capture.json')), capture = JSON.parse(bytes.toString()) as CaptureReceiptV2;
    const review = JSON.parse(await readFile(path.join(directory, 'visual-review.json'), 'utf8')) as VisualReviewV2;
    if (review.version !== 2 || review.reviewer !== 'codex' || review.checkpoint !== checkpoint || review.documentHash !== documentHash || capture.documentHash !== documentHash || review.captureHash !== hashV2(bytes) || canonicalV2(review.screenshotHashes) !== canonicalV2(capture.screenshots.map(item => item.sha256))) return;
    for (const screenshot of capture.screenshots) if (hashV2(await readFile(screenshot.path)) !== screenshot.sha256) return;
    await verifyMeasurementRefsV2(capture, runDir);
    return review;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}
/** Called only after Codex actually inspects the exact screenshots; automation cannot manufacture this judgment. */
export async function recordVisualReviewV2(runDir: string, input: { checkpoint: VisualCheckpointV2; documentHash: string; verdict: 'passed' | 'failed'; notes: string; reviewer: 'codex' }): Promise<VisualReviewV2> {
  if (!isHashV2(input.documentHash) || input.reviewer !== 'codex' || !input.notes.trim()) throw Error('A visual review requires Codex notes and an exact document hash');
  const directory = checkpointPath(runDir, input.checkpoint), bytes = await readFile(path.join(directory, 'capture.json')), capture = JSON.parse(bytes.toString()) as CaptureReceiptV2;
  if (capture.version !== 2 || capture.documentHash !== input.documentHash || capture.checkpoint !== input.checkpoint || !capture.screenshots.length || input.verdict === 'passed' && !capture.automatedPassed) throw Error('Visual judgment cannot pass a different document or unresolved automated checks');
  for (const screenshot of capture.screenshots) if (hashV2(await readFile(screenshot.path)) !== screenshot.sha256) throw Error('Screenshot changed before visual judgment');
  await verifyMeasurementRefsV2(capture, runDir);
  const receipt: VisualReviewV2 = { ...input, version: 2, captureHash: hashV2(bytes), screenshotHashes: capture.screenshots.map(item => item.sha256), createdAt: new Date().toISOString() };
  await writeJson(path.join(directory, 'visual-review.json'), receipt); return receipt;
}

async function runInteraction(page: Page, selector: string, property: string | undefined, expected: unknown): Promise<unknown> {
  let node = page.locator(selector).first();
  if (property === 'carousel' && await node.getAttribute('data-widget_type') === 'wd_products.default') return verifyProductCarouselInteractionV2(page.locator(selector), expected);
  if (property === 'scroll') {
    const specification = expected as { axis?: string; minOverflow?: number }, minimum = specification?.minOverflow;
    if (specification?.axis !== 'x' || typeof minimum !== 'number' || !Number.isFinite(minimum) || minimum < 1 || await page.locator(selector).count() !== 1) throw Error('Horizontal scroll requires one actual owner, axis x and a finite positive minimum overflow');
    const sample = () => node.evaluate(element => { const box = element.getBoundingClientRect(), css = getComputedStyle(element); return { left: element.scrollLeft, width: element.clientWidth, scrollWidth: element.scrollWidth, overflow: element.scrollWidth - element.clientWidth, direction: css.direction, overflowX: css.overflowX, visible: box.width > 0 && box.height > 0 && css.display !== 'none' && css.visibility !== 'hidden' }; });
    await node.scrollIntoViewIfNeeded(); const before = await sample();
    if (!before.visible || !['auto', 'scroll'].includes(before.overflowX) || before.overflow < minimum || ![before.left, before.width, before.scrollWidth].every(Number.isFinite)) throw Error('Declared horizontal scroll owner has no actual user-scrollable overflow');
    const evidence: { before: typeof before; after?: typeof before; restored?: typeof before; wheelDeltaX?: number; error?: string } = { before };
    try {
      const sign = before.direction === 'rtl' ? -1 : 1, atEnd = Math.abs(before.left) >= before.overflow - 1, delta = sign * (atEnd ? -1 : 1) * Math.min(before.overflow, Math.max(40, before.width * 0.7)); evidence.wheelDeltaX = delta;
      await node.hover(); await page.mouse.wheel(delta, 0);
      await page.waitForFunction(({ selector, initial }) => { const element = document.querySelector(selector); return !!element && Math.abs(element.scrollLeft - initial) >= 1; }, { selector, initial: before.left }, { timeout: 3_000 });
      // Allow browser scroll snapping to settle before judging actual movement.
      await page.waitForTimeout(200); evidence.after = await sample();
      if (Math.abs(evidence.after.left - before.left) < 1 || Math.abs(evidence.after.scrollWidth - before.scrollWidth) > 1 || Math.abs(evidence.after.width - before.width) > 1) throw Error('Actual horizontal wheel did not move a stable owned scroll window');
      return evidence;
    } catch (error) { evidence.error = safeErrorV2(error); throw Object.assign(Error(evidence.error), { evidence }); }
    finally {
      await node.evaluate((element, left) => { element.scrollLeft = left; }, before.left); await page.waitForTimeout(150); evidence.restored = await sample();
      if (Math.abs(evidence.restored.left - before.left) > 1) throw Object.assign(Error('Horizontal scroll interaction could not restore its original scrollLeft'), { evidence });
    }
  }
  if (property === 'disclosure') {
    const specification = expected as { target?: string; initialOpen?: boolean; ownedContent?: Array<{ selector: string; text: string; href?: string }> };
    if (!specification || typeof specification.target !== 'string' || !specification.target.trim() || typeof specification.initialOpen !== 'boolean' || await page.locator(selector).count() !== 1 || await node.evaluate(element => element.tagName) !== 'DETAILS') throw Error('Disclosure requires a unique actual details owner, child target and explicit initial open state');
    const summary = node.locator(':scope > summary'), target = node.locator(specification.target); if (await summary.count() !== 1 || await target.count() !== 1 || !await summary.isVisible()) throw Error('Disclosure must own exactly one visible summary and its unique declared child navigation');
    const state = async () => ({ open: await node.evaluate(element => (element as HTMLDetailsElement).open), targetVisible: await target.isVisible() });
    const before = await state(); if (before.open !== specification.initialOpen || before.targetVisible !== specification.initialOpen) throw Error('Disclosure initial open state or child visibility differs from its plan');
    if (specification.ownedContent !== undefined && (!Array.isArray(specification.ownedContent) || specification.ownedContent.some(item => !item || typeof item.selector !== 'string' || !item.selector.trim() || typeof item.text !== 'string' || item.href !== undefined && typeof item.href !== 'string'))) throw Error('Disclosure owned content requires explicit relative selectors, exact text and optional own anchor href');
    const saved = await target.evaluateHandle(root => ({ x: scrollX, y: scrollY, owners: [root, ...root.querySelectorAll('*')].filter(element => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight || element.scrollLeft || element.scrollTop).map(element => ({ element, left: element.scrollLeft, top: element.scrollTop })) }));
    const evidence: Record<string, unknown> = { before, ownedContent: [] };
    const verifyOwnedContent = async () => {
      const targetHandle = await target.elementHandle();
      try { for (const expected of specification.ownedContent ?? []) {
        const content = node.locator(expected.selector);
        if (await content.count() !== 1 || !await content.evaluate((element, owner) => !!owner?.contains(element), targetHandle)) throw Error('Disclosure content does not uniquely belong to its declared child navigation');
        await content.scrollIntoViewIfNeeded({ timeout: 3_000 });
        const actual = await content.evaluate(element => {
          const box = element.getBoundingClientRect(); let visible = box.width > 0 && box.height > 0, left = Math.max(0, box.left), right = Math.min(innerWidth, box.right), top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom);
          for (let owner: Element | null = element; owner; owner = owner.parentElement) { const css = getComputedStyle(owner), clip = owner.getBoundingClientRect(); if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0 || css.contentVisibility === 'hidden' || owner.tagName === 'DETAILS' && !owner.hasAttribute('open') && getComputedStyle(owner, '::details-content').contentVisibility !== 'visible') visible = false; if (owner !== element && /^(hidden|clip|auto|scroll)$/.test(css.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); } if (owner !== element && /^(hidden|clip|auto|scroll)$/.test(css.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); } }
          return { text: (element as HTMLElement).innerText ?? element.textContent ?? '', href: element instanceof HTMLAnchorElement ? element.href : null, tag: element.tagName, visible: visible && right - left > 1 && bottom - top > 1 };
        });
        (evidence.ownedContent as unknown[]).push({ selector: expected.selector, ...actual });
        if (!actual.visible || norm(actual.text) !== norm(expected.text) || expected.href !== undefined && (actual.tag !== 'A' || actual.href !== expected.href)) throw Error('Opened disclosure content text, own link or actual visibility differs from its plan');
      } } finally { await targetHandle?.dispose(); }
    };
    try {
      await summary.click(); const after = await state(); if (after.open === before.open || after.targetVisible !== !before.open) throw Error('Actual summary click did not toggle its owned navigation');
      evidence.after = after; if (after.open) await verifyOwnedContent();
      await summary.press('Enter'); const restored = await state(); if (canonicalV2(restored) !== canonicalV2(before)) throw Error('Actual summary Enter did not restore its original disclosure state');
      if (restored.open) await verifyOwnedContent();
      return Object.assign(evidence, { restored, clicked: true, keyboard: 'Enter', restoredPosition: true });
    } catch (error) { throw Object.assign(Error(safeErrorV2(error)), { evidence }); }
    finally {
      try { if ((await state()).open !== before.open) { await summary.click(); if (canonicalV2(await state()) !== canonicalV2(before)) throw Error('Disclosure interaction could not restore its original state'); }
        evidence.restoredScroll = await saved.evaluate(async state => { for (const owner of state.owners) { owner.element.scrollLeft = owner.left; owner.element.scrollTop = owner.top; } scrollTo(state.x, state.y); await new Promise(resolve => setTimeout(resolve, 100)); return { x: scrollX, y: scrollY, exact: Math.abs(scrollX - state.x) <= 1 && Math.abs(scrollY - state.y) <= 1 && state.owners.every(owner => owner.element.isConnected && Math.abs(owner.element.scrollLeft - owner.left) <= 1 && Math.abs(owner.element.scrollTop - owner.top) <= 1) }; });
        if (!(evidence.restoredScroll as { exact: boolean }).exact) throw Error('Disclosure content verification could not restore its scroll owners');
      } catch (error) { throw Object.assign(Error(safeErrorV2(error)), { evidence }); } finally { await saved.dispose(); }
    }
  }
  if (property === 'anchor') {
    const specification = expected as { targetId?: string; topTolerance?: number }; if (!specification?.targetId || !/^[A-Za-z][\w:.-]{0,180}$/.test(specification.targetId)) throw Error('Anchor interaction requires its actual local target ID');
    const href = await node.getAttribute('href'), current = new URL(page.url()), destination = href ? new URL(href, current) : undefined;
    if (await node.evaluate(element => element.tagName) !== 'A' || !destination || destination.origin !== current.origin || destination.pathname !== current.pathname || destination.search !== current.search || decodeURIComponent(destination.hash.slice(1)) !== specification.targetId) throw Error('Anchor control is not a same-page link to its declared target');
    const target = page.locator(`[id="${specification.targetId}"]`); if (await target.count() !== 1) throw Error('Anchor has a missing or duplicate actual target');
    const originalURL = page.url(), original = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(100); const before = await page.evaluate(() => scrollY);
    try { await node.click(); await page.waitForTimeout(500); const after = await target.evaluate(element => ({ scrollY, top: element.getBoundingClientRect().top })), tolerance = specification.topTolerance ?? 12; if (!Number.isFinite(tolerance) || tolerance < 0 || Math.abs(after.top) > tolerance || before > tolerance && after.scrollY >= before) throw Error('Actual anchor click did not scroll to the declared target'); return { clicked: true, targetId: specification.targetId, beforeScrollY: before, after, originalScroll: original }; }
    finally { if (page.url() !== originalURL) { await page.goBack({ waitUntil: 'domcontentloaded', timeout: 5_000 }); if (page.url() !== originalURL) throw Error('Anchor interaction did not restore its original browser URL'); } await page.evaluate(position => scrollTo(position.x, position.y), original); await page.waitForTimeout(100); }
  }
  if (property === 'hover') {
    const specification = expected as Record<string, string> | { target?: string; styles: Record<string, string>; restoredStyles?: Record<string, string> };
    if (!specification || typeof specification !== 'object') throw Error('Hover requires explicit CSS paint expectations');
    const grouped = typeof specification.styles === 'object', styles = (grouped ? specification.styles : specification) as Record<string, string>, restoredStyles = grouped ? specification.restoredStyles as Record<string, string> | undefined : undefined;
    const targetSelector = grouped ? specification.target : undefined;
    const target = typeof targetSelector === 'string' ? node.locator(targetSelector) : node;
    if (await target.count() !== 1) throw Error('Hover paint target must be a unique child of its declared interaction owner');
    const sample = () => target.evaluate((element, properties) => Object.fromEntries(properties.map(property => [property, getComputedStyle(element).getPropertyValue(property)])), [...new Set([...Object.keys(styles), ...Object.keys(restoredStyles ?? {})])]);
    await page.mouse.move(0, 0); const before = await sample();
    await node.hover(); await page.waitForTimeout(250); const paint = await sample();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250); const restored = await sample();
    if (Object.entries(styles).some(([key, value]) => norm(paint[key]) !== norm(value))) throw Error('Observed hover paint does not match the implementation requirement');
    if (restoredStyles ? Object.entries(restoredStyles).some(([key, value]) => norm(restored[key]) !== norm(value)) : canonicalV2(restored) !== canonicalV2(before)) throw Error('Hover child paint did not restore after the actual pointer left its owner');
    return { before, after: paint, restored };
  }
  if (property !== 'carousel') throw Error('Interaction needs a typed supported rule (carousel, hover, anchor, disclosure or scroll)');
  node = await resolveNativeCarouselV2(page.locator(selector));
  const before = (await waitForNativeCarouselReady(node)).state;
  const specification = expected && typeof expected === 'object' ? expected as { allowAllFit?: boolean; manual?: boolean; pagination?: 'bullets' | 'fraction' | false } : {};
  const autoplay = await nativeAutoplayV2(node);
  if (specification.manual && !autoplay.manualVerified) throw Object.assign(Error('Planned manual carousel is still configured to autoplay or has no proved manual configuration'), { evidence: { before, autoplay } });
  const pagination = () => node.evaluate(root => {
    const pagination = Array.from(root.querySelectorAll('.swiper-pagination,.elementor-swiper-pagination')).find(element => { const box = element.getBoundingClientRect(), css = getComputedStyle(element); return box.width > 0 && box.height > 0 && css.display !== 'none' && css.visibility !== 'hidden'; });
    const bullets = Array.from(pagination?.querySelectorAll('.swiper-pagination-bullet') ?? []), active = bullets.findIndex(element => element.classList.contains('swiper-pagination-bullet-active')), current = Number(pagination?.querySelector('.swiper-pagination-current')?.textContent), engine = (root.querySelector('.swiper,.swiper-container') as HTMLElement & { swiper?: { snapIndex?: number; realIndex?: number; params?: { slidesPerGroup?: number; loop?: boolean } } } | null)?.swiper;
    const sourceSlide = root.querySelector('.swiper-wrapper > .swiper-slide-active'), sourceIndex = Number(sourceSlide?.getAttribute('data-swiper-slide-index')), realIndex = engine?.realIndex, group = Math.max(1, Number(engine?.params?.slidesPerGroup ?? 1)), logicalIndex = Number.isInteger(realIndex) && Number(realIndex) >= 0 ? Number(realIndex) : Number.isInteger(sourceIndex) && sourceSlide?.hasAttribute('data-swiper-slide-index') ? sourceIndex : null;
    return { visible: !!pagination, bullets: bullets.length, active, current: Number.isFinite(current) && current > 0 ? current : null, snapIndex: engine?.snapIndex ?? null, realIndex: realIndex ?? null, sourceIndex: sourceSlide?.hasAttribute('data-swiper-slide-index') ? sourceIndex : null, logicalPage: logicalIndex === null || !Number.isFinite(group) ? null : Math.floor(logicalIndex / group), loop: engine?.params?.loop === true };
  });
  const beforePagination = await pagination();
  const samePagination = (left: Awaited<ReturnType<typeof pagination>>, right: Awaited<ReturnType<typeof pagination>>) => canonicalV2({ ...left, snapIndex: undefined }) === canonicalV2({ ...right, snapIndex: undefined });
  const synchronized = (value: Awaited<ReturnType<typeof pagination>>) => !value.visible || value.logicalPage !== null && (value.realIndex === null || value.sourceIndex === null || value.realIndex === value.sourceIndex) && (!value.bullets || value.active === value.logicalPage) && (value.current === null || value.current === value.logicalPage + 1);
  if (specification.pagination === false && beforePagination.visible || specification.pagination === 'bullets' && beforePagination.bullets < 1 || specification.pagination === 'fraction' && beforePagination.current === null) throw Error('Native pagination differs from the implementation requirement');
  if (!synchronized(beforePagination)) throw Error('Initial native pagination does not identify its actual logical slide');
  if (expected && typeof expected === 'object' && (expected as { allowAllFit?: boolean }).allowAllFit === true && before.slideCount === before.visibleSlides && before.visibilityVerified) return { before, after: before, restored: before, allSlidesFit: true, movementRequired: false };
  const next = node.locator('.elementor-swiper-button-next,.swiper-button-next,.slick-next,[aria-label="Next slide"],[aria-label="Next Slide"]').filter({ visible: true }).first();
  const previous = node.locator('.elementor-swiper-button-prev,.swiper-button-prev,.slick-prev,[aria-label="Previous slide"],[aria-label="Previous Slide"]').filter({ visible: true }).first();
  if (!await next.isVisible() || !await previous.isVisible()) throw Error('Carousel lacks visible next and previous controls');
  const evidence: Record<string, unknown> = { before, beforePagination, autoplay }; let cleanupControl: typeof previous | undefined, restoredNormally = false;
  try {
    await next.click(); cleanupControl = previous; const after = (await waitForNativeCarouselReady(node)).state, afterPagination = await pagination(); evidence.after = after; evidence.afterPagination = afterPagination;
    if (!before.activeIdentityVerified || !after.activeIdentityVerified || sameLogicalCarouselPosition(before, after)) throw Error('Carousel next action did not change its actual source-identified slide');
    if (!synchronized(afterPagination) || afterPagination.visible && (afterPagination.bullets && afterPagination.active === beforePagination.active || afterPagination.current !== null && afterPagination.current === beforePagination.current)) throw Error('Native pagination did not synchronize with the actual changed logical slide');
    await previous.click(); cleanupControl = undefined; const restored = (await waitForNativeCarouselReady(node)).state, restoredPagination = await pagination(); evidence.restored = restored; evidence.restoredPagination = restoredPagination;
    if (!sameLogicalCarouselPosition(before, restored)) throw Error('Carousel controls did not restore its original logical position');
    if (!samePagination(beforePagination, restoredPagination)) throw Error('Native pagination did not restore with its original slide');
    if (before.loopDeclared && beforePagination.logicalPage === 0) {
      await previous.click(); cleanupControl = next; const wrapped = (await waitForNativeCarouselReady(node)).state, wrappedPagination = await pagination(); evidence.loopBoundary = { wrapped, wrappedPagination };
      if (!synchronized(wrappedPagination) || sameLogicalCarouselPosition(before, wrapped) || wrappedPagination.logicalPage === 0) throw Error('Native previous control did not wrap to the actual final logical page with synchronized pagination');
      await next.click(); cleanupControl = undefined; const restoredBoundary = (await waitForNativeCarouselReady(node)).state, restoredBoundaryPagination = await pagination(); Object.assign(evidence.loopBoundary as object, { restored: restoredBoundary, restoredPagination: restoredBoundaryPagination });
      if (!sameLogicalCarouselPosition(before, restoredBoundary) || !samePagination(beforePagination, restoredBoundaryPagination)) throw Error('Native loop boundary did not restore its original logical slide and pagination');
    }
    restoredNormally = true; return { ...evidence, nextChanged: true, restoredPosition: true, pagination: restored.pagination };
  } catch (error) {
    evidence.failureState = (error as { lastState?: unknown }).lastState ?? await carouselState(node).catch(() => undefined);
    const failure = new Error(safeErrorV2(error)); Object.assign(failure, { evidence }); throw failure;
  } finally {
    if (!restoredNormally) {
      try { if (cleanupControl) await cleanupControl.click(); const state = (await waitForNativeCarouselReady(node, 4_000)).state; if (!sameLogicalCarouselPosition(before, state) || !samePagination(beforePagination, await pagination())) throw Error('Failed interaction did not restore its original slide and controller state'); evidence.cleanup = { restored: true, state }; }
      catch (error) { evidence.cleanupError = safeErrorV2(error); try { const previewUrl = page.url(); await navigateOwnedPreview(page, previewUrl); await normalizePreviewChromeV2(page); const state = (await waitForNativeCarouselReady(node, 5_000)).state; evidence.cleanup = { reloaded: true, restored: sameLogicalCarouselPosition(before, state), state }; } catch (resetError) { evidence.cleanup = { restored: false, error: safeErrorV2(resetError) }; } }
    }
  }
}
export { runInteraction as verifyInteractionV2 };

export async function captureReplicaV2(options: { program: ProgramV2; compiled: CompiledReplicaV2; assets?: ImportedAssetV2[]; catalog?: TargetCatalogEvidence; responsiveEnvironment?: { breakpoints?: Record<string, { value: number; direction: string }> }; sourceFacts: any; componentPlan: any; checkpoint: VisualCheckpointV2; runDir: string; previewUrl: string; pageId: number; cookies: Cookie[]; documentHash: string; programHash: string; sourceFactsHash: string; componentPlanHash: string; reviewResume?: ReviewResumeSealV2; firstFoldKeys?: string[]; onProgress?: (message: string) => void | Promise<void> }): Promise<CaptureReceiptV2> {
  const receiptDirectory = checkpointPath(options.runDir, options.checkpoint), directory = path.join(receiptDirectory, 'captures', randomUUID()); await mkdir(directory, { recursive: true });
  const receipt: CaptureReceiptV2 = { version: 2, checkpoint: options.checkpoint, documentHash: options.documentHash, programHash: options.programHash, componentPlanHash: options.componentPlanHash, sourceFactsHash: options.sourceFactsHash, createdAt: new Date().toISOString(), checks: [], automatedPassed: false, screenshots: [], evidence: [], editorSessions: 0, reportPath: path.join(directory, 'capture.json') };
  if (options.reviewResume) receipt.reviewResume = options.reviewResume;
  const views = captureViewsV2(options.program, options.checkpoint); receipt.viewports = views.map(({ name, width, height }) => ({ name, width, height }));
  if (!views.length) throw Error('The current stage has no declared viewport');
  const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
  const context = await createScopedContext(browser, options.previewUrl, { cookies: options.cookies }, { readOnly: true });
  receipt.browserRequests = 0; receipt.blockedMutationRequests = 0;
  context.on('request', request => { if (new URL(request.url()).origin === new URL(options.previewUrl).origin) { receipt.browserRequests!++; if (!['GET', 'HEAD'].includes(request.method())) receipt.blockedMutationRequests!++; } });
  try {
    const page = await context.newPage(); await page.emulateMedia({ reducedMotion: 'no-preference' }); receipt.motionPreference = 'no-preference';
    type ImageRequestState = { url: string; requested: true; status?: number; finished?: boolean; failure?: string; aborted?: boolean };
    let imageRequests = new Map<string, ImageRequestState>(), imageGeneration = 0;
    const requests = new WeakMap<import('playwright').Request, { generation: number; urls: string[] }>();
    page.on('request', request => {
      if (request.resourceType() !== 'image') return;
      const previous = request.redirectedFrom(), preceding = previous ? requests.get(previous) : undefined;
      const urls = [...new Set([...(preceding?.generation === imageGeneration ? preceding.urls : []), request.url()])];
      requests.set(request, { generation: imageGeneration, urls }); for (const url of urls) imageRequests.set(url, { url, requested: true });
    });
    const updateImageRequest = (request: import('playwright').Request, change: Partial<ImageRequestState>) => { const record = requests.get(request); if (record?.generation === imageGeneration) for (const url of record.urls) Object.assign(imageRequests.get(url)!, change); };
    page.on('response', response => updateImageRequest(response.request(), { status: response.status() }));
    page.on('requestfinished', request => updateImageRequest(request, { finished: true }));
    page.on('requestfailed', request => { const failure = request.failure()?.errorText ?? 'Image request failed'; updateImageRequest(request, { failure, aborted: /\b(?:ERR_ABORTED|NS_BINDING_ABORTED)\b/i.test(failure) }); });
    for (const view of views) {
      await options.onProgress?.(`capture-${options.checkpoint}-${view.name}`);
      imageGeneration++; imageRequests = new Map();
      await page.setViewportSize({ width: view.width, height: view.height });
      await navigateOwnedPreview(page, options.previewUrl);
      const previewChromeAdjusted = await normalizePreviewChromeV2(page);
      await page.evaluate(async () => { await document.fonts.ready; });
      const rootSelectors = options.compiled.sectionIds.map(id => `[data-id="${id}"]`);
      for (const selector of rootSelectors) await page.locator(selector).first().waitFor({ state: 'attached', timeout: 15_000 });
      if (options.checkpoint !== 'desktop-firstfold') {
        await scrollWholePageV2(page);
      }
      await page.locator('.elementor img').evaluateAll(async images => {
        await Promise.all(images.filter(image => { const box = image.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.left < innerWidth && box.right > 0 && box.top < innerHeight && box.bottom > 0; }).map(image => new Promise<void>(resolve => { const img = image as HTMLImageElement; if (img.complete) { resolve(); return; } const timer = setTimeout(resolve, 15_000); const finish = () => { clearTimeout(timer); resolve(); }; img.addEventListener('load', finish, { once: true }); img.addEventListener('error', finish, { once: true }); })));
      });
      const requirements: any[] = options.componentPlan.requirements ?? [];
      const snapshotIds = new Set((options.sourceFacts.snapshots ?? []).filter((snapshot: any) => snapshot.viewport?.name === view.name).map((snapshot: any) => snapshot.id));
      const interactions = new Map<string, { actual?: unknown; error?: string }>(), mediaProbes = new Map<string, { actual?: Record<string, unknown>; error?: string }>();
      for (const requirement of requirements) {
        if (options.checkpoint === 'desktop-firstfold') {
          let component = (options.componentPlan.components ?? []).find((item: any) => item.id === requirement.componentId);
          while (component?.parentId) component = options.componentPlan.components.find((item: any) => item.id === component.parentId);
          if (!component || !options.firstFoldKeys?.includes(component.id)) continue;
        }
        if (requirement.verification?.viewport && requirement.verification.viewport !== view.name) continue;
        if (requirement.verification?.snapshotId && !snapshotIds.has(requirement.verification.snapshotId)) continue;
        const factIds: string[] = requirement.factIds ?? [], matchedFacts = factIds.map(id => options.sourceFacts.facts?.[id]);
        if (matchedFacts.length && !matchedFacts.some(fact => snapshotIds.has(fact?.snapshotId))) continue;
        const spec = requirement.verification, check: RequirementCheckV2 = { id: requirement.id, viewport: view.name, kind: spec?.kind ?? 'unknown', status: 'unverified', expected: spec?.expected };
        receipt.checks.push(check);
        try {
          if (!spec?.selector) throw Error('Requirement has no actual target selector');
          if (spec.kind === 'interaction') { const key = canonicalV2({ selector: spec.selector, property: spec.property, expected: spec.expected }); let cached = interactions.get(key); if (!cached) { try { cached = { actual: await runInteraction(page, spec.selector, spec.property, spec.expected) }; } catch (error) { cached = { error: safeErrorV2(error), actual: (error as { evidence?: unknown }).evidence }; } interactions.set(key, cached); } if (cached.actual !== undefined) check.actual = cached.actual; if (cached.error) throw Error(cached.error); check.status = 'passed'; continue; }
          let deferredMediaProof: Record<string, unknown> | undefined;
          if (spec.kind === 'media') { const media = spec.expected && typeof spec.expected === 'object' ? spec.expected : { url: typeof spec.expected === 'string' ? spec.expected : undefined }, url = options.assets?.find(asset => asset.key === media.assetKey)?.url ?? media.url; if (typeof url === 'string') { const key = canonicalV2({ selector: spec.selector, url, allowDeferred: media.allowDeferred === true }); let cached = mediaProbes.get(key); if (!cached) { try { cached = { actual: await probeDeferredMediaV2(page, spec.selector, url, media.allowDeferred === true) }; } catch (error) { cached = { error: safeErrorV2(error), actual: (error as { evidence?: Record<string, unknown> }).evidence }; } mediaProbes.set(key, cached); } if (cached.error) throw Object.assign(Error(cached.error), { evidence: cached.actual }); deferredMediaProof = cached.actual; } }
          const actual = await page.locator(spec.selector).evaluateAll((elements, property) => elements.filter(element => !element.closest('.swiper-slide-duplicate,.slick-cloned,.elementor-sticky__spacer')).map(element => {
            const box = element.getBoundingClientRect(), css = getComputedStyle(element), image = element instanceof HTMLImageElement ? element : element.querySelector('img');
            const backgroundURLs = Array.from(css.backgroundImage.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g), match => { try { return new URL((match[1] ?? match[2] ?? match[3]).trim(), document.baseURI).href; } catch { return ''; } });
            let visible = box.width > 0 && box.height > 0;
            for (let parent: Element | null = element; parent; parent = parent.parentElement) { const style = getComputedStyle(parent); if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden') visible = false; if (parent !== element && parent.tagName === 'DETAILS' && !parent.hasAttribute('open') && getComputedStyle(parent, '::details-content').contentVisibility !== 'visible') { const summary = Array.from(parent.children).find(child => child.tagName === 'SUMMARY'); if (!summary?.contains(element)) visible = false; } }
            // Clipped/offscreen carousel items retain source ownership and structural visibility; closed disclosures and skipped content do not.
            return { tag: element.tagName, text: element.textContent ?? '', visible, rect: { x: box.x, y: box.y + scrollY, width: box.width, height: box.height }, href: element.getAttribute('href'), src: image?.currentSrc || image?.getAttribute('src'), imageComplete: image?.complete, naturalWidth: image?.naturalWidth, backgroundImage: css.backgroundImage, backgroundURLs, typedBackground: element.hasAttribute('data-cwp-background'), property: property ? css.getPropertyValue(property) : undefined };
          }), spec.property);
          check.actual = deferredMediaProof ? { elements: actual, [deferredMediaProof.kind === 'css-background' ? 'backgroundMediaProof' : 'deferredMediaProof']: deferredMediaProof } : actual;
          if (!actual.length) throw Error('Required target is missing');
          if (actual.length !== 1) throw Error('Requirement target is ambiguous or duplicated');
          const value = actual[0];
          if (spec.kind === 'presence') { if (spec.expected === false ? value.visible : !value.visible) throw Error('Required visibility differs'); }
          else if (spec.kind === 'text') { const specification = spec.expected && typeof spec.expected === 'object' ? spec.expected as { text?: string; visible?: boolean } : { text: String(spec.expected ?? ''), visible: true }; if (typeof specification.text !== 'string' || norm(value.text) !== norm(specification.text) || specification.visible !== undefined && value.visible !== specification.visible) throw Error('Static text or responsive variant differs'); }
          else if (spec.kind === 'external') { if (value.href !== spec.expected) throw Error('External entry does not preserve its verified destination'); }
          else if (spec.kind === 'media') { const specification: { assetKey?: string; url?: string; visible?: boolean; allowDeferred?: boolean } = spec.expected && typeof spec.expected === 'object' ? spec.expected : { url: typeof spec.expected === 'string' ? spec.expected : undefined, visible: true, allowDeferred: false }; const asset = specification.assetKey ? options.assets?.find(asset => asset.key === specification.assetKey) : undefined, url = asset?.url ?? specification.url, backgroundMatch = !!url && value.backgroundURLs.includes(url), backgroundMedia = value.typedBackground || backgroundMatch && value.src !== url; if (specification.assetKey && !asset) throw Error('Required media asset is not registered in the current run'); if (specification.visible !== undefined && value.visible !== specification.visible || !backgroundMedia && !specification.allowDeferred && value.src && (!value.imageComplete || !value.naturalWidth) || url && (backgroundMedia ? !backgroundMatch : value.src !== url && !backgroundMatch)) throw Error('Required media was not painted from its registered asset'); }
          else if (spec.kind === 'layout') {
            const expected = spec.expected as any, tolerance = Number(spec.tolerance ?? 12);
            if (!Number.isFinite(tolerance) || tolerance < 0) throw Error('Layout tolerance is invalid');
            if (spec.property) { const number = parseFloat(value.property ?? ''); if (typeof expected === 'number' ? !Number.isFinite(expected) || !Number.isFinite(number) || Math.abs(number - expected) > tolerance : norm(value.property) !== norm(expected)) throw Error('Required style differs'); }
            else if (expected && typeof expected === 'object') { const dimensions = Object.entries(expected.rect ?? expected).filter(([key]) => ['x', 'y', 'width', 'height'].includes(key)); if (!dimensions.length) throw Error('Layout expectation has no concrete dimensions'); for (const [key, number] of dimensions) if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(value.rect[key as keyof typeof value.rect] - number) > tolerance) throw Error(`Required content bounds differ: ${key}`); }
            else throw Error('Layout requires explicit geometry or CSS expectation');
          } else throw Error('Requirement kind is unsupported');
          check.status = 'passed';
        } catch (error) { check.status = 'failed'; check.error = safeErrorV2(error); if ((error as { evidence?: unknown }).evidence !== undefined) check.actual = (error as { evidence: unknown }).evidence; }
      }
      for (const query of options.compiled.queryReceipts) {
        const check: RequirementCheckV2 = { id: `catalog:${query.componentKey}`, viewport: view.name, kind: 'target-catalog', status: 'unverified', expected: { ids: query.productIds } }; receipt.checks.push(check);
        try {
          if (!options.catalog) throw Error('Target query lacks current catalog evidence');
          const widget = page.locator(`[data-id="${query.elementId}"]`); await widget.scrollIntoViewIfNeeded();
          if (query.settings.layout === 'carousel') await waitForNativeCatalogReady(widget, 15_000); await waitForVisibleCatalogImagesV2(widget);
          const actual = await collectNativeCatalogRender({ page, blockId: query.componentKey, widgetKey: query.componentKey, elementId: query.elementId, viewport: view.name, catalog: options.catalog });
          check.actual = renderedCatalogOnlyV2(actual, await catalogReferenceV2(options.catalog, options.runDir)); const productIds = [...new Set(actual.products.map(product => product.id))];
          if (canonicalV2(productIds) !== canonicalV2(query.productIds)) throw Error('Rendered product identity/order differs from the frozen target query');
          const normalizeURL = (url: string) => { try { return new URL(url).href; } catch { return ''; } };
          for (const product of actual.products) { const expected = options.catalog.products.find(item => item.id === product.id); if (!expected || norm(product.name) !== norm(expected.name) || normalizeURL(product.permalink) !== normalizeURL(expected.permalink) || ![expected.imageUrl, ...(expected.imageVariants ?? [])].includes(product.imageUrl) || expected.priceText && norm(product.priceText) !== norm(expected.priceText)) throw Error(`Rendered product fields differ from actual WooCommerce data: ${product.id}`); }
          check.status = 'passed';
        } catch (error) { check.status = 'failed'; check.error = safeErrorV2(error); }
      }
      const productWindows = await Promise.all(options.compiled.queryReceipts.filter(query => query.settings.layout === 'carousel').map(async query => ({ elementId: query.elementId, ...(await nativeCatalogRuntime(page.locator(`[data-id="${query.elementId}"]`))) })));
      const health = await page.evaluate(({ windows, sectionIds, firstFold, requests }) => {
        const root = document.querySelector('.elementor') ?? document.body;
        const imageRoots = firstFold ? sectionIds.map(id => document.querySelector(`[data-id="${id}"]`)).filter((node): node is Element => !!node) : [root];
        const imageStates = Array.from(root.querySelectorAll('img')).map(image => {
          const box = image.getBoundingClientRect(), src = image.currentSrc || image.src, request = requests.find(request => request.url === src);
          const inStage = imageRoots.some(element => element.contains(image)); let renderedVariant = box.width > 0 && box.height > 0, left = box.left, right = box.right, top = box.top, bottom = box.bottom;
          for (let ancestor: Element | null = image; ancestor; ancestor = ancestor.parentElement) { const css = getComputedStyle(ancestor), clip = ancestor.getBoundingClientRect(); if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0 || css.contentVisibility === 'hidden') renderedVariant = false; if (ancestor !== image && ancestor.tagName === 'DETAILS' && !ancestor.hasAttribute('open') && getComputedStyle(ancestor, '::details-content').contentVisibility !== 'visible' && !Array.from(ancestor.children).find(child => child.tagName === 'SUMMARY')?.contains(image)) renderedVariant = false; if (ancestor !== image && /^(hidden|clip|auto|scroll)$/.test(css.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); } if (ancestor !== image && /^(hidden|clip|auto|scroll)$/.test(css.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); } }
          const widget = image.closest('[data-widget_type="wd_products.default"]'), runtime = windows.find(window => window.elementId === widget?.getAttribute('data-id')), frame = runtime?.windowRect;
          if (frame) { left = Math.max(left, frame.x); right = Math.min(right, frame.x + frame.width); top = Math.max(top, frame.y); bottom = Math.min(bottom, frame.y + frame.height); }
          const paintedWindow = renderedVariant && right - left > 1 && bottom - top > 1 && right > 0 && left < innerWidth;
          const knownFailure = !!request && (!!request.failure && !request.aborted || (request.status ?? 0) >= 400 || !!request.finished && image.complete && image.naturalWidth === 0);
          const reason = !inStage || !renderedVariant ? undefined : knownFailure ? 'requested-image-failed' : paintedWindow && (!image.complete || image.naturalWidth === 0) ? 'painted-image-unavailable' : undefined;
          return { src, alt: image.alt, widgetId: image.closest('[data-widget_type]')?.getAttribute('data-id'), productId: image.closest('.product-grid-item.product[data-id]')?.getAttribute('data-id'), inStage, renderedVariant, paintedWindow, complete: image.complete, naturalWidth: image.naturalWidth, requested: !!request, reason };
        });
        // Indices reference the single raw image-state table; repeated display nodes remain distinct.
        const broken = imageStates.flatMap((image, imageIndex) => image.reason ? [{ imageIndex, reason: image.reason }] : []);
        return { viewport: innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, title: document.title, login: !!document.querySelector('#loginform,.wp-die-message'), imageScope: firstFold ? sectionIds : 'whole-page', brokenImages: broken, imageStates, imageRequests: requests, productWindows: windows.map(window => ({ elementId: window.elementId, initialized: window.initialized, activeIds: window.activeIds, visibleIds: window.visibleIds, windowRect: window.windowRect })) };
      }, { windows: productWindows, sectionIds: options.compiled.sectionIds, firstFold: options.checkpoint === 'desktop-firstfold', requests: [...imageRequests.values()] });
      for (const request of health.imageRequests) { request.url = safeErrorV2(request.url); if (request.failure) request.failure = safeErrorV2(request.failure); } for (const image of health.imageStates) image.src = safeErrorV2(image.src);
      receipt.checks.push({ id: 'page-health', viewport: view.name, kind: 'health', status: !health.login && !health.brokenImages.length && health.productWindows.every(window => window.initialized) && health.scrollWidth <= health.viewport + 2 ? 'passed' : 'failed', actual: health });
      const measurementRef = await persistViewportMeasurementsV2(directory, view.name, options.documentHash, receipt.checks); receipt.evidence.push(measurementRef.path);
      await page.evaluate(() => scrollTo(0, 0));
      const screenshotPath = path.join(directory, `${view.name}.png`), screenshotBytes = await page.screenshot({ path: screenshotPath, fullPage: options.checkpoint !== 'desktop-firstfold', animations: 'disabled' }), dimensions = await sharp(screenshotBytes).metadata();
      receipt.screenshots.push({ viewport: view.name, path: screenshotPath, sha256: hashV2(screenshotBytes), width: dimensions.width!, height: dimensions.height!, previewChromeAdjusted });
    }
    if (options.checkpoint === 'responsive') {
      const widths = [...new Set(Object.values(options.responsiveEnvironment?.breakpoints ?? {}).flatMap(breakpoint => [breakpoint.value - 1, breakpoint.value + 1]).filter(width => Number.isFinite(width) && width >= 240 && width <= 1920))].sort((a, b) => a - b);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(200);
        const health = await page.evaluate(ids => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, roots: ids.map(id => { const nodes = Array.from(document.querySelectorAll(`[data-id="${id}"]`)).filter(node => !node.closest('.swiper-slide-duplicate,.slick-cloned')); const box = nodes[0]?.getBoundingClientRect(); return { id, count: nodes.length, finite: !!box && [box.x, box.y, box.width, box.height].every(Number.isFinite) }; }) }), options.compiled.sectionIds);
        const passed = health.documentWidth <= width + 2 && health.roots.every(root => root.count === 1 && root.finite);
        const evidence = path.join(directory, `breakpoint-${width}.json`); await writeJson(evidence, { version: 2, scope: 'native-breakpoint-health-only', sourcePixelClaim: false, documentHash: options.documentHash, ...health }); receipt.evidence.push(evidence);
        receipt.checks.push({ id: `native-breakpoint-${width}`, viewport: `edge-${width}`, kind: 'breakpoint-health', status: passed ? 'passed' : 'failed', actualRef: { path: evidence, sha256: hashV2(await readFile(evidence)) } });
        if (!passed) await page.screenshot({ path: path.join(directory, `breakpoint-${width}-failure.png`), fullPage: false });
      }
    }
    receipt.automatedPassed = receipt.checks.length > 0 && receipt.checks.every(check => check.status === 'passed');
  } finally { await context.close(); await browser.close(); await writeJson(receipt.reportPath!, receipt); await archiveCaptureReceiptV2(receiptDirectory); await writeJson(path.join(receiptDirectory, 'capture.json'), receipt); }
  return receipt;
}
