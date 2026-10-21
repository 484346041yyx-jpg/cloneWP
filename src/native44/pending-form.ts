/** A pending native form is a disabled, editable layout candidate. This module
 * never establishes delivery, submission, or actual frontend inert behavior. */
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { loadNative44Knowledge } from './knowledge.js';
import { native44RegisteredSchemaHash } from './selection.js';
import type { Native44Program } from './types.js';
import { walkNative44 } from './types.js';
import type { LegacySchema } from '../wordpress/types.js';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const refSchema = z.object({ path: z.string().min(1), sha256: hashSchema }).strict();
export const native44PendingFormSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-pending-form-v1'),
  /** Explicit source-only semantics; the target remains an inert native Form. */
  sourceSubmitModel: z.literal('aria-button').optional(),
  sourceControls: z.array(z.object({ snapshotId: z.string().min(1), emailFactId: z.string().min(1), submitFactId: z.string().min(1) }).strict()).length(2),
  /** A derivative source appearance extraction; it cannot establish a pass. */
  appearance: refSchema,
  registered: z.object({ capabilities: refSchema, schemaHash: hashSchema }).strict(),
  knowledge: z.object({ fingerprint: hashSchema, formComponentHash: hashSchema, sharedControlsHash: hashSchema }).strict(),
}).strict();
export type Native44PendingFormDeclaration = z.infer<typeof native44PendingFormSchema>;
export const NATIVE44_PENDING_FORM_ATTRIBUTES = 'inert|true\naria-disabled|true';
type Ref = { path: string; sha256: string };
export interface PendingFormNode {
  kind: 'native'; key: string; widgetType: string; widgetSettings: Record<string, unknown>;
  sourceFactIds?: string[]; children?: unknown[]; resources?: unknown[];
  pendingForm?: Native44PendingFormDeclaration;
}
export interface Native44PendingFormBinding {
  version: 1; kind: 'native44-pending-form-candidate'; componentKey: string; elementId: string;
  sourceSubmitModel?: 'aria-button';
  sourceFacts: Ref; sourceControls: Native44PendingFormDeclaration['sourceControls']; packets: Ref[]; appearance: Ref;
  knowledge: Native44PendingFormDeclaration['knowledge']; registered: Native44PendingFormDeclaration['registered'];
  registeredVersions: Record<string, string>; settingsHash: string;
  businessStatus: 'pending'; runtimeVerification: 'required'; submitLabelVerification: 'source-visual-review-required';
}
/** Opaque: only the verified local factory can create an authorization. */
export interface PendingFormCapability { readonly kind: 'native44-pending-form-capability'; readonly componentKey: string; }
export interface PendingFormAttributeAuthorization { readonly kind: 'native44-pending-form-attributes'; readonly elementId: string; }
interface CapabilityData { identity: string; node: PendingFormNode; schemaHash: string; receipt: Omit<Native44PendingFormBinding, 'elementId' | 'settingsHash'>; }
const capabilities = new WeakMap<object, CapabilityData>();
const attributes = new WeakMap<object, { elementId: string; settingsHash: string; schemaHash: string; capability: PendingFormCapability }>();
const fail = (reason: string): never => { throw Error(`native44_pending_form_${reason}`); };
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== 'object' || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(value))) return fail('non_json_value');
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) fail('non_json_array');
    return `[${value.map(canonical).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const bytesHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function identity(program: Native44Program, node: PendingFormNode): string {
  return hash({ taskId: program.taskId, sourceUrl: program.sourceUrl, sourceFacts: program.sourceFacts, knowledge: program.knowledge, replicationProfile: program.replicationProfile, requirementProfile: program.requirementProfile, goalProfile: program.goalProfile, node });
}
/** Explicit candidate syntax alone does not authorize compilation or inert. */
export function assertNative44PendingFormCandidate(node: PendingFormNode): Native44PendingFormDeclaration {
  const declaration = native44PendingFormSchema.parse(node.pendingForm);
  if (node.kind !== 'native' || node.widgetType !== 'form' || node.children?.length || node.resources?.length) fail('only_resource_free_leaf_form');
  const s = node.widgetSettings;
  const allowed = new Set(['form_fields', 'button_text', 'selected_button_icon', 'submit_actions', '_attributes', 'css_classes', '_css_classes']);
  if (Object.keys(s).some(key => !allowed.has(key))) fail('unsupported_setting');
  if (s._attributes !== NATIVE44_PENDING_FORM_ATTRIBUTES || !Array.isArray(s.submit_actions) || s.submit_actions.length !== 0) fail('exact_disabled_wrapper_and_empty_actions_required');
  if (typeof s.button_text !== 'string' || s.button_text.length > 80 || /[<>\u0000-\u001f]/.test(s.button_text)) fail('invalid_submit_text');
  if (s.button_text === '') {
    if (!same(s.selected_button_icon, { value: 'fas fa-angle-right', library: 'fa-solid' })) fail('native_arrow_icon_required');
  } else if (!(s.button_text as string).trim() || s.selected_button_icon !== undefined) fail('invalid_submit_presentation');
  if (!Array.isArray(s.form_fields) || s.form_fields.length !== 1) fail('single_email_required');
  const field = (s.form_fields as unknown[])[0] as Record<string, unknown>;
  if (!field || typeof field !== 'object' || Array.isArray(field) || Object.keys(field).some(key => !['_id', 'field_type', 'field_label', 'placeholder', 'required', 'width', 'custom_id'].includes(key))) fail('unsupported_email_field');
  if (field.field_type !== 'email' || typeof field.placeholder !== 'string' || !field.placeholder || /[<>\u0000-\u001f]/.test(field.placeholder) || field.field_label !== '' || field.required !== '' || field.width !== '100' || field.custom_id !== 'email' || field._id !== undefined && (typeof field._id !== 'string' || !/^[a-f0-9]{7}$/.test(field._id))) fail('invalid_email_field');
  for (const key of ['css_classes', '_css_classes']) if (s[key] !== undefined && (typeof s[key] !== 'string' || !/^[a-zA-Z0-9_\s-]*$/.test(s[key] as string))) fail('invalid_classes');
  const facts = declaration.sourceControls.flatMap(row => [row.emailFactId, row.submitFactId]);
  if (new Set(declaration.sourceControls.map(row => row.snapshotId)).size !== 2 || new Set(facts).size !== 4 || node.sourceFactIds?.length !== 4 || new Set(node.sourceFactIds).size !== 4 || facts.some(id => !node.sourceFactIds!.includes(id))) fail('source_control_ownership');
  canonical(node); return declaration;
}
async function boundJSON(root: string, reference: Ref): Promise<any> {
  refSchema.parse(reference);
  const base = await realpath(root), file = await realpath(path.resolve(root, reference.path)), relative = path.relative(base, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('evidence_path_escape');
  const bytes = await readFile(file); if (bytesHash(bytes) !== reference.sha256) fail('evidence_hash_mismatch');
  return JSON.parse(bytes.toString('utf8'));
}
function registeredContract(schema: LegacySchema): void {
  if (schema?.type !== 'form' || schema.class !== 'ElementorPro\\Modules\\Forms\\Widgets\\Form') fail('registered_form_class');
  for (const [key, type] of Object.entries({ form_fields: 'form-fields-repeater', button_text: 'text', submit_actions: 'select2', _attributes: 'textarea' })) if (schema.controls?.[key]?.type !== type) fail(`registered_control_${key}`);
  const raw = schema.controls.form_fields.fields;
  if (!raw || typeof raw !== 'object') fail('registered_email_fields');
  const fields = Object.fromEntries(Object.entries(raw as object).map(([key, value]: [string, any]) => [value?.name ?? key, value]));
  for (const [key, type] of Object.entries({ field_type: 'select', field_label: 'text', placeholder: 'text', required: 'switcher', width: 'select', custom_id: 'text' })) if (fields[key]?.type !== type) fail(`registered_email_${key}`);
  if (!Object.hasOwn(fields.field_type.options ?? {}, 'email') || !Object.hasOwn(fields.width.options ?? {}, '100')) fail('registered_email_options');
}
function underneath(nodes: Record<string, any>, nodeId: string, owner: string): boolean {
  const seen = new Set<string>(); let current: string | undefined = nodeId;
  while (current && !seen.has(current)) { if (current === owner) return true; seen.add(current); current = nodes[current]?.parentId; }
  return false;
}
/** All reads are local and hash-bound. A persisted declaration is never a
 * current-process compile permit, nor evidence that the frontend is inert. */
export async function prepareNative44PendingFormCapabilities(options: { root: string; program: Native44Program }): Promise<PendingFormCapability[]> {
  const { root, program } = options;
  const nodes: PendingFormNode[] = [];
  const walk = (items: any[]) => { for (const item of items) { if (item.pendingForm !== undefined) nodes.push(item); walk(item.children ?? item.slides ?? []); } }; walk(program.blocks);
  if (!nodes.length) return [];
  if (program.replicationProfile !== 'desktop-browser-v1' || program.requirementProfile !== 'source-requirements-v1' || program.goalProfile !== 'component-reference-v1') fail('explicit_desktop_contract_required');
  const source = await boundJSON(root, program.sourceFacts), index = await boundJSON(root, { path: program.knowledge.path, sha256: program.knowledge.sha256 });
  if (source.version !== 2 || source.kind !== 'source-facts' || source.sourceUrl !== program.sourceUrl || !Array.isArray(source.snapshots) || !source.facts) fail('source_identity');
  const knowledge = await loadNative44Knowledge(['form'], path.dirname(path.resolve(root, program.knowledge.path)));
  if (knowledge.index.fingerprint !== program.knowledge.fingerprint || index.fingerprint !== knowledge.index.fingerprint) fail('knowledge_identity');
  const out: PendingFormCapability[] = [];
  const claimed = new Set<string>();
  for (const node of nodes) {
    const declaration = assertNative44PendingFormCandidate(node);
    if (declaration.knowledge.fingerprint !== knowledge.index.fingerprint || declaration.knowledge.formComponentHash !== knowledge.index.components.form.sha256 || declaration.knowledge.sharedControlsHash !== knowledge.index.sharedControls.sha256) fail('knowledge_binding');
    for (const key of ['form_fields', 'button_text', 'submit_actions', '_attributes']) {
      const control = knowledge.components.form.controls.find(control => control.id === key), evidence = control?.sourceEvidence as any;
      if (!control || evidence?.packageId !== 'elementor-pro' || evidence.entry !== (key === '_attributes' ? 'elementor-pro/modules/custom-attributes/module.php' : 'elementor-pro/modules/forms/widgets/form.php') || !/^[a-f0-9]{64}$/.test(evidence.declarationHash ?? '')) fail('source_declaration_binding');
    }
    const actual = await boundJSON(root, declaration.registered.capabilities), schema = actual.legacySchemas?.form as LegacySchema;
    registeredContract(schema);
    if (node.widgetSettings.selected_button_icon !== undefined && (schema.controls.selected_button_icon?.type !== 'icons' || !knowledge.components.form.controls.some(control => control.id === 'selected_button_icon' && control.type === 'icons'))) fail('registered_button_icon');
    if (native44RegisteredSchemaHash(schema) !== declaration.registered.schemaHash || !actual.versions?.elementor || !actual.versions?.elementorPro || actual.sourceProof?.schemaErrors?.form) fail('registered_binding');
    const appearance = await boundJSON(root, declaration.appearance);
    if (appearance.kind !== 'native44-visible-source-form-appearance-extraction' || !Array.isArray(appearance.rows)) fail('source_appearance');
    const packets: Ref[] = [], dimensions: string[] = [];
    for (const row of declaration.sourceControls) {
      const snapshot = source.snapshots.find((snapshot: any) => snapshot.id === row.snapshotId);
      if (!snapshot) fail('source_snapshot');
      dimensions.push(`${snapshot.viewport.width}x${snapshot.viewport.height}`);
      const email = source.facts[row.emailFactId], submit = source.facts[row.submitFactId];
      const ariaSubmit = declaration.sourceSubmitModel === 'aria-button';
      if ([email, submit].some(fact => !fact || fact.kind !== 'interaction' || fact.snapshotId !== row.snapshotId || fact.value?.nodeId !== fact.nodeId || fact.value?.kind !== 'control') || email.value.details?.type !== 'email' || submit.value.details?.type !== (ariaSubmit ? 'div' : 'submit') || email.regionId !== submit.regionId || !same(email.evidence, submit.evidence)) fail('source_facts');
      const form = JSON.parse(email.value.details.form), submitForm = JSON.parse(submit.value.details.form);
      if (!same(form, submitForm) || form.submitControlNodeId !== submit.nodeId || typeof form.nodeId !== 'string') fail('source_form_owner');
      const ownership = `${row.snapshotId}:${form.nodeId}`; if (claimed.has(ownership)) fail('duplicate_source_form'); claimed.add(ownership);
      const packet = await boundJSON(root, email.evidence);
      if (packet.version !== 2 || packet.kind !== 'observation-packet' || packet.snapshot?.id !== row.snapshotId || packet.snapshot.viewport?.width !== snapshot.viewport.width || packet.snapshot.viewport?.height !== snapshot.viewport.height) fail('packet_snapshot');
      const rawEmail = packet.nodes?.[email.nodeId], rawSubmit = packet.nodes?.[submit.nodeId], rawForm = packet.nodes?.[form.nodeId];
      const appearanceRows = appearance.rows.filter((item: any) => same(item.packet, email.evidence) && item.nodes?.some((raw: any) => raw.id === email.nodeId) && item.nodes?.some((raw: any) => raw.id === submit.nodeId));
      if (appearanceRows.length !== 1) fail('source_appearance_binding');
      const validSubmit = ariaSubmit ? rawSubmit?.tag === 'div' && rawSubmit.attributes?.role === 'button' : ['input', 'button'].includes(rawSubmit?.tag) && rawSubmit.attributes?.type === 'submit';
      if (rawForm?.tag !== 'form' || rawEmail?.tag !== 'input' || !validSubmit || rawEmail.attributes?.type !== 'email' || rawEmail.selector !== email.value.selector || rawSubmit.selector !== submit.value.selector || !underneath(packet.nodes, email.nodeId, form.nodeId) || !underneath(packet.nodes, submit.nodeId, form.nodeId)) fail('packet_controls');
      for (const raw of [rawEmail, rawSubmit]) {
        const rect = packet.layouts?.[raw.layoutId]?.rect, style = packet.styles?.[raw.styleId];
        if (raw.visible !== true || !rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0 || !style || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) fail('source_visible_footprint');
        const matches = Object.values(packet.interactions ?? {}).filter((item: any) => item.id === (raw === rawEmail ? email.value.id : submit.value.id)) as Record<string, unknown>[];
        // Source-facts assembly adds the exact raw node selector. Original
        // packet interaction records need not duplicate that node field.
        const interaction = matches[0], projected = interaction && !Object.hasOwn(interaction, 'selector') ? { ...interaction, selector: raw.selector } : interaction;
        if (matches.length !== 1 || !same(projected, raw === rawEmail ? email.value : submit.value)) fail('packet_interaction_binding');
      }
      const visible = Object.values(packet.nodes).filter((raw: any) => (['input', 'button', 'select', 'textarea'].includes(raw.tag) || ariaSubmit && raw.attributes?.role === 'button') && raw.visible === true && underneath(packet.nodes, raw.id, form.nodeId));
      if (visible.length !== 2 || !visible.includes(rawEmail) || !visible.includes(rawSubmit)) fail('source_extra_visible_controls');
      if ((node.widgetSettings.form_fields as any[])[0].placeholder !== rawEmail.attributes.placeholder || Object.hasOwn(rawEmail.attributes, 'required')) fail('source_email_content');
      packets.push(email.evidence);
    }
    if (!same(dimensions.sort(), ['1440x1000', '1920x1080'])) fail('source_desktops');
    const receipt: CapabilityData['receipt'] = { version: 1, kind: 'native44-pending-form-candidate', ...(declaration.sourceSubmitModel ? { sourceSubmitModel: declaration.sourceSubmitModel } : {}), componentKey: node.key, sourceFacts: structuredClone(program.sourceFacts), sourceControls: structuredClone(declaration.sourceControls), packets: structuredClone(packets), appearance: structuredClone(declaration.appearance), knowledge: structuredClone(declaration.knowledge), registered: structuredClone(declaration.registered), registeredVersions: structuredClone(actual.versions), businessStatus: 'pending', runtimeVerification: 'required', submitLabelVerification: 'source-visual-review-required' };
    const capability: PendingFormCapability = Object.freeze({ kind: 'native44-pending-form-capability', componentKey: node.key });
    capabilities.set(capability, { identity: identity(program, node), node: structuredClone(node), schemaHash: declaration.registered.schemaHash, receipt }); out.push(capability);
  }
  return out;
}
export function assertNative44PendingFormCapability(program: Native44Program, node: PendingFormNode, schemas: Record<string, LegacySchema>, capability: PendingFormCapability | undefined): void {
  const data = capability && capabilities.get(capability);
  if (!data || data.identity !== identity(program, node) || native44RegisteredSchemaHash(schemas.form) !== data.schemaHash) fail('exact_process_capability_required');
  assertNative44PendingFormCandidate(node); registeredContract(schemas.form);
}
/** Derive a new opaque permission for the existing three-field responsive
 * visibility overlay. Source facts, schema, native Form settings and the base
 * knowledge file/hash remain exact; serialization never grants permission. */
export function derivePendingFormsForResponsive(base: Native44Program, target: Native44Program, schemas: Record<string, LegacySchema>, input: readonly PendingFormCapability[], fields: Record<string, unknown>): PendingFormCapability[] {
  for (const [name, value] of Object.entries(fields)) { const control = value as Record<string, unknown>; if (!['hide_desktop','hide_tablet','hide_mobile'].includes(name) || control?.type !== 'switcher' || control.return_value !== 'hidden-'+name.slice(5)) fail('responsive_overlay_fields'); }
  const expected = createHash('sha256').update(JSON.stringify({ base: base.knowledge.fingerprint, module: 'responsive-native-v1', fields })).digest('hex');
  if (target.knowledge.fingerprint !== expected || !same({ ...target.knowledge, fingerprint: base.knowledge.fingerprint }, base.knowledge)) fail('responsive_overlay_identity');
  const before = walkNative44(base.blocks), after = walkNative44(target.blocks);
  return input.map(capability => {
    const source = before.find(n => n.key === capability.componentKey) as PendingFormNode, node = after.find(n => n.key === capability.componentKey) as PendingFormNode;
    if (!source || !node) fail('responsive_overlay_owner');
    assertNative44PendingFormCapability(base, source, schemas, capability); const data = capabilities.get(capability)!;
    if (identity({ ...target, knowledge: { ...target.knowledge, fingerprint: base.knowledge.fingerprint } }, node) !== data.identity) fail('responsive_overlay_changed_form');
    const derived: PendingFormCapability = Object.freeze({ kind: 'native44-pending-form-capability', componentKey: capability.componentKey });
    capabilities.set(derived, { ...data, identity: identity(target, node), node: structuredClone(node) }); return derived;
  });
}
/** The only changes permitted after source candidate validation are compiler
 * repeater identity, stable native classes and the owned editor label. */
function emittedSettings(data: CapabilityData, settings: Record<string, unknown>): void {
  const original = structuredClone(data.node.widgetSettings), actual = structuredClone(settings);
  for (const key of ['css_classes', '_css_classes', '_title']) delete actual[key];
  for (const key of ['css_classes', '_css_classes']) delete original[key];
  const expectedField = (original.form_fields as any[])[0], actualField = (actual.form_fields as any[])?.[0];
  if (!actualField || typeof actualField._id !== 'string' || !/^[a-f0-9]{7}$/.test(actualField._id)) fail('compiled_email_identity');
  if (expectedField._id !== undefined && expectedField._id !== actualField._id) fail('changed_email_identity');
  delete expectedField._id; delete actualField._id;
  if (!same(original, actual)) fail('compiled_settings_changed');
  for (const key of ['css_classes', '_css_classes']) if (settings[key] !== undefined && (typeof settings[key] !== 'string' || !/^[a-zA-Z0-9_\s-]*$/.test(settings[key] as string))) fail('compiled_classes');
  if (settings._title !== undefined && (typeof settings._title !== 'string' || /[<>\u0000-\u001f]/.test(settings._title))) fail('compiled_title');
}
export function bindPendingFormAttributeAuthorization(capability: PendingFormCapability, elementId: string, settings: Record<string, unknown>, schema: LegacySchema): PendingFormAttributeAuthorization {
  const data = capabilities.get(capability); if (!data || !/^[a-f0-9]{7}$/.test(elementId) || native44RegisteredSchemaHash(schema) !== data.schemaHash) return fail('attribute_capability');
  emittedSettings(data, settings);
  const authorization: PendingFormAttributeAuthorization = Object.freeze({ kind: 'native44-pending-form-attributes', elementId });
  attributes.set(authorization, { elementId, settingsHash: hash(settings), schemaHash: data.schemaHash, capability }); return authorization;
}
export function assertPendingFormAttributeAuthorization(authorization: PendingFormAttributeAuthorization, type: string, settings: Record<string, unknown>, elementId?: string, schema?: LegacySchema): void {
  const data = attributes.get(authorization);
  if (!data || type !== 'form' || data.settingsHash !== hash(settings) || settings._attributes !== NATIVE44_PENDING_FORM_ATTRIBUTES || elementId !== undefined && elementId !== data.elementId || schema && native44RegisteredSchemaHash(schema) !== data.schemaHash) fail('attribute_authorization');
}
export function pendingFormAuthorizationForElement(authorizations: readonly PendingFormAttributeAuthorization[] | undefined, elementId: string): PendingFormAttributeAuthorization | undefined {
  const matches = authorizations?.filter(item => attributes.get(item)?.elementId === elementId) ?? [];
  if (matches.length > 1) fail('duplicate_attribute_authorization'); return matches[0];
}
export function native44PendingFormBinding(capability: PendingFormCapability, authorization: PendingFormAttributeAuthorization, settings: Record<string, unknown>): Native44PendingFormBinding {
  const data = capabilities.get(capability), permit = attributes.get(authorization);
  if (!data || permit?.capability !== capability) return fail('binding_capability');
  assertPendingFormAttributeAuthorization(authorization, 'form', settings, permit.elementId);
  return { ...structuredClone(data.receipt), elementId: permit.elementId, settingsHash: hash(settings) };
}
