import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { assertOriginalNativeEditorChange, inspectOriginalNativeComponents, readOriginalCarouselRuntime } from '../src/original/native-verification.js';
import { buildNativeFractionCSS } from '../src/fidelity/native-fraction.js';
import type { OriginalDesign } from '../src/original/types.js';
import type { OriginalCarouselComponent, OriginalProductsComponent } from '../src/original/components.js';
import type { DraftSnapshot, LegacySchema, TargetCatalogSnapshot } from '../src/wordpress/types.js';

// Local deterministic DOM/runtime fixtures exercise the verifier in real Chromium.
// They do not establish capability, editor or successful page evidence for the configured remote site.
let browser: Browser, server: Server, origin: string, directory: string;
const workspaceCache = 'D:/cloneWP/.cache';
const viewport = { name: 'desktop', width: 1200, height: 700, deviceProfile: 'desktop' as const };
const ids = { root: 'abc0001', slides: ['abc0101', 'abc0102', 'abc0103'], texts: ['abc0201', 'abc0202', 'abc0203'], button: 'abc0301', product: 'abc0401' };
test.before(async () => {
  await mkdir(workspaceCache, { recursive: true }); directory = await mkdtemp(path.join(workspaceCache, 'original-native-verification-'));
  server = createServer((request, response) => {
    if (request.url?.endsWith('.png')) { response.setHeader('Content-Type', 'image/png'); response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6zcAAAAASUVORK5CYII=', 'base64')); }
    else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><body>Local verifier fixture</body>'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No local fixture port');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => {
  await browser?.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(workspaceCache));
  assert.match(path.basename(directory), /^original-native-verification-/);
  await rm(directory, { recursive: true, force: true });
});
const design = (): OriginalDesign => ({ version: 1, workflow: 'original-design', brand: 'Local test fixture', title: 'Native verifier fixture', language: 'en', description: 'Only local verifier behavior is tested.', tokens: { colors: { ink: '#222222' }, font: 'Arial', contentWidth: 1200 }, assets: [], sections: [{ key: 'fixture-root', kind: 'container', children: [{ key: 'fixture-title', kind: 'heading', headingTag: 'h1', text: 'Local test fixture' }] }] });
const carousel = (): OriginalCarouselComponent => ({ kind: 'carousel', key: 'stories', nativeId: ids.root, type: 'nested-carousel', settings: { slides_to_show: '1' }, carousel: { slidesToShow: 1, tabletSlidesToShow: 1, mobileSlidesToShow: 1, arrows: true, pagination: 'fraction', autoplay: false, loop: false }, slideKeys: ['slide-one', 'slide-two', 'slide-three'], slideIds: [...ids.slides] });
async function blankPage(): Promise<Page> { const page = await browser.newPage({ viewport }); await page.goto(`${origin}/fixture`); return page; }
async function carouselPage(): Promise<Page> {
  const page = await blankPage();
  await page.setContent(`<!doctype html><style>body{margin:24px;font:16px/24px Arial}.owner{width:300px}.engine{width:300px;height:120px;overflow:hidden}.track{display:flex;width:900px}.slide{flex:0 0 300px;height:120px;background:#ddd}.pager{height:28px}.buttons{display:flex;gap:12px}button{width:40px;height:32px}h2{margin:20px}</style><section class="owner" data-id="${ids.root}" data-widget_type="nested-carousel.default"><div class="engine"><div class="track">${ids.slides.map((id, index) => `<div class="slide" data-id="${id}" data-element_type="container"><div data-id="${ids.texts[index]}" data-widget_type="heading.default"><h2>Authored story ${index + 1}</h2></div></div>`).join('')}</div></div><div class="buttons"><button class="previous">←</button><button class="next">→</button></div><div class="pager"><span class="swiper-pagination-current">1</span> / <span class="swiper-pagination-total">3</span></div></section><button id="foreign-next">Foreign control</button><script>globalThis.__name=(target)=>target;</script>`);
  await page.evaluate(() => {
    const root = document.querySelector('.owner')!, engine = root.querySelector('.engine')!, wrapper = root.querySelector('.track') as HTMLElement, slides = Array.from(wrapper.children), pager = root.querySelector('.pager')!;
    const runtime = { initialized: true, destroyed: false, animating: false, el: engine, wrapperEl: wrapper, slides, activeIndex: 0, snapIndex: 0, snapGrid: [0, 300, 600], params: { pagination: { type: 'fraction' }, loop: false }, navigation: { nextEl: root.querySelector('.next')!, prevEl: root.querySelector('.previous')! }, pagination: { el: pager, bullets: [] as Element[] }, autoplay: { running: false, paused: false }, slideTo: (index: number) => move(index) };
    const move = (index: number) => { runtime.activeIndex = Math.max(0, Math.min(slides.length - 1, index)); runtime.snapIndex = runtime.activeIndex; wrapper.style.transform = `translateX(${-300 * runtime.activeIndex}px)`; pager.querySelector('.swiper-pagination-current')!.textContent = String(runtime.activeIndex + 1); };
    Object.assign(engine, { swiper: runtime });
    runtime.navigation.nextEl.addEventListener('click', () => move(runtime.activeIndex + 1)); runtime.navigation.prevEl.addEventListener('click', () => move(runtime.activeIndex - 1));
  });
  return page;
}
async function inspectCarousel(page: Page, component = carousel(), label = 'carousel') {
  return inspectOriginalNativeComponents({ page, viewport, design: design(), elementMap: { stories: ids.root }, components: [component], runDir: path.join(directory, label) });
}
const catalog = (): TargetCatalogSnapshot => ({ version: 1, targetOrigin: origin, readAt: '2026-10-14T00:00:00Z', evidence: [path.join(directory, 'fixture-catalog.json')], query: { limit: 3, status: 'publish', visibility: 'visible', orderby: 'date', order: 'DESC' }, products: [81, 82, 83].map(id => ({ id, name: `Fixture target product ${id}`, permalink: `${origin}/product/${id}`, imageUrl: `${origin}/${id}.png`, imageVariants: [`${origin}/${id}.png`], priceText: '$20' })) });
const products = (snapshot: TargetCatalogSnapshot, carouselLayout = true): OriginalProductsComponent => ({ kind: 'products', key: 'own-products', nativeId: ids.product, type: 'wd_products', settings: { items_per_page: 3 }, query: { limit: 3 }, display: { layout: carouselLayout ? 'carousel' : 'grid', columns: carouselLayout ? 1 : 3, arrows: true, pagination: carouselLayout ? 'fraction' : undefined }, productIds: snapshot.products.map(product => product.id), catalog: { targetOrigin: snapshot.targetOrigin, readAt: snapshot.readAt, evidence: [...snapshot.evidence], products: structuredClone(snapshot.products) }, ...(carouselLayout ? { styleAdapter: 'woodmart-native-fraction-v1' as const } : {}) });
async function productPage(carouselLayout = true): Promise<Page> {
  const page = await blankPage(), snapshot = catalog(), owner = `[data-id="${ids.product}"]`, fraction = buildNativeFractionCSS().replaceAll('selector', owner);
  await page.setContent(`<!doctype html><style>body{margin:24px;font:16px/24px Arial}.owner{width:${carouselLayout ? 300 : 900}px}.engine{width:${carouselLayout ? 300 : 900}px;height:160px;overflow:hidden}.track{display:flex;width:900px}.product-grid-item{flex:0 0 300px;height:160px}.product-wrapper{height:160px}img{width:80px;height:70px}h3{margin:0;font-size:16px}.wd-nav-arrows{display:flex;gap:12px}.wd-nav-pagin-wrap{width:80px;height:28px}.wd-nav-pagin{font:16px/24px Arial}button{height:32px}${fraction}</style><section class="owner" data-id="${ids.product}" data-widget_type="wd_products.default"><div class="engine wd-carousel"><div class="track wd-carousel-wrap">${snapshot.products.map(product => `<div class="product-grid-item product" data-id="${product.id}"><div class="product-wrapper"><a href="${product.permalink}"><img src="${product.imageUrl}"></a><h3 class="wd-entities-title"><a href="${product.permalink}">${product.name}</a></h3><span class="price">${product.priceText}</span></div></div>`).join('')}</div></div><div class="wd-nav-arrows"><button class="wd-prev">←</button><button class="wd-next">→</button></div><div class="wd-nav-pagin-wrap"><ul class="wd-nav-pagin">${[0, 1, 2].map(index => `<li class="wd-nav-pagin-item${index === 0 ? ' wd-active' : ''}"></li>`).join('')}</ul></div></section><script>globalThis.__name=(target)=>target;</script>`);
  if (carouselLayout) await page.evaluate(() => {
    const root = document.querySelector('.owner')!, engine = root.querySelector('.engine')!, wrapper = root.querySelector('.track') as HTMLElement, pager = root.querySelector('.wd-nav-pagin')!, slides = Array.from(wrapper.children), bullets = Array.from(pager.children);
    const runtime = { initialized: true, destroyed: false, animating: false, el: engine, wrapperEl: wrapper, slides, activeIndex: 0, snapIndex: 0, snapGrid: [0, 300, 600], params: { loop: false, slidesPerView: 1, slidesPerGroup: 1 }, navigation: { nextEl: root.querySelector('.wd-next')!, prevEl: root.querySelector('.wd-prev')! }, pagination: { el: pager, bullets }, slideTo: (index: number) => move(index - runtime.activeIndex) };
    const move = (delta: number) => { runtime.activeIndex = Math.max(0, Math.min(slides.length - 1, runtime.activeIndex + delta)); runtime.snapIndex = runtime.activeIndex; wrapper.style.transform = `translateX(${-300 * runtime.activeIndex}px)`; bullets.forEach((item, index) => item.classList.toggle('wd-active', index === runtime.activeIndex)); };
    Object.assign(engine, { swiper: runtime }); runtime.navigation.nextEl.addEventListener('click', () => move(1)); runtime.navigation.prevEl.addEventListener('click', () => move(-1));
  });
  await page.waitForFunction(() => [...document.images].every(image => image.complete)); return page;
}
async function inspectProducts(page: Page, snapshot = catalog(), carouselLayout = true, label = 'products') { return inspectOriginalNativeComponents({ page, viewport, design: design(), elementMap: { 'own-products': ids.product }, components: [products(snapshot, carouselLayout)], catalog: snapshot, runDir: path.join(directory, label) }); }

test('owned initialized carousel reads actual canonical boundaries, descendant native membership and clipping', async () => {
  const page = await carouselPage();
  try {
    const state = await readOriginalCarouselRuntime(page.locator(`[data-id="${ids.root}"]`));
    assert.equal(state.initialized, true); assert.equal(state.windowValid, true); assert.equal(state.animating, false);
    assert.deepEqual(state.slideIds, ids.slides.map((id, index) => [id, ids.texts[index]])); assert.deepEqual(state.visibleSlideIndices, [0]);
    assert.deepEqual(state.clippedNativeIds, [ids.slides[1], ids.texts[1], ids.slides[2], ids.texts[2]]);
    assert.equal(state.pagination?.bound, true); assert.equal(state.pagination?.text, '1 / 3'); assert.ok(state.nextSelector?.startsWith(':scope >'));
    await page.locator('.next').click(); const changed = await readOriginalCarouselRuntime(page.locator(`[data-id="${ids.root}"]`));
    assert.deepEqual(changed.visibleSlideIndices, [1]); assert.equal(changed.pagination?.current, 2); assert.equal(changed.pagination?.total, 3); assert.equal(changed.pagination?.bound, true);
  } finally { await page.close(); }
});

test('carousel ownership cannot be supplied by foreign instances, controls, duplicated engines or unbounded document clipping', async () => {
  for (const failure of ['foreign-wrapper', 'two-engines', 'wrong-el', 'destroyed', 'no-clipping', 'document-overflow', 'foreign-arrows'] as const) {
    const page = await carouselPage();
    try {
      await page.evaluate(failure => {
        type Runtime = { wrapperEl: Element; el: Element; destroyed: boolean; navigation: { nextEl: Element } };
        const engine = document.querySelector('.engine')! as HTMLElement & { swiper: Runtime }, runtime = engine.swiper;
        if (failure === 'foreign-wrapper') runtime.wrapperEl = document.getElementById('foreign-next')!;
        if (failure === 'wrong-el') runtime.el = document.querySelector('.owner')!;
        if (failure === 'destroyed') runtime.destroyed = true;
        if (failure === 'two-engines') { const extra = document.createElement('div'), track = document.createElement('div'); extra.append(track); document.querySelector('.owner')!.append(extra); Object.assign(extra, { swiper: { ...runtime, el: extra, wrapperEl: track } }); }
        if (failure === 'no-clipping') (engine as HTMLElement).style.overflow = 'visible';
        if (failure === 'document-overflow') { const wide = document.createElement('div'); wide.style.width = '2000px'; wide.style.height = '20px'; document.body.append(wide); }
        if (failure === 'foreign-arrows') runtime.navigation.nextEl = document.getElementById('foreign-next')!;
      }, failure);
      const state = await readOriginalCarouselRuntime(page.locator(`[data-id="${ids.root}"]`));
      if (failure === 'no-clipping' || failure === 'document-overflow') { assert.equal(state.windowValid, false, failure); assert.deepEqual(state.clippedNativeIds, []); }
      else if (failure === 'foreign-arrows') assert.equal(state.nextSelector, undefined);
      else { assert.equal(state.initialized, false); assert.deepEqual(state.coveredNativeIds, []); }
    } finally { await page.close(); }
  }
});

test('native carousel inspection navigates every slide through owned real arrows and restores fraction and geometry', async () => {
  const page = await carouselPage();
  try {
    const report = await inspectCarousel(page, carousel(), 'carousel-pass');
    assert.equal(report.passed, true); assert.deepEqual(report.issues, []); const proof = report.carousels[0];
    assert.equal(proof.initialized, true); assert.equal(proof.changed, true); assert.equal(proof.restored, true); assert.equal(proof.navigationMethod, 'arrows');
    assert.equal(proof.before?.pagination?.text, '1 / 3'); assert.equal(proof.after?.pagination?.text, '3 / 3');
    assert.deepEqual(new Set(proof.coveredNativeIds), new Set([...ids.slides, ...ids.texts]));
    const restored = await readOriginalCarouselRuntime(page.locator(`[data-id="${ids.root}"]`)); assert.equal(restored.pagination?.text, '1 / 3'); assert.deepEqual(restored.visibleSlideIndices, [0]);
    const saved = JSON.parse(await readFile(path.join(directory, 'carousel-pass/verification/native-components/desktop.json'), 'utf8')); assert.equal(saved.passed, true);
  } finally { await page.close(); }
});

test('manufactured current/total and wrong authored canonical order cannot satisfy carousel proof', async () => {
  for (const failure of ['wrong-current', 'wrong-total', 'wrong-slide-order'] as const) {
    const page = await carouselPage(), component = carousel();
    try {
      if (failure === 'wrong-slide-order') component.slideIds.reverse();
      else await page.locator(failure === 'wrong-current' ? '.swiper-pagination-current' : '.swiper-pagination-total').evaluate(element => { element.textContent = '99'; });
      const state = await readOriginalCarouselRuntime(page.locator(`[data-id="${ids.root}"]`));
      if (failure !== 'wrong-slide-order') assert.equal(state.pagination?.bound, false);
      const report = await inspectCarousel(page, component, failure); assert.equal(report.passed, false); assert.ok(report.issues.some(issue => issue.code === 'original-native-carousel'));
      assert.equal(report.carousels[0].restored, true); assert.deepEqual(report.carousels[0].coveredNativeIds, []);
    } finally { await page.close(); }
  }
});

test('correct fraction numbers hidden inside a painted pager cannot prove actual numeral paint', async () => {
  for (const hidden of ['display', 'visibility', 'opacity'] as const) {
    const page = await carouselPage();
    try {
      await page.locator('.swiper-pagination-current').evaluate((element, hidden) => { const html = element as HTMLElement; if (hidden === 'display') html.style.display = 'none'; if (hidden === 'visibility') html.style.visibility = 'hidden'; if (hidden === 'opacity') html.style.opacity = '0'; }, hidden);
      const state = await readOriginalCarouselRuntime(page.locator(`[data-id="${ids.root}"]`));
      assert.equal(state.pagination?.bound, true); assert.equal(state.pagination?.visible, false);
      const report = await inspectCarousel(page, carousel(), `hidden-fraction-${hidden}`); assert.equal(report.passed, false); assert.ok(report.issues.some(issue => issue.code === 'original-native-carousel'));
    } finally { await page.close(); }
  }
});

test('carousel observer restores the initial native window even when a pager fails after real navigation', async () => {
  const page = await carouselPage();
  try {
    await page.locator('.next').evaluate(element => element.addEventListener('click', () => { document.querySelector('.swiper-pagination-current')!.textContent = '99'; }));
    const report = await inspectCarousel(page, carousel(), 'carousel-failed-after-navigation');
    assert.equal(report.passed, false); assert.equal(report.carousels[0].changed, true); assert.equal(report.carousels[0].restored, true);
    const restored = await readOriginalCarouselRuntime(page.locator(`[data-id="${ids.root}"]`)); assert.deepEqual(restored.visibleSlideIndices, [0]); assert.equal(restored.pagination?.text, '1 / 3'); assert.equal(restored.pagination?.bound, true);
  } finally { await page.close(); }
});

test('product observer restores the actual starting native IDs when painted fraction verification fails after next', async () => {
  const page = await productPage();
  try {
    await page.locator('.wd-next').evaluate(element => element.addEventListener('click', () => { document.querySelectorAll('.wd-nav-pagin-item').forEach(item => item.classList.add('wd-active')); }));
    const report = await inspectProducts(page, catalog(), true, 'product-failed-after-navigation');
    assert.equal(report.passed, false); assert.equal(report.products[0].passed, false); assert.ok(report.issues.some(issue => issue.code === 'original-native-products'));
    assert.ok(!report.issues.some(issue => issue.code === 'original-native-products-observer-restore'));
    assert.equal(await page.locator('.wd-active').count(), 1); assert.equal(await page.locator('.wd-active').evaluate(element => [...element.parentElement!.children].indexOf(element)), 0);
    const window = await page.locator('.engine').boundingBox(), first = await page.locator('.product-grid-item').first().boundingBox(); assert.ok(window && first); assert.equal(first.x, window.x);
  } finally { await page.close(); }
});

test('actual Woodmart fraction paint and queried DOM product fields change and restore independently of fixture catalog', async () => {
  const page = await productPage();
  try {
    const report = await inspectProducts(page, catalog(), true, 'products-fraction-pass');
    assert.equal(report.passed, true); assert.deepEqual(report.issues, []); const proof = report.products[0];
    assert.deepEqual(proof.actualIds, [81, 82, 83]); assert.equal(proof.passed, true);
    assert.equal(proof.pagination?.before?.renderedText, '1 / 3'); assert.equal(proof.pagination?.after?.renderedText, '2 / 3'); assert.equal(proof.pagination?.restored?.renderedText, '1 / 3');
    assert.equal(proof.pagination?.before?.paintSource, 'chromium-layout-generated-text'); assert.equal(await page.locator('.wd-nav-pagin').textContent(), '');
    assert.equal(await page.locator('.wd-active').evaluate(element => [...element.parentElement!.children].indexOf(element)), 0);
  } finally { await page.close(); }
});

test('actual target product DOM mismatches and missing catalog evidence remain failures rather than catalog-filled facts', async () => {
  for (const failure of ['name', 'image', 'price', 'link', 'ids-order', 'missing-evidence'] as const) {
    const page = await productPage(false), snapshot = catalog();
    try {
      if (failure === 'missing-evidence') snapshot.evidence = [];
      else await page.evaluate(failure => {
        const card = document.querySelector('.product-grid-item')!;
        if (failure === 'name') card.querySelector('h3 a')!.textContent = 'Wrong invented name';
        if (failure === 'image') card.querySelector('img')!.setAttribute('src', '/not-this-product.png');
        if (failure === 'price') card.querySelector('.price')!.textContent = '$999';
        if (failure === 'link') card.querySelector('h3 a')!.setAttribute('href', '/foreign-product');
        if (failure === 'ids-order') card.parentElement!.append(card);
      }, failure);
      const report = await inspectProducts(page, snapshot, false, `wrong-product-${failure}`); assert.equal(report.passed, false); assert.equal(report.products[0].passed, false); assert.ok(report.issues.some(issue => issue.code === 'original-native-products'));
    } finally { await page.close(); }
  }
});

test('native button hover records browser paint and restores; missing change and wrong colors withhold success', async () => {
  for (const mode of ['pass', 'no-change', 'wrong-color'] as const) {
    const page = await blankPage(), input = design();
    input.sections[0].children!.push({ key: 'hover-button', kind: 'button', text: 'Read stories', href: '#stories', hover: { background: '#004422', color: '#FFFFFF' } });
    await page.setContent(`<!doctype html><style>body{margin:40px}a{display:inline-block;padding:16px 24px;background:rgb(221,221,221);color:rgb(34,34,34)}${mode === 'no-change' ? '' : `a:hover{background:${mode === 'wrong-color' ? '#BB0000' : '#004422'};color:#FFFFFF}`}</style><div data-id="${ids.button}" data-widget_type="button.default"><a class="elementor-button" href="#stories">Read stories</a></div>`);
    try {
      const report = await inspectOriginalNativeComponents({ page, viewport, design: input, elementMap: { 'hover-button': ids.button }, components: [], runDir: path.join(directory, `hover-${mode}`) });
      if (mode === 'pass') { assert.equal(report.passed, true); assert.equal(report.hovers[0].changed, true); assert.equal(report.hovers[0].restored, true); assert.equal(report.hovers[0].passed, true); assert.equal(await page.locator('a').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(221, 221, 221)'); }
      else { assert.equal(report.passed, false); assert.equal(report.hovers[0].passed, false); assert.equal(report.hovers[0].restored, true); assert.ok(report.issues.some(issue => issue.code === 'original-native-hover')); assert.equal(await page.locator('a').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(221, 221, 221)'); }
    } finally { await page.mouse.move(0, 0); await page.close(); }
  }
});

test('linked heading hover observes its painted native link rather than constant widget-wrapper color and restores failed probes', async () => {
  for (const mode of ['pass', 'no-change', 'wrong-color'] as const) {
    const page = await blankPage(), input = design();
    input.sections[0].children!.push({ key: 'hover-heading', kind: 'heading', headingTag: 'p', text: 'Read stories', href: '#stories', hover: { color: '#506850' } });
    await page.setContent(`<!doctype html><style>body{margin:40px}.owner{color:#595959}.elementor-heading-title a{display:inline-block;padding:8px;color:#303B33}${mode === 'no-change' ? '' : `.elementor-heading-title a:hover{color:${mode === 'wrong-color' ? '#BB0000' : '#506850'}}`}</style><div class="owner" data-id="${ids.button}" data-widget_type="heading.default"><p class="elementor-heading-title"><a href="#stories">Read stories</a></p></div>`);
    try {
      const report = await inspectOriginalNativeComponents({ page, viewport, design: input, elementMap: { 'hover-heading': ids.button }, components: [], runDir: path.join(directory, `heading-hover-${mode}`) });
      const proof = report.hovers[0];
      assert.equal(proof.before?.color, 'rgb(48, 59, 51)'); assert.equal(proof.restored, true);
      assert.equal(proof.paintedSelector, `[data-id="${ids.button}"] .elementor-heading-title a`);
      assert.equal(await page.locator('.owner').evaluate(element => getComputedStyle(element).color), 'rgb(89, 89, 89)');
      assert.equal(await page.locator('.elementor-heading-title a').evaluate(element => getComputedStyle(element).color), 'rgb(48, 59, 51)');
      if (mode === 'pass') { assert.equal(report.passed, true); assert.equal(proof.passed, true); assert.equal(proof.changed, true); assert.equal(proof.after?.color, 'rgb(80, 104, 80)'); }
      else { assert.equal(report.passed, false); assert.equal(proof.passed, false); assert.ok(report.issues.some(issue => issue.code === 'original-native-hover')); }
    } finally { await page.close(); }
  }
});

test('heading hover rejects missing, ambiguous, foreign or unrelated painted targets instead of searching any descendant', async () => {
  for (const failure of ['missing', 'ambiguous', 'foreign', 'wrong-text', 'wrong-href', 'wrong-widget', 'duplicated-owner', 'hidden', 'transparent-parent'] as const) {
    const page = await blankPage(), input = design();
    input.sections[0].children!.push({ key: 'hover-heading', kind: 'heading', text: 'Read stories', href: '#stories', hover: { color: '#506850' } });
    const link = `<a href="${failure === 'wrong-href' ? '#elsewhere' : '#stories'}">${failure === 'wrong-text' ? 'Unrelated link' : 'Read stories'}</a>`;
    const heading = failure === 'missing' ? link : `<h2 class="elementor-heading-title"${failure === 'hidden' ? ' style="display:none"' : ''}>${link}${failure === 'ambiguous' ? link : ''}</h2>`;
    const body = `<div class="owner" data-id="${ids.button}" data-widget_type="${failure === 'wrong-widget' ? 'text-editor' : 'heading'}.default"${failure === 'transparent-parent' ? ' style="opacity:0"' : ''}>${failure === 'foreign' ? `<div data-id="abc0801" data-widget_type="heading.default">${heading}</div>` : heading}</div>`;
    await page.setContent(`<!doctype html><style>body{margin:40px}.owner{color:#595959}a{display:inline-block;color:#303B33}a:hover{color:#506850}</style>${body}${failure === 'duplicated-owner' ? body : ''}`);
    try {
      const report = await inspectOriginalNativeComponents({ page, viewport, design: input, elementMap: { 'hover-heading': ids.button }, components: [], runDir: path.join(directory, `heading-hover-invalid-${failure}`) });
      assert.equal(report.passed, false); assert.equal(report.hovers[0].passed, false); assert.equal(report.hovers[0].before, undefined);
      assert.ok(report.issues.some(issue => issue.code === 'original-native-hover'));
    } finally { await page.close(); }
  }
});

test('native image and container hover retain their own painted-role targets and restore', async () => {
  for (const role of ['image', 'container'] as const) {
    const page = await blankPage(), input = design();
    input.sections[0].children!.push(role === 'image' ? { key: 'hover-role', kind: 'image', hover: { opacity: .5 } } : { key: 'hover-role', kind: 'container', hover: { background: '#506850' } });
    await page.setContent(role === 'image' ? `<!doctype html><style>body{margin:40px}img{width:60px;height:60px}img:hover{opacity:.5}</style><div data-id="${ids.button}" data-widget_type="image.default"><img src="${origin}/hover.png"></div>` : `<!doctype html><style>body{margin:40px}.owner{width:100px;height:80px;background:#DDD}.owner:hover{background:#506850}</style><div class="owner" data-id="${ids.button}" data-element_type="container">Content</div>`);
    try {
      await page.waitForFunction(() => [...document.images].every(image => image.complete));
      const report = await inspectOriginalNativeComponents({ page, viewport, design: input, elementMap: { 'hover-role': ids.button }, components: [], runDir: path.join(directory, `role-hover-${role}`) });
      assert.equal(report.passed, true); assert.equal(report.hovers[0].changed, true); assert.equal(report.hovers[0].restored, true);
      assert.equal(report.hovers[0].paintedSelector, `[data-id="${ids.button}"]${role === 'image' ? ' img' : ''}`);
    } finally { await page.close(); }
  }
});

const editorSchemas = (): Record<string, LegacySchema> => ({ container: { type: 'container', class: 'Elementor\\Container', controls: {} }, heading: { type: 'heading', class: 'Elementor\\Widget_Heading', controls: { title: { type: 'text' } } }, wd_products: { type: 'wd_products', class: 'XTS\\Elementor\\Products', controls: { items_per_page: { type: 'number', default: 3 }, include: { type: 'wd_autocomplete' } } }, 'nested-carousel': { type: 'nested-carousel', class: 'ElementorPro\\Modules\\NestedCarousel\\Widgets\\Nested_Carousel', controls: { slides_to_show: { type: 'select', default: '1', options: { '1': 'One', '2': 'Two', '3': 'Three' } }, carousel_name: { type: 'text' }, carousel_items: { type: 'nested-elements-repeater' } } } });
const snapshot = (): DraftSnapshot => ({ pageId: 100, runId: 'owned-original-fixture', title: 'Original draft fixture', status: 'draft', hash: 'a'.repeat(64), settings: { hide_title: 'yes' }, elements: [{ id: 'abc0999', elType: 'container', settings: {}, isInner: false, elements: [{ id: ids.product, elType: 'widget', widgetType: 'wd_products', settings: { items_per_page: 3, include: [81, 82, 83] }, elements: [] }, { id: ids.root, elType: 'widget', widgetType: 'nested-carousel', settings: { slides_to_show: '1', carousel_name: 'Stories', carousel_items: [{ _id: 'aaa0001', slide_title: 'First' }] }, elements: [{ id: ids.slides[0], elType: 'container', isInner: true, settings: {}, elements: [{ id: ids.texts[0], elType: 'widget', widgetType: 'heading', settings: { title: 'Authored copy' }, elements: [] }] }] }] }] });

test('exact native editor count/display change is accepted without mutating either snapshot', () => {
  for (const mode of ['products', 'carousel'] as const) {
    const before = snapshot(), current = snapshot(), savedBefore = structuredClone(before), nativeId = mode === 'products' ? ids.product : ids.root, setting = mode === 'products' ? 'items_per_page' : 'slides_to_show', value = mode === 'products' ? 2 : '2';
    current.elements[0].elements[mode === 'products' ? 0 : 1].settings[setting] = value;
    assert.doesNotThrow(() => assertOriginalNativeEditorChange(before, current, { nativeId, setting, value }, editorSchemas())); assert.deepEqual(before, savedBefore);
  }
});

test('native editor change guard rejects concurrent settings, identities, child order, text and foreign document changes', () => {
  const edit = { nativeId: ids.product, setting: 'items_per_page', value: 2 };
  const mutations: Array<(current: DraftSnapshot) => void> = [
    current => { current.pageId = 101; }, current => { current.runId = 'another-run'; }, current => { current.status = 'publish' as 'draft'; }, current => { current.title = 'Human edit'; }, current => { current.settings.hide_title = 'no'; },
    current => { current.elements[0].elements[0].settings.include = [999]; }, current => { current.elements[0].elements[1].settings.carousel_name = 'Human new name'; }, current => { current.elements[0].elements[1].elements[0].elements[0].settings.title = 'Concurrent authored text'; },
    current => { current.elements[0].elements.reverse(); }, current => { current.elements[0].elements[1].elements[0].id = 'fff0001'; }, current => { current.elements[0].elements[1].elements.push({ id: 'fff0002', elType: 'container', settings: {}, elements: [] }); },
  ];
  for (const mutate of mutations) { const before = snapshot(), current = snapshot(); current.elements[0].elements[0].settings.items_per_page = 2; mutate(current); assert.throws(() => assertOriginalNativeEditorChange(before, current, edit, editorSchemas()), /outside|unrelated|structure|identity|order/); }
  const illegal = snapshot(); illegal.elements[0].elements[0].settings.items_per_page = -2; assert.throws(() => assertOriginalNativeEditorChange(snapshot(), illegal, { ...edit, value: -2 }, editorSchemas()), /legal registered value/);
  const unregistered = editorSchemas(); delete unregistered.wd_products.controls.items_per_page; assert.throws(() => assertOriginalNativeEditorChange(snapshot(), snapshot(), edit, unregistered), /actual registered/);
  const carouselIllegal = snapshot(); carouselIllegal.elements[0].elements[1].settings.slides_to_show = '9'; assert.throws(() => assertOriginalNativeEditorChange(snapshot(), carouselIllegal, { nativeId: ids.root, setting: 'slides_to_show', value: '9' }, editorSchemas()), /legal registered value/);
});
