import path from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { previewCookies } from '../src/core/runner.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { chromium } from 'playwright';
import { createScopedContext } from '../src/verification/capture-target.js';
import { navigateOwnedPreview } from '../src/verification/owned-preview.js';
import {waitForNativeCarouselReady} from '../src/fidelity/acceptance.js';
import { normalizePreviewChromeV2 } from '../src/replica-v2/verify.js';
const loaded=await loadConfig('D:/cloneWP');
const client=new WordPressClient({targetUrl:loaded.config.targetUrl,username:loaded.credentials.wp_user,applicationPassword:loaded.credentials.wp_app_password});
try{
 await client.createDraft('2026-10-15T05-02-27-244Z-v2-d52069a9','Pet Supermarket — replica v2 technical draft',{requireExistingPageId:15102});
 const access=await client.getPreviewAccess(15102),cookies=await previewCookies(access.adminAccessUrl,loaded.config.targetUrl);
 const browser=await chromium.launch({headless:true});
 const context=await createScopedContext(browser,access.previewUrl,{cookies},{readOnly:true});
 try{
  const page=await context.newPage();await page.setViewportSize({width:1920,height:1080});await navigateOwnedPreview(page,access.previewUrl);await normalizePreviewChromeV2(page);await page.emulateMedia({reducedMotion:"no-preference"});await waitForNativeCarouselReady(page.locator('[data-id="b76e024"]'));
  const selectors=['[data-id="2f9aba9"] .wd-nav-pagin-wrap','[data-id="2f9aba9"] .wd-carousel-container','[data-id="2f9aba9"] .wd-products-element','[data-id="d034002"] .swiper-pagination-fraction','[data-id="d034002"] [data-widget_type="nested-carousel.default"]'];
  console.log(JSON.stringify(await page.evaluate(selectors=>Object.fromEntries(selectors.map(s=>[s,Array.from(document.querySelectorAll(s)).map(n=>{const b=n.getBoundingClientRect(),c=getComputedStyle(n);return{tag:n.tagName,id:n.getAttribute('data-id'),class:n.className,rect:{x:b.x,y:b.y,width:b.width,height:b.height},style:{color:c.color,font:c.fontFamily,width:c.width,position:c.position,right:c.right,bg:c.backgroundImage,bgsize:c.backgroundSize,bgrepeat:c.backgroundRepeat,padding:c.padding,margin:c.margin,transform:c.transform,top:c.top,bottom:c.bottom},settings:n.getAttribute('data-settings'),html:n.classList.contains('price')?n.outerHTML:undefined};})])),selectors),null,2));
 }finally{await context.close();await browser.close();}
}finally{await client.close();}
