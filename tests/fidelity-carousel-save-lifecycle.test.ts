import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { trackNativeEditorPosts } from '../src/fidelity/acceptance.js';

const privateValue = 'private-save-nonce-cookie-query-DO-NOT-RECORD';

async function saveFixture(options: { dispatchDelay: number; responseDelay: number }) {
  let savedValue = '1';
  const requests: Array<{ method: string; pathname: string }> = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    requests.push({ method: request.method ?? '', pathname: url.pathname });
    if (request.method === 'POST' && url.pathname === '/wp-admin/admin-ajax.php') {
      let body = '';
      request.setEncoding('utf8'); request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        const fields = new URLSearchParams(body);
        const actions = JSON.parse(fields.get('actions') ?? '{}') as { save_builder?: { action?: string; data?: { value?: string } } };
        setTimeout(() => {
          if (fields.get('action') === 'elementor_ajax' && actions.save_builder?.action === 'save_builder') savedValue = actions.save_builder.data?.value ?? savedValue;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ success: true, value: savedValue }));
        }, options.responseDelay);
      });
      return;
    }
    if (url.pathname === '/favicon.ico') { response.statusCode = 204; response.end(); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Set-Cookie', `private_fixture=${privateValue}; Path=/; SameSite=Lax`);
    response.end(`<!doctype html><html><head><title>Owned native save lifecycle fixture</title></head><body><button id="save">Save Draft</button><script>
      document.querySelector('#save').addEventListener('click',()=>{
        setTimeout(()=>{
          const body=new URLSearchParams({action:'elementor_ajax',actions:JSON.stringify({save_builder:{action:'save_builder',data:{private_nonce:'${privateValue}',value:'2'}}})});
          fetch('/wp-admin/admin-ajax.php?private_nonce=${privateValue}',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':'Bearer ${privateValue}'},body}).then(response=>response.json()).then(result=>{document.body.dataset.saved=String(result.value);});
        },${options.dispatchDelay});
      });
    </script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  return {
    editorUrl: `http://127.0.0.1:${address.port}/owned-editor?private_nonce=${privateValue}`,
    origin: `http://127.0.0.1:${address.port}`,
    value: () => savedValue,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function assertSafeLifecycle(tracker: ReturnType<typeof trackNativeEditorPosts>, origin: string) {
  const events = tracker.events;
  assert.deepEqual(events.map(event => event.event), ['started', 'finished']);
  assert.ok(events.every(event => event.location === `${origin}/wp-admin/admin-ajax.php`));
  assert.ok(events.every(event => JSON.stringify(event.actions) === '["save_builder"]'));
  const serialized = JSON.stringify(events);
  for (const prohibited of [privateValue, 'private_nonce', 'private_fixture', 'Authorization', 'Bearer', '?', '"data"', '"body"', '"value"']) assert.equal(serialized.includes(prohibited), false, `lifecycle diagnostics must not persist ${prohibited}`);
}

function assertOwnFixtureRequests(requests: Array<{ method: string; pathname: string }>) {
  assert.equal(requests.filter(request => request.method === 'POST').length, 1);
  assert.ok(requests.every(request => request.method === 'POST' ? request.pathname === '/wp-admin/admin-ajax.php' : request.method === 'GET' && ['/owned-editor', '/favicon.ico'].includes(request.pathname)));
}

test('zero initially pending requests cannot complete a save wait before delayed real save dispatch and server response', async () => {
  const source = await saveFixture({ dispatchDelay: 800, responseDelay: 400 });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(source.editorUrl, { waitUntil: 'domcontentloaded' });
    const tracker = trackNativeEditorPosts(page);
    tracker.markSaveClick();
    const started = Date.now();
    await page.getByRole('button', { name: 'Save Draft' }).click();
    let settled = false;
    const waiting = tracker.waitForQuiet(4000).then(() => { settled = true; });
    await page.waitForTimeout(650);
    assert.equal(tracker.pendingCount(), 0, 'dispatch is intentionally later than the quiet interval');
    assert.equal(tracker.events.length, 0);
    assert.equal(source.value(), '1');
    assert.equal(settled, false, 'a clicked save must prove its own completed save request before permitting restoration');
    await waiting;
    assert.ok(Date.now() - started >= 1700, 'real dispatch, response and subsequent quiet period must all complete');
    assert.equal(tracker.pendingCount(), 0);
    assert.equal(source.value(), '2');
    assert.equal(await page.locator('body').getAttribute('data-saved'), '2');
    assertSafeLifecycle(tracker, source.origin);
    assertOwnFixtureRequests(source.requests);
  } finally { await browser.close(); await source.close(); }
});

test('a pending server-side save survives a short wait timeout and later completion is observed before the editor is closed', async () => {
  const source = await saveFixture({ dispatchDelay: 0, responseDelay: 1200 });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(source.editorUrl, { waitUntil: 'domcontentloaded' });
    const tracker = trackNativeEditorPosts(page);
    tracker.markSaveClick();
    await page.getByRole('button', { name: 'Save Draft' }).click();
    await assert.rejects(tracker.waitForQuiet(700), /bounded save\/restoration deadline/);
    assert.equal(tracker.pendingCount(), 1, 'the unresolved save must remain tracked after the first timeout');
    assert.deepEqual(tracker.events.map(event => event.event), ['started']);
    assert.equal(source.value(), '1');
    assert.equal(page.isClosed(), false, 'the fixture stays open while the save can still commit');
    await tracker.waitForQuiet(3000);
    assert.equal(tracker.pendingCount(), 0);
    assert.equal(source.value(), '2');
    assertSafeLifecycle(tracker, source.origin);
    assertOwnFixtureRequests(source.requests);
  } finally { await browser.close(); await source.close(); }
});
