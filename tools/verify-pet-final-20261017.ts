import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createNative44CompareDependencies} from '../src/native44/compare-cli.js';
import {fingerprintNative44Snapshot,prepareNative44CapturePage,readNative44ModuleCarouselStates} from '../src/native44/compare.js';
import {collectNative44InteractionChecks} from '../src/native44/interaction-check.js';
import {collectNative44ProductChecks} from '../src/native44/catalog-check.js';
import {captureLayoutStableScreenshot} from '../src/verification/layout-stable-screenshot.js';
import {verifyNative44AppliedCSS} from '../src/native44/css-handoff.js';
import sharp from 'sharp';
const originalRun='D:/cloneWP/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c',run=process.argv[4]??originalRun,amend=originalRun+'/amendments/20261017-products-and-css',revision=process.argv[2]??amend+'/refinement-05',out=process.argv[3]??'D:/cloneWP/runs/2026-10-17-pet-component-complete-15621';await mkdir(out,{recursive:true});
const json=async(f:string)=>JSON.parse(await readFile(f,'utf8'));
const manifest=await json(run===originalRun?amend+'/compare-manifest.json':run+'/compare-manifest.json'),saved=await json(revision+'/after.json'),sourceReport=await json(originalRun+'/comparison/report.json');
Object.assign(manifest,fingerprintNative44Snapshot(saved));
await writeFile(out+'/compare-manifest.json',JSON.stringify(manifest,null,2));
const dep=await createNative44CompareDependencies('D:/cloneWP',manifest),hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const captures:any[]=[];
try{
 const initial=await dep.readSnapshot();if(initial.documentHash!==saved.hash)throw Error('Current saved draft changed before final read-only review');
 const page=await dep.openPage(manifest.targetUrl,'target');
 for(const viewport of manifest.viewports){
  await page.setViewportSize({width:viewport.width,height:viewport.height});
  let interactions:any[]=[];
  await prepareNative44CapturePage(page,manifest.interactionChecks,viewport.name,async()=>{interactions=await collectNative44InteractionChecks(page,manifest.interactionChecks,viewport.name);});
  await page.evaluate(()=>document.fonts.ready.then(()=>true));
  const scopes=new Map<string,string>(),scopeProof:any[]=[];
  for(const check of manifest.productChecks){
   const root=page.locator(check.selector);if(await root.count()!==1)throw Error('Canonical original product owner is not unique');
   const id=await root.getAttribute('data-id');if(!id||await root.getAttribute('data-widget_type')!=='wd_products.default'||await root.evaluate(n=>Boolean(n.closest('.swiper-slide-duplicate,.slick-cloned'))))throw Error('Canonical product scope is not an original actual widget');
   const requested='[data-id="'+id+'"]';if(scopes.has(requested))throw Error('Repeated canonical product map');scopes.set(requested,check.selector);scopes.set(check.selector,check.selector);scopeProof.push({elementId:id,canonicalSelector:check.selector,uniqueOriginal:true,widgetType:'wd_products'});
  }
  // A looping parent clones descendant IDs. Qualify the original widget using
  // its observed native slide owner, never replace any DOM result. Preserve
  // horizontal clipping: the shared fact checker only needs vertical exposure.
  const scopedPage=new Proxy(page,{get(target,key){
   if(key==='locator')return(selector:string,options?:any)=>{
    const canonical=scopes.get(selector),actual=target.locator(canonical??selector,options);
    if(!canonical)return actual;
    return new Proxy(actual,{get(locator,property){
     if(property==='scrollIntoViewIfNeeded')return async()=>{const y=await locator.evaluate(el=>el.getBoundingClientRect().top+scrollY);await page.evaluate(top=>scrollTo({left:0,top:Math.max(0,top-50),behavior:'instant'}),y);};
     const value=Reflect.get(locator,property,locator);return typeof value==='function'?value.bind(locator):value;
    }});
   };
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const queries=await collectNative44ProductChecks(scopedPage as any,manifest.productChecks,viewport.name);
  const statesAfterQueries=await readNative44ModuleCarouselStates(page,manifest.interactionChecks.map((c:any)=>({key:c.componentKey,targetSelector:c.selector,sourceSelector:c.selector})),'target');
  await page.evaluate(()=>scrollTo(0,0));
  await page.mouse.move(viewport.width-1,viewport.height-1);
  const geometry=await page.evaluate(({modules})=>({viewport:{width:innerWidth,height:innerHeight,clientWidth:document.documentElement.clientWidth},fontReady:document.fonts.check('700 28px "neue-haas-grotesk-display"'),adminBarHeight:document.querySelector('#wpadminbar')?.getBoundingClientRect().height??0,modules:modules.map((m:any)=>{const el=document.querySelector(m.targetSelector),r=el?.getBoundingClientRect();return{key:m.key,count:document.querySelectorAll(m.targetSelector).length,box:r?{x:r.x,y:r.y+scrollY,width:r.width,height:r.height}:null};})}),{modules:manifest.modules});
  const full=out+'/'+viewport.name+'-full.png';const receipt=await captureLayoutStableScreenshot(page,{path:full,selectors:manifest.modules.map((m:any)=>m.targetSelector)});
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out+'/'+viewport.name+'-top.png'});
  const seasonal=await page.locator(manifest.modules.find((m:any)=>m.key==='halloween').targetSelector).evaluate(el=>el.getBoundingClientRect().top+scrollY);
  await page.evaluate(y=>scrollTo({top:y-55,left:0,behavior:'instant'}),seasonal);await page.screenshot({path:out+'/'+viewport.name+'-products.png'});
  const source=sourceReport.captures.find((c:any)=>c.viewport===viewport.name).source;
  if(hash(await readFile(source.screenshot))!==source.sha256)throw Error('Original source screenshot changed');
  const sourcePath=out+'/'+viewport.name+'-source'+(source.screenshot.endsWith('.jpg')?'.jpg':'.png');await copyFile(source.screenshot,sourcePath);
  const deltas=geometry.modules.map((m:any)=>{const expected=source.modules.find((s:any)=>s.key===m.key)?.box;return{key:m.key,target:m.box,source:expected,delta:expected&&m.box?{x:m.box.x-expected.x,yIgnoringLoggedInAdminBar:m.box.y-geometry.adminBarHeight-expected.y,width:m.box.width-expected.width,height:m.box.height-expected.height}:null};});
  await sharp(full).resize({width:850}).jpeg({quality:88}).toFile(out+'/'+viewport.name+'-overview.jpg');
  const capture={viewport:viewport.name,sourceScreenshot:{path:sourcePath,sha256:source.sha256},targetScreenshot:{path:full,sha256:hash(await readFile(full))},geometry,deltas,interactions,queries,scopeProof,statesAfterQueries,screenshotReceipt:receipt};captures.push(capture);
  await writeFile(out+'/'+viewport.name+'-evidence.json',JSON.stringify(capture,null,2));
  console.log(JSON.stringify({viewport:viewport.name,interactionsPassed:interactions.filter(i=>i.status==='passed').length,queriesPassed:queries.filter(q=>q.status==='passed').length,queryProblems:queries.filter(q=>q.status!=='passed').map(q=>({key:q.componentKey,problems:q.problems})),fontReady:geometry.fontReady,documentHeight:receipt.before.scrollHeight}));
 }
 const final=await dep.readSnapshot();if(final.documentHash!==initial.documentHash)throw Error('Draft changed during final read-only verification');
 const cssFile=revision+'/page-custom.css';const css=verifyNative44AppliedCSS(await readFile(cssFile,'utf8'),final.pageCss,manifest.replicationProfile);
 const result={version:1,kind:'explicit-user-component-and-css-review',pageId:manifest.pageId,runId:manifest.runId,documentHash:final.documentHash,documentUnchanged:true,css,fontSource:amend+'/refinement-01/font-provenance.json',nativeProductSlots:manifest.productChecks.length,userScope:'Product components and layout match source; actual existing target products are replaceable content.',captures,scopeAdapter:'Canonical original non-clone native product widget selectors and vertical-only exposure; DOM values, price, image, runtime and clipping are observed unchanged.',metrics:{documentWrites:0,editorSessions:0,viewports:2},observedAt:new Date().toISOString()};
 await writeFile(out+'/report.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({status:'final-observations-saved',cssApplied:css.applied,documentHash:final.documentHash,documentWrites:0}));
}finally{await dep.close?.();}
