import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import type { BlockContract, NativeProgram } from './types.js';
import type { TargetViewportEvidence } from '../verification/types.js';
import { sha256, sourceVisibleText } from './check.js';
import { compareFidelityColor, fidelityColorChannels } from './verify.js';
import { validateTargetCatalogBindings } from './catalog-contract.js';
import { proveInactiveSourceText, retainedHiddenNativeText } from './source-static-text.js';

export interface SourceTextPaintPacket {
  evidenceId: string; evidencePath: string; viewport: string;
  observedPage?: {url:string;viewport:{width:number;height:number}};
  textOwners?:SourceTextOwner[];
  blocks: Array<{ id: string;rect?:{x:number;y:number;width:number;height:number};style?:Record<string,unknown>|string;rootStyles?:Array<{selector?:string;style?:Record<string,unknown>|string}>;carousels?:Array<{slides?:Array<{atoms?:SourcePaintAtom[]}>}>;textAtoms:SourcePaintAtom[] }>;
}
export interface SourcePaintAtom{text?:string;fullElementText?:string;selector?:string;ancestorSelectors?:string[];tag?:string;href?:string;visible?:boolean;rect?:{x?:number;y?:number;width:number;height:number};style?:Record<string,unknown>|string;}
export interface SourceTextOwner{blockId:string;sourceTextId:string;text:string;kind:BlockContract['blocks'][number]['texts'][number]['kind'];selector:string;tag?:string;href?:string;sourceState:'normal'|'conditional';evidencePath:string;}
export interface ConditionalSourcePaint{evidencePath:string;viewport:string;block:SourceTextPaintPacket['blocks'][number];}
export interface SourceResponsiveVariant{ownerSelector:string;alternateSelector:string;primaryEvidence:string;viewportEvidence:string;reason:string;}

/** Public links identify an exact native card's text when repeated prices share words. No expected paint is selected using the target color. */
function nativeTextHref(program:NativeProgram,blockIndex:number,elementKey:string):string|undefined{
  let ancestry:NativeProgram['elements']=[];
  const visit=(node:NativeProgram['elements'][number],parents:NativeProgram['elements']):boolean=>{if(node.key===elementKey){ancestry=[node,...parents];return true;}return(node.children??[]).some(child=>visit(child,[node,...parents]));};
  visit(program.elements[blockIndex],[]);
  const href=(node:NativeProgram['elements'][number])=>{const link=node.settings.link as{url?:unknown}|undefined;return typeof link?.url==='string'&&/^https?:\/\//.test(link.url)?link.url:undefined;};
  const collect=(node:NativeProgram['elements'][number]):string[]=>[...(href(node)?[href(node)!]:[]),...(node.children??[]).flatMap(collect)];
  for(const node of ancestry){const own=href(node);if(own)return own;if(node.type!=='container')continue;const urls=[...new Set(collect(node))];if(urls.length===1)return urls[0];}
  return undefined;
}

/** Positional IDs are resolved only when the complete ordered atom tuple exactly reproduces the frozen text contract. */
export function reconstructSourceTextOwners(contract:BlockContract,primary:SourceTextPaintPacket,conditional:ConditionalSourcePaint[]):SourceTextOwner[]{
  const owners:SourceTextOwner[]=[];
  for(const block of contract.blocks){
    const normal=primary.blocks.find(item=>item.id===block.id);if(!normal)continue;
    const candidates:Array<{atom:SourcePaintAtom;state:'normal'|'conditional';evidencePath:string}>=normal.textAtoms.map(atom=>({atom,state:'normal',evidencePath:primary.evidencePath}));
    if(block.role==='header'){
      candidates.push(...(normal.carousels??[]).flatMap(carousel=>(carousel.slides??[]).flatMap(slide=>(slide.atoms??[]).map(atom=>({atom,state:'normal' as const,evidencePath:primary.evidencePath})))));
      const baseline=normal.rect?normal.rect.y+normal.rect.height:undefined;
      if(baseline!==undefined)for(const observation of conditional.filter(item=>item.viewport===primary.viewport&&item.block.id===block.id))for(const atom of observation.block.textAtoms){
        if(atom.visible===true&&atom.rect&&typeof atom.rect==='object'&&typeof atom.rect.y==='number'&&atom.rect.y>=baseline&&atom.rect.width>0&&atom.rect.height>0)candidates.push({atom,state:'conditional',evidencePath:observation.evidencePath});
      }
    }
    const unique=new Map<string,{atom:SourcePaintAtom;state:'normal'|'conditional';evidencePath:string}>();
    for(const candidate of candidates){
      const restored=normal.textAtoms.find(atom=>atom.selector===candidate.atom.selector&&atom.text===candidate.atom.text&&atom.style&&typeof atom.style==='object'),atom=restored??candidate.atom,text=sourceVisibleText(atom.text??'');
      if(!atom.selector||!text||atom.visible===false||atom.tag==='button'||/^Skip to|^\d+\s*\/\s*\d+$/.test(text)||text==='/'||(/^\d+$/.test(text)&&!(block.role==='header'&&text==='0')))continue;
      if(atom.rect&&typeof atom.rect==='object'&&(atom.rect.width<2||atom.rect.height<2))continue;
      const identity=`${atom.selector}::${text}`;if(!unique.has(identity))unique.set(identity,{...candidate,atom});
    }
    const ordered=[...unique.values()];
    const classify=(atom:SourcePaintAtom):SourceTextOwner['kind']=>/^\$\d/.test(atom.text??'')?'price':block.role==='products'&&atom.href&&(atom.text??'').length>28&&!/Buy \d|See Deal in Cart|Halloween Costumes/.test(atom.text??'')?'product-name':/^h[1-6]$/.test(atom.tag??'')?'heading':block.role==='header'?'navigation':atom.href?'label':'body';
    if(ordered.length!==block.texts.length||ordered.some(({atom},index)=>block.texts[index].id!==`${block.id}-text-${index}`||sourceVisibleText(block.texts[index].text)!==sourceVisibleText(atom.text??'')||block.texts[index].kind!==classify(atom)))continue;
    owners.push(...ordered.map(({atom,state,evidencePath},index)=>({blockId:block.id,sourceTextId:block.texts[index].id,text:block.texts[index].text,kind:block.texts[index].kind,selector:atom.selector!,tag:atom.tag,href:atom.href,sourceState:state,evidencePath})));
  }
  return owners;
}
export interface TextPaintReport {
  version:1; passed:boolean; colorPassed:boolean; status:'passed'|'needs-review'|'failed';
  checks:Array<{viewport:string;blockId:string;sourceTextId:string;elementKey:string;text:string;status:'matched'|'source-inactive'|'mismatch'|'unverified';sourceColors:string[];actualColor?:string;evidence:string[];sourceSelectors:string[];sourceOwner?:SourceTextOwner;responsiveSourceVariants?:SourceResponsiveVariant[];reason?:string}>;
  counts:{expected:number;matched:number;errors:number;unverified:number;sourceInactive:number};
  glyphDiagnostics:Array<{viewport:string;blockId:string;sourceTextId:string;elementKey:string;status:'mismatch'|'unverified';reason:string;foreground?:string;background?:string;evidence:string[]}>;
  catalogReplacements?:Array<{blockId:string;widgetKey:string;sourceTextIds:string[]}>;
}

const sourceActive=(atom:SourcePaintAtom)=>atom.visible===true&&atom.rect&&typeof atom.rect==='object'&&atom.rect.width>0&&atom.rect.height>0;
const sourceHidden=(atom:SourcePaintAtom)=>atom.visible===false&&atom.rect&&typeof atom.rect==='object'&&Number.isFinite(atom.rect.width)&&Number.isFinite(atom.rect.height)&&(atom.rect.width===0||atom.rect.height===0);
/** One changed sibling position proves the same recorded responsibility container, not an unrelated same-word node. */
function siblingSourceVariant(a:string,b:string):boolean{
  const left=a.split(' > '),right=b.split(' > ');if(left.length!==right.length)return false;
  const changed=left.map((part,index)=>part===right[index]?-1:index).filter(index=>index>=0);if(changed.length!==1)return false;
  const index=changed[0],pattern=/^([a-z][a-z0-9-]*):nth-of-type\((\d+)\)$/i,x=pattern.exec(left[index]),y=pattern.exec(right[index]);return !!x&&!!y&&x[1]===y[1]&&index>0;
}
function variantSourceLink(owner:SourcePaintAtom,alternate:SourcePaintAtom,siblings:boolean):boolean{
  if(!owner.href&&!alternate.href)return siblings;
  if(!owner.href||!alternate.href||!/^https?:\/\//.test(owner.href)||!/^https?:\/\//.test(alternate.href))return false;
  if(owner.href===alternate.href)return true;
  if(!siblings)return false;const a=new URL(owner.href),b=new URL(alternate.href);a.hash='';b.hash='';return a.href===b.href;
}
/** Both public source captures must show reciprocal visibility; target paint never participates in selecting a source variant. */
export function provenSourceResponsiveVariants(owner:SourceTextOwner,viewport:string,packets:SourceTextPaintPacket[]):SourceResponsiveVariant[]{
  if(owner.sourceState!=='normal')return[];
  const primary=packets.find(packet=>packet.evidencePath===owner.evidencePath),primaryBlock=primary?.blocks.find(block=>block.id===owner.blockId),original=primaryBlock?.textAtoms.find(atom=>atom.selector===owner.selector&&sourceVisibleText(atom.text??'')===sourceVisibleText(owner.text));
  if(!primary||!primaryBlock||!original||!sourceActive(original))return[];
  const proofs:SourceResponsiveVariant[]=[];
  for(const packet of packets.filter(packet=>packet.viewport===viewport)){
    const block=packet.blocks.find(block=>block.id===owner.blockId),current=block?.textAtoms.find(atom=>atom.selector===owner.selector&&sourceVisibleText(atom.text??'')===sourceVisibleText(owner.text));if(!block||!current||!sourceHidden(current))continue;
    for(const alternate of block.textAtoms){
      if(!alternate.selector||alternate.selector===owner.selector||!sourceActive(alternate)||alternate.tag!==original.tag||sourceVisibleText(alternate.text??'')!==sourceVisibleText(original.text??'')||sourceVisibleText(alternate.fullElementText??alternate.text??'')!==sourceVisibleText(original.fullElementText??original.text??''))continue;
      const inactive=primaryBlock.textAtoms.find(atom=>atom.selector===alternate.selector&&atom.tag===alternate.tag&&sourceVisibleText(atom.text??'')===sourceVisibleText(alternate.text??''));if(!inactive||!sourceHidden(inactive))continue;
      const siblings=siblingSourceVariant(owner.selector,alternate.selector);if(!variantSourceLink(original,alternate,siblings))continue;
      proofs.push({ownerSelector:owner.selector,alternateSelector:alternate.selector,primaryEvidence:primary.evidencePath,viewportEvidence:packet.evidencePath,reason:siblings?'Exact recorded sibling responsibility container with reciprocal source visibility':'Same source block and exact public link with reciprocal source visibility'});
    }
  }
  return proofs;
}

/** Load only hash-bound normal DOM packets already frozen inside this current reference job. */
export async function loadSourceTextPaint(contract:BlockContract,jobDir:string):Promise<SourceTextPaintPacket[]> {
  const actualJob=await realpath(path.resolve(jobDir));
  const readBound=async(file:string,expectedHash:string,allowRawObservation=false)=>{
    const absolute=path.resolve(actualJob,file),relative=path.relative(actualJob,absolute);
    if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||(await realpath(absolute)).toLowerCase()!==absolute.toLowerCase())throw new Error('Text paint evidence must stay inside its current real job');
    const info=await stat(absolute);if(!info.isFile()||info.size>20_971_520)throw new Error('Text paint evidence must be a bounded regular file');
    const bytes=await readFile(absolute);if(sha256(bytes)!==expectedHash)throw new Error('Frozen normal text paint evidence changed');
    const text=bytes.toString('utf8').replace(/^\uFEFF/,'').trimStart();
    // An observation may retain raw public CSS/HTML. It remains hash-bound source
    // evidence, but cannot masquerade as a DOM paint packet. Actual JSON and the
    // explicitly structured DOM/interaction kinds still fail on malformed JSON.
    if(allowRawObservation&&(path.extname(absolute).toLowerCase()==='.css'||path.extname(absolute).toLowerCase()!=='.json'&&!/^[\[{]/.test(text)))return{absolute,document:undefined};
    return{absolute,document:JSON.parse(text)};
  };
  const report=await readBound(contract.referenceReport.path,contract.referenceReport.sha256),views=report.document.viewports;
  if(report.document.url!==contract.sourceUrl||!Array.isArray(views))throw new Error('Normal text paint reference does not match its source contract');
  const packets:SourceTextPaintPacket[]=[],conditional:ConditionalSourcePaint[]=[];
  for(const evidence of contract.evidence.filter(item=>['dom','observation','interaction'].includes(item.kind))){
    const value=await readBound(evidence.path,evidence.sha256,evidence.kind==='observation'||evidence.kind==='dom'&&/\.html?$/i.test(evidence.path)),document=value.document;
    if(document===undefined)continue;
    if(document.page?.url===contract.sourceUrl&&document.header&&typeof document.header==='object'&&typeof document.header.id==='string'&&Array.isArray(document.header.textAtoms)){
      const viewport=views.find((view:{name:string;width:number;height:number})=>view.width===document.page.viewport?.width&&view.height===document.page.viewport?.height)?.name;
      if(viewport)conditional.push({evidencePath:value.absolute,viewport,block:document.header});
    }
    if(!Array.isArray(document.blocks))continue;
    const viewport=views.find((view:{name:string;width:number;height:number})=>view.width===document.observedPage?.viewport?.width&&view.height===document.observedPage?.viewport?.height)?.name;
    if(!viewport)continue;
    if(document.observedPage?.url!==contract.sourceUrl)throw new Error('Normal text paint packet identifies a different source page');
    packets.push({evidenceId:evidence.id,evidencePath:value.absolute,viewport,observedPage:{url:document.observedPage.url,viewport:{width:document.observedPage.viewport.width,height:document.observedPage.viewport.height}},blocks:document.blocks.filter((block:unknown)=>block&&typeof block==='object'&&typeof(block as{id?:unknown}).id==='string'&&Array.isArray((block as{textAtoms?:unknown}).textAtoms))});
  }
  const primary=packets.find(packet=>packet.viewport===views[0]?.name);
  if(primary){const owners=reconstructSourceTextOwners(contract,primary,conditional);for(const packet of packets)packet.textOwners=owners;}
  return packets;
}

/** Every exact text binding gets its own paint result; repeated ambiguous source colors never become a guessed expected color. */
export function compareBoundTextPaint(contract:BlockContract,program:NativeProgram,measurements:TargetViewportEvidence[],packets:SourceTextPaintPacket[]):TextPaintReport {
  const checks:TextPaintReport['checks']=[],glyphDiagnostics:TextPaintReport['glyphDiagnostics']=[];
  const catalogBindings=contract.blocks.some(block=>block.dynamicData)||program.blocks.some(block=>block.productQuery)?validateTargetCatalogBindings(contract,program):new Map();
  const catalogReplacements=[...catalogBindings].map(([blockId,binding])=>({blockId,widgetKey:binding.query.widgetKey,sourceTextIds:[...binding.textIds]}));
  for(const viewport of measurements){
    const actualByKey=new Map(viewport.elements.map(element=>[element.sourceId,element]));
    const sourcePackets=packets.filter(packet=>packet.viewport===viewport.name);
    for(let index=0;index<contract.blocks.length;index++){
      const block=contract.blocks[index],bindings=program.blocks[index]?.bindings??[];
      const sourceAtoms=sourcePackets.flatMap(packet=>(packet.blocks.find(source=>source.id===block.id)?.textAtoms??[]).map(atom=>({atom,evidence:packet.evidencePath})));
      for(const text of block.texts){
        if(catalogBindings.get(block.id)?.textIds.has(text.id))continue;
        const binding=bindings.find(item=>item.sourceTextId===text.id),target=binding?actualByKey.get(binding.elementKey):undefined,normalized=sourceVisibleText(text.text);
        const direct=sourceAtoms.filter(item=>sourceVisibleText(item.atom.text??'')===normalized);
        const full=sourceAtoms.filter(item=>sourceVisibleText(item.atom.fullElementText??'')===normalized);
        let candidates=direct.length?direct:full;
        const owner=sourcePackets.flatMap(packet=>packet.textOwners??[]).find(owner=>owner.blockId===block.id&&owner.sourceTextId===text.id);
        const responsiveSourceVariants=owner?provenSourceResponsiveVariants(owner,viewport.name,packets):[];
        if(owner){const selectors=new Set([owner.selector,...responsiveSourceVariants.map(variant=>variant.alternateSelector)]),exact=candidates.filter(item=>selectors.has(item.atom.selector??''));candidates=exact.length?exact:candidates.filter(item=>owner.href&&/^https?:\/\//.test(owner.href)&&item.atom.href===owner.href&&item.atom.tag===owner.tag);}
        else if(block.texts.filter(item=>sourceVisibleText(item.text)===normalized).length>new Set(candidates.map(item=>item.atom.selector)).size)candidates=[];
        const expectedHref=binding&&['price','product-name'].includes(text.kind)?nativeTextHref(program,index,binding.elementKey):undefined,linked=expectedHref?candidates.filter(item=>item.atom.href===expectedHref):[];
        if(linked.length)candidates=linked;
        else if(text.kind==='heading'){const headings=candidates.filter(item=>/^h[1-6]$/.test(item.atom.tag??''));if(headings.length)candidates=headings;}
        else if(text.kind==='label'){const labels=candidates.filter(item=>item.atom.tag&&!/^h[1-6]$/.test(item.atom.tag));if(labels.length)candidates=labels;}
        // Include actual descendants of a composite source text, so differently colored spans are not reduced to the outer text's color.
        const composite=direct.length?candidates:sourceAtoms.filter(item=>candidates.some(parent=>parent.atom.selector&&item.atom.selector&&(item.atom.selector===parent.atom.selector||item.atom.selector.startsWith(`${parent.atom.selector} > `))));
        const usable=composite.filter(item=>item.atom.visible===true&&item.atom.rect&&item.atom.rect.width>0&&item.atom.rect.height>0&&typeof item.atom.style==='object'&&item.atom.style!==null&&typeof item.atom.style.color==='string'&&!!fidelityColorChannels(item.atom.style.color));
        const unique=new Map<string,string>();for(const item of usable){const color=String((item.atom.style as Record<string,unknown>).color);unique.set(fidelityColorChannels(color)!.join(','),color);}
        const sourceColors=[...unique.values()];
        const check:TextPaintReport['checks'][number]={viewport:viewport.name,blockId:block.id,sourceTextId:text.id,elementKey:binding?.elementKey??'',text:text.text,status:'unverified',sourceColors,actualColor:target?.style.color,evidence:[...new Set([...usable.map(item=>item.evidence),...(owner?[owner.evidencePath]:[])])],sourceSelectors:[...new Set([...usable.map(item=>item.atom.selector??'').filter(Boolean),...(owner?[owner.selector]:[])])],sourceOwner:owner,responsiveSourceVariants};
        const inactiveAliasProof=!owner?proveInactiveSourceText(block.id,text.text,viewport.name,packets):undefined;
        const sourceInactive = candidates.length > 0 && candidates.every(({atom})=>atom.visible===false&&atom.rect&&typeof atom.rect==='object'&&Number.isFinite(atom.rect.width)&&Number.isFinite(atom.rect.height)&&(atom.rect.width===0||atom.rect.height===0))||!!inactiveAliasProof;
        if(sourceInactive){
          check.evidence=[...new Set([...candidates.map(item=>item.evidence),...(inactiveAliasProof?.evidence??[])])];check.sourceSelectors=[...new Set([...candidates.map(item=>item.atom.selector??'').filter(Boolean),...(inactiveAliasProof?.selectors??[])])];
          if(retainedHiddenNativeText(program,block.id,text.id,text.text,target)){check.status='source-inactive';check.reason='Frozen source atoms and the native bound element are hidden at this viewport; the exact editable text setting is retained, so no visible glyph color comparison applies';}
          else if(target?.found&&target.nativeElement&&target.visible){check.status='mismatch';check.reason='Frozen source text is hidden at this viewport, but the retained native bound content is visible';}
          else check.reason='Source text is proven inactive, but its exact hidden native content has not been measured';
        }
        else if(!sourceColors.length)check.reason=owner&&!candidates.length?'The frozen original source owner has no matching normal-state atom at this viewport; conditional or same-word sibling paint was not borrowed':sourcePackets.length?'No unique visible source atom with full normal color evidence':'This viewport has no frozen source block paint packet';
        else if(sourceColors.length>1)check.reason='The same source block text has multiple visible normal colors; no expected color was guessed';
        else if(!target?.found||!target.nativeElement||!target.style.color||!fidelityColorChannels(target.style.color))check.reason='The native bound widget has no actual browser text color measurement';
        else check.status=compareFidelityColor(sourceColors[0],target.style.color,contract.tolerances.colorChannel)?'matched':'mismatch';
        if(sourceColors.length===1&&target?.found&&target.nativeElement){
          if(target.visible===false)glyphDiagnostics.push({viewport:viewport.name,blockId:block.id,sourceTextId:text.id,elementKey:binding?.elementKey??'',status:'mismatch',reason:'Source normal text is visible but its actual native bound widget is hidden',foreground:target.style.color,evidence:check.evidence});
          const layers=target.paintLayers??[];
          const ordered=[...layers.filter(layer=>layer.role==='content'),...layers.filter(layer=>layer.role==='background'),...layers.filter(layer=>layer.role==='root')];
          const opaque=ordered.find(layer=>{const color=fidelityColorChannels(layer.style['background-color']??'');return color&&color[3]>=250&&layer.effectiveOpacity>=.98&&(layer.style['background-image']??'none')==='none';});
          const foreground=target.style.color,background=opaque?.style['background-color'];
          if(foreground&&background&&compareFidelityColor(foreground,background,1)){
            const sourcePlainNoBox=usable.every(item=>{const style=item.atom.style as Record<string,unknown>;const bg=fidelityColorChannels(String(style['background-color']??''));return bg&&bg[3]<=1&&(style['background-image']??'none')==='none';});
            glyphDiagnostics.push({viewport:viewport.name,blockId:block.id,sourceTextId:text.id,elementKey:binding?.elementKey??'',status:sourcePlainNoBox?'mismatch':'unverified',reason:sourcePlainNoBox?'Native text foreground matches its opaque painted background, while visible source text has no opaque box':'Native text foreground matches its opaque painted background; source clipping or masking intent is not fully evidenced and requires visual review',foreground,background,evidence:check.evidence});
          }
        }
        checks.push(check);
      }
    }
  }
  const counts={expected:checks.length,matched:checks.filter(check=>check.status==='matched'||check.status==='source-inactive').length,sourceInactive:checks.filter(check=>check.status==='source-inactive').length,errors:checks.filter(check=>check.status==='mismatch').length,unverified:checks.filter(check=>check.status==='unverified').length};
  const glyphErrors=glyphDiagnostics.some(issue=>issue.status==='mismatch');
  return{version:1,passed:counts.errors===0&&counts.unverified===0&&glyphDiagnostics.length===0,colorPassed:counts.errors===0&&!glyphErrors,status:counts.errors||glyphErrors?'failed':counts.unverified||glyphDiagnostics.length?'needs-review':'passed',checks,counts,glyphDiagnostics,catalogReplacements};
}
