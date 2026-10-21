import path from 'node:path';
import { lstat, mkdir, open, readFile, realpath, rename, statfs, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { acquireLock } from '../core/files.js';
import { canonicalHeaderJson } from '../woodmart-header/contract.js';
import { fullReplicaHash, validateFullReplicaManifest } from './contract.js';
import { defaultNativeImagePolicy } from './native-image-policy.js';
import { reconcileFullReplica, reviseFullReplicaHeaderStyle, reviseFullReplicaNativeMotion, reviseFullReplicaNavigationReturn, reviseFullReplicaStyle, runFullReplica } from './coordinator.js';
import { fullReplicaDelivery } from './delivery.js';
import type { FullReplicaDependencies, FullReplicaManifest, FullReplicaRunState } from './types.js';
import { createPreparationTiming, wrapFullReplicaDependencies, type PreparationTimingStatus } from '../replica-preparation/timing.js';
import { defaultEditorCompletionPolicy } from '../editor-completion/contract.js';
import { editorCompletionGate, requireEditorCompletion } from '../editor-completion/store.js';
import { fullReplicaFingerprint } from './contract.js';

const ROOT = 'D:/cloneWP';
export const FULL_REPLICA_HELP = `Full replica: parallel local header/body preparation, serial remote writes
  run --manifest FILE --run-dir DIR
  resume --run-dir DIR
  review --run-dir DIR --evidence FILE
  publish --run-dir DIR
  reconcile --run-dir DIR
  recover-style --run-dir DIR
  revise-style --run-dir DIR --css FILE --expected-fingerprint SHA256
  revise-header-style --run-dir DIR --css FILE --expected-fingerprint SHA256
  revise-native-motion --run-dir DIR --expected-fingerprint SHA256
  revise-navigation-return --run-dir DIR --expected-fingerprint SHA256
  status --run-dir DIR
Remote phases: owned Full Width draft -> header resources -> body -> bind -> actual whole-page review -> publish.
Unknown remote outcomes preserve pending intent and require reconciliation; never blindly rerun.
Explicit component manifests return the preserved legacy entry without running it.
`;
const specs: Record<string, string[]> = { run: ['manifest', 'run-dir'], resume: ['run-dir'], review: ['run-dir', 'evidence'], publish: ['run-dir'], reconcile: ['run-dir'], 'recover-style':['run-dir'], 'revise-style': ['run-dir', 'css', 'expected-fingerprint'], 'revise-header-style': ['run-dir', 'css', 'expected-fingerprint'], 'revise-native-motion': ['run-dir', 'expected-fingerprint'], 'revise-navigation-return': ['run-dir', 'expected-fingerprint'], status: ['run-dir'] };
export function parseFullReplicaArguments(args: string[]) {
  if (!args.length || args.includes('--help')) return { command: 'help', flags: {} as Record<string, string> };
  const command = args[0]; if (!Object.hasOwn(specs, command)) throw Error('replica_full_cli_unknown_command');
  const flags: Record<string, string> = Object.create(null);
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, ''), value = args[i + 1];
    if (!args[i]?.startsWith('--') || !specs[command].includes(key) || Object.hasOwn(flags, key) || !value || value.startsWith('--')) throw Error('replica_full_cli_arguments_invalid');
    flags[key] = value;
  }
  if (specs[command].some(key => !Object.hasOwn(flags, key))) throw Error('replica_full_cli_required_argument');
  if (flags['expected-fingerprint'] && !/^[a-f0-9]{64}$/.test(flags['expected-fingerprint'])) throw Error('replica_full_cli_fingerprint_invalid');
  return { command, flags };
}
async function checkedPath(input: string, allowMissingFinal = false): Promise<string> {
  const root = await realpath(ROOT), target = path.resolve(input), relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('replica_full_cli_path_escape');
  let current = root; const parts = relative.split(path.sep);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let info; try { info = await lstat(current); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissingFinal && index === parts.length - 1) return target; throw error; }
    if (info.isSymbolicLink() || (await realpath(current)).toLowerCase() !== current.toLowerCase()) throw Error('replica_full_cli_reparse');
  }
  return target;
}
async function jsonFile(filename: string): Promise<unknown> {
  const file = await checkedPath(filename), info = await lstat(file);
  if (!info.isFile() || info.size > 4 * 1024 * 1024) throw Error('replica_full_cli_input_invalid');
  const input: unknown = JSON.parse(await readFile(file, 'utf8')); canonicalHeaderJson(input); return input;
}
async function newFile(filename: string, value: unknown): Promise<void> {
  const handle = await open(filename, 'wx');
  try { await handle.writeFile(canonicalHeaderJson(value), 'utf8'); await handle.sync(); } finally { await handle.close(); }
}
async function writeState(directory: string, state: FullReplicaRunState): Promise<void> {
  await checkedPath(directory);
  const free = await statfs(directory); if (free.bavail * free.bsize < 512 * 1024 * 1024) throw Error('replica_full_cli_evidence_space');
  const destination = path.join(directory, 'state.json');
  try { await checkedPath(destination); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temp = path.join(directory, `.state-${randomUUID()}.tmp`); await newFile(temp, state); await rename(temp, destination);
}
async function manifestAt(filename: string): Promise<FullReplicaManifest> {
  const absolute = await checkedPath(filename), parent = path.dirname(absolute), initial = validateFullReplicaManifest(await jsonFile(absolute));
  const resolve = (input: string) => path.resolve(parent, input);
  const manifest = { ...initial, ...(initial.responsive ? { responsive: { ...initial.responsive, source: { ...initial.responsive.source, path: resolve(initial.responsive.source.path) } } } : {}), sourceEvidence: { ...initial.sourceEvidence, path: resolve(initial.sourceEvidence.path) }, body: {
    ...initial.body,
    program: { ...initial.body.program, path: resolve(initial.body.program.path) }, css: { ...initial.body.css, path: resolve(initial.body.css.path) }, sourceUnits: { ...initial.body.sourceUnits, path: resolve(initial.body.sourceUnits.path) },
    ...(initial.body.navigationForms ? { navigationForms: initial.body.navigationForms.map(form => ({ ...form, sourceEvidence: { ...form.sourceEvidence, path: resolve(form.sourceEvidence.path) } })) } : {}),
  }, ...(initial.header ? { header: { ...initial.header, bundleDirectory: resolve(initial.header.bundleDirectory), assets: { ...initial.header.assets, path: resolve(initial.header.assets.path) } } } : {}) };
  for (const ref of [manifest.sourceEvidence, manifest.body.program, manifest.body.css, manifest.body.sourceUnits, ...(manifest.body.navigationForms ?? []).map(form => form.sourceEvidence), ...(manifest.header ? [manifest.header.assets] : [])]) {
    const file = await checkedPath(ref.path), info = await lstat(file);
    if (!info.isFile() || info.size > 32 * 1024 * 1024 || createHash('sha256').update(await readFile(file)).digest('hex') !== ref.sha256) throw Error('replica_full_cli_input_identity_changed');
  }
  return validateFullReplicaManifest(manifest);
}
export interface FullReplicaCLIServices {
  createDependencies(options: { root: string; manifestPath: string; runDirectory: string; manifest: FullReplicaManifest; recoverInterruptedStyle?: boolean }): Promise<Omit<FullReplicaDependencies, 'writeState'>>;
}
const realServices: FullReplicaCLIServices = {
  async createDependencies(options) {
    const adapter = await import('./body.js');
    return adapter.createFullReplicaDependencies(options);
  },
};
function serializeRemote(deps: FullReplicaDependencies): FullReplicaDependencies {
  const one = <Args extends unknown[], Result>(fn: (...args: Args) => Promise<Result>) => async (...args: Args): Promise<Result> => {
    const release = await acquireLock(ROOT); try { return await fn(...args); } finally { await release(); }
  };
  return { ...deps, provisionHeader: one(deps.provisionHeader.bind(deps)), createPage: one(deps.createPage.bind(deps)), saveBody: one(deps.saveBody.bind(deps)), bindHeader: one(deps.bindHeader.bind(deps)), publishPage: one(deps.publishPage.bind(deps)), ...(deps.reviseStyle ? { reviseStyle: one(deps.reviseStyle.bind(deps)) } : {}), ...(deps.reviseHeaderStyle ? { reviseHeaderStyle: one(deps.reviseHeaderStyle.bind(deps)) } : {}), ...(deps.reviseNativeMotion ? { reviseNativeMotion: one(deps.reviseNativeMotion.bind(deps)) } : {}), ...(deps.reviseNavigationReturn ? { reviseNavigationReturn: one(deps.reviseNavigationReturn.bind(deps)) } : {}) };
}
export async function runFullReplicaCLI(args: string[], services: FullReplicaCLIServices = realServices): Promise<unknown> {
  const { command, flags } = parseFullReplicaArguments(args);
  if (command === 'help') return { help: FULL_REPLICA_HELP, remoteWrites: 0 };
  let manifest: FullReplicaManifest, state: FullReplicaRunState | undefined;
  const directory = await checkedPath(flags['run-dir'], command === 'run');
  if (command === 'run') {
    manifest = await manifestAt(flags.manifest);
    if (manifest.headerProvider === 'component') return { status: 'legacy-component-route', entryPoint: 'src/cli.ts', invocation: `npm run create:replica:component -- ${JSON.stringify(manifest.body.program.path)}`, remoteWrites: 0 };
    manifest = validateFullReplicaManifest({ ...manifest, nativeImagePolicy: manifest.nativeImagePolicy ?? defaultNativeImagePolicy(), editorCompletionPolicy: manifest.editorCompletionPolicy ?? defaultEditorCompletionPolicy() });
    await mkdir(directory); await newFile(path.join(directory, 'manifest.json'), manifest);
    state = { version: 1, kind: 'clonewp-full-replica-run', taskId: manifest.taskId, runId: manifest.runId, manifestHash: fullReplicaHash(manifest), status: 'preparing', revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pending: null, checkpoints: {}, review: null };
    await writeState(directory, state);
  } else {
    manifest = await manifestAt(path.join(directory, 'manifest.json'));
    state = await jsonFile(path.join(directory, 'state.json')) as FullReplicaRunState;
    if (state.manifestHash !== fullReplicaHash(manifest) || state.taskId !== manifest.taskId || state.runId !== manifest.runId) throw Error('replica_full_cli_run_identity_conflict');
    if (command === 'status') return { ...await deliverState(state), authority: 'local-confirmed-checkpoints', remoteWrites: 0 };
    if(command==='recover-style'&&(!state.pending||state.pending.phase!=='body'||state.checkpoints.body||state.checkpoints.bound))throw Error('replica_full_style_recovery_pending_body_required');
    if (state.pending && !['reconcile','recover-style'].includes(command)) throw Error('replica_full_reconciliation_required');
    if (!state.pending && command === 'reconcile') throw Error('replica_full_reconciliation_not_pending');
    if (command === 'publish' && (!state.checkpoints.bound || state.review?.decision !== 'approved')) throw Error('replica_full_review_required');
  }
  async function deliverState(s: FullReplicaRunState) {
    const bound = s.checkpoints.published ?? s.checkpoints.bound;
    if (!bound) return fullReplicaDelivery(s, manifest);
    const identity = { taskId: s.taskId, runId: s.runId, pageId: bound.pageId, documentHash: fullReplicaFingerprint(bound) };
    if (!s.pending && s.status === 'awaiting-review' && (command.startsWith('revise-') || command === 'reconcile' && state?.pending?.phase.endsWith('-revision'))) await requireEditorCompletion(directory, s.taskId, s.runId, identity.documentHash);
    const editor = await editorCompletionGate(directory, identity, !!manifest.editorCompletionPolicy);
    return fullReplicaDelivery(s, manifest, editor);
  }
  // Timing construction can reject before the command owns a lock. Keep it
  // before acquisition so an initialization failure cannot orphan that lock.
  const timing = createPreparationTiming({ runDirectory: directory, command });
  const lock = path.join(directory, '.lock'), lockId = randomUUID(); await newFile(lock, { lockId });
  let raw: Omit<FullReplicaDependencies, 'writeState'> | undefined;
  let outcome: PreparationTimingStatus = 'failed';
  const delivered = <T>(result: T): T => { outcome = result && typeof result === 'object' && 'status' in result && result.status === 'write-unknown' ? 'failed' : 'succeeded'; return result; };
  try {
    raw = await services.createDependencies({ root: ROOT, manifestPath: path.join(directory, 'manifest.json'), runDirectory: directory, manifest, ...(command==='recover-style'?{recoverInterruptedStyle:true}:{}) });
    const deps = serializeRemote({ ...wrapFullReplicaDependencies(raw, timing), writeState: next => writeState(directory, next) });
    if (['reconcile','recover-style'].includes(command)) return delivered(await deliverState(await reconcileFullReplica(manifest, deps, state!)));
    if (command === 'revise-native-motion') return delivered(await deliverState(await reviseFullReplicaNativeMotion(manifest, deps, state!, flags['expected-fingerprint'])));
    if (command === 'revise-navigation-return') return delivered(await deliverState(await reviseFullReplicaNavigationReturn(manifest, deps, state!, flags['expected-fingerprint'])));
    if (['revise-style', 'revise-header-style'].includes(command)) { const file = await checkedPath(flags.css), info = await lstat(file); if (!info.isFile() || info.size > 1024 * 1024) throw Error('replica_full_cli_css_invalid'); const css = { path: file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }, revise = command === 'revise-header-style' ? reviseFullReplicaHeaderStyle : reviseFullReplicaStyle; return delivered(await deliverState(await revise(manifest, deps, state!, css, flags['expected-fingerprint']))); }
    const reviewInput = command === 'review' ? await jsonFile(flags.evidence) : undefined;
    const result = await runFullReplica(manifest, deps, { ...(state ? { state } : {}), ...(reviewInput === undefined ? {} : { reviewInput }), publish: command === 'publish' });
    return delivered('kind' in result && result.kind === 'clonewp-full-replica-run' ? await deliverState(result) : result);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') outcome = 'cancelled';
    throw error;
  } finally {
    try { await raw?.close?.(); }
    catch (error) { outcome = 'failed'; throw error; }
    finally {
      try { await timing.finish(outcome); }
      finally { const current = await jsonFile(lock) as { lockId: string }; if (current.lockId !== lockId) throw Error('replica_full_cli_lock_changed'); await unlink(lock); }
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2), result = await runFullReplicaCLI(args); console.log(JSON.stringify(result, null, 2));
    const status = result && typeof result === 'object' && 'status' in result ? result.status : undefined;
    if (args[0] !== 'status' && status === 'write-unknown') process.exitCode = 2;
    else if (args[0] !== 'status' && ['awaiting-review', 'review-changes-required'].includes(String(status))) process.exitCode = 3;
  }
  catch (error) { const message = error instanceof Error ? error.message : ''; console.error(JSON.stringify({ error: /^(?:replica_full|woodmart_header)_[A-Za-z0-9_-]+$/.test(message) ? message : 'replica_full_cli_failed' })); process.exitCode = 1; }
}
