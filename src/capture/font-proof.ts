import { mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { isTextFontCandidate } from './fonts.js';
import type { SourceCapture, SourceElement } from './types.js';

export interface FrozenFontProof {
  version: 1;
  purpose: 'Supplement actual rendered font usage after exact frozen text/layout/style guards; never rewrite frozen facts';
  checkedAt: string;
  sourceUrl: string;
  freshCapturedAt?: string;
  warnings: string[];
  nodes: Array<{ viewport: string; sourceId: string; status: 'verified' | 'unverified' | 'already-present'; reason?: string }>;
}
const FONT_STYLE_KEYS = ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'direction'];
export function frozenFontFactGuard(original: SourceElement, fresh: SourceElement): string | undefined {
  if (original.id !== fresh.id || original.tag !== fresh.tag) return 'Node identity or tag changed';
  if (original.directText !== fresh.directText || original.text !== fresh.text) return 'Loaded text differs from the frozen source';
  for (const key of ['x', 'y', 'width', 'height'] as const) if (Math.abs(original.rect[key] - fresh.rect[key]) > .5) return `Frozen ${key} differs from the current source`;
  for (const key of FONT_STYLE_KEYS) if (Object.hasOwn(original.style, key) && original.style[key] !== fresh.style[key]) return `Frozen computed ${key} differs from the current source`;
  if (!fresh.renderedFonts?.length) return 'Current browser did not establish actual rendered font evidence';
  return undefined;
}

/** Read-only fresh source proof, returned as a supplemental clone; the supplied source object/files stay untouched. */
export async function hydrateFrozenRenderedFonts(source: SourceCapture, options: { timeoutMs?: number; allowLocalForTests?: boolean } = {}): Promise<{ source: SourceCapture; proof: FrozenFontProof }> {
  const supplemented = structuredClone(source);
  const proof: FrozenFontProof = { version: 1, purpose: 'Supplement actual rendered font usage after exact frozen text/layout/style guards; never rewrite frozen facts', checkedAt: new Date().toISOString(), sourceUrl: source.url, warnings: [], nodes: [] };
  const pending = source.viewports.flatMap(viewport => viewport.elements.filter(isTextFontCandidate).filter(element => !element.renderedFonts?.length));
  if (!pending.length) {
    for (const viewport of source.viewports) for (const node of viewport.elements.filter(isTextFontCandidate)) proof.nodes.push({ viewport: viewport.name, sourceId: node.id, status: 'already-present' });
    return { source: supplemented, proof };
  }
  const temporaryRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, 'clonewp-font-proof-'));
  try {
    const { captureSource } = await import('./index.js');
    const fresh = await captureSource({ url: source.url, runDir: directory, viewports: source.viewports.map(({ name, width, height }) => ({ name, width, height })), timeoutMs: options.timeoutMs ?? 30000, allowLocalForTests: options.allowLocalForTests });
    proof.freshCapturedAt = fresh.capturedAt;
    proof.warnings.push(...fresh.warnings);
    for (const viewport of supplemented.viewports) {
      const current = fresh.viewports.find(item => item.name === viewport.name && item.width === viewport.width && item.height === viewport.height);
      for (const node of viewport.elements.filter(isTextFontCandidate)) {
        if (node.renderedFonts?.length) { proof.nodes.push({ viewport: viewport.name, sourceId: node.id, status: 'already-present' }); continue; }
        const observed = current?.elements.find(item => item.id === node.id);
        const reason = observed ? frozenFontFactGuard(node, observed) : 'Frozen source node or viewport is absent from current source';
        if (reason) proof.nodes.push({ viewport: viewport.name, sourceId: node.id, status: 'unverified', reason });
        else { node.renderedFonts = structuredClone(observed!.renderedFonts); proof.nodes.push({ viewport: viewport.name, sourceId: node.id, status: 'verified' }); }
      }
    }
  } catch (error) {
    proof.warnings.push(`Read-only font proof could not be established: ${error instanceof Error ? error.message : String(error)}`);
    for (const viewport of supplemented.viewports) for (const node of viewport.elements.filter(isTextFontCandidate).filter(item => !item.renderedFonts?.length)) proof.nodes.push({ viewport: viewport.name, sourceId: node.id, status: 'unverified', reason: 'Fresh source proof unavailable' });
  } finally {
    const resolved = await realpath(directory);
    if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('clonewp-font-proof-')) throw new Error('Refused to remove an unexpected font proof directory');
    await rm(resolved, { recursive: true, force: true });
  }
  return { source: supplemented, proof };
}
