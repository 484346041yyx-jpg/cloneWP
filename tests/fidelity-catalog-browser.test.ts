import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { collectNativeCatalogRender } from '../src/fidelity/catalog-browser.js';
import { catalogRenderProblems, isVerifiedCatalogCarousel, type CatalogBinding, type TargetCatalogEvidence } from '../src/fidelity/catalog-contract.js';
import type { TargetElementEvidence } from '../src/verification/types.js';
import type { TargetViewportEvidence } from '../src/verification/types.js';
import type { BlockContract, NativeProgram } from '../src/fidelity/types.js';
import { compareBoundTextPaint, type SourceTextPaintPacket } from '../src/fidelity/text-paint.js';

let browser: Browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser.close(); });
const origin = 'https://target.example';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=', 'base64');
const catalog = (): TargetCatalogEvidence => ({ targetOrigin: origin, evidence: ['real-local-wc-fixture.json'], products: [{ id: 17, name: 'Own Food & Care', permalink: `${origin}/product/own/`, imageUrl: `${origin}/own.png`, imageVariants: [`${origin}/own-430.png`], priceText: '$24.99 – $119.99Price range: $24.99 through $119.99' }] });
const card = (options: { id?: number; name?: string; href?: string; image?: string; price?: string; extraClass?: string } = {}) => `<div class="product-grid-item product ${options.extraClass ?? ''}" data-id="${options.id ?? 17}"><div class="product-wrapper"><div class="product-element-top"><a class="product-image-link" href="${options.href ?? `${origin}/product/own/`}"><img src="${options.image ?? `${origin}/own-430.png`}" alt="Actual product photograph"></a></div><div class="product-element-bottom"><h3 class="wd-entities-title woocommerce-loop-product__title"><a href="${options.href ?? `${origin}/product/own/`}">${options.name ?? 'Own Food &amp; Care'}</a></h3><span class="price">${options.price ?? '<span class="woocommerce-Price-amount amount"><bdi>$24.99</bdi></span> – <span class="woocommerce-Price-amount amount"><bdi>$119.99</bdi></span><span class="screen-reader-text">Price range: $24.99 through $119.99</span>'}</span></div></div></div>`;
const root = (content: string) => `<div class="elementor-element elementor-element-abcdef0 elementor-widget elementor-widget-wd_products" data-id="abcdef0" data-element_type="widget" data-widget_type="wd_products.default"><div class="elementor-widget-container"><div class="wd-products products">${content}</div></div></div>`;
async function fixture(t: TestContext, content = card()): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }); t.after(async () => { await page.close(); });
  // Every response is fulfilled from this fixture; it never accesses the target site.
  await page.route('**/*', async route => {
    if (route.request().isNavigationRequest()) await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><style>.product-grid-item{display:inline-block;width:200px}.product-grid-item img{width:160px;height:160px}.screen-reader-text{position:absolute;left:-10000px}</style></head><body>${root(content)}<script>Object.defineProperty(globalThis,'__name',{value:(target)=>target,configurable:true});</script></body></html>` });
    else await route.fulfill({ status: 200, contentType: 'image/png', body: png });
  });
  await page.goto(`${origin}/owned-draft/`, { waitUntil: 'load' }); return page;
}
const nativeElement = (): TargetElementEvidence => ({ sourceId: 'own-products', targetId: 'abcdef0', selector: '[data-id="abcdef0"]', found: true, count: 1, nativeElement: true, visible: true, widgetType: 'wd_products', text: '', rect: { x: 0, y: 0, width: 1000, height: 300 }, style: {}, images: [] });
const binding = (): CatalogBinding => ({ query: { provider: 'target-woocommerce', widgetKey: 'own-products', widgetType: 'wd_products', sourceTextIds: ['old-name'], sourceAssetKeys: ['old-photo'], queryControlKeys: ['post_type'], carouselMode: { control: 'layout', value: 'carousel' }, evidence: ['source-dom'] }, node: { key: 'own-products', type: 'wd_products', settings: { post_type: 'product', layout: 'carousel' } }, textIds: new Set(['old-name']), assetKeys: new Set(['old-photo']) });
const collect = (page: Page, actualCatalog = catalog(), carouselExpected = false) => collectNativeCatalogRender({ page, blockId: 'catalog', widgetKey: 'own-products', elementId: 'abcdef0', viewport: 'desktop', catalog: actualCatalog, carouselExpected });

test('native catalog browser reads actual own product IDs, name, image variant, target href and complete price text', async t => {
  const page = await fixture(t), result = await collect(page);
  assert.equal(result.products.length, 1); assert.equal(result.products[0].id, 17); assert.equal(result.products[0].name, 'Own Food & Care');
  assert.equal(result.products[0].permalink, `${origin}/product/own/`); assert.equal(result.products[0].imageUrl, `${origin}/own-430.png`);
  assert.equal(result.products[0].priceText, catalog().products[0].priceText); assert.ok(result.evidence.length);
  const layout = result.products[0].cardLayout!;
  assert.equal(layout.rect.width, 200); assert.equal(layout.visibleFraction, 1); assert.ok(layout.evidence?.length);
  assert.ok(layout.slots.every(slot => slot.domPath.startsWith('html'))); assert.ok(layout.slots.some(slot => slot.role === 'image' && slot.rect.width === 160));
  assert.ok(layout.slots.some(slot => slot.role === 'name')); assert.ok(layout.slots.some(slot => slot.role === 'price'));
  assert.deepEqual(catalogRenderProblems(binding(), result, nativeElement()), []);
});
test('catalog provenance never supplies missing or mismatching DOM product fields', async t => {
  const cases = [{ id: 999 }, { name: 'Foreign source product' }, { href: 'https://source.example/product/copied/' }, { image: 'https://source.example/source.png' }, { price: '$5.99' }];
  for (const changed of cases) {
    const page = await fixture(t, card(changed)), result = await collect(page);
    assert.equal(result.products.length, 1);
    if (changed.id) assert.equal(result.products[0].id, changed.id);
    if (changed.name) assert.equal(result.products[0].name, changed.name);
    if (changed.href) assert.equal(result.products[0].permalink, changed.href);
    if (changed.image) assert.equal(result.products[0].imageUrl, changed.image);
    if (changed.price) assert.equal(result.products[0].priceText, changed.price);
    assert.ok(catalogRenderProblems(binding(), result, nativeElement()).length);
  }
});
test('missing own product image or actual price is not backfilled from WooCommerce evidence', async t => {
  const page = await fixture(t); await page.locator('.product-grid-item img').evaluate(node => node.remove()); await page.locator('.price').evaluate(node => node.remove());
  const result = await collect(page); assert.equal(result.products[0]?.imageUrl ?? '', ''); assert.equal(result.products[0]?.priceText ?? '', '');
  assert.ok(catalogRenderProblems(binding(), result, nativeElement()).length);
});
test('an unrelated product card outside the exact native widget is never captured', async t => {
  const page = await fixture(t); await page.evaluate(html => { document.body.insertAdjacentHTML('beforeend', html); }, card({ id: 999, name: 'Unrelated footer card' }));
  const result = await collect(page); assert.deepEqual(result.products.map(product => product.id), [17]);
});
test('duplicate or wrong native widget identity cannot generate a unique own-products proof', async t => {
  const page = await fixture(t); await page.evaluate(() => { const root = document.querySelector('[data-widget_type="wd_products.default"]')!; document.body.append(root.cloneNode(true)); });
  await assert.rejects(collect(page), /unique|duplicate|native|widget/i);
  const wrong = await fixture(t); await wrong.locator('[data-id="abcdef0"]').evaluate(node => node.setAttribute('data-widget_type', 'nested-carousel.default'));
  await assert.rejects(collect(wrong), /native|widget|missing|unique/i);
});
test('a requested carousel without actual initialized runtime is an honest failure', async t => {
  const page = await fixture(t), result = await collect(page, catalog(), true);
  assert.equal(result.carousel?.initialized ?? false, false); assert.equal(isVerifiedCatalogCarousel(binding(), result, nativeElement()), false);
});
test('actual DOM products still cannot pass when target catalog provenance is unavailable', async t => {
  const page = await fixture(t), proof = catalog(); proof.evidence = [];
  const result = await collect(page, proof); assert.equal(result.products[0].name, 'Own Food & Care');
  assert.ok(catalogRenderProblems(binding(), result, nativeElement()).length);
});

test('actual catalog role paint comes from visible glyphs rather than the price wrapper or fabricated catalog styles', async t => {
  const page = await fixture(t);
  await page.addStyleTag({ content: '.price{color:rgb(153,153,153);font-size:12px;font-weight:400;line-height:18px}.price bdi{color:rgb(189,18,17);font-size:16px;font-weight:550;line-height:24px}.wd-entities-title a{color:rgb(110,98,89);font-size:16px;line-height:20px;font-weight:700}' });
  const proof = catalog(); Object.assign(proof.products[0], { namePaint: { color: '#00ff00', fontSize: '99px' }, pricePaint: { color: '#00ff00', fontSize: '99px' } });
  const result = await collect(page, proof), product = result.products[0];
  assert.equal(product.namePaint?.color, 'rgb(110, 98, 89)'); assert.equal(product.namePaint?.fontSize, '16px'); assert.equal(product.namePaint?.fontWeight, '700');
  assert.equal(product.pricePaint?.color, 'rgb(189, 18, 17)'); assert.equal(product.pricePaint?.fontSize, '16px'); assert.equal(product.pricePaint?.fontWeight, '550'); assert.equal(product.pricePaint?.lineHeight, '24px');
  assert.ok(product.pricePaint?.domPath?.endsWith('bdi:nth-of-type(1)')); assert.equal(product.onSale, false);
});
test('current and crossed-out sale prices keep separate actual DOM paint and a native card sale state', async t => {
  const page = await fixture(t, card({ price: '<del><span class="amount"><bdi>$29.99</bdi></span></del><ins><span class="amount"><bdi>$24.99</bdi></span></ins>', extraClass: 'sale' }));
  await page.addStyleTag({ content: '.price{color:rgb(23,23,23)}.price del bdi{color:rgb(153,153,153);font-size:16px;line-height:24px}.price ins bdi{color:rgb(189,18,17);font-size:16px;line-height:24px}' });
  const result = await collect(page), product = result.products[0]; assert.equal(product.onSale, true); assert.equal(product.pricePaint?.priceState, 'sale'); assert.equal(product.pricePaint?.color, 'rgb(189, 18, 17)');
  assert.ok(product.pricePaint?.parts?.some(part => part.priceState === 'old' && part.color === 'rgb(153, 153, 153)'));
});
test('missing native role nodes produce no paint fields instead of filling source or catalog style values', async t => {
  const page = await fixture(t); await page.locator('.price').evaluate(node => node.remove()); await page.locator('.wd-entities-title').evaluate(node => node.remove());
  const result = await collect(page); assert.equal(result.products[0].pricePaint, undefined); assert.equal(result.products[0].namePaint, undefined);
});

test('text paint exempts only declared catalog item data and preserves exact static heading checks with an explicit replacement receipt', () => {
  const none = { status: 'not-applicable' as const, evidence: [] }, query = binding().query;
  const contract: BlockContract = { version: 1, workflow: 'block-replication', sourceUrl: 'https://8.8.8.8/', capturedAt: '2026-10-13T09:30:00Z', referenceReport: { path: 'source.json', sha256: '0'.repeat(64) }, evidence: [{ id: 'source-dom', path: 'desktop.json', sha256: '0'.repeat(64), kind: 'dom' }], tolerances: { geometryPx: 20, geometryRatio: .15, colorChannel: 4 }, limitations: [], blocks: [{ id: 'catalog', role: 'products', presentation: 'carousel', texts: [{ id: 'static-title', text: 'Top Deals', kind: 'heading' }, { id: 'old-name', text: 'Old product', kind: 'product-name' }], assets: ['old-photo'], evidence: ['source-dom'], geometry: { desktop: { width: 1200, height: 300, columns: 5 } }, dynamicData: { provider: 'target-woocommerce', kind: 'product-list', replaceableTextIds: ['old-name'], replaceableAssetKeys: ['old-photo'], items: [{ sourceNodeId: '#source-slide', textIds: ['old-name'], assetKeys: ['old-photo'], evidence: ['source-dom'] }], evidence: ['source-dom'] }, colors: {}, states: { normal: none, hover: none, interaction: none } }] };
  const program: NativeProgram = { version: 1, workflow: 'block-replication', title: 'Own products', sourceUrl: contract.sourceUrl, sourceContract: { path: 'source.json', sha256: '0'.repeat(64) }, assetsManifest: { path: 'assets.json', sha256: '0'.repeat(64) }, deviations: [], elements: [{ key: 'catalog-root', type: 'container', settings: {}, children: [{ key: 'static-title', type: 'heading', settings: { title: 'Top Deals' } }, binding().node] }], blocks: [{ sourceBlockId: 'catalog', rootKey: 'catalog-root', presentation: 'carousel', bindings: [{ sourceTextId: 'static-title', elementKey: 'static-title', settingPath: 'title' }], productQuery: query, states: contract.blocks[0].states }] };
  const heading: TargetElementEvidence = { ...nativeElement(), sourceId: 'static-title', targetId: '1111111', widgetType: 'heading', text: 'Top Deals', style: { color: 'rgb(42,42,42)' } };
  const view: TargetViewportEvidence = { name: 'desktop', width: 1200, height: 800, url: origin, title: 'Draft', pageHeight: 300, screenshotPath: 'actual.png', evidencePath: 'actual.json', elements: [heading], overflow: [], clipping: [], imageFailures: [], consoleErrors: [], pageErrors: [], responseStatus: 200 };
  const packets: SourceTextPaintPacket[] = [{ evidenceId: 'source-dom', evidencePath: 'source.json', viewport: 'desktop', blocks: [{ id: 'catalog', textAtoms: [{ selector: 'h2', tag: 'h2', text: 'Top Deals', visible: true, rect: { width: 200, height: 40 }, style: { color: 'rgb(42,42,42)' } }, { selector: '#source-slide .name', text: 'Old product', visible: true, rect: { width: 200, height: 40 }, style: { color: 'rgb(255,0,0)' } }] }] }];
  const report = compareBoundTextPaint(contract, program, [view], packets);
  assert.equal(report.passed, true); assert.equal(report.counts.expected, 1); assert.deepEqual(report.checks.map(check => check.sourceTextId), ['static-title']);
  assert.deepEqual(report.catalogReplacements, [{ blockId: 'catalog', widgetKey: 'own-products', sourceTextIds: ['old-name'] }]);
  heading.style.color = 'rgb(255,0,0)'; assert.equal(compareBoundTextPaint(contract, program, [view], packets).counts.errors, 1);
  contract.blocks[0].dynamicData!.replaceableTextIds.push('static-title'); contract.blocks[0].dynamicData!.items[0].textIds.push('static-title'); query.sourceTextIds.push('static-title');
  assert.throws(() => compareBoundTextPaint(contract, program, [view], packets), /heading, navigation or foreign text/);
});
