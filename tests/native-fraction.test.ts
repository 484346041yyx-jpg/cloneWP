import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { buildNativeFractionCSS, collectNativeFractionPaint, hasNativeFractionBinding, probeNativeFractionNavigation } from '../src/fidelity/native-fraction.js';
import { validateScopedNativeCSS } from '../src/fidelity/native.js';
import { planNativeCapabilities } from '../src/fidelity/capability-plan.js';
import { collectTargetPresentationEvidence } from '../src/fidelity/presentation-browser.js';
import { verifyPresentationDetails, type PresentationViewport } from '../src/fidelity/presentation-contract.js';
import type { BlockContract, NativeProgram } from '../src/fidelity/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';

let browser: Browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser.close(); });

const owner = '[data-id="owned-query"]';
const css = buildNativeFractionCSS();
/** Deterministic native-DOM fixture. Actual registered theme runtime is verified separately on the owned draft. */
async function fixture(options: { productCount?: number; perItem?: boolean } = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 500 } });
  await page.setContent(`<!doctype html><style>body{margin:0;font:16px/24px Arial}.widget{position:relative;margin:40px;width:300px;height:150px}.wd-nav-pagin{font:16px/24px Arial;color:rgb(0,71,210)}.wd-nav-pagin-wrap{position:absolute;top:0;left:40px;width:80px;height:30px}.wd-nav-arrows{display:flex;width:160px;justify-content:space-between}.wd-nav-arrows button{width:30px;height:30px}.product-grid-item{display:none}${css.replaceAll('selector', owner)}</style>
    <div class="widget" data-id="owned-query" data-element_type="widget" data-widget_type="wd_products.default"><div class="wd-carousel"><div class="wd-carousel-wrap">${Array.from({ length: options.productCount ?? 13 }, (_, index) => `<div class="product-grid-item product" data-id="${index + 1}"></div>`).join('')}</div></div><div class="wd-nav-arrows"><button class="wd-prev">←</button><button class="wd-next">→</button></div><div class="wd-nav-pagin-wrap"><ul class="wd-nav-pagin"></ul></div></div><script>globalThis.__name=(target)=>target;</script>`);
  await page.evaluate(({ productCount, perItem }) => {
    const root = document.querySelector('[data-id="owned-query"]')!, pager = root.querySelector('.wd-nav-pagin')!, carousel = root.querySelector('.wd-carousel')!;
    const runtime = { initialized: true, destroyed: false, snapGrid: [] as number[], pagination: { el: pager, bullets: [] as Element[] }, params: { slidesPerGroup: 5, slidesPerView: 5, loop: false } };
    Object.assign(carousel, { swiper: runtime });
    const render = () => {
      const visible = innerWidth <= 600 ? 2 : innerWidth <= 1000 ? 3 : 5;
      runtime.params.slidesPerView = visible; runtime.params.slidesPerGroup = perItem ? 1 : visible;
      const count = perItem ? Math.max(1, productCount - visible + 1) : Math.ceil(productCount / visible);
      runtime.snapGrid = Array.from({ length: count }, (_, i) => i);
      pager.replaceChildren(...runtime.snapGrid.map((_, i) => { const item = document.createElement('li'); item.className = `wd-nav-pagin-item${i === 0 ? ' wd-active' : ''}`; item.tabIndex = 0; item.setAttribute('aria-label', `Go to slide ${i + 1}`); item.append(document.createElement('span')); return item; }));
      runtime.pagination.bullets = Array.from(pager.children);
    };
    const move = (delta: number) => {
      const items = Array.from(pager.children), current = items.findIndex(item => item.classList.contains('wd-active')), next = Math.max(0, Math.min(items.length - 1, current + delta));
      items.forEach((item, index) => item.classList.toggle('wd-active', index === next));
    };
    root.querySelector('.wd-next')!.addEventListener('click', () => move(1)); root.querySelector('.wd-prev')!.addEventListener('click', () => move(-1));
    addEventListener('resize', render); render();
  }, { productCount: options.productCount ?? 13, perItem: options.perItem ?? false });
  return page;
}
const read = (page: Page) => collectNativeFractionPaint({ page, ownerSelector: owner, evidencePath: 'actual-fraction-browser.json' });

test('native fraction CSS contains no static count, uses the registered scoped control and rejects manufactured generated labels', () => {
  assert.doesNotThrow(() => validateScopedNativeCSS(css));
  assert.equal(hasNativeFractionBinding({ type: 'wd_products', settings: { custom_css: css } }), true);
  assert.equal(hasNativeFractionBinding({ type: 'wd_products', settings: { custom_css: `selector .wd-nav-arrows{justify-content:center;}\n${css}` } }), true);
  assert.equal(hasNativeFractionBinding({ type: 'heading', settings: { custom_css: css } }), false);
  assert.equal(hasNativeFractionBinding({ type: 'wd_products', settings: { custom_css: css.replace('clonewp-page-total clonewp-page-current', 'clonewp-page-total') } }), false);
  assert.equal(hasNativeFractionBinding({ type: 'wd_products', settings: { custom_css: `${css}\nselector .wd-nav-pagin::after{content:"1 / 12";}` } }), false);
  assert.throws(() => validateScopedNativeCSS('selector::after{content:"1 / 12";}'), /live-pagination/);
  assert.throws(() => validateScopedNativeCSS('selector{counter-reset:clonewp-page-current 12;}'), /live-pagination/);
});

test('Chromium painted fraction follows native next/previous and actual query counts without fabricated DOM text', async () => {
  for (const productCount of [7, 13, 22]) {
    const page = await fixture({ productCount });
    try {
      const before = await read(page); assert.ok(before); assert.equal(before.renderedText, `1 / ${Math.ceil(productCount / 5)}`);
      assert.equal(await page.locator('.wd-nav-pagin').textContent(), '', 'drawn digits come from generated text layout');
      await page.locator('.wd-next').click(); const next = await read(page); assert.ok(next); assert.equal(next.current, 2); assert.equal(next.total, before.total);
      await page.locator('.wd-prev').click(); const restored = await read(page); assert.equal(restored?.renderedText, before.renderedText);
      assert.equal(before.productCount, productCount); assert.equal(before.paintSource, 'chromium-layout-generated-text');
    } finally { await page.close(); }
  }
});

test('responsive native pagination rebuilding changes the drawn total and previous/current state stays linked', async () => {
  const page = await fixture();
  try {
    for (const [width, total] of [[1200, 3], [900, 5], [390, 7]] as const) {
      await page.setViewportSize({ width, height: 500 });
      await page.waitForFunction(expected => document.querySelectorAll('.wd-nav-pagin-item').length === expected, total);
      assert.equal((await read(page))?.renderedText, `1 / ${total}`);
      await page.locator('.wd-next').click(); assert.equal((await read(page))?.renderedText, `2 / ${total}`);
      await page.locator('.wd-prev').click(); assert.equal((await read(page))?.renderedText, `1 / ${total}`);
    }
    await mkdir('D:/cloneWP/.cache/native-fraction-tests', { recursive: true });
    await page.screenshot({ path: 'D:/cloneWP/.cache/native-fraction-tests/fraction-mobile.png' });
  } finally { await page.close(); }
});

test('the real-arrow probe records drawn before/after/restored state rather than a static fraction expectation', async () => {
  const page = await fixture();
  try {
    const receipt = await probeNativeFractionNavigation({ page, ownerSelector: owner, evidencePath: 'actual-arrow-probe.json' });
    assert.equal(receipt.passed, true); assert.equal(receipt.before?.renderedText, '1 / 3'); assert.equal(receipt.changed?.renderedText, '2 / 3'); assert.equal(receipt.restored?.renderedText, '1 / 3');
    await page.locator('.wd-nav-arrows').evaluate(node => { (node as HTMLElement).style.display = 'none'; });
    assert.equal((await probeNativeFractionNavigation({ page, ownerSelector: owner, evidencePath: 'actual-arrow-probe.json' })).passed, false);
  } finally { await page.close(); }
});

test('missing runtime, mismatched pagination ownership and unpainted static counters cannot generate a native proof', async () => {
  const page = await fixture();
  try {
    await page.addStyleTag({ content: `${owner} .wd-nav-pagin::after{content:"1 / 3";}` });
    assert.equal(await read(page), undefined);
  } finally { await page.close(); }
  const second = await fixture();
  try {
    await second.locator('.wd-carousel').evaluate(node => { const runtime = (node as unknown as Element & { swiper: { pagination: { bullets: Element[] } } }).swiper; runtime.pagination.bullets = []; });
    assert.equal(await read(second), undefined);
  } finally { await second.close(); }
});

function model() {
  const none = { status: 'not-applicable' as const, evidence: [] }, evidence = ['actual-source'], rect = { x: 0, y: 0, width: 80, height: 30 };
  const view: PresentationViewport = { status: 'observed', width: 1200, evidence, regions: [{ id: 'track', sourceNodeId: '.track', rect, visible: true, evidence }], controlGroups: [{ id: 'controls', sourceNodeId: '.controls', ownerId: 'track', rect, visible: true, evidence, pagination: 'fraction', layout: 'row', controls: [{ id: 'fraction', sourceNodeId: '.counter', role: 'fraction', rect, visible: true, evidence, text: '1 / 11', textMatch: 'fraction', fractionTotal: 'target-query' }] }], relations: [], media: [] };
  const contract: BlockContract = { version: 1, workflow: 'block-replication', sourceUrl: 'https://source.example/', capturedAt: '2026-10-14T00:00:00Z', referenceReport: { path: 'source.json', sha256: 'a'.repeat(64) }, evidence: [{ id: 'actual-source', path: 'source.json', sha256: 'a'.repeat(64), kind: 'dom' }], tolerances: { geometryPx: 2, geometryRatio: .01, colorChannel: 2 }, limitations: [], blocks: [{ id: 'offers', role: 'products', presentation: 'carousel', texts: [], assets: [], evidence, geometry: { desktop: { width: 300, height: 150 } }, colors: {}, states: { normal: none, hover: none, interaction: none }, presentationDetails: { version: 1, viewports: { desktop: view } } }] };
  const schemas: Record<string, LegacySchema> = { wd_products: { type: 'wd_products', class: 'XTS\\Elementor\\Products', controls: { layout: { type: 'select', options: { carousel: 'Carousel' } }, hide_pagination_control: { type: 'switcher', default: 'no' }, dynamic_pagination_control: { type: 'switcher', default: 'no' }, custom_css: { type: 'code' } } } };
  const program: NativeProgram = { version: 1, workflow: 'block-replication', sourceUrl: contract.sourceUrl, title: 'Test', sourceContract: contract.referenceReport, assetsManifest: contract.referenceReport, deviations: [], elements: [{ key: 'root', type: 'container', settings: {}, children: [{ key: 'query', type: 'wd_products', settings: { layout: 'carousel', hide_pagination_control: 'no', custom_css: css } }] }], blocks: [{ sourceBlockId: 'offers', rootKey: 'root', presentation: 'carousel', bindings: [], presentationBindings: [{ id: 'track', elementKey: 'query' }, { id: 'controls', elementKey: 'query' }, { id: 'fraction', elementKey: 'query', relativeSelector: '.wd-nav-pagin' }], states: { normal: none, hover: none, interaction: none } }] };
  return { contract, schemas, program };
}

test('capability planning requires the complete native fraction binding and every actual pagination dependency', () => {
  const { contract, schemas, program } = model();
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, true);
  program.elements[0].children![0].settings.custom_css = 'selector{color:blue;}';
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, false);
  program.elements[0].children![0].settings.custom_css = css; delete schemas.wd_products.controls.custom_css;
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, false);
});

test('presentation reads actual drawn fraction and native non-loop snaps rather than ceil(query/group)', async () => {
  const page = await fixture({ perItem: true });
  try {
    const { contract, program } = model();
    program.blocks[0].productQuery = { provider: 'target-woocommerce', widgetKey: 'query', widgetType: 'wd_products', sourceTextIds: [], sourceAssetKeys: [], queryControlKeys: ['post_type'], evidence: ['actual-source'] };
    await page.locator('.widget').evaluate(node => { node.setAttribute('data-id', 'root'); const child = document.createElement('div'); child.setAttribute('data-id', 'owned-query'); child.setAttribute('data-widget_type', 'wd_products.default'); child.setAttribute('data-element_type', 'widget'); while (node.firstChild) child.append(node.firstChild); node.append(child); });
    const rows = await collectTargetPresentationEvidence({ page, contract, program, viewport: 'desktop', compiled: { elementMap: { root: 'root', query: 'owned-query' } }, evidencePath: 'painted-target.json' });
    const fraction = rows.find(row => row.id === 'fraction')!;
    fraction.glyph = { kind: 'pseudo', content: 'counter(clonewp-page-current) / counter(clonewp-page-total)' };
    assert.equal(fraction.text, '1 / 9'); assert.equal(fraction.fractionQuery?.totalPages, 9); assert.equal(fraction.fractionQuery?.pageSize, 1); assert.equal(fraction.fractionQuery?.nativePagination?.snapCount, 9);
    const view = contract.blocks[0].presentationDetails!.viewports.desktop;
    view.controlGroups[0].controls[0].glyph = { kind: 'text', content: '1 / 11' };
    for (const item of [view.regions[0], view.controlGroups[0], view.controlGroups[0].controls[0]]) { const row = rows.find(row => row.id === item.id)!; item.rect = row.rect!; item.visible = row.visible!; }
    view.controlGroups[0].layout = rows.find(row => row.id === 'controls')!.layout!;
    const report = verifyPresentationDetails(contract, program, rows);
    assert.ok(!report.issues.some(issue => issue.code === 'presentation-fraction-query-unmeasured'));
    assert.ok(!report.issues.some(issue => issue.code === 'presentation-glyph-content'));
    assert.ok(!report.issues.some(issue => issue.code === 'presentation-glyph-kind'));
    const proof = fraction.fractionQuery!.nativePagination!;
    delete fraction.fractionQuery!.nativePagination;
    assert.ok(verifyPresentationDetails(contract, program, rows).issues.some(issue => issue.code === 'presentation-glyph-kind'));
    fraction.fractionQuery!.nativePagination = proof;
    fraction.text = '2 / 9';
    assert.ok(verifyPresentationDetails(contract, program, rows).issues.some(issue => issue.code === 'presentation-fraction-current-state'));
    fraction.text = '1 / 9';
    fraction.fractionQuery!.nativePagination!.bulletCount = 8;
    assert.ok(verifyPresentationDetails(contract, program, rows).issues.some(issue => issue.code === 'presentation-fraction-query-unmeasured'));
  } finally { await page.close(); }
});
