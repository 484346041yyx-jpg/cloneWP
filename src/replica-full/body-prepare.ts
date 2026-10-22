import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { z } from 'zod';
import { parseFragment } from 'parse5';
import { validateNative44Program } from '../native44/validate.js';
import { loadNative44Knowledge, native44KnowledgeIdentity, toNative44CompilerKnowledge, type Native44Knowledge } from '../native44/knowledge.js';
import { compileNative44, preflightNative44, usedNative44WidgetTypes } from '../native44/compiler.js';
import { native44Children, walkNative44, type Native44Program, type Native44Component, type Native44CompileOptions, type Native44Compiled } from '../native44/types.js';
import { validateObservationPacketV2, ObservationPacketV2Schema, type ObservationPacketV2 } from '../replica-v2/observation.js';
import { buildSourceFactsV2, validateSourceFactsV2, type SourceFactsV2 } from '../replica-v2/source.js';
import type { ImportedAssetV2 } from '../replica-v2/types.js';
import type { LegacySchema } from '../wordpress/types.js';
import { assertFullReplicaBodyScope, fullReplicaHash, validateFullReplicaManifest } from './contract.js';
import type { FullReplicaFileRef, FullReplicaManifest, FullReplicaPreparedBody } from './types.js';
import { assertNavigationFormSource } from './navigation-form-source.js';
import { assertNativeImageCSS } from './native-image-policy.js';
import { prepareResponsiveBody, compileResponsiveBody } from '../replica-responsive/body.js';
import { verifyResponsiveSections } from '../replica-responsive/source.js';
import { verifyPhoneMotionSource } from '../replica-responsive/motion-review.js';
import { assertCarouselNavigationMapped } from './carousel-navigation.js';
import { assertHeaderContentWidthMapped } from './header-visual-width.js';

const ROOT = 'D:/cloneWP';
const refSchema = z.object({ path: z.string().min(1).max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const strings = z.array(z.string().min(1).max(240)).max(100000);
export const BodySourceUnitsSchema = z.object({ version: z.literal(1), kind: z.literal('native44-body-source-units'), taskId: z.string(), sourceUrl: z.url(), units: z.array(z.object({ id: z.string().min(1), snapshotId: z.string().min(1), ownerNodeId: z.string().min(1), nodeIds: strings.min(1), sourceFactIds: strings.min(1), componentKeys: strings }).strict()).min(1).max(2000) }).strict();
export const BodySourceEvidenceSchema = z.object({ version: z.literal(1), kind: z.literal('native44-body-source-evidence'), taskId: z.string(), sourceUrl: z.url(), snapshots: z.array(z.object({ id: z.string().min(1), viewport: ObservationPacketV2Schema.shape.snapshot.shape.viewport, packets: z.array(refSchema).min(1).max(500) }).strict()).min(1).max(8), additionalEvidence: z.array(refSchema).max(200).optional() }).strict();
export type BodySourceUnits = z.infer<typeof BodySourceUnitsSchema>;
export type BodySourceEvidence = z.infer<typeof BodySourceEvidenceSchema>;
export interface ActualBodyPayload {
  baseProgram?: Native44Program;
  program: Native44Program; css: string; sourceUnits: BodySourceUnits; sourceEvidence: BodySourceEvidence;
  sourceFacts: SourceFactsV2; knowledge: Native44Knowledge; manifest: FullReplicaManifest;
  programPath: string; sourceFactsPath: string; assetsManifestPath: string; assetsManifest: unknown;
}
const proofs = new WeakMap<object, { digest: string; manifestHash: string }>();
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function fail(code: string): never { throw Error(`replica_full_body_${code}`); }
/** Source packets/knowledge exceed header-plan limits; retain bounded strict JSON independently. */
function bodyJson(value: unknown): string {
  let count = 0; const ancestors = new Set<object>();
  const visit = (entry: unknown, depth: number): string => {
    if (++count > 2000000 || depth > 96) fail('json_limit');
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return JSON.stringify(entry);
    if (typeof entry === 'number') { if (!Number.isFinite(entry)) fail('json_invalid'); return JSON.stringify(entry); }
    if (!entry || typeof entry !== 'object' || ancestors.has(entry) || Object.getOwnPropertySymbols(entry).length) fail('json_invalid');
    const descriptors = Object.getOwnPropertyDescriptors(entry), keys = Object.keys(entry); ancestors.add(entry);
    if (Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null && !Array.isArray(entry)) fail('json_invalid');
    let result: string;
    if (Array.isArray(entry)) { if (keys.length !== entry.length || keys.some((key, i) => key !== String(i))) fail('json_invalid'); result = `[${keys.map(key => { const descriptor = descriptors[key]; if (!descriptor || !('value' in descriptor)) fail('json_invalid'); return visit(descriptor.value, depth + 1); }).join(',')}]`; }
    else { if (Object.getOwnPropertyNames(entry).length !== keys.length) fail('json_invalid'); result = `{${keys.sort().map(key => { const descriptor = descriptors[key]; if (['__proto__', 'prototype', 'constructor'].includes(key) || !descriptor || !('value' in descriptor)) fail('json_invalid'); return `${JSON.stringify(key)}:${visit(descriptor.value, depth + 1)}`; }).join(',')}}`; }
    ancestors.delete(entry); return result;
  };
  const result = visit(value, 0); if (Buffer.byteLength(result) > 96 * 1024 * 1024) fail('json_limit'); return result;
}
function equal(a: unknown, b: unknown): boolean { return bodyJson(a) === bodyJson(b); }
function sameSet(a: string[], b: string[]): boolean { return new Set(a).size === a.length && a.length === b.length && a.every(item => b.includes(item)); }
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
async function checkedFile(filename: string): Promise<string> {
  const root = await realpath(ROOT), absolute = path.resolve(filename), relative = path.relative(root, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('path_escape');
  let current = root;
  for (const segment of relative.split(path.sep)) { current = path.join(current, segment); const info = await lstat(current); if (info.isSymbolicLink() || (await realpath(current)).toLowerCase() !== current.toLowerCase()) fail('reparse_path'); }
  const info = await lstat(current); if (!info.isFile() || info.size > 32 * 1024 * 1024) fail('input_size'); return absolute;
}
async function bytesAt(ref: FullReplicaFileRef, base = ROOT): Promise<{ filename: string; bytes: Buffer }> {
  refSchema.parse({ path: ref.path, sha256: ref.sha256 }); const filename = await checkedFile(path.resolve(base, ref.path)), bytes = await readFile(filename);
  if (sha(bytes) !== ref.sha256) fail('input_hash_changed'); return { filename, bytes };
}
async function jsonAt(ref: FullReplicaFileRef, base = ROOT): Promise<{ filename: string; value: unknown }> {
  const { filename, bytes } = await bytesAt(ref, base); const value: unknown = JSON.parse(bytes.toString('utf8')); bodyJson(value); return { filename, value };
}
function under(nodes: ObservationPacketV2['nodes'], child: string, owner: string): boolean {
  const seen = new Set<string>(); let cursor: string | null = child;
  while (cursor && !seen.has(cursor)) { if (cursor === owner) return true; seen.add(cursor); cursor = nodes[cursor]?.parentId ?? null; } return false;
}
function headerNodes(packet: ObservationPacketV2): Set<string> {
  const roots = new Set(packet.regions.filter(region => {
    if (!/^(?:header|banner|site-header|main-header)$/i.test(region.role.trim())) return false;
    const node = packet.nodes[region.nodeId];
    return /(?:^|[-_])(?:header|banner|nav)(?:$|[-_])/i.test(region.id) ||
      node?.tag.toLowerCase() === 'header' || node?.attributes.role?.toLowerCase() === 'banner' ||
      /(?:^|[-_])(?:header|banner)(?:$|[-_])/i.test(node?.attributes.class ?? '');
  }).map(region => region.nodeId));
  const inContent = (id: string): boolean => { let cursor = packet.nodes[id]?.parentId; const seen = new Set<string>(); while (cursor && !seen.has(cursor)) { seen.add(cursor); const node = packet.nodes[cursor]; if (!node) break; if (['main', 'article'].includes(node.tag.toLowerCase()) || node.attributes.role === 'main') return true; cursor = node.parentId; } return false; };
  for (const node of Object.values(packet.nodes)) if (!inContent(node.id) && (node.tag.toLowerCase() === 'header' || node.attributes.role?.toLowerCase() === 'banner')) roots.add(node.id);
  const forbidden = new Set<string>();
  for (const node of Object.values(packet.nodes)) if ([...roots].some(owner => under(packet.nodes, node.id, owner))) forbidden.add(node.id);
  return forbidden;
}
function programHasHeader(node: Native44Component): boolean {
  const markupHeader = (markup: string): boolean => {
    if (!/[<>]/.test(markup)) return false;
    let found = false;
    const walk = (entry: { tagName?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: unknown[] }) => { if (entry.tagName === 'header' || entry.attrs?.some(attr => attr.name === 'role' && attr.value.trim().toLowerCase() === 'banner')) found = true; entry.childNodes?.forEach(child => walk(child as typeof entry)); };
    walk(parseFragment(markup) as unknown as Parameters<typeof walk>[0]); return found;
  };
  const settings = [node.settings, 'widgetSettings' in node ? node.widgetSettings : undefined];
  for (const value of settings) if (value) for (const [key, setting] of Object.entries(value)) {
    if (typeof setting !== 'string') continue;
    if (/^(?:html_tag|tag|_element_tag)$/i.test(key) && setting.toLowerCase() === 'header') return true;
    if (/^(?:role|aria_role)$/i.test(key) && setting.toLowerCase() === 'banner') return true;
    if (/class/i.test(key) && /(?:^|\s)(?:site-header|main-header|whb-header|header-wrapper)(?:\s|$)/i.test(setting)) return true;
    if (/attribute/i.test(key) && /(?:^|[\s|])role[\s|=]+["']?banner\b/i.test(setting)) return true;
    if (markupHeader(setting)) return true;
  }
  return node.kind === 'html-static' && markupHeader(node.template);
}
function mergePackets(packets: ObservationPacketV2[]): ObservationPacketV2 {
  const merged = structuredClone(packets[0]);
  for (const packet of packets.slice(1)) {
    if (!equal(packet.snapshot, merged.snapshot)) fail('snapshot_packet_conflict');
    for (const table of ['nodes', 'texts', 'styles', 'layouts', 'resources', 'usages', 'interactions'] as const) for (const [key, value] of Object.entries(packet[table])) {
      const record = merged[table] as Record<string, unknown>; if (Object.hasOwn(record, key) && !equal(record[key], value)) fail('packet_entity_conflict'); record[key] = value;
    }
    for (const region of packet.regions) { const previous = merged.regions.find(row => row.id === region.id); if (previous && !equal(previous, region)) fail('packet_region_conflict'); if (!previous) merged.regions.push(region); }
  }
  return validateObservationPacketV2(merged);
}
/** Hash and typed ownership proof only. Current visual/interaction acceptance is a separate full-page review. */
export async function prepareActualBody(input: FullReplicaManifest): Promise<FullReplicaPreparedBody> {
  const manifest = validateFullReplicaManifest(input);
  const [programFile, cssFile, unitsFile, evidenceFile] = await Promise.all([jsonAt(manifest.body.program), bytesAt(manifest.body.css), jsonAt(manifest.body.sourceUnits), jsonAt(manifest.sourceEvidence)]);
  let program = validateNative44Program(programFile.value); const programBase = path.dirname(programFile.filename);
  if (manifest.version === 4 && program.visualAuditVersion !== 3) fail('phone_visual_audit_required');
  assertNativeImageCSS(manifest.nativeImagePolicy, program, cssFile.bytes.toString('utf8'));
  for (const exception of manifest.nativeImagePolicy?.cssExceptions ?? []) for (const ref of exception.evidence) await bytesAt(ref, programBase);
  if (program.taskId !== manifest.taskId || program.sourceUrl !== manifest.sourceUrl) fail('program_identity');
  const sourceUnits = BodySourceUnitsSchema.parse(unitsFile.value), sourceEvidence = BodySourceEvidenceSchema.parse(evidenceFile.value);
  if ([sourceUnits, sourceEvidence].some(row => row.taskId !== manifest.taskId || row.sourceUrl !== manifest.sourceUrl)) fail('source_identity');
  if (!sameSet(sourceUnits.units.map(row => row.id), manifest.sourcePartition.allUnits)) fail('unit_partition');
  const [factsFile, planFile, assetsFile, identity] = await Promise.all([jsonAt(program.sourceFacts, programBase), jsonAt(program.componentPlan, programBase), jsonAt(program.assetsManifest, programBase), native44KnowledgeIdentity(ROOT)]);
  void planFile; // Its exact local identity is retained; actual unit mapping below derives from the program tree.
  const sourceFacts = validateSourceFactsV2(factsFile.value);
  if (sourceFacts.sourceUrl !== manifest.sourceUrl || program.knowledge.sha256 !== identity.knowledge.sha256 || program.knowledge.fingerprint !== identity.knowledge.fingerprint || program.componentCatalog.sha256 !== identity.componentCatalog.sha256 || !equal(program.targetEnvironment, identity.targetEnvironment)) fail('knowledge_or_source_identity');
  const [catalogFile, knowledgeFile] = await Promise.all([jsonAt(program.componentCatalog, programBase), jsonAt(program.knowledge, programBase)]);
  if (catalogFile.filename.toLowerCase() !== path.resolve(identity.componentCatalog.path).toLowerCase() || knowledgeFile.filename.toLowerCase() !== path.resolve(identity.knowledge.path).toLowerCase()) fail('knowledge_path');
  const observation = await bytesAt(sourceFacts.observation, path.dirname(factsFile.filename));
  const packetRows: Array<{ packet: ObservationPacketV2; ref: FullReplicaFileRef; filename: string }> = [];
  const snapshots = new Map<string, ObservationPacketV2>();
  for (const snapshot of sourceEvidence.snapshots) {
    if (snapshots.has(snapshot.id)) fail('duplicate_snapshot');
    const packets: ObservationPacketV2[] = [];
    for (const ref of snapshot.packets) {
      const loaded = await jsonAt(ref, path.dirname(evidenceFile.filename)), packet = validateObservationPacketV2(loaded.value);
      if (packet.snapshot.id !== snapshot.id || packet.snapshot.url !== manifest.sourceUrl || !equal(packet.snapshot.viewport, snapshot.viewport)) fail('packet_identity');
      packets.push(packet); packetRows.push({ packet, ref, filename: loaded.filename });
    }
    snapshots.set(snapshot.id, mergePackets(packets));
  }
  for (const ref of sourceEvidence.additionalEvidence ?? []) await bytesAt(ref, path.dirname(evidenceFile.filename));
  const desktopSizes = new Set([...snapshots.values()].map(packet => `${packet.snapshot.viewport.width}x${packet.snapshot.viewport.height}`));
  if (snapshots.size !== 2 || !desktopSizes.has('1920x1080') || !desktopSizes.has('1440x1000') || !sameSet(sourceFacts.snapshots.map(row => row.id), [...snapshots.keys()])) fail('desktop_evidence_incomplete');
  // Re-derive typed facts from the bytes. A renamed fact pointing at a header node cannot be laundered by an inventory label.
  const expected = buildSourceFactsV2({ manifestPath: observation.filename, manifestSha256: sourceFacts.observation.sha256, manifest: { version: 2, kind: 'observation-manifest', sourceUrl: manifest.sourceUrl, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, packets: packetRows.map(row => row.packet), packetFiles: packetRows.map(row => ({ path: row.ref.path, sha256: row.ref.sha256, snapshotId: row.packet.snapshot.id })) });
  if (!equal(expected.facts, sourceFacts.facts)) fail('facts_not_packet_derived');
  for (const snapshot of sourceFacts.snapshots) {
    const actual = expected.snapshots.find(row => row.id === snapshot.id)!;
    if (!equal(snapshot.nodes, actual.nodes) || !equal(snapshot.viewport, actual.viewport) || !equal(snapshot.evidence, actual.evidence)) fail('fact_snapshot_changed');
  }
  const headerBySnapshot = new Map([...snapshots].map(([id, packet]) => [id, headerNodes(packet)]));
  if ([...headerBySnapshot.values()].some(nodes => !nodes.size)) fail('header_owner_unproven');
  if (program.visualAuditVersion && manifest.header?.plan) assertHeaderContentWidthMapped([...snapshots.values()], manifest.header.plan.style.css);
  const headerUnits = new Set(manifest.sourcePartition.headerUnits), components = walkNative44(program.blocks), componentMap = new Map(components.map(node => [node.key, node]));
  const actualMapping = new Map(sourceUnits.units.map(unit => [unit.id, new Set<string>()]));
  for (const unit of sourceUnits.units) {
    const packet = snapshots.get(unit.snapshotId); if (!packet || !packet.nodes[unit.ownerNodeId] || !unit.nodeIds.includes(unit.ownerNodeId)) fail('unit_owner_missing');
    if (!sameSet(unit.nodeIds, [...new Set(unit.nodeIds)]) || !sameSet(unit.sourceFactIds, [...new Set(unit.sourceFactIds)]) || !sameSet(unit.componentKeys, [...new Set(unit.componentKeys)])) fail('unit_duplicate');
    if (unit.nodeIds.some(id => !packet.nodes[id] || !under(packet.nodes, id, unit.ownerNodeId))) fail('unit_node_outside_owner');
    for (const factId of unit.sourceFactIds) { const fact = sourceFacts.facts[factId]; if (!fact || fact.snapshotId !== unit.snapshotId || !unit.nodeIds.includes(fact.nodeId)) fail('unit_fact_outside_owner'); }
    const forbidden = headerBySnapshot.get(unit.snapshotId)!;
    if (headerUnits.has(unit.id)) {
      if (unit.componentKeys.length || !unit.nodeIds.some(id => forbidden.has(id))) fail('header_unit_misclassified');
    } else if (unit.nodeIds.some(id => forbidden.has(id))) fail('body_unit_contains_header');
    if (unit.componentKeys.some(key => !componentMap.has(key))) fail('unknown_component_mapping');
  }
  for (const [snapshotId, forbidden] of headerBySnapshot) for (const id of forbidden) if (!sourceUnits.units.some(unit => headerUnits.has(unit.id) && unit.snapshotId === snapshotId && unit.nodeIds.includes(id))) fail('header_coverage_missing');
  const effectiveFacts = (node: Native44Component): string[] => [...new Set([...(node.sourceFactIds ?? []), ...native44Children(node).flatMap(effectiveFacts)])];
  for (const node of components) {
    if (programHasHeader(node)) fail('embedded_header_semantics');
    const facts = effectiveFacts(node); if (!facts.length) fail('component_source_missing');
    for (const factId of facts) {
      const fact = sourceFacts.facts[factId]; if (!fact) fail('unknown_component_fact');
      if (headerBySnapshot.get(fact.snapshotId)?.has(fact.nodeId)) fail('embedded_header_fact');
      const owners = sourceUnits.units.filter(unit => !headerUnits.has(unit.id) && unit.snapshotId === fact.snapshotId && unit.nodeIds.includes(fact.nodeId) && unit.sourceFactIds.includes(factId));
      if (owners.length !== 1) fail('component_fact_scope_ambiguous');
      actualMapping.get(owners[0].id)!.add(node.key);
    }
  }
  for (const unit of sourceUnits.units) if (!sameSet(unit.componentKeys, [...actualMapping.get(unit.id)!])) fail('component_mapping_not_actual');
  for (const form of manifest.body.navigationForms ?? []) {
    const supplemental = await jsonAt(form.sourceEvidence, programBase);
    assertNavigationFormSource(form, supplemental.value, manifest.sourceUrl, snapshots, sourceUnits, components, sourceFacts);
  }
  const bodyIds = sourceUnits.units.filter(unit => !headerUnits.has(unit.id)).map(unit => unit.id), componentIds = bodyIds.filter(id => actualMapping.get(id)!.size > 0);
  const baseProgram = program; let effectiveCSS = cssFile.bytes.toString('utf8');
  let phonePackets: ObservationPacketV2[] | undefined;
  if (manifest.responsive) {
    phonePackets = await verifyResponsiveSections(manifest.responsive, manifest, bytesAt);
    if (manifest.version === 4) await verifyPhoneMotionSource({ taskId: manifest.taskId, sourceUrl: manifest.sourceUrl, plan: manifest.responsive, program, packets: phonePackets, read: bytesAt });
    const responsive = prepareResponsiveBody(program, manifest.responsive, effectiveCSS); program = responsive.program; effectiveCSS = responsive.css;
    assertNativeImageCSS(manifest.nativeImagePolicy, program, effectiveCSS);
  }
  if (manifest.version >= 3) assertCarouselNavigationMapped({ program, sourceUnits, snapshots, css: effectiveCSS,
    ...(phonePackets && manifest.responsive ? { phone: { packets: phonePackets, sections: manifest.responsive.sections } } : {}) });
  const knowledge = await loadNative44Knowledge(usedNative44WidgetTypes(program));
  const payload: ActualBodyPayload = { ...(manifest.responsive ? { baseProgram } : {}), program, css: effectiveCSS, sourceUnits, sourceEvidence, sourceFacts, knowledge, manifest, programPath: programFile.filename, sourceFactsPath: factsFile.filename, assetsManifestPath: assetsFile.filename, assetsManifest: assetsFile.value };
  const prepared: FullReplicaPreparedBody = freeze({ programHash: manifest.body.program.sha256, cssInputHash: manifest.body.css.sha256, sourceUnitsHash: manifest.body.sourceUnits.sha256, sourceEvidenceHash: manifest.sourceEvidence.sha256, sourceUnitIds: bodyIds, componentSourceUnitIds: componentIds, embeddedHeaderCount: 0, payload });
  assertFullReplicaBodyScope(prepared, manifest); proofs.set(prepared, { digest: sha(bodyJson(prepared)), manifestHash: fullReplicaHash(manifest) }); return prepared;
}
export function assertActualPreparedBody(body: FullReplicaPreparedBody, manifest?: FullReplicaManifest): asserts body is FullReplicaPreparedBody & { payload: ActualBodyPayload } {
  const proof = proofs.get(body); if (!proof || proof.digest !== sha(bodyJson(body)) || manifest && proof.manifestHash !== fullReplicaHash(validateFullReplicaManifest(manifest))) fail('exact_preparation_required');
}
/** Retains the native compiler's in-process proof; callers must never alter its composition. */
export function compileActualBody(body: FullReplicaPreparedBody, schemas: Record<string, LegacySchema>, assets: ImportedAssetV2[], options: Omit<Native44CompileOptions, 'schemas' | 'assets' | 'knowledge'> = {}): Native44Compiled {
  assertActualPreparedBody(body); const payload = body.payload;
  if (options.targetOrigin && options.targetOrigin !== payload.manifest.targetOrigin) fail('compiler_target_conflict');
  const input = { ...options, targetOrigin: payload.manifest.targetOrigin, schemas, knowledge: toNative44CompilerKnowledge(payload.knowledge, schemas), ...(payload.manifest.nativeImagePolicy?.version === 2 ? { directImageSlots: payload.manifest.nativeImagePolicy.directImageSlots ?? [] } : {}) };
  if (payload.manifest.responsive) return compileResponsiveBody(payload.program, { ...input, assets }, payload.css);
  preflightNative44(payload.program, input); return compileNative44(payload.program, { ...input, assets });
}
