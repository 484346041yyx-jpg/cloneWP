import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadNative44Knowledge,toNative44CompilerKnowledge} from '../src/native44/knowledge.js';
import {validateNative44Selection,native44SelectionHash} from '../src/native44/selection.js';
import {usedNative44WidgetTypes,preflightNative44} from '../src/native44/compiler.js';
const dir='D:/cloneWP/references/reference-v2-2026-10-17T01-38-08-872Z-www-petsupermarket-com-0cd5b3b3';
const read=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
const save=async(p:string,v:unknown)=>writeFile(p,JSON.stringify(v,null,2)+'\n');
const program=await read(dir+'/program.json'),plan=await read(dir+'/component-plan.json'),facts=await read(program.sourceFacts.path);
const capPath=dir+'/target-read-only/capabilities.json',cap=await read(capPath),evidence={path:capPath,sha256:hash(await readFile(capPath))};
for(const d of plan.selectionDecisions){d.contractRefs=d.contractRefs.filter((r:any)=>r.scope!=='target-registered');for(const type of new Set(d.contractRefs.map((r:any)=>r.widgetType)))d.contractRefs.push({widgetType:type,scope:'target-registered',schemaSha256:hash(JSON.stringify(cap.legacySchemas[type as string])),evidence});}
plan.selectionReview.decisionsSha256=native44SelectionHash({sourceUnits:plan.sourceUnits,selectionDecisions:plan.selectionDecisions});plan.selectionReview.reviewedAt=new Date().toISOString();
const knowledge=await loadNative44Knowledge(usedNative44WidgetTypes(program));
validateNative44Selection(program,plan,facts,{knowledge,schemas:cap.legacySchemas});
const preflight=preflightNative44(program,{schemas:cap.legacySchemas,knowledge:toNative44CompilerKnowledge(knowledge,cap.legacySchemas),targetOrigin:'https://primevapeoutlet.com'});
await save(dir+'/target-read-only/preflight.json',preflight);await save(dir+'/component-plan.json',plan);program.componentPlan.sha256=hash(await readFile(dir+'/component-plan.json'));await save(dir+'/program.json',program);
console.log(JSON.stringify({status:'current-target-contracts-bound',remoteWrites:0}));
