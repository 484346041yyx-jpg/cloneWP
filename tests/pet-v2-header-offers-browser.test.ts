import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {renderStaticHTML} from '../src/replica-v2/html.js';
import {headerOffersGeometry} from '../tools/probe-pet-v2-breakpoints.js';

test('authored narrow Pet offers reserve the real navigation and native control lanes for all six notices', async()=>{
  // Read only CSS literals. Importing the operational author would regenerate
  // its real job, so the test builds a local native-wrapper structural fixture.
  const desktop=await readFile('D:/cloneWP/tools/author-pet-v2.mjs','utf8'),responsive=await readFile('D:/cloneWP/tools/author-pet-v2-responsive.mjs','utf8');
  const baseNative=/const offers=\{[^\n]*custom_css:'([^']+)'/.exec(desktop)?.[1],baseNotice=/html\(key,'header',template,'([^']+)'/.exec(desktop)?.[1],common=/const common='([^']+)';/.exec(desktop)?.[1];
  const narrowNative=/offers\.settings\.custom_css\+='(@media\(max-width:1439px\) and \(min-width:1025px\)\{selector\{left:auto;[^']+)'/.exec(responsive)?.[1];
  const narrowNotice=/addCss\(byKey\.get\('header-offer-'\+i\),'(@media\(max-width:1439px\)[^']+)'/.exec(responsive)?.[1];
  assert.ok(baseNative&&baseNotice&&common&&narrowNative&&narrowNotice,'the actual authored native and HTML CSS rules must exist');
  const pairs=[['10% Off Buy Online, Pick up In Store!','Shop Now!'],['Buy 1 Get 1 50% Off Halloween.','Shop Now!'],['Buy more save more,','shop top BOGOs!'],['Our VIP Rewards program outshines the rest.','Join Today!'],['Find EXCLUSIVE pet favorites, only available here!','Shop Now!'],['Discover the NEWEST pet trends.','Shop Now!']];
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    const shell=(width:number,html:string,native:string)=>`<style>html,body{margin:0;font-family:Arial}*{box-sizing:border-box}.fixture{position:relative;width:${width-15}px;max-width:1440px;margin:auto;height:120px}.nav-row{position:absolute;top:76px;left:0;width:100%;height:44px;display:flex;background:#edf1fc;font-size:16px;font-weight:bold}.nav-row>a{display:flex;align-items:center;justify-content:center;text-decoration:none;color:#004cdb;height:44px}.shop{width:144.375px;margin-right:auto}.nav-track{width:160.5px}.nav-deals{width:86.703125px}.nav-services{width:152.5px}.elementor-widget,.e-n-carousel,.swiper-wrapper,.swiper-slide{position:relative;width:100%;height:44px}.swiper{overflow:hidden}.elementor-swiper-button{position:absolute;width:14px}.swiper-pagination-fraction{color:#004cdb}.elementor-15102 .elementor-element.elementor-element-9f5f6fe{position:relative}${native.replaceAll('selector','.elementor-15102 .elementor-element.elementor-element-9f5f6fe')}</style><main class="elementor-15102"><section class="fixture"><header id="header"><nav class="nav-row"><a class="shop">☰ Shop</a><a class="nav-track">Track My Order</a><a class="nav-deals">Deals</a><a class="nav-services">Book Services</a></nav></header><div class="elementor-element elementor-element-9f5f6fe" data-id="9f5f6fe"><div class="elementor-widget" data-id="b76e024"><div class="e-n-carousel swiper"><div class="swiper-wrapper"><div class="swiper-slide swiper-slide-active" data-swiper-slide-index="0">${html}</div></div></div><div class="elementor-swiper-button elementor-swiper-button-prev"></div><div class="elementor-swiper-button elementor-swiper-button-next"></div><div class="swiper-pagination-fraction">1 / 6</div></div></div></section></main>`;
    const render=(index:number,patched:boolean)=>renderStaticHTML({key:'header-offer-'+index,kind:'html-static',template:'<div class="notice"><span data-cwp-text="t0"></span><a data-cwp-link="t1" data-cwp-text="t1"></a></div>',css:common+baseNotice,responsiveCss:patched?narrowNotice:undefined,slots:{text:{t0:pairs[index][0],t1:pairs[index][1]},links:{t1:{url:'https://source.example/deals/'}},media:{}}} as any,'test','100000'+index,[],'responsive').html;
    for(const width of [1025,1100,1439,1440,1920]){
      await page.setViewportSize({width,height:1000});
      for(let index=0;index<6;index++){
        await page.setContent(shell(width,render(index,true),baseNative+narrowNative));
        const geometry:any=await headerOffersGeometry(page.locator('[data-id="b76e024"]'),'header');
        assert.ok(geometry.passed,JSON.stringify({width,index,checks:geometry.checks,collisions:geometry.collisions}));
        const extra=await page.locator('.notice').evaluate(node=>{const b=node.getBoundingClientRect(),ranges=[];for(const child of Array.from(node.childNodes)){const range=document.createRange();range.selectNodeContents(child);ranges.push(...Array.from(range.getClientRects()).filter(r=>r.width>0&&r.height>0).map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})));}return{height:b.height,rect:{left:b.left,right:b.right,top:b.top,bottom:b.bottom},ranges};});
        assert.equal(extra.height,44);assert.ok(extra.ranges.every(g=>g.top>=extra.rect.top&&g.bottom<=extra.rect.bottom));
        assert.ok(extra.ranges.every(g=>geometry.controls.every((c:any)=>Math.min(g.right,c.rect.right)-Math.max(g.left,c.rect.left)<=.01||Math.min(g.bottom,c.rect.bottom)-Math.max(g.top,c.rect.top)<=.01)));
        if(width>=1440){
          await page.setContent(shell(width,render(index,false),baseNative));
          const before:any=await headerOffersGeometry(page.locator('[data-id="b76e024"]'),'header');
          assert.deepEqual(geometry,before,'1440/1920 geometry stays byte-for-byte identical');
        }
      }
    }
    await page.setViewportSize({width:1025,height:1000});await page.setContent(shell(1025,render(4,false),baseNative));
    const original:any=await headerOffersGeometry(page.locator('[data-id="b76e024"]'),'header');
    assert.equal(original.passed,false,'the unbounded original must expose the actual navigation collision');assert.ok(original.collisions.length>0);
  }finally{await browser.close();}
});
