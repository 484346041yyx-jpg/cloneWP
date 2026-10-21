/** Completion is a conjunction of independent evidence lanes, never a count of hard errors. */
export type CompletionStatus = 'passed' | 'failed' | 'needs-review' | 'unchecked';
export type CompletionAxis = 'editable' | 'data' | 'visual' | 'behavior' | 'responsive' | 'evidence';
export interface CompletionIssue {code:string;severity:'error'|'warning';message:string;viewport?:string;blockId?:string}
export interface CompletionLane {status:CompletionStatus;required:boolean;reasons:string[]}
export interface CompletionReport {
  version:1;passed:boolean;status:'passed'|'failed'|'needs-review';
  lanes:Record<CompletionAxis,CompletionLane>;issues:CompletionIssue[];
  notice:string;
}
export function completionLane(passed:boolean|CompletionStatus|undefined,reasons:string[]=[],required=true):CompletionLane {
  return {status:typeof passed==='string'?passed:passed===undefined?'unchecked':passed?'passed':'failed',required,reasons};
}
export function resolveCompletion(lanes:Record<CompletionAxis,CompletionLane>,issues:CompletionIssue[]=[]):CompletionReport {
  const copied=structuredClone(lanes),pending=Object.entries(copied).filter(([,lane])=>lane.required&&lane.status!=='passed');
  const allIssues=[...issues];
  for(const[axis,lane]of pending)if(!lane.reasons.length)lane.reasons.push(`${axis} has not been proved by its required acceptance evidence`);
  const passed=pending.length===0&&allIssues.length===0;
  return {version:1,passed,status:passed?'passed':pending.some(([,lane])=>lane.status==='failed')||allIssues.some(issue=>issue.severity==='error')?'failed':'needs-review',lanes:copied,issues:allIssues,notice:'Native editability, correct data, appearance, behavior, responsive layout and source evidence are separate requirements. Zero hard errors is not completion; unchecked requirements, warnings and named gaps prevent a pass.'};
}

export function fidelityCompletion(input:{
  editable?:boolean|CompletionStatus;data:boolean|CompletionStatus;visual:boolean|CompletionStatus;behavior:boolean|CompletionStatus;responsive:boolean|CompletionStatus;evidence:boolean|CompletionStatus;
  issues:CompletionIssue[];limitations?:string[];
}):CompletionReport {
  const lanes={editable:completionLane(input.editable,input.editable===undefined?['This read-only frontend check did not exercise and restore the real native editor controls']:[]),data:completionLane(input.data),visual:completionLane(input.visual),behavior:completionLane(input.behavior),responsive:completionLane(input.responsive),evidence:completionLane(input.evidence)};
  const limitations=(input.limitations??[]).map(message=>({code:'unresolved-limitation',severity:'warning' as const,message}));
  return resolveCompletion(lanes,[...input.issues,...limitations]);
}
