import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { buildNativeCatalogStyle, projectNativeCatalogStyle, replaceNativeCatalogCSS, type NativeCatalogStyleView } from '../src/fidelity/catalog-style.js';
import { buildNativeFractionCSS, hasNativeFractionBinding } from '../src/fidelity/native-fraction.js';
import type { PresentationCatalogTemplate } from '../src/fidelity/presentation-contract.js';
import type { NativeElement } from '../src/fidelity/types.js';
import { catalogCardLayoutProblems, type CatalogCardLayout } from '../src/fidelity/catalog-contract.js';
import { collectNativeCatalogRender } from '../src/fidelity/catalog-browser.js';

function view(width = 194, height = 415, fontSize = 14): NativeCatalogStyleView {
  const template: PresentationCatalogTemplate = { sourceNodeId: '#source-owned-card', evidence: ['source-card'], visibleFraction: 1, rect: { x: 30, y: 20, width, height }, paint: { borderWidth: 1, borderColor: 'rgb(226, 235, 240)', borderRadius: 8, backgroundColor: 'rgb(255, 255, 255)', boxShadow: 'none' }, slots: [
    { role: 'image', visible: true, rect: { x: 24, y: 25, width: width - 48, height: width - 48 }, fit: 'contain', objectPosition: '50% 50%' },
    { role: 'name', visible: true, rect: { x: 13, y: height - 177, width: width - 26, height: 48 }, paint: { fontSize, fontWeight: '400', lineHeight: 20, color: 'rgb(110, 98, 89)', textAlign: 'left' } },
    { role: 'price', visible: true, rect: { x: 13, y: height - 129, width: width - 26, height: 40 }, paint: { fontSize: 16, lineHeight: 24, fontWeight: '550', color: '#3d3935' } },
  ], order: ['image', 'name', 'price'] };
  return { template, slotInventory: { sourceNodeId: template.sourceNodeId, complete: true, evidence: ['complete-card-subtree'], absentRoles: ['rating', 'badge'] } };
}
function contentView(width = 194, height = 415, fontSize = 14, priceHeight = 24): NativeCatalogStyleView {
  const result = view(width, height, fontSize), name = result.template.slots.find(slot => slot.role === 'name')!, price = result.template.slots.find(slot => slot.role === 'price')!;
  name.geometryBasis = 'allocation'; price.geometryBasis = 'allocation'; price.rect.height = priceHeight + 16;
  if (priceHeight !== 24) price.paint = { ...price.paint, fontSize: 20, lineHeight: 30 };
  result.slotContent = {
    name: { sourceNodeId: `${result.template.sourceNodeId} > .source-name`, evidence: ['source-card'], borderBox: { ...name.rect, height: name.rect.height - 8 }, margins: { top: 0, right: 0, bottom: 8, left: 0 } },
    price: { sourceNodeId: `${result.template.sourceNodeId} > .source-price-row > .source-price`, allocationSourceNodeId: `${result.template.sourceNodeId} > .source-price-row`, evidence: ['source-card'], borderBox: { ...price.rect, width: 60, y: price.rect.y + 8, height: priceHeight }, margins: { top: 8, right: 0, bottom: 8, left: 0 }, inlineSize: 'fill-allocation' },
  };
  return result;
}
const node = (): NativeElement => ({ key: 'target-native-query', type: 'wd_products', settings: { product_hover: 'icons', layout: 'carousel', items_per_page: 11, orderby: 'date', offset: 2, custom_css: `selector .wd-entities-title{font-size:16px;font-weight:700;}\n@media(max-width:767px){selector .price{font-size:40px;}selector .wd-arrow-inner{width:36px;}}\nselector .wd-nav-arrows{width:198px;}\n${buildNativeFractionCSS()}` } });

test('native card style derives independent viewport measurements rather than a prior brand default', () => {
  const desktop = view(), mobile = view(304, 504, 13);
  mobile.maxWidth = 767; mobile.template.paint.borderRadius = 3;
  const result = buildNativeCatalogStyle({ mobile, desktop });
  assert.deepEqual(result.gaps, []);
  assert.ok(result.css.includes('font-size:14px;font-weight:400;'));
  assert.ok(result.css.includes('@media(max-width:767px)'));
  assert.ok(result.css.includes('width:304px;height:504px;'));
  assert.ok(result.css.includes('font-size:13px;'));
  assert.ok(result.css.includes('border-radius:3px;'));
  const otherSite = view(); otherSite.template.slots[1].paint = { fontSize: 18, fontWeight: '600', color: '#fe1234', lineHeight: 25 };
  const other = buildNativeCatalogStyle({ desktop: otherSite });
  assert.ok(other.css.includes('font-size:18px;font-weight:600;color:#fe1234;'));
  assert.ok(!other.css.includes('font-size:14px;'));
});

test('complete same-card absence proof is required to hide native target roles', () => {
  const source = view(); delete source.slotInventory;
  const unproved = buildNativeCatalogStyle({ desktop: source });
  assert.deepEqual(unproved.gaps.map(gap => gap.role), ['rating', 'badge']);
  assert.ok(!unproved.css.includes('selector .star-rating{display:none;}'));
  const offer = view(); offer.template.slots = offer.template.slots.filter(slot => slot.role !== 'price'); offer.template.order = ['image', 'name']; offer.slotInventory!.absentRoles.push('price');
  const offerCSS = buildNativeCatalogStyle({ desktop: offer }).css;
  for (const role of ['.star-rating', '.price', '.product-labels']) assert.ok(offerCSS.includes(`selector ${role}{display:none;}`));
  const contradiction = view(); contradiction.slotInventory!.absentRoles.push('price');
  assert.throws(() => buildNativeCatalogStyle({ desktop: contradiction }), /contradicts/);
  const foreign = view(); foreign.slotInventory!.sourceNodeId = '#other-card';
  assert.throws(() => buildNativeCatalogStyle({ desktop: foreign }), /same owned source card/);
});

test('bounded replacement keeps genuine arrows and dynamic native fraction while preserving query data', () => {
  const before = node(), original = structuredClone(before);
  const projected = projectNativeCatalogStyle(before, { desktop: view() });
  assert.deepEqual(before, original);
  assert.equal(projected.node.settings.items_per_page, 11);
  assert.equal(projected.node.settings.offset, 2);
  assert.ok(String(projected.node.settings.custom_css).includes('selector .wd-nav-arrows{width:198px;}'));
  assert.ok(String(projected.node.settings.custom_css).includes('@media(max-width:767px){selector .wd-arrow-inner{width:36px;}'));
  assert.equal(hasNativeFractionBinding(projected.node), true);
  assert.ok(!String(projected.node.settings.custom_css).includes('font-weight:700;'));
  assert.equal(replaceNativeCatalogCSS(String(projected.node.settings.custom_css), projected.result.css), projected.node.settings.custom_css, 'style repair is idempotent');
});

test('nonfinite dimensions, escaped paint and unregistered native templates fail before any save', () => {
  const nonfinite = view(); nonfinite.template.slots[0].rect.width = NaN;
  assert.throws(() => buildNativeCatalogStyle({ desktop: nonfinite }), /measured frame/);
  const injected = view(); injected.template.slots[1].paint!.fontFamily = 'Arial;display:none';
  assert.throws(() => buildNativeCatalogStyle({ desktop: injected }), /bounded visual/);
  assert.throws(() => projectNativeCatalogStyle({ ...node(), type: 'html' }, { desktop: view() }), /discovered native/);
  assert.throws(() => buildNativeCatalogStyle({ desktop: view(), other: view() }), /one measured base/);
});

test('content border-box decomposition requires actual matching owned allocation evidence', () => {
  const source = contentView(); assert.doesNotThrow(() => buildNativeCatalogStyle({ desktop: source }));
  const moved = structuredClone(source); moved.slotContent!.price!.borderBox.y += 8;
  assert.throws(() => buildNativeCatalogStyle({ desktop: moved }), /does not decompose/);
  const height = structuredClone(source); height.slotContent!.name!.borderBox.height = 48;
  assert.throws(() => buildNativeCatalogStyle({ desktop: height }), /does not decompose/);
  const owner = structuredClone(source); owner.slotContent!.name!.sourceNodeId = '#foreign-card > .title';
  assert.throws(() => buildNativeCatalogStyle({ desktop: owner }), /same-card allocation/);
  const unprovedWidth = structuredClone(source); delete unprovedWidth.slotContent!.price!.allocationSourceNodeId;
  assert.throws(() => buildNativeCatalogStyle({ desktop: unprovedWidth }), /does not decompose/);
});

test('allocation geometry accepts own price glyph width but rejects displaced slots and missing independent proof', () => {
  const source = view().template; source.hover = { status: 'not-applicable', evidence: ['source-card'] };
  source.slots.filter(slot => slot.role === 'price' || slot.role === 'name').forEach(slot => { slot.geometryBasis = 'allocation'; });
  const actual: CatalogCardLayout = { rect: { ...source.rect }, paint: { ...source.paint }, domPath: '#own-card .product-wrapper', evidence: ['target-dom'], visibleFraction: 1, slots: source.slots.map(slot => ({ ...structuredClone(slot), domPath: `#own-card ${slot.role}`, allocationRect: { ...slot.rect }, allocationProof: { kind: 'computed-margin-box', domPath: `#own-card ${slot.role}`, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 } })), order: [...source.order] };
  const price = actual.slots.find(slot => slot.role === 'price')!; price.rect.width = 145; price.rect.height = 24;
  const name = actual.slots.find(slot => slot.role === 'name')!; name.rect.height = 40;
  assert.deepEqual(catalogCardLayoutProblems(source, actual), [], 'own long name and price range use actual allocated slot, never source glyph dimensions');
  price.allocationRect!.y += 8;
  assert.ok(catalogCardLayoutProblems(source, actual).some(problem => problem.code === 'catalog-card-slot-geometry' && problem.property === 'price.y'));
  price.allocationRect!.y -= 8; delete price.allocationProof;
  assert.ok(catalogCardLayoutProblems(source, actual).some(problem => problem.code === 'catalog-card-slot-allocation-unmeasured'));
  const legacy = structuredClone(source); legacy.slots.forEach(slot => { delete slot.geometryBasis; });
  assert.ok(catalogCardLayoutProblems(legacy, actual).some(problem => problem.code === 'catalog-card-slot-geometry' && problem.property === 'price.width'), 'legacy contracts retain their exact previous dimensions');
});

test('actual Chromium native DOM retains target products and renders measured responsive skin and slots', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.route('https://target.example/**', route => route.fulfill({ body: '<!doctype html>', contentType: 'text/html' }));
    await page.goto('https://target.example/preview');
    const mobile = view(304, 504, 13); mobile.maxWidth = 767;
    const css = buildNativeCatalogStyle({ desktop: view(), mobile }).css.replaceAll('selector', '.native-products');
    await page.setContent(`<script>globalThis.__name=(target)=>target;</script><style>*{box-sizing:border-box}body{margin:0}.native-products{margin:10px}.product-grid-item{width:350px}h3{margin:0}.wd-entities-title a{color:red;font-weight:700}.star-rating{display:block}${css}</style><div class="native-products" data-id="abc1234" data-widget_type="wd_products.default"><div class="product-grid-item product" data-id="41"><div class="product-wrapper"><div class="product-element-top"><a class="product-image-link" href="https://target.example/own-product"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'/%3E"></a></div><div class="product-element-bottom"><h3 class="wd-entities-title"><a href="https://target.example/own-product">Own catalog product name</a></h3><div class="star-rating">4 stars</div><span class="price"><span class="amount"><bdi>$17.99 – $84.99</bdi></span></span><span class="product-labels">Own label</span></div></div></div></div>`);
    const read = () => page.locator('.product-wrapper').evaluate(card => {
      const box = card.getBoundingClientRect(), slot = (selector: string) => { const element = card.querySelector(selector)!, r = element.getBoundingClientRect(), css = getComputedStyle(element); return { x: r.x - box.x, y: r.y - box.y, width: r.width, height: r.height, fontSize: css.fontSize, fontWeight: css.fontWeight, display: css.display }; };
      return { width: box.width, height: box.height, border: getComputedStyle(card).borderTopWidth, radius: getComputedStyle(card).borderRadius, image: slot('img'), name: slot('.wd-entities-title'), namePaint: slot('.wd-entities-title a'), rating: slot('.star-rating'), price: slot('.price') };
    });
    const desktop = await read();
    assert.equal(desktop.width, 194); assert.equal(desktop.height, 415); assert.equal(desktop.border, '1px'); assert.equal(desktop.radius, '8px');
    assert.equal(desktop.image.x, 24); assert.equal(desktop.image.y, 25); assert.equal(desktop.image.width, 146);
    assert.equal(desktop.name.x, 13); assert.equal(desktop.name.y, 238); assert.equal(desktop.name.width, 168); assert.equal(desktop.name.height, 48);
    assert.equal(desktop.namePaint.fontSize, '14px'); assert.equal(desktop.namePaint.fontWeight, '400'); assert.equal(desktop.rating.display, 'none');
    assert.equal(desktop.price.y, 286); assert.equal(desktop.price.width, 168);
    const actual = await collectNativeCatalogRender({ page, blockId: 'generic-products', widgetKey: 'target-native-query', elementId: 'abc1234', viewport: 'desktop', catalog: { targetOrigin: 'https://target.example', evidence: ['catalog-query'], products: [] } });
    assert.equal(actual.products[0].cardLayout?.rect.width, 194, 'measure the actual painted native wrapper, not its 350px Swiper layout slot');
    assert.equal(actual.products[0].cardLayout?.paint.borderWidth, 1);
    assert.equal(actual.products[0].cardLayout?.slots.find(slot => slot.role === 'price')?.allocationRect?.width, 168);
    assert.equal(actual.products[0].cardLayout?.slots.find(slot => slot.role === 'price')?.allocationProof?.kind, 'computed-margin-box');
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await read(); assert.equal(phone.width, 304); assert.equal(phone.height, 504); assert.equal(phone.image.width, 256); assert.equal(phone.namePaint.fontSize, '13px');
    assert.equal(await page.locator('.product-grid-item').getAttribute('data-id'), '41');
    assert.equal(await page.locator('.wd-entities-title a').textContent(), 'Own catalog product name');
    assert.equal(await page.locator('.price').textContent(), '$17.99 – $84.99');
    await page.close();
  } finally { await browser.close(); }
});

test('actual long text obeys source content height, real ancestor clipping and intact price margin-box', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.route('https://target.example/**', route => route.fulfill({ body: '<!doctype html>', contentType: 'text/html' })); await page.goto('https://target.example/preview');
    const desktop = contentView(), tablet = contentView(113, 313, 14, 31), mobile = contentView(304, 504, 14, 31); tablet.maxWidth = 1024; mobile.maxWidth = 767;
    const css = buildNativeCatalogStyle({ desktop, tablet, mobile }).css.replaceAll('selector', '.native-products');
    const longName = 'Own catalog variable product with a deliberately long description and many words';
    await page.setContent(`<script>globalThis.__name=(target)=>target;</script><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}.native-products{margin:10px}.product-grid-item{width:350px}h3{margin:0}${css}</style><div class="native-products" data-id="abc1234" data-widget_type="wd_products.default"><div class="product-grid-item product" data-id="41"><div class="product-wrapper"><div class="product-element-top"><a class="product-image-link" href="https://target.example/own-product"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'/%3E"></a></div><div class="product-element-bottom"><h3 class="wd-entities-title"><a href="https://target.example/own-product">${longName}</a></h3><span class="price"><span class="amount"><bdi>$17.99 – $84.99</bdi></span></span></div></div></div></div>`);
    const read = async (viewport: string) => (await collectNativeCatalogRender({ page, blockId: 'generic-products', widgetKey: 'target-native-query', elementId: 'abc1234', viewport, catalog: { targetOrigin: 'https://target.example', evidence: ['own-query'], products: [] } })).products[0];
    const first = await read('desktop'), firstName = first.cardLayout!.slots.find(slot => slot.role === 'name')!, firstPrice = first.cardLayout!.slots.find(slot => slot.role === 'price')!;
    assert.equal(firstName.rect.height, 40); assert.equal(firstName.allocationRect!.height, 48); assert.equal(firstName.allocationProof!.marginBottom, 8);
    assert.equal(firstName.lineCount, 2); assert.ok(firstName.fullLineCount! > firstName.lineCount!);
    assert.equal(firstPrice.rect.y, 294); assert.equal(firstPrice.rect.height, 24); assert.equal(firstPrice.allocationRect!.y, 286); assert.equal(firstPrice.allocationRect!.height, 40); assert.equal(firstPrice.allocationProof!.marginTop, 8); assert.equal(firstPrice.allocationProof!.marginBottom, 8);
    assert.equal(await page.locator('.wd-entities-title a').evaluate(anchor => anchor.getBoundingClientRect().height), 40);
    await page.setViewportSize({ width: 900, height: 900 });
    const narrow = await read('tablet'), narrowName = narrow.cardLayout!.slots.find(slot => slot.role === 'name')!, narrowPrice = narrow.cardLayout!.slots.find(slot => slot.role === 'price')!;
    assert.equal(narrowName.lineCount, 2); assert.ok(narrowName.fullLineCount! > 3);
    assert.equal(narrowPrice.rect.height, 31); assert.equal(narrowPrice.allocationRect!.height, 47); assert.equal(narrowPrice.allocationRect!.width, 87);
    assert.equal(narrowPrice.lineCount, 1); assert.equal(narrowPrice.fullLineCount, 2, 'a target price range genuinely wraps: retain the full-row diagnostic rather than claiming it fits');
    assert.equal(narrow.priceText, '$17.99 – $84.99');
    // A half exposed third line must still count as a defect, not be rounded away.
    await page.locator('.wd-entities-title').evaluate(element => { (element as HTMLElement).style.height = '48px'; (element as HTMLElement).style.maxHeight = '48px'; });
    const exposed = await read('tablet'); assert.equal(exposed.cardLayout!.slots.find(slot => slot.role === 'name')!.lineCount, 3);
    // Own element overflow can be visible while an actual native ancestor clips it.
    await page.locator('.wd-entities-title').evaluate(element => { (element as HTMLElement).style.height = '40px'; (element as HTMLElement).style.maxHeight = '40px'; (element as HTMLElement).style.overflow = 'visible'; const anchor = element.querySelector('a')!; anchor.style.overflow = 'visible'; anchor.style.height = 'auto'; anchor.style.maxHeight = 'none'; const parent = element.parentElement!; parent.style.position = 'absolute'; parent.style.top = '0'; parent.style.left = '0'; parent.style.width = '100%'; parent.style.height = `${(element as HTMLElement).offsetTop + 40}px`; parent.style.overflow = 'hidden'; });
    const ancestor = await read('tablet'); assert.equal(ancestor.cardLayout!.slots.find(slot => slot.role === 'name')!.lineCount, 2, 'actual clipping ancestor bounds must be respected');
    await page.close();
  } finally { await browser.close(); }
});

test('content-driven native prices grow only as needed inside unused card space and theme caps cannot truncate source name content', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await page.route('https://target.example/**', route => route.fulfill({ body: '<!doctype html>', contentType: 'text/html' })); await page.goto('https://target.example/preview');
    const desktop = contentView(), tablet = contentView(113, 313, 14, 31), mobile = contentView(304, 504, 14, 31); tablet.maxWidth = 1024; mobile.maxWidth = 767;
    const name = tablet.template.slots.find(slot => slot.role === 'name')!, price = tablet.template.slots.find(slot => slot.role === 'price')!;
    name.rect.y = 157; tablet.slotContent!.name!.borderBox.y = 157;
    price.rect.y = 205; tablet.slotContent!.price!.borderBox.y = 213;
    for (const view of [desktop, tablet, mobile]) view.slotContent!.price!.growth = { maxAllocationBottom: view.template.rect.height - 1, evidence: ['source-card'], reason: 'Complete target price facts may use the independently measured unoccupied card remainder; actual height differences remain explicit dynamic-data layout deviations.' };
    const invalid = structuredClone(tablet); invalid.slotContent!.price!.growth!.maxAllocationBottom = 314;
    assert.throws(() => buildNativeCatalogStyle({ desktop: contentView(), tablet: invalid }), /beyond evidenced unused/);
    const css = buildNativeCatalogStyle({ desktop, tablet, mobile }).css.replaceAll('selector', '.native-products');
    const range = '<span class="amount"><bdi>$17.99</bdi></span> – <span class="amount"><bdi>$84.99</bdi></span>';
    await page.setContent(`<script>globalThis.__name=(target)=>target;</script><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}h3{height:40px;max-height:1.4em;font-size:14px;line-height:20px;overflow:hidden;margin:0}</style><div class="native-products" data-id="abc1234" data-widget_type="wd_products.default"><div class="product-grid-item product" data-id="41"><div class="product-wrapper"><div class="product-element-top"><a class="product-image-link" href="https://target.example/own-product"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'/%3E"></a></div><div class="product-element-bottom"><h3 class="wd-entities-title"><a href="https://target.example/own-product">Own product name with enough words for many wrapped lines</a></h3><span class="price">${range}</span></div></div></div></div>`);
    assert.ok(await page.locator('h3').evaluate(element => element.getBoundingClientRect().height) < 20, 'theme 1.4em cap reproduces the real 19.6px defect');
    await page.addStyleTag({ content: css });
    const read = async (viewport: string) => (await collectNativeCatalogRender({ page, blockId: 'products', widgetKey: 'query', elementId: 'abc1234', viewport, catalog: { targetOrigin: 'https://target.example', evidence: ['own-query'], products: [] } })).products[0];
    const actual = await read('tablet'), slot = actual.cardLayout!.slots.find(slot => slot.role === 'price')!, title = actual.cardLayout!.slots.find(slot => slot.role === 'name')!;
    assert.equal(title.rect.height, 40); assert.equal(title.allocationRect!.height, 48);
    assert.equal(slot.rect.y, 213); assert.equal(slot.rect.width, 87); assert.equal(slot.rect.height, 60); assert.equal(slot.allocationRect!.y, 205); assert.equal(slot.allocationRect!.height, 76);
    assert.equal(slot.lineCount, 2); assert.equal(slot.fullLineCount, 2); assert.equal(slot.paint!.fontSize, 20); assert.equal(slot.paint!.lineHeight, 30);
    assert.equal(slot.allocationRect!.y + slot.allocationRect!.height, 281); assert.ok(281 < actual.cardLayout!.rect.height);
    assert.ok(catalogCardLayoutProblems(tablet.template, actual.cardLayout).some(problem => problem.code === 'catalog-card-slot-geometry' && problem.property === 'price.height'), 'intentional data accommodation is still a strict source geometry mismatch');
    await page.locator('.price').evaluate(element => { element.innerHTML = '<span class="amount"><bdi>$9.99</bdi></span>'; });
    assert.equal((await read('tablet')).cardLayout!.slots.find(slot => slot.role === 'price')!.rect.height, 31, 'single-price data keeps the source content height');
    await page.locator('.price').evaluate((element, value) => { element.innerHTML = value; }, range);
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal((await read('mobile')).cardLayout!.slots.find(slot => slot.role === 'price')!.rect.height, 31, 'wide phone slot stays one line without a forced two-line height');
    await page.setViewportSize({ width: 1200, height: 900 }); assert.equal((await read('desktop')).cardLayout!.slots.find(slot => slot.role === 'price')!.rect.height, 24);
    await page.close();
  } finally { await browser.close(); }
});
