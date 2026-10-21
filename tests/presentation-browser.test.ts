import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import { collectTargetPresentationEvidence } from '../src/fidelity/presentation-browser.js';
import { observeLoadedReferenceWidths } from '../src/reference/capture.js';
import type { BlockContract, NativeProgram } from '../src/fidelity/types.js';

let browser: Browser;
const expression = await readFile(new URL('../src/reference/collect-blocks.browser.js', import.meta.url), 'utf8');
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser.close(); });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="green"/></svg>';
const arrow = '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M8 2L4 6L8 10" fill="none" stroke="blue"/></svg>';
const documentHTML = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0}.strip{display:flex;align-items:center;gap:20px}.pd-carousel{width:220px;height:40px;overflow:hidden}.slick-track{display:flex}.slick-slide{min-width:220px}.controls{display:flex;align-items:center;gap:8px}button{width:30px;height:30px}.copy{width:120px;font:16px/20px Arial}.portrait{width:80px;height:120px}picture img{width:80px;height:40px} .clipped{width:60px;height:20px;overflow:hidden}.hidden{display:none}
</style><main><section id="campaign"><div class="strip"><div id="ticker" class="pd-carousel"><div class="slick-track"><div class="slick-slide">Offer one</div><div class="slick-slide">Offer two</div></div></div><div class="controls"><button class="slick-prev" aria-controls="ticker" aria-label="Previous">${arrow}</button><span>1 / 2</span><button class="slick-next" aria-controls="ticker" aria-label="Next">${arrow}</button></div><a id="book" href="/services">Book Services</a></div><p class="copy">Several words that must wrap into multiple lines</p><picture><source media="(max-width:400px)" srcset="https://fixture.example/mobile.svg"><img src="https://fixture.example/desktop.svg" alt="Responsive campaign"></picture><div class="clipped"><span style="display:block;width:150px">Clipped evidence</span></div></section></main>`;

test('source presentation keeps sibling controls and their fraction together without absorbing an unrelated service action', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
    await page.setContent(documentHTML); await page.waitForLoadState('load');
    const result = await page.evaluate(`(${expression})({includeNodes:false})`) as any;
    const block = result.blocks[0], observation = block.presentationObservation;
    const group = observation.controlGroups.find((group: any) => group.controls.some((control: any) => control.role === 'fraction'));
    assert.ok(group, 'fraction mounted beside carousel must be retained');
    assert.deepEqual(group.controls.map((control: any) => control.role), ['previous','next','fraction']);
    assert.equal(group.pagination, 'fraction'); assert.equal(group.layout,'row');
    assert.ok(group.controls.every((control: any) => !control.text.includes('Book Services')));
    assert.equal(group.controls.find((control: any) => control.role === 'previous').glyph.kind, 'svg');
    assert.ok(observation.ownership.some((owner: any) => owner.kind === 'aria-controls'));
    assert.ok(observation.regions.some((region: any) => region.sourceNodeId === '#book'));
    assert.ok(block.textAtoms.find((atom: any) => atom.text.startsWith('Several words')).lineLayout.lineCount > 1);
    const responsive = observation.media.find((media: any) => media.actualImage.alt === 'Responsive campaign');
    assert.match(responsive.actualImage.currentSrc, /mobile\.svg$/); assert.equal(responsive.actualImage.pictureSources[0].matches,true);
    assert.ok(observation.regions.some((region: any) => region.maxClippedRatio > 0 && region.maxClippedRatio < 1));
  } finally { await page.close(); }
});

test('lightweight responsive width evidence restores the original viewport and observes art direction without navigation', async () => {
  const page = await browser.newPage({ viewport: { width: 600, height: 844 } });
  try {
    let documentRequests = 0;
    await page.route('https://fixture.example/**', route => { if (route.request().isNavigationRequest()) documentRequests++; return route.fulfill({ contentType: 'image/svg+xml', body: svg }); });
    await page.setContent(documentHTML); await page.waitForLoadState('load');
    const results = await observeLoadedReferenceWidths(page,[360,430,360]);
    assert.deepEqual(results.map(row => row.requestedWidth),[360,430]); assert.equal(documentRequests,0); assert.equal(page.viewportSize()?.width,600);
    assert.equal(results[0].facts.innerWidth,360); assert.equal(results[1].facts.innerWidth,430);
    await assert.rejects(observeLoadedReferenceWidths(page,[NaN]),/integer widths/);
    await assert.rejects(observeLoadedReferenceWidths(page,Array(9).fill(360)),/at most eight/);
  } finally { await page.close(); }
});

test('native presentation probes measure actual relative geometry, clipping, fractions and visibility, and reject foreign or ambiguous owners', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.setContent(`<!doctype html><style>body{margin:0}.root{margin-top:150px;position:relative}.controls{display:flex;align-items:center;width:160px;gap:10px}.controls button{width:30px;height:30px}.hidden{display:none}.clip{width:50px;overflow:hidden}.wide{width:100px;height:20px}</style><div class="root" data-id="root-001" data-element_type="container"><div class="controls" data-id="group-001" data-element_type="widget"><button class="prev" disabled>${arrow}</button><span class="swiper-pagination-fraction">1 / 6</span><button class="next">${arrow}</button></div><div data-id="text-001" data-element_type="widget" class="hidden">Mobile hidden</div><div class="clip" data-id="clip-001" data-element_type="widget"><div class="wide">Overflow</div></div></div><div data-id="foreign-001" data-element_type="widget">Foreign</div>`);
    await page.evaluate('globalThis.__name = target => target');
    const region = (id: string) => ({ id,sourceNodeId:id,evidence:['source'],rect:{x:0,y:0,width:1,height:1},visible:true });
    const contract = { blocks:[{ id:'campaign',presentationDetails:{version:1,viewports:{mobile:{status:'observed',width:390,evidence:['source'],regions:[region('hidden'),region('clipped'),region('foreign'),region('ambiguous')],controlGroups:[{...region('controls'),ownerId:'hidden',layout:'row',pagination:'fraction',controls:[{...region('previous'),role:'previous'},{...region('fraction'),role:'fraction'}]}],media:[],relations:[]}}}}] } as unknown as BlockContract;
    const program = { blocks:[{sourceBlockId:'campaign',rootKey:'root',presentationBindings:[{id:'controls',elementKey:'group'},{id:'previous',elementKey:'group',relativeSelector:'.prev'},{id:'fraction',elementKey:'group',relativeSelector:'.swiper-pagination-fraction'},{id:'hidden',elementKey:'text'},{id:'clipped',elementKey:'clip',relativeSelector:'.wide'},{id:'foreign',elementKey:'foreign'},{id:'ambiguous',elementKey:'group',relativeSelector:'button'}]}] } as unknown as NativeProgram;
    const result = await collectTargetPresentationEvidence({page,contract,program,compiled:{elementMap:{root:'root-001',group:'group-001',text:'text-001',clip:'clip-001',foreign:'foreign-001'}},viewport:'mobile',evidencePath:'actual-browser.json'});
    const rows = new Map(result.map(row => [row.id,row]));
    assert.equal(rows.get('controls')?.rect?.y,0, 'block-relative geometry must ignore document top offsets');
    assert.equal(rows.get('controls')?.pagination,'fraction'); assert.equal(rows.get('controls')?.layout,'row');
    assert.equal(rows.get('previous')?.disabled,true); assert.equal(rows.get('previous')?.glyph?.kind,'svg');
    assert.equal(rows.get('hidden')?.visible,false); assert.equal(rows.get('clipped')?.clippedRatio,.5);
    assert.equal(rows.get('foreign')?.found,false); assert.equal(rows.get('ambiguous')?.count,2); assert.equal(rows.get('ambiguous')?.found,false);
    assert.equal(rows.get('fraction')?.text,'1 / 6'); assert.equal(rows.get('fraction')?.viewportWidth,390);
  } finally { await page.close(); }
});

test('media identity comes from the actual rendered URL and imported bytes, so an equally sized desktop image cannot impersonate mobile artwork', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.route('https://fixture.example/**', route => route.fulfill({ contentType:'image/svg+xml',body:svg }));
    await page.setContent('<!doctype html><style>body{margin:0}img{width:160px;height:80px}</style><div data-id="root-001" data-element_type="container"><div data-id="media-001" data-element_type="widget"><img src="https://fixture.example/desktop.svg"></div></div>');
    await page.waitForLoadState('load'); await page.evaluate('globalThis.__name=target=>target');
    const contract = { blocks:[{id:'banner',presentationDetails:{version:1,viewports:{mobile:{status:'observed',width:390,evidence:['source'],regions:[],controlGroups:[],relations:[],media:[{id:'artwork',sourceNodeId:'source-img',evidence:['source'],rect:{x:0,y:0,width:160,height:80},visible:true,mode:'image',assetKey:'mobile-artwork',sourceURL:'https://source.example/mobile.svg'}]}}}}] } as unknown as BlockContract;
    const program = {blocks:[{sourceBlockId:'banner',rootKey:'root',presentationBindings:[{id:'artwork',elementKey:'image',relativeSelector:'img'}]}]} as unknown as NativeProgram;
    const assets = ['desktop','mobile'].map((version,index)=>({key:`${version}-artwork`,attachmentId:100+index,url:`https://fixture.example/${version}.svg`,sourceUrl:`https://source.example/${version}.svg`,sha256:String(index+1).repeat(64),mimeType:'image/svg+xml'}));
    const options={page,contract,program,compiled:{elementMap:{root:'root-001',image:'media-001'}},viewport:'mobile',evidencePath:'actual-browser.json',assets};
    const first=(await collectTargetPresentationEvidence(options))[0];
    assert.equal(first.aspectRatio,2); assert.equal(first.assetKey,'desktop-artwork'); assert.equal(first.sourceURL,'https://source.example/desktop.svg'); assert.equal(first.attachmentId,100);
    await page.locator('img').evaluate(image => { if (!(image instanceof HTMLImageElement)) throw new Error('Expected a real image'); image.src='https://fixture.example/mobile.svg'; });
    await page.locator('img').evaluate(async image=>{if (!(image instanceof HTMLImageElement)) throw new Error('Expected a real image'); await image.decode();});
    const second=(await collectTargetPresentationEvidence(options))[0];
    assert.equal(second.aspectRatio,2); assert.equal(second.assetKey,'mobile-artwork'); assert.equal(second.mediaSha256,'2'.repeat(64));
    const unproven=(await collectTargetPresentationEvidence({...options,assets:[]}))[0];
    assert.equal(unproven.assetKey,undefined, 'missing provenance must not be filled from source contract');
  } finally { await page.close(); }
});

test('visual control absence is searched inside one real native owner and never inferred from an absent component', async () => {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  try {
    await page.setContent('<!doctype html><style>.hidden{display:none}</style><div data-id="root-001" data-element_type="container"><div data-id="owner-001" data-element_type="widget"><div class="window">Actual product window</div><div class="wd-nav-arrows hidden"><button class="wd-prev">Previous</button><button class="wd-next">Next</button></div></div></div>');
    await page.evaluate('globalThis.__name=target=>target');
    const group={id:'controls',sourceNodeId:'source-component',evidence:['source'],rect:{x:0,y:0,width:100,height:100},visible:true,ownerId:'region',layout:'separate',pagination:'none',controls:[],absentControls:['previous','next','dot','fraction']};
    const contract={blocks:[{id:'section',presentationDetails:{version:1,viewports:{mobile:{status:'observed',width:390,evidence:['source'],regions:[],controlGroups:[group],media:[],relations:[]}}}}]} as unknown as BlockContract;
    const program={blocks:[{sourceBlockId:'section',rootKey:'root',presentationBindings:[{id:'controls',elementKey:'owner',relativeSelector:'.window'}]}]} as unknown as NativeProgram;
    const options={page,contract,program,compiled:{elementMap:{root:'root-001',owner:'owner-001'}},viewport:'mobile',evidencePath:'actual.json'};
    let row=(await collectTargetPresentationEvidence(options))[0];
    assert.equal(row.found,true); assert.equal(row.controlAbsence?.ownerCount,1); assert.ok(row.controlAbsence!.checked.every(check=>check.visible===0)); assert.equal(row.controlAbsence?.checked.find(check=>check.role==='previous')?.matched,1);
    await page.locator('.hidden').evaluate(element=>element.classList.remove('hidden'));
    row=(await collectTargetPresentationEvidence(options))[0]; assert.equal(row.controlAbsence?.checked.find(check=>check.role==='next')?.visible,1);
    await page.locator('[data-id="owner-001"]').evaluate(element=>element.remove());
    row=(await collectTargetPresentationEvidence(options))[0]; assert.equal(row.found,false); assert.equal(row.controlAbsence,undefined);
  }finally{await page.close();}
});

test('percentage corner radius is measured in rendered pixels rather than treating its token as pixels', async () => {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  try {
    await page.setContent('<!doctype html><style>body{margin:0}.dot{width:12px;height:12px;border-radius:50%}.pill{width:20px;height:10px;border-radius:50%}.fixed{width:12px;height:12px;border-radius:6px}</style><main><section><div data-id="root-001" data-element_type="container"><div id="dot" class="dot" data-id="dot-001" data-element_type="widget">.</div><div id="pill" class="pill" data-id="pill-001" data-element_type="widget">.</div><div id="fixed" class="fixed" data-id="fixed-001" data-element_type="widget">.</div></div></section></main>');
    await page.evaluate('globalThis.__name=target=>target');
    const regions=['dot','pill','fixed'].map(id=>({id,sourceNodeId:id,evidence:['source'],rect:{x:0,y:0,width:12,height:12},visible:true}));
    const contract={blocks:[{id:'section',presentationDetails:{version:1,viewports:{mobile:{status:'observed',width:390,evidence:['source'],regions,controlGroups:[],media:[],relations:[]}}}}]} as unknown as BlockContract;
    const program={blocks:[{sourceBlockId:'section',rootKey:'root',presentationBindings:regions.map(({id})=>({id,elementKey:id}))}]} as unknown as NativeProgram;
    const rows=await collectTargetPresentationEvidence({page,contract,program,compiled:{elementMap:{root:'root-001',dot:'dot-001',pill:'pill-001',fixed:'fixed-001'}},viewport:'mobile',evidencePath:'actual.json'});
    assert.deepEqual(rows.map(row=>row.paint?.borderRadius),[6,5,6]);
    const source=await page.evaluate(`(${expression})({includeNodes:false})`) as any;
    const observations=source.blocks.flatMap((block:any)=>block.presentationObservation.regions);
    const sourceRadii=['#dot','#pill','#fixed'].map(selector=>observations.find((region:any)=>region.sourceNodeId===selector)?.paint.borderRadius);
    assert.deepEqual(sourceRadii,[6,5,6], 'Source and target use the same geometry-based percentage radius conversion');
    assert.equal(await page.locator('#dot').evaluate(element=>getComputedStyle(element).borderTopLeftRadius),'50%', 'Raw source CSS is retained rather than rewritten');
  }finally{await page.close();}
});

test('bound native fraction siblings count within their same widget, never a neighbouring widget',async()=>{
 const page=await browser.newPage();try{
 await page.evaluate('globalThis.__name=target=>target');
 await page.setContent('<style>.wd-nav-pagin{height:24px;width:86px}.wd-nav-pagin::after{content:counter(clonewp-page-current) " / " counter(clonewp-page-total)}</style><section data-id="root-001" data-element_type="container"><div data-id="query-001" data-element_type="widget"><div class="wd-nav-arrows"><button class="wd-prev">Previous</button><button class="wd-next">Next</button></div><div class="wd-nav-pagin"></div></div><div data-id="foreign-001" data-element_type="widget"><div class="wd-nav-pagin"></div></div></section>');
 const rect={x:0,y:0,width:86,height:24},group={id:'controls',sourceNodeId:'#source-controls',rect,visible:true,evidence:['source'],ownerId:'component',layout:'row',pagination:'fraction',controls:[{id:'fraction',sourceNodeId:'#source-fraction',rect,visible:true,evidence:['source'],role:'fraction'}]},contract={blocks:[{id:'b',presentationDetails:{viewports:{desktop:{regions:[],media:[],controlGroups:[group]}}}}]} as unknown as BlockContract,program={elements:[],blocks:[{sourceBlockId:'b',rootKey:'root',presentationBindings:[{id:'controls',elementKey:'query',relativeSelector:'.wd-nav-arrows'},{id:'fraction',elementKey:'query',relativeSelector:'.wd-nav-pagin'}]}]} as unknown as NativeProgram,compiled={elementMap:{root:'root-001',query:'query-001',foreign:'foreign-001'}};
 let rows=await collectTargetPresentationEvidence({page,contract,program,compiled,viewport:'desktop',evidencePath:'native-browser.json'});assert.equal(rows.find(row=>row.id==='controls')?.pagination,'fraction');assert.equal(rows.find(row=>row.id==='controls')?.controlInventory?.find(row=>row.role==='fraction')?.visible,1);
 program.blocks[0].presentationBindings![1].elementKey='foreign';rows=await collectTargetPresentationEvidence({page,contract,program,compiled,viewport:'desktop',evidencePath:'native-browser.json'});assert.equal(rows.find(row=>row.id==='controls')?.pagination,'none');
 }finally{await page.close();}
});
