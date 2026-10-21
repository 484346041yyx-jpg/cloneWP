import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBlockBindings, sourceVisibleText } from '../src/fidelity/check.js';
import { blockContractSchema, validateNativeProgram } from '../src/fidelity/validate.js';
import { catalogRenderProblems, isVerifiedCatalogCarousel, validateCatalogSourceOwnership, validateTargetCatalogBindings, type CatalogRenderEvidence } from '../src/fidelity/catalog-contract.js';
import { verifyFidelity } from '../src/fidelity/verify.js';
import type { BlockContract, NativeProgram, SourceAssetManifest } from '../src/fidelity/types.js';
import type { TargetElementEvidence, TargetViewportEvidence } from '../src/verification/types.js';

const none = { status: 'not-applicable' as const, evidence: [] };
function fixture() {
  const contract: BlockContract = {
    version: 1, workflow: 'block-replication', sourceUrl: 'https://8.8.8.8/', capturedAt: '2026-10-13T09:30:00Z',
    referenceReport: { path: 'source.json', sha256: '0'.repeat(64) }, evidence: [{ id: 'source-dom', path: 'desktop.json', sha256: '0'.repeat(64), kind: 'dom' }],
    tolerances: { geometryPx: 20, geometryRatio: .15, colorChannel: 4 }, limitations: [],
    blocks: [{ id: 'catalog', role: 'products', presentation: 'carousel', requiredWidgetTypes: ['wd_products'],
      texts: [{ id: 'section-title', text: 'Top Deals', kind: 'heading' }, { id: 'shop-all', text: 'Shop All', kind: 'label' }, { id: 'source-name', text: 'Source product', kind: 'product-name' }, { id: 'source-price', text: '$5.99', kind: 'price' }, { id: 'source-offer', text: 'Source item deal', kind: 'label' }],
      assets: ['source-photo'], evidence: ['source-dom'], geometry: { desktop: { width: 1440, height: 300, columns: 5 } },
      contentBounds: { desktop: { x: 20, width: 1400, viewportWidth: 1440, sourceNodeId: 'source-content', evidence: ['source-dom'] } },
      dynamicData: { provider: 'target-woocommerce', kind: 'product-list', replaceableTextIds: ['source-name', 'source-price', 'source-offer'], replaceableAssetKeys: ['source-photo'], items: [{ sourceNodeId: '#source-slide-1', textIds: ['source-name', 'source-price', 'source-offer'], assetKeys: ['source-photo'], evidence: ['source-dom'] }], evidence: ['source-dom'] },
      colors: {}, states: { normal: none, hover: none, interaction: { status: 'observed', evidence: ['source-dom'], properties: { slideCount: 11, visibleSlides: 5, nextChangesSlide: true } } } }],
  };
  const program: NativeProgram = {
    version: 1, workflow: 'block-replication', title: 'Native target products', sourceUrl: contract.sourceUrl,
    sourceContract: { path: 'contract.json', sha256: '0'.repeat(64) }, assetsManifest: { path: 'manifest.json', sha256: '0'.repeat(64) }, deviations: [],
    elements: [{ key: 'catalog-root', type: 'container', settings: {}, children: [{ key: 'section-title', type: 'heading', settings: { title: 'Top Deals' } }, { key: 'shop-all', type: 'heading', settings: { title: 'Shop All' } }, { key: 'own-query', type: 'wd_products', settings: { post_type: 'product', layout: 'carousel', items_per_page: 8 } }] }],
    blocks: [{ sourceBlockId: 'catalog', rootKey: 'catalog-root', presentation: 'carousel', contentBindings: { desktop: 'own-query' },
      productQuery: { provider: 'target-woocommerce', widgetKey: 'own-query', widgetType: 'wd_products', sourceTextIds: ['source-name', 'source-price', 'source-offer'], sourceAssetKeys: ['source-photo'], queryControlKeys: ['post_type', 'items_per_page'], carouselMode: { control: 'layout', value: 'carousel' }, evidence: ['source-dom'] },
      bindings: [{ sourceTextId: 'section-title', elementKey: 'section-title', settingPath: 'title' }, { sourceTextId: 'shop-all', elementKey: 'shop-all', settingPath: 'title' }], states: contract.blocks[0].states }],
  };
  const manifest: SourceAssetManifest = { version: 1, sourceUrl: contract.sourceUrl, downloadedAt: contract.capturedAt, assets: [{ key: 'source-photo', sourceUrl: 'https://8.8.8.8/source.png', localPath: 'source.png', sha256: '0'.repeat(64), alt: 'Source product', mediaType: 'image/png', provenance: 'Captured source item image proof' }] };
  const sourceEvidence = new Map<string, unknown>([['source-dom', { blocks: [{ id: 'catalog', carousels: [{ slides: [{ selector: '#source-slide-1', atoms: [{ text: 'Source product' }, { text: '$5.99' }, { text: 'Source item deal' }], images: [{ url: manifest.assets[0].sourceUrl }] }] }] }] }]]);
  return { contract, program, manifest, sourceEvidence };
}
function browser(value: ReturnType<typeof fixture>) {
  const element = (sourceId: string, text: string, widgetType?: string): TargetElementEvidence => ({ sourceId, targetId: sourceId, selector: `[data-id="${sourceId}"]`, found: true, count: 1, nativeElement: true, visible: true, text, widgetType, rect: { x: sourceId === 'catalog-root' ? 0 : 20, y: 0, width: sourceId === 'catalog-root' ? 1440 : 1400, height: 300 }, style: {}, images: [] });
  const products = [{ id: 17, name: 'Own product', permalink: 'https://target.example/product/own/', imageUrl: 'https://target.example/own.png', priceText: '$24.99' }];
  const render: CatalogRenderEvidence = { viewport: 'desktop', blockId: 'catalog', widgetKey: 'own-query', widgetType: 'wd_products', elementId: 'own-query', evidence: ['browser-products.json'], catalog: { targetOrigin: 'https://target.example', evidence: ['target-catalog.json'], products: structuredClone(products) }, products,
    carousel: { selector: '[data-id="own-query"] .wd-carousel', initialized: true, visibleColumns: 5, nextChanged: true, slideCount: 8, loop: false, cardWidth: 260 } };
  const view: TargetViewportEvidence = { name: 'desktop', width: 1440, height: 900, url: 'https://target.example/?preview=true', title: 'Native draft', pageHeight: 300, screenshotPath: 'actual.png', evidencePath: 'actual.json', elements: [element('catalog-root', ''), element('section-title', 'Top Deals', 'heading'), element('shop-all', 'Shop All', 'heading'), element('own-query', 'Own product $24.99', 'wd_products')], overflow: [], clipping: [], imageFailures: [], consoleErrors: [], pageErrors: [], responseStatus: 200 };
  const states = [{ viewport: 'desktop', blockId: 'catalog', state: 'interaction' as const, status: 'verified' as const, properties: { slideCount: 8, visibleSlides: 5, nextChangesSlide: true }, evidence: ['actual-next-click.json'] }];
  return { render, view, states, binding: validateTargetCatalogBindings(value.contract, value.program).get('catalog')! };
}

test('native target query replaces only item data while all source headings, order and media proof stay strict', () => {
  const value = fixture(); assert.doesNotThrow(() => blockContractSchema.parse(value.contract)); assert.doesNotThrow(() => validateNativeProgram(value.program));
  assert.equal(validateBlockBindings(value.contract, value.program, value.manifest).textBindings, 2);
  assert.doesNotThrow(() => validateCatalogSourceOwnership(value.contract, value.manifest, value.sourceEvidence, sourceVisibleText));
  value.program.elements[0].children![0].settings.title = 'Changed title';
  assert.throws(() => validateBlockBindings(value.contract, value.program, value.manifest), /rewritten or omitted: section-title/);
});
test('product displays have no source snapshot or hand-made card fallback', () => {
  const value = fixture(); delete value.program.blocks[0].productQuery;
  assert.throws(() => validateBlockBindings(value.contract, value.program, value.manifest), /requires a native target WooCommerce query/);
});
test('catalog replacement cannot authorize static headings, navigation or arbitrary subsets', () => {
  for (const id of ['section-title', 'unknown-source-text']) {
    const value = fixture(); value.contract.blocks[0].dynamicData!.replaceableTextIds.push(id); value.contract.blocks[0].dynamicData!.items[0].textIds.push(id); value.program.blocks[0].productQuery!.sourceTextIds.push(id);
    assert.throws(() => validateBlockBindings(value.contract, value.program, value.manifest), /heading, navigation or foreign text/);
  }
  const value = fixture(); value.program.blocks[0].productQuery!.sourceTextIds.pop(); assert.throws(() => validateBlockBindings(value.contract, value.program, value.manifest), /replacement sets differ/);
});
test('native query mount, provider, explicit controls and carousel mode must match their own block', () => {
  const edits = [(p: NativeProgram) => p.blocks[0].productQuery!.widgetKey = 'foreign-query', (p: NativeProgram) => p.elements[0].children![2].type = 'nested-carousel', (p: NativeProgram) => p.elements[0].children![2].settings.layout = 'grid', (p: NativeProgram) => delete p.elements[0].children![2].settings.items_per_page];
  for (const edit of edits) { const value = fixture(); edit(value.program); assert.throws(() => validateBlockBindings(value.contract, value.program, value.manifest), /native product widget|exact native mode|explicit native setting/); }
});
test('replaced source product pictures cannot remain mounted behind a native query', () => {
  const value = fixture(); value.program.elements[0].children!.push({ key: 'old-photo', type: 'image', settings: { image: { $asset: 'source-photo' } } });
  assert.throws(() => validateBlockBindings(value.contract, value.program, value.manifest), /cannot keep source product media mounted/);
});
test('actual item ownership refuses a Shop All label outside repeated source cards', () => {
  const value = fixture(); const data = value.contract.blocks[0].dynamicData!; data.replaceableTextIds.push('shop-all'); data.items[0].textIds.push('shop-all'); value.program.blocks[0].productQuery!.sourceTextIds.push('shop-all'); value.program.blocks[0].bindings.pop();
  assert.throws(() => validateCatalogSourceOwnership(value.contract, value.manifest, value.sourceEvidence, sourceVisibleText), /outside its evidenced repeated item.*shop-all/);
});
test('source item ownership cannot cross blocks or swap unrelated assets', () => {
  const value = fixture(); (value.sourceEvidence.get('source-dom') as { blocks: Array<{ id: string }> }).blocks[0].id = 'footer';
  assert.throws(() => validateCatalogSourceOwnership(value.contract, value.manifest, value.sourceEvidence, sourceVisibleText), /no observed repeated-item ownership/);
  const second = fixture(); second.manifest.assets[0].sourceUrl = 'https://8.8.8.8/foreign.png'; assert.throws(() => validateCatalogSourceOwnership(second.contract, second.manifest, second.sourceEvidence, sourceVisibleText), /media is outside/);
});
test('real target products pass even with different source item names, prices and counts', () => {
  const value = fixture(), actual = browser(value), report = verifyFidelity(value.contract, value.program, [actual.view], actual.states, [actual.render]);
  assert.equal(report.structurePassed, true); assert.equal(report.passed, false); assert.equal(report.presentationDetails.status, 'needs-review'); assert.equal(report.coverage[0].expectedTexts, 2); assert.equal(report.productChecks![0].status, 'verified'); assert.equal(report.productChecks![0].replacedSourceTexts, 3);
});
test('source or fabricated products cannot impersonate existing target WooCommerce records', () => {
  for (const edit of [(r: CatalogRenderEvidence) => r.products[0].id = 999, (r: CatalogRenderEvidence) => r.products[0].permalink = 'https://8.8.8.8/source-product/', (r: CatalogRenderEvidence) => r.products[0].imageUrl = 'https://8.8.8.8/source.png', (r: CatalogRenderEvidence) => r.products[0].priceText = '$5.99']) {
    const value = fixture(), actual = browser(value); edit(actual.render); assert.ok(catalogRenderProblems(actual.binding, actual.render, actual.view.elements[3]).length);
    assert.ok(verifyFidelity(value.contract, value.program, [actual.view], actual.states, [actual.render]).issues.some(issue => issue.code === 'target-product-provenance'));
  }
});
test('native widget name and requested mode do not substitute for initialized browser carousel evidence', () => {
  const value = fixture(), actual = browser(value); actual.render.carousel!.initialized = false;
  assert.equal(isVerifiedCatalogCarousel(actual.binding, actual.render, actual.view.elements[3]), false);
  assert.ok(verifyFidelity(value.contract, value.program, [actual.view], actual.states, [actual.render]).issues.some(issue => issue.code === 'native-carousel-missing'));
});
test('exact captured Elementor default-skin encoding retains strict native widget identity and runtime proof', () => {
  const value = fixture(), actual = browser(value), element = actual.view.elements[3]; element.widgetType = 'wd_products.default';
  assert.deepEqual(catalogRenderProblems(actual.binding, actual.render, element), []); assert.equal(isVerifiedCatalogCarousel(actual.binding, actual.render, element), true);
  for (const type of ['wd_products.unknown', 'wd_products.default.forged', 'unknown.wd_products', 'nested-carousel.default']) {
    element.widgetType = type; assert.ok(catalogRenderProblems(actual.binding, actual.render, element).some(problem => problem.includes('unique native widget'))); assert.equal(isVerifiedCatalogCarousel(actual.binding, actual.render, element), false);
  }
  element.widgetType = 'wd_products.default'; element.targetId = 'foreign-id'; assert.ok(catalogRenderProblems(actual.binding, actual.render, element).length);
  element.targetId = actual.render.elementId; element.count = 2; assert.ok(catalogRenderProblems(actual.binding, actual.render, element).length);
});
test('product carousel source columns and actual Next behavior remain strict', () => {
  const value = fixture(), actual = browser(value); actual.render.carousel!.visibleColumns = 4; actual.states[0].properties.nextChangesSlide = false;
  const report = verifyFidelity(value.contract, value.program, [actual.view], actual.states, [actual.render]);
  assert.ok(report.issues.some(issue => issue.code === 'product-carousel-columns')); assert.ok(report.issues.some(issue => issue.code === 'state-property'));
});
test('missing target catalog evidence or a different measured target origin cannot pass', () => {
  const value = fixture(), actual = browser(value); assert.equal(verifyFidelity(value.contract, value.program, [actual.view], actual.states).passed, false);
  actual.view.url = 'https://another-target.example/'; assert.ok(verifyFidelity(value.contract, value.program, [actual.view], actual.states, [actual.render]).issues.some(issue => issue.code === 'target-product-provenance'));
});
