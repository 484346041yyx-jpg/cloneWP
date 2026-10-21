import test from 'node:test';
import assert from 'node:assert/strict';
import { proveInactiveSourceText, retainedHiddenNativeText } from '../src/fidelity/source-static-text.js';
import { verifyFidelity } from '../src/fidelity/verify.js';
import { compareBoundTextPaint, type SourceTextPaintPacket } from '../src/fidelity/text-paint.js';
import type { BlockContract, NativeProgram } from '../src/fidelity/types.js';
import type { TargetViewportEvidence, TargetElementEvidence } from '../src/verification/types.js';

function fixture(){
  const none={status:'not-applicable' as const,evidence:[]},state={normal:none,hover:none,interaction:none};
  const contract={blocks:[{id:'footer',role:'footer',presentation:'static',texts:[{id:'canonical',text:'Dog',kind:'label'},{id:'responsive-alias',text:'Dog',kind:'label'}],geometry:{mobile:{width:390,height:100}},colors:{},states:state}],sourceUrl:'https://public.example/',evidence:[],tolerances:{geometryPx:2,geometryRatio:.01,colorChannel:2},limitations:[]} as unknown as BlockContract;
  const program={elements:[{key:'root',type:'container',settings:{},children:[{key:'canonical',type:'heading',settings:{title:'Dog'}},{key:'responsive-copy',type:'heading',settings:{title:'Dog'}}]}],blocks:[{sourceBlockId:'footer',rootKey:'root',bindings:[{sourceTextId:'canonical',elementKey:'canonical',settingPath:'title'},{sourceTextId:'responsive-alias',elementKey:'responsive-copy',settingPath:'title'}]}],deviations:[]} as unknown as NativeProgram;
  const hidden={sourceId:'responsive-copy',selector:'[data-id="responsive-copy"]',found:true,count:1,nativeElement:true,visible:false,text:'',rect:{x:20,y:30,width:350,height:21},style:{},images:[]} as TargetElementEvidence;
  const target={name:'mobile',width:390,height:800,url:'https://target.example/?page_id=1',elements:[{...hidden,sourceId:'root',visible:true,rect:{x:0,y:0,width:390,height:100}},{...hidden,sourceId:'canonical'},hidden],overflow:[],imageFailures:[],evidencePath:'target.json'} as unknown as TargetViewportEvidence;
  const packets:SourceTextPaintPacket[]=[{evidenceId:'mobile-source',evidencePath:'source-mobile.json',viewport:'mobile',blocks:[{id:'footer',textAtoms:[{text:'Dog',tag:'a',selector:'#source-footer > a',visible:false,rect:{x:0,y:0,width:0,height:0}}]}]}];
  return{contract,program,hidden,target,packets};
}
test('closed native accordion copy retains exact editable text when source atoms are actually inactive, without counting it as painted equality',()=>{
  const v=fixture();assert.ok(proveInactiveSourceText('footer','Dog','mobile',v.packets));assert.equal(retainedHiddenNativeText(v.program,'footer','responsive-alias','Dog',v.hidden),true);
  const report=verifyFidelity(v.contract,v.program,[v.target],[],[],[],v.packets);assert.equal(report.issues.some(issue=>issue.code==='source-text'),false);assert.equal(report.inactiveStaticText!.length,2);assert.equal(report.coverage[0].expectedTexts,2);assert.equal(report.coverage[0].matchedTexts,0);
  const paint=compareBoundTextPaint(v.contract,v.program,[v.target],v.packets);assert.equal(paint.counts.sourceInactive,2);assert.equal(paint.counts.expected,2);assert.equal(paint.passed,true);
});
test('target hidden state never excuses unobserved, visible, nonzero, non-finite or foreign-block source copy',()=>{
  const v=fixture(),atom=v.packets[0].blocks[0].textAtoms[0];
  for(const change of [{visible:true},{rect:{width:10,height:10}},{rect:{width:NaN,height:0}},{selector:undefined}]){
    const packets=structuredClone(v.packets);Object.assign(packets[0].blocks[0].textAtoms[0],change);assert.equal(proveInactiveSourceText('footer','Dog','mobile',packets),undefined);
  }
  assert.equal(proveInactiveSourceText('other-block','Dog','mobile',v.packets),undefined);assert.equal(proveInactiveSourceText('footer','Dog','tablet',v.packets),undefined);
  v.packets[0].blocks[0].textAtoms.push({...atom,selector:'#visible-same-word',visible:true,rect:{width:30,height:20}});assert.equal(proveInactiveSourceText('footer','Dog','mobile',v.packets),undefined);
  const report=verifyFidelity(v.contract,v.program,[v.target],[],[],[],[]);assert.equal(report.inactiveStaticText!.length,0);assert.equal(report.issues.filter(issue=>issue.code==='source-text').length,2);
});
test('inactive source proof still rejects changed saved settings, missing bindings and contradictory browser text',()=>{
  const v=fixture();v.hidden.text='Cat';assert.equal(retainedHiddenNativeText(v.program,'footer','responsive-alias','Dog',v.hidden),false);
  v.hidden.text='';v.program.elements[0].children![1].settings.title='Cat';assert.equal(retainedHiddenNativeText(v.program,'footer','responsive-alias','Dog',v.hidden),false);
  v.hidden.text='Dog';assert.ok(verifyFidelity(v.contract,v.program,[v.target],[],[],[],v.packets).issues.some(issue=>issue.code==='source-text-retention'));v.hidden.text='';
  v.program.elements[0].children![1].settings.title='Dog';v.hidden.visible=true;assert.equal(retainedHiddenNativeText(v.program,'footer','responsive-alias','Dog',v.hidden),false);
  const report=verifyFidelity(v.contract,v.program,[v.target],[],[],[],v.packets);assert.ok(report.issues.some(issue=>issue.code==='source-text-visibility'));
  v.hidden.visible=false;v.program.blocks[0].bindings.pop();assert.equal(retainedHiddenNativeText(v.program,'footer','responsive-alias','Dog',v.hidden),false);
});
