import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import type { NativeElement } from './types.js';

/**
 * Presentation-only adapter over Woodmart's actual Swiper pagination items.
 * No product count/current page is frozen in CSS. The native runtime owns the
 * item list and active item, including rebuilding that list at breakpoints.
 */
export const NATIVE_FRACTION_ADAPTER = 'woodmart-native-fraction-v1' as const;
export const NATIVE_FRACTION_SELECTOR = '.wd-nav-pagin';
export const NATIVE_FRACTION_ITEM_SELECTOR = '.wd-nav-pagin-item';
export const NATIVE_FRACTION_ACTIVE_CLASS = 'wd-active';
export const NATIVE_FRACTION_COUNTERS = ['clonewp-page-current', 'clonewp-page-total'] as const;

const fractionCSS = [
  'selector .wd-nav-pagin{counter-reset:clonewp-page-current clonewp-page-total;position:relative;display:block;width:100%;height:100%;margin:0;padding:0;}',
  'selector .wd-nav-pagin .wd-nav-pagin-item{counter-increment:clonewp-page-total;display:block;position:absolute;width:0;height:0;min-width:0;margin:0;padding:0;border-width:0;overflow:hidden;opacity:0;pointer-events:none;}',
  'selector .wd-nav-pagin .wd-nav-pagin-item:not(.wd-active ~ .wd-nav-pagin-item){counter-increment:clonewp-page-total clonewp-page-current;}',
  'selector .wd-nav-pagin::after{content:counter(clonewp-page-current) " / " counter(clonewp-page-total);display:block;white-space:nowrap;text-align:center;}',
].join('\n');

export function buildNativeFractionCSS(): string { return fractionCSS; }

/** Capability planning requires the complete adapter, not a CSS marker/label. */
export function hasNativeFractionBinding(node: Pick<NativeElement, 'type' | 'settings'>): boolean {
  if (node.type !== 'wd_products' || typeof node.settings.custom_css !== 'string') return false;
  const css = node.settings.custom_css;
  if (!css.includes(fractionCSS)) return false;
  // A later counter/content override could make a present adapter a false proof.
  const rest = css.replace(fractionCSS, '');
  return !/(?:^|[;{])\s*(?:counter-reset|counter-increment|counter-set|content)\s*:|clonewp-page-(?:current|total)/i.test(rest);
}

export interface NativeFractionPaint {
  selector: string; renderedText: string; current: number; total: number;
  nativeBulletCount: number; nativeActiveIndex: number; productCount: number;
  runtime: { initialized: boolean; snapCount: number; slidesPerGroup: number; loop: boolean; slidesPerView: number | 'auto' };
  adapterSha256: string; paintSource: 'chromium-layout-generated-text';
  visible: boolean; evidence: string[];
}

export interface NativeFractionNavigationReceipt {
  passed: boolean; allSlidesFit: boolean; action?: 'next' | 'previous';
  before?: NativeFractionPaint; changed?: NativeFractionPaint; restored?: NativeFractionPaint;
  error?: string;
}

/** Operate only real native arrows and restore the initial pagination state. */
export async function probeNativeFractionNavigation(options: {
  page: Page; ownerSelector: string; evidencePath: string;
}): Promise<NativeFractionNavigationReceipt> {
  const before = await collectNativeFractionPaint(options);
  if (!before) return { passed: false, allSlidesFit: false, error: 'Actual drawn native fraction/runtime ownership could not be proved' };
  if (before.total === 1) return { passed: true, allSlidesFit: true, before, restored: before };
  const canOperate = async (selector: string) => {
    const nodes = options.page.locator(`${options.ownerSelector} ${selector}`);
    if (await nodes.count() !== 1 || !await nodes.isVisible()) return false;
    return nodes.evaluate(element => {
      const css = getComputedStyle(element);
      return !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true' && !element.classList.contains('wd-disabled') && !element.classList.contains('swiper-button-disabled') && css.pointerEvents !== 'none' && Number(css.opacity) > 0;
    });
  };
  const direction = await canOperate('.wd-nav-arrows .wd-next') ? 'next' : await canOperate('.wd-nav-arrows .wd-prev') ? 'previous' : undefined;
  if (!direction) return { passed: false, allSlidesFit: false, before, error: 'Native fraction has multiple pages but no visible operable native arrow; verify the actual touch/drag path separately' };
  const forward = direction === 'next' ? '.wd-next' : '.wd-prev', backward = direction === 'next' ? '.wd-prev' : '.wd-next';
  const waitForIndex = async (index: number, equal: boolean) => options.page.waitForFunction(({ selector, index, equal }) => {
    const items = Array.from(document.querySelectorAll(`${selector} .wd-nav-pagin > .wd-nav-pagin-item`));
    const active = items.findIndex(item => item.classList.contains('wd-active'));
    return equal ? active === index : active >= 0 && active !== index;
  }, { selector: options.ownerSelector, index, equal }, { timeout: 5000 });
  try {
    await options.page.locator(`${options.ownerSelector} .wd-nav-arrows ${forward}`).click();
    await waitForIndex(before.nativeActiveIndex, false);
    const changed = await collectNativeFractionPaint(options);
    await options.page.locator(`${options.ownerSelector} .wd-nav-arrows ${backward}`).click();
    await waitForIndex(before.nativeActiveIndex, true);
    const restored = await collectNativeFractionPaint(options);
    const passed = !!changed && !!restored && changed.current !== before.current && changed.total === before.total && changed.productCount === before.productCount && restored.renderedText === before.renderedText && restored.productCount === before.productCount;
    return { passed, allSlidesFit: false, action: direction, before, changed, restored, ...(!passed ? { error: 'Actual painted fraction did not follow and restore the native query pagination state' } : {}) };
  } catch (error) {
    return { passed: false, allSlidesFit: false, action: direction, before, error: error instanceof Error ? error.message.split('\n')[0] : 'Native fraction state probe failed' };
  }
}

/**
 * Read Chromium's actual generated text layout. getComputedStyle(content)
 * returns an unevaluated counter expression, so it cannot prove drawn digits.
 * CDP resolves those digits; no expected value or query count supplies text.
 */
export async function collectNativeFractionPaint(options: {
  page: Page; ownerSelector: string; evidencePath: string;
}): Promise<NativeFractionPaint | undefined> {
  if (!/^\[data-id="[a-z0-9_-]+"\]$/i.test(options.ownerSelector)) throw new Error('Native fraction probe requires a unique bounded Elementor owner');
  const facts = await options.page.evaluate(({ ownerSelector, selector, itemSelector, activeClass }) => {
    const roots = document.querySelectorAll(ownerSelector);
    if (roots.length !== 1 || roots[0].getAttribute('data-widget_type') !== 'wd_products.default') return undefined;
    const owner = roots[0], pagers = owner.querySelectorAll(selector);
    if (pagers.length !== 1) return undefined;
    const pager = pagers[0], css = getComputedStyle(pager), after = getComputedStyle(pager, '::after');
    if (!after.content.includes('counter(clonewp-page-current)') || !after.content.includes('counter(clonewp-page-total)')) return undefined;
    const bullets = Array.from(pager.querySelectorAll(`:scope > ${itemSelector}`));
    const active = bullets.flatMap((node, index) => node.classList.contains(activeClass) ? [index] : []);
    if (!bullets.length || active.length !== 1) return undefined;
    type SwiperRuntime = { initialized?: boolean; destroyed?: boolean; snapGrid?: number[]; pagination?: { bullets?: ArrayLike<Element>; el?: Element }; params?: { slidesPerGroup?: number; loop?: boolean; slidesPerView?: number | 'auto' } };
    const runtimes = [owner, ...owner.querySelectorAll('*')].map(node => (node as Element & { swiper?: SwiperRuntime }).swiper).filter((runtime): runtime is SwiperRuntime => runtime?.initialized === true && !runtime.destroyed && runtime.pagination?.el === pager);
    if (runtimes.length !== 1) return undefined;
    const runtime = runtimes[0], nativeBullets = Array.from(runtime.pagination?.bullets ?? []);
    if (nativeBullets.length !== bullets.length || !nativeBullets.every((node, index) => node === bullets[index])) return undefined;
    const products = new Set(Array.from(owner.querySelectorAll('.product-grid-item.product[data-id]')).filter(node => !node.closest('.swiper-slide-duplicate,.slick-cloned')).map(node => Number(node.getAttribute('data-id'))));
    if (![...products].every(id => Number.isInteger(id) && id > 0)) return undefined;
    const rect = pager.getBoundingClientRect();
    let visible = rect.width > 0 && rect.height > 0;
    for (let node: Element | null = pager; node; node = node.parentElement) { const own = getComputedStyle(node); if (own.display === 'none' || own.visibility === 'hidden' || Number(own.opacity) === 0) visible = false; }
    return { nativeBulletCount: bullets.length, nativeActiveIndex: active[0], productCount: products.size,
      runtime: { initialized: true, snapCount: runtime.snapGrid?.length ?? 0, slidesPerGroup: runtime.params?.slidesPerGroup ?? 1, loop: runtime.params?.loop === true, slidesPerView: runtime.params?.slidesPerView ?? 'auto' }, visible,
      afterExpression: after.content, counterReset: css.counterReset };
  }, { ownerSelector: options.ownerSelector, selector: NATIVE_FRACTION_SELECTOR, itemSelector: NATIVE_FRACTION_ITEM_SELECTOR, activeClass: NATIVE_FRACTION_ACTIVE_CLASS });
  if (!facts) return undefined;
  const cdp = await options.page.context().newCDPSession(options.page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `${options.ownerSelector} ${NATIVE_FRACTION_SELECTOR}` });
    if (!nodeId) return undefined;
    const { node } = await cdp.send('DOM.describeNode', { nodeId });
    const snapshot = await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [], includePaintOrder: true });
    const document = snapshot.documents.find(document => document.nodes.backendNodeId?.includes(node.backendNodeId));
    if (!document?.nodes.backendNodeId || !document.nodes.parentIndex) return undefined;
    const ownerIndex = document.nodes.backendNodeId.indexOf(node.backendNodeId), parents = document.nodes.parentIndex;
    const afterIndexes = new Set(document.nodes.pseudoType?.index.filter((index, offset) => parents[index] === ownerIndex && snapshot.strings[document.nodes.pseudoType!.value[offset]] === 'after') ?? []);
    const renderedText = document.layout.text.flatMap((value, index) => afterIndexes.has(document.layout.nodeIndex[index]) && value >= 0 ? [snapshot.strings[value]] : []).join('').replace(/\s+/g, ' ').trim();
    const parsed = /^(\d+)\s*\/\s*(\d+)$/.exec(renderedText);
    if (!parsed) return undefined;
    const current = Number(parsed[1]), total = Number(parsed[2]);
    // The actual drawn fraction must agree with the native runtime's real items.
    if (current !== facts.nativeActiveIndex + 1 || total !== facts.nativeBulletCount || !Number.isInteger(total) || total < 1) return undefined;
    return { selector: `${options.ownerSelector} ${NATIVE_FRACTION_SELECTOR}`, renderedText, current, total, nativeBulletCount: facts.nativeBulletCount, nativeActiveIndex: facts.nativeActiveIndex, productCount: facts.productCount,
      runtime: facts.runtime, adapterSha256: createHash('sha256').update(fractionCSS).digest('hex'), paintSource: 'chromium-layout-generated-text', visible: facts.visible, evidence: [options.evidencePath] };
  } finally { await cdp.detach(); }
}
