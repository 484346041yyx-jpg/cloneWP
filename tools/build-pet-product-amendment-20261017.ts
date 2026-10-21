import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileNative44,usedNative44WidgetTypes} from '../src/native44/compiler.js';
import {native44Id,native44ModuleClass} from '../src/native44/adapters.js';
import {walkNative44,type Native44Component,type Native44Program} from '../src/native44/types.js';
import {loadNative44Knowledge,toNative44CompilerKnowledge} from '../src/native44/knowledge.js';
import {compileEditorElements} from '../src/wordpress/editor-serialization.js';
import {buildNative44PageCSS} from '../src/native44/css-handoff.js';
const root='D:/cloneWP',run=root+'/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c',dir=run+'/amendments/20261017-products-and-css',job=root+'/references/reference-v2-2026-10-17T01-53-33-144Z-www-petsupermarket-com-0f207465';
const json=async(file:string)=>JSON.parse(await readFile(file,'utf8'));
const program:Native44Program=await json(job+'/program.json'),before=await json(dir+'/before.json'),caps=await json(dir+'/capabilities.json'),assets=await json(run+'/assets/imported.json'),catalog=await json(dir+'/target-catalog.json'),manifest=await json(run+'/compare-manifest.json');
const originalProgram=await readFile(job+'/program.json');
catalog.evidence=[dir+'/target-catalog.json',dir+'/product-query-source.json'];
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const sort=(v:any):any=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sort(v)])):v;
const canonical=(v:any)=>JSON.stringify(sort(v));
if(before.hash!==manifest.documentHash)throw Error('Expected original draft mismatch');
const baseNodes=walkNative44(program.blocks),template=baseNodes.find(n=>n.key==='brands-carousel')!;
if(template.kind!=='native-carousel'||!template.slides?.length)throw Error('Actual native carousel template missing');
const cardContainer=structuredClone(template.slides[0]);
let cursor=0;const mappings:any[]=[];
for(const [region,count] of [['halloween',11],['fall',13]] as const){
 const owner=baseNodes.find(n=>n.key===region+'-product-placeholder');
 if(!owner||owner.kind!=='composite'||owner.children.length!==1||owner.children[0].key!==region+'-placeholder-note')throw Error('Exact user-deferred placeholder is missing');
 const slides:Native44Component[]=Array.from({length:count},(_,i)=>{
  const record=catalog.products[cursor++];if(!record?.id)throw Error('Insufficient actual target records');
  const key=region+'-product-'+i;
  mappings.push({region,key,productId:record.id,sourceLogicalSlot:i});
  return {kind:'composite',key:region+'-product-slide-'+i,settings:structuredClone(cardContainer.settings),children:[{kind:'native-products',key,role:'product',widgetType:'wd_products',widgetSettings:{layout:'grid',columns:{unit:'px',size:1,sizes:[]},spacing:'0',product_hover:'button',img_size:'woocommerce_thumbnail',_margin:{unit:'px',top:0,right:0,bottom:0,left:0,isLinked:true},_padding:{unit:'px',top:0,right:0,bottom:0,left:0,isLinked:true}},query:{ids:[record.id],evidence:[dir+'/target-catalog.json',dir+'/product-query-source.json',dir+'/request.json']}}]};
 });
 const carousel:Native44Component={kind:'native-carousel',key:region+'-products-carousel',role:'carousel',widgetType:'nested-carousel',widgetSettings:{...structuredClone(template.widgetSettings),slides_to_show:'5',slides_to_scroll:'1',image_spacing_custom:{unit:'px',size:16,sizes:''}},slides};
 owner.settings={...owner.settings,background_color:'#ffffff',flex_align_items:'stretch',flex_justify_content:'flex-start'};
 owner.children=[carousel];
}
const knowledge=toNative44CompilerKnowledge(await loadNative44Knowledge(usedNative44WidgetTypes(program)),caps.legacySchemas);
// Earlier task slider artifacts used the editor's empty-string sizes marker.
// Recompile with the registered array representation; only two replacement
// subtrees are later taken from this compiler output, all other live nodes stay.
const normalizeSizes=(value:any):void=>{if(Array.isArray(value)){value.forEach(normalizeSizes);return;}if(value&&typeof value==='object'){if(typeof value.unit==='string'&&Object.hasOwn(value,'size')&&value.sizes==='')value.sizes=[];Object.values(value).forEach(normalizeSizes);}};
normalizeSizes(program.blocks);
const compiled=compileNative44(program,{schemas:caps.legacySchemas,assets,knowledge,catalog,targetOrigin:catalog.targetOrigin});
const serialized=compileEditorElements(compiled.composition.elements,caps.legacySchemas,{executionStrategy:'native44-css-handoff'});
const find=(nodes:any[],id:string):any=>{for(const n of nodes){if(n.id===id)return n;const f=find(n.elements??[],id);if(f)return f;}};
const replacements=['halloween','fall'].map(region=>{const id=native44Id(program.taskId,region+'-product-placeholder');const old=find(before.elements,id),replacement=find(serialized,id);if(!old||!replacement)throw Error('Exact replacement owner missing');return{id,before:old,after:replacement};});
const elements=structuredClone(before.elements);
for(const replacement of replacements){const owner=find(elements,replacement.id);Object.keys(owner).forEach(k=>delete owner[k]);Object.assign(owner,replacement.after);}
const cssReview=await json(run+'/css-review.json');
const rules=[...cssReview.rules];
const add=(region:string,selector:string,declarations:Record<string,string>,reason:string,observedDecoration=false)=>rules.push({moduleKey:region,selector,declarations:Object.fromEntries(Object.entries(declarations).map(([k,v])=>[k,v+' !important'])),media:'(min-width: 1025px)',reason,evidence:[dir+'/request.json','Frozen source desktop seasonal product collection and screenshot geometry'],observedDecoration});
for(const region of ['halloween','fall']){
 const carousel='.'+native44ModuleClass(region+'-products-carousel');
 add(region,carousel,{'padding-top':'36px','width':'100%'},'Source seasonal product strip uses a top controls band and five visible cards.');
 add(region,carousel+' .swiper-pagination-fraction',{'position':'absolute','left':'auto','right':'44px','top':'0','bottom':'auto','width':'64px','line-height':'32px','font-size':'13px','font-weight':'600','color':'#333'},'Native synchronized fraction stays between the source top-right arrows.',true);
 for(const [direction,right] of [['prev','126px'],['next','10px']])add(region,carousel+' .elementor-swiper-button-'+direction,{'position':'absolute','top':'16px','left':'auto',right,'width':'32px','height':'32px','border-radius':'50%','background-color':'#fff','color':'#0047d2','font-size':'18px','justify-content':'center','box-shadow':'0 1px 4px #ddd'},'Use the real nested-carousel arrows in the observed local toolbar.',true);
 add(region,'.product-grid-item',{'border':'1px solid #e5e5e5','border-radius':'12px','padding':'14px','background-color':'#fff','text-align':'left','min-height':'405px'},'Source seasonal card is a bordered rounded product component with white body and left aligned facts.');
 add(region,'.product-image-link img',{'height':'200px','width':'100%','object-fit':'contain'},'Keep real target product imagery complete within the source card image allocation.');
 add(region,'.wd-entities-title',{'font-size':'13px','line-height':'18px','font-weight':'500','margin-bottom':'12px','white-space':'normal','max-height':'none','overflow':'visible'},'Keep complete actual product names; product wording differs by explicit user scope.');
 add(region,'.price',{'font-size':'14px','line-height':'21px','font-weight':'600','color':'#161616'},'Match source price scale using the actual target price record.');
}
const css=buildNative44PageCSS({replicationProfile:manifest.replicationProfile,pageId:15621,modules:manifest.modules,rules,canvasCss:manifest.canvasCss});
const settings={...before.settings,custom_css:css.css};
const expectedHash=sha(canonical({elements,settings}));
const payload={elements,settings};
await writeFile(dir+'/amendment-program.json',JSON.stringify(program,null,2));
await writeFile(dir+'/compiled.json',JSON.stringify(compiled,null,2));
await writeFile(dir+'/expected.json',JSON.stringify({...before,...payload,hash:expectedHash},null,2));
await writeFile(dir+'/replacements.json',JSON.stringify(replacements,null,2));
await writeFile(dir+'/product-slot-mapping.json',JSON.stringify(mappings,null,2));
await writeFile(dir+'/page-custom.css',css.css);
await writeFile(dir+'/css-rules.json',JSON.stringify(rules,null,2));
await writeFile(dir+'/intent.json',JSON.stringify({version:1,kind:'explicit-user-owned-draft-amendment',pageId:15621,runId:manifest.runId,beforeHash:before.hash,expectedHash,originalProgramSha256:sha(originalProgram),requestSha256:sha(await readFile(dir+'/request.json')),replacementIds:replacements.map(r=>r.id),nativeProductWidgets:mappings.length,nativeCarouselsAdded:2,cssSha256:css.sha256,payloadSha256:sha(canonical(payload)),allowedPageSettingKeys:['custom_css'],status:'prepared',createdAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({status:'amendment-prepared',replacements:2,productWidgets:mappings.length,expectedHash,cssBytes:css.css.length,remoteWrites:0}));
