import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { VerifiedEvidenceReader } from '../src/core/verified-evidence.js';

test('a file above the former ceiling still gets its hash and explicit protocol limits checked', async t => {
  const root = await mkdtemp(path.join(await realpath('D:/cloneWP/.cache'), 'large-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.alloc(2 ** 25 + 1, 65);
  const filename = path.join(root, 'evidence.bin');
  const ref = { path: filename, sha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(filename, bytes);
  const reader = new VerifiedEvidenceReader(root, 0);
  assert.deepEqual(await reader.verify(ref), { bytes: bytes.length });
  await assert.rejects(reader.verify(ref, 1024), /artifact_too_large/);
  await assert.rejects(new VerifiedEvidenceReader(root, 0).verify({ ...ref, sha256: '0'.repeat(64) }), /artifact_hash_mismatch/);
});
