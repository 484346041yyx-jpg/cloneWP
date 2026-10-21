import { z } from 'zod';

export const sourceSceneKinds = ['block', 'content-frame', 'repeated-template', 'control-group', 'control'] as const;
export type SourceSceneKind = typeof sourceSceneKinds[number];
export const sourceSceneBindingSchema = z.object({
  viewport: z.string().min(1), sourceId: z.string().min(1), blockId: z.string().min(1),
  targetKey: z.string().min(1), requirement: z.enum(sourceSceneKinds), state: z.string().min(1).optional(),
}).strict();
export type SourceSceneBinding = z.infer<typeof sourceSceneBindingSchema>;
export interface SourceSceneRect { x: number; y: number; width: number; height: number }
export interface SourceSceneItem {
  id: string; kind: SourceSceneKind; selector: string; sourceBlockId?: string; ownerId?: string;
  ancestorSelectors?: string[];
  rect: SourceSceneRect; visible: boolean; required: boolean;
  role?: 'previous' | 'next' | 'autoplay' | 'dot' | 'fraction' | 'action' | 'unknown';
  state: string; facts: Record<string, unknown>; evidence: string[];
}
export interface SourceSceneGap { code: string; message: string; sourceId?: string; viewport?: string }
export interface SourceSceneInventory {
  version: 1; method: 'independent-public-dom-scene'; sourceUrl: string; capturedAt: string;
  viewport: { name: string; width: number; height: number; clientWidth: number; devicePixelRatio: number | null; touch: boolean | null; coarsePointer: boolean | null; deviceProfile: 'desktop' | 'mobile' | 'touch' };
  evidencePath: string; screenshotPath?: string; screenshotSha256?: string;
  state: 'resting'; status: 'observed' | 'partial'; items: SourceSceneItem[]; gaps: SourceSceneGap[];
  notice: string;
}
const finiteRect = (value: unknown): value is SourceSceneRect => !!value && typeof value === 'object' && ['x','y','width','height'].every(key => typeof (value as Record<string, unknown>)[key] === 'number' && Number.isFinite((value as Record<string, number>)[key])) && (value as SourceSceneRect).width >= 0 && (value as SourceSceneRect).height >= 0;

/** The browser collector supplies an independent enumeration, never contract-authored expectations. */
export function normalizeSourceScene(raw: unknown, provenance: Pick<SourceSceneInventory, 'sourceUrl' | 'capturedAt' | 'evidencePath'> & { viewportName: string; deviceProfile?: 'desktop' | 'mobile' | 'touch'; screenshotPath?: string; screenshotSha256?: string }): SourceSceneInventory | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as Record<string, unknown>, viewport = value.viewport as SourceSceneInventory['viewport'];
  if (value.version !== 1 || value.method !== 'independent-public-dom-scene' || !Array.isArray(value.items) || !Array.isArray(value.gaps) || !viewport || ![viewport.width,viewport.height,viewport.clientWidth].every(number => Number.isFinite(number) && number > 0) || viewport.devicePixelRatio !== null && !(typeof viewport.devicePixelRatio === 'number' && Number.isFinite(viewport.devicePixelRatio) && viewport.devicePixelRatio > 0) || viewport.touch !== null && typeof viewport.touch !== 'boolean' || viewport.coarsePointer !== null && typeof viewport.coarsePointer !== 'boolean') return;
  const items: SourceSceneItem[] = [], gaps: SourceSceneGap[] = value.gaps.filter((gap): gap is SourceSceneGap => !!gap && typeof gap === 'object' && typeof gap.code === 'string' && typeof gap.message === 'string'), seen = new Set<string>();
  if(viewport.devicePixelRatio===null||viewport.touch===null||viewport.coarsePointer===null)gaps.push({code:'scene-device-facts-unobserved',message:'Actual device pixel ratio, touch or pointer facts are unavailable; no equivalence is inferred.'});
  for (const rawItem of value.items) {
    if (!rawItem || typeof rawItem !== 'object') { gaps.push({ code: 'scene-invalid-item', message: 'An independently observed scene item is malformed.' }); continue; }
    const item = rawItem as SourceSceneItem;
    if (!sourceSceneKinds.includes(item.kind) || typeof item.id !== 'string' || !item.id || seen.has(item.id) || typeof item.selector !== 'string' || !finiteRect(item.rect) || !Array.isArray(item.evidence) || !item.evidence.length || typeof item.visible !== 'boolean' || typeof item.required !== 'boolean' || typeof item.state !== 'string' || !item.facts || typeof item.facts !== 'object') { gaps.push({ code: 'scene-invalid-item', message: 'An independently observed scene item has invalid identity, geometry or provenance.' }); continue; }
    seen.add(item.id); items.push(item);
  }
  if (!items.some(item => item.kind === 'block')) gaps.push({ code: 'scene-blocks-unobserved', message: 'No source block was independently enumerated.' });
  return {
    version: 1, method: 'independent-public-dom-scene', ...provenance,
    viewport: { ...viewport, name: provenance.viewportName, deviceProfile: provenance.deviceProfile ?? (viewport.touch ? 'touch' : 'desktop') },
    state: 'resting', status: gaps.length ? 'partial' : 'observed', items, gaps,
    notice: 'Independent public DOM inventory is captured before contract authoring. Resting appearance is observed; hover, switching and autoplay are unobserved until separate state evidence exists. Unknown ownership and bounded collection are explicit gaps.',
  };
}
