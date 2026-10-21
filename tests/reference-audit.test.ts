import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { checkReferenceDesign } from '../src/reference/audit.js';
import { deriveOriginal } from '../src/reference/derive.js';
import { runOriginal } from '../src/original/runner.js';
import type { OriginalDesign, OriginalNode } from '../src/original/types.js';
import type { BusinessProfile, ReferenceCaptureReport, ReferencePreparedJob } from '../src/reference/types.js';

const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const writeJson = async (file: string, value: unknown) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const flatten = (nodes: OriginalNode[]): OriginalNode[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
const passage = 'SilverWhisker transforms comfortable pet spaces through thoughtful everyday companionship carefully designed routines and remarkable attention to the smallest details.';

interface Fixture {
  root: string; jobDir: string; designPath: string; referencePath: string; profilePath: string;
  reference: ReferenceCaptureReport; profile: BusinessProfile; proposal: OriginalDesign; design: OriginalDesign;
  rationale: { version: number; referenceReportSha256: string; profileSha256: string; decisions: Array<{ evidence: string[]; principle: string; application: string; targetKeys: string[]; changeFromProposal: string }>; contentNotes: string[]; limitations: string[] };
}
async function fixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'clonewp-reference-audit-'));
  t.after(async () => {
    const relative = path.relative(tmpdir(), root);
    assert.ok(relative.startsWith('clonewp-reference-audit-') && !relative.includes(path.sep), 'Temporary cleanup stays inside its named test root');
    await rm(root, { recursive: true, force: true });
  });
  const jobDir = path.join(root, 'references', 'fixture'), ownDir = path.join(root, 'original', 'assets');
  const referenceDir = path.join(jobDir, 'reference');
  await mkdir(ownDir, { recursive: true }); await mkdir(referenceDir, { recursive: true });
  const ownImage = path.join(ownDir, 'own-pets.png'), sourceScreenshot = path.join(referenceDir, 'desktop.png');
  await sharp({ create: { width: 40, height: 32, channels: 3, background: '#E0D5CA' } }).png().toFile(ownImage);
  await sharp({ create: { width: 40, height: 32, channels: 3, background: '#4B9385' } }).png().toFile(sourceScreenshot);
  const ownHash = checksum(await readFile(ownImage));
  const profile: BusinessProfile = {
    version: 1, brand: 'CedarPaws', language: 'en', description: 'An own pet-care demonstration concept.', demo: true,
    business: 'Original everyday pet-care demonstration', audience: 'People sharing their home with pets', goal: 'Explain gentle own care ideas',
    hero: { eyebrow: 'SMALL MOMENTS TOGETHER', title: 'Gentle care, shared days.', description: 'Our own introduction to a quiet moment together.', primaryLabel: 'Explore our ideas', secondaryLabel: 'Our approach' },
    services: [{ key: 'brushing', title: 'A quiet brushing moment.', description: 'An own gentle introduction to everyday brushing.' }, { key: 'rest', title: 'Room for a little rest.', description: 'An own comfortable idea for familiar resting places.' }],
    story: { title: 'An own thoughtful approach.', paragraphs: ['Our own words about noticing the small everyday moments.'] },
    faq: [{ title: 'Is this a demonstration?', content: 'This is an original demonstration brand, with no real products or bookings.' }],
    cta: { title: 'Make room for a shared moment.', description: 'Our own small reminder for everyday company.', label: 'Explore the ideas' },
    assets: [{ key: 'hero', path: ownImage, alt: 'Own pet-care demonstration artwork', provenance: 'Original local test artwork created independently for CedarPaws' }],
  };
  const referencePath = path.join(jobDir, 'reference-report.json'), profilePath = path.join(jobDir, 'business-profile.json');
  const evidencePath = path.join(referenceDir, 'desktop-evidence.json'), domPath = path.join(referenceDir, 'desktop.html');
  const reference: ReferenceCaptureReport = {
    version: 1, url: 'https://silverwhisker.example/', capturedAt: '2026-10-13T04:00:00Z', status: 'complete', evidenceNotice: 'Offline fixture evidence, no network or authentication', artifactPath: referencePath, gaps: [],
    viewports: [{ name: 'desktop', width: 1440, height: 900, title: 'SilverWhisker pet spaces', pageHeight: 3000, screenshotPath: sourceScreenshot, domPath, evidencePath,
      headings: [{ level: 1, text: passage, selector: '#source-title', rect: { x: 40, y: 180, width: 500, height: 170 } }], navigation: [], ctas: [],
      sections: [{ id: 'hero', role: 'hero', inferred: true, confidence: 0.85, selector: '#source-hero', rect: { x: 0, y: 100, width: 1440, height: 600 }, heading: passage, textPreview: passage, imageSide: 'right' }, { id: 'services', role: 'services', inferred: true, confidence: 0.85, selector: '#source-services', rect: { x: 0, y: 800, width: 1440, height: 500 }, heading: 'Source offering cards', columns: 3 }],
      images: [{ url: 'https://silverwhisker.example/source-photo.png', alt: 'Reference photograph', width: 900, height: 700, selector: '#source-photo', loaded: true, rect: { x: 700, y: 180, width: 500, height: 400 } }],
      typography: [{ family: 'Arial, sans-serif', size: 16, weight: '400', lineHeight: '24px', count: 30 }], colors: [{ hex: '#338569', weight: 25, role: 'accent' }],
      layout: { contentWidth: 1200, hero: { layout: 'split', imageSide: 'right' }, density: 'airy', cardColumns: 3, cornerStyle: 'round' }, disclosures: [], metadata: { language: 'en' }, counts: { images: 1, headings: 1 } }],
  };
  await writeJson(evidencePath, reference.viewports[0]);
  await writeFile(domPath, `<main><h1>${passage}</h1></main>`, 'utf8');
  await writeJson(referencePath, reference); await writeJson(profilePath, profile);
  const referenceReportSha256 = checksum(await readFile(referencePath)), profileSha256 = checksum(await readFile(profilePath));
  const proposal = deriveOriginal(reference, profile).design;
  const design = structuredClone(proposal);
  design.sections[1].style!.direction = 'column';
  design.sections[1].children!.forEach(child => child.style!.width = 100);
  flatten(design.sections).find(node => node.key === 'hero-title')!.style!.fontSize = 50;
  const designPath = path.join(jobDir, 'design.json'), proposalPath = path.join(jobDir, 'design-proposal.json'), rationalePath = path.join(jobDir, 'design-rationale.json'), generationBriefPath = path.join(jobDir, 'generation-brief.json');
  const rationale = {
    version: 1, referenceReportSha256, profileSha256,
    decisions: [
      { evidence: ['desktop:hero', 'desktop:layout'], principle: 'Pair a clear main message with independently owned pet imagery.', application: 'Stack the own headline above the artwork to suit this calm target concept.', targetKeys: ['hero'], changeFromProposal: 'Replace the initial split recipe with an intentionally stacked original composition.' },
      { evidence: ['desktop:typography'], principle: 'Keep the target headline readable without crowding its own message.', application: 'Use a smaller heading scale that fits the independently written target copy.', targetKeys: ['hero-title'], changeFromProposal: 'Reduce the proposed hero heading from fifty-eight to fifty pixels.' },
      { evidence: ['desktop:services', 'desktop:colors'], principle: 'Present the target offerings as a simple group with readable text contrast.', application: 'Retain two own offerings in a calm grouping instead of reference catalogue records.', targetKeys: ['offering-collection'], changeFromProposal: 'Keep this native group deliberately while replacing the surrounding hero composition.' },
    ],
    contentNotes: ['All brand copy and artwork come from the saved CedarPaws business profile.'], limitations: ['This fixture proves local checks; it does not claim a live WordPress build.'],
  };
  const evidenceKeys = ['desktop:layout', 'desktop:colors', 'desktop:typography', 'desktop:navigation', 'desktop:hero', 'desktop:services'];
  await writeJson(proposalPath, proposal); await writeJson(designPath, design); await writeJson(rationalePath, rationale);
  await writeJson(path.join(jobDir, 'profile-assets.json'), [{ key: 'hero', path: ownImage, sha256: ownHash, provenance: profile.assets[0].provenance }]);
  await writeJson(generationBriefPath, { referenceReportSha256, profileSha256, evidenceKeys, profileAssetsSha256: checksum(await readFile(path.join(jobDir, 'profile-assets.json'))), proposalSha256: checksum(await readFile(proposalPath)) });
  const job: ReferencePreparedJob = { version: 1, workflow: 'reference-to-original', jobId: 'fixture', url: reference.url, status: 'awaiting-codex-design', jobDir, referencePath, profilePath, proposalPath, generationBriefPath };
  await writeJson(path.join(jobDir, 'job.json'), job);
  return { root, jobDir, designPath, referencePath, profilePath, reference, profile, proposal, design, rationale };
}

test('originality audit accepts deliberately authored native layout with current evidence and real own image bytes', async t => {
  const f = await fixture(t), audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, true); assert.deepEqual(audit.issues, []);
  assert.equal(audit.summary.layoutChanged, true); assert.equal(audit.summary.decisions, 3);
  assert.ok(audit.summary.nativeNodes > audit.summary.sections);
  assert.equal(audit.approvedAssets[0].sha256, checksum(await readFile(f.profile.assets[0].path)));
  const receipt = JSON.parse(await readFile(path.join(f.jobDir, 'originality-audit.json'), 'utf8'));
  assert.equal(receipt.designSha256, checksum(await readFile(f.designPath)));
});

test('unchanged deterministic proposal is rejected even with a plausible written rationale', async t => {
  const f = await fixture(t); await writeJson(f.designPath, f.proposal);
  const audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false); assert.equal(audit.summary.layoutChanged, false);
  assert.ok(audit.issues.some(issue => issue.includes('unchanged deterministic proposal')));
});

test('copy-only changes do not count as deliberate layout authorship', async t => {
  const f = await fixture(t), design = structuredClone(f.proposal);
  flatten(design.sections).find(node => node.key === 'hero-title')!.text = 'Our revised words for little shared moments.';
  await writeJson(f.designPath, design);
  const audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false); assert.equal(audit.summary.layoutChanged, false);
});

test('long source passages absent from own business facts are rejected', async t => {
  const f = await fixture(t);
  flatten(f.design.sections).find(node => node.key === 'hero-description')!.text = passage;
  await writeJson(f.designPath, f.design);
  const audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false); assert.ok(audit.issues.some(issue => issue.includes('long verbatim reference passages')));
});

test('reference website identity cannot become target copy even inside otherwise original text', async t => {
  const f = await fixture(t);
  flatten(f.design.sections).find(node => node.key === 'hero-description')!.text = 'Meet SilverWhisker and share a calm moment together.';
  await writeJson(f.designPath, f.design);
  const audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false); assert.ok(audit.issues.some(issue => issue.includes('reference website identity')));
});

test('reference identity is also excluded from page metadata and user-visible alternative text', async t => {
  const f = await fixture(t);
  f.design.title = 'SilverWhisker — an independently laid out page';
  f.design.assets[0].alt = 'A SilverWhisker companion photograph';
  flatten(f.design.sections).find(node => node.key === 'hero-image')!.alt = 'A SilverWhisker companion photograph';
  await writeJson(f.designPath, f.design);
  const audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false); assert.ok(audit.issues.some(issue => issue.includes('reference website identity')));
});

test('common care language supplied by the own profile does not trigger a source-identity false positive', async t => {
  const f = await fixture(t), jobPath = path.join(f.jobDir, 'job.json');
  const job = JSON.parse(await readFile(jobPath, 'utf8'));
  job.url = 'https://petcare.example/';
  await writeJson(jobPath, job);
  f.reference.url = job.url; await writeJson(f.referencePath, f.reference);
  const updatedHash = checksum(await readFile(f.referencePath));
  const briefPath = path.join(f.jobDir, 'generation-brief.json'), brief = JSON.parse(await readFile(briefPath, 'utf8'));
  brief.referenceReportSha256 = updatedHash; f.rationale.referenceReportSha256 = updatedHash;
  await writeJson(briefPath, brief); await writeJson(path.join(f.jobDir, 'design-rationale.json'), f.rationale);
  // The saved own profile already establishes pet-care as the target's business.
  const audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, true); assert.deepEqual(audit.issues, []);
});

test('reference page URLs and remote image URLs are rejected anywhere in the target design', async t => {
  const f = await fixture(t);
  f.design.description += ` See ${f.reference.url}`;
  f.design.assets[0].provenance += ` Copied from ${f.reference.viewports[0].images[0].url}`;
  await writeJson(f.designPath, f.design);
  const audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false); assert.ok(audit.issues.some(issue => issue.includes('Reference page or media URLs')));
});

test('source screenshot media stays excluded even if a fabricated matching approval record exists', async t => {
  const f = await fixture(t), screenshot = f.reference.viewports[0].screenshotPath;
  f.design.assets[0].path = screenshot;
  await writeJson(f.designPath, f.design);
  await writeJson(path.join(f.jobDir, 'profile-assets.json'), [{ key: 'hero', path: screenshot, sha256: checksum(await readFile(screenshot)), provenance: 'Pretended own-media approval for the reference screenshot' }]);
  const audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false); assert.ok(audit.issues.some(issue => issue.includes('Reference screenshot or source resource')));
});

test('unapproved image and modified own-media bytes fail matching provenance and hash checks', async t => {
  const f = await fixture(t);
  await writeJson(path.join(f.jobDir, 'profile-assets.json'), []);
  let audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false); assert.ok(audit.issues.some(issue => issue.includes('own-media hash and provenance')));
  await writeJson(path.join(f.jobDir, 'profile-assets.json'), [{ key: 'hero', path: f.profile.assets[0].path, sha256: checksum(await readFile(f.profile.assets[0].path)), provenance: f.profile.assets[0].provenance }]);
  await sharp({ create: { width: 40, height: 32, channels: 3, background: '#50505E' } }).png().toFile(f.profile.assets[0].path);
  audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false); assert.ok(audit.issues.some(issue => issue.includes('own-media hash and provenance')));
});

test('matching media bytes alone do not establish ownership when provenance is blank', async t => {
  const f = await fixture(t), asset = f.profile.assets[0];
  await writeJson(path.join(f.jobDir, 'profile-assets.json'), [{ key: asset.key, path: asset.path, sha256: checksum(await readFile(asset.path)), provenance: '   ' }]);
  const outcome = await checkReferenceDesign(f.jobDir, { root: f.root }).then(audit => ({ audit }), error => ({ error }));
  if ('audit' in outcome) {
    assert.equal(outcome.audit.passed, false);
    assert.ok(outcome.audit.issues.some(issue => /provenance/.test(issue)));
  } else assert.match(String(outcome.error), /provenance/);
});

test('new AI artwork needs matching local bytes plus its real generation tool and prompt', async t => {
  const f = await fixture(t), asset = f.design.assets[0];
  asset.key = 'new-artwork'; asset.path = path.join(f.root, 'original', 'assets', 'new-artwork.png');
  await sharp({ create: { width: 40, height: 32, channels: 3, background: '#D2BBBE' } }).png().toFile(asset.path);
  flatten(f.design.sections).find(node => node.key === 'hero-image')!.asset = asset.key;
  await writeJson(f.designPath, f.design);
  const record = { key: asset.key, path: asset.path, sha256: checksum(await readFile(asset.path)), origin: 'ai-generated', provenance: 'New independent artwork created for the target concept' };
  await writeJson(path.join(f.jobDir, 'asset-provenance.json'), [record]);
  let audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false); assert.ok(audit.issues.some(issue => issue.includes('real generation tool and prompt')));
  await writeJson(path.join(f.jobDir, 'asset-provenance.json'), [{ ...record, tool: 'fixture-image-tool', prompt: 'An independent local fixture illustration for target pet care.' }]);
  audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, true);
});

test('frozen proposal and own-media proof cannot be replaced to manufacture a fresh authorship check', async t => {
  const f = await fixture(t), proposalPath = path.join(f.jobDir, 'design-proposal.json');
  const replaced = structuredClone(f.proposal); replaced.sections[1].style!.gap = 901;
  await writeJson(proposalPath, replaced);
  const audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false); assert.ok(audit.issues.some(issue => issue.includes('frozen proposal or own-media proof changed')));
});

test('stale reference or own-profile bytes invalidate matching design rationale', async t => {
  const f = await fixture(t);
  f.reference.evidenceNotice += ' A later observation changed the reference report.'; await writeJson(f.referencePath, f.reference);
  let audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false); assert.ok(audit.issues.some(issue => issue.includes('hashes changed')));
  f.profile.goal += ' A later business preference was supplied.'; await writeJson(f.profilePath, f.profile);
  audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false); assert.ok(audit.issues.some(issue => issue.includes('hashes changed')));
});

test('rationale must cite captured evidence and actual native target nodes', async t => {
  const f = await fixture(t);
  f.rationale.decisions[0].evidence = ['desktop:unobserved-review-conversion'];
  f.rationale.decisions[1].targetKeys = ['nonexistent-native-widget'];
  await writeJson(path.join(f.jobDir, 'design-rationale.json'), f.rationale);
  const audit = await checkReferenceDesign(f.jobDir, { root: f.root });
  assert.equal(audit.passed, false);
  assert.ok(audit.issues.some(issue => issue.includes('unavailable reference evidence')));
  assert.ok(audit.issues.some(issue => issue.includes('missing target nodes')));
});

test('a failed reference audit stops runOriginal before missing credentials are read', async t => {
  const f = await fixture(t); await writeJson(f.designPath, f.proposal);
  await assert.rejects(runOriginal(path.relative(f.root, f.designPath), { root: f.root }), error => {
    assert.ok(error instanceof Error); assert.match(error.message, /Reference-derived design has not passed current originality checks/);
    assert.ok(!/credentials|project\.json|ENOENT/.test(error.message), error.message);
    return true;
  });
});

test('reference checks reject directories outside the current references job level', async t => {
  const f = await fixture(t);
  await assert.rejects(checkReferenceDesign(path.join(f.jobDir, 'reference'), { root: f.root }), /current job inside references/);
  await assert.rejects(checkReferenceDesign(path.join(f.root, '..'), { root: f.root }), /inside the project/);
});
