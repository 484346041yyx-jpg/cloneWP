import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { documentHashV2, hashV2, canonicalV2, newMutationIntentV2, reconcileMutationV2, retryReadV2, ensureDiskSpaceV2, mergeOwnedBlocksV2, assertResumeIdentityV2, proveImmutableInputExtensionV2, assertStageOrderV2, assertCompletableV2, restoreSnapshotV2, beginStageAttemptV2, finishStageAttemptV2, writeSnapshotRefV2, readSnapshotRefV2, type RuntimeJournalV2 } from '../src/replica-v2/journal.js';
import { archiveRawInputV2, saveOwnedBatchV2, desktopDependencyV2, firstFoldDependencyV2, loadReusableFirstFoldV2, loadDesktopReviewResumeV2, confirmDesktopReviewResumeV2, proveResumeInputsV2, resultFromV2, bindStageCaptureV2, resumeMutationsV2, validateAssetBytesV2, assertSafeSVGBytesV2, assertReusableNativeSchemasV2 } from '../src/replica-v2/runtime.js';
import { recordVisualReviewV2, loadValidReviewV2, persistViewportMeasurementsV2, readCheckActualV2, archiveCaptureReceiptV2, hasVerifiedViewportCoverageV2, type RequirementCheckV2 } from '../src/replica-v2/verify.js';
import { expectedEditorSnapshotV2, assertEditorDeltaV2 } from '../src/replica-v2/editor.js';
import type { DraftSnapshot, ElementorElement, LegacySchema } from '../src/wordpress/types.js';
import type { CompiledReplicaV2, ProgramV2 } from '../src/replica-v2/types.js';
import { writeJson } from '../src/core/files.js';
import { validateProgramV2 } from '../src/replica-v2/validate.js';
import { compileReplicaV2 } from '../src/replica-v2/compile.js';
import { compileEditorElements } from '../src/wordpress/editor-serialization.js';

const base = path.resolve('D:/cloneWP/.cache/replica-v2-tests');
const node = (id: string, title = ''): ElementorElement => ({ id, elType: 'container', settings: title ? { label: title } : {}, elements: [] });
const snapshot = (elements = [node('aaaaaaa')], settings = {}): DraftSnapshot => ({ pageId: 42, runId: 'owned-test', title: 'test', status: 'draft', elements, settings, hash: documentHashV2(elements, settings) });
const journal = (runDir: string, actual = snapshot()): RuntimeJournalV2 => ({ version: 2, workflow: 'block-replication', taskId: 'task', runId: actual.runId, runDir, targetUrl: 'https://example.test/', sourceUrl: 'https://source.test/', sourceFactsHash: '1'.repeat(64), componentPlanHash: '2'.repeat(64), assetsManifestHash: '3'.repeat(64), programHash: '4'.repeat(64), pageId: actual.pageId, documentHash: actual.hash, ownedBlockKeys: ['a', 'b'], ownedRootIds: ['aaaaaaa', 'bbbbbbb'], status: 'running', stage: 'desktop', stages: { desktop: { status: 'running' }, responsive: { status: 'pending' }, final: { status: 'pending' } }, mutations: [], createdAt: '', updatedAt: '', completed: false, metrics: {} });
const schemas: Record<string, LegacySchema> = { container: { type: 'container', class: 'Container', controls: { label: { type: 'text' } } } };
const compiled = (elements: ElementorElement[]): CompiledReplicaV2 => ({ composition: { elements: elements as CompiledReplicaV2['composition']['elements'], pageSettings: {} }, sections: elements.map((node, i) => ({ key: String(i), targetId: node.id, elementIds: [node.id] })), sectionIds: elements.map(node => node.id), elementMap: {}, plan: {} as any, usedTypes: ['container'], htmlProofs: [], bindings: [], queryReceipts: [] });
async function temporary(): Promise<string> { await mkdir(base, { recursive: true }); return mkdtemp(path.join(base, 'run-')); }

const rawArchiveProgram = () => ({ title: 'Original byte identity', taskId: 'raw-archive-test', version: 2, workflow: 'block-replication', sourceUrl: 'https://source.test/', sourceFacts: { sha256: '1'.repeat(64), path: 'facts.json' }, componentPlan: { sha256: '2'.repeat(64), path: 'plan.json' }, assetsManifest: { sha256: '3'.repeat(64), path: 'assets.json' }, viewports: [{ stage: 'desktop', height: 1080, width: 1920, name: 'desktop' }], blocks: [{ widgetSettings: { title: 'Hero' }, widgetType: 'heading', kind: 'native', key: 'hero' }] });

test('raw input archival preserves original byte hashes and repairs only schema-equivalent historical serialization with exact before evidence', async () => {
  const directory = await temporary();
  try {
    const original = Buffer.from(JSON.stringify(rawArchiveProgram()) + '\r\n'), digest = hashV2(original), options = { runDir: directory, kind: 'program' as const, sha256: digest, bytes: original, normalize: validateProgramV2 };
    const created = await archiveRawInputV2(options); assert.equal(created.repaired, false); assert.deepEqual(await readFile(created.path), original); assert.equal(hashV2(await readFile(created.path)), digest);
    assert.equal((await archiveRawInputV2(options)).repaired, false);
    const historical = Buffer.from(JSON.stringify(validateProgramV2(rawArchiveProgram()), null, 2) + '\n'); assert.notEqual(hashV2(historical), digest); await writeFile(created.path, historical);
    const repaired = await archiveRawInputV2(options); assert.equal(repaired.repaired, true); assert.deepEqual(await readFile(created.path), original); assert.deepEqual(await readFile(repaired.historyRef!.path), historical); assert.equal(repaired.historyRef!.sha256, hashV2(historical));
    const names = await readdir(path.join(directory, 'inputs', 'raw-cache-history')), receiptName = names.find(name => name.startsWith('program-'))!, receipt = JSON.parse(await readFile(path.join(directory, 'inputs', 'raw-cache-history', receiptName), 'utf8'));
    assert.equal(receipt.status, 'confirmed'); assert.equal(receipt.expectedRawHash, digest); assert.deepEqual(receipt.before, repaired.historyRef); assert.equal((await archiveRawInputV2(options)).repaired, false);
    for (const kind of ['component-plan', 'source-facts', 'assets-manifest'] as const) { const bytes = Buffer.from('{ "b":2, "a":1 }\n'), result = await archiveRawInputV2({ runDir: directory, kind, sha256: hashV2(bytes), bytes, normalize: value => value }); assert.deepEqual(await readFile(result.path), bytes); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('raw input archival rejects changed content, unknown schema fields and a forged original hash without replacing cached evidence', async () => {
  const directory = await temporary();
  try {
    const original = Buffer.from(JSON.stringify(rawArchiveProgram())), options = { runDir: directory, kind: 'program' as const, sha256: hashV2(original), bytes: original, normalize: validateProgramV2 }, created = await archiveRawInputV2(options);
    const changed = { ...rawArchiveProgram(), title: 'Concurrent real edit' }; await writeJson(created.path, changed); const changedBytes = await readFile(created.path); await assert.rejects(archiveRawInputV2(options), /differs from the actual/); assert.deepEqual(await readFile(created.path), changedBytes);
    await writeJson(created.path, { ...rawArchiveProgram(), unapprovedField: true }); const extraBytes = await readFile(created.path); await assert.rejects(archiveRawInputV2(options)); assert.deepEqual(await readFile(created.path), extraBytes);
    await assert.rejects(archiveRawInputV2({ ...options, bytes: Buffer.from('{}') }), /immutable hash/); assert.deepEqual(await readFile(created.path), extraBytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('raw input archival preserves an actual third-state edit that arrives between schema comparison and atomic replacement', async () => {
  const directory = await temporary();
  try {
    const original = Buffer.from(JSON.stringify(rawArchiveProgram())), digest = hashV2(original), filename = path.join(directory, 'inputs', `program-${digest}.json`); await writeJson(filename, validateProgramV2(rawArchiveProgram())); const oldBytes = await readFile(filename), concurrent = Buffer.from(JSON.stringify({ ...rawArchiveProgram(), title: 'Third state' })); let normalized = 0;
    await assert.rejects(archiveRawInputV2({ runDir: directory, kind: 'program', sha256: digest, bytes: original, normalize: value => { const parsed = validateProgramV2(value); if (++normalized === 2) writeFileSync(filename, concurrent); return parsed; } }), /changed concurrently/);
    assert.deepEqual(await readFile(filename), concurrent); assert.deepEqual(await readFile(path.join(directory, 'inputs', 'raw-cache-history', `${hashV2(oldBytes)}.json`)), oldBytes);
    const names = await readdir(path.join(directory, 'inputs', 'raw-cache-history')), receipt = JSON.parse(await readFile(path.join(directory, 'inputs', 'raw-cache-history', names.find(name => name.startsWith('program-'))!), 'utf8')); assert.equal(receipt.status, 'conflict');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('raw input repair stops before replacement if the archived previous bytes cannot be verified', async () => {
  const directory = await temporary();
  try {
    const original = Buffer.from(JSON.stringify(rawArchiveProgram())), digest = hashV2(original), filename = path.join(directory, 'inputs', `program-${digest}.json`); await writeJson(filename, validateProgramV2(rawArchiveProgram())); const before = await readFile(filename), archive = path.join(directory, 'inputs', 'raw-cache-history'); await mkdir(archive); await writeFile(path.join(archive, `${hashV2(before)}.json`), 'corrupt history');
    await assert.rejects(archiveRawInputV2({ runDir: directory, kind: 'program', sha256: digest, bytes: original, normalize: validateProgramV2 }), /previous raw input bytes changed/); assert.deepEqual(await readFile(filename), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('identical whole documents are stored once and operation references read both new and historical snapshots', async () => {
  const directory = await temporary();
  try {
    const baseline = snapshot(), first = path.join(directory, 'mutations', 'one-before.json'), second = path.join(directory, 'target', 'accepted-snapshot.json'); const reference = await writeSnapshotRefV2(directory, first, baseline); await writeSnapshotRefV2(directory, second, baseline);
    assert.equal((await readdir(path.join(directory, 'documents'))).length, 1); assert.equal(JSON.parse(await readFile(first, 'utf8')).kind, 'document-ref'); assert.deepEqual(await readSnapshotRefV2(directory, first), baseline); assert.deepEqual(await readSnapshotRefV2(directory, second), baseline);
    const legacy = path.join(directory, 'old-before.json'); await writeJson(legacy, baseline); const original = await readFile(legacy); assert.deepEqual(await readSnapshotRefV2(directory, legacy), baseline); assert.deepEqual(await readFile(legacy), original);
    await assert.rejects(writeSnapshotRefV2(directory, path.join(directory, 'foreign.json'), { ...baseline, pageId: 43 }), /owned identity/);
    await writeFile(reference.path, '{}'); await assert.rejects(readSnapshotRefV2(directory, first), /raw document bytes changed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('interrupted editor restoration resolves a new content-addressed reference and preserves exact document identity', async () => {
  const directory = await temporary();
  try {
    const baseline = snapshot(), modified = snapshot([node('aaaaaaa', 'temporary')]), state = journal(directory, baseline), intent = newMutationIntentV2({ kind: 'editor-test', checkpoint: 'html', pageId: baseline.pageId, runId: baseline.runId, beforeHash: baseline.hash, expectedAfterHash: modified.hash, affectedBlockKeys: ['a'] }); state.mutations.push(intent);
    await writeSnapshotRefV2(directory, path.join(directory, 'mutations', `${intent.id}-before.json`), baseline); let actual = modified, writes = 0; const client = { async snapshotDraft() { return actual; }, async restoreDraft(_id: number, before: DraftSnapshot) { writes++; actual = before; return actual; } };
    assert.equal((await resumeMutationsV2(state, client, modified)).hash, baseline.hash); assert.equal(writes, 1); assert.equal((await readdir(path.join(directory, 'documents'))).length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('stage attempts preserve failures and review waits and accumulate only measured durations across resumes', () => {
  let attempt = beginStageAttemptV2({ status: 'pending' }, 'a'.repeat(64), '2026-10-15T00:00:00.000Z'); attempt.record.error = 'lookup timed out'; attempt.record.evidence = ['failure.json']; finishStageAttemptV2(attempt.record, attempt.attemptId, 'failed', 100, 'media-7');
  attempt = beginStageAttemptV2(attempt.record, 'a'.repeat(64)); finishStageAttemptV2(attempt.record, attempt.attemptId, 'awaiting-review', 200, 'desktop-firstfold');
  attempt = beginStageAttemptV2(attempt.record, 'a'.repeat(64)); finishStageAttemptV2(attempt.record, attempt.attemptId, 'passed', 50, 'desktop');
  assert.equal(attempt.record.attempts?.length, 3); assert.equal(attempt.record.accumulatedDurationMs, 350); assert.equal(attempt.record.durationMs, 350); assert.equal(attempt.record.attempts?.[0].error, 'lookup timed out'); assert.deepEqual(attempt.record.attempts?.[0].evidence, ['failure.json']); assert.equal(attempt.record.attempts?.[1].status, 'awaiting-review'); assert.throws(() => finishStageAttemptV2(attempt.record, attempt.attemptId, 'passed', 50), /already finalized/);
  const legacy = beginStageAttemptV2({ status: 'failed', startedAt: '2026-10-14T00:00:00Z', evidence: ['historical.json'] }, 'a'.repeat(64)); finishStageAttemptV2(legacy.record, legacy.attemptId, 'passed', 12); assert.equal(legacy.record.accumulatedDurationMs, 12); assert.equal(legacy.record.timingIncomplete, true); assert.equal(legacy.record.attempts?.[0].durationMs, undefined);
});

test('viewport review accepts only an exact measured scrollbar exclusion and never fits a wrong screenshot or document', async () => {
  const directory = await temporary();
  try {
    const documentHash = 'a'.repeat(64), shot = path.join(directory, 'desktop.png'), png = await sharp({ create: { width: 1905, height: 1080, channels: 3, background: '#fff' } }).png().toBuffer(); await writeFile(shot, png);
    const program = { viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }] } as ProgramV2, checks: RequirementCheckV2[] = [{ id: 'page-health', viewport: 'desktop', kind: 'health', status: 'passed', actual: { viewport: 1920, clientWidth: 1905, scrollWidth: 1905 } }]; await persistViewportMeasurementsV2(directory, 'desktop', documentHash, checks);
    const capture: any = { documentHash, viewports: [{ name: 'desktop', width: 1920, height: 1080 }], screenshots: [{ viewport: 'desktop', path: shot, sha256: hashV2(png), width: 1905, height: 1080 }], checks };
    assert.equal(await hasVerifiedViewportCoverageV2(capture, program, 'desktop', directory), true);
    assert.equal(await hasVerifiedViewportCoverageV2({ ...capture, documentHash: 'b'.repeat(64) }, program, 'desktop', directory), false);
    assert.equal(await hasVerifiedViewportCoverageV2({ ...capture, screenshots: [{ ...capture.screenshots[0], width: 1904 }] }, program, 'desktop', directory), false);
    assert.equal(await hasVerifiedViewportCoverageV2({ ...capture, checks: [{ ...checks[0], actual: { viewport: 1919, clientWidth: 1905, scrollWidth: 1905 } }] }, program, 'desktop', directory), false);
    assert.equal(await hasVerifiedViewportCoverageV2({ ...capture, checks: [{ ...checks[0], actual: { viewport: 1920, clientWidth: 1905, scrollWidth: 1918 } }] }, program, 'desktop', directory), false);
    await writeFile(shot, await sharp({ create: { width: 1904, height: 1080, channels: 3, background: '#fff' } }).png().toBuffer()); await assert.rejects(hasVerifiedViewportCoverageV2(capture, program, 'desktop', directory), /screenshot bytes changed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('new stage attempts bind capture and finish to the actual current document without inheriting the old accepted hash', async () => {
  const directory = await temporary();
  try {
    const actual = snapshot(), state = journal(directory, actual), previousHash = 'f'.repeat(64), attempt = beginStageAttemptV2({ status: 'passed', documentHash: previousHash, evidence: ['old.json'], evidenceRefs: [{ path: 'old.json', sha256: 'a'.repeat(64) }] }, 'b'.repeat(64)); state.stages.desktop = attempt.record;
    assert.equal(attempt.record.documentHash, undefined); assert.equal(attempt.record.evidence, undefined);
    const report = path.join(directory, 'verification', 'desktop', 'capture.json'), capture: any = { version: 2, checkpoint: 'desktop', documentHash: actual.hash, programHash: state.programHash, componentPlanHash: state.componentPlanHash, sourceFactsHash: state.sourceFactsHash, automatedPassed: true, screenshots: [], checks: [] }; await writeJson(report, capture);
    await bindStageCaptureV2(state, 'desktop', capture, actual.hash); finishStageAttemptV2(attempt.record, attempt.attemptId, 'awaiting-review', 20, 'desktop'); assert.equal(attempt.record.documentHash, actual.hash); assert.equal(attempt.record.attempts?.at(-1)?.documentHash, actual.hash);
    await assert.rejects(bindStageCaptureV2(state, 'desktop', { ...capture, documentHash: previousHash }, actual.hash), /current accepted inputs and actual document/);
    await assert.rejects(bindStageCaptureV2(state, 'desktop', { ...capture, programHash: 'e'.repeat(64) }, actual.hash), /current accepted inputs/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('viewport measurements are stored once with hash references while historical inline receipts remain readable', async () => {
  const directory = await temporary();
  try {
    const actual = { text: 'unique raw measured contents', rect: { width: 1440, x: 240 } }, checks: RequirementCheckV2[] = [{ id: 'copy', viewport: 'desktop', kind: 'text', status: 'passed', actual }, { id: 'layout', viewport: 'desktop', kind: 'layout', status: 'passed', actual: structuredClone(actual) }];
    const reference = await persistViewportMeasurementsV2(directory, 'desktop', 'a'.repeat(64), checks), raw = JSON.parse(await readFile(reference.path, 'utf8'));
    assert.equal(Object.keys(raw.measurements).length, 1); assert.equal(checks.some(check => Object.hasOwn(check, 'actual')), false); assert.equal(checks[0].actualRef?.pointer, checks[1].actualRef?.pointer); assert.doesNotMatch(JSON.stringify(checks), /unique raw measured contents/); assert.deepEqual(await readCheckActualV2(checks[0], directory), actual);
    assert.deepEqual(await readCheckActualV2({ id: 'old', viewport: 'desktop', kind: 'layout', status: 'passed', actual }, directory), actual);
    await writeFile(reference.path, '{}'); await assert.rejects(readCheckActualV2(checks[0], directory), /bytes changed/);
    await assert.rejects(readCheckActualV2({ ...checks[0], actualRef: { ...checks[0].actualRef!, path: path.resolve(directory, '..', 'outside.json') } }, directory), /escaped/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('capture summaries archive exact prior bytes while immutable raw evidence stays at its original path', async () => {
  const directory = await temporary();
  try {
    const raw = path.join(directory, 'desktop.json'); await writeJson(raw, { rect: { x: 240, width: 1440 } }); const rawHash = hashV2(await readFile(raw));
    await writeJson(path.join(directory, 'capture.json'), { version: 2, automatedPassed: false, evidence: [raw] }); const captureBytes = await readFile(path.join(directory, 'capture.json')); await writeJson(path.join(directory, 'visual-review.json'), { verdict: 'failed' });
    await archiveCaptureReceiptV2(directory); const index = JSON.parse(await readFile(path.join(directory, 'history-index.json'), 'utf8')); assert.equal(index.relocations.length, 2); assert.deepEqual(await readFile(index.relocations[0].path), captureBytes); assert.equal(hashV2(await readFile(raw)), rawHash);
    const attempt = path.join(directory, 'captures', 'new-attempt'); await mkdir(attempt, { recursive: true }); const current = { version: 2, automatedPassed: true, reportPath: path.join(attempt, 'capture.json'), evidence: [raw] }; await writeJson(current.reportPath, current); await writeJson(path.join(directory, 'capture.json'), current); await writeJson(path.join(directory, 'visual-review.json'), { verdict: 'passed' });
    await archiveCaptureReceiptV2(directory); assert.deepEqual(JSON.parse(await readFile(current.reportPath, 'utf8')), current); assert.equal(JSON.parse(await readFile(path.join(attempt, 'visual-review.json'), 'utf8')).verdict, 'passed'); assert.equal(hashV2(await readFile(raw)), rawHash);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('native registry resume reconciles only the proven inactive generated synchronization default', () => {
  const schema = (value: string): Record<string, LegacySchema> => ({ wd_products: { type: 'wd_products', class: 'XTS\\Elementor\\Products', controls: { layout: { type: 'select', default: 'grid', options: { grid: 'Grid', carousel: 'Carousel' } }, carousel_sync: { type: 'select', default: '', options: { '': 'Disabled', parent: 'Parent', child: 'Child' } }, sync_parent_id: { type: 'text', label: 'ID', default: value, condition: { layout: 'carousel', carousel_sync: ['parent'] } } } } });
  const previous = schema('wd_6ad05e6c8dee7'), current = schema('wd_6ad061d780834'), program = { blocks: [{ key: 'products', kind: 'native-products', widgetType: 'wd_products', widgetSettings: { layout: 'carousel' }, query: { count: 2, evidence: [] } }] } as unknown as ProgramV2;
  assert.equal(assertReusableNativeSchemasV2(previous, current, program).length, 1);
  for (const mutate of [(value: typeof current) => { value.wd_products.controls.layout.options!.grid = 'Changed'; }, (value: typeof current) => { value.wd_products.controls.sync_parent_id.type = 'hidden'; }, (value: typeof current) => { value.wd_products.controls.sync_parent_id.default = 'arbitrary'; }, (value: typeof current) => { value.wd_products.controls.sync_parent_id.condition = { layout: 'carousel' }; }]) { const changed = structuredClone(current); mutate(changed); assert.throws(() => assertReusableNativeSchemasV2(previous, changed, program), /controls changed/); }
  const active = structuredClone(program); (active.blocks[0] as any).widgetSettings.carousel_sync = 'parent'; assert.throws(() => assertReusableNativeSchemasV2(previous, current, active), /controls changed/);
});

test('same owned product node retains its inactive serialized default across a changed surrounding block tree', async () => {
  const directory = await temporary();
  try {
    const product: ElementorElement = { id: 'ccccccc', elType: 'widget', widgetType: 'wd_products', settings: { layout: 'carousel', sync_parent_id: 'wd_6ad05e6c8dee7' }, elements: [] }, root = node('aaaaaaa'); root.elements = [product]; const before = snapshot([root]);
    const registry = { ...schemas, wd_products: { type: 'wd_products', class: 'Products', controls: { layout: { type: 'select', default: 'grid', options: { grid: '', carousel: '' } }, carousel_sync: { type: 'select', default: '', options: { '': '', parent: '' } }, sync_parent_id: { type: 'text', default: 'wd_6ad061d780834', condition: { layout: 'carousel', carousel_sync: ['parent'] } } } } };
    const authored = structuredClone(root); delete authored.elements[0].settings.sync_parent_id; authored.elements.push(node('ddddddd')); let actual = before, saves = 0;
    const client = { snapshotDraft: async () => actual, buildDraft: async (_id: number, composition: any) => { saves++; actual = snapshot(composition.elements, composition.pageSettings); return actual; } };
    const after = await saveOwnedBatchV2({ client, snapshot: before, compiled: compiled([authored]), schemas: registry, journal: journal(directory, before), checkpoint: 'responsive' }); assert.equal(after.elements[0].elements[0].settings.sync_parent_id, 'wd_6ad05e6c8dee7'); assert.equal(saves, 1);
    await saveOwnedBatchV2({ client, snapshot: after, compiled: compiled([authored]), schemas: registry, journal: journal(directory, after), checkpoint: 'responsive' }); assert.equal(saves, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('v2 journal reconciles response loss by after/before/third state without retrying a write', () => {
  const before = snapshot(), after = snapshot([node('aaaaaaa', 'changed')]), third = snapshot([node('aaaaaaa', 'human')]);
  const intent = () => newMutationIntentV2({ kind: 'document-save', checkpoint: 'desktop', pageId: 42, runId: before.runId, beforeHash: before.hash, expectedAfterHash: after.hash, affectedBlockKeys: ['a'] });
  assert.equal(reconcileMutationV2(intent(), after), 'confirmed'); assert.equal(reconcileMutationV2(intent(), before), 'retryable'); assert.equal(reconcileMutationV2(intent(), third), 'conflict');
  assert.throws(() => reconcileMutationV2(intent(), { ...after, runId: 'foreign' }), /owned/);
});
test('read-only transient errors retry at most twice; definite conflicts are never retried', async () => {
  let attempts = 0; assert.equal(await retryReadV2(async () => { if (++attempts < 3) throw Error('invalid JSON response'); return 7; }), 7); assert.equal(attempts, 3);
  attempts = 0; await assert.rejects(retryReadV2(async () => { attempts++; throw Error('concurrent_document_change'); }), /concurrent/); assert.equal(attempts, 1);
});
test('disk preflight rejects less than 512 MiB before any mutation', async () => {
  await assert.rejects(ensureDiskSpaceV2(base, undefined, (async () => ({ bavail: 1, bsize: 4096 })) as any), /512|536870912/);
  assert.equal(await ensureDiskSpaceV2(base, undefined, (async () => ({ bavail: 200000, bsize: 4096 })) as any), 819200000);
});
test('owned block reconstruction replaces its full internal tree while preserving unrelated actual roots', () => {
  const original = [node('foreign', 'user'), node('aaaaaaa', 'old'), node('bbbbbbb', 'keep')], replacement = { ...node('aaaaaaa', 'new'), elements: [node('ccccccc')] };
  const merged = mergeOwnedBlocksV2(original, [replacement], ['aaaaaaa', 'bbbbbbb'], ['aaaaaaa']);
  assert.equal(merged[0].settings.label, 'user'); assert.equal(merged[1].elements[0].id, 'ccccccc'); assert.equal(merged[2].settings.label, 'keep'); assert.throws(() => mergeOwnedBlocksV2(original, [node('foreign')], ['aaaaaaa']), /foreign/);
});
test('desktop failures cannot start responsive or editor work, and pending restore blocks completion', () => {
  const state = journal(base); assert.throws(() => assertStageOrderV2(state, 'responsive'), /pass in order/); assert.throws(() => assertStageOrderV2(state, 'final'), /pass in order/);
  state.stages.desktop.status = 'passed'; assert.doesNotThrow(() => assertStageOrderV2(state, 'responsive')); assert.throws(() => assertStageOrderV2(state, 'final'), /pass in order/);
  state.stages.responsive.status = 'passed'; state.stages.final.status = 'passed'; state.mutations.push(newMutationIntentV2({ kind: 'editor-test', checkpoint: 'html', pageId: 42, runId: state.runId, beforeHash: '1'.repeat(64), expectedAfterHash: '2'.repeat(64), affectedBlockKeys: ['a'] })); assert.throws(() => assertCompletableV2(state), /unfinished/);
});
test('resume checks source, environment, owned page and actual document identity', () => {
  const state = journal(base), identity = { taskId: state.taskId, sourceUrl: state.sourceUrl, targetUrl: state.targetUrl, sourceFactsHash: state.sourceFactsHash, assetsManifestHash: state.assetsManifestHash };
  assert.doesNotThrow(() => assertResumeIdentityV2(state, identity, snapshot())); assert.throws(() => assertResumeIdentityV2(state, { ...identity, taskId: 'other' }), /identity/); assert.throws(() => assertResumeIdentityV2(state, identity, snapshot([node('aaaaaaa', 'human')])), /concurrent/);
});
test('one batch writes the complete owned stage once; a repeated exact checkpoint makes no save', async () => {
  const directory = await temporary(); try {
    let actual = snapshot(), writes = 0; const state = journal(directory, actual), client = { async snapshotDraft() { return structuredClone(actual); }, async buildDraft(_id: number, composition: any) { writes++; actual = snapshot(composition.elements, composition.pageSettings); return actual; } };
    const desired = compiled([node('aaaaaaa', 'first'), node('bbbbbbb', 'second')]); const saved = await saveOwnedBatchV2({ client, snapshot: actual, compiled: desired, schemas, journal: state, checkpoint: 'desktop' }); assert.equal(writes, 1); assert.equal(saved.elements.length, 2);
    await saveOwnedBatchV2({ client, snapshot: saved, compiled: desired, schemas, journal: state, checkpoint: 'desktop' }); assert.equal(writes, 1); assert.equal(state.mutations.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('save response loss after successful write is confirmed from actual state with no duplicate write', async () => {
  const directory = await temporary(); try {
    let actual = snapshot(), writes = 0; const state = journal(directory, actual), client = { async snapshotDraft() { return structuredClone(actual); }, async buildDraft(_id: number, composition: any) { writes++; actual = snapshot(composition.elements, composition.pageSettings); throw Error('network timeout'); } };
    const saved = await saveOwnedBatchV2({ client, snapshot: actual, compiled: compiled([node('aaaaaaa', 'new')]), schemas, journal: state, checkpoint: 'desktop' }); assert.equal(writes, 1); assert.equal(saved.hash, actual.hash); assert.equal(state.mutations[0].status, 'confirmed');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('failed write with unchanged before state is retryable, and third-state content is preserved', async () => {
  const directory = await temporary(); try {
    for (const mutate of [false, true]) { let actual = snapshot(), writes = 0; const state = journal(directory, actual), client = { async snapshotDraft() { return structuredClone(actual); }, async buildDraft() { writes++; if (mutate) actual = snapshot([node('aaaaaaa', 'human')]); throw Error('network timeout'); } }; await assert.rejects(saveOwnedBatchV2({ client, snapshot: actual, compiled: compiled([node('aaaaaaa', 'new')]), schemas, journal: state, checkpoint: 'desktop' }), /network/); assert.equal(writes, 1); assert.equal(state.mutations[0].status, mutate ? 'conflict' : 'retryable'); if (mutate) assert.equal(actual.elements[0].settings.label, 'human'); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('unwritable mutation intent prevents the target write from starting', async () => {
  const directory = await temporary(); try { const blocked = path.join(directory, 'file'); await writeFile(blocked, 'occupied'); let writes = 0; const before = snapshot(), client = { async snapshotDraft() { return before; }, async buildDraft() { writes++; return before; } }; await assert.rejects(saveOwnedBatchV2({ client, snapshot: before, compiled: compiled([node('aaaaaaa', 'new')]), schemas, journal: journal(blocked), checkpoint: 'desktop' })); assert.equal(writes, 0); } finally { await rm(directory, { recursive: true, force: true }); }
});
test('Codex visual review is bound to exact document, capture bytes and screenshot bytes', async () => {
  const directory = await temporary(); try {
    const target = path.join(directory, 'verification', 'desktop'); await mkdir(target, { recursive: true }); const shot = path.join(target, 'desktop.png'); await writeFile(shot, 'actual screenshot bytes'); const documentHash = '1'.repeat(64);
    const capture = { version: 2, checkpoint: 'desktop', documentHash, programHash: '2'.repeat(64), componentPlanHash: '3'.repeat(64), sourceFactsHash: '4'.repeat(64), automatedPassed: true, screenshots: [{ path: shot, sha256: hashV2(await readFile(shot)) }] }; await writeJson(path.join(target, 'capture.json'), capture);
    await recordVisualReviewV2(directory, { checkpoint: 'desktop', documentHash, verdict: 'passed', notes: 'Inspected geometry and background from the exact screenshot.', reviewer: 'codex' }); assert.equal((await loadValidReviewV2(directory, 'desktop', documentHash))?.verdict, 'passed'); assert.equal(await loadValidReviewV2(directory, 'desktop', '9'.repeat(64)), undefined);
    await writeFile(shot, 'changed'); assert.equal(await loadValidReviewV2(directory, 'desktop', documentHash), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('automated failures cannot be converted into a passing visual judgment', async () => {
  const directory = await temporary(); try { const target = path.join(directory, 'verification', 'desktop'); await mkdir(target, { recursive: true }); await writeJson(path.join(target, 'capture.json'), { version: 2, checkpoint: 'desktop', documentHash: '1'.repeat(64), automatedPassed: false, screenshots: [{ path: 'unused', sha256: '1'.repeat(64) }] }); await assert.rejects(recordVisualReviewV2(directory, { checkpoint: 'desktop', documentHash: '1'.repeat(64), verdict: 'passed', notes: 'Cannot pass', reviewer: 'codex' }), /unresolved automated/); } finally { await rm(directory, { recursive: true, force: true }); }
});
test('desktop review acknowledgement requires sealed capability and screenshot evidence and only one guarded document/proof read', async () => {
  const directory = await temporary();
  try {
    const actual = snapshot(), state = journal(directory, actual), sourceProof = Object.fromEntries(['save', 'get_elements_data', 'responsiveRegistration', 'responsiveCSSExpansion'].map(key => [key, { sha256: 'e'.repeat(64), source: `Actual ${key} source` }]));
    const proof = { version: 1 as const, sha256: 'f'.repeat(64), types: ['container', 'heading'] }, capabilities = { mode: 'legacy-verified', versions: { elementor: '3.33.2' }, sourceProof, legacySchemas: { ...schemas, heading: { type: 'heading', class: 'Heading', controls: { title: { type: 'text' } } } }, checkpointProof: proof }, lockBytes = Buffer.from(JSON.stringify({ mode: 'legacy-verified', versions: capabilities.versions }));
    state.environmentHash = hashV2(canonicalV2({ mode: capabilities.mode, versions: capabilities.versions, sourceProof })); state.status = 'awaiting-review'; state.checkpoint = 'desktop'; state.capabilityProbe = { status: 'passed', dependencyHash: 'a'.repeat(64), baselineHash: actual.hash };
    const input = { program: { version: 2, workflow: 'block-replication', taskId: state.taskId, title: 'Review acknowledgement', sourceUrl: state.sourceUrl, sourceFacts: { path: 'facts.json', sha256: state.sourceFactsHash }, componentPlan: { path: 'plan.json', sha256: state.componentPlanHash }, assetsManifest: { path: 'assets.json', sha256: state.assetsManifestHash }, viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }], blocks: [{ key: 'hero', kind: 'native', widgetType: 'heading', widgetSettings: { title: 'Hero' } }] } as ProgramV2, programHash: state.programHash, componentPlanHash: state.componentPlanHash, sourceFactsHash: state.sourceFactsHash, assetsManifestHash: state.assetsManifestHash };
    const target = path.join(directory, 'verification', 'desktop'), shot = path.join(target, 'desktop.png'), capabilityPath = path.join(directory, 'target', 'sealed-capabilities.json'); await mkdir(target, { recursive: true }); await writeFile(shot, 'exact reviewed screenshot'); await writeJson(capabilityPath, capabilities);
    const capture: any = { version: 2, checkpoint: 'desktop', documentHash: actual.hash, programHash: input.programHash, componentPlanHash: input.componentPlanHash, sourceFactsHash: input.sourceFactsHash, automatedPassed: true, viewports: input.program.viewports, screenshots: [{ viewport: 'desktop', path: shot, sha256: hashV2(await readFile(shot)), width: 1920, height: 1080 }], checks: [{ id: 'page-health', kind: 'health', viewport: 'desktop', status: 'passed' }], reviewResume: { version: 1, environmentHash: state.environmentHash, environmentLockHash: hashV2(lockBytes), assetsManifestHash: input.assetsManifestHash, checkpointProof: proof, capabilitiesRef: { path: capabilityPath, sha256: hashV2(await readFile(capabilityPath)) } } }; await writeJson(path.join(target, 'capture.json'), capture);
    assert.equal(await loadDesktopReviewResumeV2(input, state, lockBytes), undefined, 'Automation cannot grant the visual review'); await recordVisualReviewV2(directory, { checkpoint: 'desktop', documentHash: actual.hash, reviewer: 'codex', verdict: 'passed', notes: 'Inspected exact complete desktop.' });
    const candidate = await loadDesktopReviewResumeV2(input, state, lockBytes); assert.ok(candidate); let reads = 0; const client = { async readOwnedReviewCheckpoint() { reads++; return { snapshot: actual, proof }; } };
    assert.equal((await confirmDesktopReviewResumeV2({ input, journal: state, candidate, client, desktopDependencyHash: 'a'.repeat(64) })).hash, actual.hash); assert.equal(reads, 1); assert.equal(state.completed, false); assert.equal(state.metrics.captures, undefined);
    await assert.rejects(confirmDesktopReviewResumeV2({ input, journal: state, candidate, desktopDependencyHash: 'a'.repeat(64), client: { async readOwnedReviewCheckpoint() { return { snapshot: actual, proof: { ...proof, sha256: 'b'.repeat(64) } }; } } }), /changed after stage capture/);
    await assert.rejects(confirmDesktopReviewResumeV2({ input, journal: state, candidate, desktopDependencyHash: 'a'.repeat(64), client: { async readOwnedReviewCheckpoint() { return { snapshot: snapshot([node('aaaaaaa', 'human')]), proof }; } } }), /changed since/);
    assert.equal(await loadDesktopReviewResumeV2({ ...input, programHash: '9'.repeat(64) }, state, lockBytes), undefined); assert.equal(await loadDesktopReviewResumeV2(input, state, Buffer.from('changed lock')), undefined);
    state.mutations.push(newMutationIntentV2({ kind: 'restore', checkpoint: 'test', pageId: actual.pageId, runId: actual.runId, beforeHash: actual.hash, expectedAfterHash: actual.hash, affectedBlockKeys: [] })); assert.equal(await loadDesktopReviewResumeV2(input, state, lockBytes), undefined); state.mutations = [];
    delete capture.reviewResume; await writeJson(path.join(target, 'capture.json'), capture); assert.equal(await loadDesktopReviewResumeV2(input, state, lockBytes), undefined, 'Historical evidence is not upgraded or granted a new environment seal');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('temporary editor change accepts exactly registered fields and refuses concurrent edits', () => {
  const before = snapshot(), expected = expectedEditorSnapshotV2(before, [{ id: 'aaaaaaa', setting: 'label', value: 'test' }], schemas); assert.doesNotThrow(() => assertEditorDeltaV2(expected, expected)); const human = snapshot([node('aaaaaaa', 'human')]); assert.throws(() => assertEditorDeltaV2(human, expected), /concurrent/); assert.throws(() => expectedEditorSnapshotV2(before, [{ id: 'aaaaaaa', setting: 'unregistered', value: 1 }], schemas), /registered/);
});
test('desktop dependency survives appended responsive evidence, assets and variants but rejects a desktop design change', () => {
  const input: any = { program: { taskId: 'task', title: 'Replica', sourceUrl: 'https://source.test/', blocks: [{ key: 'hero', kind: 'html-static', template: '<h2 data-cwp-text="title"></h2>', css: ':scope{display:block}', slots: { text: { title: 'Hello' }, media: {}, links: {} } }], viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }] }, sourceFacts: { snapshots: [{ id: 'desktop-1', viewport: { name: 'desktop', width: 1920, height: 1080 }, screenshot: { sha256: '1'.repeat(64) }, evidence: [{ sha256: '2'.repeat(64) }] }], facts: { text: { id: 'text', snapshotId: 'desktop-1', evidence: { sha256: '2'.repeat(64) }, value: { text: 'Hello' } } }, gaps: [] }, componentPlan: { desktopSnapshotId: 'desktop-1', components: [{ id: 'hero', variants: [{ snapshotId: 'desktop-1', nodeIds: ['hero'] }] }], requirements: [{ id: 'text', factIds: ['text'], componentId: 'hero', verification: { kind: 'text', expected: 'Hello' } }] }, manifest: { assets: [] } };
  const original = desktopDependencyV2(input), next = structuredClone(input); next.program.blocks[0].responsiveCss = ':scope{color:blue}'; next.program.viewports.push({ name: 'mobile', width: 390, height: 844, stage: 'responsive' }); next.sourceFacts.snapshots.push({ id: 'mobile-1', viewport: { name: 'mobile' }, screenshot: { sha256: '3'.repeat(64) }, evidence: [{ sha256: '4'.repeat(64) }] }); next.sourceFacts.facts.mobile = { id: 'mobile', snapshotId: 'mobile-1', evidence: { sha256: '4'.repeat(64) }, value: { text: 'Hello Mobile' } }; next.componentPlan.components[0].variants.push({ snapshotId: 'mobile-1', nodeIds: ['hero-mobile'] }); next.componentPlan.requirements.push({ id: 'mobile-text', factIds: ['mobile'], componentId: 'hero', verification: { kind: 'text', expected: 'Hello Mobile', viewport: 'mobile' } }); next.manifest.assets.push({ key: 'mobile-only', sha256: '5'.repeat(64) }); assert.equal(desktopDependencyV2(next), original);
  next.program.blocks[0].css = ':scope{display:flex}'; assert.notEqual(desktopDependencyV2(next), original);
});
test('first-fold reuse survives only lower-root edits and requires the actual sealed reviewed subtree, exact plan, source and assets', async () => {
  const directory = await temporary();
  try {
    const sourceHash = '1'.repeat(64), planHash = '2'.repeat(64), manifestHash = '3'.repeat(64), priorProgramHash = '4'.repeat(64), ref = (sha256: string) => ({ path: 'frozen.json', sha256 });
    const html = (key: string, text: string) => ({ key, kind: 'html-static', template: '<div data-cwp-text="copy"></div>', css: ':scope{color:#333}', slots: { text: { copy: text }, media: {}, links: {} } });
    const program = validateProgramV2({ version: 2, workflow: 'block-replication', taskId: 'reuse-test', title: 'Reuse test', sourceUrl: 'https://source.test/', sourceFacts: ref(sourceHash), componentPlan: ref(planHash), assetsManifest: ref(manifestHash), viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }], blocks: [html('hero', 'First fold'), html('footer', 'Lower body')] });
    const plan: any = { sourceFacts: ref(sourceHash), desktopSnapshotId: 'desktop-1', components: [{ id: 'hero', parentId: null, firstFold: true }, { id: 'footer', parentId: null }], requirements: [{ id: 'hero-text', componentId: 'hero', verification: { kind: 'text', expected: 'First fold' } }, { id: 'footer-text', componentId: 'footer', verification: { kind: 'text', expected: 'Lower body' } }] };
    const registry: Record<string, LegacySchema> = { container: { type: 'container', class: 'Container', controls: { content_width: { type: 'select', options: { full: 'Full' } } } }, html: { type: 'html', class: 'HTML', controls: { html: { type: 'code' } } } };
    const first = compileReplicaV2({ ...program, blocks: program.blocks.slice(0, 1) }, registry, []), full = compileReplicaV2(program, registry, []), sealed = snapshot(compileEditorElements(first.composition.elements, registry), first.composition.pageSettings), current = snapshot(compileEditorElements(full.composition.elements, registry), full.composition.pageSettings), state = journal(directory, current);
    const input = { program, componentPlan: plan, programHash: priorProgramHash, componentPlanHash: planHash, sourceFactsHash: sourceHash, assetsManifestHash: manifestHash };
    const captureDirectory = path.join(directory, 'verification', 'desktop-firstfold'), shot = path.join(captureDirectory, 'desktop.png'); await mkdir(captureDirectory, { recursive: true }); await writeFile(shot, 'real recorded screenshot bytes');
    await writeJson(path.join(captureDirectory, 'capture.json'), { version: 2, checkpoint: 'desktop-firstfold', automatedPassed: true, documentHash: sealed.hash, programHash: priorProgramHash, componentPlanHash: planHash, sourceFactsHash: sourceHash, viewports: program.viewports, screenshots: [{ viewport: 'desktop', path: shot, sha256: hashV2(await readFile(shot)), width: 1920, height: 1080 }], checks: [{ id: 'page-health', viewport: 'desktop', kind: 'health', status: 'passed' }] });
    await recordVisualReviewV2(directory, { checkpoint: 'desktop-firstfold', documentHash: sealed.hash, reviewer: 'codex', verdict: 'passed', notes: 'Inspected exact first-fold screenshot.' }); await writeJson(path.join(directory, 'inputs', `program-${priorProgramHash}.json`), program); await writeJson(path.join(directory, 'inputs', `component-plan-${planHash}.json`), plan); await writeJson(path.join(directory, 'assets', 'imported.json'), []);
    const context = { journal: state, snapshot: current, schemas: registry };
    assert.equal(await loadReusableFirstFoldV2(directory, input, context), undefined, 'No sealed target snapshot means no reuse');
    const sealedRef = await writeSnapshotRefV2(directory, path.join(directory, 'target', 'firstfold.json'), sealed);
    const lowerChanged = structuredClone(input); (lowerChanged.program.blocks[1] as any).css = ':scope{color:#555}'; lowerChanged.programHash = '5'.repeat(64); assert.equal(firstFoldDependencyV2(input), firstFoldDependencyV2(lowerChanged)); const reused = await loadReusableFirstFoldV2(directory, lowerChanged, context); assert.equal(reused?.sourceDocumentHash, sealed.hash); assert.equal(reused?.currentProgramHash, lowerChanged.programHash);
    for (const mutate of [(value: typeof input) => { (value.program.blocks[0] as any).css = ':scope{color:#777}'; }, (value: typeof input) => { value.componentPlan.requirements[0].verification.expected = 'Changed'; }, (value: typeof input) => { value.program.viewports[0].width = 1440; }, (value: typeof input) => { value.sourceFactsHash = '6'.repeat(64); }, (value: typeof input) => { value.assetsManifestHash = '7'.repeat(64); }, (value: typeof input) => { value.componentPlanHash = '8'.repeat(64); }]) { const changed = structuredClone(lowerChanged); mutate(changed); assert.equal(await loadReusableFirstFoldV2(directory, changed, context), undefined); }
    const changedCurrent = snapshot(structuredClone(current.elements), current.settings); changedCurrent.elements[0].settings.unexpected = 'human edit'; changedCurrent.hash = documentHashV2(changedCurrent.elements, changedCurrent.settings); assert.equal(await loadReusableFirstFoldV2(directory, lowerChanged, { ...context, snapshot: changedCurrent }), undefined);
    await writeFile(sealedRef.path, '{}'); await assert.rejects(loadReusableFirstFoldV2(directory, lowerChanged, context), /snapshot identity|whole-document/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
function revisionFixtureV2() {
  const reference = { path: 'packet.json', sha256: 'a'.repeat(64) }, source: any = { version: 2, kind: 'source-facts', sourceUrl: 'https://source.test/', observation: reference, snapshots: [{ id: 'desktop', viewport: { name: 'desktop', width: 1920, height: 1080, clientWidth: 1905, scrollbarWidth: 15, devicePixelRatio: 1 }, screenshot: { path: 'desktop.png', sha256: 'b'.repeat(64), width: 1920, height: 1080 }, evidence: [reference], nodes: { root: { parentId: null, regionId: 'header', tag: 'header', selector: '#root', childIds: [] } } }], facts: { 'desktop:region:header': { id: 'desktop:region:header', snapshotId: 'desktop', regionId: 'header', nodeId: 'root', kind: 'region', evidence: reference, value: { id: 'header', nodeId: 'root', contentNodeId: 'root', role: 'header', order: 0, gapBefore: 0, selector: '#root' } } }, gaps: [] }, manifest = { assets: [{ key: 'logo', localPath: 'assets/logo.png', sourceUrl: 'https://source.test/logo.png', sha256: 'c'.repeat(64), mediaType: 'image/png' }] };
  const nextSource = structuredClone(source); nextSource.snapshots.push({ ...structuredClone(source.snapshots[0]), id: 'mobile', viewport: { ...source.snapshots[0].viewport, name: 'mobile', width: 390, clientWidth: 390, scrollbarWidth: 0 } }); const nextManifest = { assets: [...manifest.assets, { ...manifest.assets[0], key: 'mobile-logo', localPath: 'assets/mobile.png', sha256: 'd'.repeat(64) }] };
  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const options = { previousSourceFactsBytes: bytes(source), sourceFactsBytes: bytes(nextSource), previousAssetsManifestBytes: bytes(manifest), assetsManifestBytes: bytes(nextManifest), previousSourceFactsHash: hashV2(bytes(source)), sourceFactsHash: hashV2(bytes(nextSource)), previousAssetsManifestHash: hashV2(bytes(manifest)), assetsManifestHash: hashV2(bytes(nextManifest)) };
  return { source, nextSource, manifest, nextManifest, bytes, options };
}

test('immutable source and asset additions allow desktop owned-block rebuilds while changed desktop projection still blocks later stages', () => {
  const fixture = revisionFixtureV2(), proof = proveImmutableInputExtensionV2(fixture.options), state = journal(base); state.desktopDependencyHash = 'a'.repeat(64); state.sourceFactsHash = proof.previousSourceFactsHash; state.assetsManifestHash = proof.previousAssetsManifestHash;
  const identity = { taskId: state.taskId, sourceUrl: state.sourceUrl, targetUrl: state.targetUrl, sourceFactsHash: proof.sourceFactsHash, assetsManifestHash: proof.assetsManifestHash, desktopDependencyHash: 'e'.repeat(64), stage: 'desktop' as const };
  assert.doesNotThrow(() => assertResumeIdentityV2(state, identity, snapshot(), proof)); assert.throws(() => assertResumeIdentityV2(state, identity, snapshot()), /identity/); assert.throws(() => assertResumeIdentityV2(state, identity, snapshot(), { ...proof }), /identity/, 'A copied JSON object cannot grant revision permission');
  assert.throws(() => assertResumeIdentityV2(state, { ...identity, stage: 'responsive' }, snapshot(), proof), /identity/); assert.doesNotThrow(() => assertResumeIdentityV2(state, { ...identity, stage: 'responsive', desktopDependencyHash: state.desktopDependencyHash }, snapshot(), proof)); assert.throws(() => assertResumeIdentityV2(state, identity, snapshot([node('aaaaaaa', 'human')]), proof), /concurrent/);
  const tampered = structuredClone(fixture.nextSource); tampered.facts['desktop:region:header'].value.gapBefore = 99; const changedSource = fixture.bytes(tampered); assert.throws(() => proveImmutableInputExtensionV2({ ...fixture.options, sourceFactsBytes: changedSource, sourceFactsHash: hashV2(changedSource) }), /changed previously captured fact/);
  const changedAsset = fixture.bytes({ assets: fixture.nextManifest.assets.map(asset => asset.key === 'logo' ? { ...asset, sourceUrl: 'https://source.test/other.png' } : asset) }); assert.throws(() => proveImmutableInputExtensionV2({ ...fixture.options, assetsManifestBytes: changedAsset, assetsManifestHash: hashV2(changedAsset) }), /existing source asset record/);
  assert.throws(() => proveImmutableInputExtensionV2({ ...fixture.options, previousAssetsManifestBytes: Buffer.from('{}') }), /evidence bytes changed/);
});

test('resume revision verifies stored raw hashes and completed media ledger locally before target authentication', async () => {
  const directory = await temporary();
  try {
    const fixture = revisionFixtureV2(), state = journal(directory); state.sourceFactsHash = fixture.options.previousSourceFactsHash; state.assetsManifestHash = fixture.options.previousAssetsManifestHash;
    await writeJson(path.join(directory, 'inputs', `source-facts-${state.sourceFactsHash}.json`), fixture.source); await writeJson(path.join(directory, 'inputs', `assets-manifest-${state.assetsManifestHash}.json`), fixture.manifest); await writeJson(path.join(directory, 'next-facts.json'), fixture.nextSource); await writeJson(path.join(directory, 'next-assets.json'), fixture.nextManifest);
    const input: any = { jobDir: directory, sourceFactsHash: fixture.options.sourceFactsHash, assetsManifestHash: fixture.options.assetsManifestHash, program: { sourceFacts: { path: 'next-facts.json', sha256: fixture.options.sourceFactsHash }, assetsManifest: { path: 'next-assets.json', sha256: fixture.options.assetsManifestHash } }, manifest: fixture.nextManifest }, entry = { key: 'logo', sha256: fixture.manifest.assets[0].sha256, status: 'complete', imported: { key: 'logo', sha256: fixture.manifest.assets[0].sha256 } }, ledger = { version: 2, runId: state.runId, pageId: state.pageId, assets: [entry] };
    await writeJson(path.join(directory, 'assets', 'ledger.json'), ledger); assert.ok(await proveResumeInputsV2(state, input));
    await writeJson(path.join(directory, 'assets', 'ledger.json'), { ...ledger, assets: [{ ...entry, imported: { ...entry.imported, sha256: 'f'.repeat(64) } }] }); await assert.rejects(proveResumeInputsV2(state, input), /existing imported source asset/);
    await writeFile(path.join(directory, 'inputs', `source-facts-${state.sourceFactsHash}.json`), '{}'); await assert.rejects(proveResumeInputsV2(state, input), /evidence bytes changed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a rejected input or failed attempt never inherits stagePassed from the previously accepted program', () => {
  const state = journal(base), input = { programHash: state.programHash, componentPlanHash: state.componentPlanHash, sourceFactsHash: state.sourceFactsHash, assetsManifestHash: state.assetsManifestHash }; state.stages.desktop.status = 'passed'; state.status = 'stage-passed'; state.stages.desktop.evidence = ['old-desktop.json'];
  assert.equal(resultFromV2(state, input, 'desktop').stagePassed, true); assert.equal(resultFromV2(state, { ...input, programHash: 'f'.repeat(64) }, 'desktop').stagePassed, false); assert.deepEqual(resultFromV2(state, { ...input, programHash: 'f'.repeat(64) }, 'desktop').evidence, []);
  state.status = 'failed'; assert.equal(resultFromV2(state, input, 'desktop').stagePassed, false); assert.equal(resultFromV2(state, input, 'responsive').stagePassed, false); assert.equal(state.stages.desktop.status, 'passed', 'Historical accepted proof remains intact');
});
test('restoration lost response is reconciled without a second write and unresolved restore remains pending', async () => {
  const directory = await temporary(); try {
    const baseline = snapshot(), modified = snapshot([node('aaaaaaa', 'temporary')]); let actual = modified, restores = 0; const state = journal(directory, baseline), client = { async snapshotDraft() { return actual; }, async restoreDraft() { restores++; actual = baseline; throw Error('network timeout'); } }; const restored = await restoreSnapshotV2(client, baseline, modified, state, 'test', ['a']); assert.equal(restored.hash, baseline.hash); assert.equal(restores, 1); assert.equal(state.mutations[0].status, 'confirmed');
    actual = modified; const failed = journal(directory, baseline), unavailable = { async snapshotDraft() { return actual; }, async restoreDraft() { throw Error('network timeout'); } }; await assert.rejects(restoreSnapshotV2(unavailable, baseline, modified, failed, 'test', ['a']), /network/); assert.equal(failed.mutations[0].status, 'restore-pending'); assert.equal(failed.status, 'restore-pending');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('interrupted editor test restores only its exact temporary snapshot on resume', async () => {
  const directory = await temporary(); try {
    const baseline = snapshot(), modified = snapshot([node('aaaaaaa', 'temporary')]), state = journal(directory, baseline), intent = newMutationIntentV2({ kind: 'editor-test', checkpoint: 'html', pageId: baseline.pageId, runId: baseline.runId, beforeHash: baseline.hash, expectedAfterHash: modified.hash, affectedBlockKeys: ['a'] }); state.mutations.push(intent); await writeJson(path.join(directory, 'mutations', `${intent.id}-before.json`), baseline); let actual = modified, writes = 0; const client = { async snapshotDraft() { return actual; }, async restoreDraft(_id: number, baseline: DraftSnapshot) { writes++; actual = baseline; return actual; } }; const restored = await resumeMutationsV2(state, client, modified); assert.equal(restored.hash, baseline.hash); assert.equal(writes, 1); assert.equal(state.status, 'running'); assert.equal(intent.status, 'confirmed');
    const foreign = snapshot([node('aaaaaaa', 'human')]), pending = journal(directory, baseline), conflict = newMutationIntentV2({ kind: 'editor-test', checkpoint: 'html', pageId: baseline.pageId, runId: baseline.runId, beforeHash: baseline.hash, expectedAfterHash: modified.hash, affectedBlockKeys: ['a'] }); pending.mutations.push(conflict); await assert.rejects(resumeMutationsV2(pending, client, foreign), /concurrent/); assert.equal(writes, 1); assert.equal(conflict.status, 'conflict');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('local image-byte validation rejects forged MIME and requires safe SVG conversion before authentication', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64');
  assert.equal((await validateAssetBytesV2(png, 'image/png')).width, 1); await assert.rejects(validateAssetBytesV2(png, 'image/jpeg'), /MIME/); await assert.rejects(validateAssetBytesV2(Buffer.from('<html>intercept page</html>'), 'image/png'));
  const safe = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>'); assert.doesNotThrow(() => assertSafeSVGBytesV2(safe)); await assert.rejects(validateAssetBytesV2(safe, 'image/svg+xml'), /rasterized/);
  for (const unsafe of ['<svg><script>alert(1)</script></svg>', '<svg onload="run()"/>', '<svg><image href="https://other.test/remote.png"/></svg>', '<!DOCTYPE svg><svg/>', '<svg><style>@import "https://other.test/remote.css";</style></svg>']) assert.throws(() => assertSafeSVGBytesV2(Buffer.from(unsafe)), /executable|external/);
});
