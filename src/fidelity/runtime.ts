import { performance } from 'node:perf_hooks';

export interface RuntimePhase { name:string;startedAt:string;finishedAt?:string;durationMs?:number;status:'running'|'completed'|'failed'; }
/** Diagnostics contain phase labels and counts, never URLs, source text or authentication. */
export function createRuntimeTrace(){
  const startedAt=new Date().toISOString(),started=performance.now(),phases:RuntimePhase[]=[];
  let current:{phase:RuntimePhase;start:number}|undefined;
  const finish=(status:'completed'|'failed'='completed')=>{if(current){current.phase.finishedAt=new Date().toISOString();current.phase.durationMs=Math.round(performance.now()-current.start);current.phase.status=status;current=undefined;}};
  return{
    phase(name:string){if(!/^[a-z\d][a-z\d-]{0,150}$/.test(name))throw Error('Runtime phase labels must be fixed diagnostic identifiers');finish();const phase:RuntimePhase={name,startedAt:new Date().toISOString(),status:'running'};phases.push(phase);current={phase,start:performance.now()};},
    finish,
    snapshot(){return{version:1,startedAt,elapsedMs:Math.round(performance.now()-started),phases:structuredClone(phases)};},
  };
}
