import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAuthorizedEditorChanges, assertCanvasShellEvidence, assertDraftHash, capabilityFingerprint, ConcurrentDraftChangeError, mayRecoverDraft, validateContinuation, type RunResult } from '../src/core/runner.js';
import type { DraftSnapshot } from '../src/wordpress/types.js';
import { compileEditorElements } from '../src/wordpress/editor-serialization.js';
import { canvasShellCSS } from '../src/wordpress/canvas-shell.js';

const result: RunResult = { version: 1, runId: 'owned-run-01', sourceUrl: 'https://example.com/', targetUrl: 'https://target.example/', status: 'needs-review', stage: 'finished', startedAt: '2026-10-12T00:00:00Z', runDir: 'unused', pageId: 101, limitations: [] };
const guard = { runId: result.runId, pageId: 101, expectedHash: 'a'.repeat(64) };

test('finished task revalidation retains exact run, page, source, target and snapshot guard', () => {
  assert.doesNotThrow(() => validateContinuation(result, result.sourceUrl, result.targetUrl, guard));
  for (const changed of [{ runId: 'another-run' }, { pageId: 999 }, { expectedHash: 'missing' }]) {
    assert.throws(() => validateContinuation(result, result.sourceUrl, result.targetUrl, { ...guard, ...changed }));
  }
  assert.throws(() => validateContinuation({ ...result, status: 'running' }, result.sourceUrl, result.targetUrl, guard));
  assert.throws(() => validateContinuation(result, 'https://another-source.example/', result.targetUrl, guard));
  assert.throws(() => validateContinuation(result, result.sourceUrl, 'https://another-target.example/', guard));
});

test('failed task continuation requires verified restoration; running and finished tasks cannot use failed recovery', () => {
  assert.doesNotThrow(() => validateContinuation({ ...result, status: 'failed', restored: true }, result.sourceUrl, result.targetUrl));
  for (const previous of [{ ...result, status: 'failed' as const, restored: false }, { ...result, status: 'running' as const }, result]) {
    assert.throws(() => validateContinuation(previous, result.sourceUrl, result.targetUrl));
  }
});

test('failed revalidation requires an explicit recovered canonical hash', () => {
  const recovered = { ...result, status: 'failed' as const, restored: true, recoverySnapshotHash: guard.expectedHash };
  assert.doesNotThrow(() => validateContinuation(recovered, result.sourceUrl, result.targetUrl, guard));
  assert.throws(() => validateContinuation({ ...recovered, recoverySnapshotHash: 'b'.repeat(64) }, result.sourceUrl, result.targetUrl, guard));
  assert.throws(() => validateContinuation({ ...recovered, restored: false }, result.sourceUrl, result.targetUrl, guard));
});

test('native editor compilation preserves render structure and nondefaults while matching registered default serialization', () => {
  const schemas = {
    container: { type: 'container', class: 'Fixture', controls: { container_type: { type: 'select', default: 'flex' }, scroll_y: { type: 'text', default: -80 }, preserved: { type: 'select', default: 'yes', save_default: true } } },
    heading: { type: 'heading', class: 'Fixture', controls: { title: { type: 'textarea', default: '' }, text_color: { type: 'color', default: '' } } },
  };
  const original = [{ id: 'aaaaaaa', elType: 'container', isInner: false, settings: { container_type: 'flex', preserved: 'yes' }, elements: [{ id: 'bbbbbbb', elType: 'container', isInner: false, settings: { container_type: 'grid' }, elements: [{ id: 'ccccccc', elType: 'widget', widgetType: 'heading', settings: { title: 'Actual source', text_color: '#123456' }, elements: [] }] }] }];
  const compiled = compileEditorElements(original, schemas);
  assert.equal(compiled[0].isInner, false); assert.equal(compiled[0].elements[0].isInner, true);
  assert.deepEqual(compiled[0].settings, { preserved: 'yes', scroll_y: -80 });
  assert.deepEqual(compiled[0].elements[0].settings, { container_type: 'grid', scroll_y: -80 });
  assert.equal(original[0].elements[0].isInner, false, 'Raw recipe remains immutable');
  assert.deepEqual(compiled[0].elements[0].elements[0], original[0].elements[0].elements[0]);
  const before: DraftSnapshot = { pageId: 101, runId: 'owned-run-01', title: 'Page', status: 'draft', elements: original, settings: {}, hash: 'unused' };
  const current = { ...before, elements: compiled };
  assert.doesNotThrow(() => assertAuthorizedEditorChanges(before, current, [], schemas));
  for (const mutate of [(s: DraftSnapshot) => { s.elements[0].settings.scroll_y = -81; }, (s: DraftSnapshot) => { s.elements[0].settings.human_note = 'Keep'; }, (s: DraftSnapshot) => { s.elements[0].elements[0].isInner = false; }, (s: DraftSnapshot) => { s.elements[0].isInner = true; }, (s: DraftSnapshot) => { s.elements[0].elements.reverse(); s.elements[0].elements.push(s.elements[0].elements[0].elements.pop()!); }, (s: DraftSnapshot) => { s.title = 'Human title'; }]) {
    const changed = structuredClone(current); mutate(changed); assert.throws(() => assertAuthorizedEditorChanges(before, changed, [], schemas), ConcurrentDraftChangeError);
  }
});

test('Canvas shell CSS is restricted to the exact owned body and exact proven theme media rules', () => {
  const css = canvasShellCSS(101, '@media (min-width: 1025px){.wd-toolbar{display:none}}@media (max-width: 1024px){.sticky-toolbar-on{padding-bottom:55px}');
  assert.ok(css.includes('body.page-id-101 .wd-toolbar')); assert.ok(css.includes('body.page-id-101.sticky-toolbar-on'));
  assert.equal((css.match(/body\.page-id-101/g) ?? []).length, 2);
  assert.throws(() => canvasShellCSS(-1, '')); assert.throws(() => canvasShellCSS(101, '@media (max-width: 1200px){.sticky-toolbar-on{padding-bottom:55px}'));
});

test('enabled native Canvas isolation requires actual exact-page hidden toolbar and zero mobile padding evidence', () => {
  const proof = { enabled: true, pageId: 101 };
  const measurements = [{ width: 390, canvasShell: { bodyPageId: 101, visibleToolbarCount: 0, bodyPaddingBottom: '0px' } }] as never;
  assert.doesNotThrow(() => assertCanvasShellEvidence({ measurements }, proof));
  for (const canvasShell of [undefined, { bodyPageId: 102, visibleToolbarCount: 0, bodyPaddingBottom: '0px' }, { bodyPageId: 101, visibleToolbarCount: 1, bodyPaddingBottom: '0px' }, { bodyPageId: 101, visibleToolbarCount: 0, bodyPaddingBottom: '55px' }]) assert.throws(() => assertCanvasShellEvidence({ measurements: [{ width: 390, canvasShell }] as never }, proof));
  assert.doesNotThrow(() => assertCanvasShellEvidence({ measurements: [] }, { enabled: false, pageId: 101 }));
});

test('capability lock ignores recursive object ordering but detects actual version and schema changes', () => {
  const first = { versions: { elementor: '3.33.2', php: '8.0.30' }, mode: 'legacy-verified', legacySchemas: { heading: { controls: { size: { type: 'select', options: { h1: 'H1', h2: 'H2' } } } } } };
  const reordered = { mode: first.mode, legacySchemas: { heading: { controls: { size: { options: { h2: 'H2', h1: 'H1' }, type: 'select' } } } }, versions: { php: '8.0.30', elementor: '3.33.2' } };
  assert.equal(capabilityFingerprint(first), capabilityFingerprint(reordered));
  assert.notEqual(capabilityFingerprint(first), capabilityFingerprint({ ...first, versions: { ...first.versions, elementor: '3.33.3' } }));
  const changed = structuredClone(first); changed.legacySchemas.heading.controls.size.options.h2 = 'Heading 2';
  assert.notEqual(capabilityFingerprint(first), capabilityFingerprint(changed));
  const breakpointFacts = { ...first, sourceProof: { responsiveDevices: { active: ['desktop', 'tablet', 'mobile'], breakpoints: { tablet: { value: 1024, direction: 'max' }, mobile: { value: 768, direction: 'max' } } } } };
  const shifted = structuredClone(breakpointFacts); shifted.sourceProof.responsiveDevices.breakpoints.tablet.value = 1200;
  assert.notEqual(capabilityFingerprint(breakpointFacts), capabilityFingerprint(shifted));
});

test('concurrent edits categorically forbid recovery and unrelated errors recover only our exact known state', () => {
  const own = 'a'.repeat(64), changed = 'b'.repeat(64);
  assert.doesNotThrow(() => assertDraftHash(own, own));
  assert.throws(() => assertDraftHash(changed, own), ConcurrentDraftChangeError);
  assert.equal(mayRecoverDraft(new ConcurrentDraftChangeError(), own, [own]), false);
  assert.equal(mayRecoverDraft({ code: 'concurrent_document_change' }, own, [own]), false);
  assert.equal(mayRecoverDraft(new Error('Screenshot failure'), changed, [own]), false);
  assert.equal(mayRecoverDraft(new Error('Screenshot failure'), own, [own]), true);
});

test('editor restoration permits only the exact recorded content/media/style edits and preserves other human changes', () => {
  const before: DraftSnapshot = { pageId: 101, runId: 'owned-run-01', title: 'Fixture', status: 'draft', hash: 'unused', settings: { hide_title: 'yes' }, elements: [{ id: 'heading1', elType: 'widget', widgetType: 'heading', settings: { title: 'Original', title_color: '#000000' }, elements: [] }, { id: 'image001', elType: 'widget', widgetType: 'image', settings: { image: { id: 1, url: 'https://target.example/original.png' } }, elements: [] }] };
  const changed = structuredClone(before);
  changed.elements[0].settings.title = 'Owned verification marker';
  changed.elements[0].settings.title_color = 'rgb(18, 171, 125)';
  changed.elements[0].isInner = false;
  changed.elements[1].settings.image = { id: 2, url: 'https://target.example/check.png', alt: 'Library metadata' };
  const edits = [{ targetId: 'heading1', setting: 'title', value: 'Owned verification marker' }, { targetId: 'heading1', setting: 'title_color', value: '#12ab7d' }, { targetId: 'image001', setting: 'image', value: { id: 2, url: 'https://target.example/check.png' } }];
  assert.doesNotThrow(() => assertAuthorizedEditorChanges(before, changed, edits));
  const human = structuredClone(changed); human.elements[0].settings.align = 'right';
  assert.throws(() => assertAuthorizedEditorChanges(before, human, edits), ConcurrentDraftChangeError);
  const wrongMarker = structuredClone(changed); wrongMarker.elements[0].settings.title = 'Human title';
  assert.throws(() => assertAuthorizedEditorChanges(before, wrongMarker, edits), ConcurrentDraftChangeError);
  const pageChange = structuredClone(changed); pageChange.settings.hide_title = '';
  assert.throws(() => assertAuthorizedEditorChanges(before, pageChange, edits), ConcurrentDraftChangeError);
  assert.throws(() => assertAuthorizedEditorChanges(before, changed, [...edits, { targetId: 'heading1', setting: '_css_classes', value: 'unrecorded' }]), ConcurrentDraftChangeError);
});
