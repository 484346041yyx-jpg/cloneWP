import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { renderStaticHTML, validateNativeCSSV2 } from '../src/replica-v2/html.js';

const probe = () => import(pathToFileURL('D:/cloneWP/tools/probe-pet-v2-breakpoints.ts').href);
const marketing = () => import(pathToFileURL('D:/cloneWP/tools/pet-v2-responsive-marketing.mjs').href);

test('native Swiper min-inclusive breakpoint expectations remain independent of CSS max-inclusive mobile mode and runtime counts', async () => {
  const { nativeCarouselBoundaryContract } = await probe(), settings = { slides_to_show: '6', slides_to_show_tablet: '6', slides_to_show_mobile: '2' }, engine = { breakpointsBase: 'window', breakpoints: { 0: { slidesPerView: 2 }, 768: { slidesPerView: 6 }, 1024: { slidesPerView: 6 } } };
  const before = nativeCarouselBoundaryContract(767, settings, engine), edge = nativeCarouselBoundaryContract(768, settings, engine), after = nativeCarouselBoundaryContract(769, settings, engine);
  assert.deepEqual([before.mode, before.expectedSlidesPerView, before.expectedRuntimeBreakpoint], ['mobile', 2, '0']);
  assert.deepEqual([edge.mode, edge.expectedSlidesPerView, edge.expectedRuntimeBreakpoint], ['tablet', 6, '768']);
  assert.deepEqual([after.mode, after.expectedSlidesPerView, after.expectedRuntimeBreakpoint], ['tablet', 6, '768']);
  assert.equal(nativeCarouselBoundaryContract(1024, settings, engine).mode, 'desktop');
  assert.equal(edge.configuredCountsMatch, true);
  const wrong = nativeCarouselBoundaryContract(768, settings, { ...engine, breakpoints: { ...engine.breakpoints, 768: { slidesPerView: 2 } } });
  assert.equal(wrong.expectedSlidesPerView, 6, 'Changing engine configuration must not change the authored expected count');
  assert.equal(wrong.configuredCountsMatch, false);
  assert.throws(() => nativeCarouselBoundaryContract(768, settings, { ...engine, breakpointsBase: 'container' }), /window/);
  assert.throws(() => nativeCarouselBoundaryContract(768, settings, { ...engine, breakpoints: { 0: { slidesPerView: 2 }, 769: { slidesPerView: 6 }, 1024: { slidesPerView: 6 } } }), /map differs/);
});

test('actual 768 marketing card geometry rejects six native columns with mobile CSS and accepts aligned owned tablet cards/controls', async () => {
  const { applyPetResponsiveMarketing } = await marketing(), { marketingBoundaryGeometry } = await probe();
  const taskId = 'native-768-regression', region = 'dog-deals', id = (key: string) => createHash('sha256').update(`clonewp-replica-v2:${taskId}:${key}`).digest('hex').slice(0, 7);
  const heading: any = { key: `${region}-heading`, kind: 'html-static', settings: {}, template: '<div class="marketing-heading"><h2 data-cwp-text="title"></h2><a class="heading-shop-all" data-cwp-link="shop" data-cwp-text="shop"></a></div>', css: '.marketing-heading{position:relative}h2{margin:0}.heading-shop-all{position:absolute}', slots: { text: { title: 'Actual marketing owner', shop: 'Shop All' }, media: {}, links: { shop: { url: 'https://source.example/deals' } } } };
  const slides = Array.from({ length: 6 }, (_, index) => ({ key: `${region}-item-${index}`, kind: 'html-static', template: '<article class="marketing-card"><img class="marketing-image" data-cwp-media="image"><div class="marketing-copy"><p data-cwp-text="copy"></p></div></article>', css: ':scope *{box-sizing:border-box}.marketing-image{display:block;max-width:100%;object-fit:contain}.marketing-copy p{margin:0}.marketing-card{text-align:center}', slots: { text: { copy: 'Source owned deal with several lines' }, media: { image: { assetKey: 'fixture' } }, links: {} } }));
  const carousel: any = { key: `${region}-carousel`, kind: 'native-carousel', settings: {}, widgetSettings: { slides_to_show: '6', slides_to_show_tablet: '6', slides_to_show_mobile: '2' }, slides };
  const original: any = { taskId, blocks: [{ key: region, kind: 'composite', settings: {}, children: [heading, carousel] }], bindings: [region, heading.key, carousel.key].map(componentKey => ({ componentKey, regionIds: [region], sourceNodeIds: [], slotNodes: { text: {}, media: {}, links: {} } })), adaptations: [] };
  const authored = applyPetResponsiveMarketing({ authored: original, packetsByViewport: {} }).authored, root = authored.blocks[0], [actualHeading, actualCarousel] = root.children;
  const render = (component: any) => renderStaticHTML(component, taskId, id(component.key + '-content'), [{ key: 'fixture', attachmentId: 1, sha256: '0'.repeat(64), sourceUrl: 'https://fixture.invalid/image.png', url: 'https://fixture.invalid/image.png', mimeType: 'image/svg+xml' }], 'responsive').html;
  const fixture = (broken: boolean) => {
    const responsive = (component: any) => ({ ...component, responsiveCss: broken ? component.responsiveCss.replaceAll('@media(max-width:767px)', '@media(max-width:768px)') : component.responsiveCss });
    const nativeCSS = (component: any) => { let css = component.settings.custom_css || ''; if (broken) css = css.replaceAll('@media(max-width:767px)', '@media(max-width:768px)').replace(/@media\(min-width:768px\) and \(max-width:768px\)\{selector>\[data-id="[a-f0-9]+"\]\{--e-n-carousel-swiper-slides-to-display:6\}\}/g, ''); return validateNativeCSSV2(css, component.key).replaceAll('selector', `[data-id="${id(component.key)}"]`); };
    // Exact observed wrapper hierarchy. The inline sixth-width slots represent
    // the already initialized engine's real slidesPerView=6 at min-width768;
    // generated Elementor CSS still declares2 until the owned correction.
    const base = `html,body{margin:0;font:16px Arial}.elementor-element{position:relative;box-sizing:border-box}.e-con{display:flex;flex-direction:column;gap:0}.elementor-widget-html{width:100%}.e-n-carousel{display:flex;overflow:hidden}.swiper-wrapper{display:flex;align-items:stretch;width:100%}.swiper-slide{flex:0 0 calc(100% / 6)}.elementor-swiper-button,.swiper-pagination-fraction{position:absolute;text-align:center;transform:none;margin:0}button{padding:0;border:0}[data-id="${id(actualCarousel.key + '-carousel')}"]{--e-n-carousel-swiper-slides-to-display:2}`;
    return `<!doctype html><style>${base}${nativeCSS(root)}${nativeCSS(actualCarousel)}</style><section class="elementor-element e-con" data-id="${id(region)}"><div class="elementor-element e-con" data-id="${id(actualHeading.key)}"><div class="elementor-element elementor-widget-html">${render(responsive(actualHeading))}</div></div><div class="elementor-element e-con" data-id="${id(actualCarousel.key)}"><div class="elementor-element elementor-widget-n-carousel" data-id="${id(actualCarousel.key + '-carousel')}"><div class="e-n-carousel swiper"><div class="swiper-wrapper">${actualCarousel.slides.map((slide: any) => `<div class="elementor-element e-con swiper-slide"><div class="elementor-element elementor-widget-html">${render(responsive(slide))}</div></div>`).join('')}</div></div><button class="elementor-swiper-button elementor-swiper-button-prev">Previous</button><button class="elementor-swiper-button elementor-swiper-button-next">Next</button><div class="swiper-pagination-fraction">1 / 6</div></div></div></section>`;
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 768, height: 1000 } });
    await page.route('https://fixture.invalid/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="gold"/></svg>' }));
    const widget = page.locator(`[data-id="${id(actualCarousel.key + '-carousel')}"]`), ids = { carouselOwner: id(actualCarousel.key), section: id(region) };
    await page.setContent(fixture(true));
    const broken = await marketingBoundaryGeometry(widget, ids, 6, 1);
    assert.equal(broken.passed, false);
    assert.ok(broken.checks.some((check: any) => check.kind === 'marketing-tablet-card-styles-at768' && !check.passed));
    assert.ok(broken.checks.some((check: any) => check.kind === 'actual-tablet-heading-style-at768' && !check.passed));
    assert.equal(await widget.evaluate(element => getComputedStyle(element).getPropertyValue('--e-n-carousel-swiper-slides-to-display')), '2');
    await page.setContent(fixture(false));
    const aligned = await marketingBoundaryGeometry(widget, ids, 6, 1);
    assert.deepEqual(aligned.checks.filter((check: any) => !check.passed), [], JSON.stringify(aligned));
    assert.equal(aligned.passed, true);
    assert.equal(await widget.evaluate(element => getComputedStyle(element).getPropertyValue('--e-n-carousel-swiper-slides-to-display')), '6');
  } finally { await browser.close(); }
});
