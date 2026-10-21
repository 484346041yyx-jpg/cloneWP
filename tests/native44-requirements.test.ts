import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';
import type { Native44SourceUnit } from '../src/native44/selection-types.js';
import type { Native44Component } from '../src/native44/types.js';
import { createNative44RequirementContract, deriveNative44SourceObligations, validateNative44Requirements, assertNative44CapabilityProof, evaluateNative44Acceptance, adviseNative44Convergence, native44RequirementsHash, native44RequirementsJsonSchemas, Native44RequirementContractSchema, type Native44RequirementContract, type Native44AcceptancePolicy, type Native44AcceptanceObservation, type Native44CapabilityProof } from '../src/native44/requirements.js';
import { prepareReference, prepareOriginalReference } from '../src/reference/prepare.js';
import { prepareLocalTask } from '../src/native44/local-task.js';
import { runNative44Replica } from '../src/native44/runtime.js';
import { native44ProgramSchema } from '../src/native44/validate.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';

const ref = { path: 'source-packet.json', sha256: 'a'.repeat(64) }, sourceRef = { path: 'source-facts.json', sha256: 'b'.repeat(64) };
const current = { documentHash: 'c'.repeat(64), cssHash: 'd'.repeat(64) };
function fixture() {
  const nodes: SourceFactsV2['snapshots'][number]['nodes'] = {};
  for (const [id, tag, parentId, regionId] of [['header', 'header', null, 'header'], ['title', 'h2', 'header', 'header'], ['search', 'input', 'header', 'header'], ['cart', 'a', 'header', 'header'], ['carousel', 'div', 'header', 'header'], ['pause', 'button', 'header', 'header'], ['products', 'section', null, 'products'], ['card', 'div', 'products', 'products']] as const) nodes[id] = { tag, parentId, regionId, selector: `#${id}`, childIds: [] };
  for (const [id, node] of Object.entries(nodes)) if (node.parentId) nodes[node.parentId].childIds.push(id);
  const facts: SourceFactsV2['facts'] = {};
  const add = (kind: SourceFactsV2['facts'][string]['kind'], id: string, nodeId: string, value: Record<string, unknown>) => { const factId = `wide:${kind}:${id}`; facts[factId] = { id: factId, snapshotId: 'wide', regionId: nodes[nodeId].regionId, nodeId, kind, evidence: ref, value }; };
  add('region', 'header', 'header', {}); add('text', 'title', 'title', { text: 'Offers', visible: true });
  add('interaction', 'search', 'search', { kind: 'control', details: { action: 'search' } });
  add('interaction', 'cart', 'cart', { kind: 'link', href: 'https://target.example/cart/', details: { dynamicCart: true, cartCount: true } });
  add('interaction', 'carousel', 'carousel', { kind: 'carousel', details: { autoplay: true, pagination: true, pauseToggle: true }, controlNodeIds: ['pause'] });
  add('interaction', 'pause', 'pause', { kind: 'control', details: { pause: true } });
  add('region', 'products', 'products', {}); add('media', 'card', 'card', { visible: true });
  const source: SourceFactsV2 = { version: 2, kind: 'source-facts', sourceUrl: 'https://source.example/', observation: ref, snapshots: [{ id: 'wide', viewport: { name: 'desktop', width: 1920, height: 1080, clientWidth: 1905, scrollbarWidth: 15, devicePixelRatio: 1 }, screenshot: { ...ref, width: 1920, height: 2000 }, evidence: [ref], nodes }], facts, gaps: [] };
  const units: Native44SourceUnit[] = ['header', 'products'].map(id => ({ id, snapshotId: 'wide', ownerNodeId: id, regionId: id, role: id === 'products' ? 'query' : 'layout', sourceFactIds: Object.values(facts).filter(fact => fact.regionId === id).map(fact => fact.id), evidence: { factIds: Object.values(facts).filter(fact => fact.regionId === id).map(fact => fact.id), screenshots: [{ snapshotId: 'wide', screenshot: ref }], rationale: 'Independently inspected source ownership and complete responsibilities.' }, slots: [] }));
  const components: Native44Component[] = [{ kind: 'native', key: 'form', role: 'form', widgetType: 'form', widgetSettings: {} }, { kind: 'native', key: 'link', role: 'link', widgetType: 'button', widgetSettings: { link: { url: 'https://target.example/cart/' } } }, { kind: 'native-products', key: 'products', role: 'product', widgetType: 'wd_products', widgetSettings: {}, query: { ids: [3, 4], evidence: ['actual-target-catalog.json'] } }];
  const contract = createNative44RequirementContract(source, units, sourceRef, 'test-task');
  return { source, units, components, contract };
}
function resolve(contract: Native44RequirementContract): Native44RequirementContract {
  const copy = structuredClone(contract);
  for (const requirement of copy.requirements) requirement.fulfillment = { route: 'verified-native', capability: requirement.capability, componentKeys: requirement.sourceKey === 'unit:products' ? ['products'] : ['form'], proof: ref };
  return copy;
}
function observation(contract: Native44RequirementContract): Native44AcceptanceObservation {
  return { version: 1, kind: 'native44-acceptance-observation', requirementsHash: native44RequirementsHash(contract), ...current, review: { verification: ref, visualReview: sourceRef }, checks: contract.requirements.flatMap(requirement => requirement.checks.map(check => ({ requirementId: requirement.id, checkId: check.id, outcome: 'pass' as const, evidence: [ref] }))) };
}
function policy(contract: Native44RequirementContract): Native44AcceptancePolicy { return { version: 1, kind: 'native44-acceptance-policy', requirementsHash: native44RequirementsHash(contract), tolerances: [], acceptedDeviations: [] }; }

test('source obligations include unimplemented controls, real product requirements and source-specific playback states', () => {
  const { source, units, contract, components } = fixture();
  const result = validateNative44Requirements(contract, { source, sourceUnits: units, components, sourceFactsHash: sourceRef.sha256 });
  assert.equal(result.coverage.ready, false);
  assert.equal(result.coverage.required, contract.requirements.length);
  assert.ok(contract.requirements.some(item => item.capability === 'search-input'));
  assert.ok(contract.requirements.some(item => item.capability === 'cart-state'));
  const autoplay = contract.requirements.find(item => item.capability === 'carousel-autoplay')!, toggle = contract.requirements.find(item => item.capability === 'carousel-playback-toggle')!;
  assert.notEqual(autoplay.sourceKey, toggle.sourceKey);
  assert.deepEqual(toggle.checks.map(item => item.state), ['paused', 'resumed']);
  assert.deepEqual(contract.requirements.filter(item => item.disposition === 'target-product-data').map(item => item.dimension), ['data']);
  assert.throws(() => validateNative44Requirements({ ...contract, requirements: contract.requirements.filter(item => item.capability !== 'search-input') }, { source, sourceUnits: units }), /Source requirements missing/);
});

test('a reduced source-unit list cannot omit a static block or relabel an actual catalog', () => {
  const { source, units } = fixture(), reduced = units.filter(unit => unit.id !== 'products');
  const contract = createNative44RequirementContract(source, reduced, sourceRef, 'test-task');
  assert.throws(() => validateNative44Requirements(contract, { source, sourceUnits: reduced }), /Source inventory omits captured responsibilities/);
  const copy = structuredClone(units); copy[1].sourceFactIds.push(copy[0].sourceFactIds[0]);
  assert.throws(() => validateNative44Requirements(createNative44RequirementContract(source, copy, sourceRef, 'test-task'), { source, sourceUnits: copy }), /wrong-owner source facts/);
});

test('unrecorded native inputs and unclassified controls become named gaps rather than disappearing', () => {
  const { source, units } = fixture();
  delete source.facts['wide:interaction:search']; units[0].sourceFactIds = units[0].sourceFactIds.filter(id => id !== 'wide:interaction:search');
  source.snapshots[0].nodes.pause.selector = '#some-button'; delete source.facts['wide:interaction:pause']; units[0].sourceFactIds = units[0].sourceFactIds.filter(id => id !== 'wide:interaction:pause');
  const rows = deriveNative44SourceObligations(source, units);
  assert.ok(rows.some(row => row.sourceKey === 'node:wide:search' && row.capability === 'search-input'));
  assert.ok(rows.some(row => row.sourceKey === 'node:wide:pause' && row.capability === 'unknown-control'));
});

function declaredControlFixture(controls: Array<{ id: string; label: string; nodeClass?: string; tag?: string; details?: Record<string, unknown> }>): SourceFactsV2 {
  const facts: SourceFactsV2['facts'] = {};
  const snapshots: SourceFactsV2['snapshots'] = ['wide', 'narrow'].map(snapshotId => {
    const nodes: SourceFactsV2['snapshots'][number]['nodes'] = { group: { tag: 'section', parentId: null, regionId: 'group', selector: '#group', childIds: controls.map(control => control.id) } };
    for (const control of controls) {
      nodes[control.id] = { tag: control.tag ?? 'button', parentId: 'group', regionId: 'group', selector: `#${control.id}`, childIds: [] };
      const factId = `${snapshotId}:interaction:${control.id}`;
      facts[factId] = { id: factId, snapshotId, regionId: 'group', nodeId: control.id, kind: 'interaction', evidence: ref, value: { kind: 'control', details: { type: 'button', nodeType: control.tag ?? 'button', typeAttribute: 'button', label: control.label, nodeClass: control.nodeClass ?? '', ...control.details } } };
    }
    return { id: snapshotId, viewport: { name: snapshotId === 'wide' ? 'desktop' : 'desktop-narrow', width: snapshotId === 'wide' ? 1920 : 1440, height: snapshotId === 'wide' ? 1080 : 1000, clientWidth: snapshotId === 'wide' ? 1905 : 1425, scrollbarWidth: 15, devicePixelRatio: 1 }, screenshot: { ...ref, width: snapshotId === 'wide' ? 1905 : 1425, height: 2000 }, evidence: [ref], nodes };
  });
  return { version: 2, kind: 'source-facts', sourceUrl: 'https://source.example/', observation: ref, snapshots, facts, gaps: [] };
}

test('observed benefit headers and indexed slide buttons create all desktop behavior obligations without fulfilling them', () => {
  const benefitLabels = ['A More Transparent Ingredient List', 'Simpler Protein Tracking', 'Appealing Aroma and Texture', 'Greater Variety over Time', 'A Clear Freezer-to-Bowl Routine'];
  const source = declaredControlFixture([
    ...benefitLabels.map((label, index) => ({ id: `benefit-${index + 1}`, label, nodeClass: `natural-benefits-header${index === 0 ? ' active' : ''}` })),
    ...Array.from({ length: 5 }, (_, index) => ({ id: `slide-${index + 1}`, label: `Go to slide ${index + 1}`, nodeClass: `pet-order-dot${index === 0 ? ' active' : ''}` })),
  ]);
  const rows = deriveNative44SourceObligations(source, []);
  assert.equal(rows.length, 20);
  assert.equal(rows.filter(row => row.capability === 'accordion-toggle').length, 10);
  assert.equal(rows.filter(row => row.capability === 'carousel-pagination').length, 10);
  assert.ok(rows.every(row => row.dimension === 'behavior' && row.minimumSeverity === 'blocking' && row.requiredScopes.join() === 'control'));
  assert.deepEqual(new Set(rows.map(row => row.sourceKey)), new Set(Object.keys(source.facts).map(id => `interaction:${id}:${id.includes(':benefit-') ? 'accordion-toggle' : 'carousel-pagination'}`)));
  const contract = createNative44RequirementContract(source, [], sourceRef, 'declared-controls');
  assert.equal(contract.requirements.length, 20);
  assert.ok(contract.requirements.every(row => row.fulfillment.route === 'gap'));
  assert.ok(contract.requirements.filter(row => row.capability === 'accordion-toggle').every(row => row.checks.map(check => check.state).join() === 'expanded,collapsed'));
  assert.ok(contract.requirements.filter(row => row.capability === 'carousel-pagination').every(row => row.checks.map(check => check.state).join() === 'selected'));
});

test('control declarations require actual buttons and explicit disclosure or indexed pagination semantics', () => {
  const source = declaredControlFixture([
    { id: 'faq', label: 'Delivery information', nodeClass: 'faq-trigger' },
    { id: 'disclosure', label: 'More information', nodeClass: 'disclosure-toggle' },
    { id: 'indexed-label', label: 'Go to slide 3' },
    { id: 'indexed-dot', label: 'Slide 2', nodeClass: 'slider-dot' },
    { id: 'indexed-pagination', label: '2', nodeClass: 'carousel-pagination-button' },
    { id: 'index-attribute', label: 'Choose item', nodeClass: 'pet-order-dot', details: { 'data-slide-index': '0' } },
    { id: 'next', label: 'Next slide', nodeClass: 'pet-order-dot' },
    { id: 'ordinary', label: 'Continue' },
    { id: 'unindexed-label', label: 'Go to slide' },
    { id: 'unindexed-dot', label: 'Choose item', nodeClass: 'pet-order-dot' },
    { id: 'zero-label', label: 'Go to slide 0' },
    { id: 'unsafe-index', label: 'Go to slide 9007199254740992' },
    { id: 'negative-index', label: 'Choose item', nodeClass: 'pet-order-dot', details: { slideIndex: -1 } },
    { id: 'static-benefit', label: 'Ingredients', nodeClass: 'natural-benefits-header', tag: 'div' },
    { id: 'static-slide', label: 'Go to slide 2', nodeClass: 'pet-order-dot', tag: 'span' },
    { id: 'faq-copy', label: 'Read the FAQ header' },
  ]);
  const rows = deriveNative44SourceObligations(source, []);
  assert.equal(rows.length, Object.keys(source.facts).length);
  const expected: Record<string, string> = { faq: 'accordion-toggle', disclosure: 'accordion-toggle', 'indexed-label': 'carousel-pagination', 'indexed-dot': 'carousel-pagination', 'indexed-pagination': 'carousel-pagination', 'index-attribute': 'carousel-pagination', next: 'carousel-next-previous' };
  for (const row of rows) assert.equal(row.capability, expected[row.sourceNodeId!] ?? 'unknown-control', row.sourceKey);
});

test('product substitution cannot waive existence, styling, behavior or authenticity and fake static queries fail', () => {
  const { source, units, contract, components } = fixture();
  for (const dimension of ['presence', 'editability', 'layout', 'presentation', 'authenticity']) {
    const copy = structuredClone(contract); copy.requirements.find(item => item.sourceKey === 'unit:products' && item.dimension === dimension)!.disposition = 'target-product-data';
    assert.throws(() => validateNative44Requirements(copy, { source, sourceUnits: units }), /exempts only specific product data/);
  }
  const copy = resolve(contract); copy.requirements.find(item => item.sourceKey === 'unit:products' && item.dimension === 'authenticity')!.fulfillment = { route: 'verified-native', componentKeys: ['link'], capability: 'authentic-business', proof: ref };
  assert.throws(() => validateNative44Requirements(copy, { source, sourceUnits: units, components }), /real native product query/);
});

test('button navigation, cart links and autoplay cannot satisfy different semantic responsibilities', () => {
  const { source, units, contract, components } = fixture();
  for (const [capability, substitute] of [['search-input', 'navigate'], ['cart-state', 'navigate'], ['carousel-playback-toggle', 'carousel-autoplay']] as const) {
    const copy = resolve(contract), row = copy.requirements.find(item => item.capability === capability)!;
    row.fulfillment = { route: 'verified-native', componentKeys: ['link'], capability: substitute, proof: ref };
    assert.throws(() => validateNative44Requirements(copy, { source, sourceUnits: units, components }), /Capability substitution/);
  }
  const copy = resolve(contract), search = copy.requirements.find(item => item.capability === 'search-input')!;
  search.fulfillment = { route: 'verified-native', componentKeys: ['link'], capability: 'search-input', proof: ref };
  assert.throws(() => validateNative44Requirements(copy, { source, sourceUnits: units, components }), /not an editable search input/);
});

test('outer bounding boxes and computed style alone cannot remove inner layout or control states', () => {
  const { source, units, contract } = fixture();
  for (const remove of [(row: Native44RequirementContract['requirements'][number]) => row.dimension === 'layout', (row: Native44RequirementContract['requirements'][number]) => row.capability === 'carousel-playback-toggle']) {
    const copy = structuredClone(contract), row = copy.requirements.find(remove)!; row.checks = row.checks.slice(0, 1);
    assert.throws(() => validateNative44Requirements(copy, { source, sourceUnits: units }), /inner content\/item\/control or interaction-state/);
  }
});

test('capability proofs bind native settings and actual semantic observations, not merely the selected widget', () => {
  const { contract, components } = fixture(), resolved = resolve(contract), row = resolved.requirements.find(item => item.capability === 'carousel-playback-toggle')!;
  const proof: Native44CapabilityProof = { version: 1, kind: 'native44-capability-proof', capability: row.capability, method: 'interaction-probe', components: [{ key: 'form', widgetType: 'form', settingsHash: native44RequirementsHash({ settings: {}, widgetSettings: {} }) }], observations: { userCanPause: true, userCanResume: true, pausedStateStopsAdvancing: true }, evidence: [ref] };
  assert.doesNotThrow(() => assertNative44CapabilityProof(row, proof, components));
  assert.throws(() => assertNative44CapabilityProof(row, { ...proof, observations: { advancesWithoutUserAction: true } }, components), /semantic observations/);
  assert.throws(() => assertNative44CapabilityProof(row, { ...proof, method: 'registered-contract' }, components), /not a verified interaction/);
  assert.throws(() => assertNative44CapabilityProof(row, { ...proof, capability: 'carousel-autoplay' }, components), /required source behavior/);
  const stale = structuredClone(components); (stale[0] as Extract<Native44Component, { kind: 'native' }>).widgetSettings.field = 'changed';
  assert.throws(() => assertNative44CapabilityProof(row, proof, stale), /stale/);
});

test('acceptance distinguishes current review from deliverability and binds document, CSS, requirements and policy', () => {
  const { contract } = fixture(), resolved = resolve(contract), rules = policy(resolved), observed = observation(resolved);
  assert.equal(evaluateNative44Acceptance(resolved, rules, undefined, current).status, 'pending');
  assert.equal(evaluateNative44Acceptance(resolved, rules, observed, current).verdict, 'pass');
  assert.equal(evaluateNative44Acceptance(resolved, rules, observed, { ...current, cssHash: 'e'.repeat(64) }).status, 'stale');
  assert.equal(evaluateNative44Acceptance(resolved, { ...rules, requirementsHash: 'e'.repeat(64) }, observed, current).status, 'stale');
  const gaps = evaluateNative44Acceptance(contract, policy(contract), observation(contract), current);
  assert.equal(gaps.status, 'blocked'); assert.equal(gaps.delivery, 'pending');
});

test('small measured geometry deviations pass with deviations while missing checks remain blocking', () => {
  const { contract } = fixture(), resolved = resolve(contract), observed = observation(resolved), rules = policy(resolved);
  const layout = resolved.requirements.find(item => item.dimension === 'layout')!, item = observed.checks.find(item => item.requirementId === layout.id)!;
  item.outcome = 'fail'; item.issue = { category: 'geometry', message: 'Measured 0.4px gap difference', delta: .4, unit: 'px' };
  rules.tolerances.push({ checkId: item.checkId, maxDelta: .5, unit: 'px', reason: 'Subpixel rounding tolerance.' });
  assert.equal(evaluateNative44Acceptance(resolved, rules, observed, current).verdict, 'pass-with-deviations');
  item.issue.severity = 'blocking'; assert.equal(evaluateNative44Acceptance(resolved, rules, observed, current).verdict, 'needs-work'); delete item.issue.severity;
  observed.checks.pop(); assert.equal(evaluateNative44Acceptance(resolved, rules, observed, current).verdict, 'needs-work');
});

test('accepted minor deviations are recorded; structure, overflow and fake business can never be waived', () => {
  const { contract } = fixture(), resolved = resolve(contract), rules = policy(resolved), observed = observation(resolved);
  const presentation = resolved.requirements.find(item => item.dimension === 'presentation')!, item = observed.checks.find(item => item.requirementId === presentation.id)!;
  item.outcome = 'fail'; item.issue = { category: 'presentation', message: 'Source font license substitution.' };
  rules.acceptedDeviations.push({ requirementId: presentation.id, checkIds: [item.checkId], reason: 'User accepted the measured font substitution in this module.', acceptedBy: 'user', evidence: [ref] });
  assert.equal(evaluateNative44Acceptance(resolved, rules, observed, current).status, 'satisfied-with-deviations');
  for (const category of ['structure', 'overflow', 'fake-business', 'behavior', 'editability', 'capability'] as const) {
    item.issue.category = category; assert.equal(evaluateNative44Acceptance(resolved, rules, observed, current).verdict, 'needs-work', category);
  }
  const critical = resolved.requirements.find(item => item.capability === 'search-input')!;
  rules.acceptedDeviations.push({ requirementId: critical.id, checkIds: [critical.checks[0].id], reason: 'Cannot waive a core input with a broad cosmetic permission.', acceptedBy: 'user', evidence: [ref] });
  assert.throws(() => evaluateNative44Acceptance(resolved, rules, observed, current), /cannot be waived/);
});

test('acceptance rejects fabricated check ownership, contradictory outcomes and missing review bindings', () => {
  const { contract } = fixture(), resolved = resolve(contract), rules = policy(resolved);
  const wrong = observation(resolved); wrong.checks[0].requirementId = 'someone-else';
  assert.throws(() => evaluateNative44Acceptance(resolved, rules, wrong, current), /wrong-owner/);
  const contradictory = observation(resolved); contradictory.checks[0].issue = { category: 'overflow', message: 'Content extends outside.' };
  assert.throws(() => evaluateNative44Acceptance(resolved, rules, contradictory, current), /disagree/);
  const missing = observation(resolved) as unknown as Record<string, unknown>; delete missing.review;
  assert.throws(() => evaluateNative44Acceptance(resolved, rules, missing, current));
});

test('convergence asks to revisit the model after low gain or persistent blockers without changing acceptance', () => {
  const rounds = [10, 9.95, 9.9].map((weightedError, i) => ({ documentHash: String(i).repeat(64), blockingIssueIds: ['missing-search'], weightedError }));
  assert.equal(adviseNative44Convergence(rounds).recommendation, 'revisit-model');
  assert.equal(adviseNative44Convergence(rounds.slice(0, 2)).recommendation, 'continue');
  const { contract } = fixture(); assert.equal(evaluateNative44Acceptance(contract, policy(contract), observation(contract), current).verdict, 'needs-work');
});

test('new replica preparation writes the versioned default marker; historical original does not acquire it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-requirement-marker-'));
  try {
    const capture: NonNullable<Parameters<typeof prepareReference>[1]>['capture'] = async (_url, options) => {
      const directory = options!.referenceDir!, filename = path.join(directory, 'report.json'); await mkdir(directory, { recursive: true }); await writeFile(filename, '{}');
      return { artifactPath: filename, url: 'https://8.8.8.8/', status: 'blocked', viewports: [] } as never;
    };
    const result = await prepareReference('https://8.8.8.8/', { root, capture });
    const marker = JSON.parse(await readFile(path.join(result.jobDir, 'requirement-profile.json'), 'utf8'));
    assert.deepEqual(marker, { version: 2, kind: 'native44-requirement-profile', profile: 'source-requirements-v1', goalProfile: 'component-reference-v1' });
    const original = await prepareOriginalReference('https://8.8.8.8/', { root, capture });
    await assert.rejects(readFile(path.join(original.jobDir, 'requirement-profile.json')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('new default marker blocks missing opt-in before knowledge or authentication; old schemas remain explicit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-requirement-preauth-'));
  const program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId: 'test-task', title: 'Existing task', sourceUrl: 'https://source.example/', replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, componentCatalog: { ...ref, sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...ref, fingerprint: ref.sha256 }, targetEnvironment: { woodmart: '8.5.5', woodmartCore: '1.1.8', elementor: '3.35.4', elementorPro: '3.35.1' }, sourceFacts: sourceRef, componentPlan: ref, assetsManifest: ref, viewports: [{ name: 'desktop-wide', width: 1920, height: 1080, stage: 'desktop' }, { name: 'desktop-narrow', width: 1440, height: 1000, stage: 'desktop' }], blocks: [{ kind: 'composite', key: 'root', children: [{ kind: 'native', key: 'title', widgetType: 'heading', widgetSettings: {} }] }] };
  try {
    const job = path.join(root, 'references', 'test-task'); await mkdir(job, { recursive: true });
    await writeFile(path.join(job, 'program.json'), JSON.stringify(program));
    await writeFile(path.join(job, 'requirement-profile.json'), JSON.stringify({ version: 1, kind: 'native44-requirement-profile', profile: 'source-requirements-v1' }));
    await assert.rejects(prepareLocalTask(path.join(job, 'program.json'), root), /native44_requirement_contract_required/);
    await assert.rejects(runNative44Replica(path.join(job, 'program.json'), { root }), /native44_requirement_contract_required/);
    assert.equal(native44ProgramSchema.parse(program).requirementProfile, undefined);
    assert.equal(native44ProgramSchema.parse({ ...program, requirementProfile: 'source-requirements-v1' }).requirementProfile, 'source-requirements-v1');
    assert.equal(Native44RequirementContractSchema.safeParse({ version: 0, kind: 'native44-requirements' }).success, false);
    assert.equal(native44RequirementsJsonSchemas().requirements.type, 'object');
  } finally { await rm(root, { recursive: true, force: true }); }
});
