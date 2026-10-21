import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogSourceNodeId, catalogTemplateOwnedBy, validateCatalogSourceOwnership } from '../src/fidelity/catalog-contract.js';
import type { BlockContract, SourceAssetManifest } from '../src/fidelity/types.js';
import { inferCatalogSourceViewportIdentities, collectCatalogSourceFieldAdditions } from '../src/fidelity/source-binding.js';
function fixture(){
  const item={sourceNodeId:'#desktop-card',sourceNodeIds:{desktop:'#desktop-card',mobile:'#mobile-slide'},textIds:['name'],assetKeys:['photo'],evidence:['desktop','mobile']};
  const contract={blocks:[{id:'products',texts:[{id:'name',text:'Source food',kind:'product-name'}],dynamicData:{items:[item]}}]}as unknown as BlockContract;
  const manifest={assets:[{key:'photo',sourceUrl:'https://public.example/food.png'}]}as SourceAssetManifest;
  const packet=(viewport:string,selector:string)=>({sceneInventory:{viewport:{name:viewport},items:[{kind:'repeated-template',sourceBlockId:'products',facts:{itemSelectors:[selector]}}]},blocks:[{id:'products',textAtoms:[{selector:'#name-'+viewport,ancestorSelectors:[selector],text:'Source food'}],images:[{selector:'#image-'+viewport,ancestorSelectors:[selector],url:manifest.assets[0].sourceUrl}]}]});
  const evidence=new Map<string,unknown>([['desktop',packet('desktop','#desktop-card')],['mobile',packet('mobile','#mobile-slide')]]);
  return{item,contract,manifest,evidence};
}
test('catalog source viewport identities retain one logical field owner while independent DOM proves static-to-carousel wrappers',()=>{
  const value=fixture();assert.equal(catalogSourceNodeId(value.item,'desktop'),'#desktop-card');assert.equal(catalogSourceNodeId(value.item,'mobile'),'#mobile-slide');assert.equal(catalogSourceNodeId(value.item,'tablet'),'#desktop-card');
  assert.doesNotThrow(()=>validateCatalogSourceOwnership(value.contract,value.manifest,value.evidence,value=>value));
  assert.equal(catalogTemplateOwnedBy(value.item,{sourceNodeId:'#actual-card',sourceAncestorSelectors:['#mobile-slide']}as never,'mobile'),true);
  assert.equal(catalogTemplateOwnedBy(value.item,{sourceNodeId:'#actual-card',sourceAncestorSelectors:['#mobile-slide']}as never,'desktop'),false);
});
test('a viewport alias never borrows desktop text or image ownership to cover a missing mobile field',()=>{
  for(const property of ['textAtoms','images']){const value=fixture();const mobile=value.evidence.get('mobile')as{blocks:Array<Record<string,unknown>>};mobile.blocks[0][property]=[];assert.throws(()=>validateCatalogSourceOwnership(value.contract,value.manifest,value.evidence,value=>value),/outside its evidenced repeated item at viewport/);}
});
test('unknown viewport names and fabricated aliases need independent matching repeated-owner evidence',()=>{
  const value=fixture();value.item.sourceNodeIds.mobile='#invented';assert.throws(()=>validateCatalogSourceOwnership(value.contract,value.manifest,value.evidence,value=>value),/no observed repeated-item ownership/);
  const renamed=fixture();(renamed.evidence.get('mobile')as{sceneInventory:{viewport:{name:string}}}).sceneInventory.viewport.name='tablet';assert.throws(()=>validateCatalogSourceOwnership(renamed.contract,renamed.manifest,renamed.evidence,value=>value),/viewport/);
});
test('viewport aliases are inferred from exact repeated source copy plus actual media, never from prices or positional indexes alone',()=>{
  const value=fixture();value.manifest.sourceUrl='https://public.example/';
  const observed={id:'products',selectors:['#section'],rect:{x:0,y:0,width:390,height:400},textAtoms:[{selector:'#name-mobile',ancestorSelectors:['#mobile-slide','#section'],text:'Source food',rect:{x:0,y:200,width:180,height:40}}],images:[{selector:'#image-mobile',ancestorSelectors:['#mobile-slide','#section'],url:value.manifest.assets[0].sourceUrl,rect:{x:0,y:0,width:180,height:180}}]};
  const inventory={sourceUrl:value.manifest.sourceUrl,evidencePath:'actual-mobile.json',viewport:{name:'mobile'},items:[{kind:'repeated-template',sourceBlockId:'products',facts:{itemSelectors:['#mobile-slide','#unrelated']}}]}as never;
  let inferred=inferCatalogSourceViewportIdentities({block:value.contract.blocks[0],viewport:'mobile',observed,inventory,manifest:value.manifest});assert.equal(inferred.gaps.length,0);assert.equal(inferred.identities[0].sourceNodeId,'#mobile-slide');
  observed.images[0].ancestorSelectors=['#unrelated','#section'];inferred=inferCatalogSourceViewportIdentities({block:value.contract.blocks[0],viewport:'mobile',observed,inventory,manifest:value.manifest});assert.equal(inferred.identities.length,0);assert.ok(inferred.gaps.some(gap=>gap.code==='source-catalog-viewport-identity-unobserved'));
});
test('new catalog badges and per-item offer facts are frozen as dynamic data while external headings and item controls remain static obligations',()=>{
  const value=fixture(),box={x:0,y:0,width:200,height:30},observed={id:'products',selectors:['#section'],rect:box,textAtoms:[{selector:'#name',ancestorSelectors:['#mobile-slide'],text:'Source food',rect:box},{selector:'#badge',ancestorSelectors:['#mobile-slide'],text:'New',rect:box},{selector:'#offer',ancestorSelectors:['#mobile-slide'],text:'Buy one, get one free',rect:box},{selector:'#external',ancestorSelectors:['#section'],text:'Shop all products',rect:box},{selector:'#quick-view',ancestorSelectors:['#mobile-slide'],text:'Quick view',rect:box}],images:[]};
  const inventory={viewport:{name:'mobile'},items:[{kind:'control',sourceBlockId:'products',selector:'#quick-view'}]}as never;
  const additions=collectCatalogSourceFieldAdditions({block:value.contract.blocks[0],observed,inventory,viewport:'mobile',evidenceId:'actual-mobile'});
  assert.deepEqual(additions.map(row=>row.text.text),['New','Buy one, get one free']);assert.ok(additions.every(row=>row.itemIndex===0&&row.text.kind==='label'&&row.evidence[0]==='actual-mobile'));
  for(const addition of additions){value.contract.blocks[0].texts.push(addition.text);value.item.textIds.push(addition.text.id);}
  assert.equal(collectCatalogSourceFieldAdditions({block:value.contract.blocks[0],observed,inventory,viewport:'mobile',evidenceId:'actual-mobile'}).length,0,'same current item fields are not duplicated on retries');
});
