import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditFidelityProgram } from '../src/fidelity/check.js';
import { validateNativeProgramCSS, validateScopedNativeCSS } from '../src/fidelity/scoped-css.js';
import { preflightNativeControls, validateScopedNativeCSS as registeredCSSValidator } from '../src/fidelity/native.js';
import { buildNativeFractionCSS } from '../src/fidelity/native-fraction.js';
import type { NativeProgram } from '../src/fidelity/types.js';

const none = { status: 'not-applicable' as const, evidence: [] };
function program(css: unknown): NativeProgram {
  return { version: 1, workflow: 'block-replication', title: 'Local CSS preflight', sourceUrl: 'https://127.0.0.1/', sourceContract: { path: 'block-contract.json', sha256: 'a'.repeat(64) }, assetsManifest: { path: 'asset-manifest.json', sha256: 'b'.repeat(64) }, deviations: [], elements: [{ key: 'owned-root', type: 'container', settings: {}, children: [{ key: 'native-child', type: 'future-native-widget', settings: { custom_css: css } }] }], blocks: [{ sourceBlockId: 'source-block', rootKey: 'owned-root', presentation: 'static', bindings: [], states: { normal: none, hover: none, interaction: none } }] };
}

test('audit rejects deeply nested invalid or out-of-bound CSS before public-source checks or target configuration', async t => {
  const cache = path.resolve('D:/cloneWP/.cache'); await mkdir(cache, { recursive: true });
  const root = await mkdtemp(path.join(cache, 'local-css-audit-')), job = path.join(root, 'references', 'current-job'), filename = path.join(job, 'program.json');
  await mkdir(job, { recursive: true });
  t.after(async () => {
    const resolved = path.resolve(root), relative = path.relative(cache, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Test cleanup escaped the workspace cache');
    await rm(resolved, { recursive: true, force: true });
  });
  // Deliberately no job, evidence, assets or target credentials exist. Invalid
  // CSS must be the reported failure even before the private source URL check.
  for (const css of ['selector{z-index:999;}', 'selector{width:NaNpx;}', 'selector{top:Infinitypx;}', 'selector{transform:translateX(-Infinitypx);}', '@media(max-width:99999px){selector{color:red;}}', 'selector{position:fixed;}', 'selector{color:red;', 'body{color:red;}', 'selector{font-size:16px;}'.repeat(49)]) {
    await writeFile(filename, JSON.stringify(program(css)));
    await assert.rejects(auditFidelityProgram(filename, { root, writeAudit: false }), error => error instanceof Error && /Invalid local native custom CSS at native-child:|Non-finite native dimension rejected: native-child\.custom_css/.test(error.message));
  }
  await writeFile(filename, JSON.stringify(program('selector{z-index:10;}')));
  await assert.rejects(auditFidelityProgram(filename, { root, writeAudit: false }), /private, reserved, or internal network address/, 'valid CSS continues to the existing independent source checks');
});

test('falsey non-string styles cannot bypass the local CSS check', () => {
  for (const css of [null, false, 0, [], {}]) assert.throws(() => validateNativeProgramCSS(program(css).elements), /local stylesheet string: native-child/);
  for (const css of ['', 'selector{z-index:0;}', 'selector{z-index:10;}']) assert.doesNotThrow(() => validateNativeProgramCSS(program(css).elements));
});

test('bounded CSS is shared with the registered preflight while unknown native registrations still require live discovery', () => {
  assert.equal(registeredCSSValidator, validateScopedNativeCSS);
  const input = program(`selector .wd-nav-arrows{z-index:2;}\n@media(max-width:767px){selector .wd-nav-arrows{position:relative;}}\n${buildNativeFractionCSS()}`), before = structuredClone(input);
  assert.doesNotThrow(() => validateNativeProgramCSS(input.elements));
  assert.deepEqual(input, before);
  assert.throws(() => preflightNativeControls(input, { container: { type: 'container', class: 'Elementor\\Container', controls: {} } }), /Unregistered or non-native fidelity widget: future-native-widget/);
});
