// Explicit decisions for the current observed Pet desktop. These are not generic omission rules.
import {createHash} from 'node:crypto';
export function addPetDesktopDecisions({taskId,source,packets,blocks,bindings,adaptations}){
 const id=key=>createHash('sha256').update(`clonewp-replica-v2:${taskId}:${key}`).digest('hex').slice(0,7);
 const root=key=>`[data-id="${id(key)}"]`,scope=key=>`#cwp-${id(key+'-content')}`;
 const layoutMap={header:['header','.frame'],promo:['promo','.thin'],hero:['hero','>.e-con-inner'],'category-title':['category-heading',''],categories:['category-tiles','.pets'],bogo:['bogo','.bogo-frame'],'halloween-products':['halloween-products','>.e-con-inner'],brands:['brands',''],'dog-deals':['dog-deals',''],'cat-deals':['cat-deals',''],'other-deals':['other-deals',''],'fall-products':['fall-products','>.e-con-inner'],'shop-way':['shop-way','.services-frame'],'recently-viewed':['recently-viewed','.empty-personalization'],services:['services','.services-frame'],footer:['footer','.replica-footer']};
 const get=(key)=>{const find=bs=>bs.flatMap(b=>[b,...find(b.children??b.slides??[])]);return find(blocks).find(b=>b.key===key);};
 for(const[region,[key,local]]of Object.entries(layoutMap)){
  const b=bindings.find(b=>b.componentKey===key),p=packets[region],r=p.regions[0],program=get(key);
  const selector=(program.kind==='html-static'?scope(key):root(key))+(local?' '+local:'');
  b.layoutNodes??={};for(let nodeId of new Set([r.nodeId,r.contentNodeId]))b.layoutNodes[nodeId]={selector,dimensions:['x','width',...(!['halloween-products','fall-products','footer'].includes(region)?['height']:[])],adaptHeight:['halloween-products','fall-products','footer'].includes(region),rule:['halloween-products','fall-products'].includes(region)?'Keep the centered 1440px source product/campaign frame. Native target product text may change natural height; source side-campaign ratio and independent product styling are still required.':'Preserve the same observed content frame, bounded center and natural section dimensions.'};
  if(region==='footer')b.layoutNodes[r.contentNodeId]={selector:scope(key)+' .footer-legal',dimensions:['width'],adaptHeight:true,rule:'Source legal background bleeds 7.5px beyond both client edges. Adapt it to full client width without horizontal overflow; main footer content remains centered at 1440px.'};
 }
 const header=get('header'),hp=packets.header;
 const ancestor=(p,nodeId)=>{const result=[];let n=p.nodes[nodeId];while(n){result.push(n);n=p.nodes[n.parentId];}return result;};
 const explicit=(f,target,rule)=>adaptations.push({componentKey:target.componentKey,sourceFactIds:[f.id],target,rule});
 const external=(f,slot,rule)=>explicit(f,{componentKey:'header',kind:'external',slot,expected:header.slots.links[slot].url},rule);
 const menuTarget={componentKey:'header',kind:'interaction',selector:scope('header')+' .shop-group',property:'hover',expected:{target:'.mega',styles:{display:'grid'},restoredStyles:{display:'none'}}};
 for(const f of Object.values(source.facts).filter(f=>f.regionId==='header')){
  const n=hp.nodes[f.nodeId],chain=ancestor(hp,f.nodeId),classes=chain.map(n=>n.attributes.class??'').join(' ');
  if(f.kind==='interaction'&&f.value.kind==='link'&&/^javascript:/.test(f.value.href??'')){
   if(/findStoreLink|btn-get-in-store/.test(classes))explicit(f,{componentKey:'header',kind:'external',slot:'store',expected:header.slots.links.store.url},'Replace the source JavaScript store dialog trigger with the separately observed real source Store Locator external URL. No local location form is claimed.');
   else if(/account|loyalty|vip-rewards|user-info/i.test(classes))explicit(f,{componentKey:'header',kind:'external',slot:'account',expected:header.slots.links.account.url},'Source account/session dialog remains an external sign-in service; this source JavaScript trigger is adapted to the observed Sign In destination.');
   else explicit(f,menuTarget,'Replace nested source JavaScript drawer/back/submenu triggers with one CSS hover/focus mega menu. Verify actual open/close; every retained destination is separately checked as a real external link.');
  }
  if(f.kind==='interaction'&&f.value.kind==='control'){
   const label=f.value.details?.label??'';
   if(/^(?:Previous|Next|Turn (?:off|on) the autoplay|[1-6])$/.test(label))explicit(f,{componentKey:'header-offers',kind:'interaction',selector:root('header-offers-carousel'),property:'carousel',expected:{manual:true}},'Both source promotion controller variants are replaced by the same manual native carousel; verify arrow movement, synchronized fraction and restoration once.');
   else if(/search|clear-search/i.test(classes)||/search|submit/.test(n.attributes.type??''))external(f,'search','Search input/clear/submit controls remain in the actual external source search service. The draft exposes its verified clickable entry.');
   else if(/cart|account|loyalty|user-info/i.test(classes)||f.value.details?.type==='hidden')external(f,/cart/i.test(classes)?'cart':'account','Hidden business/session form state remains in the source business service. No local hidden input or transaction service is fabricated.');
   else explicit(f,menuTarget,'The source drawer, close, back and nested category controls are adapted to the flat CSS hover/focus menu. Its real open/close state and each actual destination are verified.');
  }
  if(f.kind==='text'&&/^3 \/ 6$/.test(f.value.text))explicit(f,{componentKey:'header-offers',kind:'interaction',selector:root('header-offers-carousel'),property:'carousel',expected:{manual:true}},'Source transient promotion index is generated by the manual native fraction; the source selected index is not hardcoded.');
  if(f.kind==='text'&&!f.value.visible&&/^[1-6]$/.test(f.value.text))explicit(f,{componentKey:'header-offers',kind:'interaction',selector:root('header-offers-carousel'),property:'carousel',expected:{manual:true}},'Hidden source promotion pagination labels are represented by the synchronized native fraction, with no duplicated inactive pagination UI.');
  if(f.kind==='text'&&!f.value.visible){
   if(/^(?:VIP Exclusive Offer|My Account|VIP Rewards member|PAW MEMBER)$/.test(f.value.text))external(f,'account','This hidden session-specific account label belongs to the external source account service; it is not presented as a working local rewards account.');
   else if(f.value.text==='Clear')external(f,'search','The hidden clear-input function belongs to source search; this draft has a clickable source search entry instead of a fake input.');
   else if(f.value.text==='Go Back')explicit(f,menuTarget,'Nested mobile/back navigation is adapted to a single desktop hover/focus menu and a later explicit responsive variant. No inactive back button is displayed.');
   else if(/service-description|service-title|subheading/.test(n.attributes.class??'')||f.value.text==='Read More')external(f,'services','The source hidden service-detail panel remains behind its verified source Services entrance. Main-page service cards retain their own original images and wording.');
  }
  if(f.kind==='media'){
   const resource=f.value.resource;
   if(resource.kind==='svg'&&(!n.visible||/header--n1870/.test(n.id))&&!['header--n741','header--n751','header--n756','header--n769','header--n979'].includes(n.id)){
    if(/account|user-info|loyalty|rewards/i.test(classes))external(f,'account','This small hidden account icon is adapted to the verified external Sign In entrance; it does not introduce a local account panel.');
    else if(/search/.test(classes))external(f,'search','This minor hidden search/clear icon belongs to external source search and is adapted to its verified entry.');
    else if(n.id==='header--n1870')external(f,'services','The small service-bookmark decoration is simplified while the adjacent Book Services wording and actual source destination are preserved.');
    else explicit(f,menuTarget,'Nested navigation chevrons and hidden drawer icons are simplified into the verified CSS hover/focus menu. No source decorative SVG equality is claimed.');
   }
   if(!n.visible&&resource.kind!=='svg'&&/service-category-image|badge-image/.test(n.attributes.class??''))external(f,'services','Hidden service-menu imagery remains in the source Services destination; the main services block retains its own visible image/card relationships.');
   if(!n.visible&&n.attributes.class==='minicart-icon')external(f,'cart','The hidden alternate cart icon belongs to the external source cart service. The desktop cart entry remains visible.');
   if(!n.visible&&/halloween-icon\.svg/.test(resource.url))explicit(f,menuTarget,'This collapsed menu category decoration is simplified in the flat hover/focus menu; main Halloween campaign imagery remains unchanged.');
   if(/\/icons\/carousel\/arrow-(?:left|right)\.svg/.test(resource.url))explicit(f,{componentKey:'header-offers',kind:'interaction',selector:root('header-offers-carousel'),property:'carousel',expected:{manual:true}},'The alternate source promotion-arrow artwork is represented by the same functional native manual controller; no duplicate hidden arrow images are emitted.');
  }
  if(f.kind==='interaction'&&f.value.kind==='carousel'&&f.nodeId==='header--n806')explicit(f,{componentKey:'header-offers',kind:'interaction',selector:root('header-offers-carousel'),property:'carousel',expected:{manual:true}},'Source desktop and mobile duplicated promotion tracks map to one native manual carousel with responsive geometry; verify its physical arrow movement, pagination and restoration.');
 }
 for(const f of Object.values(source.facts)){
  if(f.regionId==='promo'&&['promo--n39','promo--n40','promo--n42'].includes(f.nodeId))explicit(f,{componentKey:'promo',kind:'external',slot:'terms',expected:'https://www.petsupermarket.com/#'},'The source restrictions dialog and its close control remain on the actual source page. Preserve the Restrictions entry as a source external link; do not claim to implement a local legal-dialog state.');
  if(f.regionId==='hero'&&f.kind==='text'&&f.value.text==='1/1')explicit(f,{componentKey:'hero',kind:'interaction',selector:root('hero-carousel'),property:'carousel',expected:{manual:true}},'The inactive source mobile fraction is replaced by the actual native synchronized pagination, not a static 1/1 label.');
  if(f.regionId==='recently-viewed'&&f.kind!=='layout'&&f.kind!=='region')explicit(f,{componentKey:'recently-viewed',kind:'presence',selector:scope('recently-viewed')+' .empty-personalization',expected:true},'This observed source history module has zero visible items and an empty 24px region. Retain that empty scene; omit its hidden Recently Viewed title, inert counters and arrows instead of inventing browsing history.');
  if(f.regionId==='footer'){
   const p=packets.footer,n=p.nodes[f.nodeId];
   if(['footer--n17','footer--n39','footer--n61','footer--n83'].includes(f.nodeId)&&f.kind!=='layout'&&f.kind!=='region'){
    const headings={'footer--n17':'Shop','footer--n39':'Customer Service','footer--n61':'About Us','footer--n83':'Services'};
    const footer=get('footer'),slot=Object.keys(footer.slots.text).find(k=>footer.slots.text[k]===headings[f.nodeId]&&bindings.find(b=>b.componentKey==='footer').slotNodes.text[k]?.some(id=>/^h/.test(p.nodes[id].tag)));
    explicit(f,{componentKey:'footer',kind:'text',slot,expected:{text:headings[f.nodeId],visible:true}},'Adapt the source hidden mobile accordion button to the visible same-wording footer column heading. Footer links remain expanded and usable; no inert accordion button is displayed.');
   }
   const num=Number(f.nodeId.split('--n')[1]);
   if(num>=142&&f.kind!=='layout'&&f.kind!=='region'){
    const footer=get('footer'),slot=Object.keys(footer.slots.links).find(k=>footer.slots.links[k].url==='https://www.petsupermarket.com/login/');
    if(slot)explicit(f,{componentKey:'footer',kind:'external',slot,expected:'https://www.petsupermarket.com/login/'},'The source hidden restock-notification form, consent and success states remain in the source account service. The draft retains its real external account entrance and makes no local subscription or notification claim.');
   }
   if(['footer--n120','footer--n122'].includes(f.nodeId)&&f.kind!=='layout'&&f.kind!=='region')explicit(f,{componentKey:'footer',kind:'interaction',selector:scope('footer')+' .back-top',property:'anchor',expected:{targetId:'cwp-'+id('header-content')}},'Use a scoped HTML browser anchor in the footer for back-to-top. Adapt the source floating, scroll-dependent placement to a footer-local control so it does not overlay the initial viewport; simplify the minor arrow drawing and verify actual scrolling to the header without custom script.');
  }
 }
 // Dynamic product fields keep independently measured source card styling.
 for(const region of ['halloween-products','fall-products']){
   const p=packets[region],q=get(region+'-query'),firstId=q.query.ids[0],selector=root(region+'-query-products')+` .product-grid-item[data-id="${firstId}"]`;
   const carousel=Object.values(p.interactions).find(i=>i.kind==='carousel');
   for(const fact of Object.values(source.facts).filter(f=>f.regionId===region&&f.kind==='interaction'&&f.value.kind==='carousel'))explicit(fact,{componentKey:q.key,kind:'interaction',selector:root(q.key+'-products'),property:'carousel',expected:{manual:true,pagination:'bullets'}},'The registered Woodmart product carousel provides live bullets rather than a fraction. Adapt the source fraction to real native bullets in the same top controller row; verify physical next/previous, actual target product IDs and synchronized native active pagination without fabricated counters.');
   const names=carousel.itemNodeIds.slice(0,3).map(item=>Object.values(p.texts).find(t=>ancestor(p,t.nodeId).some(n=>n.id===item)&&p.nodes[t.nodeId].attributes.class==='product-link')).filter(Boolean);
   const titleTarget=selector+' .wd-entities-title a';
   for(const[index,property]of ['color','font-size','font-weight'].entries()){
     if(!names[index])throw Error('Missing independently owned source product name style');
     const fact=Object.values(source.facts).find(f=>f.regionId===region&&f.kind==='text'&&f.nodeId===names[index].nodeId);
     explicit(fact,{componentKey:q.key,kind:'layout',selector:titleTarget,property,expected:fact.value.style[property],tolerance:0},'Replace the source name with the frozen target record while preserving the actual source product-title '+property+'. Independent catalog verification checks the rendered target text and destination.');
   }
   const cardIds=new Set();for(let n of Object.values(p.nodes))if(ancestor(p,n.id).some(a=>a.id===carousel.itemNodeIds[0]))cardIds.add(n.id);
   const price=Object.values(source.facts).find(f=>f.regionId===region&&f.kind==='text'&&cardIds.has(f.nodeId)&&p.nodes[f.nodeId].attributes.class==='formatted');
   if(!price)throw Error('Missing source price paint evidence');
   explicit(price,{componentKey:q.key,kind:'layout',selector:selector+' .price > .amount:first-child bdi',property:'color',expected:price.value.style.color,tolerance:0},'Keep the evidenced dark source price paint on the actual WooCommerce price leaf. Price values/ranges remain the verified target data.');
   const media=Object.values(source.facts).find(f=>f.regionId===region&&f.kind==='media'&&cardIds.has(f.nodeId)&&f.value.kind==='img');
   if(!media)throw Error('Missing source product image frame');
   explicit(media,{componentKey:q.key,kind:'layout',selector:selector+' .product-element-top img',expected:{width:media.value.layout.rect.width,height:media.value.layout.rect.height},tolerance:2},'Use the real target product photo within the independently measured source product-image frame and contain fit. The image URL is separately checked against the native target catalog.');
 }
}
