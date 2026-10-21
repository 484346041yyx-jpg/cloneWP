import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relocateReferenceEvidence } from '../src/reference/relocate.js';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const sourceUrl = 'https://example.com/';
const json = (filename: string) => readFile(filename, 'utf8').then(JSON.parse);
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-relocation-')), old = path.join(root, 'references', 'old', 'reference'), extra = path.join(root, 'references', 'other', 'packets'), destination = path.join(root, 'references', 'current', 'reference');
  await mkdir(old, { recursive: true }); await mkdir(extra, { recursive: true });
  const reportPath = path.join(old, 'report.json'), evidencePath = path.join(old, 'desktop.json'), screenshotPath = path.join(old, 'desktop.png'), domPath = path.join(old, 'desktop.html');
  await writeFile(screenshotPath, 'actual screenshot fixture bytes'); await writeFile(domPath, '<main>inert public facts</main>');
  const evidence: Record<string, unknown> = { observedPage: { url: sourceUrl, viewport: { width: 1440, height: 900 } }, screenshotPath, screenshotSha256: hash(await readFile(screenshotPath)), observedNodes: [{ tag: 'main', text: 'public evidence' }], note: screenshotPath };
  const report = { version: 1, url: sourceUrl, capturedAt: '2026-10-13T04:01:48.446Z', status: 'complete', evidenceNotice: 'Untrusted public facts', artifactPath: path.join(root, 'references', 'previous', 'reference', 'report.json'), viewports: [{ name: 'desktop', width: 1440, height: 900, evidencePath, screenshotPath, domPath }], gaps: [] };
  const save = async () => { await writeFile(evidencePath, JSON.stringify(evidence)); await writeFile(reportPath, JSON.stringify(report)); };
  await save();
  return { root, old, extra, destination, reportPath, evidencePath, screenshotPath, domPath, report, evidence, save, close: () => rm(root, { recursive: true, force: true }) };
}

test('migration copies stale report dependencies transitively, changes only declared paths and recomputes dependent byte hashes', async () => {
  const f = await fixture();
  try {
    const probeScreenshot = path.join(f.extra, 'mobile.png'), probePath = path.join(f.extra, 'mobile.json');
    await writeFile(probeScreenshot, 'mobile screenshot');
    await writeFile(probePath, JSON.stringify({ screenshotPath: probeScreenshot, screenshotSha256: hash(await readFile(probeScreenshot)), observedNodes: [{ text: 'mobile fact' }] }));
    f.evidence.responsiveObservations = [{ evidencePath: probePath, evidenceSha256: hash(await readFile(probePath)), screenshotPath: probeScreenshot }];
    f.evidence.packet = { path: probePath, sha256: hash(await readFile(probePath)) };
    await f.save();
    const sourceBytes = new Map(await Promise.all([f.reportPath, f.evidencePath, f.screenshotPath, f.domPath, probePath, probeScreenshot].map(async filename => [filename, await readFile(filename)] as const)));
    const result = await relocateReferenceEvidence({ root: f.root, sourceReportPath: f.reportPath, destinationDirectory: f.destination, expectedReportSha256: hash(sourceBytes.get(f.reportPath)!), expectedSourceUrl: sourceUrl });
    assert.equal(result.report.artifactPath, result.reportPath);
    const evidence = await json(result.report.viewports[0].evidencePath), probe = evidence.responsiveObservations[0], packet = await json(probe.evidencePath);
    assert.equal(path.dirname(probe.evidencePath), f.destination);
    assert.equal(path.dirname(packet.screenshotPath), f.destination);
    assert.equal(probe.evidenceSha256, hash(await readFile(probe.evidencePath)));
    assert.equal(evidence.packet.path, probe.evidencePath);
    assert.equal(evidence.packet.sha256, probe.evidenceSha256);
    assert.equal(evidence.note, f.screenshotPath, 'An arbitrary source string is never path-rewritten');
    for (const [filename, bytes] of sourceBytes) assert.deepEqual(await readFile(filename), bytes);
    assert.equal(result.manifest.sourceDeclaredArtifactPath, f.report.artifactPath);
    assert.equal(result.manifest.artifacts.length, 6);
    assert.equal(result.reportSha256, hash(await readFile(result.reportPath)));
    for (const record of result.manifest.artifacts) { assert.equal(record.sourceUrl, sourceUrl); assert.equal(record.capturedAt, f.report.capturedAt); assert.equal(record.sha256, hash(await readFile(record.destinationPath))); }
  } finally { await f.close(); }
});

test('same basenames in different source directories remain distinct and content hashes preserve their identity', async () => {
  const f = await fixture();
  try {
    const duplicate = path.join(f.extra, 'desktop.png'); await writeFile(duplicate, 'different screenshot');
    f.evidence.packet = { screenshotPath: duplicate }; await f.save();
    const result = await relocateReferenceEvidence({ root: f.root, sourceReportPath: f.reportPath, destinationDirectory: f.destination });
    const evidence = await json(result.report.viewports[0].evidencePath);
    assert.notEqual(evidence.screenshotPath, evidence.packet.screenshotPath);
    assert.equal(await readFile(evidence.screenshotPath, 'utf8'), 'actual screenshot fixture bytes');
    assert.equal(await readFile(evidence.packet.screenshotPath, 'utf8'), 'different screenshot');
  } finally { await f.close(); }
});

test('historical migration records a missing independent inventory without synthesizing it or making evidence fresh', async () => {
  const f = await fixture();
  try {
    f.evidence.blocks = [{ id: 'some-selected-contract-row' }]; await f.save();
    const result = await relocateReferenceEvidence({ root: f.root, sourceReportPath: f.reportPath, destinationDirectory: f.destination });
    assert.deepEqual(result.manifest.missingSceneInventories, ['desktop']);
    assert.equal(result.report.status, 'partial');
    assert.equal(result.report.capturedAt, f.report.capturedAt);
    assert.equal((await json(result.report.viewports[0].evidencePath)).sceneInventory, undefined);
    assert.ok(result.report.gaps.some(gap => gap.code === 'legacy-scene-inventory-missing'));
  } finally { await f.close(); }
});

test('hash mismatches abort the entire graph before destination writes', async () => {
  const f = await fixture();
  try {
    f.evidence.screenshotSha256 = '0'.repeat(64); await f.save();
    await assert.rejects(relocateReferenceEvidence({ root: f.root, sourceReportPath: f.reportPath, destinationDirectory: f.destination }), /byte hash mismatch/);
    await assert.rejects(readdir(f.destination), /ENOENT/);
    await assert.rejects(relocateReferenceEvidence({ root: f.root, sourceReportPath: f.reportPath, destinationDirectory: f.destination, expectedReportSha256: 'f'.repeat(64) }), /report byte hash mismatch/);
    f.evidence.screenshotSha256 = hash(await readFile(f.screenshotPath)); await f.save();
    await assert.rejects(relocateReferenceEvidence({ root: f.root, sourceReportPath: f.reportPath, destinationDirectory: f.destination, expectedArtifactHashes: [{ path: f.screenshotPath, sha256: '0'.repeat(64) }] }), /Validated source artifact byte hash mismatch/);
  } finally { await f.close(); }
});

test('outside-root evidence, protected configuration, session exports and destination escapes are rejected', async () => {
  const f = await fixture();
  try {
    const options = { root: f.root, sourceReportPath: f.reportPath, destinationDirectory: f.destination };
    f.evidence.packetPath = path.join(path.dirname(f.root), 'outside.json'); await f.save();
    await assert.rejects(relocateReferenceEvidence(options), /inside the project root/);
    f.evidence.packetPath = path.join(f.root, 'config', 'credentials.local.json'); await f.save();
    await assert.rejects(relocateReferenceEvidence(options), /Only public evidence/);
    delete f.evidence.packetPath; f.evidence.cookies = [{ value: 'secret' }]; await f.save();
    await assert.rejects(relocateReferenceEvidence(options), /authentication or session exports/);
    delete f.evidence.cookies; await f.save();
    await assert.rejects(relocateReferenceEvidence({ ...options, destinationDirectory: path.dirname(f.root) }), /inside the project root/);
    await assert.rejects(readdir(f.destination), /ENOENT/);
  } finally { await f.close(); }
});
