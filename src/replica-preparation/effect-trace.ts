import { z } from 'zod';
import type { ObservationPacketV2 } from '../replica-v2/observation.js';
import type { SourceFactsV2, SourceFactV2 } from '../replica-v2/source.js';
import { native44ModuleClass } from '../native44/adapters.js';
import { walkNative44 } from '../native44/types.js';
import { relationshipRect } from './section-relationships.js';
import type { PreparationSection, PreparationSectionResult } from './types.js';

const id = z.string().min(1).max(400);
export const effectRefSchema = z.object({ path: z.string().min(1).max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const metric = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('style'), property: id }).strict(),
  z.object({ kind: z.literal('attribute'), name: id }).strict(),
  z.object({ kind: z.literal('detail'), name: id }).strict(),
  z.object({ kind: z.literal('size'), axis: z.enum(['width', 'height']) }).strict(),
  z.object({ kind: z.literal('relationship') }).strict(),
  z.object({ kind: z.literal('inline-inset') }).strict(),
  z.object({ kind: z.literal('inline-window') }).strict(),
]);
export const effectProbeSchema = z.object({
  id, section: id, label: id, factIds: z.array(id).min(1).max(250), metric,
  // For interaction frames, bind a real DOM attribute to the state of the sample.
  state: z.object({ factId: id, name: id, value: id }).strict().optional(),
}).strict();
export const effectImplementationSchema = z.object({
  effectId: id, componentKey: id,
  mechanism: z.enum(['native-control', 'native-structure', 'style-binding', 'scoped-css']),
  // Actual control, child component key, style binding property or scoped CSS selector.
  key: id,
}).strict();
export type EffectProbe = z.infer<typeof effectProbeSchema>;
type Value = string | number | boolean | null | Record<string, string | number | boolean>;
type View = SourceFactsV2['snapshots'][number];
type Surface = 'frontend' | 'elementor';
export interface EffectFinding { stage: 'capture' | 'production' | 'review'; section: string; effectId: string; label: string; code: string; surface?: Surface; expected?: Value; actual?: Value }
class EffectTraceError extends Error {
  readonly details: { total: number; findings: EffectFinding[] };
  constructor(findings: EffectFinding[]) {
    super('replica_full_source_effect_trace');
    this.details = { total: findings.length, findings: findings.slice(0, 25) };
  }
}
export const effectErrorDetails = (error: unknown) => error instanceof EffectTraceError ? error.details : undefined;
export function assertEffectFindings(findings: EffectFinding[]) {
  if (findings.length) throw new EffectTraceError(findings);
}
const viewShape = (view: View['viewport']) => ({ width: view.width, height: view.height, clientWidth: view.clientWidth, devicePixelRatio: view.devicePixelRatio });
const object = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const scalar = (value: unknown): string | number | boolean | null | undefined => value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value as string | number | boolean | null : undefined;
const styleValue = (value: unknown) => typeof value === 'string' && (/^rgba\(0,\s*0,\s*0,\s*0\)$/.test(value) || value === 'transparent') ? 'transparent' : scalar(value);
const round = (value: number) => Math.round(value * 100) / 100;
const positiveRect = (fact: SourceFactV2) => fact.value.visible !== false ? relationshipRect(fact.value) : undefined;
function relationshipBox(fact: SourceFactV2) {
  if (fact.kind !== 'text') return positiveRect(fact);
  const text = object(fact.value.textLayout);
  if (fact.value.visible === false || text.status !== 'measured' || !Array.isArray(text.lines) || !text.lines.length) return;
  const lines = text.lines.map(line => relationshipRect({ rect: object(line).rect }));
  if (lines.some(line => !line)) return;
  const x = Math.min(...lines.map(line => line!.x)), y = Math.min(...lines.map(line => line!.y));
  return { x, y, width: Math.max(...lines.map(line => line!.x + line!.width)) - x, height: Math.max(...lines.map(line => line!.y + line!.height)) - y };
}
function measure(view: View, facts: SourceFactV2[], probe: EffectProbe['metric'], layouts?: Map<string, SourceFactV2>): Value | undefined {
  const first = facts[0];
  if (!first) return;
  if (probe.kind === 'attribute') return scalar(view.nodes[first.nodeId]?.attributes?.[probe.name]);
  if (probe.kind === 'style') return styleValue(object(first.value.style)[probe.property]);
  if (probe.kind === 'detail') return scalar(object(first.value.details)[probe.name]);
  if (probe.kind === 'size') return positiveRect(first)?.[probe.axis];
  const a = probe.kind === 'relationship' ? relationshipBox(first) : positiveRect(first);
  if (!a) return;
  if (probe.kind === 'inline-inset') {
    if (facts.length !== 1) return;
    return { widthPx: round(a.width), leftPx: round(a.x), rightPx: round(view.viewport.clientWidth - a.x - a.width) };
  }
  if (probe.kind === 'inline-window') {
    if (facts.length < 2 || new Set(facts.map(fact => fact.nodeId)).size !== facts.length) return;
    const parent = view.nodes[facts[1].nodeId]?.parentId;
    if (!parent || !facts.slice(1).every(fact => view.nodes[fact.nodeId]?.parentId === parent)) return;
    const ancestors = new Set<string>();
    for (let node: string | null = parent; node && !ancestors.has(node); node = view.nodes[node]?.parentId ?? null) ancestors.add(node);
    if (!ancestors.has(first.nodeId)) return;
    if (!['hidden', 'clip', 'auto', 'scroll'].includes(String(object(first.value.style)['overflow-x']))) return;
    const selected = layouts ? (view.nodes[parent]?.childIds ?? []).flatMap(nodeId => {
      const fact = layouts.get(view.id + ':' + nodeId);
      return fact && positiveRect(fact) ? [fact] : [];
    }) : facts.slice(1);
    const rects = selected.map(positiveRect);
    if (!rects.length || rects.some(rect => !rect)) return;
    let fullyVisible = 0, leftPeekPx = 0, rightPeekPx = 0;
    for (const r of rects) {
      if (!r || r.y + r.height <= a.y || r.y >= a.y + a.height) continue;
      const visible = Math.min(a.x + a.width, r.x + r.width) - Math.max(a.x, r.x);
      if (visible <= 1) continue;
      if (visible >= r.width - 1) fullyVisible++;
      else if (r.x < a.x) leftPeekPx += visible;
      else rightPeekPx += visible;
    }
    return { fullyVisible, leftPeekPx: round(leftPeekPx), rightPeekPx: round(rightPeekPx) };
  }
  if (facts.length !== 2 || first.nodeId === facts[1].nodeId) return;
  const b = relationshipBox(facts[1]);
  if (!b) return;
  if (Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)) {
    if (a.x + a.width <= b.x + 1) return { order: 'right', gapPx: round(b.x - a.x - a.width) };
    if (b.x + b.width <= a.x + 1) return { order: 'left', gapPx: round(a.x - b.x - b.width) };
  }
  if (a.y + a.height <= b.y + 1) return { order: 'below', gapPx: round(b.y - a.y - a.height) };
  if (b.y + b.height <= a.y + 1) return { order: 'above', gapPx: round(a.y - b.y - b.height) };
  return { order: 'overlap', gapPx: 0 };
}

export type EffectRow = EffectProbe & {
  snapshotId: string; viewport: ReturnType<typeof viewShape>; expected: Value; sourceScreenshot: View['screenshot'];
  sourceEvidence: SourceFactV2['evidence'][];
};
/** Keep existing frozen SourceFacts unchanged. Read subparts directly from their already verified browser packets. */
export function projectEffectLayouts(source: SourceFactsV2, packets: ObservationPacketV2[], refs: SourceFactV2['evidence'][]): SourceFactsV2 {
  const facts = { ...source.facts };
  for (const [index, packet] of packets.entries()) {
    if (packet.presentationVersion !== 1 || !refs[index]) continue;
    for (const node of Object.values(packet.nodes)) {
      const id = `${packet.snapshot.id}:layout:${node.layoutId}`;
      if (facts[id]) continue;
      facts[id] = { id, snapshotId: packet.snapshot.id, nodeId: node.id, regionId: node.regionId, kind: 'layout', evidence: refs[index], value: { ...packet.layouts[node.layoutId], style: packet.styles[node.styleId], visible: node.visible, selector: node.selector } };
    }
  }
  return { ...source, facts };
}

export function effectLedger(source: SourceFactsV2, sections: PreparationSection[], explicit: EffectProbe[] = [], additional: SourceFactsV2[] = []) {
  const findings: EffectFinding[] = [], rows: EffectRow[] = [];
  const { facts, snapshots } = source;
  const views = new Map(snapshots.map(view => [view.id, view]));
  const byNode = new Map<string, SourceFactV2[]>();
  for (const fact of Object.values(facts)) {
    const key = `${fact.snapshotId}:${fact.nodeId}`;
    const list = byNode.get(key) ?? []; list.push(fact); byNode.set(key, list);
  }
  const nodeFacts = (view: View, node: string) => byNode.get(`${view.id}:${node}`) ?? [];
  const layout = (view: View, node: string) => nodeFacts(view, node).find(fact => fact.kind === 'layout');
  const candidates: EffectProbe[] = [];
  for (const section of sections) {
    const owned = new Set(section.sourceFactIds);
    const owners = new Map(section.phoneSourceOwners?.map(owner => [owner.snapshotId, owner.nodeId]));
    const regions = new Set(section.sourceFactIds.flatMap(id => facts[id]?.kind === 'region' ? [facts[id].snapshotId + ':' + facts[id].regionId] : []));
    const within = (fact: SourceFactV2) => {
      if (owned.has(fact.id) || regions.has(fact.snapshotId + ':' + fact.regionId)) return true;
      const view = views.get(fact.snapshotId), owner = owners.get(fact.snapshotId);
      if (!owner || !view) return false;
      for (let node: string | null = fact.nodeId; node; node = view.nodes[node]?.parentId ?? null) if (node === owner) return true;
      return false;
    };
    for (const fact of Object.values(facts)) {
      if (!within(fact) || (fact.kind !== 'interaction' && fact.kind !== 'layout')) continue;
      const view = views.get(fact.snapshotId), node = view?.nodes[fact.nodeId];
      if (!view || !node) continue;
      const box = layout(view, fact.nodeId) ?? fact;
      if (!positiveRect(box)) continue;
      const label = String(object(fact.value.details).label || object(fact.value.details).text || node.selector).slice(0, 220);
      const push = (name: string, factIds: string[], probeMetric: EffectProbe['metric'], state?: EffectProbe['state']) => candidates.push({
        id: `${section.key}:${fact.id}:${name}`, section: section.key, label: `${name}: ${label}`, factIds, metric: probeMetric, ...(state ? { state } : {}),
      });
      if (fact.kind === 'layout') {
        const overflow = object(box.value.style)['overflow-x'];
        if (!['hidden', 'clip', 'auto', 'scroll'].includes(String(overflow))) continue;
        const clip = positiveRect(box)!;
        // Discover same-row tracks from actual clipping and child geometry, including
        // CSS scroll-snap rails with no recognized carousel library.
        const tracks = [node, ...node.childIds.map(id => view.nodes[id]).filter(Boolean)];
        for (const track of tracks) {
          const items = track.childIds.map(child => layout(view, child)).filter((item): item is SourceFactV2 => !!item && !!positiveRect(item));
          if (items.length < 3 || items.length >= 250) continue;
          const rects = items.map(item => positiveRect(item)!);
          const first = rects[0], sameRow = rects.every(r => Math.abs(r.y - first.y) < 4 && r.width >= 20 && r.height >= 20);
          const inline = rects.every((r, i) => !i || r.x >= rects[i - 1].x + rects[i - 1].width - 2);
          if (!sameRow || !inline || rects.at(-1)!.x + rects.at(-1)!.width <= clip.x + clip.width + 2) continue;
          push('inline-window', [box.id, ...items.map(item => item.id)], { kind: 'inline-window' });
          break;
        }
        continue;
      }
      if (node.attributes?.['aria-selected'] === 'true' && node.attributes?.['aria-controls'] && !node.attributes?.['aria-label'] && label) {
        const paint = fact.value.style ? fact : box;
        for (const property of ['background-color', 'border-bottom-width', 'after:background-color']) {
          if (property.startsWith('after:') && [undefined, 'none', 'normal'].includes(object(paint.value.style)['after:content'] as string | undefined)) continue;
          push(property, [paint.id], { kind: 'style', property }, { factId: paint.id, name: 'aria-selected', value: 'true' });
        }
      }
      if (['a', 'button'].includes(node.tag) && ['link', 'control'].includes(String(fact.value.kind))) {
        const descendants = [fact.nodeId];
        const labels: SourceFactV2[] = [], icons: SourceFactV2[] = [];
        for (let i = 0; i < descendants.length && descendants.length < 65; i++) {
          const child = descendants[i], entry = view.nodes[child];
          if (!entry || (i && ['button', 'a'].includes(entry.tag))) continue;
          if (entry.tag === 'svg') { const icon = layout(view, child); if (icon && positiveRect(icon)) icons.push(icon); continue; }
          labels.push(...nodeFacts(view, child).filter(row => row.kind === 'text' && String(row.value.text).trim() && positiveRect(row)));
          descendants.push(...entry.childIds);
        }
        if (labels.length === 1 && icons.length === 1) push('label-to-icon', [labels[0].id, icons[0].id], { kind: 'relationship' });
      }
      if (fact.value.kind === 'carousel' && Array.isArray(fact.value.itemNodeIds)) {
        // Unknown geometry should use a targeted probe on the real clipping owner, not the carousel wrapper.
        for (const name of ['slidesPerView', 'slidesPerGroup']) if (scalar(object(fact.value.details)[name]) !== undefined) push(name, [fact.id], { kind: 'detail', name });
      }
    }
  }
  const unique = new Set<string>(), measuredCandidates = new Set<string>(), automatic = new Set(candidates);
  for (const probe of [...candidates, ...explicit]) {
    if (automatic.has(probe)) {
      const signature = JSON.stringify([probe.section, probe.metric, probe.factIds, probe.state]);
      if (measuredCandidates.has(signature)) continue;
      measuredCandidates.add(signature);
    }
    const section = sections.find(item => item.key === probe.section);
    const sourceSet = [source, ...additional].find(set => probe.factIds.every(id => set.facts[id]) && (!probe.state || set.facts[probe.state.factId]));
    const sample = sourceSet && probe.factIds.map(id => sourceSet.facts[id]);
    const view = sourceSet?.snapshots.find(view => view.id === sample?.[0]?.snapshotId);
    const stateFact = probe.state ? sourceSet?.facts[probe.state.factId] : undefined;
    const checkState = !probe.state || (stateFact?.snapshotId === view?.id && view?.nodes[stateFact!.nodeId]?.attributes?.[probe.state.name] === probe.state.value);
    const ownedRegion = !!section && !!sample && sample.every(fact => section.sourceFactIds.includes(fact.id) || section.phoneSourceOwners?.some(owner => owner.snapshotId === fact.snapshotId) || section.sourceFactIds.some(id => source.facts[id]?.regionId === fact.regionId));
    const expected = view && checkState && ownedRegion && sample?.every(fact => fact.snapshotId === view.id) ? measure(view, sample, probe.metric) : undefined;
    if (unique.has(probe.id) || expected === undefined || !view || !sample) {
      findings.push({ stage: 'capture', section: probe.section, effectId: probe.id, label: probe.label, code: unique.has(probe.id) ? 'duplicate-probe' : 'source-facts-or-state-missing' });
    } else rows.push({ ...probe, expected, snapshotId: view.id, viewport: viewShape(view.viewport), sourceScreenshot: view.screenshot, sourceEvidence: [...new Map([...sample, ...(stateFact ? [stateFact] : [])].map(fact => [fact.evidence.sha256, fact.evidence])).values()] });
    unique.add(probe.id);
  }
  return { rows, findings };
}

export function checkEffectProduction(rows: EffectRow[], fragments: PreparationSectionResult[]) {
  const findings: EffectFinding[] = [], implementations: Record<string, string> = {};
  for (const row of rows) {
    const fragment = fragments.find(item => item.key === row.section);
    const bindings = fragment?.effectImplementations?.filter(binding => binding.effectId === row.id) ?? [];
    const binding = bindings[0], nodes = walkNative44(fragment?.blocks ?? []);
    const node = nodes.find(node => node.key === binding?.componentKey);
    let valid = false;
    if (node && bindings.length === 1) {
      const key = binding.key, responsive = fragment?.responsive;
      if (binding.mechanism === 'native-control') {
        const inRange = (setting: { minWidth?: number; maxWidth?: number }) => row.viewport.width >= (setting.minWidth ?? 0) && row.viewport.width <= (setting.maxWidth ?? Infinity);
        const explicitNative = [...(node.nativeStyleSettings ?? []), ...(responsive?.nativeStyleSettings?.filter(item => item.componentKey === node.key).map(item => item.setting) ?? [])].some(setting => setting.controlId === key && inRange(setting) && setting.sourceFactIds.some(id => row.factIds.includes(id)));
        const raw = { ...node.settings, ...('widgetSettings' in node ? node.widgetSettings : {}), ...(row.viewport.width < 768 ? responsive?.settings.find(item => item.componentKey === node.key)?.values : {}) };
        valid = explicitNative || Object.hasOwn(raw, key);
      }
      if (binding.mechanism === 'native-structure') valid = walkNative44([node]).some(child => child !== node && child.key === key && child.sourceFactIds?.some(id => row.factIds.includes(id)));
      if (binding.mechanism === 'style-binding') valid = row.metric.kind === 'style' && key === row.metric.property && [...(node.styleBindings ?? []), ...(responsive?.styleBindings?.filter(item => item.componentKey === node.key).map(item => item.binding) ?? [])].some(style => row.factIds.includes(style.sourceFactId) && style.properties.includes(key) && row.viewport.width >= (style.minWidth ?? 0) && row.viewport.width <= (style.maxWidth ?? Infinity));
      if (binding.mechanism === 'scoped-css') {
        const css = `${fragment?.css ?? ''}\n${responsive?.css ?? ''}`;
        // CSS namespace/validity is independently checked by normal preparation/compilation.
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const ownClasses = [native44ModuleClass(node.key), ...[node.settings?.css_classes, node.settings?._css_classes].flatMap(value => typeof value === 'string' ? value.split(/\s+/) : [])];
        valid = ownClasses.some(cls => cls && key.includes('.' + cls)) && new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{[^{}]+\\}`, 'm').test(css);
      }
    }
    if (!valid) findings.push({ stage: 'production', section: row.section, effectId: row.id, label: row.label, code: bindings.length ? 'implementation-pointer-not-found' : 'effect-not-implemented' });
    else implementations[row.id] = binding.componentKey;
  }
  return { findings, implementations };
}

const matched = (expected: Value, actual: Value) => {
  const same = (key: string, left: unknown, right: unknown) => typeof left === 'number' && typeof right === 'number' && key !== 'fullyVisible' ? Math.abs(left - right) <= 2 : left === right;
  if (expected !== null && actual !== null && typeof expected === 'object' && typeof actual === 'object') return Object.keys(expected).length === Object.keys(actual).length && Object.keys(expected).every(key => same(key, expected[key], actual[key]));
  return same('', expected, actual);
};
export const effectTargetBindingSchema = z.object({ effectId: id, factIds: z.array(id).min(1).max(250), stateFactId: id.optional() }).strict();
type TargetBinding = z.infer<typeof effectTargetBindingSchema>;
export function checkEffectRender(rows: EffectRow[], surface: Surface, target: SourceFactsV2, bindings: TargetBinding[], checkOwner?: (view: View, fact: SourceFactV2, row: EffectRow) => boolean) {
  const findings: EffectFinding[] = [];
  const views = new Map(target.snapshots.map(view => [view.id, view]));
  const layouts = new Map(Object.values(target.facts).filter(fact => fact.kind === 'layout').map(fact => [fact.snapshotId + ':' + fact.nodeId, fact]));
  const indexed = new Map<string, TargetBinding[]>();
  for (const binding of bindings) { const list = indexed.get(binding.effectId) ?? []; list.push(binding); indexed.set(binding.effectId, list); }
  for (const row of rows) {
    const entry = indexed.get(row.id), binding = entry?.[0], facts = binding?.factIds.map(id => target.facts[id]);
    const view = facts?.[0] && views.get(facts[0].snapshotId);
    const state = binding?.stateFactId && target.facts[binding.stateFactId];
    const push = (code: string, actual?: Value) => findings.push({ stage: 'review', section: row.section, effectId: row.id, label: row.label, surface, code, expected: row.expected, ...(actual === undefined ? {} : { actual }) });
    if (entry?.length !== 1 || !view || !facts?.every(fact => fact?.snapshotId === view.id) || (checkOwner && !facts.every(fact => checkOwner(view, fact, row)))) push('target-evidence-missing-or-wrong-owner');
    else if (Object.entries(viewShape(view.viewport)).some(([key, value]) => row.viewport[key as keyof typeof row.viewport] !== value)) push('target-viewport-mismatch');
    else if (row.state && (!state || state.snapshotId !== view.id || (checkOwner && !checkOwner(view, state, row)) || view.nodes[state.nodeId]?.attributes?.[row.state.name] !== row.state.value)) push('target-state-not-observed');
    else {
      const actual = measure(view, facts, row.metric, layouts);
      if (actual === undefined) push('target-effect-unmeasurable');
      else if (row.metric.kind === 'detail' ? row.expected !== actual : !matched(row.expected, actual)) push('rendered-effect-different', actual);
    }
  }
  return findings;
}
