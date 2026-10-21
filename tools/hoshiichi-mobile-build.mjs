import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as css from 'css-tree';
import {createHash} from 'node:crypto';
const dir='D:/cloneWP/references/hoshiichi-mobile-20261019';
const json=async f=>JSON.parse(await fs.readFile(dir+'/'+f,'utf8'));
const before=await json('current-before.json'), upper=await json('body-upper-mobile-plan.json'), lower=await json('body-lower-mobile-plan.json'), header=await json('header-mobile-plan.json');
const controls=(await json('actual-mobile-controls.json')).controls, text=await json('desktop-text-baseline.json');
const elements=structuredClone(before.snapshot.page.elements), nodes=new Map();
const walk=ns=>ns.forEach(n=>{assert(!nodes.has(n.id));nodes.set(n.id,n);walk(n.elements||[])});walk(elements);
const patches={};
for(const group of [upper.settingsPatches,lower.patches,upper.desktopVisualEquivalentPrerequisites,lower.prerequisites])for(const[id,fields]of Object.entries(group))patches[id]={...patches[id],...fields};
for(const[id,fields]of Object.entries(patches)){
 const node=nodes.get(id);assert(node,'Missing exact node '+id);const fieldsRegistered=controls[node.widgetType||'container'];
 for(const[key,value]of Object.entries(fields)){
  if(key.endsWith('_mobile')){assert(fieldsRegistered[key],'Unregistered '+key);const c=fieldsRegistered[key];if(c.options&&typeof value==='string')assert(Object.hasOwn(c.options,value),'Invalid option '+key+':'+value);}
  else assert(key==='background_background'||key.startsWith('typography_'),'Unexpected desktop prerequisite '+key);
 }
 if(fields.typography_typography==='custom'){
  const t=text.find(t=>t.id===id);assert(t);const px=(value)=>({unit:'px',size:parseFloat(value),sizes:[]});
  fields.typography_font_family='';fields.typography_font_weight=t.fontWeight;
  fields.typography_font_size??=px(t.fontSize);if(t.lineHeight!=='normal')fields.typography_line_height??=px(t.lineHeight);
 }
 node.settings={...node.settings,...fields};
}
// Resolve the CTA image only from this owned page's retained import records.
const assets=JSON.parse(await fs.readFile('D:/cloneWP/references/hoshiichi-20261019-1229/owned-readback.json','utf8'));
const candidates=[];const scan=v=>{if(!v||typeof v!=='object')return;if(typeof v.url==='string'&&Number.isSafeInteger(v.id))candidates.push(v);Object.values(v).forEach(scan)};scan(assets);scan(before.snapshot);
const mediaFiles=await fs.readdir('D:/cloneWP/runs/hoshiichi-20261019-1229-final/body-media/assets');
for(const f of mediaFiles.filter(f=>f.endsWith('.json'))){try{scan(JSON.parse(await fs.readFile('D:/cloneWP/runs/hoshiichi-20261019-1229-final/body-media/assets/'+f,'utf8')))}catch{}}
for(const r of lower.requiredMedia){let found=candidates.find(a=>a.url===r.url);if(!found){const approved=await json('resolved-media.json');found=approved.find(a=>a.url===r.url);}assert(found,'Unresolved media '+r.url);patches[r.nodeId]={...patches[r.nodeId],...r.prerequisite,[r.field]:{id:found.id,url:found.url}};nodes.get(r.nodeId).settings={...nodes.get(r.nodeId).settings,...patches[r.nodeId]};}
const ctaExtra={background_overlay_background:'classic',background_overlay_color:'#ffffff',background_overlay_opacity:{unit:'px',size:0,sizes:[]},background_overlay_opacity_mobile:{unit:'px',size:0.23,sizes:[]},background_position_mobile:'center center',background_size_mobile:'cover',background_repeat_mobile:'no-repeat'};
Object.assign(patches['3ebc620'],ctaExtra);Object.assign(nodes.get('3ebc620').settings,ctaExtra);
// Keep exact desktop cascade positions: split each original rule in place,
// rather than moving declarations to the end of the sheet.
const ast=css.parse(before.snapshot.page.settings.custom_css), released=[];
const movedRules=new WeakSet();
const release=new Map(upper.desktopOnlyDeclarations.map(row=>[css.generate(css.parse(row.selector,{context:'selectorList'})),new Set(row.declarations.map(d=>d.property))]));
css.walk(ast,{visit:'Rule',enter(rule,item,list){
 if(movedRules.has(rule))return;
 const selector=css.generate(rule.prelude), properties=release.get(selector);const removals=[];
 rule.block.children.forEach((d,i)=>{if(d.type==='Declaration'&&(properties?.has(d.property)||d.property==='background-size'&&d.important&&selector.includes('cwp-n44-634e92fa7130')||d.property==='background-image'&&selector==='.elementor-16038 .cwp-n44-061ab7e7d3b7'))removals.push([d,i]);});
 if(!removals.length)return;const desktop=css.clone(rule);desktop.block.children=new css.List();for(const[d,i]of removals){desktop.block.children.appendData(css.clone(d));rule.block.children.remove(i);released.push({selector,property:d.property,value:css.generate(d.value),important:d.important});}
 const media=css.parse('@media(min-width:769px){}').children.first;movedRules.add(desktop);media.block.children.appendData(desktop);list.insertData(media,item.next);
}});
const phoneCSS=upper.mobileCSS+'\n'+lower.nativeBridgeCSS;
assert(!/url\(/i.test(phoneCSS));
const headerCSS=header.mobile.css.replaceAll(':header','body.page-id-16038 .whb-header.whb-header_4112946416031808');
const menuCSS=header.mobile.menuCSS.replaceAll(':mobilemenu','body.page-id-16038 .wd-fs-menu');
const bridge=header.tabletBridgeCSS;
const shell='@media(max-width:768px){body.page-id-16038 .wd-toolbar{display:none}body.page-id-16038{padding-bottom:0}.elementor-16038{overflow-x:clip}}';
const stylesheet=css.generate(ast)+'\n'+phoneCSS+'\n'+bridge+'\n@media(max-width:768px){'+headerCSS+'\n'+menuCSS+'}\n'+shell;
css.parse(stylesheet);
const proposed=header.proposedHeader;
assert.equal(proposed.id,before.snapshot.page.headerId);
for(let r=0;r<proposed.structure.content.length;r++){
 const old=before.snapshot.header.snapshot.module.header.structure.content[r],next=proposed.structure.content[r];
 assert.deepEqual(next.content.filter(c=>c.desktop_only),old.content.filter(c=>c.desktop_only));
 for(const[k,v]of Object.entries(old.params))if(!['hide_mobile','mobile_height'].includes(k))assert.deepEqual(next.params[k],v);
}
assert.deepEqual(proposed.settings,before.snapshot.header.snapshot.module.header.settings);
const patch={authorization:'current-user-mobile-amendment',pageId:16038,maxWidth:768,nodes:Object.entries(patches).map(([id,settings])=>({id,settings})),css:stylesheet,header:proposed};
await fs.writeFile(dir+'/mobile-patch.json',JSON.stringify(patch,null,2));
await fs.writeFile(dir+'/mobile-page-expected.json',JSON.stringify({...before.snapshot.page,elements,settings:{...before.snapshot.page.settings,custom_css:stylesheet}}));
await fs.writeFile(dir+'/mobile-merged.css',stylesheet);
await fs.writeFile(dir+'/mobile-local-validation.json',JSON.stringify({registeredMobileControls:true,unchangedDesktopHeader:true,unchangedBodyTreeAndCopy:true,patchedNodes:patch.nodes.length,releasedDesktopDeclarations:released,patchHash:createHash('sha256').update(JSON.stringify(patch)).digest('hex')},null,2));
console.log(JSON.stringify({patchNodes:patch.nodes.length,released:released.length,cssBytes:Buffer.byteLength(stylesheet),newPages:0}));
