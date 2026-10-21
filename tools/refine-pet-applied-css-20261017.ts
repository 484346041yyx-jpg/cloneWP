import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {native44Id,native44ModuleClass} from '../src/native44/adapters.js';
import {buildNative44PageCSS,canonicalNative44CSS} from '../src/native44/css-handoff.js';
const run='D:/cloneWP/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c',base=run+'/amendments/20261017-products-and-css',dir=base+'/refinement-01';
await mkdir(dir,{recursive:true});
const json=async(f:string)=>JSON.parse(await readFile(f,'utf8'));
const manifest=await json(base+'/compare-manifest.json'),before=await json(base+'/after.json'),rules=await json(base+'/css-rules.json');
const c=(key:string)=>'.'+native44ModuleClass(key);
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const sort=(v:any):any=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sort(v)])):v;
const canonical=(v:any)=>JSON.stringify(sort(v));
const add=(moduleKey:string,selector:string,declarations:Record<string,string>,reason:string,observedDecoration=false)=>rules.push({moduleKey,selector,declarations:Object.fromEntries(Object.entries(declarations).map(([k,v])=>[k,v+' !important'])),media:'(min-width: 1025px)',reason,evidence:[base+'/applied-layout-observation.json','Source desktop screenshot and immutable source facts'],observedDecoration});
const boxed=(key:string,padding:string)=>{add(key,'',{'padding':'0'},'Keep padding on the actual boxed inner owner; do not apply it twice.');add(key,'> .e-con-inner',{'padding':padding},'Match the observed source content inset on the actual native inner container.');};
boxed('categories-title','0');boxed('categories','30px 96px 24px');
add('categories','.elementor-image-box-img',{'display':'block'},'Remove inline figure baseline spacing while preserving the 120px source picture.');
add('categories','.elementor-image-box-img img',{'display':'block'},'Source circle allocation has no inline text baseline.');
add('header',c('header-logo'),{'width':'34%'},'Match the observed 460px logo-to-search allocation in the 1360px header inner row.');
add('header',c('header-search')+' .elementor-button-content-wrapper',{'justify-content':'flex-start'},'Source search prompt starts at the left inset of the grey field.');
add('header',c('header-notices'),{'height':'44px','min-height':'44px'},'Source secondary header row is 44px high.');
add('header',c('header-notices')+' .e-n-carousel',{'padding-bottom':'0','height':'44px'},'The default 26px outside-pagination reserve duplicates the source in-row fraction toolbar.');
add('header',c('header-notices')+' .swiper-pagination-fraction',{'transform':'none'},'Native outside pagination also translated vertically, moving the counter above its actual arrows.');
add('hero',c('hero-carousel')+' .e-n-carousel',{'padding-bottom':'26px'},'Source hero has a 225px slide and a 26px white pagination band.');
add('hero',c('hero-carousel')+' .swiper-pagination',{'top':'225px','left':'50%','bottom':'auto','transform':'translateX(-50%)','line-height':'26px'},'Place actual native bullets entirely in the observed white band.',true);
add('hero','.elementor-button',{'min-width':'132px','min-height':'48px','display':'inline-flex','align-items':'center','justify-content':'center','border-radius':'8px'},'Match the source 132x48px hero CTA.');
for(const key of ['brands','dog-deals','cat-deals','specialty-deals']){
 boxed(key,key==='brands'?'14px 24px 3px':'14px 24px 24px');
 add(key,'.elementor-heading-title',{'font-size':'33px','line-height':'48px','font-weight':'700'},'The actual source section headings are 33px/48px, not the larger draft default.');
 add(key,'.elementor-image-box-img',{'display':'block','width':'202px','max-width':'100%','margin':'0 auto 5px'},'Source six-column marketing rows use 202px imagery in 232px slots and a small caption gap.');
 add(key,'.elementor-image-box-img img',{'display':'block','width':'202px','max-width':'100%'},'Remove inherited inline image baseline spacing without cropping artwork.');
 add(key,'.elementor-image-box-title',{'font-size':'16px','line-height':'21px','font-weight':key==='brands'?'450':'700'},'Source actual caption text facts use 16px/21px, with bold deal headlines.');
 add(key,'.elementor-image-box-description',{'font-size':'16px','line-height':'21px','font-weight':'450','margin':'0'},'Match the source brand/offer continuation lines with complete unchanged copy.');
 if(key!=='brands')add(key,c(key+'-text-11'),{'right':'210px','top':'15px'},'Source Shop All sits before the local carousel controls rather than overlapping the final arrow.',true);
 if(key!=='specialty-deals'){
  const carousel=c(key+'-carousel');
  add(key,carousel,{'padding-top':'8px','--e-n-carousel-swiper-slides-gap':'0px'},'Source card images start eight pixels below their heading row; six 232px slots fill the 1392px content owner.');
  add(key,carousel+' .e-n-carousel',{'padding-bottom':'0'},'The source fraction toolbar is above the cards, so no second pagination band belongs below.');
  add(key,carousel+' .swiper-pagination-fraction',{'top':'-42px','right':'70px','width':'70px','height':'45px','line-height':'45px','font-size':'16px','font-weight':'700','transform':'none'},'Align actual synchronized source-style fraction with its local top-right arrows.',true);
  for(const [direction,right] of [['prev','146px'],['next','7px']])add(key,carousel+' .elementor-swiper-button-'+direction,{'top':'-42px',right,'width':'44px','height':'45px','transform':'none'},'Observed source controls are 44x45px in the heading toolbar.',true);
 }else add(key,c('specialty-deals-cards'),{'gap':'0','padding-top':'8px'},'All six source specialty cards are visible; preserve their static native row with the same content slots.');
}
add('dog-deals','',{'margin-top':'11px'},'Source has an 11px separation after Featured Brands.');
add('specialty-deals','',{'margin-top':'11px'},'Source has an 11px separation after the cat deal row.');
add('fall','',{'margin-top':'11px'},'Source has an 11px separation before the fall region.');
for(const region of ['halloween','fall']){
 const carousel=c(region+'-products-carousel');
 add(region,carousel+' .e-n-carousel',{'padding-bottom':'0'},'Source seasonal fraction is in its top toolbar, without a lower reserve.');
 add(region,carousel+' .swiper-pagination-fraction',{'transform':'none','top':'0','height':'32px'},'Synchronize the native fraction and arrows on the same toolbar line.',true);
 add(region,'.price .amount',{'color':'#161616'},'Use the source dark price color on real WooCommerce amount spans.');
}
add('benefits',c('benefits-background'),{'padding-bottom':'0'},'Source benefit panel is 237px high; the extra 24px lower padding came from the draft owner.');
add('benefits','',{'margin-bottom':'22px'},'Match the source gap before the empty recently-viewed allocation.');
boxed('services','10px 64px 24px');
add('services','.elementor-image-box-img',{'display':'block'},'Source service picture has no inherited inline figure baseline gap.');
add('services','.elementor-image-box-img img',{'display':'block'},'Keep the full 280x170px service photograph.');
add('services','',{'margin-bottom':'32px'},'The actual source footer starts 32px after services.');
add('footer','',{'padding-top':'20px'},'The source footer has a 20px upper inset inside its background.');
const font='"neue-haas-grotesk-display", Arial, sans-serif';
for(const m of manifest.modules){
 add(m.key,'',{'font-family':font},'Use the exact font family observed and exported from the connected source browser.');
 for(const selector of ['p','.elementor-heading-title','.elementor-image-box-title','.elementor-image-box-description','.elementor-button-text','.wd-list','.wd-entities-title','.price'])add(m.key,selector,{'font-family':font},'Override only native text slots; icon-font pseudo elements keep their actual component font.');
}
const sourceFontPath='C:/Users/Administrator/AppData/Local/Temp/browser-use/assets/816664fe-808c-4e47-bc38-43386227a836/9df708ee0e9f5451.css';
const sourceFont=await readFile(sourceFontPath,'utf8');
const fontFaces=sourceFont.match(/@font-face\s*\{[^}]+\}/g)??[];
if(fontFaces.length!==3||fontFaces.some(face=>!face.includes('neue-haas-grotesk-display')||Array.from(face.matchAll(/url\("([^"]+)"\)/g)).some(m=>new URL(m[1]).origin!=='https://use.typekit.net')))throw Error('Observed source font-face export is inconsistent');
await copyFile(sourceFontPath,dir+'/source-font-browser-export.css');
await writeFile(dir+'/font-provenance.json',JSON.stringify({kind:'user-browser-observed-font-stylesheet',browserId:'6',tabId:'442626435',sourceUrl:'https://www.petsupermarket.com/',stylesheet:'https://use.typekit.net/vxa7myu.css',exportSha256:sha(sourceFont),family:'neue-haas-grotesk-display',weights:[500,600,700],scope:'Only this owned draft page stylesheet; no global font installation',observedAt:new Date().toISOString()},null,2));
const built=buildNative44PageCSS({replicationProfile:manifest.replicationProfile,pageId:15621,modules:manifest.modules,rules,canvasCss:manifest.canvasCss});
// Explicit user-authorized page CSS amendment: observed font-face resources
// stay separate from the original generic geometry-only CSS handoff contract.
const css=fontFaces.join('\n')+'\n'+built.css;canonicalNative44CSS(css);
const elements=structuredClone(before.elements);const find=(nodes:any[],id:string):any=>{for(const n of nodes){if(n.id===id)return n;const got=find(n.elements??[],id);if(got)return got;}};
const bogoId=native44Id(manifest.taskId,'bogo-content'),bogo=find(elements,bogoId);if(!bogo?.settings.background_image)throw Error('Expected erroneous duplicate backdrop owner is missing');delete bogo.settings.background_image;
const settings={...before.settings,custom_css:css},expected={...before,elements,settings,hash:sha(canonical({elements,settings}))};
const request={kind:'explicit-user-visual-refinement',pageId:15621,summary:'Apply CSS and make component layout visually match source; correct observed duplicated inner spacing, pagination transforms, exact font and duplicate BOGO backdrop.',authorization:'Current user explicitly requests direct CSS application, component repair, and visual review.',evidence:[base+'/applied-layout-observation.json','Source browser font stylesheet export',base+'/request.json'],preserveOriginalFrozenTask:true};
await writeFile(dir+'/request.json',JSON.stringify(request,null,2));await writeFile(dir+'/before.json',JSON.stringify(before,null,2));await writeFile(dir+'/expected.json',JSON.stringify(expected,null,2));await writeFile(dir+'/page-custom.css',css);await writeFile(dir+'/css-rules.json',JSON.stringify(rules,null,2));
await writeFile(dir+'/intent.json',JSON.stringify({version:1,kind:'explicit-user-owned-draft-amendment',pageId:15621,runId:manifest.runId,beforeHash:before.hash,expectedHash:expected.hash,requestSha256:sha(await readFile(dir+'/request.json')),replacementIds:[bogoId],payloadSha256:sha(canonical({elements,settings})),cssSha256:sha(css),allowedPageSettingKeys:['custom_css'],status:'prepared',createdAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({status:'visual-refinement-prepared',cssBytes:css.length,expectedHash:expected.hash,fontFaces:fontFaces.length,remoteWrites:0}));
