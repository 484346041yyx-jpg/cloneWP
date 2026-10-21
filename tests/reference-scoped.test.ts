import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeScopedSourcePackets, type SourceBoundaryInventory, type ScopedSourceReceipt } from '../src/reference/scoped.js';
import type { SourceSceneItem } from '../src/reference/source-scene.js';

function fixture() {
  const observedPage = { url: 'https://example.com/', title: 'Observed page', viewport: { width: 1440, height: 900 }, pageHeight: 4000 };
  const boundary: SourceBoundaryInventory = { version: 1, observedPage, blocks: [{ id: 'first', selectors: ['#one', '#two'], sourceIndices: [0, 1] }, { id: 'second', selectors: ['#three'], sourceIndices: [2] }], boundaryObservation: { candidates: [{ selector: '#one', sourceIndex: 0, ownerBlockId: 'first' }, { selector: '#two', sourceIndex: 1, ownerBlockId: 'first' }, { selector: '#three', sourceIndex: 2, ownerBlockId: 'second' }] } };
  const item = (id: string, kind: SourceSceneItem['kind'], selector: string): SourceSceneItem => ({ id: `${id}-${kind}`, kind, selector, sourceBlockId: id, rect: { x: 0, y: 0, width: 100, height: 20 }, visible: true, required: true, state: 'resting', facts: { order: 0 }, evidence: ['independent-public-DOM-enumeration'] });
  const packets: ScopedSourceReceipt[] = boundary.blocks.map(block => ({ blockId: block.id, evidencePath: `/${block.id}.json`, sha256: 'a'.repeat(64), packet: { version: 1, observedPage: structuredClone(observedPage), blocks: [structuredClone(block)], sourceScene: { version: 1, method: 'independent-public-dom-scene', viewport: { width: 1440, height: 900, clientWidth: 1425, devicePixelRatio: 1, touch: false, coarsePointer: false }, state: 'resting', items: [item(block.id, 'block', block.selectors![0]), item(block.id, 'control', block.selectors!.at(-1)!)], gaps: [{ code: 'scene-scoped-observation', message: 'This packet covers one block only.' }], enumeration: { scope: block.id, rootSelectors: block.selectors } } } }));
  return { boundary, packets };
}

test('complete scoped packets preserve multi-root coverage, restore boundary order and discharge only scoped gaps', () => {
  const f = fixture();
  f.packets[0].packet.sourceScene!.gaps.push({ code: 'scene-control-owner-unresolved', message: 'A control owner remains unknown.' });
  const original = structuredClone(f), result = mergeScopedSourcePackets(f);
  assert.deepEqual(result.blocks.map(block => block.id), ['first', 'second']);
  assert.deepEqual(result.sourceScene!.items.filter(item => item.kind === 'block').map(item => item.facts.order), [0, 1]);
  assert.deepEqual(result.sourceScene!.gaps.map(gap => gap.code), ['scene-control-owner-unresolved']);
  assert.equal(result.mergeReceipt.candidates.length, 3);
  assert.equal(result.mergeReceipt.resolvedGaps.length, 2);
  assert.equal(result.mergeReceipt.blocks[1].order, 1);
  assert.deepEqual(result.mergeReceipt.blocks[0].selectors, ['#one', '#two']);
  assert.deepEqual(f, original, 'Raw independent receipts remain unchanged');
});

test('missing, duplicate and foreign block packets cannot discharge scope limitations', () => {
  const f = fixture();
  assert.throws(() => mergeScopedSourcePackets({ ...f, packets: f.packets.slice(0, 1) }), /incomplete/);
  assert.throws(() => mergeScopedSourcePackets({ ...f, packets: [f.packets[0], f.packets[0]] }), /exactly once/);
  assert.throws(() => mergeScopedSourcePackets({ ...f, packets: [{ ...f.packets[0], blockId: 'foreign' }, f.packets[1]] }), /exactly once/);
});

test('every independent DOM candidate must be uniquely accounted for, including empty layout responsibilities', () => {
  const f = fixture();
  f.boundary.boundaryObservation!.candidates!.push({ selector: '#spacer', sourceIndex: 3 });
  assert.throws(() => mergeScopedSourcePackets(f), /Every independent DOM candidate/);
  f.boundary.boundaryObservation!.candidates!.at(-1)!.excluded = true;
  assert.throws(() => mergeScopedSourcePackets(f), /observed exclusion evidence/);
  f.boundary.boundaryObservation!.candidates!.at(-1)!.exclusionEvidence = ['Measured hidden, empty non-layout DOM child'];
  assert.equal(mergeScopedSourcePackets(f).mergeReceipt.candidates.at(-1)!.excluded, true);
  f.boundary.blocks[1].sourceIndices!.push(1);
  assert.throws(() => mergeScopedSourcePackets(f), /exactly one boundary owner/);
});

test('missing candidate denominator, root omissions, mixed viewports and mixed device facts are rejected', () => {
  const f = fixture();
  const missing = structuredClone(f); delete missing.boundary.boundaryObservation;
  assert.throws(() => mergeScopedSourcePackets(missing), /Independent DOM candidate coverage/);
  const roots = structuredClone(f); roots.packets[0].packet.blocks[0].selectors = ['#one'];
  assert.throws(() => mergeScopedSourcePackets(roots), /every declared boundary root/);
  const enumeration = structuredClone(f); enumeration.packets[0].packet.sourceScene!.enumeration!.rootSelectors = ['#one'];
  assert.throws(() => mergeScopedSourcePackets(enumeration), /actually visit every boundary root/);
  const width = structuredClone(f); width.packets[1].packet.observedPage.viewport.width = 390;
  assert.throws(() => mergeScopedSourcePackets(width), /same source page/);
  const device = structuredClone(f); device.packets[1].packet.sourceScene!.viewport.touch = true;
  assert.throws(() => mergeScopedSourcePackets(device), /different device contexts/);
});

test('malformed circular serialization and cross-block scene responsibilities are never repaired from the target', () => {
  const f = fixture();
  (f.packets[0].packet.sourceScene!.items[0] as unknown as { rect: string }).rect = '[Circular]';
  assert.throws(() => mergeScopedSourcePackets(f), /circularly serialized facts/);
  const foreign = fixture(); foreign.packets[0].packet.sourceScene!.items[1].sourceBlockId = 'second';
  assert.throws(() => mergeScopedSourcePackets(foreign), /unexpected source boundary/);
});
