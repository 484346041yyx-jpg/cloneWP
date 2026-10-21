// Current Pet regression only. Author explicit source-owned variants; never
// merge same-copy nodes or change source facts to fit a failed target rendering.
import { createHash } from 'node:crypto';
import { parseFragment, serialize } from 'parse5';
import { proveCanonicalCloneEvidenceV2 } from './pet-v2-responsive-mapping.mjs';

const normalize=value=>String(value??'').normalize('NFC').replace(/\s+/g,' ').trim();
const replicaId=(task,key)=>createHash('sha256').update(`clonewp-replica-v2:${task}:${key}`).digest('hex').slice(0,7);
const flat=blocks=>blocks.flatMap(block=>[block,...flat(block.children??block.slides??[])]);
const attr=(node,name)=>node.attrs?.find(item=>item.name===name)?.value;
const find=(node,predicate)=>[...(predicate(node)?[node]:[]),...(node.childNodes??[]).flatMap(child=>find(child,predicate))];
const only=(items,label)=>{if(items.length!==1)throw Error(`Source variants need one actual ${label}`);return items[0];};
const detach=node=>{const parent=node.parentNode;if(!parent||!parent.childNodes.includes(node))throw Error('Authored variant node has no reciprocal parent');parent.childNodes.splice(parent.childNodes.indexOf(node),1);};
const setAttr=(node,name,value)=>{const old=node.attrs.find(item=>item.name===name);if(old)old.value=value;else node.attrs.push({name,value});};
const within=(packet,nodeId,rootId)=>{const result=[],seen=new Set();let node=packet.nodes[nodeId];while(node?.id!==rootId){if(!node||seen.has(node.id)||!node.parentId)throw Error('Source variant does not reach its actual region root');seen.add(node.id);const parent=packet.nodes[node.parentId],index=parent?.childIds.indexOf(node.id);if(!(index>=0))throw Error('Source variant has a non-reciprocal child slot');result.unshift(index);node=parent;}return result;};
const at=(packet,rootId,path)=>{let node=packet.nodes[rootId];for(const index of path){const child=packet.nodes[node?.childIds[index]];if(!child||child.parentId!==node.id)throw Error('Source variant path leaves its actual owner');node=child;}return node;};
const words=(packet,nodeId)=>Object.values(packet.texts??{}).filter(text=>text.nodeId===nodeId).map(text=>text.text).join(' ');
const classes=node=>(node.attributes?.class??'').split(/\s+/);
const subtree=(packet,id)=>[id,...packet.nodes[id].childIds.flatMap(child=>subtree(packet,child))];
const textAtoms=(packet,id)=>{const ids=new Set(subtree(packet,id));return Object.values(packet.texts??{}).filter(text=>ids.has(text.nodeId));};
const nearestHref=(packet,id)=>{let node=packet.nodes[id];while(node){if(/^https?:/.test(node.attributes?.href??''))return node.attributes.href;node=packet.nodes[node.parentId];}};
const owns=(packet,id,owner)=>{let node=packet.nodes[id];while(node){if(node.id===owner)return true;node=packet.nodes[node.parentId];}return false;};

// Task-only repair of aliases authored by the original flat menu inventory.
// Source anchors keep their observed destination; non-link grouping labels do
// not inherit another category's same-copy HTTP anchor.
export function reconcilePetHeaderAliasesV2({authored,packetsByViewport,sourceFacts}) {
  const result=structuredClone(authored),header=flat(result.blocks).find(component=>component.key==='header'),binding=result.bindings.find(item=>item.componentKey==='header'),packet=packetsByViewport.desktop.header,decisions=[];
  if(result.taskId!=='pet-supermarket-v2-20261015'||header?.kind!=='html-static'||!packet||!binding)throw Error('Pet header aliases require the current task and actual desktop header owner');
  const tree=parseFragment(header.template),mega=only(find(tree,node=>classes({attributes:{class:attr(node,'class')}}).includes('mega')),'actual authored mega menu');
  const adaptations=[];
  for(const[slot,ids]of Object.entries(binding.slotNodes.text).filter(([slot])=>slot.startsWith('group-'))){
    const retained=[];
    for(const id of ids){
      const source=packet.nodes[id];if(!source||normalize(words(packet,id))!==normalize(header.slots.text[slot]))throw Error(`Header group ${slot} does not own the declared source wording at ${id}`);
      if(source.tag!=='a'||!/^https?:/.test(source.attributes?.href??'')){retained.push(id);continue;}
      if(source.attributes.role!=='menuitem'||!classes(source).some(value=>['menu-header','sub-category'].includes(value)))throw Error(`Header HTTP group alias ${id} has an unknown navigation role`);
      const href=source.attributes.href,candidates=Object.entries(binding.slotNodes.links??{}).filter(([key,nodeIds])=>!key.startsWith('group-')&&header.slots.links[key]?.url===href&&normalize(header.slots.text[key])===normalize(words(packet,id))&&nodeIds.some(nodeId=>{const node=packet.nodes[nodeId];return node?.tag==='a'&&node.attributes?.href===href&&normalize(words(packet,nodeId))===normalize(words(packet,id));}));
      const[authoritative]=only(candidates,`actual same-destination owned header anchor for ${id}`),anchor=only(find(tree,node=>attr(node,'data-cwp-link')===authoritative),'authoritative real header anchor');
      if(anchor.tagName!=='a')throw Error('Authoritative navigation destination is not an anchor');
      binding.slotNodes.links[authoritative]=[...new Set([...binding.slotNodes.links[authoritative],id])];
      const facts=Object.values(sourceFacts.facts??{}).filter(fact=>fact.snapshotId===packet.snapshot.id&&fact.kind==='text'&&fact.nodeId===id);
      if(facts.length!==1)throw Error(`Header alias ${id} needs one immutable actual text fact`);
      adaptations.push({component:'header',sourceFactIds:[facts[0].id],target:{componentKey:'header',kind:'text',slot:authoritative,expected:{text:header.slots.text[authoritative]}},rule:'Adapt this exact observed menu anchor to the single authored collapsed-menu anchor with the same actual HTTP href, wording and proved source menu role. Preserve its destination and copy; do not duplicate mobile/desktop navigation implementations or copy their inactive/offscreen state.'});
      decisions.push({kind:'http-group-alias-removed',slot,sourceNodeId:id,sourceHref:href,sourceParentId:source.parentId,authoritativeSlot:authoritative,authoritativeSourceNodeIds:binding.slotNodes.links[authoritative]});
    }
    if(retained.length)binding.slotNodes.text[slot]=retained;
    else{const atom=only(find(mega,node=>attr(node,'data-cwp-text')===slot),'redundant HTTP group atom'),wrapper=atom.parentNode;if(wrapper?.tagName!=='strong'||wrapper.childNodes.length!==1)throw Error('HTTP alias is not an isolated authored group label');detach(wrapper);delete binding.slotNodes.text[slot];delete header.slots.text[slot];}
  }
  // Three mobile drawer entries stay real external destinations. Their actual
  // off-canvas layout becoming nonzero must not make the collapsed target menu
  // claim the source session/account service is implemented locally.
  for(const snapshot of sourceFacts.snapshots){const actual=packetsByViewport[snapshot.viewport.name]?.header;if(!actual)continue;for(const fact of Object.values(sourceFacts.facts??{}).filter(fact=>fact.snapshotId===snapshot.id&&fact.kind==='text'&&fact.regionId==='header')){
    const node=actual.nodes[fact.nodeId],ancestors=[];let owner=node;while(owner){ancestors.push(owner);owner=actual.nodes[owner.parentId];}
    if(!ancestors.some(node=>classes(node).includes('mobile-nav-menu')))continue;
    const role=classes(node).includes('user-message')?'account':classes(node).includes('promo-login')?'promo-login':ancestors.some(node=>classes(node).includes('contactus-menu-link'))?'contact':undefined;if(!role)continue;
    const href=nearestHref(actual,node.id);if(!href)throw Error('Mobile drawer entry lacks its actual external destination');
    const candidates=Object.entries(header.slots.links).filter(([slot,link])=>link.url===href&&(role==='account'?slot==='account':normalize(header.slots.text[slot])===normalize(fact.value.text)));
    const[slot]=only(candidates,'owned external mobile drawer destination');
    adaptations.push({snapshotId:snapshot.id,component:'header',sourceFactIds:[fact.id],target:{componentKey:'header',kind:'external',slot,expected:href},rule:'Adapt this exact mobile-drawer session/contact text to its actual source external entry. The target collapsed navigation preserves the verified destination; its independently rendered source off-canvas/session panel is not reconstructed.'});
    decisions.push({kind:'source-drawer-external-entry',snapshotId:snapshot.id,sourceNodeId:node.id,sourceHref:href,authoritativeSlot:slot});
  }}
  result.adaptations=[...adaptations,...(result.adaptations??[])];header.template=serialize(tree);return{authored:result,decisions};
}

function adaptHeaderOfferVersions({authored,packetsByViewport,sourceFacts,decisions}) {
  const all=flat(authored.blocks),carousel=all.find(component=>component.key==='header-offers');if(!carousel)return;
  if(carousel.kind!=='native-carousel')throw Error('Observed header offer alternatives require their actual native carousel');
  const desktop=packetsByViewport.desktop.header,sourceCarousels=Object.values(desktop.interactions??{}).filter(interaction=>interaction.kind==='carousel'),root=only(desktop.regions.filter(region=>region.id==='header'),'header source region');
  if(sourceCarousels.length!==2||sourceCarousels.some(item=>item.itemNodeIds.length!==carousel.slides.length))throw Error('Header promotion versions require both observed ordered six-item source tracks');
  const descriptors=sourceCarousels.map(interaction=>({path:within(desktop,interaction.trackNodeId,root.nodeId),interaction})),adaptations=[];
  for(const snapshot of sourceFacts.snapshots){const packet=packetsByViewport[snapshot.viewport.name]?.header;if(!packet)throw Error('Header promotion snapshot packet is missing');const region=only(packet.regions.filter(region=>region.id==='header'),'actual header region'),targets=new Map();
    for(const descriptor of descriptors){const track=at(packet,region.nodeId,descriptor.path),actual=only(Object.values(packet.interactions).filter(item=>item.kind==='carousel'&&item.trackNodeId===track.id),'actual versioned promotion track');if(actual.itemNodeIds.length!==carousel.slides.length)throw Error('Source promotion version changed its real item count');
      for(const[index,itemId]of actual.itemNodeIds.entries()){const slide=carousel.slides[index],atoms=textAtoms(packet,itemId),entries=Object.entries(slide.slots.text),hrefs=[...new Set(subtree(packet,itemId).map(id=>packet.nodes[id].attributes?.href).filter(href=>/^https?:/.test(href??'')))],targetHrefs=[...new Set(Object.values(slide.slots.links).map(link=>link.url))];
        if(JSON.stringify(atoms.map(atom=>normalize(atom.text)))!==JSON.stringify(entries.map(([,text])=>normalize(text)))||JSON.stringify(hrefs)!==JSON.stringify(targetHrefs))throw Error('Header promotion real-item ordinal does not retain its independently observed ordered copy and actual destination');
        atoms.forEach((atom,index)=>targets.set(atom.nodeId,{componentKey:slide.key,slot:entries[index][0],text:entries[index][1]}));
      }
    }
    for(const fact of Object.values(sourceFacts.facts??{}).filter(fact=>fact.snapshotId===snapshot.id&&fact.kind==='text'&&fact.regionId==='header')){const proof=proveCanonicalCloneEvidenceV2({packet,nodeId:fact.nodeId}),target=targets.get(proof?.canonicalNodeId??fact.nodeId);if(!target)continue;adaptations.push({snapshotId:snapshot.id,component:target.componentKey,sourceFactIds:[fact.id],target:{componentKey:target.componentKey,kind:'text',slot:target.slot,expected:{text:target.text}},rule:'Adapt the two actually observed responsive promotion tracks and their proved cloned items to one manual native carousel. Preserve each real-item ordinal, ordered text atoms and actual HTTP destination; the source duplicate track display state is intentionally represented by this single native item.'});}
    decisions.push({kind:'single-native-header-offer-versions',snapshotId:snapshot.id,sourceTrackPaths:descriptors.map(item=>item.path),nativeComponentKey:carousel.key,verifiedRealItems:carousel.slides.length});
  }
  authored.adaptations=[...adaptations,...authored.adaptations];
}

function addHeroHeadingVariants({authored,packetsByViewport,sourceFacts,tabletMax,decisions}) {
  const slide=flat(authored.blocks).find(component=>component.key==='hero-slide-0');if(!slide)return;
  const binding=authored.bindings.find(item=>item.componentKey===slide.key),packet=packetsByViewport.desktop.hero;if(slide.kind!=='html-static'||!packet||!binding)throw Error('Hero compact headings require the actual slide and source packet');
  const tree=parseFragment(slide.template),targetNodes=['heading0','heading1','heading2'].map(slot=>only(find(tree,node=>attr(node,'data-cwp-text')===slot),'desktop hero heading atom')),desktopSource=['heading0','heading1','heading2'].map(slot=>only(binding.slotNodes.text[slot],'desktop hero source heading'));
  let desktopOwner=packet.nodes[desktopSource[0]];while(desktopOwner&&!classes(desktopOwner).includes('pd-text--desktop'))desktopOwner=packet.nodes[desktopOwner.parentId];
  const desktopParent=desktopOwner?.id;if(!desktopParent||!desktopSource.every(id=>owns(packet,id,desktopParent)))throw Error('Desktop hero heading atoms have different source owners');
  const parent=packet.nodes[desktopParent],siblings=packet.nodes[parent.parentId].childIds.map(id=>packet.nodes[id]),compactParent=only(siblings.filter(node=>node.id!==parent.id&&classes(node).some(value=>/hide-desktop/.test(value))),'independent compact hero heading owner');
  const compactAtoms=textAtoms(packet,compactParent.id);if(compactAtoms.length!==3||JSON.stringify(compactAtoms.map(atom=>normalize(atom.text)))!==JSON.stringify(desktopSource.map(id=>normalize(words(packet,id)))))throw Error('Compact hero headings lack their own ordered source atoms');
  const sourceRegion=only(packet.regions.filter(region=>region.id==='hero'),'hero source region'),snapshots=[];
  for(const snapshot of sourceFacts.snapshots){const actual=packetsByViewport[snapshot.viewport.name]?.hero,root=only(actual.regions.filter(region=>region.id==='hero'),'actual hero region'),small=snapshot.viewport.width<=tabletMax;
    for(let index=0;index<3;index++){const before=at(actual,root.nodeId,within(packet,desktopSource[index],sourceRegion.nodeId)),after=at(actual,root.nodeId,within(packet,compactAtoms[index].nodeId,sourceRegion.nodeId));if(normalize(words(actual,before.id))!==normalize(slide.slots.text['heading'+index])||normalize(words(actual,after.id))!==normalize(slide.slots.text['heading'+index])||before.visible!==!small||after.visible!==small)throw Error('Hero heading alternatives do not prove the independently observed opposite visibility');}
    snapshots.push({snapshotId:snapshot.id,compactVisible:small,desktopVisible:!small});
  }
  for(let index=0;index<3;index++){const slot='compact-heading'+index,copy=structuredClone(targetNodes[index]);copy.parentNode=targetNodes[index].parentNode;setAttr(copy,'data-cwp-text',slot);setAttr(copy,'class',[attr(copy,'class'),'compact-heading-copy'].filter(Boolean).join(' '));copy.parentNode.childNodes.splice(copy.parentNode.childNodes.indexOf(targetNodes[index])+1,0,copy);setAttr(targetNodes[index],'class',[attr(targetNodes[index],'class'),'desktop-heading-copy'].filter(Boolean).join(' '));slide.slots.text[slot]=slide.slots.text['heading'+index];binding.slotNodes.text[slot]=[compactAtoms[index].nodeId];}
  slide.template=serialize(tree);slide.css+=`:scope h2 .compact-heading-copy{display:none!important}@media(max-width:${tabletMax}px){:scope h2 .desktop-heading-copy{display:none!important}:scope h2 .compact-heading-copy.heading-0,:scope h2 .compact-heading-copy.heading-1{display:inline!important}:scope h2 .compact-heading-copy.heading-2{display:block!important}}`;
  decisions.push({kind:'independent-hero-heading-atoms',componentKey:slide.key,desktopSourceNodeIds:desktopSource,compactSourceNodeIds:compactAtoms.map(atom=>atom.nodeId),snapshots});
}

/** Pure, task-owned continuation. Each later node comes from its exact replayed
 * mapping; source offscreen layout never becomes a fabricated hidden fact. */
export function applyPetInteractionSourceVariantsV2({authored,packetsByViewport,sourceFacts,responsiveMappings=authored.responsiveMappings??[],tabletMax=1024}) {
  const result=structuredClone(authored),components=new Map(flat(result.blocks).map(component=>[component.key,component])),decisions=[];
  if(result.taskId!=='pet-supermarket-v2-20261015'||tabletMax!==1024)throw Error('Pet interaction variants require the current task and proved target breakpoint');
  const header=components.get('header'),binding=result.bindings.find(item=>item.componentKey==='header');
  if(header?.kind!=='html-static'||!binding)throw Error('Header interaction adaptation needs its actual component');
  const tree=parseFragment(header.template),mega=only(find(tree,node=>classes({attributes:{class:attr(node,'class')}}).includes('mega')),'owned header navigation');
  const additions=[],desktop=packetsByViewport.desktop.header,desktopFacts=Object.values(sourceFacts.facts??{}).filter(fact=>fact.snapshotId===desktop.snapshot.id),hover=result.adaptations.filter(item=>!item.snapshotId&&(item.target?.componentKey??item.component)==='header'&&item.target?.property==='hover');
  for(const snapshot of sourceFacts.snapshots.filter(item=>item.viewport.width<=tabletMax)){
    const packet=packetsByViewport[snapshot.viewport.name]?.header;if(!packet)continue;
    const drawers=Object.values(packet.nodes).filter(node=>classes(node).includes('mobile-nav-menu'));if(!drawers.length)continue;
    const drawer=only(drawers,'actual source mobile drawer'),layout=packet.layouts[drawer.layoutId];if(layout?.position!=='fixed'||!(layout.rect.x+layout.rect.width<=0))throw Error('Source drawer adaptation requires its actual fully offscreen fixed container');
    const target=only(find(tree,node=>node.tagName==='details'&&classes({attributes:{class:attr(node,'class')}}).includes('shop-group')),'actual target details navigation');
    if(!find(target,node=>node===mega).length||find(target,node=>node.tagName==='summary'&&node.parentNode===target).length!==1)throw Error('The actual disclosure does not own its summary and mapped navigation');
    const record=only(responsiveMappings.flatMap(report=>report.mappings??[]).filter(item=>item.componentKey==='header'&&item.snapshotId===snapshot.id),'explicit header snapshot mapping'),pairs=new Map();
    for(const proof of record.nodeMappings??[]){if(pairs.has(proof.desktopNodeId)&&pairs.get(proof.desktopNodeId)!==proof.variantNodeId)throw Error('Header disclosure has ambiguous responsive source identities');pairs.set(proof.desktopNodeId,proof.variantNodeId);}
    const facts=Object.values(sourceFacts.facts??{}).filter(fact=>fact.snapshotId===snapshot.id),content=new Map(),covered=new Set(),ownership=[];
    for(const[slot,ids]of Object.entries(binding.slotNodes.text??{})){
      const atom=find(mega,node=>attr(node,'data-cwp-text')===slot);if(!atom.length)continue;if(atom.length!==1)throw Error('Header text slot is not unique in its actual disclosure');
      for(const id of ids){const mapped=pairs.get(id);if(!mapped)throw Error(`Header disclosure text owner lacks an explicit source mapping: ${id}`);const source=packet.nodes[mapped],fact=facts.find(fact=>fact.nodeId===mapped&&fact.kind==='text');if(!fact||!fact.value.visible||!owns(packet,mapped,drawer.id))continue;
        if(normalize(fact.value.text)!==normalize(header.slots.text[slot]))throw Error('Header disclosure target wording differs from its exact mapped source owner');
        const href=nearestHref(packet,mapped),link=header.slots.links?.[slot],kind=link?'link':'text';
        if(link&&href!==link.url)throw Error('Header disclosure actual external destination differs from its typed anchor');
        if(!link&&!(source.tag==='a'&&/^javascript:/.test(source.attributes?.href??'')&&classes(source).includes('main-link-primary')||source.tag==='span'&&classes(source).includes('menu-title')))throw Error('Visible non-link disclosure copy has an unknown actual source navigation role');
        if(link){const anchor=only(find(mega,node=>attr(node,'data-cwp-link')===slot),'actual target navigation anchor');if(anchor.tagName!=='a'||!find(anchor,node=>node===atom[0]).length)throw Error('Navigation text/link slots do not share their actual target anchor');}
        const specification={selector:`:scope .mega [data-cwp-${kind==='link'?'link':'text'}="${slot}"]`,text:header.slots.text[slot],...(link?{href:link.url}:{})};content.set(slot,specification);covered.add(fact.id);ownership.push({factId:fact.id,desktopNodeId:id,variantNodeId:mapped,slot,kind,sourceDrawerId:drawer.id,evidence:fact.evidence,sourceRect:packet.layouts[source.layoutId]?.rect});
      }
    }
    if(!content.size)throw Error('Observed offscreen navigation has no exact content owner to verify after opening');
    // Continue only the already-authored source control adaptations; never turn
    // an unclassified source subtree into a blanket disclosure presence check.
    for(const item of hover){const originals=desktopFacts.filter(fact=>item.sourceFactIds?.includes(fact.id)||item.sourceNodeIds?.some(id=>owns(desktop,fact.nodeId,id)));for(const original of originals){const mapped=pairs.get(original.nodeId);if(!mapped)throw Error('An adapted source drawer control lacks its exact responsive continuation');const matches=facts.filter(fact=>fact.nodeId===mapped&&fact.kind===original.kind&&fact.value.kind===original.value.kind&&fact.value.purpose===original.value.purpose);if(matches.length!==1)throw Error('Source drawer control continuation changed its factual role');covered.add(matches[0].id);}}
    const expected={target:'.mega',initialOpen:false,ownedContent:[...content.values()]},selector=`#cwp-${replicaId(result.taskId,'header-content')} details.shop-group`;
    additions.push({snapshotId:snapshot.id,component:'header',sourceFactIds:[...covered],target:{componentKey:'header',kind:'interaction',selector,property:'disclosure',expected},rule:'Adapt the actually observed fixed offscreen JavaScript drawer and its previously classified controls to this unique native details navigation. Its default closed state replaces offscreen positioning; verify summary click and keyboard restoration, then each exact owned text/anchor inside the opened navigation with original wording and actual HTTP href. No source visibility fact is rewritten.'});
    decisions.push({kind:'source-offscreen-drawer-to-owned-disclosure',snapshotId:snapshot.id,sourceDrawerId:drawer.id,sourceDrawerRect:layout.rect,targetSelector:selector,expected,sourceFactIds:[...covered],ownership});
  }
  result.adaptations=[...additions,...result.adaptations];
  const packet=packetsByViewport.desktop.hero;
  for(const key of['hero-slide-1','hero-slide-2']){const slide=components.get(key);if(!slide)continue;const binding=result.bindings.find(item=>item.componentKey===key),sourceId=only(binding?.slotNodes?.text?.cta??[],'actual desktop hero CTA owner'),source=packet?.nodes[sourceId],parent=packet?.nodes[source?.parentId];
    if(slide.kind!=='html-static'||source?.tag!=='a'||!classes(source).includes('pd-cta--hide-mobile')||!classes(parent).includes('pd-cta-wrap')||source.attributes.href!==slide.slots.links.cta.url)throw Error('Hero desktop CTA has no exact independent source anchor responsibility');
    const compact=only(parent.childIds.map(id=>packet.nodes[id]).filter(node=>node.tag==='a'&&classes(node).includes('pd-cta--hide-desktop')),'independent same-wrapper compact CTA'),region=only(packet.regions.filter(region=>region.id==='hero'),'hero source region'),snapshots=[];
    for(const snapshot of sourceFacts.snapshots){const actual=packetsByViewport[snapshot.viewport.name]?.hero,root=only(actual.regions.filter(region=>region.id==='hero'),'actual hero source region'),before=at(actual,root.nodeId,within(packet,source.id,region.nodeId)),after=at(actual,root.nodeId,within(packet,compact.id,region.nodeId)),small=snapshot.viewport.width<=tabletMax;if(before.tag!=='a'||after.tag!=='a'||before.visible!==!small||after.visible!==small||before.attributes.href!==source.attributes.href||after.attributes.href!==compact.attributes.href||normalize(words(actual,before.id))!==normalize(slide.slots.text.cta)||normalize(words(actual,after.id))!==normalize(words(packet,compact.id)))throw Error('Hero CTA alternatives changed their independently observed text, href or opposite visibility');snapshots.push({snapshotId:snapshot.id,desktopNodeId:before.id,compactNodeId:after.id,desktopVisible:before.visible,compactVisible:after.visible});}
    const tree=parseFragment(slide.template),anchor=only(find(tree,node=>attr(node,'data-cwp-link')==='cta'&&attr(node,'data-cwp-text')==='cta'),'existing desktop target CTA');if(anchor.tagName!=='a')throw Error('Desktop CTA target is not its actual anchor');const copy=structuredClone(anchor);copy.parentNode=anchor.parentNode;setAttr(copy,'data-cwp-link','compact-cta');setAttr(copy,'data-cwp-text','compact-cta');setAttr(copy,'class',[attr(copy,'class'),'compact-cta'].filter(Boolean).join(' '));setAttr(anchor,'class',[attr(anchor,'class'),'desktop-cta'].filter(Boolean).join(' '));anchor.parentNode.childNodes.splice(anchor.parentNode.childNodes.indexOf(anchor)+1,0,copy);
    slide.slots.text['compact-cta']=words(packet,compact.id);slide.slots.links['compact-cta']={url:compact.attributes.href,isExternal:true};binding.slotNodes.text['compact-cta']=[compact.id];binding.slotNodes.links['compact-cta']=[compact.id];slide.template=serialize(tree);slide.css+=`:scope .cta.compact-cta{display:none!important}@media(max-width:${tabletMax}px){:scope .cta.desktop-cta{display:none!important}:scope .cta.compact-cta{display:inline-flex!important}}`;
    decisions.push({kind:'independent-hero-cta-anchors',componentKey:key,desktopSourceNodeId:source.id,compactSourceNodeId:compact.id,desktopHref:source.attributes.href,compactHref:compact.attributes.href,snapshots});
  }
  return{authored:result,decisions};
}

export function applyPetSourceVariantsV2({authored,packetsByViewport,sourceFacts,responsiveMappings=authored.responsiveMappings??[],tabletMax=1024}) {
  const reconciled=reconcilePetHeaderAliasesV2({authored,packetsByViewport,sourceFacts}),result=reconciled.authored,components=new Map(flat(result.blocks).map(block=>[block.key,block])),bindings=new Map(result.bindings.map(binding=>[binding.componentKey,binding])),decisions=reconciled.decisions;
  if(result.taskId!=='pet-supermarket-v2-20261015'||!sourceFacts?.snapshots?.some(snapshot=>snapshot.viewport.name==='desktop')||!Number.isFinite(tabletMax)||tabletMax!==1024)throw Error('This source-variant authoring module belongs to the current observed Pet task and target breakpoint');
  const header=components.get('header'),headerBinding=bindings.get('header');if(header?.kind!=='html-static'||!headerBinding)throw Error('Actual static header/binding is missing');
  const tree=parseFragment(header.template),frame=only(find(tree,node=>node.tagName==='header'&&classes({attributes:{class:attr(node,'class')}}).includes('frame')),'authored header frame'),mega=only(find(tree,node=>classes({attributes:{class:attr(node,'class')}}).includes('mega')),'authored mega menu');
  const headerPacket=only(headerBinding.regionIds.map(id=>packetsByViewport.desktop[id]).filter(Boolean).filter((packet,index,array)=>array.indexOf(packet)===index),'desktop header packet');
  const removedSlots=[];
  for(const authoritative of ['deals','services']) {
    const sourceIds=headerBinding.slotNodes?.text?.[authoritative],linkIds=headerBinding.slotNodes?.links?.[authoritative];if(sourceIds?.length!==1||linkIds?.length!==1||sourceIds[0]!==linkIds[0])throw Error(`Header ${authoritative} needs one authoritative source text/link owner`);
    const source=headerPacket.nodes[sourceIds[0]],url=header.slots.links[authoritative]?.url;if(source?.tag!=='a'||source.attributes.href!==url||normalize(words(headerPacket,source.id))!==normalize(header.slots.text[authoritative]))throw Error(`Header ${authoritative} is not the actual source anchor and wording`);
    only(find(tree,node=>attr(node,'data-cwp-link')===authoritative),'authoritative header '+authoritative);
    for(const[slot,nodeIds]of Object.entries(headerBinding.slotNodes.text)) {
      if(slot===authoritative||JSON.stringify(nodeIds)!==JSON.stringify(sourceIds))continue;
      if(JSON.stringify(headerBinding.slotNodes.links?.[slot])!==JSON.stringify(linkIds)||header.slots.links[slot]?.url!==url||normalize(header.slots.text[slot])!==normalize(header.slots.text[authoritative]))throw Error('Duplicate header source owner has a different typed responsibility');
      const duplicate=only(find(mega,node=>attr(node,'data-cwp-link')===slot),'duplicate mega-menu anchor');detach(duplicate);delete header.slots.text[slot];delete header.slots.links[slot];delete headerBinding.slotNodes.text[slot];delete headerBinding.slotNodes.links[slot];removedSlots.push({slot,authoritative,sourceNodeId:source.id});
      for(const adaptation of result.adaptations??[]){const target=adaptation.target;if(!target||(target.componentKey??adaptation.componentKey??adaptation.component)!=='header')continue;if(target.slot===slot)target.slot=authoritative;if(target.selector)target.selector=target.selector.replaceAll(`data-cwp-text="${slot}"`,`data-cwp-text="${authoritative}"`).replaceAll(`data-cwp-link="${slot}"`,`data-cwp-link="${authoritative}"`);}
    }
  }
  const skipAnchors=[];
  for(const slot of ['nav-0','nav-1']) {
    const ids=headerBinding.slotNodes?.text?.[slot],source=ids?.length===1&&headerPacket.nodes[ids[0]],layout=source&&headerPacket.layouts[source.layoutId];if(source?.tag!=='a'||!classes(source).includes('skip')||source.attributes.href!==header.slots.links[slot]?.url||layout?.position!=='absolute'||!(layout.rect.y+layout.rect.height<=0)||!source.visible)throw Error('Focus-only source skip links need their actual laid-out offscreen anchor evidence');
    const anchor=only(find(mega,node=>attr(node,'data-cwp-link')===slot),'focus-only skip anchor');detach(anchor);setAttr(anchor,'class',[attr(anchor,'class'),'focus-skip'].filter(Boolean).join(' '));anchor.parentNode=frame;skipAnchors.push(anchor);
    decisions.push({kind:'focus-only-skip',componentKey:'header',slot,sourceNodeId:source.id,sourceSnapshotId:headerPacket.snapshot.id,observedRect:layout.rect,target:'Original typed anchor outside closed navigation, laid out above viewport and revealed by keyboard focus.'});
  }
  frame.childNodes.unshift(...skipAnchors);header.template=serialize(tree);header.css+=':scope .frame{position:relative}:scope .focus-skip{position:absolute;top:-67.187px;left:0;z-index:1000;padding:16px;background:#fff;color:#004cdb;line-height:24px}:scope .focus-skip:focus,:scope .focus-skip:focus-visible{top:0;outline:2px solid #004cdb}';
  decisions.push({kind:'authoritative-header-source-owner',componentKey:'header',removedDuplicateSlots:removedSlots});
  adaptHeaderOfferVersions({authored:result,packetsByViewport,sourceFacts,decisions});
  addHeroHeadingVariants({authored:result,packetsByViewport,sourceFacts,tabletMax,decisions});

  const categories=components.get('categories'),heading=components.get('category-heading'),headingBinding=bindings.get('category-heading');if(categories?.kind!=='composite'||heading?.kind!=='native'||heading.widgetType!=='heading'||!headingBinding||components.has('category-heading-compact')||components.has('category-heading-group'))throw Error('Category variants need the existing unique native heading and composite owner');
  const regionId=only(headingBinding.regionIds,'category-title source region'),packet=packetsByViewport.desktop[regionId],region=packet?.regions.find(item=>item.id===regionId),desktopId=only(headingBinding.slotNodes?.native?.title??[],'desktop category title slot'),desktop=packet?.nodes[desktopId],desktopWrapper=packet?.nodes[desktop?.parentId],content=packet?.nodes[desktopWrapper?.parentId];
  if(desktop?.tag!=='h2'||!classes(desktopWrapper).includes('pd-text--desktop')||!content||!region)throw Error('Desktop category title lacks its actual native desktop-wrapper ownership');
  const compactWrapper=only(content.childIds.map(id=>packet.nodes[id]).filter(node=>classes(node).includes('pd-text--default')&&classes(node).includes('pd-text--hide-desktop')),'compact source title wrapper'),compact=only(compactWrapper.childIds.map(id=>packet.nodes[id]).filter(node=>node.tag==='h2'),'compact source h2');
  if(normalize(words(packet,desktop.id))!==normalize(heading.widgetSettings.title)||normalize(words(packet,compact.id))!==normalize(heading.widgetSettings.title))throw Error('The two independent category title variants must each retain their own actual source wording');
  const desktopPath=within(packet,desktop.id,region.nodeId),compactPath=within(packet,compact.id,region.nodeId),snapshots=[];
  for(const snapshot of sourceFacts.snapshots){const variants=Object.values(packetsByViewport).map(table=>table?.[regionId]).filter(candidate=>candidate?.snapshot.id===snapshot.id),actual=only([...new Set(variants)],'actual category variant packet'),root=actual.regions.find(item=>item.id===regionId),before=at(actual,root.nodeId,desktopPath),after=at(actual,root.nodeId,compactPath),small=snapshot.viewport.width<=tabletMax;if(before.tag!=='h2'||after.tag!=='h2'||normalize(words(actual,before.id))!==normalize(heading.widgetSettings.title)||normalize(words(actual,after.id))!==normalize(heading.widgetSettings.title)||before.visible!==!small||after.visible!==small)throw Error('Actual category variants do not prove the explicit opposite source visibility at this target viewport');snapshots.push({snapshotId:snapshot.id,desktopNodeId:before.id,compactNodeId:after.id,desktopVisible:before.visible,compactVisible:after.visible});}
  const compactHeading=structuredClone(heading);compactHeading.key='category-heading-compact';compactHeading.settings.custom_css=(compactHeading.settings.custom_css??'')+`selector{display:none!important;}@media(max-width:${tabletMax}px){selector{display:flex!important;}}`;
  heading.settings.custom_css=(heading.settings.custom_css??'')+`@media(max-width:${tabletMax}px){selector{display:none!important;}}`;
  const groupKey='category-heading-group',groupSelector=`[data-id="${replicaId(result.taskId,groupKey)}"]`,groupSettings=structuredClone(heading.settings);delete groupSettings.custom_css;
  const group={key:groupKey,kind:'composite',settings:groupSettings,children:[heading,compactHeading]},index=categories.children.findIndex(child=>child.key===heading.key);if(index<0)throw Error('Existing category title is not the actual direct child');categories.children.splice(index,1,group);
  const groupBinding={componentKey:groupKey,regionIds:[regionId],sourceNodeIds:[region.nodeId],slotNodes:{},layoutNodes:Object.fromEntries([...new Set([region.nodeId,region.contentNodeId,content.id])].filter(Boolean).map(id=>[id,{...(headingBinding.layoutNodes?.[id]??{}),selector:groupSelector,dimensions:['x','width','height'],adaptHeight:false,rule:'Preserve the source category-title content frame in one natural-height group containing its independently owned mutually exclusive heading variants.'}]))};
  headingBinding.sourceNodeIds=[desktop.id];headingBinding.slotNodes={native:{title:[desktop.id]}};delete headingBinding.layoutNodes;
  const compactBinding={componentKey:compactHeading.key,regionIds:[regionId],sourceNodeIds:[compact.id],slotNodes:{native:{title:[compact.id]}}};
  result.bindings.push(groupBinding,compactBinding);decisions.push({kind:'independent-native-category-headings',desktopComponentKey:heading.key,compactComponentKey:compactHeading.key,groupComponentKey:groupKey,sourceRegionId:regionId,desktopSourceNodeId:desktop.id,compactSourceNodeId:compact.id,desktopPath,compactPath,snapshots});
  const interactionVariants=applyPetInteractionSourceVariantsV2({authored:result,packetsByViewport,sourceFacts,responsiveMappings,tabletMax});
  return{authored:interactionVariants.authored,decisions:[...decisions,...interactionVariants.decisions]};
}
