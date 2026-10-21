import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadNative44Knowledge, native44KnowledgeIdentity, toNative44CompilerKnowledge } from '../src/native44/knowledge.js';
import { native44RegisteredSchemaHash } from '../src/native44/selection.js';
import { native44ProfileViewports } from '../src/native44/profile.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { assertNative44PendingFormCandidate, assertNative44PendingFormCapability, assertPendingFormAttributeAuthorization, bindPendingFormAttributeAuthorization, native44PendingFormBinding, NATIVE44_PENDING_FORM_ATTRIBUTES, pendingFormAuthorizationForElement, prepareNative44PendingFormCapabilities, type PendingFormNode } from '../src/native44/pending-form.js';
import type { Native44Program } from '../src/native44/types.js';
import type { LegacySchema, CapabilityReport } from '../src/wordpress/types.js';
import { createPendingFormRegistryReader, probePendingFormCapabilities } from '../references/furryskitchen-20261017-observation/probe-pending-form-capabilities.js';
import { compileNative44, assertNative44Compilation, assertNative44PendingFormCompilation } from '../src/native44/compiler.js';
import { derivePendingFormsForResponsive } from '../src/native44/pending-form.js';
import { validatePlan, validateRegisteredSettings } from '../src/planning/plan.js';

const ROOT = path.resolve('D:/cloneWP');
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const loaded = await loadNative44Knowledge(['form']);
const knowledgeIdentity = await native44KnowledgeIdentity(ROOT);
/** A synthetic registered fixture, deliberately not current-target evidence. */
function registeredFixture(): LegacySchema {
  const fields = { field_type: { type: 'select', options: { email: 'Email' } }, field_label: { type: 'text' }, placeholder: { type: 'text' }, required: { type: 'switcher', default: '', options: { true: 'Yes' } }, width: { type: 'select', options: { '100': '100%' } }, custom_id: { type: 'text' }, _id: { type: 'hidden' } };
  return { type: 'form', class: 'ElementorPro\\Modules\\Forms\\Widgets\\Form', controls: { form_fields: { type: 'form-fields-repeater', fields }, button_text: { type: 'text' }, selected_button_icon: { type: 'icons' }, show_labels: { type: 'switcher' }, submit_actions: { type: 'select2', multiple: true, default: ['email'] }, _attributes: { type: 'textarea' }, _css_classes: { type: 'text' } } };
}
async function fixture(schemaOverride?: LegacySchema) {
  const dir = await mkdtemp(path.join(ROOT, 'tests', '.tmp-pending-form-'));
  const put = async (name: string, value: unknown) => { const file = path.join(dir, name), bytes = JSON.stringify(value); await writeFile(file, bytes); return { path: file, sha256: sha(bytes) }; };
  const schema = structuredClone(schemaOverride ?? registeredFixture()), registered = await put('registered.json', { mode: 'legacy-verified', legacySchemas: { form: schema }, versions: { elementor: 'test-version', elementorPro: 'test-version' }, sourceProof: { schemaErrors: {} } });
  const snapshots: any[] = [], facts: Record<string, any> = {}, sourceControls: any[] = [], appearanceRows: any[] = [];
  const packets: any[] = [];
  for (const [index, viewport] of native44ProfileViewports('desktop-browser-v1').entries()) {
    const id = `snapshot-${index}`, emailId = `email-${index}`, submitId = `submit-${index}`, formId = `form-${index}`;
    const form = JSON.stringify({ nodeId: formId, selector: `#${formId}`, submitControlNodeId: submitId, action: 'https://source.example/subscribe', method: 'post' });
    const interaction = (type: string, nodeId: string) => ({ id: `interaction-${nodeId}`, nodeId, regionId: 'region', kind: 'control', status: 'unobserved', selector: `#${nodeId}`, details: { type, form } });
    const nodes = {
      [formId]: { id: formId, tag: 'form', parentId: null, selector: `#${formId}`, visible: true, attributes: {}, childIds: [emailId, submitId] },
      [emailId]: { id: emailId, tag: 'input', parentId: formId, selector: `#${emailId}`, visible: true, attributes: { type: 'email', placeholder: 'Enter email' }, styleId: 'email-style', layoutId: 'email-layout' },
      [submitId]: { id: submitId, tag: 'input', parentId: formId, selector: `#${submitId}`, visible: true, attributes: { type: 'submit' }, styleId: 'submit-style', layoutId: 'submit-layout' },
    };
    const packet = { version: 2, kind: 'observation-packet', snapshot: { id, viewport }, nodes, styles: { 'email-style': { display: 'block', visibility: 'visible' }, 'submit-style': { display: 'block', visibility: 'visible' } }, layouts: { 'email-layout': { rect: { x: 0, y: 1, width: 200, height: 40 } }, 'submit-layout': { rect: { x: 200, y: 1, width: 80, height: 40 } } }, interactions: { email: interaction('email', emailId), submit: interaction('submit', submitId) } };
    const packetRef = await put(`packet-${index}.json`, packet); packets.push({ packet, packetRef });
    for (const [kind, nodeId] of [['email', emailId], ['submit', submitId]]) { const value = packet.interactions[kind as 'email' | 'submit']; facts[`${id}:${kind}`] = { kind: 'interaction', snapshotId: id, regionId: 'region', nodeId, evidence: packetRef, value }; }
    snapshots.push({ id, viewport, nodes }); sourceControls.push({ snapshotId: id, emailFactId: `${id}:email`, submitFactId: `${id}:submit` }); appearanceRows.push({ packet: packetRef, nodes: [nodes[emailId], nodes[submitId]] });
  }
  const source = { version: 2, kind: 'source-facts', sourceUrl: 'https://source.example/', snapshots, facts }, sourceFacts = await put('source.json', source);
  const appearance = await put('appearance.json', { version: 1, kind: 'native44-visible-source-form-appearance-extraction', rows: appearanceRows, visualPassed: false });
  const node: PendingFormNode = { kind: 'native', key: 'pending-email', widgetType: 'form', sourceFactIds: Object.keys(facts), widgetSettings: { form_fields: [{ field_type: 'email', field_label: '', placeholder: 'Enter email', required: '', width: '100', custom_id: 'email' }], button_text: 'Subscribe', submit_actions: [], _attributes: NATIVE44_PENDING_FORM_ATTRIBUTES }, pendingForm: { version: 1, kind: 'native44-pending-form-v1', sourceControls, appearance, registered: { capabilities: registered, schemaHash: native44RegisteredSchemaHash(schema) }, knowledge: { fingerprint: loaded.index.fingerprint, formComponentHash: loaded.index.components.form.sha256, sharedControlsHash: loaded.index.sharedControls.sha256 } } };
  const program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, requirementProfile: 'source-requirements-v1', goalProfile: 'component-reference-v1', taskId: 'pending-form-fixture', title: 'Pending layout', sourceUrl: source.sourceUrl, ...knowledgeIdentity, sourceFacts, componentPlan: sourceFacts, assetsManifest: sourceFacts, viewports: native44ProfileViewports('desktop-browser-v1'), blocks: [{ kind: 'composite', key: 'module', children: [node] }] } as unknown as Native44Program;
  const cleanup = async () => { assert.equal(path.dirname(dir), path.join(ROOT, 'tests')); assert.ok(path.basename(dir).startsWith('.tmp-pending-form-')); await rm(dir, { recursive: true }); };
  return { dir, put, cleanup, schema, node, program, source, packets, appearanceRows };
}
async function withFixture(fn: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) { const f = await fixture(); try { await fn(f); } finally { await f.cleanup(); } }
const emitted = (node: PendingFormNode): Record<string, unknown> => ({ ...structuredClone(node.widgetSettings), form_fields: [{ ...(node.widgetSettings.form_fields as any[])[0], _id: 'abcdef0' }], _css_classes: 'cwp-owned-form' });

async function useAriaSource(f: Awaited<ReturnType<typeof fixture>>, role = 'button', extra = false) {
  f.node.pendingForm!.sourceSubmitModel = 'aria-button';
  for (const [index, item] of f.packets.entries()) {
    const raw = item.packet.nodes[`submit-${index}`]; raw.tag = 'div'; raw.attributes = { role } as any;
    item.packet.interactions.submit.details.type = 'div';
    if (extra) (item.packet.nodes as any).extra = { id: 'extra', tag: 'div', parentId: `form-${index}`, visible: true, attributes: { role: 'button' } };
    const ref = await f.put(`aria-packet-${index}.json`, item.packet);
    for (const fact of Object.values(f.source.facts) as any[]) if (fact.snapshotId === `snapshot-${index}`) fact.evidence = ref;
    f.appearanceRows[index].packet = ref;
  }
  f.program.sourceFacts = await f.put('aria-source.json', f.source);
  f.node.pendingForm!.appearance = await f.put('aria-appearance.json', { kind: 'native44-visible-source-form-appearance-extraction', rows: f.appearanceRows });
}

test('explicit ARIA source button preserves native inert target and binds the source model', () => withFixture(async f => {
  await useAriaSource(f);
  const [capability] = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
  const settings = emitted(f.node), permit = bindPendingFormAttributeAuthorization(capability, 'abcdef1', settings, f.schema);
  assert.equal(native44PendingFormBinding(capability, permit, settings).sourceSubmitModel, 'aria-button');
  delete f.node.pendingForm!.sourceSubmitModel;
  assert.throws(() => assertNative44PendingFormCapability(f.program, f.node, { form: f.schema }, capability));
  await assert.rejects(() => prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program }));
}));

for (const [name, role, extra] of [['wrong ARIA role', 'link', false], ['extra ARIA control', 'button', true]] as const) test(`ARIA source rejects ${name}`, () => withFixture(async f => {
  await useAriaSource(f, role, extra);
  await assert.rejects(() => prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program }));
}));

test('verified local source + KG + synthetic registration creates only a pending candidate', () => withFixture(async f => {
  const [capability] = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
  assertNative44PendingFormCapability(f.program, f.node, { form: f.schema }, capability);
  const settings = emitted(f.node), permit = bindPendingFormAttributeAuthorization(capability, 'abcdef1', settings, f.schema);
  assert.deepEqual(toNative44CompilerKnowledge(loaded, { form: f.schema }).validateSettings('form', settings), settings);
  assertPendingFormAttributeAuthorization(permit, 'form', settings, 'abcdef1', f.schema);
  assert.equal(pendingFormAuthorizationForElement([permit], 'abcdef1'), permit);
  const receipt = native44PendingFormBinding(capability, permit, settings);
  assert.equal(receipt.businessStatus, 'pending'); assert.equal(receipt.runtimeVerification, 'required'); assert.equal(receipt.submitLabelVerification, 'source-visual-review-required');
  assert.equal(receipt.packets.length, 2); assert.equal(receipt.registered.schemaHash, native44RegisteredSchemaHash(f.schema));
}));

test('responsive visibility derives opaque pending permission without allowing Form or source mutations', () => withFixture(async f => {
  const [capability] = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
  const fields = { hide_mobile: { type: 'switcher', return_value: 'hidden-mobile' } }, target = structuredClone(f.program);
  target.knowledge.fingerprint = sha(JSON.stringify({ base: f.program.knowledge.fingerprint, module: 'responsive-native-v1', fields }));
  const node = (target.blocks[0] as any).children[0], schemas = { form: f.schema };
  const [derived] = derivePendingFormsForResponsive(f.program, target, schemas, [capability], fields);
  assertNative44PendingFormCapability(target, node, schemas, derived);
  assertNative44PendingFormCapability(f.program, f.node, schemas, capability);
  assert.throws(() => assertNative44PendingFormCapability(target, node, schemas, capability));
  node.widgetSettings.submit_actions = ['email']; assert.throws(() => derivePendingFormsForResponsive(f.program, target, schemas, [capability], fields)); node.widgetSettings.submit_actions = [];
  target.sourceFacts.sha256 = '0'.repeat(64); assert.throws(() => derivePendingFormsForResponsive(f.program, target, schemas, [capability], fields));
  assert.throws(() => derivePendingFormsForResponsive(f.program, target, schemas, [structuredClone(capability)], fields));
  assert.throws(() => derivePendingFormsForResponsive(f.program, target, schemas, [capability], { arbitrary: { type: 'switcher', return_value: 'yes' } }));
}));

test('native non-resource font arrow is an explicit candidate; resources or arbitrary icon objects reject', () => withFixture(async f => {
  f.node.widgetSettings.button_text = ''; f.node.widgetSettings.selected_button_icon = { value: 'fas fa-angle-right', library: 'fa-solid' };
  assertNative44PendingFormCandidate(f.node); assert.equal((await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program })).length, 1);
  assert.deepEqual(toNative44CompilerKnowledge(loaded, { form: f.schema }).validateSettings('form', emitted(f.node)), emitted(f.node));
  f.node.widgetSettings.selected_button_icon = { value: { id: 12, url: 'https://target.example/icon.svg' }, library: 'svg' };
  assert.throws(() => assertNative44PendingFormCandidate(f.node), /native_arrow_icon/);
}));

for (const [name, mutate] of Object.entries<(node: PendingFormNode) => void>({
  'ordinary form without marker': node => { delete node.pendingForm; },
  'CF7 cannot acquire permission': node => { node.widgetType = 'wd_contact_form_7'; },
  'actions email': node => { node.widgetSettings.submit_actions = ['email']; },
  'absent actions defaults unsafe': node => { delete node.widgetSettings.submit_actions; },
  'aria disabled alone': node => { node.widgetSettings._attributes = 'aria-disabled|true'; },
  'generic extra attribute': node => { node.widgetSettings._attributes += '\ndata-inert|true'; },
  'recipient': node => { node.widgetSettings.email_to = 'recipient@example.test'; },
  'webhook': node => { node.widgetSettings.webhooks = 'https://target.example/api'; },
  'dynamic tags': node => { node.widgetSettings.__dynamic__ = { button_text: 'dynamic' }; },
  'HTML field': node => { (node.widgetSettings.form_fields as any[])[0].field_html = '<input>'; },
  'field value': node => { (node.widgetSettings.form_fields as any[])[0].field_value = 'x@example.test'; },
  'second email': node => { (node.widgetSettings.form_fields as any[]).push({ ...(node.widgetSettings.form_fields as any[])[0] }); },
  'resource IDs': node => { node.resources = [{ kind: 'form', ids: [12] }]; },
  'wrong source owner': node => { node.sourceFactIds = []; },
})) test(`strict pending syntax rejects ${name}`, () => withFixture(async f => { mutate(f.node); assert.throws(() => assertNative44PendingFormCandidate(f.node)); }));

test('serialized/forged capabilities and attributes never authorize inert; exact element/settings/schema binding is enforced', () => withFixture(async f => {
  const [capability] = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program }), settings = emitted(f.node);
  assert.throws(() => assertNative44PendingFormCapability(f.program, f.node, { form: f.schema }, structuredClone(capability)), /process_capability/);
  const permit = bindPendingFormAttributeAuthorization(capability, 'abcdef1', settings, f.schema);
  for (const check of [() => assertPendingFormAttributeAuthorization(structuredClone(permit), 'form', settings), () => assertPendingFormAttributeAuthorization(permit, 'container', settings), () => assertPendingFormAttributeAuthorization(permit, 'form', { ...settings, submit_actions: ['email'] }), () => assertPendingFormAttributeAuthorization(permit, 'form', settings, 'abcdef2'), () => pendingFormAuthorizationForElement([permit, permit], 'abcdef1')]) assert.throws(check);
  const changed = structuredClone(f.schema); changed.controls.submit_actions.default = ['webhook'];
  assert.throws(() => assertNative44PendingFormCapability(f.program, f.node, { form: changed }, capability), /process_capability/);
  f.node.widgetSettings.button_text = 'Changed'; assert.throws(() => assertNative44PendingFormCapability(f.program, f.node, { form: f.schema }, capability));
}));

for (const scenario of ['source-file-hash', 'KG-component-hash', 'registered-hash', 'wrong-viewport', 'cross-form', 'hidden-email', 'zero-submit', 'extra-visible-control', 'placeholder', 'packet-interaction', 'appearance-packet', 'wrong-profile']) test(`local evidence rejects ${scenario}`, () => withFixture(async f => {
  if (scenario === 'source-file-hash') await writeFile(f.program.sourceFacts.path, '{}');
  if (scenario === 'KG-component-hash') f.node.pendingForm!.knowledge.formComponentHash = '0'.repeat(64);
  if (scenario === 'registered-hash') f.node.pendingForm!.registered.schemaHash = '0'.repeat(64);
  if (scenario === 'wrong-viewport') f.source.snapshots[1].viewport = { width: 1024, height: 768 };
  if (scenario === 'cross-form') f.source.facts['snapshot-0:submit'].value.details.form = JSON.stringify({ nodeId: 'other' });
  if (scenario === 'placeholder') (f.node.widgetSettings.form_fields as any[])[0].placeholder = 'Wrong';
  if (scenario === 'wrong-profile') delete f.program.goalProfile;
  if (['hidden-email', 'zero-submit', 'extra-visible-control', 'packet-interaction', 'appearance-packet'].includes(scenario)) {
    const p = f.packets[0].packet;
    if (scenario === 'hidden-email') p.nodes['email-0'].visible = false;
    if (scenario === 'zero-submit') p.layouts['submit-layout'].rect.height = 0;
    if (scenario === 'extra-visible-control') p.nodes.extra = { id: 'extra', tag: 'textarea', parentId: 'form-0', visible: true };
    if (scenario === 'packet-interaction') p.interactions.email.details.type = 'password';
    const ref = await f.put('packet-changed.json', p); f.source.facts['snapshot-0:email'].evidence = ref; f.source.facts['snapshot-0:submit'].evidence = ref;
    if (scenario !== 'appearance-packet') { f.appearanceRows[0].packet = ref; f.node.pendingForm!.appearance = await f.put('appearance-new.json', { kind: 'native44-visible-source-form-appearance-extraction', rows: f.appearanceRows }); }
  }
  if (scenario !== 'source-file-hash') f.program.sourceFacts = await f.put('source-updated.json', f.source);
  await assert.rejects(() => prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program }));
}));

test('capability observation calls only container/form discovery and strips unrelated result surfaces', async () => {
  const calls: string[][] = [], schema = registeredFixture();
  const result = await probePendingFormCapabilities({ async discoverCapabilities(types) { calls.push(types); return { mode: 'legacy-verified', abilities: [{ name: 'unsafe-unrelated', token: 'do-not-export' }], schemas: { irrelevant: true }, legacySchemas: { form: schema, unrelated: schema }, versions: { elementor: 'test', elementorPro: 'test' }, sourceProof: { schemaErrors: {}, unrelated: 'do-not-export' }, limitations: [] } as CapabilityReport; } });
  assert.deepEqual(calls, [['container', 'form']]); assert.deepEqual(Object.keys(result.capabilities.legacySchemas), ['form']); assert.equal(result.frontendInert, 'unverified'); assert.equal(result.businessStatus, 'pending');
  assert.equal(JSON.stringify(result).includes('do-not-export'), false);
});
test('missing registered form remains an honest missing observation, not a renderer pass', async () => {
  const result = await probePendingFormCapabilities({ async discoverCapabilities() { return { mode: 'legacy-verified', abilities: [], schemas: {}, legacySchemas: {}, versions: {}, limitations: [] }; } });
  assert.equal(result.registeredFormObserved, false); assert.equal(result.frontendInert, 'unverified');
});
test('real registry client construction retains the exact fixed 44 set without authentication', () => {
  let requests = 0;
  assert.doesNotThrow(() => createPendingFormRegistryReader({ targetUrl: 'https://target.example/', username: 'synthetic-test-user', applicationPassword: 'synthetic-test-password', fetch: async () => { requests++; throw Error('No network allowed in constructor test'); } }));
  assert.equal(requests, 0);
});
test('actual target used-control projection intersects frozen KG including nested conditions for text and arrow candidates', async () => {
  const actual = JSON.parse(await readFile(new URL('./fixtures/native44-pending-form-registered.json', import.meta.url), 'utf8'));
  assert.equal(actual.kind, 'native44-pending-form-registered-used-control-projection');
  assert.equal(actual.source.sha256, '33b2c95be9eccee890e54a93baf2f9e0a222f09e530deaf59c33461566343190');
  assert.equal(actual.sourceFullSchemaHash, '60d94fcc56088415ef76d402a54945e70c551b4ad84ce203cc2d536df8ca3bf0');
  const f = await fixture(actual.schema);
  try {
    assert.deepEqual(f.schema.controls.submit_actions.default, ['email', 'save-to-database']);
    for (const arrow of [false, true]) {
      if (arrow) { f.node.widgetSettings.button_text = ''; f.node.widgetSettings.selected_button_icon = { value: 'fas fa-angle-right', library: 'fa-solid' }; }
      const [capability] = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
      const settings = emitted(f.node), solved = toNative44CompilerKnowledge(loaded, { form: f.schema }).validateSettings('form', settings);
      assert.deepEqual(solved, settings); assert.deepEqual(solved.submit_actions, []);
      const permit = bindPendingFormAttributeAuthorization(capability, 'abcdef1', solved, f.schema);
      assert.equal(native44PendingFormBinding(capability, permit, solved).runtimeVerification, 'required');
    }
    const changed = structuredClone(f.schema), fields = Object.values(changed.controls.form_fields.fields as object) as any[];
    const placeholder = fields.find(field => field.name === 'placeholder');
    placeholder.conditions.terms = [{ name: 'field_type', operator: '===', value: 'tel' }];
    assert.throws(() => toNative44CompilerKnowledge(loaded, { form: changed }).validateSettings('form', emitted(f.node)), /condition|inactive/i);
  } finally { await f.cleanup(); }
});
test('source-facts may add only the exact node selector omitted by the raw interaction collector', () => withFixture(async f => {
  for (const item of f.packets) {
    for (const interaction of Object.values(item.packet.interactions) as any[]) delete interaction.selector;
    // The fixture's fact values shared original objects: preserve the actual
    // assembler result explicitly while raw records retain no selector.
    for (const fact of Object.values(f.source.facts) as any[]) if (fact.evidence.path === item.packetRef.path) fact.value = { ...structuredClone(item.packet.interactions[fact.value.details.type]), selector: item.packet.nodes[fact.nodeId].selector };
    const updated = await f.put(path.basename(item.packetRef.path) + '-no-selector.json', item.packet);
    for (const fact of Object.values(f.source.facts) as any[]) if (fact.evidence.path === item.packetRef.path) fact.evidence = updated;
    f.appearanceRows.find(row => row.packet.path === item.packetRef.path).packet = updated;
  }
  f.program.sourceFacts = await f.put('source-selectors.json', f.source);
  f.node.pendingForm!.appearance = await f.put('appearance-selectors.json', { kind: 'native44-visible-source-form-appearance-extraction', rows: f.appearanceRows });
  assert.equal((await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program })).length, 1);
  (Object.values(f.source.facts) as any[])[0].value.selector = '#invented'; f.program.sourceFacts = await f.put('source-wrong-selector.json', f.source);
  await assert.rejects(() => prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program }), /packet_controls/);
}));
test('normal44 compilation requires opaque candidate permission and seals final native attrs/actions/receipt/editor metadata', () => withFixture(async f => {
  const all = await loadNative44Knowledge(['form', 'container']);
  const schemas = { form: f.schema, container: { type: 'container', class: 'Elementor\\Includes\\Elements\\Container', controls: { css_classes: { type: 'text' }, _attributes: { type: 'textarea' } } } };
  const options = { schemas, assets: [], knowledge: toNative44CompilerKnowledge(all, schemas) };
  (f.node as any).editorTitle = 'Pending editable email form';
  assert.throws(() => compileNative44(f.program, options), /capabilities/);
  const pendingForms = await prepareNative44PendingFormCapabilities({ root: ROOT, program: f.program });
  assert.throws(() => compileNative44(f.program, { ...options, pendingForms: structuredClone(pendingForms) }), /process_capability/);
  const compiled = compileNative44(f.program, { ...options, pendingForms });
  const form = compiled.composition.elements[0].elements[0];
  assert.equal(form.widgetType, 'form'); assert.equal(form.settings._attributes, NATIVE44_PENDING_FORM_ATTRIBUTES); assert.deepEqual(form.settings.submit_actions, []);
  assert.equal(form.settings._title, 'Pending editable email form');
  delete (f.node as any).editorTitle;f.program.editorNaming='native-translated-v1';
  const nativePendingForms=await prepareNative44PendingFormCapabilities({root:ROOT,program:f.program});
  const nativeNames=compileNative44(f.program,{...options,pendingForms:nativePendingForms}),nativeForm=nativeNames.composition.elements[0].elements[0];
  const renderSettings=structuredClone(form.settings);delete renderSettings._title;
  assert.deepEqual(nativeForm.settings,renderSettings);assert.equal(nativeNames.editorLabels,undefined);assert.equal(nativeForm.id,form.id);
  assertNative44PendingFormCompilation(nativeNames,schemas);
  assert.equal(compiled.pendingFormBindings?.[0].elementId, form.id); assert.equal(compiled.pendingFormBindings?.[0].runtimeVerification, 'required');
  assertNative44Compilation(compiled, compiled.composition); assertNative44PendingFormCompilation(compiled, schemas);
  assert.throws(() => validateRegisteredSettings('form', form.settings, schemas.form), /inert|Undiscovered/);
  assert.throws(() => validateRegisteredSettings('container', { _attributes: NATIVE44_PENDING_FORM_ATTRIBUTES }, schemas.container), /inert/);
  assert.throws(() => validatePlan(compiled.plan, { mode: 'legacy-verified', widgetSchemas: schemas }), /inert/);
  assert.throws(() => validatePlan(compiled.plan, { mode: 'legacy-verified', widgetSchemas: schemas, pendingFormAuthorizations: [{ kind: 'native44-pending-form-attributes', elementId: form.id }] }), /inert/);
  const changed = structuredClone(schemas); changed.form.controls.submit_actions.default = ['webhook'];
  assert.throws(() => assertNative44PendingFormCompilation(compiled, changed), /attribute_authorization/);
  compiled.pendingFormBindings![0].runtimeVerification = 'passed' as any;
  assert.throws(() => assertNative44Compilation(compiled, compiled.composition), /exact current-process/);
}));
test('same disabled-looking form without explicit marker stays unverified and inert cannot unlock general attributes', () => withFixture(async f => {
  const all = await loadNative44Knowledge(['form', 'container']);
  const schemas = { form: f.schema, container: { type: 'container', class: 'Elementor\\Includes\\Elements\\Container', controls: { css_classes: { type: 'text' }, _attributes: { type: 'textarea' } } } };
  delete f.node.pendingForm;
  assert.throws(() => compileNative44(f.program, { schemas, assets: [], knowledge: toNative44CompilerKnowledge(all, schemas) }), /resource_adapter_unverified/);
}));
