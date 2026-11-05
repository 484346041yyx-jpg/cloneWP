import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptNative44Products } from '../src/native44/adapters.js';
import type { Native44Products } from '../src/native44/types.js';
import type { TargetCatalogEvidence } from '../src/wordpress/catalog-contract.js';
import type { LegacySchema } from '../src/wordpress/types.js';

test('WoodMart product carousel preserves explicit single-card scrolling on Elementor', () => {
  const origin = 'https://example.com';
  const catalog: TargetCatalogEvidence = { targetOrigin: origin, evidence: ['catalog.json'], products: [{ id: 11, name: 'Product', permalink: origin + '/product/sample/', imageUrl: origin + '/image.jpg', imageVariants: [], priceText: '$10' }] };
  const node: Native44Products = { key: 'products', kind: 'native-products', widgetType: 'wd_products', query: { ids: [11], evidence: ['products.json'] }, widgetSettings: { layout: 'carousel', scroll_per_page: 'no' } };
  const schema: LegacySchema = { type: 'wd_products', class: 'XTS\\Elementor\\Products', controls: {
    scroll_per_page: { type: 'switcher', default: 'yes' }, post_type: { type: 'select' }, include: { type: 'wd_autocomplete' }, items_per_page: { type: 'number' }, orderby: { type: 'select' },
  } };
  const compile = () => adaptNative44Products(node, schema, catalog, new Set(), 'task', 'abc1234');
  const result = compile();
  assert.equal(result.settings.scroll_per_page, '');
  assert.equal(result.receipts[0].settings.scroll_per_page, '');
  assert.deepEqual(result.settings.include, [11]);
  assert.equal(node.widgetSettings.scroll_per_page, 'no');
  node.widgetSettings.scroll_per_page = 'yes';
  assert.equal(compile().settings.scroll_per_page, 'yes');
});
