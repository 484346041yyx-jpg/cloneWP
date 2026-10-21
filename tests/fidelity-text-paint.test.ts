import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm}from'node:fs/promises';
import path from'node:path';import os from'node:os';
import {writeJson}from'../src/core/files.js';import{sha256}from'../src/fidelity/check.js';
import{compareBoundTextPaint,loadSourceTextPaint,reconstructSourceTextOwners,provenSourceResponsiveVariants,type SourceTextPaintPacket}from'../src/fidelity/text-paint.js';
import type{BlockContract,NativeProgram}from'../src/fidelity/types.js';import type{TargetViewportEvidence,TargetElementEvidence}from'../src/verification/types.js';
function fixture(){
  const state={status:'observed' as const,evidence:['desktop-dom']},none={status:'not-applicable' as const,evidence:[]};
  const contract:BlockContract={version:1,workflow:'block-replication',sourceUrl:'https://8.8.8.8/',capturedAt:'2026-10-13T05:00:00Z',referenceReport:{path:'reference/report.json',sha256:'a'.repeat(64)},evidence:[{id:'desktop-dom',path:'reference/desktop.json',sha256:'a'.repeat(64),kind:'dom'}],tolerances:{geometryPx:30,geometryRatio:.1,colorChannel:4},blocks:[{id:'products',role:'products',presentation:'static',texts:[{id:'product-heading',text:'Original source heading',kind:'heading'}],assets:[],evidence:['desktop-dom'],geometry:{desktop:{width:1000,height:200}},colors:{background:'#fff'},states:{normal:state,hover:none,interaction:none}}],limitations:[]};
  const program:NativeProgram={version:1,workflow:'block-replication',sourceUrl:contract.sourceUrl,title:'Owned draft',sourceContract:{path:'block-contract.json',sha256:'a'.repeat(64)},assetsManifest:{path:'asset-manifest.json',sha256:'a'.repeat(64)},elements:[{key:'products-root',type:'container',settings:{},children:[{key:'heading',type:'heading',settings:{title:'Original source heading'}}]}],blocks:[{sourceBlockId:'products',rootKey:'products-root',presentation:'static',bindings:[{sourceTextId:'product-heading',elementKey:'heading',settingPath:'title'}],states:contract.blocks[0].states}],deviations:[]};
  const packets:SourceTextPaintPacket[]=[{evidenceId:'desktop-dom',evidencePath:'source-dom.json',viewport:'desktop',blocks:[{id:'products',textAtoms:[{text:'Original source heading',fullElementText:'Original source heading',selector:'h2',visible:true,rect:{width:500,height:40},style:{color:'rgb(65, 116, 141)'}}]}]}];
  const element:TargetElementEvidence={sourceId:'heading',targetId:'abcdef1',selector:'[data-id="abcdef1"]',found:true,count:1,nativeElement:true,text:'Original source heading',visible:true,rect:{x:0,y:0,width:500,height:40},style:{color:'rgb(65, 116, 141)'},images:[]};
  const target:TargetViewportEvidence={name:'desktop',width:1440,height:1000,url:'https://8.8.8.8/?page_id=11',title:'Owned draft',pageHeight:200,screenshotPath:'actual.png',evidencePath:'actual.json',elements:[element],overflow:[],clipping:[],imageFailures:[],consoleErrors:[],pageErrors:[],responseStatus:200};
  return{contract,program,packets,target};
}
test('each bound heading paint is checked against exact same-block source text, even when root backgrounds agree',()=>{
  const value=fixture();assert.equal(compareBoundTextPaint(value.contract,value.program,[value.target],value.packets).passed,true);
  value.target.elements[0].style.color='rgb(110, 98, 89)';const report=compareBoundTextPaint(value.contract,value.program,[value.target],value.packets);assert.equal(report.passed,false);assert.equal(report.counts.errors,1);assert.equal(report.checks[0].sourceTextId,'product-heading');
});
test('ambiguous repeated normal colors are an explicit source gap instead of taking the first color',()=>{
  const value=fixture();value.packets[0].blocks[0].textAtoms.push({...value.packets[0].blocks[0].textAtoms[0],selector:'h3',style:{color:'rgb(255,0,0)'}});
  const report=compareBoundTextPaint(value.contract,value.program,[value.target],value.packets);assert.equal(report.status,'needs-review');assert.equal(report.counts.errors,0);assert.equal(report.counts.unverified,1);assert.equal(report.checks[0].sourceColors.length,2);assert.match(report.checks[0].reason!,/multiple visible normal colors/);
});

test('source heading tag and exact public link context distinguish repeated literal text without choosing a color from the target',()=>{
  const value=fixture(),atom=value.packets[0].blocks[0].textAtoms[0];atom.tag='h2';
  value.packets[0].blocks[0].textAtoms.push({...atom,selector:'a.source-link',tag:'a',href:'https://8.8.8.8/other',visible:false,rect:{width:0,height:0},style:{color:'rgb(255,0,0)'}});
  assert.equal(compareBoundTextPaint(value.contract,value.program,[value.target],value.packets).passed,true);
  value.contract.blocks[0].texts[0].kind='label';value.program.elements[0].children![0].settings.link={url:'https://8.8.8.8/other'};
  value.target.elements[0].visible=false;
  let report=compareBoundTextPaint(value.contract,value.program,[value.target],value.packets);assert.equal(report.checks[0].status,'source-inactive');assert.deepEqual(report.checks[0].sourceSelectors,['a.source-link']);
  value.target.elements[0].visible=true;value.packets[0].blocks[0].textAtoms[1].visible=true;value.packets[0].blocks[0].textAtoms[1].rect={width:300,height:30};
  report=compareBoundTextPaint(value.contract,value.program,[value.target],value.packets);assert.equal(report.checks[0].status,'mismatch');assert.deepEqual(report.checks[0].sourceColors,['rgb(255,0,0)']);
});

test('complete frozen atom ownership prevents a conditional same-word menu item from borrowing main navigation normal paint',()=>{
  const value=fixture(),block=value.contract.blocks[0];block.id='header';block.role='header';value.program.blocks[0].sourceBlockId='header';block.texts=[{id:'header-text-0',text:'Deals',kind:'navigation'},{id:'header-text-1',text:'Deals',kind:'navigation'}];
  value.program.elements[0].children=[{key:'main-deals',type:'heading',settings:{title:'Deals'}},{key:'menu-deals',type:'heading',settings:{title:'Deals'}}];value.program.blocks[0].bindings=[{sourceTextId:'header-text-0',elementKey:'main-deals',settingPath:'title'},{sourceTextId:'header-text-1',elementKey:'menu-deals',settingPath:'title'}];
  value.packets[0].blocks=[{id:'header',rect:{x:0,y:0,width:1000,height:100},textAtoms:[{text:'Deals',selector:'header .main-deals',tag:'a',visible:true,rect:{x:800,y:50,width:50,height:20},style:{color:'rgb(0,71,210)'}}]}];
  const conditional={evidencePath:'source-open-menu.json',viewport:'desktop',block:{id:'header',textAtoms:[{text:'Deals',selector:'header .submenu-deals',tag:'a',visible:true,rect:{x:20,y:140,width:240,height:48},style:{color:'rgb(193,29,36)'}}]}};
  value.packets[0].textOwners=reconstructSourceTextOwners(value.contract,value.packets[0],[conditional]);assert.equal(value.packets[0].textOwners.length,2);assert.equal(value.packets[0].textOwners[1].sourceState,'conditional');
  const base=value.target.elements[0];value.target.elements=[{...base,sourceId:'main-deals',text:'Deals',style:{color:'rgb(0,71,210)'}},{...base,sourceId:'menu-deals',text:'Deals',visible:false,rect:{x:0,y:0,width:0,height:0},style:{color:'rgb(193,29,36)'}}];
  let report=compareBoundTextPaint(value.contract,value.program,[value.target],value.packets);assert.equal(report.counts.errors,0);assert.equal(report.counts.unverified,1);assert.equal(report.checks[1].sourceOwner?.selector,'header .submenu-deals');assert.match(report.checks[1].reason!,/conditional or same-word sibling paint was not borrowed/);assert.equal(report.glyphDiagnostics.length,0);
  value.packets[0].blocks[0].textAtoms.push({...conditional.block.textAtoms[0],visible:false,rect:{x:0,y:0,width:0,height:0}});report=compareBoundTextPaint(value.contract,value.program,[value.target],value.packets);assert.equal(report.checks[1].status,'source-inactive');
  block.texts[1].text='Changed frozen owner';assert.equal(reconstructSourceTextOwners(value.contract,value.packets[0],[conditional]).length,0);
});

test('ordinary repeated text without enough identified source atoms stays unverified rather than borrowing one expected color twice',()=>{
  const value=fixture();value.contract.blocks[0].texts.push({...value.contract.blocks[0].texts[0],id:'second-heading'});value.program.elements[0].children!.push({key:'second-heading',type:'heading',settings:{title:'Original source heading'}});value.program.blocks[0].bindings.push({sourceTextId:'second-heading',elementKey:'second-heading',settingPath:'title'});value.target.elements.push({...value.target.elements[0],sourceId:'second-heading',style:{color:'rgb(255,0,0)'}});
  const report=compareBoundTextPaint(value.contract,value.program,[value.target],value.packets);assert.equal(report.counts.errors,0);assert.equal(report.counts.unverified,2);assert.equal(report.counts.matched,0);assert.equal(report.passed,false);
});

test('source responsive counterparts require reciprocal source visibility and the same full text, tag and responsibility, while nonmutual or foreign-link copies cannot lend paint',()=>{
  const value=fixture(),primary=value.packets[0],original=primary.blocks[0].textAtoms[0];original.selector='article > div:nth-of-type(2) > h2';original.tag='h2';original.fullElementText='Original source heading';
  const alternate={...original,selector:'article > div:nth-of-type(1) > h2',visible:false,rect:{width:0,height:0}};primary.blocks[0].textAtoms.push(alternate);
  const owner={blockId:'products',sourceTextId:'product-heading',text:'Original source heading',kind:'heading' as const,selector:original.selector,tag:'h2',sourceState:'normal' as const,evidencePath:primary.evidencePath};primary.textOwners=[owner];
  const mobile:SourceTextPaintPacket={evidenceId:'mobile-dom',evidencePath:'source-mobile.json',viewport:'mobile',textOwners:[owner],blocks:[{id:'products',textAtoms:[{...original,visible:false,rect:{width:0,height:0}},{...alternate,visible:true,rect:{width:300,height:30},style:{color:'rgb(255,0,0)'}}]}]};
  assert.equal(provenSourceResponsiveVariants(owner,'mobile',[primary,mobile]).length,1);
  value.target.name='mobile';value.target.elements[0].style.color='rgb(255,0,0)';let report=compareBoundTextPaint(value.contract,value.program,[value.target],[primary,mobile]);assert.equal(report.counts.errors,0);assert.equal(report.checks[0].responsiveSourceVariants?.length,1);
  value.target.elements[0].style.color='rgb(65,116,141)';report=compareBoundTextPaint(value.contract,value.program,[value.target],[primary,mobile]);assert.equal(report.counts.errors,1);
  alternate.visible=true;alternate.rect={width:300,height:30};assert.equal(provenSourceResponsiveVariants(owner,'mobile',[primary,mobile]).length,0);alternate.visible=false;alternate.rect={width:0,height:0};
  original.href='https://8.8.8.8/source';mobile.blocks[0].textAtoms[1].href='https://8.8.8.8/other';assert.equal(provenSourceResponsiveVariants(owner,'mobile',[primary,mobile]).length,0);
  original.href=undefined;mobile.blocks[0].textAtoms[1].href=undefined;mobile.blocks[0].textAtoms[1].fullElementText='Changed full paragraph';assert.equal(provenSourceResponsiveVariants(owner,'mobile',[primary,mobile]).length,0);
});
test('normal paint matching never borrows same words from another block or hidden and truncated source styles',()=>{
  const value=fixture();value.packets[0].blocks[0].id='footer';assert.equal(compareBoundTextPaint(value.contract,value.program,[value.target],value.packets).counts.unverified,1);
  value.packets[0].blocks[0].id='products';value.packets[0].blocks[0].textAtoms[0].visible=false;assert.equal(compareBoundTextPaint(value.contract,value.program,[value.target],value.packets).counts.unverified,1);
  value.packets[0].blocks[0].textAtoms[0].visible=true;value.packets[0].blocks[0].textAtoms[0].style='[MaxDepth]';assert.equal(compareBoundTextPaint(value.contract,value.program,[value.target],value.packets).counts.unverified,1);
});

test('source-inactive responsive text requires frozen zero geometry and exact retained hidden native content, while visible source text stays mandatory',()=>{
  const value=fixture(),atom=value.packets[0].blocks[0].textAtoms[0],target=value.target.elements[0];
  atom.visible=false;atom.rect={width:0,height:0};target.visible=false;target.rect.width=0;target.rect.height=0;
  let report=compareBoundTextPaint(value.contract,value.program,[value.target],value.packets);
  assert.equal(report.passed,true);assert.equal(report.checks[0].status,'source-inactive');assert.equal(report.counts.sourceInactive,1);assert.equal(report.checks[0].evidence[0],'source-dom.json');
  target.visible=true;report=compareBoundTextPaint(value.contract,value.program,[value.target],value.packets);assert.equal(report.status,'failed');assert.match(report.checks[0].reason!,/native bound content is visible/);
  target.visible=false;target.text='Missing source words';report=compareBoundTextPaint(value.contract,value.program,[value.target],value.packets);assert.equal(report.status,'needs-review');assert.equal(report.counts.sourceInactive,0);
  target.text='Original source heading';atom.visible=true;atom.rect={width:500,height:40};report=compareBoundTextPaint(value.contract,value.program,[value.target],value.packets);assert.equal(report.status,'failed');assert.equal(report.glyphDiagnostics[0].status,'mismatch');
});
test('a native glyph masked by its opaque box is diagnosed only when source evidence proves normal text has no such box',()=>{
  const value=fixture();value.packets[0].blocks[0].textAtoms[0].style={'color':'rgb(65, 116, 141)','background-color':'rgba(0,0,0,0)','background-image':'none'};
  value.target.elements[0].paintLayers=[{role:'root',rect:value.target.elements[0].rect,effectiveOpacity:1,style:{'background-color':'rgb(65, 116, 141)','background-image':'none'}}];
  let report=compareBoundTextPaint(value.contract,value.program,[value.target],value.packets);assert.equal(report.counts.errors,0);assert.equal(report.glyphDiagnostics[0].status,'mismatch');assert.equal(report.passed,false);
  value.packets[0].blocks[0].textAtoms[0].style={'color':'rgb(65, 116, 141)','background-color':'rgb(65, 116, 141)','background-image':'none'};
  report=compareBoundTextPaint(value.contract,value.program,[value.target],value.packets);assert.equal(report.glyphDiagnostics[0].status,'unverified');assert.match(report.glyphDiagnostics[0].reason,/clipping or masking intent/);
});
test('hash-bound source paint loading reads actual block packets without rewriting contract or source artifacts',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'clonewp-text-paint-'));
  try{
    const value=fixture();await mkdir(path.join(directory,'reference'));await writeJson(path.join(directory,'reference/report.json'),{url:value.contract.sourceUrl,viewports:[{name:'desktop',width:1440,height:1000}]});
    await writeJson(path.join(directory,'reference/desktop.json'),{observedPage:{url:value.contract.sourceUrl,viewport:{width:1440,height:1000}},blocks:value.packets[0].blocks});
    value.contract.referenceReport.sha256=sha256(await readFile(path.join(directory,'reference/report.json')));value.contract.evidence[0].sha256=sha256(await readFile(path.join(directory,'reference/desktop.json')));
    const before=JSON.stringify(value.contract),bytes=await readFile(path.join(directory,'reference/desktop.json')),packets=await loadSourceTextPaint(value.contract,directory);assert.equal(packets[0].viewport,'desktop');assert.deepEqual(packets[0].observedPage,{url:value.contract.sourceUrl,viewport:{width:1440,height:1000}});assert.equal(packets[0].blocks[0].textAtoms[0].style&&typeof packets[0].blocks[0].textAtoms[0].style==='object'&&(packets[0].blocks[0].textAtoms[0].style as Record<string,string>).color,'rgb(65, 116, 141)');assert.equal(JSON.stringify(value.contract),before);assert.deepEqual(await readFile(path.join(directory,'reference/desktop.json')),bytes);
    await writeFile(path.join(directory,'reference/desktop.json'),'{}');await assert.rejects(loadSourceTextPaint(value.contract,directory),/Frozen normal text paint evidence changed/);
  }finally{assert.ok(path.relative(os.tmpdir(),directory).startsWith('clonewp-text-paint-'));await rm(directory,{recursive:true,force:true});}
});

test('raw stylesheet observations retain hash validation without being parsed as DOM JSON; malformed JSON, DOM and interaction packets still fail',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'clonewp-text-raw-observation-'));
  try{
    const value=fixture();await mkdir(path.join(directory,'reference'));
    const report=JSON.stringify({url:value.contract.sourceUrl,viewports:[{name:'desktop',width:1440,height:1000}]}),packet=JSON.stringify({observedPage:{url:value.contract.sourceUrl,viewport:{width:1440,height:1000}},blocks:value.packets[0].blocks}),css='@import url(https://fonts.example/public.css);\nbody{color:#333}';
    await writeFile(path.join(directory,'reference/report.json'),report);await writeFile(path.join(directory,'reference/desktop.json'),packet);await writeFile(path.join(directory,'reference/source.css'),css);
    value.contract.referenceReport.sha256=sha256(report);value.contract.evidence[0].sha256=sha256(packet);value.contract.evidence.push({id:'source-css',path:'reference/source.css',sha256:sha256(css),kind:'observation'});
    const html='<!doctype html><html><body>Public page</body></html>';await writeFile(path.join(directory,'reference/source.html'),html);value.contract.evidence.push({id:'source-html',path:'reference/source.html',sha256:sha256(html),kind:'dom'});
    const attributeCSS='[data-source="public"] { color: #333; }';await writeFile(path.join(directory,'reference/attribute.css'),attributeCSS);value.contract.evidence.push({id:'attribute-css',path:'reference/attribute.css',sha256:sha256(attributeCSS),kind:'observation'});
    const before=JSON.stringify(value.contract);assert.equal((await loadSourceTextPaint(value.contract,directory)).length,1);assert.equal(JSON.stringify(value.contract),before);assert.equal(await readFile(path.join(directory,'reference/source.css'),'utf8'),css);
    await writeFile(path.join(directory,'reference/source.css'),css+'\n.changed{}');await assert.rejects(loadSourceTextPaint(value.contract,directory),/Frozen normal text paint evidence changed/);await writeFile(path.join(directory,'reference/source.css'),css);
    for(const kind of ['dom','interaction'] as const){value.contract.evidence[1].kind=kind;await assert.rejects(loadSourceTextPaint(value.contract,directory),SyntaxError);}
    value.contract.evidence[1].kind='observation';value.contract.evidence[1].path='reference/malformed.json';await writeFile(path.join(directory,'reference/malformed.json'),css);await assert.rejects(loadSourceTextPaint(value.contract,directory),SyntaxError);
  }finally{await rm(directory,{recursive:true,force:true});}
});
