import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fingerprintNative44Snapshot,compareNative44Run} from '../src/native44/compare.js';
import {createNative44CompareDependencies} from '../src/native44/compare-cli.js';
import {native44ModuleClass} from '../src/native44/adapters.js';
const run='D:/cloneWP/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c',dir=run+'/amendments/20261017-products-and-css';
const reviewDir='D:/cloneWP/runs/2026-10-17-pet-applied-review-15621';
const json=async(f:string)=>JSON.parse(await readFile(f,'utf8'));
let manifest:any;
try{manifest=await json(dir+'/compare-manifest.json');}catch{
 manifest=await json(run+'/compare-manifest.json');
 const after=await json(dir+'/after.json'),compiled=await json(dir+'/compiled.json'),catalog=await json(dir+'/target-catalog.json');
 const mappings=await json(dir+'/product-slot-mapping.json');
 Object.assign(manifest,fingerprintNative44Snapshot(after));
 manifest.widgetTypes=[...new Set([...manifest.widgetTypes,'wd_products'])];
 manifest.cssRules=await json(dir+'/css-rules.json');
 catalog.evidence=[dir+'/target-catalog.json',dir+'/product-query-source.json'];
 manifest.productChecks=mappings.map((m:any)=>({componentKey:m.key,selector:'.elementor-15621 .'+native44ModuleClass(m.region+'-products-carousel')+' .swiper-slide:not(.swiper-slide-duplicate) [data-id="'+compiled.widgetTargets[m.key]+'"]',widgetType:'wd_products',expectedProductIds:[m.productId],catalog,carouselExpected:false}));
 for(const region of ['halloween','fall'])manifest.interactionChecks.push({componentKey:region+'-products-carousel',sourceComponentKey:region,requireSourceAlignment:true,expectedLogicalIndex:0,selector:'.elementor-15621 [data-id="'+compiled.widgetTargets[region+'-products-carousel']+'"]',widgetType:'nested-carousel',nextSelector:'.elementor-swiper-button-next',previousSelector:'.elementor-swiper-button-prev',paginationSelector:'.swiper-pagination-fraction'});
 await writeFile(dir+'/compare-manifest.json',JSON.stringify(manifest,null,2));
}
const dep=await createNative44CompareDependencies('D:/cloneWP',manifest);
await mkdir(reviewDir,{recursive:true});
await writeFile(reviewDir+'/compare-manifest.json',JSON.stringify(manifest,null,2));
let result;try{result=await compareNative44Run(reviewDir,dep,{verifyApplied:true});}finally{await dep.close?.();}
console.log(JSON.stringify({documentUnchanged:result.documentHash===result.finalReadHash,css:result.css,visualVerification:result.visualVerification,checks:result.captures.map((c:any)=>({viewport:c.viewport,queries:c.target.productChecks?.map((p:any)=>({key:p.componentKey,status:p.status,problems:p.problems})),interactions:c.target.interactionChecks?.map((p:any)=>({key:p.componentKey,status:p.status,problems:p.problems}))})),gaps:result.gaps,metrics:result.metrics},null,2));
