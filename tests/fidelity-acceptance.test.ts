import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { inspectFidelityPage, assertAuthorizedCarouselChange,normalizeFidelityMeasurements,bindSourceScrollEvidence,responsiveTextBindings,resolveResponsiveTextMeasurements,resolveProvenResponsiveTextMeasurements,verifyNativeBackgroundMedia,nativeBoundTitleSelector,type FidelityPageStateReceipt } from '../src/fidelity/acceptance.js';
import { compileEditorElements } from '../src/wordpress/editor-serialization.js';
import type { DraftSnapshot, LegacySchema } from '../src/wordpress/types.js';
import type { NativeProgram, BlockContract } from '../src/fidelity/types.js';
import type { CompiledFidelity } from '../src/fidelity/native.js';
import type{TargetViewportEvidence,TargetElementEvidence,TargetImageEvidence}from'../src/verification/types.js';

test('fidelity frontend probe clicks actual carousel arrows, verifies movement and restoration, and measures actual hover paint', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-fidelity-states-')), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.setContent(`<!doctype html><html><head><title>Owned native carousel fixture</title><style>
      .swiper {width:200px;overflow:hidden}.swiper-wrapper{display:flex;width:400px;transform:translateX(0px)}.swiper-slide{width:200px;min-width:200px;height:180px}
      .elementor-heading-title a{color:rgb(51,51,51);text-decoration:none}.elementor-heading-title a:hover{color:rgb(0,86,184);text-decoration:underline}
      </style></head><body><div class="elementor" data-elementor-type="wp-page"><div data-id="1111111" data-element_type="container">
        <div data-id="2222222" data-widget_type="nested-carousel.default" data-settings='{"autoplay":"no","autoplay_speed":5000,"infinite":"yes"}'>
          <div class="swiper"><div class="swiper-wrapper"><div class="swiper-slide swiper-slide-active" data-swiper-slide-index="0"><div data-id="3333333" data-element_type="container"><div data-id="5555555" data-widget_type="heading.default"><h3 class="elementor-heading-title"><a href="https://8.8.8.8/food">Original Food</a></h3></div><p>$16.99</p></div></div>
          <div class="swiper-slide" data-swiper-slide-index="1"><div data-id="4444444" data-element_type="container"><h3>Original Treats</h3><p>$4.99</p></div></div></div></div>
          <button class="elementor-swiper-button-prev" aria-label="Previous slide">Previous</button><button class="elementor-swiper-button-next" aria-label="Next slide">Next</button>
        </div></div></div><script>
        document.querySelector('.swiper').swiper={initialized:true,destroyed:false,animating:false,params:{slidesPerView:1}};
        let active=0; function setActive(value){active=value;document.querySelector('.swiper-wrapper').style.transform='translateX('+(-active*200)+'px)';document.querySelectorAll('.swiper-slide').forEach((slide,index)=>slide.classList.toggle('swiper-slide-active',index===active));}
        document.querySelector('.elementor-swiper-button-next').addEventListener('click',()=>setActive((active+1)%2));document.querySelector('.elementor-swiper-button-prev').addEventListener('click',()=>setActive((active+1)%2));
        Object.defineProperty(globalThis,'__name',{value:(target)=>target,configurable:true});
        </script></body></html>`);
    const state = { status: 'observed' as const, evidence: ['real-source-fixture'] };
    const contract: BlockContract = { version: 1, workflow: 'block-replication', sourceUrl: 'https://8.8.8.8/', capturedAt: '2026-10-13T05:00:00Z', referenceReport: { path: 'source.json', sha256: '0'.repeat(64) }, evidence: [{ id: 'real-source-fixture', path: 'source.json', sha256: '0'.repeat(64), kind: 'dom' }], tolerances: { geometryPx: 20, geometryRatio: 0.1, colorChannel: 4 }, limitations: [], blocks: [{ id: 'products', role: 'products', presentation: 'carousel', texts: [{ id: 'food-title', text: 'Original Food', kind: 'product-name' }], assets: [], evidence: ['real-source-fixture'], geometry: { desktop: { width: 200, height: 180, columns: 1 } }, colors: {}, states: { normal: state, hover: { ...state, properties: { subject: 'product-link', sourceTextId:'food-title',sourceHref:'https://8.8.8.8/food',color: '#0056b8', colorChanged: true } }, interaction: { ...state, properties: { subject: 'arrow-next', nextChangesSlide: true, slideCount: 2, visibleSlides: 1 } } } }] };
    const program: NativeProgram = { version: 1, workflow: 'block-replication', sourceUrl: contract.sourceUrl, title: 'Owned source fixture', sourceContract: { path: 'source.json', sha256: '0'.repeat(64) }, assetsManifest: { path: 'assets.json', sha256: '0'.repeat(64) }, deviations: [], elements: [{ key: 'products-root', type: 'container', settings: {}, children: [{ key: 'products-carousel', type: 'nested-carousel', settings: {}, children: [{ key: 'food-card', type: 'container', settings: {}, children: [{ key: 'food-title', type: 'heading', settings: { title: 'Original Food' } }] }, { key: 'treat-card', type: 'container', settings: {} }] }] }], blocks: [{ sourceBlockId: 'products', rootKey: 'products-root', presentation: 'carousel', bindings: [{ sourceTextId: 'food-title', elementKey: 'food-title', settingPath: 'title' }], states: contract.blocks[0].states }] };
    const compiled: CompiledFidelity = { composition: { elements: [], pageSettings: {} }, plan: { title: program.title, mode: 'legacy-verified', compositionJson: '{}', mappings: [], unsupported: [], rationale: 'Fixture' }, elementMap: { 'products-root': '1111111', 'products-carousel': '2222222', 'food-card': '3333333', 'treat-card': '4444444', 'food-title': '5555555' }, sectionIds: ['1111111'], sections: [], usedTypes: [], scopedCSS: [] };
    const receipt = await inspectFidelityPage({ page, program, contract, compiled, viewport: 'desktop', runDir: directory });
    assert.equal(receipt.carousels.length, 1); assert.equal(receipt.carousels[0].clicked, true); assert.equal(receipt.carousels[0].moved, true); assert.equal(receipt.carousels[0].restored, true);
    assert.equal(receipt.hovers[0].hovered, true); assert.equal(receipt.hovers[0].restored, true); assert.equal(receipt.hovers[0].before?.color, 'rgb(51, 51, 51)'); assert.equal(receipt.hovers[0].after?.color, 'rgb(0, 86, 184)');
    const interaction = receipt.observations.find(item => item.state === 'interaction')!; assert.equal(interaction.status, 'verified'); assert.equal(interaction.properties.nextChangesSlide, true); assert.equal(interaction.properties.visibleSlides, 1); assert.equal(interaction.properties.autoplayDeclared, false);
    const hover = receipt.observations.find(item => item.state === 'hover')!; assert.equal(hover.status, 'verified'); assert.equal(hover.properties.underline, true); assert.equal(hover.properties.colorChanged, true);
    assert.equal(hover.properties.sourceTextId,'food-title');assert.equal(hover.properties.sourceHref,'https://8.8.8.8/food');
    assert.equal(await page.locator('.swiper-slide-active').getAttribute('data-swiper-slide-index'), '0');
    await page.evaluate(()=>{
      document.querySelector('.elementor-swiper-button-next')?.remove();document.querySelector('.elementor-swiper-button-prev')?.remove();
      const area=document.querySelector('.swiper')!;let start=0;
      area.addEventListener('pointerdown',event=>{start=(event as PointerEvent).clientX;});
      area.addEventListener('pointerup',event=>{if(Math.abs((event as PointerEvent).clientX-start)>20){const active=Array.from(document.querySelectorAll('.swiper-slide')).findIndex(slide=>slide.classList.contains('swiper-slide-active'));const next=(active+1)%2;const track=document.querySelector('.swiper-wrapper') as HTMLElement;track.style.transform=`translateX(${-next*200}px)`;document.querySelectorAll('.swiper-slide').forEach((slide,index)=>slide.classList.toggle('swiper-slide-active',index===next));}});
    });
    contract.blocks[0].states.interaction.properties={subject:'swipe',swipeChangesSlide:true,slideCount:2,visibleSlides:1};
    const swipeReceipt=await inspectFidelityPage({page,program,contract,compiled,viewport:'desktop',runDir:directory});
    assert.equal(swipeReceipt.carousels[0].clicked,false);assert.equal(swipeReceipt.carousels[0].dragged,true);assert.equal(swipeReceipt.carousels[0].swipeChanged,true);assert.equal(swipeReceipt.carousels[0].restored,true);assert.equal(swipeReceipt.observations.find(item=>item.state==='interaction')?.properties.swipeChangesSlide,true);
    contract.blocks[0].geometry.desktop.columns=2;
    await page.locator('.swiper').evaluate(element=>(element as HTMLElement).style.width='400px');
    const fitsReceipt=await inspectFidelityPage({page,program,contract,compiled,viewport:'desktop',runDir:directory});
    assert.equal(fitsReceipt.carousels[0].dragged,undefined);assert.equal(fitsReceipt.carousels[0].allSlidesFit,true);assert.equal(fitsReceipt.carousels[0].restored,true);assert.equal(fitsReceipt.observations.find(item=>item.state==='interaction')?.properties.movementRequired,false);
  } finally { await browser.close(); assert.ok(path.relative(os.tmpdir(), directory).startsWith('clonewp-fidelity-states-')); await rm(directory, { recursive: true, force: true }); }
});

test('native carousel restore guard accepts only its registered display-count change and preserves source repeater, text, structure and concurrent edits',()=>{
  const schemas:Record<string,LegacySchema>={container:{type:'container',class:'Container',controls:{}},'nested-carousel':{type:'nested-carousel',class:'NestedCarousel',controls:{slides_to_show:{type:'select',default:'',options:{'1':1,'2':2}},carousel_items:{type:'nested-elements',default:[]}},nativeChildren:{childType:'container',repeaterKey:'carousel_items',titleSettingKey:'slide_title',baseClass:'NestedBase',sourceSha256:'a'.repeat(64)}}};
  const before:DraftSnapshot={pageId:11,runId:'owned-run',title:'Owned source draft',status:'draft',hash:'a'.repeat(64),settings:{},elements:compileEditorElements([{id:'1111111',elType:'container',isInner:false,settings:{},elements:[{id:'2222222',elType:'widget',widgetType:'nested-carousel',settings:{slides_to_show:'2',carousel_items:[{_id:'slide1',slide_title:'Original source slide'}]},elements:[{id:'3333333',elType:'container',isInner:true,settings:{},elements:[]}]}]}],schemas)};
  const edit={targetId:'2222222',setting:'slides_to_show' as const,value:'1'},current=structuredClone(before);current.elements[0].elements[0].settings.slides_to_show='1';
  assert.doesNotThrow(()=>assertAuthorizedCarouselChange(before,current,edit,schemas));
  const numeric=structuredClone(current);numeric.elements[0].elements[0].settings.slides_to_show=1;assert.doesNotThrow(()=>assertAuthorizedCarouselChange(before,numeric,edit,schemas));
  const repeated=structuredClone(current);(repeated.elements[0].elements[0].settings.carousel_items as Array<{slide_title:string}>)[0].slide_title='Rewritten concurrent source title';assert.throws(()=>assertAuthorizedCarouselChange(before,repeated,edit,schemas),/unrelated document or repeater/);
  const pageChanged=structuredClone(current);pageChanged.settings.background_color='#ff0000';assert.throws(()=>assertAuthorizedCarouselChange(before,pageChanged,edit,schemas),/outside its authorized/);
  const unsupported=structuredClone(current);unsupported.elements[0].elements[0].settings.slides_to_show='99';assert.throws(()=>assertAuthorizedCarouselChange(before,unsupported,{...edit,value:'99'},schemas),/registered select value/);
  const nested=structuredClone(current);nested.elements[0].elements[0].elements[0].isInner=false;assert.throws(()=>assertAuthorizedCarouselChange(before,nested,edit,schemas),/changed native nesting/);
});

test('offscreen unrequested native lazy images are excluded only with actual DOM proof and no failed visible original sharing their URI',()=>{
  const program:NativeProgram={version:1,workflow:'block-replication',title:'Fixture',sourceUrl:'https://8.8.8.8/',sourceContract:{path:'c',sha256:'a'.repeat(64)},assetsManifest:{path:'a',sha256:'a'.repeat(64)},blocks:[],deviations:[],elements:[{key:'root',type:'container',settings:{},children:[{key:'carousel',type:'nested-carousel',settings:{},children:[{key:'photo',type:'image',settings:{}}]}]}]};
  const compiled:CompiledFidelity={composition:{elements:[],pageSettings:{}},plan:{title:'Fixture',mode:'legacy-verified',compositionJson:'{}',mappings:[],unsupported:[],rationale:'Fixture'},elementMap:{root:'1111111',carousel:'2222222',photo:'3333333'},sections:[],sectionIds:['1111111'],usedTypes:[],scopedCSS:[]};
  const image:TargetImageEvidence={url:'https://8.8.8.8/own.png',complete:false,naturalWidth:0,naturalHeight:0,rect:{x:800,y:100,width:200,height:200},objectFit:'contain',objectPosition:'50% 50%',alt:'Original'};
  const root:TargetElementEvidence={sourceId:'root',targetId:'1111111',selector:'[data-id="1111111"]',found:true,count:1,nativeElement:true,text:'',visible:true,rect:{x:0,y:100,width:600,height:400},style:{},images:[image]};
  const view:TargetViewportEvidence={name:'desktop',width:1000,height:800,url:'https://8.8.8.8/',title:'Fixture',pageHeight:2000,screenshotPath:'actual.png',evidencePath:'actual.json',elements:[root,{...root,sourceId:'carousel',targetId:'2222222',images:[],rect:{x:0,y:100,width:600,height:400}}],overflow:[],clipping:[],imageFailures:[{url:image.url,alt:image.alt}],consoleErrors:[],pageErrors:[],responseStatus:200};
  const receipt:FidelityPageStateReceipt={viewport:'desktop',documentWidth:1000,viewportWidth:1000,observations:[],carousels:[],hovers:[],unrequestedLazyRows:[{url:image.url,src:image.url,currentSrc:'',loading:'lazy',naturalWidth:0,naturalHeight:0,complete:false,rect:image.rect,outsideViewportHorizontal:false,outsideCarouselHorizontal:true,clone:true}]};
  assert.equal(normalizeFidelityMeasurements([view],program,compiled,[receipt])[0].imageFailures.length,0);
  assert.equal(view.imageFailures.length,1);
  root.images.push({...image,rect:{...image.rect,x:100}});assert.equal(normalizeFidelityMeasurements([view],program,compiled,[receipt])[0].imageFailures.length,1);
  root.images=[{...image,rect:{...image.rect,x:100,y:1700}}];assert.equal(normalizeFidelityMeasurements([view],program,compiled,[receipt])[0].imageFailures.length,1);
  assert.equal(normalizeFidelityMeasurements([view],program,compiled,[])[0].imageFailures.length,1);
});

test('native static horizontal scroll clipping needs a visible auto/scroll ancestor and normal document width, with source-equivalence gaps kept explicit',()=>{
  const program:NativeProgram={version:1,workflow:'block-replication',title:'Fixture',sourceUrl:'https://8.8.8.8/',sourceContract:{path:'c',sha256:'a'.repeat(64)},assetsManifest:{path:'a',sha256:'a'.repeat(64)},blocks:[],deviations:[],elements:[{key:'root',type:'container',settings:{},children:[{key:'scroller',type:'container',settings:{},children:[{key:'tile',type:'container',settings:{}}]}]}]};
  const compiled:CompiledFidelity={composition:{elements:[],pageSettings:{}},plan:{title:'Fixture',mode:'legacy-verified',compositionJson:'{}',mappings:[],unsupported:[],rationale:'Fixture'},elementMap:{root:'1111111',scroller:'2222222',tile:'3333333'},sections:[],sectionIds:['1111111'],usedTypes:[],scopedCSS:[]};
  const childRect={x:1200,y:100,width:200,height:200},view:TargetViewportEvidence={name:'mobile',width:390,height:844,url:'https://8.8.8.8/',title:'Fixture',pageHeight:2000,screenshotPath:'actual.png',evidencePath:'actual.json',elements:[],overflow:[{selector:'[data-id="3333333"]',rect:childRect}],clipping:[],imageFailures:[],consoleErrors:[],pageErrors:[],responseStatus:200};
  const receipt:FidelityPageStateReceipt={viewport:'mobile',documentWidth:390,viewportWidth:390,observations:[],carousels:[],hovers:[],horizontalScrollClips:[{elementKey:'tile',targetId:'3333333',ancestorId:'2222222',ancestorSelector:'[data-id="2222222"]',overflowX:'auto',ancestorRect:{x:0,y:100,width:380,height:200},childRect,scrollWidth:1600,clientWidth:380,documentWidth:390,viewportWidth:390,blockId:'pet-categories'}]};
  assert.equal(normalizeFidelityMeasurements([view],program,compiled,[receipt])[0].overflow.length,0);assert.equal(view.overflow.length,1);
  bindSourceScrollEvidence([receipt],[{evidenceId:'mobile-dom',evidencePath:'source-mobile.json',viewport:'mobile',blocks:[{id:'pet-categories',textAtoms:[],rootStyles:[{style:{'overflow-x':'visible'}}]}]}]);assert.equal(receipt.horizontalScrollClips![0].sourceStatus,'unverified');assert.match(receipt.horizontalScrollClips![0].sourceGap!,/no matching full ancestor/);
  bindSourceScrollEvidence([receipt],[{evidenceId:'mobile-dom',evidencePath:'source-mobile.json',viewport:'mobile',blocks:[{id:'pet-categories',textAtoms:[],rootStyles:[{style:{'overflow-x':'auto'}}]}]}]);assert.equal(receipt.horizontalScrollClips![0].sourceStatus,'observed');assert.equal(receipt.horizontalScrollClips![0].sourceEvidence![0],'source-mobile.json');
  receipt.horizontalScrollClips![0].overflowX='hidden';assert.equal(normalizeFidelityMeasurements([view],program,compiled,[receipt])[0].overflow.length,1);
  receipt.horizontalScrollClips![0].overflowX='auto';receipt.horizontalScrollClips![0].documentWidth=1600;assert.equal(normalizeFidelityMeasurements([view],program,compiled,[receipt])[0].overflow.length,1);
  receipt.horizontalScrollClips![0].documentWidth=390;receipt.horizontalScrollClips![0].ancestorRect.width=1500;assert.equal(normalizeFidelityMeasurements([view],program,compiled,[receipt])[0].overflow.length,1);
});

test('non-ID carousel leaves need same-capture mapped ancestry and exact clip boxes; unproved siblings and true document overflow remain errors',()=>{
  const program:NativeProgram={version:1,workflow:'block-replication',title:'Fixture',sourceUrl:'https://8.8.8.8/',sourceContract:{path:'c',sha256:'a'.repeat(64)},assetsManifest:{path:'a',sha256:'a'.repeat(64)},blocks:[],deviations:[],elements:[{key:'root',type:'container',settings:{},children:[{key:'carousel',type:'nested-carousel',settings:{},children:[]}]}]};
  const compiled:CompiledFidelity={composition:{elements:[],pageSettings:{}},plan:{title:'Fixture',mode:'legacy-verified',compositionJson:'{}',mappings:[],unsupported:[],rationale:'Fixture'},elementMap:{root:'1111111',carousel:'2222222'},sections:[],sectionIds:['1111111'],usedTypes:[],scopedCSS:[]};
  const child={x:600,y:50,width:200,height:100},selector='p.elementor-heading-title.elementor-size-default';
  const view:TargetViewportEvidence&{nativeCarouselClips:Array<{selector:string;childRect:typeof child;childDomPath:string;carouselId:string;widgetType:string;windowRect:typeof child;windowDomPath:string;overflowX:string;documentWidth:number;viewportWidth:number}>}={name:'mobile',width:390,height:844,url:'https://8.8.8.8/',title:'Fixture',pageHeight:1000,screenshotPath:'actual.png',evidencePath:'actual.json',elements:[],overflow:[{selector,rect:child},{selector,rect:{...child,y:200}}],clipping:[],imageFailures:[],consoleErrors:[],pageErrors:[],responseStatus:200,nativeCarouselClips:[{selector,childRect:child,childDomPath:'html > body > div > p',carouselId:'2222222',widgetType:'nested-carousel.default',windowRect:{x:10,y:50,width:370,height:100},windowDomPath:'html > body > div',overflowX:'hidden',documentWidth:390,viewportWidth:390}]};
  assert.equal(normalizeFidelityMeasurements([view],program,compiled)[0].overflow.length,1);assert.equal(view.overflow.length,2);
  view.nativeCarouselClips[0].documentWidth=600;assert.equal(normalizeFidelityMeasurements([view],program,compiled)[0].overflow.length,2);view.nativeCarouselClips[0].documentWidth=390;
  view.nativeCarouselClips[0].carouselId='9999999';assert.equal(normalizeFidelityMeasurements([view],program,compiled)[0].overflow.length,2);view.nativeCarouselClips[0].carouselId='2222222';
  view.nativeCarouselClips[0].childDomPath='html > body > aside > p';assert.equal(normalizeFidelityMeasurements([view],program,compiled)[0].overflow.length,2);
});

test('responsive native accordion titles substitute hidden desktop headings only with same-block exact setting and visible source plus actual leaf evidence',()=>{
  const state={status:'observed' as const,evidence:['source-dom']},none={status:'not-applicable' as const,evidence:[]};
  const contract:BlockContract={version:1,workflow:'block-replication',sourceUrl:'https://8.8.8.8/',capturedAt:'2026-10-13T05:00:00Z',referenceReport:{path:'reference/report.json',sha256:'a'.repeat(64)},evidence:[{id:'source-dom',path:'source.json',sha256:'a'.repeat(64),kind:'dom'}],tolerances:{geometryPx:20,geometryRatio:.1,colorChannel:4},limitations:[],blocks:[{id:'footer',role:'footer',presentation:'static',texts:[{id:'shop',text:'Shop',kind:'heading'}],assets:[],evidence:['source-dom'],geometry:{mobile:{width:390,height:100}},colors:{},states:{normal:state,hover:none,interaction:none}}]};
  const program:NativeProgram={version:1,workflow:'block-replication',title:'Fixture',sourceUrl:contract.sourceUrl,sourceContract:{path:'c',sha256:'a'.repeat(64)},assetsManifest:{path:'a',sha256:'a'.repeat(64)},deviations:[],elements:[{key:'footer-root',type:'container',settings:{},children:[{key:'desktop-title',type:'heading',settings:{title:'Shop'}},{key:'responsive-accordion',type:'nested-accordion',settings:{items:[{item_title:'Shop'}]},children:[]}]}],blocks:[{sourceBlockId:'footer',rootKey:'footer-root',presentation:'static',bindings:[{sourceTextId:'shop',elementKey:'desktop-title',settingPath:'title'}],states:contract.blocks[0].states}]};
  const compiled:CompiledFidelity={composition:{elements:[],pageSettings:{}},plan:{title:'Fixture',mode:'legacy-verified',compositionJson:'{}',mappings:[],unsupported:[],rationale:'Fixture'},elementMap:{'footer-root':'1111111','desktop-title':'2222222','responsive-accordion':'3333333'},sections:[],sectionIds:['1111111'],usedTypes:[],scopedCSS:[]};
  const schemas:Record<string,LegacySchema>={'nested-accordion':{type:'nested-accordion',class:'NestedAccordion',controls:{},nativeChildren:{childType:'container',repeaterKey:'items',titleSettingKey:'item_title',baseClass:'NestedBase',sourceSha256:'a'.repeat(64)}}};
  const alternatives=responsiveTextBindings(contract,program,compiled,schemas);assert.equal(alternatives.length,1);assert.match(alternatives[0].selector!,/e-n-accordion-item-title-text/);
  const original:TargetElementEvidence={sourceId:'desktop-title',targetId:'2222222',selector:'[data-id="2222222"]',found:true,count:1,nativeElement:true,text:'Shop',visible:false,rect:{x:0,y:0,width:0,height:0},style:{color:'#111'},images:[]},leaf={...original,sourceId:alternatives[0].measurementKey,targetId:'3333333',selector:alternatives[0].selector!,visible:true,rect:{x:0,y:50,width:300,height:40},style:{color:'#6e6259'}};
  const view:TargetViewportEvidence={name:'mobile',width:390,height:844,url:contract.sourceUrl,title:'Fixture',pageHeight:1000,screenshotPath:'actual.png',evidencePath:'actual.json',elements:[original,leaf],overflow:[],clipping:[],imageFailures:[],consoleErrors:[],pageErrors:[],responseStatus:200};
  const packets=[{evidenceId:'source-dom',evidencePath:'source.json',viewport:'mobile',blocks:[{id:'footer',textAtoms:[{text:'Shop',visible:true,rect:{width:300,height:40},style:{color:'#6e6259'}}]}]}];
  let result=resolveResponsiveTextMeasurements([view],alternatives,packets,contract);assert.equal(result.receipts.length,1);assert.equal(result.measurements[0].elements[0].sourceId,'desktop-title');assert.equal(result.measurements[0].elements[0].targetId,'3333333');assert.equal(view.elements[0].visible,false);
  packets[0].blocks[0].textAtoms[0].visible=false;packets[0].blocks[0].textAtoms[0].rect={width:0,height:0};assert.equal(resolveResponsiveTextMeasurements([view],alternatives,packets,contract).receipts.length,0);
  packets[0].blocks[0].textAtoms[0].visible=true;packets[0].blocks[0].textAtoms[0].rect={width:300,height:40};leaf.text='Changed Shop';assert.equal(resolveResponsiveTextMeasurements([view],alternatives,packets,contract).receipts.length,0);
  leaf.text='Shop';leaf.nativeElement=false;assert.equal(resolveResponsiveTextMeasurements([view],alternatives,packets,contract).receipts.length,0);
  program.elements[0].children!.push({key:'responsive-desktop-title',type:'heading',settings:{title:'Shop'}});compiled.elementMap['responsive-desktop-title']='4444444';leaf.nativeElement=true;leaf.found=false;const copy={...leaf,found:true,sourceId:'responsive-desktop-title',targetId:'4444444',count:2};view.elements.push(copy);
  const copies=responsiveTextBindings(contract,program,compiled,schemas);assert.equal(resolveProvenResponsiveTextMeasurements([view],program,compiled,[],copies,packets,contract).receipts.length,0);
  const cloneReceipt:FidelityPageStateReceipt={viewport:'mobile',documentWidth:390,viewportWidth:390,observations:[],carousels:[],hovers:[],aliases:[{elementKey:copy.sourceId,targetId:copy.targetId,rawCount:2,logicalCount:1,cloneCount:1,cloneKinds:['swiper-slide-duplicate']}]};
  assert.equal(resolveProvenResponsiveTextMeasurements([view],program,compiled,[cloneReceipt],copies,packets,contract).receipts.length,1);assert.equal(view.elements[2].count,2);
  cloneReceipt.aliases![0].rawCount=3;assert.equal(resolveProvenResponsiveTextMeasurements([view],program,compiled,[cloneReceipt],copies,packets,contract).receipts.length,0);
  program.elements[0].children!.pop();program.elements[0].children![1].settings.items=[{item_title:'New creative heading'}];assert.equal(responsiveTextBindings(contract,program,compiled,schemas).length,0);
});

test('background photos need registered native media, exact compiled attachment identity and this canonical container own actual CSS URL',()=>{
  const url='https://8.8.8.8/uploads/original.png',asset={key:'photo',attachmentId:12,url,sha256:'a'.repeat(64),sourceUrl:'https://8.8.8.8/source.png',mimeType:'image/png',localPath:'photo.png'};
  const program:NativeProgram={version:1,workflow:'block-replication',title:'Fixture',sourceUrl:'https://8.8.8.8/',sourceContract:{path:'c',sha256:'a'.repeat(64)},assetsManifest:{path:'a',sha256:'a'.repeat(64)},blocks:[],deviations:[],elements:[{key:'photo-root',type:'container',settings:{background_image:{$asset:'photo'}},children:[]}]};
  const compiled:CompiledFidelity={composition:{elements:[{id:'1111111',elType:'container',settings:{background_image:{id:12,url}},elements:[]}],pageSettings:{}},plan:{title:'Fixture',mode:'legacy-verified',compositionJson:'{}',mappings:[],unsupported:[],rationale:'Fixture'},elementMap:{'photo-root':'1111111'},sections:[],sectionIds:['1111111'],usedTypes:[],scopedCSS:[]};
  const schemas:Record<string,LegacySchema>={container:{type:'container',class:'Container',controls:{background_image:{type:'media',default:{url:'',id:''}}}}};
  const target:TargetElementEvidence={sourceId:'photo-root',targetId:'1111111',selector:'[data-id="1111111"]',found:true,count:1,nativeElement:true,text:'',visible:true,rect:{x:0,y:0,width:300,height:200},style:{'background-image':`url("${url}")`},images:[],media:[{origin:'background',url}]};
  const view:TargetViewportEvidence={name:'desktop',width:1440,height:1000,url:'https://8.8.8.8/',title:'Fixture',pageHeight:1000,screenshotPath:'actual.png',evidencePath:'actual.json',elements:[target],overflow:[],clipping:[],imageFailures:[],consoleErrors:[],pageErrors:[],responseStatus:200};
  assert.equal(verifyNativeBackgroundMedia(program,compiled,schemas,[asset],[view]).passed,true);
  target.style['background-image']='none';assert.equal(verifyNativeBackgroundMedia(program,compiled,schemas,[asset],[view]).passed,false);
  target.style['background-image']=`url("${url}")`;target.count=2;assert.equal(verifyNativeBackgroundMedia(program,compiled,schemas,[asset],[view]).passed,false);
  target.count=1;compiled.composition.elements[0].settings.background_image={id:99,url};assert.equal(verifyNativeBackgroundMedia(program,compiled,schemas,[asset],[view]).passed,false);
  compiled.composition.elements[0].settings.background_image={id:12,url};schemas.container.controls.background_image.type='text';assert.equal(verifyNativeBackgroundMedia(program,compiled,schemas,[asset],[view]).passed,false);
});

test('native repeater title selectors measure visible labels across optimized wrappers rather than hidden submenu headings',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),program:NativeProgram={version:1,workflow:'block-replication',title:'Fixture',sourceUrl:'https://8.8.8.8/',sourceContract:{path:'c',sha256:'a'.repeat(64)},assetsManifest:{path:'a',sha256:'a'.repeat(64)},elements:[{key:'menu',type:'mega-menu',settings:{menu_items:[{item_title:'Shop'}]}}],blocks:[{sourceBlockId:'header',rootKey:'menu',presentation:'navigation',bindings:[{sourceTextId:'shop',elementKey:'menu',settingPath:'menu_items.0.item_title'}],states:{normal:{status:'observed',evidence:[]},hover:{status:'not-applicable',evidence:[]},interaction:{status:'not-applicable',evidence:[]}}}],deviations:[]};
    const compiled:CompiledFidelity={composition:{elements:[],pageSettings:{}},plan:{title:'Fixture',mode:'legacy-verified',compositionJson:'{}',mappings:[],unsupported:[],rationale:'Fixture'},elementMap:{menu:'1111111'},sections:[],sectionIds:[],usedTypes:[],scopedCSS:[]};
    const schemas:Record<string,LegacySchema>={'mega-menu':{type:'mega-menu',class:'MegaMenu',controls:{},nativeChildren:{childType:'container',repeaterKey:'menu_items',titleSettingKey:'item_title',baseClass:'NestedBase',sourceSha256:'a'.repeat(64)}}};
    const selector=nativeBoundTitleSelector(program,compiled,schemas,program.elements[0])!;
    for(const optimized of [false,true]){
      const menu='<div class="e-n-menu"><div class="e-n-menu-wrapper"><ul class="e-n-menu-heading"><li class="e-n-menu-item"><div class="e-n-menu-title"><span class="e-n-menu-title-text" style="color:rgb(0,71,210)">Shop</span></div><div style="display:none"><h3 style="color:white">Dog</h3></div></li></ul></div></div>';
      await page.setContent(`<div class="elementor" data-id="1111111">${optimized?menu:`<div class="elementor-widget-container">${menu}</div>`}</div>`);
      assert.equal(await page.locator(selector).count(),1);assert.equal(await page.locator(selector).innerText(),'Shop');assert.equal(await page.locator(selector).evaluate(element=>getComputedStyle(element).color),'rgb(0, 71, 210)');
    }
  }finally{await browser.close();}
});
