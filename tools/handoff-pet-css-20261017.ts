import {readFile,writeFile} from 'node:fs/promises';
import {recordNative44CSSReview,type Native44CSSReviewRule} from '../src/native44/compare.js';
import {buildNative44PageCSS} from '../src/native44/css-handoff.js';
const run='D:/cloneWP/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c';
const manifest=JSON.parse(await readFile(run+'/compare-manifest.json','utf8'));
const compiled=JSON.parse(await readFile(run+'/compiled.json','utf8'));
const classes=compiled.moduleClasses as Record<string,string>;
const c=(key:string)=>{if(!classes[key])throw Error('Unknown actual component '+key);return '.'+classes[key];};
const rules:Native44CSSReviewRule[]=[];
function add(moduleKey:string,selector:string,declarations:Record<string,string>,reason:string,observedDecoration=false){
 rules.push({moduleKey,selector,declarations:Object.fromEntries(Object.entries(declarations).map(([k,v])=>[k,v+' !important'])),media:'(min-width: 1025px)',reason,evidence:['Actual saved desktop source/target screenshots and module measurements; comparison/report.json','Frozen source browser facts; source-style-notes.json'],parentAttribution:reason,measurementRefs:['desktop-wide','desktop-narrow'].map(viewport=>({viewport,moduleKey,kind:'box' as const})),...(observedDecoration?{observedDecoration:true}:{})});
}
// Most top-level Elementor containers were boxed internally, but padding was
// still based on the wider outer box. Match the observed 1440 px content owner.
for(const m of manifest.modules.filter((m:any)=>m.key!=='footer'))add(m.key,'',{'width':'100%','max-width':'1440px','margin-left':'auto','margin-right':'auto','box-sizing':'border-box'},'Observed source content owners are 1440px centered at 1920 and fill the 1425px client width at 1440; keep container padding inside that same owner.');
add('header',c('header-logo'),{'width':'32%','flex-shrink':'0'},'Header logo column aligns to the source navigation and search owner.');
add('header',c('header-search-slot'),{'background-color':'#f6f6f6','border':'1px solid #b7b7b7','border-radius':'10px','min-height':'43px','padding':'0 10px 0 14px','margin-right':'16px','flex-grow':'1'},'Source search field is one full bordered grey owner; the native button and icon share this parent.');
add('header',c('header-search'),{'flex':'1 1 auto','width':'auto','min-width':'0'},'Search entry occupies available parent width instead of its text content width.');
add('header',c('header-search')+' .elementor-button',{'width':'100%','text-align':'left','background-color':'#f6f6f6','padding':'12px 0','color':'#686868','font-size':'14px','font-weight':'400'},'Match source placeholder appearance without claiming a local product search implementation.');
add('header',c('header-notices'),{'padding-right':'88px','min-height':'44px'},'The source notice and fraction controls share a compact horizontal row.');
add('header',c('header-notices')+' .swiper-pagination-fraction',{'position':'absolute','width':'42px','left':'auto','right':'25px','top':'10px','bottom':'auto','font-size':'13px','line-height':'24px','color':'#0047d2'},'Observed header fraction belongs between its two local arrows.',true);
for(const [direction,right] of [['prev','68px'],['next','4px']])add('header',c('header-notices')+' .elementor-swiper-button-'+direction,{'position':'absolute','top':'22px','left':'auto',right,'width':'20px','height':'24px','font-size':'16px','color':'#0047d2'},'Place the actual native notice arrow beside the owned fraction, as observed in source.',true);
add('promo',c('promo-row'),{'min-height':'89px','height':'89px'},'Source promotional ribbon is 89px high in both desktop observations.');
add('promo',c('promo-text-25'),{'font-size':'28px','line-height':'30px','font-weight':'900','letter-spacing':'0.8px'},'Source promo text fact promo-n25 records 28px/30px; native fallback rendered too large and wrapped.');
add('promo',c('promo-text-25')+' p',{'margin':'0','font-size':'inherit','line-height':'inherit'},'Remove inherited paragraph spacing inside the source ribbon copy owner.');
add('promo',c('promo-text-29')+' p',{'margin':'0','line-height':'18px'},'Source promo supporting line has 18px height with no paragraph gap.');
add('hero',c('hero-carousel')+' .swiper-pagination',{'min-height':'26px','line-height':'26px'},'Source hero keeps a 26px pagination band below the image.');
add('hero',c('hero-carousel')+' .swiper-pagination-bullet',{'width':'12px','height':'12px','background-color':'#dce4e8','opacity':'1'},'Match observed large circular hero pagination markers.');
add('hero',c('hero-carousel')+' .swiper-pagination-bullet-active',{'background-color':'#0047d2'},'The actual active native marker uses the source blue.');
for(const direction of ['prev','next'])add('hero',c('hero-carousel')+' .elementor-swiper-button-'+direction,{'width':'40px','height':'40px','border-radius':'50%','background-color':'#fff','color':'#0047d2','font-size':'20px','justify-content':'center','box-shadow':'0 1px 5px #bdc3cb'},'Source hero arrows are white circular local controls; retain actual clickable native arrows.');
add('hero',c('hero-slide-1'),{'background-color':'#173476'},'Source first hero uses a continuous blue backdrop behind the editable copy and transparent right-side artwork.');
add('categories-title','',{'padding':'0','margin-bottom':'10px'},'Source category heading owns a 36px line followed by a 10px inter-block gap.');
add('categories','',{'padding':'30px 96px 24px'},'Source category grid begins with 30px top inset and ends after its 166px cards plus 24px bottom inset.');
add('categories','.elementor-image-box-img',{'width':'120px','max-width':'100%','margin':'0 auto 30px'},'Actual source category images are 120px circles; the caption starts 30px below each image.');
add('categories','.elementor-image-box-img img',{'width':'120px','height':'120px','object-fit':'contain'},'Use observed circle dimensions without cropping source animals.');
add('categories','.elementor-image-box-title',{'font-size':'13px','line-height':'16px','margin':'0'},'Source category caption typography is 13px/16px.');
add('bogo',c('bogo-background'),{'background-size':'100% auto','background-position':'0% 0%','background-repeat':'no-repeat'},'Source BOGO heading background is one proportional nonrepeating image across its 1440px owner.');
add('bogo',c('bogo-text-9'),{'padding':'18px 0'},'Source BOGO header is 96px high: a 60px title line and 18px top/bottom inset.');
add('bogo',c('bogo-content'),{'background-size':'100% auto','background-position':'0% 0%','background-repeat':'no-repeat'},'Source BOGO body has its own proportional nonrepeating beige backdrop, rather than the default tiled header artwork.');
for(const key of ['brands','dog-deals','cat-deals','specialty-deals']){
 const title=key==='brands'?Object.keys(classes).find(k=>k==='brands-text-8'):key+'-text-8';
 if(title&&classes[title])add(key,c(title),{'text-align':'center','width':'100%'},'Source activity heading spans the parent row and is centered independently of the Shop All link.');
 if(classes[key+'-heading'])add(key,c(key+'-heading'),{'position':'relative','justify-content':'center'},'Give the source title/link row its own local layout owner.');
 if(classes[key+'-text-11'])add(key,c(key+'-text-11'),{'position':'absolute','right':'16px','top':'8px','width':'auto'},'Source Shop All is local right-aligned decoration alongside the centered row title.',true);
 if(key!=='specialty-deals'){
  const carousel=c(key+'-carousel');
  add(key,carousel,{'padding-top':'36px','padding-bottom':'0'},'Source card controls occupy a 36px toolbar above the first card rather than intersecting its picture.');
  add(key,carousel+' .swiper-pagination-fraction',{'position':'absolute','width':'64px','left':'auto','right':'45px','top':'0px','bottom':'auto','line-height':'32px','font-size':'13px','font-weight':'600','color':'#333'},'Observed source card fraction is centered between local top-right arrows.',true);
  for(const [direction,right] of [['prev','126px'],['next','10px']])add(key,carousel+' .elementor-swiper-button-'+direction,{'position':'absolute','top':'16px','left':'auto',right,'width':'32px','height':'32px','border-radius':'50%','background-color':'#fff','color':'#0047d2','font-size':'18px','justify-content':'center','box-shadow':'0 1px 4px #ddd'},'Move the real native control into the observed card toolbar; no decorative duplicate arrows.',true);
 }
 add(key,'.elementor-image-box-img',{'margin-bottom':'12px'},'Source cards have a small image-to-caption gap; native default image spacing adds height.');
 add(key,'.elementor-image-box-title',{'margin':'0','font-size':'16px','line-height':'24px','font-weight':'400'},'Preserve source activity and brand caption metrics in the available font.');
}
for(const key of ['halloween','fall'])add(key,'',{'min-height':'484.594px'},'Preserve the source seasonal region height while its product collection remains an editable user-configured placeholder.');
add('services','',{'padding':'0 64px 24px'},'Source services uses a centered inset grid and about 24px lower whitespace.');
add('services',c('services-text-10'),{'margin-bottom':'30px'},'Source service heading has a 30px gap before the image row.');
add('services','.elementor-image-box-img',{'width':'280px','max-width':'100%','margin':'0 auto 13px'},'Source service photography is 280x170px with a 12.8px caption gap.');
add('services','.elementor-image-box-img img',{'width':'280px','height':'170px','object-fit':'contain'},'Maintain full service artwork at its observed desktop dimensions.');
add('services','.elementor-image-box-title',{'margin':'0','font-size':'18px','line-height':'27px','font-weight':'500'},'Source service caption metrics are 18px/27px.');
add('footer',c('footer-social-row'),{'justify-content':'center','gap':'20px','align-items':'center'},'Source footer groups its brand logo and six icons in one centered row instead of distributing them across the page.');
add('footer',c('footer-image-104'),{'width':'188px','min-width':'188px','flex':'0 0 188px','margin-right':'15px'},'Source footer logo is 188px wide; generic equal-width native row shrinkage reduced it.');
for(const key of [107,109,111,113,115,117])add('footer',c('footer-image-'+key),{'width':'48px','min-width':'48px','flex':'0 0 48px'},'Source footer social icon is about 48px wide; constrain each actual image owner.');
add('footer',c('footer-legal-row'),{'justify-content':'flex-start','gap':'8px','align-items':'center','flex-wrap':'wrap'},'Source legal links form one compact row rather than equal-width columns.');
add('footer',c('footer-text-137'),{'margin-left':'auto'},'Source copyright sits at the far right of the legal row.');
const built=buildNative44PageCSS({replicationProfile:manifest.replicationProfile,pageId:manifest.pageId,modules:manifest.modules,rules,canvasCss:manifest.canvasCss});
await writeFile(run+'/page-custom.css',built.css);
const review=await recordNative44CSSReview(run,{documentHash:manifest.documentHash,parentAttribution:'Differences arise from outer boxed-container padding, registered widget defaults and native carousel control placement; changes stay within the existing page/module owners.',notes:'Reviewed both desktop captures. User deferred both real product collections. This is a manual CSS handoff, not an assertion that CSS has been applied or passed visual verification. Logged-in admin chrome is retained in raw screenshots and identified separately. Source service links remain external. Specialty six-card row is static native content; source controller parity is an acknowledged limitation.',rules});
console.log(JSON.stringify({status:'reviewed-css-handoff',rules:rules.length,cssBytes:Buffer.byteLength(built.css),sha256:built.sha256,remoteWrites:0,observedAt:review.observedAt}));
