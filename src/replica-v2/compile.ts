import { createHash } from 'node:crypto';
import { validatePlan, validateRegisteredChildren, validateRegisteredSettings, type ElementorElement, type ModelPlan } from '../planning/plan.js';
import type { TargetCatalogEvidence } from '../fidelity/catalog-contract.js';
import type { LegacySchema } from '../wordpress/types.js';
import { renderStaticHTML, validateNativeCSSV2 } from './html.js';
import { validateProgramV2 } from './validate.js';
import { componentChildrenV2, visibleAtStageV2, walkComponentsV2, type ComponentV2, type CompiledReplicaV2, type ImportedAssetV2, type ProgramV2, type ReplicaStage } from './types.js';
export type { CompiledReplicaV2, ProgramV2, ReplicaStage } from './types.js';

export const replicaIdV2 = (taskId: string, key: string): string => createHash('sha256').update(`clonewp-replica-v2:${taskId}:${key}`).digest('hex').slice(0, 7);
/** Desktop does not carry settings owned by a separately registered device. */
function stageSettingsV2(settings: Record<string, unknown>, stage: ReplicaStage, schema?: LegacySchema): Record<string, unknown> {
  if (stage !== 'desktop') return settings;
  return Object.fromEntries(Object.entries(settings).filter(([key]) => {
    const responsive = schema?.controls[key]?.responsive as { max?: unknown } | undefined;
    if (typeof responsive?.max === 'string' && responsive.max !== 'desktop') return false;
    return !/_(?:tablet|mobile)(?:_extra)?$/.test(key);
  }));
}
export function referencedAssetsV2(program: ProgramV2, stage: ReplicaStage = 'desktop', schemas?: Record<string, LegacySchema>): Set<string> {
  const keys = new Set<string>();
  const scan = (value: unknown): void => { if (Array.isArray(value)) value.forEach(scan); else if (value && typeof value === 'object') { const record = value as Record<string, unknown>; if (typeof record.$asset === 'string') keys.add(record.$asset); else Object.values(record).forEach(scan); } };
  for (const node of walkComponentsV2(program.blocks, stage)) {
    scan(stageSettingsV2(node.settings ?? {}, stage, schemas?.container)); if ('widgetSettings' in node) scan(stageSettingsV2(node.widgetSettings, stage, schemas?.[node.widgetType]));
    if (node.kind === 'html-static') for (const slot of Object.values(node.slots.media)) { keys.add(slot.assetKey); if (stage !== 'desktop') slot.responsive?.forEach(source => keys.add(source.assetKey)); }
  }
  return keys;
}
export function usedWidgetTypesV2(program: ProgramV2, stage: ReplicaStage = 'desktop'): string[] {
  return [...new Set(['container', ...walkComponentsV2(program.blocks, stage).flatMap(node => node.kind === 'html-static' ? ['html'] : 'widgetType' in node ? [node.widgetType] : [])])];
}

/** Prove live registered controls before importing assets or creating a document. No write composition is exposed. */
export function preflightReplicaV2(program: ProgramV2, schemas: Record<string, LegacySchema>, catalog?: TargetCatalogEvidence, stage: ReplicaStage = 'desktop'): { version: 2; passed: true; usedTypes: string[]; symbolicAssets: string[]; components: number } {
  const keys = [...referencedAssetsV2(program, stage, schemas)];
  const assets = keys.map((key, index) => ({ key, attachmentId: index + 1, sourceUrl: `https://asset-preflight.invalid/${key}`, url: `https://asset-preflight.invalid/${key}`, sha256: '0'.repeat(64), mimeType: 'image/png' }));
  const compiled = compileReplicaV2(program, schemas, assets, catalog, stage);
  return { version: 2, passed: true, usedTypes: compiled.usedTypes, symbolicAssets: keys, components: walkComponentsV2(program.blocks, stage).length };
}

export function compileReplicaV2(input: ProgramV2, schemas: Record<string, LegacySchema>, assets: ImportedAssetV2[], catalog?: TargetCatalogEvidence, stage: ReplicaStage = 'desktop'): CompiledReplicaV2 {
  const program = validateProgramV2(input), assetMap = new Map<string, ImportedAssetV2>();
  for (const asset of assets) {
    if (assetMap.has(asset.key) || !asset.key || !Number.isInteger(asset.attachmentId) || asset.attachmentId < 1 || !/^https?:\/\//.test(asset.url) || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Imported v2 media must have unique keys and proven attachment identities');
    const url = new URL(asset.url); if (url.username || url.password) throw new Error('Credentials are forbidden in imported media URLs');
    assetMap.set(asset.key, asset);
  }
  for (const key of referencedAssetsV2(program, stage, schemas)) if (!assetMap.has(key)) throw new Error(`Unresolved v2 asset: ${key}`);
  const result: CompiledReplicaV2 = { composition: { elements: [], pageSettings: { hide_title: 'yes', background_background: 'classic', background_color: '#FFFFFF' } }, plan: {} as ModelPlan, elementMap: {}, sectionIds: [], sections: [], usedTypes: [], htmlProofs: [], bindings: [], queryReceipts: [] };
  const usedTypes = new Set<string>(), ids = new Set<string>(), approvedCSS = new Set<string>(), queriedIds = new Set<number>();
  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === 'object') { const record = value as Record<string, unknown>; if (Object.hasOwn(record, '$asset')) { const asset = typeof record.$asset === 'string' && assetMap.get(record.$asset); if (!asset || Object.keys(record).length !== 1) throw new Error('Unresolved or malformed symbolic media'); return { id: asset.attachmentId, url: asset.url }; } return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, resolve(item)])); }
    return value;
  };
  const native = (key: string, type: string, settings: Record<string, unknown>, children: ElementorElement[], depth: number, componentKey = key): ElementorElement => {
    const id = replicaIdV2(program.taskId, key), schema = schemas[type];
    if (!schema?.controls) throw new Error(`Undiscovered v2 widget controls: ${componentKey}/${type}`);
    if (ids.has(id)) throw new Error(`Duplicate v2 target ID: ${key}`); ids.add(id); usedTypes.add(type); result.elementMap[key] = id;
    try {
      if (typeof settings.custom_css === 'string' && settings.custom_css) { settings.custom_css = validateNativeCSSV2(settings.custom_css, `${componentKey}:${type}`); approvedCSS.add(settings.custom_css as string); }
      validateRegisteredSettings(type, settings, schema, { allowedMedia: assets });
      validateRegisteredChildren(type, settings, children.map(child => child.elType === 'container' ? 'container' : child.widgetType ?? ''), schema);
    } catch (error) { throw new Error(`V2 component ${componentKey}, widget ${type}, element ${key}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
    return { id, elType: type === 'container' ? 'container' : 'widget', ...(type === 'container' ? { isInner: depth > 0 } : { widgetType: type }), settings, elements: children };
  };
  const compile = (node: ComponentV2, depth: number): ElementorElement => {
    const children = componentChildrenV2(node).filter(child => visibleAtStageV2(child, stage));
    const outerSettings = resolve(stageSettingsV2(node.settings ?? {}, stage, schemas.container)) as Record<string, unknown>;
    let content: ElementorElement[];
    if (node.kind === 'composite') content = children.map(child => compile(child, depth + 1));
    else if (node.kind === 'html-static') {
      const widgetKey = `${node.key}-content`, id = replicaIdV2(program.taskId, widgetKey), proof = renderStaticHTML(node, program.taskId, id, assets, stage);
      result.htmlProofs.push(proof); result.bindings.push(...proof.bindings);
      content = [native(widgetKey, 'html', { html: proof.html }, [], depth + 1, node.key)];
    } else if (node.kind === 'native-carousel') {
      const schema = schemas[node.widgetType], nested = schema?.nativeChildren;
      if (!nested || nested.childType !== 'container' || !/^[a-f0-9]{64}$/.test(nested.sourceSha256)) throw new Error(`Unproven native carousel relationship: ${node.key}`);
      const settings = resolve(stageSettingsV2(node.widgetSettings, stage, schemas[node.widgetType])) as Record<string, unknown>;
      const provided = settings[nested.repeaterKey];
      if (provided !== undefined && (!Array.isArray(provided) || provided.length !== children.length)) throw new Error(`Carousel rows differ from current-stage slides: ${node.key}`);
      settings[nested.repeaterKey] ??= children.map((child, index) => ({ _id: replicaIdV2(program.taskId, `${node.key}-row-${child.key}`), [nested.titleSettingKey]: `Slide ${index + 1}` }));
      content = [native(`${node.key}-carousel`, node.widgetType, settings, children.map(child => compile(child, depth + 2)), depth + 1, node.key)];
    } else if (node.kind === 'native-products') {
      const schema = schemas.wd_products;
      if (schema?.class !== 'XTS\\Elementor\\Products' || schema.controls.post_type?.type !== 'select' || !schema.controls.post_type.options?.product || !catalog?.evidence.length || !catalog.products.length || new URL(catalog.targetOrigin).origin !== catalog.targetOrigin) throw new Error(`Native product query needs actual registered controls and catalog proof: ${node.key}`);
      const selected = node.query.ids ? node.query.ids.map(id => catalog.products.find(product => product.id === id)) : catalog.products.slice(node.query.offset ?? 0, (node.query.offset ?? 0) + node.query.count);
      if (selected.length !== node.query.count || selected.some(product => !product)) throw new Error(`Insufficient verified target products: ${node.key}`);
      const productIds = selected.map(product => product!.id);
      if (node.query.ids) {
        const actualDateOrder = catalog.products.filter(product => productIds.includes(product.id)).map(product => product.id);
        if (JSON.stringify(productIds) !== JSON.stringify(actualDateOrder)) throw new Error(`Explicit target IDs must preserve the actual catalog date-descending order; native include-order capability is not proven: ${node.key}`);
      }
      if (productIds.some(id => queriedIds.has(id))) throw new Error(`Overlapping target product rows: ${node.key}`); productIds.forEach(id => queriedIds.add(id));
      const settings = resolve(stageSettingsV2(node.widgetSettings, stage, schemas[node.widgetType])) as Record<string, unknown>;
      if (node.query.ids && settings.order !== undefined) {
        if (settings.order !== '') throw new Error(`Explicit target IDs cannot set the inactive native sort-order control: ${node.key}`);
        delete settings.order;
      }
      for (const key of ['categories', 'product_cat', 'taxonomies', 'exclude', 'featured', 'sale', 'best_selling', 'stock_status', 'hide_outofstock', 'query_id', 'meta_query', 'tax_query', 'paged', 'pagination']) if (Object.hasOwn(settings, key) && settings[key] !== '' && settings[key] !== false && settings[key] !== 'no') throw new Error(`Undeclared target product filter: ${node.key}/${key}`);
      const expected: Record<string, unknown> = { items_per_page: node.query.count, orderby: 'date', ...(node.query.ids ? { post_type: 'ids', include: productIds } : { post_type: 'product', offset: node.query.offset ?? 0, order: 'DESC' }) };
      for (const key of ['post_type', 'include', 'offset', 'items_per_page', 'orderby', 'order']) if (Object.hasOwn(settings, key) && Object.hasOwn(expected, key) && JSON.stringify(settings[key]) !== JSON.stringify(expected[key])) throw new Error(`Product settings conflict with frozen query: ${node.key}/${key}`);
      Object.assign(settings, expected);
      const widget = native(`${node.key}-products`, 'wd_products', settings, [], depth + 1, node.key); content = [widget];
      result.queryReceipts.push({ componentKey: node.key, elementId: widget.id, provider: 'target-woocommerce', targetOrigin: catalog.targetOrigin, productIds, evidence: [...new Set([...catalog.evidence, ...node.query.evidence])], settings });
    } else {
      const settings = resolve(stageSettingsV2(node.widgetSettings, stage, schemas[node.widgetType])) as Record<string, unknown>;
      const widget = native(`${node.key}-native`, node.widgetType, settings, children.map(child => compile(child, depth + 2)), depth + 1, node.key); content = [widget];
      for (const [path, value] of Object.entries(settings)) if (typeof value === 'string') result.bindings.push({ componentKey: node.key, elementId: widget.id, kind: 'native', settingPath: path, value });
    }
    return native(node.key, 'container', outerSettings, content, depth);
  };
  result.composition.elements = program.blocks.filter(block => visibleAtStageV2(block, stage)).map(block => compile(block, 0));
  if (!result.composition.elements.length) throw new Error('Current stage has no blocks');
  result.plan = { title: program.title, mode: 'legacy-verified', compositionJson: JSON.stringify(result.composition), mappings: Object.entries(result.elementMap).map(([sourceId, targetId]) => ({ sourceId, targetId })), unsupported: [], rationale: 'Version 2 component plan compiled into stable native containers, typed static HTML blocks and verified WooCommerce queries.' };
  const verified = validatePlan(result.plan, { mode: 'legacy-verified', widgetSchemas: schemas, maxElements: 2500, allowedMedia: assets, approvedCustomCSS: approvedCSS, htmlProofs: result.htmlProofs });
  result.composition = verified.composition as CompiledReplicaV2['composition']; result.plan = verified.plan; result.elementMap = verified.elementMap;
  const collect = (node: ElementorElement): string[] => [node.id, ...node.elements.flatMap(collect)];
  result.sections = result.composition.elements.map((node, index) => ({ key: program.blocks.filter(block => visibleAtStageV2(block, stage))[index].key, targetId: node.id, elementIds: collect(node) }));
  result.sectionIds = result.sections.map(section => section.targetId); result.usedTypes = [...usedTypes]; return result;
}
