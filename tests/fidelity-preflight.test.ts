import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preflightNativeControls, compileFidelity } from '../src/fidelity/native.js';
import { validateRegisteredSettings } from '../src/planning/plan.js';
import type { NativeProgram } from '../src/fidelity/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';

const file = { path: 'source.json', sha256: 'a'.repeat(64) }, state = { status: 'not-applicable' as const, evidence: [] }, states = { normal: state, hover: state, interaction: state };
function fixture() {
  const schemas: Record<string, LegacySchema> = {
    container: { type: 'container', class: 'Elementor\\Includes\\Elements\\Container', controls: { margin_tablet: { type: 'dimensions', size_units: ['px', 'custom'] }, width: { type: 'slider', size_units: ['%', 'px', 'custom'] }, layout: { type: 'select', options: { flex: 'Flex', grid: 'Grid' } }, gap: { type: 'gaps', size_units: ['px'] }, custom_css: { type: 'code' } } },
    image: { type: 'image', class: 'Elementor\\Widget_Image', controls: { image: { type: 'media' }, gallery: { type: 'gallery' } } },
    'native-slider': { type: 'native-slider', class: 'Elementor\\Modules\\NestedCarousel\\Widgets\\Nested_Carousel', controls: { rows: { type: 'nested-elements-repeater', fields: [{ name: 'title', type: 'text' }, { name: 'image', type: 'media' }] } }, nativeChildren: { childType: 'container', repeaterKey: 'rows', titleSettingKey: 'title', baseClass: 'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base', sourceSha256: 'b'.repeat(64) } },
  };
  const program: NativeProgram = { version: 1, workflow: 'block-replication', title: 'Native preflight', sourceUrl: 'https://example.com/', sourceContract: file, assetsManifest: file, elements: [{ key: 'root', type: 'container', settings: { margin_tablet: { unit: 'custom', top: 'calc(0px)', right: 'auto', bottom: '0', left: 'auto' }, width: { unit: '%', size: 100 }, gap: { unit: 'px', column: '0', row: '12' }, custom_css: 'selector{margin-left:auto;}' }, children: [{ key: 'picture', type: 'image', settings: { image: { $asset: 'original-picture' }, gallery: [{ $asset: 'gallery-picture' }] } }] }], blocks: [{ sourceBlockId: 'feature', rootKey: 'root', presentation: 'static', bindings: [], states }], deviations: [] };
  return { program, schemas };
}

test('registered preflight validates actual control types with symbolic media and no fabricated attachment IDs', () => {
  const { program, schemas } = fixture(), before = JSON.stringify(program);
  const report = preflightNativeControls(program, schemas);
  assert.equal(report.passed, true); assert.equal(report.nativeElements, 2); assert.equal(report.registeredSettings, 6);
  assert.deepEqual(report.symbolicAssets, ['gallery-picture', 'original-picture']); assert.equal(report.scopedStylesheets, 1);
  assert.equal(JSON.stringify(program), before); assert.equal(JSON.stringify(program).includes('attachmentId'), false);
});

test('invalid responsive custom dimensions fail before draft creation or media import', async () => {
  const { program, schemas } = fixture();
  (program.elements[0].settings.margin_tablet as Record<string, unknown>).top = '0px';
  const mutations: string[] = [];
  const guardedBuild = async () => { preflightNativeControls(program, schemas); mutations.push('create-draft'); mutations.push('import-media'); };
  await assert.rejects(guardedBuild(), /Invalid dimension container\.margin_tablet\.top/);
  assert.deepEqual(mutations, []);
  (program.elements[0].settings.margin_tablet as Record<string, unknown>).top = 'calc(0px)';
  await guardedBuild(); assert.deepEqual(mutations, ['create-draft', 'import-media']);
});

test('preflight refuses NaN, unsupported options, unknown controls, invalid gaps and unscoped CSS', () => {
  for (const settings of [
    { margin_tablet: { unit: 'custom', top: 'calc(NaNpx)' } },
    { layout: 'not-registered' }, { flex_shrink: 0 },
    { gap: { unit: 'px', column: 'auto', row: '10' } },
    { custom_css: 'body{color:red;}' },
  ]) { const { program, schemas } = fixture(); program.elements[0].settings = settings; assert.throws(() => preflightNativeControls(program, schemas)); }
});

test('symbolic assets are permitted only in real media controls and exact placeholder shapes', () => {
  const { schemas } = fixture();
  assert.doesNotThrow(() => validateRegisteredSettings('image', { image: { $asset: 'known' } }, schemas.image, { symbolicAssets: new Set(['known']) }));
  for (const media of [{ $asset: 'unknown' }, { $asset: 'known', id: 99 }, { id: 99, url: 'https://target.example/fake.png' }, 'https://a.example/a.png']) assert.throws(() => validateRegisteredSettings('image', { image: media }, schemas.image, { symbolicAssets: new Set(['known']) }));
  assert.throws(() => validateRegisteredSettings('container', { layout: { $asset: 'known' } }, schemas.container, { symbolicAssets: new Set(['known']) }), /Invalid setting option/);
  assert.throws(() => validateRegisteredSettings('image', { image: { $asset: 'known' } }, schemas.image), /symbolic media/);
});

test('native repeater media and child containers are checked before rendering', () => {
  const { program, schemas } = fixture(); program.elements[0].children = [{ key: 'slider', type: 'native-slider', settings: { rows: [{ _id: 'row', title: 'Existing source title', image: { $asset: 'slide-art' } }] }, children: [{ key: 'slide', type: 'container', settings: {} }] }];
  assert.deepEqual(preflightNativeControls(program, schemas).symbolicAssets, ['slide-art']);
  program.elements[0].children[0].children = []; assert.doesNotThrow(() => preflightNativeControls(program, schemas));
  program.elements[0].children[0].children = [{ key: 'bad-child', type: 'image', settings: { image: { $asset: 'slide-art' } } }];
  assert.throws(() => preflightNativeControls(program, schemas), /repeater rows/);
});

test('preflight and final compilation share dimension and registered-option semantics', () => {
  const { program, schemas } = fixture(), assets = ['original-picture', 'gallery-picture'].map((key, index) => ({ key, attachmentId: index + 1, url: `https://target.example/${key}.png`, sourceUrl: `https://example.com/${key}.png`, sha256: 'c'.repeat(64), mimeType: 'image/png' }));
  assert.doesNotThrow(() => compileFidelity(program, schemas, assets));
  (program.elements[0].settings.margin_tablet as Record<string, unknown>).top = '0px';
  assert.throws(() => preflightNativeControls(program, schemas), /Invalid dimension/);
  assert.throws(() => compileFidelity(program, schemas, assets), /Invalid dimension/);
});

test('omitted gap unit hints allow only finite spatial units while explicit registered units stay strict', () => {
  const control = { controls: { gap: { type: 'gaps' } } };
  assert.doesNotThrow(() => validateRegisteredSettings('container', { gap: { unit: 'px', column: '20', row: '20' } }, control));
  for (const gap of [{ unit: 'deg', column: '20', row: '20' }, { unit: 'px', column: 'NaN', row: '20' }]) assert.throws(() => validateRegisteredSettings('container', { gap }, control), /Invalid native gaps/);
  assert.throws(() => validateRegisteredSettings('container', { gap: { unit: 'em', column: '1', row: '1' } }, { controls: { gap: { type: 'gaps', size_units: ['px'] } } }), /Invalid native gaps/);
});
