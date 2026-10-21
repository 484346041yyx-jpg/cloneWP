import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const probe = () => import(pathToFileURL('D:/cloneWP/tools/probe-pet-v2-breakpoints.ts').href);
const logo = '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="200"><rect width="768" height="200" fill="white"/><circle cx="80" cy="100" r="60" fill="gold"/></svg>';
function fixture(width: number, oldFixedRow = false, extra = '') {
  // The actual current mobile logo asset is768x200. Retain its natural height
  // and the real horizontal bleed; the former fixed105.422 row cannot fit it
  // at767/768. CTA right cropping remains deliberately allowed.
  return `<style>html,body{margin:0;font-family:Arial,sans-serif}.host{width:${width - 15}px}.promo-outer{position:relative;overflow:hidden}.thin{display:grid;grid-template-columns:50% 1fr auto;align-items:center;min-height:77px;gap:4px}.logos img{display:block;width:100%;height:77px}.copy{text-align:center}.copy strong{display:block;font-size:20px;line-height:22px}.terms{display:block;font-size:16px;line-height:19px;margin-top:4px}.mobile-cta{position:absolute;right:-12px;bottom:10px;width:120px;height:48px;background:gold}@media(min-width:1025px){.logos img{height:89px}}@media(max-width:768px){.thin{width:calc(100% + 40px);margin-left:-20px;grid-template-columns:65% 35%;grid-template-rows:${oldFixedRow ? '105.422px 73px' : 'minmax(102.422px,auto) minmax(73px,auto)'};row-gap:${oldFixedRow ? '0' : '3px'};${oldFixedRow ? 'height:178.422px;' : ''}}.logos{grid-column:1/-1;padding:0 16px;align-self:start}.logos img{height:auto}.copy{grid-column:1;align-self:start;padding:0 8px 0 28px;box-sizing:border-box}.copy strong{font-size:19px;line-height:22px}}${extra}</style><main class="host"><div id="promo"><div class="promo-outer"><div class="thin"><a class="logos"><img src="https://fixture.invalid/logos.svg"></a><div class="copy"><strong data-cwp-text="heading">Spooky Good Savings up to $10 Off</strong><a class="terms" data-cwp-text="terms">*Restrictions apply.</a></div><a class="mobile-cta">Shop Now</a></div></div></div></main>`;
}

test('breakpoint promo measurement rejects natural-logo overlap and glyph clipping while allowing the observed CTA crop', async () => {
  const { promoFrameGeometry, visibleFrameReadiness } = await probe(), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.route('https://fixture.invalid/logos.svg', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: logo }));
    for (const width of [320, 390, 767, 768, 769, 1023, 1024, 1025]) {
      await page.setViewportSize({ width, height: 1000 }); await page.setContent(fixture(width));
      const ready = await visibleFrameReadiness(page); assert.equal(ready.passed, true); assert.equal(ready.images.length, 1);
      const actual = await promoFrameGeometry(page.locator('#promo')); assert.equal(actual.passed, true, JSON.stringify({ width, actual }));
      assert.equal(actual.ctaContainmentRequired, false); assert.ok(actual.cta.some((box: any) => box.right > actual.outer.right), 'The intentional CTA crop cannot be treated as a geometry failure');
      if (width === 767 || width === 768) {
        await page.setContent(fixture(width, true)); await visibleFrameReadiness(page);
        const old = await promoFrameGeometry(page.locator('#promo')); assert.equal(old.passed, false);
        assert.ok(old.checks.some((check: any) => check.kind === 'promo-image-separate-from-heading' && !check.passed), JSON.stringify(old));
      }
    }
    await page.setViewportSize({ width: 768, height: 1000 });
    await page.setContent(fixture(768, false, '.copy{height:12px;overflow:hidden}')); await visibleFrameReadiness(page);
    const clipped = await promoFrameGeometry(page.locator('#promo')); assert.equal(clipped.passed, false); assert.ok(clipped.checks.some((check: any) => check.kind === 'promo-heading-glyphs-inside-visible-clip' && !check.passed));
    await page.setContent(fixture(768, false, '.terms{position:relative;top:-20px}')); await visibleFrameReadiness(page);
    const overlap = await promoFrameGeometry(page.locator('#promo')); assert.equal(overlap.passed, false); assert.ok(overlap.checks.some((check: any) => check.kind === 'promo-heading-and-terms-separate' && !check.passed));
  } finally { await browser.close(); }
});

test('capture readiness decodes visible images and rejects broken paint without waiting on offscreen lazy images', async () => {
  const { visibleFrameReadiness } = await probe(), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 768, height: 1000 } });
    await page.route('https://fixture.invalid/**', route => route.request().url().endsWith('/valid.svg') ? route.fulfill({ status: 200, contentType: 'image/svg+xml', body: logo }) : route.fulfill({ status: 404, contentType: 'text/plain', body: 'Missing fixture image' }));
    await page.setContent('<img src="https://fixture.invalid/valid.svg" width="384" height="100"><img src="https://fixture.invalid/offscreen.svg" loading="lazy" style="position:absolute;top:3000px;width:100px;height:100px">');
    const ready = await visibleFrameReadiness(page); assert.equal(ready.fontsReady, true); assert.equal(ready.passed, true); assert.equal(ready.images.length, 1); assert.equal(ready.images[0].naturalWidth, 768);
    await page.setContent('<img src="https://fixture.invalid/broken.svg" width="384" height="100">');
    const broken = await visibleFrameReadiness(page); assert.equal(broken.passed, false); assert.equal(broken.images.length, 1); assert.equal(broken.images[0].decoded, false);
  } finally { await browser.close(); }
});

test('promo clip proof follows actual overflow ancestors rather than treating an overflow-visible frame as a crop', async () => {
  const { promoFrameGeometry, visibleFrameReadiness } = await probe(), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1025, height: 1000 } });
    await page.route('https://fixture.invalid/logos.svg', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: logo }));
    const paintedOutside = '#promo{margin-top:100px;overflow:visible}.promo-outer,.thin{overflow:visible}.copy{position:relative;top:-24px}';
    await page.setContent(fixture(1025, false, paintedOutside)); await visibleFrameReadiness(page);
    const visible = await promoFrameGeometry(page.locator('#promo'));
    assert.equal(visible.passed, true, JSON.stringify(visible));
    const heading = visible.texts.find((item: any) => item.role === 'heading');
    assert.ok(heading.glyphs.some((box: any) => box.top < visible.outer.top), 'The positive case must actually paint a Range above the outer box');
    assert.equal(heading.visibleClip.top, 0, 'Only the viewport clips this visible-overflow positive case');
    assert.equal(visible.clipAncestors.length, 0);
    for (const hiddenOwner of ['.promo-outer', '#promo']) {
      await page.setContent(fixture(1025, false, paintedOutside + hiddenOwner + '{overflow:hidden}')); await visibleFrameReadiness(page);
      const clipped = await promoFrameGeometry(page.locator('#promo'));
      assert.equal(clipped.passed, false, JSON.stringify({ hiddenOwner, clipped }));
      assert.ok(clipped.checks.some((check: any) => check.kind === 'promo-heading-glyphs-inside-visible-clip' && !check.passed));
      const clippedHeading = clipped.texts.find((item: any) => item.role === 'heading');
      assert.ok(clippedHeading.clipAncestors.some((item: any) => item.overflowY === 'hidden' && item.clipsY === true), 'The failure must retain the real clipping owner as evidence');
    }
  } finally { await browser.close(); }
});
