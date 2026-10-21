import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOriginal, preflightOriginal, type OriginalImportedAsset } from '../src/original/compile.js';
import type { OriginalDesign } from '../src/original/types.js';
import type { ControlInfo, LegacySchema, TargetCatalogSnapshot } from '../src/wordpress/types.js';
import { renderOriginalPrototype } from '../src/original/prototype.js';
import { buildNativeFractionCSS } from '../src/fidelity/native-fraction.js';
import { compileEditorElements } from '../src/wordpress/editor-serialization.js';
import type { ElementorElement } from '../src/planning/plan.js';

// Small registered-control fixtures: these exercise real native names, enum activation and units.
// Passing fixture tests alone is deliberately not a claim about the remote WordPress page.
const text = (): ControlInfo => ({ type: 'text' });
const color = (): ControlInfo => ({ type: 'color' });
const choose = (values: string[], defaultValue = ''): ControlInfo => ({ type: 'choose', options: Object.fromEntries(values.map(value => [value, value])), default: defaultValue });
const select = (values: string[], defaultValue = ''): ControlInfo => ({ ...choose(values, defaultValue), type: 'select' });
const slider = (): ControlInfo => ({ type: 'slider', size_units: ['px', '%', 'em', 'custom'] });
const dimensions = (): ControlInfo => ({ type: 'dimensions', size_units: ['px'] });
const background = (prefix: string): Record<string, ControlInfo> => ({
  [`${prefix}background_background`]: choose(['', 'classic', 'gradient']),
  [`${prefix}background_color`]: { ...color(), condition: { [`${prefix}background_background`]: ['classic', 'gradient'] } },
});
const border = (prefix: string): Record<string, ControlInfo> => ({
  [`${prefix}border_border`]: select(['', 'none', 'solid']),
  [`${prefix}border_width`]: { ...dimensions(), condition: { [`${prefix}border_border!`]: ['', 'none'] } },
  [`${prefix}border_color`]: { ...color(), condition: { [`${prefix}border_border!`]: ['', 'none'] } },
  [`${prefix}border_radius`]: dimensions(),
});
const typography = (prefix: string): Record<string, ControlInfo> => ({
  [`${prefix}_typography`]: { type: 'popover_toggle', default: '' },
  [`${prefix}_font_family`]: { type: 'font', condition: { [`${prefix}_typography!`]: '' } },
  [`${prefix}_font_size`]: { ...slider(), condition: { [`${prefix}_typography!`]: '' } },
  [`${prefix}_font_size_mobile`]: { ...slider(), condition: { [`${prefix}_typography!`]: '' } },
  [`${prefix}_font_weight`]: { ...select(['400', '600', '700', '800']), condition: { [`${prefix}_typography!`]: '' } },
  [`${prefix}_line_height`]: { ...slider(), condition: { [`${prefix}_typography!`]: '' } },
});
const common = (): Record<string, ControlInfo> => ({
  _element_id: text(), _attributes: { type: 'textarea' }, _margin: dimensions(), _padding: dimensions(), _padding_mobile: dimensions(),
  _element_width: select(['', 'initial', 'auto', 'inherit']), _element_width_mobile: select(['', 'initial', 'auto', 'inherit']),
  _element_custom_width: { ...slider(), condition: { _element_width: 'initial' } },
  _element_custom_width_mobile: { ...slider(), condition: { _element_width: 'initial' } },
  align: choose(['left', 'center', 'right']), ...background('_'), ...border('_'),
});
const schema = (type: string, controls: Record<string, ControlInfo>): LegacySchema => ({ type, class: `Fixture\\${type}`, controls });
function schemas(): Record<string, LegacySchema> {
  return {
    container: schema('container', {
      _element_id: text(), _attributes: { type: 'textarea' }, container_type: select(['flex']), content_width: select(['boxed', 'full']),
      boxed_width: { ...slider(), condition: { content_width: 'boxed' } }, width: { ...slider(), condition: { content_width: 'full' } }, width_mobile: { ...slider(), condition: { content_width: 'full' } },
      flex_direction: choose(['row', 'column']), flex_direction_mobile: choose(['row', 'column']), flex_justify_content: choose(['flex-start', 'center', 'space-between']), flex_align_items: choose(['stretch', 'center', 'flex-start']),
      flex_gap: { type: 'gaps' }, flex_wrap: choose(['nowrap', 'wrap']), flex_wrap_mobile: choose(['nowrap', 'wrap']),
      padding: dimensions(), padding_mobile: dimensions(), margin: dimensions(), min_height: slider(), html_tag: select(['section', 'header', 'footer']),
      ...background(''), ...border(''),
    }),
    heading: schema('heading', { ...common(), title: { type: 'textarea' }, header_size: select(['h1', 'h2', 'h3', 'p']), title_color: color(), link: { type: 'url' }, ...typography('typography') }),
    'text-editor': schema('text-editor', { ...common(), editor: { type: 'wysiwyg' }, text_color: color(), ...typography('typography') }),
    image: schema('image', { ...common(), image: { type: 'media' }, image_size: select(['full']), width: slider(), width_mobile: slider(), space: slider(), height: slider(), height_mobile: slider(), 'object-fit': select(['cover']), 'object-fit_mobile': select(['cover']), 'object-position': select(['center center']), image_border_radius: dimensions(), link_to: select(['custom']), link: { type: 'url' } }),
    button: schema('button', { ...common(), ...background(''), ...border(''), text: text(), link: { type: 'url' }, button_text_color: color(), text_padding: dimensions(), text_padding_mobile: dimensions(), ...typography('typography') }),
    accordion: schema('accordion', { ...common(), tabs: { type: 'repeater', fields: { tab_title: text(), tab_content: { type: 'wysiwyg' } } }, title_html_tag: select(['h3']), title_color: color(), tab_active_color: color(), content_color: color(), border_width: slider(), border_color: color(), title_background: color(), content_background_color: color(), title_padding: dimensions(), content_padding: dimensions(), ...typography('title_typography'), ...typography('content_typography') }),
  };
}
function design(): OriginalDesign {
  return {
    version: 1, brand: 'MoriPaws', title: 'MoriPaws original homepage', language: 'en', description: 'An authored pet care concept',
    tokens: { font: 'Arial', contentWidth: 1200, colors: { ink: '#203C31', cream: '#FCFBF8' } },
    assets: [{ key: 'hero', path: 'D:/cloneWP/original/assets/hero.png', alt: 'Dog and cat', provenance: 'Original artwork' }],
    sections: [
      { key: 'header', kind: 'container', style: { direction: 'row', mobileDirection: 'column', justify: 'space-between', padding: [20, 24, 20, 24] }, children: [{ key: 'brand', kind: 'heading', text: 'MoriPaws', headingTag: 'p', style: { fontSize: 24 } }, { key: 'nav-button', kind: 'button', text: 'Care & comfort', href: '#care', style: { background: 'transparent', color: '#203C31', padding: [0, 0, 0, 0] } }] },
      { key: 'hero-section', anchor: 'home', kind: 'container', style: { background: '#FCFBF8', direction: 'row', mobileDirection: 'column', gap: 40 }, children: [
        { key: 'hero-copy', kind: 'container', style: { width: 47, mobileWidth: 100, color: '#203C31' }, children: [{ key: 'hero-title', kind: 'heading', headingTag: 'h1', text: 'Small paws. Big love.', style: { fontSize: 64, mobileFontSize: 38 } }, { key: 'hero-description', kind: 'text', text: 'Original care for everyday life.\n\nMade for pets and their people.' }, { key: 'hero-cta', kind: 'button', text: 'Explore care', href: '#care', style: { radius: 30 } }] },
        { key: 'hero-visual', kind: 'container', style: { width: 47 }, children: [{ key: 'hero-image', kind: 'image', asset: 'hero', alt: 'Dog and cat', style: { imageHeight: 520, mobileImageHeight: 320, radius: 28 } }] },
      ] },
      { key: 'care-section', kind: 'container', anchor: 'care', children: [{ key: 'care-title', kind: 'heading', text: 'Care, explained simply.' }, { key: 'care-faq', kind: 'accordion', items: [{ title: 'Can I edit this page?', content: 'Yes. Every block uses native Elementor controls.' }, { title: 'Is this a live store?', content: 'This is an original demonstration homepage.' }], style: { fontSize: 18, borderColor: '#E1E8DE', borderWidth: 1 } }] },
    ],
  };
}
const asset: OriginalImportedAsset = { key: 'hero', attachmentId: 101, url: 'https://target.example/wp-content/uploads/hero.png', sourceUrl: 'https://clonewp.local.invalid/original-assets/hero', sha256: 'a'.repeat(64), mimeType: 'image/png', width: 1536, height: 1024 };
function flatten(elements: ElementorElement[]): ElementorElement[] { return elements.flatMap(element => [element, ...flatten(element.elements)]); }

test('original design compiles stable independently editable native sections without a source capture', () => {
  const compiled = compileOriginal(design(), schemas(), [asset]);
  const flat = flatten(compiled.composition.elements);
  assert.equal(compiled.sections.length, 3); assert.equal(compiled.sectionIds.length, 3);
  assert.equal(compiled.composition.elements.length, 3);
  assert.equal(Object.keys(compiled.elementMap).length, flat.length);
  assert.equal(new Set(flat.map(element => element.id)).size, flat.length);
  assert.ok(flat.every(element => /^[a-f0-9]{7}$/.test(element.id)));
  assert.deepEqual(new Set(flat.filter(element => element.elType === 'widget').map(element => element.widgetType)), new Set(['heading', 'button', 'text-editor', 'image', 'accordion']));
  assert.ok(!JSON.stringify(compiled.composition).includes('htmlCache'));
  assert.ok(flat.every(element => !Object.hasOwn(element.settings, 'custom_css')));
  assert.equal(compiled.plan.unsupported.length, 0);
  assert.equal(compiled.plan.mappings[0].sourceId, 'header');
  assert.deepEqual(compiled, compileOriginal(design(), schemas(), [asset]));
  for (const section of compiled.sections) assert.deepEqual(section.elementIds, flatten([compiled.composition.elements.find(element => element.id === section.targetId)!]).map(element => element.id));
});

test('original native responsive controls retain authored width, direction, image crop and typography', () => {
  const compiled = compileOriginal(design(), schemas(), [asset]);
  const byKey = (key: string) => flatten(compiled.composition.elements).find(element => element.id === compiled.elementMap[key])!;
  assert.equal(byKey('hero-copy').settings.content_width, 'full');
  assert.deepEqual(byKey('hero-copy').settings.width, { unit: '%', size: 47, sizes: [] });
  assert.deepEqual(byKey('hero-copy').settings.width_mobile, { unit: '%', size: 100, sizes: [] });
  assert.equal(byKey('hero-section').settings.flex_direction, 'row');
  assert.equal(byKey('hero-section').settings.flex_direction_mobile, 'column');
  assert.equal(byKey('hero-title').settings.header_size, 'h1');
  assert.equal(byKey('hero-title').settings.typography_font_family, 'Arial');
  assert.equal((byKey('hero-title').settings.typography_font_size_mobile as { size: number }).size, 38);
  assert.equal(byKey('hero-image').settings['object-fit'], 'cover');
  assert.deepEqual(byKey('hero-image').settings.image, { id: 101, url: asset.url });
  assert.equal(byKey('hero-copy').isInner, true); assert.equal(byKey('hero-image').isInner, false); assert.equal(byKey('hero-section').isInner, false);
  const faq = byKey('care-faq');
  assert.equal((faq.settings.tabs as Array<{ tab_content: string }>)[0].tab_content, '<p>Yes. Every block uses native Elementor controls.</p>');
});

test('image width belongs to the native flex widget and row navigation stays intrinsic', () => {
  const input = design();
  input.sections[1].children![1] = { key: 'sibling-image', kind: 'image', asset: 'hero', style: { width: 47, mobileWidth: 100, imageHeight: 460 } };
  input.sections[0].children!.splice(1, 0, { key: 'intrinsic-nav', kind: 'container', style: { direction: 'row', mobileDirection: 'row' }, children: [{ key: 'inner-nav-button', kind: 'button', text: 'Care', href: '#care' }] });
  input.sections[1].children![0].children![0].text = 'Care.\nTogether.';
  const compiled = compileOriginal(input, schemas(), [asset]);
  const flat = flatten(compiled.composition.elements), byKey = (key: string) => flat.find(element => element.id === compiled.elementMap[key])!;
  assert.equal((byKey('sibling-image').settings._element_custom_width as { size: number }).size, 47);
  assert.equal((byKey('sibling-image').settings._element_custom_width_mobile as { size: number }).size, 100);
  assert.equal((byKey('sibling-image').settings.width as { size: number }).size, 100);
  assert.equal(byKey('intrinsic-nav').settings.content_width, 'full');
  assert.equal((byKey('intrinsic-nav').settings.width as { size: string }).size, 'auto');
  assert.equal(byKey('inner-nav-button').settings._element_width, 'auto');
  assert.equal(byKey('hero-title').settings.title, 'Care.<br>Together.');
});

test('original compiler fails on undiscovered or inactive settings and illegal native options', () => {
  const missing = schemas(); delete missing.heading.controls.title_color;
  assert.throws(() => compileOriginal(design(), missing, [asset]), /Undiscovered setting heading.title_color/);
  const inactive = schemas(); inactive.heading.controls.typography_font_family.condition = { typography_typography: 'unregistered-mode' };
  assert.throws(() => compileOriginal(design(), inactive, [asset]), /Inactive setting heading.typography_font_family/);
  const invalid = design(); invalid.sections[0].style!.justify = 'invented-position';
  assert.throws(() => compileOriginal(invalid, schemas(), [asset]), /Invalid setting option container.flex_justify_content/);
  const unknown = design(); (unknown.sections[0].style as Record<string, unknown>).custom_css = 'body{}';
  assert.throws(() => compileOriginal(unknown, schemas(), [asset]), /Unsupported original style/);
});

test('original images require actual imported identity and an authored asset key', () => {
  assert.throws(() => compileOriginal(design(), schemas(), []), /imported native media attachment/);
  assert.throws(() => compileOriginal(design(), schemas(), [{ ...asset, attachmentId: 0 }]), /Invalid imported original media/);
  assert.throws(() => compileOriginal(design(), schemas(), [asset, asset]), /Duplicate or missing original media key/);
  const undeclared = design(); undeclared.assets = [];
  assert.throws(() => compileOriginal(undeclared, schemas(), [asset]), /undeclared asset/);
});

test('original native text is escaped and active link protocols are rejected', () => {
  const input = design(); input.sections[1].children![0].children![1].text = '<em>Calm care & company</em>';
  const compiled = compileOriginal(input, schemas(), [asset]);
  const editor = flatten(compiled.composition.elements).find(element => element.widgetType === 'text-editor')!.settings.editor as string;
  assert.ok(editor.includes('&lt;em&gt;Calm care &amp; company')); assert.ok(!editor.includes('<em>'));
  const unsafe = design(); unsafe.sections[0].children![1].href = 'javascript:run()';
  assert.throws(() => compileOriginal(unsafe, schemas(), [asset]), /Executable|protocol/);
});

test('original structural identities cannot collide, duplicate anchors or split leaves', () => {
  const duplicate = design(); duplicate.sections[2].key = duplicate.sections[0].key;
  assert.throws(() => compileOriginal(duplicate, schemas(), [asset]), /Duplicate or invalid original node key/);
  const anchor = design(); anchor.sections[2].anchor = 'home';
  assert.throws(() => compileOriginal(anchor, schemas(), [asset]), /Duplicate or invalid original anchor/);
  const leaf = design(); leaf.sections[0].children![0].children = [{ key: 'bogus-child', kind: 'text', text: 'No' }];
  assert.throws(() => compileOriginal(leaf, schemas(), [asset]), /leaf cannot own native children/);
  const twoTitles = design(); twoTitles.sections[2].children![0].headingTag = 'h1';
  assert.throws(() => compileOriginal(twoTitles, schemas(), [asset]), /single H1/);
  const negative = design(); negative.sections[0].style!.padding = [-10, 24, 20, 24];
  assert.throws(() => compileOriginal(negative, schemas(), [asset]), /four finite sides/);
  const broken = design(); broken.sections[0].children![1].href = '#missing-section';
  assert.throws(() => compileOriginal(broken, schemas(), [asset]), /no authored destination/);
});

// Names, classes and activation conditions mirror the saved target's registered branches.
// These fixtures prove adapter behavior only; remote render/editor evidence remains separately required.
function componentSchemas(): Record<string, LegacySchema> {
  const registry = schemas();
  registry.wd_products = { type: 'wd_products', class: 'XTS\\Elementor\\Products', controls: {
    ...common(), post_type: select(['product', 'ids'], 'product'), include: { type: 'wd_autocomplete', condition: { post_type: 'ids' } },
    items_per_page: { type: 'number' }, layout: select(['grid', 'carousel']), orderby: select(['date', 'id']), order: { ...select(['DESC', 'ASC']), condition: { 'post_type!': 'ids' } },
    ...Object.fromEntries(['columns', 'columns_tablet', 'columns_mobile'].map(key => [key, { ...slider(), condition: { layout: 'grid' } }])),
    ...Object.fromEntries(['slides_per_view', 'slides_per_view_tablet', 'slides_per_view_mobile'].map(key => [key, { ...slider(), condition: { layout: 'carousel' } }])),
    ...Object.fromEntries(['hide_prev_next_buttons', 'hide_pagination_control', 'hide_pagination_control_tablet', 'hide_pagination_control_mobile', 'dynamic_pagination_control', 'scroll_per_page', 'autoplay', 'wrap'].map(key => [key, { type: 'switcher', default: 'no', condition: { layout: 'carousel' } }])),
    speed: { type: 'number', condition: { layout: 'carousel', autoplay: 'yes' } }, product_hover: select(['standard', 'icons']), custom_css: { type: 'code' },
  } };
  registry['nested-carousel'] = { type: 'nested-carousel', class: 'ElementorPro\\Modules\\NestedCarousel\\Widgets\\Nested_Carousel', nativeChildren: {
    childType: 'container', repeaterKey: 'carousel_items', titleSettingKey: 'slide_title', baseClass: 'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base', sourceSha256: 'c'.repeat(64),
  }, controls: {
    ...common(), carousel_name: text(), carousel_items: { type: 'nested-elements-repeater', fields: { _id: { type: 'hidden' }, slide_title: text() } },
    ...Object.fromEntries(['slides_to_show', 'slides_to_show_tablet', 'slides_to_show_mobile', 'slides_to_scroll'].map(key => [key, select(['1', '2', '3', '4'])])),
    arrows: { type: 'switcher', default: 'yes' }, pagination: select(['', 'bullets', 'fraction']), autoplay: { type: 'switcher', options: { yes: 'On', no: 'Off' } },
    infinite: { type: 'switcher', options: { yes: 'On', no: 'Off' } }, autoplay_speed: { type: 'number', condition: { autoplay: 'yes' } }, speed: { type: 'number' },
    pause_on_hover: { type: 'switcher', options: { yes: 'On', no: 'Off' }, condition: { autoplay: 'yes' } }, pause_on_interaction: { type: 'switcher', options: { yes: 'On', no: 'Off' }, condition: { autoplay: 'yes' } },
  } };
  return registry;
}
const catalog = (): TargetCatalogSnapshot => ({ version: 1, targetOrigin: 'https://target.example', readAt: '2026-10-14T06:00:00Z', evidence: ['D:/cloneWP/runs/fixture/target/catalog.json'],
  query: { limit: 4, status: 'publish', visibility: 'visible', orderby: 'date', order: 'DESC' }, products: [91, 24, 58, 63].map(id => ({ id, name: `Actual target ${id}`, permalink: `https://target.example/product/${id}/`, imageUrl: `https://target.example/uploads/${id}.png`, imageVariants: [`https://target.example/uploads/${id}.png`], priceText: '$20' })) });
function productDesign(): OriginalDesign {
  const input = design(); input.workflow = 'original-design';
  input.sections[2].children!.push({ key: 'current-catalog', kind: 'products', productQuery: { limit: 3 }, productDisplay: { layout: 'carousel', columns: 3, tabletColumns: 2, mobileColumns: 1, arrows: true, pagination: 'fraction', autoplay: true, autoplaySpeed: 3500, loop: false, hoverStyle: 'icons' } });
  return input;
}
function carouselDesign(): OriginalDesign {
  const input = design(); input.workflow = 'original-design';
  input.sections[2].children!.push({ key: 'authored-stories', kind: 'carousel', text: 'Our stories', carousel: { slidesToShow: 2, tabletSlidesToShow: 2, mobileSlidesToShow: 1, slidesToScroll: 1, arrows: true, pagination: 'fraction', autoplay: true, autoplaySpeed: 3000, loop: false, pauseOnHover: true, pauseOnInteraction: true, speed: 400 },
    children: [1, 2, 3].map(index => ({ key: `story-slide-${index}`, kind: 'container', style: { boxed: false }, children: [{ key: `story-text-${index}`, kind: 'heading', text: `Authored story ${index}` }] })) });
  return input;
}

test('pure original preflight proves registered controls with symbolic local media and exposes no fake write composition', () => {
  const receipt = preflightOriginal(design(), schemas());
  assert.equal(receipt.passed, true); assert.equal(receipt.nativeElements, Object.keys(compileOriginal(design(), schemas(), [asset]).elementMap).length);
  assert.ok(receipt.usedTypes.includes('image')); assert.ok(receipt.registeredSettings > 0);
  assert.equal('composition' in receipt, false); assert.equal('assets' in receipt, false); assert.doesNotMatch(JSON.stringify(receipt), /attachmentId|clonewp\.local|\$asset/);
  const registry = schemas(); delete registry.image.controls.image;
  assert.throws(() => preflightOriginal(design(), registry), /Undiscovered setting image.image/);
  const inactive = schemas(); inactive.heading.controls.typography_font_family.condition = { typography_typography: 'wrong' };
  assert.throws(() => preflightOriginal(design(), inactive), /Inactive setting/);
});

test('native original products query actual target IDs in a registered carousel without static product cards', () => {
  const input = productDesign(), target = catalog(), options = { targetOrigin: target.targetOrigin, catalog: target };
  const preflight = preflightOriginal(input, componentSchemas(), options), compiled = compileOriginal(input, componentSchemas(), [asset], options);
  assert.deepEqual(preflight.nativeComponents, compiled.nativeComponents);
  const component = compiled.nativeComponents[0]; assert.equal(component.kind, 'products');
  if (component.kind !== 'products') throw Error('Wrong fixture kind');
  assert.deepEqual(component.productIds, [91, 24, 58]); assert.deepEqual(component.catalog.products.map(product => product.id), component.productIds);
  assert.equal(component.settings.post_type, 'ids'); assert.deepEqual(component.settings.include, [91, 24, 58]); assert.equal(component.settings.orderby, 'date'); assert.equal(component.settings.order, undefined);
  assert.deepEqual(component.settings.slides_per_view_tablet, { unit: 'px', size: 2, sizes: [] });
  assert.equal(component.settings.hide_pagination_control_mobile, 'no'); assert.equal(component.settings.hide_prev_next_buttons, 'no');
  assert.equal(component.settings.autoplay, 'yes'); assert.equal(component.settings.speed, 3500);
  assert.ok(String(component.settings.custom_css).startsWith(buildNativeFractionCSS())); assert.match(String(component.settings.custom_css), /wd-nav-pagin-wrap\{min-height:24px;height:24px/); assert.equal(component.styleAdapter, 'woodmart-native-fraction-v1');
  const widget = flatten(compiled.composition.elements).find(element => element.id === component.nativeId)!;
  assert.equal(widget.widgetType, 'wd_products'); assert.equal(widget.elements.length, 0);
  assert.doesNotMatch(JSON.stringify(compiled.composition), /Actual target|product\/91|uploads\/91/);
  assert.equal(JSON.stringify(input), JSON.stringify(productDesign()), 'Compilation preserves authored input');
});

test('original explicit product IDs remain actual target query identities and native grid columns', () => {
  const input = productDesign(), products = input.sections[2].children!.at(-1)!;
  products.productQuery = { ids: [58, 91], limit: 2 }; products.productDisplay = { layout: 'grid', columns: 2, tabletColumns: 2, mobileColumns: 1 };
  const compiled = compileOriginal(input, componentSchemas(), [asset], { targetOrigin: 'https://target.example', catalog: catalog() });
  const component = compiled.nativeComponents[0]; assert.equal(component.kind, 'products');
  assert.equal(component.settings.post_type, 'ids'); assert.deepEqual(component.settings.include, [91, 58]); assert.equal(component.settings.order, undefined);
  assert.deepEqual(component.settings.columns, { unit: 'px', size: 2, sizes: [] }); assert.equal(component.settings.slides_per_view, undefined);
  if (component.kind === 'products') assert.deepEqual(component.productIds, [91, 58]);
});

test('product catalog, class, query, pagination and unsupported display gaps fail before draft writes', () => {
  const input = productDesign(), options = { targetOrigin: 'https://target.example', catalog: catalog() };
  assert.throws(() => preflightOriginal(input, componentSchemas()), /read-only target WooCommerce catalog evidence/);
  const noEvidence = catalog(); noEvidence.evidence = [];
  assert.throws(() => preflightOriginal(input, componentSchemas(), { ...options, catalog: noEvidence }), /catalog evidence/);
  assert.throws(() => preflightOriginal(input, componentSchemas(), { ...options, targetOrigin: 'https://another.example' }), /catalog evidence/);
  const unknown = productDesign(); unknown.sections[2].children!.at(-1)!.productQuery!.ids = [91, 24, 999999];
  assert.throws(() => preflightOriginal(unknown, componentSchemas(), options), /actual target catalog/);
  const missing = componentSchemas(); delete missing.wd_products.controls.hide_pagination_control_tablet;
  assert.throws(() => preflightOriginal(input, missing, options), /hide_pagination_control_tablet/);
  const fraction = componentSchemas(); delete fraction.wd_products.controls.custom_css;
  assert.throws(() => preflightOriginal(input, fraction, options), /custom_css/);
  const wrongClass = componentSchemas(); wrongClass.wd_products.class = 'Fixture\\Products';
  assert.throws(() => preflightOriginal(input, wrongClass, options), /actual registered Woodmart/);
  const unsupported = productDesign(); unsupported.sections[2].children!.at(-1)!.productDisplay!.showRating = true;
  assert.throws(() => preflightOriginal(unsupported, componentSchemas(), options), /price\/rating visibility controls are unsupported/);
  const hover = productDesign(); hover.sections[2].children!.at(-1)!.productDisplay!.hoverStyle = 'invented-hover';
  assert.throws(() => preflightOriginal(hover, componentSchemas(), options), /Invalid setting option wd_products.product_hover/);
});

test('original nested carousel owns editable containers, exact repeater rows and actual responsive/behavior controls', () => {
  const input = carouselDesign(), registry = componentSchemas(), preflight = preflightOriginal(input, registry);
  const compiled = compileOriginal(input, registry, [asset]); assert.deepEqual(preflight.nativeComponents, compiled.nativeComponents);
  const component = compiled.nativeComponents[0]; assert.equal(component.kind, 'carousel');
  if (component.kind !== 'carousel') throw Error('Wrong fixture kind');
  assert.equal(component.settings.slides_to_show, '2'); assert.equal(component.settings.slides_to_show_tablet, '2'); assert.equal(component.settings.slides_to_show_mobile, '1');
  assert.equal(component.settings.pagination, 'fraction'); assert.equal(component.settings.pause_on_hover, 'yes'); assert.equal(component.settings.infinite, 'no');
  assert.equal(component.settings.custom_css, undefined); assert.equal(component.slideIds.length, 3);
  const node = flatten(compiled.composition.elements).find(element => element.id === component.nativeId)!;
  assert.deepEqual(node.elements.map(child => child.id), component.slideIds); assert.ok(node.elements.every(child => child.elType === 'container' && child.elements[0].widgetType === 'heading'));
  const rows = component.settings.carousel_items as Array<Record<string, unknown>>; assert.equal(rows.length, 3); assert.ok(rows.every(row => Object.keys(row).sort().join(',') === '_id,slide_title'));
  assert.equal(flatten(compileEditorElements(compiled.composition.elements, registry) as ElementorElement[]).find(element => element.id === component.slideIds[0])!.isInner, true);
});

test('native carousel missing inheritance, source hash, options, fields and inactive settings remain explicit failures', () => {
  for (const mutate of [(registry: ReturnType<typeof componentSchemas>) => { delete registry['nested-carousel'].nativeChildren; }, (registry: ReturnType<typeof componentSchemas>) => { registry['nested-carousel'].nativeChildren!.sourceSha256 = ''; }, (registry: ReturnType<typeof componentSchemas>) => { delete registry['nested-carousel'].controls.slides_to_show_tablet; }]) {
    const registry = componentSchemas(); mutate(registry); assert.throws(() => preflightOriginal(carouselDesign(), registry), /native child|Classic widgets|slides_to_show_tablet/);
  }
  const options = componentSchemas(); delete options['nested-carousel'].controls.pagination.options!.fraction;
  assert.throws(() => preflightOriginal(carouselDesign(), options), /Invalid setting option nested-carousel.pagination/);
  const fields = componentSchemas(); fields['nested-carousel'].controls.carousel_items.fields = { _id: { type: 'hidden' }, wrong_title: text() };
  assert.throws(() => preflightOriginal(carouselDesign(), fields), /Undiscovered repeater field/);
  const inactive = carouselDesign(); inactive.sections[2].children!.at(-1)!.carousel!.autoplay = false;
  assert.throws(() => preflightOriginal(inactive, componentSchemas()), /require autoplay|require enabled autoplay/);
});

test('tablet design properties use real native controls and missing responsive controls cannot pass', () => {
  const input = design(), registry = schemas();
  Object.assign(registry.container.controls, { flex_direction_tablet: choose(['row', 'column']), flex_wrap_tablet: choose(['wrap', 'nowrap']), flex_gap_tablet: { type: 'gaps' }, padding_tablet: dimensions(), width_tablet: slider() });
  registry.heading.controls.typography_font_size_tablet = slider(); registry.image.controls.height_tablet = slider(); registry.image.controls['object-fit_tablet'] = select(['cover']);
  registry.button.controls.text_padding_tablet = dimensions();
  input.sections[1].style = { ...input.sections[1].style, tabletDirection: 'row', tabletWrap: 'wrap', tabletGap: 22, tabletPadding: [12, 24, 12, 24] };
  input.sections[1].children![0].style!.tabletWidth = 50; input.sections[1].children![0].children![0].style!.tabletFontSize = 44;
  input.sections[1].children![1].children![0].style!.tabletImageHeight = 380;
  input.sections[1].children![0].children![2].style = { tabletPadding: [10, 16, 10, 16] };
  const compiled = compileOriginal(input, registry, [asset]), flat = flatten(compiled.composition.elements), byKey = (key: string) => flat.find(element => element.id === compiled.elementMap[key])!;
  assert.equal(byKey('hero-section').settings.flex_direction_tablet, 'row'); assert.deepEqual(byKey('hero-copy').settings.width_tablet, { unit: '%', size: 50, sizes: [] });
  assert.equal((byKey('hero-title').settings.typography_font_size_tablet as { size: number }).size, 44); assert.equal((byKey('hero-image').settings.height_tablet as { size: number }).size, 380);
  assert.equal((byKey('hero-cta').settings.text_padding_tablet as { top: string }).top, '10');
  delete registry.heading.controls.typography_font_size_tablet;
  assert.throws(() => preflightOriginal(input, registry), /typography_font_size_tablet/);
});

test('hover changes need registered editable controls and actual hover selector proof', () => {
  const input = design(), registry = schemas(), button = input.sections[1].children![0].children![2];
  button.hover = { background: '#004422', color: '#FFFFFF', borderColor: '#112233' };
  Object.assign(registry.button.controls, { hover_color: { type: 'color', selectors: { '{{WRAPPER}} .elementor-button:hover': 'color: {{VALUE}}' } }, button_background_hover_background: choose(['classic', 'gradient']), button_background_hover_color: { type: 'color', condition: { button_background_hover_background: 'classic' }, selectors: { '{{WRAPPER}} .elementor-button:hover': 'background-color: {{VALUE}}' } }, button_hover_border_color: { type: 'color', selectors: { '{{WRAPPER}} .elementor-button:hover': 'border-color: {{VALUE}}' } } });
  const compiled = compileOriginal(input, registry, [asset]), widget = flatten(compiled.composition.elements).find(element => element.id === compiled.elementMap[button.key])!;
  assert.equal(widget.settings.hover_color, '#FFFFFF'); assert.equal(widget.settings.button_background_hover_background, 'classic'); assert.equal(widget.settings.button_background_hover_color, '#004422');
  assert.equal(widget.settings.custom_css, undefined);
  delete registry.button.controls.hover_color.selectors;
  assert.throws(() => preflightOriginal(input, registry), /native selector proof/);
  delete registry.button.controls.hover_color;
  assert.throws(() => preflightOriginal(input, registry), /Undiscovered native original setting/);
});

test('local authored prototype marks unavailable product/runtime preview and never fabricates static target cards', () => {
  const input = productDesign(); input.sections[2].children!.push(carouselDesign().sections[2].children!.at(-1)!);
  const html = renderOriginalPrototype(input);
  assert.match(html, /requires-target-render/); assert.match(html, /static-slide-content/); assert.doesNotMatch(html, /Actual target|product-grid-item|Swiper|brightness/);
});
