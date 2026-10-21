import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadSourceCoverage, loadSourceViewportPlan } from '../src/fidelity/source-coverage.js';
import { normalizeSourceScene } from '../src/reference/source-scene.js';
import type { BlockContract } from '../src/fidelity/types.js';

const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
test('official source plan consumes immutable probe packets and completeness includes their independent controls',async()=>{
  const testsRoot=path.resolve(import.meta.dirname),folder=await mkdtemp(path.join(testsRoot,'.source-scene-')),referenceDir=path.join(folder,'reference');
  try{
    await mkdir(referenceDir);const url='https://public.example/',capturedAt='2026-10-14T00:00:00Z',scene=(width:number)=>({version:1,method:'independent-public-dom-scene',viewport:{width,height:800,clientWidth:width,devicePixelRatio:1,touch:false,coarsePointer:false},items:[{id:'block',kind:'block',selector:'#hero',sourceBlockId:'hero',rect:{x:0,y:0,width,height:400},visible:true,required:true,state:'resting',facts:{},evidence:['independent-DOM']},{id:'pause',kind:'control',selector:'#pause',sourceBlockId:'hero',rect:{x:0,y:390,width:20,height:20},visible:true,required:true,state:'resting',role:'autoplay',facts:{},evidence:['independent-DOM']}],gaps:[]});
    const probePath=path.join(referenceDir,'mobile-w400.json'),probeRaw=scene(400),probeInventory=normalizeSourceScene(probeRaw,{sourceUrl:url,capturedAt,evidencePath:probePath,viewportName:'mobile-w400',deviceProfile:'mobile'})!;
    await writeFile(probePath,JSON.stringify({name:'mobile-w400',width:400,height:800,sourceScene:probeRaw,sceneInventory:probeInventory,observedBlocks:[{id:'hero',rect:{x:0,y:0,width:400,height:400}}]}));
    const evidence:BlockContract['evidence']=[],views=[];
    for(const name of ['desktop','tablet','mobile']){
      const filename=path.join(referenceDir,name+'.json'),raw=scene(name==='mobile'?390:name==='tablet'?900:1440),inventory=normalizeSourceScene(raw,{sourceUrl:url,capturedAt,evidencePath:filename,viewportName:name,deviceProfile:name==='mobile'?'mobile':'desktop'})!,document={sourceScene:raw,sceneInventory:inventory,responsiveObservations:name==='mobile'?[{requestedWidth:400,evidencePath:probePath,evidenceSha256:hash(await readFile(probePath)),facts:{innerWidth:400,clientWidth:400,devicePixelRatio:1,touch:true,coarsePointer:true}}]:[]};
      await writeFile(filename,JSON.stringify(document));evidence.push({id:name,path:filename,sha256:hash(await readFile(filename)),kind:'dom'});views.push({name,width:raw.viewport.width,height:800,evidencePath:filename,deviceFacts:{profile:name==='mobile'?'mobile':'desktop',innerWidth:raw.viewport.width,clientWidth:raw.viewport.width,devicePixelRatio:1,touch:name==='mobile',coarsePointer:name==='mobile'}});
    }
    const reportPath=path.join(referenceDir,'report.json');await writeFile(reportPath,JSON.stringify({url,capturedAt,viewports:views}));
    const contract={sourceUrl:url,referenceReport:{path:reportPath,sha256:hash(await readFile(reportPath))},evidence,blocks:[{id:'hero'}]} as BlockContract;
    const plan=await loadSourceViewportPlan(contract,folder);assert.equal(plan.viewports.length,4);assert.equal(plan.viewports[3].name,'mobile-w400');assert.equal(plan.viewports[3].observationKind,'probe');assert.equal(plan.viewports[3].deviceFacts?.coarsePointer,true);
    const coverage=await loadSourceCoverage(contract,folder);assert.equal(coverage.counts.inventories,4);assert.equal(coverage.counts.required,8);assert.ok(coverage.issues.some(issue=>issue.viewport==='mobile-w400'&&issue.sourceId==='pause'));
    await writeFile(probePath,JSON.stringify({forged:true}));const changed=await loadSourceCoverage(contract,folder);assert.ok(changed.issues.some(issue=>issue.code==='source-responsive-probe-bytes-changed'));assert.equal(changed.passed,false);
    const changedPlan=await loadSourceViewportPlan(contract,folder);assert.equal(changedPlan.viewports.length,3);assert.ok(changedPlan.gaps.some(gap=>gap.code==='source-responsive-probe-unfrozen'));
  }finally{assert.ok(folder.startsWith(path.join(testsRoot,'.source-scene-')));await rm(folder,{recursive:true,force:true});}
});
