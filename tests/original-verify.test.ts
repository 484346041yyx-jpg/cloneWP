import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { captureOriginalEditorStartupDiagnosis, verifyOriginal, verifyOriginalEditorSections } from '../src/original/verify.js';
import { captureTarget, createScopedContext } from '../src/verification/capture-target.js';
import type { OriginalDesign } from '../src/original/types.js';
import type { ElementorElement, LegacyComposition } from '../src/wordpress/types.js';

const design: OriginalDesign = {
  version: 1, brand: 'MoriPaws', title: 'Original native fixture', language: 'en', description: 'A deliberately small browser fixture.',
  tokens: { colors: { ink: '#222222' }, font: 'Arial', contentWidth: 1100 },
  assets: [{ key: 'dog', path: 'fixture.svg', alt: 'Dog illustration', provenance: 'Local browser fixture' }],
  sections: [
    { key: 'hero', kind: 'container', anchor: 'hero', children: [{ key: 'heading', kind: 'heading', text: 'Care for your companion.' }, { key: 'nav', kind: 'button', text: 'Read our FAQ', href: '#faq' }, { key: 'picture', kind: 'image', asset: 'dog' }] },
    { key: 'faq', kind: 'container', anchor: 'faq', children: [{ key: 'questions', kind: 'accordion', items: [{ title: 'What can I edit?', content: 'Every section uses native Elementor controls.' }] }] },
  ],
};
const elementMap = { hero: '1000001', heading: '1000002', nav: '1000003', picture: '1000004', faq: '1000005', questions: '1000006' };
const element = (id: string, widgetType?: string, settings: Record<string, unknown> = {}, elements: ElementorElement[] = []): ElementorElement => ({ id, elType: widgetType ? 'widget' : 'container', ...(widgetType ? { widgetType } : {}), settings, elements });
function composition(url: string): LegacyComposition {
  return { elements: [element(elementMap.hero, undefined, { _element_id: 'hero' }, [element(elementMap.heading, 'heading', { title: 'Care for your companion.' }), element(elementMap.nav, 'button', { text: 'Read our FAQ', link: { url: '#faq' } }), element(elementMap.picture, 'image', { image: { id: 31, url: `${url}/fixture.svg` } })]), element(elementMap.faq, undefined, { _element_id: 'faq' }, [element(elementMap.questions, 'accordion', { tabs: [{ tab_title: 'What can I edit?', tab_content: 'Every section uses native Elementor controls.' }] })])] };
}
async function fixture(broken = false) {
  let saved = 0;
  const server = createServer((request, response) => {
    if (request.url === '/fixture.svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#abd4bb"/></svg>'); return; }
    if (request.url === '/save') { saved++; response.end('This route must never be called by original read-only checks.'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url?.startsWith('/wp-admin/post.php')) {
      response.end(`<!doctype html><body><div id="elementor-panel"><select data-setting="content_width"><option>Boxed</option></select><input data-setting="width" value="100"></div><div id="elementor-navigator"><div class="elementor-navigator__element" data-id="${elementMap.hero}"><div class="elementor-navigator__item" onclick="window.selected='${elementMap.hero}'">Hero</div></div><div class="elementor-navigator__element" data-id="${elementMap.faq}"><div class="elementor-navigator__item" onclick="window.selected='${elementMap.faq}'">FAQ</div></div></div><iframe id="elementor-preview-iframe" src="/"></iframe><button onclick="fetch('/save')">Save Draft</button><script>window.selected='';window.elementor={getPanelView:()=>({getCurrentPageView:()=>({model:{get:(key)=>key==='id'?window.selected:'container'}})})}</script></body>`);
      return;
    }
    response.end(`<!doctype html><head><style>body{margin:0;font:16px Arial}.section{padding:24px;box-sizing:border-box}#hero{min-height:660px}#faq{min-height:450px}h1{margin:0 0 24px}a{display:inline-block;margin-bottom:24px}img{display:block}.elementor-tab-title{cursor:pointer}.elementor-tab-content{display:none}</style></head><body><main class="elementor" data-elementor-type="wp-page">
      <section class="section elementor-element" id="hero" data-id="${elementMap.hero}" data-element_type="container" ${broken ? 'style="width:850px"' : ''}>
        <div class="elementor-element" data-id="${elementMap.heading}" data-widget_type="${broken ? 'html' : 'heading'}.default"><h1 class="elementor-heading-title">Care for your companion.</h1></div>
        ${broken ? `<div class="elementor-element" data-id="${elementMap.heading}" data-widget_type="heading.default"><h1>Duplicate invisible document mistake</h1></div>` : ''}
        <div class="elementor-element" data-id="${elementMap.nav}" data-widget_type="button.default"><a class="elementor-button" href="#faq">Read our FAQ</a></div>
        <div class="elementor-element" data-id="${elementMap.picture}" data-widget_type="image.default"><img src="${broken ? '/missing' : '/fixture.svg'}" width="160" height="120" alt="Dog illustration"></div>
      </section>
      <section class="section elementor-element" id="faq" data-id="${elementMap.faq}" data-element_type="container"><div class="elementor-element" data-id="${elementMap.questions}" data-widget_type="accordion.default"><div class="elementor-accordion"><div class="elementor-accordion-item"><div class="elementor-tab-title" role="button" aria-expanded="false" aria-controls="answer">What can I edit?</div><div class="elementor-tab-content" id="answer">Every section uses native Elementor controls.</div></div></div></div></section>
      </main>${broken ? '' : '<script>document.querySelector(".elementor-tab-title").onclick=function(){const open=this.getAttribute("aria-expanded")!=="true";this.setAttribute("aria-expanded",String(open));document.getElementById("answer").style.display=open?"block":"none"}</script>'}</body>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The local fixture did not obtain a port.');
  return { url: `http://127.0.0.1:${address.port}`, get saved() { return saved; }, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test('original homepage verifies native tree, all viewport screenshots, FAQ restore and local CTA scroll', async () => {
  const site = await fixture(), directory = await mkdtemp(path.join(os.tmpdir(), 'original-homepage-'));
  try {
    const report = await verifyOriginal({ design, composition: composition(site.url), elementMap, previewUrl: site.url, runDir: directory, expectedMedia: { dog: { attachmentId: 31, url: `${site.url}/fixture.svg` } } });
    assert.equal(report.passed, true, JSON.stringify(report.issues));
    assert.deepEqual(report.coverage.map(item => [item.expected, item.matched]), [[6, 6], [6, 6], [6, 6]]);
    assert.equal(report.screenshots.length, 3);
    assert(report.sections.every(section => section.native && section.visible && section.editableElementCount > 0));
    assert(report.measurements.every(measurement => measurement.interactions?.[0].status === 'verified' && measurement.interactions[0].restored));
    assert(report.browserChecks.every(check => check.navigation[0].clicked && check.navigation[0].targetVisible && check.navigation[0].restored));
    assert.equal(report.editability.actualEditorSaveRequired, true, 'Browser/document checks cannot claim real editor save testing.');
    assert.equal(site.saved, 0);
  } finally { await site.close(); await rm(directory, { recursive: true, force: true }); }
});

test('original verifier rejects duplicate native ownership, a fake HTML widget, broken media, overflow and inert FAQ', async () => {
  const site = await fixture(true), directory = await mkdtemp(path.join(os.tmpdir(), 'original-homepage-broken-'));
  try {
    const invalid = composition(site.url);
    invalid.elements[0].elements[0].widgetType = 'html';
    invalid.elements[0].elements.push({ ...invalid.elements[0].elements[0] });
    const report = await verifyOriginal({ design, composition: invalid, elementMap, previewUrl: site.url, runDir: directory, viewports: [{ name: 'mobile', width: 390, height: 844 }] });
    assert.equal(report.passed, false);
    const codes = new Set(report.issues.map(issue => issue.code));
    for (const code of ['native-document-count', 'native-browser-element', 'authored-image-broken', 'horizontal-overflow', 'document-horizontal-overflow', 'faq-behavior']) assert(codes.has(code), `Missing ${code}`);
    assert.equal(site.saved, 0);
  } finally { await site.close(); await rm(directory, { recursive: true, force: true }); }
});

test('original editor section review selects every Navigator container without saving or changing settings', async () => {
  const site = await fixture(), directory = await mkdtemp(path.join(os.tmpdir(), 'original-editor-sections-'));
  try {
    const report = await verifyOriginalEditorSections({ design, elementMap, editorUrl: `${site.url}/wp-admin/post.php?post=17&action=elementor`, runDir: directory });
    assert.equal(report.passed, true, JSON.stringify(report.issues));
    assert.equal(report.readOnly, true);
    assert.equal(report.sections.length, 2);
    assert.deepEqual(report.sections.map(section => section.panelModelId), [elementMap.hero, elementMap.faq]);
    assert(report.sections.every(section => section.screenshot && section.selected && section.panelLoaded && section.nativeContainer));
    assert.equal(site.saved, 0);
  } finally { await site.close(); await rm(directory, { recursive: true, force: true }); }
});

test('editor startup failure evidence separates native data-id roots from hidden class matches and omits private query values', async () => {
  const site = await fixture(), directory = await mkdtemp(path.join(os.tmpdir(), 'original-editor-startup-diagnosis-'));
  const browser = await chromium.launch({ headless: true }), context = await createScopedContext(browser, site.url);
  try {
    const page = await context.newPage();
    await page.goto(`${site.url}/wp-admin/post.php?post=17&action=elementor&private_nonce=not-for-receipts`);
    const frame = page.frameLocator('#elementor-preview-iframe');
    await frame.locator(`[data-id="${elementMap.hero}"]`).waitFor({ state: 'visible' });
    const content = page.frames().find(candidate => candidate !== page.mainFrame());
    assert(content);
    await content.evaluate(id => { const style = document.createElement('style'); style.className = `elementor-element-${id}`; document.head.prepend(style); }, elementMap.hero);
    const proof = await captureOriginalEditorStartupDiagnosis(page, elementMap.hero, directory);
    const bytes = await readFile(proof.evidencePath, 'utf8'), receipt = JSON.parse(bytes);
    assert(!bytes.includes('not-for-receipts'));
    assert(!bytes.includes('private_nonce'));
    const rendered = receipt.frames.find((item: { state: { dataIdMatches?: Array<{elementType?:string}> } }) => item.state.dataIdMatches?.some(match => match.elementType === 'container'));
    assert.equal(rendered.state.dataIdMatches.length, 1);
    assert.equal(rendered.state.dataIdMatches[0].tag, 'section');
    assert.equal(rendered.state.sharedSelectorMatches[0].tag, 'style');
    assert.equal(rendered.state.sharedSelectorMatches[0].width, 0);
    assert(proof.screenshot);
    assert.equal(site.saved, 0);
  } finally { await context.close(); await browser.close(); await site.close(); await rm(directory, { recursive: true, force: true }); }
});

test('final native measurements and screenshot wait for JavaScript FAQ restoration instead of capturing a clipped slide frame', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><head><style>body{margin:0;font:16px/25px Arial}.elementor-tab-title{height:25px}.elementor-tab-content p{height:180px;margin:0}.elementor-tab-content{overflow:hidden}.footer{height:1000px}</style></head><body><main class="elementor"><div class="elementor-element" data-id="slidefaq" data-widget_type="accordion.default"><div class="elementor-accordion"><div class="elementor-accordion-item"><div class="elementor-tab-title" role="button" aria-expanded="true" aria-controls="slideanswer">What can I edit?</div><div id="slideanswer" class="elementor-tab-content"><p>Every section uses native Elementor controls. The full answer must remain painted after restoration.</p></div></div></div></div><div class="footer"></div></main><script>let timer;document.querySelector('.elementor-tab-title').onclick=function(){clearInterval(timer);const open=this.getAttribute('aria-expanded')!=='true';this.setAttribute('aria-expanded',String(open));const answer=document.getElementById('slideanswer');if(!open){answer.style.display='none';answer.style.height='';return;}answer.style.display='block';answer.style.height='1px';let height=1;timer=setInterval(()=>{height+=30;answer.style.height=height+'px';if(height>=180){clearInterval(timer);answer.style.height='';}},90);};</script></body>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'original-animated-faq-'));
  try {
    const [measurement] = await captureTarget({ previewUrl: `http://127.0.0.1:${address.port}`, runDir: directory, viewports: [{ name: 'desktop', width: 500, height: 400 }], elementMap: { questions: { targetId: 'slidefaq', kind: 'accordion' } }, sourceInteractions: { desktop: [{ sourceNodeId: 'questions', tag: 'button', role: 'button', text: 'What can I edit?', expanded: 'true', controlledContentText: 'Every section uses native Elementor controls.', disabled: false }] } });
    assert.equal(measurement.interactions?.[0].restored, true);
    assert.deepEqual(measurement.pageErrors, []);
    assert.equal(measurement.elements[0].rect.height, 205, 'Native geometry must be measured after the entire 180px answer is restored.');
    assert.equal(measurement.pageHeight, 1205);
    assert.equal((await sharp(measurement.screenshotPath).metadata()).height, measurement.pageHeight, 'Saved document measurements and screenshot must describe the same settled layout.');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(directory, { recursive: true, force: true }); }
});
