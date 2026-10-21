import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadReusableEditorCheckpoint, type EditorCheckpointOptions, type StyleRevisionEditorReceipt } from '../src/fidelity/editor-checkpoint.js';

const originalHash = 'a'.repeat(64), nextHash = 'b'.repeat(64), rootIds = ['1111111', '2222222'];
const complete = { changed: true, saved: true, readbackConfirmed: true, frontendConfirmed: true, restored: true };
function sourceReport(): any {
  return { version: 1, workflow: 'block-replication', passed: false, status: 'needs-review', restoredHash: originalHash,
    nativeDocument: { passed: true, readbackHash: originalHash, rootOrder: [...rootIds], uniqueOwners: 12, mappedOwners: 12, duplicateNativeIDs: [] },
    editorSections: { version: 1, passed: true, readOnly: true, sections: rootIds.map(targetId => ({ key: `key-${targetId}`, targetId, panelModelId: targetId, selected: true, panelLoaded: true, nativeContainer: true, controls: ['container_type'] })), issues: [] },
    editability: { status: 'verified', requiredFields: ['title', 'image', 'style'], verifiedFields: ['title', 'image', 'style'], checks: ['title', 'image', 'style'].map(field => ({ sourceId: `${field}-widget`, field, selected: true, changed: true, saved: true, frontendConfirmed: true, restored: true })), issues: [], screenshots: ['original-ui.png'] },
    carouselEditor: { version: 1, passed: true, restoredHash: originalHash, panels: [{ key: 'slider', targetId: '3333333', selected: true, nativeWidget: true, controls: ['slides_to_show'], repeaterRows: 3, expectedRows: 3 }], check: { ...complete, key: 'slider', targetId: '3333333', setting: 'slides_to_show' }, issues: [] },
    catalogQueryEditor: { version: 1, passed: true, restoredHash: originalHash, panels: [{ key: 'products', targetId: '4444444', selected: true, nativeWidget: true, queryControls: ['post_type'], layoutControls: ['items_per_page'] }], check: { ...complete, key: 'products', targetId: '4444444', setting: 'items_per_page', beforeCount: 11, afterCount: 12, restoredCount: 11 }, issues: [] },
    runtime: { startedAt: '2026-10-14T04:00:00.000Z', phases: [{ name: 'native-content-save-and-restore', status: 'completed', finishedAt: '2026-10-14T04:02:00.000Z' }, { name: 'final-frontend-capture', status: 'completed', finishedAt: '2026-10-14T04:03:00.000Z' }] } };
}
async function fixture(t: TestContext) {
  const cache = 'D:/cloneWP/.cache'; await mkdir(cache, { recursive: true });
  const workspace = await mkdtemp(path.join(cache, 'test-editor-checkpoint-')), runId = 'owned-current-run', runDir = path.join(workspace, 'runs', runId), sourceReportPath = path.join(runDir, 'verification', 'final.json');
  await mkdir(path.dirname(sourceReportPath), { recursive: true });
  await writeFile(path.join(runDir, 'result.json'), JSON.stringify({ runId, runDir, pageId: 71 }));
  const report = sourceReport(); await writeFile(sourceReportPath, JSON.stringify(report));
  const styleRevisionReceipt: StyleRevisionEditorReceipt = { version: 1, runDir, runId, pageId: 71, beforeHash: originalHash, afterHash: nextHash, assertStyleRevisionPassed: true, unchanged: { nativeTree: true, productQueries: true, staticContent: true, media: true, sourceContract: true, assetsManifest: true } };
  const options: EditorCheckpointOptions = { sourceReportPath, expectedBeforeHash: originalHash, afterHash: nextHash, rootIds: [...rootIds], nativeOwnerCount: 12, styleRevisionReceipt };
  t.after(async () => { const target = path.resolve(workspace), relative = path.relative(path.resolve(cache), target); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Test cleanup escaped workspace cache'); await rm(target, { recursive: true, force: true }); });
  return { options, report, runDir, sourceReportPath, write: async (value: any) => writeFile(sourceReportPath, JSON.stringify(value)) };
}

test('same-run pure-style checkpoint preserves the four original reports and clearly scopes historical proof', async t => {
  const f = await fixture(t), result = await loadReusableEditorCheckpoint(f.options);
  for (const key of ['editorSections', 'editability', 'carouselEditor', 'catalogQueryEditor'] as const) assert.deepEqual(result[key], f.report[key]);
  assert.equal(result.reuse.sourceReportSha256, createHash('sha256').update(await readFile(f.sourceReportPath)).digest('hex'));
  assert.equal(result.reuse.sourceDocumentHash, originalHash); assert.equal(result.reuse.targetDocumentHash, nextHash);
  assert.equal(result.reuse.currentRevisionUITested, false);
  assert.equal(result.reuse.originalVerificationTime.startedAt, '2026-10-14T04:00:00.000Z');
  assert.equal(result.reuse.originalVerificationTime.finishedAt, '2026-10-14T04:03:00.000Z');
  assert.ok(result.reuse.excludes.includes('Whole-task completion'));
  assert.equal(f.report.passed, false, 'visual needs-review is never promoted by reusable UI proof');
  const before = result.reuse.sourceReportSha256; f.report.additionalDiagnostic = 'changed local report bytes'; await f.write(f.report);
  assert.notEqual((await loadReusableEditorCheckpoint(f.options)).reuse.sourceReportSha256, before, 'receipt hashes the actual file, not a copied claimed digest');
});

test('failed, partial, inconsistent or differently owned historical UI proof is never reusable', async t => {
  const f = await fixture(t);
  const corruptions: Array<(report: any) => void> = [
    r => { r.restoredHash = nextHash; }, r => { r.nativeDocument.readbackHash = nextHash; }, r => { r.nativeDocument.passed = false; },
    r => { r.nativeDocument.rootOrder.reverse(); }, r => { r.nativeDocument.uniqueOwners = 11; }, r => { r.nativeDocument.mappedOwners = 11; }, r => { r.nativeDocument.duplicateNativeIDs = ['1111111']; },
    r => { r.editorSections.passed = false; }, r => { r.editorSections.sections[1].selected = false; }, r => { r.editorSections.sections[1].panelModelId = '9999999'; },
    r => { r.editability.status = 'unverified'; }, r => { r.editability.verifiedFields = ['title', 'style']; }, r => { r.editability.checks = r.editability.checks.filter((c: any) => c.field !== 'image'); }, r => { r.editability.checks[0].saved = false; }, r => { r.editability.checks[2].restored = false; },
    r => { r.carouselEditor.passed = false; }, r => { r.carouselEditor.check.frontendConfirmed = false; }, r => { r.carouselEditor.restoredHash = nextHash; },
    r => { r.catalogQueryEditor.passed = false; }, r => { r.catalogQueryEditor.check.readbackConfirmed = false; }, r => { r.catalogQueryEditor.panels[0].nativeWidget = false; },
    r => { r.readOnly = true; }, r => { r.editorVisited = false; }, r => { delete r.runtime; },
  ];
  for (const edit of corruptions) { const report = sourceReport(); edit(report); await f.write(report); await assert.rejects(loadReusableEditorCheckpoint(f.options), /Editor checkpoint is not reusable/); }
});

test('every style-only invariant and exact baseline/new hash is required before reuse', async t => {
  const f = await fixture(t);
  for (const key of Object.keys(f.options.styleRevisionReceipt.unchanged)) {
    const input = structuredClone(f.options); (input.styleRevisionReceipt.unchanged as any)[key] = false;
    await assert.rejects(loadReusableEditorCheckpoint(input), /explicitly unchanged/);
  }
  for (const edit of [(input: any) => { input.styleRevisionReceipt.assertStyleRevisionPassed = false; }, (input: any) => { input.styleRevisionReceipt.beforeHash = nextHash; }, (input: any) => { input.styleRevisionReceipt.afterHash = originalHash; }, (input: any) => { input.afterHash = 'invalid'; }, (input: any) => { input.rootIds.push(input.rootIds[0]); }, (input: any) => { input.nativeOwnerCount = 13; }]) {
    const input = structuredClone(f.options); edit(input); await assert.rejects(loadReusableEditorCheckpoint(input), /Editor checkpoint is not reusable/);
  }
});

test('identical document hashes cannot borrow source proof from another run/page or a nonfinal artifact', async t => {
  const f = await fixture(t), second = await fixture(t);
  await assert.rejects(loadReusableEditorCheckpoint({ ...f.options, sourceReportPath: second.sourceReportPath }), /inside this exact owned run/);
  const wrongPage = structuredClone(f.options); wrongPage.styleRevisionReceipt.pageId = 72;
  await assert.rejects(loadReusableEditorCheckpoint(wrongPage), /another run or page/);
  const alias = path.join(f.runDir, 'verification', 'copied.json'); await writeFile(alias, JSON.stringify(sourceReport()));
  await assert.rejects(loadReusableEditorCheckpoint({ ...f.options, sourceReportPath: alias }), /verification\/final.json/);
});

test('source-proved no-carousel/no-query reports can reuse only their unchanged not-applicable scope', async t => {
  const f = await fixture(t);
  for (const key of ['carouselEditor', 'catalogQueryEditor']) { f.report[key].panels = []; delete f.report[key].check; }
  await f.write(f.report);
  const result = await loadReusableEditorCheckpoint(f.options);
  assert.deepEqual(result.carouselEditor.panels, []); assert.deepEqual(result.catalogQueryEditor.panels, []);
  assert.equal(result.reuse.currentRevisionUITested, false);
});
