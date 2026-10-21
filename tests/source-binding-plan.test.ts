import test from 'node:test';import assert from 'node:assert/strict';
import {planSourceBindingRepairs,type SourceBindingPlanOptions}from'../src/fidelity/source-binding-plan.js';
function fixture():SourceBindingPlanOptions{
  const region={id:'owner',sourceNodeId:'#section',rect:{x:0,y:0,width:500,height:300},evidence:['dom'],visible:true};
  const state={normal:{status:'observed',evidence:['dom']},hover:{status:'not-applicable',evidence:[]},interaction:{status:'not-applicable',evidence:[]}};
  const item=(id:string,kind:string,selector:string,rect={x:20,y:40,width:500,height:300},facts={})=>({id,kind,selector,rect,sourceBlockId:'observed',visible:true,required:true,state:'resting',facts,evidence:['DOM']});
  const options={contract:{sourceUrl:'https://public.example/',evidence:[{id:'dom'}],blocks:[{id:'catalog',role:'products',presentation:'carousel',geometry:{desktop:{width:500,height:300}},texts:[],assets:[],states:state,dynamicData:{items:[{sourceNodeId:'#a'},{sourceNodeId:'#b'}]},presentationDetails:{version:1,viewports:{desktop:{regions:[region],media:[],controlGroups:[{id:'legacy-group',sourceNodeId:'old wrapper',ownerId:'owner',rect:{x:300,y:0,width:180,height:40},evidence:['dom'],visible:true,layout:'row',pagination:'none',controls:[{id:'next',sourceNodeId:'img parent button',role:'next',rect:{x:440,y:0,width:40,height:40},evidence:['dom'],visible:true}]}],catalogTemplate:{sourceNodeId:'#a > article',visibleFraction:1,slots:[{role:'name'}]}}}}}],sourceSceneBindings:[{viewport:'desktop',sourceId:'block',blockId:'catalog',targetKey:'root',requirement:'block'},{viewport:'desktop',sourceId:'rail',blockId:'catalog',targetKey:'query',requirement:'repeated-template'}]},program:{sourceUrl:'https://public.example/',elements:[{key:'root',type:'container',settings:{},children:[{key:'query',type:'wd_products',settings:{}}]}],blocks:[{sourceBlockId:'catalog',rootKey:'root',bindings:[],productQuery:{widgetKey:'query'},presentationBindings:[{id:'owner',elementKey:'root'},{id:'legacy-group',elementKey:'query',relativeSelector:'.navigation'},{id:'next',elementKey:'query',relativeSelector:'.next'}]}]},inventories:[{sourceUrl:'https://public.example/',viewport:{name:'desktop',width:1000,height:800},evidencePath:'source.json',gaps:[],items:[item('block','block','#section'),item('rail','repeated-template','#rail',undefined,{itemSelectors:['#a','#b']}),{...item('source-next','control','#source-next',{x:460,y:40,width:40,height:40}),ownerId:'rail',role:'next'}]}],packets:[{viewport:'desktop',evidenceId:'dom',blocks:[{id:'observed',rect:{x:20,y:40,width:500,height:300},selectors:['#section'],textAtoms:[],images:[]}]}],measurements:[{name:'desktop',evidencePath:'target.json',elements:[{sourceId:'root',found:true,count:1,nativeElement:true,visible:true,rect:{x:20,y:40,width:500,height:300}},{sourceId:'query',found:true,count:1,nativeElement:true,visible:true,rect:{x:20,y:40,width:500,height:300}}]}],presentationEvidence:[{viewport:'desktop',blockId:'catalog',id:'next',found:true,count:1,visible:true,rect:{x:430,y:2,width:40,height:40},evidence:['actual-native-probe.json']}],programSha256:'a'.repeat(64),targetProof:{programSha256:'a'.repeat(64),beforeHash:'b'.repeat(64),afterHash:'b'.repeat(64),nativeDocumentPassed:true,evidencePath:'qa.json'}};
  Object.assign(options.presentationEvidence[0],{glyph:{kind:'text',content:'›'},containedByIds:['legacy-group']});
  (options.presentationEvidence as unknown[]).push({viewport:'desktop',blockId:'catalog',id:'legacy-group',found:true,count:1,visible:true,rect:{x:300,y:0,width:180,height:40},evidence:['actual-group.json'],containedByIds:['owner'],controlInventory:[{role:'next',matched:1,visible:1}]});return options as unknown as SourceBindingPlanOptions;
}
test('binding repair uses the independent source owner and actual same-role native probe, preserves source and target measurements separately',()=>{
  const v=fixture(),before=JSON.stringify(v),plan=planSourceBindingRepairs(v),row=plan.features.find(row=>row.sourceId==='source-next')!;
  assert.equal(row.status,'proposed');assert.equal(row.binding?.targetKey,'query');assert.equal(row.presentationChange?.after.sourceNodeId,'#source-next');assert.deepEqual(row.presentationChange?.after.rect,{x:440,y:0,width:40,height:40});assert.equal(row.targetActual?.rect?.x,430);assert.equal(row.presentationChange?.before?.sourceNodeId,'img parent button');assert.equal(plan.counts.required,3);assert.equal(plan.wholeTaskPassed,false);assert.equal(JSON.stringify(v),before);
});
test('a missing source owner, foreign native key, duplicate role or absent actual probe never yields a proposed binding',()=>{
  for(const mutate of [
    (v:SourceBindingPlanOptions)=>{delete v.inventories[0].items[2].ownerId;},
    (v:SourceBindingPlanOptions)=>{v.program.blocks[0].presentationBindings![2].elementKey='foreign';v.measurements[0].elements.push({...v.measurements[0].elements[1],sourceId:'foreign'});},
    (v:SourceBindingPlanOptions)=>{v.presentationEvidence=[];},
    (v:SourceBindingPlanOptions)=>{v.presentationEvidence.find(probe=>probe.id==='legacy-group')!.controlInventory=[{role:'next',matched:2,visible:2}];},
    (v:SourceBindingPlanOptions)=>{v.presentationEvidence[0].containedByIds=[];},
    (v:SourceBindingPlanOptions)=>{const view=v.contract.blocks[0].presentationDetails!.viewports.desktop;view.controlGroups[0].controls.push({...view.controlGroups[0].controls[0],id:'second-next'});v.program.blocks[0].presentationBindings!.push({id:'second-next',elementKey:'query',relativeSelector:'.other-next'});v.presentationEvidence.push({...v.presentationEvidence[0],id:'second-next'});}
  ]){const v=fixture();mutate(v);assert.equal(planSourceBindingRepairs(v).features.find(row=>row.sourceId==='source-next')?.status,'gap');}
});
test('stale program bytes and changed actual document hashes retain candidate diagnostics but require new probes',()=>{
  for(const field of ['programSha256','afterHash']as const){const v=fixture();v.targetProof[field]='c'.repeat(64);const plan=planSourceBindingRepairs(v);assert.equal(plan.features.find(row=>row.sourceId==='source-next')?.status,'needs-probe');assert.equal(plan.additions.length,0);assert.equal(plan.counts.required,3);}
});
test('source card-internal repeated slots cannot borrow the whole native query track binding',()=>{
  const v=fixture();v.inventories[0].items.push({id:'inner',kind:'repeated-template',selector:'#a > article > div',ancestorSelectors:['#a','#rail','#section'],sourceBlockId:'observed',rect:{x:20,y:200,width:200,height:80},visible:true,required:true,state:'resting',facts:{itemSelectors:['#a > article > div > p:nth-of-type(1)','#a > article > div > p:nth-of-type(2)']},evidence:['DOM']});
  const plan=planSourceBindingRepairs(v),row=plan.features.find(row=>row.sourceId==='inner')!;assert.equal(row.classification?.kind,'catalog-card-slots');assert.equal(row.status,'gap');assert.equal(row.binding,undefined);assert.match(row.reason,/card-internal/);assert.equal(plan.counts.required,4);
});
test('a heading row with matching insets cannot impersonate a source content frame that also owns the query',()=>{
  const v=fixture();v.program.elements[0].children!.push({key:'heading-row',type:'container',settings:{}});v.program.blocks[0].contentBindings={desktop:'heading-row'};
  v.measurements[0].elements.push({...v.measurements[0].elements[1],sourceId:'heading-row',rect:{x:20,y:40,width:500,height:40}});
  v.inventories[0].items[1].ancestorSelectors=['#frame','#section'];
  v.inventories[0].items.push({id:'frame',kind:'content-frame',selector:'#frame',ancestorSelectors:['#section'],sourceBlockId:'observed',rect:{x:20,y:40,width:500,height:300},visible:true,required:true,state:'resting',facts:{},evidence:['DOM']});
  v.packets[0].blocks[0].nodes=[{selector:'#frame',rect:{x:20,y:40,width:500,height:300}}];
  v.contract.sourceSceneBindings!.push({viewport:'desktop',sourceId:'frame',blockId:'catalog',targetKey:'heading-row',requirement:'content-frame'});
  const row=planSourceBindingRepairs(v).features.find(row=>row.sourceId==='frame')!;assert.equal(row.status,'gap');assert.equal(row.binding,undefined);assert.match(row.reason,/partial subtree/);
});
test('an exact selector never upgrades a different control role or a plain region into a source control/group',()=>{
  for(const mode of ['wrong-role','plain-control-region','plain-group-region']as const){
    const v=fixture(),view=v.contract.blocks[0].presentationDetails!.viewports.desktop,control=view.controlGroups[0].controls[0];control.sourceNodeId='#source-next';
    if(mode==='wrong-role')control.role='previous';
    else{view.regions.push({...control,id:'wrong-kind',sourceNodeId:'#source-next'});delete(view.regions.at(-1)as unknown as Record<string,unknown>).role;view.controlGroups=[];v.program.blocks[0].presentationBindings!.push({id:'wrong-kind',elementKey:'query',relativeSelector:'.next'});v.presentationEvidence.push({...v.presentationEvidence[0],id:'wrong-kind'});}
    if(mode==='plain-group-region'){v.inventories[0].items[2].kind='control-group';v.inventories[0].items[2].role=undefined;v.inventories[0].items[2].facts={controlIds:[]};}
    assert.equal(planSourceBindingRepairs(v).features.find(row=>row.sourceId==='source-next')!.status,'gap',mode);
  }
});
test('source control groups require their actual typed group probe and independently observed member roles',()=>{
  const v=fixture();v.inventories[0].items.push({id:'group',kind:'control-group',selector:'#source-controls',ownerId:'rail',sourceBlockId:'observed',rect:{x:320,y:40,width:180,height:40},visible:true,required:true,state:'resting',facts:{controlIds:['source-next']},evidence:['DOM']});
  assert.equal(planSourceBindingRepairs(v).features.find(row=>row.sourceId==='group')!.status,'proposed');
  v.presentationEvidence.at(-1)!.controlInventory=[{role:'previous',matched:1,visible:1}];assert.equal(planSourceBindingRepairs(v).features.find(row=>row.sourceId==='group')!.status,'gap');
});
function fullFrame(){
  const v=fixture();v.program.blocks[0].contentBindings={desktop:'root'};v.inventories[0].items[1].ancestorSelectors=['#frame','#section'];
  v.inventories[0].items.push({id:'frame',kind:'content-frame',selector:'#frame',sourceBlockId:'observed',ancestorSelectors:['#section'],rect:{x:20,y:40,width:500,height:300},visible:true,required:true,state:'resting',facts:{},evidence:['DOM']});
  v.packets[0].blocks[0].nodes=[{selector:'#frame',rect:{x:20,y:40,width:500,height:300}}];v.nativeContainment=[{viewport:'desktop',ancestorKey:'root',descendantKey:'query',contained:true,evidence:['actual-native-contains.json']}];return v;
}
test('a frame requires positive complete source scope, every descendant mapping and actual DOM containment',()=>{
  const v=fullFrame();assert.equal(planSourceBindingRepairs(v).features.find(row=>row.sourceId==='frame')!.status,'proposed');
  for(const mutate of [
    (x:SourceBindingPlanOptions)=>{x.nativeContainment=[];},
    (x:SourceBindingPlanOptions)=>{x.nativeContainment![0].contained=false;},
    (x:SourceBindingPlanOptions)=>{x.nativeContainment![0].evidence=[];},
    (x:SourceBindingPlanOptions)=>{delete x.packets[0].blocks[0].images;},
    (x:SourceBindingPlanOptions)=>{x.packets[0].blocks[0].nodes=[];},
    (x:SourceBindingPlanOptions)=>{x.inventories[0].gaps.push({code:'scene-node-limit',message:'Source DOM denominator truncated'});},
    (x:SourceBindingPlanOptions)=>{x.contract.sourceSceneBindings!.find(binding=>binding.sourceId==='rail')!.requirement='control';},
    (x:SourceBindingPlanOptions)=>{x.inventories[0].items.push({id:'unknown-child',kind:'control',role:'action',selector:'#frame > button',sourceBlockId:'observed',rect:{x:20,y:40,width:40,height:40},visible:true,required:true,state:'resting',facts:{},evidence:['DOM']});}
  ]){const x=fullFrame();mutate(x);const plan=planSourceBindingRepairs(x),row=plan.features.find(row=>row.sourceId==='frame')!;assert.equal(row.status,'gap');assert.equal(row.binding,undefined);assert.equal(plan.counts.required,x.inventories[0].items.length);}
});
