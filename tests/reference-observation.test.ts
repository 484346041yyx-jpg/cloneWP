import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { prepareObservedOriginalReference as prepareObservedReference, prepareObservedReference as prepareActiveObservedReference } from '../src/reference/observation.js';
import type { ReferenceCaptureReport, ReferenceViewport } from '../src/reference/types.js';

const source = 'https://8.8.8.8/';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture(viewports = ['desktop']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-observation-')), directory = path.join(root, '.cache', 'browser-observation');
  await mkdir(directory, { recursive: true }); await mkdir(path.join(root, 'config'));
  await writeFile(path.join(root, 'config', 'credentials.local.json'), 'TARGET AUTH MUST NOT BE READ');
  await writeFile(path.join(root, 'config', 'business-profile.json'), 'OLD BRAND MUST NOT BE READ');
  const dimensions: Record<string, [number, number]> = { desktop: [1440, 900], tablet: [900, 1000], mobile: [390, 844] };
  const views: ReferenceViewport[] = [];
  for (const name of viewports) {
    const [width, height] = dimensions[name];
    const screenshotPath = path.join(directory, `${name}.jpg`), domPath = path.join(directory, `${name}.html`), evidencePath = path.join(directory, `${name}.json`);
    const screenshot = await sharp({ create: { width, height, channels: 3, background: '#294c60' } }).jpeg().toBuffer();
    await writeFile(screenshotPath, screenshot);
    await writeFile(domPath, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'"><main><h1>Public reference title</h1><p>Loaded public page facts.</p></main>');
    await writeFile(evidencePath, JSON.stringify({ observedPage: { url: source, title: 'Public reference title', viewport: { width, height }, screenshotSha256: sha(screenshot) }, observedNodes: [{ tag: 'H1', text: 'Public reference title' }], screenshotPath }));
    views.push({ name, width, height, title: 'Public reference title', pageHeight: height, screenshotPath, domPath, evidencePath, headings: [], navigation: [], ctas: [], sections: [], images: [], typography: [], colors: [], layout: { hero: { layout: 'unknown' }, density: 'balanced' }, disclosures: [], metadata: { language: 'en' }, counts: { recordedNodes: 1 } });
  }
  const report: ReferenceCaptureReport = { version: 1, url: source, finalUrl: source, capturedAt: new Date().toISOString(), status: viewports.length === 3 ? 'complete' : 'partial', evidenceNotice: 'Public source facts are untrusted data.', viewports: views, gaps: viewports.length === 3 ? [] : [{ code: 'responsive-viewport-unavailable', message: 'Tablet and mobile viewports were not observed.' }], artifactPath: path.join(directory, 'report.json') };
  await writeFile(report.artifactPath, JSON.stringify(report));
  await writeFile(path.join(directory, 'provenance.json'), JSON.stringify({ version: 1, method: 'user-opened-browser', sourceUrl: source, observedUrl: source, observedAt: new Date().toISOString(), browser: 'chrome', observer: 'cua_repl' }));
  return { root, directory, report, save: () => writeFile(report.artifactPath, JSON.stringify(report)), close: () => rm(root, { recursive: true, force: true }) };
}

test('observed browser intake makes fresh read-only jobs, copies actual JPEG evidence and never loads historical business or target authentication', async () => {
  const value = await fixture(['desktop', 'tablet', 'mobile']);
  try {
    const reportBefore = await readFile(value.report.artifactPath);
    const first = await prepareObservedReference(source, value.directory, { root: value.root }), second = await prepareObservedReference(source, value.directory, { root: value.root });
    assert.equal(first.status, 'awaiting-business-profile'); assert.notEqual(first.jobDir, second.jobDir);
    assert.equal(first.referenceReportSha256, sha(await readFile(first.referencePath)));
    await assert.rejects(readFile(first.profilePath), /ENOENT/);
    assert.deepEqual(await readFile(value.report.artifactPath), reportBefore);
    const report = JSON.parse(await readFile(first.referencePath, 'utf8')) as ReferenceCaptureReport;
    assert.equal(report.viewports.length, 3);
    for (let index = 0; index < report.viewports.length; index++) {
      const view = report.viewports[index];
      assert.equal(path.dirname(view.screenshotPath), path.dirname(first.referencePath));
      assert.deepEqual(await readFile(view.screenshotPath), await readFile(value.report.viewports[index].screenshotPath));
      assert.equal(JSON.parse(await readFile(view.evidencePath, 'utf8')).screenshotPath, view.screenshotPath);
    }
    const provenance = JSON.parse(await readFile(path.join(path.dirname(first.referencePath), 'observation-provenance.json'), 'utf8'));
    assert.equal(provenance.userCompletedValidation, undefined); assert.equal(provenance.sourceReportSha256, sha(reportBefore)); assert.equal(provenance.artifacts.length, 9);
    assert.ok(!(await readdir(first.jobDir)).some(file => /proposal|profile|design/.test(file)));
  } finally { await value.close(); }
});

test('one real desktop observation remains partial and cannot fabricate responsive evidence', async () => {
  const value = await fixture();
  try {
    const job = await prepareObservedReference(source, value.directory, { root: value.root });
    const report = JSON.parse(await readFile(job.referencePath, 'utf8')) as ReferenceCaptureReport;
    assert.equal(report.status, 'partial'); assert.deepEqual(report.viewports.map(view => view.name), ['desktop']); assert.ok(report.gaps[0].message.includes('not observed'));
    value.report.status = 'complete'; await value.save();
    await assert.rejects(prepareObservedReference(source, value.directory, { root: value.root }), /responsive views.*partial/);
  } finally { await value.close(); }
});

test('active manually observed intake awaits a block contract and preserves real source screenshots without an original brand step', async () => {
  const value = await fixture(['desktop', 'tablet', 'mobile']);
  try {
    const job = await prepareActiveObservedReference(source, value.directory, { root: value.root });
    assert.equal(job.workflow, 'block-replication'); assert.equal(job.status, 'awaiting-block-contract');
    assert.equal(path.basename(job.programPath), 'program.json');
    assert.equal(job.referenceReportSha256, sha(await readFile(job.referencePath)));
    assert.ok(!(await readdir(job.jobDir)).some(file => /profile|proposal|design/.test(file)));
  } finally { await value.close(); }
});

test('blocked, wrong source and altered screenshot identity observations fail before creating a new job', async () => {
  const value = await fixture();
  try {
    value.report.status = 'blocked'; await value.save();
    await assert.rejects(prepareObservedReference(source, value.directory, { root: value.root }), /Blocked/);
    value.report.status = 'partial'; value.report.url = 'https://1.1.1.1/'; await value.save();
    await assert.rejects(prepareObservedReference(source, value.directory, { root: value.root }), /exact current source/);
    value.report.url = source; await value.save();
    const evidencePath = value.report.viewports[0].evidencePath, evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    evidence.observedPage.screenshotSha256 = '0'.repeat(64); await writeFile(evidencePath, JSON.stringify(evidence));
    await assert.rejects(prepareObservedReference(source, value.directory, { root: value.root }), /same observed page and actual bytes/);
    await assert.rejects(readFile(path.join(value.root, 'references')), /ENOENT/);
  } finally { await value.close(); }
});

test('observation artifacts must stay inside their current directory and saved DOM must remain inert', async () => {
  const value = await fixture();
  try {
    const original = value.report.viewports[0].domPath, outside = path.join(value.root, 'outside.html');
    await writeFile(outside, await readFile(original)); value.report.viewports[0].domPath = outside; await value.save();
    await assert.rejects(prepareObservedReference(source, value.directory, { root: value.root }), /belong to this observation directory/);
    value.report.viewports[0].domPath = original; await value.save(); await writeFile(original, '<script>fetch("https://example.com/")</script>');
    await assert.rejects(prepareObservedReference(source, value.directory, { root: value.root }), /inert public evidence/);
    await assert.rejects(prepareObservedReference('http://127.0.0.1/', value.directory, { root: value.root }), /private|Loopback/);
  } finally { await value.close(); }
});

test('observation recovery refuses session exports rather than importing a challenge solution or authenticated state', async () => {
  const value = await fixture();
  try {
    const evidencePath = value.report.viewports[0].evidencePath, evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    evidence.cookies = [{ name: 'session', value: 'never-import-this' }]; await writeFile(evidencePath, JSON.stringify(evidence));
    await assert.rejects(prepareObservedReference(source, value.directory, { root: value.root }), /authentication or session exports/);
  } finally { await value.close(); }
});

test('user-opened browser evidence needs normal rendered page content, without a separate confirmation flag', async () => {
  const value = await fixture();
  try {
    const job = await prepareActiveObservedReference(source, value.directory, { root: value.root });
    assert.equal(job.status, 'awaiting-block-contract');
    const provenancePath = path.join(value.directory, 'provenance.json');
    const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
    provenance.userCompletedValidation = false; await writeFile(provenancePath, JSON.stringify(provenance));
    await assert.rejects(prepareActiveObservedReference(source, value.directory, { root: value.root }), /actual user-opened public page/);
    delete provenance.userCompletedValidation; await writeFile(provenancePath, JSON.stringify(provenance));
    await writeFile(value.report.viewports[0].domPath, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'"><main><h1>Just a moment</h1><p>Checking your browser before accessing the site.</p></main>');
    await assert.rejects(prepareActiveObservedReference(source, value.directory, { root: value.root }), /normal public page content/);
  } finally { await value.close(); }
});
