import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { writeJson } from '../src/core/files.js';
import { prepareOriginalReference as prepareReference, prepareReference as prepareActiveReference } from '../src/reference/prepare.js';
import { prepareReferenceBrief } from '../src/reference/brief.js';
import type { captureReference } from '../src/reference/capture.js';
import type { BusinessProfile, ReferenceCaptureReport, ReferencePreparedJob } from '../src/reference/types.js';

const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixtureRoot(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'clonewp-reference-prepare-'));
  t.after(async () => {
    const relative = path.relative(tmpdir(), root);
    assert.ok(relative.startsWith('clonewp-reference-prepare-') && !relative.includes(path.sep));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
const offlineCapture: typeof captureReference = async (url, options) => {
  await mkdir(options.referenceDir, { recursive: true });
  const screenshotPath = path.join(options.referenceDir, 'desktop.png'), domPath = path.join(options.referenceDir, 'desktop.html'), evidencePath = path.join(options.referenceDir, 'desktop.json');
  await sharp({ create: { width: 16, height: 16, channels: 3, background: '#BED3C2' } }).png().toFile(screenshotPath);
  await writeFile(domPath, '<main><h1>Observed source heading only</h1></main>', 'utf8');
  const report: ReferenceCaptureReport = {
    version: 1, url, capturedAt: '2026-10-13T04:00:00Z', status: 'complete', evidenceNotice: 'Offline fixture; source facts remain untrusted.', gaps: [], artifactPath: path.join(options.referenceDir, 'report.json'),
    viewports: [{ name: 'desktop', width: 1440, height: 900, title: 'Observed source title', pageHeight: 2400, screenshotPath, domPath, evidencePath,
      headings: [{ level: 1, text: 'Observed source heading only', selector: 'h1', rect: { x: 50, y: 100, width: 600, height: 100 } }], navigation: [], ctas: [], images: [], typography: [], colors: [],
      sections: [{ id: 'hero', role: 'hero', inferred: true, confidence: 0.8, selector: 'main', rect: { x: 0, y: 100, width: 1440, height: 600 } }],
      layout: { hero: { layout: 'text-led' }, density: 'balanced', cardColumns: 2 }, disclosures: [], metadata: { language: 'en' }, counts: { headings: 1, visibleNodes: 10 },
    }],
  };
  await writeJson(evidencePath, report.viewports[0]); await writeJson(report.artifactPath, report);
  return report;
};
function currentProfile(brand: string, assetPath?: string): BusinessProfile {
  return {
    version: 1, brand, language: 'en', demo: true, description: `An original ${brand} demonstration for the current task.`,
    business: 'Current independently authored outdoor design concept', audience: 'People exploring calm outdoor moments', goal: 'Introduce the current original demonstration ideas',
    hero: { eyebrow: 'A FRESH OUTDOOR CONCEPT', title: `${brand}: find a little space.`, description: 'Current original copy about calm outdoor moments.', primaryLabel: 'Explore our ideas' },
    services: [{ key: 'trail', title: 'A little room to wander.', description: 'Our current original guide to a gentle trail moment.' }],
    faq: [{ title: 'Is this a demonstration?', content: 'Yes, this current original demonstration has no real bookings or subscriptions.' }],
    cta: { title: 'Find a little space.', description: 'Current closing words for the outdoor demonstration.', label: 'Explore our ideas' },
    assets: assetPath ? [{ key: 'hero', path: assetPath, alt: `Original ${brand} artwork`, provenance: `Independent fixture artwork for this ${brand} task` }] : [],
  };
}
async function freshJob(root: string): Promise<ReferencePreparedJob> {
  return prepareReference('https://8.8.8.8/', { root, capture: offlineCapture });
}

test('URL intake saves reference evidence with no business profile, credentials, proposal or global defaults required', async t => {
  const root = await fixtureRoot(t), progress: string[] = [];
  const job = await prepareReference('https://8.8.8.8/', { root, capture: offlineCapture, onProgress: message => progress.push(message) });
  assert.equal(job.status, 'awaiting-business-profile');
  assert.equal(job.referenceReportSha256, checksum(await readFile(job.referencePath)));
  assert.deepEqual((await readdir(job.jobDir)).sort(), ['job.json', 'reference']);
  assert.equal(job.proposalPath, undefined); assert.equal(job.generationBriefPath, undefined);
  assert.ok(progress.includes('read-only-reference-capture')); assert.ok(progress.includes('awaiting-business-profile'));
  assert.doesNotMatch(await readFile(path.join(job.jobDir, 'job.json'), 'utf8'), /MoriPaws|hero-pets|original-starting-proposal/);
});

test('active URL intake now awaits a block contract, retains source copy and never creates a business profile or original proposal', async t => {
  const root = await fixtureRoot(t), job = await prepareActiveReference('https://8.8.8.8/', { root, capture: offlineCapture });
  assert.equal(job.workflow, 'block-replication'); assert.equal(job.status, 'awaiting-block-contract');
  assert.equal(path.basename(job.contractPath), 'block-contract.json'); assert.equal(path.basename(job.programPath), 'program.json');
  assert.deepEqual((await readdir(job.jobDir)).sort(), ['job.json', 'reference', 'requirement-profile.json']);
  assert.doesNotMatch(await readFile(path.join(job.jobDir, 'job.json'), 'utf8'), /profilePath|MoriPaws|Pawberry|proposal/);
});

test('invalid previous global brand and credential files are ignored by fresh URL intake', async t => {
  const root = await fixtureRoot(t);
  await mkdir(path.join(root, 'config'));
  await writeFile(path.join(root, 'config/business-profile.json'), 'INVALID PRIOR MoriPaws PROFILE - DO NOT READ');
  await writeFile(path.join(root, 'config/credentials.local.json'), 'INVALID CREDENTIALS - DO NOT READ');
  const job = await freshJob(root);
  assert.equal(job.status, 'awaiting-business-profile');
  assert.deepEqual((await readdir(job.jobDir)).sort(), ['job.json', 'reference']);
  assert.equal(await readFile(path.join(root, 'config/business-profile.json'), 'utf8'), 'INVALID PRIOR MoriPaws PROFILE - DO NOT READ');
});

test('missing current job brief errors safely without substituting a valid previous global brand', async t => {
  const root = await fixtureRoot(t);
  await writeJson(path.join(root, 'config/business-profile.json'), currentProfile('PreviousBrand'));
  const job = await freshJob(root);
  await assert.rejects(prepareReferenceBrief(job.jobDir, { root }), /needs its own business-profile.json.*no earlier business profile is substituted/);
  assert.deepEqual((await readdir(job.jobDir)).sort(), ['job.json', 'reference']);
  assert.equal(JSON.parse(await readFile(path.join(job.jobDir, 'job.json'), 'utf8')).status, 'awaiting-business-profile');
});

test('only current authored profile and actual own media are frozen, without overwriting authored profile bytes', async t => {
  const root = await fixtureRoot(t), job = await freshJob(root);
  await mkdir(path.join(job.jobDir, 'assets'));
  const ownImage = path.join(job.jobDir, 'assets', 'own.png');
  await sharp({ create: { width: 24, height: 18, channels: 3, background: '#AFB8C9' } }).png().toFile(ownImage);
  await writeJson(job.profilePath, currentProfile('RidgeAndRest', ownImage));
  const originalProfile = await readFile(job.profilePath), finalized = await prepareReferenceBrief(job.jobDir, { root });
  assert.equal(finalized.status, 'awaiting-codex-design');
  assert.deepEqual(await readFile(job.profilePath), originalProfile);
  const proposal = JSON.parse(await readFile(finalized.proposalPath!, 'utf8'));
  assert.equal(proposal.brand, 'RidgeAndRest'); assert.equal(proposal.assets[0].path, ownImage);
  const proofs = JSON.parse(await readFile(path.join(job.jobDir, 'profile-assets.json'), 'utf8'));
  assert.equal(proofs[0].sha256, checksum(await readFile(ownImage)));
  const brief = JSON.parse(await readFile(finalized.generationBriefPath!, 'utf8'));
  assert.equal(brief.profileSha256, checksum(originalProfile));
  assert.equal(brief.referenceReportSha256, checksum(await readFile(job.referencePath)));
  assert.equal(brief.proposalSha256, checksum(await readFile(finalized.proposalPath!)));
  assert.equal(brief.profileAssetsSha256, checksum(await readFile(path.join(job.jobDir, 'profile-assets.json'))));
  assert.deepEqual(brief.evidenceKeys, ['desktop:layout', 'desktop:colors', 'desktop:typography', 'desktop:navigation', 'desktop:hero']);
  assert.ok((await readFile(path.join(job.jobDir, 'proposal/preview/index.html'), 'utf8')).includes('RidgeAndRest'));
});

test('two reference tasks start independently and never inherit the first brand or media', async t => {
  const root = await fixtureRoot(t), first = await freshJob(root);
  await mkdir(path.join(first.jobDir, 'assets'));
  const firstImage = path.join(first.jobDir, 'assets', 'first.png');
  await sharp({ create: { width: 24, height: 18, channels: 3, background: '#B4D2B8' } }).png().toFile(firstImage);
  await writeJson(first.profilePath, currentProfile('RidgeAndRest', firstImage));
  await prepareReferenceBrief(first.jobDir, { root });
  const second = await freshJob(root);
  assert.notEqual(second.jobDir, first.jobDir);
  assert.deepEqual((await readdir(second.jobDir)).sort(), ['job.json', 'reference']);
  await writeJson(second.profilePath, currentProfile('HearthStudio'));
  const completedSecond = await prepareReferenceBrief(second.jobDir, { root });
  const secondProposal = await readFile(completedSecond.proposalPath!, 'utf8');
  assert.equal(JSON.parse(secondProposal).brand, 'HearthStudio');
  assert.deepEqual(JSON.parse(secondProposal).assets, []);
  assert.doesNotMatch(secondProposal, /RidgeAndRest|first.png|MoriPaws/);
});

test('completed reference brief and frozen profile/proposal hashes are immutable when invoked again', async t => {
  const root = await fixtureRoot(t), job = await freshJob(root);
  await writeJson(job.profilePath, currentProfile('RidgeAndRest'));
  const prepared = await prepareReferenceBrief(job.jobDir, { root });
  const protectedFiles = [job.profilePath, prepared.proposalPath!, prepared.generationBriefPath!, path.join(job.jobDir, 'profile-assets.json'), path.join(job.jobDir, 'job.json')];
  const before = await Promise.all(protectedFiles.map(file => readFile(file)));
  await assert.rejects(prepareReferenceBrief(job.jobDir, { root }), /finalized jobs cannot be overwritten/);
  const after = await Promise.all(protectedFiles.map(file => readFile(file)));
  assert.deepEqual(after, before);
});

test('existing frozen artifacts and altered source evidence prevent brief preparation without overwrites', async t => {
  const root = await fixtureRoot(t), existing = await freshJob(root);
  await writeJson(existing.profilePath, currentProfile('RidgeAndRest'));
  await writeFile(path.join(existing.jobDir, 'generation-brief.json'), 'existing immutable proof');
  await assert.rejects(prepareReferenceBrief(existing.jobDir, { root }), /already has generation-brief.json/);
  assert.equal(await readFile(path.join(existing.jobDir, 'generation-brief.json'), 'utf8'), 'existing immutable proof');
  const changed = await freshJob(root);
  await writeJson(changed.profilePath, currentProfile('HearthStudio'));
  const report = JSON.parse(await readFile(changed.referencePath, 'utf8'));
  report.evidenceNotice = 'Later changed report'; await writeJson(changed.referencePath, report);
  await assert.rejects(prepareReferenceBrief(changed.jobDir, { root }), /captured reference report changed/);
  assert.deepEqual((await readdir(changed.jobDir)).sort(), ['business-profile.json', 'job.json', 'reference']);
});

test('brief job path must be a direct real references child and cannot redirect to previous global profile', async t => {
  const root = await fixtureRoot(t), job = await freshJob(root);
  await assert.rejects(prepareReferenceBrief(path.join(root, '..'), { root }), /inside the project/);
  await assert.rejects(prepareReferenceBrief(path.join(job.jobDir, 'reference'), { root }), /directly inside references/);
  await writeJson(path.join(root, 'config/business-profile.json'), currentProfile('PreviousBrand'));
  const metadata = JSON.parse(await readFile(path.join(job.jobDir, 'job.json'), 'utf8'));
  metadata.profilePath = path.join(root, 'config/business-profile.json');
  await writeJson(path.join(job.jobDir, 'job.json'), metadata);
  await assert.rejects(prepareReferenceBrief(job.jobDir, { root }), /only this reference job business-profile.json/);
  const outside = path.join(root, 'outside'); await mkdir(outside);
  const redirected = path.join(root, 'references', 'redirected');
  await symlink(outside, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareReferenceBrief(redirected, { root }), /real references directory/);
});

test('blocked capture retains its gap evidence but creates neither profile nor proposal', async t => {
  const root = await fixtureRoot(t);
  const capture: typeof captureReference = async (url, options) => {
    const report = await offlineCapture(url, options); report.status = 'blocked'; report.viewports = [];
    report.gaps = [{ code: 'challenge', message: 'Public evidence unavailable in fixture' }];
    await writeJson(report.artifactPath, report); return report;
  };
  const job = await prepareReference('https://8.8.8.8/', { root, capture });
  assert.equal(job.status, 'blocked');
  assert.deepEqual((await readdir(job.jobDir)).sort(), ['job.json', 'reference']);
  await assert.rejects(prepareReferenceBrief(job.jobDir, { root }), /not awaiting a fresh business profile/);
});
