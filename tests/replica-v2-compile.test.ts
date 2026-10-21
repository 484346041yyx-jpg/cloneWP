import test from 'node:test';
import assert from 'node:assert/strict';
import { compileReplicaV2, preflightReplicaV2, referencedAssetsV2, usedWidgetTypesV2 } from '../src/replica-v2/compile.js';
import { renderStaticHTML, scopeStaticCSS, assertGeneratedHtmlProof, validateNativeCSSV2 } from '../src/replica-v2/html.js';
import { validateScopedNativeCSS } from '../src/fidelity/scoped-css.js';
import { validateProgramV2 } from '../src/replica-v2/validate.js';
import { validatePlan } from '../src/planning/plan.js';
import type { HtmlStaticComponentV2, ImportedAssetV2, ProgramV2 } from '../src/replica-v2/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';
import { WordPressClient } from '../src/wordpress/client.js';
import type { DraftSnapshot } from '../src/wordpress/types.js';
import { documentHashV2 } from '../src/replica-v2/journal.js';

const ref = { path: 'current.json', sha256: 'a'.repeat(64) };
const asset: ImportedAssetV2 = { key: 'hero', attachmentId: 21, url: 'https://target.example/uploads/hero.png', sourceUrl: 'https://source.example/hero.png', sha256: 'b'.repeat(64), mimeType: 'image/png' };
const mobile = { ...asset, key: 'mobile-hero', attachmentId: 22, url: 'https://target.example/uploads/mobile.png' };
const schemas: Record<string, LegacySchema> = {
  container: { type: 'container', class: 'Elementor\\Container', controls: { content_width: { type: 'select', options: { full: 'Full' } }, custom_css: { type: 'code' } } },
  html: { type: 'html', class: 'Elementor\\Widget_Html', controls: { html: { type: 'code' } } },
  heading: { type: 'heading', class: 'Elementor\\Widget_Heading', controls: { title: { type: 'textarea' } } },
  'nested-carousel': { type: 'nested-carousel', class: 'NativeCarousel', nativeChildren: { childType: 'container', repeaterKey: 'carousel_items', titleSettingKey: 'slide_title', baseClass: 'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base', sourceSha256: 'c'.repeat(64) }, controls: { carousel_items: { type: 'nested-elements-repeater', fields: { _id: { type: 'hidden' }, slide_title: { type: 'text' } } }, slides_to_show: { type: 'select', options: { '1': 'One' } } } },
  wd_products: { type: 'wd_products', class: 'XTS\\Elementor\\Products', controls: { post_type: { type: 'select', options: { product: 'Products', ids: 'IDs' } }, include: { type: 'select2' }, offset: { type: 'number' }, items_per_page: { type: 'number' }, orderby: { type: 'select', options: { date: 'Date' }, condition: { 'post_type!': ['recently_viewed', 'top_rated_products', 'bestselling'] } }, order: { type: 'select', options: { '': 'Inherit', DESC: 'Desc', ASC: 'Asc' }, condition: { 'post_type!': ['ids', 'recently_viewed', 'bestselling'] } } } },
};
const html = (): HtmlStaticComponentV2 => ({ key: 'promotion', kind: 'html-static', template: '<section data-cwp-background="back"><h2 data-cwp-text="title"></h2><a class="cta" data-cwp-link="shop"><span data-cwp-text="cta"></span></a><img data-cwp-media="photo"></section>', css: ':scope{display:block}.cta{background:#ffcb00;padding:12px 24px;border-radius:10px}@media(max-width:700px){.cta{display:block}}', slots: { text: { title: 'Save <script>alert(1)</script> & more', cta: 'Shop Now' }, media: { back: { assetKey: 'hero' }, photo: { assetKey: 'hero', alt: 'Dog', responsive: [{ assetKey: 'mobile-hero', media: '(max-width:700px)' }] } }, links: { shop: { url: 'https://source.example/shop', isExternal: true } } } });
const program = (): ProgramV2 => ({ version: 2, workflow: 'block-replication', taskId: 'replica-test', title: 'Replica', sourceUrl: 'https://source.example/', sourceFacts: ref, componentPlan: ref, assetsManifest: ref, viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }, { name: 'mobile', width: 390, height: 844, stage: 'responsive' }], blocks: [html()] });

test('v2 compiles exact scoped HTML with text escaping, imported background and intact CTA style', () => {
  const result = compileReplicaV2(program(), schemas, [asset]);
  assert.equal(result.sections[0].key, 'promotion');
  const widget = result.composition.elements[0].elements[0];
  const content = String(widget.settings.html);
  assert.equal(widget.widgetType, 'html'); assert.match(content, /&lt;script&gt;/); assert.doesNotMatch(content, /<script>/);
  assert.match(content, /background-image:url/); assert.match(content, /background:#ffcb00;padding:12px 24px;border-radius:10px/);
  assert.match(content, /noopener noreferrer/); assert.equal(result.bindings.filter(binding => binding.assetKey === 'hero').length, 2);
  assertGeneratedHtmlProof(result.htmlProofs[0], widget.id, content);
});

test('v2 HTML proof cannot be copied, edited or used by another element', () => {
  const proof = renderStaticHTML(html(), 'task', 'abcdef1', [asset], 'desktop');
  assert.throws(() => assertGeneratedHtmlProof({ ...proof }, proof.elementId, proof.html), /exact current-process/);
  assert.throws(() => assertGeneratedHtmlProof(proof, 'abcdef2', proof.html), /exact current-process/);
  assert.throws(() => assertGeneratedHtmlProof(proof, proof.elementId, proof.html + 'x'), /exact current-process/);
  const injected = html(); injected.key = '\"><script>alert(1)</script>';
  assert.throws(() => renderStaticHTML(injected, 'task', 'abcdef1', [asset], 'desktop'), /identity/);
});

test('legacy and original shared planning path continues to reject unproved HTML', () => {
  const compiled = compileReplicaV2(program(), schemas, [asset]);
  assert.throws(() => validatePlan(compiled.plan, { mode: 'legacy-verified', widgetSchemas: schemas }), /forbidden|native controls/);
});

test('desktop compilation excludes responsive asset dependencies and sources', () => {
  const p = program();
  assert.deepEqual([...referencedAssetsV2(p)], ['hero']);
  assert.deepEqual([...referencedAssetsV2(p, 'responsive')], ['hero', 'mobile-hero']);
  const result = compileReplicaV2(p, schemas, [asset, mobile], undefined, 'responsive');
  assert.match(String(result.composition.elements[0].elements[0].settings.html), /<picture><source media="\(max-width:700px\)" srcset="https:\/\/target.example\/uploads\/mobile.png">/);
});

test('desktop native settings defer registered responsive background media and controls', () => {
  const p = program(), discovery = structuredClone(schemas);
  discovery.heading.controls.background_image = { type: 'media', responsive: { max: 'desktop' } };
  discovery.heading.controls.background_image_mobile = { type: 'media', responsive: { max: 'mobile' } };
  discovery.heading.controls.background_image_laptop = { type: 'media', responsive: { max: 'laptop' } };
  p.blocks = [{ key: 'native-background', kind: 'native', widgetType: 'heading', widgetSettings: { title: 'Source title', background_image: { $asset: 'hero' }, background_image_mobile: { $asset: 'mobile-hero' }, background_image_laptop: { $asset: 'mobile-hero' } } }];
  assert.deepEqual([...referencedAssetsV2(p, 'desktop', discovery)], ['hero']);
  const desktop = compileReplicaV2(p, discovery, [asset]);
  const settings = desktop.composition.elements[0].elements[0].settings;
  assert.equal(settings.background_image_mobile, undefined); assert.equal(settings.background_image_laptop, undefined);
  assert.throws(() => compileReplicaV2(p, discovery, [asset], undefined, 'responsive'), /Unresolved v2 asset/);
  const responsive = compileReplicaV2(p, discovery, [asset, mobile], undefined, 'responsive');
  assert.deepEqual(responsive.composition.elements[0].elements[0].settings.background_image_mobile, { id: 22, url: mobile.url });
});

test('registered control failures identify the exact component and widget', () => {
  const p = program(); p.blocks = [{ key: 'source-cta', kind: 'native', widgetType: 'heading', widgetSettings: { invented_setting: 'x' } }];
  assert.throws(() => compileReplicaV2(p, schemas, []), /V2 component source-cta, widget heading, element source-cta-native: Undiscovered setting heading.invented_setting/);
});

test('typed HTML rejects active code, unbound media, documents and lost or duplicate slots', () => {
  for (const template of ['<script></script>', '<iframe></iframe>', '<form></form>', '<html><body></body></html>', '<img src="https://source.example/x.png">', '<div onclick="evil()"></div>', '<div style="color:red"></div>']) {
    const block = html(); block.template = template; assert.throws(() => renderStaticHTML(block, 'task', 'abcdef1', [asset], 'desktop'));
  }
  const duplicate = html(); duplicate.template += '<p data-cwp-text="cta"></p>';
  assert.throws(() => renderStaticHTML(duplicate, 'task', 'abcdef1', [asset], 'desktop'), /repeated/);
  const missing = html(); delete missing.slots.text.title;
  assert.throws(() => renderStaticHTML(missing, 'task', 'abcdef1', [asset], 'desktop'), /Missing/);
  const voidText = html(); voidText.template = '<img data-cwp-text="title" data-cwp-media="photo">';
  assert.throws(() => renderStaticHTML(voidText, 'task', 'abcdef1', [asset], 'desktop'), /non-void element/);
});

test('v2 typed HTML preserves native mobile details disclosures without scripts or event attributes', () => {
  const block: HtmlStaticComponentV2 = { key: 'mobile-navigation', kind: 'html-static', template: '<nav><details open><summary data-cwp-text="label"></summary><a data-cwp-link="dog"><span data-cwp-text="dog"></span></a></details></nav>', css: 'details[open] > summary{color:#004cdb}', slots: { text: { label: 'Shop', dog: 'Dog' }, media: {}, links: { dog: { url: 'https://source.example/dog/' } } } };
  const proof = renderStaticHTML(block, 'task', 'abcdef1', [], 'responsive');
  assert.match(proof.html, /<details open=""><summary data-cwp-text="label">Shop<\/summary>/); assert.match(proof.html, /href="https:\/\/source.example\/dog\/"/);
  assert.deepEqual(proof.bindings.map(binding => [binding.kind, binding.slot]), [['text', 'label'], ['text', 'dog'], ['link', 'dog']]);
  assert.throws(() => validatePlan({ title: 'Legacy', mode: 'legacy-verified', compositionJson: JSON.stringify({ elements: [{ id: 'abcdef1', elType: 'widget', widgetType: 'html', settings: { html: proof.html }, elements: [] }] }), mappings: [], unsupported: [], rationale: '' }, { mode: 'legacy-verified', widgetSchemas: schemas }), /forbidden|native controls/);
  for (const template of ['<details ontoggle="evil()"><summary data-cwp-text="label"></summary></details>', '<summary data-cwp-text="label"></summary>', '<details><span data-cwp-text="label"></span></details>', '<details><summary></summary><summary data-cwp-text="label"></summary></details>', '<details open="false"><summary data-cwp-text="label"></summary></details>', '<div open data-cwp-text="label"></div>']) {
    const unsafe = { ...block, template, slots: { text: { label: 'Shop' }, media: {}, links: {} } }; assert.throws(() => renderStaticHTML(unsafe, 'task', 'abcdef1', [], 'responsive'));
  }
});

test('AST CSS scopes selectors inside media and prevents nested scope or sibling escapes', () => {
  const scoped = scopeStaticCSS('.card,.card h3{display:grid}@media(max-width:700px){:scope{display:block}}:is(:scope,.elsewhere){color:red}', 'cwp-root');
  assert.match(scoped, /#cwp-root \.card,#cwp-root \.card h3/); assert.match(scoped, /#cwp-root :is\(#cwp-root,\.elsewhere\)/);
  for (const css of ['body{margin:0}', '@import "https://other.example/x.css";', '.x{background:url(https://other.example/x.png)}', ':scope + .global{color:red}', '.x{behavior:evil}', '.x{width:e\\78pression(alert(1))}', '.x{b\\65havior:evil}', 'b\\6f dy{margin:0}']) assert.throws(() => scopeStaticCSS(css, 'cwp-root'));
});

test('v2 native CSS retains important theme-leaf overrides without opening legacy or global styles', () => {
  const input = 'selector .price .amount,selector .price bdi{color:#3d3935!important}@media(max-width:700px){selector .price bdi{font-size:14px!important}}';
  const result = validateNativeCSSV2(input, 'products-query');
  assert.match(result, /selector \.price \.amount,selector \.price bdi\{color:#3d3935!important\}/);
  assert.match(result, /@media\s*\(max-width:700px\)/); assert.doesNotMatch(result, /cwp-native/);
  assert.throws(() => validateScopedNativeCSS(input), /unsupported content/);
  const p = program(); p.blocks = [{ key: 'native-title', kind: 'native', widgetType: 'heading', widgetSettings: { title: 'Title', custom_css: input } }];
  assert.doesNotThrow(() => validateProgramV2(p));
  const discovery = structuredClone(schemas); discovery.heading.controls.custom_css = { type: 'code' };
  const compiled = compileReplicaV2(p, discovery, []); assert.match(String(compiled.composition.elements[0].elements[0].settings.custom_css), /!important/);
  for (const css of ['body{color:red!important}', '.global{color:red!important}', 'selector + .outside{color:red}', 'selector .x{background:url(https://foreign.example/x)}', 'selector .x{width:e\\78pression(alert(1))}', 'selector .x{b\\65havior:evil}', 'selector :global(.x){color:red}', 'selector selector{color:red}', 'selector .x{content:"$2.00"}', 'selector{counter-reset:clonewp-page-current 999}', 'selector .x{counter-increment:fake-pages}']) assert.throws(() => validateNativeCSSV2(css, 'products-query'));
  const unsafe = program(); unsafe.blocks = [{ key: 'unsafe-price', kind: 'native', settings: { custom_css: 'selector::after{content:"$2.00"}' }, widgetType: 'heading', widgetSettings: { title: 'Title' } }];
  assert.throws(() => validateProgramV2(unsafe), /V2 component unsafe-price.settings.custom_css: V2 native generated content/);
  unsafe.blocks[0].settings = {}; if (unsafe.blocks[0].kind !== 'native') throw Error('test'); unsafe.blocks[0].widgetSettings.custom_css = 'body{color:red!important}';
  assert.throws(() => validateProgramV2(unsafe), /V2 component unsafe-price.widgetSettings.custom_css: V2 native CSS selectors must begin/);
});

test('native carousel preserves mixed slide components and separate stable containers', () => {
  const p = program(); p.blocks = [{ key: 'hero-carousel', kind: 'native-carousel', widgetType: 'nested-carousel', widgetSettings: { slides_to_show: '1' }, slides: [html(), { key: 'double-image', kind: 'html-static', template: '<div class="pair"><img data-cwp-media="left"><img data-cwp-media="right"></div>', css: '.pair{display:grid;grid-template-columns:1fr 1fr}', slots: { text: {}, media: { left: { assetKey: 'hero' }, right: { assetKey: 'hero' } }, links: {} } }] }];
  const result = compileReplicaV2(p, schemas, [asset]);
  const carousel = result.composition.elements[0].elements[0];
  assert.equal(carousel.widgetType, 'nested-carousel'); assert.equal(carousel.elements.length, 2); assert.equal((carousel.settings.carousel_items as unknown[]).length, 2);
  assert.equal(result.htmlProofs.length, 2); assert.deepEqual(usedWidgetTypesV2(p), ['container', 'nested-carousel', 'html']);
});

test('composite header keeps promotion carousel and native title without collapsing header role', () => {
  const p = program(); p.blocks = [{ key: 'header', kind: 'composite', children: [{ key: 'brand', kind: 'native', widgetType: 'heading', widgetSettings: { title: 'Pet Supermarket' } }, { key: 'promotion-carousel', kind: 'native-carousel', widgetType: 'nested-carousel', widgetSettings: { slides_to_show: '1' }, slides: [html()] }] }];
  const result = compileReplicaV2(p, schemas, [asset]); assert.equal(result.sectionIds.length, 1); assert.equal(result.composition.elements[0].elements.length, 2);
});

test('real product rows freeze catalog ordering and reject overlap, shortage and forged IDs', () => {
  const p = program();
  p.blocks = [0, 1].map(index => ({ key: `products-${index}`, kind: 'native-products', widgetType: 'wd_products', widgetSettings: {}, query: { count: 2, offset: index * 2, evidence: ['catalog-current'] } }));
  const catalog = { targetOrigin: 'https://target.example', evidence: ['catalog-current'], products: [11, 12, 13, 14].map(id => ({ id, name: `Target ${id}`, permalink: `https://target.example/p/${id}`, imageUrl: asset.url })) };
  const result = compileReplicaV2(p, schemas, [], catalog); assert.deepEqual(result.queryReceipts.map(receipt => receipt.productIds), [[11, 12], [13, 14]]);
  if (p.blocks[1].kind !== 'native-products') throw Error('test'); p.blocks[1].query.offset = 0;
  assert.throws(() => compileReplicaV2(p, schemas, [], catalog), /Overlapping/);
  p.blocks[1].query.offset = 4; assert.throws(() => compileReplicaV2(p, schemas, [], catalog), /Insufficient/);
  p.blocks = [{ key: 'forged', kind: 'native-products', widgetType: 'wd_products', widgetSettings: {}, query: { count: 1, ids: [1001], evidence: ['catalog-current'] } }]; assert.throws(() => compileReplicaV2(p, schemas, [], catalog), /Insufficient/);
  p.blocks = [{ key: 'explicit', kind: 'native-products', widgetType: 'wd_products', widgetSettings: {}, query: { count: 2, ids: [14, 11], evidence: ['catalog-current'] } }];
  assert.throws(() => compileReplicaV2(p, schemas, [], catalog), /catalog date-descending order/);
  if (p.blocks[0].kind !== 'native-products') throw Error('test'); p.blocks[0].query.ids = [11, 14];
  const explicit = compileReplicaV2(p, schemas, [], catalog); assert.deepEqual(explicit.queryReceipts[0].productIds, [11, 14]); assert.equal(explicit.queryReceipts[0].settings.orderby, 'date'); assert.equal(explicit.queryReceipts[0].settings.order, undefined);
  p.blocks[0].widgetSettings.order = 'DESC'; assert.throws(() => compileReplicaV2(p, schemas, [], catalog), /inactive native sort-order/);
  p.blocks[0].widgetSettings.order = ''; assert.doesNotThrow(() => compileReplicaV2(p, schemas, [], catalog));
});

test('invalid versions, truncated evidence, duplicate keys and generic HTML or product bypass fail locally', () => {
  const p = program(); assert.throws(() => validateProgramV2({ ...p, version: 1 }));
  assert.throws(() => validateProgramV2({ ...p, title: '[MaxDepth]' }), /Truncated/);
  assert.throws(() => validateProgramV2({ ...p, blocks: [html(), html()] }), /Duplicate/);
  for (const widgetType of ['html', 'wd_products', 'nested-carousel']) assert.throws(() => validateProgramV2({ ...p, blocks: [{ key: 'bypass', kind: 'native', widgetType, widgetSettings: {} }] }), /explicit/);
});

test('preflight proves registered controls without exposing synthetic assets or write composition', () => {
  const receipt = preflightReplicaV2(program(), schemas);
  assert.deepEqual(receipt.symbolicAssets, ['hero']); assert.equal(receipt.passed, true);
  assert.deepEqual(Object.keys(receipt).sort(), ['components', 'passed', 'symbolicAssets', 'usedTypes', 'version']);
  const bad = program(); if (bad.blocks[0].kind !== 'html-static') throw Error('test'); bad.blocks[0].css = '.x{background:url(https://unapproved.example/a.png)}';
  assert.throws(() => validateProgramV2(bad), /typed background/);
  assert.throws(() => preflightReplicaV2(program(), { ...schemas, html: { ...schemas.html, controls: {} } }), /Undiscovered setting/);
});

test('WordPress shared writer validates exact v2 proof and keeps unproved or forged HTML rejected', () => {
  const client = new WordPressClient({ targetUrl: 'https://target.example', username: 'fixture', applicationPassword: 'fixture' });
  const testing = client as unknown as { capabilities: { legacySchemas: typeof schemas }; validateLegacy: (elements: unknown[], proofs?: unknown[]) => void };
  testing.capabilities = { legacySchemas: schemas };
  const compiled = compileReplicaV2(program(), schemas, [asset]);
  assert.doesNotThrow(() => testing.validateLegacy(compiled.composition.elements, compiled.htmlProofs));
  assert.throws(() => testing.validateLegacy(compiled.composition.elements), /exact current-process/);
  assert.throws(() => testing.validateLegacy(compiled.composition.elements, structuredClone(compiled.htmlProofs)), /exact current-process/);
  const edited = structuredClone(compiled.composition.elements); edited[0].elements[0].settings.html += '<script>oops()</script>';
  assert.throws(() => testing.validateLegacy(edited, compiled.htmlProofs), /exact current-process/);
});

test('HTML restoration requires an exact prior server read or recompiled proof, not a forged snapshot hash', async () => {
  const compiled = compileReplicaV2(program(), schemas, [asset]);
  const snapshot: DraftSnapshot = { pageId: 42, runId: 'owned-run', title: 'Fixture', status: 'draft', elements: compiled.composition.elements, settings: {}, hash: documentHashV2(compiled.composition.elements, {}) };
  const client = new WordPressClient({ targetUrl: 'https://target.example', username: 'fixture', applicationPassword: 'fixture' });
  const testing = client as unknown as { ownedPages: Map<number, string>; capabilities: { legacySchemas: typeof schemas }; php: (code: string) => Promise<unknown> };
  testing.ownedPages.set(42, 'owned-run'); testing.capabilities = { legacySchemas: schemas };
  let writes = 0, actual = structuredClone(snapshot);
  testing.php = async code => {
    if (code.includes('$input=json_decode')) { writes++; const encoded = code.match(/\$input=json_decode\(base64_decode\('([^']+)'\)/)![1]; const input = JSON.parse(Buffer.from(encoded, 'base64').toString()); actual = { ...actual, elements: input.elements, settings: input.settings }; return true; }
    return structuredClone(actual);
  };
  await assert.rejects(client.restoreDraft(42, snapshot, { expectedCurrent: actual }), /exact server-read snapshot/);
  assert.equal(writes, 0);
  await assert.rejects(client.restoreDraft(42, snapshot, { expectedCurrent: actual, htmlProofs: structuredClone(compiled.htmlProofs) }), /exact server-read snapshot/);
  assert.equal(writes, 0);
  const restoredByProof = await client.restoreDraft(42, snapshot, { expectedCurrent: actual, htmlProofs: compiled.htmlProofs });
  assert.equal(restoredByProof.hash, snapshot.hash); assert.equal(writes, 1);
  // A new client has no process-local compiler capability. Its actual server read
  // still permits restoring that unchanged baseline after temporary editor tests.
  const resumed = new WordPressClient({ targetUrl: 'https://target.example', username: 'fixture', applicationPassword: 'fixture' });
  const resumedTesting = resumed as unknown as typeof testing;
  resumedTesting.ownedPages.set(42, 'owned-run'); resumedTesting.capabilities = { legacySchemas: schemas }; resumedTesting.php = testing.php;
  const read = await resumed.snapshotDraft(42); assert.equal(read.hash, snapshot.hash);
  await assert.doesNotReject(resumed.restoreDraft(42, structuredClone(read), { expectedCurrent: read }));
  const forged = structuredClone(read); forged.elements[0].elements[0].settings.html += '<script>bad()</script>'; forged.hash = documentHashV2(forged.elements, forged.settings);
  await assert.rejects(resumed.restoreDraft(42, forged, { expectedCurrent: read }), /exact server-read snapshot/);
});
