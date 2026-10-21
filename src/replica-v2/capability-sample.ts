import type { TargetCatalogEvidence } from '../fidelity/catalog-contract.js';
import type { LegacySchema } from '../wordpress/types.js';
import { compileReplicaV2, referencedAssetsV2, replicaIdV2 } from './compile.js';
import { validateProgramV2 } from './validate.js';
import { walkComponentsV2, type ComponentV2, type HtmlStaticComponentV2, type ProgramV2, type ReplicaStage } from './types.js';

export interface CapabilitySampleV2 {
  sampleProgram: ProgramV2;
  html?: { sourceComponentKey: string; componentKey: string; elementId: string; scopeId: string; selector: string; text: string; ctaText: string; backgroundColor: string; padding: number; gridColumns: number };
  carousel?: { sourceComponentKey: string; componentKey: string; elementId: string; slideKeys: string[]; slideElementIds: string[]; htmlElementId?: string; headingElementId: string; text: string; pagination: string; slidesToShow: 1 };
  products?: { sourceComponentKey: string; componentKey: string; elementId: string; productIds: number[] };
}

/** Internal, temporary capability sample. It is never a source-fidelity delivery program. */
export function buildCapabilitySampleV2(input: ProgramV2, schemas: Record<string, LegacySchema>, catalog?: TargetCatalogEvidence, stage: ReplicaStage = 'desktop'): CapabilitySampleV2 {
  const program = validateProgramV2(input), nodes = walkComponentsV2(program.blocks, stage);
  const root = nodes.find(node => program.blocks.some(block => block.key === node.key));
  if (!root) throw new Error('Capability sample requires a current-stage owned root');
  const prefix = root.key.slice(0, 65), children: ComponentV2[] = [], result: CapabilitySampleV2 = { sampleProgram: { ...program, blocks: [] } };
  const html = nodes.find(node => node.kind === 'html-static' && Object.values(node.slots.text).some(text => text.trim())) ?? nodes.find(node => node.kind === 'html-static');
  const carousel = nodes.find(node => node.kind === 'native-carousel'), product = nodes.find(node => node.kind === 'native-products');
  const sourceTexts = html?.kind === 'html-static' ? Object.values(html.slots.text) : [];
  const nativeSource = nodes.find(node => node.kind === 'native' && node.widgetType === 'heading' && typeof node.widgetSettings.title === 'string' && node.widgetSettings.title.trim());
  const firstText = sourceTexts.find(value => value.trim()) ?? (nativeSource?.kind === 'native' ? String(nativeSource.widgetSettings.title) : 'cloneWP capability sample');
  const ctaText = sourceTexts.find(value => value.trim() && value !== firstText) ?? firstText;
  const createHtml = (key: string): HtmlStaticComponentV2 => {
    const sourceLink = html?.kind === 'html-static' ? Object.values(html.slots.links)[0] : undefined;
    return { key, kind: 'html-static', contentRole: 'decoration', template: `<div class="sample"><span data-cwp-text="copy"></span>${sourceLink ? '<a class="cta" data-cwp-link="entry"><span data-cwp-text="cta"></span></a>' : '<span class="cta" data-cwp-text="cta"></span>'}</div>`, css: '.sample{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px;background:#f0f5fa}.cta{display:block;background:#ffcb00;color:#222;padding:12px 24px;border-radius:8px}', slots: { text: { copy: firstText, cta: ctaText }, media: {}, links: sourceLink ? { entry: structuredClone(sourceLink) } : {} } };
  };
  if (html?.kind === 'html-static') {
    const sample = createHtml(`${prefix}-capability-html`); children.push(sample);
    const id = replicaIdV2(program.taskId, `${sample.key}-content`), scopeId = `cwp-${id}`;
    result.html = { sourceComponentKey: html.key, componentKey: sample.key, elementId: id, scopeId, selector: `#${scopeId} .sample`, text: firstText, ctaText, backgroundColor: 'rgb(240, 245, 250)', padding: 16, gridColumns: 2 };
  }
  if (carousel?.kind === 'native-carousel') {
    const schema = schemas[carousel.widgetType], nativeChildren = schema?.nativeChildren;
    if (!nativeChildren) throw new Error(`Capability sample needs discovered nested-carousel child controls: ${carousel.key}`);
    if (!schemas.heading?.controls.title) throw new Error(`Mixed carousel capability sample requires discovered native heading.title controls: ${carousel.key}`);
    const settings = zeroMediaSettings(carousel.widgetSettings, schema);
    delete settings[nativeChildren.repeaterKey]; delete settings.custom_css;
    const select = (key: string, value: string): void => {
      const control = schema.controls[key];
      if (!control || control.options && !Object.hasOwn(control.options, value)) throw new Error(`Capability sample cannot prove registered nested-carousel.${key}=${value}: ${carousel.key}`);
      settings[key] = value;
    };
    select('slides_to_show', '1');
    if (schema.controls.slides_to_scroll) select('slides_to_scroll', '1');
    select('autoplay', 'no'); select('arrows', 'yes');
    const pagination = String(settings.pagination ?? schema.controls.pagination?.default ?? '');
    if (!['bullets', 'fraction', 'progressbar'].includes(pagination)) throw new Error(`Capability sample requires an authored, registered carousel pagination mode: ${carousel.key}`);
    select('pagination', pagination);
    // Responsive display counts must not hide the second sample slide during a probe.
    for (const key of Object.keys(settings)) if (/^slides_to_(?:show|scroll)_/.test(key)) delete settings[key];
    const key = `${prefix}-capability-carousel`, firstKey = `${prefix}-capability-slide-html`, headingKey = `${prefix}-capability-slide-native`;
    const text = firstText;
    const heading: ComponentV2 = { key: headingKey, kind: 'native', widgetType: 'heading', widgetSettings: { title: text } };
    const first: ComponentV2 = html ? createHtml(firstKey) : { ...structuredClone(heading), key: firstKey };
    children.push({ key, kind: 'native-carousel', widgetType: 'nested-carousel', widgetSettings: settings, slides: [first, heading] });
    result.carousel = { sourceComponentKey: carousel.key, componentKey: key, elementId: replicaIdV2(program.taskId, `${key}-carousel`), slideKeys: [firstKey, headingKey], slideElementIds: [firstKey, headingKey].map(slide => replicaIdV2(program.taskId, slide)), ...(html ? { htmlElementId: replicaIdV2(program.taskId, `${firstKey}-content`) } : {}), headingElementId: replicaIdV2(program.taskId, `${headingKey}-native`), text, pagination, slidesToShow: 1 };
  }
  if (product?.kind === 'native-products') {
    if (!catalog) throw new Error(`Capability sample needs the actual target catalog: ${product.key}`);
    const count = Math.min(2, product.query.count), key = `${prefix}-capability-products`, settings = zeroMediaSettings(product.widgetSettings, schemas.wd_products);
    delete settings.items_per_page; delete settings.include;
    children.push({ ...structuredClone(product), key, settings: {}, widgetSettings: settings, query: { ...product.query, count, ...(product.query.ids ? { ids: product.query.ids.slice(0, count) } : {}) } });
    result.products = { sourceComponentKey: product.key, componentKey: key, elementId: replicaIdV2(program.taskId, `${key}-products`), productIds: [] };
  }
  // A native-only page has no new HTML, carousel or commerce capability to prove.
  if (!children.length) return result;
  result.sampleProgram.blocks = [{ key: root.key, kind: 'composite', settings: {}, children }];
  if (referencedAssetsV2(result.sampleProgram, stage, schemas).size) throw new Error('Capability sample must not import media');
  const compiled = compileReplicaV2(result.sampleProgram, schemas, [], catalog, stage);
  if (result.products) result.products.productIds = compiled.queryReceipts[0].productIds;
  return result;
}

function zeroMediaSettings(input: Record<string, unknown>, schema?: LegacySchema): Record<string, unknown> {
  const containsMedia = (value: unknown): boolean => !!value && typeof value === 'object' && (Array.isArray(value) ? value.some(containsMedia) : Object.hasOwn(value, '$asset') || typeof (value as Record<string, unknown>).url === 'string' && Object.hasOwn(value, 'id') || Object.values(value).some(containsMedia));
  return Object.fromEntries(Object.entries(structuredClone(input)).filter(([key, value]) => !['media', 'gallery'].includes(schema?.controls[key]?.type ?? '') && !containsMedia(value)));
}
