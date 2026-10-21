import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const probe = () => import(pathToFileURL('D:/cloneWP/tools/probe-pet-v2-breakpoints.ts').href);
const copy = [
  ['10% Off Buy Online, Pick up In Store!', 'Shop Now!'],
  ['Buy 1 Get 1 50% Off Halloween.', 'Shop Now!'],
  ['Buy more save more,', 'shop top BOGOs!'],
  ['Our VIP Rewards program outshines the rest.', 'Join Today!'],
  ['Find EXCLUSIVE pet favorites, only available here!', 'Shop Now!'],
  ['Discover the NEWEST pet trends.', 'Shop Now!'],
];

function fixture(width: number, legacyFixedWidth = false, active = copy[4]) {
  // Preserve the real separate static header/native widget ownership, native
  // wrapper/track, offscreen slides, and sibling controls. At1025 the previous
  // 665px notice paints over right-hand navigation despite valid header bounds.
  const notice = (words: string[]) => `<div class="notice"><span>${words[0]}</span> <a>${words[1]}</a></div>`;
  return `<style>html,body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}#section{position:relative;width:${width}px;height:232px}#header .nav-row{position:absolute;top:76px;height:44px;width:100%;background:#eaf0fc;display:flex;align-items:stretch}summary{list-style:none}.shop{padding:10px 32px;display:flex;align-items:center;gap:10px}.shop-group{margin:0}.spacer{flex:1}.nav-row>a{display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;white-space:nowrap}.nav-track{width:154px}.nav-deals{width:100px}.nav-services{width:156px}.offers{position:absolute;top:76px;left:140px;right:410px;height:44px}.e-n-carousel{overflow:hidden;width:100%;height:44px}.swiper-wrapper{display:flex;transform:translateX(-100%);width:100%;height:44px}.swiper-slide{flex:0 0 100%;min-width:0}.notice{height:44px;display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;align-content:center;gap:0 4px;font-size:14px;line-height:18px;padding:0 84px 0 10px}.notice a{font-weight:bold}.elementor-swiper-button{position:absolute;top:12px;width:14px;height:20px;font-size:14px}.elementor-swiper-button-prev{right:60px}.elementor-swiper-button-next{right:0}.swiper-pagination-fraction{position:absolute;right:17px;top:0;width:38px;height:44px;display:flex;align-items:center;justify-content:center;gap:3px;font-size:12px}.unused{display:none}@media(max-width:1024px){#header .nav-row{top:179px}.nav-track,.nav-deals{display:none!important}.offers{top:134px;left:0;right:0}.notice{justify-content:center;padding:0 120px 0 90px}}@media(max-width:768px){#header .nav-row{top:12px}.nav-services{display:none!important}.shop .shop-label{display:none}.offers{top:122px;height:60px}.e-n-carousel,.swiper-wrapper,.notice{height:60px}.notice{padding:5px 120px 5px 42px;font-size:12px;line-height:17px}.elementor-swiper-button{top:20px}.swiper-pagination-fraction{height:60px}}${legacyFixedWidth ? '@media(min-width:1025px){.offers{left:calc(50% - 348px);right:auto;width:665px}.notice{white-space:nowrap;flex-wrap:nowrap}}' : ''}</style><section id="section"><div id="header"><header><nav class="nav-row"><details class="shop-group"><summary class="shop"><span>☰</span><span class="shop-label">Shop</span></summary></details><div class="spacer"></div><a class="nav-track"><span>Track My Order</span></a><a class="nav-deals"><span>Deals</span></a><a class="nav-services"><span>Book Services</span></a></nav></header></div><div class="elementor-element offers" data-id="native-offers"><div class="elementor-widget-container"><div class="e-n-carousel swiper"><div class="swiper-wrapper"><div class="swiper-slide swiper-slide-duplicate" data-swiper-slide-index="5">${notice(['Inactive copy must not collide', 'Shop Now!'])}</div><div class="swiper-slide swiper-slide-active" data-swiper-slide-index="0">${notice(active)}</div><div class="swiper-slide" data-swiper-slide-index="1">${notice(['Inactive copy must not collide', 'Shop Now!'])}</div></div></div><div class="elementor-swiper-button elementor-swiper-button-prev">‹</div><div class="elementor-swiper-button elementor-swiper-button-next">›</div><div class="swiper-pagination swiper-pagination-fraction"><span>1</span><span>/</span><span>6</span></div></div></div></section>`;
}

test('header offers proof checks real visible ranges at all six boundaries and rejects the fixed665px overlap', async () => {
  const { headerOffersGeometry } = await probe(), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const width of [767, 768, 769, 1023, 1024, 1025]) {
      await page.setViewportSize({ width, height: 1000 }); await page.setContent(fixture(width)); await page.evaluate(() => document.fonts.ready);
      const actual = await headerOffersGeometry(page.locator('[data-id="native-offers"]'), 'header');
      assert.equal(actual.passed, true, JSON.stringify({ width, actual })); assert.equal(actual.slides.length, 1);
      if (width <= 768) assert.ok(actual.navigation.filter((item: any) => item.selector !== '.shop').every((item: any) => item.glyphs.length === 0), 'Hidden mobile variants must not create fictitious collisions');
    }
    await page.setViewportSize({ width: 1025, height: 1000 });
    for (const words of copy) { await page.setContent(fixture(1025, false, words)); const actual = await headerOffersGeometry(page.locator('[data-id="native-offers"]'), 'header'); assert.equal(actual.passed, true, JSON.stringify({ words, actual })); }
    await page.setContent(fixture(1025, true));
    const broken = await headerOffersGeometry(page.locator('[data-id="native-offers"]'), 'header');
    assert.equal(broken.passed, false); assert.ok(broken.collisions.some((collision: any) => collision.kind === 'notice-text' && collision.navigation === '.nav-track'), JSON.stringify(broken));
    assert.ok(broken.collisions.some((collision: any) => collision.kind === 'native-control'), JSON.stringify(broken));
  } finally { await browser.close(); }
});

test('header offers proof rejects clipped copy, hidden controls and missing navigation owners', async () => {
  const { headerOffersGeometry } = await probe(), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1025, height: 1000 } });
    await page.setContent(fixture(1025) + '<style>.notice{height:12px;overflow:hidden}</style>');
    const clipped = await headerOffersGeometry(page.locator('[data-id="native-offers"]'), 'header'); assert.equal(clipped.passed, false); assert.ok(clipped.checks.some((check: any) => check.kind === 'header-offer-glyphs-inside-visible-clip' && !check.passed));
    await page.setContent(fixture(1025) + '<style>.elementor-swiper-button-next{visibility:hidden}</style>');
    const hidden = await headerOffersGeometry(page.locator('[data-id="native-offers"]'), 'header'); assert.equal(hidden.passed, false); assert.ok(hidden.checks.some((check: any) => check.kind === 'visible-owned-header-offer-controls' && !check.passed));
    await page.setContent(fixture(1025).replace('class="nav-deals"', 'class="wrong-owner"'));
    const missing = await headerOffersGeometry(page.locator('[data-id="native-offers"]'), 'header'); assert.equal(missing.passed, false); assert.ok(missing.checks.some((check: any) => check.kind === 'exact-header-navigation-owners' && !check.passed));
  } finally { await browser.close(); }
});
