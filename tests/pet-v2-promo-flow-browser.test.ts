import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { renderStaticHTML } from '../src/replica-v2/html.js';

test('authored Pet promo naturally contains the full responsive logo, title glyphs and footnote at all mobile widths', async () => {
  // Read the actual authored CSS literals without importing the task script:
  // importing it would regenerate the current real job and download media.
  const desktop = await readFile('D:/cloneWP/tools/author-pet-v2.mjs', 'utf8'), responsive = await readFile('D:/cloneWP/tools/author-pet-v2-responsive.mjs', 'utf8');
  const common = /const common='([^']+)';/.exec(desktop)?.[1], declaration = /const promo=html\('promo','promo','([^']+)','([^']+)',/.exec(desktop);
  assert.ok(common && declaration, 'the actual task promo declaration is required');
  const responsiveCss = [...responsive.matchAll(/addCss\(promo,'([^']*)'\);/g)].map(match => match[1]).join(''); assert.ok(responsiveCss);
  const block: any = { key: 'promo', kind: 'html-static', template: declaration[1].replace('<div class="frame thin">', '<div class="frame promo-outer"><div class="thin">') + '</div>', css: common + declaration[2], responsiveCss,
    slots: { text: { heading: 'Spooky Good Savings up to $10 Off', body: 'Save on select dog & cat food brands.', terms: '*Restrictions apply.', cta: 'Shop Now', 'mobile-cta': 'Shop Now' }, media: { logos: { assetKey: 'logos-desktop', alt: 'Observed brand strip', responsive: [{ assetKey: 'logos-tablet', media: '(min-width:769px) and (max-width:1024px)' }, { assetKey: 'logos-mobile', media: '(max-width:768px)' }] } }, links: { logos: { url: 'https://source.example/deals/' }, terms: { url: 'https://source.example/#' }, cta: { url: 'https://source.example/deals/' }, 'mobile-cta': { url: 'https://source.example/deals/#shopall' } } } };
  // Each responsive fixture fills the entire image boundary and has the exact
  // intrinsic dimensions of its actually observed PNG, rather than a convenient
  // substitute aspect ratio that could conceal logo/copy overlap.
  const images = new Map<string, string>(), assets = [['desktop', 720, 89], ['tablet', 512, 89], ['mobile', 768, 200]].map(([name, width, height], index) => { const url = `https://fixture.example/logos-${name}.svg`, body = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white"/></svg>`; images.set(url, body); return { key: 'logos-' + name, attachmentId: index + 1, url, sha256: createHash('sha256').update(body).digest('hex') }; });
  const output = renderStaticHTML(block, 'pet-supermarket-v2-20261015', '17eb85a', assets as any, 'responsive'), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.route('https://fixture.example/**', route => { const body = images.get(route.request().url()); return body ? route.fulfill({ contentType: 'image/svg+xml', body }) : route.abort(); });
    for (const width of [900, 320, 390, 767, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      // The frozen source/target packets both record a 15px desktop scrollbar;
      // the explicit fixture host reproduces that measured content width even
      // on platforms whose test browser uses overlay scrollbars.
      await page.setContent(`<style>html,body{margin:0}.fixture-host{width:${width - 15}px}</style><main class="fixture-host">${output.html}</main>`);
      await page.locator('.logos img').evaluate(async image => { await (image as HTMLImageElement).decode(); });
      const actual = await page.locator('#cwp-17eb85a').evaluate(root => {
        const heading = root.querySelector('[data-cwp-text="heading"]')!, terms = root.querySelector('[data-cwp-text="terms"]')!, cta = root.querySelector('[data-cwp-link="mobile-cta"]')!, outer = root.querySelector('.promo-outer')!, copy = root.querySelector('.copy')!, logos = root.querySelector('.logos')!, image = logos.querySelector('img')!, thin = root.querySelector('.thin')!;
        const ranges = []; for (const node of [heading, terms]) { const range = document.createRange(); range.selectNodeContents(node); ranges.push(Array.from(range.getClientRects()).filter(box => box.width > 0 && box.height > 0).map(box => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom }))); }
        const boxes = [cta, outer, logos, image, copy].map(node => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; });
        return { heading: ranges[0], terms: ranges[1], cta: boxes[0], outer: boxes[1], logos: boxes[2], image: boxes[3], copy: boxes[4], naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, rows: getComputedStyle(thin).gridTemplateRows, headingDisplay: getComputedStyle(heading).display, headingFontSize: getComputedStyle(heading).fontSize, headingLineHeight: getComputedStyle(heading).lineHeight, termsDisplay: getComputedStyle(terms).display, paddingLeft: getComputedStyle(copy).paddingLeft, paddingRight: getComputedStyle(copy).paddingRight, headingVisible: getComputedStyle(heading).visibility, termsVisible: getComputedStyle(terms).visibility };
      });
      assert.equal(actual.headingDisplay, 'block'); assert.equal(actual.termsDisplay, 'block'); assert.equal(actual.headingVisible, 'visible'); assert.equal(actual.termsVisible, 'visible'); assert.ok(actual.heading.length >= 1 && actual.heading.length <= 3); if (width === 390 || width === 900) assert.equal(actual.heading.length, 2, 'the two evidenced viewports retain both promotion heading lines'); assert.equal(actual.terms.length, 1);
      assert.ok(actual.terms[0].top >= Math.max(...actual.heading.map(line => line.bottom)) - 1, JSON.stringify(actual));
      assert.ok(actual.heading.every(line => line.left >= actual.outer.left && line.right <= actual.outer.right), JSON.stringify(actual)); assert.ok(actual.terms[0].bottom <= actual.outer.bottom, JSON.stringify(actual));
      if (width <= 768) {
        assert.equal(actual.naturalWidth, 768); assert.equal(actual.naturalHeight, 200); assert.ok(actual.image.height > 0); assert.ok(actual.image.top >= actual.outer.top && actual.image.bottom <= actual.outer.bottom, JSON.stringify(actual));
        assert.ok(actual.copy.top >= Math.max(actual.logos.bottom, actual.image.bottom), JSON.stringify(actual)); assert.ok(Math.min(...actual.heading.map(line => line.top)) >= actual.image.bottom, JSON.stringify(actual));
      }
      if (width === 390) { assert.equal(actual.paddingLeft, '28px'); assert.equal(actual.paddingRight, '8px'); assert.ok(Math.abs(actual.copy.top - 105.421875) < 0.02); assert.ok(Math.abs(actual.outer.height - 178.421875) < 0.02); assert.ok(actual.cta.right > actual.outer.right, 'the independently observed source CTA right crop remains intentional'); }
    }
  } finally { await browser.close(); }
});
