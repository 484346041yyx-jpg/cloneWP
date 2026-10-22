import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readCreationInput} from '../core/creation-mode.js';
import {runFullReplicaCLI,FULL_REPLICA_HELP} from './cli.js';
import {validateFullReplicaManifest} from './contract.js';
import {runPreparationCLI,PREPARATION_HELP} from '../replica-preparation/cli.js';
import {validatePreparationPlan} from '../replica-preparation/contract.js';

/** New replicas default to Full Width + WHB. Legacy resume stays on its frozen path. */
export function selectReplicaEntry(input:unknown,args:string[]):'preparation'|'full'|'component'{
 const providerIndex=args.indexOf('--provider');
 const provider=providerIndex<0?undefined:args[providerIndex+1];
 if(providerIndex>=0&&(!['component','woodmart-header-builder'].includes(provider??'')||args.lastIndexOf('--provider')!==providerIndex))throw Error('replica_full_entry_provider');
 if(provider==='component'||args.includes('--resume')){
  if(provider==='woodmart-header-builder'||['clonewp-full-replica','clonewp-replica-preparation'].includes((input as any)?.kind))throw Error('replica_full_entry_provider_conflict');
  if((input as any)?.workflow!=='block-replication')throw Error('replica_full_entry_legacy_program_required');
  return 'component';
 }
 if((input as any)?.kind==='clonewp-replica-preparation'){validatePreparationPlan(input);return 'preparation';}
 if((input as any)?.kind!=='clonewp-full-replica')throw Error('replica_full_entry_manifest_required');
 if(validateFullReplicaManifest(input).headerProvider==='component')return 'component';
 return 'full';
}
export async function runReplicaEntry(args:string[],root='D:/cloneWP'):Promise<unknown>{
 if(!args.length||args.includes('--help'))return {help:PREPARATION_HELP+'\n'+FULL_REPLICA_HELP+'\nPrepared full manifest: create:replica -- FULL_MANIFEST.json [--run-dir DIR]\nPreserved component path: create:replica:component -- PROGRAM.json\nFrozen legacy resume: create:replica -- PROGRAM.json --resume RUN_DIR',remoteWrites:0};
 if(['run','resume','review','publish','status','reconcile','revise-style','revise-header-style','revise-native-motion','revise-layout'].includes(args[0]))return runFullReplicaCLI(args);
 const filename=args.find(a=>!a.startsWith('--')&&/\.json$/i.test(a));if(!filename)throw Error('replica_full_entry_input');
 const {input,filename:absolute}=await readCreationInput(root,filename),provider=selectReplicaEntry(input,args);
 if(provider==='component'){
  const flag=args.indexOf('--provider'),legacy=args.filter((_,i)=>flag<0||i!==flag&&i!==flag+1);
  if((input as any)?.kind==='clonewp-full-replica')return runFullReplicaCLI(['run','--manifest',absolute,'--run-dir',path.join(root,'runs',(input as any).runId)]);
  return new Promise(resolve=>{
   const child=spawn(process.execPath,['--import','tsx',path.join(root,'src/cli.ts'),'--mode','replica',...legacy],{cwd:root,stdio:'inherit',shell:false});
   child.on('error',()=>{process.exitCode=1;resolve({status:'legacy-component-failed'});});
   child.on('exit',code=>{process.exitCode=code??1;resolve({status:'legacy-component-route',exitCode:code});});
  });
 }
 const allowed=new Set([filename,'--provider','woodmart-header-builder','--run-dir']);
 const dirIndex=args.indexOf('--run-dir'),runDirectory=dirIndex<0?path.join(root,'runs',(input as any).runId):args[dirIndex+1];
 if(!runDirectory||args.some((a,i)=>!allowed.has(a)&&i!==dirIndex+1)||args.lastIndexOf('--run-dir')!==dirIndex)throw Error('replica_full_entry_arguments');
 if(provider==='preparation')return runPreparationCLI(['dispatch','--input',absolute,'--run-dir',runDirectory]);
 return runFullReplicaCLI(['run','--manifest',absolute,'--run-dir',runDirectory]);
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
 try{const result=await runReplicaEntry(process.argv.slice(2));console.log(JSON.stringify(result,null,2));if((result as any)?.status==='write-unknown')process.exitCode=2;else if(['awaiting-preparation','awaiting-review','review-changes-required'].includes((result as any)?.status))process.exitCode=3;}
 catch(error){const message=error instanceof Error?error.message:'';console.error(JSON.stringify({error:/^replica_(?:full|preparation|responsive)_[a-z0-9_]+$/.test(message)?message:'replica_full_entry_failed'}));process.exitCode=1;}
}
