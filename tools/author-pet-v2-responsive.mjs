// Authored responsive implementation for this isolated Pet regression only.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {resolvePetResponsiveAssetV2} from './append-pet-v2-responsive.mjs';
import {mapResponsiveBindings,deriveResponsiveEvidenceBindingsV2} from './pet-v2-responsive-mapping.mjs';

const job='D:/cloneWP/references/reference-v2-2026-10-15T04-35-43-856Z-www-petsupermarket-com-67f02b1e';
const hash=b=>createHash('sha256').update(b).digest('hex');
const a=JSON.parse(await fs.readFile(path.join(job,'authored-desktop.json'),'utf8'));
const sourceBytes=await fs.readFile(path.join(job,'source-facts-responsive.json'));
const source=JSON.parse(sourceBytes);
let manifest;try{manifest=JSON.parse(await fs.readFile(path.join(job,'asset-manifest-responsive-authored.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;manifest=JSON.parse(await fs.readFile(path.join(job,'asset-manifest-responsive.json'),'utf8'));}
const flat=bs=>bs.flatMap(b=>[b,...flat(b.children??b.slides??[])]);
const byKey=new Map(flat(a.blocks).map(b=>[b.key,b]));
const packetsByViewport={};
for(const snapshot of source.snapshots){packetsByViewport[snapshot.viewport.name]={};for(const ref of snapshot.evidence){const p=JSON.parse(await fs.readFile(ref.path,'utf8'));for(const r of p.regions)packetsByViewport[snapshot.viewport.name][r.id]=p;}}
packetsByViewport.narrow=packetsByViewport['desktop-narrow'];
const desktopSnapshot=source.snapshots.find(s=>s.viewport.name==='desktop');
const frozenPlanBytes=await fs.readFile(path.join(job,'component-plan-desktop-reviewed.json'));
a.desktopComponentPlan={path:'component-plan-desktop-reviewed.json',sha256:hash(frozenPlanBytes)};
a.bindings=deriveResponsiveEvidenceBindingsV2({bindings:a.bindings,adaptations:a.adaptations,sourceFacts:source,desktopPackets:packetsByViewport.desktop,desktopSnapshotId:desktopSnapshot.id,componentPlan:JSON.parse(frozenPlanBytes)});
const mediaVariants=JSON.parse(await fs.readFile(path.join(job,'explicit-media-variants-responsive.json'),'utf8')).variants;
let nodeVariants=[];try{nodeVariants=JSON.parse(await fs.readFile(path.join(job,'explicit-node-variants-responsive.json'),'utf8')).declarations;}catch(e){if(e.code!=='ENOENT')throw e;}
const sourceMappings=['narrow','tablet','mobile'].map(viewport=>mapResponsiveBindings({desktopPackets:packetsByViewport.desktop,variantPackets:packetsByViewport[viewport],bindings:a.bindings,explicitMediaVariants:mediaVariants,explicitNodeVariants:nodeVariants}));
const dim=(t=0,r=t,b=t,l=r)=>({unit:'px',top:String(t),right:String(r),bottom:String(b),left:String(l),isLinked:t===r&&r===b&&b===l});
const addCss=(b,css)=>b.responsiveCss=(b.responsiveCss??'')+css;
const mediaUrl=(p,id,kind)=>{let us=Object.values(p.usages).filter(u=>u.nodeId===id);const u=us.find(u=>kind==='background'?u.kind==='css-background'||u.attribute==='background-image':u.attribute==='src');return u&&p.resources[u.resourceId].url;};
async function asset(url,alt=''){
 let old=manifest.assets.find(x=>(x.observedResourceUrl??x.sourceUrl)===url);if(old){if(hash(await fs.readFile(path.join(job,old.localPath)))!==old.sha256)throw Error('Changed responsive asset bytes');return old.key;}
 const resource=Object.values(packetsByViewport).flatMap(ps=>Object.values(ps)).flatMap(p=>Object.values(p.resources)).find(r=>r.url===url);if(!resource)throw Error('Asset has no actual current-job observation');
 const item=await resolvePetResponsiveAssetV2({jobDir:job,resource,assets:manifest.assets,alt});await fs.writeFile(path.join(job,'asset-manifest-responsive-authored.json'),JSON.stringify(manifest,null,2)+'\n');return item.key;
}
// Each slot keeps the same component owner; responsive files are distinct from
// repeated use sites and are imported only by the responsive stage projection.
for(const b of flat(a.blocks).filter(b=>b.kind==='html-static')){
 const binding=a.bindings.find(x=>x.componentKey===b.key);if(!binding)continue;
 for(const[slot,ids]of Object.entries(binding.slotNodes?.media??{})){
  const region=binding.regionIds.find(r=>packetsByViewport.desktop[r]?.nodes[ids[0]]);if(!region)continue;
  const kind=b.template.includes('data-cwp-background="'+slot+'"')?'background':'image';
  for(const[vp,media]of [['tablet','(min-width:769px) and (max-width:1024px)'],['mobile','(max-width:768px)']]){
   const p=packetsByViewport[vp][region],mapping=sourceMappings.flatMap(r=>r.mappings).find(m=>m.componentKey===b.key&&m.snapshotId===p.snapshot.id),variantNode=mapping?.slotNodes?.media?.[slot]?.[0];
   if(!variantNode)throw Error('Responsive media has no independently proved owner '+b.key+'/'+slot+'/'+vp);
   const url=mediaUrl(p,variantNode,kind);if(!url)continue;
   const key=await asset(url,b.slots.media[slot].alt??'');if(key!==b.slots.media[slot].assetKey)(b.slots.media[slot].responsive??=[]).push({assetKey:key,media});
  }
 }
}
// Source header's mobile drawer becomes a real script-free disclosure. It
// retains all observed destinations, and desktop hover remains CSS-operated.
const header=byKey.get('header');
header.template=header.template.replace('<div class="shop-group"><a class="shop" data-cwp-link="shop">','<details class="shop-group"><summary class="shop">').replace('</span></a><div class="mega">','</span></summary><div class="mega">').replace('</div></div><div class="promo-space">','</div></details><div class="promo-space">');
delete header.slots.links.shop;delete a.bindings.find(x=>x.componentKey==='header').slotNodes.links.shop;
header.css+=':scope summary.shop{list-style:none;cursor:pointer}:scope summary.shop::-webkit-details-marker{display:none}:scope details[open] .mega{display:grid}@media(min-width:769px){:scope details::details-content{content-visibility:visible}}';
addCss(header,'@media(max-width:1439px) and (min-width:1025px){:scope .top{padding:0 40px;gap:25px}:scope .search{width:700px;min-width:0;flex:1;max-width:700px}}@media(max-width:1024px){:scope .top{height:134px;padding:12px 32px 16px;display:grid;grid-template-columns:1fr auto;gap:10px}:scope .logo{grid-column:1;grid-row:1}:scope .businesses{grid-column:2;grid-row:1}:scope .search{grid-column:1/-1;grid-row:2;width:100%;margin:0}:scope .nav-row{height:98px;padding-top:45px}:scope .nav-track,:scope .nav-deals{display:none}:scope .shop{padding:10px 32px}:scope .mega{top:98px;grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:768px){:scope .top{height:122.391px;padding:12px 16px 14px;gap:10px}:scope .logo{width:113px;margin-left:44px}:scope .logo img{width:113px;height:auto}:scope .businesses{gap:17px}:scope .business{font-size:0}:scope .business-icon{height:26px;font-size:25px}:scope .search{height:42px;font-size:14px;overflow:hidden}:scope [data-cwp-text="search"]{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}:scope .nav-row{height:60px;padding:0}:scope .nav-services{display:none}:scope .shop-group{position:static}:scope .shop{position:absolute;top:-110px;left:16px;padding:3px 6px;border-radius:4px;background:#eaf0fc;font-size:22px;z-index:25}:scope [data-cwp-text="shop"]{display:none}:scope .mega{position:absolute;top:0;left:0;width:100%;max-height:65vh;grid-template-columns:repeat(2,minmax(0,1fr));font-size:13px;padding:14px;z-index:30}:scope .shop-group:hover:not([open]) .mega,:scope .shop-group:focus-within:not([open]) .mega{display:none}}');
const offers=byKey.get('header-offers');offers.settings.custom_css+='@media(max-width:1439px) and (min-width:1025px){selector{left:calc(50% - 348px);width:665px;}}@media(max-width:1024px){selector{top:134px;left:0;width:100%;}selector .elementor-swiper-button-prev{right:84px;}selector .elementor-swiper-button-next{right:32px;}selector .swiper-pagination-fraction{right:48px;}}@media(max-width:768px){selector{top:122.391px;height:60px;}selector .swiper-pagination-fraction{height:60px;right:42px;}selector .elementor-swiper-button-prev{right:86px;}selector .elementor-swiper-button-next{right:22px;}}';
// NativeCarousel has no responsiveCss field: keep the narrow-only container
// rule in its real scoped native CSS control, with the normal desktop gate.
offers.settings.custom_css+='@media(max-width:1439px) and (min-width:1025px){selector{left:auto;right:400px;width:min(665px,calc(100% - 530px));}}';
// The source hides these mobile business labels while retaining their icons.
// font-size:0 alone leaves inline boxes with a nonzero inherited line height.
addCss(header,'@media(max-width:768px){:scope [data-cwp-text="store"],:scope [data-cwp-text="account"],:scope [data-cwp-text="cart"]{display:none}}');
// Tablet uses the same native disclosure. Closing it must also suppress the
// desktop hover/focus presentation while the pointer remains on its summary.
addCss(header,'@media(max-width:1024px){:scope .shop-group:hover:not([open]) .mega,:scope .shop-group:focus-within:not([open]) .mega{display:none}}');
// The installed native widget defaults to two tablet slides even when the
// desktop value is one. These two observed interaction blocks show one at all
// widths; freeze the actual responsive controls rather than inherit defaults.
for(const key of ['header-offers','hero'])for(const viewport of ['tablet','mobile']){
 byKey.get(key).widgetSettings['slides_to_show_'+viewport]='1';
 byKey.get(key).widgetSettings['slides_to_scroll_'+viewport]='1';
}
for(let i=0;i<6;i++)addCss(byKey.get('header-offer-'+i),'@media(max-width:1024px){:scope .notice{justify-content:center;height:45px;padding-right:120px;padding-left:90px;white-space:normal;gap:3px}}@media(max-width:768px){:scope .notice{height:60px;padding:5px 120px 5px 42px;display:block;text-align:center;font-size:12px;line-height:17px}}');
for(let i=0;i<6;i++)addCss(byKey.get('header-offer-'+i),'@media(max-width:1439px) and (min-width:1025px){:scope .notice{display:block;white-space:normal;line-height:18px;padding-top:4px;padding-bottom:4px;text-align:right}:scope .notice>a{display:inline-block;margin-left:4px}}');
const promo=byKey.get('promo');promo.settings.margin_mobile=dim();addCss(promo,'@media(max-width:1439px) and (min-width:1025px){:scope .thin{height:auto;min-height:88px;padding-right:28px;grid-template-columns:50% 1fr auto}:scope strong{font-size:28px;white-space:normal}:scope .logos img{height:auto}}@media(max-width:1024px){:scope .thin{height:77px;grid-template-columns:50% 1fr auto;padding-right:10px;gap:4px}:scope .logos img{height:77px;object-fit:fill}:scope strong{font-size:20px;line-height:22px;white-space:normal}:scope .copy p{display:none}:scope .cta{padding:12px 26px}:scope .terms{line-height:18px}}@media(max-width:768px){:scope .thin{height:178.422px;display:grid;grid-template-columns:2fr 1fr;grid-template-rows:109px 69.422px;padding:0;gap:0}:scope .logos{grid-column:1/-1}:scope .logos img{height:109px;object-fit:fill}:scope .copy{grid-column:1;line-height:19px;padding:0 8px}:scope strong{font-size:20px;line-height:21px}:scope .copy .terms{font-size:16px;line-height:20px}:scope .cta{grid-column:2;padding:10px 12px;margin-right:7px;min-height:48px;white-space:nowrap}}');
const hero=byKey.get('hero');hero.settings.margin_tablet=dim(29.532,0,0,0);hero.settings.margin_mobile=dim(14.25,0,0,0);hero.settings.custom_css+='@media(max-width:1024px){selector .elementor-swiper-button{top:98.875px;}}@media(max-width:768px){selector .elementor-swiper-button{top:146px;width:32px;height:32px;}selector .elementor-swiper-button-prev{left:8px;}selector .elementor-swiper-button-next{right:8px;}}';
// The source has separate outer and negative-margin inner frames on mobile.
// Keep both real boxes, clip only at the outer frame and retain both CTA nodes.
promo.template=promo.template.replace('<div class="frame thin">','<div class="frame promo-outer"><div class="thin">')+'</div>';
a.bindings.find(x=>x.componentKey==='promo').layoutNodes['promo--n1'].selector='#cwp-17eb85a .promo-outer';
addCss(promo,'@media(max-width:1024px){:scope .cta{display:none}:scope .mobile-cta{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 26px;background:#ffc000;color:#3d3935;border-radius:8px;font-size:16px;font-weight:600;line-height:22px;white-space:nowrap}}@media(max-width:768px){:scope .promo-outer{overflow:hidden}:scope .thin{width:calc(100% + 40px);margin:0 -20px;grid-template-columns:65% 35%;grid-template-rows:105.422px 73px}:scope .logos{padding:0 16px;align-self:start}:scope .logos img{height:auto;object-fit:contain}:scope .copy{align-self:start}:scope .copy strong{display:block;font-size:19px;line-height:22px}:scope .copy .terms{display:block;line-height:19px;margin-top:2px}:scope .mobile-cta{grid-column:2;justify-self:center;align-self:start;margin:1.562px 0 0;padding:12px 26px}}');
// Source heading and footnote have separate block flow. Keep the intentional
// negative-margin CTA bleed while giving only the mobile copy a safe inset.
addCss(promo,'@media(max-width:1024px){:scope .copy strong,:scope .copy .terms{display:block}:scope .copy .terms{margin-top:4px}}@media(max-width:768px){:scope .copy{padding-left:28px;padding-right:8px}}');
// The mobile logo keeps its intrinsic aspect ratio at every intermediate width.
// Split the existing 105.422px minimum into a 102.422px row plus 3px glyph
// clearance: the 390px copy position is unchanged while wider logos grow.
addCss(promo,'@media(max-width:768px){:scope .thin{height:auto;grid-template-rows:minmax(102.422px,auto) minmax(73px,auto);row-gap:3px}}');
for(let i=0;i<5;i++){
 const b=byKey.get('hero-slide-'+i);
 if(i<3){
  if(i===0)b.template=b.template.replace('<p data-cwp-text="body0"></p>','<p class="desktop-source-copy" data-cwp-text="body0"></p><p class="mobile-source-copy" data-cwp-text="mobile-copy"></p>').replace('</div><p class="mobile-source-copy" data-cwp-text="mobile-copy"></p>','</div>');
  if(i===2)b.template=b.template.replace('<h2>','<h2 class="desktop-source-copy">').replace('</h2>','</h2><h2 class="mobile-source-copy" data-cwp-text="mobile-copy"></h2>').replace('</div><p class="mobile-source-copy" data-cwp-text="mobile-copy"></p>','</div>');
  addCss(b,'@media(max-width:1024px){:scope .hero-content{height:197.75px}:scope .visual img{height:197.75px;object-fit:fill}:scope h2,:scope .heading-1{font-size:30px;line-height:31px}:scope .copy{padding:6px 24px;gap:5px}:scope .copy p{font-size:16px;line-height:24px}:scope .copy .cta{margin-top:0}}@media(max-width:768px){:scope .hero-content{height:auto;min-height:296.125px;grid-template-columns:1fr;grid-template-rows:auto 1fr}:scope .visual{grid-row:1}:scope .visual img{height:auto;object-fit:contain}:scope .copy{grid-row:2;padding:0 24px 8px;gap:0;justify-content:center}:scope h2,:scope .heading-1{font-size:22px;line-height:24px}:scope .copy p{font-size:14px;line-height:24px}:scope .copy .cta{margin-top:0}}');
  if(i===0)addCss(b,'@media(max-width:1024px){:scope .desktop-source-copy{display:none}:scope .mobile-source-copy{display:block}:scope h2 .heading-0,:scope h2 .heading-1{font-size:30px;line-height:31px}}@media(max-width:768px){:scope .hero-content{min-height:254.531px}:scope h2 .heading-0,:scope h2 .heading-1{font-size:22px;line-height:24px}}');
  if(i===1)addCss(b,'@media(max-width:1024px){:scope h2{font-size:26px;line-height:27px}:scope .copy p:nth-of-type(2){font-size:17px;line-height:18.5px}}@media(max-width:768px){:scope .hero-content{min-height:232.891px}:scope h2{font-size:22px;line-height:24px}:scope .copy p:nth-of-type(2){display:none}}');
  if(i===2)addCss(b,'@media(max-width:1024px){:scope .desktop-source-copy{display:none}:scope .mobile-source-copy{display:block;font-size:26px;line-height:26px}}@media(max-width:768px){:scope .mobile-source-copy{font-size:22px;line-height:24px}}');
 }else addCss(b,'@media(max-width:1024px){:scope .dual{height:197.75px}:scope .dual img{height:197.75px;object-fit:fill}}@media(max-width:768px){:scope .dual{height:auto;min-height:253.906px;display:flex;flex-direction:column}:scope .dual a{width:100%}:scope .dual img{height:auto;object-fit:contain}}');
}
// Native catalog controls keep frozen record sets. Product fields remain WooCommerce.
for(const region of ['halloween-products','fall-products']){
 const b=byKey.get(region),campaign=byKey.get(region+'-campaign'),q=byKey.get(region+'-query');
 b.settings.flex_direction_mobile='column';b.settings.custom_css+='@media(max-width:1024px){selector{min-height:0;}}';
 campaign.settings.width_mobile={unit:'%',size:100,sizes:[]};q.settings.width_mobile={unit:'%',size:100,sizes:[]};
 q.widgetSettings.slides_per_view_tablet={unit:'px',size:5,sizes:[]};q.widgetSettings.slides_per_view_mobile={unit:'px',size:1,sizes:[]};
 q.widgetSettings.hide_pagination_control_tablet='no';q.widgetSettings.hide_pagination_control_mobile='no';
 q.settings.padding_mobile=dim(36,42,64,42);
 addCss(campaign,'@media(max-width:768px){:scope .campaign img{aspect-ratio:768/550;object-fit:cover}}');
 q.widgetSettings.custom_css+='@media(max-width:1024px){selector .product-wrapper{min-height:280px;}selector .product-element-top{height:148px;padding:25px 12px 0;}selector .product-element-top img{width:67px;height:67px;}selector .wd-entities-title,selector .wd-entities-title a{font-size:14px!important;line-height:20px!important;}selector .price,selector .price .amount,selector .price bdi{font-size:20px!important;}selector .wd-nav-pagin-wrap{top:auto;bottom:-42px;right:50%;transform:translateX(50%);}}@media(max-width:768px){selector .product-wrapper{min-height:475px;}selector .product-element-top{height:315px;padding:28px 18px 0;}selector .product-element-top img{width:256px;height:256px;}selector .wd-entities-title,selector .wd-entities-title a{font-size:14px!important;line-height:20px!important;}selector .price,selector .price .amount,selector .price bdi{font-size:20px!important;}selector .wd-nav-arrows{top:auto;bottom:-44px;right:10px;}}';
}
const module=await import('./pet-v2-responsive-marketing.mjs');const marketing=await module.applyPetResponsiveMarketing({authored:a,packetsByViewport,breakpoints:{mobile:768,tablet:1024}});Object.assign(a,marketing.authored);
const sourceVariantModule=await import('./pet-v2-source-variants.mjs');
const sourceVariants=sourceVariantModule.applyPetSourceVariantsV2({authored:a,packetsByViewport,sourceFacts:source,responsiveMappings:sourceMappings});Object.assign(a,sourceVariants.authored);
a.bindings=deriveResponsiveEvidenceBindingsV2({bindings:a.bindings,adaptations:a.adaptations,sourceFacts:source,desktopPackets:packetsByViewport.desktop,desktopSnapshotId:desktopSnapshot.id,componentPlan:JSON.parse(frozenPlanBytes)});
await fs.writeFile(path.join(job,'source-variant-decisions-responsive.json'),JSON.stringify({sourceFactsHash:hash(sourceBytes),decisions:sourceVariants.decisions},null,2)+'\n');
a.responsiveMappings=['narrow','tablet','mobile'].map(viewport=>mapResponsiveBindings({desktopPackets:packetsByViewport.desktop,variantPackets:packetsByViewport[viewport],bindings:a.bindings,explicitMediaVariants:mediaVariants,explicitNodeVariants:nodeVariants}));
// Copy decisions only through the independently replayed ownership pairs.
for(const snapshot of source.snapshots.filter(s=>s.viewport.name!=='desktop')){
 const maps=a.responsiveMappings.flatMap(r=>r.mappings).filter(m=>m.snapshotId===snapshot.id),pairs=new Map();
 for(const m of maps)for(const p of m.nodeMappings){if(pairs.has(p.desktopNodeId)&&pairs.get(p.desktopNodeId)!==p.variantNodeId)throw Error('Ambiguous authored responsive node');pairs.set(p.desktopNodeId,p.variantNodeId);}
 const sourceFacts=Object.values(source.facts).filter(f=>f.snapshotId===snapshot.id);
 for(const old of a.adaptations.filter(x=>!x.snapshotId&&x.target?.componentKey==='header'&&x.target?.property==='hover')){
  const target=snapshot.viewport.name==='mobile'?{...old.target,selector:old.target.selector.replace(' .shop-group',' details.shop-group'),property:'disclosure',expected:{target:'.mega',initialOpen:false}}:structuredClone(old.target);
  const ids=(old.sourceFactIds??[]).flatMap(id=>{const f=source.facts[id],mapped=f&&pairs.get(f.nodeId);return sourceFacts.filter(v=>v.nodeId===mapped&&v.kind===f.kind&&v.value.kind===f.value.kind&&v.value.purpose===f.value.purpose).map(v=>v.id);});
  const nodes=(old.sourceNodeIds??[]).map(id=>pairs.get(id)).filter(Boolean);
  if(ids.length||nodes.length)a.adaptations.push({...structuredClone(old),snapshotId:snapshot.id,sourceFactIds:ids,sourceNodeIds:nodes,target,rule:snapshot.viewport.name==='mobile'?'Adapt the source JavaScript drawer/submenus to one real native HTML details disclosure. Verify summary click, keyboard close, restored state and all original external destinations.':'Retain the actual hover/focus menu at this observed wider viewport and verify its real open/close while native summary remains available.'});
 }
}
a.sourceFactsFile='source-facts-responsive.json';a.assetsManifestFile='asset-manifest-responsive-authored.json';a.sourceHash=hash(sourceBytes);
await fs.writeFile(path.join(job,'authored-responsive.json'),JSON.stringify(a,null,2)+'\n');
await fs.writeFile(path.join(job,'asset-manifest-responsive-authored.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({components:flat(a.blocks).length,assets:manifest.assets.length,sourceHash:a.sourceHash}));
