import type { SourceAsset, SourceCapture } from './types.js';

const PAINT_PROPERTIES = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'clip-rule', 'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'paint-order', 'vector-effect', 'stop-color', 'stop-opacity', 'filter', 'clip-path', 'mask', 'visibility', 'display']);
export interface FrozenSvgPaint { bakedOpacity: number; bakedEffects: string[] }

/** Pure migration proof for existing frozen bytes; never rewrites source facts, assets or the site. */
export function inferFrozenSvgPaint(asset: SourceAsset, source: SourceCapture): FrozenSvgPaint | undefined {
  if (!source.assets.some(item => item.url === asset.url && item.kind === asset.kind)) return undefined;
  const data = /^data:image\/svg\+xml(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(asset.url);
  if (!data || !asset.sourceNodeIds.length || !asset.viewports.length || data[2].length > 10 * 1024 * 1024) return undefined;
  let xml: string;
  try { xml = data[1] ? Buffer.from(data[2], 'base64').toString('utf8') : decodeURIComponent(data[2]); } catch { return undefined; }
  const root = /^\s*(?:<\?xml[^>]*>\s*)?<svg\b([^>]*)>/i.exec(xml);
  if (!root) return undefined;
  const attribute = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(root[1]);
  if (!attribute) return undefined;
  const style = (attribute[1] ?? attribute[2]).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const opacity = /(?:^|;)\s*opacity\s*:\s*([0-9.]+)(?:\s*!important)?\s*(?:;|$)/i.exec(style);
  const bakedOpacity = opacity ? Number(opacity[1]) : NaN;
  if (!Number.isFinite(bakedOpacity) || bakedOpacity < 0 || bakedOpacity > 1) return undefined;
  for (const name of asset.viewports) {
    const viewport = source.viewports.find(item => item.name === name);
    if (!viewport) return undefined;
    for (const id of asset.sourceNodeIds) {
      const node = viewport.elements.find(element => element.id === id && element.tag === 'svg');
      const captured = node ? Number.parseFloat(node.style.opacity) : NaN;
      if (!Number.isFinite(captured) || Math.abs(captured - bakedOpacity) > 1e-6) return undefined;
    }
  }
  const bakedEffects = [...new Set([...style.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/gi)].map(match => match[1].toLowerCase()))].filter(name => PAINT_PROPERTIES.has(name));
  return { bakedOpacity, bakedEffects };
}
