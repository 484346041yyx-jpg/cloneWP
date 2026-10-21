import type { PresentationRect } from './presentation-contract.js';
import { isSafePresentationSelector } from './presentation-contract.js';
import { validateScopedNativeCSS } from './scoped-css.js';

type Insets = { top: number | 'auto'; right: number | 'auto'; bottom: number | 'auto'; left: number | 'auto' };
type Margins = { top: number; right: number; bottom: number; left: number };
type Viewport = { name: string; width: number };
export interface ControlAlignmentInput {
  /** All rectangles, including the actual positioning padding-box, share this block-relative frame. */
  coordinateSpace: { kind: 'block-relative'; sourceBlockId: string };
  ownerBinding: { sourceOwnerId: string; nativeOwnerKey: string; evidence: string[] };
  source: { status: 'observed'; blockId: string; groupId: string; ownerId: string; viewport: Viewport; rect: PresentationRect; evidence: string[] };
  target: {
    blockId: string; sourceGroupId: string; nativeOwnerKey: string; viewport: Viewport;
    relativeSelector: string; matchedCount: 1; rect: PresentationRect; evidence: string[];
    position: 'absolute'; insets: Insets; margins: Margins;
    /** CSSOM resolved values can turn undeclared opposing insets into pixel values.
     * Supply the actual cascade's anchor proof in that case; a computed number alone
     * cannot distinguish a controlling inset from a resolved used offset. */
    anchorEvidence?: { horizontal: 'left' | 'right'; vertical: 'top' | 'bottom'; opposingInsets: 'declared-auto'; evidence: string[] };
    /** A measured own transform. Ancestor scaling/rotation is separately ruled out below. */
    transform: 'none' | { a: number; b: number; c: number; d: number; e: number; f: number };
    containingBlock: {
      nativeOwnerKey: string; relativeSelector: string; matchedCount: 1;
      rect: PresentationRect; box: 'css-positioning-padding-box'; cssPixels: 'unscaled-axis-aligned'; evidence: string[];
    };
  };
  viewport: Viewport & { breakpoint?: { minWidth?: number; maxWidth?: number }; evidence: string[] };
  maxTranslationPx?: number; dimensionTolerancePx?: number; positioningTolerancePx?: number;
}
export interface ControlAlignmentReceipt {
  version: 1; status: 'already-aligned' | 'translation-proposed';
  sourceBlockId: string; sourceGroupId: string; sourceOwnerId: string; nativeOwnerKey: string;
  relativeSelector: string; viewport: ControlAlignmentInput['viewport'];
  sourceRect: PresentationRect; targetRect: PresentationRect; predictedRect: PresentationRect;
  actualContainingBlock: ControlAlignmentInput['target']['containingBlock'];
  positioningAnchors: { horizontal: 'left' | 'right'; vertical: 'top' | 'bottom'; evidence?: ControlAlignmentInput['target']['anchorEvidence'] };
  beforeInsets: Insets; afterInsets: Insets; delta: { x: number; y: number; distance: number };
  /** Insert this rule only in the exact recorded native breakpoint cascade. */
  localRule: string;
  /** Present only when the full intended range can be expressed by the bounded CSS grammar. */
  css?: string;
  emission: 'no-change' | 'scoped-css' | 'requires-existing-breakpoint-context';
  evidence: string[]; fidelityPassGranted: false; verification: 'requires-browser-remeasurement';
}
const fail = (reason: string): never => { throw Error(`Control translation rejected: ${reason}`); };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
const rect = (value: PresentationRect) => value && [value.x, value.y, value.width, value.height].every(finite) && value.width > 0 && value.height > 0;
const evidence = (items: string[]) => Array.isArray(items) && items.length > 0 && items.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 2000);
const px = (value: number) => `${Math.round(value * 1000) / 1000}px`;

/** Pure bounded correction over measured geometry. No website names, widget-root origin guesses,
 * document mutations, CSS scaling or source/target behavior equivalence are inferred here. */
export function planControlAlignment(input: ControlAlignmentInput): ControlAlignmentReceipt {
  const { source, target, ownerBinding: binding, viewport } = input;
  if (input.coordinateSpace?.kind !== 'block-relative' || !input.coordinateSpace.sourceBlockId || source.blockId !== input.coordinateSpace.sourceBlockId || target.blockId !== source.blockId) fail('source, target and containing-block geometry require the same explicit block-relative frame');
  if (source.status !== 'observed' || !evidence(source.evidence) || !evidence(target.evidence) || !evidence(binding.evidence) || !evidence(viewport.evidence)) fail('independent observed source, target, owner and viewport evidence is required');
  if (!source.groupId || target.sourceGroupId !== source.groupId || !binding.sourceOwnerId || !binding.nativeOwnerKey || source.ownerId !== binding.sourceOwnerId || target.nativeOwnerKey !== binding.nativeOwnerKey) fail('source control group and target binding have different owners');
  if (!viewport.name || !finite(viewport.width) || viewport.width < 320 || viewport.width > 16384 || source.viewport.name !== viewport.name || target.viewport.name !== viewport.name || source.viewport.width !== viewport.width || target.viewport.width !== viewport.width) fail('source and target must have the same independently observed viewport');
  const bounds = viewport.breakpoint;
  if (bounds && (bounds.minWidth === undefined && bounds.maxWidth === undefined || [bounds.minWidth, bounds.maxWidth].some(value => value !== undefined && (!Number.isInteger(value) || value < 320 || value > 2560)) || bounds.minWidth !== undefined && viewport.width < bounds.minWidth || bounds.maxWidth !== undefined && viewport.width > bounds.maxWidth || bounds.minWidth !== undefined && bounds.maxWidth !== undefined && bounds.minWidth > bounds.maxWidth)) fail('the recorded native breakpoint does not contain this observed viewport');
  const cb = target.containingBlock;
  if (!rect(source.rect) || !rect(target.rect) || !cb || !rect(cb.rect) || !evidence(cb.evidence) || cb.nativeOwnerKey !== binding.nativeOwnerKey || cb.matchedCount !== 1 || cb.box !== 'css-positioning-padding-box' || cb.cssPixels !== 'unscaled-axis-aligned') fail('the actual unscaled CSS positioning padding-box must be independently measured under the same native owner');
  if (target.matchedCount !== 1 || !/^[.\[]/.test(target.relativeSelector) || !isSafePresentationSelector(target.relativeSelector) || cb.relativeSelector !== ':scope' && (!/^[.\[]/.test(cb.relativeSelector) || !isSafePresentationSelector(cb.relativeSelector))) fail('control and containing-block selectors must identify unique bounded nodes inside this native widget');
  const sizeTolerance = input.dimensionTolerancePx ?? .25, positionTolerance = input.positioningTolerancePx ?? .5, max = input.maxTranslationPx ?? 32;
  if (!finite(sizeTolerance) || sizeTolerance < 0 || sizeTolerance > .5 || !finite(positionTolerance) || positionTolerance < 0 || positionTolerance > 2 || !finite(max) || max <= 0 || max > 128) fail('translation tolerances exceed their local bounds');
  if (Math.abs(source.rect.width - target.rect.width) > sizeTolerance || Math.abs(source.rect.height - target.rect.height) > sizeTolerance) fail('different control dimensions need layout/scale repair, not translation');
  const transform = target.transform === 'none' ? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } : target.transform;
  if (!transform || ![transform.a, transform.b, transform.c, transform.d, transform.e, transform.f].every(finite) || Math.abs(transform.a - 1) > .000001 || Math.abs(transform.d - 1) > .000001 || Math.abs(transform.b) > .000001 || Math.abs(transform.c) > .000001) fail('rotation or scaling cannot be repaired as a pure translation');
  const insets = target.insets, margins = target.margins;
  if (target.position !== 'absolute' || !insets || !margins || !['top', 'right', 'bottom', 'left'].every(key => finite(margins[key as keyof Margins])) || !['top', 'right', 'bottom', 'left'].every(key => insets[key as keyof Insets] === 'auto' || finite(insets[key as keyof Insets]))) fail('actual absolute pixel insets and computed margins are required');
  const anchorProof = target.anchorEvidence;
  if (anchorProof && (!['left', 'right'].includes(anchorProof.horizontal) || !['top', 'bottom'].includes(anchorProof.vertical) || anchorProof.opposingInsets !== 'declared-auto' || !evidence(anchorProof.evidence))) fail('resolved CSS insets need independently evidenced actual cascade anchors with opposing declared auto');
  const xAnchor = anchorProof?.horizontal ?? (typeof insets.left === 'number' && insets.right === 'auto' ? 'left' : typeof insets.right === 'number' && insets.left === 'auto' ? 'right' : undefined);
  const yAnchor = anchorProof?.vertical ?? (typeof insets.top === 'number' && insets.bottom === 'auto' ? 'top' : typeof insets.bottom === 'number' && insets.top === 'auto' ? 'bottom' : undefined);
  if (!xAnchor || !yAnchor) fail('each axis needs one actual absolute anchor; static or overconstrained positioning is ambiguous');
  if (!finite(insets[xAnchor!]) || !finite(insets[yAnchor!])) fail('the evidenced controlling insets must resolve to actual finite pixel offsets');
  const actualX = xAnchor === 'left' ? cb.rect.x + Number(insets.left) + margins.left + transform.e : cb.rect.x + cb.rect.width - Number(insets.right) - margins.right - target.rect.width + transform.e;
  const actualY = yAnchor === 'top' ? cb.rect.y + Number(insets.top) + margins.top + transform.f : cb.rect.y + cb.rect.height - Number(insets.bottom) - margins.bottom - target.rect.height + transform.f;
  if (Math.abs(actualX - target.rect.x) > positionTolerance || Math.abs(actualY - target.rect.y) > positionTolerance) fail('the claimed containing-block origin/insets do not explain the actual target position');
  const x = source.rect.x - target.rect.x, y = source.rect.y - target.rect.y, distance = Math.hypot(x, y);
  if (distance > max + .000001) fail('required translation exceeds the bounded correction distance');
  // Normalize CSSOM-only used values back to the proved declared auto. Never emit
  // those resolved opposing values: setting both sides would change the layout.
  const after: Insets = { ...insets, [xAnchor === 'left' ? 'right' : 'left']: 'auto', [yAnchor === 'top' ? 'bottom' : 'top']: 'auto' }, declarations: string[] = [];
  if (Math.abs(x) > .001) { after[xAnchor!] = Number(insets[xAnchor!]) + (xAnchor === 'left' ? x : -x); declarations.push(`${xAnchor}:${px(Number(after[xAnchor!]))};`); }
  if (Math.abs(y) > .001) { after[yAnchor!] = Number(insets[yAnchor!]) + (yAnchor === 'top' ? y : -y); declarations.push(`${yAnchor}:${px(Number(after[yAnchor!]))};`); }
  if (Object.values(after).some(value => typeof value === 'number' && Math.abs(value) > 16384)) fail('corrected native pixel insets exceed the local visual bound');
  const localRule = declarations.length ? `selector ${target.relativeSelector}{${declarations.join('')}}` : '';
  if (localRule) validateScopedNativeCSS(localRule);
  let css: string | undefined, emission: ControlAlignmentReceipt['emission'] = localRule ? 'requires-existing-breakpoint-context' : 'no-change';
  if (!localRule) css = '';
  else if (bounds && (bounds.minWidth === undefined || bounds.maxWidth === undefined)) {
    css = `@media(${bounds.minWidth === undefined ? 'max' : 'min'}-width:${bounds.minWidth ?? bounds.maxWidth}px){${localRule}}`;
    validateScopedNativeCSS(css); emission = 'scoped-css';
  }
  return { version: 1, status: localRule ? 'translation-proposed' : 'already-aligned', sourceBlockId: source.blockId, sourceGroupId: source.groupId, sourceOwnerId: source.ownerId, nativeOwnerKey: binding.nativeOwnerKey, relativeSelector: target.relativeSelector, viewport: structuredClone(viewport), sourceRect: { ...source.rect }, targetRect: { ...target.rect }, predictedRect: { ...target.rect, x: target.rect.x + (Math.abs(x) > .001 ? x : 0), y: target.rect.y + (Math.abs(y) > .001 ? y : 0) }, actualContainingBlock: structuredClone(cb), positioningAnchors: { horizontal: xAnchor!, vertical: yAnchor!, ...(anchorProof ? { evidence: structuredClone(anchorProof) } : {}) }, beforeInsets: { ...insets }, afterInsets: after, delta: { x, y, distance }, localRule, ...(css === undefined ? {} : { css }), emission, evidence: [...new Set([...source.evidence, ...target.evidence, ...binding.evidence, ...viewport.evidence, ...cb.evidence, ...(anchorProof?.evidence ?? [])])], fidelityPassGranted: false, verification: 'requires-browser-remeasurement' };
}
