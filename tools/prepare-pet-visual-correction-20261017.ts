import { readFile, writeFile, mkdir, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { acquireLock } from '../src/core/files.js';
import { readNative44CurrentState } from '../src/native44/current-state.js';
import { fingerprintNative44Snapshot } from '../src/native44/compare.js';
import { buildNative44PageCSS } from '../src/native44/css-handoff.js';
import { consolidateNative44CSS } from '../src/native44/consolidate-css.js';
const root='D:/cloneWP',run=root+'/runs/2026-10-17-pet-unified-draft',dir=run+'/amendments/20261017-visual-corrections',out=root+'/runs/2026-10-17-pet-unified-final-review';
const json=async(p:string)=>JSON.parse(await readFile(p,'utf8')),sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const sort=(v:any):any=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sort(x)])):v;
const unlock = await acquireLock(root);
try {
// An attempted or bound intent is immutable. Refuse even a partial previous
// preparation; never refresh createdAt or replace its expected document.
let existing: string[] = [];
try { existing = await readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
if (existing.length) throw Error('Existing visual-correction evidence is immutable; preparation cannot rewrite this amendment directory.');
if (await realpath(path.dirname(dir)) !== path.resolve(path.dirname(dir))) throw Error('Visual-correction evidence parent is aliased outside its exact owner.');
const current=await readNative44CurrentState(root,run);if(!current||current.pageId!==15734||current.documentHash!=='339fc1a3f7a2e5204943c108fb94d1c303fee99b90cbc9441a35678354e9dfe4')throw Error('Visual correction requires exact observed draft');
const before=await json(current.currentSnapshot.path),manifest=await json(run+'/compare-manifest.json');
await mkdir(dir,{recursive:true});await mkdir(out,{recursive:true});
const evidence={version:1,source:'Existing user Chrome Pet Supermarket tab, read-only live DOM and frozen task screenshots',sourceAbsence:'Source product-tile contains image, optional size, product-link, price and real promotion; no rating presentation.',targetOptionality:'Actual native wd_products button layout product-wrapper contains separate DIV.star-rating; 541 registered fields have no widget rating toggle. Rating facts and queries are retained.',sourceStyles:{viewportWidth:1920,card:{width:196,height:416.59375,border:'1px solid #e2ebf0',radius:8},imageWrap:{height:180,padding:'16px 15px 0'},image:{width:148,height:148},title:{fontSize:16,fontWeight:700,lineHeight:20,color:'#6e6259'},price:{fontSize:16,fontWeight:550,lineHeight:24,color:'#3d3935'}},order:['header','promo','hero'],contentPolicy:'Target product facts are replaceable; no fake source New, size or offer facts are generated.'};
await writeFile(dir+'/source-card-evidence.json',JSON.stringify(evidence,null,2));
const evidencePath=dir+'/source-card-evidence.json',rules:any[]=[];
for(const key of ['halloween','fall']){
 const add=(selector:string,declarations:Record<string,string>,reason:string,extra:any={})=>rules.push({moduleKey:key,selector,declarations,media:'(min-width:1025px)',reason,evidence:[evidencePath+'#sourceAbsence',evidencePath+'#targetOptionality',evidencePath+'#sourceStyles'],...extra});
 add('.product-grid-item',{'padding':'0 !important','border':'1px solid #e2ebf0 !important','border-radius':'8px !important','min-height':'416.594px !important'},'Observed source card border, corner and full content owner height.');
 add('.product-element-top',{'height':'180px !important','margin':'0 15px !important','padding':'16px 8px 0 !important','box-sizing':'border-box !important'},'Observed source image wrapper allocates 180px including 16px top inset.');
 add('.product-image-link',{'height':'148px !important','display':'block !important'},'Observed source image box, preserves actual product link.');
 add('.product-image-link img',{'width':'100% !important','max-width':'148px !important','height':'148px !important','object-fit':'contain !important','display':'block !important','margin':'0 auto !important'},'Observed source image is card width minus48px, maximum148px; target media remains real.');
 add('.wd-entities-title',{'font-size':'16px !important','line-height':'20px !important','font-weight':'700 !important','color':'#6e6259 !important','margin':'10px 12px 8px !important','min-height':'40px !important'},'Observed source product-link typography and body inset; full actual name remains readable.');
 add('.wd-entities-title a',{'font-size':'inherit !important','line-height':'inherit !important','font-weight':'inherit !important','color':'inherit !important'},'Native anchor theme color must inherit source-matched card title.');
 add('.price',{'font-size':'16px !important','line-height':'24px !important','font-weight':'550 !important','color':'#3d3935 !important','margin':'8px 12px !important'},'Observed source price typography; target prices and variable ranges remain true.');
 add('.price .amount',{'color':'inherit !important','font-weight':'inherit !important'},'Native price amount inherits observed source typography.');
 add('.star-rating',{'display':'none !important'},'Source has no rating presentation; omit only this optional native visual role without altering product facts.',{optionalPresentation:'product-rating',optionalPresentationEvidence:{sourceAbsence:evidencePath+'#sourceAbsence',targetOptionality:evidencePath+'#targetOptionality'}});
}
const fragment=buildNative44PageCSS({pageId:15734,modules:manifest.modules,rules,canvasCss:'',replicationProfile:manifest.replicationProfile});
const elements=[before.elements[1],before.elements[0],...before.elements.slice(2)];if(elements[0].id!=='18e7216'||elements[1].id!=='ac0f642')throw Error('Unexpected native source order');
const consolidated=consolidateNative44CSS(before.settings.custom_css+'\n'+fragment.css,{modules:manifest.modules,elements});
const css='/* cloneWP page 15734; complete current page CSS. Native settings remain in native components. */\n'+consolidated.css,settings={...before.settings,custom_css:css},payload=JSON.stringify(sort({elements,settings})),expected={...before,elements,settings,hash:sha(payload)};
await writeFile(dir+'/before.json',JSON.stringify(before,null,2));await writeFile(dir+'/expected.json',JSON.stringify(expected,null,2));await writeFile(dir+'/page-custom.css',css);await writeFile(out+'/page-custom.css',css);
await writeFile(dir+'/request.json',JSON.stringify({pageId:15734,runId:current.runId,kind:'explicit-user-visual-corrections',instruction:'统一修复后做复核；商品具体内容可不同，但原生组件、布局、样式和交互须匹配。',scope:'Restore observed header/promo native root order and source product-card presentation on the owned new draft only.',evidence:evidencePath},null,2));
await writeFile(dir+'/intent.json',JSON.stringify({version:1,kind:'explicit-user-owned-draft-amendment',pageId:15734,runId:current.runId,beforeHash:before.hash,expectedHash:expected.hash,requestSha256:sha(await readFile(dir+'/request.json')),payloadSha256:sha(payload),cssSha256:sha(css),replacementIds:['18e7216','ac0f642'],status:'prepared',createdAt:new Date().toISOString()},null,2));
await writeFile(dir+'/css-selector-map.json',JSON.stringify(fragment.selectorMap,null,2));await writeFile(out+'/repair-target.json',JSON.stringify({run,dir,out,runId:current.runId,pageId:15734},null,2));
await writeFile(out+'/prepared-manifest.json',JSON.stringify({...manifest,...fingerprintNative44Snapshot(expected)},null,2));console.log(JSON.stringify({prepared:true,expectedHash:expected.hash,rules:rules.length,bodyOrderChanged:true,productQueriesChanged:false}));
} finally { await unlock(); }
