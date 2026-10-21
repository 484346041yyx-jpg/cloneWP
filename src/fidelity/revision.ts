import path from 'node:path';
import { realpath, mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadConfig, readJson } from '../core/config.js';
import { acquireLock, writeJson } from '../core/files.js';
import { previewCookies } from '../core/runner.js';
import { WordPressClient } from '../wordpress/client.js';
import type { DraftSnapshot, ElementorElement, LegacySchema } from '../wordpress/types.js';
import { compileEditorElements } from '../wordpress/editor-serialization.js';
import { auditFidelityProgram, flattenNative, sha256 } from './check.js';
import { compileFidelity, preflightNativeControls, referencedFidelityAssets, type CompiledFidelity, type FidelityImportedAsset } from './native.js';
import { assertFidelityDraftReady, assertFidelityEnvironment, type FidelityRunResult } from './runner.js';
import { assertNativeCapabilityPlan, planNativeCapabilities, type NativeResponsiveEnvironment } from './capability-plan.js';
import { checkFidelityDraft } from './acceptance.js';
import type { NativeProgram } from './types.js';
import type { TargetCatalogEvidence } from './catalog-contract.js';
import { loadReusableEditorCheckpoint, type StyleRevisionEditorReceipt } from './editor-checkpoint.js';

const canonical = (value: unknown): string => JSON.stringify(normalize(value));
function normalize(value: unknown): unknown { return Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)])) : value; }
function assertSnapshot(snapshot: DraftSnapshot) {
  if (snapshot.status !== 'draft' || !Number.isInteger(snapshot.pageId) || snapshot.pageId < 1 || !/^[A-Za-z\d_-]{4,100}$/.test(snapshot.runId) || snapshot.hash !== sha256(canonical({ elements: snapshot.elements, settings: snapshot.settings }))) throw new Error('Revision requires a valid current owned draft snapshot');
}
function assertSameSnapshot(actual: DraftSnapshot, expected: DraftSnapshot) {
  assertSnapshot(actual); assertSnapshot(expected);
  if (actual.pageId !== expected.pageId || actual.runId !== expected.runId || actual.hash !== expected.hash || actual.title !== expected.title) throw new Error('Owned draft changed before revision; the concurrent change was preserved');
}

export interface RetainedNativeDefault {
  elementId:string; nativeType:string; control:string; registeredType:string;
  previousValueSha256:string; registeredDefaultSha256:string; reason:string;
}
/** Only simple, fully known registered AND conditions establish inactivity.
 * Unknown/complex dependencies cannot authorize preserving a generated value. */
function registeredInactive(control:LegacySchema['controls'][string],settings:Record<string,unknown>,controls:LegacySchema['controls']):boolean{
  if(control.conditions!==undefined||!control.condition||typeof control.condition!=='object'||Array.isArray(control.condition))return false;
  const rows=Object.entries(control.condition);if(!rows.length)return false;let inactive=false;
  for(const [expression,expected]of rows){
    const match=/^([A-Za-z_][A-Za-z\d_-]*)(!)?$/.exec(expression);if(!match)return false;
    const name=match[1],dependency=controls[name];
    if(!dependency||!Object.hasOwn(settings,name)&&!Object.hasOwn(dependency,'default'))return false;
    const actual=Object.hasOwn(settings,name)?settings[name]:dependency.default,values=Array.isArray(expected)?expected:[expected];
    if(actual===undefined||actual!==null&&typeof actual==='object'||values.some(value=>value!==null&&typeof value==='object'||value===undefined))return false;
    const equal=values.some(value=>value===actual),matches=match[2]?!equal:equal;if(!matches)inactive=true;
  }
  return inactive;
}

/** Preserve already-owned inactive text defaults materialized by Elementor's
 * serializer, never explicit author input or a field inferred from its name.
 * The returned copy still participates in exact block diff/readback checks. */
export function retainRegisteredInactiveDefaults(options:{authored:ElementorElement[];serialized:ElementorElement[];baseline:ElementorElement[];schemas:Record<string,LegacySchema>}):{elements:ElementorElement[];retained:RetainedNativeDefault[]}{
  const elements=structuredClone(options.serialized),retained:RetainedNativeDefault[]=[];
  const signature=(nodes:ElementorElement[]):unknown=>nodes.map(node=>[node.id,node.elType,node.widgetType??null,signature(node.elements??[])]);
  const flat=(nodes:ElementorElement[]):ElementorElement[]=>nodes.flatMap(node=>[node,...flat(node.elements??[])]);
  const authored=flat(options.authored),baseline=flat(options.baseline),serialized=flat(elements);
  const unique=(nodes:ElementorElement[])=>new Set(nodes.map(node=>node.id)).size===nodes.length;
  if(!unique(authored)||!unique(baseline)||!unique(serialized)||canonical(signature(options.authored))!==canonical(signature(options.baseline))||canonical(signature(options.serialized))!==canonical(signature(options.baseline)))return{elements,retained};
  const originalById=new Map(authored.map(node=>[node.id,node])),savedById=new Map(baseline.map(node=>[node.id,node]));
  for(const node of serialized){
    const original=originalById.get(node.id)!,saved=savedById.get(node.id)!,type=node.elType==='widget'?node.widgetType:node.elType,schema=type&&options.schemas[type];if(!type||!schema||schema.type!==type||!schema.class)continue;
    for(const [key,control]of Object.entries(schema.controls)){
      // This is the exact serializer branch that inserts otherwise un-authored
      // values. Type hidden alone, a generated-looking prefix or a changed
      // registry default is insufficient evidence.
      if(!['text','textarea'].includes(control.type)||Object.hasOwn(original.settings,key)||!Object.hasOwn(control,'default')||typeof control.default!=='string'||!control.default||!Object.hasOwn(node.settings,key)||canonical(node.settings[key])!==canonical(control.default)||!Object.hasOwn(saved.settings,key)||typeof saved.settings[key]!=='string'||!saved.settings[key]||canonical(saved.settings[key])===canonical(node.settings[key]))continue;
      if(!registeredInactive(control,node.settings,schema.controls)||!registeredInactive(control,saved.settings,schema.controls))continue;
      node.settings[key]=structuredClone(saved.settings[key]);
      retained.push({elementId:node.id,nativeType:type,control:key,registeredType:control.type,previousValueSha256:sha256(canonical(saved.settings[key])),registeredDefaultSha256:sha256(canonical(control.default)),reason:'Author omitted this exact field; the native serializer inserted its registered text default, but the same owned native element already retains a value and the registered control is conclusively inactive before and after this revision.'});
    }
  }
  return{elements,retained};
}

/** Only current-run saved blocks may be replaced; a revision cannot change
 * source text, target data-query inputs or the native element ownership tree. */
export function assertStyleRevision(before: NativeProgram, after: NativeProgram): void {
  if (before.sourceUrl !== after.sourceUrl || before.title !== after.title || canonical(before.sourceContract) !== canonical(after.sourceContract) || canonical(before.assetsManifest) !== canonical(after.assetsManifest)) throw new Error('Style revision changed its frozen source, title or asset identity');
  const first = flattenNative(before.elements), second = flattenNative(after.elements);
  if (canonical(first.map(node => [node.key, node.type, (node.children ?? []).map(child => child.key)])) !== canonical(second.map(node => [node.key, node.type, (node.children ?? []).map(child => child.key)]))) throw new Error('Style revision cannot replace, reorder or borrow native elements');
  if (canonical(before.blocks.map(block => [block.sourceBlockId, block.rootKey, block.productQuery])) !== canonical(after.blocks.map(block => [block.sourceBlockId, block.rootKey, block.productQuery]))) throw new Error('Style revision cannot change the target product mapping or source block ownership');
  const nodes = new Map(second.map(node => [node.key, node]));
  for (const block of before.blocks) if (block.productQuery) for (const key of block.productQuery.queryControlKeys) {
    const a = first.find(node => node.key === block.productQuery!.widgetKey), b = nodes.get(block.productQuery.widgetKey);
    if (canonical(a?.settings[key]) !== canonical(b?.settings[key])) throw new Error(`Style revision cannot change target query input ${key}`);
  }
  const value = (input: unknown, steps: string[]): unknown => steps.reduce<unknown>((current, step) => current && typeof current === 'object' ? (current as Record<string, unknown>)[step] : undefined, input);
  for (const block of before.blocks) for (const binding of block.bindings) {
    const a = first.find(node => node.key === binding.elementKey), b = nodes.get(binding.elementKey), steps = binding.settingPath.split('.');
    if (canonical(value(a?.settings, steps)) !== canonical(value(b?.settings, steps))) throw new Error('Style revision cannot change bound static source content');
  }
  for (const original of first) for (const [key, setting] of Object.entries(original.settings)) if (setting && typeof setting === 'object' && '$asset' in setting && canonical(setting) !== canonical(nodes.get(original.key)?.settings[key])) throw new Error('Style revision cannot replace bound source media');
}

/** Small guarded primitive: no authentication, uploads, new pages or recovery
 * side effects. Caller holds the project write lock and owns current snapshot. */
export async function reviseFidelityBlocks(options: {
  client: Pick<WordPressClient, 'snapshotDraft' | 'buildDraft'>; snapshot: DraftSnapshot; expectedCurrentHash: string;
  compiled: CompiledFidelity; schemas: Record<string, LegacySchema>; runDir: string;
  onProgress?: (message: string) => void | Promise<void>; onSnapshot?: (snapshot: DraftSnapshot) => void;
}) {
  assertSnapshot(options.snapshot);
  if (!/^[a-f\d]{64}$/.test(options.expectedCurrentHash) || options.snapshot.hash !== options.expectedCurrentHash) throw new Error('Revision expected hash does not match the owned baseline');
  const serialized = compileEditorElements(options.compiled.composition.elements, options.schemas);
  const retention=retainRegisteredInactiveDefaults({authored:options.compiled.composition.elements,serialized,baseline:options.snapshot.elements,schemas:options.schemas}),expected=retention.elements;
  if (canonical(expected.map(node => node.id)) !== canonical(options.snapshot.elements.map(node => node.id)) || expected.some(node => node.elType !== 'container')) throw new Error('Revision requires the same complete ordered native source blocks');
  let accepted = await options.client.snapshotDraft(options.snapshot.pageId); assertSameSnapshot(accepted, options.snapshot);
  const changed = expected.flatMap((node, index) => canonical(node) === canonical(accepted.elements[index]) ? [] : [index]);
  const receipts: Array<{ blockIndex: number; blockId: string; beforeHash: string; afterHash: string }> = [];
  for (const index of changed) {
    const current = await options.client.snapshotDraft(accepted.pageId); assertSameSnapshot(current, accepted);
    await options.onProgress?.(`revise-native-block-${index + 1}`);
    const elements = structuredClone(accepted.elements); elements[index] = expected[index];
    const before = accepted;
    accepted = await options.client.buildDraft(accepted.pageId, { elements, pageSettings: accepted.settings }, undefined, { expectedCurrent: before });
    assertSnapshot(accepted);
    if (accepted.runId !== before.runId || accepted.pageId !== before.pageId || canonical(accepted.settings) !== canonical(before.settings) || accepted.elements.length !== before.elements.length || canonical(compileEditorElements(accepted.elements, options.schemas)[index]) !== canonical(expected[index]) || accepted.elements.some((node, position) => position !== index && canonical(node) !== canonical(before.elements[position]))) throw new Error('Native revision readback changed an unrelated block/page settings or did not save the intended block; preserve current state for review');
    options.onSnapshot?.(accepted);
    receipts.push({ blockIndex: index, blockId: expected[index].id, beforeHash: before.hash, afterHash: accepted.hash });
    await writeJson(path.join(options.runDir, 'target', `revision-block-${index + 1}.json`), accepted);
  }
  const final = await options.client.snapshotDraft(accepted.pageId); assertSameSnapshot(final, accepted);
  await writeJson(path.join(options.runDir, 'revision-write-receipt.json'), { version: 1, runId: final.runId, pageId: final.pageId, expectedCurrentHash: options.expectedCurrentHash, finalHash: final.hash, retainedInactiveDefaults:retention.retained, changedBlocks: receipts, skippedBlocks: expected.length - changed.length, mediaUploads: 0, newPages: 0, completionPassGranted: false });
  return { snapshot: final, changedBlocks: receipts.length, skippedBlocks: expected.length - changed.length };
}

/** Reuse the exact owned draft and imported media, then run the same real
 * frontend/editor acceptance as a fresh build. No old run is ever adopted. */
export async function reviseOwnedFidelity(options: {
  root: string; runDir: string; programPath: string; expectedCurrentHash: string;
  onProgress?: (message: string) => void; reviewDraft?: { reason: string };
  reuseEditorProofPath?: string;
}) {
  const root = await realpath(options.root), runDir = await realpath(options.runDir);
  if (path.dirname(runDir).toLowerCase() !== path.join(root, 'runs').toLowerCase()) throw new Error('Revision must belong to one current project run directory');
  const input = await auditFidelityProgram(options.programPath, { root, writeAudit: false });
  assertFidelityDraftReady(input.audit, options.reviewDraft);
  const prior = await readJson<FidelityRunResult>(path.join(runDir, 'result.json'));
  const priorProgram = await readJson<NativeProgram>(path.join(runDir, 'native-program.json'));
  assertStyleRevision(priorProgram, input.program);
  if (!prior.pageId || prior.runId !== path.basename(runDir) || prior.sourceUrl !== input.program.sourceUrl || prior.contractSha256 !== input.audit.contractSha256 || prior.assetsManifestSha256 !== input.audit.assetsManifestSha256) throw new Error('Revision source identity does not match the existing owned run');
  const assets = await readJson<FidelityImportedAsset[]>(path.join(runDir, 'assets/imported.json'));
  const required = referencedFidelityAssets(input.program.elements);
  for (const key of required) {
    const matches = assets.filter(asset => asset.key === key), source = input.manifest.assets.find(asset => asset.key === key);
    if (matches.length !== 1 || !source || matches[0].sha256 !== source.sha256 || matches[0].sourceUrl !== source.sourceUrl || !Number.isInteger(matches[0].attachmentId)) throw new Error('Revision media proof is missing or belongs to different source bytes');
  }
  const lock = await readJson<{ mode: string; versions: Record<string, string>; responsiveDevices?: unknown }>(path.join(root, 'config/environment-lock.json'));
  // Credentials are loaded only after frozen local source/asset/ownership audit.
  const loaded = await loadConfig(root), release = await acquireLock(root);
  const client = new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, networkRoute:loaded.config.wordpressNetworkRoute });
  const revisionDir = path.join(runDir, 'revisions', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  try {
    if (prior.targetUrl !== loaded.config.targetUrl || assets.some(asset => new URL(asset.url).origin !== new URL(loaded.config.targetUrl).origin)) throw new Error('Revision target or imported media left the configured test origin');
    const usedTypes = [...new Set(flattenNative(input.program.elements).map(node => node.type))];
    const capabilities = await client.discoverCapabilities(usedTypes);
    assertFidelityEnvironment(capabilities, lock, usedTypes); preflightNativeControls(input.program, capabilities.legacySchemas);
    const capabilityPlan = planNativeCapabilities(input.contract, capabilities.legacySchemas, input.program, undefined, capabilities.sourceProof?.responsiveDevices as NativeResponsiveEnvironment | undefined);
    assertNativeCapabilityPlan(capabilityPlan, { reviewDraft: !!options.reviewDraft });
    await client.createDraft(prior.runId, priorProgram.title, { requireExistingPageId: prior.pageId });
    const baseline = await client.snapshotDraft(prior.pageId);
    if (baseline.hash !== options.expectedCurrentHash || baseline.runId !== prior.runId) throw new Error('Current owned draft hash changed; no revision was saved');
    for (let offset = 0; offset < assets.length; offset += 100) await client.verifyImportedAssets(prior.pageId, assets.slice(offset, offset + 100));
    const catalog: TargetCatalogEvidence | undefined = input.program.blocks.some(block => block.productQuery) ? await client.readTargetCatalog(200) : undefined;
    if (catalog) catalog.evidence = [path.join(revisionDir, 'target/catalog.json')];
    const again = await auditFidelityProgram(options.programPath, { root, writeAudit: false });
    if (again.audit.programSha256 !== input.audit.programSha256 || again.audit.contractSha256 !== input.audit.contractSha256 || again.audit.assetsManifestSha256 !== input.audit.assetsManifestSha256) throw new Error('Revision input changed during live discovery; no blocks were saved');
    const compiled = compileFidelity(input.program, capabilities.legacySchemas, assets, catalog);
    const styleReceipt = (afterHash: string): StyleRevisionEditorReceipt => ({ version: 1, runDir, runId: prior.runId, pageId: prior.pageId!, beforeHash: baseline.hash, afterHash, assertStyleRevisionPassed: true, unchanged: { nativeTree: true, productQueries: true, staticContent: true, media: true, sourceContract: true, assetsManifest: true } });
    const checkpoint = async (afterHash: string) => options.reuseEditorProofPath ? loadReusableEditorCheckpoint({ sourceReportPath: options.reuseEditorProofPath, expectedBeforeHash: baseline.hash, afterHash, rootIds: compiled.sectionIds, nativeOwnerCount: flattenNative(input.program.elements).length, styleRevisionReceipt: styleReceipt(afterHash) }) : undefined;
    // Reject failed or foreign historical proofs before any document write.
    if (options.reuseEditorProofPath) await checkpoint(baseline.hash);
    await mkdir(revisionDir, { recursive: true });
    await writeJson(path.join(revisionDir, 'native-program.json'), input.program); await writeJson(path.join(revisionDir, 'target/native-capability-plan.json'), capabilityPlan);
    if (catalog) await writeJson(path.join(revisionDir, 'target/catalog.json'), catalog);
    const written = await reviseFidelityBlocks({ client, snapshot: baseline, expectedCurrentHash: options.expectedCurrentHash, compiled, schemas: capabilities.legacySchemas, runDir: revisionDir, onProgress: options.onProgress });
    const access = await client.getPreviewAccess(prior.pageId);
    for (const url of [access.editUrl, access.previewUrl]) if (new URL(url).origin !== new URL(loaded.config.targetUrl).origin) throw new Error('Revision verification URL left the configured target origin');
    const cookies = await previewCookies(access.adminAccessUrl, loaded.config.targetUrl);
    const contract = { ...input.contract, referenceReport: { ...input.contract.referenceReport, path: path.resolve(path.dirname(input.audit.programPath), input.contract.referenceReport.path) } };
    await writeJson(path.join(revisionDir, 'style-revision-invariants.json'), styleReceipt(written.snapshot.hash));
    const checked = await checkFidelityDraft({ program: input.program, contract, compiled, client, snapshot: written.snapshot, schemas: capabilities.legacySchemas, assets, editUrl: access.editUrl, previewUrl: access.previewUrl, cookies, runDir: revisionDir, catalog, editorCheckpoint: await checkpoint(written.snapshot.hash), onProgress: options.onProgress });
    const final = await client.snapshotDraft(prior.pageId); assertSameSnapshot(final, checked.snapshot);
    await writeJson(path.join(revisionDir, 'target/final-snapshot.json'), final);
    await writeJson(path.join(revisionDir, 'elementor-document.json'), { elements: final.elements, pageSettings: final.settings });
    await writeJson(path.join(revisionDir, 'elementor-template.json'), { version: '0.4', title: input.program.title, type: 'page', content: final.elements, page_settings: final.settings });
    const exported = ['elementor-document.json', 'elementor-template.json', 'target/final-snapshot.json', 'verification/final.json'];
    await writeJson(path.join(revisionDir, 'export-receipt.json'), { version: 1, workflow: 'block-replication', draftPageId: final.pageId, published: false, finalHash: final.hash, programSha256: input.audit.programSha256, files: await Promise.all(exported.map(async name => ({ path: name, sha256: sha256(await readFile(path.join(revisionDir, name))) }))) });
    const result = { version: 1, runId: prior.runId, pageId: prior.pageId, revisionDir, status: checked.passed ? 'completed' : 'needs-review', passed: checked.passed, finalHash: final.hash, verificationPath: checked.verificationPath, changedBlocks: written.changedBlocks, skippedBlocks: written.skippedBlocks, importedAssets: 0, newPages: 0, programSha256: input.audit.programSha256 };
    await writeJson(path.join(revisionDir, 'result.json'), result); await writeJson(path.join(runDir, 'latest-revision.json'), result);
    return result;
  } finally { await client.close().catch(() => undefined); await release(); }
}
