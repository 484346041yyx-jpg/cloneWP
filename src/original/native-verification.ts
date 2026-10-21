import path from 'node:path';
import { chromium, type Browser, type Cookie, type Locator, type Page } from 'playwright';
import { createScopedContext } from '../verification/capture-target.js';
import { attachEditorStartupNetwork, awaitNativeEditorReady } from '../verification/editor-readiness.js';
import { selectNativeWidget, saveDraftThroughUI } from '../verification/editability.js';
import { assertDraftHash } from '../core/runner.js';
import { writeJson } from '../core/files.js';
import { redactor } from '../core/config.js';
import { compileEditorElements } from '../wordpress/editor-serialization.js';
import type { DraftSnapshot, LegacySchema, TargetCatalogSnapshot } from '../wordpress/types.js';
import type { WordPressClient } from '../wordpress/client.js';
import type { VerificationIssue, Viewport } from '../verification/types.js';
import type { OriginalDesign, OriginalNode } from './types.js';
import type { OriginalNativeComponent } from './components.js';
import { collectNativeCatalogRender, nativeCatalogRuntime, waitForNativeCatalogReady } from '../fidelity/catalog-browser.js';
import { chooseNativeCarouselOption, trackNativeEditorPosts } from '../fidelity/acceptance.js';
import { collectNativeFractionPaint, type NativeFractionPaint } from '../fidelity/native-fraction.js';

const selector = (id: string) => { if (!/^[a-f\d]{7}$/.test(id)) throw Error('Invalid native original component ID'); return `[data-id="${id}"]`; };
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const flatten = (nodes: OriginalNode[]): OriginalNode[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
const safe = redactor();
export interface OriginalNativeBrowserReport {
  viewport: string; passed: boolean; issues: VerificationIssue[];
  products: Array<{ key: string; nativeId: string; actualIds: number[]; expectedIds: number[]; passed: boolean; pagination?: { before?: NativeFractionPaint; after?: NativeFractionPaint; restored?: NativeFractionPaint } }>;
  carousels: Array<{ key: string; nativeId: string; initialized: boolean; changed: boolean; restored: boolean; allSlidesFit?: boolean; navigationMethod?: 'arrows' | 'pager-click' | 'instance-slideTo'; coveredNativeIds: string[]; clippedNativeIds: string[]; before?: OriginalCarouselRuntime; after?: OriginalCarouselRuntime; error?: string }>;
  hovers: Array<{ key: string; nativeId: string; applicable: boolean; changed: boolean; restored: boolean; passed: boolean; paintedSelector?: string; before?: Record<string, string>; after?: Record<string, string>; error?: string }>;
}
export interface OriginalCarouselRuntime {
  initialized: boolean; animating: boolean; windowValid: boolean; slideIds: string[][]; visibleSlideIndices: number[]; activeIndex?: number;
  coveredNativeIds: string[]; clippedNativeIds: string[]; windowRect?: { x: number; y: number; width: number; height: number };
  nextSelector?: string; previousSelector?: string; paginationSelectors: string[]; autoplayRunning?: boolean; autoplayPaused?: boolean;
  pagination?: { mode: 'fraction' | 'dots'; bound: boolean; visible: boolean; current: number; total: number; text: string };
}

/** Instance references, canonical slide membership and actual clipping prove ownership.
 * A swiper class or hidden slide alone cannot exempt an authored element. */
export async function readOriginalCarouselRuntime(widget: Locator): Promise<OriginalCarouselRuntime> {
  return widget.evaluate(root => {
    type Runtime = { initialized?: boolean; destroyed?: boolean; animating?: boolean; el?: Element; wrapperEl?: Element; slides?: ArrayLike<Element>; activeIndex?: number; snapIndex?: number; snapGrid?: number[]; navigation?: { nextEl?: Element | Element[] | string; prevEl?: Element | Element[] | string }; pagination?: { el?: Element; bullets?: ArrayLike<Element> }; params?: { slideDuplicateClass?: string; pagination?: { type?: string } }; autoplay?: { running?: boolean; paused?: boolean } };
    const engines = [root, ...root.querySelectorAll('*')].flatMap(element => { const runtime = (element as Element & { swiper?: Runtime }).swiper; return runtime?.initialized === true && runtime.destroyed !== true && runtime.el === element && runtime.wrapperEl instanceof Element && element.contains(runtime.wrapperEl) && root.contains(runtime.wrapperEl) ? [{ element, runtime }] : []; });
    if (engines.length !== 1) return { initialized: false, animating: false, windowValid: false, slideIds: [], visibleSlideIndices: [], coveredNativeIds: [], clippedNativeIds: [], paginationSelectors: [] };
    const { element, runtime } = engines[0], windowBox = element.getBoundingClientRect(), style = getComputedStyle(element), raw = runtime.slides;
    const slides = raw && Number.isInteger(raw.length) && raw.length <= 100 ? Array.from(raw).filter(slide => slide instanceof Element && runtime.wrapperEl!.contains(slide)) : [];
    const duplicate = runtime.params?.slideDuplicateClass;
    const originals = slides.filter(slide => !slide.matches('.swiper-slide-duplicate,.slick-cloned') && !(duplicate && /^[\w-]+$/.test(duplicate) && slide.classList.contains(duplicate)));
    const windowValid = windowBox.width > 1 && windowBox.height > 1 && windowBox.left >= -4 && windowBox.right <= innerWidth + 4 && ['hidden', 'clip'].includes(style.overflowX) && document.documentElement.scrollWidth <= innerWidth + 4;
    const slideIds = originals.map(slide => [slide, ...slide.querySelectorAll('[data-id]')].filter(node => node.hasAttribute('data-id') && node.closest('[data-widget_type]') === root).map(node => node.getAttribute('data-id')!).filter(id => /^[a-f\d]{7}$/.test(id)));
    // Descendant widgets own their data-widget_type, but their native IDs still belong to the exact canonical slide.
    originals.forEach((slide, index) => { for (const node of slide.querySelectorAll('[data-id]')) { const id = node.getAttribute('data-id')!; if (/^[a-f\d]{7}$/.test(id) && !slideIds[index].includes(id)) slideIds[index].push(id); } });
    const visibleSlideIndices: number[] = [], clippedNativeIds: string[] = [];
    originals.forEach((slide, index) => { const box = slide.getBoundingClientRect(), css = getComputedStyle(slide), width = Math.max(0, Math.min(box.right, windowBox.right) - Math.max(box.left, windowBox.left)); if (box.width > 1 && box.height > 1 && css.display !== 'none' && css.visibility !== 'hidden' && width / box.width >= .6) visibleSlideIndices.push(index); if (windowValid && box.width > 1 && box.height > 1 && css.display !== 'none' && css.visibility !== 'hidden' && (box.right <= windowBox.left || box.left >= windowBox.right)) clippedNativeIds.push(...slideIds[index]); });
    const domPath = (node: Element): string | undefined => { const parts: string[] = []; for (let item: Element | null = node; item && item !== root; item = item.parentElement) { if (!item.parentElement) return; const siblings = Array.from(item.parentElement.children).filter(other => other.tagName === item!.tagName); parts.unshift(`${item.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(item) + 1})`); if (item.parentElement === root) return `:scope > ${parts.join(' > ')}`; } };
    const control = (value: Element | Element[] | string | undefined) => { let candidates: Element[] = []; try { candidates = value instanceof Element ? [value] : Array.isArray(value) ? value : typeof value === 'string' ? Array.from(root.querySelectorAll(value)) : []; } catch { return; } candidates = candidates.filter(node => root.contains(node)); return candidates.length === 1 ? domPath(candidates[0]) : undefined; };
    const pager = runtime.pagination?.el, bullets = Array.from(runtime.pagination?.bullets ?? []), pagerBox = pager instanceof Element ? pager.getBoundingClientRect() : undefined;
    let pagination: { mode: 'fraction' | 'dots'; bound: boolean; visible: boolean; current: number; total: number; text: string } | undefined;
    const hasPaint = (node: Element | null): boolean => {
      if (!node) return false;
      for (let own: Element | null = node; own; own = own.parentElement) { const css = getComputedStyle(own); if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0) return false; }
      const range = document.createRange(); range.selectNodeContents(node);
      return Array.from(range.getClientRects()).some(box => box.width > 0 && box.height > 0);
    };
    if (pager instanceof Element && root.contains(pager)) { const current = pager.querySelector('.swiper-pagination-current'), total = pager.querySelector('.swiper-pagination-total'), mode = runtime.params?.pagination?.type === 'fraction' ? 'fraction' : 'dots'; const currentValue = mode === 'fraction' ? Number(current?.textContent?.trim()) : bullets.findIndex(bullet => bullet.classList.contains('swiper-pagination-bullet-active')) + 1; const totalValue = mode === 'fraction' ? Number(total?.textContent?.trim()) : bullets.length; pagination = { mode, bound: mode === 'fraction' ? !!current && !!total : bullets.length > 0 && bullets.every(bullet => pager.contains(bullet)), visible: !!pagerBox && pagerBox.width > 0 && pagerBox.height > 0 && getComputedStyle(pager).display !== 'none' && getComputedStyle(pager).visibility !== 'hidden' && Number(getComputedStyle(pager).opacity) > 0 && (mode !== 'fraction' || hasPaint(current) && hasPaint(total)), current: currentValue, total: totalValue, text: (pager as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() ?? '', }; if (currentValue !== (runtime.snapIndex ?? runtime.activeIndex ?? -1) + 1 || totalValue !== (runtime.snapGrid?.length ?? 0)) pagination.bound = false; }
    return { initialized: originals.length > 1 && slides.length > 1, animating: runtime.animating === true, windowValid, slideIds, visibleSlideIndices, activeIndex: originals.findIndex(slide => slide === slides[runtime.activeIndex ?? -1]), coveredNativeIds: slideIds.flat(), clippedNativeIds, windowRect: { x: windowBox.x, y: windowBox.y, width: windowBox.width, height: windowBox.height }, nextSelector: control(runtime.navigation?.nextEl), previousSelector: control(runtime.navigation?.prevEl), paginationSelectors: bullets.filter(node => root.contains(node)).map(node => domPath(node)).filter((value): value is string => !!value), autoplayRunning: runtime.autoplay?.running, autoplayPaused: runtime.autoplay?.paused, pagination };
  });
}
async function moveActualCarousel(widget: Locator, index: number) {
  await widget.evaluate((root, index) => { type Runtime = { initialized?: boolean; destroyed?: boolean; el?: Element; wrapperEl?: Element; slides?: ArrayLike<Element>; slideTo?: (index: number) => void; slideToLoop?: (index: number) => void; params?: { loop?: boolean } }; const found = [root, ...root.querySelectorAll('*')].flatMap(element => { const runtime = (element as Element & { swiper?: Runtime }).swiper; return runtime?.initialized === true && !runtime.destroyed && runtime.el === element && runtime.wrapperEl instanceof Element && root.contains(runtime.wrapperEl) ? [runtime] : []; }); if (found.length !== 1 || !Number.isInteger(index) || index < 0 || index >= (found[0].slides?.length ?? 0)) throw Error('No unique owned actual carousel API/index'); const runtime = found[0]; if (runtime.params?.loop && runtime.slideToLoop) runtime.slideToLoop(index); else if (runtime.slideTo) runtime.slideTo(index); else throw Error('Actual carousel has no public registered runtime slideTo method'); }, index);
}
async function hasActualProductDots(widget: Locator) { return widget.evaluate(root => { type Runtime = { initialized?: boolean; destroyed?: boolean; pagination?: { el?: Element; bullets?: ArrayLike<Element> }; snapGrid?: number[]; snapIndex?: number }; const instances = [root, ...root.querySelectorAll('*')].map(element => (element as Element & { swiper?: Runtime }).swiper).filter(runtime => runtime?.initialized === true && !runtime.destroyed && runtime.pagination?.el instanceof Element && root.contains(runtime.pagination.el)); if (instances.length !== 1) return false; const runtime = instances[0]!, pager = runtime.pagination!.el!, bullets = Array.from(runtime.pagination?.bullets ?? []), box = pager.getBoundingClientRect(), current = bullets.flatMap((node, index) => node.classList.contains('wd-active') || node.classList.contains('swiper-pagination-bullet-active') ? [index] : []); return bullets.length > 0 && bullets.length === runtime.snapGrid?.length && bullets.every(node => pager.contains(node)) && current.length === 1 && current[0] === runtime.snapIndex && box.width > 0 && box.height > 0 && getComputedStyle(pager).display !== 'none'; }); }
async function waitRuntime(widget: Locator, deadlineMs = 5000) {
  const deadline = Date.now() + deadlineMs; let previous = '', stable = 0, state = await readOriginalCarouselRuntime(widget);
  while (Date.now() < deadline) { const signature = JSON.stringify([state.visibleSlideIndices, state.activeIndex, state.windowRect]); stable = state.initialized && !state.animating && state.windowValid && state.visibleSlideIndices.length ? signature === previous ? stable + 1 : 1 : 0; if (stable >= 3) return state; previous = signature; await widget.page().waitForTimeout(100); state = await readOriginalCarouselRuntime(widget); }
  throw Error('Native original carousel lacks a stable actual instance, canonical slides or clipped window');
}
const color = (value: string): number[] | undefined => { if (value === 'transparent') return [0, 0, 0, 0]; const hex = value.match(/^#([a-f\d]{3,8})$/i)?.[1]; if (hex) { const expanded = hex.length <= 4 ? [...hex].map(char => char + char).join('') : hex; return [0, 2, 4].map(index => parseInt(expanded.slice(index, index + 2), 16)).concat(expanded.length === 8 ? parseInt(expanded.slice(6), 16) / 255 : 1); } const rgb = value.match(/^rgba?\(([^)]+)\)$/)?.[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return rgb && rgb.length >= 3 ? [rgb[0], rgb[1], rgb[2], rgb[3] ?? 1] : undefined; };
const sameColor = (left: string, right: string) => { const a = color(left), b = color(right); return a && b ? a.every((value, index) => Math.abs(value - b[index]) <= (index === 3 ? .02 : 2)) : left === right; };
async function paint(locator: Locator) { return locator.evaluate(element => { const css = getComputedStyle(element); return { background: css.backgroundColor, color: css.color, borderColor: css.borderTopColor, borderWidth: css.borderTopWidth, radius: css.borderTopLeftRadius, opacity: css.opacity }; }); }

/** The widget wrapper can have a different, unchanged color from its rendered link.
 * Resolve the same owned native painted element for observation and restoration;
 * a coincidental nested link/image or duplicated owner cannot supply hover proof. */
async function originalHoverTarget(page: Page, node: OriginalNode, nativeId: string): Promise<{ target: Locator; paintedSelector: string }> {
  const ownerSelector = selector(nativeId), root = page.locator(ownerSelector);
  if (await root.count() !== 1) throw Error('Original hover requires exactly one actual native owner');
  const expectedType = node.kind === 'container' ? undefined : ['heading', 'button', 'image'].includes(node.kind) ? node.kind : '';
  if (expectedType === '' || !await root.evaluate((element, expected) => expected ? element.getAttribute('data-widget_type')?.split('.')[0] === expected : element.getAttribute('data-element_type') === 'container', expectedType)) throw Error('Original hover owner does not match its authored native role');
  const childSelector = node.kind === 'heading' ? '.elementor-heading-title a' : node.kind === 'button' ? 'a.elementor-button' : node.kind === 'image' ? 'img' : '';
  const target = childSelector ? root.locator(childSelector) : root;
  if (await target.count() !== 1) throw Error('Original hover requires exactly one painted native target for its role');
  if (!await target.evaluate((element, id) => element.closest('[data-id]')?.getAttribute('data-id') === id, nativeId)) throw Error('Original hover painted target belongs to a foreign native owner');
  if (['heading', 'button'].includes(node.kind) && (await target.getAttribute('href') !== node.href || normalize(await target.innerText()) !== normalize(node.text ?? ''))) throw Error('Original hover link differs from its authored native text or destination');
  if (!await target.isVisible() || !await target.evaluate(element => { const box = element.getBoundingClientRect(); if (box.width <= 0 || box.height <= 0) return false; for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) { const css = getComputedStyle(ancestor); if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) <= 0) return false; } return true; })) throw Error('Original hover target has no actual visible paint');
  return { target, paintedSelector: childSelector ? `${ownerSelector} ${childSelector}` : ownerSelector };
}

export async function inspectOriginalNativeComponents(options: { page: Page; viewport: Viewport; design: OriginalDesign; elementMap: Record<string, string>; components: OriginalNativeComponent[]; catalog?: TargetCatalogSnapshot; runDir: string }): Promise<OriginalNativeBrowserReport> {
  const { page, viewport, components, design, elementMap } = options;
  const report: OriginalNativeBrowserReport = { viewport: viewport.name, passed: false, issues: [], products: [], carousels: [], hovers: [] };
  const add = (code: string, message: string, key?: string, actual?: unknown) => report.issues.push({ code, message, viewport: viewport.name, sourceId: key, targetId: key ? elementMap[key] : undefined, actual, severity: 'error', status: 'unverified' });
  for (const component of components) {
    const widget = page.locator(selector(component.nativeId)).first();
    if (component.kind === 'products') {
      const productProof: OriginalNativeBrowserReport['products'][number] = { key: component.key, nativeId: component.nativeId, actualIds: [] as number[], expectedIds: component.productIds, passed: false }; report.products.push(productProof);
      let productStart: Awaited<ReturnType<typeof nativeCatalogRuntime>> | undefined, productMoved = false;
      try {
        const catalog = options.catalog;
        if (!catalog?.evidence.length || catalog.targetOrigin !== new URL(page.url()).origin) throw Error('Current read-only own WooCommerce catalog evidence is required');
        const selected = component.productIds.map(id => catalog.products.find(product => product.id === id));
        if (selected.some(product => !product) || JSON.stringify(component.catalog.products) !== JSON.stringify(selected)) throw Error('Compiled product identities do not match the independently read current target catalog');
        const rendered = await collectNativeCatalogRender({ page, blockId: component.key, widgetKey: component.key, elementId: component.nativeId, viewport: viewport.name, catalog, runDir: options.runDir, carouselExpected: component.display.layout === 'carousel' });
        productProof.actualIds = rendered.products.map(product => product.id);
        if (JSON.stringify(productProof.actualIds) !== JSON.stringify(component.productIds)) throw Error('Actual native product IDs/order differ from the target query');
        for (const row of rendered.products) { const actual = catalog.products.find(product => product.id === row.id)!; if (normalize(row.name) !== normalize(actual.name) || row.permalink !== actual.permalink || ![actual.imageUrl, ...actual.imageVariants].includes(row.imageUrl) || normalize(row.priceText ?? '') !== normalize(actual.priceText)) throw Error('Native product name, image, price or permalink differs from its actual WooCommerce record'); }
        const ratings = await widget.locator('.product-grid-item.product[data-id]:not(.swiper-slide-duplicate *, .slick-cloned *)').evaluateAll(cards => cards.map(card => { const element = card.querySelector('.star-rating'); return { id: Number(card.getAttribute('data-id')), visible: !!element && getComputedStyle(element).display !== 'none', rating: element?.getAttribute('data-rating') ?? element?.getAttribute('aria-label') ?? element?.getAttribute('title') ?? element?.textContent ?? '' }; }));
        for (const rating of ratings.filter(item => item.visible)) { const actual = catalog.products.find(product => product.id === rating.id) as (TargetCatalogSnapshot['products'][number] & { averageRating?: number; ratingCount?: number }) | undefined; if (actual?.averageRating === undefined || actual.ratingCount === undefined) add('original-product-rating-evidence-gap', 'A rendered rating lacks independently read target rating/count evidence', component.key, rating); else { const value = rating.rating.match(/(?:rated\s*)?(\d+(?:\.\d+)?)/i)?.[1]; if (value === undefined || Math.abs(Number(value) - actual.averageRating) > .01) add('original-product-rating-mismatch', 'Rendered native rating differs from its actual target record', component.key, rating); } }
        const expectedColumns = viewport.name === 'mobile' ? component.display.mobileColumns ?? 1 : viewport.name === 'tablet' ? component.display.tabletColumns ?? component.display.columns : component.display.columns;
        if (component.display.layout === 'carousel') {
          if (!rendered.runtime.initialized || rendered.runtime.visibleIds.length !== Math.min(expectedColumns, component.productIds.length)) throw Error('Native product carousel has no initialized instance with the authored visible columns');
          const before = rendered.runtime, pagination = component.display.pagination ?? 'dots';
          productStart = before;
          if (pagination === 'fraction') { const value = await collectNativeFractionPaint({ page, ownerSelector: selector(component.nativeId), evidencePath: path.join(options.runDir, 'verification/native-components', `${viewport.name}-${component.key}-fraction.json`) }); if (!value?.visible || value.productCount !== component.productIds.length) throw Error('Actual painted native fraction is not bound to the product instance/current/total'); productProof.pagination = { before: value }; }
          else if (pagination === 'dots') { if (!await hasActualProductDots(widget)) throw Error('Actual visible product dots are not bound to the native runtime bullets/current page'); }
          if (component.productIds.length > expectedColumns) {
            productMoved = true;
            if (component.display.arrows ?? true) { if (!before.nextSelector || !before.previousSelector) throw Error('Actual product carousel runtime has no owned next/previous controls'); await widget.locator(before.nextSelector).click({ timeout: 5000 }); }
            else await moveActualCarousel(widget, 1);
            const after = await waitForNativeCatalogReady(widget);
            if (JSON.stringify(after.visibleIds) === JSON.stringify(before.visibleIds)) throw Error('Actual native product next operation did not change visible target IDs');
            if (pagination === 'fraction') { const value = await collectNativeFractionPaint({ page, ownerSelector: selector(component.nativeId), evidencePath: path.join(options.runDir, 'verification/native-components', `${viewport.name}-${component.key}-fraction-after.json`) }); if (!value?.visible || value.current === productProof.pagination!.before!.current || value.total !== productProof.pagination!.before!.total) throw Error('Actual painted product fraction did not follow native next state'); productProof.pagination!.after = value; }
            if (component.display.arrows ?? true) await widget.locator(before.previousSelector!).click({ timeout: 5000 }); else await moveActualCarousel(widget, 0);
            const restored = await waitForNativeCatalogReady(widget);
            if (JSON.stringify(restored.visibleIds) !== JSON.stringify(before.visibleIds)) throw Error('Native product carousel did not restore its real starting state');
            if (pagination === 'fraction') { const value = await collectNativeFractionPaint({ page, ownerSelector: selector(component.nativeId), evidencePath: path.join(options.runDir, 'verification/native-components', `${viewport.name}-${component.key}-fraction-restored.json`) }); if (!value?.visible || value.renderedText !== productProof.pagination!.before!.renderedText) throw Error('Actual painted product fraction did not restore'); productProof.pagination!.restored = value; }
            productMoved = false;
          }
        }
        else { const count = await widget.locator('.product-grid-item.product[data-id]').evaluateAll(cards => { const rows = cards.map(card => card.getBoundingClientRect()); const top = Math.min(...rows.map(rect => rect.top)); return rows.filter(rect => Math.abs(rect.top - top) <= 3).length; }); if (count !== Math.min(expectedColumns, component.productIds.length)) throw Error('Actual product grid columns differ from the authored native display'); }
        productProof.passed = true;
      } catch (error) {
        add('original-native-products', safe(error), component.key);
      } finally {
        if (productMoved && productStart) try {
          const index = component.productIds.indexOf(productStart.activeIds[0]);
          if (index < 0) throw Error('Original native product starting identity was not captured');
          await moveActualCarousel(widget, index);
          const restored = await waitForNativeCatalogReady(widget);
          if (JSON.stringify(restored.visibleIds) !== JSON.stringify(productStart.visibleIds)) throw Error('Original native product observer could not restore its starting window');
        } catch (error) { add('original-native-products-observer-restore', safe(error), component.key); }
      }
    } else {
      const proof: OriginalNativeBrowserReport['carousels'][number] = { key: component.key, nativeId: component.nativeId, initialized: false, changed: false, restored: false, coveredNativeIds: [], clippedNativeIds: [] }; report.carousels.push(proof);
      try {
        await widget.scrollIntoViewIfNeeded({ timeout: 5000 });
        const before = await waitRuntime(widget); proof.before = before; proof.initialized = before.initialized;
        const expected = viewport.name === 'mobile' ? component.carousel.mobileSlidesToShow ?? 1 : viewport.name === 'tablet' ? component.carousel.tabletSlidesToShow ?? component.carousel.slidesToShow : component.carousel.slidesToShow;
        if (before.slideIds.length !== component.slideIds.length || component.slideIds.some((id, index) => !before.slideIds[index].includes(id))) throw Error('Actual runtime canonical slide boundaries/order differ from the authored native containers');
        if (before.visibleSlideIndices.length !== Math.min(expected, before.slideIds.length)) throw Error('Actual carousel display count differs from its authored viewport control');
        if (component.carousel.pagination !== 'none' && (!before.pagination?.bound || !before.pagination.visible || before.pagination.mode !== component.carousel.pagination)) throw Error('Actual carousel pager current/total/paint is not bound to its owned runtime');
        const seen = new Set(before.visibleSlideIndices), states = [before];
        proof.allSlidesFit = before.visibleSlideIndices.length === before.slideIds.length;
        proof.navigationMethod = component.carousel.arrows ? 'arrows' : component.carousel.pagination === 'dots' && before.paginationSelectors.length > 1 ? 'pager-click' : 'instance-slideTo';
        if (component.carousel.arrows && (!before.nextSelector || !before.previousSelector)) throw Error('Authored native arrows lack actual owned runtime control references');
        for (let step = 1; step <= Math.max(0, before.slideIds.length - expected); step++) {
          if (proof.navigationMethod === 'arrows') await widget.locator(before.nextSelector!).click({ timeout: 5000 }); else if (proof.navigationMethod === 'pager-click' && before.paginationSelectors[step]) await widget.locator(before.paginationSelectors[step]).click({ timeout: 5000 }); else await moveActualCarousel(widget, step);
          const after = await waitRuntime(widget); states.push(after); for (const index of after.visibleSlideIndices) seen.add(index); if (JSON.stringify(after.visibleSlideIndices) !== JSON.stringify(before.visibleSlideIndices)) proof.changed = true;
          if (component.carousel.pagination !== 'none' && (!after.pagination?.bound || !after.pagination.visible)) throw Error('Actual carousel pagination did not follow its runtime state');
        }
        proof.after = states.at(-1);
        if (proof.navigationMethod === 'arrows') for (let step = 1; step < states.length; step++) { await widget.locator(before.previousSelector!).click({ timeout: 5000 }); await waitRuntime(widget); }
        else if (proof.navigationMethod === 'pager-click' && before.paginationSelectors[before.pagination!.current - 1]) await widget.locator(before.paginationSelectors[before.pagination!.current - 1]).click({ timeout: 5000 }); else await moveActualCarousel(widget, before.activeIndex ?? 0);
        const restored = await waitRuntime(widget); proof.restored = JSON.stringify(restored.visibleSlideIndices) === JSON.stringify(before.visibleSlideIndices) && restored.activeIndex === before.activeIndex;
        if (seen.size !== before.slideIds.length || !proof.changed && !proof.allSlidesFit || !proof.restored || component.carousel.pagination !== 'none' && JSON.stringify(restored.pagination) !== JSON.stringify(before.pagination)) throw Error('Every actual canonical slide must be shown, its native state/pagination must change and its starting state must restore');
        proof.coveredNativeIds = [...new Set(before.coveredNativeIds)]; proof.clippedNativeIds = before.clippedNativeIds;
        if (component.carousel.autoplay && before.autoplayRunning !== true) throw Error('The authored native autoplay has no running actual instance');
      } catch (error) { proof.error = safe(error); add('original-native-carousel', proof.error, component.key); }
      finally {
        if (proof.before?.initialized && !proof.restored) try {
          await moveActualCarousel(widget, proof.before.activeIndex ?? 0);
          const restored = await waitRuntime(widget);
          proof.restored = restored.activeIndex === proof.before.activeIndex && JSON.stringify(restored.visibleSlideIndices) === JSON.stringify(proof.before.visibleSlideIndices);
          if (!proof.restored) throw Error('Original native carousel observer could not restore its starting window');
        } catch (error) { add('original-native-carousel-observer-restore', safe(error), component.key); }
      }
    }
  }
  for (const node of flatten(design.sections).filter(node => node.hover)) {
    const nativeId = elementMap[node.key], proof: OriginalNativeBrowserReport['hovers'][number] = { key: node.key, nativeId, applicable: viewport.deviceProfile !== 'mobile' && viewport.deviceProfile !== 'touch', changed: false, restored: false, passed: false }; report.hovers.push(proof);
    try {
      if (!proof.applicable) { proof.passed = true; continue; }
      const { target, paintedSelector } = await originalHoverTarget(page, node, nativeId); proof.paintedSelector = paintedSelector;
      await target.scrollIntoViewIfNeeded({ timeout: 5000 }); await page.mouse.move(0, 0); const before = await paint(target); proof.before = before; await target.hover({ timeout: 5000 }); await page.waitForTimeout(400); const after = await paint(target); proof.after = after;
      proof.changed = JSON.stringify(before) !== JSON.stringify(after);
      for (const [key, value] of Object.entries(node.hover!)) if (key === 'background' || key === 'color' || key === 'borderColor' ? !sameColor(String(value), after[key]) : Math.abs(Number(value) - Number.parseFloat(after[key as keyof typeof after])) > .03) throw Error(`Actual native hover ${key} differs from its authored setting`);
      await page.mouse.move(0, 0); await page.waitForTimeout(400); proof.restored = JSON.stringify(await paint(target)) === JSON.stringify(before); proof.passed = proof.changed && proof.restored;
      if (!proof.passed) throw Error('Authored native hover must change actual paint and restore');
    } catch (error) { proof.error = safe(error); add('original-native-hover', proof.error, node.key); }
    finally {
      if (proof.applicable && proof.before && !proof.restored) try {
        await page.mouse.move(0, 0); await page.waitForTimeout(400);
        const { target } = await originalHoverTarget(page, node, nativeId);
        proof.restored = JSON.stringify(await paint(target)) === JSON.stringify(proof.before);
        if (!proof.restored) throw Error('Original hover observer could not restore its starting paint');
      } catch (error) { add('original-native-hover-observer-restore', safe(error), node.key); }
    }
  }
  report.passed = report.issues.length === 0;
  await writeJson(path.join(options.runDir, 'verification/native-components', `${viewport.name}.json`), report);
  return report;
}

export interface OriginalNativeEditorReport { version: 1; passed: boolean; panels: Array<{ key: string; nativeId: string; selected: boolean; controls: string[]; error?: string }>; checks: Array<{ key: string; nativeId: string; setting: string; beforeValue: unknown; changedValue: unknown; saved: boolean; readbackConfirmed: boolean; frontendConfirmed: boolean; restored: boolean }>; issues: string[]; restoredHash?: string }
const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child) ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
const find = (nodes: DraftSnapshot['elements'], id: string): DraftSnapshot['elements'][number] | undefined => { for (const node of nodes) { if (node.id === id) return node; const child = find(node.elements, id); if (child) return child; } };
/** Exactly one registered field is authorized. Concurrent changes are never restored away. */
export function assertOriginalNativeEditorChange(before: DraftSnapshot, current: DraftSnapshot, edit: { nativeId: string; setting: string; value: unknown }, schemas: Record<string, LegacySchema>) {
  if (before.pageId !== current.pageId || before.runId !== current.runId || before.title !== current.title || before.status !== current.status || canonical(before.settings) !== canonical(current.settings)) throw Error('Owned original document changed outside its authorized native component test');
  const expected = structuredClone(before.elements), node = find(expected, edit.nativeId), actual = find(current.elements, edit.nativeId), control = node?.widgetType ? schemas[node.widgetType]?.controls[edit.setting] : undefined;
  if (!node || !actual || !['wd_products', 'nested-carousel'].includes(node.widgetType ?? '') || !control || !['items_per_page', 'slides_to_show'].includes(edit.setting)) throw Error('Only one actual registered native product count or carousel display control is authorized');
  const value = Object.hasOwn(actual.settings, edit.setting) ? actual.settings[edit.setting] : control.default;
  if (String(value) !== String(edit.value) || control.type === 'select' && !Object.hasOwn(control.options ?? {}, String(edit.value)) || control.type === 'number' && (!Number.isSafeInteger(Number(edit.value)) || Number(edit.value) < 1)) throw Error('Native editor readback differs from its legal registered value');
  const identity = (left: DraftSnapshot['elements'], right: DraftSnapshot['elements']): void => { if (left.length !== right.length) throw Error('Native component edit changed child structure'); left.forEach((element, index) => { const next = right[index]; if (element.id !== next.id || element.elType !== next.elType || element.widgetType !== next.widgetType || Boolean(element.isInner) !== Boolean(next.isInner)) throw Error('Native component edit changed identity, order or nesting'); identity(element.elements, next.elements); }); }; identity(before.elements, current.elements);
  node.settings[edit.setting] = value;
  if (canonical(compileEditorElements(expected, schemas)) !== canonical(compileEditorElements(current.elements, schemas))) throw Error('Native original component test cannot restore unrelated controls, structure or concurrent human edits');
}
const saveDraft = saveDraftThroughUI;

/** Uses authored component metadata and real controls; never fabricates a reference program or source contract. */
export async function verifyOriginalNativeEditor(options: { design: OriginalDesign; components: OriginalNativeComponent[]; client: WordPressClient; snapshot: DraftSnapshot; schemas: Record<string, LegacySchema>; elementMap: Record<string, string>; editorUrl: string; previewUrl: string; cookies: Cookie[]; runDir: string; catalog?: TargetCatalogSnapshot; browser?: Browser; onSnapshot?: (snapshot: DraftSnapshot) => void }): Promise<OriginalNativeEditorReport> {
  const report: OriginalNativeEditorReport = { version: 1, passed: false, panels: [], checks: [], issues: [] };
  if (!options.components.length) { report.passed = true; report.restoredHash = options.snapshot.hash; return report; }
  const { client, snapshot, schemas, components } = options, editorURL = new URL(options.editorUrl), previewURL = new URL(options.previewUrl);
  if (snapshot.status !== 'draft' || editorURL.origin !== previewURL.origin || editorURL.searchParams.get('post') !== String(snapshot.pageId) || editorURL.searchParams.get('action') !== 'elementor') throw Error('Native component editor must target the exact owned original draft');
  const owned = !options.browser, browser = options.browser ?? await chromium.launch({ headless: true }), context = await createScopedContext(browser, options.editorUrl, { cookies: options.cookies });
  const directory = path.join(options.runDir, 'verification/native-component-editor');
  try {
    for (const component of components) {
      assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash, snapshot.hash);
      const page = await context.newPage(), responses = attachEditorStartupNetwork(page); let tracker: ReturnType<typeof trackNativeEditorPosts> | undefined, settled = true, mutated = false;
      const panel = { key: component.key, nativeId: component.nativeId, selected: false, controls: [] as string[], error: undefined as string | undefined }; report.panels.push(panel);
      const setting = component.kind === 'products' ? 'items_per_page' : 'slides_to_show', original = find(snapshot.elements, component.nativeId), control = schemas[component.type]?.controls[setting], beforeValue = original?.settings[setting] ?? control?.default;
      let check: OriginalNativeEditorReport['checks'][number] | undefined;
      const frontendValue = async (label: string) => { const frontend = await context.newPage(); try { await frontend.setViewportSize({ width: 1440, height: 1000 }); await frontend.goto(options.previewUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); const root = frontend.locator(selector(component.nativeId)).first(); await root.scrollIntoViewIfNeeded({ timeout: 5000 }); if (component.kind === 'carousel') return (await waitRuntime(root)).visibleSlideIndices.length; if (!options.catalog?.evidence.length) throw Error('Current target catalog proof is required'); const render = await collectNativeCatalogRender({ page: frontend, blockId: `${component.key}-${label}`, widgetKey: component.key, elementId: component.nativeId, viewport: 'desktop', catalog: options.catalog, runDir: directory }); for (const row of render.products) { const record = options.catalog.products.find(item => item.id === row.id); if (!record || normalize(row.name) !== normalize(record.name) || row.permalink !== record.permalink || ![record.imageUrl, ...record.imageVariants].includes(row.imageUrl) || row.priceText && normalize(row.priceText) !== normalize(record.priceText)) throw Error('Native edited query lacks actual own-product field equality'); } return render.products.length; } finally { await frontend.close(); } };
      try {
        await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(options.editorUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); await awaitNativeEditorReady({ page, editorUrl: options.editorUrl, rootIds: options.design.sections.map(node => options.elementMap[node.key]), runDir: options.runDir, label: component.key, requirePanelAPI: true, responses });
        const widget = page.frameLocator('#elementor-preview-iframe').locator(selector(component.nativeId)).first(); if (!await widget.evaluate((element, type) => element.getAttribute('data-widget_type')?.split('.')[0] === type, component.type)) throw Error('Actual editor component does not match its registered native widget'); await selectNativeWidget(widget, page);
        await page.waitForFunction(id => { const api = (window as unknown as { elementor?: { getPanelView?: () => { getCurrentPageView?: () => { model?: { get?: (name: string) => unknown } } }; getContainer?: (id: string) => { id?: string } } }).elementor; return api?.getPanelView?.()?.getCurrentPageView?.()?.model?.get?.('id') === id && api?.getContainer?.(id)?.id === id; }, component.nativeId, { timeout: 15000 }); panel.selected = true;
        for (const tab of ['content', 'style']) { const button = page.locator(`#elementor-panel [data-tab="${tab}"],#elementor-panel .elementor-tab-control-${tab}`).first(); if (await button.isVisible()) await button.click(); panel.controls.push(...await page.locator('#elementor-panel [data-setting]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-setting') ?? ''))); }
        panel.controls = [...new Set(panel.controls)];
        if (component.kind === 'products') { const header = page.locator('#elementor-panel .elementor-control-layout_style_section .elementor-panel-heading').first(); if (!await page.locator('#elementor-panel [data-setting="items_per_page"]:visible').count() && await header.isVisible()) await header.click(); if (!panel.controls.includes('post_type')) throw Error('Real query panel lacks the registered product source control'); }
        else { const tab = page.locator('#elementor-panel [data-tab="content"],#elementor-panel .elementor-tab-control-content').first(); if (await tab.isVisible()) await tab.click(); }
        const input = page.locator(`#elementor-panel [data-setting="${setting}"]:visible`).first(); await input.waitFor({ state: 'visible', timeout: 5000 });
        if (!control || component.kind === 'products' && control.type !== 'number' || component.kind === 'carousel' && control.type !== 'select') throw Error('Actual registered native component lacks a supported count/display test control');
        const beforeCount = await frontendValue('before');
        let changedValue: unknown;
        if (component.kind === 'products') { const count = Number(beforeValue); if (!Number.isInteger(count) || count < 2 || beforeCount !== count) throw Error('Actual query must expose at least two real items for a visible reversible count edit'); changedValue = count - 1; }
        else { changedValue = Object.keys(control.options ?? {}).find(value => /^\d+$/.test(value) && Number(value) > 0 && Number(value) !== beforeCount && Number(value) <= (awaitableSlideCount(component))); if (!changedValue) throw Error('Native carousel exposes no alternate registered display count'); }
        check = { key: component.key, nativeId: component.nativeId, setting, beforeValue, changedValue, saved: false, readbackConfirmed: false, frontendConfirmed: false, restored: false }; report.checks.push(check); tracker = trackNativeEditorPosts(page); mutated = true;
        if (control.type === 'select') await chooseNativeCarouselOption(input, String(changedValue)); else { await input.focus(); await input.press('ArrowDown'); await input.press('Tab'); }
        await page.waitForFunction(({ id, setting, value }) => { const api = (window as unknown as { elementor?: { getContainer?: (id: string) => { settings?: { get?: (name: string) => unknown } }; saver?: { isEditorChanged?: () => boolean } } }).elementor; return String(api?.getContainer?.(id)?.settings?.get?.(setting)) === String(value) && api?.saver?.isEditorChanged?.() === true; }, { id: component.nativeId, setting, value: changedValue }, { timeout: 15000 });
        settled = false; await saveDraft(page, () => tracker!.markSaveClick()); await tracker.waitForQuiet(45000); settled = true;
        const modified = await client.snapshotDraft(snapshot.pageId); assertOriginalNativeEditorChange(snapshot, modified, { nativeId: component.nativeId, setting, value: changedValue }, schemas); check.saved = true; check.readbackConfirmed = true;
        for (let sample = 0; sample < 2; sample++) { await page.waitForTimeout(350); assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash, modified.hash); }
        const afterCount = await frontendValue('after'); check.frontendConfirmed = afterCount === Number(changedValue) && afterCount !== beforeCount; if (!check.frontendConfirmed) throw Error('Genuine saved native component control did not change actual frontend count');
      } catch (error) { panel.error = safe(error); report.issues.push(`${component.key}: ${panel.error}`); }
      finally {
        if (tracker) { try { await tracker.waitForQuiet(45000); settled = true; } catch (error) { settled = false; report.issues.push(safe(error)); } await writeJson(path.join(directory, `${component.key}-save.json`), { settled, events: tracker.events, pending: tracker.pendingCount() }); }
        await page.close();
        if (mutated && !settled) report.issues.push('Native component save remains unsettled; restoration success is withheld');
        else { try { const current = await client.snapshotDraft(snapshot.pageId); let restored = current; if (current.hash !== snapshot.hash) { if (!check) throw Error('No authorized native edit was recorded'); assertOriginalNativeEditorChange(snapshot, current, { nativeId: check.nativeId, setting: check.setting, value: check.changedValue }, schemas); restored = await client.restoreDraft(snapshot.pageId, snapshot, { expectedCurrent: current }); options.onSnapshot?.(restored); } assertDraftHash(restored.hash, snapshot.hash); report.restoredHash = restored.hash; if (check) { const restoredCount = await frontendValue('restored'); check.restored = restoredCount === Number(beforeValue); if (!check.restored) throw Error('Exact native component restoration did not restore its actual frontend count'); } } catch (error) { report.issues.push(`Restoration: ${safe(error)}`); } }
      }
    }
  } finally { await context.close(); if (owned) await browser.close(); }
  report.passed = report.issues.length === 0 && report.panels.length === components.length && report.panels.every(panel => panel.selected) && report.checks.length === components.length && report.checks.every(check => check.saved && check.readbackConfirmed && check.frontendConfirmed && check.restored) && report.restoredHash === snapshot.hash;
  await writeJson(path.join(directory, 'receipt.json'), report); return report;
}
function awaitableSlideCount(component: OriginalNativeComponent): number { return component.kind === 'carousel' ? component.slideIds.length : component.productIds.length; }
