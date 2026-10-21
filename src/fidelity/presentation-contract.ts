import type { BlockContract, NativeElement, NativeProgram } from './types.js';

/** Coordinates are relative to this source block, never to the whole document. */
export interface PresentationRect { x: number; y: number; width: number; height: number }
export interface PresentationPaint {
  color?: string; backgroundColor?: string; borderColor?: string; borderWidth?: number;
  borderRadius?: number; opacity?: number; fontSize?: number; lineHeight?: number;
  fontWeight?: string; fontFamily?: string; textAlign?: string; boxShadow?: string;
}
export interface PresentationRegion {
  id: string; sourceNodeId: string; evidence: string[]; rect: PresentationRect;
  visible: boolean; paint?: PresentationPaint; lineCount?: number; maxClippedRatio?: number;
  /** Tight, role-specific limits are independent of the whole-block tolerance. */
  geometryRole?: 'control' | 'content' | 'card' | 'slot'; tolerancePx?: number;
  /** A measured baseline in block-relative coordinates, never an inferred box center. */
  baseline?: number;
}
export interface PresentationGlyph {
  kind: 'svg' | 'pseudo' | 'image' | 'text' | 'none'; signature?: string;
  content?: string; fontFamily?: string; width?: number; height?: number; stroke?: string; fill?: string;
}
export interface PresentationControl extends PresentationRegion {
  role: 'previous' | 'next' | 'fraction' | 'dot' | 'autoplay';
  disabled?: boolean; active?: boolean; text?: string; textMatch?: 'exact' | 'fraction'; glyph?: PresentationGlyph;
  fractionTotal?: 'source' | 'target-query';
}
export interface PresentationControlGroup extends PresentationRegion {
  ownerId: string; layout: 'row' | 'column' | 'overlay' | 'separate';
  /** Observed behavior belongs to this exact interaction owner, not unrelated sibling sliders. */
  behavior?: { autoplay?: boolean; loop?: boolean; pauseOnHover?: boolean };
  pagination: 'fraction' | 'bullets' | 'none'; controls: PresentationControl[];
  stateSynchronized?: boolean; activePaint?: PresentationPaint; inactivePaint?: PresentationPaint;
  /** Explicit visual absence must be proved inside the unique native component owner. */
  absentControls?: PresentationControl['role'][];
  /** Explicit cardinality is required when the source count is dynamically replaced. */
  cardinality?: Partial<Record<PresentationControl['role'], number>>;
}
export interface PresentationMedia extends PresentationRegion {
  mode: 'image' | 'background'; fit?: string; objectPosition?: string;
  aspectRatio?: number; maxClippedRatio?: number;
  assetKey?: string; sourceURL?: string; assetSha256?: string;
}
export interface PresentationRelation {
  id: string; kind: 'contains' | 'outside' | 'non-overlap' | 'same-row' | 'ordered-before' | 'align' | 'attach' | 'fill' | 'center' | 'baseline' | 'gap' | 'owned-by';
  from: string; to: string; tolerancePx?: number; evidence: string[];
  axis?: 'x' | 'y' | 'both'; edge?: 'start' | 'end'; valuePx?: number;
}
export type CatalogSlotRole = 'image' | 'name' | 'rating' | 'price' | 'badge';
export interface CatalogTemplateSlot {
  role: CatalogSlotRole; rect: PresentationRect; visible: boolean; paint?: PresentationPaint;
  fit?: string; objectPosition?: string; maxLines?: number; overflow?: string;
  /** Dynamic copy can change painted text height; its allocated slot remains measured. */
  heightMode?: 'fixed' | 'content'; maxHeight?: number;
  /** Allocated source role region, including measured margins, rather than text glyph width. */
  geometryBasis?: 'allocation';
}
/** One physically visible source card template. All slot coordinates are card-relative. */
export interface PresentationCatalogTemplate {
  sourceNodeId: string; evidence: string[]; rect: PresentationRect; visibleFraction: number;
  /** Actual source DOM parents, nearest first; unique IDs can interrupt CSS selector ancestry. */
  sourceAncestorSelectors?: string[];
  paint: PresentationPaint; slots: CatalogTemplateSlot[]; order: CatalogSlotRole[];
  gaps?: Array<{ from: CatalogSlotRole; to: CatalogSlotRole; axis: 'x' | 'y'; valuePx: number }>;
  hover?: { status: 'observed' | 'not-applicable' | 'unobserved'; evidence: string[]; paint?: PresentationPaint; note?: string };
}
export interface PresentationViewport {
  status: 'observed' | 'unobserved'; width: number; height?: number; evidence: string[];
  note?: string; breakpoint?: { minWidth?: number; maxWidth?: number };
  regions: PresentationRegion[]; controlGroups: PresentationControlGroup[];
  media: PresentationMedia[]; relations: PresentationRelation[];
  catalogTemplate?: PresentationCatalogTemplate;
}
export interface PresentationDetails { version: 1; viewports: Record<string, PresentationViewport> }
/** Selectors are evaluated only below the mapped native Elementor element. */
export interface PresentationBinding { id: string; elementKey: string; relativeSelector?: string }
export interface PresentationGap {
  viewport: string; id: string; capability: string; reason: string; evidence: string[]; scope?: 'item' | 'glyph';
}
export interface TargetPresentationEvidence {
  viewport: string; blockId: string; id: string; found: boolean; count: number; evidence: string[]; viewportWidth?: number;
  rect?: PresentationRect; visible?: boolean; paint?: PresentationPaint;
  /** Native DOM containment observed against bound region nodes, not copied from source ownerId. */
  containedByIds?: string[];
  layout?: PresentationControlGroup['layout']; pagination?: PresentationControlGroup['pagination'];
  disabled?: boolean; active?: boolean; text?: string; glyph?: PresentationGlyph; lineCount?: number;
  mode?: PresentationMedia['mode']; fit?: string; objectPosition?: string;
  aspectRatio?: number; clippedRatio?: number;
  baseline?: number;
  /** Role comes from actual DOM semantics/bindings and state, not source counts. */
  controlInventory?: Array<{ role: PresentationControl['role']; visible: number; matched: number }>;
  fractionQuery?: { totalPages: number; productCount: number; pageSize: number; evidence: string[];
    /** Native non-loop snap counts depend on visible columns, not ceil(items/group). */
    nativePagination?: { kind: 'swiper-native-bullets'; initialized: true; bulletCount: number; snapCount: number; activeIndex: number; loop: boolean; paintedCurrent: number; paintSource: 'chromium-layout-generated-text' };
  };
  actualURL?: string; assetKey?: string; sourceURL?: string; mediaSha256?: string; attachmentId?: number;
  controlAbsence?: { ownerCount: number; checked: Array<{ role: PresentationControl['role']; selector: string; matched: number; visible: number }> };
}
export interface PresentationIssue {
  code: string; severity: 'error' | 'warning'; blockId: string; viewport?: string;
  id?: string; message: string; expected?: unknown; actual?: unknown;
}
export interface PresentationVerification {
  version: 1; passed: boolean; status: 'passed' | 'needs-review' | 'failed';
  coverage: Array<{ blockId: string; viewport: string; status: 'verified' | 'failed' | 'unobserved' | 'missing'; expected: number; measured: number }>;
  issues: PresentationIssue[];
}

export type PresentationItem = PresentationRegion | PresentationControl | PresentationControlGroup | PresentationMedia;
export function presentationItems(view: PresentationViewport): PresentationItem[] {
  return [...view.regions, ...view.controlGroups.flatMap(group => [group, ...group.controls]), ...view.media];
}

/** No sibling block, global selector or unknown evidence can impersonate a detail. */
export function validatePresentationBindings(contract: BlockContract, program: NativeProgram): string[] {
  const knownEvidence = new Set(contract.evidence.map(item => item.id));
  const limitations: string[] = [];
  for (const block of contract.blocks) {
    const target = program.blocks.find(candidate => candidate.sourceBlockId === block.id);
    if (!target) throw new Error(`Presentation block has no native target: ${block.id}`);
    const root = program.elements.find(element => element.key === target.rootKey);
    const descendants = new Set<string>();
    const visit = (element: NativeElement) => { descendants.add(element.key); element.children?.forEach(visit); };
    if (root) visit(root);
    const bindings = new Map((target.presentationBindings ?? []).map(binding => [binding.id, binding]));
    if (bindings.size !== target.presentationBindings?.length && target.presentationBindings) throw new Error(`Repeated presentation binding: ${block.id}`);
    const allItemIds = new Set<string>();
    const gaps = target.presentationGaps ?? [];
    if (new Set(gaps.map(gap => `${gap.viewport}/${gap.id}`)).size !== gaps.length) throw new Error(`Repeated native presentation capability gap: ${block.id}`);
    if (!block.presentationDetails) {
      if (bindings.size || gaps.length) throw new Error(`Native presentation bindings or gaps lack source details: ${block.id}`);
      limitations.push(`${block.id}/presentation-details: source internal regions, control styling and responsive media have not been frozen.`);
      continue;
    }
    for (const [viewport, view] of Object.entries(block.presentationDetails.viewports)) {
      if (!block.geometry[viewport]) throw new Error(`Presentation viewport lacks source block geometry: ${block.id}/${viewport}`);
      if (!view.evidence.length || view.evidence.some(id => !knownEvidence.has(id))) throw new Error(`Presentation viewport lacks known evidence: ${block.id}/${viewport}`);
      if (view.breakpoint && (view.breakpoint.minWidth !== undefined && view.width < view.breakpoint.minWidth || view.breakpoint.maxWidth !== undefined && view.width > view.breakpoint.maxWidth || view.breakpoint.minWidth !== undefined && view.breakpoint.maxWidth !== undefined && view.breakpoint.minWidth > view.breakpoint.maxWidth)) throw new Error(`Presentation breakpoint does not contain its observed viewport: ${block.id}/${viewport}`);
      if (view.status === 'unobserved') {
        if (!view.note?.trim()) throw new Error(`Unobserved presentation viewport requires a named gap: ${block.id}/${viewport}`);
        limitations.push(`${block.id}/${viewport}/presentation-details: ${view.note}`);
      }
      if (view.status === 'observed' && !view.regions.length) throw new Error(`Observed presentation requires at least one measured internal region: ${block.id}/${viewport}`);
      if (view.status === 'observed' && block.presentation === 'carousel' && !view.controlGroups.length) throw new Error(`Source carousel requires an evidenced control ownership group: ${block.id}/${viewport}`);
      const items = presentationItems(view), itemIds = new Set(items.map(item => item.id));
      if (items.length !== itemIds.size) throw new Error(`Presentation item IDs must be unique within a viewport: ${block.id}/${viewport}`);
      const regionIds = new Set(view.regions.map(item => item.id));
      for (const item of items) {
        allItemIds.add(item.id);
        if (!item.evidence.length || item.evidence.some(id => !knownEvidence.has(id))) throw new Error(`Presentation item lacks known evidence: ${block.id}/${viewport}/${item.id}`);
        if (!finiteRect(item.rect) || item.tolerancePx !== undefined && (!Number.isFinite(item.tolerancePx) || item.tolerancePx < 0 || item.tolerancePx > geometryTolerance(item, contract.tolerances.geometryPx))) throw new Error(`Presentation geometry has non-finite values or an excessive role tolerance: ${block.id}/${viewport}/${item.id}`);
        if ('mode' in item && item.assetKey && !block.assets.includes(item.assetKey)) throw new Error(`Presentation media asset is outside its source block: ${block.id}/${viewport}/${item.id}`);
        if (view.status !== 'observed') continue;
        if (gaps.some(gap => gap.viewport === viewport && gap.id === item.id && gap.scope !== 'glyph')) continue;
        const binding = bindings.get(item.id);
        if (!binding || !descendants.has(binding.elementKey)) throw new Error(`Presentation binding is missing or crosses its source block: ${block.id}/${viewport}/${item.id}`);
        if (binding.relativeSelector !== undefined && !isSafePresentationSelector(binding.relativeSelector)) throw new Error(`Presentation selector must be a bounded native descendant: ${block.id}/${item.id}`);
      }
      for (const group of view.controlGroups) {
        if (!regionIds.has(group.ownerId)) throw new Error(`Control group owner must be an evidenced region: ${block.id}/${viewport}/${group.id}`);
        if (group.pagination === 'fraction' && !group.controls.some(control => control.role === 'fraction')) throw new Error(`Fraction pagination requires an evidenced fraction control: ${block.id}/${group.id}`);
        if (group.pagination === 'bullets' && !group.controls.some(control => control.role === 'dot')) throw new Error(`Bullet pagination requires evidenced dot controls: ${block.id}/${group.id}`);
        if (group.pagination === 'none' && group.controls.some(control => ['dot', 'fraction'].includes(control.role) && control.visible)) throw new Error(`Absent pagination cannot contain visible pagination controls: ${block.id}/${group.id}`);
        if (group.absentControls && (new Set(group.absentControls).size !== group.absentControls.length || group.controls.some(control => control.visible && group.absentControls!.includes(control.role)))) throw new Error(`Absent controls cannot duplicate or contradict observed visible controls: ${block.id}/${group.id}`);
      }
      const relationIds = new Set<string>();
      for (const relation of view.relations) {
        if (relationIds.has(relation.id) || !itemIds.has(relation.from) || !itemIds.has(relation.to) || relation.from === relation.to) throw new Error(`Presentation relation has repeated or unknown endpoints: ${block.id}/${viewport}/${relation.id}`);
        relationIds.add(relation.id);
        if (!relation.evidence.length || relation.evidence.some(id => !knownEvidence.has(id))) throw new Error(`Presentation relation lacks known evidence: ${block.id}/${viewport}/${relation.id}`);
        if (relation.tolerancePx !== undefined && (!Number.isFinite(relation.tolerancePx) || relation.tolerancePx < 0 || relation.tolerancePx > Math.min(4, contract.tolerances.geometryPx))) throw new Error(`Presentation relation tolerance cannot exceed the tight internal geometry tolerance: ${block.id}/${viewport}/${relation.id}`);
        if (['align', 'attach'].includes(relation.kind) && (!relation.axis || relation.axis === 'both' || !relation.edge)) throw new Error(`Edge relation requires one axis and edge: ${block.id}/${viewport}/${relation.id}`);
        if (relation.kind === 'gap' && (!relation.axis || relation.axis === 'both' || !Number.isFinite(relation.valuePx))) throw new Error(`Gap relation requires one axis and a finite measured gap: ${block.id}/${viewport}/${relation.id}`);
      }
      if (view.catalogTemplate) {
        const template = view.catalogTemplate;
        if (!template.evidence.length || template.evidence.some(id => !knownEvidence.has(id)) || !finiteRect(template.rect) || !Number.isFinite(template.visibleFraction) || template.visibleFraction < .6) throw new Error(`Catalog template requires a physically visible source card and known evidence: ${block.id}/${viewport}`);
        if (new Set(template.slots.map(slot => slot.role)).size !== template.slots.length || new Set(template.order).size !== template.order.length || template.order.some(role => !template.slots.some(slot => slot.role === role && slot.visible))) throw new Error(`Catalog template has duplicate slots or unknown ordered roles: ${block.id}/${viewport}`);
        for (const slot of template.slots) if (!finiteRect(slot.rect)) throw new Error(`Catalog slot has non-finite geometry: ${block.id}/${viewport}/${slot.role}`);
      }
    }
    for (const gap of gaps) {
      const view = block.presentationDetails.viewports[gap.viewport];
      if (!view || view.status !== 'observed' || !presentationItems(view).some(item => item.id === gap.id)) throw new Error(`Native capability gap must identify an observed source item: ${block.id}/${gap.viewport}/${gap.id}`);
      if (gap.scope === 'glyph' && !view.controlGroups.some(group => group.controls.some(control => control.id === gap.id && control.glyph))) throw new Error(`Glyph capability gap must identify an evidenced source control glyph: ${block.id}/${gap.viewport}/${gap.id}`);
      if (!gap.reason.trim() || !gap.capability.trim() || !gap.evidence.length || gap.evidence.some(id => !knownEvidence.has(id))) throw new Error(`Native capability gap lacks a named capability and source evidence: ${block.id}/${gap.viewport}/${gap.id}`);
      limitations.push(`${block.id}/${gap.viewport}/native-capability-gap/${gap.id}: ${gap.capability}: ${gap.reason}`);
    }
    for (const id of bindings.keys()) if (!allItemIds.has(id)) throw new Error(`Native presentation binding has no source item: ${block.id}/${id}`);
  }
  return limitations;
}

/** No arbitrary document escapes, style injection or unbounded universal search. */
export function isSafePresentationSelector(selector: string): boolean {
  return selector.length > 0 && selector.length <= 600 && !/[{},;\\]|\/\*|\/\/|:has\(|:is\(|:where\(|:not\(|\b(?:html|body|iframe|script|style)\b|\*/i.test(selector) && !/^\s*[+~]/.test(selector);
}

function color(value: string): number[] | undefined {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return [0, 0, 0, 0];
  if (/^#[a-f\d]{3}$/.test(text)) return [...Array.from(text.slice(1)).map(value => parseInt(value + value, 16)), 255];
  if (/^#[a-f\d]{6}(?:[a-f\d]{2})?$/.test(text)) return [...[1, 3, 5].map(index => parseInt(text.slice(index, index + 2), 16)), text.length === 9 ? parseInt(text.slice(7, 9), 16) : 255];
  const match = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(text);
  return match ? [...match.slice(1, 4).map(Number), Number(match[4] ?? 1) * 255] : undefined;
}
function sameColor(a: string, b: string, tolerance: number): boolean {
  const first = color(a), second = color(b);
  return first && second ? first.every((value, index) => Math.abs(value - second[index]) <= tolerance) : a.trim().toLowerCase() === b.trim().toLowerCase();
}
const normal = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const finiteRect = (rect: PresentationRect | undefined): rect is PresentationRect => !!rect && Object.values(rect).every(Number.isFinite) && rect.width >= 0 && rect.height >= 0;
const right = (rect: PresentationRect) => rect.x + rect.width;
const bottom = (rect: PresentationRect) => rect.y + rect.height;
export function geometryTolerance(item: PresentationItem, blockTolerance: number): number {
  const role = 'role' in item || 'controls' in item ? 'control' : item.geometryRole ?? 'content';
  const cap = role === 'control' ? 2 : role === 'card' || role === 'slot' ? 3 : 4;
  return Math.min(cap, blockTolerance, item.tolerancePx ?? cap);
}
function relationHolds(relation: PresentationRelation, first: TargetPresentationEvidence, second: TargetPresentationEvidence, tolerance: number): boolean {
  const kind = relation.kind, a = first.rect!, b = second.rect!;
  if (kind === 'owned-by') return first.containedByIds?.includes(relation.to) === true;
  if (kind === 'baseline') return Number.isFinite(first.baseline) && Number.isFinite(second.baseline) && Math.abs(first.baseline! - second.baseline!) <= tolerance;
  if (kind === 'align' || kind === 'attach') {
    const end = relation.edge === 'end', x = relation.axis === 'x';
    const firstEdge = x ? end ? right(a) : a.x : end ? bottom(a) : a.y;
    const secondEdge = x ? end ? right(b) : b.x : end ? bottom(b) : b.y;
    return Math.abs(firstEdge - secondEdge - (relation.valuePx ?? 0)) <= tolerance;
  }
  if (kind === 'fill') return (relation.axis === 'y' || Math.abs(a.x - b.x) <= tolerance && Math.abs(right(a) - right(b)) <= tolerance) && (relation.axis === 'x' || Math.abs(a.y - b.y) <= tolerance && Math.abs(bottom(a) - bottom(b)) <= tolerance);
  if (kind === 'center') return (relation.axis === 'y' || Math.abs(a.x + a.width / 2 - b.x - b.width / 2) <= tolerance) && (relation.axis === 'x' || Math.abs(a.y + a.height / 2 - b.y - b.height / 2) <= tolerance);
  if (kind === 'gap') return Math.abs((relation.axis === 'x' ? b.x - right(a) : b.y - bottom(a)) - relation.valuePx!) <= tolerance;
  const firstRect = a, secondRect = b;
  if (kind === 'contains') return b.x >= a.x - tolerance && b.y >= a.y - tolerance && right(b) <= right(a) + tolerance && bottom(b) <= bottom(a) + tolerance;
  const intersectionWidth = Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x));
  const intersectionHeight = Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));
  if (kind === 'outside' || kind === 'non-overlap') return intersectionWidth <= tolerance || intersectionHeight <= tolerance;
  if (kind === 'same-row') return Math.abs(a.y + a.height / 2 - b.y - b.height / 2) <= tolerance;
  return bottom(firstRect) <= secondRect.y + tolerance;
}

/** Detailed presentation is independent of native editability and successful carousel movement. */
export function verifyPresentationDetails(contract: BlockContract, program: NativeProgram, actual: TargetPresentationEvidence[] = []): PresentationVerification {
  const issues: PresentationIssue[] = [], coverage: PresentationVerification['coverage'] = [];
  const add = (issue: PresentationIssue) => issues.push(issue);
  try { validatePresentationBindings(contract, program); } catch (error) { add({ code: 'presentation-binding', severity: 'error', blockId: '', message: error instanceof Error ? error.message : 'Presentation binding is invalid' }); }
  for (const block of contract.blocks) {
    for (const viewport of Object.keys(block.geometry)) {
      const view = block.presentationDetails?.viewports[viewport];
      if (!view) { add({ code: 'presentation-details-missing', severity: 'warning', blockId: block.id, viewport, message: 'Internal regions, controls and responsive media have no frozen presentation contract.' }); coverage.push({ blockId: block.id, viewport, status: 'missing', expected: 0, measured: 0 }); continue; }
      if (view.status === 'unobserved') { add({ code: 'presentation-source-unobserved', severity: 'warning', blockId: block.id, viewport, message: view.note ?? 'Source presentation details were not observed.' }); coverage.push({ blockId: block.id, viewport, status: 'unobserved', expected: presentationItems(view).length, measured: 0 }); continue; }
      const before = issues.length, items = presentationItems(view); let measured = 0;
      const gaps = program.blocks.find(item => item.sourceBlockId === block.id)?.presentationGaps?.filter(gap => gap.viewport === viewport) ?? [];
      const gapIds = new Set(gaps.filter(gap => gap.scope !== 'glyph').map(gap => gap.id));
      const expectedIds = new Set(items.map(item => item.id));
      const scoped = actual.filter(item => item.blockId === block.id && item.viewport === viewport);
      const lookup = new Map<string, TargetPresentationEvidence>();
      for (const item of scoped) {
        if (!expectedIds.has(item.id)) continue;
        if (lookup.has(item.id)) { add({ code: 'presentation-measurement-duplicate', severity: 'error', blockId: block.id, viewport, id: item.id, message: 'A presentation item has duplicate browser measurements.' }); continue; }
        lookup.set(item.id, item);
      }
      for (const item of items) {
        const capabilityGap = gaps.find(gap => gap.id === item.id && gap.scope !== 'glyph');
        if (capabilityGap) add({ code: 'native-capability-gap', severity: 'error', blockId: block.id, viewport, id: item.id, message: `${capabilityGap.capability}: ${capabilityGap.reason}`, expected: item });
        const target = lookup.get(item.id);
        const mismatch = (property: string, expected: unknown, value: unknown, warning = false) => add({ code: `presentation-${property}`, severity: warning ? 'warning' : 'error', blockId: block.id, viewport, id: item.id, message: `Actual native presentation ${property} differs from its source evidence.`, expected, actual: value });
        if (!target?.found || target.count !== 1 || !target.evidence.length || !finiteRect(target.rect)) { mismatch('unmeasured', { found: true, count: 1, evidence: true, finiteRect: true }, target); continue; }
        measured++;
        if (target.viewportWidth === undefined || !Number.isFinite(target.viewportWidth) || Math.abs(target.viewportWidth - view.width) > .5) mismatch('viewport-width', view.width, target.viewportWidth);
        if (target.visible !== item.visible) mismatch('visibility', item.visible, target.visible);
        // Hidden controls intentionally retain no layout box; do not compare a made-up position.
        if (item.visible && target.visible) for (const property of ['x', 'y', 'width', 'height'] as const) if (Math.abs(target.rect[property] - item.rect[property]) > geometryTolerance(item, contract.tolerances.geometryPx)) mismatch(`rect-${property}`, item.rect[property], target.rect[property]);
        const sourceGroup = view.controlGroups.find(group => group.controls.some(control => control.id === item.id));
        const statePaint = (item as PresentationControl).role === 'dot' && sourceGroup ? target.active === true ? sourceGroup.activePaint : target.active === false ? sourceGroup.inactivePaint : undefined : undefined;
        for (const [property, expected] of Object.entries({ ...item.paint, ...statePaint })) {
          const value = target.paint?.[property as keyof PresentationPaint];
          if (value === undefined) { mismatch(`paint-${property}-unmeasured`, expected, value); continue; }
          const same = typeof expected === 'number' && typeof value === 'number' ? Math.abs(expected - value) <= (property === 'opacity' ? .02 : property === 'borderWidth' ? .25 : 1) : typeof expected === 'string' && typeof value === 'string' ? /color/i.test(property) ? sameColor(expected, value, contract.tolerances.colorChannel) : normal(expected).toLowerCase() === normal(value).toLowerCase() : expected === value;
          if (!same) mismatch(`paint-${property}`, expected, value);
        }
        const control = item as PresentationControl;
        let provedGeneratedFraction = false;
        if (control.role) {
          for (const property of ['disabled', 'active'] as const) if (control[property] !== undefined && !(property === 'active' && control.role === 'dot' && sourceGroup?.stateSynchronized !== true) && control[property] !== target[property]) mismatch(property, control[property], target[property]);
          if (control.text !== undefined) {
            if (control.textMatch === 'fraction' || control.role === 'fraction' && control.textMatch !== 'exact') {
              const expected = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(control.text), value = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(target.text ?? '');
              const query = target.fractionQuery, dynamic = control.fractionTotal === 'target-query';
              const native = query?.nativePagination;
              const nativeTotal = native && native.kind === 'swiper-native-bullets' && native.initialized === true && native.paintSource === 'chromium-layout-generated-text' && Number.isInteger(native.bulletCount) && native.bulletCount > 0 && Number.isInteger(native.snapCount) && native.snapCount > 0 && Number.isInteger(native.activeIndex) && native.activeIndex >= 0 && native.activeIndex < native.bulletCount && native.paintedCurrent === native.activeIndex + 1 && (native.loop || native.bulletCount === native.snapCount) && query!.totalPages === native.bulletCount;
              const provenQuery = query && Number.isInteger(query.productCount) && query.productCount > 0 && Number.isInteger(query.pageSize) && query.pageSize > 0 && Number.isInteger(query.totalPages) && (native ? nativeTotal : query.totalPages === Math.ceil(query.productCount / query.pageSize)) && query.evidence.length > 0;
              if (dynamic && !provenQuery) mismatch('fraction-query-unmeasured', 'Actual native query page count', query);
              const total = dynamic ? provenQuery ? query!.totalPages : undefined : expected ? Number(expected[2]) : undefined;
              if (!expected || !value || Number(value[2]) !== total || Number(value[1]) < 1 || Number(value[1]) > Number(value[2])) mismatch('fraction-text', dynamic ? { queryTotalPages: total } : control.text, target.text);
              if (native && (!value || Number(value[1]) !== native.paintedCurrent)) mismatch('fraction-current-state', native.paintedCurrent, target.text);
              provedGeneratedFraction = control.role === 'fraction' && dynamic && !!provenQuery && !!nativeTotal && !!value && Number(value[1]) === native!.paintedCurrent && Number(value[2]) === native!.bulletCount;
            } else if (normal(control.text) !== normal(target.text ?? '')) mismatch('text', control.text, target.text);
          }
          if (control.role === 'dot' && sourceGroup && (sourceGroup.activePaint || sourceGroup.inactivePaint) && typeof target.active !== 'boolean') mismatch('active-unmeasured', 'Actual dot active state', target.active);
        }
        const glyphGap = gaps.find(gap => gap.id === item.id && gap.scope === 'glyph');
        if (glyphGap) add({ code: 'native-capability-gap', severity: 'error', blockId: block.id, viewport, id: item.id, message: `${glyphGap.capability}: ${glyphGap.reason}`, expected: control.glyph });
        if (!glyphGap && item.visible && ['previous', 'next'].includes(control.role) && !control.glyph) mismatch('glyph-source-unobserved', 'Observed arrow glyph', undefined, true);
        for (const [property, expected] of Object.entries(control.glyph ?? {})) {
          // DOM text and a genuinely drawn live CSS counter are different
          // representations. Only actual Chromium paint + initialized native
          // ownership/state proof permits this narrow representation exception.
          // Geometry, dimensions, font and color are still checked normally.
          if (provedGeneratedFraction && ['kind', 'content', 'signature'].includes(property)) continue;
          const value = target.glyph?.[property as keyof PresentationGlyph];
          const same = typeof expected === 'number' && typeof value === 'number' ? Math.abs(expected - value) <= 1 : typeof expected === 'string' && typeof value === 'string' ? /stroke|fill/.test(property) ? sameColor(expected, value, contract.tolerances.colorChannel) : normal(expected) === normal(value) : expected === value;
          if (!same) mismatch(`glyph-${property}`, expected, value);
        }
        if (item.lineCount !== undefined && item.lineCount !== target.lineCount) mismatch('line-count', item.lineCount, target.lineCount);
        if (item.maxClippedRatio !== undefined && (target.clippedRatio === undefined || !Number.isFinite(target.clippedRatio) || target.clippedRatio > item.maxClippedRatio + .01)) mismatch('clipping', item.maxClippedRatio, target.clippedRatio);
        const group = item as PresentationControlGroup;
        if (group.controls) {
          if (!target.containedByIds?.includes(group.ownerId)) mismatch('owner', group.ownerId, target.containedByIds);
          for (const property of ['layout', 'pagination'] as const) if (target[property] !== group[property]) mismatch(property, group[property], target[property]);
          const inventory = target.controlInventory;
          if (!inventory) mismatch('control-inventory-unmeasured', 'Actual role counts inside native component', undefined, true);
          else for (const role of ['previous', 'next', 'fraction', 'dot', 'autoplay'] as const) {
            const rows = inventory.filter(row => row.role === role), wanted = group.cardinality?.[role] ?? group.controls.filter(control => control.role === role && control.visible).length;
            if (rows.length !== 1 || !Number.isInteger(rows[0].visible) || rows[0].visible < 0 || !Number.isInteger(rows[0].matched) || rows[0].matched < rows[0].visible) mismatch('control-inventory-unmeasured', { role, visible: wanted }, rows);
            else if (rows[0].visible !== wanted) mismatch('control-cardinality', { role, visible: wanted }, rows[0]);
          }
          for (const role of group.absentControls ?? []) {
            const checks = target.controlAbsence?.checked.filter(check => check.role === role) ?? [], check = checks[0];
            if (target.controlAbsence?.ownerCount !== 1 || checks.length !== 1 || !check?.selector || !Number.isInteger(check.matched) || check.matched < 0 || !Number.isInteger(check.visible) || check.visible < 0 || check.visible > check.matched) mismatch('absence-unmeasured', { role, ownerCount: 1, actualSelectorChecked: true }, target.controlAbsence);
            else if (check.visible !== 0) mismatch('unexpected-control', { role, visible: 0 }, check);
          }
        }
        const media = item as PresentationMedia;
        if (media.mode) {
          for (const property of ['mode', 'fit', 'objectPosition'] as const) if (media[property] !== undefined && target[property] !== media[property]) mismatch(`media-${property}`, media[property], target[property]);
          if (media.aspectRatio !== undefined && (target.aspectRatio === undefined || !Number.isFinite(target.aspectRatio) || Math.abs(media.aspectRatio - target.aspectRatio) > .02)) mismatch('media-aspect-ratio', media.aspectRatio, target.aspectRatio);
          for (const [property, value] of [['assetKey', target.assetKey], ['sourceURL', target.sourceURL], ['assetSha256', target.mediaSha256]] as const) if (media[property] !== undefined && media[property] !== value) mismatch(`media-${property}`, media[property], value, value === undefined);
        }
      }
      for (const relation of view.relations) {
        const first = lookup.get(relation.from), second = lookup.get(relation.to);
        if (!first?.found || first.count !== 1 || !first.visible || !finiteRect(first.rect) || !second?.found || second.count !== 1 || !second.visible || !finiteRect(second.rect)) { add({ code: 'presentation-relation-unmeasured', severity: 'error', blockId: block.id, viewport, id: relation.id, message: 'A presentation relation requires two unique visible measured endpoints.' }); continue; }
        if (!relationHolds(relation, first, second, relation.tolerancePx ?? Math.min(2, contract.tolerances.geometryPx))) add({ code: `presentation-relation-${relation.kind}`, severity: 'error', blockId: block.id, viewport, id: relation.id, message: 'Actual internal layout violates an evidenced source relation.', expected: relation, actual: { from: first.rect, to: second.rect } });
      }
      coverage.push({ blockId: block.id, viewport, status: issues.length === before ? 'verified' : issues.slice(before).some(issue => issue.severity === 'error') ? 'failed' : 'unobserved', expected: items.length, measured });
    }
  }
  const errors = issues.some(issue => issue.severity === 'error');
  return { version: 1, passed: !issues.length, status: errors ? 'failed' : issues.length ? 'needs-review' : 'passed', coverage, issues };
}
