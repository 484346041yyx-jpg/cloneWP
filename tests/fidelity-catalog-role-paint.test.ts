import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCatalogRolePaint, catalogRenderProblems, catalogCardLayoutProblems, type CatalogRenderEvidence, type CatalogRolePaint, type CatalogCardLayout } from '../src/fidelity/catalog-contract.js';
import type { PresentationCatalogTemplate } from '../src/fidelity/presentation-contract.js';
import type { BlockContract, NativeProgram } from '../src/fidelity/types.js';
import type { SourcePaintAtom, SourceTextPaintPacket } from '../src/fidelity/text-paint.js';

const none = { status: 'not-applicable' as const, evidence: [] };
const paint = (role: 'name' | 'price', color = role === 'name' ? '#6e6259' : '#3d3935'): CatalogRolePaint => ({ color, fontSize: '16px', fontWeight: role === 'name' ? '700' : '550', lineHeight: role === 'name' ? '20px' : '24px', fontFamily: 'Arial, sans-serif', rect: { x: 20, y: 200, width: 180, height: 24 }, domPath: `html > body > .owned-card > .${role}`, visible: true });
const atom = (text: string, selector: string, role: 'name' | 'price', color?: string, old = false): SourcePaintAtom => { const value = paint(role, color); return { text, selector, href: 'https://source.example/old/', tag: 'span', visible: true, rect: value.rect, style: { color: value.color, 'font-size': value.fontSize, 'font-weight': value.fontWeight, 'line-height': value.lineHeight, 'font-family': value.fontFamily, 'text-decoration-line': old ? 'line-through' : 'none' } }; };
function fixture() {
  const contract: BlockContract = { version: 1, workflow: 'block-replication', sourceUrl: 'https://source.example/', capturedAt: '2026-10-13T09:30:00Z', referenceReport: { path: 'source.json', sha256: '0'.repeat(64) }, evidence: [{ id: 'source-dom', path: 'desktop.json', sha256: '0'.repeat(64), kind: 'dom' }], tolerances: { geometryPx: 20, geometryRatio: .15, colorChannel: 4 }, limitations: [], blocks: [{ id: 'items', role: 'products', presentation: 'carousel', texts: [{ id: 'name-1', text: 'A reference product', kind: 'product-name' }, { id: 'price-1', text: '$5.99', kind: 'price' }], assets: ['photo-1'], evidence: ['source-dom'], geometry: { desktop: { width: 1200, height: 300, columns: 5 } }, dynamicData: { provider: 'target-woocommerce', kind: 'product-list', replaceableTextIds: ['name-1', 'price-1'], replaceableAssetKeys: ['photo-1'], items: [{ sourceNodeId: '#source-item-1', textIds: ['name-1', 'price-1'], assetKeys: ['photo-1'], evidence: ['source-dom'] }], evidence: ['source-dom'] }, colors: {}, states: { normal: none, hover: none, interaction: none } }] };
  const program: NativeProgram = { version: 1, workflow: 'block-replication', title: 'Own product data', sourceUrl: contract.sourceUrl, sourceContract: { path: 'source.json', sha256: '0'.repeat(64) }, assetsManifest: { path: 'assets.json', sha256: '0'.repeat(64) }, deviations: [], elements: [{ key: 'root', type: 'container', settings: {}, children: [{ key: 'query', type: 'wd_products', settings: { layout: 'carousel', post_type: 'product' } }] }], blocks: [{ sourceBlockId: 'items', rootKey: 'root', presentation: 'carousel', productQuery: { provider: 'target-woocommerce', widgetKey: 'query', widgetType: 'wd_products', sourceTextIds: ['name-1', 'price-1'], sourceAssetKeys: ['photo-1'], queryControlKeys: ['post_type'], carouselMode: { control: 'layout', value: 'carousel' }, styleBindings: { nameSourceTextIds: ['name-1'], priceSourceTextIds: ['price-1'] }, evidence: ['source-dom'] }, bindings: [], states: contract.blocks[0].states }] };
  const atoms = [atom('A reference product', '#source-item-1 .name', 'name'), atom('$5.99', '#source-item-1 .price', 'price')];
  const packets: SourceTextPaintPacket[] = [{ evidenceId: 'source-dom', evidencePath: 'actual-source.json', viewport: 'desktop', blocks: [{ id: 'items', textAtoms: atoms, carousels: [{ slides: [{ selector: '#source-item-1', atoms } as { atoms: SourcePaintAtom[] }] }] }] }];
  const catalogProduct = { id: 17, name: 'An entirely different own product', permalink: 'https://target.example/product/own/', imageUrl: 'https://target.example/own.png', priceText: '$24.99', onSale: false };
  const render: CatalogRenderEvidence = { viewport: 'desktop', blockId: 'items', widgetKey: 'query', widgetType: 'wd_products', elementId: '2222222', evidence: ['actual-browser.json'], catalog: { targetOrigin: 'https://target.example', evidence: ['real-catalog.json'], products: [catalogProduct] }, products: [{ ...catalogProduct, namePaint: paint('name'), pricePaint: paint('price') }] };
  const template: PresentationCatalogTemplate = { sourceNodeId: '#source-item-1', evidence: ['source-dom'], rect: { x: 0, y: 0, width: 220, height: 300 }, visibleFraction: 1, paint: { borderWidth: 1, borderColor: '#dddddd', borderRadius: 12, backgroundColor: '#ffffff', boxShadow: 'none' }, slots: [{ role: 'image', visible: true, rect: { x: 20, y: 20, width: 180, height: 160 }, fit: 'contain', objectPosition: '50% 50%' }, { role: 'name', visible: true, rect: { x: 20, y: 200, width: 180, height: 24 }, maxLines: 2 }, { role: 'price', visible: true, rect: { x: 20, y: 230, width: 180, height: 24 } }], order: ['image', 'name', 'price'], gaps: [{ from: 'name', to: 'price', axis: 'y', valuePx: 6 }], hover: { status: 'not-applicable', evidence: ['source-dom'] } };
  contract.blocks[0].presentationDetails = { version: 1, viewports: { desktop: { status: 'observed', width: 1200, evidence: ['source-dom'], regions: [], controlGroups: [], media: [], relations: [], catalogTemplate: template } } };
  render.products[0].cardLayout = { ...structuredClone(template), domPath: '.actual-target-card', evidence: ['actual-browser.json'], slots: template.slots.map(slot => ({ ...structuredClone(slot), domPath: `.actual-target-card .${slot.role}`, lineCount: 1 })), hover: undefined };
  return { contract, program, packets, render };
}
const compare = (value: ReturnType<typeof fixture>) => compareCatalogRolePaint(value.contract, value.program, value.packets, [value.render]);

test('catalog replacement changes item data without exempting same-role name and price styles', () => {
  const value = fixture(), report = compare(value); assert.equal(report.passed, true); assert.equal(report.counts.matched, 3); assert.equal(report.issues.length, 0);
  assert.equal(report.checks.find(check => check.role === 'name')!.sourceTextIds[0], 'name-1'); assert.equal(report.checks[0].productId, 17);
  assert.notEqual(value.contract.blocks[0].texts[0].text, value.render.products[0].name);
});
test('actual product-role color, font size, line height and weight mismatches remain errors after text replacement', () => {
  for (const edit of [(p: CatalogRolePaint) => { p.color = '#171717'; }, (p: CatalogRolePaint) => { p.fontSize = '14px'; }, (p: CatalogRolePaint) => { p.lineHeight = '20px'; }, (p: CatalogRolePaint) => { p.fontWeight = '700'; }]) {
    const value = fixture(); edit(value.render.products[0].pricePaint!); const report = compare(value); assert.equal(report.status, 'failed'); assert.ok(report.issues.some(issue => issue.severity === 'error' && issue.role === 'price'));
  }
});
test('role font rounding allows at most one pixel and never inherits broad block geometry tolerance', () => {
  const value = fixture(); value.render.products[0].namePaint!.fontSize = '16.5px'; value.render.products[0].namePaint!.lineHeight = '20.5px'; assert.equal(compare(value).passed, true);
  value.render.products[0].namePaint!.fontSize = '18px'; assert.ok(compare(value).issues.some(issue => issue.property === 'fontSize' && issue.severity === 'error'));
});
test('font-family replacement is a named fallback gap, while absent actual role DOM proof never passes', () => {
  const value = fixture(); value.render.products[0].namePaint!.fontFamily = 'Different Font'; let report = compare(value); assert.equal(report.status, 'needs-review'); assert.ok(report.issues.some(issue => issue.code === 'catalog-role-font-fallback'));
  delete value.render.products[0].pricePaint; report = compare(value); assert.equal(report.passed, false); assert.ok(report.issues.some(issue => issue.code === 'catalog-role-paint-unmeasured'));
  value.render.products[0].namePaint!.domPath = ''; assert.equal(compare(value).passed, false);
});
test('source role styles cannot be borrowed from a different item, block or viewport', () => {
  for (const edit of [(v: ReturnType<typeof fixture>) => { v.packets[0].blocks[0].id = 'footer'; }, (v: ReturnType<typeof fixture>) => { v.packets[0].viewport = 'mobile'; }, (v: ReturnType<typeof fixture>) => { (v.packets[0].blocks[0].carousels![0].slides![0] as { selector?: string }).selector = '#different-item'; }]) {
    const value = fixture(); edit(value); const report = compare(value); assert.equal(report.passed, false); assert.ok(report.issues.some(issue => issue.code === 'catalog-source-role-paint-unproven'));
  }
});
test('promotion captions require explicit structural name mapping and never turn discount wording into a product price', () => {
  const value = fixture(); value.contract.blocks[0].role = 'promotion'; value.contract.blocks[0].texts[0].kind = 'label'; value.program.blocks[0].productQuery!.styleBindings!.priceSourceTextIds = [];
  const report = compare(value); assert.equal(report.checks.find(check => check.role === 'name')?.status, 'matched'); assert.ok(report.issues.some(issue => issue.code === 'catalog-source-role-unproven' && issue.role === 'price'));
  delete value.program.blocks[0].productQuery!.styleBindings; assert.ok(compare(value).issues.some(issue => issue.code === 'catalog-source-role-unproven' && issue.role === 'name'));
});
test('style mapping cannot swallow headings, foreign fields or omit proven source product roles', () => {
  const value = fixture(); value.program.blocks[0].productQuery!.styleBindings!.nameSourceTextIds = ['price-1']; assert.throws(() => compare(value), /own authorized item caption/);
  const missing = fixture(); missing.program.blocks[0].productQuery!.styleBindings!.priceSourceTextIds = []; assert.throws(() => compare(missing), /discard a proven source price role/);
});
function saleFixture() {
  const value = fixture(), source = value.contract.blocks[0], dynamic = source.dynamicData!, query = value.program.blocks[0].productQuery!, sourceBlock = value.packets[0].blocks[0];
  source.texts.push({ id: 'old-sale-price', text: '$19.99', kind: 'price' }, { id: 'current-sale-price', text: '$15.99', kind: 'price' }); source.assets.push('photo-2'); dynamic.replaceableTextIds.push('old-sale-price', 'current-sale-price'); dynamic.replaceableAssetKeys.push('photo-2'); dynamic.items.push({ sourceNodeId: '#source-sale-item', textIds: ['old-sale-price', 'current-sale-price'], assetKeys: ['photo-2'], evidence: ['source-dom'] });
  query.sourceTextIds.push('old-sale-price', 'current-sale-price'); query.sourceAssetKeys.push('photo-2'); query.styleBindings!.priceSourceTextIds.push('old-sale-price', 'current-sale-price');
  const atoms = [atom('$19.99', '#source-sale-item .old-price', 'price', '#999999', true), atom('$15.99', '#source-sale-item .current-price', 'price', '#bd1211')]; sourceBlock.textAtoms.push(...atoms); sourceBlock.carousels![0].slides!.push({ selector: '#source-sale-item', atoms } as { atoms: SourcePaintAtom[] });
  return value;
}
test('source crossed-out and current sale prices never choose a favorable color for normal own products', () => {
  const value = saleFixture(); assert.equal(compare(value).passed, true, 'normal target price compares only to source normal-price items');
  value.render.products[0].pricePaint!.color = '#bd1211'; assert.ok(compare(value).issues.some(issue => issue.code === 'catalog-role-color' && issue.severity === 'error'));
});
test('actual target sale provenance selects source sale current and old role styles without comparing data strings', () => {
  const value = saleFixture(); value.render.catalog.products[0].onSale = true; value.render.products[0].onSale = true; value.render.products[0].pricePaint = { ...paint('price', '#bd1211'), priceState: 'sale', parts: [{ ...paint('price', '#999999'), priceState: 'old' }] };
  assert.equal(compare(value).passed, true); value.render.products[0].pricePaint.parts![0].color = '#ff0000'; assert.ok(compare(value).issues.some(issue => issue.code === 'catalog-role-color' && issue.severity === 'error'));
  value.render.products[0].onSale = false; assert.ok(compare(value).issues.some(issue => issue.code === 'catalog-price-state' && issue.severity === 'error'));
});
test('missing sale-state catalog provenance and ambiguous source variants remain gaps without a guessed match', () => {
  const value = saleFixture(); delete value.render.catalog.products[0].onSale; assert.equal(compare(value).passed, false); assert.ok(compare(value).issues.some(issue => issue.code === 'catalog-price-state-unverified'));
  const ambiguous = fixture(), source = ambiguous.contract.blocks[0], dynamic = source.dynamicData!, query = ambiguous.program.blocks[0].productQuery!;
  source.texts.push({ id: 'name-2', text: 'Another source product', kind: 'product-name' }); source.assets.push('photo-2'); dynamic.replaceableTextIds.push('name-2'); dynamic.replaceableAssetKeys.push('photo-2'); dynamic.items.push({ sourceNodeId: '#source-item-2', textIds: ['name-2'], assetKeys: ['photo-2'], evidence: ['source-dom'] }); query.sourceTextIds.push('name-2'); query.sourceAssetKeys.push('photo-2'); query.styleBindings!.nameSourceTextIds.push('name-2');
  const extra = atom('Another source product', '#source-item-2 .name', 'name'); (extra.style as Record<string, unknown>)['font-size'] = '18px'; ambiguous.packets[0].blocks[0].textAtoms.push(extra); ambiguous.packets[0].blocks[0].carousels![0].slides!.push({ selector: '#source-item-2', atoms: [extra] } as { atoms: SourcePaintAtom[] });
  ambiguous.render.products[0].namePaint!.color = '#ff0000'; const report = compare(ambiguous); assert.ok(report.issues.some(issue => issue.code === 'catalog-source-role-paint-ambiguous')); assert.ok(report.issues.some(issue => issue.code === 'catalog-role-color' && issue.severity === 'error'), 'known invariant color still detects a mismatch when another source metric is ambiguous');
});
test('catalog data provenance checks actual DOM sale state in addition to name, href, price and media', () => {
  const value = fixture(), root = { sourceId: 'query', targetId: '2222222', selector: 'root', found: true, count: 1, nativeElement: true, visible: true, widgetType: 'wd_products', text: '', rect: { x: 0, y: 0, width: 1200, height: 300 }, style: {}, images: [] };
  value.render.products[0].onSale = true;
  const binding = { query: value.program.blocks[0].productQuery!, node: value.program.elements[0].children![0], textIds: new Set(['name-1', 'price-1']), assetKeys: new Set(['photo-1']) };
  assert.ok(catalogRenderProblems(binding, value.render, root).some(message => message.includes('sale state')));
});

test('own-product card fidelity checks frame, image fit, allocated slots and order independently of block height', () => {
  for (const edit of [(card: CatalogCardLayout) => { card.paint.borderWidth = 0; }, (card: CatalogCardLayout) => { card.slots[0].fit = 'cover'; }, (card: CatalogCardLayout) => { card.slots[1].rect.y += 15; }, (card: CatalogCardLayout) => { card.order = ['image', 'price', 'name']; }]) {
    const value = fixture(); edit(value.render.products[0].cardLayout!); const report = compare(value); assert.equal(report.status, 'failed'); assert.ok(report.issues.some(issue => issue.role === 'card' && issue.severity === 'error'));
  }
});

test('long target names keep the allocated card layout and line budget without source text equality', () => {
  const value = fixture(), product = value.render.products[0]; product.name = 'A very long target product title whose wrapping differs from the reference wording'; product.cardLayout!.slots.find(slot => slot.role === 'name')!.lineCount = 2;
  assert.equal(compare(value).passed, true);
  product.cardLayout!.slots.find(slot => slot.role === 'name')!.lineCount = 4;
  assert.ok(compare(value).issues.some(issue => issue.code === 'catalog-card-slot-lines'));
});

test('CSS-visible offscreen source carousel clones cannot select an invisible favorable role style', () => {
  const value = fixture(); value.packets[0].observedPage = { url: value.contract.sourceUrl, viewport: { width: 1200, height: 900 } };
  const source = value.packets[0].blocks[0].textAtoms[0]; source.rect!.x = 2479;
  const report = compare(value); assert.equal(report.passed, false); assert.ok(report.issues.some(issue => issue.code === 'catalog-source-role-paint-unproven' && issue.role === 'name'));
});

test('missing source card, absent actual card and unobserved hover never become a style pass', () => {
  const value = fixture(); delete value.contract.blocks[0].presentationDetails!.viewports.desktop.catalogTemplate;
  assert.ok(compare(value).issues.some(issue => issue.code === 'catalog-card-template-unproven'));
  const actual = fixture(); delete actual.render.products[0].cardLayout;
  assert.ok(compare(actual).issues.some(issue => issue.code === 'catalog-card-layout-unmeasured'));
  const hover = fixture(); hover.contract.blocks[0].presentationDetails!.viewports.desktop.catalogTemplate!.hover = { status: 'observed', evidence: ['source-dom'], paint: { boxShadow: '0px 2px 4px black' } };
  assert.ok(compare(hover).issues.some(issue => issue.code === 'catalog-card-hover-unmeasured'));
});
