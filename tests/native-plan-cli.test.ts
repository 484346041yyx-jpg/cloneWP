import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { createOfflineNativePlan, parseNativePlanArguments, nativePlanConsoleOutput } from '../src/native-plan-cli.js';
import { readObservationDirectoryV2, observationCountsV2, type ObservationPacketV2 } from '../src/replica-v2/observation.js';
import { buildSourceFactsV2 } from '../src/replica-v2/source.js';
import type { ProgramV2 } from '../src/replica-v2/types.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const projectRoot = path.resolve(process.cwd());
const base = path.join(projectRoot, '.cache', 'native-plan-tests');
const json = async (filename: string, value: unknown) => { const bytes = JSON.stringify(value, null, 2) + '\n'; await writeFile(filename, bytes); return { path: filename, sha256: hash(bytes) }; };
const schemas = {
  container: { type: 'container', class: 'Elementor\\Container', controls: {} },
  heading: { type: 'heading', class: 'Elementor\\Widget_Heading', controls: { title: { type: 'textarea' } } },
  wd_products: { type: 'wd_products', class: 'XTS\\Elementor\\Products', controls: { post_type: { type: 'select', options: { product: 'Product', ids: 'IDs' } }, include: { type: 'wd_autocomplete' }, items_per_page: { type: 'number' }, offset: { type: 'number' }, orderby: { type: 'select', options: { date: 'Date' } }, order: { type: 'select', options: { DESC: 'DESC' } } } },
};
async function fixture() {
  await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'case-'));
  const job = path.join(root, 'references', 'current'), config = path.join(root, 'config');
  await mkdir(job, { recursive: true }); await mkdir(config);
  await json(path.join(config, 'environment-lock.json'), { mode: 'legacy-verified', versions: { elementor: '3.33.2' } });
  await json(path.join(config, 'project.json'), { targetUrl: 'https://target.example/' });
  const registry = path.join(root, 'registry.json');
  await json(registry, { mode: 'legacy-verified', legacySchemas: schemas, versions: { elementor: '3.33.2' }, sourceProof: Object.fromEntries(['save', 'get_elements_data', 'responsiveRegistration', 'responsiveCSSExpansion'].map(name => [name, { sha256: 'a'.repeat(64), source: `Actual fixture ${name} source` }])) });
  return { root, job, registry, cleanup: async () => { const relative = path.relative(base, root); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Unsafe fixture cleanup'); await rm(root, { recursive: true, force: true }); } };
}
async function v2(f: Awaited<ReturnType<typeof fixture>>, product = false) {
  const evidenceDir = path.join(f.job, 'reference'); await mkdir(evidenceDir);
  const screenshot = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#fff' } }).png().toBuffer(); await writeFile(path.join(evidenceDir, 'desktop.png'), screenshot);
  const layout = { id: 'layout', rect: { x: 0, y: 0, width: 640, height: 480 }, contentRect: { x: 0, y: 0, width: 640, height: 480 }, padding: [0, 0, 0, 0] as [number, number, number, number], margin: [0, 0, 0, 0] as [number, number, number, number], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'column', flowIndex: 0 };
  const packet: ObservationPacketV2 = { version: 2, kind: 'observation-packet', snapshot: { id: 'desktop-scene', url: 'https://8.8.8.8/', title: 'A normal public storefront', capturedAt: '2026-10-15T00:00:00.000Z', viewport: { name: 'desktop', width: 640, height: 480, clientWidth: 640, scrollbarWidth: 0, devicePixelRatio: 1 }, pageHeight: 480, screenshot: { path: 'desktop.png', sha256: hash(screenshot), width: 640, height: 480 } }, nodes: { root: { id: 'root', parentId: null, childIds: [], regionId: 'region', tag: 'header', selector: '#root', styleId: 'style', layoutId: 'layout', visible: true, attributes: {} } }, regions: [{ id: 'region', nodeId: 'root', contentNodeId: 'root', role: 'header', order: 0, gapBefore: 0 }], texts: { copy: { id: 'copy', nodeId: 'root', regionId: 'region', text: 'Complete observed storefront wording for offline planning', kind: 'heading', level: 2 } }, styles: { style: { display: 'block' } }, layouts: { layout }, resources: {}, usages: {}, interactions: {}, gaps: [] };
  const packetFile = await json(path.join(evidenceDir, 'packet.json'), packet);
  await json(path.join(evidenceDir, 'observation-manifest.json'), { version: 2, kind: 'observation-manifest', sourceUrl: packet.snapshot.url, provenance: { method: 'public-capture', observer: 'playwright', browser: 'chromium' }, packets: [{ path: 'packet.json', sha256: packetFile.sha256, snapshotId: packet.snapshot.id, regionIds: ['region'], counts: observationCountsV2(packet), dependencies: [] }], screenshots: [{ path: 'desktop.png', sha256: hash(screenshot), snapshotId: packet.snapshot.id }] });
  const facts = buildSourceFactsV2(await readObservationDirectoryV2(evidenceDir)), factsRef = await json(path.join(f.job, 'source-facts.json'), facts);
  const planRef = await json(path.join(f.job, 'component-plan.json'), { version: 2, kind: 'component-plan', sourceFacts: factsRef, desktopSnapshotId: 'desktop-scene', components: [{ id: 'header', parentId: null, role: 'header', renderer: product ? 'products' : 'native', editability: product ? 'woocommerce' : 'controls', sourceRegionIds: ['region'], variants: [{ snapshotId: 'desktop-scene', nodeIds: ['root'], visible: true }], firstFold: true }], requirements: Object.values(facts.facts).map((fact, index) => ({ id: `requirement-${index}`, factIds: [fact.id], componentId: 'header', disposition: product && fact.kind === 'text' ? 'adapt' : 'preserve', rule: product && fact.kind === 'text' ? 'Replace source catalog fields with frozen target WooCommerce records and independent actual query checks.' : 'Verify current observed component', verification: fact.kind === 'text' && !product ? { kind: 'text', selector: '.header .elementor-heading-title', expected: { text: fact.value.text, visible: true } } : { kind: 'presence', selector: '.header', expected: true } })) });
  const assetsRef = await json(path.join(f.job, 'asset-manifest.json'), { version: 2, assets: [] });
  const program: ProgramV2 = { version: 2, workflow: 'block-replication', taskId: 'fixture-job', title: 'Fixture', sourceUrl: packet.snapshot.url, sourceFacts: factsRef, componentPlan: planRef, assetsManifest: assetsRef, viewports: [{ name: 'desktop', width: 640, height: 480, stage: 'desktop' }], blocks: [product ? { key: 'header', kind: 'native-products', widgetType: 'wd_products', widgetSettings: {}, query: { count: 1, offset: 0, evidence: ['catalog-fixture'] } } : { key: 'header', kind: 'native', widgetType: 'heading', widgetSettings: { title: packet.texts.copy.text } }] };
  await json(path.join(f.job, 'program.json'), program); return program;
}

test('design:plan parser supports explicit v2 stage/catalog and rejects ambiguous arguments', () => {
  assert.deepEqual(parseNativePlanArguments(['references/a', 'registry.json']), { job: 'references/a', registry: 'registry.json' });
  assert.deepEqual(parseNativePlanArguments(['references/a', 'registry.json', '--stage', 'responsive', '--catalog', 'catalog.json']), { job: 'references/a', registry: 'registry.json', stage: 'responsive', catalog: 'catalog.json' });
  for (const args of [[], ['a'], ['a', 'b', 'c'], ['a', 'b', '--stage', 'bad'], ['a', 'b', '--stage', 'desktop', '--stage', 'final'], ['a', 'b', '--catalog', 'https://target.example/'], ['--other', 'a']]) assert.equal(parseNativePlanArguments(args), undefined);
});

test('historical v1 CLI keeps its capability-plan path and does not gain v2 flags', async () => {
  const f = await fixture();
  try {
    const state = { status: 'not-applicable', evidence: [] };
    await json(path.join(f.job, 'block-contract.json'), { version: 1, workflow: 'block-replication', sourceUrl: 'https://source.example/', capturedAt: '2026-10-15T00:00:00.000Z', referenceReport: { path: 'report.json', sha256: 'b'.repeat(64) }, evidence: [{ id: 'dom', path: 'desktop.json', sha256: 'c'.repeat(64), kind: 'dom' }], tolerances: { geometryPx: 10, geometryRatio: .1, colorChannel: 2 }, blocks: [{ id: 'header', role: 'header', presentation: 'static', texts: [], assets: [], evidence: ['dom'], geometry: { desktop: { width: 640, height: 480 } }, colors: {}, states: { normal: state, hover: state, interaction: state } }], limitations: [] });
    const result = await createOfflineNativePlan({ job: f.job, registry: f.registry }, f.root);
    assert.equal(result.plan.version, 1); assert.equal(result.resultFile, path.join(f.job, 'native-capability-plan.json')); assert.equal(result.plan.passed, true);
    await assert.rejects(createOfflineNativePlan({ job: f.job, registry: f.registry, stage: 'desktop' }, f.root), /version 2/);
  } finally { await f.cleanup(); }
});

test('v2 offline CLI validates actual source bytes and registry controls without credentials', async () => {
  const f = await fixture();
  try {
    await v2(f); const result = await createOfflineNativePlan({ job: f.job, registry: f.registry }, f.root);
    assert.equal(result.plan.version, 2); assert.equal(result.plan.passed, true); assert.equal(result.resultFile, path.join(f.job, 'native-capability-plan-desktop.json'));
    const persisted = JSON.parse(await readFile(result.resultFile, 'utf8')); assert.equal(persisted.stage, 'desktop'); assert.equal(persisted.wholeTaskComplete, false); assert.equal(persisted.liveRediscoveryRequired, true); assert.deepEqual(persisted.usedTypes.sort(), ['container', 'heading']);
    const summary = nativePlanConsoleOutput(result); assert.equal(summary.version, 2); assert.ok(!('components' in summary)); assert.ok(!('symbolicAssets' in summary)); assert.ok('counts' in summary); assert.equal(persisted.components.length, 1);
    await writeFile(path.join(f.job, 'reference', 'packet.json'), '{}');
    await assert.rejects(createOfflineNativePlan({ job: f.job, registry: f.registry }, f.root), /hash/);
  } finally { await f.cleanup(); }
});

test('v2 product planning requires saved real target catalog and rejects foreign origins', async () => {
  const f = await fixture();
  try {
    await v2(f, true); await assert.rejects(createOfflineNativePlan({ job: f.job, registry: f.registry }, f.root), /--catalog/);
    const catalog = path.join(f.root, 'catalog.json'); await json(catalog, { targetOrigin: 'https://target.example', evidence: ['actual-catalog-read.json'], products: [{ id: 51, name: 'Target product', permalink: 'https://target.example/p/51', imageUrl: 'https://target.example/uploads/51.png' }] });
    const result = await createOfflineNativePlan({ job: f.job, registry: f.registry, catalog }, f.root); assert.equal(result.plan.version, 2); assert.equal(result.plan.passed, true);
    await json(catalog, { targetOrigin: 'https://foreign.example', evidence: ['actual-catalog-read.json'], products: [] });
    await assert.rejects(createOfflineNativePlan({ job: f.job, registry: f.registry, catalog }, f.root), /actual configured target/);
  } finally { await f.cleanup(); }
});

test('actual CLI rejects invalid arguments with usage exit code before reading credentials', () => {
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(projectRoot, 'src', 'native-plan-cli.ts'), 'references/a', 'registry.json', '--stage', 'invalid'], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(result.status, 2); assert.match(result.stderr, /Usage/); assert.doesNotMatch(result.stderr, /credentials/);
});
