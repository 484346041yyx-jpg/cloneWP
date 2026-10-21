import {readFile,writeFile} from 'node:fs/promises';
import {createNative44CompareDependencies} from '../src/native44/compare-cli.js';
import {prepareNative44CapturePage} from '../src/native44/compare.js';
const run='D:/cloneWP/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c';
const manifest=JSON.parse(await readFile(run+'/compare-manifest.json','utf8'));
const compiled=JSON.parse(await readFile(run+'/compiled.json','utf8'));
console.log(JSON.stringify({checks:manifest.interactionChecks,modules:manifest.modules.map((m:any)=>({key:m.key,className:m.className,state:m.state})),compiledKeys:Object.keys(compiled),classes:compiled.moduleClasses},null,2));
const dep=await createNative44CompareDependencies('D:/cloneWP',manifest);
try{
 const page=await dep.openPage(manifest.targetUrl,'target');
 await page.setViewportSize({width:1920,height:1080});
 await prepareNative44CapturePage(page,[],'desktop-wide');
 const observations=await page.evaluate(()=>({
  carousels:Array.from(document.querySelectorAll('[data-widget_type="nested-carousel.default"]')).map(root=>({
   id:root.getAttribute('data-id'),classes:root.className,
   controls:Array.from(root.querySelectorAll('[role="button"],button,.swiper-pagination')).filter(n=>n.closest('[data-widget_type]')===root).map(n=>({tag:n.tagName,classes:n.className,role:n.getAttribute('role'),label:n.getAttribute('aria-label'),text:n.textContent?.trim().slice(0,80)}))
  })),
  fixed:Array.from(document.querySelectorAll('*')).filter(n=>['fixed','sticky'].includes(getComputedStyle(n).position)&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0).map(n=>({tag:n.tagName,id:n.id,class:n.className,position:getComputedStyle(n).position,text:n.textContent?.trim().slice(0,50)})),
  sample:Array.from(document.querySelectorAll('.elementor-widget-button,.elementor-widget-wd_image_or_svg')).slice(0,10).map(n=>({classes:n.className,html:n.outerHTML.slice(0,1600)}))
 }));
 await writeFile(run+'/comparison/dom-review.json',JSON.stringify(observations,null,2)+'\n');
 console.log(JSON.stringify({carousels:observations.carousels,fixed:observations.fixed},null,2));
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:run+'/comparison/target-top-before-css.png'});
}finally{await dep.close?.();}
