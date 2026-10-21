import type { JSHandle, Page } from 'playwright';
import type { Native44MeasuredModule } from './contracts.js';

export interface Native44CaptureMediaMetrics {
  inventories: number; visitedNodes: number; displayedUses: number; decodeAttempts: number;
  decodeCacheHits: number; cacheInvalidations: number; maximumConcurrentDecodes: number; elapsedMs: number;
}
interface ImageSample { owner: string; hasSource: boolean; ready: boolean; failed: boolean; resourceChanged: boolean }
interface MediaUse {
  url: string; drawable: boolean; kind: string; owner: string; moduleKey: string;
  box: { x: number; y: number; width: number; height: number };
  clip: { left: number; right: number; top: number; bottom: number };
}
interface BrowserMediaSession {
  viewport(): Promise<ImageSample[]>;
  modules(input: Array<{ key: string; selector: string }>): Promise<Array<Native44MeasuredModule & { media?: MediaUse[] }>>;
  metrics(): Native44CaptureMediaMetrics;
  dispose(): void;
}

/** A process-local, document-bound observation session. Resource decoding is
 * shared, while each displayed use keeps its own owner, box and clipping facts.
 * Nothing is injected into the DOM or persistent browser globals. */
export async function createNative44CaptureMediaSession(page: Page, concurrency = 4) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw Error('Invalid bounded capture media concurrency');
  const browserFactory = ({ concurrency }: { concurrency: number }): BrowserMediaSession => {
    const capturedDocument = document, started = performance.now();
    const metrics: Native44CaptureMediaMetrics = { inventories: 0, visitedNodes: 0, displayedUses: 0, decodeAttempts: 0, decodeCacheHits: 0, cacheInvalidations: 0, maximumConcurrentDecodes: 0, elapsedMs: 0 };
    const decoded = new Map<string, Promise<boolean>>(), sources = new WeakMap<HTMLImageElement, string>(), readySources = new WeakMap<HTMLImageElement, string>();
    let dirty = false, active = 0;
    const observer = new MutationObserver(() => { dirty = true; });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const begin = () => {
      if (document !== capturedDocument || !capturedDocument.documentElement.isConnected) throw Error('Capture media document identity changed');
      if (dirty || observer.takeRecords().length) { decoded.clear(); metrics.cacheInvalidations++; dirty = false; }
      metrics.inventories++;
    };
    const mapBounded = async <T, U>(items: T[], task: (item: T) => Promise<U>): Promise<U[]> => {
      const result: U[] = new Array(items.length); let index = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (index < items.length) { const next = index++; result[next] = await task(items[next]); }
      })); return result;
    };
    const decode = (url: string, image?: HTMLImageElement): Promise<boolean> => {
      if (!url) return Promise.resolve(false);
      const known = decoded.get(url); if (known) { metrics.decodeCacheHits++; return known; }
      const task = (async () => {
        metrics.decodeAttempts++; active++; metrics.maximumConcurrentDecodes = Math.max(active, metrics.maximumConcurrentDecodes);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const candidate = image ?? new Image(); if (!image) candidate.src = url;
          await Promise.race([candidate.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('decode timeout')), 5000); })]);
          return candidate.complete && candidate.naturalWidth > 0 && candidate.naturalHeight > 0 && (!image || image.currentSrc === url);
        } catch { return false; } finally { if (timer) clearTimeout(timer); active--; }
      })(); decoded.set(url, task); return task;
    };
    const imageSource = (image: HTMLImageElement) => {
      const source = image.currentSrc, previous = sources.get(image);
      if (previous !== undefined && previous !== source) { decoded.delete(previous); decoded.delete(source); metrics.cacheInvalidations++; }
      sources.set(image, source); return source;
    };
    const inventory = (nodes: Element[], viewport: boolean) => {
      const styles = new Map<Element, CSSStyleDeclaration>(), boxes = new Map<Element, DOMRect>();
      const css = (node: Element) => { let value = styles.get(node); if (!value) { value = getComputedStyle(node); styles.set(node, value); } return value; };
      const bounds = (node: Element) => { let value = boxes.get(node); if (!value) { value = node.getBoundingClientRect(); boxes.set(node, value); } return value; };
      return nodes.flatMap(node => {
        metrics.visitedNodes++; const box = bounds(node);
        let left = viewport ? Math.max(0, box.left) : box.left, right = viewport ? Math.min(innerWidth, box.right) : box.right;
        let top = viewport ? Math.max(0, box.top) : box.top, bottom = viewport ? Math.min(innerHeight, box.bottom) : box.bottom;
        if (box.width <= 0 || box.height <= 0) return [];
        for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
          const style = css(ancestor), clip = bounds(ancestor);
          if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0 || style.contentVisibility === 'hidden') return [];
          if (ancestor !== node && /^(hidden|clip|auto|scroll)$/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
          if (ancestor !== node && /^(hidden|clip|auto|scroll)$/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
        }
        if (right - left <= (viewport ? 1 : 0) || bottom - top <= (viewport ? 1 : 0)) return [];
        return [{ node, style: css(node), box: { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height }, clip: { left: left + scrollX, right: right + scrollX, top: top + scrollY, bottom: bottom + scrollY }, owner: node.closest('[data-id]')?.getAttribute('data-id') ?? node.id ?? 'unmapped-image' }];
      });
    };
    return {
      async viewport() {
        begin(); const visible = inventory(Array.from(document.images), true);
        const result = await mapBounded(visible, async ({ node, owner }) => {
          const image = node as HTMLImageElement, source = imageSource(image), hasSource = Boolean(source || image.getAttribute('src')?.trim());
          const ready = source && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 ? await decode(source, image) : false;
          // Each actual node is checked even when another use decoded this URL.
          const actualReady = Boolean(ready && source === image.currentSrc && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0), resourceChanged = actualReady && readySources.get(image) !== source;
          if (actualReady) readySources.set(image, source);
          return { owner, hasSource, ready: actualReady, resourceChanged, failed: Boolean(image.complete && hasSource && source === image.currentSrc && (image.naturalWidth === 0 || image.naturalWidth > 0 && !ready)) };
        }); metrics.displayedUses += result.length; return result;
      },
      async modules(input) {
        begin();
        const owners = input.map(module => ({ ...module, nodes: Array.from(document.querySelectorAll(module.selector)) }));
        // One shared geometry/style/visibility sweep, including nested module
        // ownership. A use may belong to several ancestors and is not deduped.
        const candidates = inventory(Array.from(document.body.querySelectorAll('*')).filter(node => owners.some(owner => owner.nodes[0]?.contains(node))), false);
        const jobs = candidates.flatMap(candidate => {
          const rows: Array<{ candidate: typeof candidate; url: string; kind: string; image?: HTMLImageElement }> = [];
          if (candidate.node instanceof HTMLImageElement) rows.push({ candidate, url: imageSource(candidate.node) || candidate.node.src, kind: 'image', image: candidate.node });
          for (const match of candidate.style.backgroundImage.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) rows.push({ candidate, url: new URL((match[1] ?? match[2] ?? match[3]).trim(), document.baseURI).href, kind: 'background' });
          return rows;
        });
        const uses = await mapBounded(jobs, async job => {
          const drawable = await decode(job.url, job.image);
          return { ...job, drawable: Boolean(drawable && (!job.image || job.image.complete && job.image.naturalWidth > 0 && job.image.naturalHeight > 0 && job.image.currentSrc === job.url)) };
        });
        return owners.map(module => {
          const element = module.nodes[0], result: Native44MeasuredModule & { media?: MediaUse[] } = { key: module.key, count: module.nodes.length, visible: false };
          if (element) {
            const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
            result.visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            result.box = { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
            result.css = Object.fromEntries(['display', 'max-width', 'padding', 'margin', 'gap', 'font-family', 'font-size', 'line-height', 'color', 'background-color', 'background-image', 'grid-template-columns'].map(key => [key, style.getPropertyValue(key)]));
            result.media = uses.filter(use => element.contains(use.candidate.node)).map(use => ({ url: use.url, kind: use.kind, drawable: use.drawable, owner: use.candidate.owner, moduleKey: module.key, box: use.candidate.box, clip: use.candidate.clip }));
            metrics.displayedUses += result.media.length;
            result.state = { ...(element.hasAttribute('aria-expanded') ? { expanded: element.getAttribute('aria-expanded') === 'true' } : {}), hover: element.matches(':hover') };
          } return result;
        });
      },
      metrics() { return { ...metrics, elapsedMs: Math.round(performance.now() - started) }; },
      dispose() { observer.disconnect(); decoded.clear(); },
    };
  };
  // tsx's local name annotations need a lexical helper when serialized. Keep
  // it inside this trusted function's scope, never in the inspected globals.
  const handle = await page.evaluateHandle(`(() => { const __name = (target) => target; return (${browserFactory.toString()})(${JSON.stringify({ concurrency })}); })()`) as JSHandle<BrowserMediaSession>;
  return {
    viewport: () => handle.evaluate(session => session.viewport()),
    modules: (modules: Array<{ key: string; selector: string }>) => handle.evaluate((session, modules) => session.modules(modules), modules),
    metrics: () => handle.evaluate(session => session.metrics()),
    dispose: async () => { await handle.evaluate(session => session.dispose()).catch(() => undefined); await handle.dispose(); },
  };
}
export type Native44CaptureMediaSession = Awaited<ReturnType<typeof createNative44CaptureMediaSession>>;
