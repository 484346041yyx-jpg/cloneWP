import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {prepareRestoredRenderingV2} from '../src/replica-v2/render-preparation.js';
import {carouselState} from '../src/fidelity/acceptance.js';

/** Local environment fixture, not a Swiper implementation test: real clipping,
 * CSS widths/transform and delayed browser initialization precede six-card paint. */
function fixture(badPainted=false):string{return `<!doctype html><html><head><style>
html,body{margin:0}body{font-family:Arial}.elementor{width:650px;margin:auto}.spacer{height:1600px}.swiper{width:600px;height:110px;overflow:hidden}.swiper-wrapper{display:flex;width:max-content;transform:translateX(-600px)}.swiper-slide{flex:0 0 600px;width:600px;height:100px}.swiper-slide img{display:block;width:90px;height:80px}.ready .swiper-slide{flex-basis:100px;width:100px}.ready .swiper-wrapper{transform:translateX(-100px)}#pane{width:150px;height:25px;overflow:auto}#pane>div{width:500px;height:25px}.lazy-region{height:600px}.lazy-region img{width:180px;height:120px}#hidden{display:none}.horizontal-clip{position:relative;width:120px;height:30px;overflow:hidden}.horizontal-clip img{position:absolute;left:150px;width:80px;height:25px}[data-cwp-background]{width:180px;height:90px;background-image:url('/background.png')}
</style></head><body><main class="elementor" data-id="root"><div id="pane"><div>Unrelated existing horizontal scroll</div></div><div class="spacer"></div><section data-id="carousel" data-settings='{"autoplay":"no","infinite":"no"}'><div class="swiper"><div class="swiper-wrapper">${Array.from({length:7},(_,index)=>`<div class="swiper-slide${index===1?' swiper-slide-active':''}" data-swiper-slide-index="${index}"><img src="${index===0?'/clipped-bad.png':badPainted&&index===3?'/painted-bad.png':'/card.png'}" width="90" height="80" alt="Card ${index}"></div>`).join('')}</div></div></section><div class="spacer"></div><section class="lazy-region" data-id="services"><img id="service-image" loading="lazy" src="/services.png" width="180" height="120" alt="Services"><div data-cwp-background="service-background"></div></section><div class="spacer"></div><footer class="lazy-region" data-id="footer"><img id="footer-image" loading="lazy" src="/footer.png" width="180" height="120" alt="Footer"><div id="hidden"><img src="/hidden-bad.png" width="90" height="80"></div><div class="horizontal-clip"><img src="/overflow-bad.png" width="80" height="25"></div></footer></main><script>
const windowNode=document.querySelector('.swiper'),widget=document.querySelector('[data-id="carousel"]');window.renderHistory=[{event:'ssr',count:1,at:performance.now()}];windowNode.swiper={initialized:false,destroyed:false,animating:false,realIndex:1,activeIndex:1,params:{slidesPerView:6,slidesPerGroup:1,loop:false,autoplay:false},autoplay:{running:false}};
let scheduled=false;const observer=new IntersectionObserver(entries=>{if(scheduled||!entries.some(entry=>entry.isIntersecting))return;scheduled=true;setTimeout(()=>{widget.classList.add('ready');windowNode.swiper.initialized=true;window.renderHistory.push({event:'initialized',count:6,at:performance.now()});observer.disconnect();},250);});observer.observe(widget);
window.imageLoaded=[];document.querySelectorAll('img').forEach(image=>image.addEventListener('load',()=>window.imageLoaded.push(image.getAttribute('src'))));
</script></body></html>`;}

async function environment(run:(origin:string,requests:string[])=>Promise<void>){
  const png=await sharp({create:{width:18,height:12,channels:4,background:'#167f9b'}}).png().toBuffer(),requests:string[]=[];
  const server=createServer((request,response)=>{const url=new URL(request.url??'/','http://fixture.test');requests.push(url.pathname);if(url.pathname.endsWith('.png')){if(url.pathname.includes('bad')){response.writeHead(404,{'Content-Type':'text/plain'});response.end('Actual undecodable fixture');}else setTimeout(()=>{response.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});response.end(png);},80);return;}response.writeHead(200,{'Content-Type':'text/html'});response.end(fixture(url.searchParams.has('bad-painted')));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  try{await run(`http://127.0.0.1:${address.port}`,requests);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
const options={rootIds:['root'],nativeCarouselIds:['carousel'],productCarouselIds:[],documentHash:'7'.repeat(64)};

test('restored rendering waits for real six-card initialization, decodes lazy services/footer and preserves scroll/model',async()=>{
  await environment(async(origin,requests)=>{
    const browser=await chromium.launch({headless:true});
    try{
      const context=await browser.newContext({viewport:{width:900,height:600}}),page=await context.newPage();await page.goto(origin,{waitUntil:'domcontentloaded'});await page.evaluate(()=>{scrollTo(0,85);document.getElementById('pane')!.scrollLeft=35;});
      const before=await carouselState(page.locator('[data-id="carousel"]'));assert.equal(before.initialized,false);assert.equal(before.visibleSlides,1);assert.equal(requests.includes('/footer.png'),false,'the truly lower lazy image has not yet been requested');
      const attributes=await page.locator('img').evaluateAll(images=>images.map(image=>({src:image.getAttribute('src'),loading:image.getAttribute('loading'),width:image.getAttribute('width'),height:image.getAttribute('height')})));
      const receipt=await prepareRestoredRenderingV2(page,options);
      assert.equal(receipt.passed,true);assert.equal(receipt.pagesCreated,0);assert.equal(receipt.contextsCreated,0);assert.equal(context.pages().length,1);assert.equal(receipt.documentHash,options.documentHash);
      assert.equal(receipt.carousels.length,1);const carousel=receipt.carousels[0];assert.equal(carousel.state.initialized,true);assert.equal(carousel.state.runtimeSlidesPerView,6);assert.equal(carousel.state.visibleSlides,6);assert.deepEqual(carousel.state.visibleSourceIds,['index:1','index:2','index:3','index:4','index:5','index:6']);assert.deepEqual(carousel.restored.visibleSourceIds,carousel.state.visibleSourceIds);assert.deepEqual(carousel.restored.activeSourceIds,['index:1']);
      for(const filename of ['/services.png','/footer.png']){assert.ok(requests.includes(filename));const proof=receipt.images.find((image:any)=>image.url===origin+filename);assert.ok(proof);assert.equal(proof.decoded,true);assert.equal(proof.drawable,true);assert.ok(proof.paintedWidth>1&&proof.paintedHeight>1);assert.ok(proof.scrollY>1000);}
      assert.ok(receipt.backgrounds.some((background:any)=>background.url===origin+'/background.png'&&background.decoded&&background.drawable));assert.ok(receipt.images.every((image:any)=>!image.url.includes('bad')),'horizontal clip outside and CSS-hidden images cannot become paint requirements');
      assert.equal(receipt.scroll.restored,true);assert.equal(receipt.restored.exact,true);assert.deepEqual(await page.evaluate(()=>({x:scrollX,y:scrollY,pane:document.getElementById('pane')!.scrollLeft})),{x:0,y:85,pane:35});
      assert.deepEqual(await page.locator('img').evaluateAll(images=>images.map(image=>({src:image.getAttribute('src'),loading:image.getAttribute('loading'),width:image.getAttribute('width'),height:image.getAttribute('height')}))),attributes,'preparation must not rewrite media sources, lazy declarations or model dimensions');
      assert.deepEqual(await page.evaluate(()=>(window as any).renderHistory.map((event:any)=>event.count)),[1,6]);
      // Capture uses the same already-open page after successful actual decode.
      const screenshot=await page.screenshot({fullPage:true});assert.ok(screenshot.byteLength>1000);assert.equal(context.pages().length,1);
      await context.close();
    }finally{await browser.close();}
  });
});

test('a truly painted broken image fails restored rendering and still restores original scroll and native window',async()=>{
  await environment(async origin=>{
    const browser=await chromium.launch({headless:true});
    try{
      const page=await browser.newPage({viewport:{width:900,height:600}});await page.goto(origin+'/?bad-painted=1',{waitUntil:'domcontentloaded'});await page.evaluate(()=>{scrollTo(0,85);document.getElementById('pane')!.scrollLeft=35;});
      let failure:any;try{await prepareRestoredRenderingV2(page,options);}catch(error){failure=error;}
      assert.ok(failure,'a404 image inside the actual native window must block the screenshot gate');assert.match(failure.message,/decod|pixels/i);const evidence=failure.evidence;assert.equal(evidence.passed,false);assert.equal(evidence.restored.exact,true);assert.ok(evidence.images.some((image:any)=>image.url===origin+'/painted-bad.png'&&!image.decoded));assert.ok(evidence.images.every((image:any)=>!image.url.includes('/clipped-bad.png')));
      assert.deepEqual(await page.evaluate(()=>({x:scrollX,y:scrollY,pane:document.getElementById('pane')!.scrollLeft})),{x:0,y:85,pane:35});const after=await carouselState(page.locator('[data-id="carousel"]'));assert.equal(after.initialized,true);assert.deepEqual(after.activeSourceIds,['index:1']);assert.deepEqual(after.visibleSourceIds,['index:1','index:2','index:3','index:4','index:5','index:6']);
    }finally{await browser.close();}
  });
});
