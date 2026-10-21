import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertFidelityEnvironment, assertFidelityDraftReady, runFidelity } from '../src/fidelity/runner.js';
import type { FidelityAudit } from '../src/fidelity/types.js';

test('a review draft keeps incomplete fidelity explicit and still rejects stale or missing evidence', () => {
  const audit={passed:false,sourceCoverage:{counts:{inventories:3,required:42,bound:40,missing:2,unknown:1},issues:[{code:'scene-device-facts-unobserved',severity:'warning',message:'Touch context unknown'}]}} as FidelityAudit;
  assert.throws(()=>assertFidelityDraftReady(audit),/before target authentication/);
  assert.doesNotThrow(()=>assertFidelityDraftReady(audit,{reason:'User authorized a new draft for actual browser verification'}));
  assert.equal(audit.passed,false);
  assert.throws(()=>assertFidelityDraftReady({...audit,sourceCoverage:{...audit.sourceCoverage!,counts:{...audit.sourceCoverage!.counts,inventories:0}}},{reason:'Review'}),/before target authentication/);
  assert.throws(()=>assertFidelityDraftReady({...audit,sourceCoverage:{...audit.sourceCoverage!,issues:[{code:'source-scene-provenance-mismatch',severity:'error',message:'Changed packet'}]}},{reason:'Review'}),/before target authentication/);
});
import type { CapabilityReport } from '../src/wordpress/types.js';

const versions = { elementor: '3.33.2', elementorPro: '3.32.1', wordpress: '7.1.3', php: '8.0.30', novamira: '1.12.8' };
const responsive = { active: ['desktop','tablet','mobile'], breakpoints: { tablet: { value: 1024, direction: 'max' }, mobile: { value: 768, direction: 'max' } }, originalDuplicationMode: 'off' };
function discovery(): CapabilityReport {
  return { mode: 'legacy-verified', abilities: [], schemas: {}, versions: { ...versions }, limitations: [],
    legacySchemas: { container: { type: 'container', class: 'Elementor\\Includes\\Elements\\Container', controls: { content_width: { type: 'select', options: { full: 'Full' } } } }, 'e-n-carousel': { type: 'e-n-carousel', class: 'ElementorPro\\Modules\\NestedCarousel\\Widgets\\Nested_Carousel', controls: { slides: { type: 'nested-elements-repeater' } }, nativeChildren: { childType: 'container', repeaterKey: 'slides', titleSettingKey: 'slide_title', baseClass: 'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base', sourceSha256: 'b'.repeat(64) } } },
    sourceProof: { responsiveDevices: structuredClone(responsive), ...Object.fromEntries(['save','get_elements_data','responsiveRegistration','responsiveCSSExpansion'].map(method => [method, { sha256: 'a'.repeat(64), source: `Fixture source proof for ${method}` }])) },
  };
}
test('expanded native subset is proved with current registry and compatible versions instead of an old full-schema fingerprint', () => {
  const result = assertFidelityEnvironment(discovery(), { mode: 'legacy-verified', versions, responsiveDevices: responsive }, ['container','e-n-carousel']);
  assert.equal(result.passed, true); assert.equal(result.fullHistoricalSchemaFingerprintUsed, false);
  assert.equal(result.widgets['e-n-carousel'].nativeChildren?.sourceSha256, 'b'.repeat(64));
  assert.match(result.discoveredSubsetSha256, /^[a-f\d]{64}$/);
});
test('version, breakpoint, unavailable native type and missing actual source proof fail before draft creation', () => {
  const lock = { mode: 'legacy-verified', versions, responsiveDevices: responsive };
  const changed = discovery(); changed.versions.elementor = 'different'; assert.throws(() => assertFidelityEnvironment(changed, lock, ['container']), /version changed/);
  const breakpoints = discovery(); (breakpoints.sourceProof!.responsiveDevices as typeof responsive).breakpoints.mobile.value = 600; assert.throws(() => assertFidelityEnvironment(breakpoints, lock, ['container']), /breakpoints changed/);
  assert.throws(() => assertFidelityEnvironment(discovery(), lock, ['unregistered-carousel']), /unavailable registered/);
  const missing = discovery(); delete missing.sourceProof!.save; assert.throws(() => assertFidelityEnvironment(missing, lock, ['container']), /actual source proof/);
  const atomic = discovery(); atomic.mode = 'native-v4'; assert.throws(() => assertFidelityEnvironment(atomic, lock, ['container']), /verified legacy/);
});
test('invalid native input is rejected by the complete local audit before environment configuration or credentials', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(),'clonewp-fidelity-preauth-'));
  try {
    const job = path.join(root,'references','reference-current'); await mkdir(job,{recursive:true});
    await writeFile(path.join(job,'program.json'), JSON.stringify({ version: 1, workflow: 'block-replication', title: 'Incomplete native program', sourceUrl: 'https://public.example/' }));
    await assert.rejects(runFidelity(path.join(job,'program.json'),{root}), error => {
      const message = String(error); assert.doesNotMatch(message,/credentials|environment-lock|project\.json|ENOENT/); return /sourceContract|assetsManifest|elements/.test(message);
    });
    assert.deepEqual((await readdir(root)).sort(),['references']);
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('shared create CLI dispatches a native program to the source-block audit instead of the original brand route', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'clonewp-fidelity-dispatch-')), root = path.resolve(import.meta.dirname,'..');
  try {
    const job = path.join(directory,'references','reference-current'); await mkdir(job,{recursive:true});
    await writeFile(path.join(job,'program.json'), JSON.stringify({ workflow: 'block-replication' }));
    const loader = pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href;
    const result = await new Promise<{code:number;stdout:string;stderr:string}>(resolve => execFile(process.execPath,['--import',loader,path.join(root,'src/cli.ts'),'references/reference-current/program.json'],{cwd:directory,timeout:20_000,env:{SystemRoot:process.env.SystemRoot,TEMP:os.tmpdir(),TMP:os.tmpdir()}},(error,stdout,stderr)=>resolve({code:error?Number((error as NodeJS.ErrnoException & {code?:unknown}).code):0,stdout,stderr})));
    assert.equal(result.code,1); assert.equal(result.stdout,'');
    assert.match(result.stderr,/sourceContract|assetsManifest/); assert.doesNotMatch(result.stderr,/brand|OriginalDesign|credentials|project\.json|ENOENT/);
    assert.deepEqual((await readdir(directory)).sort(),['references']);
  } finally { await rm(directory,{recursive:true,force:true}); }
});


test('valid legacy source artifacts stop before reading target configuration or credentials when scene coverage is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-coverage-preauth-'));
  try {
    const jobDir = path.join(root, 'references', 'reference-current'); await mkdir(path.join(jobDir, 'reference'), { recursive: true });
    const { createHash } = await import('node:crypto');
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    const domBytes = JSON.stringify({ observedUrl: 'https://8.8.8.8/' });
    const reportBytes = JSON.stringify({ url: 'https://8.8.8.8/', status: 'complete', viewports: [{ name: 'desktop', width: 1200, height: 800, evidencePath: 'desktop.json' }] });
    const state = { status: 'not-applicable', evidence: [] };
    const contract = { version: 1, workflow: 'block-replication', sourceUrl: 'https://8.8.8.8/', capturedAt: new Date().toISOString(), referenceReport: { path: 'reference/report.json', sha256: digest(reportBytes) }, evidence: [{ id: 'dom', path: 'reference/desktop.json', sha256: digest(domBytes), kind: 'dom' }], tolerances: { geometryPx: 2, geometryRatio: 0, colorChannel: 1 }, blocks: [{ id: 'main', role: 'main', presentation: 'static', texts: [], assets: [], evidence: ['dom'], geometry: { desktop: { width: 1200, height: 200 } }, colors: {}, states: { normal: state, hover: state, interaction: state } }], limitations: [] };
    const manifest = { version: 1, sourceUrl: contract.sourceUrl, downloadedAt: new Date().toISOString(), assets: [] };
    const contractBytes = JSON.stringify(contract), manifestBytes = JSON.stringify(manifest);
    const program = { version: 1, workflow: 'block-replication', title: 'Local completeness guard', sourceUrl: contract.sourceUrl, sourceContract: { path: 'block-contract.json', sha256: digest(contractBytes) }, assetsManifest: { path: 'asset-manifest.json', sha256: digest(manifestBytes) }, elements: [{ key: 'main-root', type: 'container', settings: {} }], blocks: [{ sourceBlockId: 'main', rootKey: 'main-root', presentation: 'static', bindings: [], states: contract.blocks[0].states }], deviations: [] };
    await Promise.all([
      writeFile(path.join(jobDir, 'reference/desktop.json'), domBytes), writeFile(path.join(jobDir, 'reference/report.json'), reportBytes),
      writeFile(path.join(jobDir, 'block-contract.json'), contractBytes), writeFile(path.join(jobDir, 'asset-manifest.json'), manifestBytes),
      writeFile(path.join(jobDir, 'program.json'), JSON.stringify(program)),
      writeFile(path.join(jobDir, 'job.json'), JSON.stringify({ version: 1, workflow: 'block-replication', jobId: path.basename(jobDir), jobDir, url: contract.sourceUrl, status: 'awaiting-block-contract', referencePath: path.join(jobDir, 'reference/report.json'), referenceReportSha256: contract.referenceReport.sha256 })),
    ]);
    await assert.rejects(runFidelity(path.join(jobDir, 'program.json'), { root }), /Source evidence completeness requires review before target authentication/);
    assert.deepEqual((await readdir(root)).sort(), ['references']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
