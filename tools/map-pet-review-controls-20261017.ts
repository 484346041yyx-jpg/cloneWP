import {readFile,writeFile} from 'node:fs/promises';
const run='D:/cloneWP/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c';
const manifest=JSON.parse(await readFile(run+'/compare-manifest.json','utf8'));
const dom=JSON.parse(await readFile(run+'/comparison/dom-review.json','utf8'));
for(const check of manifest.interactionChecks){
 const id=check.selector.match(/data-id="([^"]+)"/)?.[1];
 const owner=dom.carousels.find((o:any)=>o.id===id);
 if(!owner||!owner.controls.some((c:any)=>c.classes.includes('elementor-swiper-button-next'))||!owner.controls.some((c:any)=>c.classes.includes('elementor-swiper-button-prev')))throw Error('Actual controls missing');
 check.nextSelector='.elementor-swiper-button-next';check.previousSelector='.elementor-swiper-button-prev';
 check.paginationSelector=check.componentKey==='hero-carousel'?'.swiper-pagination-bullet':'.swiper-pagination-fraction';
 // Header source packet is actual 3/6. Other bound source tracks show first logical item.
 check.expectedLogicalIndex=check.componentKey==='header-notices'?2:0;
}
await writeFile(run+'/compare-manifest.json',JSON.stringify(manifest,null,2)+'\n');
const job='D:/cloneWP/references/reference-v2-2026-10-17T01-53-33-144Z-www-petsupermarket-com-0f207465';
const plan=JSON.parse(await readFile(job+'/component-plan.json','utf8'));
const prog=JSON.parse(await readFile(job+'/program.json','utf8'));
const inventory:any[]=[];
function visit(n:any){inventory.push({id:n.id,key:n.key,widgetType:n.widgetType,type:n.type,settings:n.settings,widgetSettings:n.widgetSettings});for(const k of ['children','elements','items'])if(Array.isArray(n[k]))n[k].forEach(visit);}
prog.blocks.forEach(visit);
await writeFile(run+'/comparison/program-inventory.json',JSON.stringify({inventory,carouselAdaptations:plan.requirements.filter((r:any)=>r.disposition==='adapt'&&r.verification.property==='carousel').map((r:any)=>({id:r.id,componentId:r.componentId,rule:r.rule,verification:r.verification}))},null,2));
console.log('Actual native controls mapped. No remote writes.');
