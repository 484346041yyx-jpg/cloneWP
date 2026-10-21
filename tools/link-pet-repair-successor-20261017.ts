import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { acquireLock, writeJson } from '../src/core/files.js';
import { readNative44CurrentState } from '../src/native44/current-state.js';
const root = 'D:/cloneWP', parent = root + '/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c', run = root + '/runs/2026-10-17-pet-unified-draft', out = root + '/runs/2026-10-17-pet-unified-review';
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const ref = async (file: string) => ({ path: file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
const current = await readNative44CurrentState(root, run); if (!current || current.pageId !== 15734) throw Error('New owned draft state is not verified');
const journal = await json(run + '/journal.json'), parentJournal = await json(parent + '/journal.json'), unlock = await acquireLock(root);
try {
  await writeJson(parent + '/current-successor.json', { version: 1, kind: 'native44-current-draft-successor', taskId: current.taskId, parentRunId: parentJournal.runId, parentPageId: 15621, successorRunId: journal.runId, successorPageId: 15734, parentState: await ref(parent + '/current-user-amendment.json'), successorJournal: await ref(run + '/journal.json'), authorization: await ref(run + '/derivation-request.json') });
  const resolved = await readNative44CurrentState(root, parent); if (resolved?.runId !== journal.runId || resolved.pageId !== 15734) throw Error('Original task did not resolve to the authorized new draft');
  await writeJson(out + '/resolved-current-state.json', resolved);
  console.log(JSON.stringify({ oldPagePreserved: 15621, currentPageId: resolved.pageId, currentRunId: resolved.runId, status: resolved.status, localWritesOnly: true }));
} finally { await unlock(); }
