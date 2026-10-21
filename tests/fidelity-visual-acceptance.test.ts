import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,readFile,writeFile,rm}from'node:fs/promises';
import {createHash}from'node:crypto';
import {chromium}from'playwright';
import {verifyVisualAcceptance,validateDynamicPixelExclusions}from'../src/fidelity/visual-acceptance.js';
import {fidelityCompletion}from'../src/fidelity/completion.js';
import type{BlockContract,NativeProgram}from'../src/fidelity/types.js';
import type{TargetViewportEvidence}from'../src/verification/types.js';
import type{TargetPresentationEvidence}from'../src/fidelity/presentation-contract.js';

test('real source and target paint accepts identical regions and rejects omitted controls and changed card borders',async()=>{
 const directory=await mkdtemp('D:/cloneWP/.cache/test-region-acceptance-'),browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:400,height:260},deviceScaleFactor:1});
  await page.setContent('<!doctype html><style>body{margin:0;background:white}#root{position:relative;width:400px;height:240px;background:#f5f8fa}#card{position:absolute;left:40px;top:40px;width:200px;height:120px;box-sizing:border-box;border:3px solid #0047d2;border-radius:12px;background:white}#next{position:absolute;left:350px;top:100px;width:28px;height:28px;border-radius:50%;border:1px solid #0047d2;color:#0047d2;background:white}</style><div id="root"><div id="card"></div><button id="next" aria-label="Next">›</button></div>');
  const sourcePath=path.join(directory,'source.png'),targetPath=path.join(directory,'target.png');await page.screenshot({path:sourcePath});
  const facts=await page.evaluate(()=>({profile:'desktop' as const,innerWidth,clientWidth:document.documentElement.clientWidth,devicePixelRatio,touch:navigator.maxTouchPoints>0,coarsePointer:matchMedia('(pointer:coarse)').matches}));
  const normal={status:'observed' as const,evidence:['source']},none={status:'not-applicable' as const,evidence:[]};
  const contract:BlockContract={version:1,workflow:'block-replication',sourceUrl:'https://source.example/',capturedAt:'2026-10-14T00:00:00Z',referenceReport:{path:path.join(directory,'report.json'),sha256:'0'.repeat(64)},evidence:[{id:'source',path:sourcePath,kind:'screenshot',sha256:createHash('sha256').update(await readFile(sourcePath)).digest('hex')}],tolerances:{geometryPx:20,geometryRatio:.1,colorChannel:4},limitations:[],blocks:[{id:'offers',role:'proof',presentation:'static',texts:[],assets:[],evidence:['source'],geometry:{desktop:{width:400,height:240}},colors:{},states:{normal,hover:none,interaction:none},presentationDetails:{version:1,viewports:{desktop:{status:'observed',width:400,height:260,evidence:['source'],regions:[{id:'card',sourceNodeId:'#card',visible:true,evidence:['source'],rect:{x:40,y:40,width:200,height:120}}],media:[],relations:[],controlGroups:[{id:'controls',ownerId:'card',sourceNodeId:'#next',evidence:['source'],visible:true,rect:{x:350,y:100,width:28,height:28},layout:'separate',pagination:'none',controls:[{id:'next',sourceNodeId:'#next',evidence:['source'],role:'next',visible:true,rect:{x:350,y:100,width:28,height:28}}]}]}}}}]};
  const program:NativeProgram={version:1,workflow:'block-replication',sourceUrl:contract.sourceUrl,title:'Actual paint fixture',sourceContract:{path:path.join(directory,'contract.json'),sha256:'0'.repeat(64)},assetsManifest:{path:path.join(directory,'assets.json'),sha256:'0'.repeat(64)},deviations:[],elements:[{key:'root',type:'container',settings:{}}],blocks:[{sourceBlockId:'offers',rootKey:'root',presentation:'static',bindings:[],states:contract.blocks[0].states}]};
  const actual=async(relative=false,screenshotChanged=false,sourceDiagnostic=false)=>{
   await page.screenshot({path:targetPath});
   const rect=await page.locator('#root').evaluate(element=>{const box=element.getBoundingClientRect();return{x:box.x,y:box.y,width:box.width,height:box.height};});
   const presentation:TargetPresentationEvidence[]=[];
   for(const[id,selector]of [['card','#card'],['controls','#next'],['next','#next']]){
    const found=await page.locator(selector).count()>0;
    presentation.push({viewport:'desktop',blockId:'offers',id,found,count:found?1:0,visible:found,rect:found?await page.locator(selector).evaluate(element=>{const box=element.getBoundingClientRect();return{x:box.x,y:box.y,width:box.width,height:box.height};}):undefined,evidence:[targetPath]});
   }
   let activeContract=contract,sourceEvidencePath:string|undefined;
   if(sourceDiagnostic){
    sourceEvidencePath=path.join(directory,'source-capture.json');const bytes=JSON.stringify({screenshotCapture:{method:'scroll-viewport-cdp-no-beyond',passed:false,documentLayoutPreserved:true,complete:true,seamless:false,before:facts,contentRaster:{width:400,height:260,scale:1,scaleBasis:'actual-png-viewport-ratio',measuredDevicePixelRatio:1},constraints:{domOrCSSMutations:0,viewportOverrides:0,captureBeyondViewport:false,fromSurface:true},gaps:[{code:'screenshot-fixed-sticky-overlay',message:'Observed fixed layer has unresolved stitching continuity'}]}});await writeFile(sourceEvidencePath,bytes);activeContract={...contract,evidence:[...contract.evidence,{id:'source-capture',path:sourceEvidencePath,sha256:createHash('sha256').update(bytes).digest('hex'),kind:'observation'}]};
   }
   return verifyVisualAcceptance({contract:relative?{...activeContract,referenceReport:{...activeContract.referenceReport,path:path.join(directory,'reference','report.json')},evidence:activeContract.evidence.map(item=>({...item,path:'source.png'}))}:activeContract,program:relative?{...program,sourceContract:{...program.sourceContract,path:'block-contract.json'}}:program,sourceViewports:[{name:'desktop',width:400,height:260,deviceProfile:'desktop',sourceScreenshotPath:sourcePath,...(sourceEvidencePath?{sourceEvidencePath}:{}),deviceFacts:facts}],measurements:[{name:'desktop',width:400,height:260,screenshotPath:targetPath,evidencePath:targetPath,deviceFacts:facts,...(screenshotChanged?{screenshotGeometry:{status:'changed-after-screenshot',changedFacts:['clientWidth'],gaps:[{code:'screenshot-layoutmetrics-changed',message:'Actually observed changed metrics'}]}}:{}),elements:[{sourceId:'root',found:true,count:1,visible:true,rect}]} as TargetViewportEvidence],presentationEvidence:presentation,sourcePackets:[{viewport:'desktop',evidenceId:'source',evidencePath:sourcePath,blocks:[{id:'offers',rect:{x:0,y:0,width:400,height:240},textAtoms:[]}]}],runDir:directory});
  };
  const baseline=await actual();assert.equal(baseline.passed,true);assert.equal(baseline.checks.length,4);
  const incoherent=await actual(false,true);assert.equal(incoherent.passed,false);assert.ok(incoherent.issues.some(issue=>issue.code==='visual-target-screenshot-layoutmetrics-changed'),'equal pixels cannot hide an actual screenshot environment change');
  assert.equal((await actual(true)).passed,true,'normal relative sourceContract/evidence paths resolve inside the current job');
  const reused=await actual();assert.equal(reused.passed,true);assert.equal(reused.runtime.reusedRegions,4);
  const sourceCaptureGap=await actual(false,false,true);assert.equal(sourceCaptureGap.passed,false);assert.ok(sourceCaptureGap.issues.some(issue=>issue.code==='visual-source-screenshot-fixed-sticky-overlay'));assert.ok(sourceCaptureGap.issues.some(issue=>issue.code==='visual-source-screenshot-not-certified'),'coherent compositor scale and identical pixels do not hide source capture gaps');
  await page.locator('#card').evaluate(element=>(element as HTMLElement).style.borderColor='#d20000');
  const changed=await actual();assert.equal(changed.passed,false);assert.ok(changed.checks.some(check=>check.regionId==='card'&&check.status==='failed'));assert.ok(changed.issues.some(issue=>issue.code==='visual-pixel-mismatch'));
  await page.locator('#next').evaluate(element=>element.remove());
  const omitted=await actual();assert.equal(omitted.passed,false);assert.ok(omitted.issues.some(issue=>issue.code==='visual-region-missing'));
  const unknown=await verifyVisualAcceptance({contract,program,sourceViewports:[],measurements:[],presentationEvidence:[],sourcePackets:[],runDir:path.join(directory,'unknown')});assert.equal(unknown.passed,false);assert.equal(unknown.status,'needs-review');
 }finally{await browser.close();assert.ok(path.resolve(directory).startsWith(path.resolve('D:/cloneWP/.cache/test-region-acceptance-')));await rm(directory,{recursive:true,force:true});}
});

test('completion never converts warnings, named gaps or unchecked editor evidence into a pass',()=>{
 const complete={editable:true,data:true,visual:true,behavior:true,responsive:true,evidence:true,issues:[]};
 assert.equal(fidelityCompletion(complete).passed,true);
 const unchecked=fidelityCompletion({...complete,editable:undefined});assert.equal(unchecked.passed,false);assert.equal(unchecked.status,'needs-review');assert.equal(unchecked.lanes.editable.status,'unchecked');
 assert.equal(fidelityCompletion({...complete,issues:[{code:'missing-probe',severity:'warning',message:'No source probe screenshot'}]}).passed,false);
 assert.equal(fidelityCompletion({...complete,limitations:['Native pause control unavailable']}).passed,false);
});

test('dynamic product pixels require exact leaf ownership plus separate layout/style/data proofs and cannot hide controls',()=>{
 const card={x:0,y:0,width:200,height:300},field={field:'image' as const,source:{x:10,y:10,width:180,height:180},target:{x:10,y:10,width:180,height:180},sourceNodeId:'#source-product-image',targetProductId:42,evidence:['actual-own-catalog','source-slot','target-slot'],dataVerified:true,layoutVerified:true,styleVerified:true},options={sourceCard:card,targetCard:card,sourceControls:[],targetControls:[],fields:[field]};
 assert.equal(validateDynamicPixelExclusions(options).length,1);
 assert.throws(()=>validateDynamicPixelExclusions({...options,fields:[{...field,styleVerified:false}]}),/independent/);
 assert.throws(()=>validateDynamicPixelExclusions({...options,sourceControls:[{x:20,y:20,width:30,height:30}]}),/controls/);
 assert.throws(()=>validateDynamicPixelExclusions({...options,fields:[{...field,source:card}]}),/card or track/);
});
