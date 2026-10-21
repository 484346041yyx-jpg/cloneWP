import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { assertCreationTaskMode, parseCreationArguments, readCreationInput, resolveCreationMode } from '../src/core/creation-mode.js';
import type { OriginalDesign } from '../src/original/types.js';
import type { NativeProgram } from '../src/fidelity/types.js';

const original = (): OriginalDesign => ({
  version: 1, brand: 'Mode test', title: 'Mode test', language: 'en', description: 'A system test fixture.',
  tokens: {colors: {ink: '#222222'}, font: 'Arial', contentWidth: 1200}, assets: [],
  sections: [{key: 'hero', kind: 'container', children: [{key: 'title', kind: 'heading', headingTag: 'h1', text: 'Mode test'}]}],
});
const replica = (): NativeProgram => ({
  version: 1, workflow: 'block-replication', title: 'Replica test', sourceUrl: 'https://example.com/',
  sourceContract: {path: 'contract.json', sha256: 'a'.repeat(64)}, assetsManifest: {path: 'manifest.json', sha256: 'b'.repeat(64)},
  elements: [{key: 'hero', type: 'container', settings: {}, children: [{key: 'title', type: 'heading', settings: {title: 'Source copy'}}]}],
  blocks: [{sourceBlockId: 'hero', rootKey: 'hero', presentation: 'static', bindings: [{sourceTextId: 'title', elementKey: 'title', settingPath: 'title'}],
    states: {normal: {status: 'not-applicable', evidence: []}, hover: {status: 'not-applicable', evidence: []}, interaction: {status: 'not-applicable', evidence: []}}}], deviations: [],
});
test('mode dispatch requires a complete known input and cannot reinterpret the workflow', () => {
  assert.equal(resolveCreationMode(original()), 'original');
  assert.equal(resolveCreationMode({...original(), workflow: 'original-design'}), 'original');
  assert.equal(resolveCreationMode(replica()), 'replica');
  assert.throws(() => resolveCreationMode(original(), 'replica'), /conflicts/);
  assert.throws(() => resolveCreationMode(replica(), 'original'), /conflicts/);
  for (const input of [{workflow: 'unknown'}, {workflow: 'reference-to-original'}, {workflow: 'original-elementor'}, {workflow: null}, {}, {brand: 'Broken'}, [], null]) {
    assert.throws(() => resolveCreationMode(input), /Unknown|Invalid|design or native/);
  }
  assert.throws(() => resolveCreationMode({...original(), sourceUrl: 'https://example.com/'}), /Invalid original/);
  assert.throws(() => resolveCreationMode({workflow: 'block-replication'}), /Invalid block-replication/);
});

test('explicit CLI aliases accept one JSON and reject ambiguous flags or URLs', () => {
  assert.deepEqual(parseCreationArguments(['--mode', 'original', 'original/task/design.json']), {mode: 'original', filename: 'original/task/design.json'});
  assert.deepEqual(parseCreationArguments(['references/task/program.json', '--mode', 'replica']), {mode: 'replica', filename: 'references/task/program.json'});
  assert.deepEqual(parseCreationArguments(['original/design.json']), {filename: 'original/design.json', mode: undefined});
  for (const args of [[], ['--mode', 'original'], ['--mode', 'unknown', 'design.json'], ['--mode', 'original', '--mode', 'original', 'design.json'], ['design.json', '--publish'], ['a.json', 'b.json'], ['https://example.com/design.json']]) assert.equal(parseCreationArguments(args), undefined);
});

test('task identity is checked locally; reference directories cannot silently become new original tasks', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-two-mode-'));
  t.after(async () => {assert.match(path.basename(root), /^clonewp-two-mode-/); await rm(root, {recursive: true, force: true});});
  const save = async (relative: string, input: unknown) => { const file = path.join(root, relative); await mkdir(path.dirname(file), {recursive: true}); await writeFile(file, JSON.stringify(input)); return file; };
  const newDesign = {...original(), workflow: 'original-design'};
  const current = await save('original/current/design.json', newDesign);
  assert.deepEqual(await assertCreationTaskMode(root, current, 'original'), {legacyReferenceOriginal: false});
  await save('original/current/job.json', {workflow: 'original-design', mode: 'original'});
  assert.deepEqual(await assertCreationTaskMode(root, current, 'original'), {legacyReferenceOriginal: false});
  await save('original/current/job.json', {workflow: 'block-replication'});
  await assert.rejects(assertCreationTaskMode(root, current, 'original'), /Task marker conflicts/);
  await save('original/current/job.json', {workflow: 'unknown'});
  await assert.rejects(assertCreationTaskMode(root, current, 'original'), /Unknown task workflow/);
  const old = await save('original/design.json', original());
  assert.deepEqual(await assertCreationTaskMode(root, old, 'original'), {legacyReferenceOriginal: false});
  await save('original/design.json', newDesign);
  await assert.rejects(assertCreationTaskMode(root, old, 'original'), /isolated/);
  const referenceOriginal = await save('references/capture/design.json', original());
  await assert.rejects(assertCreationTaskMode(root, referenceOriginal, 'original'), /cannot fall back/);
  await save('references/capture/job.json', {workflow: 'block-replication'});
  await assert.rejects(assertCreationTaskMode(root, referenceOriginal, 'original'), /Task marker conflicts/);
  await save('references/capture/job.json', {workflow: 'reference-to-original'});
  assert.equal((await assertCreationTaskMode(root, referenceOriginal, 'original')).legacyReferenceOriginal, true);
  const program = await save('references/current/program.json', replica());
  assert.deepEqual(await assertCreationTaskMode(root, program, 'replica'), {legacyReferenceOriginal: false});
  const wrongDirectory = await save('original/replica/program.json', replica());
  await assert.rejects(assertCreationTaskMode(root, wrongDirectory, 'replica'), /cannot run inside/);
});

test('task mode reads reject path escapes and junctions resolving to foreign task files', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'clonewp-mode-path-')), root = path.join(base, 'project'), outside = path.join(base, 'outside');
  t.after(async () => {assert.match(path.basename(base), /^clonewp-mode-path-/); await rm(base, {recursive: true, force: true});});
  await mkdir(path.join(root, 'original'), {recursive: true}); await mkdir(outside);
  await writeFile(path.join(outside, 'job.json'), JSON.stringify({workflow: 'original-design'}));
  await writeFile(path.join(outside, 'design.json'), JSON.stringify({...original(), workflow: 'original-design'}));
  await symlink(outside, path.join(root, 'original/task'), 'junction');
  await assert.rejects(assertCreationTaskMode(root, 'original/task/design.json', 'original'), /inside the project/);
  await assert.rejects(readCreationInput(root, '../outside/job.json'), /inside the project/);
});
