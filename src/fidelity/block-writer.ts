import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { writeJson } from '../core/files.js';
import type { WordPressClient,DraftSnapshot } from '../wordpress/client.js';
import type { CompiledFidelity } from './native.js';
import { sha256 } from './check.js';

const canonical=(value:unknown):string=>JSON.stringify(normalize(value));
function normalize(value:unknown):unknown{return Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,child])=>child!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,normalize(child)])):value;}
export interface FidelityBuildIdentity { programSha256:string;contractSha256:string;assetsManifestSha256:string;environmentSha256:string; }
export interface FidelityBuildCheckpoint {
  version:1;runId:string;pageId:number;identity:FidelityBuildIdentity;blockHashes:string[];completedBlocks:number;
  acceptedHash:string;snapshotPath:string;updatedAt:string;
}
function assertSnapshot(snapshot:DraftSnapshot){
  if(snapshot.status!=='draft'||!Number.isInteger(snapshot.pageId)||snapshot.pageId<1||!/^[a-zA-Z\d_-]{4,100}$/.test(snapshot.runId)||snapshot.hash!==sha256(canonical({elements:snapshot.elements,settings:snapshot.settings})))throw Error('A valid owned draft snapshot is required for native block continuation');
}
/** The checkpoint is scoped to this exact frozen program, environment, run and owned draft. */
export function validateBuildCheckpoint(checkpoint:FidelityBuildCheckpoint,options:{snapshot:DraftSnapshot;compiled:CompiledFidelity;identity:FidelityBuildIdentity}){
  assertSnapshot(options.snapshot);
  const expected=options.compiled.composition.elements.map(element=>sha256(canonical(element)));
  if(checkpoint.version!==1||checkpoint.runId!==options.snapshot.runId||checkpoint.pageId!==options.snapshot.pageId||canonical(checkpoint.identity)!==canonical(options.identity)||canonical(checkpoint.blockHashes)!==canonical(expected)||!Number.isInteger(checkpoint.completedBlocks)||checkpoint.completedBlocks<0||checkpoint.completedBlocks>expected.length||checkpoint.acceptedHash!==options.snapshot.hash||checkpoint.snapshotPath!==`target/block-${checkpoint.completedBlocks}.json`||canonical(options.snapshot.elements.map(element=>element.id))!==canonical(options.compiled.sectionIds.slice(0,checkpoint.completedBlocks)))throw Error('Native block checkpoint no longer matches the exact owned run, draft, source or environment');
  return checkpoint.completedBlocks;
}

/** Sequential native writes retain an atomic server guard and complete real readback per block. */
export async function writeFidelityBlocks(options:{
  client:Pick<WordPressClient,'buildDraft'|'snapshotDraft'>;snapshot:DraftSnapshot;compiled:CompiledFidelity;identity:FidelityBuildIdentity;
  runDir:string;blockIds:string[];resume?:boolean;onProgress?:(index:number,blockId:string)=>Promise<void>|void;onSnapshot?:(snapshot:DraftSnapshot)=>void;
}){
  const{client,compiled,runDir,identity}=options;assertSnapshot(options.snapshot);
  if(Object.values(identity).some(value=>!/^[a-f\d]{64}$/.test(value))||compiled.sections.length!==compiled.sectionIds.length||compiled.sectionIds.length!==compiled.composition.elements.length||options.blockIds.length!==compiled.sections.length)throw Error('Frozen native block identity or ordered compilation is incomplete');
  let accepted=options.snapshot,start=0;
  const checkpointPath=path.join(runDir,'target/build-checkpoint.json');
  if(options.resume){
    const checkpoint=JSON.parse(await readFile(checkpointPath,'utf8')) as FidelityBuildCheckpoint;
    start=validateBuildCheckpoint(checkpoint,{snapshot:accepted,compiled,identity});
    const remote=await client.snapshotDraft(accepted.pageId);assertSnapshot(remote);
    if(remote.hash!==accepted.hash||remote.pageId!==accepted.pageId||remote.runId!==accepted.runId||remote.status!==accepted.status||remote.title!==accepted.title||canonical(remote.elements)!==canonical(accepted.elements)||canonical(remote.settings)!==canonical(accepted.settings))throw Error('Owned draft changed before native block continuation; preserve the concurrent change');
    accepted=remote;
  }else if(accepted.elements.length)throw Error('A nonempty owned draft requires its exact native block checkpoint before continuation');
  for(let index=start;index<compiled.sections.length;index++){
    await options.onProgress?.(index,options.blockIds[index]);
    const elements=compiled.composition.elements.slice(0,index+1);
    // buildDraft performs its own current read and the server checks expected state in the same save.
    accepted=await client.buildDraft(accepted.pageId,{...compiled.composition,elements},undefined,{expectedCurrent:accepted});assertSnapshot(accepted);
    if(canonical(accepted.elements.map(element=>element.id))!==canonical(elements.map(element=>element.id))||accepted.elements.some(element=>element.elType!=='container'))throw Error('Saved native source blocks do not match the complete ordered cumulative program');
    options.onSnapshot?.(accepted);
    const snapshotPath=`target/block-${index+1}.json`;await writeJson(path.join(runDir,snapshotPath),accepted);
    const checkpoint:FidelityBuildCheckpoint={version:1,runId:accepted.runId,pageId:accepted.pageId,identity,blockHashes:compiled.composition.elements.map(element=>sha256(canonical(element))),completedBlocks:index+1,acceptedHash:accepted.hash,snapshotPath,updatedAt:new Date().toISOString()};
    await writeJson(checkpointPath,checkpoint);
  }
  return{snapshot:accepted,completedBlocks:compiled.sections.length,skippedBlocks:start,checkpointPath};
}
