import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { parseFragment } from 'parse5';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { renderStaticHTML } from '../src/replica-v2/html.js';
import type { HtmlStaticComponentV2, ImportedAssetV2 } from '../src/replica-v2/types.js';

async function builder() { return (await import(pathToFileURL('D:/cloneWP/tools/pet-v2-marketing.mjs').href)).buildMarketing; }
function packet(region: string) {
  const p: any = { nodes: {}, texts: {}, styles: {}, layouts: {}, resources: {}, usages: {}, interactions: {}, regions: [{ id: region, nodeId: 'root', gapBefore: 32 }] };
  const add = (id: string, tag: string, parentId: string | null, attributes: Record<string, string> = {}, text?: string, visible = true) => {
    p.nodes[id] = { id, tag, parentId, attributes, visible, childIds: [] }; if (parentId) p.nodes[parentId].childIds.push(id);
    if (text) p.texts[id] = { id, nodeId: id, regionId: region, text };
  };
  add('root', 'section', null);
  return { p, add };
}
const fakeHtml = (key: string, regionId: string, template: string, css: string, slots: unknown, settings: unknown) => ({ key, regionId, template, css, slots, settings, kind: 'html-static' });

test('BOGO direct anchor text retains its heading ancestry and real source href', async () => {
  const { p, add } = packet('bogo'); add('heading', 'h2', 'root'); add('heading-link', 'a', 'heading', { href: 'https://source.example/bogo/' }, 'Save with BOGO Deals!');
  for (let index = 0; index < 6; index++) {
    add(`a-${index}`, 'a', 'root', { href: `https://source.example/deal/${index}` }); add(`img-${index}`, 'img', `a-${index}`, { alt: `Tile ${index}` });
    p.resources[`res-${index}`] = { id: `res-${index}`, url: `https://source.example/image-${index}.png`, kind: 'image' };
    p.usages[`use-${index}`] = { id: `use-${index}`, nodeId: `img-${index}`, resourceId: `res-${index}`, visible: true, kind: 'picture' };
  }
  const result = await (await builder())({ packets: { bogo: p }, html: fakeHtml, asset: async (url: string) => url, baseSettings: {} });
  const block = result.blocks[0], binding = result.bindings.find((entry: any) => entry.componentKey === 'bogo');
  assert.ok(Object.values(block.slots.text).includes('Save with BOGO Deals!'));
  assert.ok(Object.values(block.slots.links).some((value: any) => value.url === 'https://source.example/bogo/'));
  assert.ok(Object.values(binding.slotNodes.text).some((ids: any) => ids.includes('heading-link')));
  const fragment: any = parseFragment(block.template);
  const walk = (node: any): any[] => [node, ...(node.childNodes || []).flatMap(walk)];
  assert.ok(walk(fragment).some(node => node.tagName === 'h2' && node.attrs.some((attr: any) => attr.name === 'data-cwp-text')));
  assert.equal(Object.keys(block.slots.media).length, 6);
});

test('desktop footer binds visible Services heading and link while leaving mobile-only button separate', async () => {
  const { p, add } = packet('footer'); add('column', 'div', 'root', { class: 'content-asset' }); add('column-heading', 'div', 'column');
  add('mobile-heading', 'button', 'column-heading', { class: 'd-sm-none' }, 'Services', false);
  add('desktop-heading', 'h2', 'column-heading', { class: 'd-none d-sm-block' }, 'Services');
  add('nav', 'ul', 'column'); add('nav-link', 'a', 'nav', { href: 'https://source.example/services/' }, 'Services');
  const result = await (await builder())({ packets: { footer: p }, html: fakeHtml, asset: async (url: string) => url, baseSettings: {} });
  const binding = result.bindings.find((entry: any) => entry.componentKey === 'footer'), ids = Object.values(binding.slotNodes.text).flat();
  assert.ok(ids.includes('desktop-heading')); assert.ok(ids.includes('nav-link')); assert.ok(!ids.includes('mobile-heading'));
  assert.equal(Object.values(result.blocks[0].slots.text).filter(value => value === 'Services').length, 2);
});

test('actual browser paint preserves a short BOGO edge banner in a tall frame and scoped hero copy/CTA under theme CSS', async () => {
  const { p, add } = packet('bogo'); add('heading', 'h2', 'root'); add('heading-link', 'a', 'heading', { href: 'https://source.example/bogo/' }, 'Save with BOGO Deals!');
  const background = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="120"><rect width="32" height="120" fill="#ff0066"/><rect x="1408" width="32" height="120" fill="#00ccff"/></svg>')).png().toBuffer();
  const strip = await sharp({ create: { width: 180, height: 72, channels: 4, background: '#ffffff' } }).png().toBuffer(), deal = await sharp({ create: { width: 288, height: 240, channels: 4, background: '#ffffff' } }).png().toBuffer();
  const assets: ImportedAssetV2[] = [], bytes = new Map<string, Buffer>();
  const register = (key: string, body: Buffer, width: number, height: number) => { const sourceUrl = `https://source.example/${key}.png`, url = `https://target.example/uploads/${key}.png`; assets.push({ key, attachmentId: assets.length + 1, sourceUrl, url, width, height, mimeType: 'image/png', sha256: createHash('sha256').update(body).digest('hex') }); bytes.set(url, body); return sourceUrl; };
  p.resources.background = { id: 'background', url: register('edge-background', background, 1440, 120), kind: 'background' }; p.usages.background = { id: 'background', nodeId: 'root', resourceId: 'background', kind: 'background', visible: true };
  for (let index = 0; index < 6; index++) {
    add(`a-${index}`, 'a', 'root', { href: `https://source.example/deal/${index}` }); add(`img-${index}`, 'img', `a-${index}`);
    const isStrip = index % 3 === 0, key = `card-${index}`;
    p.resources[key] = { id: key, url: register(key, isStrip ? strip : deal, isStrip ? 180 : 288, isStrip ? 72 : 240), kind: 'image' };
    p.usages[key] = { id: key, nodeId: `img-${index}`, resourceId: key, visible: true, kind: 'img' };
  }
  const result = await (await builder())({ packets: { bogo: p }, html: fakeHtml, asset: async (url: string) => assets.find(asset => asset.sourceUrl === url)!.key, baseSettings: {} });
  const bogo = renderStaticHTML(result.blocks[0], 'paint-regression', 'abcdef1', assets, 'desktop');
  const hero: HtmlStaticComponentV2 = { key: 'typed-hero', kind: 'html-static', template: '<section class="copy"><h2><span data-cwp-text="heading"></span></h2><a class="cta" data-cwp-link="shop" data-cwp-text="cta"></a></section>', css: ':scope{font-family:Arial,Helvetica,sans-serif}.copy{color:#fff;background:#207c99;padding:20px}h2{font-family:inherit;color:inherit;font-size:40px;line-height:42px;font-weight:700}.cta{display:inline-flex;box-sizing:border-box;min-height:48px;padding:12px 26px;background:#ffc000;color:#3d3935;border-radius:8px;font-weight:600;line-height:22px;text-decoration:none}', slots: { text: { heading: 'Scare away Fleas & Ticks', cta: 'Shop Now' }, media: {}, links: { shop: { url: 'https://source.example/deal/' } } } };
  const heroProof = renderStaticHTML(hero, 'paint-regression', 'abcdef2', [], 'desktop'), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.route('https://target.example/**', async route => { const body = bytes.get(route.request().url()); assert.ok(body, 'Renderer requested a registered current-task asset'); await route.fulfill({ contentType: 'image/png', body }); });
    // Simulate an ordinary host theme declaring leaf rules after the HTML widget.
    await page.setContent(`<!doctype html><html><head><style>body{margin:0}img{max-width:100%}</style></head><body>${bogo.html}${heroProof.html}<style>h2{font-family:Georgia,serif;color:#123456;font-size:12px}a{background:#777;color:#f00;padding:0;border-radius:0}</style></body></html>`);
    await page.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); });
    const frame = page.locator('#cwp-abcdef1 .bogo-frame'), box = await frame.boundingBox(); assert.ok(box); assert.equal(box.width, 1440); assert.equal(box.height, 424);
    const pixel = async (png: Buffer, x: number, y: number) => [...await sharp(png).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
    const painted = await frame.screenshot(); assert.deepEqual(await pixel(painted, 8, 8), [255, 0, 102]); assert.deepEqual(await pixel(painted, 1432, 8), [0, 204, 255]); assert.deepEqual(await pixel(painted, 8, 150), [250, 218, 193], 'The 120px artwork must not repeat down the 424px frame');
    // Negative control demonstrates this fixture catches the actual former bug:
    // cover scales 120px artwork to 424px, cropping both edge markers away.
    await frame.evaluate(element => { (element as HTMLElement).style.backgroundSize = 'cover'; }); const covered = await frame.screenshot();
    assert.notDeepEqual(await pixel(covered, 8, 8), [255, 0, 102]); assert.notDeepEqual(await pixel(covered, 1432, 8), [0, 204, 255]);
    const presentation = await page.locator('#cwp-abcdef2').evaluate(root => { const heading = getComputedStyle(root.querySelector('h2 span')!), cta = getComputedStyle(root.querySelector('.cta')!); return { font: heading.fontFamily, fontSize: heading.fontSize, color: heading.color, background: cta.backgroundColor, padding: cta.padding, radius: cta.borderRadius, height: root.querySelector('.cta')!.getBoundingClientRect().height }; });
    assert.match(presentation.font, /^Arial/); assert.equal(presentation.fontSize, '40px'); assert.equal(presentation.color, 'rgb(255, 255, 255)'); assert.equal(presentation.background, 'rgb(255, 192, 0)'); assert.equal(presentation.padding, '12px 26px'); assert.equal(presentation.radius, '8px'); assert.ok(presentation.height >= 48);
  } finally { await browser.close(); }
});
