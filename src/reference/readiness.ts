import type { Page } from 'playwright';

export interface SourceReadiness {
  version: 1; method: 'actual-frame-resource-and-repeated-bounds-stability'; status: 'ready' | 'partial'; passed: boolean;
  elapsedMs: number; stableForMs: number; requiredStableMs: number; sampledFrames: number; observedComponents: number; observedBounds: number;
  conditions: { domReady: boolean; fontsReady: boolean; imagesReady: boolean; repeatedBoundsStable: boolean };
  gaps: Array<{ code: string; message: string }>;
  notice: string;
}
/** Observe real frame geometry after layout/resize, without changing page styles, timers or slider state. */
export async function observeSourceReadiness(page: Page, options: { stableMs?: number; timeoutMs?: number; tolerancePx?: number; maxScanNodes?: number; maxComponents?: number } = {}): Promise<SourceReadiness> {
  const config = { stableMs: options.stableMs ?? 650, timeoutMs: options.timeoutMs ?? 5000, tolerancePx: options.tolerancePx ?? .25, maxScanNodes: options.maxScanNodes ?? 12000, maxComponents: options.maxComponents ?? 240 };
  if (!Number.isInteger(config.stableMs) || config.stableMs < 600 || config.stableMs > 6000 || !Number.isInteger(config.timeoutMs) || config.timeoutMs < config.stableMs || config.timeoutMs > 15000 || !Number.isFinite(config.tolerancePx) || config.tolerancePx < 0 || config.tolerancePx > 1 || !Number.isInteger(config.maxScanNodes) || config.maxScanNodes < 1 || config.maxScanNodes > 24000 || !Number.isInteger(config.maxComponents) || config.maxComponents < 1 || config.maxComponents > 1000) throw new Error('Source readiness requires bounded limits and at least 600ms of actual-frame stability');
  type ReadinessConfig = typeof config;
  const reader = (config: ReadinessConfig) => new Promise<SourceReadiness>(resolve => {
    const start = performance.now(), ids = new WeakMap<Element, number>(), gaps: SourceReadiness['gaps'] = [];
    let nextId = 0, dirty = true, components: Element[] = [], bounds: Element[] = [], minimum: number[] | undefined, maximum: number[] | undefined, stableSince: number | undefined, frames = 0, done = false, animation = 0;
    let conditions: SourceReadiness['conditions'] = { domReady: false, fontsReady: false, imagesReady: false, repeatedBoundsStable: false };
    const addGap = (code: string, message: string) => { if (!gaps.some(gap => gap.code === code)) gaps.push({ code, message }); };
    const identify = (element: Element) => { let id = ids.get(element); if (id === undefined) { id = ++nextId; ids.set(element, id); } return id; };
    const discover = () => {
      const all = Array.from(document.querySelectorAll('body *'));
      if (all.length > config.maxScanNodes) addGap('source-readiness-scan-limit', 'Repeated-layout readiness enumeration reached its bounded DOM budget; remaining nodes are unobserved.');
      const roots = new Set<Element>(Array.from(document.querySelectorAll('[aria-roledescription="carousel"],[role="listbox"],[data-slider-track],.slick-track,.swiper-wrapper,.splide__list,.owl-stage')));
      for (const element of all.slice(0, config.maxScanNodes)) {
        if (element.children.length < 2 || element.children.length > 100 || element.matches('script,style,svg,picture')) continue;
        const children = Array.from(element.children).filter(child => !child.matches('script,style,svg,path,button'));
        if (children.length < 2) continue;
        const groups = new Map<string, Element[]>();
        for (const child of children) { const key = `${child.tagName}:${child.getAttribute('role') ?? ''}:${!!child.querySelector('img,picture')}:${!!child.querySelector('a[href]')}`; const group = groups.get(key) ?? []; group.push(child); groups.set(key, group); }
        if ([...groups.values()].some(group => group.length >= 2 && group.length >= children.length * .6 && group.some(child => child.matches('a[href],article,[role="group"]') || !!child.querySelector('img,a[href]')))) roots.add(element);
      }
      if (roots.size > config.maxComponents) addGap('source-readiness-component-limit', 'Repeated-layout readiness reached its component budget; unmeasured tracks/templates remain unknown.');
      components = [...roots].slice(0, config.maxComponents);
      bounds = [...new Set(components.flatMap(element => [element, ...Array.from(element.children).slice(0, 100)]))]; dirty = false;
    };
    const observer = new MutationObserver(records => { if (records.some(record => record.type === 'childList')) dirty = true; });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const finish = (timedOut: boolean) => {
      if (done) return; done = true; clearTimeout(timer); cancelAnimationFrame(animation); observer.disconnect();
      const now = performance.now(), stableForMs = stableSince === undefined ? 0 : now - stableSince;
      if (!conditions.domReady) addGap('source-dom-not-ready', 'Public DOM was not ready before the bounded readiness deadline.');
      if (!conditions.fontsReady) addGap('source-fonts-not-ready', 'Font loading did not finish before the bounded readiness deadline.');
      if (!conditions.imagesReady) addGap('source-images-not-ready', 'Visible public images remained unloaded or failed before the bounded readiness deadline.');
      if (timedOut && !conditions.repeatedBoundsStable) addGap('source-layout-not-stable', 'Repeated-item/track bounds did not remain stable over the required actual-frame observation window; equal document height is insufficient.');
      const passed = !timedOut && gaps.length === 0;
      resolve({ version: 1, method: 'actual-frame-resource-and-repeated-bounds-stability', status: passed ? 'ready' : 'partial', passed, elapsedMs: Math.round(now - start), stableForMs: Math.round(stableForMs), requiredStableMs: config.stableMs, sampledFrames: frames, observedComponents: components.length, observedBounds: bounds.length, conditions, gaps, notice: 'Readiness observes current DOM, fonts, visible image loading and repeated component/item geometry over real animation frames. It does not infer future delayed timers or prove hover, autoplay or other interaction behavior.' });
    };
    const timer = setTimeout(() => finish(true), config.timeoutMs);
    const frame = () => {
      if (done) return; frames++; if (dirty) discover();
      conditions.domReady = document.readyState === 'interactive' || document.readyState === 'complete';
      conditions.fontsReady = !!document.fonts && document.fonts.status === 'loaded';
      conditions.imagesReady = Array.from(document.images).every(image => { const box = image.getBoundingClientRect(), css = getComputedStyle(image); return box.width <= 0 || box.height <= 0 || box.right <= 0 || box.left >= innerWidth || box.bottom <= 0 || box.top >= innerHeight || css.display === 'none' || css.visibility === 'hidden' || image.complete && image.naturalWidth > 0; });
      const values = [innerWidth, innerHeight, document.documentElement.clientWidth, document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, ...bounds.flatMap(element => { const box = element.getBoundingClientRect(); return [identify(element), box.x, box.y, box.width, box.height]; })];
      const equal = minimum?.length === values.length && values.every((value, index) => Number.isFinite(value) && Math.max(value, maximum![index]) - Math.min(value, minimum![index]) <= config.tolerancePx);
      const resources = conditions.domReady && conditions.fontsReady && conditions.imagesReady;
      const now = performance.now();
      if (!equal || !resources) { stableSince = undefined; minimum = [...values]; maximum = [...values]; }
      else { stableSince ??= now; minimum = values.map((value, index) => Math.min(value, minimum![index])); maximum = values.map((value, index) => Math.max(value, maximum![index])); }
      conditions.repeatedBoundsStable = stableSince !== undefined && now - stableSince >= config.stableMs && frames >= 2;
      if (resources && conditions.repeatedBoundsStable) finish(false); else animation = requestAnimationFrame(frame);
    };
    animation = requestAnimationFrame(frame);
  });
  // tsx/esbuild may annotate local function names with __name. Keep that helper
  // lexical to this read-only evaluator instead of injecting globals into a site.
  return page.evaluate<SourceReadiness>(`((__name) => (${reader.toString()})(${JSON.stringify(config)}))(target => target)`);
}
