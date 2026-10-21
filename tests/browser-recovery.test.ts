import test from 'node:test';
import assert from 'node:assert/strict';
import { browserPreflightMain } from '../src/replica-v2/browser-preflight-cli.js';
import { browserRecoveryFailureAction, canResumeBrowserCapture, nextBrowserRecoveryAction, recoverSourceBrowser,
  type BrowserRecoveryAdapter, type BrowserRecoveryBinding, type BrowserRecoveryInput, type BrowserRecoveryInventory } from '../src/replica-v2/browser-recovery.js';

const sourceUrl = 'https://example.com/shop/';
const binding = { browserId: 'live-instance', tabId: 'live-tab' };
const inventory = { browsers: [{ browserId: binding.browserId, tabs: [{ tabId: binding.tabId, url: sourceUrl }] }] };
const input = (): Omit<BrowserRecoveryInput, 'events'> => ({ version: 1, sourceUrl, nextRequestUtf8Bytes: 3000, probeRequestUtf8Bytes: { url: 110, dom: 280 } });
function adapter(overrides: Partial<BrowserRecoveryAdapter> = {}) {
  const calls: string[] = [];
  const api: BrowserRecoveryAdapter = {
    async inventory() { calls.push('inventory'); return inventory; },
    async bind(value) { calls.push(`bind:${value.tabId}`); },
    async readUrl(value) { calls.push(`url:${value.tabId}`); return { actualUrl: sourceUrl }; },
    async readDom(value) { calls.push(`dom:${value.tabId}`); return { actualUrl: sourceUrl, readyState: 'complete', bodyPresent: true, access: 'normal' }; },
    async wait(ms) { calls.push(`wait:${ms}`); }, ...overrides,
  };
  return { api, calls };
}

test('fresh inventory binds the exact existing URL and verifies both small reads without requesting user help', async () => {
  const { api, calls } = adapter();
  const result = await recoverSourceBrowser(input(), api);
  assert.equal(result.code, 'ready'); assert.equal(result.userHelpRequired, false); assert.equal(result.remoteWrites, 0);
  assert.deepEqual(result.binding, binding);
  assert.deepEqual(calls, ['inventory', 'bind:live-tab', 'url:live-tab', 'dom:live-tab']);
});

test('one same-binding CDP retry recovers automatically without reinventory or repeated binding', async () => {
  let probes = 0;
  const { api, calls } = adapter({ async readUrl() { probes++; if (probes === 1) throw Error('CDP Page.getFrameTree timed out'); return { actualUrl: sourceUrl }; } });
  const result = await recoverSourceBrowser({ ...input(), initialBinding: binding }, api);
  assert.equal(result.status, 'ready'); assert.equal(probes, 2);
  assert.equal(result.metrics.sameBindingRetries, 1); assert.equal(result.metrics.inventoryCalls, 0);
  assert.deepEqual(calls, ['dom:live-tab']);
});

test('failed same-binding retry refreshes inventory and reacquires a changed live session ID', async () => {
  let probes = 0; const seen: BrowserRecoveryBinding[] = [];
  const changed = { browserId: 'new-instance', tabId: 'new-source' };
  const { api } = adapter({
    async inventory() { return { browsers: [{ browserId: changed.browserId, tabs: [{ tabId: changed.tabId, url: sourceUrl }] }] }; },
    async readUrl(selected) { seen.push(selected); probes++; if (probes <= 2) throw Error('CDP Page.getFrameTree timed out'); return { actualUrl: sourceUrl }; },
  });
  const result = await recoverSourceBrowser({ ...input(), initialBinding: binding }, api);
  assert.equal(result.status, 'ready'); assert.deepEqual(result.binding, changed);
  assert.deepEqual(seen, [binding, binding, changed]); assert.equal(result.metrics.sameBindingRetries, 1);
});

test('an already exhausted legacy retry starts with fresh inventory; a failed DOM probe retries that same probe', async () => {
  const { api, calls } = adapter();
  const exhausted = await recoverSourceBrowser({ ...input(), initialBinding: binding, sameBindingRetryUsed: true,
    failure: { scope: 'source-read', error: 'CDP Runtime.evaluate timed out', probeStage: 'dom' } }, api);
  assert.equal(exhausted.status, 'ready'); assert.equal(exhausted.metrics.sameBindingRetries, 0);
  assert.deepEqual(calls, ['inventory', 'bind:live-tab', 'url:live-tab', 'dom:live-tab']);
  calls.length = 0;
  const retried = await recoverSourceBrowser({ ...input(), initialBinding: binding,
    failure: { scope: 'source-read', error: 'CDP Runtime.evaluate timed out', probeStage: 'dom' } }, api);
  assert.equal(retried.status, 'ready'); assert.equal(retried.metrics.sameBindingRetries, 1);
  assert.deepEqual(calls, ['dom:live-tab']);
});

test('detached tab uses a supported reacquisition before it asks the user', async () => {
  const { api, calls } = adapter();
  const result = await recoverSourceBrowser({ ...input(), initialBinding: binding, failure: { scope: 'source-read', error: 'Debugger is not attached to tab' } }, api);
  assert.equal(result.status, 'ready'); assert.deepEqual(calls, ['inventory', 'bind:live-tab', 'url:live-tab', 'dom:live-tab']);
});

test('temporary empty inventory recovers after 2s and 5s backoff; persistent offline is terminal exactly once', async () => {
  let reads = 0; const waits: number[] = [];
  const { api } = adapter({ async inventory() { return ++reads === 3 ? inventory : { browsers: [] }; }, async wait(ms) { waits.push(ms); } });
  const recovered = await recoverSourceBrowser(input(), api);
  assert.equal(recovered.status, 'ready'); assert.equal(reads, 3); assert.deepEqual(waits, [2000, 5000]);
  reads = 0; waits.length = 0;
  api.inventory = async () => { reads++; return { browsers: [] }; };
  const stopped = await recoverSourceBrowser(input(), api);
  assert.equal(stopped.status, 'user-action-required'); assert.equal(stopped.code, 'connection-unavailable');
  assert.equal(reads, 3); assert.deepEqual(waits, [2000, 5000]);
});

test('persistent not-attached stays bounded even when inventory keeps advertising the same tab', async () => {
  const { api } = adapter({ async bind() { throw Error('Debugger is not attached to tab'); } });
  const result = await recoverSourceBrowser(input(), api);
  assert.equal(result.code, 'tab-attachment-unavailable'); assert.equal(result.userHelpRequired, true);
  assert.equal(result.metrics.binds, 3); assert.equal(result.metrics.urlProbes, 0);
});

test('duplicate exact URL probes each candidate and prefers the known original binding', async () => {
  const duplicated: BrowserRecoveryInventory = structuredClone(inventory);
  duplicated.browsers[0].tabs.push({ tabId: 'other-tab', url: sourceUrl });
  const { api, calls } = adapter({ async inventory() { return duplicated; } });
  const selectedWithoutOriginal = await recoverSourceBrowser(input(), api);
  assert.equal(selectedWithoutOriginal.code, 'ready'); assert.deepEqual(selectedWithoutOriginal.binding, binding);
  assert.deepEqual(calls, ['bind:live-tab', 'url:live-tab', 'dom:live-tab']);
  const selected = await recoverSourceBrowser({ ...input(), initialBinding: binding, failure: { scope: 'source-read', error: 'browser transport disconnected' } }, api);
  assert.equal(selected.status, 'ready'); assert.deepEqual(selected.binding, binding);
});

test('automatic source opening runs once after existing-tab recovery and verifies the selected document', async () => {
  const opened = { browserId: 'owned-browser', tabId: 'owned-source' };
  let openCalls = 0;
  const { api } = adapter({
    async inventory() { return { browsers: [] }; },
    async openCandidates(url, options) { openCalls++; assert.equal(url, sourceUrl); assert.equal(options.maxCandidates, 3); assert.equal(options.staggerMs, 15_000); return opened; },
  });
  const result = await recoverSourceBrowser({ ...input(), autoOpen: true }, api);
  assert.equal(result.code, 'ready'); assert.deepEqual(result.binding, opened); assert.equal(openCalls, 1);
});

test('a failed automatic open reports a tool/site fault without demanding another user-open attempt', async () => {
  const { api } = adapter({ async inventory() { return { browsers: [] }; }, async openCandidates() { throw Error('browser tool has no tab creation capability'); } });
  const result = await recoverSourceBrowser({ ...input(), autoOpen: true }, api);
  assert.equal(result.code, 'automatic-open-unavailable'); assert.equal(result.userHelpRequired, false);
});

test('loading waits once, then normal read proceeds; login/challenge explicitly requires help', async () => {
  let reads = 0;
  const { api } = adapter({ async readDom() { return { actualUrl: sourceUrl, readyState: ++reads === 1 ? 'loading' : 'complete', bodyPresent: reads > 1, access: 'normal' }; } });
  const loaded = await recoverSourceBrowser(input(), api);
  assert.equal(loaded.status, 'ready'); assert.equal(loaded.metrics.domProbes, 2); assert.equal(loaded.metrics.backoffMs, 2000);
  for (const access of ['login', 'challenge', 'permission-required'] as const) {
    api.readDom = async () => ({ actualUrl: sourceUrl, readyState: 'complete', bodyPresent: true, access });
    assert.equal((await recoverSourceBrowser(input(), api)).code, 'source-access-required');
  }
});

test('URL changes stop acquisition rather than navigating or using a different source', async () => {
  const { api } = adapter({ async readUrl() { return { actualUrl: 'https://example.com/unexpected/' }; } });
  const result = await recoverSourceBrowser(input(), api);
  assert.equal(result.code, 'source-url-changed'); assert.equal(result.userHelpRequired, false); assert.equal(result.metrics.domProbes, 0);
});

test('oversize, capture timeout, runtime fault and unknown write result never ask for browser reconnection', async () => {
  for (const [scope, error, code] of [
    ['source-read', 'message too large', 'reduce-request'],
    ['source-capture', 'screenshot transaction timed out after 60000ms', 'resume-bounded-capture'],
    ['source-read', 'Uint8Array is not a constructor', 'inspect-tool-runtime'],
    ['target-write', 'network timeout after save request', 'reconcile-target-write'],
    ['source-read', 'unclassified implementation fault', 'inspect-read-failure'],
  ] as const) {
    const { api, calls } = adapter();
    const result = await recoverSourceBrowser({ ...input(), failure: { scope, error } }, api);
    assert.equal(result.code, code); assert.equal(result.userHelpRequired, false); assert.deepEqual(calls, []);
    assert.equal(browserRecoveryFailureAction(scope, error), code);
  }
  const { api, calls } = adapter();
  assert.equal((await recoverSourceBrowser({ ...input(), nextRequestUtf8Bytes: 32769 }, api)).code, 'reduce-request');
  assert.deepEqual(calls, []);
});

test('capture segments may resume only after exact document, style, geometry, viewport and interaction state identity readback', () => {
  const identity = { documentSha256: 'a'.repeat(64), styleSha256: 'b'.repeat(64), geometrySha256: 'c'.repeat(64), stateSha256: 'd'.repeat(64), viewport: { width: 1920, height: 1080, clientWidth: 1905 } };
  assert.equal(canResumeBrowserCapture(identity, structuredClone(identity)), true);
  for (const field of ['documentSha256', 'styleSha256', 'geometrySha256', 'stateSha256'] as const) {
    assert.equal(canResumeBrowserCapture(identity, { ...identity, [field]: 'e'.repeat(64) }), false);
  }
  assert.equal(canResumeBrowserCapture(identity, { ...identity, viewport: { ...identity.viewport, clientWidth: 1920 } }), false);
  assert.equal(canResumeBrowserCapture(identity, {}), false);
});

test('replay rejects invented events and mismatched bindings, and CLI drives the same state machine without echoing raw errors', async () => {
  assert.throws(() => nextBrowserRecoveryAction({ ...input(), events: [{ kind: 'url', binding, result: { outcome: 'ok', actualUrl: sourceUrl } }] }), /browser_recovery_event_mismatch/);
  assert.throws(() => nextBrowserRecoveryAction({ ...input(), initialBinding: binding, events: [{ kind: 'url', binding: { ...binding, tabId: 'wrong' }, result: { outcome: 'ok', actualUrl: sourceUrl } }] }), /browser_recovery_binding_mismatch/);
  let output = '';
  const payload = { ...input(), failure: { scope: 'tool-runtime', error: 'Uint8Array is not a constructor Authorization: Secret' } };
  const code = await browserPreflightMain(['--recover', '--stdin'], process.cwd(), { stdin: (async function* () { yield JSON.stringify(payload); })(), write(value) { output += value; } });
  assert.equal(code, 2); assert.equal(JSON.parse(output).code, 'inspect-tool-runtime'); assert.equal(output.includes('Secret'), false);
});
