import type { Page, Route } from 'playwright';
import { carouselState, sameLogicalCarouselPosition, waitForNativeCarouselReady } from '../fidelity/acceptance.js';
import { nativeCatalogRuntime, waitForNativeCatalogReady } from '../fidelity/catalog-browser.js';
import { canonicalV2, safeErrorV2 } from './journal.js';

/** Real scrolling triggers browser/Elementor lazy work; never rewrite image attributes or slide state. */
export async function scrollWholePageV2(page: Page, visit?: () => Promise<void>) {
  const before = await page.evaluate(() => ({ x: scrollX, y: scrollY })), positions: Array<{ x: number; y: number; height: number }> = [];
  let completed = false, previousHeight = -1;
  try {
    for (let step = 0; step < 60; step++) {
      const dimensions = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, viewport: innerHeight })), top = Math.min(step * Math.max(300, dimensions.viewport - 100), Math.max(0, dimensions.height - dimensions.viewport));
      await page.evaluate(({ x, y }) => scrollTo({ left: x, top: y, behavior: 'instant' }), { x: before.x, y: top }); await page.waitForTimeout(100); await visit?.();
      const actual = await page.evaluate(() => ({ x: scrollX, y: scrollY, height: document.documentElement.scrollHeight, viewport: innerHeight })); positions.push({ x: actual.x, y: actual.y, height: actual.height });
      if (actual.y + actual.viewport >= actual.height - 1 && previousHeight === actual.height) { completed = true; break; } previousHeight = actual.height;
    }
    if (!completed) throw Error('Whole-page rendering did not reach a stable bottom within its bounded scroll pass');
  } finally { await page.evaluate(point => scrollTo({ left: point.x, top: point.y, behavior: 'instant' }), before); }
  const after = await page.evaluate(() => ({ x: scrollX, y: scrollY })), restored = Math.abs(after.x - before.x) <= 1 && Math.abs(after.y - before.y) <= 1;
  if (!restored) throw Error('Whole-page rendering did not restore its original scroll position'); return { before, after, positions, restored };
}

export interface RestoredRenderingOptionsV2 { rootIds: string[]; nativeCarouselIds: string[]; productCarouselIds: string[]; documentHash: string }
/** Prepare one already-open restored frontend page; all media proofs concern actual clipped paint during the vertical pass. */
export async function prepareRestoredRenderingV2(page: Page, options: RestoredRenderingOptionsV2): Promise<Record<string, any>> {
  const receipt: Record<string, any> = { version: 2, kind: 'restored-frontend-render-preparation', documentHash: options.documentHash, startedAt: new Date().toISOString(), passed: false, pagesCreated: 0, contextsCreated: 0, blockedMutationRequests: 0, carousels: [], products: [], images: [], backgrounds: [] };
  const guard = async (route: Route) => { if (['GET', 'HEAD'].includes(route.request().method())) await route.fallback(); else { receipt.blockedMutationRequests++; await route.abort('blockedbyclient'); } }; await page.route('**/*', guard);
  const saved = await page.evaluateHandle(() => ({ x: scrollX, y: scrollY, owners: Array.from(document.querySelectorAll('*')).filter(element => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight || element.scrollLeft || element.scrollTop).map(element => ({ element, left: element.scrollLeft, top: element.scrollTop })) }));
  const media = await page.evaluateHandle(() => ({ seen: new WeakMap<Element, Set<string>>(), images: [] as unknown[], backgrounds: [] as unknown[], resources: new Map<string, Promise<{ naturalWidth: number; naturalHeight: number }>>() }));
  const states = new Map<string, Awaited<ReturnType<typeof carouselState>>>(), catalogStates = new Map<string, Awaited<ReturnType<typeof nativeCatalogRuntime>>>();
  const decodeVisible = async () => { await media.evaluate(async state => {
    const candidates = Array.from(document.querySelectorAll('img,[data-cwp-background],.elementor [data-id],.elementor .elementor-background-overlay'));
    await Promise.all(candidates.map(async element => {
      const box = element.getBoundingClientRect(); let left = Math.max(0, box.left), right = Math.min(innerWidth, box.right), top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom), visible = box.width > 0 && box.height > 0;
      for (let owner: Element | null = element; owner; owner = owner.parentElement) { const css = getComputedStyle(owner), clip = owner.getBoundingClientRect(); if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0 || css.contentVisibility === 'hidden') visible = false; if (owner !== element && owner.tagName === 'DETAILS' && !owner.hasAttribute('open') && getComputedStyle(owner, '::details-content').contentVisibility !== 'visible' && !Array.from(owner.children).find(child => child.tagName === 'SUMMARY')?.contains(element)) visible = false; if (owner !== element && /^(hidden|clip|auto|scroll)$/.test(css.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); } if (owner !== element && /^(hidden|clip|auto|scroll)$/.test(css.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); } }
      if (!visible || right - left <= 1 || bottom - top <= 1) return;
      const cssBackground = getComputedStyle(element).backgroundImage, urls = element instanceof HTMLImageElement ? [element.currentSrc || element.src] : Array.from(cssBackground.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g), match => new URL((match[1] ?? match[2] ?? match[3]).trim(), document.baseURI).href);
      if (!urls.length) return; const parts: string[] = []; for (let node: Element | null = element; node; node = node.parentElement) { const parent: Element | null = node.parentElement, siblings = parent ? Array.from(parent.children).filter(sibling => sibling.tagName === node!.tagName) : [node]; parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); }
      const seen = state.seen.get(element) ?? new Set<string>(); state.seen.set(element, seen);
      for (const url of urls) {
        if (seen.has(url)) continue;
        const proof: Record<string, unknown> = { domPath: parts.join(' > '), url, paintedWidth: right - left, paintedHeight: bottom - top, scrollY, decoded: false, drawable: false };
        (element instanceof HTMLImageElement ? state.images : state.backgrounds).push(proof);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          if (element instanceof HTMLImageElement) {
            await Promise.race([(async () => { try { await element.decode(); } catch { if (element.complete) throw Error('Restored visible image has no decodable pixels'); await new Promise<void>((resolve, reject) => { element.addEventListener('load', () => resolve(), { once: true }); element.addEventListener('error', () => reject(Error('Restored visible image has no decodable pixels')), { once: true }); }); await element.decode(); } })(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('Restored visible image decode timed out')), 10_000); })]);
            if ((element.currentSrc || element.src) !== url || element.naturalWidth <= 0 || element.naturalHeight <= 0) throw Error('Restored visible image source changed or has no pixels');
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d'); if (!context) throw Error('Restored image drawable probe unavailable'); context.drawImage(element, 0, 0, 1, 1); Object.assign(proof, { decoded: true, drawable: true, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight });
          } else {
            if (!state.resources.has(url)) state.resources.set(url, (async () => { const image = new Image(); image.src = url; await image.decode(); if (!image.naturalWidth || !image.naturalHeight) throw Error('Restored CSS background has no decodable pixels'); return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }; })());
            const decoded = await Promise.race([state.resources.get(url)!, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('Restored CSS background decode timed out')), 10_000); })]); if (getComputedStyle(element).backgroundImage !== cssBackground) throw Error('Restored CSS background changed during decode'); Object.assign(proof, decoded, { decoded: true, drawable: true, backgroundImage: cssBackground });
          }
          const painted = element.getBoundingClientRect(); let afterLeft = Math.max(0, painted.left), afterRight = Math.min(innerWidth, painted.right), afterTop = Math.max(0, painted.top), afterBottom = Math.min(innerHeight, painted.bottom);
          for (let owner = element.parentElement; owner; owner = owner.parentElement) { const css = getComputedStyle(owner), clip = owner.getBoundingClientRect(); if (/^(hidden|clip|auto|scroll)$/.test(css.overflowX)) { afterLeft = Math.max(afterLeft, clip.left); afterRight = Math.min(afterRight, clip.right); } if (/^(hidden|clip|auto|scroll)$/.test(css.overflowY)) { afterTop = Math.max(afterTop, clip.top); afterBottom = Math.min(afterBottom, clip.bottom); } }
          Object.assign(proof, { paintedWidth: Math.max(0, afterRight - afterLeft), paintedHeight: Math.max(0, afterBottom - afterTop) });
          if (!element.isConnected || afterRight - afterLeft <= 1 || afterBottom - afterTop <= 1) throw Error('Decoded restored media did not remain inside its actual painted window'); seen.add(url);
        } finally { if (timer) clearTimeout(timer); }
      }
    }));
  }); };
  try {
    await page.evaluate(async () => { await document.fonts.ready; });
    for (const id of options.rootIds) if (await page.locator(`[data-id="${id}"]`).count() !== 1) throw Error('Restored frontend is missing a unique owned root');
    for (const id of options.nativeCarouselIds) { const widget = page.locator(`[data-id="${id}"]`); if (await widget.count() === 1 && await widget.isVisible() && (await carouselState(widget)).initialized) states.set(id, (await waitForNativeCarouselReady(widget)).state); }
    for (const id of options.productCarouselIds) { const widget = page.locator(`[data-id="${id}"]`); if (await widget.count() === 1 && await widget.isVisible() && (await nativeCatalogRuntime(widget)).initialized) catalogStates.set(id, await waitForNativeCatalogReady(widget, 15_000)); }
    receipt.initialScroll = await scrollWholePageV2(page);
    for (const id of options.nativeCarouselIds) {
      const widget = page.locator(`[data-id="${id}"]`); if (await widget.count() !== 1) throw Error('Restored frontend has a missing or duplicated native carousel');
      if (!await widget.isVisible()) { receipt.carousels.push({ elementId: id, hidden: true }); continue; }
      await widget.scrollIntoViewIfNeeded(); const state = (await waitForNativeCarouselReady(widget)).state, configured = Number(state.runtimeSlidesPerView);
      if (Number.isInteger(configured) && configured > 0 && state.visibleSlides !== Math.min(state.slideCount, configured)) throw Error('Restored native carousel does not draw its actual configured visible slide count');
      const before = states.get(id); if (!before) states.set(id, state); await decodeVisible(); receipt.carousels.push({ elementId: id, ...(before ? { before } : {}), state });
    }
    for (const id of options.productCarouselIds) { const widget = page.locator(`[data-id="${id}"]`); if (await widget.count() !== 1) throw Error('Restored frontend has a missing or duplicated product carousel'); if (!await widget.isVisible()) { receipt.products.push({ elementId: id, hidden: true }); continue; } await widget.scrollIntoViewIfNeeded(); const state = await waitForNativeCatalogReady(widget, 15_000), before = catalogStates.get(id); if (!before) catalogStates.set(id, state); await decodeVisible(); receipt.products.push({ elementId: id, ...(before ? { before } : {}), state }); }
    receipt.scroll = await scrollWholePageV2(page, decodeVisible); receipt.passed = true;
  } catch (error) { receipt.error = safeErrorV2(error); }
  finally {
    const raw = await media.evaluate(state => ({ images: state.images, backgrounds: state.backgrounds })); receipt.images = raw.images.map((proof: any) => ({ ...proof, url: safeErrorV2(proof.url) })); receipt.backgrounds = raw.backgrounds.map((proof: any) => ({ ...proof, url: safeErrorV2(proof.url), backgroundImage: safeErrorV2(proof.backgroundImage ?? '') }));
    try {
      receipt.restored = await saved.evaluate(async state => { for (const owner of state.owners) { owner.element.scrollLeft = owner.left; owner.element.scrollTop = owner.top; } scrollTo({ left: state.x, top: state.y, behavior: 'instant' }); await new Promise(resolve => setTimeout(resolve, 100)); return { x: scrollX, y: scrollY, exact: Math.abs(scrollX - state.x) <= 1 && Math.abs(scrollY - state.y) <= 1 && state.owners.every(owner => owner.element.isConnected && Math.abs(owner.element.scrollLeft - owner.left) <= 1 && Math.abs(owner.element.scrollTop - owner.top) <= 1) }; });
      if (!receipt.restored.exact) throw Error('Restored rendering did not preserve its original scroll owners');
      for (const [id, before] of states) { const after = (await waitForNativeCarouselReady(page.locator(`[data-id="${id}"]`), 8_000)).state; if (!sameLogicalCarouselPosition(before, after)) throw Error('Restored rendering changed a native logical slide window'); const row = receipt.carousels.find((row: any) => row.elementId === id); if (row) row.restored = after; else receipt.carousels.push({ elementId: id, before, restored: after }); }
      for (const [id, before] of catalogStates) { const after = await waitForNativeCatalogReady(page.locator(`[data-id="${id}"]`), 8_000); if (canonicalV2({ activeIds: before.activeIds, visibleIds: before.visibleIds }) !== canonicalV2({ activeIds: after.activeIds, visibleIds: after.visibleIds })) throw Error('Restored rendering changed a product logical window'); const row = receipt.products.find((row: any) => row.elementId === id); if (row) row.restored = after; else receipt.products.push({ elementId: id, before, restored: after }); }
    } catch (error) { receipt.passed = false; receipt.restoreError = safeErrorV2(error); }
    await media.dispose(); await saved.dispose(); await page.unroute('**/*', guard); receipt.finishedAt = new Date().toISOString();
  }
  if (!receipt.passed) throw Object.assign(Error(receipt.error ?? receipt.restoreError ?? 'Restored rendering remains unverified'), { evidence: receipt }); return receipt;
}
