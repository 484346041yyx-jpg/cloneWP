import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCapabilitySampleV2 } from '../src/replica-v2/capability-sample.js';
import { compileReplicaV2, referencedAssetsV2 } from '../src/replica-v2/compile.js';
import type { ProgramV2 } from '../src/replica-v2/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';

const ref = { path: 'current.json', sha256: 'a'.repeat(64) };
const schemas: Record<string, LegacySchema> = {
  container: { type: 'container', class: 'Container', controls: {} },
  html: { type: 'html', class: 'Html', controls: { html: { type: 'code' } } },
  heading: { type: 'heading', class: 'Heading', controls: { title: { type: 'textarea' } } },
  'nested-carousel': { type: 'nested-carousel', class: 'NativeCarousel', nativeChildren: { childType: 'container', repeaterKey: 'carousel_items', titleSettingKey: 'slide_title', baseClass: 'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base', sourceSha256: 'b'.repeat(64) }, controls: { carousel_items: { type: 'nested-elements-repeater', fields: { _id: { type: 'hidden' }, slide_title: { type: 'text' } } }, slides_to_show: { type: 'select', options: { '1': 'One', '6': 'Six' } }, slides_to_scroll: { type: 'select', options: { '1': 'One' } }, autoplay: { type: 'switcher', options: { yes: 'On', no: 'Off' } }, arrows: { type: 'switcher', default: 'yes' }, pagination: { type: 'select', default: 'bullets', options: { '': 'None', bullets: 'Dots', fraction: 'Fraction' } }, background_image: { type: 'media' } } },
  wd_products: { type: 'wd_products', class: 'XTS\\Elementor\\Products', controls: { post_type: { type: 'select', options: { product: 'Products', ids: 'IDs' } }, include: { type: 'select2' }, offset: { type: 'number' }, items_per_page: { type: 'number' }, orderby: { type: 'select', options: { date: 'Date' } }, order: { type: 'select', options: { DESC: 'Desc' }, condition: { 'post_type!': ['ids'] } } } },
};
const program = (): ProgramV2 => ({ version: 2, workflow: 'block-replication', taskId: 'capability-test', title: 'Replica', sourceUrl: 'https://source.example/', sourceFacts: ref, componentPlan: ref, assetsManifest: ref, viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }], blocks: [{ key: 'page-header', kind: 'composite', children: [
  { key: 'actual-offer', kind: 'html-static', template: '<section><h2 data-cwp-text="title"></h2><a data-cwp-link="shop"><span data-cwp-text="cta"></span></a><img data-cwp-media="photo"></section>', css: '', slots: { text: { title: 'Real source <offer> & copy', cta: 'Shop Now' }, media: { photo: { assetKey: 'real-source-image' } }, links: { shop: { url: 'https://source.example/shop' } } } },
  { key: 'actual-carousel', kind: 'native-carousel', widgetType: 'nested-carousel', widgetSettings: { slides_to_show: '6', slides_to_scroll: '1', autoplay: 'yes', arrows: 'yes', pagination: 'fraction', background_image: { $asset: 'real-source-image' }, carousel_items: [{ _id: 'row01', slide_title: 'First' }] }, slides: [{ key: 'actual-slide', kind: 'native', widgetType: 'heading', widgetSettings: { title: 'Real native source text' } }] },
  { key: 'actual-products', kind: 'native-products', widgetType: 'wd_products', widgetSettings: {}, query: { count: 3, ids: [41, 42, 43], evidence: ['real-catalog'] } },
] }] });
const catalog = { targetOrigin: 'https://target.example', evidence: ['real-catalog'], products: [41, 42, 43].map(id => ({ id, name: `Target ${id}`, permalink: `https://target.example/p/${id}`, imageUrl: 'https://target.example/product.png' })) };

test('combined capability sample compiles zero-media actual copy, mixed carousel and two real products under one owned root', () => {
  const input = program(), unchanged = structuredClone(input), sample = buildCapabilitySampleV2(input, schemas, catalog);
  assert.deepEqual(input, unchanged); assert.equal(sample.sampleProgram.blocks.length, 1); assert.equal(sample.sampleProgram.blocks[0].key, 'page-header');
  assert.equal(referencedAssetsV2(sample.sampleProgram).size, 0); assert.equal(sample.html?.text, 'Real source <offer> & copy'); assert.equal(sample.html?.ctaText, 'Shop Now');
  assert.equal(sample.carousel?.pagination, 'fraction'); assert.equal(sample.carousel?.slideKeys.length, 2); assert.deepEqual(sample.products?.productIds, [41, 42]);
  const compiled = compileReplicaV2(sample.sampleProgram, schemas, [], catalog);
  assert.equal(compiled.htmlProofs.length, 2); assert.equal(compiled.queryReceipts.length, 1); assert.match(compiled.htmlProofs[0].html, /Real source &lt;offer&gt; &amp; copy/); assert.match(compiled.htmlProofs[0].html, /background:#ffcb00/);
  const carousel = compiled.composition.elements[0].elements.find(element => element.id === compiled.elementMap[sample.carousel!.componentKey])!.elements[0];
  assert.equal(carousel.settings.slides_to_show, '1'); assert.equal(carousel.settings.autoplay, 'no'); assert.equal(carousel.settings.background_image, undefined); assert.equal((carousel.settings.carousel_items as unknown[]).length, 2);
  assert.equal(carousel.elements[0].elements[0].widgetType, 'html'); assert.equal(carousel.elements[1].elements[0].widgetType, 'heading');
});

test('HTML and carousel capability sample runs without product catalog and introduces no source media', () => {
  const input = program(); if (input.blocks[0].kind !== 'composite') throw Error('fixture'); input.blocks[0].children.pop();
  const sample = buildCapabilitySampleV2(input, schemas); assert.ok(sample.html); assert.ok(sample.carousel); assert.equal(sample.products, undefined); assert.equal(referencedAssetsV2(sample.sampleProgram).size, 0);
});

test('capability helper fails missing actual controls, invalid pagination, unavailable single slide and catalog before a write', () => {
  const missing = structuredClone(schemas); delete missing.heading;
  assert.throws(() => buildCapabilitySampleV2(program(), missing, catalog), /discovered native heading.title/);
  const unsupported = structuredClone(schemas); delete unsupported['nested-carousel'].controls.slides_to_show.options!['1'];
  assert.throws(() => buildCapabilitySampleV2(program(), unsupported, catalog), /cannot prove registered nested-carousel.slides_to_show=1/);
  const disabled = program(); if (disabled.blocks[0].kind !== 'composite' || disabled.blocks[0].children[1].kind !== 'native-carousel') throw Error('fixture'); disabled.blocks[0].children[1].widgetSettings.pagination = '';
  assert.throws(() => buildCapabilitySampleV2(disabled, schemas, catalog), /authored, registered carousel pagination/);
  assert.throws(() => buildCapabilitySampleV2(program(), schemas), /actual target catalog/);
});

test('native-only pages gain no unrelated HTML or carousel sample', () => {
  const input = program(); input.blocks = [{ key: 'native-source', kind: 'native', widgetType: 'heading', widgetSettings: { title: 'Actual title' } }];
  const sample = buildCapabilitySampleV2(input, schemas); assert.deepEqual(sample.sampleProgram.blocks, []); assert.equal(sample.html, undefined); assert.equal(sample.carousel, undefined); assert.equal(sample.products, undefined);
});

test('image-only carousel uses an explicitly temporary noncommercial capability sentinel instead of an empty native heading', () => {
  const input = program(); if (input.blocks[0].kind !== 'composite') throw Error('fixture');
  const html = input.blocks[0].children[0], carousel = input.blocks[0].children[1]; if (html.kind !== 'html-static' || carousel.kind !== 'native-carousel') throw Error('fixture');
  html.template = '<img data-cwp-media="photo">'; html.slots.text = {}; html.slots.links = {}; carousel.slides = [structuredClone(html)]; carousel.slides[0].key = 'image-only-slide'; input.blocks[0].children = [html, carousel];
  const sample = buildCapabilitySampleV2(input, schemas); assert.equal(sample.carousel?.text, 'cloneWP capability sample'); assert.equal(sample.html?.text, 'cloneWP capability sample');
});

test('desktop capability projection does not start responsive-only widget capabilities', () => {
  const input = program(); input.blocks = [{ key: 'desktop-source', kind: 'native', widgetType: 'heading', widgetSettings: { title: 'Desktop title' } }, { ...input.blocks[0], stage: 'responsive' }];
  assert.deepEqual(buildCapabilitySampleV2(input, schemas).sampleProgram.blocks, []);
  assert.ok(buildCapabilitySampleV2(input, schemas, catalog, 'responsive').carousel);
});
