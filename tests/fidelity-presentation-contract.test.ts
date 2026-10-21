import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSafePresentationSelector, presentationItems, validatePresentationBindings, verifyPresentationDetails, type PresentationViewport, type TargetPresentationEvidence } from '../src/fidelity/presentation-contract.js';
import { blockContractSchema, validateNativeProgram } from '../src/fidelity/validate.js';
import type { BlockContract, NativeProgram } from '../src/fidelity/types.js';

const hash = 'a'.repeat(64), file = { path: 'source.json', sha256: hash };
const state = { status: 'not-applicable' as const, evidence: [] };
const states = { normal: { status: 'observed' as const, evidence: ['facts'] }, hover: state, interaction: state };
function fixture() {
  const region = (id: string, x: number, y: number, width: number, height: number) => ({ id, sourceNodeId: `source-${id}`, evidence: ['facts'], rect: { x, y, width, height }, visible: true });
  const desktop: PresentationViewport = {
    status: 'observed', width: 1280, height: 900, breakpoint: { minWidth: 768 }, evidence: ['facts'],
    regions: [region('track', 20, 80, 1240, 240), region('header-tools', 900, 10, 360, 50)],
    controlGroups: [{ ...region('controls', 1080, 15, 170, 40), ownerId: 'header-tools', layout: 'row', pagination: 'fraction', controls: [
      { ...region('prev', 1080, 15, 40, 40), role: 'previous', disabled: true, glyph: { kind: 'svg', signature: 'viewBox:0 0 24 24;path:M14 5L7 12L14 19', width: 24, height: 24 } },
      { ...region('counter', 1125, 25, 70, 20), role: 'fraction', text: '1 / 6', paint: { fontSize: 14, fontWeight: '400', color: '#0047d2' } },
      { ...region('next', 1200, 15, 40, 40), role: 'next', disabled: false, glyph: { kind: 'svg', signature: 'viewBox:0 0 24 24;path:M7 5L14 12L7 19', width: 24, height: 24 } },
    ] }],
    media: [{ ...region('banner', 20, 80, 1240, 240), mode: 'background', fit: 'cover', objectPosition: '50% 50%', aspectRatio: 1240 / 240, maxClippedRatio: 0 }],
    relations: [
      { id: 'tools-own-controls', kind: 'contains', from: 'header-tools', to: 'controls', evidence: ['facts'] },
      { id: 'controls-above-track', kind: 'non-overlap', from: 'controls', to: 'track', evidence: ['facts'] },
      { id: 'arrow-counter-baseline', kind: 'same-row', from: 'prev', to: 'counter', tolerancePx: 1, evidence: ['facts'] },
    ],
  };
  const mobile: PresentationViewport = {
    status: 'observed', width: 390, height: 844, breakpoint: { maxWidth: 767 }, evidence: ['facts'],
    regions: [region('track', 10, 80, 370, 220), region('header-tools', 10, 310, 370, 30)],
    controlGroups: [{ ...region('controls', 170, 315, 50, 12), ownerId: 'header-tools', layout: 'row', pagination: 'bullets', stateSynchronized: true, controls: [
      { ...region('dot-a', 170, 315, 12, 12), role: 'dot', active: true, paint: { backgroundColor: '#0047d2', borderWidth: 1, borderColor: '#0047d2', borderRadius: 6 } },
      { ...region('dot-b', 196, 315, 12, 12), role: 'dot', active: false, paint: { backgroundColor: '#e2ebf0', borderWidth: 1, borderColor: '#e1d5c9', borderRadius: 6 } },
    ] }],
    media: [{ ...region('banner', 10, 80, 370, 220), mode: 'image', fit: 'contain', objectPosition: '50% 50%', aspectRatio: 370 / 220, maxClippedRatio: 0 }],
    relations: [{ id: 'dots-below-image', kind: 'ordered-before', from: 'banner', to: 'controls', evidence: ['facts'] }],
  };
  const contract: BlockContract = { version: 1, workflow: 'block-replication', sourceUrl: 'https://a.example/', capturedAt: '2026-10-14T01:00:00.000Z', referenceReport: file, evidence: [{ id: 'facts', ...file, kind: 'observation' }], tolerances: { geometryPx: 2, geometryRatio: .1, colorChannel: 2 }, blocks: [{ id: 'feature', role: 'products', presentation: 'carousel', texts: [], assets: [], evidence: ['facts'], geometry: { desktop: { width: 1280, height: 340 }, mobile: { width: 390, height: 350 } }, colors: {}, states, presentationDetails: { version: 1, viewports: { desktop, mobile } } }], limitations: [] };
  const ids = [...new Set([desktop, mobile].flatMap(view => presentationItems(view).map(item => item.id)))];
  // The track and its external sibling controls are children of one native region,
  // rather than incorrectly treating the track as the complete interaction root.
  const program: NativeProgram = { version: 1, workflow: 'block-replication', title: 'Example', sourceUrl: contract.sourceUrl, sourceContract: file, assetsManifest: file, elements: [{ key: 'native-feature', type: 'container', settings: {}, children: [{ key: 'native-track', type: 'nested-carousel', settings: {} }, { key: 'native-tools', type: 'container', settings: {} }] }], blocks: [{ sourceBlockId: 'feature', rootKey: 'native-feature', presentation: 'carousel', bindings: [], states, presentationBindings: ids.map(id => ({ id, elementKey: id === 'track' || id === 'banner' ? 'native-track' : 'native-tools', ...(id === 'track' || id === 'header-tools' ? {} : { relativeSelector: `[data-role="${id}"]` }) })) }], deviations: [] };
  const actual: TargetPresentationEvidence[] = Object.entries(contract.blocks[0].presentationDetails!.viewports).flatMap(([viewport, view]) => presentationItems(view).map(item => ({ viewport, viewportWidth: view.width, blockId: 'feature', id: item.id, found: true, count: 1, evidence: [`actual-${viewport}.json`], rect: { ...item.rect }, visible: item.visible, paint: item.paint ? { ...item.paint } : undefined, ...('layout' in item ? { layout: item.layout, pagination: item.pagination, containedByIds: ['header-tools'] } : {}), ...('role' in item ? { disabled: item.disabled, active: item.active, text: item.text, glyph: item.glyph ? { ...item.glyph } : undefined } : {}), ...('mode' in item ? { mode: item.mode, fit: item.fit, objectPosition: item.objectPosition, aspectRatio: item.aspectRatio, clippedRatio: 0 } : {}) } as TargetPresentationEvidence)));
  for (const [viewport, view] of Object.entries(contract.blocks[0].presentationDetails!.viewports)) for (const group of view.controlGroups) actual.find(row => row.viewport === viewport && row.id === group.id)!.controlInventory = (['previous', 'next', 'fraction', 'dot', 'autoplay'] as const).map(role => ({ role, matched: group.controls.filter(control => control.role === role).length, visible: group.controls.filter(control => control.role === role && control.visible).length }));
  return { contract, program, actual };
}

test('external sibling controls, fraction header and mobile bullets retain separate owners and presentation', () => {
  const value = fixture(); blockContractSchema.parse(value.contract); validateNativeProgram(value.program);
  assert.deepEqual(validatePresentationBindings(value.contract, value.program), []);
  const report = verifyPresentationDetails(value.contract, value.program, value.actual);
  assert.equal(report.passed, true, JSON.stringify(report.issues)); assert.equal(report.coverage.length, 2);
});

test('working arrows do not excuse displaced counter, changed weight, or replacement bullets', () => {
  const value = fixture(), counter = value.actual.find(item => item.id === 'counter')!;
  counter.rect!.y += 30; counter.paint!.fontWeight = '700'; value.actual.find(item => item.id === 'controls' && item.viewport === 'desktop')!.pagination = 'bullets';
  const report = verifyPresentationDetails(value.contract, value.program, value.actual);
  for (const code of ['presentation-rect-y', 'presentation-paint-fontWeight', 'presentation-pagination', 'presentation-relation-same-row']) assert.ok(report.issues.some(issue => issue.code === code));
  assert.equal(report.status, 'failed');
});

test('circle border, active state and SVG glyph shape are compared independently of presence', () => {
  const value = fixture(); value.actual.find(item => item.id === 'dot-b')!.paint!.borderColor = '#ffffff'; value.actual.find(item => item.id === 'dot-a')!.active = false; value.actual.find(item => item.id === 'next')!.glyph!.signature = 'different curve';
  const report = verifyPresentationDetails(value.contract, value.program, value.actual);
  for (const code of ['presentation-paint-borderColor', 'presentation-active', 'presentation-glyph-signature']) assert.ok(report.issues.some(issue => issue.code === code));
});

test('mobile responsive media mode, proportion and actual clipping are required', () => {
  const value = fixture(), media = value.actual.find(item => item.id === 'banner' && item.viewport === 'mobile')!;
  media.mode = 'background'; media.fit = 'cover'; media.aspectRatio = 5; media.clippedRatio = .2;
  const report = verifyPresentationDetails(value.contract, value.program, value.actual);
  for (const code of ['presentation-media-mode', 'presentation-media-fit', 'presentation-media-aspect-ratio', 'presentation-clipping']) assert.ok(report.issues.some(issue => issue.code === code));
});

test('component containment and overlap remain errors even when block boundaries match', () => {
  const value = fixture(); value.actual.find(item => item.id === 'controls' && item.viewport === 'desktop')!.rect!.y = 100;
  assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-relation-contains'));
  assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-relation-non-overlap'));
});

test('control ownership requires actual native containment, not only a source owner label', () => {
  const value = fixture(); value.actual.find(item => item.id === 'controls' && item.viewport === 'desktop')!.containedByIds = ['track'];
  assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-owner'));
});

test('viewport and breakpoint mismatches cannot borrow desktop evidence for mobile', () => {
  const value = fixture(); value.actual.find(item => item.viewport === 'mobile')!.viewportWidth = 1280;
  assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-viewport-width'));
  value.contract.blocks[0].presentationDetails!.viewports.mobile.breakpoint = { minWidth: 768 };
  assert.throws(() => validatePresentationBindings(value.contract, value.program), /breakpoint/);
});

test('unknown ownership, crossing native roots and fabricated source evidence fail before target authentication', () => {
  let value = fixture(); value.contract.blocks[0].presentationDetails!.viewports.desktop.controlGroups[0].ownerId = 'not-a-region'; assert.throws(() => validatePresentationBindings(value.contract, value.program), /owner/);
  value = fixture(); value.program.blocks[0].presentationBindings![0].elementKey = 'foreign-block'; assert.throws(() => validatePresentationBindings(value.contract, value.program), /crosses/);
  value = fixture(); value.contract.blocks[0].presentationDetails!.viewports.desktop.regions[0].evidence = ['fake']; assert.throws(() => validatePresentationBindings(value.contract, value.program), /known evidence/);
});

test('legacy and unobserved presentation remain explicit incomplete coverage, never precision passed', () => {
  let value = fixture(); delete value.contract.blocks[0].presentationDetails; delete value.program.blocks[0].presentationBindings;
  let report = verifyPresentationDetails(value.contract, value.program, value.actual); assert.equal(report.passed, false); assert.equal(report.status, 'needs-review'); assert.ok(report.coverage.every(item => item.status === 'missing'));
  value = fixture(); value.contract.blocks[0].presentationDetails!.viewports.mobile.status = 'unobserved'; value.contract.blocks[0].presentationDetails!.viewports.mobile.note = 'Reference mobile verification unavailable';
  report = verifyPresentationDetails(value.contract, value.program, value.actual); assert.equal(report.status, 'needs-review'); assert.equal(report.coverage[1].status, 'unobserved');
  delete value.contract.blocks[0].presentationDetails!.viewports.mobile.note; assert.throws(() => validatePresentationBindings(value.contract, value.program), /named gap/);
});

test('missing, ambiguous and duplicate target probes do not reuse expected rectangles', () => {
  let value = fixture(); value.actual = value.actual.filter(item => item.id !== 'counter'); assert.equal(verifyPresentationDetails(value.contract, value.program, value.actual).status, 'failed');
  value = fixture(); value.actual[0].count = 2; assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-unmeasured'));
  value = fixture(); value.actual.push(value.actual[0]); assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-measurement-duplicate'));
});

test('unmeasured arrow glyph and paint stay explicit instead of claiming visual equality', () => {
  const value = fixture(); delete value.contract.blocks[0].presentationDetails!.viewports.desktop.controlGroups[0].controls[0].glyph;
  const report = verifyPresentationDetails(value.contract, value.program, value.actual); assert.equal(report.status, 'needs-review'); assert.ok(report.issues.some(issue => issue.code === 'presentation-glyph-source-unobserved'));
  delete value.actual.find(item => item.id === 'counter')!.paint; assert.equal(verifyPresentationDetails(value.contract, value.program, value.actual).status, 'failed');
});

test('bounded descendant selectors reject global escapes and invalid CSS fragments', () => {
  for (const selector of ['body .counter', 'html', '.arrow, .global', '+ .neighbor', ':has(.counter)', '*', '.thing{color:red}', '.foo\\bar']) assert.equal(isSafePresentationSelector(selector), false, selector);
  for (const selector of ['.header-controls .counter', '[data-role="previous"]', ':scope > .arrow:nth-of-type(2)']) assert.equal(isSafePresentationSelector(selector), true, selector);
});

test('NaN/Infinity native calculated dimensions reject locally while ordinary Infinity copy remains text', () => {
  for (const settings of [{ margin_mobile: { unit: 'custom', top: 'calc(NaNpx)' } }, { width: { size: Infinity } }, { custom_css: 'selector{height:calc(Infinity * 1px)}' }, { padding: { top: 'NaNpx' } }]) {
    const value = fixture(); value.program.elements[0].settings = settings; assert.throws(() => validateNativeProgram(value.program), /Non-finite/);
  }
  const value = fixture(); value.program.elements[0].settings = { title: 'Infinity' }; assert.doesNotThrow(() => validateNativeProgram(value.program));
});

test('explicit native capability gaps keep observed source intact and never become precision passes', () => {
  const value = fixture(); value.program.blocks[0].presentationGaps = [{ viewport: 'desktop', id: 'counter', capability: 'Native query widget has no fraction pager', reason: 'Actual registered native query controls provide only bullet pagination.', evidence: ['facts'] }];
  value.program.blocks[0].presentationBindings = value.program.blocks[0].presentationBindings!.filter(item => item.id !== 'counter');
  value.actual = value.actual.filter(item => item.id !== 'counter'); value.actual.find(item => item.id === 'controls' && item.viewport === 'desktop')!.pagination = 'none';
  assert.doesNotThrow(() => validatePresentationBindings(value.contract, value.program));
  const report = verifyPresentationDetails(value.contract, value.program, value.actual);
  assert.equal(report.status, 'failed'); assert.equal(report.passed, false); assert.equal(value.contract.blocks[0].presentationDetails!.viewports.desktop.status, 'observed');
  assert.ok(report.issues.some(issue => issue.code === 'native-capability-gap' && issue.severity === 'error')); assert.ok(report.issues.some(issue => issue.code === 'presentation-pagination'));
  value.program.blocks[0].presentationGaps[0].id = 'invented'; assert.throws(() => validatePresentationBindings(value.contract, value.program), /missing|observed source item/);
});

test('a glyph capability gap does not waive arrow geometry, paint or ownership', () => {
  const value = fixture(); value.program.blocks[0].presentationGaps = [{ viewport: 'desktop', id: 'next', scope: 'glyph', capability: 'Exact arrow SVG unsupported', reason: 'Registered native query navigation does not expose a custom glyph control.', evidence: ['facts'] }];
  value.actual.find(item => item.id === 'next')!.glyph!.signature = 'native alternative';
  assert.equal(verifyPresentationDetails(value.contract, value.program, value.actual).status, 'failed');
  value.actual.find(item => item.id === 'next')!.rect!.x -= 80;
  const report = verifyPresentationDetails(value.contract, value.program, value.actual); assert.equal(report.status, 'failed'); assert.ok(report.issues.some(issue => issue.code === 'presentation-rect-x'));
});

test('fraction count is valid across asynchronous autoplay positions and exact synchronized mode remains available', () => {
  const value = fixture(); value.actual.find(item => item.id === 'counter')!.text = '4 / 6';
  assert.equal(verifyPresentationDetails(value.contract, value.program, value.actual).passed, true);
  value.actual.find(item => item.id === 'counter')!.text = '8 / 6'; assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-fraction-text'));
  value.actual.find(item => item.id === 'counter')!.text = '4 / 6'; value.contract.blocks[0].presentationDetails!.viewports.desktop.controlGroups[0].controls[1].textMatch = 'exact';
  assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-text'));
});

test('same-size wrong responsive asset fails while absent byte provenance stays honestly unverified', () => {
  const value = fixture(), expected = value.contract.blocks[0].presentationDetails!.viewports.mobile.media[0];
  expected.assetKey = 'mobile-art'; expected.sourceURL = 'https://a.example/mobile.png'; value.contract.blocks[0].assets.push('mobile-art');
  const actual = value.actual.find(item => item.id === 'banner' && item.viewport === 'mobile')!; actual.assetKey = 'desktop-art'; actual.sourceURL = 'https://a.example/desktop.png';
  const wrong = verifyPresentationDetails(value.contract, value.program, value.actual); assert.equal(wrong.status, 'failed'); assert.ok(wrong.issues.some(issue => issue.code === 'presentation-media-assetKey'));
  delete actual.assetKey; delete actual.sourceURL; const absent = verifyPresentationDetails(value.contract, value.program, value.actual); assert.equal(absent.status, 'needs-review');
});

test('expected control absence requires a unique measured owner and a real zero-visible search', () => {
  const value = fixture(), group = value.contract.blocks[0].presentationDetails!.viewports.desktop.controlGroups[0];
  group.controls = []; group.pagination = 'none'; group.absentControls = ['previous', 'next'];
  value.contract.blocks[0].presentationDetails!.viewports.desktop.relations = [];
  value.program.blocks[0].presentationBindings = value.program.blocks[0].presentationBindings!.filter(item => !['prev', 'counter', 'next'].includes(item.id));
  const target = value.actual.find(item => item.id === 'controls' && item.viewport === 'desktop')!;
  target.controlInventory!.forEach(row => { row.visible = 0; row.matched = 0; });
  target.pagination = 'none'; target.controlAbsence = { ownerCount: 1, checked: [{ role: 'previous', selector: '.native-prev', matched: 1, visible: 0 }, { role: 'next', selector: '.native-next', matched: 1, visible: 0 }] };
  assert.equal(verifyPresentationDetails(value.contract, value.program, value.actual).passed, true);
  target.controlAbsence.checked[1].visible = 1; assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-unexpected-control'));
  target.controlAbsence.checked[1].visible = 0; target.controlAbsence.ownerCount = 0; assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-absence-unmeasured'));
  target.controlAbsence.ownerCount = 1; target.found = false; assert.equal(verifyPresentationDetails(value.contract, value.program, value.actual).status, 'failed');
});

test('small controls cannot borrow a broad block tolerance and capability declarations never hide defects', () => {
  const value = fixture(); value.contract.tolerances.geometryPx = 20;
  value.actual.find(item => item.id === 'next')!.rect!.y += 9;
  assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-rect-y' && issue.id === 'next'));
});

test('edge attachment, fill and measured gaps catch self-consistent but wrong internal placement', () => {
  const value = fixture(), view = value.contract.blocks[0].presentationDetails!.viewports.desktop;
  view.relations = [{ id: 'tools-top', kind: 'attach', from: 'controls', to: 'header-tools', axis: 'y', edge: 'start', valuePx: 5, evidence: ['facts'] }, { id: 'arrow-counter-gap', kind: 'gap', from: 'prev', to: 'counter', axis: 'x', valuePx: 5, evidence: ['facts'] }];
  assert.equal(verifyPresentationDetails(value.contract, value.program, value.actual).passed, true);
  value.actual.find(item => item.id === 'controls' && item.viewport === 'desktop')!.rect!.y += 2.5;
  value.actual.find(item => item.id === 'counter')!.rect!.x += 4;
  const report = verifyPresentationDetails(value.contract, value.program, value.actual);
  assert.ok(report.issues.some(issue => issue.code === 'presentation-relation-attach')); assert.ok(report.issues.some(issue => issue.code === 'presentation-relation-gap'));
  view.relations[0] = { id: 'tools-fill', kind: 'fill', from: 'controls', to: 'header-tools', axis: 'y', evidence: ['facts'] };
  assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-relation-fill'));
});

test('unexpected pause controls, wrong dot count and unmeasured inventories cannot pass', () => {
  const value = fixture(), group = value.actual.find(item => item.id === 'controls' && item.viewport === 'desktop')!;
  group.controlInventory!.find(row => row.role === 'autoplay')!.visible = 1; group.controlInventory!.find(row => row.role === 'autoplay')!.matched = 1;
  assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-control-cardinality'));
  delete group.controlInventory;
  assert.equal(verifyPresentationDetails(value.contract, value.program, value.actual).passed, false);
});

test('own-product fraction totals use proved target query pagination rather than copied source totals', () => {
  const value = fixture(), expected = value.contract.blocks[0].presentationDetails!.viewports.desktop.controlGroups[0].controls[1], actual = value.actual.find(item => item.id === 'counter')!;
  expected.fractionTotal = 'target-query'; actual.text = '2 / 4'; actual.fractionQuery = { productCount: 11, pageSize: 3, totalPages: 4, evidence: ['actual-native-query.json'] };
  assert.equal(verifyPresentationDetails(value.contract, value.program, value.actual).passed, true);
  actual.fractionQuery.totalPages = 5;
  assert.ok(verifyPresentationDetails(value.contract, value.program, value.actual).issues.some(issue => issue.code === 'presentation-fraction-query-unmeasured'));
});
