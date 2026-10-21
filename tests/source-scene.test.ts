import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { normalizeSourceScene, sourceSceneBindingSchema, type SourceSceneInventory, type SourceSceneBinding } from '../src/reference/source-scene.js';
import { auditSourceCoverage } from '../src/fidelity/source-coverage.js';
import type { NativeProgram } from '../src/fidelity/types.js';

const provenance={sourceUrl:'https://public.example/',capturedAt:'2026-10-14T00:00:00Z',evidencePath:'D:/cloneWP/references/fixture/reference/desktop.json',viewportName:'desktop',deviceProfile:'desktop' as const};
test('independent source inventory recognizes vanilla scroll and ARIA tracks, sibling pause/fraction/dots, without assigning adjacent service actions',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1000,height:800}}),expression=await readFile(new URL('../src/reference/collect-blocks.browser.js',import.meta.url),'utf8');
    await page.setContent(`<!doctype html><style>
      body{margin:0}main{max-width:900px;margin:auto}section{padding:12px} .rail{width:400px;display:flex;overflow-x:auto;scroll-snap-type:x mandatory}.card{min-width:240px;height:100px;scroll-snap-align:start}.card a{display:block}
      .viewport{width:400px;overflow:hidden}.moving{display:flex;width:1000px}.slide{min-width:250px;height:100px;transform:translateX(-10px)}
      .controls{display:flex;gap:8px}.controls button{height:30px;min-width:30px}
      </style><header><button id="services">Book Services</button></header><main>
      <section id="vanilla"><h2>Collections</h2><div id="rail" class="rail"><article class="card"><a href="/a">Alpha</a></article><article class="card"><a href="/b">Beta</a></article><article class="card"><a href="/c">Gamma</a></article></div>
      <div class="controls"><button id="back" aria-controls="rail" aria-label="Previous slide">←</button><output id="fraction">1 / 3</output><button id="next" aria-controls="rail" aria-label="Next slide">→</button><button id="pause" aria-controls="rail" aria-label="Pause autoplay">Ⅱ</button></div>
      <div role="tablist"><button id="dot1" role="tab" aria-controls="rail" aria-selected="true">1</button><button id="dot2" role="tab" aria-controls="rail">2</button><button id="dot3" role="tab" aria-controls="rail">3</button></div><button id="book">Book Services</button></section>
      <section id="custom" aria-roledescription="carousel"><div class="viewport"><div id="custom-rail" class="moving"><div class="slide" aria-roledescription="slide"><a href="/d">Delta</a></div><div class="slide" aria-roledescription="slide"><a href="/e">Epsilon</a></div></div></div><button id="custom-next" aria-label="Next" aria-controls="custom-rail">›</button></section>
      </main><footer><p>Static footer</p></footer>`);
    const result=await page.evaluate(`(${expression})({includeNodes:false})`) as {sourceScene:unknown},inventory=normalizeSourceScene(result.sourceScene,provenance)!;
    assert.ok(inventory);assert.ok(inventory.items.some(item=>item.kind==='repeated-template'&&item.selector==='#rail'));
    const control=(id:string)=>inventory.items.find(item=>item.kind==='control'&&item.selector===`#${id}`)!;
    assert.equal(control('back').role,'previous');assert.equal(control('next').role,'next');assert.equal(control('pause').role,'autoplay');assert.equal(control('fraction').role,'fraction');assert.equal(control('dot2').role,'dot');
    for(const id of ['back','next','pause','fraction','dot1','dot2','dot3'])assert.ok(control(id).ownerId,`${id} retains proven track ownership`);
    assert.equal(control('book').role,'action');assert.equal(control('book').ownerId,undefined);assert.equal(control('services').ownerId,undefined);
    assert.ok(control('custom-next').ownerId);assert.ok(inventory.items.some(item=>item.kind==='control-group'&&item.facts.pagination==='fraction'));assert.ok(inventory.items.some(item=>item.kind==='control-group'&&item.facts.pagination==='bullets'));
    assert.equal(control('pause').facts.behavior,'unobserved');
    const deleted=inventory.items.filter(item=>item.selector!=='#pause');assert.equal(deleted.length,inventory.items.length-1);
    const restricted=await page.evaluate('(() => { const navigator=undefined,matchMedia=undefined,devicePixelRatio=undefined,CSS={escape:globalThis.CSS.escape}; return ('+expression+')({includeNodes:false}); })()') as {sourceScene:unknown};
    const restrictedInventory=normalizeSourceScene(restricted.sourceScene,provenance)!;
    assert.ok(restrictedInventory.items.length);assert.equal(restrictedInventory.viewport.touch,null);assert.equal(restrictedInventory.viewport.devicePixelRatio,null);assert.equal(restrictedInventory.status,'partial');assert.ok(restrictedInventory.gaps.some(gap=>gap.code==='scene-environment-unobserved'));
  }finally{await browser.close();}
});

const inventory=(viewport:string):SourceSceneInventory=>({version:1,method:'independent-public-dom-scene',sourceUrl:provenance.sourceUrl,capturedAt:provenance.capturedAt,evidencePath:provenance.evidencePath,viewport:{name:viewport,width:1000,height:800,clientWidth:1000,devicePixelRatio:1,touch:false,coarsePointer:false,deviceProfile:'desktop'},state:'resting',status:'observed',notice:'Independent fixture',gaps:[],items:[
  {id:'block',kind:'block',selector:'#hero',sourceBlockId:'source-hero',rect:{x:50,y:0,width:900,height:400},visible:true,required:true,state:'resting',facts:{order:0},evidence:['public-DOM']},
  {id:'template',kind:'repeated-template',selector:'#rail',sourceBlockId:'source-hero',rect:{x:50,y:0,width:900,height:400},visible:true,required:true,state:'resting',facts:{itemCount:3},evidence:['public-DOM']},
  {id:'pause',kind:'control',selector:'#pause',sourceBlockId:'source-hero',ownerId:'template',role:'autoplay',rect:{x:50,y:390,width:20,height:20},visible:true,required:true,state:'resting',facts:{behavior:'unobserved'},evidence:['public-DOM']},
]});
const bindings=(scene:SourceSceneInventory):SourceSceneBinding[]=>scene.items.map(item=>({viewport:scene.viewport.name,sourceId:item.id,blockId:'hero',targetKey:item.kind==='control'?'hero-pause':'hero',requirement:item.kind}));
test('source completeness rejects deleted pause, invented features and changed block order; legacy inventory cannot pass',()=>{
  const scenes=['desktop','tablet','mobile'].map(inventory),views=Object.fromEntries(scenes.map(scene=>[scene.viewport.name,{status:'observed',width:1000,evidence:['DOM'],regions:[{id:'template-measured',sourceNodeId:'#rail',rect:{x:0,y:0,width:900,height:400}}],media:[],controlGroups:[{id:'group',sourceNodeId:'.controls',controls:[{id:'pause-measured',sourceNodeId:'#pause',role:'autoplay',rect:{x:0,y:390,width:20,height:20}}]}]}])),contract={sourceUrl:provenance.sourceUrl,blocks:[{id:'hero',presentationDetails:{version:1,viewports:views}}],sourceSceneBindings:scenes.flatMap(bindings)},program={elements:[{key:'hero',type:'container',settings:{},children:[{key:'hero-pause',type:'button',settings:{}}]}],blocks:[{sourceBlockId:'hero',rootKey:'hero',presentationBindings:[{id:'template-measured',elementKey:'hero'},{id:'pause-measured',elementKey:'hero-pause'}]}]} as NativeProgram;
  Object.assign(contract.blocks[0],{geometry:Object.fromEntries(scenes.map(scene=>[scene.viewport.name,{width:900,height:400}]))});
  const complete=auditSourceCoverage(contract as never,scenes,{program});assert.equal(complete.passed,true);assert.equal(complete.counts.required,9);
  const noProgram=auditSourceCoverage(contract as never,scenes);assert.equal(noProgram.passed,false);assert.equal(noProgram.counts.bound,0);assert.ok(noProgram.issues.some(issue=>issue.code==='source-feature-native-proof-missing'));
  const fakeNative=auditSourceCoverage({...contract,sourceSceneBindings:contract.sourceSceneBindings.map(binding=>({...binding,targetKey:'invented-native-root'}))} as never,scenes,{program});assert.equal(fakeNative.passed,false);assert.equal(fakeNative.counts.bound,0);
  const missing=auditSourceCoverage({...contract,sourceSceneBindings:contract.sourceSceneBindings.filter(binding=>binding.sourceId!=='pause')} as never,scenes,{program});assert.equal(missing.status,'failed');assert.equal(missing.counts.missing,3);assert.ok(missing.issues.some(issue=>issue.sourceId==='pause'&&issue.code==='source-feature-unbound'));
  const invented=auditSourceCoverage({...contract,sourceSceneBindings:[...contract.sourceSceneBindings,{viewport:'desktop',sourceId:'invented',blockId:'hero',targetKey:'native',requirement:'control'}]} as never,scenes);assert.ok(invented.issues.some(issue=>issue.code==='source-binding-invented-feature'));
  const legacy=auditSourceCoverage({sourceUrl:provenance.sourceUrl,blocks:[]} as never,[]);assert.equal(legacy.status,'needs-review');assert.equal(legacy.passed,false);
  const missingMobile=auditSourceCoverage(contract as never,scenes.slice(0,2));assert.equal(missingMobile.passed,false);assert.ok(missingMobile.issues.some(issue=>issue.code==='source-scene-viewport-unobserved'&&issue.viewport==='mobile'));
});
test('source bindings and independently observed geometry reject non-finite/ambiguous facts',()=>{
  assert.equal(sourceSceneBindingSchema.safeParse({viewport:'desktop',sourceId:'pause',blockId:'hero',targetKey:'',requirement:'control'}).success,false);
  const scene=inventory('desktop'),raw={...scene,items:[{...scene.items[0],rect:{x:NaN,y:0,width:100,height:20}}]},normalized=normalizeSourceScene(raw,provenance)!;
  assert.equal(normalized.status,'partial');assert.equal(normalized.items.length,0);assert.ok(normalized.gaps.some(gap=>gap.code==='scene-invalid-item'));
  const duplicate=auditSourceCoverage({sourceUrl:scene.sourceUrl,blocks:[{id:'hero'}],sourceSceneBindings:[...bindings(scene),bindings(scene)[0]]} as never,[scene],{requiredViewports:['desktop']});assert.equal(duplicate.passed,false);assert.ok(duplicate.issues.some(issue=>issue.code==='source-feature-ambiguous-binding'));
});
