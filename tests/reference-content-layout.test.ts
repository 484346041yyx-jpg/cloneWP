import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

interface Frame { selector: string; sourceNodeId: string; tag: string; relationship: string; rect: { x: number; width: number }; contentRect?: { x: number; width: number }; contentRectStatus: string; maxWidth: string; boxSizing: string; padding: { left: number; right: number }; computedMargins: { left: string; right: string }; declaredMargins: { inline: Record<string,string>; matchedRules: Array<{ declarations: Record<string,string>; conditions: string[] }> }; responsibilities: string[]; ownsVisibleContent?: boolean }
interface Capture { boundaryObservation: { transparentWrappers: Array<{ selector: string; proof: string[] }>; retainedWrapper: { selector: string; style: Record<string,string> } }; blocks: Array<{ role: string; selectors: string[]; candidateReason?: string; contentLayout: { status: string; preferredFrameSelectors: string[]; viewport: { width: number; clientWidth: number }; paintedRoots: Frame[]; ancestors: Frame[]; contentFrames: Frame[]; layoutFrames: Frame[]; gaps: string[] } }> }
const expression = await readFile(new URL('../src/reference/collect-blocks.browser.js', import.meta.url), 'utf8');
const html = `<!doctype html><html><head><style>
  *{box-sizing:border-box}body{margin:0} main{max-width:1440px;margin:0 auto}
  .inside{max-width:1280px;padding:0 24px;margin-left:auto;margin-right:auto}footer{background:#edf4fa;padding:32px 0}
  .row{display:flex;gap:20px}.card{max-width:200px}.card img{width:40px;height:40px}
  @media(max-width:767px){.inside{padding:0 16px}} @media(min-width:2500px){.inside{margin-left:13px}}
  </style></head><body><main><section><div class="inside"><h2>Our services</h2><div class="row"><div class="card"><p>Public dog care</p><img alt="Dog care"></div><div class="card"><p>Public cat care</p><img alt="Cat care"></div></div></div></section></main>
  <footer><div class="inside"><h2>Public footer</h2><p>Original footer text</p></div></footer></body></html>`;

test('source collector retains full-bleed paint and centered content frames as separate owned facts', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }); await page.setContent(html);
    await page.evaluate(() => { (window as unknown as { mutations: number }).mutations = 0; new MutationObserver(records => { (window as unknown as { mutations: number }).mutations += records.length; }).observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true }); });
    const result = await page.evaluate(`(${expression})({includeNodes:false})`) as Capture;
    const services = result.blocks.find(block => block.role === 'unknown')!, footer = result.blocks.find(block => block.role === 'footer')!;
    assert.equal(services.contentLayout.status, 'observed'); assert.equal(footer.contentLayout.status, 'observed');
    assert.equal(footer.contentLayout.paintedRoots[0].rect.width, 1920); assert.equal(footer.contentLayout.paintedRoots[0].rect.x, 0);
    const content = footer.contentLayout.contentFrames.find(frame => footer.contentLayout.preferredFrameSelectors.includes(frame.selector))!;
    assert.equal(content.rect.width, 1280); assert.equal(content.rect.x, 320); assert.equal(content.contentRect!.x, 344); assert.equal(content.contentRect!.width, 1232);
    assert.equal(content.maxWidth, '1280px'); assert.equal(content.boxSizing, 'border-box'); assert.equal(content.sourceNodeId, content.selector);
    assert.ok(content.declaredMargins.matchedRules.some(rule => rule.declarations['margin-left'] === 'auto'));
    assert.ok(content.declaredMargins.matchedRules.every(rule => !rule.conditions.includes('(min-width: 2500px)')));
    assert.ok(services.contentLayout.ancestors.some(frame => frame.maxWidth === '1440px' && frame.rect.x === 240));
    assert.equal(await page.evaluate(() => (window as unknown as { mutations: number }).mutations), 0);
  } finally { await browser.close(); }
});

test('preferred source frame owns all visible content rather than a narrower decorative card', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.setContent(html);
    const result = await page.evaluate(`(${expression})({includeNodes:false})`) as Capture;
    const services = result.blocks.find(block => block.role === 'unknown')!;
    const preferred = services.contentLayout.contentFrames.find(frame => services.contentLayout.preferredFrameSelectors.includes(frame.selector))!;
    assert.equal(preferred.maxWidth, '1280px'); assert.equal(preferred.ownsVisibleContent, true);
    assert.ok(services.contentLayout.contentFrames.some(frame => frame.maxWidth === '200px' && frame.ownsVisibleContent === false));
    assert.ok(preferred.responsibilities.includes('horizontal-padding'));
  } finally { await browser.close(); }
});

test('source content bounds and declared active margins are captured independently at mobile width', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.setContent(html);
    const result = await page.evaluate(`(${expression})({includeNodes:false})`) as Capture;
    const footer = result.blocks.find(block => block.role === 'footer')!, frame = footer.contentLayout.contentFrames.find(item => footer.contentLayout.preferredFrameSelectors.includes(item.selector))!;
    assert.equal(footer.contentLayout.viewport.width, 390); assert.equal(frame.rect.width, 390); assert.equal(frame.rect.x, 0);
    assert.equal(frame.contentRect!.width, 358); assert.equal(frame.contentRect!.x, 16); assert.equal(frame.padding.left, 16); assert.equal(frame.padding.right, 16);
  } finally { await browser.close(); }
});

test('a source with no measured horizontal responsibility reports a gap instead of invented content padding', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }); await page.setContent('<!doctype html><style>body{margin:0}h2{margin:0}</style><main><section><h2>Plain public copy</h2></section></main>');
    const result = await page.evaluate(`(${expression})({includeNodes:false})`) as Capture, block = result.blocks[0];
    assert.equal(block.contentLayout.status, 'unobserved'); assert.deepEqual(block.contentLayout.preferredFrameSelectors, []);
    assert.ok(block.contentLayout.gaps.some(gap => /No unique horizontal layout owner/.test(gap)));
    assert.equal(block.contentLayout.paintedRoots[0].rect.width, 1920);
  } finally { await browser.close(); }
});

test('measured source body margins and inline auto margins are retained without hardcoded source identifiers', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } }); await page.setContent('<!doctype html><style>body{margin:8px}</style><main><section style="max-width:720px;margin:0 auto;padding:0 12px"><h2>Generic content frame</h2></section></main>');
    const result = await page.evaluate(`(${expression})({includeNodes:false})`) as Capture, block = result.blocks[0], frame = block.contentLayout.contentFrames.find(item => block.contentLayout.preferredFrameSelectors.includes(item.selector))!;
    assert.equal(frame.maxWidth, '720px'); assert.equal(frame.declaredMargins.inline['margin'], '0px auto'); assert.equal(frame.ownsVisibleContent, true);
    assert.ok(block.contentLayout.ancestors.some(item => item.tag === 'body' && item.computedMargins.left === '8px' && item.rect.x === 8));
  } finally { await browser.close(); }
});

test('generic candidate traversal proves transparent wrappers and preserves semantic sections and empty layout spacers', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent('<!doctype html><style>body{margin:0}main{max-width:1000px;margin:auto}h2{margin:0}</style><main><div><div><section><h2>Unrelated store services</h2></section><div style="height:42px"></div><section><h2>Unrelated store shipping</h2></section></div></div></main>');
    const result = await page.evaluate(`(${expression})({includeNodes:false})`) as Capture;
    assert.equal(result.boundaryObservation.transparentWrappers.length, 2);
    assert.ok(result.boundaryObservation.transparentWrappers.every(item => item.proof.includes('measured horizontal box equals parent content box')));
    assert.equal(result.blocks.length, 3);
    assert.equal(result.blocks[1].candidateReason, 'visible-layout-box-without-text');
    assert.ok(result.blocks[0].selectors[0].endsWith('section:nth-of-type(1)'));
    assert.ok(result.blocks[2].selectors[0].endsWith('section:nth-of-type(2)'));
    assert.ok(result.blocks[0].contentLayout.ancestors.some(frame => frame.maxWidth === '1000px' && frame.rect.x === 100));
  } finally { await browser.close(); }
});

test('significant grid, padding and max-width ancestors remain intact instead of becoming transparent wrappers', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent('<!doctype html><style>body{margin:0}.content{display:grid;gap:28px;padding:20px;max-width:1000px;margin:auto}</style><main><div class="content"><section><h2>Generic catalog</h2></section><section><h2>Generic contact</h2></section></div></main>');
    const result = await page.evaluate(`(${expression})({includeNodes:false})`) as Capture;
    assert.deepEqual(result.boundaryObservation.transparentWrappers, []); assert.equal(result.blocks.length, 1);
    const owner = result.blocks[0].contentLayout.contentFrames.find(frame => result.blocks[0].contentLayout.preferredFrameSelectors.includes(frame.selector))!;
    assert.equal(owner.maxWidth, '1000px'); assert.equal(owner.padding.left, 20); assert.ok(owner.responsibilities.includes('layout-children'));
    assert.equal(result.boundaryObservation.retainedWrapper.selector, 'html > body > main');
  } finally { await browser.close(); }
});

test('transformed source frames keep actual border measurements and disclose an unmeasured inner padding box', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent('<!doctype html><style>body{margin:0}main{max-width:1000px;margin:auto;transform:scale(.5);transform-origin:top left}section{padding:0 20px}</style><main><section><h2>Scaled content</h2></section></main>');
    const result = await page.evaluate(`(${expression})({includeNodes:false})`) as Capture;
    const owner = result.blocks[0].contentLayout.contentFrames.find(frame => result.blocks[0].contentLayout.preferredFrameSelectors.includes(frame.selector))!;
    assert.equal(owner.rect.width, 500); assert.equal(owner.contentRect, undefined); assert.equal(owner.contentRectStatus, 'unverified-transform');
    assert.ok(result.blocks[0].contentLayout.gaps.some(gap => /scale, rotation, perspective or CSS zoom/.test(gap)));
  } finally { await browser.close(); }
});
