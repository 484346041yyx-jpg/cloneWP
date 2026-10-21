import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

async function mapper() { return (await import(pathToFileURL('D:/cloneWP/tools/pet-v2-responsive-mapping.mjs').href)).mapResponsiveBindings; }
function packet(prefix = '', snapshotId = 'desktop-scene', viewport = 'desktop') {
  const p: any = { snapshot: { id: snapshotId, viewport: { name: viewport } }, regions: [{ id: 'random-region', nodeId: prefix + 'root' }], nodes: {}, texts: {}, usages: {}, resources: {} };
  for (const [id, parentId, tag, children, attributes] of [
    ['root', null, 'section', ['card'], {}], ['card', 'root', 'article', ['link'], {}], ['link', 'card', 'a', ['title', 'picture'], { href: 'https://source.example/deal/' }], ['title', 'link', 'h3', [], {}], ['picture', 'link', 'picture', ['image'], {}], ['image', 'picture', 'img', [], {}],
  ] as Array<[string, string | null, string, string[], Record<string, string>]>) p.nodes[prefix + id] = { id: prefix + id, parentId: parentId ? prefix + parentId : null, childIds: children.map(id => prefix + id), regionId: 'random-region', tag, attributes, visible: true, selector: `#untrusted-${prefix + id}` };
  p.texts.copy = { nodeId: prefix + 'title', text: 'One exact source card heading' };
  p.resources.wide = { url: 'https://source.example/wide.png' }; p.resources.narrow = { url: 'https://source.example/narrow.png' };
  p.usages.selected = { nodeId: prefix + 'image', kind: 'img', resourceId: viewport === 'mobile' ? 'narrow' : 'wide' };
  p.usages.candidateWide = { nodeId: prefix + 'image', kind: 'picture', attribute: 'srcset', resourceId: 'wide' };
  p.usages.candidateNarrow = { nodeId: prefix + 'image', kind: 'picture', attribute: 'srcset', resourceId: 'narrow' };
  return p;
}
const bindings = () => [{ componentKey: 'card-html', regionIds: ['random-region'], sourceNodeIds: ['card'], slotNodes: { text: { title: ['title'] }, media: { image: ['image'] }, links: { destination: ['link'] } }, layoutNodes: { card: { selector: '#actual-target .card', dimensions: ['x', 'width'], adaptHeight: true, rule: 'Actual source content owner' } } }];
function carouselPacket(prefix = '', snapshotId = 'desktop-scene', viewport = 'desktop', cloneCount = 6) {
  const p = packet(prefix, snapshotId, viewport), track = prefix + 'track', second = prefix + 'card-two';
  p.nodes[track] = { id: track, tag: 'div', parentId: prefix + 'root', regionId: 'random-region', attributes: { class: 'slick-track' }, childIds: [], visible: true };
  p.nodes[prefix + 'root'].childIds = [track]; p.nodes[prefix + 'card'].parentId = track;
  const remap = (id: string) => id === prefix + 'card' ? second : id + '-two';
  for (const id of ['card', 'link', 'title', 'picture', 'image']) { const original = p.nodes[prefix + id], next = remap(original.id); p.nodes[next] = { ...original, id: next, parentId: id === 'card' ? track : remap(original.parentId), childIds: original.childIds.map(remap), attributes: { ...original.attributes } }; }
  p.nodes[prefix + 'link-two'].attributes.href = 'https://source.example/deal-two/';
  p.resources['second-wide'] = { url: 'https://source.example/second-wide.png' }; p.resources['second-narrow'] = { url: 'https://source.example/second-narrow.png' };
  for (const [key, usage] of Object.entries(p.usages) as [string, any][]) p.usages[key + '-two'] = { ...usage, nodeId: prefix + 'image-two', resourceId: usage.resourceId === 'wide' ? 'second-wide' : 'second-narrow' };
  const pre: string[] = [], post: string[] = [];
  for (let index = 0; index < cloneCount * 2; index++) { const id = prefix + 'clone-' + index; p.nodes[id] = { id, tag: 'article', parentId: track, regionId: 'random-region', attributes: { class: 'slick-cloned' }, childIds: [], visible: true }; (index < cloneCount ? pre : post).push(id); }
  p.nodes[track].childIds = [...pre, prefix + 'card', second, ...post];
  p.interactions = { carousel: { id: prefix + 'carousel', nodeId: prefix + 'root', regionId: 'random-region', kind: 'carousel', trackNodeId: track, itemNodeIds: [prefix + 'card', second], cloneNodeIds: [...pre, ...post], controlNodeIds: [] } };
  return p;
}

test('responsive mapping proves relative owner slots across entirely different IDs and maps all typed bindings', async () => {
  const desktop = packet(), mobile = packet('mobile-', 'mobile-scene', 'mobile'), input = bindings(), before = JSON.stringify(input);
  mobile.nodes['mobile-title'].visible = false;
  const result = (await mapper())({ desktopPackets: { 'random-region': desktop }, variantPackets: { 'random-region': mobile }, bindings: input });
  assert.deepEqual(result.gaps, []); assert.equal(result.mappings[0].snapshotId, 'mobile-scene'); assert.deepEqual(result.mappings[0].sourceNodeIds, ['mobile-card']);
  assert.deepEqual(result.mappings[0].slotNodes, { text: { title: ['mobile-title'] }, media: { image: ['mobile-image'] }, links: { destination: ['mobile-link'] } });
  assert.deepEqual(result.mappings[0].layoutNodes['mobile-card'], input[0].layoutNodes.card); assert.equal(JSON.stringify(input), before);
  const title = result.mappings[0].nodeMappings.find((entry: any) => entry.desktopNodeId === 'title'); assert.deepEqual(title.path, [0, 0, 0]); assert.equal(title.visible, false); assert.ok(title.evidence.includes('actual-source-href'));
  assert.ok(result.mappings[0].nodeMappings.find((entry: any) => entry.desktopNodeId === 'image').evidence.includes('owner-bound-media-candidate-intersection'));
});

test('identical node IDs and copy cannot prove a changed destination or changed relative structure', async () => {
  const desktop = packet(), later = packet('', 'mobile-scene', 'mobile'); later.nodes.link.attributes.href = 'https://source.example/unrelated/';
  let result = (await mapper())({ desktopPackets: { 'random-region': desktop }, variantPackets: { 'random-region': later }, bindings: bindings() });
  assert.ok(result.gaps.some((gap: any) => /destination relationship/.test(gap.message))); assert.deepEqual(result.mappings[0].slotNodes.links.destination, []);
  later.nodes.link.attributes.href = desktop.nodes.link.attributes.href; later.nodes.title.tag = 'div';
  result = (await mapper())({ desktopPackets: { 'random-region': desktop }, variantPackets: { 'random-region': later }, bindings: bindings() });
  assert.ok(result.gaps.some((gap: any) => /path or tag/.test(gap.message))); assert.deepEqual(result.mappings[0].slotNodes.text.title, []);
});

test('same-tag hidden inputs cannot exchange their actual id, name or type at a coincident relative slot',async()=>{
  const desktop=packet(),later=packet('mobile-','mobile-scene','mobile');desktop.nodes.title.tag='input';later.nodes['mobile-title'].tag='input';desktop.nodes.title.attributes={id:'source-hidden-a',name:'source-a',type:'hidden'};later.nodes['mobile-title'].attributes={id:'source-hidden-b',name:'source-b',type:'hidden'};
  const result=(await mapper())({desktopPackets:{'random-region':desktop},variantPackets:{'random-region':later},bindings:bindings()});assert.ok(result.gaps.some((gap:any)=>gap.desktopNodeId==='title'&&/Actual typed source node role/.test(gap.message)));assert.deepEqual(result.mappings[0].slotNodes.text.title,[]);
});

test('responsive currentSrc changes need actual owner-bound picture candidates and do not match by alt or copy', async () => {
  const desktop = packet(), later = packet('mobile-', 'mobile-scene', 'mobile'); later.resources = { unrelated: { url: 'https://source.example/unrelated.png' } }; later.usages = { selected: { nodeId: 'mobile-image', kind: 'img', resourceId: 'unrelated' } };
  const result = (await mapper())({ desktopPackets: { 'random-region': desktop }, variantPackets: { 'random-region': later }, bindings: bindings() });
  assert.ok(result.gaps.some((gap: any) => /Media resources have no verified identity/.test(gap.message))); assert.deepEqual(result.mappings[0].slotNodes.media.image, []);
});

test('text differences preserve proven owner identity as an explicit variant gap, never a selector-text union', async () => {
  const desktop = packet(), later = packet('mobile-', 'mobile-scene', 'mobile'); later.texts.copy.text = 'A mobile-only source variant'; later.nodes['mobile-title'].selector = '#title';
  const result = (await mapper())({ desktopPackets: { 'random-region': desktop }, variantPackets: { 'random-region': later }, bindings: bindings() });
  assert.deepEqual(result.mappings[0].slotNodes.text.title, ['mobile-title']); assert.equal(result.gaps.filter((gap: any) => gap.code === 'responsive-text-variant-required').length, 1); assert.equal(result.mappings[0].slotNodes.text.title.length, 1);
});

test('missing regions and a real-item-to-clone mapping remain explicit unresolved ownership gaps', async () => {
  const desktop = packet(), later = packet('mobile-', 'mobile-scene', 'mobile'); later.nodes['mobile-card'].attributes.class = 'swiper-slide-duplicate';
  let result = (await mapper())({ desktopPackets: { 'random-region': desktop }, variantPackets: { 'random-region': later }, bindings: bindings() });
  assert.ok(result.gaps.some((gap: any) => /real item cannot be mapped/.test(gap.message)));
  result = (await mapper())({ desktopPackets: { 'random-region': desktop }, variantPackets: {}, bindings: bindings() });
  assert.ok(result.gaps.some((gap: any) => gap.code === 'responsive-region-missing')); assert.deepEqual(result.mappings[0].sourceNodeIds, []);
});

test('actual carousel real-item ordinals preserve mapping when Slick changes its leading clone quantity', async () => {
  const desktop = carouselPacket(), later = carouselPacket('mobile-', 'mobile-scene', 'mobile', 2);
  const result = (await mapper())({ desktopPackets: { 'random-region': desktop }, variantPackets: { 'random-region': later }, bindings: bindings() });
  assert.deepEqual(result.gaps, []); assert.deepEqual(result.mappings[0].sourceNodeIds, ['mobile-card']); assert.deepEqual(result.mappings[0].slotNodes.media.image, ['mobile-image']);
  const proof = result.mappings[0].nodeMappings.find((proof: any) => proof.desktopNodeId === 'image');
  assert.deepEqual(proof.path, [0, 6, 0, 1, 0]); assert.deepEqual(proof.carouselSlots, [{ desktopInteractionId: 'carousel', variantInteractionId: 'mobile-carousel', desktopTrackNodeId: 'track', variantTrackNodeId: 'mobile-track', desktopItemNodeId: 'card', variantItemNodeId: 'mobile-card', realItemOrdinal: 0, desktopChildIndex: 6, variantChildIndex: 2, pathOffset: 1 }]);
  assert.ok(proof.evidence.includes('canonical-carousel-real-item-slot'));
  const { proveCarouselRealItemSlot } = await import(pathToFileURL('D:/cloneWP/tools/pet-v2-responsive-mapping.mjs').href);
  assert.deepEqual(proveCarouselRealItemSlot({ desktopPacket: desktop, variantPacket: later, desktopTrackNodeId: 'track', variantTrackNodeId: 'mobile-track', desktopItemNodeId: 'card', pathOffset: 1 }), proof.carouselSlots[0]);
});

test('canonical carousel slots reject reordered real items, mismatched media and incomplete interaction ownership', async () => {
  const desktop = carouselPacket(), later = carouselPacket('mobile-', 'mobile-scene', 'mobile', 2), real = later.interactions.carousel.itemNodeIds;
  later.interactions.carousel.itemNodeIds = [real[1], real[0]]; later.nodes['mobile-track'].childIds.splice(2, 2, real[1], real[0]);
  let result = (await mapper())({ desktopPackets: { 'random-region': desktop }, variantPackets: { 'random-region': later }, bindings: bindings() });
  assert.ok(result.gaps.some((gap: any) => /real item reordering/.test(gap.message))); assert.deepEqual(result.mappings[0].sourceNodeIds, []);
  later.interactions.carousel.itemNodeIds = real; later.nodes['mobile-track'].childIds.splice(2, 2, ...real);
  later.resources.wide.url = 'https://source.example/unrelated-wide.png'; later.resources.narrow.url = 'https://source.example/unrelated-narrow.png';
  result = (await mapper())({ desktopPackets: { 'random-region': desktop }, variantPackets: { 'random-region': later }, bindings: bindings() });
  assert.ok(result.gaps.some((gap: any) => /same-owner candidate/.test(gap.message)));
  later.interactions.carousel.cloneNodeIds = [];
  result = (await mapper())({ desktopPackets: { 'random-region': desktop }, variantPackets: { 'random-region': later }, bindings: bindings() });
  assert.ok(result.gaps.some((gap: any) => /actual track DOM/.test(gap.message)));
});

test('collector ownership widening preserves the same actual region-root track path and rejects a changed track ancestor', async () => {
  const desktop = carouselPacket(), later = carouselPacket('mobile-', 'mobile-scene', 'mobile', 2);
  desktop.interactions.carousel.nodeId = 'track'; // Older collector chose the local slider owner.
  let result = (await mapper())({ desktopPackets: { 'random-region': desktop }, variantPackets: { 'random-region': later }, bindings: bindings() });
  assert.deepEqual(result.gaps, []); assert.deepEqual(result.mappings[0].sourceNodeIds, ['mobile-card']);
  later.nodes['mobile-root'].tag = 'aside';
  result = (await mapper())({ desktopPackets: { 'random-region': desktop }, variantPackets: { 'random-region': later }, bindings: bindings() });
  assert.ok(result.gaps.some((gap: any) => /root.*tag/.test(gap.message)));
});

test('evidence-only clone aliases prove complete real-item identity and map canonical slots without copying clone indices', async () => {
  const {proveCanonicalCloneEvidenceV2,deriveResponsiveEvidenceBindingsV2,mapResponsiveBindings}=await import(pathToFileURL('D:/cloneWP/tools/pet-v2-responsive-mapping.mjs').href);
  const desktop=carouselPacket(),mobile=carouselPacket('mobile-','mobile-scene','mobile',2),cloneId='clone-0';
  const copy=(id:string,parentId:string):string=>{const original=desktop.nodes[id],next=id==='card'?cloneId:'copy-'+id;desktop.nodes[next]={...original,id:next,parentId,attributes:{...original.attributes,...(id==='card'?{class:'slick-cloned','data-slick-index':'-6'}:{})},childIds:[]};desktop.nodes[next].childIds=original.childIds.map((child:string)=>copy(child,next));return next;};copy('card','track');
  desktop.texts.cloned={...desktop.texts.copy,nodeId:'copy-title'};for(const [key,usage] of Object.entries(desktop.usages) as [string,any][])if(usage.nodeId==='image')desktop.usages['clone-'+key]={...usage,nodeId:'copy-image'};
  const proof=proveCanonicalCloneEvidenceV2({packet:desktop,nodeId:'copy-title'});assert.equal(proof.canonicalNodeId,'title');assert.equal(proof.realItemOrdinal,0);assert.deepEqual(proof.relativePath,[0,0]);
  const sourceFacts={snapshots:[{id:'desktop-scene'}],facts:{cloned:{snapshotId:'desktop-scene',nodeId:'copy-title'}}};
  const derived=deriveResponsiveEvidenceBindingsV2({bindings:bindings(),adaptations:[{sourceFactIds:['cloned'],target:{componentKey:'card-html'}}],sourceFacts,desktopPackets:{'random-region':desktop},desktopSnapshotId:'desktop-scene'});
  assert.deepEqual(derived[0].evidenceNodeIds,['title']);assert.deepEqual(derived[0].evidenceAliases,[proof]);
  const mapping=mapResponsiveBindings({desktopPackets:{'random-region':desktop},variantPackets:{'random-region':mobile},bindings:derived});assert.deepEqual(mapping.gaps,[]);assert.deepEqual(mapping.mappings[0].evidenceNodeIds,['mobile-title']);assert.deepEqual(mapping.mappings[0].sourceNodeIds,['mobile-card']);
  desktop.nodes['copy-link'].attributes.href='https://source.example/changed/';assert.throws(()=>proveCanonicalCloneEvidenceV2({packet:desktop,nodeId:'copy-title'}),/complete canonical real-item/);
  desktop.nodes['copy-link'].attributes.href=desktop.nodes.link.attributes.href;desktop.nodes[cloneId].childIds=[];assert.throws(()=>proveCanonicalCloneEvidenceV2({packet:desktop,nodeId:cloneId}),/complete canonical real-item/);
});
