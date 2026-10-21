import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import type { BlockContract, NativeProgram, NativeElement, SourceAssetManifest } from './types.js';
import { readSettingPath } from './validate.js';
import type { Viewport } from '../verification/types.js';
import { normalizeSourceScene, sourceSceneBindingSchema, type SourceSceneBinding, type SourceSceneGap, type SourceSceneInventory } from '../reference/source-scene.js';
import { catalogSourceNodeId, catalogTemplateOwnedBy } from './catalog-contract.js';

export interface SourceCoverageIssue extends SourceSceneGap { severity: 'error' | 'warning'; blockId?: string }
export interface SourceCoverageAudit {
  version: 1; passed: boolean; status: 'complete' | 'needs-review' | 'failed';
  counts: { inventories: number; required: number; bound: number; missing: number; unknown: number };
  issues: SourceCoverageIssue[];
  content?: SourceContentCoverage['counts'];
}
export type SourceCoverageReport = SourceCoverageAudit;
export interface SourceContentPacket {
  viewport:string;evidencePath:string;
  blocks:Array<{id:string;carousels?:Array<{slides?:Array<{selector?:string}>}>;textAtoms?:Array<{text?:string;selector?:string;ancestorSelectors?:string[];visible?:boolean;tag?:string;rect?:{x:number;y:number;width:number;height:number};lineLayout?:{visibility?:{painted?:boolean;clippedRatio?:number}}}>;images?:Array<{url?:string;currentSrc?:string;src?:string;selector?:string;ancestorSelectors?:string[];visible?:boolean;loaded?:boolean;rect?:{x:number;y:number;width:number;height:number};visibility?:{painted?:boolean;clippedRatio?:number}}>}>;
}
export interface SourceContentCoverage {
  issues:SourceCoverageIssue[];
  counts:{expectedText:number;matchedText:number;dynamicText:number;expectedMedia:number;matchedMedia:number;dynamicMedia:number};
}
const normalizedCopy=(value:string)=>value.replace(/<[^>]*>/g,' ').replace(/&#x([a-f\d]+);/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16))).replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code))).replace(/&nbsp;|\u00a0/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').normalize('NFC').replace(/\s+/g,' ').trim();
const insideSelector=(selector:string|undefined,owner:string)=>!!selector&&(selector===owner||selector.startsWith(owner+' > '));
const sourceOwns=(record:{selector?:string;ancestorSelectors?:string[]},owner:string)=>insideSelector(record.selector,owner)||record.ancestorSelectors?.includes(owner)===true;
const assetKeys=(value:unknown):string[]=>Array.isArray(value)?value.flatMap(assetKeys):value&&typeof value==='object'?Object.entries(value).flatMap(([key,child])=>key==='$asset'&&typeof child==='string'?[child]:assetKeys(child)):[];
/** One native text may legitimately join adjacent source text nodes; consumed ranges prevent duplicate wording from disappearing. */
function textPool(values:string[]){
  const rows=values.map(value=>({value:normalizedCopy(value),used:new Set<number>()}));
  return {consume(value:string){const expected=normalizedCopy(value);if(!expected)return true;for(const row of rows){let offset=row.value.indexOf(expected);while(offset>=0){if(Array.from({length:expected.length},(_,index)=>offset+index).every(index=>!row.used.has(index))){for(let index=offset;index<offset+expected.length;index++)row.used.add(index);return true;}offset=row.value.indexOf(expected,offset+1);}}return false;},remaining(){return rows.some(row=>Array.from(row.value).some((character,index)=>!/\s/.test(character)&&!row.used.has(index)));}};
}
/** Source atom/media denominators remain independent even if the author omits a heading or whole product field from the contract. */
export function auditSourceContentCoverage(contract:BlockContract,program:NativeProgram|undefined,manifest:SourceAssetManifest|undefined,packets:SourceContentPacket[],inventories:SourceSceneInventory[]):SourceContentCoverage{
  const issues:SourceCoverageIssue[]=[],counts={expectedText:0,matchedText:0,dynamicText:0,expectedMedia:0,matchedMedia:0,dynamicMedia:0};
  for(const inventory of inventories){
    const viewport=inventory.viewport.name,packet=packets.find(packet=>packet.viewport===viewport);
    if(!packet){issues.push({code:'source-static-content-unobserved',severity:'warning',viewport,message:'Independent source text/media packet is unavailable; contract-selected content cannot prove completeness.'});continue;}
    if(inventory.gaps.some(gap=>gap.code==='scene-fast-frames-unobserved')){issues.push({code:'source-static-content-unobserved',severity:'warning',viewport,message:'Fast structural observation omits independent text/media; a complete content packet is still required.'});continue;}
    for(const item of inventory.items.filter(item=>item.kind==='block'&&item.required&&item.visible)){
      const mapping=contract.sourceSceneBindings?.find(binding=>binding.viewport===viewport&&binding.sourceId===item.id&&binding.requirement==='block'),source=mapping&&contract.blocks.find(block=>block.id===mapping.blockId),observed=packet.blocks.find(block=>block.id===item.sourceBlockId),target=source&&program?.blocks.find(block=>block.sourceBlockId===source.id),root=target&&program?.elements.find(node=>node.key===target.rootKey),nodes=root?flatten([root]):[];
      if(!mapping||!source)continue;
      if(!observed||!Array.isArray(observed.textAtoms)||!Array.isArray(observed.images)){issues.push({code:'source-static-content-unobserved',severity:'warning',viewport,blockId:source.id,message:'Observed block has no independent public text and media arrays.'});continue;}
      const template=source.presentationDetails?.viewports[viewport]?.catalogTemplate;
      if(template?.sourceAncestorSelectors){
        const actual=[...observed.textAtoms,...observed.images].some(node=>{
          const chain=node.ancestorSelectors,index=chain?.indexOf(template.sourceNodeId)??-1;
          return index>=0&&JSON.stringify(chain!.slice(index+1))===JSON.stringify(template.sourceAncestorSelectors);
        });
        if(!actual)issues.push({code:'source-catalog-ancestry-unproven',severity:'error',viewport,blockId:source.id,sourceId:template.sourceNodeId,message:'Frozen catalog ancestry does not reproduce any independently captured descendant DOM parent chain.'});
      }
      const repeatedOwners=[...(observed.carousels??[]).flatMap(carousel=>(carousel.slides??[]).flatMap(slide=>slide.selector?[slide.selector]:[])),...inventory.items.filter(feature=>feature.kind==='repeated-template'&&feature.sourceBlockId===item.sourceBlockId).flatMap(feature=>Array.isArray(feature.facts.itemSelectors)?feature.facts.itemSelectors.filter((value):value is string=>typeof value==='string'):[])];
      const inactiveDuplicate=(record:{selector?:string;ancestorSelectors?:string[];rect?:{x:number;y:number;width:number;height:number}},visibility:{painted?:boolean;clippedRatio?:number}|undefined)=>{
        const originalRepeatedItem=repeatedOwners.some(owner=>sourceOwns(record,owner));
        if(originalRepeatedItem)return false;
        if(visibility?.painted===false||visibility?.clippedRatio!==undefined&&visibility.clippedRatio>=.999)return true;
        return !!record.rect&&(record.rect.width<=0||record.rect.height<=0||record.rect.x+record.rect.width<=0||record.rect.x>=inventory.viewport.width);
      };
      const allowedDynamic=new Set(source.dynamicData?.replaceableTextIds??[]),nativeTexts=(target?.bindings??[]).flatMap(binding=>{
        const text=source.texts.find(text=>text.id===binding.sourceTextId),node=nodes.find(node=>node.key===binding.elementKey),actual=node&&readSettingPath(node.settings,binding.settingPath);
        return text&&!allowedDynamic.has(text.id)&&typeof actual==='string'&&normalizedCopy(actual)===normalizedCopy(text.text)?[actual]:[];
      }),pool=textPool(nativeTexts),dynamicPools=(source.dynamicData?.items??[]).map(owner=>({owner,pool:textPool(owner.textIds.flatMap(id=>{
        const text=source.texts.find(text=>text.id===id),query=target?.productQuery;
        return query&&query.sourceTextIds.includes(id)&&nodes.some(node=>node.key===query.widgetKey&&node.type===query.widgetType)&&text?[text.text]:[];
      }))})),controlSelectors=new Set(inventory.items.filter(feature=>feature.kind==='control').map(feature=>feature.selector));
      const seenText=new Set<string>();
      for(const atom of observed.textAtoms){
        const value=normalizedCopy(atom.text??''),identity=(atom.selector??'')+':'+value;
        if(!value||atom.visible===false||inactiveDuplicate(atom,atom.lineLayout?.visibility)||atom.tag==='button'||controlSelectors.has(atom.selector??'')||/^\d+\s*\/\s*\d+$/.test(value)||value==='/'||/^\d+$/.test(value)||seenText.has(identity))continue;
        seenText.add(identity);counts.expectedText++;
        const dynamic=dynamicPools.find(candidate=>sourceOwns(atom,catalogSourceNodeId(candidate.owner,viewport))&&candidate.pool.consume(value));
        if(dynamic){counts.dynamicText++;continue;}
        if(pool.consume(value)){counts.matchedText++;continue;}
        issues.push({code:'source-static-text-omitted',severity:'error',viewport,blockId:source.id,sourceId:atom.selector,message:'Independently observed source copy has no exact native text binding or field-specific catalog substitution: '+value});
      }
      // Resting mobile evidence may hide source copy shown at another width.
      // Omission coverage therefore never treats unused desktop words as a new
      // mobile claim; native visibility is checked by the actual browser lane.
      const mountedAssets=new Set(assetKeys(root)),seenMedia=new Set<string>();
      for(const image of observed.images){
        const urls=[image.url,image.currentSrc,image.src].filter((value):value is string=>typeof value==='string'&&!!value),identity=(image.selector??'')+':'+urls[0];
        if(image.visible===false||inactiveDuplicate(image,image.visibility)||seenMedia.has(identity))continue;
        if(!urls.length){issues.push({code:'source-static-media-unobserved',severity:'warning',viewport,blockId:source.id,sourceId:image.selector,message:'A source image has no actual public resource URL; no previous job or unobserved asset fallback is allowed.'});continue;}
        seenMedia.add(identity);counts.expectedMedia++;
        if(image.loaded===false)issues.push({code:'source-static-media-unready',severity:'warning',viewport,blockId:source.id,sourceId:image.selector,message:'Source image was not rendered ready; downloaded bytes cannot prove its observed source appearance.'});
        const assets=manifest?.assets.filter(asset=>source.assets.includes(asset.key)&&urls.includes(asset.sourceUrl))??[],dynamic=source.dynamicData?.items.some(owner=>sourceOwns(image,catalogSourceNodeId(owner,viewport))&&owner.assetKeys.some(key=>assets.some(asset=>asset.key===key))&&target?.productQuery?.sourceAssetKeys.some(key=>owner.assetKeys.includes(key)));
        if(dynamic){counts.dynamicMedia++;continue;}
        if(assets.some(asset=>mountedAssets.has(asset.key))){counts.matchedMedia++;continue;}
        issues.push({code:'source-static-media-omitted',severity:manifest?'error':'warning',viewport,blockId:source.id,sourceId:image.selector,message:'Independent static source media has no exact downloaded asset/native media mapping; product-block-wide exemptions are forbidden.'});
      }
    }
  }
  return {issues,counts};
}
type CoverageContract = Pick<BlockContract,'sourceUrl'|'blocks'> & { sourceSceneBindings?: SourceSceneBinding[] };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const flatten=(nodes:NativeElement[]):NativeElement[]=>nodes.flatMap(node=>[node,...flatten(node.children??[])]);
export interface SourceRepeatOwnership { kind:'catalog-list'|'catalog-card-slots'|'static-repeat'|'unknown'; sourceItemIndices:number[]; reason:string }
/** A repeated DOM group is not necessarily a product list. In particular, the
 * two paragraphs inside one product card retain their own presentation fact. */
export function classifySourceRepeat(source:BlockContract['blocks'][number],item:SourceSceneInventory['items'][number],inventory:SourceSceneInventory):SourceRepeatOwnership{
  const unknown=(reason:string):SourceRepeatOwnership=>({kind:'unknown',sourceItemIndices:[],reason});
  if(item.kind!=='repeated-template')return unknown('The source fact is not a repeated template.');
  if(!source.dynamicData)return{kind:'static-repeat',sourceItemIndices:[],reason:'This block has no authorized catalog substitution.'};
  const selectors=Array.isArray(item.facts.itemSelectors)?item.facts.itemSelectors.filter((value):value is string=>typeof value==='string'&&!!value):[];
  if(selectors.length<2||new Set(selectors).size!==selectors.length)return unknown('Repeated children have no complete distinct independently observed identities.');
  const viewport=inventory.viewport.name,owners=source.dynamicData.items.map(owner=>catalogSourceNodeId(owner,viewport));
  const records=inventory.items.filter(record=>record.sourceBlockId===item.sourceBlockId);
  const descendants=(child:string,parent:string)=>insideSelector(child,parent)||records.some(record=>record.selector===child&&record.ancestorSelectors?.includes(parent));
  const matches=selectors.map(selector=>owners.flatMap((owner,index)=>descendants(owner,selector)?[index]:[]));
  if(matches.some(match=>match.length)){
    const indices=matches.flat();
    if(matches.every(match=>match.length===1)&&new Set(indices).size===indices.length)return{kind:'catalog-list',sourceItemIndices:indices,reason:'Every repeated child owns one distinct authorized source catalog item.'};
    return unknown('Repeated children mix or ambiguously contain catalog ownership.');
  }
  const containing=owners.flatMap((owner,index)=>sourceOwns(item,owner)?[index]:[]);
  if(containing.length===1&&selectors.every(selector=>descendants(selector,item.selector)))return{kind:'catalog-card-slots',sourceItemIndices:containing,reason:'The repeated container and all its children are inside one independently identified source catalog item.'};
  if(containing.length)return unknown('Repeated source slots do not have one complete catalog item ownership chain.');
  const otherViewportOwners=source.dynamicData.items.flatMap(owner=>[owner.sourceNodeId,...Object.values(owner.sourceNodeIds??{})]).filter(owner=>!owners.includes(owner));
  if(otherViewportOwners.some(owner=>sourceOwns(item,owner)||selectors.some(selector=>descendants(owner,selector))))return unknown('Catalog ownership is recorded only for a different viewport; it cannot establish this source repeat.');
  // Static siblings in a catalog block are permitted only when actual DOM
  // ancestry proves their separate block responsibility, not by text or name.
  const block=records.find(record=>record.kind==='block');
  if(block&&sourceOwns(item,block.selector)&&selectors.every(selector=>descendants(selector,item.selector)))return{kind:'static-repeat',sourceItemIndices:[],reason:'Observed static repeated children are outside every authorized source catalog item, within this source block.'};
  return unknown('The source repeat has no independently proven catalog or static ownership.');
}
function nativeMappingGap(contract:CoverageContract,program:NativeProgram|undefined,binding:SourceSceneBinding,item:SourceSceneInventory['items'][number],inventory:SourceSceneInventory):string|undefined{
  if(!program)return 'Native program is unavailable; a user-authored target key cannot establish source coverage.';
  const source=contract.blocks.find(block=>block.id===binding.blockId),target=program.blocks.find(block=>block.sourceBlockId===binding.blockId),root=target&&program.elements.find(node=>node.key===target.rootKey),nodes=root?flatten([root]):[];
  if(!source||!target||!root||!nodes.some(node=>node.key===binding.targetKey))return 'The mapped key does not exist inside the corresponding native block.';
  if(item.kind==='block'){
    const geometry=source.geometry?.[binding.viewport];
    return binding.targetKey===root.key&&geometry&&Math.abs(geometry.width-item.rect.width)<=.51&&Math.abs(geometry.height-item.rect.height)<=.51?undefined:'A source block must map to its actual native root and preserve independently observed root geometry.';
  }
  const view=source.presentationDetails?.viewports[binding.viewport],regions=view?[...view.regions,...view.media,...view.controlGroups,...view.controlGroups.flatMap(group=>group.controls)]:[],presentationBindings=target.presentationBindings??[],sourceRoot=inventory.items.find(candidate=>candidate.kind==='block'&&candidate.sourceBlockId===item.sourceBlockId);
  const measured=regions.filter(region=>region.sourceNodeId===item.selector),geometryMatches=(region:typeof regions[number])=>!!sourceRoot&&!!region.rect&&Math.abs(region.rect.x+sourceRoot.rect.x-item.rect.x)<=.51&&Math.abs(region.rect.y+sourceRoot.rect.y-item.rect.y)<=.51&&Math.abs(region.rect.width-item.rect.width)<=.51&&Math.abs(region.rect.height-item.rect.height)<=.51,bound=measured.filter(region=>geometryMatches(region)&&presentationBindings.some(candidate=>candidate.id===region.id&&candidate.elementKey===binding.targetKey));
  if(item.kind==='content-frame'){
    const bounds=source.contentBounds?.[binding.viewport];
    if(bounds?.sourceNodeId===item.selector&&target.contentBindings?.[binding.viewport]===binding.targetKey&&Math.abs(bounds.x-item.rect.x)<=.51&&Math.abs(bounds.width-item.rect.width)<=.51)return;
    return bound.length?undefined:'The content frame lacks a selector-matched measured content/presentation binding.';
  }
  if(item.kind==='control'||item.kind==='control-group'){
    const exact=item.kind==='control-group'?view?.controlGroups.filter(group=>group.sourceNodeId===item.selector):item.role==='action'?measured:view?.controlGroups.flatMap(group=>group.controls).filter(control=>control.sourceNodeId===item.selector&&control.role===item.role);
    return exact?.some(region=>geometryMatches(region)&&presentationBindings.some(candidate=>candidate.id===region.id&&candidate.elementKey===binding.targetKey&&(item.kind!=='control'||nodes.find(node=>node.key===binding.targetKey)?.type!=='container'||!!candidate.relativeSelector)))?undefined:'The observed control/group is absent from the independently measured presentation geometry or its actual native presentation binding.';
  }
  if(item.kind==='repeated-template'){
    const ownership=classifySourceRepeat(source,item,inventory);
    if(ownership.kind==='unknown')return ownership.reason;
    if(ownership.kind==='catalog-card-slots'){
      const query=target.productQuery;
      const slots=bound.filter(region=>region.geometryRole==='slot'||region.geometryRole==='card');
      return query&&query.widgetKey===binding.targetKey&&slots.some(region=>presentationBindings.some(candidate=>candidate.id===region.id&&candidate.elementKey===query.widgetKey&&!!candidate.relativeSelector))?undefined:'Catalog-internal repeated slots require their exact measured source container and a bounded presentation probe on the actual native product component.';
    }
    if(ownership.kind==='catalog-list'){
      const selectors=Array.isArray(item.facts.itemSelectors)?item.facts.itemSelectors.filter((value):value is string=>typeof value==='string'):[],template=view?.catalogTemplate;
      const owningItems=template?selectors.filter(selector=>insideSelector(template.sourceNodeId,selector)||template.sourceAncestorSelectors?.includes(selector)):[];
      const catalogOwner=template&&source.dynamicData?.items.some(owner=>catalogTemplateOwnedBy(owner,template,binding.viewport));
      if(!source.dynamicData||!target.productQuery||target.productQuery.widgetKey!==binding.targetKey||!template||owningItems.length!==1||!catalogOwner||template.visibleFraction<.6||!template.slots.length)return 'A catalog template needs one physically visible source card inside its repeated item, the same authorized catalog identity chain, measured slots and exact native target-product component binding.';
      return;
    }
    if(target.productQuery&&!source.dynamicData)return 'A native query cannot establish source catalog ownership without authorized source item identities.';
    return bound.length?undefined:'A static repeated template needs its measured source container and actual native presentation binding.';
  }
}

/** Expected source features come from pre-authoring browser evidence, not the program's selected nodes. */
export function auditSourceCoverage(contract: CoverageContract, inventories: SourceSceneInventory[], options: { requiredViewports?: string[]; priorIssues?: SourceCoverageIssue[];program?:NativeProgram } = {}): SourceCoverageAudit {
  const issues: SourceCoverageIssue[] = [...(options.priorIssues ?? [])], blockIds=new Set(contract.blocks.map(block=>block.id)), rows=contract.sourceSceneBindings??[], requiredViewports=options.requiredViewports??['desktop','tablet','mobile'];
  const bindings: SourceSceneBinding[]=[];
  for(const row of rows){const parsed=sourceSceneBindingSchema.safeParse(row);if(parsed.success)bindings.push(parsed.data);else issues.push({code:'source-binding-invalid',severity:'error',message:'A source scene binding has an invalid identity, kind or target key.'});}
  for(const viewport of requiredViewports)if(!inventories.some(inventory=>inventory.viewport.name===viewport))issues.push({code:'source-scene-viewport-unobserved',severity:'warning',viewport,message:'Required source viewport has no independently captured inventory; legacy or missing evidence cannot prove completeness.'});
  let required=0,bound=0,missing=0;
  const known=new Set<string>();
  for(const inventory of inventories){
    const viewport=inventory.viewport.name;
    if(inventory.sourceUrl!==contract.sourceUrl){issues.push({code:'source-scene-url-mismatch',severity:'error',viewport,message:'Source inventory belongs to a different source URL.'});continue;}
    for(const gap of inventory.gaps)issues.push({...gap,viewport,severity:'warning'});
    const blockMappings=inventory.items.filter(item=>item.kind==='block'&&item.required&&item.visible).map(item=>({item,binding:bindings.find(binding=>binding.viewport===viewport&&binding.sourceId===item.id)}));
    const mappedBlockIds=blockMappings.flatMap(row=>row.binding?[row.binding.blockId]:[]);
    if(new Set(mappedBlockIds).size!==mappedBlockIds.length)issues.push({code:'source-blocks-collapsed',severity:'error',viewport,message:'Distinct independently observed source blocks map to the same native root.'});
    for(const item of inventory.items){
      known.add(`${viewport}:${item.id}`);
      if(!item.required||!item.visible)continue;required++;
      const candidates=bindings.filter(binding=>binding.viewport===viewport&&binding.sourceId===item.id);
      if(!candidates.length){missing++;issues.push({code:'source-feature-unbound',severity:'error',viewport,sourceId:item.id,message:`Observed ${item.kind}${item.role?` (${item.role})`:''} has no native target mapping: ${item.selector}`});continue;}
      if(candidates.length!==1){missing++;issues.push({code:'source-feature-ambiguous-binding',severity:'error',viewport,sourceId:item.id,message:'One source feature has multiple target mappings; ownership is ambiguous.'});continue;}
      const binding=candidates[0];
      if(binding.requirement!==item.kind||!blockIds.has(binding.blockId)||binding.state&&binding.state!==item.state){missing++;issues.push({code:'source-feature-binding-mismatch',severity:'error',viewport,sourceId:item.id,blockId:binding.blockId,message:'The native mapping changes the observed feature kind/state or names a missing contract block.'});continue;}
      const ownerBlock=item.kind!=='block'&&blockMappings.find(row=>row.item.sourceBlockId===item.sourceBlockId)?.binding;
      if(item.kind!=='block'&&(!ownerBlock||ownerBlock.blockId!==binding.blockId)){missing++;issues.push({code:'source-feature-foreign-block',severity:'error',viewport,sourceId:item.id,blockId:binding.blockId,message:'A feature was mapped outside its independently observed block ownership chain.'});continue;}
      const mappingGap=nativeMappingGap(contract,options.program,binding,item,inventory);
      if(mappingGap){missing++;issues.push({code:'source-feature-native-proof-missing',severity:'warning',viewport,sourceId:item.id,blockId:binding.blockId,message:mappingGap});continue;}
      bound++;
    }
    const ordered=inventory.items.filter(item=>item.kind==='block'&&item.required&&item.visible).map(item=>bindings.find(binding=>binding.viewport===viewport&&binding.sourceId===item.id)).filter((value):value is SourceSceneBinding=>!!value).map(binding=>contract.blocks.findIndex(block=>block.id===binding.blockId));
    if(ordered.some((index,position)=>position>0&&index<ordered[position-1]))issues.push({code:'source-block-order-changed',severity:'error',viewport,message:'Mapped source block order differs from the authored contract order.'});
  }
  for(const binding of bindings)if(!known.has(`${binding.viewport}:${binding.sourceId}`))issues.push({code:'source-binding-invented-feature',severity:'error',viewport:binding.viewport,sourceId:binding.sourceId,blockId:binding.blockId,message:'A source binding has no independently enumerated source feature.'});
  if(!inventories.length)issues.push({code:'source-scene-inventory-missing',severity:'warning',message:'No independent pre-authoring scene inventory exists; legacy reports require re-observation and cannot pass by omission.'});
  const errors=issues.some(issue=>issue.severity==='error'),status=errors?'failed':issues.length?'needs-review':'complete';
  return {version:1,passed:status==='complete',status,counts:{inventories:inventories.length,required,bound,missing,unknown:issues.filter(issue=>issue.severity==='warning').length},issues};
}

interface SourceReport { url: string; capturedAt?: string; viewports: Array<{name:string;width:number;height:number;evidencePath?:string;screenshotPath?:string;deviceFacts?:{profile?:Viewport['deviceProfile'];innerWidth?:number;clientWidth?:number;devicePixelRatio?:number;touch?:boolean;coarsePointer?:boolean}}> }
export interface SourceViewportPlan {
  viewports: Array<Viewport & { sourceEvidencePath:string;sourceScreenshotPath?:string;deviceFacts?:SourceReport['viewports'][number]['deviceFacts'];observationKind:'full'|'probe' }>;
  gaps: SourceSceneGap[];
}
type LoadedDocuments = {report:SourceReport;documents:Map<string,Record<string,unknown>>;issues:SourceCoverageIssue[];reportPath:string};
const samePath=(left:string,right:string)=>path.resolve(left).toLowerCase()===path.resolve(right).toLowerCase();
async function loadDocuments(contract:Pick<BlockContract,'sourceUrl'|'referenceReport'|'evidence'>,root?:string,options:{report?:SourceReport;evidenceDocuments?:Map<string,Record<string,unknown>>}={}):Promise<LoadedDocuments>{
  const reportPath=path.resolve(root??process.cwd(),contract.referenceReport.path),evidenceRoot=path.dirname(reportPath),issues:SourceCoverageIssue[]=[],documents=new Map<string,Record<string,unknown>>();
  const reportBytes=await readFile(reportPath),parsedReport=JSON.parse(reportBytes.toString('utf8')) as SourceReport,report=options.report&&JSON.stringify(options.report)===JSON.stringify(parsedReport)?options.report:parsedReport;
  if(digest(reportBytes)!==contract.referenceReport.sha256)throw new Error('Source coverage report bytes changed after contract freezing');
  if(report.url!==contract.sourceUrl||!Array.isArray(report.viewports))throw new Error('Source coverage report does not identify the frozen source URL');
  for(const view of report.viewports){
    if(!view.evidencePath){issues.push({code:'source-scene-document-missing',severity:'warning',viewport:view.name,message:'Legacy source viewport has no independent evidence path; re-observation is required.'});continue;}
    const filename=path.resolve(evidenceRoot,view.evidencePath),relative=path.relative(evidenceRoot,filename);
    if(relative.startsWith(`..${path.sep}`)||relative==='..'||path.isAbsolute(relative)||!samePath(await realpath(filename),filename))throw new Error('Independent source coverage evidence must remain inside its real source directory');
    const bytes=await readFile(filename),attestation=contract.evidence.find(entry=>samePath(path.resolve(root??path.dirname(evidenceRoot),entry.path),filename));
    if(!attestation||digest(bytes)!==attestation.sha256)issues.push({code:'source-scene-evidence-unfrozen',severity:'error',viewport:view.name,message:'Report-selected scene evidence bytes are not attested by the frozen contract.'});
    // Parse actual bytes even when a caller supplied a cached parse, then accept
    // the cache only when it is exactly the same public evidence document.
    const parsed=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>,cached=options.evidenceDocuments?.get(filename);
    documents.set(filename,cached&&JSON.stringify(cached)===JSON.stringify(parsed)?cached:parsed);
  }
  return {report,documents,issues,reportPath};
}

export async function loadSourceCoverage(contract:BlockContract,root?:string,options:{report?:SourceReport;evidenceDocuments?:Map<string,Record<string,unknown>>;program?:NativeProgram}={}):Promise<SourceCoverageAudit>{
  const loaded=await loadDocuments(contract,root,options),inventories:SourceSceneInventory[]=[],issues=[...loaded.issues],contentPackets:SourceContentPacket[]=[];
  for(const view of loaded.report.viewports){
    if(!view.evidencePath)continue;
    const filename=path.resolve(path.dirname(loaded.reportPath),view.evidencePath),document=loaded.documents.get(filename)!,raw=document.sourceScene,stored=document.sceneInventory as SourceSceneInventory|undefined;
    if(!raw||!stored){issues.push({code:'source-scene-inventory-missing',severity:'warning',viewport:view.name,message:'Legacy source evidence has no independent scene inventory; re-observation is required.'});continue;}
    const inventory=normalizeSourceScene(raw,{sourceUrl:contract.sourceUrl,capturedAt:loaded.report.capturedAt??'',evidencePath:filename,viewportName:view.name,deviceProfile:view.deviceFacts?.profile,screenshotPath:view.screenshotPath,screenshotSha256:stored.screenshotSha256});
    if(!inventory||stored.sourceUrl!==contract.sourceUrl||stored.viewport.name!==view.name||stored.viewport.width!==view.width||stored.viewport.height!==view.height||!samePath(stored.evidencePath,filename)||JSON.stringify(stored.items)!==JSON.stringify(inventory.items)){
      issues.push({code:'source-scene-provenance-mismatch',severity:'error',viewport:view.name,message:'Stored source inventory does not reproduce the independently enumerated browser facts and viewport.'});continue;
    }
    if(inventory.viewport.width!==view.width||inventory.viewport.height!==view.height)issues.push({code:'source-scene-effective-viewport-mismatch',severity:'warning',viewport:view.name,message:'The effective source CSS viewport differs from the requested viewport; equivalence remains unverified.'});
    inventories.push(inventory);
    contentPackets.push({viewport:view.name,evidencePath:filename,blocks:(Array.isArray(document.observedBlocks)?document.observedBlocks:Array.isArray(document.blocks)?document.blocks:[]) as SourceContentPacket['blocks']});
    for(const value of Array.isArray(document.responsiveObservations)?document.responsiveObservations:[]){
      const probe=value as {requestedWidth?:number;evidencePath?:string;evidenceSha256?:string;facts?:{innerWidth?:number}},name=`${view.name}-w${probe.requestedWidth}`;
      if(!probe.evidencePath||!probe.evidenceSha256){issues.push({code:'source-responsive-probe-evidence-missing',severity:'warning',viewport:name,message:'A source width observation lacks an immutable independent scene packet; completeness cannot be inferred from its parent viewport.'});continue;}
      const probePath=path.resolve(path.dirname(loaded.reportPath),probe.evidencePath),relative=path.relative(path.dirname(loaded.reportPath),probePath);
      if(relative.startsWith('..')||path.isAbsolute(relative)||!samePath(await realpath(probePath),probePath))throw new Error('Source scene probe evidence escapes its real source directory');
      const bytes=await readFile(probePath);
      if(digest(bytes)!==probe.evidenceSha256){issues.push({code:'source-responsive-probe-bytes-changed',severity:'error',viewport:name,message:'Source responsive scene bytes changed after the parent evidence was captured.'});continue;}
      const packet=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>,storedProbe=packet.sceneInventory as SourceSceneInventory|undefined,probeScene=normalizeSourceScene(packet.sourceScene,{sourceUrl:contract.sourceUrl,capturedAt:loaded.report.capturedAt??'',evidencePath:probePath,viewportName:typeof packet.name==='string'?packet.name:name,deviceProfile:view.deviceFacts?.profile,screenshotPath:typeof packet.screenshotPath==='string'?packet.screenshotPath:undefined,screenshotSha256:typeof packet.screenshotSha256==='string'?packet.screenshotSha256:undefined});
      if(!probeScene||!storedProbe||storedProbe.sourceUrl!==contract.sourceUrl||JSON.stringify(storedProbe.items)!==JSON.stringify(probeScene.items)||storedProbe.viewport.width!==probe.facts?.innerWidth||!samePath(storedProbe.evidencePath,probePath))issues.push({code:'source-responsive-scene-provenance-mismatch',severity:'error',viewport:name,message:'Responsive scene facts are missing or differ from the independently captured packet.'});
      else{inventories.push(probeScene);contentPackets.push({viewport:probeScene.viewport.name,evidencePath:probePath,blocks:(Array.isArray(packet.observedBlocks)?packet.observedBlocks:Array.isArray(packet.blocks)?packet.blocks:[]) as SourceContentPacket['blocks']});}
    }
  }
  let manifest:SourceAssetManifest|undefined;
  const needsMediaProof=inventories.some(inventory=>!inventory.gaps.some(gap=>gap.code==='scene-fast-frames-unobserved')&&contentPackets.find(packet=>packet.viewport===inventory.viewport.name)?.blocks.some(block=>block.images?.some(image=>image.visible!==false&&!!(image.url||image.currentSrc||image.src))));
  if(needsMediaProof&&options.program?.assetsManifest){
    const jobDir=path.dirname(path.dirname(loaded.reportPath)),filename=path.resolve(jobDir,options.program.assetsManifest.path),relative=path.relative(jobDir,filename);
    if(relative.startsWith('..')||path.isAbsolute(relative)||!samePath(await realpath(filename),filename))throw new Error('Source content media manifest escapes the current source job');
    const bytes=await readFile(filename);if(digest(bytes)!==options.program.assetsManifest.sha256)throw new Error('Source content media manifest changed after freezing');
    manifest=JSON.parse(bytes.toString('utf8')) as SourceAssetManifest;
  }
  const content=auditSourceContentCoverage(contract,options.program,manifest,contentPackets,inventories);
  const audit=auditSourceCoverage(contract,inventories,{priorIssues:[...issues,...content.issues],program:options.program});audit.content=content.counts;return audit;
}

/** The authoritative target plan includes real lightweight source-width probes. */
export async function loadSourceViewportPlan(contract:BlockContract,root?:string):Promise<SourceViewportPlan>{
  const loaded=await loadDocuments(contract,root),viewports:SourceViewportPlan['viewports']=[],gaps:SourceSceneGap[]=loaded.issues.map(({severity:_severity,...issue})=>issue);
  for(const view of loaded.report.viewports){
    const filename=view.evidencePath?path.resolve(path.dirname(loaded.reportPath),view.evidencePath):loaded.reportPath,document=loaded.documents.get(filename)??{};
    viewports.push({name:view.name,width:view.width,height:view.height,deviceProfile:view.deviceFacts?.profile??'desktop',deviceScaleFactor:view.deviceFacts?.devicePixelRatio??1,deviceFacts:view.deviceFacts,sourceEvidencePath:filename,...(view.screenshotPath?{sourceScreenshotPath:path.resolve(path.dirname(loaded.reportPath),view.screenshotPath)}:{}),observationKind:'full'});
    const discovery=document.responsiveDiscovery as {gaps?:string[]}|undefined,plan=document.responsivePlan as {omittedBreakpoints?:number[]}|undefined;
    for(const message of discovery?.gaps??[])gaps.push({code:'source-responsive-discovery-gap',viewport:view.name,message});
    if(plan?.omittedBreakpoints?.length)gaps.push({code:'source-responsive-probe-budget',viewport:view.name,message:`Declared source breakpoints not covered by the bounded width plan: ${plan.omittedBreakpoints.join(', ')}.`});
    for(const raw of Array.isArray(document.responsiveObservations)?document.responsiveObservations:[]){
      const probe=raw as {requestedWidth?:number;evidencePath?:string;evidenceSha256?:string;screenshotPath?:string;facts?:{devicePixelRatio?:number;touch?:boolean;coarsePointer?:boolean;innerWidth?:number;clientWidth?:number}};
      if(!Number.isInteger(probe.requestedWidth)||probe.requestedWidth!<240||probe.requestedWidth!>2560||!probe.evidencePath){gaps.push({code:'source-responsive-probe-evidence-missing',viewport:view.name,message:'A legacy width measurement has no independently saved scene/screenshot packet; it cannot prove visual equality.'});continue;}
      const probePath=path.resolve(path.dirname(loaded.reportPath),probe.evidencePath),relative=path.relative(path.dirname(loaded.reportPath),probePath);
      if(relative.startsWith('..')||path.isAbsolute(relative)||!samePath(await realpath(probePath),probePath))throw new Error('Source responsive probe evidence escapes its real source directory');
      const probeBytes=await readFile(probePath);
      if(!probe.evidenceSha256||digest(probeBytes)!==probe.evidenceSha256){gaps.push({code:'source-responsive-probe-unfrozen',viewport:view.name,message:'Responsive source packet bytes do not match their immutable parent observation.'});continue;}
      const packet=JSON.parse(probeBytes.toString('utf8')) as {name?:string;width?:number;height?:number;sceneInventory?:SourceSceneInventory;screenshotPath?:string};
      if(packet.width!==probe.requestedWidth||!packet.height||!packet.sceneInventory||packet.sceneInventory.viewport.width!==probe.facts?.innerWidth){gaps.push({code:'source-responsive-probe-inconsistent',viewport:view.name,message:'Responsive probe facts and independently saved packet do not identify the same real viewport.'});continue;}
      viewports.push({name:packet.name??`${view.name}-w${probe.requestedWidth}`,width:probe.requestedWidth!,height:packet.height,deviceProfile:view.deviceFacts?.profile??'desktop',deviceScaleFactor:probe.facts?.devicePixelRatio??view.deviceFacts?.devicePixelRatio??1,deviceFacts:{profile:view.deviceFacts?.profile??'desktop',...probe.facts},sourceEvidencePath:probePath,...(packet.screenshotPath?{sourceScreenshotPath:packet.screenshotPath}:{}),observationKind:'probe'});
      if(!packet.screenshotPath)gaps.push({code:'source-responsive-probe-screenshot-missing',viewport:packet.name,message:'Responsive source probe has layout facts but no screenshot; pixel evidence remains unavailable.'});
    }
  }
  return {viewports,gaps};
}
