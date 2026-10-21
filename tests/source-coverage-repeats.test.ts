import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSourceCoverage, classifySourceRepeat } from '../src/fidelity/source-coverage.js';
import type { BlockContract, NativeProgram } from '../src/fidelity/types.js';
import type { SourceSceneInventory, SourceSceneItem } from '../src/reference/source-scene.js';

function fixture(){
  const rect={x:20,y:40,width:180,height:60};
  const scene:SourceSceneInventory={version:1,method:'independent-public-dom-scene',sourceUrl:'https://public.example/',capturedAt:'2026-10-14T00:00:00Z',evidencePath:'source.json',viewport:{name:'mobile',width:390,height:800,clientWidth:390,devicePixelRatio:1,touch:true,coarsePointer:true,deviceProfile:'mobile'},state:'resting',status:'observed',gaps:[],notice:'Independent fixture',items:[{id:'block',kind:'block',sourceBlockId:'catalog',selector:'#source',rect:{x:0,y:0,width:390,height:300},visible:true,required:true,state:'resting',facts:{},evidence:['source']}]};
  const repeat:SourceSceneItem={id:'slots',kind:'repeated-template',sourceBlockId:'catalog',selector:'#a > div',ancestorSelectors:['#a','#rail','#source'],rect,visible:true,required:true,state:'resting',facts:{itemSelectors:['#a > div > p:nth-of-type(1)','#a > div > p:nth-of-type(2)']},evidence:['source']};
  scene.items.push(repeat);
  const source={id:'catalog',geometry:{mobile:{width:390,height:300}},dynamicData:{items:[{sourceNodeId:'#old-a',sourceNodeIds:{mobile:'#a'}},{sourceNodeId:'#old-b',sourceNodeIds:{mobile:'#b'}}]},presentationDetails:{version:1,viewports:{mobile:{regions:[{id:'slot-region',sourceNodeId:repeat.selector,rect:{...rect},geometryRole:'slot'}],media:[],controlGroups:[]}}}} as unknown as BlockContract['blocks'][number];
  const contract={sourceUrl:scene.sourceUrl,blocks:[source],sourceSceneBindings:[{viewport:'mobile',sourceId:'block',blockId:'catalog',targetKey:'root',requirement:'block'},{viewport:'mobile',sourceId:'slots',blockId:'catalog',targetKey:'products',requirement:'repeated-template'}]} as unknown as BlockContract;
  const program={elements:[{key:'root',type:'container',settings:{},children:[{key:'products',type:'native-products',settings:{}}]}],blocks:[{sourceBlockId:'catalog',rootKey:'root',productQuery:{widgetKey:'products'},presentationBindings:[{id:'slot-region',elementKey:'products',relativeSelector:'.native-card .native-body'}]}]} as unknown as NativeProgram;
  return{scene,repeat,source,contract,program};
}
test('source repeat classification preserves catalog lists, card-internal slots and static sibling responsibilities',()=>{
  const v=fixture();assert.deepEqual(classifySourceRepeat(v.source,v.repeat,v.scene).sourceItemIndices,[0]);assert.equal(classifySourceRepeat(v.source,v.repeat,v.scene).kind,'catalog-card-slots');
  const list={...v.repeat,selector:'#rail',ancestorSelectors:['#source'],facts:{itemSelectors:['#a','#b']}};
  assert.equal(classifySourceRepeat(v.source,list,v.scene).kind,'catalog-list');
  const staticGroup={...v.repeat,selector:'#source > aside',ancestorSelectors:['#source'],facts:{itemSelectors:['#source > aside > a:nth-of-type(1)','#source > aside > a:nth-of-type(2)']}};
  assert.equal(classifySourceRepeat(v.source,staticGroup,v.scene).kind,'static-repeat');
  assert.equal(classifySourceRepeat(v.source,{...list,facts:{itemSelectors:['#a','#unknown']}},v.scene).kind,'unknown');
  assert.equal(classifySourceRepeat(v.source,{...v.repeat,facts:{itemSelectors:['#a > div > p','#foreign']}},v.scene).kind,'unknown');
  assert.equal(classifySourceRepeat(v.source,{...v.repeat,ancestorSelectors:[],selector:'#opaque-slots'},v.scene).kind,'unknown');
});
test('catalog-internal repeat maps only through its exact measured native query subregion, without deleting its source fact',()=>{
  const v=fixture(),audit=()=>auditSourceCoverage(v.contract,[v.scene],{program:v.program,requiredViewports:['mobile']});
  assert.equal(audit().passed,true);assert.equal(audit().counts.required,2);
  delete v.program.blocks[0].presentationBindings![0].relativeSelector;assert.equal(audit().counts.missing,1);
  v.program.blocks[0].presentationBindings![0].relativeSelector='.native-card .native-body';v.contract.sourceSceneBindings![1].targetKey='root';assert.equal(audit().counts.missing,1);
  v.contract.sourceSceneBindings![1].targetKey='products';v.source.presentationDetails!.viewports.mobile.regions[0].rect.width++;assert.equal(audit().counts.missing,1);
  v.source.presentationDetails!.viewports.mobile.regions[0].rect.width--;v.contract.sourceSceneBindings!.pop();const missing=audit();assert.equal(missing.counts.required,2);assert.equal(missing.counts.missing,1);assert.ok(missing.issues.some(issue=>issue.code==='source-feature-unbound'&&issue.sourceId==='slots'));
});
test('nested slots cannot borrow the source card proof from another viewport or from two owner chains',()=>{
  const v=fixture();v.source.dynamicData!.items[0].sourceNodeIds={desktop:'#a'};assert.equal(classifySourceRepeat(v.source,v.repeat,v.scene).kind,'unknown');
  v.source.dynamicData!.items[0].sourceNodeIds={mobile:'#a'};v.repeat.ancestorSelectors!.push('#b');assert.equal(classifySourceRepeat(v.source,v.repeat,v.scene).kind,'unknown');
});
test('a true catalog list still requires a physically visible measured authorized card and native query',()=>{
  const v=fixture();v.repeat.selector='#rail';v.repeat.ancestorSelectors=['#source'];v.repeat.facts={itemSelectors:['#a','#b']};
  const template={sourceNodeId:'#a > article',sourceAncestorSelectors:['#a','#rail','#source'],rect:{x:20,y:40,width:180,height:220},visibleFraction:1,slots:[{role:'name'}]};
  Object.assign(v.source.presentationDetails!.viewports.mobile,{catalogTemplate:template});
  const audit=()=>auditSourceCoverage(v.contract,[v.scene],{program:v.program,requiredViewports:['mobile']});
  assert.equal(audit().passed,true);template.visibleFraction=.2;assert.equal(audit().counts.missing,1);
  template.visibleFraction=1;template.sourceNodeId='#foreign > article';template.sourceAncestorSelectors=['#foreign'];assert.equal(audit().counts.missing,1);
});
