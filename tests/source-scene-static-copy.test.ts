import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSourceContentCoverage, type SourceContentPacket } from '../src/fidelity/source-coverage.js';
import type { BlockContract, NativeProgram, SourceAssetManifest } from '../src/fidelity/types.js';
import type { SourceSceneInventory } from '../src/reference/source-scene.js';

test('independent static copy catches an omitted heading and does not exempt a whole product block',()=>{
  const scene={version:1,method:'independent-public-dom-scene',sourceUrl:'https://public.example/',viewport:{name:'desktop'},gaps:[],items:[{id:'scene-block',kind:'block',sourceBlockId:'source-block',selector:'#source',visible:true,required:true}]} as unknown as SourceSceneInventory;
  const contract={sourceUrl:scene.sourceUrl,sourceSceneBindings:[{viewport:'desktop',sourceId:'scene-block',blockId:'products',targetKey:'root',requirement:'block'}],blocks:[{id:'products',texts:[{id:'heading',text:'Great products',kind:'heading'},{id:'name',text:'Source Food',kind:'product-name'},{id:'price',text:'$5.99',kind:'price'}],assets:['banner','source-product'],dynamicData:{replaceableTextIds:['name','price'],items:[{sourceNodeId:'#source > article',textIds:['name','price'],assetKeys:['source-product']}]}}]} as BlockContract;
  const program={elements:[{key:'root',type:'container',settings:{},children:[{key:'heading',type:'heading',settings:{title:'Great products'}},{key:'banner',type:'image',settings:{image:{$asset:'banner'}}},{key:'query',type:'wd_products',settings:{}}]}],blocks:[{sourceBlockId:'products',rootKey:'root',bindings:[{sourceTextId:'heading',elementKey:'heading',settingPath:'title'}],productQuery:{widgetKey:'query',widgetType:'wd_products',sourceTextIds:['name','price'],sourceAssetKeys:['source-product']}}]} as NativeProgram;
  const manifest={assets:[{key:'banner',sourceUrl:'https://public.example/banner.png'},{key:'source-product',sourceUrl:'https://public.example/product.png'}]} as SourceAssetManifest;
  const packet:SourceContentPacket={viewport:'desktop',evidencePath:'source.json',blocks:[{id:'source-block',textAtoms:[
    {selector:'#source > h2',text:'Great products',tag:'h2',visible:true},
    {selector:'#source > h3',text:'Try Our Services',tag:'h3',visible:true},
    {selector:'#source > article > h3',text:'Source Food',tag:'h3',visible:true},
    {selector:'#source > article > span',text:'$5.99',tag:'span',visible:true},
    {selector:'#source > h4',text:'Source Food',tag:'h4',visible:true},
  ],images:[{selector:'#source > img',url:'https://public.example/banner.png',visible:true},{selector:'#source > article > img',url:'https://public.example/product.png',visible:true}]}]};
  const result=auditSourceContentCoverage(contract,program,manifest,[packet],[scene]);assert.equal(result.counts.expectedText,5);assert.equal(result.counts.matchedText,1);assert.equal(result.counts.dynamicText,2);assert.equal(result.counts.matchedMedia,1);assert.equal(result.counts.dynamicMedia,1);
  assert.ok(result.issues.some(issue=>issue.code==='source-static-text-omitted'&&issue.message.includes('Try Our Services')));
  assert.ok(result.issues.some(issue=>issue.code==='source-static-text-omitted'&&issue.sourceId==='#source > h4'),'same product wording outside exact authorized item remains static');
  (program.elements[0].children![0].settings as {title:string}).title='Rewritten title';const rewritten=auditSourceContentCoverage(contract,program,manifest,[packet],[scene]);assert.ok(rewritten.issues.some(issue=>issue.sourceId==='#source > h2'));
  (program.elements[0].children![0].settings as {title:string}).title='Great products';
  Object.assign(scene.viewport,{width:1000});scene.items.push({id:'repeated',kind:'repeated-template',sourceBlockId:'source-block',facts:{itemSelectors:['#source > list > article']}} as never);
  packet.blocks[0].textAtoms!.push({selector:'#source > aside > span',text:'Offscreen duplicate must not count',visible:true,rect:{x:-5000,y:0,width:300,height:30},lineLayout:{visibility:{painted:false,clippedRatio:1}}},{selector:'#source > list > article > a',text:'Original later slide must count',visible:true,rect:{x:3000,y:0,width:300,height:30},lineLayout:{visibility:{painted:false,clippedRatio:1}}});
  packet.blocks[0].images!.push({selector:'#source > picture > img',visible:true,loaded:false});
  const visibility=auditSourceContentCoverage(contract,program,manifest,[packet],[scene]);assert.equal(visibility.issues.some(issue=>issue.message.includes('Offscreen duplicate')),false);assert.ok(visibility.issues.some(issue=>issue.message.includes('Original later slide')));assert.ok(visibility.issues.some(issue=>issue.code==='source-static-media-unobserved'));
});
