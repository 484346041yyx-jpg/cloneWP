import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

test('read-only block collector retains hidden original carousel products and public styles while excluding clones and private field values', async () => {
  const expression = await readFile(path.resolve(import.meta.dirname, '../src/reference/collect-blocks.browser.js'), 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.setContent(`<!doctype html><html lang="en"><head><title>Read-only source fixture</title><style>
      .slick-list {width:240px;overflow:hidden}.slick-track {width:1000px;display:flex}.slick-slide{width:120px;min-width:120px;height:160px;color:rgb(0,86,184)}
      .third {transform:translateX(600px)} .pd-carousel {background:#fff;padding:10px} .secret {display:none}
      </style></head><body><header><nav><a href="https://8.8.8.8/pets">Pets</a></nav><aside style="position:absolute;left:-50000px;width:200px">Hidden mega menu text</aside><input value="PRIVATE_EMAIL@invalid" placeholder="Search pets"></header>
      <main id="maincontent"><div id="homepage"><div><section class="pd-carousel" data-disable-autoplay="true" data-autoplay-speed="5000">
        <h2>Original products</h2><div class="slick-slider"><div class="slick-list"><div class="slick-track">
          <div class="slick-slide"><a href="https://8.8.8.8/a"><strong>Original Food</strong></a><span>$16.99</span><img src="https://8.8.8.8/a.png" alt="Original Food"></div>
          <div class="slick-slide third" aria-hidden="true"><a href="https://8.8.8.8/b">Offscreen Treats</a><span>$4.99</span><img data-src="https://8.8.8.8/b.png" alt="Offscreen Treats"></div>
          <div class="slick-slide slick-cloned"><span>CLONE_TEXT_EXCLUDED</span><img src="https://8.8.8.8/clone.png"></div>
        </div></div><button class="slick-next" aria-label="Next slide">Next</button></div>
      </section><section><h2>Help with pet care</h2><p>Keep the original public copy.</p><script>window.secret='PRIVATE_SCRIPT_VALUE';</script></section></div></div></main>
      <footer><p>Original footer copy.</p><textarea>PRIVATE_TYPED_CONTENT</textarea></footer></body></html>`);
    await page.evaluate(() => {
      (window as unknown as { sourceMutationCount: number }).sourceMutationCount = 0;
      new MutationObserver(records => { (window as unknown as { sourceMutationCount: number }).sourceMutationCount += records.length; }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    const result = await page.evaluate(`(${expression})()`) as {
      boundaryMethod: string; blocks: Array<{ role: string; text: string; headerInputs: Array<{ attributes: Record<string,string> }>; textAtoms: Array<{text:string}>; carousels: Array<{ declared: { disableAutoplay: string }; slides: Array<{ text: string; visible: boolean; intersectsTrack: boolean; images: Array<{ dataSrc: string }> }>; visibleCount: number }> }>; observedNodes: unknown[];
    };
    assert.equal(result.boundaryMethod, 'generic-preserved-major-children');
    const recorded = JSON.stringify(result); assert.match(recorded, /Original Food/); assert.match(recorded, /Offscreen Treats/); assert.match(recorded, /\$16\.99/);
    assert.doesNotMatch(recorded, /CLONE_TEXT_EXCLUDED|clone\.png|PRIVATE_EMAIL|PRIVATE_TYPED_CONTENT|PRIVATE_SCRIPT_VALUE/);
    const carousel = result.blocks.flatMap(block => block.carousels)[0]; assert.equal(carousel.slides.length, 2); assert.equal(carousel.declared.disableAutoplay, 'true'); assert.equal(carousel.visibleCount, 1);
    assert.ok(carousel.slides[1].text.includes('Offscreen Treats')); assert.equal(carousel.slides[1].intersectsTrack, false); assert.equal(carousel.slides[1].images[0].dataSrc, 'https://8.8.8.8/b.png');
    assert.ok(result.observedNodes.length > 5); assert.ok(result.observedNodes.length <= 2600);
    const header = result.blocks.find(block => block.role === 'header')!;
    assert.doesNotMatch(header.text, /Hidden mega menu text/); assert.ok(header.headerInputs.some(input => input.attributes.placeholder === 'Search pets')); assert.doesNotMatch(JSON.stringify(header.headerInputs), /PRIVATE_EMAIL|value/);
    const lightweight = await page.evaluate(`(${expression})({includeNodes:false})`) as typeof result & { typography: unknown[]; colors: unknown[] };
    assert.equal(lightweight.observedNodes.length, 0); assert.deepEqual(lightweight.blocks.map(block => block.text), result.blocks.map(block => block.text)); assert.ok(lightweight.typography.length); assert.ok(lightweight.colors.length);
    assert.equal(await page.evaluate(() => (window as unknown as { sourceMutationCount: number }).sourceMutationCount), 0);
  } finally { await browser.close(); }
});
