import test from 'node:test';
import assert from 'node:assert/strict';
import { blockContractSchema, validateContentBoundsBindings, validateNativeProgram } from '../src/fidelity/validate.js';
import { verifyFidelity } from '../src/fidelity/verify.js';
import type { BlockContract, NativeProgram } from '../src/fidelity/types.js';
import type { TargetElementEvidence, TargetViewportEvidence } from '../src/verification/types.js';

const none = { status: 'not-applicable' as const, evidence: [] };
function fixture() {
  const contract: BlockContract = {
    version: 1, workflow: 'block-replication', sourceUrl: 'https://8.8.8.8/', capturedAt: '2026-10-13T09:30:00Z',
    referenceReport: { path: 'source.json', sha256: '0'.repeat(64) },
    evidence: [{ id: 'source-dom', path: 'desktop.json', sha256: '0'.repeat(64), kind: 'dom' }],
    tolerances: { geometryPx: 20, geometryRatio: .15, colorChannel: 4 }, limitations: [],
    blocks: [{ id: 'services', role: 'services', presentation: 'grid', texts: [], assets: [], evidence: ['source-dom'],
      geometry: { desktop: { width: 1440, height: 300 }, tablet: { width: 900, height: 300 }, mobile: { width: 390, height: 500 } },
      contentBounds: {
        desktop: { x: 80, width: 1280, viewportWidth: 1440, sourceNodeId: 'services-content', evidence: ['source-dom'] },
        tablet: { x: 90, width: 720, viewportWidth: 900, sourceNodeId: 'services-content', evidence: ['source-dom'] },
        mobile: { x: 20, width: 350, viewportWidth: 390, sourceNodeId: 'services-content', evidence: ['source-dom'] },
      }, colors: {}, states: { normal: none, hover: none, interaction: none } }],
  };
  const program: NativeProgram = {
    version: 1, workflow: 'block-replication', title: 'Native centered content', sourceUrl: contract.sourceUrl,
    sourceContract: { path: 'contract.json', sha256: '0'.repeat(64) }, assetsManifest: { path: 'manifest.json', sha256: '0'.repeat(64) }, deviations: [],
    elements: [{ key: 'services-root', type: 'container', settings: {}, children: [{ key: 'services-content', type: 'container', settings: {} }] }],
    blocks: [{ sourceBlockId: 'services', rootKey: 'services-root', presentation: 'grid', bindings: [], contentBindings: { desktop: 'services-content', tablet: 'services-content', mobile: 'services-content' }, states: contract.blocks[0].states }],
  };
  return { contract, program };
}
function view(name: string, width: number, inset: number, contentWidth: number, height: number): TargetViewportEvidence {
  const element = (sourceId: string, x: number, rectWidth: number): TargetElementEvidence => ({ sourceId, targetId: sourceId, selector: `[data-id="${sourceId}"]`, found: true, count: 1, nativeElement: true, visible: true, text: '', rect: { x, y: 0, width: rectWidth, height }, style: {}, images: [] });
  return { name, width, height: 900, url: 'https://8.8.8.8/', title: 'Actual native draft', pageHeight: height,
    screenshotPath: `${name}.png`, evidencePath: `${name}.json`, elements: [element('services-root', 0, width), element('services-content', inset, contentWidth)],
    overflow: [], clipping: [], imageFailures: [], consoleErrors: [], pageErrors: [], responseStatus: 200 };
}
const views = () => [view('desktop', 1440, 80, 1280, 300), view('tablet', 900, 90, 720, 300), view('mobile', 390, 20, 350, 500)];

test('a correct full-bleed block width cannot hide lost content gutters within relative size tolerance', () => {
  const { contract, program } = fixture(), target = views();
  target[0].elements[1].rect = { x: 0, y: 0, width: 1440, height: 300 };
  const report = verifyFidelity(contract, program, target);
  assert.equal(report.structurePassed, false);
  assert.equal(report.issues.some(issue => issue.code === 'block-geometry'), false, 'the unchanged background still has matching outer geometry');
  assert.ok(report.issues.some(issue => issue.code === 'content-bounds-width'));
  assert.ok(report.issues.some(issue => issue.code === 'content-bounds-leftInset'));
  assert.ok(report.issues.some(issue => issue.code === 'content-bounds-rightInset'));
});

test('a full-bleed background with its own evidenced centered native content passes at all viewports', () => {
  const { contract, program } = fixture();
  assert.doesNotThrow(() => validateContentBoundsBindings(contract, program));
  assert.doesNotThrow(() => blockContractSchema.parse(contract));
  assert.doesNotThrow(() => validateNativeProgram(program));
  const report = verifyFidelity(contract, program, views());
  assert.equal(report.structurePassed, true);
  assert.equal(report.passed, false, 'Legacy bounds evidence does not prove internal control or media precision');
  assert.equal(report.presentationDetails.status, 'needs-review');
  assert.equal(report.contentBoundsChecks?.length, 3);
  assert.ok(report.contentBoundsChecks?.every(check => check.status === 'verified' && check.evidence.includes(`${check.viewport}.json`)));
});

test('horizontal position and both insets are checked even when content width is exact', () => {
  const { contract, program } = fixture(), target = views(); target[0].elements[1].rect.x += 30;
  const report = verifyFidelity(contract, program, target);
  assert.equal(report.structurePassed, false);
  assert.equal(report.issues.some(issue => issue.code === 'content-bounds-width'), false);
  assert.ok(report.issues.some(issue => issue.code === 'content-bounds-leftInset'));
  assert.ok(report.issues.some(issue => issue.code === 'content-bounds-rightInset'));
});

test('each responsive content box uses its own measured viewport rather than the desktop gutter', () => {
  const { contract, program } = fixture(), target = views(); target[2].elements[1].rect.x = 80; target[2].elements[1].rect.width = 230;
  const report = verifyFidelity(contract, program, target);
  assert.equal(report.contentBoundsChecks?.find(check => check.viewport === 'desktop')?.status, 'verified');
  assert.equal(report.contentBoundsChecks?.find(check => check.viewport === 'mobile')?.status, 'failed');
  assert.ok(report.issues.filter(issue => issue.code.startsWith('content-bounds-') && issue.severity === 'error').every(issue => issue.viewport === 'mobile'));
});

test('declared source bounds require an owned native binding and real unique browser measurement', () => {
  const { contract, program } = fixture(); delete program.blocks[0].contentBindings!.desktop;
  assert.throws(() => validateContentBoundsBindings(contract, program), /missing or crosses/);
  assert.equal(verifyFidelity(contract, program, views()).structurePassed, false);
  const second = fixture(), target = views(); target[0].elements[1].count = 2;
  assert.ok(verifyFidelity(second.contract, second.program, target).issues.some(issue => issue.code === 'content-bounds-unmeasured'));
});

test('another source block cannot be bound as the measured content even with identical rects', () => {
  const { contract, program } = fixture();
  program.elements.push({ key: 'foreign-content', type: 'container', settings: {} }); program.blocks[0].contentBindings!.desktop = 'foreign-content';
  assert.throws(() => validateContentBoundsBindings(contract, program), /crosses its source block/);
  const target = views(); target[0].elements.push({ ...target[0].elements[1], sourceId: 'foreign-content' });
  assert.ok(verifyFidelity(contract, program, target).issues.some(issue => issue.code === 'content-bounds-binding' && issue.severity === 'error'));
});

test('unobserved source bounds remain an explicit gap and never inherit guessed padding', () => {
  const { contract, program } = fixture(); delete contract.blocks[0].contentBounds; delete program.blocks[0].contentBindings;
  const report = verifyFidelity(contract, program, views());
  assert.equal(report.structurePassed, true); assert.equal(report.passed, false); assert.equal(report.status, 'needs-review');
  assert.equal(report.issues.filter(issue => issue.code === 'source-content-bounds-unverified').length, 3);
});

test('measured scrollbar-centred source content may cross the viewport by its declared pixel tolerance only', () => {
  const { contract } = fixture();
  contract.blocks[0].contentBounds!.desktop = { ...contract.blocks[0].contentBounds!.desktop, x: -7.5, width: 1200 };
  assert.doesNotThrow(() => blockContractSchema.parse(contract));
  contract.blocks[0].contentBounds!.desktop.x = -contract.tolerances.geometryPx - 1;
  assert.throws(() => blockContractSchema.parse(contract), /fit its measured viewport/);
});

test('source bounds reject unknown proof, impossible geometry and mismatched viewport measurement', () => {
  const { contract, program } = fixture(); contract.blocks[0].contentBounds!.desktop.evidence = ['invented-proof'];
  assert.throws(() => validateContentBoundsBindings(contract, program), /known evidence/);
  const second = fixture(); second.contract.blocks[0].contentBounds!.desktop.x = 200;
  assert.throws(() => blockContractSchema.parse(second.contract), /fit its measured viewport/);
  const third = fixture(), target = views(); target[0].width = 1920;
  assert.ok(verifyFidelity(third.contract, third.program, target).issues.some(issue => issue.code === 'content-bounds-viewport'));
});

test('wide desktop max-width centering is retained instead of turning content into viewport width', () => {
  const { contract, program } = fixture();
  contract.blocks[0].geometry.desktop.width = 1920; contract.blocks[0].contentBounds!.desktop = { x: 240, width: 1440, viewportWidth: 1920, sourceNodeId: 'services-content', evidence: ['source-dom'] };
  const target = views(); target[0] = view('desktop', 1920, 240, 1440, 300);
  assert.equal(verifyFidelity(contract, program, target).structurePassed, true);
  target[0].elements[1].rect.x = 0; target[0].elements[1].rect.width = 1920;
  assert.equal(verifyFidelity(contract, program, target).structurePassed, false);
});
