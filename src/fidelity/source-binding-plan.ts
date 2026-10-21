import { createHash } from 'node:crypto';
import type { BlockContract, NativeElement, NativeProgram, SourceAssetManifest } from './types.js';
import type { SourceSceneBinding, SourceSceneInventory, SourceSceneItem } from '../reference/source-scene.js';
import type { TargetViewportEvidence } from '../verification/types.js';
import { auditSourceCoverage, classifySourceRepeat } from './source-coverage.js';
import { proposeSourceSceneBindings, type SourceBindingPacket } from './source-binding.js';
import { catalogTemplateOwnedBy } from './catalog-contract.js';
import { presentationItems, type PresentationBinding, type PresentationControl, type PresentationRegion, type TargetPresentationEvidence } from './presentation-contract.js';
import { sourceVisibleText } from './check.js';

export interface SourceBindingPlanFeature {
  viewport:string; sourceId:string; blockId?:string; kind:SourceSceneItem['kind']; selector:string;
  status:'already-bound'|'proposed'|'needs-probe'|'gap'; reason:string; evidence:string[];
  classification?:ReturnType<typeof classifySourceRepeat>;
  binding?:SourceSceneBinding; nativeBinding?:PresentationBinding;
  /** Source-only changes are measured facts. They never overwrite target measurements. */
  presentationChange?:{id:string;before?:PresentationRegion;after:PresentationRegion;kind:'region'|'control'|'control-group'};
  targetActual?:{rect?:TargetPresentationEvidence['rect'];visible?:boolean;count:number;source:string};
  requiredFollowUp?:string[];
}
export interface SourceBindingPlan {
  version:1; wholeTaskPassed:false; writes:{contract:0;program:0;target:0};
  baseline:ReturnType<typeof auditSourceCoverage>['counts'];
  counts:{required:number;alreadyBound:number;proposed:number;needsProbe:number;gaps:number};
  additions:SourceSceneBinding[]; features:SourceBindingPlanFeature[];
  notice:string;
}
export interface SourceBindingPlanOptions {
  contract:BlockContract;program:NativeProgram;inventories:SourceSceneInventory[];packets:SourceBindingPacket[];manifest?:SourceAssetManifest;
  measurements:TargetViewportEvidence[];presentationEvidence:TargetPresentationEvidence[];
  /** Independently captured DOM Node.contains observations, not program-tree expectations. */
  nativeContainment?:Array<{viewport:string;ancestorKey:string;descendantKey:string;contained:boolean;evidence:string[]}>;
  /** Caller obtains both values from immutable file bytes and the current revision receipt. */
  programSha256:string;targetProof:{programSha256:string;beforeHash:string;afterHash:string;nativeDocumentPassed:boolean;evidencePath:string};
}
const flatten=(nodes:NativeElement[]):NativeElement[]=>nodes.flatMap(node=>[node,...flatten(node.children??[])]);
const identity=(viewport:string,sourceId:string)=>viewport+'\0'+sourceId;
const within=(selector:string,owner:string)=>selector===owner||selector.startsWith(owner+' > ');
const finite=(rect:{x:number;y:number;width:number;height:number}|undefined)=>!!rect&&[rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)&&rect.width>=0&&rect.height>=0;
const measuredId=(selector:string)=>'source-plan-'+createHash('sha256').update(selector).digest('hex').slice(0,18);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

/** Plan from independent source facts and actual same-document native probes.
 * This is an authoring aid, not a way to grant acceptance to its proposals. */
export function planSourceBindingRepairs(options:SourceBindingPlanOptions):SourceBindingPlan{
  const {contract,program,inventories,packets,measurements,presentationEvidence}=options;
  const audit=auditSourceCoverage(contract,inventories,{program,requiredViewports:inventories.map(scene=>scene.viewport.name)}),bad=new Set(audit.issues.filter(issue=>issue.sourceId&&issue.code.startsWith('source-feature-')).map(issue=>identity(issue.viewport??'',issue.sourceId!)));
  const base=proposeSourceSceneBindings({contract,program,inventories,packets,manifest:options.manifest});
  const coherent=/^[a-f0-9]{64}$/.test(options.programSha256)&&options.programSha256===options.targetProof.programSha256&&/^[a-f0-9]{64}$/.test(options.targetProof.beforeHash)&&options.targetProof.beforeHash===options.targetProof.afterHash&&options.targetProof.nativeDocumentPassed&&!!options.targetProof.evidencePath;
  const result:SourceBindingPlan={version:1,wholeTaskPassed:false,writes:{contract:0,program:0,target:0},baseline:audit.counts,counts:{required:0,alreadyBound:0,proposed:0,needsProbe:0,gaps:0},additions:[],features:[],notice:'Proposals preserve the independent source denominator. Fresh source selector/geometry changes require a separately frozen revision; all target rectangles below are actual QA measurements and may still mismatch the source. No proposal grants visual, behavioral, responsive, data or editor completion.'};
  for(const scene of inventories){
    const viewport=scene.viewport.name,packet=packets.find(packet=>packet.viewport===viewport),knownEvidence=new Set(contract.evidence.map(e=>e.id));
    for(const item of scene.items.filter(item=>item.required&&item.visible)){
      result.counts.required++;
      const existing=contract.sourceSceneBindings?.find(binding=>binding.viewport===viewport&&binding.sourceId===item.id),proposed=base.bindings.find(binding=>binding.viewport===viewport&&binding.sourceId===item.id);
      const blockId=existing?.blockId??proposed?.blockId??base.blocks.find(row=>row.viewport===viewport&&row.sourceBlockId===item.sourceBlockId)?.blockId;
      const source=contract.blocks.find(block=>block.id===blockId),target=program.blocks.find(block=>block.sourceBlockId===blockId),root=target&&program.elements.find(node=>node.key===target.rootKey),nodes=root?flatten([root]):[];
      const row:SourceBindingPlanFeature={viewport,sourceId:item.id,blockId,kind:item.kind,selector:item.selector,status:'gap',reason:'Source/native block ownership is unresolved.',evidence:[scene.evidencePath,options.targetProof.evidencePath]};result.features.push(row);
      if(existing&&!bad.has(identity(viewport,item.id))){row.status='already-bound';row.reason='Existing binding reproduces its independent source fact and current native program.';row.binding=existing;continue;}
      if(!source||!target||!root||!packet||!knownEvidence.has(packet.evidenceId)){row.requiredFollowUp=['Resolve the source block against current hash-bound source evidence and its actual native root.'];continue;}
      if(scene.sourceUrl!==contract.sourceUrl||program.sourceUrl!==contract.sourceUrl){row.reason='Source URL identity differs between the independent scene, contract and program.';continue;}
      const sourceRoot=scene.items.find(candidate=>candidate.kind==='block'&&candidate.sourceBlockId===item.sourceBlockId),view=source.presentationDetails?.viewports[viewport],observed=packet.blocks.find(block=>block.id===item.sourceBlockId);
      if(!sourceRoot||!finite(sourceRoot.rect)||!finite(item.rect)){row.reason='Independent source geometry is missing or non-finite.';continue;}
      if(item.kind==='repeated-template')row.classification=classifySourceRepeat(source,item,scene);
      const actualNode=(key:string)=>{const views=measurements.filter(measured=>measured.name===viewport),matches=views.length===1?views[0].elements.filter(element=>element.sourceId===key):[];return nodes.filter(node=>node.key===key).length===1&&matches.length===1&&matches[0].found&&matches[0].count===1&&matches[0].nativeElement?matches[0]:undefined;};
      const actualDetail=(id:string)=>{const matches=presentationEvidence.filter(detail=>detail.viewport===viewport&&detail.blockId===source.id&&detail.id===id);return matches.length===1&&matches[0].found&&matches[0].count===1&&finite(matches[0].rect)?matches[0]:undefined;};
      const bindings=target.presentationBindings??[],regions=view?presentationItems(view):[];
      let native:PresentationBinding|undefined,presentationId:string|undefined,previous:PresentationRegion|undefined,proof:TargetPresentationEvidence|undefined,reason:string|undefined;
      const sourceKindMatches=(region:PresentationRegion)=>item.kind==='control'?item.role==='action'?region.geometryRole==='control'&&!('role'in region):'role'in region&&region.role===item.role:item.kind==='control-group'?'controls'in region&&'ownerId'in region:!('role'in region)&&!('controls'in region);
      const probeKindMatches=(region:PresentationRegion,actual:TargetPresentationEvidence)=>{
        if(item.kind==='control-group'){
          const ids=Array.isArray(item.facts.controlIds)?item.facts.controlIds:[],children=ids.map(id=>scene.items.find(child=>child.id===id&&child.kind==='control'&&child.sourceBlockId===item.sourceBlockId));
          if(!ids.length||children.some(child=>!child)||!actual.controlInventory?.length||!('ownerId'in region)||!actual.containedByIds?.includes(String(region.ownerId)))return false;
          return children.every(child=>child!.role&&actual.controlInventory!.some(probe=>probe.role===child!.role&&probe.matched===children.filter(member=>member!.role===child!.role).length&&probe.visible===children.filter(member=>member!.role===child!.role&&member!.visible).length));
        }
        if(item.kind==='control'&&item.role==='fraction')return typeof actual.text==='string'&&/^\s*\d+\s*\/\s*\d+\s*$/.test(actual.text);
        if(item.kind==='control'&&item.role!=='action'){
          const group=view?.controlGroups.find(group=>group.controls.some(control=>control.id===region.id&&control.role===item.role)),groupProbe=group&&actualDetail(group.id);
          // Independent native inventory plus actual DOM containment proves the
          // control kind. A missing glyph remains a separate visual gap; it is
          // neither invented here nor used to rename another native action.
          const sourceMembers=scene.items.filter(member=>member.kind==='control'&&member.sourceBlockId===item.sourceBlockId&&member.ownerId===item.ownerId&&member.role===item.role);
          return !!item.ownerId&&sourceMembers.length>0&&!!group&&actual.containedByIds?.includes(group.id)===true&&groupProbe?.controlInventory?.some(probe=>probe.role===item.role&&probe.matched===sourceMembers.length&&probe.visible===sourceMembers.filter(member=>member.visible).length)===true;
        }
        return true;
      };
      const exact=regions.flatMap(region=>region.sourceNodeId===item.selector&&sourceKindMatches(region)?bindings.filter(binding=>binding.id===region.id).map(binding=>({region,binding})):[]);
      if(exact.length===1&&actualNode(exact[0].binding.elementKey)&&actualDetail(exact[0].region.id)&&probeKindMatches(exact[0].region,actualDetail(exact[0].region.id)!)){
        ({binding:native,region:previous}=exact[0]);presentationId=previous.id;proof=actualDetail(previous.id);reason='Exact source selector, same-block native presentation binding and current unique actual probe.';
      }
      // Source repeated owner -> native component is established before using a
      // control role. A role or one nearby button alone cannot select a slider.
      if(!native&&['control','control-group'].includes(item.kind)&&item.ownerId){
        const owner=scene.items.find(candidate=>candidate.id===item.ownerId&&candidate.kind==='repeated-template'&&candidate.sourceBlockId===item.sourceBlockId);
        const template=view?.catalogTemplate,children=Array.isArray(owner?.facts.itemSelectors)?owner!.facts.itemSelectors.filter((value):value is string=>typeof value==='string'):[];
        const catalogOwner=!!owner&&!!target.productQuery&&!!template&&children.some(child=>within(template.sourceNodeId,child)||template.sourceAncestorSelectors?.includes(child))&&source.dynamicData?.items.some(candidate=>catalogTemplateOwnedBy(candidate,template,viewport));
        const controls=item.kind==='control'?view?.controlGroups.flatMap(group=>group.controls).filter(control=>control.role===item.role)??[]:view?.controlGroups??[];
        const candidates=controls.flatMap(control=>bindings.filter(binding=>binding.id===control.id).flatMap(binding=>{
          const actual=actualDetail(control.id);if(!actual||!sourceKindMatches(control)||!probeKindMatches(control,actual)||!actualNode(binding.elementKey))return[];
          if(catalogOwner&&binding.elementKey!==target.productQuery!.widgetKey)return[];
          if(!catalogOwner){
            // Exact independently captured source siblings (e.g. previous/next)
            // may identify one static carousel even if its legacy track binding
            // was wrong. Their shared target owner must itself be a real native
            // carousel, never a plain layout container.
            const node=nodes.find(node=>node.key===binding.elementKey);
            const peers=owner&&scene.items.filter(peer=>peer.kind==='control'&&peer.ownerId===owner.id&&peer.id!==item.id).flatMap(peer=>regions.filter(region=>region.sourceNodeId===peer.selector&&'role'in region&&region.role===peer.role).flatMap(region=>bindings.filter(candidate=>candidate.id===region.id&&candidate.elementKey===binding.elementKey)));
            if(!node||!/carousel|slider|^slides$/i.test(node.type)||!peers?.length)return[];
          }
          return[{control,binding,actual}];
        }));
        if(candidates.length===1){const candidate=candidates[0];native=candidate.binding;previous=candidate.control;presentationId=previous.id;proof=candidate.actual;reason=catalogOwner?'Independent source catalog owner, exact native query owner and unique same-role actual control probe.':'Independent source control siblings identify one actually rendered native carousel and same-role probe.';}
      }
      if(!native&&proposed&&item.kind==='repeated-template'&&row.classification?.kind==='catalog-list'&&actualNode(proposed.targetKey)){
        native={id:item.id,elementKey:proposed.targetKey};reason='Every independently repeated source item belongs to the authorized catalog, with its actual unique native query component.';
      }
      if(!native&&proposed){
        const addition=base.presentation.find(change=>change.blockId===source.id&&change.viewport===viewport&&change.region.sourceNodeId===item.selector&&change.binding.elementKey===proposed.targetKey),node=actualNode(proposed.targetKey);
        if(addition&&node?.visible){native=addition.binding;presentationId=addition.region.id;reason='Independent exact static copy/media fingerprint maps to a unique actually visible same-block native subtree.';}
      }
      if(!native&&item.kind==='content-frame'){
        const key=target.contentBindings?.[viewport],node=key&&actualNode(key);
        if(key&&node){
          // Still only a candidate: positive responsibility and real DOM
          // containment are proved below for exact and fallback paths alike.
          native={id:measuredId(item.selector),elementKey:key};presentationId=native.id;reason='Explicit native content responsibility has a unique actual measured node; its source frame identity/geometry must be freshly frozen.';
        }
      }
      if(!native){
        if(item.kind==='repeated-template'&&row.classification?.kind==='catalog-card-slots'){
          row.reason='Source card-internal repeated children are preserved as independent requirements; no exact native subregion/semantic child-role probe exists.';
          row.requiredFollowUp=['Freeze each source child slot role from owned source facts.','Observe the actual corresponding native card subregion and its children; a whole query/track or one product name cannot stand in for the two source slots.'];
        }else if(item.kind==='repeated-template'&&row.classification?.kind==='unknown'){
          row.reason=row.classification.reason;row.requiredFollowUp=['Complete source item ownership from exact current text/media evidence, preserving historical authorization; do not classify this unknown repeat as static.'];
        }else if(item.kind==='control'&&item.role==='autoplay'){
          row.reason='Observed manual source autoplay control has no independently measured matching native action.';row.requiredFollowUp=['Discover and test a registered native manual autoplay control; autoplay settings alone are insufficient.'];
        }else{row.reason='No unique source-to-native identity with actual same-block probe exists.';row.requiredFollowUp=['Capture the exact source responsibility and corresponding native DOM probe; preserve ambiguity until it is resolved.'];}
        continue;
      }
      if(item.kind==='content-frame'){
        const candidate=nodes.find(node=>node.key===native!.elementKey)!,ownedKeys=new Set(flatten([candidate]).map(node=>node.key)),isWithin=(record:{selector:string;ancestorSelectors?:string[]})=>within(record.selector,item.selector)||record.ancestorSelectors?.includes(item.selector)===true;
        const blockedCapture=new Set(['scene-invalid-item','scene-fast-frames-unobserved','scene-node-limit','scene-control-limit','scene-fraction-scan-limit','scene-blocks-unobserved']);
        const complete=!!observed&&Array.isArray(observed.textAtoms)&&Array.isArray(observed.images)&&Array.isArray(observed.nodes)&&observed.nodes.some(node=>node.selector===item.selector)&&!scene.gaps.some(gap=>blockedCapture.has(gap.code));
        const features=scene.items.filter(feature=>feature.id!==item.id&&feature.sourceBlockId===item.sourceBlockId&&feature.required&&feature.visible&&isWithin(feature));
        const text=(observed?.textAtoms??[]).filter(atom=>atom.visible!==false&&!!sourceVisibleText(atom.text??'')&&isWithin(atom)),media=(observed?.images??[]).filter(image=>image.visible!==false&&isWithin(image));
        const contains=(key:string)=>{
          if(!ownedKeys.has(key)||!actualNode(key))return false;if(key===native!.elementKey)return true;
          const explicit=options.nativeContainment?.filter(probe=>probe.viewport===viewport&&probe.ancestorKey===native!.elementKey&&probe.descendantKey===key);
          if(explicit?.length)return explicit.length===1&&explicit[0].contained===true&&explicit[0].evidence.length>0;
          const owners=bindings.filter(binding=>binding.elementKey===native!.elementKey&&!binding.relativeSelector&&actualDetail(binding.id)),children=bindings.filter(binding=>binding.elementKey===key&&!binding.relativeSelector&&actualDetail(binding.id));
          return owners.length>0&&children.length>0&&children.every(child=>owners.some(owner=>actualDetail(child.id)!.containedByIds?.includes(owner.id)));
        };
        const featureMappings=features.map(feature=>({feature,mapping:!bad.has(identity(viewport,feature.id))?contract.sourceSceneBindings?.find(binding=>binding.viewport===viewport&&binding.sourceId===feature.id&&binding.requirement===feature.kind&&(!binding.state||binding.state===feature.state)):undefined}));
        const missingFeature=featureMappings.some(({mapping})=>!mapping||mapping.blockId!==source.id||!contains(mapping.targetKey)),covered=(record:{selector:string;ancestorSelectors?:string[]})=>featureMappings.some(({feature,mapping})=>mapping&&contains(mapping.targetKey)&&(within(record.selector,feature.selector)||record.ancestorSelectors?.includes(feature.selector)));
        const missingText=text.some(atom=>{
          if(covered(atom))return false;
          const values=source.texts.filter(value=>sourceVisibleText(value.text)===sourceVisibleText(atom.text??'')&&!source.dynamicData?.replaceableTextIds.includes(value.id));
          return !values.length||values.some(value=>{const matches=target.bindings.filter(binding=>binding.sourceTextId===value.id);return matches.length!==1||!contains(matches[0].elementKey);});
        });
        const mountedAssets=(value:unknown):string[]=>Array.isArray(value)?value.flatMap(mountedAssets):value&&typeof value==='object'?Object.entries(value).flatMap(([key,child])=>key==='$asset'&&typeof child==='string'?[child]:mountedAssets(child)):[];
        const missingMedia=media.some(image=>{
          if(covered(image))return false;const urls=[image.url,image.currentSrc,image.src].filter(Boolean),assets=options.manifest?.assets.filter(asset=>source.assets.includes(asset.key)&&urls.includes(asset.sourceUrl))??[];
          const owners=nodes.filter(node=>assets.some(asset=>mountedAssets(node.settings).includes(asset.key)));return !assets.length||!owners.length||owners.some(owner=>!contains(owner.key));
        });
        if(!complete||features.length+text.length+media.length===0||missingFeature||missingText||missingMedia){
          row.reason=complete&&features.length+text.length+media.length>0?'The assigned native content key has only a partial subtree proof: every independent source responsibility needs a mapped actual native descendant and positive DOM containment.':'Source content-frame scope is incomplete or has no independently observed responsibility descendants; absence of outside mappings proves nothing.';
          row.requiredFollowUp=['Capture the complete source frame node, text/media arrays and independently enumerated descendant responsibilities.','Resolve every descendant mapping and observe real same-block native DOM Node.contains for its assigned container; program-tree containment alone is insufficient.'];continue;
        }
      }
      row.nativeBinding=native;
      row.binding={viewport,sourceId:item.id,blockId:source.id,targetKey:native.elementKey,requirement:item.kind,state:item.state};
      if(proof)row.targetActual={rect:proof.rect,visible:proof.visible,count:proof.count,source:proof.evidence.join('; ')};
      else{const node=actualNode(native.elementKey)!;row.targetActual={rect:node.rect,visible:node.visible,count:node.count,source:measurements.find(measurement=>measurement.name===viewport)?.evidencePath??''};}
      if(item.kind!=='repeated-template'||row.classification?.kind!=='catalog-list'){
        const after:PresentationRegion={...(previous??{}),id:presentationId??measuredId(item.selector),sourceNodeId:item.selector,evidence:[...new Set([...(previous?.evidence??[]),packet.evidenceId])],rect:{...item.rect,x:item.rect.x-sourceRoot.rect.x,y:item.rect.y-sourceRoot.rect.y},visible:item.visible,geometryRole:item.kind==='control'?'control':'content'};
        const node=observed?.nodes?.find(node=>node.selector===item.selector),paint=node?.style;
        if(paint&&typeof paint==='object')after.paint=Object.fromEntries([['color',paint.color],['backgroundColor',paint['background-color']],['borderColor',paint['border-top-color']]].filter((row):row is [string,string]=>typeof row[1]==='string'));
        if(item.kind==='control'&&item.role&&item.role!=='action'&&item.role!=='unknown')Object.assign(after,{role:item.role,...(typeof item.facts.disabled==='boolean'?{disabled:item.facts.disabled}:{}),...(typeof item.facts.active==='boolean'?{active:item.facts.active}:{}),...(item.facts.glyph&&typeof item.facts.glyph==='object'&&['svg','pseudo','image','text','none'].includes(String((item.facts.glyph as {kind?:unknown}).kind))?{glyph:item.facts.glyph as PresentationControl['glyph']}:{}),...(item.role==='fraction'?{text:String(item.facts.label||((item.facts.glyph as {content?:string})?.content??'')),textMatch:'fraction',...(target.productQuery?{fractionTotal:'target-query'}:{})}:{})} satisfies Partial<PresentationControl>);
        row.presentationChange={id:after.id,...(previous?{before:previous}:{}),after,kind:item.kind==='control-group'?'control-group':item.kind==='control'&&item.role!=='action'?'control':'region'};
        if(previous&&same(previous,after))delete row.presentationChange;
      }
      row.reason=reason!;
      row.status=coherent?'proposed':'needs-probe';
      row.requiredFollowUp=[...(row.presentationChange?['Preserve the previous source presentation entry and freeze this freshly measured selector/geometry in a new contract revision.']:[]),'Recapture and compare actual native presentation, control behavior and editor save/readback; this plan grants no fidelity pass.',...(!coherent?['Current target evidence is not bound to these exact program bytes and an unchanged actual document hash.']:[])];
      if(row.status==='proposed'&&!existing)result.additions.push(row.binding);
    }
  }
  result.counts.alreadyBound=result.features.filter(row=>row.status==='already-bound').length;result.counts.proposed=result.features.filter(row=>row.status==='proposed').length;result.counts.needsProbe=result.features.filter(row=>row.status==='needs-probe').length;result.counts.gaps=result.features.filter(row=>row.status==='gap').length;
  return result;
}
