import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { runNative44RevisionCli } from '../src/native44/revision-cli.js';

test('revision CLI rejects ambiguous commands and invalid requests before creating a target client', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-revision-cli-')); t.after(() => rm(root, { recursive: true, force: true }));
  let factories = 0; const deps = { remote: async (): Promise<never> => { factories++; throw Error('must not authenticate'); } };
  await writeFile(path.join(root, 'invalid.json'), '{}');
  for (const args of [[], ['unknown'], ['prepare', '--request', 'invalid.json', '--request', 'invalid.json'], ['prepare', '--request', 'invalid.json'], ['apply', '--run', 'missing', '--operation', 'revision-one'], ['status', '--run', '../../outside']]) await assert.rejects(runNative44RevisionCli(args, root, deps));
  assert.equal(factories, 0);
});

test('revision CLI rejects outside paths and checks large in-project requests by schema before authentication', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'clonewp-revision-paths-')); t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'project'), other = path.join(base, 'other'); await mkdir(root); await mkdir(other); await writeFile(path.join(other, 'request.json'), '{}');
  const deps = { remote: async (): Promise<never> => { throw Error('must not authenticate'); } };
  await symlink(other, path.join(root, 'alias'), 'junction');
  await assert.rejects(runNative44RevisionCli(['prepare', '--request', '../other/request.json'], root, deps), /path_escape/);
  await assert.rejects(runNative44RevisionCli(['prepare', '--request', 'alias/request.json'], root, deps), /path_escape/);
  await writeFile(path.join(root, 'large.json'), '{}' + ' '.repeat(2 ** 25));
  await assert.rejects(runNative44RevisionCli(['prepare', '--request', 'large.json'], root, deps), error => error instanceof Error && error.name === 'ZodError');
});
