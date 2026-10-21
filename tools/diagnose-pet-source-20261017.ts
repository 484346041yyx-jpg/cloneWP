import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {readNative44SourceCapture} from '../src/native44/source-captures.js';
const dir='D:/cloneWP/references/reference-v2-2026-10-17T01-53-33-144Z-www-petsupermarket-com-0f207465';
const json=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const job=await json(dir+'/job.json'),program=await json(dir+'/program.json'),plan=await json(dir+'/component-plan.json'),facts=await json(job.sourceFactsPath),packets=new Map(),renderEvidence=new Map();
for(const s of facts.snapshots){const ps=[];for(const r of s.evidence)ps.push(await json(r.path));packets.set(s.id,ps);const o=await json(job.sourceRenderEvidenceBySnapshot[s.id].path);o.verifiedAssetDecodes=[];for(const a of o.hostDecodedAssets??[]){const b=await readFile(path.resolve(dir,a.asset.path)),m=await sharp(b).metadata();await sharp(b).raw().toBuffer();o.verifiedAssetDecodes.push({url:a.url,sha256:a.asset.sha256,decoder:'sharp',format:m.format,width:m.width,height:m.height});}renderEvidence.set(s.id,o);}
const set:any={sourceFacts:program.sourceFacts,viewports:program.viewports.map((v:any)=>({viewport:v.name,snapshotId:facts.snapshots.find((s:any)=>s.viewport.width===v.width).id}))};
const out=[];for(const v of program.viewports){const result=await readNative44SourceCapture({set,facts,plan,packets,renderEvidence}as any,v,plan.components.map((c:any)=>({key:c.id})));out.push({viewport:v.name,gaps:result.gaps,badMedia:result.modules.filter(m=>m.media?.some(m=>m.drawable!==true)).map(m=>({key:m.key,media:m.media?.filter(m=>m.drawable!==true)}))});}await writeFile(dir+'/source-render-diagnostic.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));
