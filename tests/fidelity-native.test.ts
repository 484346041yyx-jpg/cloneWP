import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFidelity, validateScopedNativeCSS, type FidelityImportedAsset } from '../src/fidelity/native.js';
import { compileEditorElements } from '../src/wordpress/editor-serialization.js';
import type { NativeProgram } from '../src/fidelity/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';

const nativeChildren = { childType: 'container' as const, repeaterKey: 'carousel_items', titleSettingKey: 'slide_title', baseClass: 'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base', sourceSha256: 'a'.repeat(64) };
const schemas = (): Record<string, LegacySchema> => ({
  container: { type: 'container', class: 'Elementor\\Container', controls: { content_width: { type: 'select', options: { full: 'Full', boxed: 'Boxed' } }, custom_css: { type: 'code' } } },
  'nested-carousel': { type: 'nested-carousel', class: 'ElementorPro\\Modules\\NestedCarousel\\Widgets\\Nested_Carousel', nativeChildren, controls: {
    carousel_name: { type: 'text', default: 'Carousel' }, carousel_items: { type: 'nested-elements-repeater', fields: { _id: { type: 'hidden' }, slide_title: { type: 'text' } } },
    slides_to_show: { type: 'select', options: { '1': 'One', '4': 'Four' } }, arrows: { type: 'switcher', options: { yes: 'Yes', no: 'No' } },
    arrow_hover_color: { type: 'color', condition: { arrows: 'yes' } },
  } },
  image: { type: 'image', class: 'Elementor\\Widget_Image', controls: { image: { type: 'media' } } },
  heading: { type: 'heading', class: 'Elementor\\Widget_Heading', controls: { title: { type: 'textarea' }, custom_css: { type: 'code' } } },
  'image-carousel': { type: 'image-carousel', class: 'Elementor\\Widget_Image_Carousel', controls: { carousel: { type: 'gallery' } } },
});
const asset: FidelityImportedAsset = { key: 'product', attachmentId: 13, url: 'https://target.example/uploads/product.jpg', sourceUrl: 'https://source.example/product.jpg', sha256: 'b'.repeat(64), mimeType: 'image/jpeg' };
function program(): NativeProgram {
  return { version: 1, workflow: 'block-replication', title: 'Source products', sourceUrl: 'https://source.example/', sourceContract: { path: 'contract.json', sha256: 'a'.repeat(64) }, assetsManifest: { path: 'assets.json', sha256: 'c'.repeat(64) }, blocks: [], deviations: [], elements: [{ key: 'products', type: 'container', settings: { content_width: 'full' }, children: [{ key: 'product-carousel', type: 'nested-carousel', settings: { carousel_name: 'Products', carousel_items: [{ _id: 'first', slide_title: 'First product' }, { _id: 'second', slide_title: 'Second product' }], slides_to_show: '1', arrows: 'yes', arrow_hover_color: '#0065ff' }, children: [1, 2].map(index => ({ key: `product-${index}`, type: 'container', settings: { content_width: 'full' }, children: [{ key: `photo-${index}`, type: 'image', settings: { image: { $asset: 'product' } } }, { key: `name-${index}`, type: 'heading', settings: { title: `Source product ${index}`, custom_css: 'selector a:hover { color:#0065ff;text-decoration:underline; }' } }] })) }] }] };
}

test('native product carousel retains each nested card as independently editable text and media', () => {
  const compiled = compileFidelity(program(), schemas(), [asset]);
  const carousel = compiled.composition.elements[0].elements[0];
  assert.equal(carousel.widgetType, 'nested-carousel');
  assert.equal(carousel.elements.length, 2);
  assert.equal(carousel.elements[0].elements[1].settings.title, 'Source product 1');
  assert.deepEqual(carousel.elements[0].elements[0].settings.image, { id: 13, url: asset.url });
  assert.equal(compiled.sectionIds.length, 1);
  assert.equal(Object.keys(compiled.elementMap).length, 8);
  assert.ok(compiled.usedTypes.includes('nested-carousel'));
  const serialized = compileEditorElements(compiled.composition.elements, schemas());
  assert.equal(serialized[0].elements[0].elements[0].isInner, true);
  assert.equal(serialized[0].elements[0].settings.carousel_name, 'Products');
});
test('classic widget children and unproven nested inheritance fail before save', () => {
  const input = program(); input.elements[0].children![0].type = 'heading'; input.elements[0].children![0].settings = { title: 'Not a carousel' };
  assert.throws(() => compileFidelity(input, schemas(), [asset]), /Classic widgets/);
  const discovery = schemas(); delete discovery['nested-carousel'].nativeChildren;
  assert.throws(() => compileFidelity(program(), discovery, [asset]), /Classic widgets/);
});
test('nested carousel repeaters must match native children and cannot introduce undeclared fields', () => {
  const count = program(); (count.elements[0].children![0].settings.carousel_items as unknown[]).pop();
  assert.throws(() => compileFidelity(count, schemas(), [asset]), /correspond/);
  const fields = program(); (fields.elements[0].children![0].settings.carousel_items as any[])[0].product_id = 77;
  assert.throws(() => compileFidelity(fields, schemas(), [asset]), /Undiscovered repeater field/);
});
test('carousel conditions and exact option values are validated against registered controls', () => {
  const inactive = program(); inactive.elements[0].children![0].settings.arrows = 'no';
  assert.throws(() => compileFidelity(inactive, schemas(), [asset]), /Inactive setting/);
  const invalid = program(); invalid.elements[0].children![0].settings.slides_to_show = '9';
  assert.throws(() => compileFidelity(invalid, schemas(), [asset]), /Invalid setting option/);
  const switcher = program(); switcher.elements[0].children![0].settings.arrows = 'false';
  assert.throws(() => compileFidelity(switcher, schemas(), [asset]), /Invalid native switcher/);
});
test('asset placeholders resolve through real imported galleries and reject unknown or foreign media', () => {
  const input = program(); input.elements[0].children = [{ key: 'brands', type: 'image-carousel', settings: { carousel: [{ $asset: 'product' }] } }];
  assert.deepEqual(compileFidelity(input, schemas(), [asset]).composition.elements[0].elements[0].settings.carousel, [{ id: 13, url: asset.url }]);
  input.elements[0].children[0].settings.carousel = [{ $asset: 'absent' }];
  assert.throws(() => compileFidelity(input, schemas(), [asset]), /Unknown native asset/);
  input.elements[0].children[0].settings.carousel = [{ id: 13, url: 'https://foreign.example/source.jpg' }];
  assert.throws(() => compileFidelity(input, schemas(), [asset]), /imported attachment/);
});
test('native scoped CSS allows visual hover details and rejects cross-page, network, and executable effects', () => {
  validateScopedNativeCSS('selector img {transition:transform 0.2s ease;} selector:hover img {transform:scale(1.02);}');
  validateScopedNativeCSS('selector .product-wrapper {display:flex;flex-direction:column;} selector .price {order:1;font-family:Arial,sans-serif;}');
  validateScopedNativeCSS('@media (max-width:1024px) {selector .price {font-size:20px;}}');
  for(const css of ['@media (max-width:1024px) {body {color:red;}}','@media (max-width:1024px) {@media (max-width:767px) {selector {color:red;}}}','@media (max-width:99999px) {selector {color:red;}}'])assert.throws(()=>validateScopedNativeCSS(css),/Native|native|Unsupported/);
  for (const css of ['body {color:red;}', 'selector, body {color:red;}', 'selector + body {color:red;}', 'selector:hover + .outside {color:red;}', 'selector ~ .outside {color:red;}', 'selector {background-color:url(https://foreign.example/pixel);}', 'selector {position:fixed;}', 'selector {z-index:999;}', '@import "x";', 'selector {content:"hello";}', 'selector {animation:x 1s;}', 'selector {color:red!important;}']) assert.throws(() => validateScopedNativeCSS(css), /Native|native|Unsupported/);
});
test('top-level source blocks are containers and whole-page HTML is rejected', () => {
  const input = program(); input.elements[0].type = 'heading';
  assert.throws(() => compileFidelity(input, schemas(), [asset]), /top-level/);
  input.elements[0].type = 'container'; input.elements[0].children![0].type = 'html';
  assert.throws(() => compileFidelity(input, schemas(), [asset]), /Unregistered or non-native/);
});
test('full source catalogues can retain over 700 native fields while the 2500 upper bound stays enforced', () => {
  const input = program();
  input.elements = [{ key: 'full-catalogue', type: 'container', settings: { content_width: 'full' }, children: Array.from({ length: 800 }, (_, index) => ({ key: `catalogue-name-${index}`, type: 'heading', settings: { title: `Source product ${index}` } })) }];
  assert.equal(Object.keys(compileFidelity(input, schemas(), []).elementMap).length, 801);
  input.elements[0].children = Array.from({ length: 2500 }, (_, index) => ({ key: `catalogue-name-${index}`, type: 'heading', settings: { title: `Source product ${index}` } }));
  assert.throws(() => compileFidelity(input, schemas(), []), /bounded tree/);
});
