import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { carouselState,hoverPaintedTarget,inspectFidelityPage, selectPaintedHoverTarget,waitForNativeCarouselReady,waitForStableHoverPaint } from '../src/fidelity/acceptance.js';
import type { BlockContract, NativeProgram } from '../src/fidelity/types.js';
import type { CompiledFidelity } from '../src/fidelity/native.js';

function fixture() {
  const observed={status:'observed' as const,evidence:['local-source']},none={status:'not-applicable' as const,evidence:[]};
  const contract:BlockContract={version:1,workflow:'block-replication',sourceUrl:'https://8.8.8.8/',capturedAt:'2026-10-13T09:00:00Z',referenceReport:{path:'source.json',sha256:'0'.repeat(64)},evidence:[],tolerances:{geometryPx:20,geometryRatio:.1,colorChannel:4},limitations:[],blocks:[{id:'products',role:'products',presentation:'carousel',texts:[{id:'food',text:'Original Food',kind:'product-name'}],assets:[],evidence:['local-source'],geometry:{desktop:{width:200,height:100,columns:1}},colors:{},states:{normal:none,interaction:{...observed,properties:{subject:'arrow-next',nextChangesSlide:true}},hover:{...observed,properties:{subject:'product-link',sourceTextId:'food',sourceHref:'https://8.8.8.8/food'}}}}]};
  const program:NativeProgram={version:1,workflow:'block-replication',title:'Source fixture',sourceUrl:contract.sourceUrl,sourceContract:{path:'source.json',sha256:'0'.repeat(64)},assetsManifest:{path:'assets.json',sha256:'0'.repeat(64)},deviations:[],elements:[{key:'root',type:'container',settings:{},children:[{key:'carousel',type:'nested-carousel',settings:{},children:[{key:'food',type:'heading',settings:{title:'Original Food'}},{key:'treat',type:'heading',settings:{title:'Original Treat'}}]}]}],blocks:[{sourceBlockId:'products',rootKey:'root',presentation:'carousel',bindings:[{sourceTextId:'food',elementKey:'food',settingPath:'title'}],states:contract.blocks[0].states}]};
  const compiled:CompiledFidelity={composition:{elements:[],pageSettings:{}},plan:{title:program.title,mode:'legacy-verified',compositionJson:'{}',mappings:[],unsupported:[],rationale:'Fixture'},elementMap:{root:'1111111',carousel:'2222222',food:'5555555',treat:'6666666'},sectionIds:['1111111'],sections:[],usedTypes:[],scopedCSS:[]};
  return{contract,program,compiled};
}

test('fresh frontend waits initialization and restores the same logical source through a real previous click at a different physical loop copy',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'clonewp-fresh-states-')),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:800,height:600}});
    await page.setContent(`<!doctype html><style>body{margin:20px}.swiper{width:200px;height:100px;overflow:hidden;position:relative}.swiper-wrapper{position:relative;width:600px;height:100px}.swiper-slide{position:absolute;width:200px;height:100px;top:0}a{color:rgb(51,51,51);text-decoration:none}a:hover{color:rgb(0,86,184);text-decoration:underline}</style>
      <div data-id="1111111"><div data-id="2222222" data-settings='{"autoplay":"yes","pause_on_hover":"yes","infinite":"yes"}'><div class="swiper"><div class="swiper-wrapper">
      <div class="swiper-slide swiper-slide-active" data-swiper-slide-index="0" style="left:0">Original wrapper<div data-id="5555555"><h3 class="elementor-heading-title"><a href="https://8.8.8.8/food">Original Food</a></h3></div></div>
      <div class="swiper-slide" data-swiper-slide-index="1" style="left:200px"><div data-id="6666666">Original Treat</div></div>
      <div class="swiper-slide swiper-slide-duplicate" data-swiper-slide-index="0" style="left:400px">Different physical loop wrapper<div data-id="5555555"><h3 class="elementor-heading-title"><a href="https://8.8.8.8/food">Original Food</a></h3></div></div>
      </div></div><button class="elementor-swiper-button-prev">Previous</button><button class="elementor-swiper-button-next">Next</button></div></div>
      <script>window.fixtureClicks=[];const area=document.querySelector('.swiper'),slides=[...area.querySelectorAll('.swiper-slide')];
      setTimeout(()=>{area.swiper={initialized:true,destroyed:false,animating:false,params:{slidesPerView:1},autoplay:{running:true,paused:false},slideNext(){throw Error('Runtime mutation forbidden')},slidePrev(){throw Error('Runtime mutation forbidden')}}},200);
      area.addEventListener('mouseenter',()=>{if(area.swiper)area.swiper.autoplay.paused=true});area.addEventListener('mouseleave',()=>{if(area.swiper)area.swiper.autoplay.paused=false});
      function position(offset,active){slides.forEach((slide,index)=>{slide.style.left=(index*200-offset)+'px';slide.classList.toggle('swiper-slide-active',index===active)})}
      document.querySelector('.elementor-swiper-button-next').onclick=()=>{fixtureClicks.push('next');position(200,1)};document.querySelector('.elementor-swiper-button-prev').onclick=()=>{fixtureClicks.push('previous');position(400,2)};
      Object.defineProperty(globalThis,'__name',{value:target=>target,configurable:true});</script>`);
    const data=fixture(),receipt=await inspectFidelityPage({page,...data,viewport:'desktop',runDir:directory}),carousel=receipt.carousels[0];
    assert.equal(carousel.before?.initialized,true);assert.equal(carousel.before?.autoplayPaused,true);
    assert.equal(carousel.clicked,true);assert.equal(carousel.moved,true);assert.equal(carousel.restored,true);
    assert.deepEqual(carousel.before?.activeSourceIds,['index:0']);assert.deepEqual(carousel.after?.activeSourceIds,['index:1']);assert.deepEqual(carousel.restoredState?.activeSourceIds,['index:0']);
    assert.equal(carousel.before?.visibleWrappers[0].clone,false);assert.equal(carousel.restoredState?.visibleWrappers[0].clone,true);
    assert.notEqual(carousel.before?.token,carousel.restoredState?.token,'legacy original-only text tokens differ despite the same proved source position');
    assert.deepEqual(await page.evaluate(()=> (window as unknown as{fixtureClicks:string[]}).fixtureClicks),['next','previous']);
    assert.equal(receipt.observations.find(item=>item.state==='interaction')?.status,'verified');
    assert.equal(receipt.hovers[0].hovered,true);assert.equal(receipt.hovers[0].target?.clone,true);assert.equal(receipt.hovers[0].restored,true);
    assert.equal(receipt.hovers[0].after?.color,'rgb(0, 86, 184)');assert.equal(receipt.observations.find(item=>item.state==='hover')?.properties.sourceTextId,'food');
  }finally{await browser.close();await rm(directory,{recursive:true,force:true});}
});

test('hover selection requires exact source href/text plus a genuinely painted unclipped unoccluded pointer location',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:600,height:400}});
    await page.setContent(`<style>body{margin:0}.window{width:200px;height:100px;overflow:hidden;position:relative}.slide{position:absolute;width:200px;height:100px;top:0}a{display:block;width:150px;height:40px}.overlay{position:absolute;left:0;top:0;width:200px;height:100px;background:white;z-index:99}</style><div class="window"><div class="slide" style="left:-200px"><a data-id="5555555" href="https://8.8.8.8/food">Original Food</a></div><div class="slide swiper-slide-duplicate" style="left:0"><a data-id="5555555" href="https://8.8.8.8/food">Original Food</a></div><div class="slide" style="left:200px"><a data-id="7777777" href="https://8.8.8.8/food">Wrong bound title</a></div></div>`);
    const candidates=page.locator('a[href]'),selected=await selectPaintedHoverTarget(candidates,{sourceHref:'https://8.8.8.8/food',expectedText:'Original Food'});
    assert.ok(selected);assert.equal(selected.index,1);assert.equal(selected.clone,true);assert.equal(selected.targetId,'5555555');
    await selected.locator.hover({position:selected.position});assert.equal(await selected.locator.evaluate(element=>element.matches(':hover')),true);
    assert.equal(await selectPaintedHoverTarget(candidates,{sourceHref:'https://8.8.8.8/other'}),undefined);
    assert.equal(await selectPaintedHoverTarget(candidates,{expectedText:'Wrong bound title'}),undefined,'an offscreen link cannot substitute a bound visible source leaf');
    await page.locator('.window').evaluate(element=>{const overlay=document.createElement('div');overlay.className='overlay';element.append(overlay)});
    assert.equal(await selectPaintedHoverTarget(candidates,{sourceHref:'https://8.8.8.8/food',expectedText:'Original Food'}),undefined,'covered native link is unverified, never force-hovered');
  }finally{await browser.close();}
});

test('source column declarations cannot turn a clipped nonmoving carousel into all-items-fit success',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'clonewp-no-fake-fit-')),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:800,height:600}}),data=fixture();data.contract.blocks[0].geometry.desktop.columns=2;data.contract.blocks[0].states.hover={status:'not-applicable',evidence:[]};
    await page.setContent(`<style>.swiper{width:200px;height:100px;overflow:hidden}.swiper-wrapper{display:flex;width:400px}.swiper-slide{width:200px;min-width:200px;height:100px}</style><div data-id="1111111"><div data-id="2222222"><div class="swiper"><div class="swiper-wrapper"><div class="swiper-slide swiper-slide-active" data-swiper-slide-index="0">Food</div><div class="swiper-slide" data-swiper-slide-index="1">Treat</div></div></div></div></div><script>document.querySelector('.swiper').swiper={initialized:true,destroyed:false,animating:false,params:{slidesPerView:1}};Object.defineProperty(globalThis,'__name',{value:target=>target,configurable:true});</script>`);
    const bad=await inspectFidelityPage({page,...data,viewport:'desktop',runDir:directory});
    assert.equal(bad.carousels[0].before?.visibleSlides,1);assert.equal(bad.carousels[0].allSlidesFit,false);assert.equal(bad.carousels[0].moved,false);assert.equal(bad.observations[0].status,'unverified');
    await page.locator('.swiper').evaluate(element=>(element as HTMLElement).style.width='400px');
    const fits=await inspectFidelityPage({page,...data,viewport:'desktop',runDir:directory});
    assert.equal(fits.carousels[0].before?.visibleSlides,2);assert.equal(fits.carousels[0].allSlidesFit,true);assert.equal(fits.carousels[0].clicked,false);assert.equal(fits.carousels[0].restored,true);assert.equal(fits.observations[0].status,'verified');
  }finally{await browser.close();await rm(directory,{recursive:true,force:true});}
});

test('interaction observations need normal motion before initialization; reduced CSS transitions leave an honestly unready animating runtime',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    for(const motion of ['reduce','no-preference']as const){
      const context=await browser.newContext({reducedMotion:'no-preference'}),page=await context.newPage();
      try{
        await page.setContent(`<!doctype html><style>.swiper{width:200px;height:100px;overflow:hidden}.swiper-wrapper{display:flex;width:400px;transform:translateX(0);transition:transform .15s linear}.swiper-slide{width:200px;min-width:200px;height:100px}@media(prefers-reduced-motion:reduce){.swiper-wrapper{transition-duration:0s!important}}</style><div data-id="2222222"><div class="swiper"><div class="swiper-wrapper"><div class="swiper-slide swiper-slide-active" data-swiper-slide-index="0">Food</div><div class="swiper-slide" data-swiper-slide-index="1">Treat</div></div></div><button class="next">Next</button><button class="previous">Previous</button></div><script>const area=document.querySelector('.swiper'),track=document.querySelector('.swiper-wrapper'),slides=[...track.children];area.swiper={initialized:true,destroyed:false,animating:false,params:{slidesPerView:1}};let active=0;track.addEventListener('transitionend',()=>{area.swiper.animating=false});function move(value){if(area.swiper.animating)return;active=value;area.swiper.animating=true;track.style.transform='translateX('+(-active*200)+'px)';slides.forEach((slide,index)=>slide.classList.toggle('swiper-slide-active',index===active))}document.querySelector('.next').onclick=()=>move(1);document.querySelector('.previous').onclick=()=>move(0);Object.defineProperty(globalThis,'__name',{value:target=>target,configurable:true});</script>`);
        const widget=page.locator('[data-id="2222222"]');await page.waitForFunction(()=>{const runtime=(document.querySelector('.swiper')as HTMLElement&{swiper?:{initialized?:boolean;animating?:boolean}})?.swiper;return runtime?.initialized===true&&runtime.animating===false;});const initialized=(await waitForNativeCarouselReady(widget,5000)).state;assert.equal(initialized.initialized,true);assert.equal(initialized.animating,false);assert.deepEqual(initialized.activeSourceIds,['index:0']);await page.emulateMedia({reducedMotion:motion});
        await page.locator('.next').click();await page.waitForTimeout(220);const next=await carouselState(widget);
        assert.deepEqual(next.activeSourceIds,['index:1']);assert.equal(next.reducedMotion,motion==='reduce');
        if(motion==='reduce'){
          assert.equal(next.transitionDuration,'0s');assert.equal(next.animating,true);
          // The negative budget must allow a real geometry sample under full-suite browser CPU contention.
          await assert.rejects(waitForNativeCarouselReady(widget,2000),(error:unknown)=>{const actual=error as{lastState?:Awaited<ReturnType<typeof carouselState>>};assert.equal(actual.lastState?.animating,true);assert.equal(actual.lastState?.reducedMotion,true);return true});
          await page.locator('.previous').click();assert.deepEqual((await carouselState(widget)).activeSourceIds,['index:1'],'no readiness or restoration success is claimed from a stuck runtime');
        }else{
          assert.equal(next.animating,false);await page.locator('.previous').click();const restored=(await waitForNativeCarouselReady(widget,5000)).state;assert.deepEqual(restored.activeSourceIds,['index:0']);assert.equal(restored.animating,false);
        }
      }finally{await context.close();}
    }
  }finally{await browser.close();}
});

test('a real hit-tested pointer hovers a clipped multiline leaf and waits its full 300ms paint transition before comparing restoration',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:700,height:500}});await page.setContent(`<style>body{margin:40px}.owned{height:40px;overflow:hidden;width:170px;font:bold 16px/20px Arial;letter-spacing:.8px}a{color:rgb(61,57,53);background-color:rgb(255,192,0);transition:color .3s,background-color .3s}a:hover{color:rgb(255,255,255);background-color:rgb(0,71,210)}</style><div class="owned" data-id="5555555"><a href="https://8.8.8.8/product/own/">Aristopet Superhero Halloween Costume Dog Hoodie, Blue</a></div>`);
    const selected=await selectPaintedHoverTarget(page.locator('.owned a'));assert.ok(selected);const before=await waitForStableHoverPaint(selected.locator);await hoverPaintedTarget(selected);const after=await waitForStableHoverPaint(selected.locator);
    assert.equal(after.color,'rgb(255, 255, 255)');assert.equal(after.backgroundColor,'rgb(0, 71, 210)');assert.equal(await selected.locator.evaluate(element=>element.matches(':hover')),true);
    await page.mouse.move(0,0);const restored=await waitForStableHoverPaint(selected.locator);assert.deepEqual(restored,before,'transition samples never become final source paint or a false restoration failure');
    await page.locator('.owned').evaluate(element=>{const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;background:white;z-index:999';document.body.append(overlay)});
    await assert.rejects(hoverPaintedTarget(selected),/no longer unobstructed/);
  }finally{await browser.close();}
});
