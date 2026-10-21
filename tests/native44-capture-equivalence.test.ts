import test from 'node:test';
import assert from 'node:assert/strict';
import { assertExpandedCaptureEquivalent } from '../src/native44/capture-equivalence.js';
import { validateObservationPacketV2, type ObservationPacketV2 } from '../src/replica-v2/observation.js';
import { native44ObservedGeometryHash } from '../src/native44/source.js';

function packet(expanded = false): ObservationPacketV2 {
  const rect = { x: expanded ? 0 : -7.5, y: 0, width: expanded ? 1905 : 1920, height: 1200 };
  const contentRect = {x: 200, y: 40, width: 1200, height: 40};
  const style = {display:'block',position:'relative',visibility:'visible',opacity:'1','background-color':'rgb(255, 255, 255)','background-image':'none','box-shadow':'none','border-width':'0px','border-radius':'0px',transform:'none'};
  return { version:2,kind:'observation-packet',snapshot:{id:expanded?'expanded':'desktop',url:'https://example.com/',title:'A normal source page',capturedAt:'2026-10-16T00:00:00.000Z',viewport:{name:'desktop',width:expanded?1905:1920,height:expanded?1200:1080,clientWidth:1905,scrollbarWidth:expanded?0:15,devicePixelRatio:1},pageHeight:1200,screenshot:{path:'source.png',sha256:'1'.repeat(64),width:1905,height:1200}},
    nodes:{root:{id:'root',parentId:null,regionId:'page',tag:'section',selector:'#page',attributes:{},childIds:['copy'],styleId:'root-style',layoutId:'root-layout',visible:true},copy:{id:'copy',parentId:'root',regionId:'page',tag:'p',selector:'#copy',attributes:{},childIds:[],styleId:'copy-style',layoutId:'copy-layout',visible:true}},
    regions:[{id:'page',nodeId:'root',role:'page',order:0,contentNodeId:'root',gapBefore:0}],texts:{copy:{id:'copy',nodeId:'copy',regionId:'page',text:'Visible source copy is preserved.',kind:'body'}},styles:{'root-style':style,'copy-style':{...style,'font-size':'18px'}},
    layouts:{'root-layout':{id:'root-layout',rect,contentRect:rect,padding:[0,0,0,0],margin:[0,0,0,0],gap:{row:0,column:0},display:'block',position:'relative',maxWidth:'none',direction:'row',flowIndex:0},'copy-layout':{id:'copy-layout',rect:contentRect,contentRect,padding:[0,0,0,0],margin:[0,0,0,0],gap:{row:0,column:0},display:'block',position:'relative',maxWidth:'none',direction:'row',flowIndex:1}},resources:{},usages:{},interactions:{},gaps:[]};
}

test('expanded raster accepts exact visible solid-background coverage and independently checks descendants', () => {
  assert.doesNotThrow(() => assertExpandedCaptureEquivalent([packet()], [packet(true)]));
  for (const mutate of [
    (p:ObservationPacketV2)=>{p.layouts['copy-layout'].rect.x++;},
    (p:ObservationPacketV2)=>{p.styles['copy-style']['font-size']='19px';},
    (p:ObservationPacketV2)=>{p.texts.copy.text='Changed copy';},
    (p:ObservationPacketV2)=>{p.layouts['root-layout'].rect.height--;},
    (p:ObservationPacketV2)=>{p.styles['root-style']['background-color']='rgb(0, 0, 0)';},
    (p:ObservationPacketV2)=>{p.snapshot.viewport.width++;},
  ]) {
    const changed=structuredClone(packet(true)); mutate(changed);
    assert.throws(()=>assertExpandedCaptureEquivalent([packet()],[changed]));
  }
});

test('full-bleed normalization cannot waive own copy, media, borders or cropped content', () => {
  for(const decorate of [
    (p:ObservationPacketV2)=>{p.texts.own={id:'own',nodeId:'root',regionId:'page',text:'Own text',kind:'body'};},
    (p:ObservationPacketV2)=>{p.styles['root-style']['border-width']='1px';},
    (p:ObservationPacketV2)=>{p.resources.photo={id:'photo',url:'https://example.com/photo.png',kind:'image'};p.usages.photo={id:'photo',nodeId:'root',regionId:'page',resourceId:'photo',kind:'img',visible:true};},
    (p:ObservationPacketV2)=>{p.layouts['root-layout'].rect.x=1;},
  ]) {
    const a=packet(),b=packet(true);decorate(a);decorate(b);
    assert.throws(()=>assertExpandedCaptureEquivalent([a],[b]));
  }
});

test('animation offset boxes retain raw paint bounds and still detect genuine layout drift', () => {
  const a=packet(),b=packet(true);
  for(const p of[a,b]) {
    p.styles['copy-style']['animation-name']='spin';p.styles['copy-style']['animation-duration']='1s';
    p.layouts['copy-layout'].captureGeometry={method:'css-animation-offset-layout',rect:structuredClone(p.layouts['copy-layout'].rect),contentRect:structuredClone(p.layouts['copy-layout'].contentRect)};
    validateObservationPacketV2(p);
  }
  b.layouts['copy-layout'].rect.width=99;
  assert.doesNotThrow(()=>assertExpandedCaptureEquivalent([a],[b]));
  const oldHash=native44ObservedGeometryHash([b],b.snapshot.id);
  b.layouts['copy-layout'].captureGeometry!.rect.width++;
  assert.notEqual(native44ObservedGeometryHash([b],b.snapshot.id),oldHash);
  assert.throws(()=>assertExpandedCaptureEquivalent([a],[b]));
  delete a.styles['copy-style']['animation-name'];
  assert.throws(()=>validateObservationPacketV2(a),/observed CSS animation/);
});

function clippedHeaderPackets(): [ObservationPacketV2, ObservationPacketV2] {
  const packets: [ObservationPacketV2, ObservationPacketV2] = [packet(), packet(true)];
  for (const [index, p] of packets.entries()) {
    const headerRect = { x:0, y:index ? 700 : 0, width:1905, height:108 };
    const labelRect = { x:40, y:headerRect.y + 30, width:200, height:24 };
    const position = index ? 'fixed' : 'static';
    p.nodes.root.childIds.unshift('header');
    p.nodes.header = {id:'header',parentId:'root',regionId:'page',tag:'header',selector:'#header',attributes:{},childIds:['label'],styleId:'header-style',layoutId:'header-layout',visible:true};
    p.nodes.label = {id:'label',parentId:'header',regionId:'page',tag:'a',selector:'#header a',attributes:{href:'https://example.com/shop/'},childIds:[],styleId:'label-style',layoutId:'label-layout',visible:true};
    p.styles['header-style'] = {...p.styles['root-style'],position,'border-width':'1px'};
    p.styles['label-style'] = {...p.styles['copy-style']};
    for (const style of Object.values(p.styles)) Object.assign(style, {'box-shadow':'none','text-shadow':'none',filter:'none','backdrop-filter':'none','-webkit-box-reflect':'none','mix-blend-mode':'normal','outline-style':'none','outline-width':'0px','border-image-outset':'0','before:content':'none','after:content':'none'});
    p.layouts['header-layout'] = {...structuredClone(p.layouts['copy-layout']),id:'header-layout',position,rect:headerRect,contentRect:structuredClone(headerRect)};
    p.layouts['label-layout'] = {...structuredClone(p.layouts['copy-layout']),id:'label-layout',rect:labelRect,contentRect:structuredClone(labelRect)};
    p.layouts['copy-layout'].rect.y = 940;
    p.texts.label = {id:'label',nodeId:'label',regionId:'page',text:'Shop',kind:'control'};
    validateObservationPacketV2(p);
  }
  return packets;
}

const frameClip = {clip:{top:900,height:180}};

test('clipped raster permits a bounded sticky-header subtree wholly outside both covered rectangles', () => {
  const [a,b] = clippedHeaderPackets();
  b.styles['header-style']['background-color'] = 'rgb(240, 240, 240)';
  b.styles['header-style'].transform = 'matrix(1, 0, 0, 1, 0, 700)';
  assert.doesNotThrow(()=>assertExpandedCaptureEquivalent([a],[b],frameClip));
  assert.throws(()=>assertExpandedCaptureEquivalent([a],[b]),/paint styles/);
});

test('clip exclusion retains identity, semantic copy, media and animation-layout proofs', () => {
  for (const mutate of [
    (p:ObservationPacketV2)=>{p.nodes.label.selector='#different';},
    (p:ObservationPacketV2)=>{p.nodes.label.attributes.href='https://example.com/changed/';},
    (p:ObservationPacketV2)=>{p.texts.label.text='Changed label';},
    (p:ObservationPacketV2)=>{p.resources.logo={id:'logo',url:'https://example.com/logo.png',kind:'image'};p.usages.logo={id:'logo',nodeId:'header',regionId:'page',resourceId:'logo',kind:'img',visible:true};},
    (p:ObservationPacketV2)=>{p.layouts['header-layout'].captureGeometry={method:'css-animation-offset-layout',rect:structuredClone(p.layouts['header-layout'].rect),contentRect:structuredClone(p.layouts['header-layout'].contentRect)};},
  ]) {
    const [a,b]=clippedHeaderPackets();mutate(b);
    assert.throws(()=>assertExpandedCaptureEquivalent([a],[b],frameClip));
  }
});

test('touching or intersecting either clip edge and in-frame paint/layout drift are not excluded', () => {
  for (const index of [0,1]) for (const y of [792,793,1000,1080]) {
    const [a,b]=clippedHeaderPackets();
    const changed = [a,b][index];
    changed.layouts['header-layout'].rect.y=y;
    changed.layouts['header-layout'].contentRect.y=y;
    assert.throws(()=>assertExpandedCaptureEquivalent([a],[b],frameClip),/paint styles/);
  }
  for (const mutate of [
    (p:ObservationPacketV2)=>{p.styles['copy-style']['font-size']='20px';},
    (p:ObservationPacketV2)=>{p.styles['copy-style'].filter='blur(10px)';},
    (p:ObservationPacketV2)=>{p.layouts['copy-layout'].rect.x++;},
  ]) {
    const [a,b]=clippedHeaderPackets();mutate(b);
    assert.throws(()=>assertExpandedCaptureEquivalent([a],[b],frameClip));
  }
});

test('off-clip border boxes cannot hide overflow paint, generated pseudos or missing no-bleed facts', () => {
  for (const decorate of [
    (p:ObservationPacketV2)=>{p.styles['header-style']['box-shadow']='0 300px 60px black';},
    (p:ObservationPacketV2)=>{p.styles['label-style']['text-shadow']='0 300px 60px black';},
    (p:ObservationPacketV2)=>{p.styles['header-style'].filter='blur(300px)';},
    (p:ObservationPacketV2)=>{p.styles['header-style']['backdrop-filter']='blur(300px)';},
    (p:ObservationPacketV2)=>{p.styles['header-style']['outline-style']='solid';p.styles['header-style']['outline-width']='300px';},
    (p:ObservationPacketV2)=>{p.styles['header-style']['border-image-outset']='300';},
    (p:ObservationPacketV2)=>{p.styles['header-style']['before:content']='""';},
    (p:ObservationPacketV2)=>{p.styles['label-style']['after:content']='"icon"';},
    (p:ObservationPacketV2)=>{delete p.styles['header-style'].filter;},
    (p:ObservationPacketV2)=>{p.styles['root-style'].filter='blur(300px)';},
    (p:ObservationPacketV2)=>{p.layouts['header-layout'].contentRect.height=1000;},
  ]) {
    const [a,b]=clippedHeaderPackets();decorate(a);decorate(b);
    assert.throws(()=>assertExpandedCaptureEquivalent([a],[b],frameClip));
  }
});

test('off-clip parent and normalized animation boxes cannot waive a visible descendant or raw paint bounds', () => {
  const [a,b]=clippedHeaderPackets();
  for (const p of [a,b]) {
    p.layouts['label-layout'].rect.y=940;
    p.layouts['label-layout'].contentRect.y=940;
  }
  assert.throws(()=>assertExpandedCaptureEquivalent([a],[b],frameClip),/paint styles/);
  const [c,d]=clippedHeaderPackets();
  for (const p of [c,d]) {
    p.styles['header-style']['animation-name']='slide';p.styles['header-style']['animation-duration']='1s';
    p.layouts['header-layout'].captureGeometry={method:'css-animation-offset-layout',rect:structuredClone(p.layouts['header-layout'].rect),contentRect:structuredClone(p.layouts['header-layout'].contentRect)};
  }
  d.layouts['header-layout'].rect.y=940;
  assert.throws(()=>assertExpandedCaptureEquivalent([c],[d],frameClip),/paint styles/);
});

test('display:none subtrees exclude scroll-relative zero boxes while preserving their source facts', () => {
  const hidden = () => {
    const [a,b]=clippedHeaderPackets();
    for (const p of [a,b]) {
      p.styles['header-style'].display='none';p.layouts['header-layout'].display='none';
      for (const id of ['header','label']) {
        p.nodes[id].visible=false;
        const layout=p.layouts[p.nodes[id].layoutId];
        layout.rect.width=layout.rect.height=layout.contentRect.width=layout.contentRect.height=0;
        p.styles[p.nodes[id].styleId]['before:content']='"icon"';
      }
    }
    return [a,b];
  };
  const [a,b]=hidden();
  assert.doesNotThrow(()=>assertExpandedCaptureEquivalent([a],[b],frameClip));
  assert.throws(()=>assertExpandedCaptureEquivalent([a],[b]),/source geometry/);
  for (const mutate of [
    (p:ObservationPacketV2)=>{p.texts.label.text='Changed hidden source copy';},
    (p:ObservationPacketV2)=>{p.nodes.label.attributes.href='https://example.com/changed/';},
    (p:ObservationPacketV2)=>{p.styles['header-style'].display='block';p.layouts['header-layout'].display='block';},
    (p:ObservationPacketV2)=>{p.nodes.label.visible=true;},
    (p:ObservationPacketV2)=>{p.resources.logo={id:'logo',url:'https://example.com/logo.png',kind:'image'};p.usages.logo={id:'logo',nodeId:'label',regionId:'page',resourceId:'logo',kind:'img',visible:false};},
  ]) {
    const [left,right]=hidden();mutate(right);
    assert.throws(()=>assertExpandedCaptureEquivalent([left],[right],frameClip));
  }
});

function addBoundedPseudo(p: ObservationPacketV2, content: string, display: string): void {
  const values = {content,display,position:'static',transform:'none',width:'auto',height:'auto','margin-top':'0px','margin-right':'0px','margin-bottom':'0px','margin-left':'0px','padding-top':'0px','padding-right':'0px','padding-bottom':'0px','padding-left':'0px','border-width':'0px','border-style':'none','background-color':'rgba(0, 0, 0, 0)','background-image':'none','box-shadow':'none','text-shadow':'none',filter:'none','backdrop-filter':'none','-webkit-box-reflect':'none','mix-blend-mode':'normal','outline-style':'none','outline-width':'3px','border-image-outset':'0',overflow:'visible','font-size':'10px','line-height':'14px',visibility:'visible',color:'rgb(0, 0, 0)'};
  Object.assign(p.styles['label-style'],Object.fromEntries(Object.entries(values).map(([key,value])=>[`before:${key}`,value])));
}

test('clip exclusion bounds empty clearfix and static inline font pseudos by the ordinary text box model', () => {
  for (const [content,display] of [['""','table'],['"icon"','inline']]) {
    const [a,b]=clippedHeaderPackets();
    for (const p of [a,b]) addBoundedPseudo(p,content,display);
    assert.doesNotThrow(()=>assertExpandedCaptureEquivalent([a],[b],frameClip));
  }
  for (const mutate of [
    (s:Record<string,string>)=>{s['before:position']='absolute';},
    (s:Record<string,string>)=>{s['before:transform']='matrix(1, 0, 0, 1, 0, 300)';},
    (s:Record<string,string>)=>{s['before:box-shadow']='0 300px 30px black';},
    (s:Record<string,string>)=>{s['before:filter']='blur(30px)';},
    (s:Record<string,string>)=>{s['before:outline-style']='solid';},
    (s:Record<string,string>)=>{s['before:margin-bottom']='100px';},
    (s:Record<string,string>)=>{s['before:padding-top']='100px';},
    (s:Record<string,string>)=>{s['before:height']='100px';},
    (s:Record<string,string>)=>{s['before:font-size']='0px';},
    (s:Record<string,string>)=>{s['before:font-size']='invalid';},
    (s:Record<string,string>)=>{s['before:line-height']='100px';},
    (s:Record<string,string>)=>{s['before:background-color']='rgb(0, 0, 0)';},
    (s:Record<string,string>)=>{delete s['before:filter'];},
  ]) {
    const [a,b]=clippedHeaderPackets();
    for (const p of [a,b]) {addBoundedPseudo(p,'"icon"','inline');mutate(p.styles['label-style']);}
    assert.throws(()=>assertExpandedCaptureEquivalent([a],[b],frameClip));
  }
  const [a,b]=clippedHeaderPackets();
  for(const p of [a,b]) {addBoundedPseudo(p,'"icon"','inline');p.layouts['label-layout'].rect.y=p.layouts['label-layout'].contentRect.y=940;}
  // In-frame pseudo changes still take their existing strict comparison.
  a.styles['header-style'].position=b.styles['header-style'].position='static';
  a.layouts['header-layout']=structuredClone(b.layouts['header-layout']);
  b.styles['label-style']['before:color']='rgb(255, 0, 0)';
  assert.throws(()=>assertExpandedCaptureEquivalent([a],[b],frameClip),/pseudo-element paint/);
});

test('static inline font pseudos can use a font size larger than their fitted line box', () => {
  const [a,b]=clippedHeaderPackets();
  for(const p of [a,b]) {
    addBoundedPseudo(p,'"user icon"','inline');
    p.styles['label-style']['before:font-size']='18.6667px';
    p.styles['label-style']['before:line-height']='14px';
    p.layouts['label-layout'].rect.height=p.layouts['label-layout'].contentRect.height=14;
  }
  assert.doesNotThrow(()=>assertExpandedCaptureEquivalent([a],[b],frameClip));
  b.styles['label-style']['before:line-height']='15px';
  assert.throws(()=>assertExpandedCaptureEquivalent([a],[b],frameClip));
});

test('clip exclusion suppresses matched hidden visibility while still checking visible descendants and pseudos', () => {
  const hidden = () => {
    const [a,b]=clippedHeaderPackets();
    for (const p of [a,b]) {
      p.nodes.label.visible=false;p.styles['label-style'].visibility='hidden';
      p.layouts['label-layout'].rect.y=p.layouts['label-layout'].contentRect.y=940;
    }
    return [a,b];
  };
  const [a,b]=hidden();
  assert.doesNotThrow(()=>assertExpandedCaptureEquivalent([a],[b],frameClip));
  assert.throws(()=>assertExpandedCaptureEquivalent([a],[b]),/paint styles/);
  const [c,d]=hidden();
  for(const p of [c,d]) {p.nodes.label.visible=true;p.styles['label-style'].visibility='visible';}
  assert.throws(()=>assertExpandedCaptureEquivalent([c],[d],frameClip));
  const [g,h]=hidden();
  for(const p of [g,h]) {p.nodes.root.childIds=p.nodes.root.childIds.filter(id=>id!=='copy');p.nodes.label.childIds=['copy'];p.nodes.copy.parentId='label';}
  assert.throws(()=>assertExpandedCaptureEquivalent([g],[h],frameClip));
  const [e,f]=hidden();
  for(const p of [e,f]) {addBoundedPseudo(p,'"icon"','inline');p.styles['label-style']['before:visibility']='visible';}
  assert.throws(()=>assertExpandedCaptureEquivalent([e],[f],frameClip));
  for(const p of [e,f]) p.styles['label-style']['before:visibility']='hidden';
  assert.doesNotThrow(()=>assertExpandedCaptureEquivalent([e],[f],frameClip));
  f.texts.label.text='Changed hidden copy';
  assert.throws(()=>assertExpandedCaptureEquivalent([e],[f],frameClip),/copy/);
});
