import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const importTool = async (filename: string) => import(pathToFileURL(`D:/cloneWP/tools/${filename}`).href);
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const readJson = async (directory: string, name: string) => JSON.parse(await readFile(path.join(directory, name), 'utf8'));

function packet(prefix = '', id = 'desktop-scene', name = 'desktop'): any {
  const nodes: any = {};
  for (const [key, parent, tag, children, attributes] of [['root', null, 'section', ['link'], {}], ['link', 'root', 'a', ['title', 'image'], { href: 'https://source.example/deal/' }], ['title', 'link', 'h3', [], {}], ['image', 'link', 'img', [], {}]] as Array<[string, string | null, string, string[], any]>) nodes[prefix + key] = { id: prefix + key, parentId: parent ? prefix + parent : null, childIds: children.map(child => prefix + child), tag, attributes, regionId: 'observed-region', layoutId: 'layout-root', visible: true, selector: '.untrusted-' + key };
  return { snapshot: { id, viewport: { name, width: name === 'desktop' ? 1920 : 390, height: name === 'desktop' ? 1080 : 844 } }, regions: [{ id: 'observed-region', nodeId: prefix + 'root', contentNodeId: prefix + 'root' }], nodes, layouts: { 'layout-root': { rect: { x: name === 'desktop' ? 240 : 12, y: 0, width: name === 'desktop' ? 1440 : 366, height: name === 'desktop' ? 120 : 160 } } }, texts: { title: { nodeId: prefix + 'title', text: 'Actual source heading' } }, resources: { wide: { url: 'https://source.example/wide.png' }, narrow: { url: 'https://source.example/narrow.png' } }, usages: { current: { nodeId: prefix + 'image', kind: 'img', attribute: 'src', resourceId: name === 'desktop' ? 'wide' : 'narrow' }, wide: { nodeId: prefix + 'image', kind: 'picture', attribute: 'srcset', resourceId: 'wide' }, narrow: { nodeId: prefix + 'image', kind: 'picture', attribute: 'srcset', resourceId: 'narrow' } }, interactions: {} };
}
const binding = () => ({ componentKey: 'actual-card', regionIds: ['observed-region'], sourceNodeIds: ['root'], slotNodes: { text: { title: ['title'] }, media: { image: ['image'] }, links: { destination: ['link'] } }, layoutNodes: { root: { localSelector: '.frame', dimensions: ['x', 'width', 'height'] } } });
const block = () => ({ key: 'actual-card', kind: 'html-static', template: '<section class="frame"><a data-cwp-link="destination"><h3 data-cwp-text="title"></h3><img data-cwp-media="image"></a></section>', css: '', slots: { text: { title: 'Actual source heading' }, media: { image: { assetKey: 'wide', responsive: [{ assetKey: 'narrow', media: '(max-width:700px)' }] } }, links: { destination: { url: 'https://source.example/deal/' } } } });

function withCarousel(item: any, prefix: string, cloneCount: number): void {
  const node = (key: string, parentId: string, tag: string, childIds: string[], attributes: any = {}) => ({ id: prefix + key, parentId: prefix + parentId, childIds: childIds.map(id => prefix + id), tag, attributes, regionId: 'observed-region', layoutId: 'layout-root', visible: true, selector: '.not-identity-' + key });
  const clones = Array.from({ length: cloneCount }, (_, index) => `clone-${index}`);
  item.nodes[prefix + 'root'].childIds = [prefix + 'track']; item.nodes[prefix + 'link'].parentId = prefix + 'card';
  item.nodes[prefix + 'track'] = node('track', 'root', 'div', [...clones, 'card', 'other-card']);
  item.nodes[prefix + 'card'] = node('card', 'track', 'article', ['link']); item.nodes[prefix + 'other-card'] = node('other-card', 'track', 'article', ['other-link']);
  item.nodes[prefix + 'other-link'] = node('other-link', 'other-card', 'a', [], { href: 'https://source.example/another-deal/' });
  for (const clone of clones) item.nodes[prefix + clone] = node(clone, 'track', 'article', [], { class: 'slick-cloned' });
  item.interactions.carousel = { id: prefix + 'carousel', nodeId: prefix + 'root', kind: 'carousel', trackNodeId: prefix + 'track', itemNodeIds: [prefix + 'card', prefix + 'other-card'], cloneNodeIds: clones.map(id => prefix + id) };
}

async function setup() {
  const base = 'D:/cloneWP/references'; await mkdir(base, { recursive: true }); const directory = await mkdtemp(path.join(base, 'test-pet-plan-responsive-'));
  const desktop = packet(), mobile = packet('m-', 'mobile-scene', 'mobile');
  await writeFile(path.join(directory, 'asset-manifest.json'), json({ assets: [{ key: 'wide', sourceUrl: desktop.resources.wide.url }, { key: 'narrow', sourceUrl: desktop.resources.narrow.url }] }));
  const writeInput = async (packets: any[], options: { mappings?: any; adaptations?: any[]; filename?: string } = {}) => {
    const source: any = { version: 2, kind: 'source-facts', sourceUrl: 'https://source.example/', snapshots: [], facts: {} };
    for (const item of packets) {
      const filename = path.join(directory, `${item.snapshot.id}.packet.json`), bytes = json(item); await writeFile(filename, bytes);
      source.snapshots.push({ id: item.snapshot.id, viewport: item.snapshot.viewport, nodes: item.nodes, evidence: [{ path: filename, sha256: digest(bytes) }] });
      const add = (kind: string, nodeId: string, value: any, suffix = '', entityId?: string) => { const id = `${item.snapshot.id}:${kind}:${entityId ?? nodeId + suffix}`; source.facts[id] = { id, snapshotId: item.snapshot.id, regionId: 'observed-region', nodeId, kind, evidence: { path: filename, sha256: digest(bytes) }, value }; };
      const prefix = item.snapshot.id === 'desktop-scene' ? '' : Object.keys(item.nodes).find(key => key.endsWith('root'))!.slice(0, -4);
      add('region', prefix + 'root', {}); add('text', prefix + 'title', { text: 'Actual source heading', visible: true, style: { color: item.snapshot.id === 'desktop-scene' ? 'rgb(61, 57, 53)' : 'rgb(0, 76, 219)' } });
      for (const [key,text] of Object.entries(item.texts) as Array<[string,any]>) if (key !== 'title') add('text',text.nodeId,{text:text.text,visible:item.nodes[text.nodeId].visible});
      add('interaction', prefix + 'link', { kind: 'link', href: 'https://source.example/deal/' });
      for (const [key, usage] of Object.entries(item.usages) as Array<[string, any]>) add('media', usage.nodeId, { ...usage, resource: item.resources[usage.resourceId] }, ':' + key, usage.id);
    }
    const sourceBytes = json(source); await writeFile(path.join(directory, 'source-facts.json'), sourceBytes);
    const authored: any = { taskId: 'responsive-tool-fixture', sourceHash: digest(sourceBytes), blocks: [block()], bindings: [binding()], adaptations: options.adaptations ?? [] };
    if (options.mappings !== undefined) authored.responsiveMappings = options.mappings;
    await writeFile(path.join(directory, options.filename ?? 'authored-desktop.json'), json(authored)); return { source, authored };
  };
  return { directory, desktop, mobile, writeInput, cleanup: async () => { assert.ok(path.resolve(directory).startsWith(path.resolve(base) + path.sep)); await rm(directory, { recursive: true, force: true }); } };
}

test('Pet plan keeps desktop requirements byte-identical and adds independently mapped snapshot variants, currentSrc and layout requirements', async () => {
  const data = await setup();
  try {
    const { authorPetPlanV2 } = await importTool('author-pet-v2-plan.mjs'), { mapResponsiveBindings } = await importTool('pet-v2-responsive-mapping.mjs');
    await data.writeInput([data.desktop]); await authorPetPlanV2(data.directory); const desktopPlan = await readJson(data.directory, 'component-plan.json');
    const mappings = mapResponsiveBindings({ desktopPackets: { 'observed-region': data.desktop }, variantPackets: { 'observed-region': data.mobile }, bindings: [binding()] }); assert.deepEqual(mappings.gaps, []);
    await data.writeInput([data.desktop, data.mobile], { mappings, filename: 'authored-responsive.json' }); await authorPetPlanV2(data.directory, 'authored-responsive.json');
    const plan = await readJson(data.directory, 'component-plan.json'), program = await readJson(data.directory, 'program.json');
    assert.equal(json(plan.requirements.filter((requirement: any) => requirement.verification.snapshotId === 'desktop-scene')), json(desktopPlan.requirements));
    assert.deepEqual(plan.components[0].variants[0], desktopPlan.components[0].variants[0]); assert.deepEqual(plan.components[0].itemSlots, desktopPlan.components[0].itemSlots); assert.deepEqual(plan.components[0].variants[1].nodeIds, ['m-root']);
    const mobileMedia = plan.requirements.filter((item: any) => item.verification.snapshotId === 'mobile-scene' && item.verification.kind === 'media');
    assert.equal(mobileMedia.length, 2); assert.ok(mobileMedia.every((item: any) => item.verification.expected.assetKey === 'narrow')); assert.ok(mobileMedia.some((item: any) => item.disposition === 'adapt' && item.factIds.some((id: string) => id.endsWith(':wide'))));
    const layout = plan.requirements.find((item: any) => item.verification.snapshotId === 'mobile-scene' && item.verification.kind === 'layout'); assert.deepEqual(layout.verification.expected, { x: 12, width: 366, height: 160 });
    assert.deepEqual(program.viewports.map((viewport: any) => [viewport.name, viewport.stage]), [['desktop', 'desktop'], ['mobile', 'responsive']]);
  } finally { await data.cleanup(); }
});

test('responsive same-number nodes and equal source text never fill absent or invalid path mappings', async () => {
  const data = await setup();
  try {
    const { authorPetPlanV2 } = await importTool('author-pet-v2-plan.mjs'); const sameIds = packet('', 'mobile-scene', 'mobile');
    await data.writeInput([data.desktop, sameIds]); await assert.rejects(authorPetPlanV2(data.directory), /named source planning gaps/);
    let gaps = (await readJson(data.directory, 'plan-gaps.json')).gaps; assert.ok(gaps.some((item: any) => /numeric DOM IDs/.test(item.reason)));
    const { mapResponsiveBindings } = await importTool('pet-v2-responsive-mapping.mjs'), mappings = mapResponsiveBindings({ desktopPackets: { 'observed-region': data.desktop }, variantPackets: { 'observed-region': data.mobile }, bindings: [binding()] });
    mappings.mappings[0].nodeMappings.find((item: any) => item.desktopNodeId === 'title').path = [0, 1];
    await data.writeInput([data.desktop, data.mobile], { mappings }); await assert.rejects(authorPetPlanV2(data.directory), /named source planning gaps/);
    gaps = (await readJson(data.directory, 'plan-gaps.json')).gaps; assert.ok(gaps.some((item: any) => /actual recorded path/.test(item.reason)));
  } finally { await data.cleanup(); }
});

test('explicit fact adaptations map only proved nodes and use that viewport’s actual style evidence', async () => {
  const data = await setup();
  try {
    const { authorPetPlanV2 } = await importTool('author-pet-v2-plan.mjs'), { mapResponsiveBindings } = await importTool('pet-v2-responsive-mapping.mjs');
    const mappings = mapResponsiveBindings({ desktopPackets: { 'observed-region': data.desktop }, variantPackets: { 'observed-region': data.mobile }, bindings: [binding()] });
    const adaptations = [{ sourceFactIds: ['desktop-scene:text:title'], rule: 'Preserve the measured source title color in the actual same-owner typed label.', target: { componentKey: 'actual-card', kind: 'layout', selector: '#actual-title', property: 'color', expected: 'rgb(61, 57, 53)' } }];
    await data.writeInput([data.desktop, data.mobile], { mappings, adaptations }); await authorPetPlanV2(data.directory); const plan = await readJson(data.directory, 'component-plan.json');
    const responsive = plan.requirements.find((item: any) => item.factIds.includes('mobile-scene:text:m-title')); assert.equal(responsive.disposition, 'adapt'); assert.equal(responsive.verification.expected, 'rgb(0, 76, 219)');
    const missing = structuredClone(mappings); missing.mappings[0].nodeMappings = missing.mappings[0].nodeMappings.filter((item: any) => item.desktopNodeId !== 'title'); missing.mappings[0].slotNodes.text.title = [];
    await data.writeInput([data.desktop, data.mobile], { mappings: missing, adaptations }); await assert.rejects(authorPetPlanV2(data.directory), /named source planning gaps/); assert.ok((await readJson(data.directory, 'plan-gaps.json')).gaps.some((item: any) => item.code === 'responsive-adaptation-unmapped'));
  } finally { await data.cleanup(); }
});

test('responsive media never chooses an inactive candidate without actual same-owner src evidence', async () => {
  const data = await setup();
  try {
    const { authorPetPlanV2 } = await importTool('author-pet-v2-plan.mjs'), { mapResponsiveBindings } = await importTool('pet-v2-responsive-mapping.mjs');
    data.mobile.usages.current.attribute = 'srcset';
    const mappings = mapResponsiveBindings({ desktopPackets: { 'observed-region': data.desktop }, variantPackets: { 'observed-region': data.mobile }, bindings: [binding()] });
    await data.writeInput([data.desktop, data.mobile], { mappings }); await assert.rejects(authorPetPlanV2(data.directory), /named source planning gaps/);
    assert.ok((await readJson(data.directory, 'plan-gaps.json')).gaps.some((item: any) => /same-owner src\/currentSrc/.test(item.reason)));
  } finally { await data.cleanup(); }
});

test('picture actual src remains current paint evidence and is never confused with inactive srcset candidates', async () => {
  const data = await setup();
  try {
    const { authorPetPlanV2 } = await importTool('author-pet-v2-plan.mjs'), { mapResponsiveBindings } = await importTool('pet-v2-responsive-mapping.mjs');
    data.mobile.usages.current.kind = 'picture';
    const mappings=mapResponsiveBindings({desktopPackets:{'observed-region':data.desktop},variantPackets:{'observed-region':data.mobile},bindings:[binding()]});
    await data.writeInput([data.desktop,data.mobile],{mappings});await authorPetPlanV2(data.directory);
    const requirements=(await readJson(data.directory,'component-plan.json')).requirements.filter((item:any)=>item.verification.snapshotId==='mobile-scene'&&item.verification.kind==='media');
    assert.ok(requirements.length);assert.ok(requirements.every((item:any)=>item.verification.expected.assetKey==='narrow'));
  } finally {await data.cleanup();}
});

test('frozen desktop text targets carry through explicit evidence nodes without widening responsive source ownership', async () => {
  const data = await setup();
  try {
    const { authorPetPlanV2 } = await importTool('author-pet-v2-plan.mjs'), { mapResponsiveBindings,deriveResponsiveEvidenceBindingsV2 } = await importTool('pet-v2-responsive-mapping.mjs');
    for(const [p,prefix] of [[data.desktop,''],[data.mobile,'m-']] as const){p.nodes[prefix+'duplicate']={...p.nodes[prefix+'title'],id:prefix+'duplicate',visible:false};p.nodes[prefix+'link'].childIds.push(prefix+'duplicate');p.texts.duplicate={nodeId:prefix+'duplicate',text:'Actual source heading'};}
    await data.writeInput([data.desktop]);await authorPetPlanV2(data.directory);
    const desktopBytes=await readFile(path.join(data.directory,'source-facts.json')),frozen=await readJson(data.directory,'component-plan.json');
    await writeFile(path.join(data.directory,'source-facts-desktop.json'),desktopBytes);frozen.sourceFacts={path:'source-facts-desktop.json',sha256:digest(desktopBytes)};
    const frozenBytes=json(frozen);await writeFile(path.join(data.directory,'desktop-plan.json'),frozenBytes);
    const input=await data.writeInput([data.desktop,data.mobile]);
    const bindings=deriveResponsiveEvidenceBindingsV2({bindings:input.authored.bindings,adaptations:input.authored.adaptations,sourceFacts:input.source,desktopPackets:{'observed-region':data.desktop},desktopSnapshotId:'desktop-scene',componentPlan:frozen});
    assert.ok(bindings[0].evidenceNodeIds.includes('duplicate'));assert.deepEqual(bindings[0].sourceNodeIds,['root']);assert.deepEqual(bindings[0].slotNodes,input.authored.bindings[0].slotNodes);
    const mappings=mapResponsiveBindings({desktopPackets:{'observed-region':data.desktop},variantPackets:{'observed-region':data.mobile},bindings});assert.deepEqual(mappings.gaps,[]);
    const authored={...input.authored,bindings,responsiveMappings:mappings,desktopComponentPlan:{path:'desktop-plan.json',sha256:digest(frozenBytes)}};
    await writeFile(path.join(data.directory,'authored-desktop.json'),json(authored));await authorPetPlanV2(data.directory);
    const plan=await readJson(data.directory,'component-plan.json'),requirement=plan.requirements.find((r:any)=>r.factIds.includes('mobile-scene:text:m-duplicate'));
    assert.equal(requirement.verification.kind,'text');assert.match(requirement.verification.selector,/data-cwp-text="title"/);assert.equal(requirement.disposition,'adapt');assert.match(requirement.rule,/frozen desktop target binding/);
    const altered=structuredClone(authored);altered.responsiveMappings.mappings[0].evidenceNodeIds=altered.responsiveMappings.mappings[0].evidenceNodeIds.filter((id:string)=>id!=='m-duplicate');
    await writeFile(path.join(data.directory,'authored-desktop.json'),json(altered));await assert.rejects(authorPetPlanV2(data.directory),/named source planning gaps/);
    authored.desktopComponentPlan.sha256='0'.repeat(64);await writeFile(path.join(data.directory,'authored-desktop.json'),json(authored));await assert.rejects(authorPetPlanV2(data.directory),/Frozen desktop component plan bytes changed/);
  } finally {await data.cleanup();}
});

test('one actual text node cannot silently select the first of multiple exact target slots',async()=>{
  const data=await setup();
  try{
    const {authorPetPlanV2}=await importTool('author-pet-v2-plan.mjs'),input=await data.writeInput([data.desktop]);input.authored.blocks[0].template+='<span data-cwp-text="duplicate"></span>';input.authored.blocks[0].slots.text.duplicate='Actual source heading';input.authored.bindings[0].slotNodes.text.duplicate=['title'];await writeFile(path.join(data.directory,'authored-desktop.json'),json(input.authored));
    await assert.rejects(authorPetPlanV2(data.directory),/named source planning gaps/);const gaps=(await readJson(data.directory,'plan-gaps.json')).gaps;assert.ok(gaps.some((gap:any)=>gap.factId==='desktop-scene:text:title'&&/ambiguously assigned/.test(gap.reason)&&gap.slots.length===2));
  }finally{await data.cleanup();}
});

test('current proved text slots override a stale frozen selector and retain each exact source node visibility',async()=>{
  const data=await setup();
  try{
    const {authorPetPlanV2}=await importTool('author-pet-v2-plan.mjs'),{deriveResponsiveEvidenceBindingsV2,mapResponsiveBindings}=await importTool('pet-v2-responsive-mapping.mjs');await data.writeInput([data.desktop]);await authorPetPlanV2(data.directory);const oldBytes=await readFile(path.join(data.directory,'source-facts.json')),frozen=await readJson(data.directory,'component-plan.json');await writeFile(path.join(data.directory,'desktop-source.json'),oldBytes);frozen.sourceFacts={path:'desktop-source.json',sha256:digest(oldBytes)};const frozenBytes=json(frozen);await writeFile(path.join(data.directory,'desktop-plan.json'),frozenBytes);
    const input=await data.writeInput([data.desktop,data.mobile]);input.authored.blocks[0].template=input.authored.blocks[0].template.replace('data-cwp-text="title"','data-cwp-text="authoritative"');input.authored.blocks[0].slots.text={authoritative:'Actual source heading'};input.authored.bindings[0].slotNodes.text={authoritative:['title']};input.authored.bindings=deriveResponsiveEvidenceBindingsV2({bindings:input.authored.bindings,sourceFacts:input.source,desktopPackets:{'observed-region':data.desktop},desktopSnapshotId:'desktop-scene',componentPlan:frozen});input.authored.responsiveMappings=mapResponsiveBindings({desktopPackets:{'observed-region':data.desktop},variantPackets:{'observed-region':data.mobile},bindings:input.authored.bindings});input.authored.desktopComponentPlan={path:'desktop-plan.json',sha256:digest(frozenBytes)};await writeFile(path.join(data.directory,'authored-desktop.json'),json(input.authored));await authorPetPlanV2(data.directory);
    const requirement=(await readJson(data.directory,'component-plan.json')).requirements.find((r:any)=>r.factIds.includes('mobile-scene:text:m-title'));assert.match(requirement.verification.selector,/data-cwp-text="authoritative"/);assert.deepEqual(requirement.verification.expected,{text:'Actual source heading',visible:true});assert.doesNotMatch(requirement.rule,/frozen desktop target binding/);
  }finally{await data.cleanup();}
});

test('a newly active source counterpart needs its own proved slot or an explicit adaptation, never a same-copy frozen union',async()=>{
  const data=await setup();
  try{
    const {authorPetPlanV2}=await importTool('author-pet-v2-plan.mjs'),{deriveResponsiveEvidenceBindingsV2,mapResponsiveBindings}=await importTool('pet-v2-responsive-mapping.mjs');for(const[p,prefix]of[[data.desktop,''],[data.mobile,'m-']]as const){p.nodes[prefix+'counterpart']={...p.nodes[prefix+'title'],id:prefix+'counterpart',visible:!!prefix};p.nodes[prefix+'link'].childIds.push(prefix+'counterpart');p.texts.counterpart={nodeId:prefix+'counterpart',text:'Actual source heading'};}
    await data.writeInput([data.desktop]);await authorPetPlanV2(data.directory);const oldBytes=await readFile(path.join(data.directory,'source-facts.json')),frozen=await readJson(data.directory,'component-plan.json');await writeFile(path.join(data.directory,'desktop-source.json'),oldBytes);frozen.sourceFacts={path:'desktop-source.json',sha256:digest(oldBytes)};const frozenBytes=json(frozen);await writeFile(path.join(data.directory,'desktop-plan.json'),frozenBytes);
    const input=await data.writeInput([data.desktop,data.mobile]);input.authored.bindings=deriveResponsiveEvidenceBindingsV2({bindings:input.authored.bindings,sourceFacts:input.source,desktopPackets:{'observed-region':data.desktop},desktopSnapshotId:'desktop-scene',componentPlan:frozen});input.authored.responsiveMappings=mapResponsiveBindings({desktopPackets:{'observed-region':data.desktop},variantPackets:{'observed-region':data.mobile},bindings:input.authored.bindings});input.authored.desktopComponentPlan={path:'desktop-plan.json',sha256:digest(frozenBytes)};await writeFile(path.join(data.directory,'authored-desktop.json'),json(input.authored));await assert.rejects(authorPetPlanV2(data.directory),/named source planning gaps/);assert.ok((await readJson(data.directory,'plan-gaps.json')).gaps.some((gap:any)=>gap.factId==='mobile-scene:text:m-counterpart'&&/no exact owned/.test(gap.reason)));
    const explicit=structuredClone(input.authored);explicit.adaptations.push({snapshotId:'mobile-scene',sourceFactIds:['mobile-scene:text:m-counterpart'],disposition:'adapt',rule:'Explicitly consolidate this redundant source counterpart into the already proved live label while separately checking its current placement and interaction.',target:{componentKey:'actual-card',kind:'text',slot:'title',expected:{text:'Actual source heading',visible:true}}});await writeFile(path.join(data.directory,'authored-desktop.json'),json(explicit));await authorPetPlanV2(data.directory);
    input.authored.blocks[0].template+='<h3 data-cwp-text="compact"></h3>';input.authored.blocks[0].slots.text.compact='Actual source heading';input.authored.bindings[0].slotNodes.text.compact=['counterpart'];input.authored.responsiveMappings=mapResponsiveBindings({desktopPackets:{'observed-region':data.desktop},variantPackets:{'observed-region':data.mobile},bindings:input.authored.bindings});await writeFile(path.join(data.directory,'authored-desktop.json'),json(input.authored));await authorPetPlanV2(data.directory);const plan=await readJson(data.directory,'component-plan.json');for(const[id,visible]of[['desktop-scene:text:counterpart',false],['mobile-scene:text:m-counterpart',true]]){const requirement=plan.requirements.find((r:any)=>r.factIds.includes(id));assert.match(requirement.verification.selector,/data-cwp-text="compact"/);assert.equal(requirement.verification.expected.visible,visible);}
  }finally{await data.cleanup();}
});

test('frozen hidden media preserves only the same external href or the same selected resource and typed asset slot', async () => {
  const data=await setup();
  try {
    const {authorPetPlanV2}=await importTool('author-pet-v2-plan.mjs'),{mapResponsiveBindings,deriveResponsiveEvidenceBindingsV2}=await importTool('pet-v2-responsive-mapping.mjs');
    for(const [p,prefix] of [[data.desktop,''],[data.mobile,'m-']] as const){
      p.resources.logo={url:'https://source.example/logo.svg'};p.resources.brand={url:'https://source.example/brand.png'};
      for(const id of ['logo','duplicate-logo','brand-image'])p.nodes[prefix+id]={...p.nodes[prefix+'image'],id:prefix+id,parentId:prefix+'root',visible:id==='logo'};
      p.nodes[prefix+'root'].childIds.push(prefix+'logo',prefix+'duplicate-logo',prefix+'brand-link');p.nodes[prefix+'brand-link']={...p.nodes[prefix+'link'],id:prefix+'brand-link',parentId:prefix+'root',attributes:{href:'https://source.example/brand/'},childIds:[prefix+'brand-image']};p.nodes[prefix+'brand-image'].parentId=prefix+'brand-link';
      for(const id of ['logo','duplicate-logo','brand-image'])p.usages[id]={nodeId:prefix+id,kind:'img',attribute:'src',resourceId:id==='brand-image'?'brand':'logo'};
      p.usages.logoCandidate={nodeId:prefix+'duplicate-logo',kind:'picture',attribute:'srcset',resourceId:'logo'};
    }
    const manifest=await readJson(data.directory,'asset-manifest.json');manifest.assets.push({key:'logo',sourceUrl:data.desktop.resources.logo.url});await writeFile(path.join(data.directory,'asset-manifest.json'),json(manifest));
    const amend=async(input:any)=>{const b=input.authored.blocks[0];b.template+='<img data-cwp-media="logo"><a data-cwp-link="brand"></a>';b.slots.media.logo={assetKey:'logo'};b.slots.links.brand={url:'https://source.example/brand/'};input.authored.bindings[0].slotNodes.media.logo=['logo'];return input;};
    const baseline=await amend(await data.writeInput([data.desktop]));await writeFile(path.join(data.directory,'authored-desktop.json'),json(baseline.authored));await authorPetPlanV2(data.directory);
    const baseBytes=await readFile(path.join(data.directory,'source-facts.json')),frozen=await readJson(data.directory,'component-plan.json');await writeFile(path.join(data.directory,'source-facts-desktop.json'),baseBytes);frozen.sourceFacts={path:'source-facts-desktop.json',sha256:digest(baseBytes)};const frozenBytes=json(frozen);await writeFile(path.join(data.directory,'desktop-plan.json'),frozenBytes);
    const authorInput=async()=>{const input=await amend(await data.writeInput([data.desktop,data.mobile]));input.authored.bindings=deriveResponsiveEvidenceBindingsV2({bindings:input.authored.bindings,sourceFacts:input.source,desktopPackets:{'observed-region':data.desktop},desktopSnapshotId:'desktop-scene',componentPlan:frozen});input.authored.responsiveMappings=mapResponsiveBindings({desktopPackets:{'observed-region':data.desktop},variantPackets:{'observed-region':data.mobile},bindings:input.authored.bindings});input.authored.desktopComponentPlan={path:'desktop-plan.json',sha256:digest(frozenBytes)};await writeFile(path.join(data.directory,'authored-desktop.json'),json(input.authored));return input;};
    const input=await authorInput();assert.deepEqual(input.authored.responsiveMappings.gaps,[]);await authorPetPlanV2(data.directory);const plan=await readJson(data.directory,'component-plan.json');
    const hidden=Object.values(input.source.facts).filter((f:any)=>f.snapshotId==='mobile-scene'&&f.nodeId==='m-brand-image') as any[];assert.ok(hidden.length);assert.equal(plan.requirements.find((r:any)=>r.factIds.includes(hidden[0].id)).verification.expected,'https://source.example/brand/');
    const duplicate=Object.values(input.source.facts).filter((f:any)=>f.snapshotId==='mobile-scene'&&f.nodeId==='m-duplicate-logo') as any[];assert.ok(duplicate.every(f=>plan.requirements.find((r:any)=>r.factIds.includes(f.id)).verification.expected.assetKey==='logo'));
    data.mobile.usages['duplicate-logo'].resourceId='narrow';const changed=await authorInput();assert.deepEqual(changed.authored.responsiveMappings.gaps,[]);await assert.rejects(authorPetPlanV2(data.directory),/named source planning gaps/);
    assert.ok((await readJson(data.directory,'plan-gaps.json')).gaps.some((g:any)=>g.sourceNodeId==='m-duplicate-logo'&&g.code==='unbound-media'));
  }finally{await data.cleanup();}
});

test('carousel decisions follow a proved track and every real item when the collector widens the owner to include sibling controls',async()=>{
  const data=await setup();
  try{
    const {authorPetPlanV2}=await importTool('author-pet-v2-plan.mjs'),{mapResponsiveBindings,deriveResponsiveEvidenceBindingsV2}=await importTool('pet-v2-responsive-mapping.mjs');withCarousel(data.desktop,'',6);withCarousel(data.mobile,'m-',2);
    for(const[p,prefix]of[[data.desktop,''],[data.mobile,'m-']]as const){p.nodes[prefix+'wrapper']={...p.nodes[prefix+'track'],id:prefix+'wrapper',parentId:prefix+'root',childIds:[prefix+'track']};p.nodes[prefix+'root'].childIds=[prefix+'wrapper',prefix+'next'];p.nodes[prefix+'track'].parentId=prefix+'wrapper';p.nodes[prefix+'next']={...p.nodes[prefix+'root'],id:prefix+'next',tag:'button',parentId:prefix+'root',childIds:[]};p.interactions.carousel.nodeId=prefix+(prefix?'root':'wrapper');p.interactions.carousel.controlNodeIds=prefix?[prefix+'next']:[];}
    const input=await data.writeInput([data.desktop,data.mobile]);for(const p of[data.desktop,data.mobile]){const sn=input.source.snapshots.find((s:any)=>s.id===p.snapshot.id),id=p.snapshot.id+':interaction:carousel';input.source.facts[id]={id,snapshotId:p.snapshot.id,regionId:'observed-region',nodeId:p.interactions.carousel.nodeId,kind:'interaction',evidence:sn.evidence[0],value:p.interactions.carousel};}
    const originalBinding=input.authored.bindings[0];input.authored.blocks=[{key:'actual-carousel',kind:'native-carousel',slides:[input.authored.blocks[0]]}];input.authored.bindings=[{componentKey:'actual-carousel',regionIds:['observed-region'],sourceNodeIds:['wrapper']},originalBinding];input.authored.adaptations=[{sourceFactIds:['desktop-scene:interaction:carousel'],rule:'Use verified native manual navigation with actual live pagination.',target:{componentKey:'actual-carousel',kind:'interaction',selector:'#real-native-carousel',property:'carousel',expected:{manual:true,pagination:'bullets'}}}];
    input.authored.bindings=deriveResponsiveEvidenceBindingsV2({bindings:input.authored.bindings,adaptations:input.authored.adaptations,sourceFacts:input.source,desktopPackets:{'observed-region':data.desktop},desktopSnapshotId:'desktop-scene'});assert.ok(input.authored.bindings[0].evidenceNodeIds.includes('track'));
    input.authored.responsiveMappings=mapResponsiveBindings({desktopPackets:{'observed-region':data.desktop},variantPackets:{'observed-region':data.mobile},bindings:input.authored.bindings});assert.deepEqual(input.authored.responsiveMappings.gaps,[]);const bytes=json(input.source);input.authored.sourceHash=digest(bytes);await writeFile(path.join(data.directory,'source-facts.json'),bytes);await writeFile(path.join(data.directory,'authored-desktop.json'),json(input.authored));await authorPetPlanV2(data.directory);
    const requirement=(await readJson(data.directory,'component-plan.json')).requirements.find((r:any)=>r.factIds.includes('mobile-scene:interaction:carousel'));assert.equal(requirement.componentId,'actual-carousel');assert.deepEqual(requirement.verification.expected,{manual:true,pagination:'bullets'});assert.equal(requirement.verification.selector,'#real-native-carousel');
  }finally{await data.cleanup();}
});

test('Pet plan replays real-item ordinal proofs across changed carousel clone counts and rejects forged, duplicate or unused slots', async () => {
  const data = await setup();
  try {
    const { authorPetPlanV2 } = await importTool('author-pet-v2-plan.mjs'), { mapResponsiveBindings } = await importTool('pet-v2-responsive-mapping.mjs');
    withCarousel(data.desktop, '', 6); withCarousel(data.mobile, 'm-', 2);
    const mappings = mapResponsiveBindings({ desktopPackets: { 'observed-region': data.desktop }, variantPackets: { 'observed-region': data.mobile }, bindings: [binding()] }); assert.deepEqual(mappings.gaps, []);
    const imageProof = mappings.mappings[0].nodeMappings.find((proof: any) => proof.desktopNodeId === 'image'); assert.equal(imageProof.carouselSlots[0].desktopChildIndex, 6); assert.equal(imageProof.carouselSlots[0].variantChildIndex, 2);
    await data.writeInput([data.desktop, data.mobile], { mappings }); await authorPetPlanV2(data.directory); const plan = await readJson(data.directory, 'component-plan.json'); assert.equal(plan.components[0].variants[1].snapshotId, 'mobile-scene');
    for (const tamper of [(proof: any) => { proof.carouselSlots[0].realItemOrdinal = 1; }, (proof: any) => { proof.carouselSlots.push(structuredClone(proof.carouselSlots[0])); }, (proof: any) => { proof.carouselSlots[0].pathOffset = proof.path.length; }, (proof: any) => { proof.carouselSlots[0].unproved = true; }]) {
      const altered = structuredClone(mappings); tamper(altered.mappings[0].nodeMappings.find((proof: any) => proof.desktopNodeId === 'image'));
      await data.writeInput([data.desktop, data.mobile], { mappings: altered }); await assert.rejects(authorPetPlanV2(data.directory), /named source planning gaps/);
      assert.ok((await readJson(data.directory, 'plan-gaps.json')).gaps.some((gap: any) => gap.code === 'responsive-binding-invalid'));
    }
  } finally { await data.cleanup(); }
});

test('each scene vendor utility resolves through the real source entrance requirement from its own snapshot', async () => {
  const data = await setup();
  try {
    const { authorPetPlanV2 } = await importTool('author-pet-v2-plan.mjs'), { mapResponsiveBindings } = await importTool('pet-v2-responsive-mapping.mjs');
    data.desktop.nodes.link.attributes.href = 'https://source.example/'; data.mobile.nodes['m-link'].attributes.href = 'https://source.example/';
    const inputBinding = { ...binding(), componentKey: 'header' }, mappings = mapResponsiveBindings({ desktopPackets: { 'observed-region': data.desktop }, variantPackets: { 'observed-region': data.mobile }, bindings: [inputBinding] });
    const { source, authored } = await data.writeInput([data.desktop, data.mobile], { mappings });
    authored.blocks[0].key = 'header'; authored.blocks[0].slots.links.destination.url = source.sourceUrl; authored.bindings[0].componentKey = 'header';
    source.sceneInventories = [];
    for (const snapshot of source.snapshots) {
      const filename = path.join(data.directory, `${snapshot.id}.inventory.json`), bytes = json({ entries: { feedback: { id: 'feedback', utility: true } } }); await writeFile(filename, bytes);
      source.sceneInventories.push({ snapshotId: snapshot.id, path: filename, sha256: digest(bytes) });
    }
    for (const fact of Object.values(source.facts) as any[]) if (fact.kind === 'interaction') fact.value.href = source.sourceUrl;
    const sourceBytes = json(source); authored.sourceHash = digest(sourceBytes); await writeFile(path.join(data.directory, 'source-facts.json'), sourceBytes); await writeFile(path.join(data.directory, 'authored-desktop.json'), json(authored));
    await authorPetPlanV2(data.directory); const plan = await readJson(data.directory, 'component-plan.json'); assert.equal(plan.inventoryResolutions.length, 2);
    for (const resolution of plan.inventoryResolutions) {
      const requirement = plan.requirements.find((item: any) => item.id === resolution.requirementId); assert.equal(requirement.verification.snapshotId, resolution.snapshotId); assert.equal(requirement.verification.expected, source.sourceUrl); assert.equal(requirement.disposition, 'adapt');
    }
  } finally { await data.cleanup(); }
});

test('only exact declared CSS background pairs may change media at the same proved responsive owner', async () => {
  const data = await setup();
  try {
    const { authorPetPlanV2 } = await importTool('author-pet-v2-plan.mjs'), { mapResponsiveBindings } = await importTool('pet-v2-responsive-mapping.mjs'), { proveCssBackgroundVariantV2 } = await importTool('pet-v2-media-variants.mjs');
    data.desktop.nodes.image.tag = 'div'; data.mobile.nodes['m-image'].tag = 'div';
    data.desktop.usages = { oldBackground: { id:'oldBackground',nodeId:'image',regionId:'observed-region',kind:'background',attribute:'background-image',resourceId:'wide',visible:true } };
    data.mobile.usages = { newBackground: { id:'newBackground',nodeId:'m-image',regionId:'observed-region',kind:'background',attribute:'background-image',resourceId:'narrow',visible:true } };
    const initial = await data.writeInput([data.desktop,data.mobile]), declaration = {kind:'css-background',desktopSnapshotId:'desktop-scene',snapshotId:'mobile-scene',regionId:'observed-region',desktopNodeId:'image',variantNodeId:'m-image',desktopUsageId:'oldBackground',variantUsageId:'newBackground',desktopURL:data.desktop.resources.wide.url,variantURL:data.mobile.resources.narrow.url,desktopEvidence:initial.source.facts['desktop-scene:media:oldBackground'].evidence,variantEvidence:initial.source.facts['mobile-scene:media:newBackground'].evidence};
    const arguments_ = { desktopPackets:{'observed-region':data.desktop},variantPackets:{'observed-region':data.mobile},bindings:[binding()] };
    assert.ok(mapResponsiveBindings(arguments_).gaps.some((gap:any)=>/Media resources/.test(gap.message)));
    const mappings = mapResponsiveBindings({...arguments_,explicitMediaVariants:[declaration]}); assert.deepEqual(mappings.gaps,[]);
    const {authored} = await data.writeInput([data.desktop,data.mobile],{mappings}); authored.blocks[0].template = authored.blocks[0].template.replace('<img data-cwp-media="image">','<div data-cwp-background="image"></div>');
    await writeFile(path.join(data.directory,'authored-desktop.json'),json(authored)); await authorPetPlanV2(data.directory); const plan = await readJson(data.directory,'component-plan.json'); assert.equal(plan.requirements.find((item:any)=>item.factIds.includes('mobile-scene:media:newBackground')).verification.expected.assetKey,'narrow');
    const forged = structuredClone(authored); forged.responsiveMappings.mappings[0].explicitMediaVariants[0].variantEvidence.sha256 = '0'.repeat(64); await writeFile(path.join(data.directory,'authored-desktop.json'),json(forged)); await assert.rejects(authorPetPlanV2(data.directory),/named source planning gaps/);
    assert.ok((await readJson(data.directory,'plan-gaps.json')).gaps.some((gap:any)=>/independently hashed source facts/.test(gap.reason)));
    const image = structuredClone(data.desktop); image.usages.oldBackground.kind='img'; assert.throws(()=>proveCssBackgroundVariantV2({desktopPacket:image,variantPacket:data.mobile,declaration}),/never img or SVG/);
    image.usages.oldBackground.kind='svg'; assert.throws(()=>proveCssBackgroundVariantV2({desktopPacket:image,variantPacket:data.mobile,declaration}),/never img or SVG/);
  } finally {await data.cleanup();}
});

test('explicit responsive owner pairs replay actual packet hashes and never become blanket component identity', async () => {
  const data = await setup();
  try {
    const { authorPetPlanV2 } = await importTool('author-pet-v2-plan.mjs'), { mapResponsiveBindings } = await importTool('pet-v2-responsive-mapping.mjs');
    data.mobile.nodes['m-root'].childIds.unshift('m-extra');
    data.mobile.nodes['m-extra'] = { ...data.mobile.nodes['m-root'], id: 'm-extra', parentId: 'm-root', childIds: [], tag: 'div', attributes: { class: 'unrelated-source-slot' } };
    data.mobile.usages.current.resourceId = 'wide';
    const initial = await data.writeInput([data.desktop, data.mobile]);
    const desktopEvidence = initial.source.snapshots[0].evidence[0], variantEvidence = initial.source.snapshots[1].evidence[0];
    const declarations = ['link', 'title', 'image'].map((nodeId, index) => ({
      version: 1, desktopSnapshotId: 'desktop-scene', snapshotId: 'mobile-scene', regionId: 'observed-region', desktopEvidence, variantEvidence,
      desktopNodeId: nodeId, variantNodeId: 'm-' + nodeId, desktopOwnerPath: [0], variantOwnerPath: [1],
      ownerIdentity: { tag: 'a', attributes: data.desktop.nodes.link.attributes }, desktopPath: index ? [index - 1] : [], variantPath: index ? [index - 1] : [],
      leafIdentity: { tag: data.desktop.nodes[nodeId].tag, attributes: data.desktop.nodes[nodeId].attributes }
    }));
    const arguments_ = { desktopPackets: { 'observed-region': data.desktop }, variantPackets: { 'observed-region': data.mobile }, bindings: [binding()] };
    assert.ok(mapResponsiveBindings(arguments_).gaps.length > 0);
    const mappings = mapResponsiveBindings({ ...arguments_, explicitNodeVariants: declarations }); assert.deepEqual(mappings.gaps, []);
    assert.equal(mappings.mappings[0].nodeMappings.filter((proof: any) => proof.explicitNodeVariant).length, 3);
    assert.equal(mappings.mappings[0].nodeMappings.find((proof: any) => proof.desktopNodeId === 'root').explicitNodeVariant, undefined);
    await data.writeInput([data.desktop, data.mobile], { mappings }); await authorPetPlanV2(data.directory);
    assert.deepEqual((await readJson(data.directory, 'component-plan.json')).components[0].variants[1].nodeIds, ['m-root']);
    for (const tamper of [
      (proof: any) => { proof.explicitNodeVariant.proofSha256 = '0'.repeat(64); },
      (proof: any) => { proof.explicitNodeVariant.declaration.variantOwnerPath = [0]; },
      (proof: any) => { proof.explicitNodeVariant.declaration.variantEvidence.sha256 = '0'.repeat(64); },
      (proof: any) => { proof.explicitNodeVariant.declaration.variantEvidence.path += '.unobserved'; },
      (proof: any) => { proof.variantNodeId = 'm-extra'; },
      (proof: any) => { proof.unverified = true; }
    ]) {
      const altered = structuredClone(mappings); tamper(altered.mappings[0].nodeMappings.find((proof: any) => proof.desktopNodeId === 'title'));
      await data.writeInput([data.desktop, data.mobile], { mappings: altered }); await assert.rejects(authorPetPlanV2(data.directory), /named source planning gaps/);
      assert.ok((await readJson(data.directory, 'plan-gaps.json')).gaps.some((gap: any) => gap.code === 'responsive-binding-invalid' && /Explicit source owner mapping/.test(gap.reason)));
    }
    const duplicate = mapResponsiveBindings({ ...arguments_, explicitNodeVariants: [...declarations, declarations[1]] });
    assert.ok(duplicate.gaps.some((gap: any) => gap.desktopNodeId === 'title' && /duplicate explicit variant/.test(gap.message)));
  } finally { await data.cleanup(); }
});
