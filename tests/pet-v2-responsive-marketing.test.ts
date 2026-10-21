import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { renderStaticHTML, validateNativeCSSV2 } from '../src/replica-v2/html.js';

async function author() { return (await import(pathToFileURL('D:/cloneWP/tools/pet-v2-responsive-marketing.mjs').href)).applyPetResponsiveMarketing; }
function footerPacket(viewport: string, width: number) {
  const p: any = { snapshot: { id: `actual-${viewport}`, viewport: { name: viewport, width } }, regions: [{ id: 'footer', nodeId: 'root', contentNodeId: 'root' }], nodes: { root: { id: 'root', layoutId: 'layout', attributes: {} } }, layouts: { layout: { rect: { x: 0, y: 0, width, height: 900 } } }, texts: {} };
  for (let index = 0; index < 4; index++) p.nodes[`button-${index}`] = { id: `button-${index}`, tag: 'button', attributes: { class: 'ps-footer-headers' } };
  return { footer: p };
}
function authored() {
  const text: Record<string, string> = {}, links: Record<string, any> = {}, slots: any = { text: {}, media: {}, links: {} }; let template = '<footer><nav class="footer-nav">';
  for (let index = 0; index < 4; index++) { text[`heading-${index}`] = `Source column ${index}`; text[`link-${index}`] = `Source destination ${index}`; links[`link-${index}`] = { url: `https://source.example/actual/${index}` }; slots.text[`heading-${index}`] = [`heading-${index}`]; slots.text[`link-${index}`] = [`link-${index}`]; slots.links[`link-${index}`] = [`link-${index}`]; template += `<div class="footer-column"><h3 data-cwp-text="heading-${index}"></h3><div><a data-cwp-link="link-${index}" data-cwp-text="link-${index}"></a></div></div>`; }
  template += '</nav></footer>';
  return { taskId: 'responsive-fixture', blocks: [{ key: 'footer', kind: 'html-static', template, css: '.footer-nav{display:grid;grid-template-columns:repeat(4,1fr)}.footer-column>div{margin:0 0 9px}', slots: { text, media: {}, links } }], bindings: [{ componentKey: 'footer', regionIds: ['footer'], sourceNodeIds: ['root'], slotNodes: slots }], adaptations: [] };
}

test('responsive footer preserves one typed heading/link per source owner and actual native disclosure behavior', async () => {
  const original = authored(), before = JSON.stringify(original), result = (await author())({ authored: original, packetsByViewport: { tablet: footerPacket('tablet', 900), mobile: footerPacket('mobile', 390) } });
  assert.equal(JSON.stringify(original), before); assert.deepEqual(result.gaps, []); const footer = result.authored.blocks[0];
  assert.equal((footer.template.match(/<summary /g) || []).length, 4); assert.equal((footer.template.match(/<details /g) || []).length, 4); assert.deepEqual(footer.slots, original.blocks[0].slots);
  const id = createHash('sha256').update('clonewp-replica-v2:responsive-fixture:footer-content').digest('hex').slice(0, 7), proof = renderStaticHTML(footer, original.taskId, id, [], 'responsive');
  assert.ok(result.adaptations.every((entry: any) => entry.target.property === 'disclosure' && entry.target.expected.initialOpen === false && entry.sourceNodeIds.length === 1));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }); await page.setContent(proof.html);
    const details = page.locator(`#cwp-${id} details`).first(), summary = details.locator('summary'), link = details.locator('a');
    assert.equal(await details.getAttribute('open'), null); assert.equal(await link.isVisible(), true, 'Desktop CSS must retain all original links even when native details is initially closed');
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await link.isVisible(), false, 'The actual initial mobile state must be closed');
    await summary.click(); assert.equal(await link.isVisible(), true); assert.equal(await link.getAttribute('href'), 'https://source.example/actual/0'); assert.equal(await summary.textContent(), 'Source column 0');
    await summary.press('Enter'); assert.equal(await link.isVisible(), false); assert.equal(await details.getAttribute('open'), null);
  } finally { await browser.close(); }
});

test('marketing controls use the padded component through the actual separate native widget and heading containers', async () => {
  const taskId = 'native-wrapper-regression', regions = ['brands', 'dog-deals', 'cat-deals', 'other-deals'];
  const id = (key: string) => createHash('sha256').update(`clonewp-replica-v2:${taskId}:${key}`).digest('hex').slice(0, 7);
  const blocks = regions.map(key => ({ key, kind: 'composite', settings: {}, children: [
    { key: `${key}-heading`, kind: 'html-static', settings: {}, template: `<div class="marketing-heading"><h2 data-cwp-text="title"></h2>${key === 'brands' ? '' : '<a class="heading-shop-all" data-cwp-link="shop" data-cwp-text="shop"></a>'}</div>`, css: '.marketing-heading{position:relative}h2{margin:0}.heading-shop-all{position:absolute;right:210px;top:27px}', slots: { text: { title: key, ...(key === 'brands' ? {} : { shop: 'Shop All' }) }, media: {}, links: key === 'brands' ? {} : { shop: { url: 'https://source.example/deals' } } } },
    { key: `${key}-carousel`, kind: 'native-carousel', settings: {}, widgetSettings: {}, slides: [{ key: `${key}-item-1`, kind: 'html-static', template: '<article class="marketing-card"><div class="marketing-image"></div><div class="marketing-copy"><p data-cwp-text="copy"></p></div></article>', css: '.marketing-card{text-align:center}.marketing-copy p{margin:0}', slots: { text: { copy: 'A source promotion with several lines of actual owned copy' }, media: {}, links: {} } }] }
  ] }));
  const original: any = { taskId, blocks, bindings: regions.flatMap(key => [key, `${key}-heading`, `${key}-carousel`].map(componentKey => ({ componentKey, regionIds: [key], sourceNodeIds: [], slotNodes: { text: {}, media: {}, links: {} } }))), adaptations: [] };
  const authored = (await author())({ authored: original, packetsByViewport: {} }).authored;
  // This is the actual nesting measured in the owned Elementor diagnostic:
  // section e-con -> heading e-con -> HTML widget, and carousel e-con ->
  // separate positioned n-carousel widget -> swiper + sibling controls.
  // The earlier simplified fixture omitted those two positioned layers.
  const fixture = (omitWrapperFix: boolean) => {
    let css = 'html,body{margin:0;font:16px Arial}.elementor-element{position:relative;box-sizing:border-box}.e-con{display:flex;flex-direction:column;gap:0}.elementor-widget-html{width:100%}.e-n-carousel{display:flex;overflow:hidden}.swiper-wrapper{position:relative;display:flex;width:100%}.swiper-slide{flex:0 0 50%}.elementor-swiper-button,.swiper-pagination-fraction{position:absolute;transform:none;margin:0;text-align:center}button{border:0;padding:0}';
    const nativeCSS = (component: any) => {
      let value = component.settings?.custom_css || '';
      if (omitWrapperFix) value = value.replace(/selector>\[data-id="[a-f0-9]+"\]\{position:static\}/g, '');
      return validateNativeCSSV2(value, component.key).replaceAll('selector', `[data-id="${id(component.key)}"]`);
    };
    let body = '';
    for (const root of authored.blocks) {
      const [heading, carousel] = root.children;
      css += nativeCSS(root) + nativeCSS(carousel);
      const html = (component: any) => renderStaticHTML(component, taskId, id(`${component.key}-content`), [], 'responsive').html;
      body += `<section class="elementor-element e-con" data-id="${id(root.key)}" data-section="${root.key}"><div class="elementor-element e-con" data-id="${id(heading.key)}"><div class="elementor-element elementor-widget-html"><div class="elementor-widget-container">${html(heading)}</div></div></div><div class="elementor-element e-con" data-id="${id(carousel.key)}"><div class="elementor-element elementor-widget-n-carousel" data-id="${id(`${carousel.key}-carousel`)}"><div class="e-n-carousel swiper"><div class="swiper-wrapper"><div class="elementor-element e-con swiper-slide"><div class="elementor-element elementor-widget-html">${html(carousel.slides[0])}</div></div></div></div><button class="elementor-swiper-button elementor-swiper-button-prev">Previous</button><button class="elementor-swiper-button elementor-swiper-button-next">Next</button><div class="swiper-pagination-fraction">1 / 6</div></div></div></section>`;
    }
    return `<!doctype html><style>${css}</style>${body}`;
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const measure = async (): Promise<any[]> => page.evaluate(`Array.from(document.querySelectorAll('[data-section]')).map(root => {
      const rect = element => { if (!element) return null; const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, bottom: b.bottom, right: b.right }; };
      return { key: root.getAttribute('data-section'), root: rect(root), track: rect(root.querySelector('.swiper-wrapper')), heading: rect(root.querySelector('h2')), shop: rect(root.querySelector('.heading-shop-all')), controls: Array.from(root.querySelectorAll('.elementor-swiper-button,.swiper-pagination-fraction')).map(element => rect(element)) };
    })`);
    for (const width of [885, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.setContent(fixture(true));
      const broken = await measure();
      assert.ok(broken.every(row => row.controls.some((control: any) => control.y < row.track.bottom)), 'The actual omitted native widget layer must reproduce the observed control overlap');
      assert.ok(broken.filter(row => row.shop).every(row => row.shop!.y < row.track.y), 'The omitted heading container fix must reproduce Shop All attached to its title');
      await page.setContent(fixture(false));
      const fixed = await measure();
      for (const row of fixed) {
        assert.ok(row.controls.every((control: any) => control.y >= row.track.bottom - .01), `${width}/${row.key}: arrows/fraction must be below all card content`);
        assert.ok(row.controls.every((control: any) => control.bottom <= row.root.bottom + .01), `${width}/${row.key}: controls must remain in their own section`);
        if (row.shop) {
          assert.ok(row.shop.y >= row.track.bottom - .01, `${width}/${row.key}: Shop All must be below the complete card content`);
          for (const control of row.controls) assert.ok(row.shop.right <= control.x || control.right <= row.shop.x || row.shop.bottom <= control.y || control.bottom <= row.shop.y, `${width}/${row.key}: the one Shop All anchor must not overlap controls`);
        }
      }
    }
  } finally { await browser.close(); }
});
