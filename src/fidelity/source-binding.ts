import { createHash } from 'node:crypto';
import type { SourceSceneBinding, SourceSceneGap, SourceSceneInventory, SourceSceneItem, SourceSceneRect } from '../reference/source-scene.js';
import type { BlockContract, NativeElement, NativeProgram, SourceAssetManifest } from './types.js';
import { isSafePresentationSelector, presentationItems, type CatalogSlotRole, type PresentationBinding, type PresentationCatalogTemplate, type PresentationPaint, type PresentationRegion } from './presentation-contract.js';
import { readSettingPath } from './validate.js';
import { catalogTemplateOwnedBy, catalogSourceNodeId } from './catalog-contract.js';

export interface SourceBindingObservedNode {
  selector: string; rect: SourceSceneRect; text?: string; url?: string; currentSrc?: string; src?: string;
  parentSelector?: string | null;
  ancestorSelectors?: string[];
  visible?: boolean; style?: Record<string, string>; visibility?: { painted?: boolean; clippedRatio?: number };
  lineLayout?: { visibility?: { painted?: boolean; clippedRatio?: number } };
}
export interface SourceBindingObservedBlock {
  id: string; selectors: string[]; rect: SourceSceneRect;
  textAtoms?: SourceBindingObservedNode[]; images?: SourceBindingObservedNode[];
  nodes?: SourceBindingObservedNode[];
}
export interface SourceBindingPacket { viewport: string; evidenceId: string; blocks: SourceBindingObservedBlock[] }
/** Supplied by a compiler adapter after it has selected a real same-block native node. */
export interface SourceNativeIdentity {
  blockId: string; sourceNodeId: string; elementKey: string; relativeSelector?: string;
  viewport?: string; evidence: string[];
}
export interface SourceBindingMatch { viewport: string; sourceBlockId: string; blockId: string; reason: string }
export interface SourceBindingProposal {
  bindings: SourceSceneBinding[]; blocks: SourceBindingMatch[]; gaps: SourceSceneGap[];
  /** Measured additions still need to be frozen and browser verified; they are not a pass receipt. */
  presentation: Array<{ blockId: string; viewport: string; region: PresentationRegion; binding: PresentationBinding }>;
}
/** Complete item-owned source facts without mounting source claims on target products. */
export function collectCatalogSourceFieldAdditions(options: {
  block: BlockContract['blocks'][number]; observed: SourceBindingObservedBlock; inventory: SourceSceneInventory; viewport: string; evidenceId: string;
}): Array<{ itemIndex: number; text: BlockContract['blocks'][number]['texts'][number]; sourceSelector: string; evidence: string[] }> {
  const { block, observed, inventory, viewport, evidenceId } = options;
  if (observed.id !== block.id || inventory.viewport.name !== viewport || !evidenceId) throw new Error('Catalog field capture requires its exact independently observed source block and viewport');
  const additions: Array<{ itemIndex: number; text: BlockContract['blocks'][number]['texts'][number]; sourceSelector: string; evidence: string[] }> = [];
  const controls = inventory.items.filter(item => item.kind === 'control' && item.sourceBlockId === observed.id);
  for (const [itemIndex, item] of (block.dynamicData?.items ?? []).entries()) {
    const owner = catalogSourceNodeId(item, viewport), remaining = new Map<string, number>(), occurrences = new Map<string, number>();
    for (const id of item.textIds) { const value = normalized(block.texts.find(text => text.id === id)?.text ?? ''); remaining.set(value, (remaining.get(value) ?? 0) + 1); }
    const seen = new Set<string>();
    for (const atom of observed.textAtoms ?? []) {
      const value = normalized(atom.text ?? ''), identity = atom.selector + '\0' + value;
      if (!value || atom.visible === false || seen.has(identity) || !sourceWithin(atom.selector, owner, observed) || controls.some(control => sourceWithin(atom.selector, control.selector, observed))) continue;
      seen.add(identity);const available = remaining.get(value) ?? 0;
      if (available > 0) { remaining.set(value, available - 1); continue; }
      const occurrence = (occurrences.get(value) ?? 0) + 1; occurrences.set(value, occurrence);
      const id = 'catalog-field-' + createHash('sha256').update(item.sourceNodeId + '\0' + value + '\0' + occurrence).digest('hex').slice(0, 20);
      additions.push({ itemIndex, text: { id, text: value, kind: 'label' }, sourceSelector: atom.selector, evidence: [evidenceId] });
    }
  }
  return additions;
}
/** Same logical fields may be remounted beneath different source DOM owners at a breakpoint. */
export function inferCatalogSourceViewportIdentities(options: {
  block: BlockContract['blocks'][number]; viewport: string; observed: SourceBindingObservedBlock;
  inventory: SourceSceneInventory; manifest: SourceAssetManifest;
}): { identities: Array<{ itemIndex: number; sourceNodeId: string; evidence: string[] }>; gaps: SourceSceneGap[] } {
  const { block, viewport, observed, inventory, manifest } = options, identities: Array<{ itemIndex: number; sourceNodeId: string; evidence: string[] }> = [], gaps: SourceSceneGap[] = [];
  if (inventory.viewport.name !== viewport || inventory.sourceUrl !== manifest.sourceUrl || observed.id !== block.id) return { identities, gaps: [{ code: 'source-catalog-identity-context-mismatch', viewport, message: 'Catalog identity inference requires the same independent source block, viewport and asset origin.' }] };
  const repeated = [...new Set(inventory.items.filter(item => item.kind === 'repeated-template' && item.sourceBlockId === observed.id).flatMap(item => Array.isArray(item.facts.itemSelectors) ? item.facts.itemSelectors.filter((value): value is string => typeof value === 'string') : []))];
  for (const [itemIndex, item] of (block.dynamicData?.items ?? []).entries()) {
    const copy = item.textIds.map(id => block.texts.find(text => text.id === id)?.text).filter((value): value is string => typeof value === 'string').map(normalized);
    const media = item.assetKeys.map(key => manifest.assets.find(asset => asset.key === key)?.sourceUrl).filter((value): value is string => !!value);
    const candidates = repeated.filter(owner => copy.length === item.textIds.length && media.length === item.assetKeys.length && copy.every(text => observed.textAtoms?.some(atom => normalized(atom.text ?? '') === text && sourceWithin(atom.selector, owner, observed))) && media.every(url => observed.images?.some(image => urls(image).includes(url) && sourceWithin(image.selector, owner, observed))));
    // Nested structural repeats may contain the same fields. Select the most
    // specific candidate only when actual source parent chains prove nesting.
    const minimal = candidates.filter(owner => !candidates.some(other => other !== owner && sourceWithin(other, owner, observed)));
    if (minimal.length !== 1) { gaps.push({ code: minimal.length ? 'source-catalog-viewport-identity-ambiguous' : 'source-catalog-viewport-identity-unobserved', viewport, sourceId: item.sourceNodeId, message: 'The same logical catalog item has no unique independently repeated owner containing all exact source text and media fields at this viewport.' }); continue; }
    identities.push({ itemIndex, sourceNodeId: minimal[0], evidence: [inventory.evidencePath] });
  }
  if (new Set(identities.map(row => row.sourceNodeId)).size !== identities.length) return { identities: [], gaps: [...gaps, { code: 'source-catalog-viewport-identities-collapsed', viewport, message: 'Distinct logical catalog items cannot alias one independently observed source card.' }] };
  return { identities, gaps };
}
const normalized = (value: string) => value.normalize('NFC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const descendants = (nodes: NativeElement[]): NativeElement[] => nodes.flatMap(node => [node, ...descendants(node.children ?? [])]);
const within = (child: string, owner: string) => child === owner || child.startsWith(owner + ' > ');
const finiteRect = (rect: SourceSceneRect) => ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key as keyof SourceSceneRect])) && rect.width >= 0 && rect.height >= 0;
const measuredId = (kind: string, selector: string) => 'source-' + kind + '-' + createHash('sha256').update(selector).digest('hex').slice(0, 16);
const assetKeys = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(assetKeys) : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, child]) => key === '$asset' && typeof child === 'string' ? [child] : assetKeys(child)) : [];
const urls = (node: SourceBindingObservedNode) => [node.url, node.currentSrc, node.src].filter((value): value is string => !!value);
function sourceWithin(child: string, owner: string, block: SourceBindingObservedBlock): boolean {
  if (within(child, owner)) return true;
  const record = [...(block.nodes ?? []), ...(block.textAtoms ?? []), ...(block.images ?? [])].find(node => node.selector === child);
  if (record?.ancestorSelectors?.includes(owner)) return true;
  const parents = new Map((block.nodes ?? []).map(node => [node.selector, node.parentSelector]));
  const seen = new Set<string>();
  for (let current: string | null | undefined = child, depth = 0; current && depth < 64; current = parents.get(current), depth++) {
    if (within(current, owner)) return true;
    if (seen.has(current)) break; seen.add(current);
  }
  return false;
}
function staticFeatureCandidates(item: SourceSceneItem, source: BlockContract['blocks'][number], target: NativeProgram['blocks'][number], root: NativeElement, observed: SourceBindingObservedBlock | undefined, manifest: SourceAssetManifest | undefined): PresentationBinding[] {
  if (!observed || item.kind !== 'repeated-template' || source.dynamicData || target.productQuery) return [];
  const shown = (node: SourceBindingObservedNode) => node.visible !== false && node.visibility?.painted !== false && node.lineLayout?.visibility?.painted !== false;
  const texts = [...new Set((observed.textAtoms ?? []).filter(node => node.text && shown(node) && sourceWithin(node.selector, item.selector, observed)).map(node => normalized(node.text!)).filter(Boolean))].sort();
  const sourceImages = (observed.images ?? []).filter(node => shown(node) && sourceWithin(node.selector, item.selector, observed));
  const keys = [...new Set(sourceImages.flatMap(node => manifest?.assets.filter(asset => source.assets.includes(asset.key) && urls(node).includes(asset.sourceUrl)).map(asset => asset.key) ?? []))].sort();
  if (sourceImages.some(node => !manifest?.assets.some(asset => source.assets.includes(asset.key) && urls(node).includes(asset.sourceUrl))) || texts.length + keys.length < 2) return [];
  const candidates = descendants([root]).flatMap(node => {
    const subtree = descendants([node]), nativeKeys = new Set(subtree.map(node => node.key));
    const ownAssets = [...new Set(assetKeys(node))].sort();
    const ownTexts = [...new Set(target.bindings.filter(binding => nativeKeys.has(binding.elementKey)).flatMap(binding => {
      const text = source.texts.find(text => text.id === binding.sourceTextId), element = subtree.find(node => node.key === binding.elementKey), actual = element && readSettingPath(element.settings, binding.settingPath);
      return text && typeof actual === 'string' && normalized(actual) === normalized(text.text) ? [normalized(text.text)] : [];
    }))].sort();
    return JSON.stringify(ownAssets) === JSON.stringify(keys) && JSON.stringify(ownTexts) === JSON.stringify(texts) ? [{ node, size: subtree.length }] : [];
  }).sort((a, b) => a.size - b.size);
  if (!candidates.length) return [];
  return candidates.filter(candidate => candidate.size === candidates[0].size).map(candidate => ({ id: measuredId('region', item.selector), elementKey: candidate.node.key }));
}
function sourceIdentities(block: BlockContract['blocks'][number]): string[] {
  return [...new Set([
    ...Object.values(block.contentBounds ?? {}).map(bounds => bounds.sourceNodeId),
    ...Object.values(block.presentationDetails?.viewports ?? {}).flatMap(view => presentationItems(view).map(item => item.sourceNodeId)),
    ...(block.dynamicData?.items ?? []).flatMap(item => [item.sourceNodeId, ...Object.values(item.sourceNodeIds ?? {})]),
  ])];
}
function sameGeometry(left: SourceSceneRect, right: { width: number; height: number } | undefined) {
  return !!right && Math.abs(left.width - right.width) <= .51 && Math.abs(left.height - right.height) <= .51;
}

/**
 * Resolve identities mechanically. It never substitutes a root for an unknown
 * control, guesses a descendant selector, or shrinks the independent inventory.
 * Omitted/ambiguous records remain explicit gaps for the compiler to resolve.
 */
export function proposeSourceSceneBindings(options: {
  contract: BlockContract; program: NativeProgram; inventories: SourceSceneInventory[];
  packets?: SourceBindingPacket[]; manifest?: SourceAssetManifest; identities?: SourceNativeIdentity[];
}): SourceBindingProposal {
  const { contract, program, inventories } = options;
  const result: SourceBindingProposal = { bindings: [], blocks: [], gaps: [], presentation: [] };
  if (!inventories.length) result.gaps.push({ code: 'source-scene-inventory-missing', message: 'No independent source inventory is available for mechanical binding.' });
  const knownEvidence = new Set(contract.evidence.map(item => item.id));
  const identityUse = new Map<string, Set<string>>();
  for (const block of contract.blocks) for (const identity of sourceIdentities(block)) {
    const used = identityUse.get(identity) ?? new Set<string>(); used.add(block.id); identityUse.set(identity, used);
  }
  for (const scene of inventories) {
    const viewport = scene.viewport.name;
    result.gaps.push(...scene.gaps.map(gap => ({ ...gap, viewport })));
    if (scene.sourceUrl !== contract.sourceUrl || program.sourceUrl !== contract.sourceUrl) {
      result.gaps.push({ code: 'source-binding-url-mismatch', viewport, message: 'Source inventory, contract and native program must describe the same URL.' }); continue;
    }
    const packet = options.packets?.find(packet => packet.viewport === viewport);
    const roots = scene.items.filter(item => item.kind === 'block' && item.visible && item.required);
    if (!roots.length) result.gaps.push({ code: 'source-scene-visible-blocks-missing', viewport, message: 'Independent scene has no valid required source blocks; malformed or empty observations cannot produce an empty success.' });
    const resolved = new Map<string, string>();
    for (const root of roots) {
      const observed = packet?.blocks.find(block => block.id === root.sourceBlockId);
      const addresses = [...new Set([root.selector, ...(observed?.selectors ?? []), ...(Array.isArray(root.facts.selectors) ? root.facts.selectors.filter((value): value is string => typeof value === 'string') : [])])];
      const candidates = contract.blocks.map(block => {
        const identities = sourceIdentities(block).filter(address => identityUse.get(address)?.size === 1);
        const exact = identities.filter(address => addresses.includes(address));
        const children = identities.filter(address => addresses.some(owner => within(address, owner)));
        const contractCopy = new Set(block.texts.filter(text => !block.dynamicData?.replaceableTextIds.includes(text.id)).map(text => normalized(text.text)).filter(Boolean));
        const observedCopy = [...new Set((observed?.textAtoms ?? []).filter(atom => atom.visible !== false && atom.lineLayout?.visibility?.painted !== false).map(atom => normalized(atom.text ?? '')).filter(Boolean))];
        const exactText = observedCopy.filter(text => contractCopy.has(text));
        const observedMedia = new Set((observed?.images ?? []).flatMap(urls));
        const media = options.manifest?.assets.filter(asset => block.assets.includes(asset.key) && observedMedia.has(asset.sourceUrl)) ?? [];
        const id = block.id === root.sourceBlockId && sameGeometry(root.rect, block.geometry[viewport]);
        // Content fingerprints must cover the observed block, not just one word
        // in a coarsely captured whole main element.
        const fingerprint = observedCopy.length > 0 && exactText.length / observedCopy.length >= .8 && (exactText.length >= 2 || media.length > 0);
        return { block, score: exact.length ? 400 : id ? 300 : children.length ? 200 : fingerprint ? 100 : 0,
          reason: exact.length ? 'unique exact source selector' : id ? 'source block identity and measured geometry' : children.length ? 'unique source descendant identities' : 'independent exact static-copy/media fingerprint' };
      }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score);
      if (!candidates.length || candidates[1]?.score === candidates[0].score) {
        result.gaps.push({ code: candidates.length ? 'source-block-binding-ambiguous' : 'source-block-binding-unresolved', viewport, sourceId: root.id, message: 'Independent source block has no unique selector/content identity in the native program; neither geometry-only nor a whole-page fallback is allowed.' }); continue;
      }
      const choice = candidates[0];
      resolved.set(root.sourceBlockId ?? root.id, choice.block.id);
      result.blocks.push({ viewport, sourceBlockId: root.sourceBlockId ?? root.id, blockId: choice.block.id, reason: choice.reason });
    }
    // Multiple independently captured blocks may not collapse onto one root.
    for (const blockId of new Set(resolved.values())) {
      const duplicates = [...resolved.entries()].filter(([, value]) => value === blockId);
      if (duplicates.length > 1) for (const [sourceId] of duplicates) {
        resolved.delete(sourceId); result.gaps.push({ code: 'source-block-binding-collapsed', viewport, sourceId, message: 'Distinct source blocks resolve to one native block; source segmentation or compiler ownership must be corrected.' });
      }
    }
    for (const item of scene.items.filter(item => item.required && item.visible)) {
      const blockId = resolved.get(item.sourceBlockId ?? item.id), source = contract.blocks.find(block => block.id === blockId);
      const target = program.blocks.find(block => block.sourceBlockId === blockId), root = target && program.elements.find(node => node.key === target.rootKey);
      if (!source || !target || !root) { result.gaps.push({ code: 'source-feature-owner-unresolved', viewport, sourceId: item.id, message: 'Feature has no uniquely resolved source/native block ownership.' }); continue; }
      const nodes = descendants([root]), view = source.presentationDetails?.viewports[viewport];
      const explicit = (options.identities ?? []).filter(identity => identity.blockId === blockId && identity.sourceNodeId === item.selector && (!identity.viewport || identity.viewport === viewport));
      const candidates: PresentationBinding[] = [];
      if (item.kind === 'block') candidates.push({ id: item.id, elementKey: root.key });
      if (item.kind === 'content-frame' && source.contentBounds?.[viewport]?.sourceNodeId === item.selector && target.contentBindings?.[viewport]) candidates.push({ id: item.id, elementKey: target.contentBindings[viewport] });
      if (view) {
        const measured = presentationItems(view).filter(region => region.sourceNodeId === item.selector && (item.kind !== 'control' || item.role === 'action' || 'role' in region && region.role === item.role));
        for (const region of measured) candidates.push(...(target.presentationBindings ?? []).filter(binding => binding.id === region.id));
      }
      if (item.kind === 'repeated-template' && source.dynamicData && target.productQuery) {
        const template = view?.catalogTemplate;
        const owners = Array.isArray(item.facts.itemSelectors) ? item.facts.itemSelectors.filter((value): value is string => typeof value === 'string') : [];
        if (template && template.visibleFraction >= .6 && template.slots.length && owners.some(owner => within(template.sourceNodeId, owner) || template.sourceAncestorSelectors?.includes(owner)) && source.dynamicData.items.some(owner => catalogTemplateOwnedBy(owner, template, viewport))) candidates.push({ id: item.id, elementKey: target.productQuery.widgetKey });
      }
      const observed = packet?.blocks.find(block => block.id === item.sourceBlockId);
      if (!candidates.length) candidates.push(...staticFeatureCandidates(item, source, target, root, observed, options.manifest));
      for (const identity of explicit) {
        if (!identity.evidence.length || identity.evidence.some(id => !knownEvidence.has(id)) || identity.relativeSelector !== undefined && !isSafePresentationSelector(identity.relativeSelector)) {
          result.gaps.push({ code: 'source-native-identity-invalid', viewport, sourceId: item.id, message: 'Compiler identity needs known evidence and a bounded native descendant selector.' }); continue;
        }
        candidates.push({ id: item.id, elementKey: identity.elementKey, ...(identity.relativeSelector ? { relativeSelector: identity.relativeSelector } : {}) });
      }
      // A static action can reuse its exact static text binding. Directional
      // controls cannot be inferred from a matching word or button position.
      if (!candidates.length && item.kind === 'control' && item.role === 'action' && packet) {
        const atom = observed?.textAtoms?.filter(atom => atom.selector === item.selector && atom.text).map(atom => normalized(atom.text!)).join(' ');
        if (atom) for (const binding of target.bindings) {
          const text = source.texts.find(text => text.id === binding.sourceTextId), node = nodes.find(node => node.key === binding.elementKey);
          if (text && normalized(text.text) === atom && node && typeof readSettingPath(node.settings, binding.settingPath) === 'string' && normalized(readSettingPath(node.settings, binding.settingPath) as string) === atom) candidates.push({ id: item.id, elementKey: node.key });
        }
      }
      const valid = candidates.filter(binding => {
        const node = nodes.find(node => node.key === binding.elementKey);
        return !!node && (item.kind !== 'control' || node.type !== 'container' || !!binding.relativeSelector);
      });
      const unique = [...new Map(valid.map(binding => [binding.elementKey + '\0' + (binding.relativeSelector ?? ''), binding])).values()];
      if (unique.length !== 1) {
        result.gaps.push({ code: unique.length ? 'source-feature-binding-ambiguous' : 'source-feature-native-identity-unresolved', viewport, sourceId: item.id, message: 'Observed ' + item.kind + ' needs a unique real same-block native identity; a root placeholder or arbitrary selector cannot establish coverage.' }); continue;
      }
      const binding = unique[0];
      result.bindings.push({ viewport, sourceId: item.id, blockId: source.id, targetKey: binding.elementKey, requirement: item.kind, state: item.state });
      const measured = view && presentationItems(view).some(region => region.sourceNodeId === item.selector);
      if ((!['block', 'content-frame'].includes(item.kind) && !measured) && (item.kind === 'repeated-template' && !source.dynamicData || item.kind === 'control' && item.role === 'action')) {
        const evidenceId = packet?.evidenceId;
        const sourceRoot = roots.find(root => root.sourceBlockId === item.sourceBlockId);
        if (evidenceId && knownEvidence.has(evidenceId) && sourceRoot && finiteRect(item.rect)) result.presentation.push({ blockId: source.id, viewport, region: { id: measuredId('region', item.selector), sourceNodeId: item.selector, evidence: [evidenceId], visible: item.visible, rect: { ...item.rect, x: item.rect.x - sourceRoot.rect.x, y: item.rect.y - sourceRoot.rect.y }, geometryRole: item.kind === 'control' ? 'control' : 'content', ...(observed?.nodes?.find(node => node.selector === item.selector)?.style ? { paint: measuredPaint(observed.nodes.find(node => node.selector === item.selector)!.style) } : {}) }, binding: { ...binding, id: measuredId('region', item.selector) } });
      }
    }
  }
  return result;
}

function measuredPaint(style: Record<string, string> = {}): PresentationPaint {
  const result: PresentationPaint = {};
  for (const [key, property] of Object.entries({ color: 'color', backgroundColor: 'background-color', borderColor: 'border-top-color', fontWeight: 'font-weight', fontFamily: 'font-family', textAlign: 'text-align', boxShadow: 'box-shadow' })) if (style[property]) (result as Record<string, unknown>)[key] = style[property];
  for (const [key, property] of Object.entries({ borderWidth: 'border-top-width', borderRadius: 'border-top-left-radius', opacity: 'opacity', fontSize: 'font-size', lineHeight: 'line-height' })) {
    const raw = style[property], value = raw && /^(?:-?\d+(?:\.\d+)?)(?:px)?$/.test(raw.trim()) ? Number.parseFloat(raw) : undefined;
    if (value !== undefined && Number.isFinite(value)) (result as Record<string, unknown>)[key] = value;
  }
  return result;
}
/** Freeze a physically observed card. Slot roles must have independent semantic identities. */
export function measureSourceCatalogTemplate(options: {
  card: SourceBindingObservedNode; blockRect: SourceSceneRect; evidenceId: string;
  slots: Array<{ role: CatalogSlotRole; node: SourceBindingObservedNode; maxLines?: number; heightMode?: 'fixed' | 'content'; maxHeight?: number }>;
}): { template?: PresentationCatalogTemplate; gaps: SourceSceneGap[] } {
  const { card, blockRect, evidenceId, slots } = options, gaps: SourceSceneGap[] = [];
  const visibility = card.visibility ?? card.lineLayout?.visibility, fraction = visibility?.clippedRatio === undefined ? undefined : 1 - visibility.clippedRatio;
  if (!finiteRect(card.rect) || !finiteRect(blockRect) || card.visible === false || visibility?.painted === false || fraction === undefined || fraction < .6 || !Number.isFinite(fraction) || fraction > 1) gaps.push({ code: 'source-catalog-card-unobserved', sourceId: card.selector, message: 'Card geometry and at least 60% physically painted visibility must be independently observed.' });
  if (!evidenceId || !card.selector || !slots.length || new Set(slots.map(slot => slot.role)).size !== slots.length) gaps.push({ code: 'source-catalog-slots-unresolved', sourceId: card.selector, message: 'Each semantic catalog slot needs one unique measured role and an evidence identity.' });
  for (const slot of slots) if ((!within(slot.node.selector, card.selector) && !slot.node.ancestorSelectors?.includes(card.selector)) || !finiteRect(slot.node.rect) || slot.node.visible === false || slot.maxLines !== undefined && (!Number.isInteger(slot.maxLines) || slot.maxLines <= 0) || slot.maxHeight !== undefined && (!Number.isFinite(slot.maxHeight) || slot.maxHeight <= 0)) gaps.push({ code: 'source-catalog-slot-invalid', sourceId: slot.node.selector, message: 'A catalog slot must be a finite physically measured descendant of its own card.' });
  if (gaps.length) return { gaps };
  const measured = slots.map(slot => ({ role: slot.role, rect: { ...slot.node.rect, x: slot.node.rect.x - card.rect.x, y: slot.node.rect.y - card.rect.y }, visible: true, paint: measuredPaint(slot.node.style), ...(slot.node.style?.['object-fit'] ? { fit: slot.node.style['object-fit'] } : {}), ...(slot.node.style?.['object-position'] ? { objectPosition: slot.node.style['object-position'] } : {}), ...(slot.maxLines === undefined ? {} : { maxLines: slot.maxLines }), ...(slot.heightMode ? { heightMode: slot.heightMode } : {}), ...(slot.maxHeight === undefined ? {} : { maxHeight: slot.maxHeight }) }));
  const ordered = [...measured].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x), order = ordered.map(slot => slot.role);
  const template: PresentationCatalogTemplate = { sourceNodeId: card.selector, ...(card.ancestorSelectors?.length ? { sourceAncestorSelectors: [...card.ancestorSelectors] } : {}), evidence: [evidenceId], rect: { ...card.rect, x: card.rect.x - blockRect.x, y: card.rect.y - blockRect.y }, visibleFraction: fraction!, paint: measuredPaint(card.style), slots: measured, order, gaps: ordered.slice(1).map((slot, index) => ({ from: ordered[index].role, to: slot.role, axis: 'y' as const, valuePx: slot.rect.y - ordered[index].rect.y - ordered[index].rect.height })) };
  return { template, gaps };
}
