import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('CLI rejects URLs and extra arguments before authentication', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-cli-'));
  const root = path.resolve(import.meta.dirname, '..');
  const loader = pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href;
  const invoke = (args: string[]) => new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
    execFile(process.execPath, ['--import', loader, path.join(root, 'src/cli.ts'), ...args], {
      cwd: directory, timeout: 20_000,
      env: { SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir() },
    }, (error, stdout, stderr) => resolve({ code: error ? Number((error as NodeJS.ErrnoException & { code?: unknown }).code) : 0, stdout, stderr }));
  });
  try {
    for (const args of [[], ['https://example.com/'], ['original/design.json', '--publish'], ['one.json', 'two.json'], ['file:///private.json']]) {
      const result = await invoke(args);
      assert.equal(result.code, 2);
      assert.match(result.stderr, /Usage: npm run create -- <DESIGN_JSON>/);
      assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, /credentials|project\.json|ENOENT/);
    }
    const rejectedDesign = await invoke(['../outside.json']);
    assert.equal(rejectedDesign.code, 1);
    assert.match(rejectedDesign.stderr, /inside the project/);
    assert.doesNotMatch(rejectedDesign.stderr, /credentials|project\.json|ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
