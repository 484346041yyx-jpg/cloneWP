import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { reviewDraftFixture } from './helpers/review-draft-fixture.js';
import { prepareLocalTask } from '../src/native44/local-task.js';
import { runNative44Replica } from '../src/native44/runtime.js';
import { parseCreationArguments } from '../src/core/creation-mode.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { documentHashV2, hashV2 } from '../src/replica-v2/journal.js';
import { compileEditorElements } from '../src/wordpress/editor-serialization.js';
import { assertNative44PublicationGate } from '../src/native44/publication.js';
import type { DraftSnapshot, PreflightReport, CapabilityReport } from '../src/wordpress/types.js';

test('review draft argument is explicit, unique and position independent', () => {
  assert.deepEqual(parseCreationArguments(['--review-draft', 'program.json', '--mode', 'replica']), { filename: 'program.json', mode: 'replica', reviewDraft: true });
  assert.deepEqual(parseCreationArguments(['program.json', '--review-draft']), { filename: 'program.json', mode: undefined, reviewDraft: true });
  assert.equal(parseCreationArguments(['program.json', '--review-draft', '--review-draft']), undefined);
  assert.equal(parseCreationArguments(['program.json', '--review-draft=true']), undefined);
});

test('strict native44 creation still blocks gaps; explicit review keeps the entire verified source plan and every unverified behavior', async t => {
  const f = await reviewDraftFixture(t);
  await assert.rejects(prepareLocalTask(f.filename, f.root), /native44_required_capability_gaps/);
  const input = await prepareLocalTask(f.filename, f.root, { reviewDraft: true });
  assert.equal(input.requirementCoverage!.draftReady, false);
  assert.equal(input.reviewDraftIntent!.reviewDraftOnly, true);
  assert.equal(input.reviewDraftIntent!.requirementsComplete, false);
  assert.equal(input.reviewDraftIntent!.deliveryComplete, false);
  assert.deepEqual(input.reviewDraftIntent!.components.map(item => item.key), ['root', 'body']);
  assert.equal(input.reviewDraftIntent!.sourceUnits.length, 4);
  assert.equal(input.reviewDraftIntent!.unverifiedRequirements.length, 2);
  assert.ok(input.reviewDraftIntent!.unverifiedRequirements.every(item => item.capability === 'hover' && item.fulfillment.route === 'gap'));
  assert.equal(input.reviewDraftIntent!.inputs.program.sha256, hashV2(await readFile(f.filename)));
});

test('review draft cannot bypass missing static proof, reduced source coverage or a historical task', async t => {
  const f = await reviewDraftFixture(t), original = structuredClone(f.plan);
  const savePlan = async () => { f.program.componentPlan = await f.json(path.join(f.jobDir, 'component-plan.json'), f.plan); await f.json(f.filename, f.program); };
  const staticRow = f.plan.requirementContract!.requirements.find(item => item.dimension === 'presence')!;
  staticRow.fulfillment = { route: 'gap', gapId: 'missing-static', reason: 'This synthetic static content has no verified component proof.' };
  await savePlan(); await assert.rejects(runNative44Replica(f.filename, { root: f.root, reviewDraft: true }), /native44_review_draft_static_gaps/);
  Object.assign(f.plan, structuredClone(original)); f.plan.sourceUnits!.pop();
  await savePlan(); await assert.rejects(runNative44Replica(f.filename, { root: f.root, reviewDraft: true }), /source-unit inventory hash changed|Source inventory omits|Selection/);
  Object.assign(f.plan, structuredClone(original)); await savePlan();
  await f.json(f.jobFile, { ...f.job, releaseLock: undefined });
  await assert.rejects(runNative44Replica(f.filename, { root: f.root, reviewDraft: true }), /release_ref_missing|review_draft_requires_new_full/);
});

test('full review intent is durable before configuration or credentials can be loaded', async t => {
  const f = await reviewDraftFixture(t);
  // No project configuration or credentials exist in the isolated fixture.
  await assert.rejects(runNative44Replica(f.filename, { root: f.root, reviewDraft: true }), /ENOENT.*project.json/);
  const intent = JSON.parse(await readFile(path.join(f.jobDir, 'review-draft-intent.json'), 'utf8'));
  assert.equal(intent.inputs.program.sha256, hashV2(await readFile(f.filename)));
  assert.equal(intent.inputs.componentPlan.sha256, hashV2(await readFile(path.join(f.jobDir, 'component-plan.json'))));
  assert.equal(intent.unverifiedRequirements.length, 2);
  assert.deepEqual(intent.components.map((item: { key: string }) => item.key), ['root', 'body']);
  assert.equal(intent.inputs.releaseLock.sha256, hashV2(await readFile(intent.inputs.releaseLock.path)));
});

test('explicit review creates one full owned draft through the normal lifecycle and leaves publication blocked', async t => {
  const f = await reviewDraftFixture(t), core = JSON.parse(await readFile(new URL('./fixtures/native44-core-source.json', import.meta.url), 'utf8'));
  await f.json(path.join(f.root, 'config/project.json'), { siteKey: 'synthetic', targetUrl: 'https://target.example/', credentialsFile: 'config/synthetic-credentials.json', viewports: [{ name: 'desktop', width: 1920, height: 1080 }], maxCorrectionRounds: 0, maxSourceSections: 100, maxSourceElements: 4000, maxElements: 1000, maxAssets: 100, maxAssetBytes: 1000000, maxPageHeight: 30000, pageStatus: 'publish', pageTemplate: 'elementor_canvas', agentTimeoutMs: 1000, maxTotalMs: 60000 });
  await f.json(path.join(f.root, 'config/synthetic-credentials.json'), { wp_user: 'synthetic-fixture', wp_app_password: 'synthetic-fixture-only' });
  let creates = 0, saves = 0, auth = 0, current: DraftSnapshot;
  const preflight: PreflightReport = { targetUrl: 'https://target.example/', authenticated: true, userId: 1, plugins: [{ plugin: 'elementor/elementor', name: 'Elementor', status: 'active', version: '3.33.2' }, { plugin: 'elementor-pro/elementor-pro', name: 'Pro', status: 'active', version: '3.32.1' }, { plugin: 'woodmart-core/woodmart-core', name: 'Core', status: 'active', version: '1.1.5' }], themes: [], namespaces: [], novamiraInstalled: true, novamiraActive: true, blockers: [] };
  const capabilities: CapabilityReport = { mode: 'legacy-verified', abilities: [], schemas: {}, legacySchemas: f.schemas, versions: { elementor: '3.33.2', elementorPro: '3.32.1', woodmart: '8.3.4', woodmartCore: '1.1.5', activeTemplate: 'woodmart' }, sourceProof: core.sourceProof, limitations: [] };
  t.mock.method(WordPressClient.prototype, 'preflight', async () => { auth++; const intent = JSON.parse(await readFile(path.join(f.jobDir, 'review-draft-intent.json'), 'utf8')); assert.equal(intent.deliveryComplete, false); return preflight; });
  t.mock.method(WordPressClient.prototype, 'discoverCapabilities', async () => capabilities);
  t.mock.method(WordPressClient.prototype, 'createDraft', async (runId: string, title: string) => { creates++; current = { pageId: 77, runId, title, status: 'draft', elements: [], settings: {}, hash: documentHashV2([], {}) }; return { pageId: 77, editUrl: 'https://target.example/wp-admin/post.php?post=77&action=elementor' }; });
  t.mock.method(WordPressClient.prototype, 'snapshotDraft', async () => structuredClone(current));
  t.mock.method(WordPressClient.prototype, 'configureCanvasShell', async () => ({ enabled: false, pageId: 77 }));
  t.mock.method(WordPressClient.prototype, 'buildDraft', async (_page: number, composition: Parameters<WordPressClient['buildDraft']>[1]) => { assert.ok('elements' in composition); saves++; assert.equal(current.status, 'draft'); assert.equal(composition.elements.length, 1); assert.equal(composition.elements[0].elements?.length, 1); const elements = compileEditorElements(composition.elements, f.schemas, { executionStrategy: 'native44-css-handoff' }); current = { ...current, elements, settings: { ...current.settings, ...composition.pageSettings }, hash: documentHashV2(elements, { ...current.settings, ...composition.pageSettings }) }; return structuredClone(current); });
  t.mock.method(WordPressClient.prototype, 'close', async () => {});
  const result = await runNative44Replica(f.filename, { root: f.root, reviewDraft: true });
  assert.equal(result.status, 'awaiting-comparison', result.error ?? 'Full review draft did not reach comparison.'); assert.equal(auth, 1); assert.equal(creates, 1); assert.equal(saves, 1);
  assert.equal(result.reviewDraftOnly, true); assert.equal(result.requirementsComplete, false); assert.equal(result.deliveryComplete, false); assert.equal(result.finalDeliveryPolicy.desiredPageStatus, 'publish');
  assert.equal(result.metrics.bodyCommits, 1); assert.equal(result.mutations.length, 1); assert.equal(result.mutations[0].status, 'confirmed');
  const runIntent = JSON.parse(await readFile(path.join(result.runDir, 'review-draft-intent.json'), 'utf8'));
  assert.equal(runIntent.unverifiedRequirements.length, 2);
  assert.throws(() => assertNative44PublicationGate({ deliveryComplete: false, visualVerification: 'pending-comparison' } as never, { acceptedOmissions: [] } as never), /current_review_missing/);
});

