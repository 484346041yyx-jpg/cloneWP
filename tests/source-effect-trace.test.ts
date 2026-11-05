import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertEffectFindings, checkEffectProduction, checkEffectRender, effectErrorDetails, effectLedger, projectEffectLayouts, type EffectProbe, type EffectRow } from '../src/replica-preparation/effect-trace.js';
import { verifyEffectReview } from '../src/replica-preparation/effect-review.js';
import type { FullReplicaManifest } from '../src/replica-full/types.js';
import type { PreparationSection, PreparationSectionResult } from '../src/replica-preparation/types.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';
import type { ObservationPacketV2 } from '../src/replica-v2/observation.js';

function fixture(name: string): { facts: SourceFactsV2; packets: ObservationPacketV2[] } {
  return JSON.parse(readFileSync(new URL(`./fixtures/source-effects/${name}.json`, import.meta.url), 'utf8'));
}
function load(name: string, region: string) {
  const { facts, packets } = fixture(name);
  const source = projectEffectLayouts(facts, packets, facts.snapshots[0].evidence);
  const section: PreparationSection = { key: 'demo', sourceUnitIds: [], sourceFactIds: Object.values(source.facts).filter(fact => fact.regionId === region).map(fact => fact.id), family: 'interaction', dependsOn: [], estimatedEffort: 1 };
  return { source, section };
}
function fragment(row: EffectRow, key = 'local_control'): PreparationSectionResult {
  return { key: row.section, css: '', blocks: [{ key: 'module', kind: 'native', widgetType: 'button', widgetSettings: { [key]: 'value' } }],
    effectImplementations: [{ effectId: row.id, componentKey: 'module', mechanism: 'native-control', key }] };
}
const binding = (row: EffectRow) => [{ effectId: row.id, factIds: row.factIds, ...(row.state ? { stateFactId: row.state.factId } : {}) }];
function setProperty(source: SourceFactsV2, fact: string, property: string, value: string) {
  const changed = structuredClone(source);
  (changed.facts[fact].value.style as Record<string, string>)[property] = value;
  return changed;
}

test('Wigs: derived tab paint and button icon position survive as source-owned facts', () => {
  const { source, section } = load('wigs', 'body-4');
  const ledger = effectLedger(source, [section]);
  assert.deepEqual(ledger.findings, []);
  const tab = ledger.rows.find(row => row.label === 'background-color: Shop with Confidence')!;
  assert.ok(tab);
  assert.equal(tab.expected, 'transparent');
  assert.equal(checkEffectProduction([tab], []).findings[0].stage, 'production');
  assert.equal(checkEffectProduction([tab], [{ ...fragment(tab), effectImplementations: [{ effectId: tab.id, componentKey: 'module', mechanism: 'native-control', key: 'absent' }] }]).findings[0].code, 'implementation-pointer-not-found');
  assert.deepEqual(checkEffectProduction([tab], [fragment(tab)]).findings, []);
  assert.deepEqual(checkEffectRender([tab], 'frontend', source, binding(tab)), []);
  const wrong = checkEffectRender([tab], 'elementor', setProperty(source, tab.factIds[0], 'background-color', 'rgb(97, 206, 112)'), binding(tab));
  assert.equal(wrong[0].surface, 'elementor');
  assert.equal(wrong[0].code, 'rendered-effect-different');

  const brand = load('wigs', 'body-5');
  const link = effectLedger(brand.source, [brand.section]).rows.find(row => row.label === 'label-to-icon: Shop All Belle Tress')!;
  assert.ok(link);
  assert.equal((link.expected as { order: string }).order, 'right');
  const switched = [{ effectId: link.id, factIds: [...link.factIds].reverse() }];
  assert.equal(checkEffectRender([link], 'frontend', brand.source, switched)[0].code, 'rendered-effect-different');
});

test('Vape City: a scroll-snap product rail is discovered from clipping and real card geometry', () => {
  const { source, section } = load('vapecity', 'new-arrivals');
  const ledger = effectLedger(source, [section]);
  assert.deepEqual(ledger.findings, []);
  const rail = ledger.rows.find(row => row.metric.kind === 'inline-window')!;
  assert.ok(rail);
  assert.equal((rail.expected as { fullyVisible: number }).fullyVisible, 6);
  assert.deepEqual(checkEffectRender([rail], 'elementor', source, binding(rail)), []);
  assert.deepEqual(checkEffectRender([rail], 'elementor', source, [{ effectId: rail.id, factIds: rail.factIds.slice(0, 2) }]), []);
  const shifted = structuredClone(source);
  const clip = shifted.facts[rail.factIds[0]].value.rect as { width: number };
  clip.width -= 75;
  assert.equal(checkEffectRender([rail], 'frontend', shifted, binding(rail))[0].code, 'rendered-effect-different');
  shifted.snapshots[0].viewport.clientWidth--;
  assert.equal(checkEffectRender([rail], 'elementor', shifted, binding(rail))[0].code, 'target-viewport-mismatch');
});

test('Huaqi: a new form effect needs actual capture and catches missing paint without site-specific code', () => {
  const { source, section } = load('huaqi', 'body-12');
  const field = Object.values(source.facts).find(fact => fact.regionId === 'body-12' && fact.kind === 'interaction' && (fact.value.details as { type?: string }).type === 'textarea')!;
  assert.ok(field);
  const probe: EffectProbe = { id: 'inquiry-border', section: section.key, label: 'Inquiry textarea border', factIds: [field.id], metric: { kind: 'style', property: 'border-bottom-width' } };
  const missing = effectLedger(source, [section], [{ ...probe, factIds: ['uncaptured-form-field'] }]);
  assert.equal(missing.findings[0].stage, 'capture');
  try { assertEffectFindings(missing.findings); assert.fail('capture gap passed'); }
  catch (error) { assert.equal(effectErrorDetails(error)?.findings[0].effectId, probe.id); }
  const row = effectLedger(source, [section], [probe]).rows.find(row => row.id === probe.id)!;
  assert.equal(row.expected, '1px');
  assert.equal(checkEffectRender([row], 'frontend', source, [])[0].code, 'target-evidence-missing-or-wrong-owner');
  assert.equal(checkEffectRender([row], 'frontend', setProperty(source, field.id, 'border-bottom-width', '0px'), binding(row))[0].code, 'rendered-effect-different');
  assert.deepEqual(checkEffectRender([row], 'elementor', source, binding(row)), []);
});

test('formal review cannot pass a new trace without both surfaces; an old manifest remains unchanged', async () => {
  const { source, section } = load('wigs', 'body-4');
  const row = effectLedger(source, [section]).rows[0];
  const ref = { path: 'fixture/trace.json', sha256: '0'.repeat(64) };
  const manifest = { taskId: 'task', runId: 'run' } as FullReplicaManifest;
  let reads = 0;
  const input = { manifest, pageId: 5, fingerprint: '1'.repeat(64), observedAt: new Date().toISOString(),
    evidence: undefined, base: '.', frontUrls: new Set<string>(), read: async () => {
      reads++;
      return { filename: ref.path, bytes: Buffer.from(JSON.stringify({ version: 1, kind: 'clonewp-source-effect-trace', taskId: 'task', runId: 'run', rows: [row], implementations: { [row.id]: 'module' } })) };
    } };
  await verifyEffectReview(input);
  assert.equal(reads, 0);
  await assert.rejects(verifyEffectReview({ ...input, manifest: { ...manifest, effectTrace: ref } }), error => {
    assert.equal(effectErrorDetails(error)?.findings[0].code, 'paired-frontend-elementor-evidence-required');
    return true;
  });
  assert.equal(reads, 1);
});

test('section inset review distinguishes a full-width shell from its centered inner clipping box', () => {
  const { source, section } = load('vapecity', 'new-arrivals');
  const rail = effectLedger(source, [section]).rows.find(row => row.metric.kind === 'inline-window')!;
  const inner: EffectProbe = { id: 'rail-insets', section: section.key, label: 'Content edges', factIds: rail.factIds.slice(0, 1), metric: { kind: 'inline-inset' } };
  const ledger = effectLedger(source, [section], [inner]);
  const row = ledger.rows.find(item => item.id === inner.id)!;
  assert.deepEqual(row.expected, { widthPx: 1488, leftPx: 208.5, rightPx: 208.5 });
  const shifted = structuredClone(source);
  (shifted.facts[row.factIds[0]].value.rect as { x: number }).x += 30;
  assert.equal(checkEffectRender([row], 'elementor', shifted, binding(row))[0].code, 'rendered-effect-different');
  assert.deepEqual(checkEffectRender([row], 'frontend', source, binding(row)), []);
});
