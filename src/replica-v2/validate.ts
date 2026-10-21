import { z } from 'zod';
import type { ComponentV2, ProgramV2 } from './types.js';
import { componentChildrenV2 } from './types.js';
import { renderStaticHTML, validateNativeCSSV2 } from './html.js';

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,100}$/);
const ref = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const settings = z.record(z.string(), z.unknown());
const base = { key, settings: settings.optional(), stage: z.enum(['desktop', 'responsive']).optional(), sourceFactIds: z.array(z.string().min(1)).optional() };
const media = z.object({ assetKey: key, alt: z.string().optional(), responsive: z.array(z.object({ assetKey: key, media: z.string().min(1) }).strict()).optional() }).strict();
const component: z.ZodType<ComponentV2> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('native'), widgetType: z.string().min(1), widgetSettings: settings, children: z.array(component).optional() }).strict(),
  z.object({ ...base, kind: z.literal('html-static'), template: z.string().min(1).max(500000), css: z.string().max(300000), responsiveCss: z.string().max(300000).optional(), contentRole: z.enum(['marketing', 'navigation', 'category', 'service', 'decoration', 'footer']).optional(), slots: z.object({ text: z.record(key, z.string()), media: z.record(key, media), links: z.record(key, z.object({ url: z.string().min(1), isExternal: z.boolean().optional(), title: z.string().optional() }).strict()) }).strict() }).strict(),
  z.object({ ...base, kind: z.literal('native-carousel'), widgetType: z.literal('nested-carousel'), widgetSettings: settings, slides: z.array(component).min(1).max(100) }).strict(),
  z.object({ ...base, kind: z.literal('native-products'), widgetType: z.literal('wd_products'), widgetSettings: settings, query: z.object({ count: z.number().int().min(1).max(200), offset: z.number().int().min(0).optional(), ids: z.array(z.number().int().positive()).min(1).max(200).optional(), evidence: z.array(z.string().min(1)).min(1) }).strict() }).strict(),
  z.object({ ...base, kind: z.literal('composite'), children: z.array(component).min(1) }).strict(),
]));
const programSchema = z.object({
  version: z.literal(2), workflow: z.literal('block-replication'), taskId: key, title: z.string().min(1), sourceUrl: z.url(),
  sourceFacts: ref, componentPlan: ref, assetsManifest: ref,
  viewports: z.array(z.object({ name: key, width: z.number().int().min(240).max(8000), height: z.number().int().min(200).max(8000), stage: z.enum(['desktop', 'responsive']) }).strict()).min(1),
  blocks: z.array(component).min(1),
}).strict();

function finite(value: unknown, path: string, depth = 0): void {
  if (depth > 40) throw new Error(`v2 value exceeds bounded depth: ${path}`);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Non-finite v2 value: ${path}`);
  if (typeof value === 'string' && (value.includes('[MaxDepth]') || /(?:settings|widgetSettings|\.css|responsiveCss)/.test(path) && /\b(?:NaN|Infinity)\b/.test(value))) throw new Error(`Truncated or non-finite v2 value: ${path}`);
  if (Array.isArray(value)) value.forEach((item, index) => finite(item, `${path}[${index}]`, depth + 1));
  else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error(`Unsafe v2 key: ${path}.${name}`);
    finite(item, `${path}.${name}`, depth + 1);
  }
}
export function validateProgramV2(input: unknown): ProgramV2 {
  finite(input, 'program');
  const result = programSchema.parse(input);
  const source = new URL(result.sourceUrl);
  if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) throw new Error('Public v2 source URL required');
  const keys = new Set<string>();
  const visit = (node: ComponentV2, depth: number) => {
    if (depth > 16 || keys.size >= 2500 || keys.has(node.key)) throw new Error(`Duplicate or excessive v2 component tree: ${node.key}`);
    keys.add(node.key);
    for (const [owner, values] of [['settings', node.settings], ['widgetSettings', 'widgetSettings' in node ? node.widgetSettings : undefined]] as const) {
      if (values?.custom_css !== undefined) {
        if (typeof values.custom_css !== 'string') throw new Error(`V2 component ${node.key}.${owner}.custom_css must be a string`);
        try { validateNativeCSSV2(values.custom_css, `${node.key}:${owner}`); }
        catch (error) { throw new Error(`V2 component ${node.key}.${owner}.custom_css: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
      }
    }
    if (node.kind === 'native' && ['html', 'shortcode', 'code-highlight', 'wd_products', 'nested-carousel'].includes(node.widgetType)) throw new Error(`Use the explicit v2 component type for ${node.widgetType}`);
    if (node.kind === 'html-static') {
      // Validate source template semantics locally before any target authentication.
      // Synthetic identities are discarded; only actual imported bytes can produce the run's write composition.
      const assetKeys = [...new Set(Object.values(node.slots.media).flatMap(slot => [slot.assetKey, ...(slot.responsive ?? []).map(source => source.assetKey)]))];
      const symbolic = assetKeys.map((assetKey, index) => ({ key: assetKey, attachmentId: index + 1, sourceUrl: `https://asset-preflight.invalid/${assetKey}`, url: `https://asset-preflight.invalid/${assetKey}`, sha256: '0'.repeat(64), mimeType: 'image/png' }));
      renderStaticHTML(node, result.taskId, 'abcdef1', symbolic, 'final');
    }
    if (node.kind === 'native-products' && node.query.ids) {
      if (new Set(node.query.ids).size !== node.query.ids.length || node.query.offset || node.query.ids.length !== node.query.count) throw new Error(`Explicit product IDs must be unique and equal query count: ${node.key}`);
    }
    componentChildrenV2(node).forEach(child => visit(child, depth + 1));
  };
  result.blocks.forEach(block => visit(block, 0));
  if (!result.viewports.some(viewport => viewport.stage === 'desktop') || new Set(result.viewports.map(viewport => viewport.name)).size !== result.viewports.length) throw new Error('v2 requires uniquely named viewports and a desktop baseline');
  return result;
}
