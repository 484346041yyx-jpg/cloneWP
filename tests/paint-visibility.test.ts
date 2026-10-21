import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { collectTargetPresentationEvidence } from '../src/fidelity/presentation-browser.js';
import { captureTarget } from '../src/verification/capture-target.js';
import type { BlockContract, NativeProgram } from '../src/fidelity/types.js';

const sourceExpression = await readFile(new URL('../src/reference/collect-blocks.browser.js', import.meta.url), 'utf8');
const items = [
  ['summary', '2222222', true], ['closed-body', '3333333', false],
  ['second-summary', '4444444', false], ['nested-summary', '5555555', false],
  ['hidden-content', '6666666', false], ['hidden-child', '7777777', false],
  ['auto-content', '8888888', true], ['outside', '9999999', true],
] as const;
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0}summary span,.body,p{display:block;width:180px;min-height:24px;margin:0}.body{position:absolute;left:0;top:100px;width:900px}.hidden-content{content-visibility:hidden;width:180px;height:32px}.auto-content{content-visibility:auto;margin-top:900px;width:180px;height:32px}
</style><main class="elementor" data-elementor-type="wp-page"><section data-id="1111111" data-element_type="container">
<details id="accordion"><summary><span id="summary" data-id="2222222" data-element_type="widget">Visible summary</span></summary>
<div class="body"><p id="closed-body" data-id="3333333" data-element_type="widget">Closed body content</p><details open><summary><span id="nested-summary" data-id="5555555" data-element_type="widget">Nested hidden summary</span></summary></details></div>
<summary><span id="second-summary" data-id="4444444" data-element_type="widget">Second hidden summary</span></summary></details>
<div class="hidden-content" id="hidden-content" data-id="6666666" data-element_type="widget">Skipped content own<p id="hidden-child" data-id="7777777" data-element_type="widget">Skipped content child</p></div>
<p id="outside" data-id="9999999" data-element_type="widget">Visible outside</p><p class="auto-content" id="auto-content" data-id="8888888" data-element_type="widget">Offscreen auto content</p>
</section></main>`;

test('closed details bodies and content-visibility hidden cannot become painted source or native presentation from retained layout boxes', async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{width:390,height:844} });
  try {
    await page.setContent(html); await page.evaluate('globalThis.__name=target=>target');
    const regions=items.map(([id])=>({id,sourceNodeId:`#${id}`,evidence:['source'],rect:{x:0,y:0,width:180,height:24},visible:true}));
    const contract={blocks:[{id:'section',presentationDetails:{version:1,viewports:{mobile:{status:'observed',width:390,evidence:['source'],regions,controlGroups:[],media:[],relations:[]}}}}]} as unknown as BlockContract;
    const program={blocks:[{sourceBlockId:'section',rootKey:'root',presentationBindings:items.map(([id])=>({id,elementKey:id}))}]} as unknown as NativeProgram;
    const options={page,contract,program,compiled:{elementMap:{root:'1111111',...Object.fromEntries(items.map(([id,nativeId])=>[id,nativeId]))}},viewport:'mobile',evidencePath:'actual.json'};
    const inspect=async()=>{
      const source=await page.evaluate(`(${sourceExpression})({includeNodes:false})`) as any;
      const target=new Map((await collectTargetPresentationEvidence(options)).map(row=>[row.id,row]));
      const atoms=source.blocks.flatMap((block:any)=>block.textAtoms);
      return {target,atoms};
    };
    const closed=await inspect();
    for(const[id,,visible]of items){
      assert.equal(closed.target.get(id)?.visible,visible,`native ${id}`);
      const atom=closed.atoms.find((atom:any)=>atom.selector===`#${id}`);
      assert.ok(atom,`raw source ${id} retained`);assert.equal(atom.visible,visible,`source ${id}`);assert.equal(atom.lineLayout.visibility.painted,visible,`source paint ${id}`);
    }
    assert.ok(closed.target.get('closed-body')!.rect!.width>0,'closed content retains raw layout geometry; it cannot prove paint');
    assert.ok(closed.target.get('auto-content')!.rect!.y>844,'offscreen auto stays observable instead of being treated as hidden');
    await page.locator('#accordion').evaluate(element=>element.setAttribute('open',''));
    const opened=await inspect();
    for(const id of ['summary','closed-body','nested-summary','second-summary']){
      assert.equal(opened.target.get(id)?.visible,true,`opened native ${id}`);
      assert.equal(opened.atoms.find((atom:any)=>atom.selector===`#${id}`)?.visible,true,`opened source ${id}`);
    }
    assert.equal(opened.target.get('hidden-child')?.visible,false);
    await page.setContent('<!doctype html><main><section id="skipped-root" style="content-visibility:hidden;width:180px;height:32px;background:rgb(1,2,3)">Skipped own content</section></main>');
    const retained=await page.evaluate(`(${sourceExpression})({includeNodes:false})`) as any;
    assert.equal(retained.blocks.length,1,'a skipped-content source block still owns a real principal box');
    assert.equal(retained.blocks[0].candidateReason,'visible-layout-box-without-text');
    assert.equal(retained.blocks[0].rect.width,180);assert.equal(retained.blocks[0].style['background-color'],'rgb(1, 2, 3)');
    assert.equal(retained.blocks[0].style['content-visibility'],'hidden');assert.equal(retained.blocks[0].textAtoms[0].visible,false);
  } finally { await browser.close(); }
});

test('core target capture retains visible summary and auto content while excluding closed accordion contents from visibility and overflow', async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'clonewp-paint-visibility-'));
  const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end(html);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');
  try {
    const result=await captureTarget({previewUrl:`http://127.0.0.1:${address.port}/owned/`,runDir:directory,viewports:[{name:'mobile',width:390,height:844}],elementMap:items.map(([sourceId,targetId])=>({sourceId,targetId,kind:'text'})),inspectPage:async page=>{await page.locator('#hidden-content').evaluate(element=>(element as HTMLElement).style.width='900px');}});
    for(const[id,,visible]of items){const row=result[0].elements.find(row=>row.sourceId===id);assert.ok(row?.found,`core raw ${id}`);assert.equal(row.visible,visible,`core ${id}`);}
    assert.deepEqual(result[0].overflow.map(item=>item.selector),['[data-id="6666666"]'],'closed descendants cannot manufacture overflow, but a skipped-content element still owns its real 900px principal box');
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});}
});
