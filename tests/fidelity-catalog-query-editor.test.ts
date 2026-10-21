import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { assertAuthorizedCatalogQueryChange, exposeNativeProductQuerySection,readNativeProductQueryControl, waitForNativeProductQueryControl } from '../src/fidelity/acceptance.js';
import type { DraftSnapshot, LegacySchema } from '../src/wordpress/types.js';

const targetId = '2222222', secret = 'private-field-cookie-nonce-do-not-record';
const schemas: Record<string, LegacySchema> = {
  container: { type: 'container', class: 'Elementor\\Container', controls: { content_width: { type: 'select', default: 'full', options: { full: 'Full' } } } },
  heading: { type: 'heading', class: 'Elementor\\Widget_Heading', controls: { title: { type: 'text', default: '' } } },
  wd_products: { type: 'wd_products', class: 'XTS\\Elementor\\Products', controls: {
    items_per_page: { type: 'number', default: 12 }, post_type: { type: 'select', default: 'product', options: { product: 'All products', sale: 'Sale products' } },
    layout: { type: 'select', default: 'grid', options: { grid: 'Grid', carousel: 'Carousel' } }, empty_registered_link: { type: 'url', default: { url: '', is_external: '', nofollow: '' } },
  } },
};
function snapshots(value: number | string = 13) {
  const before: DraftSnapshot = { pageId: 13178, runId: 'owned-native-query-test', title: 'Owned source draft', status: 'draft', hash: 'a'.repeat(64), settings: { background_color: '#ffffff' }, elements: [{ id: '1111111', elType: 'container', isInner: false, settings: { content_width: 'full' }, elements: [{ id: '3333333', elType: 'widget', widgetType: 'heading', settings: { title: 'Original source title' }, elements: [] }, { id: targetId, elType: 'widget', widgetType: 'wd_products', settings: { items_per_page: 12, post_type: 'product', layout: 'carousel', empty_registered_link: { url: '', is_external: '', nofollow: '' } }, elements: [] }] }] };
  const current = structuredClone(before); current.hash = 'b'.repeat(64); current.elements[0].elements[1].settings.items_per_page = value;
  return { before, current };
}
test('catalog UI guard accepts only the exact recorded numeric count change with all source and page ownership intact', () => {
  for (const value of [13, '13']) { const { before, current } = snapshots(value); assert.doesNotThrow(() => assertAuthorizedCatalogQueryChange(before, current, { targetId, value: 13 }, schemas)); }
  const { before, current } = snapshots(14); assert.throws(() => assertAuthorizedCatalogQueryChange(before, current, { targetId, value: 13 }, schemas), /exact registered/);
  assert.throws(() => assertAuthorizedCatalogQueryChange(before, current, { targetId, value: 14 }, schemas), /exact registered|increment|count/);
});
test('catalog query restoration rejects unrelated text, data source, layout, unknown settings and source structure edits', () => {
  const changes = [
    (s: DraftSnapshot) => { s.elements[0].elements[0].settings.title = 'Concurrent human title'; },
    (s: DraftSnapshot) => { s.elements[0].elements[1].settings.post_type = 'sale'; },
    (s: DraftSnapshot) => { s.elements[0].elements[1].settings.layout = 'grid'; },
    (s: DraftSnapshot) => { s.elements[0].elements[1].settings.unregistered_setting = ''; },
    (s: DraftSnapshot) => { s.elements[0].elements.reverse(); },
    (s: DraftSnapshot) => { s.elements[0].elements[1].id = '4444444'; },
    (s: DraftSnapshot) => { s.elements[0].elements[1].isInner = true; },
    (s: DraftSnapshot) => { s.elements[0].elements[1].elements.push({ id: '4444444', elType: 'container', isInner: true, settings: {}, elements: [] }); },
  ];
  for (const change of changes) { const { before, current } = snapshots(); change(current); assert.throws(() => assertAuthorizedCatalogQueryChange(before, current, { targetId, value: 13 }, schemas), /unrelated|exact registered|identity or nesting|order or structure/); }
});
test('native product count guard preserves current draft identity, status, title and human page style changes', () => {
  for (const fields of [{ pageId: 999 }, { runId: 'another-run' }, { title: 'Human title' }, { status: 'publish' }]) { const { before, current } = snapshots(); Object.assign(current, fields); assert.throws(() => assertAuthorizedCatalogQueryChange(before, current, { targetId, value: 13 }, schemas), /outside its authorized/); }
  const { before, current } = snapshots(); current.settings.background_color = '#ff0000'; assert.throws(() => assertAuthorizedCatalogQueryChange(before, current, { targetId, value: 13 }, schemas), /outside its authorized/);
});
test('native product count needs the exact registered number control and does not accept unrelated widget or nonnumeric values', () => {
  for (const value of ['not-a-number', 'NaN', '', 13.5]) { const { before, current } = snapshots(value); assert.throws(() => assertAuthorizedCatalogQueryChange(before, current, { targetId, value: 13 }, schemas), /exact registered/); }
  for (const value of [0, -1, 13.5, NaN]) { const { before, current } = snapshots(); assert.throws(() => assertAuthorizedCatalogQueryChange(before, current, { targetId, value }, schemas), /exact registered/); }
  const { before, current } = snapshots(), wrong = structuredClone(schemas); wrong.wd_products.controls.items_per_page.type = 'text'; assert.throws(() => assertAuthorizedCatalogQueryChange(before, current, { targetId, value: 13 }, wrong), /exact registered/);
  current.elements[0].elements[1].widgetType = 'heading'; assert.throws(() => assertAuthorizedCatalogQueryChange(before, current, { targetId, value: 13 }, schemas), /exact registered/);
});
test('registered default serialization permits only known empty/default removals and never erases an unknown human setting', () => {
  const { before, current } = snapshots(); delete current.elements[0].elements[1].settings.empty_registered_link; delete current.elements[0].elements[1].settings.post_type; delete current.elements[0].settings.content_width;
  assert.doesNotThrow(() => assertAuthorizedCatalogQueryChange(before, current, { targetId, value: 13 }, schemas));
  before.elements[0].elements[1].settings.unknown_human_setting = ''; assert.throws(() => assertAuthorizedCatalogQueryChange(before, current, { targetId, value: 13 }, schemas), /unrelated controls/);
});

test('an actual 11-to-12 query edit may omit only its exact registered default after serialization',()=>{
  const{before,current}=snapshots(12);before.elements[0].elements[1].settings.items_per_page=11;delete current.elements[0].elements[1].settings.items_per_page;
  assert.doesNotThrow(()=>assertAuthorizedCatalogQueryChange(before,current,{targetId,value:12},schemas));
  for(const defaultValue of [undefined,13,'not-a-number',null]){const wrong=structuredClone(schemas);wrong.wd_products.controls.items_per_page.default=defaultValue;assert.throws(()=>assertAuthorizedCatalogQueryChange(before,current,{targetId,value:12},wrong),/exact registered/);}
  const explicitNull=structuredClone(current);explicitNull.elements[0].elements[1].settings.items_per_page=null;assert.throws(()=>assertAuthorizedCatalogQueryChange(before,explicitNull,{targetId,value:12},schemas),/exact registered/);
  const otherChange=structuredClone(current);otherChange.elements[0].elements[1].settings.unregistered_human_value='Changed';assert.throws(()=>assertAuthorizedCatalogQueryChange(before,otherChange,{targetId,value:12},schemas),/unrelated controls/);
});

let browser: Browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser.close(); });
async function editorFixture(t: TestContext, options: { modelId?: string; containerId?: string; containerValue?: number; inputValue?: number; delay?: number } = {}): Promise<Page> {
  const page = await browser.newPage(); t.after(async () => { await page.close(); });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><aside id="elementor-panel"><input type="number" step="1" min="1" data-setting="items_per_page" value="${options.inputValue ?? 12}"><select data-setting="post_type"><option value="product">All products</option><option value="sale">Sale products</option></select><input type="password" data-setting="private_password" value="${secret}"><input type="hidden" name="nonce" value="${secret}"></aside><button>Another control</button><script>
    Object.defineProperty(globalThis,'__name',{value:(target)=>target,configurable:true});
    window.nativeState={modelId:${JSON.stringify(options.modelId ?? targetId)},containerId:${JSON.stringify(options.containerId ?? targetId)},value:${options.containerValue ?? 12},panelValue:12,dirty:false,events:[],reads:[],directWrites:0,secret:${JSON.stringify(secret)}};
    const legacySettings={get:key=>{window.nativeState.reads.push('legacy:'+key);return key==='items_per_page'?window.nativeState.panelValue:window.nativeState.secret;}};
    const model={get:key=>{window.nativeState.reads.push('model:'+key);return key==='id'?window.nativeState.modelId:key==='settings'?legacySettings:window.nativeState.secret;}};
    const actualSettings={get:key=>{window.nativeState.reads.push('container:'+key);return key==='items_per_page'?window.nativeState.value:key==='post_type'?'product':undefined;},set:()=>{window.nativeState.directWrites++;throw Error('Direct settings writes are forbidden');}};
    window.elementor={getPanelView:()=>({getCurrentPageView:()=>({model})}),getContainer:()=>({id:window.nativeState.containerId,settings:actualSettings}),saver:{isEditorChanged:()=>window.nativeState.dirty}};
    document.querySelector('[data-setting="items_per_page"]').addEventListener('change',event=>{window.nativeState.events.push({trusted:event.isTrusted,value:event.target.value});if(event.isTrusted){const value=Number(event.target.value);setTimeout(()=>{window.nativeState.value=value;window.nativeState.dirty=true;},${options.delay ?? 0});}});
  </script></body></html>`);
  return page;
}
const publicReceipt = (value: unknown) => { const text = JSON.stringify(value); assert.equal(text.includes(secret), false); assert.equal(text.includes('private_password'), false); assert.equal(text.includes('nonce'), false); };
test('trusted native ArrowUp and Tab change the authoritative own-query container while the old panel value remains stale', async t => {
  const page = await editorFixture(t), input = page.locator('#elementor-panel [data-setting="items_per_page"]');
  const before = await waitForNativeProductQueryControl(page, targetId, 12, 500); assert.equal(before.containerValue, 12); publicReceipt(before);
  await input.focus(); await input.press('ArrowUp'); await input.press('Tab'); const after = await waitForNativeProductQueryControl(page, targetId, 13, 800);
  assert.equal(after.containerValue, 13); assert.equal(after.controlValue, '13'); assert.equal(after.dirty, true); publicReceipt(after);
  const state = await page.evaluate(() => (window as unknown as { nativeState: { panelValue: number; directWrites: number; events: Array<{ trusted: boolean; value: string }>; reads: string[] } }).nativeState);
  assert.equal(state.panelValue, 12); assert.equal(state.directWrites, 0); assert.ok(state.events.some(event => event.trusted && event.value === '13')); assert.ok(state.events.every(event => event.trusted));
  assert.ok(state.reads.every(key => ['model:id', 'container:items_per_page'].includes(key)));
});
test('own query readiness waits actual asynchronous container acknowledgement instead of trusting only the displayed input', async t => {
  const page = await editorFixture(t, { delay: 250 }), input = page.locator('[data-setting="items_per_page"]');
  await input.focus(); await input.press('ArrowUp'); await input.press('Tab'); const before = await readNativeProductQueryControl(page); assert.equal(before.controlValue, '13'); assert.equal(before.containerValue, 12);
  const started = Date.now(), after = await waitForNativeProductQueryControl(page, targetId, 13, 1000); assert.ok(Date.now() - started >= 100); assert.equal(after.containerValue, 13); publicReceipt(after);
});
test('wrong own-query model/container identity or unacknowledged values reject within a bounded local wait', async t => {
  for (const options of [{ modelId: '9999999' }, { containerId: '9999999' }, { inputValue: 13, containerValue: 12 }, { inputValue: 12, containerValue: 13 }]) {
    const page = await editorFixture(t, options), started = Date.now(); await assert.rejects(waitForNativeProductQueryControl(page, targetId, 13, 250), /exact native product query input/); assert.ok(Date.now() - started < 1200); publicReceipt(await readNativeProductQueryControl(page));
  }
});

test('native query count and slider are exposed by real clicks in their separately registered Layout and Carousel sections',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());
  await page.setContent(`<div id="elementor-panel"><div class="elementor-control-layout_style_section"><button class="elementor-panel-heading">Layout</button></div><div class="elementor-control-carousel_style_section"><button class="elementor-panel-heading">Carousel</button></div><div id="current-fields"><div class="elementor-control-items_per_page"><input type="number" data-setting="items_per_page" value="11"></div></div></div><script>window.sectionClicks=[];window.elementor={getPanelView:()=>({getCurrentPageView:()=>({model:{get:key=>key==='id'?'2222222':undefined}})}),getContainer:id=>({id})};const fields=document.querySelector('#current-fields');document.querySelector('.elementor-control-carousel_style_section button').onclick=event=>{sectionClicks.push({section:'carousel',trusted:event.isTrusted});fields.innerHTML='<div class="elementor-control-slides_per_view"><input type="number" data-setting="size" value="5"></div>'};document.querySelector('.elementor-control-layout_style_section button').onclick=event=>{sectionClicks.push({section:'layout',trusted:event.isTrusted});fields.innerHTML='<div class="elementor-control-items_per_page"><input type="number" data-setting="items_per_page" value="11"></div>'};Object.defineProperty(globalThis,'__name',{value:target=>target,configurable:true});</script>`);
  const schema:LegacySchema={type:'wd_products',class:'XTS\\Elementor\\Products',controls:{layout_style_section:{type:'section'},carousel_style_section:{type:'section',condition:{layout:'carousel'}},items_per_page:{type:'number'},slides_per_view:{type:'slider'}}};
  const layout=await exposeNativeProductQuerySection(page,targetId,'layout_style_section','items_per_page',schema);assert.equal(layout.inputs[0].value,'11');assert.equal(await page.locator('.elementor-control-slides_per_view').count(),0);
  const carousel=await exposeNativeProductQuerySection(page,targetId,'carousel_style_section','slides_per_view',schema);assert.equal(carousel.inputs[0].setting,'size');assert.equal(carousel.inputs[0].value,'5');assert.equal(await page.locator('[data-setting="items_per_page"]').count(),0,'a section switch actually replaces the editor control views');
  const restored=await exposeNativeProductQuerySection(page,targetId,'layout_style_section','items_per_page',schema);assert.equal(restored.inputs[0].value,'11');assert.deepEqual(await page.evaluate(()=>(window as unknown as{sectionClicks:unknown[]}).sectionClicks),[{section:'carousel',trusted:true},{section:'layout',trusted:true}]);
  await assert.rejects(exposeNativeProductQuerySection(page,targetId,'carousel_style_section','slides_per_view',{...schema,controls:{...schema.controls,slides_per_view:{type:'number'}}}),/not registered/);
});
