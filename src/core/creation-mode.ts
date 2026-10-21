import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { validateOriginalDesign } from '../original/validate.js';
import { validateNativeProgram } from '../fidelity/validate.js';
import { validateProgramV2 } from '../replica-v2/validate.js';
import type { ReplicaStage } from '../replica-v2/types.js';
import { validateNative44Program } from '../native44/validate.js';
import { canonicalV2 } from '../replica-v2/journal.js';
import { assertNative44ProfileIdentity } from '../native44/profile.js';

export type CreationMode = 'original' | 'replica';
const inside = (root: string, filename: string): void => {
  const relative = path.relative(root, filename);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Creation input must stay inside the project');
};

/** Identify only complete known input schemas. A failed reference never becomes original. */
export function resolveCreationMode(input: unknown, explicitMode?: CreationMode): CreationMode {
  if (explicitMode !== undefined && explicitMode !== 'original' && explicitMode !== 'replica') throw new Error('Unknown creation mode');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Creation input must be a design or native program');
  const workflow = (input as { workflow?: unknown }).workflow;
  if (workflow !== 'block-replication' && (input as {executionStrategy?:unknown}).executionStrategy !== undefined) throw Error('Replica execution strategy cannot change original creation permissions');
  let mode: CreationMode;
  if (workflow === 'block-replication') {
    try {
      const strategy = (input as { executionStrategy?: unknown }).executionStrategy;
      if (strategy !== undefined) {
        if (strategy !== 'native44-css-handoff' || (input as {version?:unknown}).version !== 2) throw Error('Unknown or conflicting replica execution strategy');
        validateNative44Program(input);
      } else if ((input as {version?:unknown}).version === 2) validateProgramV2(input); else validateNativeProgram(input);
    } catch (error) { throw new Error(`Invalid block-replication program: ${error instanceof Error ? error.message : 'unknown schema'}`); }
    mode = 'replica';
  } else if (workflow === 'original-design' || workflow === undefined) {
    try { validateOriginalDesign(input); } catch { throw new Error('Invalid original design; unknown inputs cannot fall back to original creation'); }
    mode = 'original';
  } else throw new Error('Unknown creation workflow; select an original design or block-replication program');
  if (explicitMode !== undefined && explicitMode !== mode) throw new Error('Selected creation mode conflicts with the input workflow');
  return mode;
}

export async function readCreationInput(root: string, filename: string): Promise<{ filename: string; input: unknown }> {
  const actualRoot = await realpath(root), local = path.resolve(actualRoot, filename);
  inside(actualRoot, local);
  const actual = await realpath(local); inside(actualRoot, actual);
  const info = await stat(actual);
  if (!info.isFile() || info.size > 8_388_608) throw new Error('Creation input must be a regular JSON file within 8 MiB');
  return { filename: actual, input: JSON.parse((await readFile(actual, 'utf8')).replace(/^\uFEFF/, '')) };
}

/** Task markers are identity, not suggestions. Check before loading target credentials. */
export async function assertCreationTaskMode(root: string, filename: string, mode: CreationMode): Promise<{ legacyReferenceOriginal: boolean }> {
  const actualRoot = await realpath(root), { filename: actual, input } = await readCreationInput(actualRoot, filename);
  resolveCreationMode(input, mode);
  const parts = path.relative(actualRoot, actual).split(path.sep), top = parts[0].toLowerCase();
  const workflow = (input as { workflow?: unknown }).workflow;
  if (mode === 'replica' && top === 'original') throw new Error('A replication program cannot run inside an original task');
  if (mode === 'original' && workflow === 'original-design' && (top !== 'original' || parts.length < 3)) throw new Error('New original designs require an isolated original/<taskId>/ directory');
  let legacyReferenceOriginal = false, markerFound = false;
  for (let directory = path.dirname(actual); directory !== actualRoot; directory = path.dirname(directory)) {
    const marker = path.join(directory, 'job.json');
    let info;
    try { info = await stat(marker); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    inside(actualRoot, await realpath(marker));
    if (!info.isFile() || info.size > 1_048_576) throw new Error('Task marker must be a bounded regular JSON file');
    const job = JSON.parse((await readFile(marker, 'utf8')).replace(/^\uFEFF/, '')) as { workflow?: unknown; mode?: unknown; taskId?: unknown; url?: unknown; executionStrategy?: unknown; componentCatalog?: unknown; knowledge?: unknown; targetEnvironment?: unknown; replicationProfile?: unknown; selectionRulesHash?: unknown };
    if (!job || typeof job !== 'object' || Array.isArray(job)) throw new Error('Invalid creation task marker');
    const jobMode = job.workflow === 'block-replication' ? 'replica' : job.workflow === 'original-design' || job.workflow === 'reference-to-original' ? 'original' : undefined;
    if (!jobMode) throw new Error('Unknown task workflow; task modes cannot be inferred from a directory name');
    if (jobMode !== mode || (job.mode !== undefined && job.mode !== jobMode)) throw new Error('Task marker conflicts with the selected creation mode');
    const program = input as { taskId?: unknown; sourceUrl?: unknown; executionStrategy?: unknown; componentCatalog?: unknown; knowledge?: unknown; targetEnvironment?: unknown; replicationProfile?: unknown; selectionRulesHash?: unknown };
    if (job.executionStrategy !== program.executionStrategy && (job.executionStrategy !== undefined || program.executionStrategy !== undefined)) throw Error('Task execution strategy conflicts with the program');
    if (program.executionStrategy === 'native44-css-handoff') for (const key of ['componentCatalog', 'knowledge', 'targetEnvironment'] as const) if (canonicalV2(job[key]) !== canonicalV2(program[key])) throw Error(`Task ${key} identity conflicts with the program`);
    if (program.executionStrategy === 'native44-css-handoff') {
      assertNative44ProfileIdentity(job.replicationProfile, program.replicationProfile);
      if (job.selectionRulesHash !== program.selectionRulesHash) throw Error('Task selection rules identity conflicts with the program');
    }
    if (program.executionStrategy === 'native44-css-handoff' && (job.taskId !== program.taskId || job.url !== program.sourceUrl)) throw Error('Task source URL or task identity conflicts with the native44 program');
    markerFound = true;
    legacyReferenceOriginal ||= job.workflow === 'reference-to-original';
  }
  if (mode === 'original' && top === 'references' && (!markerFound || !legacyReferenceOriginal)) throw new Error('Reference capture tasks cannot fall back to original creation');
  if ((input as {executionStrategy?:unknown}).executionStrategy === 'native44-css-handoff' && !markerFound) throw Error('New native44 tasks require their own strategy-bound job marker');
  return { legacyReferenceOriginal };
}

export function parseCreationArguments(args: string[]): { filename: string; mode?: CreationMode; stage?: ReplicaStage; resume?: string; reviewDraft?: true } | undefined {
  let mode: CreationMode | undefined, filename: string | undefined, stage: ReplicaStage | undefined, resume: string | undefined, reviewDraft: true | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--mode') {
      if (mode !== undefined || !['original', 'replica'].includes(args[index + 1])) return undefined;
      mode = args[++index] as CreationMode;
    } else if (argument === '--stage') {
      if (stage !== undefined || !['desktop','responsive','final'].includes(args[index + 1])) return undefined;
      stage = args[++index] as ReplicaStage;
    } else if (argument === '--review-draft') {
      if (reviewDraft) return undefined;
      reviewDraft = true;
    } else if (argument === '--resume') {
      if (resume !== undefined || !args[index + 1] || args[index + 1].startsWith('--') || /^[a-z]+:\/\//i.test(args[index + 1])) return undefined;
      resume = args[++index];
    } else if (filename !== undefined || !/\.json$/i.test(argument) || /^(?:[a-z]+:\/\/|--)/i.test(argument)) return undefined;
    else filename = argument;
  }
  return filename ? { filename, mode, ...(stage ? {stage} : {}), ...(resume ? {resume} : {}), ...(reviewDraft ? {reviewDraft} : {}) } : undefined;
}
