import { createHash } from 'node:crypto';
import type { SourceSceneGap, SourceSceneItem } from './source-scene.js';

type RecordValue = Record<string, unknown>;
export interface ScopedSourceBoundary {
  id: string; role?: string; selector?: string; selectors?: string[]; sourceIndices?: number[];
  rect?: { x: number; y: number; width: number; height: number };
}
export interface SourceBoundaryCandidate {
  selector: string; index?: number; sourceIndex?: number; ownerBlockId?: string; ownerBlockIds?: string[];
  excluded?: boolean; exclusionEvidence?: string[]; [key: string]: unknown;
}
export interface ScopedSourcePacket extends RecordValue {
  version: 1;
  observedPage: { url: string; title?: string; viewport: { width: number; height: number }; pageHeight?: number };
  blocks: ScopedSourceBoundary[];
  sourceScene?: { version: 1; method: string; viewport: RecordValue; state: string; items: SourceSceneItem[]; gaps: SourceSceneGap[]; enumeration?: RecordValue; [key: string]: unknown };
}
export interface SourceBoundaryInventory extends ScopedSourcePacket {
  deviceFacts?: RecordValue;
  boundaryObservation?: RecordValue & { candidates?: SourceBoundaryCandidate[] };
  majorChildren?: SourceBoundaryCandidate[];
  candidates?: SourceBoundaryCandidate[];
}
export interface ScopedSourceReceipt { blockId: string; packet: ScopedSourcePacket; evidencePath?: string; sha256?: string }
export interface ScopedMergeReceipt {
  version: 1; method: 'complete-independent-boundaries-and-scoped-packets'; sourceUrl: string;
  viewport: { width: number; height: number }; boundaryHash: string;
  blocks: Array<{ blockId: string; order: number; selectors: string[]; sourceIndices: number[]; packetHash: string; evidencePath?: string; evidenceSha256?: string }>;
  candidates: Array<{ selector: string; sourceIndex: number; ownerBlockId?: string; excluded: boolean }>;
  resolvedGaps: Array<{ code: 'scene-scoped-observation'; blockId: string }>;
  notice: string;
}
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sameSet = (left: string[], right: string[]) => left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
const selectors = (block: ScopedSourceBoundary) => block.selectors ?? (block.selector ? [block.selector] : []);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const finiteRect = (value: unknown) => record(value) && ['x', 'y', 'width', 'height'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]));

/** Merge full per-block observations only after independently measured boundary/candidate coverage is complete. */
export function mergeScopedSourcePackets(options: { boundary: SourceBoundaryInventory; packets: ScopedSourceReceipt[] }): ScopedSourcePacket & { mergeReceipt: ScopedMergeReceipt } {
  const { boundary, packets } = options, page = boundary.observedPage;
  if (boundary.version !== 1 || !page?.url || !positive(page.viewport?.width) || !positive(page.viewport?.height) || !Array.isArray(boundary.blocks) || !boundary.blocks.length) throw new Error('A valid independently captured boundary inventory is required');
  const candidates = boundary.boundaryObservation?.candidates ?? boundary.candidates ?? boundary.majorChildren;
  if (!Array.isArray(candidates)) throw new Error('Independent DOM candidate coverage is required before scoped observations can merge');
  const ids = new Set<string>(), rootOwners = new Map<string, string>(), indexOwners = new Map<number, string>();
  for (const block of boundary.blocks) {
    const roots = selectors(block);
    if (!block.id || ids.has(block.id) || !roots.length || roots.some(value => typeof value !== 'string' || !value.trim()) || new Set(roots).size !== roots.length) throw new Error('Declared source boundaries need distinct IDs and actual root selectors');
    ids.add(block.id);
    for (const root of roots) { if (rootOwners.has(root)) throw new Error('A source root cannot belong to multiple declared boundaries'); rootOwners.set(root, block.id); }
    for (const index of block.sourceIndices ?? []) {
      if (!Number.isInteger(index) || index < 0 || indexOwners.has(index)) throw new Error('DOM candidate source indices must have exactly one boundary owner');
      indexOwners.set(index, block.id);
    }
  }
  const candidateRows: ScopedMergeReceipt['candidates'] = [], seenCandidates = new Set<string>(), seenIndices = new Set<number>();
  for (const candidate of candidates) {
    const index = candidate.sourceIndex ?? candidate.index;
    if (!candidate.selector || seenCandidates.has(candidate.selector) || !Number.isInteger(index) || index! < 0 || seenIndices.has(index!)) throw new Error('Independent DOM candidates require distinct selectors and source indices');
    seenCandidates.add(candidate.selector); seenIndices.add(index!);
    const explicitOwners = candidate.ownerBlockIds ?? (candidate.ownerBlockId ? [candidate.ownerBlockId] : []), declared = indexOwners.get(index!);
    if (candidate.excluded === true) {
      if (!Array.isArray(candidate.exclusionEvidence) || !candidate.exclusionEvidence.length || explicitOwners.length || declared) throw new Error('Excluded DOM candidates need observed exclusion evidence and cannot also be owned');
      candidateRows.push({ selector: candidate.selector, sourceIndex: index!, excluded: true }); continue;
    }
    if (explicitOwners.length > 1 || explicitOwners.length === 1 && (!ids.has(explicitOwners[0]) || declared && declared !== explicitOwners[0])) throw new Error('Independent candidate ownership conflicts with declared boundary grouping');
    const owner = explicitOwners[0] ?? declared ?? rootOwners.get(candidate.selector);
    if (!owner || !ids.has(owner)) throw new Error('Every independent DOM candidate must have exactly one declared boundary responsibility');
    candidateRows.push({ selector: candidate.selector, sourceIndex: index!, ownerBlockId: owner, excluded: false });
  }
  for (const index of indexOwners.keys()) if (!seenIndices.has(index)) throw new Error('Declared boundary source index is absent from independent DOM candidates');
  const receipts = new Map<string, ScopedSourceReceipt>();
  for (const receipt of packets) {
    if (!ids.has(receipt.blockId) || receipts.has(receipt.blockId)) throw new Error('Every declared source boundary must be covered exactly once; extra or duplicate packets are forbidden');
    if (receipt.sha256 && (!receipt.evidencePath || !/^[a-f\d]{64}$/i.test(receipt.sha256))) throw new Error('Scoped artifact byte hashes require an actual evidence path and SHA-256 value');
    receipts.set(receipt.blockId, receipt);
  }
  if (receipts.size !== boundary.blocks.length) throw new Error('Scoped observations are incomplete: every declared boundary needs one full packet');
  const blocks: ScopedSourceBoundary[] = [], items: SourceSceneItem[] = [], gaps: SourceSceneGap[] = [], sceneIds = new Set<string>(), receiptRows: ScopedMergeReceipt['blocks'] = [], resolvedGaps: ScopedMergeReceipt['resolvedGaps'] = [], observedNodes: unknown[] = [];
  let firstScene: NonNullable<ScopedSourcePacket['sourceScene']> | undefined;
  for (const [order, boundaryBlock] of boundary.blocks.entries()) {
    const receipt = receipts.get(boundaryBlock.id)!, packet = receipt.packet, scene = packet.sourceScene;
    if (packet.version !== 1 || packet.observedPage?.url !== page.url || packet.observedPage.viewport.width !== page.viewport.width || packet.observedPage.viewport.height !== page.viewport.height || packet.observedPage.title !== page.title) throw new Error('Scoped source packets must describe the same source page, title and actual viewport');
    if (!Array.isArray(packet.blocks) || packet.blocks.length !== 1 || packet.blocks[0].id !== boundaryBlock.id || !sameSet(selectors(packet.blocks[0]), selectors(boundaryBlock))) throw new Error('Scoped packet root selectors must match every declared boundary root exactly');
    if (!scene || scene.version !== 1 || scene.method !== 'independent-public-dom-scene' || scene.state !== 'resting' || !Array.isArray(scene.items) || !Array.isArray(scene.gaps) || !record(scene.viewport) || scene.viewport.width !== page.viewport.width || scene.viewport.height !== page.viewport.height) throw new Error('Each full scoped packet needs its own independent source scene at the actual viewport');
    if (scene.enumeration?.scope !== boundaryBlock.id) throw new Error('Scoped packet enumeration scope must identify its declared block');
    if (!Array.isArray(scene.enumeration.rootSelectors) || !sameSet(scene.enumeration.rootSelectors as string[], selectors(boundaryBlock))) throw new Error('Scoped enumeration did not actually visit every boundary root');
    if (!scene.items.some(item => item.kind === 'block' && item.sourceBlockId === boundaryBlock.id)) throw new Error('Each scoped packet must independently enumerate its own source block');
    const deviceKeys = ['clientWidth', 'devicePixelRatio', 'touch', 'coarsePointer'];
    if (firstScene && deviceKeys.some(key => firstScene!.viewport[key] !== scene.viewport[key])) throw new Error('Scoped source packets cannot mix different device contexts');
    firstScene ??= scene;
    for (const item of scene.items) {
      if (!item || !item.id || typeof item.selector !== 'string' || !finiteRect(item.rect) || !Array.isArray(item.evidence) || !item.evidence.length || !record(item.facts)) throw new Error('Scoped source scene contains malformed or circularly serialized facts; fresh lossless observation is required');
      if (item.sourceBlockId && item.sourceBlockId !== boundaryBlock.id) throw new Error('Scoped source scene item belongs to an unexpected source boundary');
      if (sceneIds.has(item.id)) throw new Error('Scoped source scene identities overlap across boundary packets');
      sceneIds.add(item.id); items.push(item.kind === 'block' ? { ...item, facts: { ...item.facts, order, orderEvidence: 'independently-captured-boundary-inventory' } } : item);
    }
    for (const gap of scene.gaps) if (gap.code === 'scene-scoped-observation') resolvedGaps.push({ code: gap.code, blockId: boundaryBlock.id }); else gaps.push(gap);
    blocks.push(packet.blocks[0]);
    if (Array.isArray(packet.observedNodes)) observedNodes.push(...packet.observedNodes);
    receiptRows.push({ blockId: boundaryBlock.id, order, selectors: selectors(boundaryBlock), sourceIndices: boundaryBlock.sourceIndices ?? [], packetHash: digest(packet), ...(receipt.evidencePath ? { evidencePath: receipt.evidencePath } : {}), ...(receipt.sha256 ? { evidenceSha256: receipt.sha256 } : {}) });
  }
  // Boundary-level unknowns are never erased by collecting smaller packets.
  if (boundary.sourceScene?.gaps) gaps.push(...boundary.sourceScene.gaps);
  const mergeReceipt: ScopedMergeReceipt = { version: 1, method: 'complete-independent-boundaries-and-scoped-packets', sourceUrl: page.url, viewport: { ...page.viewport }, boundaryHash: digest(boundary), blocks: receiptRows, candidates: candidateRows, resolvedGaps, notice: 'Only scene-scoped-observation gaps were discharged by exact complete independently captured block/candidate coverage. All ownership, device, budget, paint and behavior gaps remain. Receipt hashes identify in-memory packet JSON; optional evidenceSha256 identifies separately saved artifact bytes.' };
  return { ...boundary, blocks, observedNodes, sourceScene: { ...firstScene!, items, gaps, enumeration: { scope: 'verified-boundary-union', method: 'verified-scoped-union', blockCount: blocks.length, candidateCount: candidates.length, packetCount: packets.length }, notice: mergeReceipt.notice }, mergeReceipt };
}
