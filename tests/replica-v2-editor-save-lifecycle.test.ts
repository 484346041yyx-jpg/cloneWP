import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { trackNativeEditorPosts } from '../src/fidelity/acceptance.js';
import { captureEditorSaveLifecycleV2, waitForEditorSaveV2, beginEditorAttemptV2, persistEditorAttemptV2, type EditorCheckV2, type EditorReceiptV2 } from '../src/replica-v2/editor.js';

const privateValue = 'private-nonce-cookie-body-query-MUST-NOT-PERSIST';
const check = (): EditorCheckV2 => ({ group: 'native-product-query', componentKey: 'catalog', elementId: 'abcdefg', selected: true, changed: true, saved: false, frontendConfirmed: false, restored: false });

test('v2 successful save wait retains real sanitized POST events and fixed deadline without inventing group acceptance', async () => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'POST') { request.resume(); request.on('end', () => { setTimeout(() => { response.setHeader('Content-Type', 'application/json'); response.end('{"success":true}'); }, 120); }); return; }
    if (url.pathname === '/favicon.ico') { response.statusCode = 204; response.end(); return; }
    response.setHeader('Content-Type', 'text/html'); response.setHeader('Set-Cookie', 'private_cookie=' + privateValue + '; Path=/');
    response.end('<button id="save">Save Draft</button><script>document.querySelector("button").onclick=()=>fetch("/wp-admin/admin-ajax.php?nonce=' + privateValue + '",{method:"POST",headers:{Authorization:"Bearer ' + privateValue + '"},body:new URLSearchParams({action:"elementor_ajax",actions:JSON.stringify({save:{action:"save_builder",data:{private_nonce:"' + privateValue + '"}}})})}).then(r=>r.json());</script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert(address && typeof address === 'object');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.goto('http://127.0.0.1:' + address.port + '/editor?nonce=' + privateValue);
    const tracker = trackNativeEditorPosts(page), result = check(); tracker.markSaveClick(); await page.getByRole('button', { name: 'Save Draft' }).click(); await waitForEditorSaveV2(tracker, result, 'save', 0);
    assert.deepEqual(result.saveLifecycle?.events.map(event => event.event), ['started', 'finished']);
    assert(result.saveLifecycle?.events.every(event => event.location === 'http://127.0.0.1:' + address.port + '/wp-admin/admin-ajax.php' && event.actions.join() === 'save_builder'));
    assert.equal(result.saveLifecycle?.pendingCount, 0); assert.equal(result.saveLifecycle?.waits[0].timeoutMs, 45000); assert.equal(result.saveLifecycle?.waits[0].outcome, 'quiet'); assert((result.saveLifecycle?.waits[0].durationMs ?? 0) >= 600);
    assert.equal(result.saved, false); assert.equal(result.frontendConfirmed, false); assert.equal(result.restored, false);
    const serialized = JSON.stringify(result.saveLifecycle); for (const forbidden of [privateValue, 'private_nonce', 'private_cookie', 'Authorization', 'Bearer', '?', '"body"', '"data"']) assert(!serialized.includes(forbidden));
  } finally { await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('v2 timeout and failure-recovery wait snapshots persist pending state and exact original errors without turning late quiet into saved', async () => {
  const result = check(), events = [{ event: 'started', at: new Date().toISOString(), location: 'https://owned.test/wp-admin/admin-ajax.php?nonce=' + privateValue, actions: ['save_builder'] }], original = new Error('Native editor save POST did not finish before the bounded save/restoration deadline'); let pending = 1, calls = 0;
  const tracker = { events, pendingCount: () => pending, async waitForQuiet(timeout: number) { assert.equal(timeout, 45000); calls++; if (calls === 1) throw original; events.push({ ...events[0], event: 'finished' }); pending = 0; } };
  await assert.rejects(waitForEditorSaveV2(tracker, result, 'save', 0), error => error === original);
  assert.equal(result.saveLifecycle?.pendingCount, 1); assert.equal(result.saveLifecycle?.waits[0].pendingCount, 1); assert.equal(result.saveLifecycle?.waits[0].outcome, 'timeout'); assert.equal(result.saveLifecycle?.events.length, 1);
  await waitForEditorSaveV2(tracker, result, 'failure-recovery', 0);
  assert.equal(result.saveLifecycle?.waits.length, 2); assert.equal(result.saveLifecycle?.waits[0].pendingCount, 1); assert.equal(result.saveLifecycle?.waits[1].outcome, 'quiet'); assert.equal(result.saveLifecycle?.pendingCount, 0); assert.equal(result.saved, false);
  const base = 'D:/cloneWP/.cache/editor-save-lifecycle-tests'; await mkdir(base, { recursive: true }); const run = await mkdtemp(path.join(base, 'run-'));
  try {
    const attempt = await beginEditorAttemptV2(run, '1'.repeat(64)); const report: EditorReceiptV2 = { version: 2, passed: false, editorSessions: 1, editorLoads: 1, browserRequests: 1, pages: 2, sections: [], checks: [result], restorePending: true, error: original.message }; await persistEditorAttemptV2(attempt, report);
    const stored = JSON.parse(await readFile(attempt.reportPath, 'utf8')); assert.deepEqual(stored.checks[0].saveLifecycle, result.saveLifecycle); assert.equal(stored.passed, false); assert.equal(stored.checks[0].saved, false); assert.equal(stored.restorePending, true); assert.deepEqual(await readFile(attempt.latestPath), await readFile(attempt.reportPath));
  } finally { const relative = path.relative(base, run); assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); await rm(run, { recursive: true, force: true }); }
});

test('v2 lifecycle observation excludes previous groups and raw extra fields, preserves failed wait, and copies tracker data', async () => {
  const result = check(), now = new Date().toISOString(), events = [{ event: 'started', at: now, location: 'https://owned.test/previous', actions: ['save_document'] }, { event: 'started', at: now, location: 'https://user:password@owned.test/wp-admin/admin-ajax.php?nonce=' + privateValue + '#cookie', actions: ['save_builder', 'invalid?' + privateValue], body: privateValue, cookies: privateValue }];
  const error = new Error('Native editor POST failed; server-side save completion is not proved');
  const tracker = { events, pendingCount: () => 1, async waitForQuiet(timeout: number) { assert.equal(timeout, 45000); throw error; } };
  await assert.rejects(waitForEditorSaveV2(tracker, result, 'failure-recovery', 1), actual => actual === error);
  const lifecycle = result.saveLifecycle!; assert.equal(lifecycle.waits[0].outcome, 'failed'); assert.equal(lifecycle.events.length, 1); assert.equal(lifecycle.events[0].location, 'https://owned.test/wp-admin/admin-ajax.php'); assert.deepEqual(lifecycle.events[0].actions, ['save_builder']);
  events[1].actions[0] = 'changed_after_snapshot'; assert.deepEqual(lifecycle.events[0].actions, ['save_builder']);
  const serialized = JSON.stringify(lifecycle); for (const forbidden of [privateValue, 'password', 'user:', '?', '#cookie', '"body"', '"cookies"', '/previous']) assert(!serialized.includes(forbidden));
  assert.equal(result.saved, false); assert.equal(result.restored, false); assert.equal(result.frontendConfirmed, false);
  captureEditorSaveLifecycleV2(tracker, result, 1); assert.equal(result.saveLifecycle?.waits.length, 1, 'later tracker snapshots must not erase the timed wait evidence');
});
