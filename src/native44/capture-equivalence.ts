import type { ObservationPacketV2 } from '../replica-v2/observation.js';

/** Compare an auxiliary expanded raster with the two required desktop
 * observations. Original facts are retained; no resize or fabricated pixels
 * can establish this proof. Pure viewport-width backgrounds are compared by
 * their exact visible coverage, while every descendant is checked separately.
 */
export function assertExpandedCaptureEquivalent(original: ObservationPacketV2[], expanded: ObservationPacketV2[], options: {clip?:{top:number;height:number}} = {}): void {
  const merge = (packets: ObservationPacketV2[]) => ({
    nodes: Object.assign({}, ...packets.map(packet => packet.nodes)) as ObservationPacketV2['nodes'],
    layouts: Object.assign({}, ...packets.map(packet => packet.layouts)) as ObservationPacketV2['layouts'],
    styles: Object.assign({}, ...packets.map(packet => packet.styles)) as ObservationPacketV2['styles'],
    texts: packets.flatMap(packet => Object.values(packet.texts)),
    usages: packets.flatMap(packet => Object.values(packet.usages)),
    resources: Object.assign({}, ...packets.map(packet => packet.resources)) as ObservationPacketV2['resources'],
  });
  if (!original.length || !expanded.length) throw Error('Expanded capture needs actual desktop and auxiliary packets');
  const a = merge(original), b = merge(expanded), source = original[0].snapshot, raster = expanded[0].snapshot;
  const direct = raster.viewport.width === source.viewport.clientWidth && raster.viewport.height === source.pageHeight && raster.viewport.scrollbarWidth === 0;
  const tall = raster.viewport.width === source.viewport.width && raster.viewport.height >= source.viewport.height && raster.viewport.scrollbarWidth === source.viewport.scrollbarWidth;
  if (source.url !== raster.url || (!direct && !tall) || raster.viewport.clientWidth !== source.viewport.clientWidth || raster.pageHeight !== source.pageHeight || raster.viewport.devicePixelRatio !== source.viewport.devicePixelRatio) throw Error('Expanded raster does not preserve the exact source content width/page height');
  if (JSON.stringify(Object.keys(a.nodes).sort()) !== JSON.stringify(Object.keys(b.nodes).sort())) throw Error('Expanded capture changed source node identities');
  const geometry = (layout: ObservationPacketV2['layouts'][string]) => layout.captureGeometry ?? layout;
  const paintProperties = ['display', 'position', 'visibility', 'opacity', 'background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'white-space', 'border-radius', 'border-width', 'border-color', 'border-style', 'box-shadow', 'overflow', 'object-fit', 'object-position', 'z-index', 'animation-name', 'animation-duration', 'animation-timing-function', 'animation-iteration-count'];
  const clipPaintProperties = ['text-shadow', 'filter', 'backdrop-filter', '-webkit-box-reflect', 'mix-blend-mode', 'outline-style', 'outline-width', 'border-image-outset'];
  const coverage = (rect: {x:number;y:number;width:number;height:number}) => [Math.max(0, rect.x), rect.y, Math.min(source.viewport.clientWidth, rect.x + rect.width), rect.height];
  // A clipped frame can exclude a sticky header in both observations. Its
  // viewport state need not match, but a border box alone does not bound
  // shadows, generated content, group effects, or an overflowing descendant.
  // Require explicit no-bleed facts; older packets without them get no waiver.
  const noGroupEffects = (style: Record<string, string>) => ['filter', 'backdrop-filter', '-webkit-box-reflect'].every(property => style[property] === 'none') && style['mix-blend-mode'] === 'normal';
  const zeroLengths = (value: string | undefined) => /^0(?:px)?(?:\s+0(?:px)?){0,3}$/.test(value ?? '');
  const boundedEffects = (style: Record<string, string>) => noGroupEffects(style) &&
    style['box-shadow'] === 'none' && style['text-shadow'] === 'none' &&
    typeof style['outline-style'] === 'string' && typeof style['outline-width'] === 'string' &&
    (style['outline-style'] === 'none' || /^0(?:px)?$/.test(style['outline-width'])) &&
    zeroLengths(style['border-image-outset']);
  const boundedPseudo = (style: Record<string, string>, pseudo: string, rect: {width:number;height:number}) => {
    const content = style[`${pseudo}:content`];
    if (['none', 'normal'].includes(content)) return true;
    const own = Object.fromEntries(Object.entries(style).filter(([key]) => key.startsWith(`${pseudo}:`)).map(([key, value]) => [key.slice(pseudo.length + 1), value]));
    if (own.position !== 'static' || own.transform !== 'none' || !boundedEffects(own) ||
      own['background-image'] !== 'none' || !/^(?:transparent|rgba\([^)]*,\s*0(?:\.0+)?\))$/.test(own['background-color'] ?? '') ||
      !zeroLengths(own['border-width']) || !/^(?:none)(?:\s+none){0,3}$/.test(own['border-style'] ?? '') ||
      !['margin', 'padding'].every(kind => ['top', 'right', 'bottom', 'left'].every(side => zeroLengths(own[`${kind}-${side}`]))) ||
      !['visible', 'hidden', 'clip'].includes(own.overflow)) return false;
    const within = (value: string | undefined, maximum: number) => value === 'auto' || /^\d+(?:\.\d+)?px$/.test(value ?? '') && Number.parseFloat(value!) <= maximum;
    if (!within(own.width, rect.width) || !within(own.height, rect.height)) return false;
    // Empty static clear-fix boxes have no own paint under the conditions
    // above. A static inline font glyph uses the same originating-box model
    // as ordinary text; this does not claim to measure exact font ink extents.
    if (['""', "''"].includes(content)) return ['table', 'block', 'inline', 'inline-block', 'flow-root'].includes(own.display);
    return /^(?:"[^"]+"|'[^']+')$/.test(content ?? '') && own.display === 'inline' &&
      /^\d+(?:\.\d+)?px$/.test(own['font-size'] ?? '') && Number.parseFloat(own['font-size']) > 0 &&
      (own['line-height'] === 'normal' || own['line-height'] !== 'auto' && within(own['line-height'], rect.height));
  };
  const boundedPaint = (style: Record<string, string>, rect: {width:number;height:number}) => boundedEffects(style) && ['before', 'after'].every(pseudo => boundedPseudo(style, pseudo, rect));
  const hiddenOwnPaint = (nodes: Array<ObservationPacketV2['nodes'][string]>) => {
    const styles = nodes.map((node, index) => (index === 0 ? a : b).styles[node.styleId]);
    return nodes.every(node => !node.visible) && styles[0].visibility === styles[1].visibility && ['hidden', 'collapse'].includes(styles[0].visibility) &&
      styles.every(style => ['before', 'after'].every(pseudo => ['none', 'normal'].includes(style[`${pseudo}:content`]) || ['hidden', 'collapse'].includes(style[`${pseudo}:visibility`])));
  };
  const outside = (rect: {y:number;height:number}) => Boolean(options.clip && (rect.y + rect.height < options.clip.top || rect.y > options.clip.top + options.clip.height));
  const outsideTreeCache = new Map<string, boolean>();
  const outsideTree = (id: string): boolean => {
    if (outsideTreeCache.has(id)) return outsideTreeCache.get(id)!;
    outsideTreeCache.set(id, false);
    const nodes = [a.nodes[id], b.nodes[id]];
    const hidden = hiddenOwnPaint(nodes);
    if (nodes.some((node, index) => {
      const set = index === 0 ? a : b, layout = set.layouts[node.layoutId], style = set.styles[node.styleId];
      return hidden ? !noGroupEffects(style) : ![layout.rect, layout.contentRect, geometry(layout).rect, geometry(layout).contentRect].every(outside) || !boundedPaint(style, layout.rect) ||
        // SVG descendants are serialized as one media resource, so their own
        // overflow cannot be proven by independently checking child boxes.
        (node.tag === 'svg' && !['hidden', 'clip'].includes(style.overflow));
    })) return false;
    if ([...new Set(nodes.flatMap(node => node.childIds))].some(child => !outsideTree(child))) return false;
    outsideTreeCache.set(id, true);
    return true;
  };
  const excludedPaint = (id: string) => {
    if (!options.clip || !outsideTree(id)) return false;
    for (const set of [a, b]) {
      let parent = set.nodes[id].parentId;
      const seen = new Set<string>();
      while (parent) {
        if (seen.has(parent) || !noGroupEffects(set.styles[set.nodes[parent].styleId])) return false;
        seen.add(parent); parent = set.nodes[parent].parentId;
      }
    }
    return true;
  };
  const displayNoneAncestor = (set: typeof a, id: string) => {
    let current: string | null = id;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current)) return false;
      seen.add(current);
      const node: ObservationPacketV2['nodes'][string] = set.nodes[current];
      if (set.styles[node.styleId].display === 'none' && set.layouts[node.layoutId].display === 'none') return true;
      current = node.parentId;
    }
    return false;
  };
  for (const [id, node] of Object.entries(a.nodes)) {
    const other = b.nodes[id], left = a.layouts[node.layoutId], right = b.layouts[other.layoutId], ls = a.styles[node.styleId], rs = b.styles[other.styleId];
    if (node.selector !== other.selector || node.tag !== other.tag || node.parentId !== other.parentId || JSON.stringify(node.childIds) !== JSON.stringify(other.childIds) || node.visible !== other.visible) throw Error(`Expanded capture changed source structure: ${id}`);
    const zeroAreaHidden = !node.visible && !other.visible && left.rect.width * left.rect.height === 0 && right.rect.width * right.rect.height === 0;
    const displayNoneExcluded = Boolean(options.clip) && zeroAreaHidden && displayNoneAncestor(a, id) && displayNoneAncestor(b, id);
    const clipExcluded = displayNoneExcluded || excludedPaint(id);
    if (['id','href','alt','title','role','type','placeholder','aria-label','data-sku','data-product-id','data-product_id','data-slick-index'].some(key => (node.attributes[key] ?? '') !== (other.attributes[key] ?? ''))) throw Error(`Expanded capture changed a semantic source attribute: ${id}`);
    if (Boolean(left.captureGeometry) !== Boolean(right.captureGeometry)) throw Error(`Expanded capture changed animation layout identity: ${id}`);
    const originalText = a.texts.filter(text => text.nodeId === id).map(text => text.text), expandedText = b.texts.filter(text => text.nodeId === id).map(text => text.text);
    // A zero-area hidden carousel's live counter is not present in either
    // raster. Its original text is still retained in the desktop packet.
    if ((!zeroAreaHidden || clipExcluded) && JSON.stringify(originalText) !== JSON.stringify(expandedText)) throw Error(`Expanded capture changed copy: ${id}`);
    const media = (set: typeof a) => set.usages.filter(usage => usage.nodeId === id).map(usage => [usage.kind, usage.attribute ?? '', usage.media ?? '', usage.visible, set.resources[usage.resourceId]?.inline ?? set.resources[usage.resourceId]?.url]);
    if (JSON.stringify(media(a)) !== JSON.stringify(media(b))) throw Error(`Expanded capture changed media: ${id}`);
    // getBoundingClientRect() for a display:none fixed subtree is all-zero;
    // document-space collection still adds scrollY. That offset paints no
    // pixels, including any generated content suppressed by display:none.
    if (clipExcluded) continue;
    if (!zeroAreaHidden && [...paintProperties, ...(options.clip ? clipPaintProperties : [])].some(property => (ls[property] ?? '') !== (rs[property] ?? ''))) throw Error(`Expanded capture changed paint styles: ${id}`);
    if (!zeroAreaHidden && [...new Set([...Object.keys(ls),...Object.keys(rs)])].filter(property=>/^(?:before|after):/.test(property)).some(property=>(ls[property]??'')!==(rs[property]??''))) throw Error(`Expanded capture changed pseudo-element paint: ${id}`);
    if (!zeroAreaHidden && !left.captureGeometry && !right.captureGeometry && (ls.transform ?? '') !== (rs.transform ?? '')) throw Error(`Expanded capture changed a non-animation transform: ${id}`);
    const lg = geometry(left), rg = geometry(right);
    if (JSON.stringify([lg.rect, lg.contentRect, left.display, left.position]) === JSON.stringify([rg.rect, rg.contentRect, right.display, right.position])) continue;
    const solidWrapper = !originalText.length && !a.usages.some(usage => usage.nodeId === id) && !left.captureGeometry && !right.captureGeometry &&
      left.rect.x <= 0 && right.rect.x <= 0 && left.rect.x + left.rect.width >= source.viewport.clientWidth && right.rect.x + right.rect.width >= source.viewport.clientWidth &&
      (ls['background-image'] ?? 'none') === 'none' && (ls['box-shadow'] ?? 'none') === 'none' && Number.parseFloat(ls['border-width'] ?? '0') === 0 && Number.parseFloat(ls['border-radius'] ?? '0') === 0 &&
      JSON.stringify(coverage(left.rect)) === JSON.stringify(coverage(right.rect));
    if (!solidWrapper) throw Error(`Expanded capture changed source geometry: ${id}`);
  }
}
