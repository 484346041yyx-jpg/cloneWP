import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeSourceSceneBindings, measureSourceCatalogTemplate, type SourceBindingPacket } from '../src/fidelity/source-binding.js';
import { auditSourceCoverage } from '../src/fidelity/source-coverage.js';
import { auditSourceContentCoverage, type SourceContentPacket } from '../src/fidelity/source-coverage.js';
import type { BlockContract, NativeProgram } from '../src/fidelity/types.js';
import type { SourceSceneInventory, SourceSceneItem } from '../src/reference/source-scene.js';

function fixture() {
  const rect = { x: 50, y: 100, width: 900, height: 400 }, state = { status: 'observed' as const, evidence: ['dom'] };
  const contract: BlockContract = { version: 1, workflow: 'block-replication', sourceUrl: 'https://public.example/', capturedAt: '', referenceReport: { path: 'report.json', sha256: '0'.repeat(64) }, evidence: [{ id: 'dom', path: 'desktop.json', sha256: '0'.repeat(64), kind: 'dom' }], tolerances: { geometryPx: 4, geometryRatio: .1, colorChannel: 2 }, limitations: [], blocks: [{ id: 'catalog', role: 'products', presentation: 'carousel', texts: [{ id: 'heading', kind: 'heading', text: 'Our featured products' }], assets: [], evidence: ['dom'], geometry: { desktop: { width: 900, height: 400 } }, colors: {}, states: { normal: state, hover: state, interaction: state }, contentBounds: { desktop: { x: 50, width: 900, viewportWidth: 1000, sourceNodeId: '#section', evidence: ['dom'] } }, presentationDetails: { version: 1, viewports: { desktop: { status: 'observed', width: 1000, evidence: ['dom'], regions: [{ id: 'owner', sourceNodeId: '#rail', evidence: ['dom'], rect: { x: 0, y: 0, width: 900, height: 400 }, visible: true }], media: [], relations: [], controlGroups: [{ id: 'group', sourceNodeId: '#controls', ownerId: 'owner', evidence: ['dom'], rect: { x: 800, y: 0, width: 100, height: 30 }, visible: true, layout: 'row', pagination: 'none', controls: [{ id: 'next', sourceNodeId: '#next', evidence: ['dom'], rect: { x: 870, y: 0, width: 30, height: 30 }, visible: true, role: 'next' }] }] } } } }] };
  const program: NativeProgram = { version: 1, workflow: 'block-replication', sourceUrl: contract.sourceUrl, title: '', sourceContract: { path: '', sha256: '' }, assetsManifest: { path: '', sha256: '' }, deviations: [], elements: [{ key: 'root', type: 'container', settings: {}, children: [{ key: 'query', type: 'wd_products', settings: {} }, { key: 'heading', type: 'heading', settings: { title: 'Our featured products' } }] }], blocks: [{ sourceBlockId: 'catalog', rootKey: 'root', presentation: 'carousel', states: contract.blocks[0].states, contentBindings: { desktop: 'root' }, bindings: [{ sourceTextId: 'heading', elementKey: 'heading', settingPath: 'title' }], presentationBindings: [{ id: 'owner', elementKey: 'query' }, { id: 'group', elementKey: 'query', relativeSelector: '.controls' }, { id: 'next', elementKey: 'query', relativeSelector: '.next' }] }] };
  const item = (id: string, kind: SourceSceneItem['kind'], selector: string, box = rect): SourceSceneItem => ({ id, kind, selector, sourceBlockId: 'observed-7', rect: box, visible: true, required: true, state: 'resting', evidence: ['independent-DOM'], facts: {} });
  const scene: SourceSceneInventory = { version: 1, method: 'independent-public-dom-scene', sourceUrl: contract.sourceUrl, capturedAt: '', evidencePath: 'desktop.json', viewport: { name: 'desktop', width: 1000, height: 800, clientWidth: 1000, devicePixelRatio: 1, touch: false, coarsePointer: false, deviceProfile: 'desktop' }, state: 'resting', status: 'observed', notice: '', gaps: [], items: [item('block', 'block', '#section'), item('track', 'repeated-template', '#rail'), item('controls', 'control-group', '#controls', { x: 850, y: 100, width: 100, height: 30 }), { ...item('next-control', 'control', '#next', { x: 920, y: 100, width: 30, height: 30 }), role: 'next', ownerId: 'track' }] };
  const packet: SourceBindingPacket = { viewport: 'desktop', evidenceId: 'dom', blocks: [{ id: 'observed-7', rect, selectors: ['#section'], textAtoms: [{ selector: '#section > h2', rect, text: 'Our featured products' }], images: [] }] };
  return { contract, program, scene, packet, item };
}
test('mechanical scene binding resolves exact source identities and actual same-block native probes without changing inputs', () => {
  const value = fixture(), snapshot = JSON.stringify(value);
  const plan = proposeSourceSceneBindings({ ...value, inventories: [value.scene], packets: [value.packet] });
  assert.equal(plan.gaps.length, 0); assert.equal(plan.bindings.length, 4); assert.equal(plan.blocks[0].blockId, 'catalog');
  value.contract.sourceSceneBindings = plan.bindings;
  assert.equal(auditSourceCoverage(value.contract, [value.scene], { program: value.program, requiredViewports: ['desktop'] }).passed, true);
  delete value.contract.sourceSceneBindings; assert.equal(JSON.stringify(value), snapshot);
});
test('missing or malformed scene denominators remain explicit proposal gaps', () => {
  const value = fixture();
  assert.ok(proposeSourceSceneBindings({ ...value, inventories: [] }).gaps.some(gap => gap.code === 'source-scene-inventory-missing'));
  value.scene.items = []; value.scene.gaps = [{ code: 'scene-invalid-item', message: 'Serialization removed source geometry' }];
  const plan = proposeSourceSceneBindings({ ...value, inventories: [value.scene] });
  assert.equal(plan.bindings.length, 0); assert.ok(plan.gaps.some(gap => gap.code === 'scene-invalid-item')); assert.ok(plan.gaps.some(gap => gap.code === 'source-scene-visible-blocks-missing'));
});
test('unknown controls cannot be mapped to the root and duplicate source ownership is retained as a gap', () => {
  const value = fixture(); value.scene.items.push({ ...value.item('pause', 'control', '#pause'), role: 'autoplay' });
  const plan = proposeSourceSceneBindings({ ...value, inventories: [value.scene] });
  assert.ok(plan.gaps.some(gap => gap.sourceId === 'pause')); assert.equal(plan.bindings.some(binding => binding.sourceId === 'pause'), false);
  const root = proposeSourceSceneBindings({ ...value, inventories: [value.scene], identities: [{ blockId: 'catalog', sourceNodeId: '#pause', elementKey: 'root', evidence: ['dom'] }] });
  assert.equal(root.bindings.some(binding => binding.sourceId === 'pause'), false);
  value.scene.items.push({ ...value.scene.items[0], id: 'second-block', sourceBlockId: 'second', selector: '#section > div' });
  const collapsed = proposeSourceSceneBindings({ ...value, inventories: [value.scene] });
  assert.ok(collapsed.gaps.length); assert.equal(collapsed.bindings.some(binding => binding.sourceId === 'second-block'), false);
});
test('exact static copy and source media infer unique renamed blocks; shared words cannot bind a coarse whole-page block', () => {
  const value = fixture(); delete value.contract.blocks[0].contentBounds; delete value.contract.blocks[0].presentationDetails;
  value.contract.blocks[0].assets = ['logo']; const manifest = { version: 1 as const, sourceUrl: value.contract.sourceUrl, downloadedAt: '', assets: [{ key: 'logo', sourceUrl: 'https://public.example/logo.png', localPath: '', sha256: '', alt: '', mediaType: 'image/png' as const, provenance: '' }] };
  value.packet.blocks[0].images = [{ selector: '#image', rect: value.scene.items[0].rect, url: manifest.assets[0].sourceUrl }];
  const plan = proposeSourceSceneBindings({ ...value, inventories: [value.scene], packets: [value.packet], manifest });
  assert.equal(plan.blocks[0].reason, 'independent exact static-copy/media fingerprint');
  value.packet.blocks[0].textAtoms!.push({ selector: '#unrelated', rect: value.scene.items[0].rect, text: 'Another unrelated section' });
  const coarse = proposeSourceSceneBindings({ ...value, inventories: [value.scene], packets: [value.packet], manifest });
  assert.equal(coarse.blocks.length, 0);
});
test('action labels use exact saved native copy while duplicate labels stay ambiguous', () => {
  const value = fixture(); value.scene.items.push({ ...value.item('action', 'control', '#cta'), role: 'action' });
  value.packet.blocks[0].textAtoms!.push({ selector: '#cta', rect: value.scene.items[0].rect, text: 'Our featured products' });
  let plan = proposeSourceSceneBindings({ ...value, inventories: [value.scene], packets: [value.packet] });
  assert.equal(plan.bindings.find(binding => binding.sourceId === 'action')?.targetKey, 'heading'); assert.equal(plan.presentation.length, 1);
  value.program.elements[0].children!.push({ key: 'second-heading', type: 'heading', settings: { title: 'Our featured products' } });
  value.program.blocks[0].bindings.push({ sourceTextId: 'heading', elementKey: 'second-heading', settingPath: 'title' });
  plan = proposeSourceSceneBindings({ ...value, inventories: [value.scene], packets: [value.packet] });
  assert.equal(plan.bindings.some(binding => binding.sourceId === 'action'), false); assert.ok(plan.gaps.some(gap => gap.code === 'source-feature-binding-ambiguous'));
});
test('catalog card measurements retain card-relative slots and reject unobserved/offscreen/non-finite roles', () => {
  const card = { selector: '#slide > article', rect: { x: 100, y: 200, width: 220, height: 320 }, visible: true, visibility: { painted: true, clippedRatio: 0 }, style: { 'border-top-width': '1px', 'border-top-left-radius': '12px', 'background-color': '#fff' } };
  const node = { selector: '#slide > article > h3', rect: { x: 120, y: 420, width: 180, height: 40 }, visible: true, style: { 'font-size': '16px' } };
  const options = { card, blockRect: { x: 50, y: 100, width: 900, height: 500 }, evidenceId: 'dom', slots: [{ role: 'name' as const, node, maxLines: 2 }] };
  const measured = measureSourceCatalogTemplate(options); assert.equal(measured.gaps.length, 0); assert.deepEqual(measured.template?.rect, { x: 50, y: 100, width: 220, height: 320 }); assert.deepEqual(measured.template?.slots[0].rect, { x: 20, y: 220, width: 180, height: 40 }); assert.equal(measured.template?.paint.borderRadius, 12);
  assert.ok(measureSourceCatalogTemplate({ ...options, card: { ...card, visibility: undefined } }).gaps.length);
  assert.ok(measureSourceCatalogTemplate({ ...options, card: { ...card, visibility: { painted: true, clippedRatio: .5 } } }).gaps.length);
  assert.ok(measureSourceCatalogTemplate({ ...options, slots: [{ role: 'name', node: { ...node, selector: '#other > h3' } }] }).gaps.length);
  assert.ok(measureSourceCatalogTemplate({ ...options, slots: [{ role: 'name', node: { ...node, rect: { ...node.rect, width: NaN } } }] }).gaps.length);
});
test('catalog repeated wrappers accept a measured descendant card only within its own authorized identity chain', () => {
  const value = fixture(), source = value.contract.blocks[0], target = value.program.blocks[0], view = source.presentationDetails!.viewports.desktop;
  source.dynamicData = { provider: 'target-woocommerce', kind: 'product-list', replaceableTextIds: [], replaceableAssetKeys: [], items: [{ sourceNodeId: '#slide > article > a', textIds: [], assetKeys: [], evidence: ['dom'] }, { sourceNodeId: '#second-slide > article > a', textIds: [], assetKeys: [], evidence: ['dom'] }], evidence: ['dom'] };
  target.productQuery = { provider: 'target-woocommerce', widgetKey: 'query', widgetType: 'wd_products', sourceTextIds: [], sourceAssetKeys: [], queryControlKeys: [], evidence: ['dom'] };
  // The real collector enumerates at least two distinct DOM children for a
  // repeated template. One authored item alone cannot prove a source repeat.
  value.scene.items[1].facts.itemSelectors = ['#slide', '#second-slide']; value.scene.items[1].facts.itemCount = 2;
  value.packet.blocks[0].nodes = [{ selector: '#slide', parentSelector: '#rail', rect: { x: 50, y: 100, width: 220, height: 300 } }, { selector: '#second-slide', parentSelector: '#rail', rect: { x: 280, y: 100, width: 220, height: 300 } }];
  view.catalogTemplate = { sourceNodeId: '#slide > article', evidence: ['dom'], rect: { x: 0, y: 0, width: 220, height: 300 }, visibleFraction: 1, paint: {}, slots: [{ role: 'name', rect: { x: 0, y: 200, width: 200, height: 40 }, visible: true }], order: ['name'] };
  source.presentationDetails!.viewports.desktop.regions = [];
  target.presentationBindings = target.presentationBindings!.filter(binding => binding.id !== 'owner');
  const plan = proposeSourceSceneBindings({ ...value, inventories: [value.scene], packets: [value.packet] }); value.contract.sourceSceneBindings = plan.bindings;
  assert.equal(auditSourceCoverage(value.contract, [value.scene], { program: value.program, requiredViewports: ['desktop'] }).passed, true);
  value.scene.items[1].facts.itemSelectors = ['#slide'];
  assert.equal(auditSourceCoverage(value.contract, [value.scene], { program: value.program, requiredViewports: ['desktop'] }).passed, false);
  value.scene.items[1].facts.itemSelectors = ['#slide', '#second-slide'];
  source.dynamicData.items[0].sourceNodeId = '#different-item';
  assert.equal(auditSourceCoverage(value.contract, [value.scene], { program: value.program, requiredViewports: ['desktop'] }).passed, false);
});
test('static repeat fingerprints select the smallest exact native subtree including source nodes whose unique ids interrupt selector ancestry', () => {
  const value = fixture(), source = value.contract.blocks[0], target = value.program.blocks[0], root = value.program.elements[0];
  source.presentationDetails = undefined; source.assets = ['dog', 'cat']; source.texts = [{ id: 'dog', text: 'Dog', kind: 'label' }, { id: 'cat', text: 'Cat', kind: 'label' }];
  root.children = [{ key: 'tiles', type: 'container', settings: {}, children: [{ key: 'dog', type: 'image', settings: { image: { $asset: 'dog' }, caption: 'Dog' } }, { key: 'cat', type: 'image', settings: { image: { $asset: 'cat' }, caption: 'Cat' } }] }];
  target.presentationBindings = []; target.bindings = [{ sourceTextId: 'dog', elementKey: 'dog', settingPath: 'caption' }, { sourceTextId: 'cat', elementKey: 'cat', settingPath: 'caption' }];
  value.scene.items = [value.scene.items[0], value.item('tiles', 'repeated-template', '#tiles')];
  const observed = value.packet.blocks[0], box = value.scene.items[0].rect;
  observed.textAtoms = [{ selector: '#tiles > a:nth-of-type(1) > span', rect: box, text: 'Dog' }, { selector: '#tiles > a:nth-of-type(2) > span', rect: box, text: 'Cat' }];
  observed.images = [{ selector: '#dog-image', rect: box, url: 'https://public.example/dog.png' }, { selector: '#cat-image', rect: box, url: 'https://public.example/cat.png' }];
  observed.nodes = [{ selector: '#dog-image', parentSelector: '#tiles > a:nth-of-type(1)', rect: box }, { selector: '#cat-image', parentSelector: '#tiles > a:nth-of-type(2)', rect: box }];
  const manifest = { version: 1 as const, sourceUrl: source.id, downloadedAt: '', assets: ['dog', 'cat'].map(key => ({ key, sourceUrl: 'https://public.example/' + key + '.png', localPath: '', sha256: '', alt: '', mediaType: 'image/png' as const, provenance: '' })) };
  let plan = proposeSourceSceneBindings({ ...value, inventories: [value.scene], packets: [value.packet], manifest });
  assert.equal(plan.gaps.length, 0); assert.equal(plan.bindings.find(binding => binding.sourceId === 'tiles')?.targetKey, 'tiles'); assert.equal(plan.presentation.length, 1);
  root.children.push(structuredClone(root.children[0])); root.children[1].key = 'duplicate-tiles';
  plan = proposeSourceSceneBindings({ ...value, inventories: [value.scene], packets: [value.packet], manifest });
  assert.equal(plan.bindings.some(binding => binding.sourceId === 'tiles'), false); assert.ok(plan.gaps.some(gap => gap.code === 'source-feature-binding-ambiguous'));
});
test('source DOM ancestor evidence authorizes only its own dynamic slot when a unique id truncates the CSS address', () => {
  const value = fixture(), source = value.contract.blocks[0], target = value.program.blocks[0];
  source.texts.push({ id: 'source-name', text: 'Source product', kind: 'product-name' });
  source.dynamicData = { provider: 'target-woocommerce', kind: 'product-list', replaceableTextIds: ['source-name'], replaceableAssetKeys: [], items: [{ sourceNodeId: '#slide', textIds: ['source-name'], assetKeys: [], evidence: ['dom'] }], evidence: ['dom'] };
  target.productQuery = { provider: 'target-woocommerce', widgetKey: 'query', widgetType: 'wd_products', sourceTextIds: ['source-name'], sourceAssetKeys: [], queryControlKeys: [], evidence: ['dom'] };
  value.contract.sourceSceneBindings = [{ sourceId: 'block', viewport: 'desktop', blockId: 'catalog', targetKey: 'root', requirement: 'block' }];
  const packet: SourceContentPacket = { viewport: 'desktop', evidencePath: 'source.json', blocks: [{ id: 'observed-7', textAtoms: [{ selector: '#product-title', ancestorSelectors: ['#slide', '#section'], text: 'Source product', visible: true }], images: [] }] };
  let audit = auditSourceContentCoverage(value.contract, value.program, undefined, [packet], [value.scene]); assert.equal(audit.counts.dynamicText, 1); assert.equal(audit.issues.length, 0);
  source.presentationDetails!.viewports.desktop.catalogTemplate = { sourceNodeId: '#product-card', sourceAncestorSelectors: ['#slide', '#section'], evidence: ['dom'], rect: { x: 0, y: 0, width: 200, height: 300 }, visibleFraction: 1, paint: {}, slots: [{ role: 'name', visible: true, rect: { x: 0, y: 0, width: 200, height: 30 } }], order: ['name'] };
  packet.blocks[0].textAtoms![0].ancestorSelectors = ['#product-card', '#slide', '#section'];
  audit = auditSourceContentCoverage(value.contract, value.program, undefined, [packet], [value.scene]); assert.equal(audit.issues.length, 0);
  source.presentationDetails!.viewports.desktop.catalogTemplate.sourceAncestorSelectors = ['#invented-slide', '#section'];
  audit = auditSourceContentCoverage(value.contract, value.program, undefined, [packet], [value.scene]); assert.ok(audit.issues.some(issue => issue.code === 'source-catalog-ancestry-unproven'));
  source.presentationDetails!.viewports.desktop.catalogTemplate = undefined;
  packet.blocks[0].textAtoms![0].ancestorSelectors = ['#other-card', '#section'];
  audit = auditSourceContentCoverage(value.contract, value.program, undefined, [packet], [value.scene]); assert.equal(audit.counts.dynamicText, 0); assert.ok(audit.issues.some(issue => issue.code === 'source-static-text-omitted'));
});
