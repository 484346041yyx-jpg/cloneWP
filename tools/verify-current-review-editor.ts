import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadConfig, redactor } from '../src/core/config.js';
import { previewCookies } from '../src/core/runner.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { checkFidelityDraft } from '../src/fidelity/acceptance.js';
import { compileFidelity } from '../src/fidelity/native.js';

const root = 'D:/cloneWP';
const runId = '2026-10-15T01-39-43-444Z-blocks-www-petsupermarket-com-b1a67d75';
const pageId = 14866;
const expectedHash = 'b551992f3eb001b99f14cfd2959f157b3cb185cc088b671e025ec44922eea903';
const baseRunDir = path.join(root, 'runs', runId);
const runDir = path.join(baseRunDir, 'revisions', '2026-10-15T02-34-58-296Z-1fa42b86');
const jobDir = path.join(root, 'references', 'reference-2026-10-15T01-35-56-997Z-www-petsupermarket-com-1698bebb');
const json = async <T>(name: string): Promise<T> => JSON.parse(await readFile(path.join(baseRunDir, name), 'utf8')) as T;
const { config, credentials } = await loadConfig(root);
const redact = redactor(credentials);
const client = new WordPressClient({ targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password });
let enteredEditor = false;
try {
  const owned = await client.inspectOwnedDraft(pageId, runId);
  if (!owned.exists || !owned.markerMatches || owned.status !== 'draft') throw new Error('The review draft ownership changed.');
  await client.createDraft(runId, 'Pet Supermarket reference review', { requireExistingPageId: pageId });
  const snapshot = await client.snapshotDraft(pageId);
  if (snapshot.hash !== expectedHash) throw new Error('The owned draft changed since the saved checkpoint.');
  const program = JSON.parse(await readFile(path.join(jobDir, 'program.json'), 'utf8'));
  const contract = await json<any>('source-block-contract.json');
  contract.referenceReport.path = path.resolve(jobDir, contract.referenceReport.path);
  const capabilities = await json<any>('target/capabilities.json');
  const assets = await json<any>('assets/imported.json');
  const catalog = await json<any>('target/catalog.json');
  const compiled = compileFidelity(program, capabilities.legacySchemas, assets, catalog);
  const access = await client.getPreviewAccess(pageId);
  const cookies = await previewCookies(access.adminAccessUrl, config.targetUrl);
  const checked = await checkFidelityDraft({ program, contract, compiled, client, snapshot, schemas: capabilities.legacySchemas, assets, catalog, editUrl: access.editUrl, previewUrl: access.previewUrl, cookies, runDir, onProgress: stage => { if (/editor|restore/i.test(stage)) enteredEditor = true; process.stderr.write(`[editor verify] ${stage}\n`); } });
  process.stdout.write(JSON.stringify({ status: checked.report.status, passed: checked.passed, hash: checked.snapshot.hash, verificationPath: checked.verificationPath, editorStatus: checked.report.completion.lanes.editable.status }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ verificationFailed: true, error: redact(error), enteredEditor, stack: error instanceof Error ? error.stack?.split('\n').slice(0, 7).map(line => line.replace(/https?:\/\/\S+/g, '[url]')) : undefined }) + '\n');
  process.exitCode = 1;
} finally {
  try {
    const current = await client.snapshotDraft(pageId);
    process.stderr.write(JSON.stringify({ finalHash: current.hash, matchesCheckpoint: current.hash === expectedHash }) + '\n');
  } catch { process.stderr.write('[editor verify] final readback unavailable\n'); }
  await client.close().catch(() => undefined);
}
