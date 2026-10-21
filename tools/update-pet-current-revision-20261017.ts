import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { acquireLock, writeJson } from '../src/core/files.js';
import { readNative44CurrentState } from '../src/native44/current-state.js';
const root = 'D:/cloneWP', run = root + '/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c', dir = run + '/amendments/20261017-unified-repair', out = root + '/runs/2026-10-17-pet-unified-repair-15621', filename = run + '/current-user-amendment.json';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const reference = async (file: string) => ({ path: file, sha256: sha(await readFile(file)) });
const unlock = await acquireLock(root);
try {
  const raw = await readFile(filename, 'utf8'), pointer = JSON.parse(raw), mode = process.argv[2];
  await readNative44CurrentState(root, run);
  if (mode === 'before') {
    const before = await json(dir + '/before.json'); if (pointer.documentHash !== before.hash || pointer.status !== 'completed') throw Error('Current revision changed before repair intent');
    await writeFile(out + '/current-state-before.json', raw);
    if (await readFile(filename, 'utf8') !== raw) throw Error('Concurrent current pointer change');
    await writeJson(filename, { ...pointer, status: 'amendment-pending', requestedScope: 'Product content may differ; native source layout and interactions remain required. Consolidate and apply current CSS, unify project rules and current task state, then visually verify both desktops.' });
  } else if (mode === 'applied') {
    const after = await json(dir + '/after.json'), receipt = await json(dir + '/receipt.json'), intent = await json(dir + '/intent.json');
    if (pointer.status !== 'amendment-pending' || pointer.documentHash !== intent.beforeHash || receipt.status !== 'confirmed' || receipt.afterHash !== after.hash || after.hash !== intent.expectedHash) throw Error('Native CSS save is not confirmed against the pending current revision');
    const step = { intent: await reference(dir + '/intent.json'), receipt: await reference(dir + '/receipt.json'), beforeHash: intent.beforeHash, afterHash: after.hash };
    if (await readFile(filename, 'utf8') !== raw) throw Error('Concurrent current pointer change');
    await writeJson(filename, { ...pointer, status: 'applied-pending-review', documentHash: after.hash, cssApplied: true, amendments: [...pointer.amendments, step], currentSnapshot: await reference(dir + '/after.json'), currentCSS: await reference(dir + '/page-custom.css') });
  } else if (mode === 'reviewed') {
    const report = await json(out + '/report.json'), reviews = await json(out + '/visual-reviews.json');
    if (pointer.status !== 'applied-pending-review' || report.documentHash !== pointer.documentHash || reviews.length !== 2 || reviews.some((review: any) => review.documentHash !== pointer.documentHash || review.verdict !== 'reviewed')) throw Error('New CSS has not received actual two-desktop visual review');
    if (await readFile(filename, 'utf8') !== raw) throw Error('Concurrent current pointer change');
    await writeJson(filename, { ...pointer, status: 'completed', verification: await reference(out + '/report.json'), visualReview: await reference(out + '/visual-reviews.json'), completedAt: new Date().toISOString() });
  } else throw Error('Use before, applied, or reviewed');
  const current = await readNative44CurrentState(root, run);
  await writeJson(out + '/current-state.json', current);
  console.log(JSON.stringify({ status: current?.status, visualVerification: current?.visualVerification, documentHash: current?.documentHash, remoteWrites: 0 }));
} finally { await unlock(); }
