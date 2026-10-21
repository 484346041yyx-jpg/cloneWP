import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { chooseNativeCarouselOption, readNativeCarouselEditorControl, waitForNativeCarouselPanel } from '../src/fidelity/acceptance.js';

const privateValue = 'private-auth-query-cookie-DO-NOT-RECORD';
const headerID = 'bde6000';

function editorFixture(options: { id: string; modelValue: string; controlValue: string; transition?: boolean; delayedChange?: boolean; authoritative?: { id: string; value: string }; trustedChange?: boolean }) {
  return `<!doctype html><html><head><title>Owned carousel editor fixture</title></head><body class="elementor-device-desktop unrelated-private-${privateValue}">
    <aside id="elementor-panel"><div class="elementor-control-slides_to_show"><select data-setting="slides_to_show"><option value="1" ${options.controlValue === '1' ? 'selected' : ''}>1</option><option value="2" ${options.controlValue === '2' ? 'selected' : ''}>2</option><option value="5" ${options.controlValue === '5' ? 'selected' : ''}>5</option></select></div><input data-setting="unrelated_password" type="password" value="${privateValue}"></aside>
    <button class="public-save-control" disabled>Save Draft</button><button class="private-publish-${privateValue}">Publish</button><input type="hidden" name="_nonce" value="${privateValue}">
    <script>(function(){
      window.fixtureState={id:${JSON.stringify(options.id)},value:${JSON.stringify(options.modelValue)},dirty:false,secret:${JSON.stringify(privateValue)},reads:[]};
      const settings={get:key=>{window.fixtureState.reads.push('settings:'+key);return key==='slides_to_show'?window.fixtureState.value:window.fixtureState.secret;}};
      const model={get:key=>{window.fixtureState.reads.push('model:'+key);return key==='id'?window.fixtureState.id:key==='settings'?settings:window.fixtureState.secret;}};
      window.elementor={getPanelView:()=>({getCurrentPageView:()=>({model})}),saver:{isEditorChanged:()=>window.fixtureState.dirty}};
      ${options.authoritative ? `window.authoritativeState={id:${JSON.stringify(options.authoritative.id)},value:${JSON.stringify(options.authoritative.value)},changes:[],directSetCalls:0};const containerSettings={get:key=>key==='slides_to_show'?window.authoritativeState.value:undefined,set:()=>{window.authoritativeState.directSetCalls++;throw new Error('Direct settings mutation is forbidden in this fixture');}};window.elementor.getContainer=()=>({id:window.authoritativeState.id,settings:containerSettings,panel:{getControlView:name=>name==='slides_to_show'?{container:{id:window.authoritativeState.id},getControlValue:()=>window.authoritativeState.value}:undefined}});` : ''}
      ${options.transition ? `setTimeout(()=>{window.fixtureState.id='${headerID}';window.fixtureState.value='1';document.body.dataset.phase='right-model-stale-control';},200);setTimeout(()=>{document.querySelector('select[data-setting="slides_to_show"]').value='1';document.body.dataset.phase='ready';},400);` : ''}
      ${options.delayedChange ? `document.querySelector('select[data-setting="slides_to_show"]').addEventListener('change',event=>{const value=event.target.value;setTimeout(()=>{window.fixtureState.value=value;window.fixtureState.dirty=true;document.querySelector('.public-save-control').disabled=false;},250);});` : ''}
      ${options.trustedChange ? `document.querySelector('select[data-setting="slides_to_show"]').addEventListener('change',event=>{window.authoritativeState.changes.push({trusted:event.isTrusted,value:event.target.value});if(event.isTrusted){window.authoritativeState.value=event.target.value;window.fixtureState.dirty=true;document.querySelector('.public-save-control').disabled=false;}});` : ''}
    })();</script></body></html>`;
}

function assertPublicReceipt(receipt: unknown) {
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes(privateValue), false, 'unrelated credentials, hidden values, cookie/query values and unrelated classes must not enter control evidence');
  assert.equal(serialized.includes('unrelated_password'), false);
  assert.equal(serialized.includes('_nonce'), false);
  assert.equal(serialized.includes('Publish'), false, 'the getter records safe save controls only');
}

test('carousel panel readiness waits for both the exact selected model and its current DOM/model value after stale Fall panel', async () => {
  const requests: Array<{ method: string; pathname: string }> = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method ?? '', pathname: new URL(request.url ?? '/', 'http://localhost').pathname });
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Set-Cookie', `private_fixture=${privateValue}; Path=/`);
    response.end(editorFixture({ id: 'fall000', modelValue: '5', controlValue: '5', transition: true }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/wp-admin/post.php?post=11&action=elementor&nonce=${privateValue}`, { waitUntil: 'domcontentloaded' });
    const initial = await readNativeCarouselEditorControl(page);
    assert.equal(initial.modelId, 'fall000'); assert.equal(initial.modelValue, '5'); assert.equal(initial.controlValue, '5');
    let settled = false;
    const waiting = waitForNativeCarouselPanel(page, headerID, '1', 1500).then(value => { settled = true; return value; });
    await page.waitForFunction(() => document.body.dataset.phase === 'right-model-stale-control', undefined, { timeout: 1000 });
    const partial = await readNativeCarouselEditorControl(page);
    assert.equal(partial.modelId, headerID); assert.equal(partial.modelValue, '1'); assert.equal(partial.controlValue, '5');
    assert.equal(settled, false, 'a correct model ID with the old Fall select still visible must not pass');
    const ready = await waiting;
    assert.equal(ready.modelId, headerID); assert.equal(ready.modelValue, '1'); assert.equal(ready.controlValue, '1');
    assert.deepEqual(ready.deviceClasses, ['elementor-device-desktop']);
    assert.equal(ready.dirty, false);
    assert.deepEqual(ready.saveControls, [{ label: 'Save Draft', disabled: true, ariaDisabled: null, classes: 'public-save-control' }]);
    for (const receipt of [initial, partial, ready]) assertPublicReceipt(receipt);
    assert.ok(requests.every(request => request.method === 'GET'));
    assert.ok(requests.every(request => !/save|publish|admin-ajax|wp-json/i.test(request.pathname)));
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('a changed DOM select is not acknowledged until the native settings model receives the same value', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(editorFixture({ id: headerID, modelValue: '1', controlValue: '1', delayedChange: true }));
    await page.locator('#elementor-panel select[data-setting="slides_to_show"]').selectOption('2');
    const immediate = await readNativeCarouselEditorControl(page);
    assert.equal(immediate.controlValue, '2'); assert.equal(immediate.modelValue, '1'); assert.equal(immediate.dirty, false);
    const started = Date.now();
    const acknowledged = await waitForNativeCarouselPanel(page, headerID, '2', 1500);
    assert.ok(Date.now() - started >= 150, 'readiness must wait for asynchronous model acknowledgement');
    assert.equal(acknowledged.controlValue, '2'); assert.equal(acknowledged.modelValue, '2'); assert.equal(acknowledged.dirty, true);
    assert.equal(acknowledged.saveControls[0].disabled, false);
    const readKeys = await page.evaluate(() => (window as unknown as { fixtureState: { reads: string[] } }).fixtureState.reads);
    assert.ok(readKeys.every(key => ['model:id', 'model:settings', 'settings:slides_to_show'].includes(key)), 'only exact carousel identity and display-count settings may be read');
    assertPublicReceipt(immediate); assertPublicReceipt(acknowledged);
  } finally { await browser.close(); }
});

test('mismatched carousel identity, DOM select or settings model fails within the bounded panel wait', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const fixture of [
      { id: 'fall000', modelValue: '1', controlValue: '1' },
      { id: headerID, modelValue: '1', controlValue: '2' },
      { id: headerID, modelValue: '2', controlValue: '1' },
    ]) {
      await page.setContent(editorFixture(fixture));
      const started = Date.now();
      await assert.rejects(waitForNativeCarouselPanel(page, headerID, '1', 300), /Timeout/);
      assert.ok(Date.now() - started < 1500);
      assertPublicReceipt(await readNativeCarouselEditorControl(page));
    }
  } finally { await browser.close(); }
});

test('authoritative native container settings can acknowledge a change while the deprecated panel model stays stale', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(editorFixture({ id: headerID, modelValue: '1', controlValue: '2', authoritative: { id: headerID, value: '2' } }));
    const approved = await waitForNativeCarouselPanel(page, headerID, '2', 600);
    assert.equal(approved.modelId, headerID);
    assert.equal(approved.modelValue, '1', 'the stale legacy model must not veto the actual native container acknowledgement');
    assert.equal(approved.containerId, headerID); assert.equal(approved.containerValue, '2');
    assert.equal(approved.controlContainerId, headerID); assert.equal(approved.controlModelValue, '2'); assert.equal(approved.controlValue, '2');
    assertPublicReceipt(approved);

    await page.setContent(editorFixture({ id: headerID, modelValue: '2', controlValue: '2', authoritative: { id: 'fall000', value: '2' } }));
    await assert.rejects(waitForNativeCarouselPanel(page, headerID, '2', 300), /Timeout/);
    const mismatched = await readNativeCarouselEditorControl(page);
    assert.equal(mismatched.containerId, 'fall000'); assertPublicReceipt(mismatched);

    await page.setContent(editorFixture({ id: headerID, modelValue: '2', controlValue: '2', authoritative: { id: headerID, value: '2' } }));
    await page.evaluate(() => { (window as unknown as { elementor: { getContainer: () => unknown } }).elementor.getContainer = () => undefined; });
    await assert.rejects(waitForNativeCarouselPanel(page, headerID, '2', 300), /Timeout/, 'an available container API with a missing target cannot fall back to a stale legacy model');
  } finally { await browser.close(); }
});

test('actual native select keyboard input sends trusted change events to the authoritative container without direct model mutation', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(editorFixture({ id: headerID, modelValue: '1', controlValue: '1', authoritative: { id: headerID, value: '1' }, trustedChange: true }));
    const select = page.locator('#elementor-panel .elementor-control-slides_to_show select[data-setting="slides_to_show"]');
    await chooseNativeCarouselOption(select, '2');
    const acknowledged = await waitForNativeCarouselPanel(page, headerID, '2', 600);
    assert.equal(acknowledged.controlValue, '2'); assert.equal(acknowledged.containerValue, '2'); assert.equal(acknowledged.controlModelValue, '2');
    assert.equal(acknowledged.modelValue, '1', 'keyboard events update the current container, while the obsolete panel object remains unchanged');
    assert.equal(acknowledged.dirty, true);
    const events = await page.evaluate(() => (window as unknown as { authoritativeState: { changes: Array<{ trusted: boolean; value: string }>; directSetCalls: number } }).authoritativeState);
    assert.ok(events.changes.some(event => event.trusted && event.value === '2'));
    assert.ok(events.changes.every(event => event.trusted));
    assert.equal(events.directSetCalls, 0);
    await assert.rejects(chooseNativeCarouselOption(select, '9'), /not enabled/);
    assert.equal(await select.inputValue(), '2');
    assertPublicReceipt(acknowledged);
  } finally { await browser.close(); }
});
