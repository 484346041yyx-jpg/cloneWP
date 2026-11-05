import assert from 'node:assert/strict';
import test from 'node:test';
import { projectOwnedBodyPresentationFacts } from '../src/replica-full/body-prepare.js';
import type { ObservationPacketV2 } from '../src/replica-v2/observation.js';
import { projectPhoneProductionFacts } from '../src/replica-responsive/production.js';

const url = 'https://example.com/';
const sha256 = '0'.repeat(64);

function packet(id: string, width: number, regions: string[]): ObservationPacketV2 {
  const rect = { x: 0, y: 0, width, height: 20 };
  const ids = regions.flatMap(region => [region, region + '-child']);
  const nodes = Object.fromEntries(ids.map(nodeId => {
    const parentId = nodeId.endsWith('-child') ? nodeId.slice(0, -6) : null;
    return [nodeId, { id: nodeId, parentId, regionId: parentId ?? nodeId, tag: 'div', selector: '#' + nodeId, attributes: {}, childIds: parentId ? [] : [nodeId + '-child'], styleId: 's', layoutId: nodeId, visible: true }];
  }));
  return {
    version: 2, kind: 'observation-packet', snapshot: { id, url, title: 't', capturedAt: '2026-10-24T00:00:00.000Z', viewport: { name: width > 1000 ? 'desktop' : 'mobile', width, height: 800, clientWidth: width, scrollbarWidth: 0, devicePixelRatio: 1 }, pageHeight: 800, screenshot: { path: id + '.png', sha256, width, height: 800 } },
    nodes, regions: regions.map((region, order) => ({ id: region, nodeId: region, role: 'region', order, contentNodeId: region + '-child', gapBefore: 0 })),
    texts: {}, styles: { s: { display: 'block', visibility: 'visible', opacity: '1' } }, layouts: Object.fromEntries(ids.map(nodeId => [nodeId, { id: nodeId, rect, contentRect: rect, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'row', flowIndex: 0 }])),
    resources: {}, usages: {}, interactions: {}, gaps: [],
  } as ObservationPacketV2;
}

test('body presentation uses selected desktop facts and phone descendants while retaining full original evidence', () => {
  const desktopPackets = [packet('desk', 1440, ['hero', 'blog']), packet('desk', 1440, ['header'])];
  const phones = { packets: [packet('phone', 390, ['hero', 'blog']), packet('phone', 390, ['header'])], packetFiles: [{ path: 'phone-body.json', sha256, snapshotId: 'phone' }, { path: 'phone-shared.json', sha256, snapshotId: 'phone' }] };
  const desktopRefs = [{ path: 'desktop-body.json', sha256, snapshotId: 'desk' }, { path: 'desktop-shared.json', sha256, snapshotId: 'desk' }];
  const desktop = projectPhoneProductionFacts({ version: 2, kind: 'source-facts', sourceUrl: url, observation: { path: 'observation.json', sha256 }, snapshots: [], facts: {}, gaps: [] }, desktopPackets, desktopRefs, { packets: [], packetFiles: [] });
  const selected = Object.values(desktop.facts).filter(fact => fact.regionId === 'hero').map(fact => fact.id);
  const scoped = projectOwnedBodyPresentationFacts(desktop, desktopPackets, desktopRefs, phones, [{ id: 'hero', snapshotId: 'desk', ownerNodeId: 'hero', nodeIds: ['hero', 'hero-child'], sourceFactIds: selected, componentKeys: [] }], [{ snapshotId: 'phone', nodeId: 'hero' }]);
  assert.deepEqual(new Set(Object.keys(scoped.facts)), new Set([...selected, 'phone:region:hero', 'phone:layout:hero', 'phone:layout:hero-child']));
  assert.ok(scoped.snapshots.every(snapshot => !Object.hasOwn(snapshot.nodes, 'header')));
  assert.ok(desktop.facts['desk:region:header']);
  assert.ok(desktop.facts['desk:region:blog']);
});
