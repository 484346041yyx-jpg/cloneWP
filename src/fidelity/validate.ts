import { z } from 'zod';
import type { BlockContract, NativeElement, NativeProgram, SourceAssetManifest } from './types.js';
import { isSafePresentationSelector } from './presentation-contract.js';
import { presentationDetailsSchema } from './presentation-schema.js';
export { presentationDetailsSchema } from './presentation-schema.js';
import { sourceSceneBindingSchema } from '../reference/source-scene.js';

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,100}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.strictObject({ path: z.string().min(1), sha256: hash });
const url = z.string().url().refine(value => { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; }, 'Only credential-free public HTTP(S) URLs are allowed');
const presentation = z.enum(['static', 'grid', 'carousel', 'accordion', 'navigation', 'form']);
const evidence = z.array(z.string().min(1).max(200)).max(300);
const state = z.strictObject({ status: z.enum(['observed', 'not-applicable', 'unobserved']), evidence, note: z.string().max(2000).optional(), properties: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()])).optional() });
const states = z.strictObject({ normal: state, hover: state, interaction: state });
const catalogSource = z.strictObject({ provider: z.literal('target-woocommerce'), kind: z.literal('product-list'), replaceableTextIds: z.array(key).min(1).max(300), replaceableAssetKeys: z.array(key).min(1).max(300), items: z.array(z.strictObject({ sourceNodeId: z.string().min(1).max(3000), sourceNodeIds: z.record(z.string().min(1).max(100), z.string().min(1).max(3000)).optional(), textIds: z.array(key).min(1).max(300), assetKeys: z.array(key).min(1).max(300), evidence: evidence.min(1) })).min(1).max(300), evidence: evidence.min(1) });
const productQuery = z.strictObject({ provider: z.literal('target-woocommerce'), widgetKey: key, widgetType: z.literal('wd_products'), sourceTextIds: z.array(key).min(1).max(300), sourceAssetKeys: z.array(key).min(1).max(300), queryControlKeys: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/)).min(1).max(30), styleBindings: z.strictObject({ nameSourceTextIds: z.array(key).max(300), priceSourceTextIds: z.array(key).max(300) }).optional(), carouselMode: z.strictObject({ control: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/), value: z.string().min(1).max(100) }).optional(), evidence: evidence.min(1) });
const node: z.ZodType<NativeElement> = z.lazy(() => z.strictObject({ key, type: z.string().regex(/^[a-z][a-z0-9_-]{0,100}$/), settings: z.record(z.string(), z.unknown()), children: z.array(node).max(300).optional() }));
export const blockContractSchema: z.ZodType<BlockContract> = z.strictObject({
  version: z.literal(1), workflow: z.literal('block-replication'), sourceUrl: url, capturedAt: z.string().datetime(), referenceReport: file,
  evidence: z.array(z.strictObject({ id: z.string().min(1), path: z.string().min(1), sha256: hash, kind: z.enum(['dom', 'screenshot', 'interaction', 'observation']) })).min(1).max(1000),
  tolerances: z.strictObject({ geometryPx: z.number().finite().min(0).max(250), geometryRatio: z.number().finite().min(0).max(0.35), colorChannel: z.number().int().min(0).max(50) }),
  sourceSceneBindings: z.array(sourceSceneBindingSchema).max(20000).optional(),
  blocks: z.array(z.strictObject({
    id: key, role: z.string().min(1).max(100), presentation, requiredWidgetTypes: z.array(z.string().min(1)).max(30).optional(),
    texts: z.array(z.strictObject({ id: key, text: z.string().min(1).max(20000), kind: z.enum(['heading', 'body', 'label', 'product-name', 'price', 'rating', 'navigation', 'other']) })).max(300),
    assets: z.array(key).max(300), evidence,
    geometry: z.record(z.string(), z.strictObject({ width: z.number().finite().positive(), height: z.number().finite().positive(), columns: z.number().int().min(1).max(30).optional() })),
    contentBounds: z.record(z.string().min(1), z.strictObject({ x: z.number().finite().min(-250), width: z.number().finite().positive(), viewportWidth: z.number().finite().positive(), sourceNodeId: z.string().min(1).max(3000), evidence: evidence.min(1) })).optional(),
    presentationDetails: presentationDetailsSchema.optional(),
    dynamicData: catalogSource.optional(),
    colors: z.record(z.string(), z.string().max(200)), states,
  })).min(1).max(60), limitations: z.array(z.string().min(1).max(3000)).max(300),
}).superRefine((contract, context) => {
  contract.blocks.forEach((block, index) => { for (const [viewport, box] of Object.entries(block.contentBounds ?? {})) {
    if (box.x < -contract.tolerances.geometryPx || box.x + box.width > box.viewportWidth + contract.tolerances.geometryPx) context.addIssue({code:'custom',path:['blocks',index,'contentBounds',viewport],message:'Source content bounds must fit its measured viewport within the declared pixel tolerance'});
  } });
});
export const sourceAssetManifestSchema: z.ZodType<SourceAssetManifest> = z.strictObject({ version: z.literal(1), sourceUrl: url, downloadedAt: z.string().datetime(), assets: z.array(z.strictObject({ key, sourceUrl: url, localPath: z.string().min(1), sha256: hash, alt: z.string().max(2000), mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']), provenance: z.string().min(1).max(2000) })).max(300) });
export const nativeProgramSchema: z.ZodType<NativeProgram> = z.strictObject({
  version: z.literal(1), workflow: z.literal('block-replication'), title: z.string().min(1).max(200), sourceUrl: url, sourceContract: file, assetsManifest: file,
  elements: z.array(node).min(1).max(60),
  blocks: z.array(z.strictObject({ sourceBlockId: key, rootKey: key, presentation, contentBindings: z.record(z.string().min(1), key).optional(), presentationBindings: z.array(z.strictObject({ id: key, elementKey: key, relativeSelector: z.string().refine(isSafePresentationSelector, 'Presentation selectors must remain bounded native descendants').optional() })).max(1000).optional(), presentationGaps: z.array(z.strictObject({ viewport: z.string().min(1).max(100), id: key, capability: z.string().min(1).max(300), reason: z.string().min(15).max(3000), evidence: evidence.min(1), scope: z.enum(['item', 'glyph']).optional() })).max(1000).optional(), productQuery: productQuery.optional(), bindings: z.array(z.strictObject({ sourceTextId: key, elementKey: key, settingPath: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*(?:\.(?:[A-Za-z_][A-Za-z0-9_-]*|\d+))*$/) })).max(300), states })).min(1).max(60),
  deviations: z.array(z.strictObject({ blockId: key, category: z.enum(['geometry', 'behavior', 'asset', 'data', 'state']), reason: z.string().min(15).max(3000), evidence })).max(300),
});
export const normalizeText = (text: string) => text.normalize('NFC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
/** Run before target authentication; a sibling block cannot stand in for this content box. */
export function validateContentBoundsBindings(contract: BlockContract, program: NativeProgram): void {
  const knownEvidence = new Set(contract.evidence.map(item => item.id));
  for (const source of contract.blocks) {
    const target = program.blocks.find(block => block.sourceBlockId === source.id);
    if (!target) throw new Error(`Source content bounds have no target block: ${source.id}`);
    const root = program.elements.find(element => element.key === target.rootKey);
    const descendants = new Set<string>();
    const visit = (element: NativeElement) => { descendants.add(element.key); for (const child of element.children ?? []) visit(child); };
    if (root) visit(root);
    for (const [viewport, bounds] of Object.entries(source.contentBounds ?? {})) {
      if (bounds.x < -contract.tolerances.geometryPx || bounds.x + bounds.width > bounds.viewportWidth + contract.tolerances.geometryPx) throw new Error(`Source content bounds exceed the evidenced viewport tolerance: ${source.id}/${viewport}`);
      if (!source.geometry[viewport]) throw new Error(`Source content bounds lack corresponding block geometry: ${source.id}/${viewport}`);
      if (!bounds.evidence.length || bounds.evidence.some(id => !knownEvidence.has(id))) throw new Error(`Source content bounds lack known evidence: ${source.id}/${viewport}`);
      const contentKey = target.contentBindings?.[viewport];
      if (!contentKey || !descendants.has(contentKey)) throw new Error(`Content bounds binding is missing or crosses its source block: ${source.id}/${viewport}`);
    }
    for (const viewport of Object.keys(target.contentBindings ?? {})) if (!source.contentBounds?.[viewport]) throw new Error(`Native content binding has no source bounds: ${source.id}/${viewport}`);
  }
}
export function readSettingPath(settings: Record<string, unknown>, settingPath: string): unknown {
  let value: unknown = settings;
  for (const segment of settingPath.split('.')) {
    if (['__proto__', 'constructor', 'prototype'].includes(segment)) throw new Error('Unsafe native setting path');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}
/** No HTML, script, shortcodes or remote embeds may impersonate a native block. */
export function validateNativeProgram(input: unknown): NativeProgram {
  const program = nativeProgramSchema.parse(input), seen = new Set<string>();
  const visit = (element: NativeElement, depth: number) => {
    if (seen.has(element.key)) throw new Error(`Repeated native element key: ${element.key}`);
    if (depth > 30 || seen.size > 2500) throw new Error('Native program exceeds tree limits');
    if (['html', 'shortcode', 'template', 'global', 'wp-widget-custom_html', 'code-highlight'].includes(element.type)) throw new Error('Native blocks cannot be HTML, shortcodes, templates or global embeds');
    seen.add(element.key);
    const settingsText = JSON.stringify(element.settings);
    validateFiniteNativeSettings(element.settings, element.key);
    if (/<\s*(?:script|iframe|object|embed)\b|\son[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html/i.test(settingsText)) throw new Error(`Executable native setting rejected: ${element.key}`);
    if (Object.keys(element.settings).some(name => /^(?:html|htmlCache|custom_js|custom_code|shortcode)$/i.test(name))) throw new Error(`Non-native rendering setting rejected: ${element.key}`);
    if (typeof element.settings.custom_css === 'string' && /@import|url\s*\(|expression|javascript|<\s*style/i.test(element.settings.custom_css)) throw new Error('Native CSS cannot import remote or executable content');
    for (const child of element.children ?? []) visit(child, depth + 1);
  };
  for (const root of program.elements) { if (root.type !== 'container') throw new Error('Each source block requires a top-level native container'); visit(root, 0); }
  return program;
}

/** Invalid calculated dimensions must fail locally before credentials or target writes. */
export function validateFiniteNativeSettings(value: unknown, label = 'native setting', dimension = false): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Non-finite native setting rejected: ${label}`);
  if (typeof value === 'string' && (/(?:calc|min|max|clamp)\([^)]*(?:NaN|Infinity)/i.test(value) || dimension && /(?:^|[\s:,])(?:NaN|[-+]?Infinity)(?:px|em|rem|%|vh|vw|vmin|vmax)?(?:$|[\s;,])/i.test(value))) throw new Error(`Non-finite native dimension rejected: ${label}`);
  if (Array.isArray(value)) value.forEach((item, index) => validateFiniteNativeSettings(item, `${label}[${index}]`, dimension));
  else if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) validateFiniteNativeSettings(child, `${label}.${name}`, dimension || /^(?:size|top|right|bottom|left|width|height|min_width|max_width|min_height|max_height|custom_css)$/.test(name));
}
