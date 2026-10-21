import { validateScopedNativeCSS } from './scoped-css.js';
export { validateScopedNativeCSS } from './scoped-css.js';
import { createHash } from 'node:crypto';
import { validatePlan, validateRegisteredChildren, validateRegisteredSettings, type LegacyComposition, type ModelPlan, type ElementorElement } from '../planning/plan.js';
import type { ImportedAsset, LegacySchema } from '../wordpress/types.js';
import type { NativeElement, NativeProgram } from './types.js';
import type { TargetCatalogEvidence } from './catalog-contract.js';
import { validateFiniteNativeSettings } from './validate.js';

export type FidelityImportedAsset = ImportedAsset & { key: string };
export interface CompiledFidelity {
  composition: LegacyComposition; plan: ModelPlan; elementMap: Record<string, string>;
  sectionIds: string[]; sections: Array<{ key: string; targetId: string; elementIds: string[] }>;
  usedTypes: string[]; scopedCSS: Array<{ key: string; css: string }>;
}
export const fidelityIdFor = (key: string): string => createHash('sha256').update(`clonewp-fidelity:${key}`).digest('hex').slice(0, 7);
export function referencedFidelityAssets(elements: NativeElement[]): Set<string> {
  const keys = new Set<string>();
  const walk = (value: unknown): void => { if (Array.isArray(value)) { value.forEach(walk); return; } if (!value || typeof value !== 'object') return; const record = value as Record<string, unknown>; if (typeof record.$asset === 'string') keys.add(record.$asset); else Object.values(record).forEach(walk); };
  walk(elements); return keys;
}

export interface NativeControlPreflight {
  version: 1; passed: true; nativeElements: number; registeredSettings: number;
  usedTypes: string[]; symbolicAssets: string[]; scopedStylesheets: number;
}
/** Run immediately after control discovery, before creating a draft or importing media. */
export function preflightNativeControls(program: NativeProgram, schemas: Record<string, LegacySchema>): NativeControlPreflight {
  if (program.version !== 1 || program.workflow !== 'block-replication' || !program.title?.trim() || !Array.isArray(program.elements) || !program.elements.length) throw new Error('Invalid block replication program for native control preflight');
  if (program.elements.some(element => element.type !== 'container')) throw new Error('Every source block must be a top-level native container');
  const keys = new Set<string>(), ids = new Set<string>(), types = new Set<string>();
  const symbolicAssets = referencedFidelityAssets(program.elements); let registeredSettings = 0, scopedStylesheets = 0;
  const visit = (node: NativeElement, depth: number) => {
    if (depth > 16 || keys.size >= 2500 || !node || !/^[A-Za-z][A-Za-z0-9_-]{0,100}$/.test(node.key) || keys.has(node.key)) throw new Error('Native fidelity keys must be unique within bounded tree');
    if (!node.type || !schemas[node.type]?.controls || ['html', 'shortcode', 'code-highlight'].includes(node.type)) throw new Error(`Unregistered or non-native fidelity widget: ${node.type}`);
    if (!node.settings || typeof node.settings !== 'object' || Array.isArray(node.settings)) throw new Error('Native fidelity settings must be an object');
    keys.add(node.key); types.add(node.type); const id = fidelityIdFor(node.key);
    if (ids.has(id)) throw new Error('Native fidelity ID collision'); ids.add(id);
    validateFiniteNativeSettings(node.settings, node.key);
    validateRegisteredSettings(node.type, node.settings, schemas[node.type], { symbolicAssets });
    registeredSettings += Object.keys(node.settings).length;
    if (node.settings.custom_css) {
      if (schemas[node.type].controls.custom_css?.type !== 'code' || typeof node.settings.custom_css !== 'string') throw new Error('Native custom CSS must use the actual registered code control');
      validateScopedNativeCSS(node.settings.custom_css); scopedStylesheets++;
    }
    validateRegisteredChildren(node.type, node.settings, (node.children ?? []).map(child => child.type), schemas[node.type]);
    (node.children ?? []).forEach(child => visit(child, depth + 1));
  };
  program.elements.forEach(element => visit(element, 0));
  for (const block of program.blocks) if (block.productQuery) {
    const query = block.productQuery, schema = schemas[query.widgetType];
    if (query.widgetType !== 'wd_products' || schema?.class !== 'XTS\\Elementor\\Products' || schema.controls.post_type?.type !== 'select' || !schema.controls.post_type.options?.product) throw new Error('Target product query lacks the actual registered Woodmart data source contract');
    if (query.queryControlKeys.some(key => !schema.controls[key])) throw new Error('Target product query uses an undiscovered native query control');
    if (query.carouselMode && (query.carouselMode.control !== 'layout' || query.carouselMode.value !== 'carousel' || !schema.controls.layout?.options?.carousel)) throw new Error('Target product carousel lacks its actual registered render branch');
    const find = (nodes: NativeElement[]): NativeElement | undefined => { for (const node of nodes) { if (node.key === query.widgetKey) return node; const child = find(node.children ?? []); if (child) return child; } };
    const widget = find(program.elements);
    if (!widget || widget.type !== query.widgetType || !Number.isInteger(widget.settings.items_per_page) || Number(widget.settings.items_per_page) < 1 || Number(widget.settings.items_per_page) > 200) throw new Error('Native target product query must use its actual bounded native widget');
  }
  return { version: 1, passed: true, nativeElements: keys.size, registeredSettings, usedTypes: [...types], symbolicAssets: [...symbolicAssets].sort(), scopedStylesheets };
}

/** Compile a frozen block program using only current registered native controls and imported media. */
export function compileFidelity(program: NativeProgram, schemas: Record<string, LegacySchema>, assets: FidelityImportedAsset[], catalog?: TargetCatalogEvidence): CompiledFidelity {
  preflightNativeControls(program, schemas);
  const productQueries = new Map(program.blocks.filter(block => block.productQuery).map(block => [block.productQuery!.widgetKey, block.productQuery!]));
  if (productQueries.size && (!catalog?.evidence.length || !catalog.products.length || new URL(catalog.targetOrigin).origin !== catalog.targetOrigin)) throw new Error('Native product compilation requires actual target WooCommerce catalog evidence');
  for (const query of productQueries.values()) {
    const schema = schemas[query.widgetType];
    if (query.widgetType !== 'wd_products' || schema?.class !== 'XTS\\Elementor\\Products' || schema.controls.post_type?.type !== 'select' || !schema.controls.post_type.options?.product) throw new Error('Target product query lacks the actual registered Woodmart data source contract');
    if (query.queryControlKeys.some(key => !schema.controls[key])) throw new Error('Target product query uses an undiscovered native query control');
    if (query.carouselMode && (query.carouselMode.control !== 'layout' || query.carouselMode.value !== 'carousel' || !schema.controls.layout?.options?.carousel)) throw new Error('Target product carousel lacks its actual registered render branch');
  }
  if (program.version !== 1 || program.workflow !== 'block-replication' || !program.title?.trim() || !Array.isArray(program.elements) || !program.elements.length) throw new Error('Invalid block replication program');
  const media = new Map<string, FidelityImportedAsset>();
  for (const asset of assets) {
    if (!asset.key || media.has(asset.key) || !Number.isInteger(asset.attachmentId) || asset.attachmentId < 1 || !/^https?:\/\//.test(asset.url)) throw new Error('Imported fidelity media must have unique keys and registered attachments');
    const url = new URL(asset.url);
    if (url.username || url.password || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid imported fidelity media identity');
    media.set(asset.key, asset);
  }
  const keys = new Set<string>(), ids = new Set<string>(), usedTypes = new Set<string>();
  const mappings: ModelPlan['mappings'] = [], scopedCSS: CompiledFidelity['scopedCSS'] = [];
  const resolve = (value: unknown, context: string, depth = 0): unknown => {
    if (depth > 40) throw new Error('Native setting value exceeds bounded depth');
    if (Array.isArray(value)) return value.map(item => resolve(item, context, depth + 1));
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (Object.hasOwn(record, '$asset')) {
        if (Object.keys(record).length !== 1 || typeof record.$asset !== 'string' || !media.has(record.$asset)) throw new Error(`Unknown native asset reference: ${context}`);
        const asset = media.get(record.$asset)!;
        return { id: asset.attachmentId, url: asset.url };
      }
      return Object.fromEntries(Object.entries(record).map(([key, item]) => {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe native setting key');
        return [key, resolve(item, `${context}.${key}`, depth + 1)];
      }));
    }
    return value;
  };
  const compile = (node: NativeElement, depth: number): ElementorElement => {
    if (depth > 16 || keys.size >= 2500 || !node || !/^[A-Za-z][A-Za-z0-9_-]{0,100}$/.test(node.key) || keys.has(node.key)) throw new Error('Native fidelity keys must be unique within bounded tree');
    if (!node.type || !schemas[node.type]?.controls || ['html', 'shortcode', 'code-highlight'].includes(node.type)) throw new Error(`Unregistered or non-native fidelity widget: ${node.type}`);
    if (!node.settings || typeof node.settings !== 'object' || Array.isArray(node.settings)) throw new Error('Native fidelity settings must be an object');
    keys.add(node.key); usedTypes.add(node.type);
    const id = fidelityIdFor(node.key);
    if (ids.has(id)) throw new Error('Native fidelity ID collision');
    ids.add(id); mappings.push({ sourceId: node.key, targetId: id });
    const settings = resolve(node.settings, node.key) as Record<string, unknown>;
    const productQuery = productQueries.get(node.key);
    if (productQuery) {
      if (!Number.isInteger(settings.items_per_page) || Number(settings.items_per_page) < 1 || Number(settings.items_per_page) > 200) throw new Error('Native target product query must use a bounded result count');
      if (settings.post_type === 'ids') {
        const ids = settings.include;
        if (!Array.isArray(ids) || !ids.length || ids.some(id => !catalog!.products.some(product => product.id === Number(id)))) throw new Error('Native product IDs must belong to the actual target catalog');
      }
    }
    if (Object.hasOwn(settings, 'custom_css') && settings.custom_css) {
      if (schemas[node.type].controls.custom_css?.type !== 'code' || typeof settings.custom_css !== 'string') throw new Error('Native custom CSS must use the actual registered code control');
      validateScopedNativeCSS(settings.custom_css); scopedCSS.push({ key: node.key, css: settings.custom_css });
    }
    for (const [name, value] of Object.entries(settings)) {
      const control = schemas[node.type].controls[name];
      if (!control) throw new Error(`Undiscovered setting ${node.type}.${name}`);
      if (control.type === 'switcher' && control.options && (typeof value !== 'string' || (value !== '' && !Object.hasOwn(control.options, value)))) throw new Error(`Invalid native switcher ${node.type}.${name}`);
      if (control.type === 'gaps') {
        const gaps = value as Record<string, unknown>;
        if (!gaps || typeof gaps !== 'object' || Array.isArray(gaps) || !Array.isArray(control.size_units) || !control.size_units.includes(gaps.unit) || ['column', 'row'].some(side => typeof gaps[side] !== 'string' && typeof gaps[side] !== 'number' || !/^-?\d*(?:\.\d+)?$/.test(String(gaps[side])))) throw new Error(`Invalid native gaps ${node.key}.${name}`);
      }
    }
    const children = (node.children ?? []).map(child => compile(child, depth + 1));
    return { id, elType: node.type === 'container' ? 'container' : 'widget', ...(node.type === 'container' ? { isInner: depth > 0 } : { widgetType: node.type }), settings, elements: children };
  };
  if (program.elements.some(node => node.type !== 'container')) throw new Error('Every source block must be a top-level native container');
  const composition: LegacyComposition = { elements: program.elements.map(node => compile(node, 0)), pageSettings: { hide_title: 'yes', background_background: 'classic', background_color: '#FFFFFF' } };
  const plan: ModelPlan = { title: program.title, mode: 'legacy-verified', compositionJson: JSON.stringify(composition), mappings, unsupported: program.deviations.map(item => `${item.blockId}: ${item.reason}`), rationale: 'Frozen source blocks compiled into independently editable native Elementor elements; fidelity is verified against the source block contract.' };
  const verified = validatePlan(plan, { mode: 'legacy-verified', widgetSchemas: schemas, maxElements: 2500, allowedMedia: assets, approvedCustomCSS: new Set(scopedCSS.map(item => item.css)) });
  const collect = (node: ElementorElement): string[] => [node.id, ...node.elements.flatMap(collect)];
  return { composition: verified.composition as LegacyComposition, plan: verified.plan, elementMap: verified.elementMap, sectionIds: composition.elements.map(node => node.id), sections: composition.elements.map((node, index) => ({ key: program.elements[index].key, targetId: node.id, elementIds: collect(node) })), usedTypes: [...usedTypes], scopedCSS };
}
