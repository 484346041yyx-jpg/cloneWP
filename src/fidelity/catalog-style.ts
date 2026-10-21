import { validateScopedNativeCSS } from './native.js';
import type { CatalogSlotRole, PresentationCatalogTemplate, PresentationPaint, PresentationRect } from './presentation-contract.js';
import type { NativeElement } from './types.js';

/** A missing slot is not evidence of absence. This inventory must come from the complete owned source card. */
export interface CatalogSlotInventory {
  sourceNodeId: string; complete: true; evidence: string[]; absentRoles: CatalogSlotRole[];
}
export interface NativeCatalogStyleView {
  template: PresentationCatalogTemplate;
  /** The actual registered target breakpoint, independently reconciled with the observed source viewport. */
  maxWidth?: number;
  slotInventory?: CatalogSlotInventory;
  /** Independently observed content border-box and its margins, in the same card coordinate system. */
  slotContent?: Partial<Record<CatalogSlotRole, CatalogSlotContent>>;
}
export interface CatalogSlotContent {
  sourceNodeId: string; evidence: string[]; borderBox: PresentationRect;
  margins: { top: number; right: number; bottom: number; left: number };
  /** Price glyphs vary in width; this must identify the actual observed containing row. */
  inlineSize?: 'fill-allocation'; allocationSourceNodeId?: string;
  /** Explicit dynamic-data policy: use only independently bounded unused same-card space. */
  growth?: { maxAllocationBottom: number; evidence: string[]; reason: string };
}
export interface NativeCatalogStyleResult {
  css: string;
  gaps: Array<{ viewport: string; role?: CatalogSlotRole; reason: string }>;
  receipts: Array<{ viewport: string; sourceNodeId: string; evidence: string[]; hiddenRoles: CatalogSlotRole[]; slotContent?: NativeCatalogStyleView['slotContent'] }>;
}
const roles: CatalogSlotRole[] = ['image', 'name', 'rating', 'price', 'badge'];
const nativeRole: Record<CatalogSlotRole, string> = { image: '.product-element-top', name: '.wd-entities-title', rating: '.star-rating', price: '.price', badge: '.product-labels' };
const px = (value: number) => {
  if (!Number.isFinite(value) || Math.abs(value) > 16384) throw Error('Catalog style requires finite bounded measured dimensions');
  return `${Math.round(value * 100) / 100}px`;
};
function safe(value: string): string {
  if (!value.trim() || value.length > 250 || !/^[a-zA-Z0-9#(),.%\s+/*'"_-]+$/.test(value)) throw Error('Catalog paint is not a bounded visual CSS value');
  return value;
}
const properties = { color: 'color', backgroundColor: 'background-color', borderColor: 'border-color', borderWidth: 'border-width', borderRadius: 'border-radius', opacity: 'opacity', fontSize: 'font-size', lineHeight: 'line-height', fontWeight: 'font-weight', fontFamily: 'font-family', textAlign: 'text-align', boxShadow: 'box-shadow' } as const;
function paintCSS(paint: PresentationPaint | undefined): string {
  return Object.entries(paint ?? {}).map(([key, value]) => {
    const property = properties[key as keyof typeof properties];
    if (!property) throw Error('Catalog paint has an unsupported property');
    return `${property}:${typeof value === 'number' ? key === 'opacity' ? safe(String(value)) : px(value) : safe(String(value))};`;
  }).join('');
}
const rule = (selector: string, declarations: string) => `${selector}{${declarations}}`;

/**
 * Project measured slots onto the registered Woodmart icons template. Product DOM/data and
 * native query/Swiper controls remain intact; only the widget's editable custom_css changes.
 * This function deliberately contains no source URL, block ID, product count or default brand skin.
 */
export function buildNativeCatalogStyle(views: Record<string, NativeCatalogStyleView>): NativeCatalogStyleResult {
  const entries = Object.entries(views).sort((a, b) => (b[1].maxWidth ?? Infinity) - (a[1].maxWidth ?? Infinity));
  if (!entries.length || entries.filter(([, view]) => view.maxWidth === undefined).length !== 1) throw Error('Catalog style requires one measured base view and explicit responsive breakpoints');
  if (new Set(entries.map(([, view]) => view.maxWidth)).size !== entries.length) throw Error('Catalog style breakpoints must be unique');
  const result: NativeCatalogStyleResult = { css: '', gaps: [], receipts: [] };
  const cascade = new Map<string, Map<string, string>>();
  const fragments = [
    rule('selector .product-wrapper', 'position:relative;display:block;padding:0;margin:0;overflow:hidden;'),
    rule('selector .product-element-bottom', 'position:static;display:block;padding:0;margin:0;'),
    rule('selector .product-image-link', 'display:block;width:100%;height:100%;'),
    rule('selector .wd-entities-title a', 'font-family:inherit;font-size:inherit;font-weight:inherit;line-height:inherit;color:inherit;text-decoration:none;display:block;width:100%;height:100%;max-height:100%;overflow:hidden;'),
    rule('selector .price .amount,selector .price bdi', 'font-family:inherit;font-size:inherit;font-weight:inherit;line-height:inherit;color:inherit;'),
    rule('selector .product-labels .product-label', 'color:inherit;background-color:inherit;font-family:inherit;font-size:inherit;font-weight:inherit;line-height:inherit;border-radius:inherit;min-width:0;min-height:0;max-width:100%;padding:0;margin:0;'),
  ];
  for (const [viewport, { template, maxWidth, slotInventory, slotContent }] of entries) {
    if (!template.sourceNodeId || !template.evidence.length || template.visibleFraction < .6 || ![template.rect.width, template.rect.height].every(value => Number.isFinite(value) && value > 0)) throw Error(`Catalog style lacks a complete visible measured template: ${viewport}`);
    if (maxWidth !== undefined && (!Number.isInteger(maxWidth) || maxWidth < 320 || maxWidth > 2560)) throw Error('Catalog style requires an actual bounded target breakpoint');
    if (new Set(template.slots.map(slot => slot.role)).size !== template.slots.length) throw Error('Catalog style roles must be unique');
    if (!['image', 'name'].every(role => template.slots.some(slot => slot.role === role && slot.visible))) throw Error(`Catalog style requires image and name source slots: ${viewport}`);
    if (slotInventory && (slotInventory.complete !== true || slotInventory.sourceNodeId !== template.sourceNodeId || !slotInventory.evidence.length || new Set(slotInventory.absentRoles).size !== slotInventory.absentRoles.length || slotInventory.absentRoles.some(role => !roles.includes(role) || template.slots.some(slot => slot.role === role && slot.visible)))) throw Error('Complete catalog role inventory contradicts the same owned source card');
    const hidden = roles.filter(role => template.slots.some(slot => slot.role === role && !slot.visible) || slotInventory?.absentRoles.includes(role));
    for (const role of roles) if (!template.slots.some(slot => slot.role === role) && !hidden.includes(role)) result.gaps.push({ viewport, role, reason: 'A missing source role needs explicit complete-card absence evidence before hiding native target data.' });
    const border = template.paint.borderWidth ?? 0;
    const rules = [rule('selector .product-wrapper', `width:${px(template.rect.width)};max-width:100%;height:${px(template.rect.height)};min-height:${px(template.rect.height)};border-style:solid;${paintCSS(template.paint)}`)];
    for (const slot of template.slots.filter(slot => slot.visible)) {
      if (!Object.values(slot.rect).every(Number.isFinite) || slot.rect.width <= 0 || slot.rect.height <= 0 || slot.rect.x < 0 || slot.rect.y < 0 || slot.rect.x + slot.rect.width > template.rect.width + 3 || slot.rect.y + slot.rect.height > template.rect.height + 3) throw Error(`Catalog style slot must fit its same-card measured frame: ${viewport}/${slot.role}`);
      // Native WooCommerce badges live inside the positioned image wrapper.
      // Their measured source coordinates remain card-relative in the contract.
      const image = template.slots.find(candidate => candidate.role === 'image');
      const originX = slot.role === 'badge' && image ? image.rect.x + (image.paint?.borderWidth ?? 0) : border;
      const originY = slot.role === 'badge' && image ? image.rect.y + (image.paint?.borderWidth ?? 0) : border;
      const content = slotContent?.[slot.role];
      if (content) {
        const { borderBox: box, margins: m } = content;
        if (!content.sourceNodeId.startsWith(`${template.sourceNodeId} > `) || !content.evidence.length || ![...Object.values(box), ...Object.values(m)].every(Number.isFinite) || Object.values(m).some(value => value < 0) || box.height <= 0 || box.width <= 0 || Math.abs(box.y - m.top - slot.rect.y) > 1 || Math.abs(box.height + m.top + m.bottom - slot.rect.height) > 1 || (content.inlineSize === 'fill-allocation' ? !content.allocationSourceNodeId?.startsWith(`${template.sourceNodeId} > `) || box.x - m.left < slot.rect.x - 1 || box.x + box.width + m.right > slot.rect.x + slot.rect.width + 1 : Math.abs(box.x - m.left - slot.rect.x) > 1 || Math.abs(box.width + m.left + m.right - slot.rect.width) > 1)) throw Error(`Catalog content border-box does not decompose its measured same-card allocation: ${viewport}/${slot.role}`);
      }
      const m = content?.margins;
      const width = content ? content.inlineSize === 'fill-allocation' ? slot.rect.width - m!.left - m!.right : content.borderBox.width : slot.rect.width;
      const height = content?.borderBox.height ?? slot.rect.height;
      const growth = content?.growth;
      let maxHeight = height;
      if (growth) {
        const occupied = template.slots.filter(other => other.visible && other.role !== slot.role && other.rect.y >= slot.rect.y + slot.rect.height - 1 && Math.min(other.rect.x + other.rect.width, slot.rect.x + slot.rect.width) > Math.max(other.rect.x, slot.rect.x));
        const boundary = Math.min(template.rect.height - border, ...occupied.map(other => other.rect.y));
        maxHeight = growth.maxAllocationBottom - slot.rect.y - (m?.top ?? 0) - (m?.bottom ?? 0);
        if (slot.role !== 'price' || !growth.reason.trim() || !growth.evidence.length || !Number.isFinite(growth.maxAllocationBottom) || growth.maxAllocationBottom > boundary + .1 || maxHeight < height) throw Error(`Dynamic catalog data cannot grow beyond evidenced unused same-card space: ${viewport}/${slot.role}`);
      }
      const position = `position:absolute;left:${px(slot.rect.x - originX)};top:${px(slot.rect.y - originY)};width:${px(width)};height:${growth ? 'auto' : px(height)};${content || slot.role === 'name' || slot.role === 'price' ? `max-height:${px(maxHeight)};` : ''}min-height:${growth ? px(height) : '0'};margin:${m ? `${px(m.top)} ${px(m.right)} ${px(m.bottom)} ${px(m.left)}` : '0'};padding:0;`;
      const overflow = slot.overflow ? `overflow:${safe(slot.overflow)};` : 'overflow:hidden;';
      rules.push(rule(`selector ${nativeRole[slot.role]}`, `${position}${overflow}display:block;${paintCSS(slot.paint)}`));
      if (slot.role === 'image') rules.push(rule('selector .product-image-link img', `width:100%;height:100%;max-width:100%;object-fit:${safe(slot.fit ?? 'contain')};object-position:${safe(slot.objectPosition ?? '50% 50%')};transform:none;`));
    }
    if (hidden.length) rules.push(rule(hidden.map(role => `selector ${nativeRole[role]}`).join(','), 'display:none;'));
    // This complete inventory also rules out auxiliary native overlay layers, not product facts.
    if (slotInventory) rules.push(rule('selector .hover-img,selector .wrapp-buttons,selector .wd-buttons,selector .wd-add-btn,selector .swatches-grid,selector .wd-product-sku,selector .wd-stock-status,selector .wd-product-cats,selector .wd-product-brands', 'display:none;'));
    // Emit only measured breakpoint changes. Besides smaller CSS, this prevents
    // three copied full skins from consuming the native widget's bounded budget.
    const css = rules.map(text => {
      const brace = text.indexOf('{'), selectors = text.slice(0, brace).split(','), declarations = text.slice(brace + 1, -1).split(';').filter(Boolean).map(declaration => { const index = declaration.indexOf(':'); return [declaration.slice(0, index), declaration.slice(index + 1)] as const; });
      return selectors.map(selector => {
        const previous = cascade.get(selector) ?? new Map<string, string>(), changed = declarations.filter(([property, value]) => previous.get(property) !== value);
        declarations.forEach(([property, value]) => previous.set(property, value)); cascade.set(selector, previous);
        return changed.length ? rule(selector, changed.map(([property, value]) => `${property}:${value};`).join('')) : '';
      }).join('');
    }).join(''); fragments.push(maxWidth === undefined ? css : css ? `@media(max-width:${maxWidth}px){${css}}` : '');
    result.receipts.push({ viewport, sourceNodeId: template.sourceNodeId, evidence: [...new Set([...template.evidence, ...(slotInventory?.evidence ?? []), ...Object.values(slotContent ?? {}).flatMap(content => content?.evidence ?? [])])], hiddenRoles: hidden, ...(slotContent ? { slotContent: structuredClone(slotContent) } : {}) });
  }
  result.css = fragments.join('\n'); validateScopedNativeCSS(result.css); return result;
}

const catalogClass = /\.(?:product-grid-item|product-wrapper|product-element-top|product-element-bottom|product-image-link|wd-entities-title|price|star-rating|product-labels?|hover-img|wrapp-buttons|wd-buttons|wd-add-btn|swatches-grid|wd-product-sku|wd-stock-status|wd-product-cats|wd-product-brands)(?![\w-])/;
/** Replace only native card rules. Preserve actual pagination/arrow CSS byte-for-byte where possible. */
export function replaceNativeCatalogCSS(previous: string, next: string): string {
  validateScopedNativeCSS(previous); validateScopedNativeCSS(next);
  const filter = (css: string): string => {
    let cursor = 0, output = '';
    const token = /@media\s*\(\s*(?:max|min)-width\s*:\s*\d+px\s*\)\s*\{|[^{}]+\{[^{}]*\}/g;
    for (;;) {
      token.lastIndex = cursor; const match = token.exec(css); if (!match) break;
      if (css.slice(cursor, match.index).trim()) throw Error('Unsupported prior native catalog stylesheet');
      const text = match[0].trim();
      if (text.trimStart().startsWith('@media')) {
        let depth = 1, end = token.lastIndex;
        for (; end < css.length && depth; end++) { if (css[end] === '{') depth++; if (css[end] === '}') depth--; }
        if (depth) throw Error('Unbalanced prior native stylesheet');
        const kept = filter(css.slice(token.lastIndex, end - 1)); if (kept.trim()) output += `${text}${kept}}\n`; cursor = end;
      } else {
        const brace = text.indexOf('{'), selectors = text.slice(0, brace).split(',').filter(selector => !catalogClass.test(selector));
        if (selectors.length) output += `${selectors.join(',')}${text.slice(brace)}\n`; cursor = token.lastIndex;
      }
    }
    if (css.slice(cursor).trim()) throw Error('Unsupported trailing native catalog stylesheet');
    return output;
  };
  const combined = `${filter(previous).trim()}\n${next}`.trim(); validateScopedNativeCSS(combined); return combined;
}

export function projectNativeCatalogStyle(node: NativeElement, views: Record<string, NativeCatalogStyleView>): { node: NativeElement; result: NativeCatalogStyleResult } {
  if (node.type !== 'wd_products' || node.settings.product_hover !== 'icons' || typeof node.settings.custom_css !== 'string') throw Error('Catalog style adapter requires the discovered native Woodmart icons product template and editable custom_css');
  const result = buildNativeCatalogStyle(views);
  return { node: { ...node, settings: { ...node.settings, custom_css: replaceNativeCatalogCSS(node.settings.custom_css, result.css) } }, result };
}
