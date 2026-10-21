import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNativeCapabilityPlan, collectNativeRequirements, planNativeCapabilities, type NativeAdapter } from '../src/fidelity/capability-plan.js';
import type { BlockContract, NativeProgram } from '../src/fidelity/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';

const state = { status: 'not-applicable' as const, evidence: [] };
function fixture(roles: Array<'previous' | 'next' | 'fraction' | 'dot' | 'autoplay'> = ['previous', 'next', 'fraction']) {
  const rect = { x: 0, y: 0, width: 20, height: 20 }, evidence = ['dom'];
  const contract: BlockContract = { version: 1, workflow: 'block-replication', sourceUrl: 'https://reference.example/', capturedAt: new Date().toISOString(), referenceReport: { path: 'reference/report.json', sha256: 'a'.repeat(64) }, evidence: [{ id: 'dom', path: 'reference/desktop.json', sha256: 'a'.repeat(64), kind: 'dom' }], tolerances: { geometryPx: 20, geometryRatio: .1, colorChannel: 3 }, blocks: [{ id: 'offers', role: 'offers', presentation: 'carousel', texts: [], assets: [], evidence, geometry: { desktop: { width: 1000, height: 300 } }, colors: {}, states: { normal: state, hover: state, interaction: state }, presentationDetails: { version: 1, viewports: { desktop: { status: 'observed', width: 1000, evidence, regions: [{ id: 'track', sourceNodeId: '.track', rect, visible: true, evidence }], controlGroups: [{ id: 'controls', ownerId: 'track', sourceNodeId: '.controls', rect, visible: true, evidence, layout: 'row', pagination: roles.includes('fraction') ? 'fraction' : 'bullets', controls: roles.map((role, i) => ({ id: `control-${i}`, role, sourceNodeId: `.control-${i}`, rect, visible: true, evidence })) }], relations: [], media: [] } } } }], limitations: [] };
  const schemas: Record<string, LegacySchema> = { 'nested-carousel': { type: 'nested-carousel', class: 'ElementorPro\\Modules\\NestedCarousel\\Widgets\\Nested_Carousel', controls: { carousel_items: { type: 'nested-elements-repeater' }, arrows: { type: 'switcher', default: 'yes' }, pagination: { type: 'select', default: 'bullets', options: { fraction: 'Fraction', bullets: 'Dots' } } } } };
  const program: NativeProgram = { version: 1, workflow: 'block-replication', title: 'Test', sourceUrl: contract.sourceUrl, sourceContract: contract.referenceReport, assetsManifest: contract.referenceReport, elements: [{ key: 'root', type: 'container', settings: {}, children: [{ key: 'carousel', type: 'nested-carousel', settings: { pagination: 'fraction' } }] }], blocks: [{ sourceBlockId: 'offers', rootKey: 'root', presentation: 'carousel', bindings: [], presentationBindings: [{ id: 'track', elementKey: 'carousel' }], states: { normal: state, hover: state, interaction: state } }], deviations: [] };
  return { contract, schemas, program };
}
test('native planning checks complete source feature bundles before compilation, not widget name alone', () => {
  const { contract, schemas, program } = fixture();
  const plan = planNativeCapabilities(contract, schemas, program);
  assert.equal(plan.passed, true); assert.equal(plan.renderVerificationRequired, true);
  program.elements[0].children![0].settings.pagination = 'bullets';
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, false);
  assert.throws(() => assertNativeCapabilityPlan(planNativeCapabilities(contract, schemas, program)), /before target writes.*fraction/);
});
test('autoplay configuration is not a user-operable play/pause control and static fraction text is not a carousel', () => {
  const { contract, schemas, program } = fixture(['previous', 'next', 'autoplay']);
  schemas['nested-carousel'].controls.autoplay = { type: 'switcher', default: 'yes' };
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, false);
  const second = fixture(); second.program.elements[0].children = [{ key: 'fraction-text', type: 'heading', settings: { title: '1 / 6' } }];
  assert.equal(planNativeCapabilities(second.contract, second.schemas, second.program).passed, false);
});
test('adapter capabilities cannot be inferred from labels or a registered but wrong native class', () => {
  const { contract, schemas } = fixture(); schemas['nested-carousel'].class = 'Other\\Lookalike';
  assert.equal(planNativeCapabilities(contract, schemas).passed, false);
});
test('new native adapters are selected by feature bundle without source domain/block IDs', () => {
  const { contract, schemas, program } = fixture(); const custom: NativeAdapter = { id: 'verified-other-carousel', widgetType: 'native-other', className: 'Vendor\\NativeCarousel', features: { carousel: { controls: [{ key: 'items', type: 'repeater' }] }, 'controls.arrows': { controls: [{ key: 'buttons', value: 'on' }] }, 'controls.fraction': { controls: [{ key: 'pager', value: 'fraction' }] } } };
  schemas['native-other'] = { type: 'native-other', class: custom.className, controls: { items: { type: 'repeater' }, buttons: { type: 'select', options: { on: 'On' } }, pager: { type: 'select', options: { fraction: 'Fraction' } } } };
  program.elements[0].children![0] = { key: 'carousel', type: 'native-other', settings: { buttons: 'on', pager: 'fraction' } };
  const result = planNativeCapabilities(contract, schemas, program, [custom]); assert.equal(result.passed, true); assert.equal(result.requirements[0].selected?.adapter, custom.id);
});
test('source carousel with no observed control model cannot silently use component defaults', () => {
  const { contract, schemas } = fixture(); delete contract.blocks[0].presentationDetails;
  assert.equal(planNativeCapabilities(contract, schemas).passed, false);
});
test('selected adapters must satisfy prerequisites as well as advertised feature controls', () => {
  const { contract, schemas, program } = fixture();
  const adapter: NativeAdapter = { id: 'guarded', widgetType: 'nested-carousel', className: schemas['nested-carousel'].class, prerequisites: { controls: [{ key: 'required_render_branch', value: 'native' }] }, features: { carousel: { controls: [{ key: 'carousel_items' }] }, 'controls.arrows': { controls: [{ key: 'arrows', value: 'yes' }] }, 'controls.fraction': { controls: [{ key: 'pagination', value: 'fraction' }] } } };
  assert.equal(planNativeCapabilities(contract, schemas, program, [adapter]).passed, false);
});
test('observed disabled autoplay cannot borrow an enabled native default', () => {
  const { contract, schemas, program } = fixture();
  contract.blocks[0].states.interaction = { status: 'observed', evidence: ['dom'], properties: { autoplay: false } };
  schemas['nested-carousel'].controls.autoplay = { type: 'switcher', default: 'yes', options: { yes: 'On', no: 'Off' } };
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, false);
  program.elements[0].children![0].settings.autoplay = 'no';
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, true);
});
test('a source owner cannot borrow an unrelated sibling carousel or pick one of multiple candidates', () => {
  const { contract, schemas, program } = fixture();
  program.blocks[0].presentationBindings![0].elementKey = 'missing-owner';
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, false);
  program.blocks[0].presentationBindings![0].elementKey = 'root';
  program.elements[0].children!.push({ ...structuredClone(program.elements[0].children![0]), key: 'other-carousel' });
  assert.ok(planNativeCapabilities(contract, schemas, program).gaps.some(gap => gap.code === 'native-owner-ambiguous'));
});
test('responsive registered controls respect tablet inheritance and reject unknown probe device mapping', () => {
  const { contract, schemas, program } = fixture();
  const view = contract.blocks[0].presentationDetails!.viewports.desktop;
  contract.blocks[0].geometry = { mobile: { width: 390, height: 300 } };
  contract.blocks[0].presentationDetails!.viewports = { mobile: view };
  const control = schemas['nested-carousel'].controls.pagination; control.responsive = { devices: ['desktop', 'tablet', 'mobile'] };
  program.elements[0].children![0].settings.pagination = 'bullets'; program.elements[0].children![0].settings.pagination_tablet = 'fraction';
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, true);
  contract.blocks[0].geometry = { 'mobile-w399': { width: 399, height: 300 } }; contract.blocks[0].presentationDetails!.viewports = { 'mobile-w399': view };
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, false);
});
test('observed absent arrows and pagination require native off controls rather than enabled defaults', () => {
  const { contract, schemas, program } = fixture(['previous', 'next']);
  const group = contract.blocks[0].presentationDetails!.viewports.desktop.controlGroups[0];
  group.controls.forEach(control => { control.visible = false; }); group.pagination = 'none';
  schemas['nested-carousel'].controls.pagination.options![''] = 'None';
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, false);
  program.elements[0].children![0].settings.arrows = ''; program.elements[0].children![0].settings.pagination = '';
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, true);
});
test('a switcher with a custom registered return value cannot prove the yes rendering branch', () => {
  const { contract, schemas, program } = fixture();
  schemas['nested-carousel'].controls.arrows = { type: 'switcher', default: 'disabled', return_value: 'enabled' };
  program.elements[0].children![0].settings.arrows = 'yes';
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, false);
});
test('different interaction owners cannot inherit one block-global autoplay flag', () => {
  const { contract, schemas, program } = fixture();
  const view = contract.blocks[0].presentationDetails!.viewports.desktop;
  view.controlGroups.push({ ...structuredClone(view.controlGroups[0]), id: 'other-controls', ownerId: 'other-track' });
  contract.blocks[0].states.interaction = { status: 'observed', evidence: ['dom'], properties: { autoplay: false } };
  assert.ok(planNativeCapabilities(contract, schemas, program).gaps.some(gap => gap.code === 'source-owner-behavior-ambiguous'));
});
test('probe widths use the actual registered native breakpoints rather than guessed device-name suffixes', () => {
  const { contract, schemas, program } = fixture();
  const view = contract.blocks[0].presentationDetails!.viewports.desktop; view.width = 399;
  contract.blocks[0].geometry = { 'phone-w399': { width: 399, height: 300 } }; contract.blocks[0].presentationDetails!.viewports = { 'phone-w399': view };
  schemas['nested-carousel'].controls.pagination.responsive = { devices: ['desktop', 'tablet', 'mobile'] };
  program.elements[0].children![0].settings.pagination = 'bullets'; program.elements[0].children![0].settings.pagination_mobile = 'fraction';
  assert.equal(planNativeCapabilities(contract, schemas, program, undefined, { active: ['desktop','tablet','mobile'], breakpoints: { tablet: { value: 1024, direction: 'max' }, mobile: { value: 768, direction: 'max' } } }).passed, true);
});

test('responsive visual absence uses actual registered scoped native styling at the observed width and rejects overrides', () => {
  const { contract, schemas, program } = fixture(['previous', 'next']);
  const view = contract.blocks[0].presentationDetails!.viewports.desktop; view.width = 390;
  view.controlGroups[0].controls.forEach(control => { control.visible = false; });
  view.controlGroups[0].pagination = 'bullets';
  schemas['nested-carousel'].controls.custom_css = { type: 'code' };
  program.elements[0].children![0].settings = { arrows: 'yes', pagination: 'bullets', custom_css: '@media(max-width:767px){selector .elementor-swiper-button{display:none;}}' };
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, true);
  view.width = 900;
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, false);
  view.width = 390;
  program.elements[0].children![0].settings.custom_css += '\nselector .elementor-swiper-button-next{display:flex;}';
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, false);
  program.elements[0].children![0].settings.custom_css = '@media(max-width:767px){selector .foreign-arrow{display:none;}}';
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, false);
});

test('explicit review draft may render a uniquely mapped native carousel with only the named play/pause gap, without granting pass', () => {
  const { contract, schemas, program } = fixture(['previous', 'next', 'autoplay']);
  program.elements[0].children![0].settings.pagination = 'bullets';
  const plan = planNativeCapabilities(contract, schemas, program);
  assert.equal(plan.passed, false); assert.deepEqual(plan.requirements[0].selected?.missing, ['controls.autoplay-toggle']);
  assert.throws(() => assertNativeCapabilityPlan(plan), /before target writes/);
  assert.doesNotThrow(() => assertNativeCapabilityPlan(plan, { reviewDraft: true }));
  assert.equal(plan.passed, false);
  program.elements[0].children![0].settings.pagination = 'fraction';
  assert.throws(() => assertNativeCapabilityPlan(planNativeCapabilities(contract, schemas, program), { reviewDraft: true }), /before target writes/);
});

test('separate arrows and fraction groups on the same proved owner form one coherent feature bundle', () => {
  const { contract, schemas, program } = fixture();
  const view = contract.blocks[0].presentationDetails!.viewports.desktop, original = view.controlGroups[0];
  view.controlGroups = [
    { ...structuredClone(original), id: 'arrows', pagination: 'none', controls: original.controls.filter(control => control.role !== 'fraction') },
    { ...structuredClone(original), id: 'pager', controls: original.controls.filter(control => control.role === 'fraction') },
  ];
  contract.blocks[0].states.interaction = { status: 'observed', evidence: ['dom'], properties: { autoplay: false } };
  schemas['nested-carousel'].controls.autoplay = { type: 'switcher', default: 'yes', options: { yes: 'On', no: 'Off' } };
  program.elements[0].children![0].settings.autoplay = 'no';
  const requirements = collectNativeRequirements(contract);
  assert.equal(requirements.length, 1); assert.equal(requirements[0].ownerId, 'track');
  assert.ok(requirements[0].features.includes('controls.arrows')); assert.ok(requirements[0].features.includes('controls.fraction'));
  assert.ok(!requirements[0].features.includes('controls.no-pagination')); assert.equal(requirements[0].ambiguousBehavior, undefined);
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, true);
});

test('one owner with simultaneous fraction and dot groups requires both forms without inventing pagination absence', () => {
  const { contract } = fixture(['fraction']);
  const view = contract.blocks[0].presentationDetails!.viewports.desktop, group = view.controlGroups[0];
  view.controlGroups.push({ ...structuredClone(group), id: 'dots', pagination: 'bullets', controls: [{ ...structuredClone(group.controls[0]), id: 'dot-1', role: 'dot' }] });
  const requirements = collectNativeRequirements(contract);
  assert.equal(requirements.length, 1); assert.ok(requirements[0].features.includes('controls.fraction')); assert.ok(requirements[0].features.includes('controls.bullets'));
  assert.ok(!requirements[0].features.includes('controls.no-pagination'));
});

test('arrow absence is owner-wide only when every split group explicitly proves both arrows absent', () => {
  const { contract } = fixture();
  const view = contract.blocks[0].presentationDetails!.viewports.desktop, original = view.controlGroups[0];
  view.controlGroups = [
    { ...structuredClone(original), id: 'arrows', pagination: 'none', controls: original.controls.filter(control => control.role !== 'fraction').map(control => ({ ...control, visible: false })) },
    { ...structuredClone(original), id: 'pager', controls: original.controls.filter(control => control.role === 'fraction') },
  ];
  assert.ok(!collectNativeRequirements(contract)[0].features.includes('controls.no-arrows'));
  view.controlGroups[1].absentControls = ['previous', 'next'];
  assert.ok(collectNativeRequirements(contract)[0].features.includes('controls.no-arrows'));
  view.controlGroups[0].controls[0].visible = true;
  assert.ok(collectNativeRequirements(contract)[0].features.includes('controls.arrows'));
  assert.ok(!collectNativeRequirements(contract)[0].features.includes('controls.no-arrows'));
});

test('distinct engine owners keep separate requirements and cannot inherit one block-global autoplay value', () => {
  const { contract } = fixture();
  const view = contract.blocks[0].presentationDetails!.viewports.desktop;
  view.controlGroups.push({ ...structuredClone(view.controlGroups[0]), id: 'second-engine-controls', ownerId: 'different-track' });
  contract.blocks[0].states.interaction = { status: 'observed', evidence: ['dom'], properties: { autoplay: false } };
  const requirements = collectNativeRequirements(contract);
  assert.equal(requirements.length, 2); assert.deepEqual(requirements.map(requirement => requirement.ownerId), ['track', 'different-track']);
  assert.ok(requirements.every(requirement => requirement.ambiguousBehavior === true));
});

test('split controls merge consistent per-owner behavior but conflicting observations remain a named blocker', () => {
  const { contract, schemas, program } = fixture();
  const view = contract.blocks[0].presentationDetails!.viewports.desktop, original = view.controlGroups[0];
  view.controlGroups = [
    { ...structuredClone(original), id: 'arrows', pagination: 'none', behavior: { autoplay: false }, controls: original.controls.filter(control => control.role !== 'fraction') },
    { ...structuredClone(original), id: 'pager', behavior: { autoplay: false }, controls: original.controls.filter(control => control.role === 'fraction') },
  ];
  schemas['nested-carousel'].controls.autoplay = { type: 'switcher', default: 'no', options: { yes: 'On', no: 'Off' } };
  assert.equal(planNativeCapabilities(contract, schemas, program).passed, true);
  view.controlGroups[1].behavior = { autoplay: true };
  assert.ok(planNativeCapabilities(contract, schemas, program).gaps.some(gap => gap.code === 'source-owner-behavior-ambiguous'));
});
