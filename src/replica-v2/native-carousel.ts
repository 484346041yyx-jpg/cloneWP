import type { Locator } from 'playwright';
import { waitForNativeCarouselReady, sameLogicalCarouselPosition } from '../fidelity/acceptance.js';

const nativeSelector = '[data-widget_type="nested-carousel.default"],[data-widget_type="n-carousel.default"]';

/** A contract may bind a composite wrapper; settings and runtime must belong to its one actual native widget. */
export async function resolveNativeCarouselV2(owner: Locator): Promise<Locator> {
  if (await owner.count() !== 1) throw Error('Native carousel interaction requires one actual owner');
  if (await owner.evaluate((root, selector) => root.matches(selector), nativeSelector)) return owner;
  const children = owner.locator(nativeSelector);
  if (await children.count() !== 1) throw Error('Carousel owner does not identify exactly one actual native widget');
  return children;
}

export async function nativeAutoplayV2(widget: Locator) {
  return widget.evaluate(root => {
    const window = root.querySelector('.swiper,.swiper-container') as HTMLElement & { swiper?: { params?: { autoplay?: unknown }; autoplay?: { running?: boolean; paused?: boolean } } } | null;
    const engine = window?.swiper; let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(root.getAttribute('data-settings') ?? '{}'); } catch { /* Unknown declarations cannot grant manual mode. */ }
    const parameter = engine?.params?.autoplay, configured = parameter === false ? false : parameter === true ? true : parameter && typeof parameter === 'object' ? (parameter as { enabled?: unknown }).enabled !== false : undefined;
    const declared = settings.autoplay === 'no' ? false : settings.autoplay === 'yes' ? true : undefined;
    return { ownerId: root.getAttribute('data-id'), declared, configured, parameter, running: engine?.autoplay?.running, paused: engine?.autoplay?.paused, manualVerified: declared !== true && configured !== true && engine?.autoplay?.running !== true && (declared === false || configured === false) };
  });
}

/** Reveal the actual original native slide through its existing public engine, never DOM classes or synthetic geometry. */
export async function revealNativeMediaV2(target: Locator): Promise<{ evidence: Record<string, unknown>; restore: () => Promise<void> } | undefined> {
  const ownership = await target.evaluate((root, selector) => {
    const slide = root.closest('.swiper-slide'); if (!slide) return;
    const widget = slide.closest(selector), track = slide.parentElement;
    if (!widget || !track?.classList.contains('swiper-wrapper') || slide.matches('.swiper-slide-duplicate,.slick-cloned')) throw Error('Deferred media has no proved original native slide owner');
    const window = track.parentElement as HTMLElement & { swiper?: any };
    if (!window || !window.matches('.swiper,.swiper-container') || !widget.contains(window)) throw Error('Deferred slide is not owned by its actual native window');
    const originals = Array.from(track.children).filter(node => node.matches('.swiper-slide:not(.swiper-slide-duplicate)'));
    const index = slide.getAttribute('data-swiper-slide-index');
    if (index !== null && (!/^\d+$/.test(index) || originals.filter(node => node.getAttribute('data-swiper-slide-index') === index).length !== 1)) throw Error('Deferred media slide source identity is ambiguous');
    const id = widget.getAttribute('data-id'); if (!id || document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).length !== 1) throw Error('Deferred media native widget identity is missing or ambiguous');
    return { ownerId: id, targetIndex: index !== null ? Number(index) : originals.indexOf(slide), sourceId: index !== null ? `index:${index}` : `original:${originals.indexOf(slide)}` };
  }, nativeSelector);
  if (!ownership) return;
  const widget = target.page().locator(`[data-id="${ownership.ownerId}"]`);
  await widget.scrollIntoViewIfNeeded({ timeout: 5_000 });
  const before = (await waitForNativeCarouselReady(widget)).state;
  const saved = await widget.evaluateHandle(root => {
    const window = root.querySelector('.swiper,.swiper-container') as HTMLElement & { swiper?: any } | null, engine = window?.swiper;
    if (!engine?.initialized || engine.destroyed) throw Error('Deferred media native engine is not live');
    const loop = engine.params?.loop === true, index = loop ? engine.realIndex : engine.activeIndex;
    if (!Number.isInteger(index) || index < 0 || typeof (loop ? engine.slideToLoop : engine.slideTo) !== 'function') throw Error('Deferred media native engine has no stable public source navigation');
    return { window, engine, loop, index };
  });
  const evidence: Record<string, unknown> = { ...ownership, before };
  const navigate = (index: number) => saved.evaluate((state, index) => {
    if (!state.window?.isConnected || state.window.swiper !== state.engine || !state.engine.initialized || state.engine.destroyed) throw Error('Deferred media native engine changed during verification');
    if (state.loop) state.engine.slideToLoop(index); else state.engine.slideTo(index);
  }, index);
  let disposed = false;
  const restore = async () => {
    if (disposed) return;
    try {
      await navigate(await saved.evaluate(state => state.index));
      const restored = (await waitForNativeCarouselReady(widget, 8_000)).state; evidence.restored = restored;
      if (!sameLogicalCarouselPosition(before, restored)) throw Error('Deferred media probe did not restore its original native slide window');
    } finally { disposed = true; await saved.dispose(); }
  };
  try {
    if (!before.visibleSourceIds.includes(ownership.sourceId)) await navigate(ownership.targetIndex);
    const revealed = (await waitForNativeCarouselReady(widget, 8_000)).state; evidence.revealed = revealed;
    if (!revealed.visibleSourceIds.includes(ownership.sourceId)) throw Error('Native engine did not bring its deferred source slide into the actual visible window');
    return { evidence, restore };
  } catch (error) { try { await restore(); } catch (restoreError) { throw Object.assign(restoreError as Error, { evidence }); } throw Object.assign(error as Error, { evidence }); }
}
