import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeFidelityBlocks,type FidelityBuildCheckpoint } from '../src/fidelity/block-writer.js';
import { createRuntimeTrace } from '../src/fidelity/runtime.js';
import { sha256 } from '../src/fidelity/check.js';
import type { DraftSnapshot } from '../src/wordpress/client.js';
import type { CompiledFidelity } from '../src/fidelity/native.js';
import { createServer } from 'node:http';
import { captureTarget,createScopedContext } from '../src/verification/capture-target.js';
import { chromium } from 'playwright';

function hash(snapshot:Pick<DraftSnapshot,'elements'|'settings'>){const sorted=(value:unknown):unknown=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,sorted(child)])):value;return sha256(JSON.stringify(sorted({elements:snapshot.elements,settings:snapshot.settings})));}
test('durable native block continuation skips only exact frozen blocks and preserves real serial save/readback guards',async()=>{
  const runDir=await mkdtemp(path.join(os.tmpdir(),'clonewp-checkpoint-'));
  try{
    const elements=['1111111','2222222','3333333'].map(id=>({id,elType:'container' as const,settings:{},elements:[]}));
    const compiled:CompiledFidelity={composition:{elements},plan:{title:'Fixture',mode:'legacy-verified',compositionJson:'{}',mappings:[],unsupported:[],rationale:'Fixture'},elementMap:{},sections:elements.map((element,index)=>({key:`block${index}`,targetId:element.id,elementIds:[element.id]})),sectionIds:elements.map(element=>element.id),usedTypes:['container'],scopedCSS:[]};
    let remote:DraftSnapshot={pageId:77,runId:'owned-checkpoint',title:'Fixture',status:'draft',elements:[],settings:{},hash:''};remote.hash=hash(remote);
    const initial=structuredClone(remote),identity={programSha256:'a'.repeat(64),contractSha256:'b'.repeat(64),assetsManifestSha256:'c'.repeat(64),environmentSha256:'d'.repeat(64)};
    let failThird=true,saves=0,reads=0,active=0,maxActive=0;
    const client={snapshotDraft:async()=>{reads++;return structuredClone(remote);},buildDraft:async(_pageId:number,composition:CompiledFidelity['composition'],_assets:unknown,options?:{expectedCurrent:DraftSnapshot})=>{
      assert.equal(options?.expectedCurrent.hash,remote.hash);active++;maxActive=Math.max(maxActive,active);
      try{saves++;if(failThird&&composition.elements.length===3)throw Error('Interrupted transport fixture');remote={...remote,elements:structuredClone(composition.elements),hash:''};remote.hash=hash(remote);return structuredClone(remote);}finally{active--;}
    }};
    const options={client,snapshot:initial,compiled,identity,runDir,blockIds:['one','two','three']};
    await assert.rejects(writeFidelityBlocks(options),/Interrupted transport/);assert.equal(remote.elements.length,2);assert.equal(reads,0,'The shared writer does not add redundant pre-save reads');
    const checkpoint=JSON.parse(await readFile(path.join(runDir,'target/build-checkpoint.json'),'utf8')) as FidelityBuildCheckpoint;assert.equal(checkpoint.completedBlocks,2);assert.equal(checkpoint.acceptedHash,remote.hash);
    const accepted=structuredClone(remote);
    await assert.rejects(writeFidelityBlocks({...options,snapshot:accepted,resume:true,identity:{...identity,programSha256:'e'.repeat(64)}}),/checkpoint no longer matches/);assert.equal(reads,0);
    remote.title='Concurrent human edit';await assert.rejects(writeFidelityBlocks({...options,snapshot:accepted,resume:true}),/preserve the concurrent change/);assert.equal(saves,3);assert.equal(remote.title,'Concurrent human edit');remote=structuredClone(accepted);
    failThird=false;const resumed=await writeFidelityBlocks({...options,snapshot:accepted,resume:true});assert.equal(resumed.skippedBlocks,2);assert.equal(resumed.completedBlocks,3);assert.equal(saves,4);assert.equal(maxActive,1);assert.equal(reads,2);assert.equal(resumed.snapshot.elements.length,3);
    const final=JSON.parse(await readFile(path.join(runDir,'target/build-checkpoint.json'),'utf8')) as FidelityBuildCheckpoint;assert.equal(final.acceptedHash,remote.hash);assert.equal(final.snapshotPath,'target/block-3.json');
    await assert.rejects(writeFidelityBlocks({...options,snapshot:{...accepted,runId:'another-owned-run'},resume:true}),/checkpoint no longer matches/);
  }finally{await rm(runDir,{recursive:true,force:true});}
});

test('runtime trace closes phases, records monotonic durations and contains fixed diagnostics only',()=>{
  const runtime=createRuntimeTrace();runtime.phase('source-audit');runtime.phase('native-block-save');runtime.finish('failed');const result=runtime.snapshot();
  assert.deepEqual(result.phases.map(phase=>phase.status),['completed','failed']);assert.ok(result.phases.every(phase=>Number.isInteger(phase.durationMs)&&phase.durationMs!>=0&&phase.finishedAt));assert.ok(result.elapsedMs>=0);assert.throws(()=>runtime.phase('https://secret.example/?token=private'),/fixed diagnostic/);
});

test('shared read-only viewport workers are bounded to two, use normal motion for state proof and preserve source order',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'clonewp-shared-view-')),requests:string[]=[];
  const server=createServer((request,response)=>{requests.push(request.method??'');response.setHeader('Content-Type','text/html');response.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}.elementor{height:80px;transition:opacity .2s}</style><div class="elementor" data-elementor-type="wp-page"><div data-id="1111111" data-element_type="container">Actual page</div></div>');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');
  try{
    let active=0,maximum=0;const observed:string[]=[];
    const result=await captureTarget({previewUrl:`http://127.0.0.1:${address.port}/owned/`,runDir:directory,viewports:[{name:'desktop',width:1440,height:900},{name:'tablet',width:900,height:900},{name:'mobile',width:390,height:844,deviceProfile:'mobile',deviceScaleFactor:2}],elementMap:[{sourceId:'root',targetId:'1111111',kind:'container'}],nativeRootIds:['1111111'],concurrency:2,inspectPage:async(page,view)=>{
      active++;maximum=Math.max(maximum,active);try{assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),false);assert.equal(await page.locator('.elementor').evaluate(element=>getComputedStyle(element).transitionDuration),'0.2s');await new Promise(resolve=>setTimeout(resolve,view.name==='desktop'?500:100));observed.push(view.name);}finally{active--;}
    }});
    assert.equal(maximum,2);assert.deepEqual([...observed].sort(),['desktop','mobile','tablet']);assert.deepEqual(result.map(view=>view.name),['desktop','tablet','mobile']);assert.ok(result.every(view=>view.elements[0].found));assert.equal(result[0].deviceFacts?.touch,false);assert.equal(result[0].deviceFacts?.profile,'desktop');assert.equal(result[2].deviceFacts?.touch,true);assert.equal(result[2].deviceFacts?.coarsePointer,true);assert.equal(result[2].deviceFacts?.devicePixelRatio,2);assert.equal(result[2].deviceFacts?.innerWidth,390);assert.ok(requests.every(method=>method==='GET'));
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});}
});

test('frontend policy blocks page POSTs while GET and arrow interactions work; the separately authorized editor context keeps POST support',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'clonewp-frontend-method-')),requests:Array<{path:string;method:string}>=[];
  const server=createServer((request,response)=>{
    const url=new URL(request.url??'/','http://localhost');requests.push({path:url.pathname,method:request.method??''});
    if(url.pathname==='/owned/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><style>body{margin:0}</style><div class="elementor" data-elementor-type="wp-page"><div data-id="1111111" data-element_type="container"><span id="slide">Slide 1</span><button id="next" aria-label="Next slide">Next</button></div></div><script>fetch("/attempt-write",{method:"POST",body:"fixture"}).then(()=>document.body.dataset.post="accepted").catch(()=>document.body.dataset.post="blocked");document.querySelector("#next").onclick=async()=>{await fetch("/read-slide");document.querySelector("#slide").textContent="Slide 2";};</script>');}
    else{response.setHeader('Content-Type','application/json');response.end('{"ok":true}');}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}/owned/`;
  try{
    const result=await captureTarget({previewUrl:url,runDir:directory,viewports:[{name:'desktop',width:900,height:700}],elementMap:[{sourceId:'root',targetId:'1111111',kind:'container'}],inspectPage:async page=>{await page.waitForFunction(()=>document.body.dataset.post==='blocked');await page.getByRole('button',{name:'Next slide'}).click();await page.waitForFunction(()=>document.getElementById('slide')?.textContent==='Slide 2');}});
    assert.equal(requests.some(request=>request.method==='POST'),false);assert.ok(requests.some(request=>request.path==='/read-slide'&&request.method==='GET'));assert.equal(result[0].networkPolicy?.blockedMutationRequests,1);assert.equal(result[0].networkPolicy?.webSocketsBlocked,true);
    const browser=await chromium.launch({headless:true});try{const context=await createScopedContext(browser,url);try{const page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>document.body.dataset.post==='accepted');assert.equal(requests.filter(request=>request.path==='/attempt-write'&&request.method==='POST').length,1);}finally{await context.close();}}finally{await browser.close();}
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});}
});
