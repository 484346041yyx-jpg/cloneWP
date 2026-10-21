import type { Locator } from 'playwright';
import { nativeCatalogRuntime, waitForNativeCatalogReady, type CatalogRuntimeState } from '../fidelity/catalog-browser.js';
import { safeErrorV2 } from './journal.js';

const samePosition = (left: CatalogRuntimeState, right: CatalogRuntimeState) => JSON.stringify([left.activeIds, left.visibleIds]) === JSON.stringify([right.activeIds, right.visibleIds]);
function validIdentities(state: CatalogRuntimeState): boolean {
  const originals = new Set(state.cards.filter(card => !card.clone).map(card => card.id));
  return state.initialized && !state.animating && state.activeIds.length > 0 && state.visibleIds.length > 0 && [...originals, ...state.activeIds, ...state.visibleIds].every(id => Number.isInteger(id) && id > 0) && [...state.activeIds, ...state.visibleIds].every(id => originals.has(id));
}

/** Product carousels are owned by the actual registered query's runtime DOM
 * references. No generic .swiper selectors or inferred Woodmart arrow classes. */
export async function verifyProductCarouselInteractionV2(widget: Locator, expected?: unknown): Promise<Record<string, unknown>> {
  if (await widget.count() !== 1 || await widget.getAttribute('data-widget_type') !== 'wd_products.default') throw Error('Product carousel interaction requires one actual registered wd_products widget');
  const specification = expected && typeof expected === 'object' ? expected as { manual?: boolean; allowAllFit?: boolean; pagination?: 'bullets' | 'fraction' | false } : {};
  const evidence: Record<string, unknown> = {};
  const fail = (message: string) => Object.assign(new Error(safeErrorV2(message)), { evidence });
  let before: CatalogRuntimeState;
  try { before = await waitForNativeCatalogReady(widget); } catch (error) { evidence.failureState = await nativeCatalogRuntime(widget).catch(() => undefined); throw fail(error instanceof Error ? error.message : 'Actual product carousel readiness failed'); }
  evidence.before = before;
  if (!validIdentities(before) || !before.selector) throw fail('Product carousel has no stable original WooCommerce product identities');
  const controller = () => widget.evaluate((root, { selector, originalCount }) => {
    const element = selector === ':scope' ? root : root.querySelector(selector), engine = (element as Element & { swiper?: any } | null)?.swiper;
    if (!engine?.initialized || engine.destroyed) throw Error('The actual product carousel engine disappeared');
    const params = engine.params ?? {}, pagination = engine.pagination, declaration = params.pagination;
    const resolve = (value: any): Element[] => {
      try { return (typeof value === 'string' ? [...root.querySelectorAll(value)] : value instanceof Element ? [value] : Array.isArray(value) ? value : []).filter(item => item instanceof Element && root.contains(item)); } catch { return []; }
    };
    const painted = (item: Element): boolean => { const box = item.getBoundingClientRect(); for (let node: Element | null = item; node; node = node.parentElement) { const css = getComputedStyle(node); if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0) return false; if (node === root) break; } return box.width > 0 && box.height > 0; };
    const containers = resolve(pagination?.el ?? declaration?.el).filter(painted);
    if (containers.length > 1) throw Error('Actual product pagination has multiple visible owners');
    const container = containers[0], bullets = Array.from(pagination?.bullets ?? []).filter((item): item is Element => item instanceof Element && !!container?.contains(item)), activeClass = declaration?.bulletActiveClass;
    const classNode = (className: unknown) => typeof className === 'string' && /^[\w-]+$/.test(className) ? container?.querySelector(`.${className}`) : undefined;
    const active = typeof activeClass === 'string' && /^[\w-]+$/.test(activeClass) ? bullets.findIndex(item => item.classList.contains(activeClass)) : -1;
    const current = Number(classNode(declaration?.currentClass)?.textContent), realIndex = engine.realIndex, group = params.slidesPerGroup;
    const pageCount = params.loop === true ? Number.isInteger(group) && group > 0 ? Math.ceil(originalCount / group) : null : Array.isArray(engine.snapGrid) && engine.snapGrid.length > 0 && engine.snapGrid.every((value: unknown) => typeof value === 'number' && Number.isFinite(value)) ? engine.snapGrid.length : null;
    return { autoplayConfiguredOff: params.autoplay === false || params.autoplay?.enabled === false, autoplayRunning: engine.autoplay?.running === true, visible: !!container, type: declaration?.type ?? null, bullets: bullets.length, active, activeClass: typeof activeClass === 'string' ? activeClass : null, current: Number.isInteger(current) && current > 0 ? current : null, realIndex: Number.isInteger(realIndex) && realIndex >= 0 ? realIndex : null, group: Number.isInteger(group) && group > 0 ? group : null, logicalPage: Number.isInteger(realIndex) && realIndex >= 0 && Number.isInteger(group) && group > 0 ? Math.floor(realIndex / group) : null, pageCount };
  }, { selector: before.selector!, originalCount: new Set(before.cards.filter(card => !card.clone).map(card => card.id)).size });
  const synchronized = (state: Awaited<ReturnType<typeof controller>>) => !state.visible || state.logicalPage !== null && state.pageCount !== null && (state.type === 'bullets' ? state.bullets === state.pageCount && !!state.activeClass && state.active === state.logicalPage : state.type === 'fraction' ? state.current === state.logicalPage + 1 : false);
  const beforeController = await controller().catch(error => { throw fail(error instanceof Error ? error.message : 'Actual product controller is unavailable'); }); evidence.beforePagination = beforeController;
  if (specification.manual && (!beforeController.autoplayConfiguredOff || beforeController.autoplayRunning)) throw fail('Planned manual target product carousel is not actually configured with autoplay off');
  if (!synchronized(beforeController) || specification.pagination === false && beforeController.visible || specification.pagination && (beforeController.type !== specification.pagination || !beforeController.visible)) throw fail('Actual product pagination does not identify its current logical product page');
  const originals = new Set(before.cards.filter(card => !card.clone).map(card => card.id));
  if (specification.allowAllFit === true && [...originals].every(id => before.visibleIds.includes(id))) return { ...evidence, after: before, restored: before, allSlidesFit: true, movementRequired: false };
  if (!before.nextSelector || !before.previousSelector) throw fail('Actual target product runtime has no uniquely owned next and previous controls');
  const next = widget.locator(before.nextSelector), previous = widget.locator(before.previousSelector);
  if (await next.count() !== 1 || await previous.count() !== 1 || !await next.isVisible() || !await previous.isVisible()) throw fail('Actual target product next and previous controls are not uniquely visible');
  let moved = false, restoredNormally = false;
  const sameController = (left: Awaited<ReturnType<typeof controller>>, right: Awaited<ReturnType<typeof controller>>) => JSON.stringify(left) === JSON.stringify(right);
  try {
    await next.click(); moved = true;
    const after = await waitForNativeCatalogReady(widget), afterController = await controller(); evidence.after = after; evidence.afterPagination = afterController;
    if (!validIdentities(after) || samePosition(before, after)) throw Error('Actual target product next action did not change source-identified WooCommerce cards');
    if (specification.manual && (!afterController.autoplayConfiguredOff || afterController.autoplayRunning) || !synchronized(afterController) || afterController.visible && afterController.logicalPage === beforeController.logicalPage) throw Error('Actual target product pagination did not synchronize with the changed logical product page');
    await previous.click(); moved = false;
    const restored = await waitForNativeCatalogReady(widget), restoredController = await controller(); evidence.restored = restored; evidence.restoredPagination = restoredController;
    if (!validIdentities(restored) || !samePosition(before, restored) || !sameController(beforeController, restoredController)) throw Error('Actual target product controls did not restore their original product identities and pagination');
    restoredNormally = true; return { ...evidence, nextChanged: true, restoredPosition: true };
  } catch (error) {
    evidence.failureState = await nativeCatalogRuntime(widget).catch(() => undefined);
    const failure = new Error(safeErrorV2(error)); Object.assign(failure, { evidence }); throw failure;
  } finally {
    if (!restoredNormally) {
      try {
        const actual = await nativeCatalogRuntime(widget); if (moved && !samePosition(before, actual)) await previous.click();
        const restored = await waitForNativeCatalogReady(widget, 4_000), pagination = await controller();
        if (!validIdentities(restored) || !samePosition(before, restored) || !sameController(beforeController, pagination)) throw Error('Failed product interaction could not restore actual cards and controller state');
        evidence.cleanup = { restored: true, state: restored, pagination };
      } catch (error) { evidence.cleanup = { restored: false, error: safeErrorV2(error) }; }
    }
  }
}
