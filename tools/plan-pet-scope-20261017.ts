import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PetNative44PlanContext} from './plan-pet-native44-20261016.js';
import {walkNative44,native44Children,type Native44Program,type Native44Component} from '../src/native44/types.js';
import {native44ModuleClass} from '../src/native44/adapters.js';
import {validateNative44Program} from '../src/native44/validate.js';
import {validateDesktopComponentPlan,validateNative44Selection,native44SelectionHash,NATIVE44_SELECTION_RULES_HASH} from '../src/native44/selection.js';
import {loadNative44Knowledge,toNative44CompilerKnowledge} from '../src/native44/knowledge.js';
import {preflightNative44} from '../src/native44/compiler.js';
import type {ComponentPlanV2} from '../src/replica-v2/component-plan.js';
import type {Native44SourceUnit,Native44SelectionDecision} from '../src/native44/selection-types.js';
const dir='D:/cloneWP/references/reference-v2-2026-10-17T01-38-08-872Z-www-petsupermarket-com-0cd5b3b3';
const json=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const digest=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const save=async(p:string,v:unknown)=>writeFile(p,JSON.stringify(v,null,2)+'\n');
const ref=async(p:string)=>({path:p,sha256:digest(await readFile(p))});
const job=await json(dir+'/job.json'),facts=await json(job.sourceFactsPath),manifest=await json(dir+'/asset-manifest.json');
const program:Native44Program=await json(dir+'/program.authoring.json');
const rows:any[]=await json(dir+'/authoring-bindings.json'),bindings=new Map(rows.map(row=>[row.key,row]));
const ctx=new PetNative44PlanContext(facts,manifest.assets);await ctx.loadPackets();const wide=ctx.desktop.id;
const all=walkNative44(program.blocks),byKey=new Map(all.map(node=>[node.key,node])),parent=new Map<string,string|null>();
const visit=(ns:Native44Component[],p:string|null)=>{for(const n of ns){parent.set(n.key,p);visit(native44Children(n),n.key);}};visit(program.blocks,null);
const type=(n:Native44Component)=>n.kind==='composite'?'container':n.kind==='html-static'?'html':n.widgetType;
const at=(n:any,p:string):any=>p.split('.').reduce((v,k)=>v?.[k],n);
const depth=(snapshot:string,id:string)=>{let x:string|null=id,d=0;const packet:any=ctx.packets.get(snapshot);while(x){d++;x=packet.nodes[x]?.parentId;}return d;};
const fields=rows.flatMap(row=>Object.entries(row.fields).map(([id,settingPath])=>({key:row.key,kind:id.slice(0,id.indexOf(':')),source:id.slice(id.indexOf(':')+1),settingPath:String(settingPath)})));
const mapped=new Map<string,Record<string,string[]>>();for(const row of rows){const refs:any={};for(const owner of row.owners)for(const[s,ids]of Object.entries(ctx.mapOwner(owner)))refs[s]=[...new Set([...(refs[s]??[]),...ids])];mapped.set(row.key,refs);}
const nodeMapCache=new Map<string,Record<string,string[]>>();
const mapNode=(id:string,snapshot:string)=>{if(!nodeMapCache.has(id))nodeMapCache.set(id,ctx.mapOwner(id));return nodeMapCache.get(id)![snapshot][0];};
const under=(snapshot:string,id:string,owner:string)=>ctx.beneath(snapshot,id,owner);
const common=(snapshot:string,ids:string[])=>{const packet:any=ctx.packets.get(snapshot);let candidate:string|null=ids[0];while(candidate){if(ids.every(id=>under(snapshot,id,candidate!)))return candidate;candidate=packet.nodes[candidate].parentId;}throw Error('Source unit lacks natural owner');};
const plans:any[]=[],requirements:any[]=[],units:Native44SourceUnit[]=[],decisions:Native44SelectionDecision[]=[],pending:string[]=[];
for(const n of all){plans.push({id:n.key,parentId:parent.get(n.key),role:bindings.get(n.key).rationale,renderer:n.kind==='native-carousel'?'carousel':n.kind,editability:'controls',sourceRegionIds:[...new Set(bindings.get(n.key).owners.map((id:string)=>(ctx.packets.get(wide) as any).nodes[id].regionId))],sourceNodeIds:mapped.get(n.key)![wide],variants:facts.snapshots.map((s:any)=>({snapshotId:s.id,nodeIds:mapped.get(n.key)![s.id],visible:true})),...(n.kind==='native-carousel'?{itemSlots:n.slides!.map(slide=>({id:slide.key,nodeIds:mapped.get(slide.key)![wide]}))}:{} )});}
const plan:ComponentPlanV2={version:2,kind:'component-plan',replicationProfile:'desktop-browser-v1',selectionRulesHash:NATIVE44_SELECTION_RULES_HASH,sourceFacts:program.sourceFacts,desktopSnapshotId:wide,components:plans,requirements,catalogDeferrals:[],sourceUnits:units,selectionDecisions:decisions};
const selectedFacts=new Map<string,{key:string;path:string;kind:string}>();
const snapshotBuckets=new Map<string,Map<string,{owner:string;role:Native44SourceUnit['role'];keys:string[];facts:any[];reason:string}>>();
const contracts=await loadNative44Knowledge([...new Set(all.map(type))]);
const sourceRef=(widgetType:string)=>({path:'D:/cloneWP/data/native44/'+contracts.index.components[widgetType].path,sha256:contracts.index.components[widgetType].sha256});
const localContracts=(types:string[])=>types.map(widgetType=>({widgetType,scope:'local-source' as const,schemaSha256:contracts.index.components[widgetType].sha256,evidence:sourceRef(widgetType)}));
for(const snapshot of facts.snapshots){const sid=snapshot.id,packet:any=ctx.packets.get(sid),sourceFacts=Object.values(facts.facts).filter((f:any)=>f.snapshotId===sid) as any[];
 const buckets=new Map<string,any>();snapshotBuckets.set(sid,buckets);
 const add=(id:string,owner:string,role:Native44SourceUnit['role'],keys:string[],f:any,reason:string)=>{if(!buckets.has(id))buckets.set(id,{owner,role,keys:[...keys],facts:[],reason});const b=buckets.get(id);for(const k of keys)if(!b.keys.includes(k))b.keys.push(k);b.facts.push(f);};
 const shown=(id:string)=>{let cur:string|null=id;while(cur){const st=packet.styles[packet.nodes[cur].styleId];if(st.display==='none'||['hidden','collapse'].includes(st.visibility)||st.opacity==='0')return false;cur=packet.nodes[cur].parentId;}return true;};
 const clones=(Object.values(packet.interactions) as any[]).flatMap(i=>i.cloneNodeIds??[]),controls=(Object.values(packet.interactions) as any[]).flatMap(i=>i.controlNodeIds??[]);
 const cloned=(id:string)=>clones.some(root=>under(sid,id,root));
 const controlled=(id:string)=>controls.some(root=>under(sid,id,root));
 const carousels=(Object.values(packet.interactions) as any[]).filter(i=>i.kind==='carousel');
 const catalogGroups=facts.sourceCommerce.filter((r:any)=>r.snapshotId===sid).flatMap((r:any)=>r.groups).filter((g:any)=>g.status==='catalog');
 for(const group of catalogGroups)plan.catalogDeferrals!.push({snapshotId:sid,groupId:group.id,componentId:group.regionId+'-product-placeholder',reason:'The user explicitly leaves all product configuration for their own later work. Preserve evidence and reserve an editable native structural area.',scope:await ref(dir+'/task-scope.json')});
 const adapted=(f:any,key:string,rule:string,visible=false,extra:any={})=>({id:'req-'+(requirements.length+1),factIds:[f.id],componentId:key,disposition:'adapt',rule,verification:{kind:'presence',selector:'.'+native44ModuleClass(key),snapshotId:sid,viewport:snapshot.viewport.name,expected:{visible,...extra}}});
 for(const f of sourceFacts){let req:any;const root=f.regionId;
  const catalog=catalogGroups.find((g:any)=>under(sid,f.nodeId,g.ownerNodeId));
  const productCard=catalog?.cardNodeIds.some((card:string)=>under(sid,f.nodeId,card));
  if(catalog&&['text','media','interaction'].includes(f.kind)){const key=root+'-product-placeholder';req=adapted(f,key,'User explicitly defers product content, offers, source controls and query configuration. Keep actual facts in evidence without rendering them.',false,{deferredCatalog:catalog.id});add('deferred-'+catalog.id,catalog.ownerNodeId,'deferred-query',[key,root+'-placeholder-note'],f,'Actual independently observed product records remain a deferred query responsibility, owned by the user after delivery.');}
  else if(['region','layout'].includes(f.kind)){req={id:'req-'+(requirements.length+1),factIds:[f.id],componentId:root,disposition:'preserve',rule:'Keep this source visual module, content inset, order and natural geometry.',verification:{kind:f.kind==='layout'?'layout':'presence',selector:'.'+native44ModuleClass(root),snapshotId:sid,viewport:snapshot.viewport.name,expected:f.kind==='layout'?{rect:f.value.rect,contentRect:f.value.contentRect,padding:f.value.padding,margin:f.value.margin}:true,tolerance:3}};const rootFact=sourceFacts.find(x=>x.kind==='region'&&x.regionId===root);add('layout-'+root,rootFact.nodeId,'layout',all.filter(n=>n.kind==='composite'&&plans.find(p=>p.id===n.key).sourceRegionIds.includes(root)).map(n=>n.key),f,'The source region and content-frame observations establish explicit parent, inset and repeated layout responsibilities.');}
  else{
   const candidates=fields.filter(field=>{
    const source=mapNode(field.source,sid),component=byKey.get(field.key)!;
    if(f.kind==='text'&&field.kind==='text')return under(sid,f.nodeId,source);
    if(f.kind==='media'&&field.kind==='media'){const value=at(component,field.settingPath),a=manifest.assets.find((a:any)=>a.key===value?.$asset);return f.nodeId===source&&a?.sourceUrl===f.value.resource.url;}
    if(f.kind==='interaction'&&typeof f.value.href==='string'&&/^https?:/.test(f.value.href)&&field.kind==='link'){
     const value=at(component,field.settingPath),url=typeof value==='string'?value:value?.url;
     return url===f.value.href&&(under(sid,f.nodeId,source)||under(sid,source,f.nodeId));
    }return false;
   }).sort((a,b)=>depth(sid,mapNode(b.source,sid))-depth(sid,mapNode(a.source,sid)));
   const pick=!cloned(f.nodeId)&&!controlled(f.nodeId)&&shown(f.nodeId)?candidates[0]:undefined;
   if(pick){selectedFacts.set(f.id,{key:pick.key,path:pick.settingPath,kind:f.kind});const c=byKey.get(pick.key)!;const row=bindings.get(pick.key);let role:Native44SourceUnit['role']=row.role==='link'?'navigation-list':row.role;
    if(f.kind==='interaction'&&role==='image')role='marketing-card';
    if(role==='layout'&&f.kind==='media')role='decoration';
    const contentIds=[...mapped.get(pick.key)![sid],f.nodeId],owner=common(sid,contentIds);
    add('selected-'+pick.key,owner,role,[pick.key],f,row.rationale);
    const b=buckets.get('selected-'+pick.key);b.owner=common(sid,[b.owner,f.nodeId]);if(f.kind==='interaction'&&b.role==='image')b.role='marketing-card';
    req=f.kind==='text'?{id:'req-'+(requirements.length+1),factIds:[f.id],componentId:pick.key,disposition:'preserve',rule:'Keep the actual wording in its exact editable native field and natural source order.',verification:{kind:'text',selector:'.'+native44ModuleClass(pick.key),snapshotId:sid,viewport:snapshot.viewport.name,expected:{text:f.value.text,visible:f.value.visible}}}:f.kind==='media'?{id:'req-'+(requirements.length+1),factIds:[f.id],componentId:pick.key,disposition:'preserve',rule:'Keep this exact source image/background usage in its task-bound editable native field.',verification:{kind:'media',selector:'.'+native44ModuleClass(pick.key),snapshotId:sid,viewport:snapshot.viewport.name,expected:{assetKey:at(c,pick.settingPath).$asset}}}:{id:'req-'+(requirements.length+1),factIds:[f.id],componentId:pick.key,disposition:'external',rule:'Keep the actual source destination in this exact native link field.',verification:{kind:'external',selector:'.'+native44ModuleClass(pick.key),snapshotId:sid,viewport:snapshot.viewport.name,expected:f.value.href}};
   }else{
    const carousel=carousels.filter(i=>under(sid,f.nodeId,i.nodeId)).sort((a,b)=>depth(sid,b.nodeId)-depth(sid,a.nodeId))[0];
    const hidden=!shown(f.nodeId)||packet.layouts[packet.nodes[f.nodeId].layoutId].rect.width===0||packet.layouts[packet.nodes[f.nodeId].layoutId].rect.height===0;
    const imageAlternative=f.kind==='media'&&fields.some(field=>field.kind==='media'&&mapNode(field.source,sid)===f.nodeId);
    const nativeController=f.kind==='interaction'&&f.value.kind==='carousel'||controlled(f.nodeId)||cloned(f.nodeId)||f.kind==='text'&&/^(?:\d+(?:\s*\/\s*\d+)?|\/)$/.test(f.value.text);
    const sourceOnly=hidden||cloned(f.nodeId)||controlled(f.nodeId)||imageAlternative||nativeController;
    if(!sourceOnly&&f.kind==='text'&&!(root==='header'&&['header-n2','header-n3','header-n770'].includes(f.nodeId)))pending.push(f.id+' '+String(f.value.text));
    if(!sourceOnly&&f.kind==='media')pending.push(f.id+' '+f.value.resource.url);
    let rule=hidden?'Preserve this hidden source state as evidence; do not generate duplicate hidden desktop/mobile content.':cloned(f.nodeId)?'Native carousel owns runtime duplicates; keep each source logical item once.':imageAlternative?'The actual displayed source asset is bound; retain unused picture candidates as source evidence without duplicate display.':nativeController?'Replace source runtime controller nodes and count labels with the declared native manual carousel controls.':'The source-only business/control entrance is adapted to the actual external service destination or page accessibility, without copying source scripts or inventing local state.';
    if(root==='header'&&f.nodeId==='header-n770')rule='The source cart zero is not a target cart fact and is omitted; keep the actual external cart entrance.';
    const owner=carousel?.nodeId??sourceFacts.find(x=>x.kind==='region'&&x.regionId===root)!.nodeId;
    const targetCarousel=root==='hero'?'hero-carousel':root==='header'?'header-notices':root==='specialty-deals'?root+'-cards':byKey.has(root+'-carousel')?root+'-carousel':root;
    const key=carousel?targetCarousel:root;
    req=adapted(f,key,rule,false);
    if(nativeController&&!hidden){req.verification.kind='interaction';req.verification.property='carousel';req.verification.expected={visible:false,nativeManualControls:true};}
    const search=root==='header'&&under(sid,f.nodeId,mapNode('header-n736',sid));
    const bucket=search?'external-search':carousel?'runtime-'+carousel.id:'omitted-'+root;
    const role:Native44SourceUnit['role']=search?'form':carousel?'carousel':root==='header'?'navigation-list':'decoration';
    const keys=search?['header-search']:carousel?[key]:root==='header'?[root,'header-text-982']:root==='recently-viewed'?[root,'recently-viewed-empty']:[root];
    add(bucket,search?mapNode('header-n736',sid):owner,role,keys,f,'Source-only runtime, hidden duplicate or explicitly adapted service content remains independently identified and does not fabricate source business functionality.');
   }
  }
  requirements.push(req);
 }
 // Every source carousel role retains its own independently observed controller fact.
 for(const [bid,bucket]of buckets){if(!bucket.facts.length)continue;
  if(bucket.role==='carousel'&&!bucket.facts.some((f:any)=>f.kind==='interaction'&&f.value.kind==='carousel'&&f.nodeId===bucket.owner)){bucket.role='decoration';}
  const slotFacts=bucket.facts.filter((f:any)=>['text','media','interaction'].includes(f.kind));
  const listOwned=bucket.facts.some((f:any)=>f.kind==='interaction'&&typeof f.value.href==='string'&&Object.entries(packet.nodes).some(([id,n]:any)=>/^(?:ul|ol|nav)$/i.test(n.tag)&&under(sid,f.nodeId,id)));
  if(listOwned&&!['navigation-list','image-card','marketing-card','carousel','deferred-query'].includes(bucket.role)){bucket.role='navigation-list';const native=all.find(n=>n.kind==='native'&&n.widgetType==='wd_list'&&plans.find(p=>p.id===n.key).sourceRegionIds.includes(bucket.facts[0].regionId));if(native&&!bucket.keys.includes(native.key))bucket.keys.push(native.key);}
  const slots=slotFacts.map((f:any,i:number)=>{const picked=selectedFacts.get(f.id);return{id:'slot-'+i,kind:f.kind==='interaction'?(typeof f.value.href==='string'?'link':'interaction'):f.kind, factIds:[f.id],required:!!picked};}) as Native44SourceUnit['slots'];
  const unit:Native44SourceUnit={id:sid+'-'+bid,snapshotId:sid,ownerNodeId:bucket.owner,regionId:bucket.facts[0].regionId,role:bucket.role,sourceFactIds:bucket.facts.map((f:any)=>f.id),evidence:{factIds:bucket.facts.map((f:any)=>f.id),screenshots:[{snapshotId:sid,screenshot:{path:snapshot.screenshot.path,sha256:snapshot.screenshot.sha256}}],rationale:bucket.reason},slots};
  if(unit.role==='navigation-list'&&slots.filter(s=>s.kind==='link').length>1)unit.repeatedItems=slots.filter(s=>s.kind==='link').map((slot,i)=>({id:'item-'+i,ownerNodeId:facts.facts[slot.factIds[0]].nodeId,slotIds:[slot.id]}));
  units.push(unit);const keys=[...new Set(bucket.keys)],types=[...new Set(keys.map(key=>type(byKey.get(key)!)))];
  const decision:Native44SelectionDecision={unitId:unit.id,componentKeys:keys,candidates:[{widgetTypes:types,conclusion:'selected',reason:bucket.reason,evidence:[program.sourceFacts]}],reason:bucket.reason,slotBindings:slots.flatMap(slot=>{const pick=selectedFacts.get(slot.factIds[0]);return pick?[{slotId:slot.id,componentKey:pick.key,settingPath:pick.path}]:[];}),contractRefs:localContracts(types)};
  decisions.push(decision);
 }
}
// A background-bearing source owner also establishes content media on a Container;
// it is distinct from the source region's structural layout unit.
for(const c of all)if(c.kind==='native-carousel'&&!decisions.some(d=>d.componentKeys.includes(c.key)))throw Error('Unowned carousel '+c.key);
const inventories=await Promise.all(facts.sceneInventories.map((r:any)=>json(r.path)));
for(const inventory of inventories){const entries=Object.values(inventory.entries).filter((e:any)=>!e.ownerRegionId) as any[];if(entries.length){const f:any=Object.values(facts.facts).find((f:any)=>f.snapshotId===inventory.snapshotId&&f.kind==='region'&&f.regionId==='footer'),req=requirements.find(r=>r.factIds.includes(f.id));req.disposition='adapt';req.rule='Source-vendor chat and feedback overlays are omitted; this draft retains page-owned footer and actual external navigation.';req.verification={kind:'presence',selector:'.'+native44ModuleClass('footer'),snapshotId:inventory.snapshotId,expected:{footerPresent:true,sourceChatOverlay:false,sourceFeedbackOverlay:false}};(plan.inventoryResolutions??=[]).push({snapshotId:inventory.snapshotId,entryIds:entries.map(e=>e.id),componentId:'footer',factId:undefined,requirementId:req.id,rule:req.rule} as any);delete(plan.inventoryResolutions!.at(-1) as any).factId;}}
for(const gap of facts.gaps){const f:any=Object.values(facts.facts).find((f:any)=>f.snapshotId===gap.snapshotId&&f.nodeId===gap.nodeId);if(!f)throw Error('Gap lacks actual source fact '+gap.code);const req=requirements.find(r=>r.factIds.includes(f.id));req.disposition='adapt';req.verification={kind:'presence',selector:'.'+native44ModuleClass(req.componentId),snapshotId:gap.snapshotId,expected:{nativeControl:true,visible:false}};req.rule='Adapt the source font-icon decoration to the native control glyph; actual native state and movement remain to be verified.';(plan.gapResolutions??=[]).push({snapshotId:gap.snapshotId,code:gap.code,nodeId:gap.nodeId,componentId:req.componentId,requirementId:req.id,rule:req.rule});}
await save(dir+'/unmapped-source-content.json',pending);if(pending.length)throw Error('Visible source content still needs exact native bindings: '+pending.slice(0,12).join('\n'));
plan.selectionReview={reviewer:'codex',status:'approved',reviewedAt:new Date().toISOString(),sourceFacts:program.sourceFacts,selectionRulesHash:NATIVE44_SELECTION_RULES_HASH,decisionsSha256:native44SelectionHash({sourceUnits:units,selectionDecisions:decisions}),screenshots:facts.snapshots.map((s:any)=>({snapshotId:s.id,screenshot:{path:s.screenshot.path,sha256:s.screenshot.sha256}})),reviewedUnitIds:units.map(u=>u.id),checks:{moduleOrder:true,contentOwnership:true,componentSuitability:true,editingGranularity:true},judgment:'The inspected source desktop overviews and actual DOM owners establish module order, complete card responsibilities, separate slide content and page-owned footer. Both native product placeholders implement the explicit user deferral; original product evidence is retained and omitted from rendering. Native manual controls and external service entrances are declared adaptations pending target runtime comparison.'};
await save(dir+'/component-plan.json',plan);program.componentPlan=await ref(dir+'/component-plan.json');await save(dir+'/program.json',program);
validateNative44Program(program);validateDesktopComponentPlan(plan,facts,{sceneInventories:inventories});validateNative44Selection(program,plan,facts,{knowledge:contracts});
const schemas=(await json('D:/cloneWP/reports/native44/target-capabilities.json')).legacySchemas;
const preflight=preflightNative44(program,{schemas,knowledge:toNative44CompilerKnowledge(contracts,schemas),targetOrigin:'https://primevapeoutlet.com'});await save(dir+'/offline-preflight.json',preflight);
await save(dir+'/job.json',{...job,programPath:dir+'/program.json'});
console.log(JSON.stringify({status:'local-source-plan-validated',components:all.length,sourceUnits:units.length,requirements:requirements.length,assets:manifest.assets.length,queries:0,deferredCatalogs:plan.catalogDeferrals!.length}));
