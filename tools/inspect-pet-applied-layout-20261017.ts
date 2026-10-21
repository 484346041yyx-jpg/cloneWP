import {readFile,writeFile} from 'node:fs/promises';
import {createNative44CompareDependencies} from '../src/native44/compare-cli.js';
import {prepareNative44CapturePage} from '../src/native44/compare.js';
const review='D:/cloneWP/runs/2026-10-17-pet-applied-review-15621',dir='D:/cloneWP/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c/amendments/20261017-products-and-css';
const manifest=JSON.parse(await readFile(review+'/compare-manifest.json','utf8')),compiled=JSON.parse(await readFile(dir+'/compiled.json','utf8'));
const keys=Object.keys(compiled.moduleClasses).filter(k=>['header-top','header-navigation','header-nav','header-notices','header-search-slot','header-search','promo-copy','promo-text-25','promo-row','hero-carousel','hero-slide-1','categories-title','categories','categories-card-8','brands','brands-heading','brands-carousel','dog-deals','dog-deals-heading','dog-deals-carousel','benefits','services','services-text-10','service-cards','services-card-14','halloween-products-carousel','bogo-background','bogo-content'].includes(k));
const dep=await createNative44CompareDependencies('D:/cloneWP',manifest);
try{
 const page=await dep.openPage(manifest.targetUrl,'target');await page.setViewportSize({width:1920,height:1080});await prepareNative44CapturePage(page,[],'desktop-wide');await page.evaluate(()=>scrollTo(0,0));
 const observer=({keys,classes}:any)=>{
  const describe=(el:Element)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {tag:el.tagName,classes:el.className,box:{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height},css:Object.fromEntries(['display','position','padding','margin','gap','font-size','line-height','font-family','font-weight','width','height','min-height','max-height','flex','transform','top','bottom','left','right','--padding-top','--padding-bottom','--padding-left','--padding-right','--container-widget-width'].map(k=>[k,s.getPropertyValue(k)]))};};
  return keys.map((key:string)=>{const root=document.querySelector('.elementor-15621 .'+classes[key]);return {key,root:root?describe(root):null,descendants:root?Array.from(root.querySelectorAll('.e-con-inner,.elementor-image-box-img,.elementor-image-box-title,.swiper-pagination,.elementor-swiper-button,p,h2,strong,.elementor-button-content-wrapper,.elementor-button-text')).filter(n=>!n.closest('.swiper-slide-duplicate')).slice(0,14).map(describe):[],html:key==='promo-text-25'||key==='header-search'?root?.innerHTML:undefined};});
 };
 const measurements=await page.evaluate(new Function('input','const __name=value=>value;return ('+observer.toString()+')(input);') as any,{keys,classes:compiled.moduleClasses});
 await writeFile(dir+'/applied-layout-observation.json',JSON.stringify(measurements,null,2));
 console.log(JSON.stringify({status:'observed-real-layout',keys:measurements.length,remoteWrites:0}));
}finally{await dep.close?.();}
