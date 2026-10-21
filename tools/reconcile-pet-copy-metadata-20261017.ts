import { readFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadConfig } from '../src/core/config.js';
import { acquireLock, writeJson } from '../src/core/files.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { NATIVE44_ALL_TYPES } from '../src/native44/catalog.js';
import { fingerprintNative44Snapshot } from '../src/native44/compare.js';
const root = 'D:/cloneWP', run = root + '/runs/2026-10-17-pet-unified-draft', dir = run + '/amendments/20261017-unified-copy', out = root + '/runs/2026-10-17-pet-unified-review';
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8')), sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sort = (value: any): any => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)])) : value;
const canonical = (value: any) => JSON.stringify(sort(value));
const before = await json(dir + '/before.json'), expected = await json(dir + '/expected.json'), manifest = await json(run + '/compare-manifest.json'), intent = await json(dir + '/intent.json'), journal = await json(run + '/journal.json');
if ('post_title' in expected.settings || 'post_status' in expected.settings || before.settings.post_status !== 'draft' || before.title !== before.settings.post_title) throw Error('Native metadata retention does not meet exact safe predicate');
const normalizedSettings = { ...expected.settings, post_title: before.settings.post_title, post_status: 'draft' }, normalizedHash = sha(canonical({ elements: expected.elements, settings: normalizedSettings }));
const loaded = await loadConfig(root), client = new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, executionStrategy: 'native44-css-handoff', allowedWidgetTypes: NATIVE44_ALL_TYPES }), unlock = await acquireLock(root);
try {
  const { snapshot: actual } = await client.readOwnedReviewCheckpoint(15734, journal.runId, manifest.widgetTypes);
  if (actual.hash !== normalizedHash || canonical(actual.elements) !== canonical(expected.elements) || canonical(actual.settings) !== canonical(normalizedSettings) || intent.expectedHash !== expected.hash) throw Error('Current draft has a change beyond retained native metadata; preserve conflict');
  await copyFile(dir + '/receipt.json', dir + '/receipt-before-native-metadata-reconciliation.json', 1);
  await writeJson(dir + '/normalized-expected.json', { ...expected, settings: normalizedSettings, hash: normalizedHash });
  await writeJson(dir + '/metadata-normalization-proof.json', { kind: 'native-page-metadata-retained', expectedInputHash: expected.hash, actualOutputHash: actual.hash, fields: ['post_title', 'post_status'], retainedFromBefore: true, completeElementsEqual: true, allOtherSettingsEqual: true, actualDraftReadback: true, remoteWrites: 0, observedAt: new Date().toISOString() });
  await writeJson(dir + '/receipt.json', { version: 1, status: 'confirmed', pageId: 15734, runId: journal.runId, beforeHash: before.hash, afterHash: actual.hash, cssApplied: true, normalization: { kind: 'native-page-metadata-retained', inputHash: expected.hash, outputHash: actual.hash, fields: ['post_title', 'post_status'] }, reconciledWithoutRepeatWrite: true, observedAt: new Date().toISOString() });
  const counts = { containers: 0, widgets: 0, html: 0, productWidgets: 0 }; const visit = (nodes: any[]) => nodes.forEach(node => { if (node.elType === 'container') counts.containers++; else counts.widgets++; if (node.widgetType === 'html') counts.html++; if (node.widgetType === 'wd_products') counts.productWidgets++; visit(node.elements ?? []); }); visit(actual.elements);
  const ref = async (file: string) => ({ path: file, sha256: sha(await readFile(file)) });
  await writeJson(run + '/compare-manifest.json', { ...manifest, ...fingerprintNative44Snapshot(actual) }); await writeJson(out + '/compare-manifest.json', { ...manifest, ...fingerprintNative44Snapshot(actual) });
  await writeJson(run + '/current-user-amendment.json', { version: 1, kind: 'completed-explicit-user-draft-amendment', pageId: 15734, runId: journal.runId, taskId: journal.taskId, status: 'applied-pending-review', unpublished: true, documentHash: actual.hash, cssApplied: true, requestedScope: 'User-authorized unpublished copy; actual product content may differ while native source layout/styles/interactions remain required. Consolidated CSS applied; project rules/state unified; two-desktop visual review pending.', counts, amendments: [{ intent: await ref(dir + '/intent.json'), receipt: await ref(dir + '/receipt.json'), beforeHash: before.hash, afterHash: actual.hash }], currentSnapshot: await ref(dir + '/after.json'), currentCSS: await ref(dir + '/page-custom.css') });
  console.log(JSON.stringify({ status: 'applied-pending-review', pageId: 15734, documentHash: actual.hash, counts, remoteWrites: 0, repeatedSave: false }));
} finally { await client.close(); await unlock(); }
