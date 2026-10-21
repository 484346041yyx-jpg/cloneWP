import { createHash } from 'node:crypto';
import { validatePlan, validateRegisteredChildren, validateRegisteredSettings, type ElementorElement, type LegacyComposition, type ModelPlan } from '../planning/plan.js';
import type { ImportedAsset, LegacySchema } from '../wordpress/types.js';
import type { OriginalDesign, OriginalNode } from './types.js';
import { compileOriginalCarousel, compileOriginalHover, compileOriginalProducts, type OriginalCompileOptions, type OriginalNativeComponent } from './components.js';
import { isSafeOriginalHref, validateOriginalDesign } from './validate.js';
export type { OriginalCompileOptions, OriginalNativeComponent } from './components.js';

export type OriginalImportedAsset = ImportedAsset & { key: string };
export interface CompiledOriginal {
  composition: LegacyComposition;
  elementMap: Record<string, string>;
  sectionIds: string[];
  sections: Array<{ key: string; targetId: string; elementIds: string[] }>;
  plan: ModelPlan;
  nativeComponents: OriginalNativeComponent[];
  usedTypes: string[];
}

const nativeKind = { heading: 'heading', text: 'text-editor', image: 'image', button: 'button', accordion: 'accordion', products: 'wd_products', carousel: 'nested-carousel' } as const;
const styleKeys = new Set(['direction', 'tabletDirection', 'mobileDirection', 'width', 'tabletWidth', 'mobileWidth', 'boxed', 'justify', 'tabletJustify', 'mobileJustify', 'alignItems', 'tabletAlignItems', 'mobileAlignItems', 'align', 'tabletAlign', 'mobileAlign', 'gap', 'tabletGap', 'mobileGap', 'padding', 'tabletPadding', 'mobilePadding', 'margin', 'tabletMargin', 'mobileMargin', 'background', 'color', 'borderColor', 'borderWidth', 'radius', 'fontSize', 'tabletFontSize', 'mobileFontSize', 'weight', 'lineHeight', 'imageHeight', 'tabletImageHeight', 'mobileImageHeight', 'minHeight', 'tabletMinHeight', 'mobileMinHeight', 'wrap', 'tabletWrap', 'mobileWrap']);
const escapeText = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const paragraphs = (value: string): string => value.split(/\n\s*\n/).map(part => `<p>${escapeText(part).replace(/\n/g, '<br>')}</p>`).join('');
const dimension = (values: number[]): Record<string, unknown> => ({ unit: 'px', top: String(values[0]), right: String(values[1]), bottom: String(values[2]), left: String(values[3]), isLinked: values.every(value => value === values[0]) });
const slider = (size: number, unit = 'px'): Record<string, unknown> => ({ unit, size, sizes: [] });
const idFor = (key: string): string => createHash('sha256').update(`clonewp-original:${key}`).digest('hex').slice(0, 7);

/** Compile authored design intent against the target's actual registered native controls.
 * There is no source DOM, inferred foreign layout, model-generated settings, or HTML page fallback.
 */
function compileDocument(design: OriginalDesign, schemas: Record<string, LegacySchema>, assets: OriginalImportedAsset[], options: OriginalCompileOptions, symbolic = false): CompiledOriginal {
  if (design.workflow !== undefined && design.workflow !== 'original-design') throw new Error('Original compilation requires the original-design workflow');
  if (design.version !== 1 || !design.title?.trim() || !design.brand?.trim() || !Array.isArray(design.sections) || !design.sections.length) throw new Error('Invalid original website design');
  if (!Number.isFinite(design.tokens.contentWidth) || design.tokens.contentWidth <= 0 || !design.tokens.font?.trim()) throw new Error('Original design needs explicit content width and font');
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(design.language)) throw new Error('Original design language must be an explicit language tag');
  if (design.sections.length > 35) throw new Error('Original design has too many sections');
  const media = new Map<string, OriginalImportedAsset>();
  for (const asset of assets) {
    if (!asset.key || media.has(asset.key)) throw new Error(`Duplicate or missing original media key: ${asset.key}`);
    if (!Number.isInteger(asset.attachmentId) || asset.attachmentId < 1 || !/^https?:\/\//.test(asset.url)) throw new Error(`Invalid imported original media: ${asset.key}`);
    media.set(asset.key, asset);
  }
  const declaredAssetKeys = new Set<string>();
  for (const asset of design.assets) {
    if (!asset.key || declaredAssetKeys.has(asset.key)) throw new Error(`Duplicate or missing authored asset key: ${asset.key}`);
    declaredAssetKeys.add(asset.key);
  }
  const keys = new Set<string>(), ids = new Set<string>(), anchors = new Set<string>(), usedTypes = new Set<string>();
  const nativeComponents: OriginalNativeComponent[] = [];
  const anchorLinks: Array<{ key: string; anchor: string }> = [];
  const mappings: ModelPlan['mappings'] = [];
  const sections: CompiledOriginal['sections'] = [];
  let h1Count = 0;

  const compileNode = (node: OriginalNode, depth: number, inheritedColor?: string, inheritedAlign?: 'left' | 'center' | 'right', parentDirection?: 'row' | 'column', parentMobileDirection?: 'row' | 'column', parentTabletDirection?: 'row' | 'column', inheritedTabletAlign?: 'left' | 'center' | 'right', inheritedMobileAlign?: 'left' | 'center' | 'right'): ElementorElement => {
    if (!node.key || keys.has(node.key) || !/^[a-zA-Z][a-zA-Z0-9_-]{0,100}$/.test(node.key)) throw new Error(`Duplicate or invalid original node key: ${node.key}`);
    if (depth > 25 || keys.size >= 700) throw new Error('Original design tree exceeds native limits');
    keys.add(node.key);
    const id = idFor(node.key);
    if (ids.has(id)) throw new Error('Original design native ID collision');
    ids.add(id); mappings.push({ sourceId: node.key, targetId: id });
    if (node.href && !isSafeOriginalHref(node.href)) throw new Error(`Unsupported original link protocol or destination: ${node.key}`);
    if (node.href?.startsWith('#')) anchorLinks.push({ key: node.key, anchor: node.href.slice(1) });
    const kind = node.kind;
    const type = kind === 'container' ? 'container' : nativeKind[kind];
    if (!type || !schemas[type]?.controls || !Object.keys(schemas[type].controls).length) throw new Error(`Undiscovered native original component: ${String(kind)}`);
    usedTypes.add(type);
    if (node.href && !['heading', 'image', 'button'].includes(kind)) throw new Error(`Original link is not supported by this node: ${node.key}`);
    if (kind !== 'products' && (node.productQuery || node.productDisplay) || kind !== 'carousel' && node.carousel) throw new Error(`Original component configuration belongs to its matching node: ${node.key}`);
    const settings: Record<string, unknown> = {};
    const set = (name: string, value: unknown) => {
      if (!schemas[type].controls[name]) throw new Error(`Undiscovered setting ${type}.${name}; original design cannot be approximated silently`);
      settings[name] = value;
    };
    const style = node.style ?? {};
    // Responsive intent must bind to real controls on this node, rather than become a schema-only promise.
    for (const name of ['tabletDirection', 'tabletWrap', 'tabletJustify', 'mobileJustify', 'tabletAlignItems', 'mobileAlignItems', 'tabletGap', 'mobileGap', 'tabletMinHeight', 'mobileMinHeight'] as const) {
      if (style[name] !== undefined && kind !== 'container') throw new Error(`Unsupported original responsive container setting: ${node.key}.${name}`);
    }
    if (style.tabletFontSize !== undefined && !['heading', 'text', 'button', 'accordion'].includes(kind)) throw new Error(`Unsupported original responsive typography setting: ${node.key}.tabletFontSize`);
    if (style.tabletImageHeight !== undefined && kind !== 'image') throw new Error(`Unsupported original responsive image setting: ${node.key}.tabletImageHeight`);
    for (const [name, value] of Object.entries(style)) {
      if (!styleKeys.has(name)) throw new Error(`Unsupported original style: ${node.key}.${name}`);
      if (value === undefined) continue;
      if (/^(?:(?:tablet|mobile)?(?:Width|Gap|FontSize|ImageHeight|MinHeight)|width|gap|fontSize|imageHeight|minHeight|borderWidth|radius|lineHeight)$/.test(name) && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error(`Invalid original style number: ${node.key}.${name}`);
      if (['padding', 'tabletPadding', 'mobilePadding', 'margin', 'tabletMargin', 'mobileMargin'].includes(name) && (!Array.isArray(value) || value.length !== 4 || value.some(n => typeof n !== 'number' || !Number.isFinite(n) || (!/margin/i.test(name) && n < 0)))) throw new Error(`Original ${name} must have four finite sides: ${node.key}`);
      if (['background', 'color', 'borderColor'].includes(name) && (typeof value !== 'string' || !/^(?:#[0-9a-f]{3,8}|transparent|rgba?\([\d\s.,%]+\))$/i.test(value))) throw new Error(`Invalid original color: ${node.key}.${name}`);
    }
    if (node.anchor) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(node.anchor) || anchors.has(node.anchor)) throw new Error(`Duplicate or invalid original anchor: ${node.anchor}`);
      anchors.add(node.anchor); set('_element_id', node.anchor);
    }
    const color = style.color ?? inheritedColor ?? design.tokens.colors.ink ?? '#203C31';
    const typography = (prefix: string, fontSize: number, weight: number, lineHeight: number) => {
      set(`${prefix}_typography`, 'custom');
      set(`${prefix}_font_family`, design.tokens.font);
      set(`${prefix}_font_size`, slider(fontSize));
      if (style.tabletFontSize !== undefined) set(`${prefix}_font_size_tablet`, slider(style.tabletFontSize));
      set(`${prefix}_font_size_mobile`, slider(style.mobileFontSize ?? fontSize));
      set(`${prefix}_font_weight`, String(weight));
      set(`${prefix}_line_height`, slider(lineHeight, 'em'));
    };
    const border = (prefix: string) => {
      if (style.borderColor !== undefined || style.borderWidth !== undefined) {
        set(`${prefix}border_border`, 'solid');
        set(`${prefix}border_width`, dimension(Array(4).fill(style.borderWidth ?? 1)));
        if (style.borderColor !== undefined) set(`${prefix}border_color`, style.borderColor);
      }
      if (style.radius !== undefined) set(`${prefix}border_radius`, dimension(Array(4).fill(style.radius)));
    };
    const background = (prefix: string) => { if (style.background !== undefined) { set(`${prefix}background_background`, 'classic'); set(`${prefix}background_color`, style.background); } };
    const link = () => ({ url: node.href ?? '#', is_external: '', nofollow: '', custom_attributes: '' });

    if (kind === 'container') {
      const boxed = style.boxed ?? depth === 0;
      set('container_type', 'flex'); set('content_width', boxed ? 'boxed' : 'full');
      if (boxed) set('boxed_width', slider(design.tokens.contentWidth));
      else {
        // A row's intrinsic navigation/brand group must not consume a synthetic 100% width.
        set('width', style.width !== undefined ? slider(style.width, '%') : parentDirection === 'row' ? { unit: 'custom', size: 'auto', sizes: [] } : slider(100, '%'));
        set('width_mobile', style.mobileWidth !== undefined ? slider(style.mobileWidth, '%') : style.width === undefined && parentMobileDirection === 'row' ? { unit: 'custom', size: 'auto', sizes: [] } : slider(100, '%'));
        if (parentTabletDirection !== undefined && parentTabletDirection !== parentDirection && style.tabletWidth === undefined) set('width_tablet', style.width === undefined && parentTabletDirection === 'row' ? { unit: 'custom', size: 'auto', sizes: [] } : slider(style.width ?? 100, '%'));
      }
      const direction = style.direction ?? 'column';
      set('flex_direction', direction);
      if (style.tabletDirection !== undefined) set('flex_direction_tablet', style.tabletDirection);
      set('flex_direction_mobile', style.mobileDirection ?? 'column');
      set('flex_justify_content', style.justify ?? 'flex-start');
      set('flex_align_items', style.alignItems ?? 'stretch');
      if (style.tabletJustify !== undefined) set('flex_justify_content_tablet', style.tabletJustify);
      if (style.mobileJustify !== undefined) set('flex_justify_content_mobile', style.mobileJustify);
      if (style.tabletAlignItems !== undefined) set('flex_align_items_tablet', style.tabletAlignItems);
      if (style.mobileAlignItems !== undefined) set('flex_align_items_mobile', style.mobileAlignItems);
      set('flex_gap', { unit: 'px', column: String(style.gap ?? 20), row: String(style.gap ?? 20), isLinked: true });
      if (style.tabletGap !== undefined) set('flex_gap_tablet', { unit: 'px', column: String(style.tabletGap), row: String(style.tabletGap), isLinked: true });
      if (style.mobileGap !== undefined) set('flex_gap_mobile', { unit: 'px', column: String(style.mobileGap), row: String(style.mobileGap), isLinked: true });
      set('flex_wrap', (style as { wrap?: string }).wrap ?? 'nowrap');
      set('flex_wrap_mobile', (style as { mobileWrap?: string }).mobileWrap ?? 'nowrap');
      if (style.tabletWrap !== undefined) set('flex_wrap_tablet', style.tabletWrap);
      set('padding', dimension(style.padding ?? [0, 0, 0, 0]));
      if (style.mobilePadding) set('padding_mobile', dimension(style.mobilePadding));
      if (style.tabletPadding) set('padding_tablet', dimension(style.tabletPadding));
      if (style.margin) set('margin', dimension(style.margin));
      if (style.tabletMargin) set('margin_tablet', dimension(style.tabletMargin));
      if (style.mobileMargin) set('margin_mobile', dimension(style.mobileMargin));
      if (style.minHeight !== undefined) set('min_height', slider(style.minHeight));
      if (style.tabletMinHeight !== undefined) set('min_height_tablet', slider(style.tabletMinHeight));
      if (style.mobileMinHeight !== undefined) set('min_height_mobile', slider(style.mobileMinHeight));
      if (style.tabletWidth !== undefined) { if (boxed) throw new Error(`Original boxed section width uses its authored content width: ${node.key}`); set('width_tablet', slider(style.tabletWidth, '%')); }
      if (depth === 0) {
        set('html_tag', node.key === 'header' ? 'header' : node.key === 'footer' ? 'footer' : 'section');
        set('_attributes', `lang|${design.language}`);
      }
      background(''); border('');
      compileOriginalHover(node, schemas[type], settings);
      if (!Array.isArray(node.children) || !node.children.length) throw new Error(`Original container has no editable content: ${node.key}`);
      return { id, elType: 'container', settings, isInner: depth > 0, elements: node.children.map(child => compileNode(child, depth + 1, color, style.align ?? inheritedAlign, direction, style.mobileDirection ?? 'column', style.tabletDirection ?? direction, style.tabletAlign ?? inheritedTabletAlign, style.mobileAlign ?? inheritedMobileAlign)) };
    }
    if (kind !== 'carousel' && node.children?.length) throw new Error(`Original leaf cannot own native children: ${node.key}`);
    if (style.margin) set('_margin', dimension(style.margin));
    if (style.tabletMargin) set('_margin_tablet', dimension(style.tabletMargin));
    if (style.mobileMargin) set('_margin_mobile', dimension(style.mobileMargin));
    if (style.width !== undefined) {
      set('_element_width', 'initial'); set('_element_custom_width', slider(style.width, '%'));
      set('_element_width_mobile', 'initial'); set('_element_custom_width_mobile', slider(style.mobileWidth ?? style.width, '%'));
    } else if (kind === 'button' || parentDirection === 'row') {
      set('_element_width', 'auto');
      set('_element_width_mobile', parentMobileDirection === 'row' || kind === 'button' ? 'auto' : 'inherit');
    }
    if (style.tabletWidth !== undefined) { set('_element_width_tablet', 'initial'); set('_element_custom_width_tablet', slider(style.tabletWidth, '%')); }
    if (style.mobileWidth !== undefined && style.width === undefined) { set('_element_width_mobile', 'initial'); set('_element_custom_width_mobile', slider(style.mobileWidth, '%')); }
    if (!['accordion', 'products', 'carousel'].includes(kind) && (style.align ?? inheritedAlign)) set('align', style.align ?? inheritedAlign);
    else if (['products', 'carousel'].includes(kind) && style.align !== undefined) set('align', style.align);
    if (!['accordion', 'products', 'carousel'].includes(kind)) {
      if (style.tabletAlign ?? inheritedTabletAlign) set('align_tablet', style.tabletAlign ?? inheritedTabletAlign);
      if (style.mobileAlign ?? inheritedMobileAlign) set('align_mobile', style.mobileAlign ?? inheritedMobileAlign);
    } else {
      if (style.tabletAlign !== undefined) set('align_tablet', style.tabletAlign);
      if (style.mobileAlign !== undefined) set('align_mobile', style.mobileAlign);
    }
    if (kind === 'heading') {
      if (!node.text?.trim()) throw new Error(`Original heading is empty: ${node.key}`);
      const headingTag = (node as OriginalNode & { headingTag?: string }).headingTag ?? (node.key === 'hero-title' ? 'h1' : 'h2');
      if (headingTag === 'h1' && ++h1Count > 1) throw new Error('Original homepage must have a single H1');
      set('title', escapeText(node.text).replace(/\n/g, '<br>')); set('header_size', headingTag); set('title_color', color);
      if (node.href) set('link', link());
      typography('typography', style.fontSize ?? 32, style.weight ?? 700, style.lineHeight ?? 1.2);
    } else if (kind === 'text') {
      if (!node.text?.trim()) throw new Error(`Original text is empty: ${node.key}`);
      set('editor', paragraphs(node.text)); set('text_color', color);
      typography('typography', style.fontSize ?? 16, style.weight ?? 400, style.lineHeight ?? 1.65);
    } else if (kind === 'image') {
      if (!node.asset || !declaredAssetKeys.has(node.asset)) throw new Error(`Original image references an undeclared asset: ${node.key}`);
      const asset = media.get(node.asset);
      if (!symbolic && !asset) throw new Error(`Original image needs an imported native media attachment: ${node.asset}`);
      set('image', symbolic ? { $asset: node.asset } : { id: asset!.attachmentId, url: asset!.url }); set('image_size', 'full');
      // Authored image width describes the flex item; the image fills that independently editable widget.
      set('width', slider(100, '%')); set('space', slider(100, '%'));
      if (style.imageHeight !== undefined) { set('height', slider(style.imageHeight)); set('object-fit', 'cover'); set('object-position', 'center center'); }
      if (style.mobileImageHeight !== undefined) { set('height_mobile', slider(style.mobileImageHeight)); set('object-fit_mobile', 'cover'); }
      if (style.tabletImageHeight !== undefined) { set('height_tablet', slider(style.tabletImageHeight)); set('object-fit_tablet', 'cover'); }
      if (style.radius !== undefined) set('image_border_radius', dimension(Array(4).fill(style.radius)));
      if (node.href) { set('link_to', 'custom'); set('link', link()); }
    } else if (kind === 'button') {
      if (!node.text?.trim() || !node.href) throw new Error(`Original button needs text and an explicit destination: ${node.key}`);
      set('text', node.text); set('link', link()); set('button_text_color', style.color ?? '#FFFFFF');
      set('background_background', 'classic'); set('background_color', style.background ?? '#203C31');
      typography('typography', style.fontSize ?? 14, style.weight ?? 700, style.lineHeight ?? 1.2);
      set('text_padding', dimension(style.padding ?? [15, 24, 15, 24]));
      if (style.mobilePadding) set('text_padding_mobile', dimension(style.mobilePadding));
      if (style.tabletPadding) set('text_padding_tablet', dimension(style.tabletPadding));
      border('');
      compileOriginalHover(node, schemas[type], settings);
      return { id, elType: 'widget', widgetType: type, settings, isInner: false, elements: [] };
    } else if (kind === 'accordion') {
      if (!node.items?.length || node.items.length > 30 || node.items.some(item => !item.title?.trim() || !item.content?.trim())) throw new Error(`Original accordion needs complete editable questions and answers: ${node.key}`);
      set('tabs', node.items.map((item, index) => ({ _id: idFor(`${node.key}-item-${index}`), tab_title: item.title, tab_content: paragraphs(item.content) })));
      set('title_html_tag', 'h3'); set('title_color', color); set('tab_active_color', color);
      set('content_color', color); set('border_width', slider(style.borderWidth ?? 1));
      set('border_color', style.borderColor ?? '#E1E8DE');
      set('title_background', style.background ?? '#FFFFFF'); set('content_background_color', style.background ?? '#FFFFFF');
      set('title_padding', dimension(style.padding ?? [22, 24, 22, 24])); set('content_padding', dimension([4, 24, 24, 24]));
      typography('title_typography', style.fontSize ?? 18, style.weight ?? 700, style.lineHeight ?? 1.4);
      // Answer typography remains independent native settings rather than inheriting large question text.
      const answerFont = style.fontSize ? Math.min(style.fontSize, 16) : 16;
      typography('content_typography', answerFont, 400, 1.65);
      if (style.tabletPadding) set('title_padding_tablet', dimension(style.tabletPadding));
      if (style.mobilePadding) set('title_padding_mobile', dimension(style.mobilePadding));
    } else if (kind === 'products' || kind === 'carousel') {
      for (const name of ['fontSize', 'tabletFontSize', 'mobileFontSize', 'weight', 'lineHeight', 'color', 'imageHeight', 'tabletImageHeight', 'mobileImageHeight', 'direction', 'tabletDirection', 'mobileDirection', 'wrap', 'tabletWrap', 'mobileWrap', 'gap', 'tabletGap', 'mobileGap', 'boxed', 'justify', 'alignItems', 'tabletJustify', 'mobileJustify', 'tabletAlignItems', 'mobileAlignItems', 'minHeight', 'tabletMinHeight', 'mobileMinHeight'] as const) if (style[name] !== undefined) throw new Error(`Unsupported original ${kind} style control: ${node.key}.${name}`);
      const component = kind === 'products' ? compileOriginalProducts(node, id, schemas[type], options) : compileOriginalCarousel(node, id, schemas[type], idFor);
      for (const [name, value] of Object.entries(component.settings)) set(name, value);
      component.settings = settings;
      nativeComponents.push(component);
    }
    if (style.padding && kind !== 'accordion') set('_padding', dimension(style.padding));
    if (style.mobilePadding && kind !== 'accordion') set('_padding_mobile', dimension(style.mobilePadding));
    if (style.tabletPadding && kind !== 'accordion') set('_padding_tablet', dimension(style.tabletPadding));
    if (kind !== 'accordion') background('_');
    if (kind !== 'image') border('_');
    compileOriginalHover(node, schemas[type], settings);
    return { id, elType: 'widget', widgetType: type, settings, isInner: false, elements: kind === 'carousel' ? node.children!.map(child => compileNode(child, depth + 1, color, style.align ?? inheritedAlign, 'row', 'row', 'row', style.tabletAlign ?? inheritedTabletAlign, style.mobileAlign ?? inheritedMobileAlign)) : [] };
  };

  const elements = design.sections.map(section => {
    if (section.kind !== 'container') throw new Error('Every original homepage section must be a native top-level container');
    const element = compileNode(section, 0);
    const elementIds: string[] = [];
    const collect = (node: ElementorElement) => { elementIds.push(node.id); node.elements.forEach(collect); };
    collect(element); sections.push({ key: section.key, targetId: element.id, elementIds });
    return element;
  });
  const composition: LegacyComposition = { elements, pageSettings: { hide_title: 'yes' } };
  for (const link of anchorLinks) if (!anchors.has(link.anchor)) throw new Error(`Original link has no authored destination: ${link.key} -> #${link.anchor}`);
  const plan: ModelPlan = { title: design.title, mode: 'legacy-verified', compositionJson: JSON.stringify(composition), mappings, unsupported: [], rationale: `Original ${design.brand} design compiled deterministically into registered editable native Elementor controls. Mapping keys are authored design identifiers, with no foreign page or capture evidence.` };
  // Reuse the native schema/content safety validator. Authored keys are identities, not fabricated source facts.
  const approvedCustomCSS = new Set(nativeComponents.flatMap(component => typeof component.settings.custom_css === 'string' ? [component.settings.custom_css] : []));
  if (symbolic) {
    const inspect = (value: unknown, key = ''): void => {
      if (typeof value === 'string' && (/<\s*(script|style|link|meta|base|iframe|object|embed|form|input|textarea|select|button|img|svg|video|audio|source|canvas)\b|\son\w+\s*=|(?:javascript|vbscript):/i.test(value) || key === 'custom_css' && !approvedCustomCSS.has(value))) throw new Error('Executable content or unsupported CSS is forbidden in original preflight');
      if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) inspect(child, key);
    };
    inspect(composition);
    const visit = (element: ElementorElement): void => {
      const type = element.widgetType ?? 'container';
      validateRegisteredSettings(type, element.settings, schemas[type], { symbolicAssets: declaredAssetKeys });
      validateRegisteredChildren(type, element.settings, element.elements.map(child => child.widgetType ?? 'container'), schemas[type]);
      element.elements.forEach(visit);
    };
    elements.forEach(visit);
    return { composition, elementMap: Object.fromEntries(mappings.map(mapping => [mapping.sourceId, mapping.targetId])), sectionIds: sections.map(section => section.targetId), sections, plan, nativeComponents, usedTypes: [...usedTypes] };
  }
  const validated = validatePlan(plan, { mode: 'legacy-verified', maxElements: 700, widgetSchemas: schemas, allowedMedia: assets, approvedCustomCSS });
  return { composition: validated.composition as LegacyComposition, elementMap: validated.elementMap, sectionIds: sections.map(section => section.targetId), sections, plan: validated.plan, nativeComponents, usedTypes: [...usedTypes] };
}

export interface OriginalPreflight { version: 1; passed: true; usedTypes: string[]; nativeElements: number; registeredSettings: number; nativeComponents: OriginalNativeComponent[] }
/** Pure read-only planning. Symbolic media stay private and never become writeable composition output. */
export function preflightOriginal(design: OriginalDesign, schemas: Record<string, LegacySchema>, options: OriginalCompileOptions = {}): OriginalPreflight {
  const compiled = compileDocument(validateOriginalDesign(design), schemas, [], options, true);
  let registeredSettings = 0;
  const visit = (element: ElementorElement): void => { registeredSettings += Object.keys(element.settings).length; element.elements.forEach(visit); };
  compiled.composition.elements.forEach(visit);
  return { version: 1, passed: true, usedTypes: compiled.usedTypes, nativeElements: Object.keys(compiled.elementMap).length, registeredSettings, nativeComponents: compiled.nativeComponents };
}
export function compileOriginal(design: OriginalDesign, schemas: Record<string, LegacySchema>, assets: OriginalImportedAsset[], options: OriginalCompileOptions = {}): CompiledOriginal {
  const compiled = compileDocument(design, schemas, assets, options);
  validateOriginalDesign(design);
  return compiled;
}
