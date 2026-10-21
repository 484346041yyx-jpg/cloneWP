import { validateRegisteredChildren, validateRegisteredSettings } from '../planning/plan.js';
import { buildNativeFractionCSS, NATIVE_FRACTION_ADAPTER } from '../fidelity/native-fraction.js';
import { validateScopedNativeCSS } from '../fidelity/scoped-css.js';
import type { LegacySchema, TargetCatalogSnapshot } from '../wordpress/types.js';
import type { OriginalCarousel, OriginalHover, OriginalNode, OriginalProductDisplay, OriginalProductQuery } from './types.js';

export interface OriginalCompileOptions { catalog?: TargetCatalogSnapshot; targetOrigin?: string }
interface ComponentIdentity { key: string; nativeId: string; settings: Record<string, unknown> }
export interface OriginalProductsComponent extends ComponentIdentity {
  kind: 'products'; type: 'wd_products'; productIds: number[];
  query: OriginalProductQuery; display: OriginalProductDisplay;
  catalog: { targetOrigin: string; readAt: string; evidence: string[]; products: TargetCatalogSnapshot['products'] };
  styleAdapter?: typeof NATIVE_FRACTION_ADAPTER;
}
export interface OriginalCarouselComponent extends ComponentIdentity {
  kind: 'carousel'; type: 'nested-carousel'; carousel: OriginalCarousel; slideKeys: string[]; slideIds: string[];
}
export type OriginalNativeComponent = OriginalProductsComponent | OriginalCarouselComponent;

const slider = (size: number) => ({ unit: 'px', size, sizes: [] });
const dimension = (size: number) => ({ unit: 'px', top: String(size), right: String(size), bottom: String(size), left: String(size), isLinked: true });
function control(schema: LegacySchema, key: string, type?: string) {
  const found = schema.controls[key];
  if (!found || type && found.type !== type) throw new Error(`Undiscovered native original setting ${schema.type}.${key}${type ? ` (${type})` : ''}`);
  return found;
}
function switcher(schema: LegacySchema, key: string, on: boolean, off: 'no' | '' = 'no'): string {
  const found = control(schema, key, 'switcher'), value = on ? 'yes' : off;
  if (found.options && value && !Object.hasOwn(found.options, value)) throw new Error(`Unsupported native switcher ${schema.type}.${key}.${value}`);
  return value;
}
function publicURL(value: unknown): URL | undefined {
  if (typeof value !== 'string') return;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : undefined; } catch { return; }
}
/** Catalog evidence is supplied by the read-only target client, never manufactured during compilation. */
export function requireOriginalCatalog(options: OriginalCompileOptions): TargetCatalogSnapshot {
  const catalog = options.catalog, origin = publicURL(options.targetOrigin)?.origin;
  if (!origin || options.targetOrigin !== origin || !catalog || catalog.version !== 1 || catalog.targetOrigin !== origin ||
      !Number.isFinite(Date.parse(catalog.readAt)) || !Array.isArray(catalog.evidence) || !catalog.evidence.length || catalog.evidence.some(item => typeof item !== 'string' || !item.trim()) ||
      !catalog.query || catalog.query.status !== 'publish' || catalog.query.visibility !== 'visible' || catalog.query.orderby !== 'date' || catalog.query.order !== 'DESC' ||
      !Number.isInteger(catalog.query.limit) || catalog.query.limit < 1 || catalog.query.limit > 200 || !Array.isArray(catalog.products) || !catalog.products.length || catalog.products.length > catalog.query.limit) {
    throw new Error('Original products require read-only target WooCommerce catalog evidence for the configured target origin');
  }
  const ids = new Set<number>();
  for (const product of catalog.products) {
    if (!Number.isSafeInteger(product.id) || product.id < 1 || ids.has(product.id) || typeof product.name !== 'string' || !product.name.trim() ||
        publicURL(product.permalink)?.origin !== origin || !publicURL(product.imageUrl) || typeof product.priceText !== 'string' || !Array.isArray(product.imageVariants) || product.imageVariants.some(url => !publicURL(url))) {
      throw new Error('Original products contain invalid or foreign target catalog identities');
    }
    ids.add(product.id);
  }
  return catalog;
}

export function compileOriginalProducts(node: OriginalNode, nativeId: string, schema: LegacySchema, options: OriginalCompileOptions): OriginalProductsComponent {
  if (schema.type !== 'wd_products' || schema.class !== 'XTS\\Elementor\\Products' || control(schema, 'post_type', 'select').options?.product === undefined) throw new Error('Original products require the actual registered Woodmart native product component');
  const catalog = requireOriginalCatalog(options), query = node.productQuery, display = node.productDisplay;
  if (!query || !display || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200) throw new Error(`Original products require a bounded target query and native display: ${node.key}`);
  if (!['grid', 'carousel'].includes(display.layout)) throw new Error('Unsupported original native product layout');
  if (query.ids && (query.ids.length !== query.limit || new Set(query.ids).size !== query.ids.length || query.ids.some(id => !Number.isSafeInteger(id) || id < 1))) throw new Error('Explicit original product IDs must be unique and match limit');
  // IDs specify membership. The actual catalog's date/ID order supplies the
  // deterministic native display order, including records with identical dates.
  const selected = query.ids ? catalog.products.filter(product => query.ids!.includes(product.id)) : catalog.products.slice(0, query.limit);
  if (selected.length !== query.limit || selected.some(product => !product)) throw new Error('Original product query cannot be fulfilled by the actual target catalog');
  const products = selected as TargetCatalogSnapshot['products'];
  // Freeze the observed selection even for limit-only input. Date ties can be ordered
  // differently by WC's data store and the widget's WP_Query. The installed native
  // date order delegates to WC's date/ID rule; include alone inherits site sorting.
  if (!control(schema, 'post_type', 'select').options?.ids || control(schema, 'include').type !== 'wd_autocomplete') throw new Error('Original products require the registered Woodmart ID/include query control');
  control(schema, 'orderby', 'select');
  const settings: Record<string, unknown> = { post_type: 'ids', include: products.map(product => product.id), orderby: 'date', items_per_page: query.limit, layout: display.layout };
  // This registered widget has no per-widget price/rating switch. Do not replace products with copied cards or invent theme-global settings.
  if (display.showPrice !== undefined || display.showRating !== undefined) throw new Error('Native Woodmart product price/rating visibility controls are unsupported by this adapter; omit showPrice/showRating to retain native target rendering');
  const prefix = display.layout === 'carousel' ? 'slides_per_view' : 'columns';
  for (const [suffix, count] of [['', display.columns], ['_tablet', display.tabletColumns ?? display.columns], ['_mobile', display.mobileColumns ?? 1]] as const) {
    if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error(`Invalid original native product column count: ${node.key}`);
    control(schema, `${prefix}${suffix}`, 'slider'); settings[`${prefix}${suffix}`] = slider(count);
  }
  if (display.hoverStyle !== undefined) { control(schema, 'product_hover', 'select'); settings.product_hover = display.hoverStyle; }
  let styleAdapter: OriginalProductsComponent['styleAdapter'];
  if (display.layout === 'carousel') {
    settings.hide_prev_next_buttons = switcher(schema, 'hide_prev_next_buttons', !(display.arrows ?? true));
    const pagination = display.pagination ?? 'dots';
    if (!['none', 'dots', 'fraction'].includes(pagination)) throw new Error('Unsupported original product pagination');
    for (const suffix of ['', '_tablet', '_mobile']) settings[`hide_pagination_control${suffix}`] = switcher(schema, `hide_pagination_control${suffix}`, pagination === 'none');
    if (pagination !== 'none') settings.dynamic_pagination_control = switcher(schema, 'dynamic_pagination_control', false);
    settings.autoplay = switcher(schema, 'autoplay', display.autoplay ?? false);
    settings.wrap = switcher(schema, 'wrap', display.loop ?? false);
    settings.scroll_per_page = switcher(schema, 'scroll_per_page', display.scrollPerPage ?? false);
    if (display.autoplaySpeed !== undefined) {
      if (!display.autoplay || !Number.isInteger(display.autoplaySpeed) || display.autoplaySpeed < 100 || display.autoplaySpeed > 120000) throw new Error('Original native product speed requires enabled autoplay and finite bounded milliseconds');
      control(schema, 'speed', 'number'); settings.speed = display.autoplaySpeed;
    }
    if (pagination === 'fraction') {
      control(schema, 'custom_css', 'code');
      // Absolute zero-size native bullets need a real layout allocation for their
      // generated fraction. Keep the shared exact counter binding intact.
      settings.custom_css = `${buildNativeFractionCSS()}\nselector .wd-nav-pagin-wrap{min-height:24px;height:24px;width:100%;}`;
      validateScopedNativeCSS(String(settings.custom_css)); styleAdapter = NATIVE_FRACTION_ADAPTER;
    }
  } else if ([display.arrows, display.pagination, display.autoplay, display.autoplaySpeed, display.loop, display.scrollPerPage].some(value => value !== undefined)) throw new Error('Original product interaction controls require native carousel layout');
  validateRegisteredSettings('wd_products', settings, schema);
  return { kind: 'products', key: node.key, nativeId, type: 'wd_products', settings, productIds: products.map(product => product.id), query: structuredClone(query), display: structuredClone(display),
    catalog: { targetOrigin: catalog.targetOrigin, readAt: catalog.readAt, evidence: [...catalog.evidence], products: structuredClone(products) }, ...(styleAdapter ? { styleAdapter } : {}) };
}

export function compileOriginalCarousel(node: OriginalNode, nativeId: string, schema: LegacySchema, idFor: (key: string) => string): OriginalCarouselComponent {
  if (schema.type !== 'nested-carousel' || schema.class !== 'ElementorPro\\Modules\\NestedCarousel\\Widgets\\Nested_Carousel' || !schema.nativeChildren || schema.nativeChildren.repeaterKey !== 'carousel_items' || schema.nativeChildren.titleSettingKey !== 'slide_title') throw new Error('Original carousel requires the registered Elementor nested carousel and native child/repeater proof');
  const value = node.carousel, children = node.children;
  if (!value || !children?.length || children.some(child => child.kind !== 'container')) throw new Error(`Original carousel needs settings and native container slides: ${node.key}`);
  control(schema, 'carousel_items', 'nested-elements-repeater');
  const settings: Record<string, unknown> = { carousel_name: node.text ?? node.key,
    carousel_items: children.map((child, index) => ({ _id: idFor(`${node.key}-slide-${index}`), slide_title: child.text ?? `Slide ${index + 1}` })) };
  for (const [key, count] of [['slides_to_show', value.slidesToShow], ['slides_to_show_tablet', value.tabletSlidesToShow ?? value.slidesToShow], ['slides_to_show_mobile', value.mobileSlidesToShow ?? 1], ['slides_to_scroll', value.slidesToScroll ?? 1]] as const) {
    if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error(`Invalid original native slide count: ${node.key}`);
    control(schema, key, 'select'); settings[key] = String(count);
  }
  settings.arrows = switcher(schema, 'arrows', value.arrows, '');
  if (!['none', 'dots', 'fraction'].includes(value.pagination)) throw new Error('Unsupported original carousel pagination');
  settings.pagination = value.pagination === 'none' ? '' : value.pagination === 'dots' ? 'bullets' : 'fraction';
  settings.autoplay = switcher(schema, 'autoplay', value.autoplay);
  settings.infinite = switcher(schema, 'infinite', value.loop);
  if (!value.autoplay && [value.autoplaySpeed, value.pauseOnHover, value.pauseOnInteraction].some(setting => setting !== undefined)) throw new Error('Original carousel autoplay settings require enabled autoplay');
  if (value.autoplay) {
    if (value.autoplaySpeed !== undefined) { if (!Number.isInteger(value.autoplaySpeed) || value.autoplaySpeed < 100 || value.autoplaySpeed > 120000) throw new Error('Invalid original carousel autoplay speed'); control(schema, 'autoplay_speed', 'number'); settings.autoplay_speed = value.autoplaySpeed; }
    if (value.pauseOnHover !== undefined) settings.pause_on_hover = switcher(schema, 'pause_on_hover', value.pauseOnHover);
    if (value.pauseOnInteraction !== undefined) settings.pause_on_interaction = switcher(schema, 'pause_on_interaction', value.pauseOnInteraction);
  }
  if (value.speed !== undefined) { if (!Number.isInteger(value.speed) || value.speed < 0 || value.speed > 10000) throw new Error('Invalid original carousel transition speed'); control(schema, 'speed', 'number'); settings.speed = value.speed; }
  validateRegisteredSettings('nested-carousel', settings, schema);
  validateRegisteredChildren('nested-carousel', settings, children.map(() => 'container'), schema);
  return { kind: 'carousel', key: node.key, nativeId, type: 'nested-carousel', settings, carousel: structuredClone(value), slideKeys: children.map(child => child.key), slideIds: children.map(child => idFor(child.key)) };
}

/** Only semantic bindings to actual native hover selectors; never a CSS or scripted hover fallback. */
export function compileOriginalHover(node: OriginalNode, schema: LegacySchema, settings: Record<string, unknown>): void {
  const hover: OriginalHover | undefined = node.hover;
  if (!hover) return;
  if (!Object.keys(hover).length) throw new Error('Original hover needs an explicit native change');
  const paint = (key: string, value: unknown, type: string) => {
    const registered = control(schema, key, type);
    if (!registered.selectors || typeof registered.selectors !== 'object' || !Object.keys(registered.selectors).some(selector => selector.includes(':hover'))) throw new Error(`Original hover lacks its native selector proof: ${schema.type}.${key}`);
    settings[key] = value;
  };
  if (hover.background !== undefined) {
    const prefix = node.kind === 'container' ? 'background_hover' : node.kind === 'button' ? 'button_background_hover' : '_background_hover';
    control(schema, `${prefix}_background`, 'choose'); settings[`${prefix}_background`] = 'classic'; paint(`${prefix}_color`, hover.background, 'color');
  }
  if (hover.color !== undefined) {
    if (node.kind === 'button') paint('hover_color', hover.color, 'color');
    else if (node.kind === 'heading' && node.href) paint('title_hover_color', hover.color, 'color');
    else throw new Error(`Original native hover text color is unsupported for ${node.kind}; linked headings and buttons are supported`);
  }
  if (hover.borderColor !== undefined || hover.borderWidth !== undefined) {
    if (node.kind === 'button' && hover.borderWidth !== undefined) throw new Error('Original native button hover border width is unsupported; its wrapper border cannot substitute for the button border');
    if (node.kind === 'button' && hover.borderWidth === undefined) paint('button_hover_border_color', hover.borderColor, 'color');
    else {
      const prefix = node.kind === 'container' ? 'border_hover' : '_border_hover';
      control(schema, `${prefix}_border`, 'select'); settings[`${prefix}_border`] = 'solid';
      if (hover.borderWidth !== undefined) paint(`${prefix}_width`, dimension(hover.borderWidth), 'dimensions');
      if (hover.borderColor !== undefined) paint(`${prefix}_color`, hover.borderColor, 'color');
    }
  }
  if (hover.radius !== undefined) {
    if (['button', 'image'].includes(node.kind)) throw new Error(`Original native hover radius is unsupported for ${node.kind}`);
    paint(node.kind === 'container' ? 'border_radius_hover' : '_border_radius_hover', dimension(hover.radius), 'dimensions');
  }
  if (hover.opacity !== undefined) {
    if (node.kind !== 'image' || !Number.isFinite(hover.opacity) || hover.opacity < 0 || hover.opacity > 1) throw new Error('Original hover opacity requires an image and a finite value from zero to one');
    paint('opacity_hover', slider(hover.opacity), 'slider');
  }
}
