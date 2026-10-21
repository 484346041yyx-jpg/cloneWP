import type { BlockContract, CatalogSourceData, NativeElement, NativeProductQuery, NativeProgram, SourceAssetManifest } from './types.js';
import type { TargetElementEvidence } from '../verification/types.js';
import type { SourcePaintAtom, SourceTextPaintPacket } from './text-paint.js';
import type { CatalogTemplateSlot, PresentationCatalogTemplate, PresentationPaint, PresentationRect } from './presentation-contract.js';

export interface CatalogCardLayout {
  rect: PresentationRect; domPath: string; visibleFraction: number; paint: PresentationPaint;
  slots: Array<CatalogTemplateSlot & { domPath: string; lineCount?: number; fullLineCount?: number;
    /** Independently measured from actual DOM bounds and computed margins, never source expectations. */
    allocationRect?: PresentationRect;
    allocationProof?: { kind: 'computed-margin-box'; domPath: string; marginTop: number; marginRight: number; marginBottom: number; marginLeft: number };
  }>;
  order: CatalogTemplateSlot['role'][]; evidence?: string[];
  hover?: { paint: PresentationPaint; evidence: string[] };
}

export interface CatalogRolePaint {
  color: string; fontSize: string; fontWeight: string; lineHeight: string; fontFamily: string;
  rect: { x: number; y: number; width: number; height: number };
  domPath?: string; visible?: boolean; evidence?: string[]; priceState?: 'regular' | 'sale' | 'old'; parts?: CatalogRolePaint[];
}

export interface CatalogProductEvidence {
  id: number; name: string; permalink: string; imageUrl: string; priceText?: string; imageVariants?: string[];
  onSale?: boolean;
  /** Actual DOM role paint is independent of the WooCommerce data record. */
  namePaint?: CatalogRolePaint; pricePaint?: CatalogRolePaint;
  cardLayout?: CatalogCardLayout;
}
export interface TargetCatalogEvidence {
  targetOrigin: string; evidence: string[]; products: CatalogProductEvidence[];
}
export interface CatalogRenderEvidence {
  viewport: string; blockId: string; widgetKey: string; widgetType: 'wd_products'; elementId: string;
  evidence: string[]; catalog: TargetCatalogEvidence; products: CatalogProductEvidence[];
  carousel?: { selector: string; initialized: boolean; visibleColumns: number; nextChanged?: boolean; slideCount?: number; loop?: boolean; cardWidth?: number };
}
export interface CatalogBinding {
  query: NativeProductQuery; node: NativeElement; textIds: Set<string>; assetKeys: Set<string>;
}
const flatten = (nodes: NativeElement[]): NativeElement[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
const unique = (values: string[], label: string) => {
  if (values.some(value => !value) || new Set(values).size !== values.length) throw new Error(`Catalog ${label} must be unique`);
};
const equalSets = (a: string[], b: string[]) => a.length === b.length && a.every(value => b.includes(value));
const nativeCatalogTypes = new Set(['wd_products']);
export const requiresTargetProductQuery = (role: string) => /^(?:products?|product-(?:grid|carousel|list|display))$/i.test(role);
export const catalogSourceNodeId = (item: CatalogSourceData['items'][number], viewport: string) => item.sourceNodeIds?.[viewport] ?? item.sourceNodeId;
const sourceDescendant = (record: { selector?: string; ancestorSelectors?: string[] }, owner: string) => record.selector === owner || record.selector?.startsWith(owner + ' > ') || record.ancestorSelectors?.includes(owner) === true;
export const catalogTemplateOwnedBy = (item: CatalogSourceData['items'][number], template: PresentationCatalogTemplate, viewport: string) => {
  const owner = catalogSourceNodeId(item, viewport);
  return template.sourceNodeId === owner || template.sourceNodeId.startsWith(owner + ' > ') || owner.startsWith(template.sourceNodeId + ' > ') || template.sourceAncestorSelectors?.includes(owner) === true;
};

/** Local contract checks cannot authorize dropping static headings, links or another block's data. */
export function validateTargetCatalogBindings(contract: BlockContract, program: NativeProgram): Map<string, CatalogBinding> {
  const result = new Map<string, CatalogBinding>(), evidenceIds = new Set(contract.evidence.map(item => item.id));
  const evidence = (ids: string[], label: string) => { if (!ids.length || ids.some(id => !evidenceIds.has(id))) throw new Error(`Catalog ${label} requires known source evidence`); };
  const mounted = new Set<string>();
  for (let index = 0; index < contract.blocks.length; index++) {
    const source = contract.blocks[index], target = program.blocks[index], dynamic = source.dynamicData, query = target?.productQuery;
    if (requiresTargetProductQuery(source.role) && (!dynamic || !query)) throw new Error(`Product block requires a native target WooCommerce query: ${source.id}`);
    if (!dynamic && !query) continue;
    if (!dynamic || !query) throw new Error(`Catalog source declaration and native query must both exist: ${source.id}`);
    if (!['grid', 'carousel'].includes(source.presentation)) throw new Error(`Catalog data requires a repeated grid or carousel block: ${source.id}`);
    if (dynamic.provider !== 'target-woocommerce' || dynamic.kind !== 'product-list' || query.provider !== dynamic.provider) throw new Error(`Catalog provider does not match: ${source.id}`);
    evidence(dynamic.evidence, source.id); evidence(query.evidence, source.id);
    unique(dynamic.replaceableTextIds, 'source text IDs'); unique(dynamic.replaceableAssetKeys, 'source asset keys');
    unique(query.sourceTextIds, 'query source text IDs'); unique(query.sourceAssetKeys, 'query source asset keys'); unique(query.queryControlKeys, 'query controls');
    if (!dynamic.items.length || !dynamic.replaceableTextIds.length || !dynamic.replaceableAssetKeys.length || !query.queryControlKeys.length) throw new Error(`Catalog replacement requires evidenced item text, media and query controls: ${source.id}`);
    if (!equalSets(dynamic.replaceableTextIds, query.sourceTextIds) || !equalSets(dynamic.replaceableAssetKeys, query.sourceAssetKeys)) throw new Error(`Catalog query replacement sets differ from the frozen authorization: ${source.id}`);
    const texts = new Map(source.texts.map(text => [text.id, text]));
    for (const id of dynamic.replaceableTextIds) {
      const text = texts.get(id);
      if (!text || ['heading', 'navigation'].includes(text.kind)) throw new Error(`Catalog replacement cannot remove a heading, navigation or foreign text: ${source.id}/${id}`);
    }
    for (const key of dynamic.replaceableAssetKeys) if (!source.assets.includes(key)) throw new Error(`Catalog replacement references foreign media: ${source.id}/${key}`);
    const itemTexts = dynamic.items.flatMap(item => item.textIds), itemAssets = dynamic.items.flatMap(item => item.assetKeys);
    unique(dynamic.items.map(item => item.sourceNodeId), 'item identities'); unique(itemTexts, 'item text owners');
    for (const viewport of new Set(dynamic.items.flatMap(item => Object.keys(item.sourceNodeIds ?? {})))) {
      if (!source.geometry[viewport]) throw new Error(`Catalog viewport identity lacks observed geometry: ${source.id}/${viewport}`);
      unique(dynamic.items.map(item => catalogSourceNodeId(item, viewport)), 'viewport item identities');
    }
    if (!equalSets(dynamic.replaceableTextIds, itemTexts) || !equalSets(dynamic.replaceableAssetKeys, [...new Set(itemAssets)])) throw new Error(`Catalog replacement must have exactly one evidenced repeated-item text owner: ${source.id}`);
    for (const item of dynamic.items) { if (!item.sourceNodeId.trim() || !item.textIds.length || !item.assetKeys.length) throw new Error(`Catalog item is incomplete: ${source.id}`); evidence(item.evidence, `${source.id}/${item.sourceNodeId}`); }
    const root = program.elements[index];
    if (!root || target.rootKey !== root.key || target.sourceBlockId !== source.id) throw new Error(`Catalog query block identity differs from its source: ${source.id}`);
    const nodes = flatten([root]), matches = nodes.filter(node => node.key === query.widgetKey), node = matches[0];
    if (matches.length !== 1 || !nativeCatalogTypes.has(query.widgetType) || node.type !== query.widgetType || node.children?.length) throw new Error(`Catalog query must mount once in its own native product widget: ${source.id}`);
    if (mounted.has(query.widgetKey)) throw new Error(`Catalog widget is mounted by more than one source block: ${query.widgetKey}`); mounted.add(query.widgetKey);
    for (const control of query.queryControlKeys) if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(control) || !Object.hasOwn(node.settings, control)) throw new Error(`Catalog query control has no explicit native setting: ${source.id}/${control}`);
    if (query.styleBindings) {
      const { nameSourceTextIds, priceSourceTextIds } = query.styleBindings;
      unique(nameSourceTextIds, 'name style source IDs'); unique(priceSourceTextIds, 'price style source IDs');
      for (const id of nameSourceTextIds) if (!dynamic.replaceableTextIds.includes(id) || ['heading', 'navigation', 'price', 'rating'].includes(texts.get(id)?.kind ?? 'heading')) throw new Error(`Catalog name style must bind its own authorized item caption: ${source.id}/${id}`);
      for (const id of priceSourceTextIds) if (!dynamic.replaceableTextIds.includes(id) || texts.get(id)?.kind !== 'price' || !requiresTargetProductQuery(source.role)) throw new Error(`Catalog price style requires a real source product price role: ${source.id}/${id}`);
      if (requiresTargetProductQuery(source.role) && source.texts.some(text => text.kind === 'product-name') && !nameSourceTextIds.length) throw new Error(`Catalog name style cannot discard a proven source name role: ${source.id}`);
      if (requiresTargetProductQuery(source.role) && source.texts.some(text => text.kind === 'price') && !priceSourceTextIds.length) throw new Error(`Catalog price style cannot discard a proven source price role: ${source.id}`);
    }
    if (source.presentation === 'carousel') {
      if (!query.carouselMode || node.settings[query.carouselMode.control] !== query.carouselMode.value || !query.carouselMode.value) throw new Error(`Catalog carousel lacks its exact native mode setting: ${source.id}`);
    } else if (query.carouselMode) throw new Error(`A grid cannot claim a carousel mode: ${source.id}`);
    result.set(source.id, { query, node, textIds: new Set(dynamic.replaceableTextIds), assetKeys: new Set(dynamic.replaceableAssetKeys) });
  }
  return result;
}

type SourceItem = { selector?: string; sourceNodeId?: string; atoms?: Array<{ text?: string; selector?: string; ancestorSelectors?: string[] }>; textAtoms?: Array<{ text?: string; selector?: string; ancestorSelectors?: string[] }>; images?: Array<{ url?: string; currentSrc?: string; src?: string; selector?: string; ancestorSelectors?: string[] }> };
/** Hash-checked DOM evidence must show each replaced field inside the actual repeated item. */
export function validateCatalogSourceOwnership(contract: BlockContract, manifest: SourceAssetManifest, sourceEvidence: Map<string, unknown>, visibleText: (text: string) => string): void {
  const assets = new Map(manifest.assets.map(asset => [asset.key, asset]));
  for (const source of contract.blocks) {
    if (!source.dynamicData) continue;
    for (const item of source.dynamicData.items) {
      const observations: SourceItem[] = [], provenIdentities = new Set<string>(), viewportOwners = new Map<string, SourceItem[]>();
      for (const id of item.evidence) {
        const packet = sourceEvidence.get(id) as { name?: string; sceneInventory?: { viewport?: { name?: string }; items?: Array<{ kind?: string; sourceBlockId?: string; facts?: { itemSelectors?: string[] } }> }; sourceScene?: { items?: Array<{ kind?: string; sourceBlockId?: string; facts?: { itemSelectors?: string[] } }> }; blocks?: Array<{ id?: string; textAtoms?: NonNullable<SourceItem['atoms']>; images?: SourceItem['images']; carousels?: Array<{ slides?: SourceItem[] }>; repeatedItems?: SourceItem[] }> } | undefined;
        const viewport = packet?.sceneInventory?.viewport?.name ?? packet?.name ?? '', expected = catalogSourceNodeId(item, viewport);
        for (const block of packet?.blocks ?? []) if (block.id === source.id) {
          const repeated = (packet?.sceneInventory?.items ?? packet?.sourceScene?.items ?? []).filter(row => row.kind === 'repeated-template' && row.sourceBlockId === source.id).flatMap(row => row.facts?.itemSelectors ?? []);
          const rows: SourceItem[] = [...(block.carousels ?? []).flatMap(carousel => carousel.slides ?? []), ...(block.repeatedItems ?? []), ...repeated.map(selector => ({ selector, atoms: (block.textAtoms ?? []).filter(atom => sourceDescendant(atom, selector)), images: (block.images ?? []).filter(image => sourceDescendant(image, selector)) }))];
          const matching = rows.filter(owner => (owner.selector ?? owner.sourceNodeId) === expected);
          observations.push(...matching); if (matching.length) provenIdentities.add(expected);
          const identityKey=viewport+'\0'+expected;viewportOwners.set(identityKey,[...(viewportOwners.get(identityKey)??[]),...matching]);
        }
      }
      for (const identity of new Set([item.sourceNodeId, ...Object.values(item.sourceNodeIds ?? {})])) if (!provenIdentities.has(identity)) throw new Error(`Catalog item has no observed repeated-item ownership for viewport identity: ${source.id}/${identity}`);
      for(const [viewport,identity]of Object.entries(item.sourceNodeIds??{})){
        const owners=viewportOwners.get(viewport+'\0'+identity)??[];
        if(!owners.length)throw new Error(`Catalog item has no observed repeated-item ownership at viewport: ${source.id}/${viewport}/${identity}`);
        for(const id of item.textIds){const text=source.texts.find(text=>text.id===id);if(!text||!owners.some(owner=>[...(owner.atoms??[]),...(owner.textAtoms??[])].some(atom=>typeof atom.text==='string'&&visibleText(atom.text)===visibleText(text.text))))throw new Error(`Catalog text is outside its evidenced repeated item at viewport: ${source.id}/${viewport}/${id}`);}
        for(const key of item.assetKeys){const url=assets.get(key)?.sourceUrl;if(!url||!owners.some(owner=>(owner.images??[]).some(image=>[image.url,image.currentSrc,image.src].includes(url))))throw new Error(`Catalog media is outside its evidenced repeated item at viewport: ${source.id}/${viewport}/${key}`);}
      }
      const owners = observations;
      if (!owners.length) throw new Error(`Catalog item has no observed repeated-item ownership: ${source.id}/${item.sourceNodeId}`);
      for (const id of item.textIds) {
        const text = source.texts.find(text => text.id === id);
        if (!text || !owners.some(owner => [...(owner.atoms ?? []), ...(owner.textAtoms ?? [])].some(atom => typeof atom.text === 'string' && visibleText(atom.text) === visibleText(text.text)))) throw new Error(`Catalog text is outside its evidenced repeated item: ${source.id}/${id}`);
      }
      for (const key of item.assetKeys) {
        const url = assets.get(key)?.sourceUrl;
        if (!url || !owners.some(owner => (owner.images ?? []).some(image => [image.url, image.currentSrc, image.src].includes(url)))) throw new Error(`Catalog media is outside its evidenced repeated item: ${source.id}/${key}`);
      }
    }
  }
}

const publicURL = (value: string) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : undefined; } catch { return undefined; } };
const normalText = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|\u00a0/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').normalize('NFC').replace(/\s+/g, ' ').trim();
export function catalogRenderProblems(binding: CatalogBinding, rendered: CatalogRenderEvidence, element: TargetElementEvidence | undefined): string[] {
  const problems: string[] = [], origin = publicURL(rendered.catalog?.targetOrigin ?? '');
  if (!origin || origin.origin !== rendered.catalog.targetOrigin || !rendered.catalog.evidence.length || !rendered.evidence.length) return ['Target catalog requires a credential-free target origin and actual catalog/browser evidence'];
  // Registry names omit the Elementor DOM's proven default-skin suffix; accept only these exact two encodings.
  const exactNativeType = element?.widgetType === binding.query.widgetType || element?.widgetType === `${binding.query.widgetType}.default`;
  if (!element?.found || !element.visible || !element.nativeElement || element.count !== 1 || !exactNativeType || rendered.widgetKey !== binding.query.widgetKey || rendered.widgetType !== binding.query.widgetType || rendered.elementId !== element.targetId) problems.push('Target products have no unique native widget binding');
  const allowed = new Map<number, CatalogProductEvidence>();
  for (const product of rendered.catalog.products) {
    if (!Number.isInteger(product.id) || product.id < 1 || allowed.has(product.id) || publicURL(product.permalink)?.origin !== origin.origin || !publicURL(product.imageUrl) || (product.imageVariants ?? []).some(url => !publicURL(url)) || !product.name.trim()) { problems.push('Target catalog contains invalid or foreign product identity'); continue; }
    allowed.set(product.id, product);
  }
  if (!rendered.products.length) problems.push('Native product query rendered no observed target products');
  for (const product of rendered.products) {
    const registered = allowed.get(product.id);
    if (!registered || publicURL(product.permalink)?.origin !== origin.origin || product.permalink !== registered.permalink || normalText(product.name) !== normalText(registered.name) || ![registered.imageUrl, ...(registered.imageVariants ?? [])].includes(product.imageUrl) || (registered.priceText !== undefined && normalText(product.priceText ?? '') !== normalText(registered.priceText))) problems.push(`Rendered product ${product.id} does not match actual target catalog provenance`);
    if (registered && typeof registered.onSale === 'boolean' && product.onSale !== registered.onSale) problems.push(`Rendered product ${product.id} sale state does not match actual target catalog provenance`);
  }
  return problems;
}
/** A native product type name alone never proves its carousel rendered or initialized. */
export function isVerifiedCatalogCarousel(binding: CatalogBinding, rendered: CatalogRenderEvidence | undefined, element: TargetElementEvidence | undefined): boolean {
  return Boolean(binding.query.carouselMode && rendered && !catalogRenderProblems(binding, rendered, element).length && rendered.carousel?.selector && rendered.carousel.initialized && Number.isInteger(rendered.carousel.visibleColumns) && rendered.carousel.visibleColumns > 0);
}

export interface CatalogRolePaintIssue {
  code: string; severity: 'error' | 'warning'; viewport: string; blockId: string; role: 'name' | 'price' | 'card'; productId?: number;
  message: string; property?: string; expected?: unknown; actual?: unknown;
}
export interface CatalogRolePaintCheck {
  viewport: string; blockId: string; role: 'name' | 'price' | 'card'; productId?: number;
  status: 'matched' | 'mismatch' | 'unverified' | 'not-applicable';
  sourceTextIds: string[]; sourceSelectors: string[]; evidence: string[];
  expected?: Omit<CatalogRolePaint, 'parts'>; actual?: CatalogRolePaint; priceState?: 'regular' | 'sale';
}
export interface CatalogRolePaintReport {
  version: 1; passed: boolean; colorTypographyPassed: boolean; status: 'passed' | 'needs-review' | 'failed';
  checks: CatalogRolePaintCheck[]; issues: CatalogRolePaintIssue[];
  counts: { matched: number; errors: number; unverified: number; notApplicable: number };
}
type StyledSourceItem = SourceItem & { atoms?: SourcePaintAtom[]; textAtoms?: SourcePaintAtom[] };
type RoleSource = { textId: string; item: string; selector: string; evidence: string; paint: CatalogRolePaint; oldPrice: boolean };
const colorChannels = (value: string): number[] | undefined => {
  if (/^#[a-f\d]{3}$/i.test(value)) return [...value.slice(1).split('').map(v => parseInt(v + v, 16)), 255];
  if (/^#[a-f\d]{6}(?:[a-f\d]{2})?$/i.test(value)) return [...[1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)), value.length === 9 ? parseInt(value.slice(7, 9), 16) : 255];
  const rgba = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(value);
  return rgba ? [...rgba.slice(1, 4).map(Number), Number(rgba[4] ?? 1) * 255] : undefined;
};
const pxValue = (value: string) => /^-?\d+(?:\.\d+)?px$/.test(value.trim()) ? Number.parseFloat(value) : undefined;
const weightValue = (value: string) => value === 'normal' ? 400 : value === 'bold' ? 700 : /^\d+$/.test(value) ? Number(value) : undefined;
const primaryFamily = (value: string) => value.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
const paintSignature = (paint: CatalogRolePaint) => JSON.stringify([colorChannels(paint.color), pxValue(paint.fontSize), weightValue(paint.fontWeight), pxValue(paint.lineHeight), primaryFamily(paint.fontFamily)]);

function sourceRolePaints(source: BlockContract['blocks'][number], ids: string[], viewport: string, packets: SourceTextPaintPacket[]): RoleSource[] {
  const rows: RoleSource[] = [];
  for (const id of ids) {
    const text = source.texts.find(text => text.id === id), item = source.dynamicData?.items.find(item => item.textIds.includes(id)); if (!text || !item) continue;
    for (const packet of packets.filter(packet => packet.viewport === viewport)) {
      const block = packet.blocks.find(block => block.id === source.id); if (!block) continue;
      const itemRows = (block.carousels ?? []).flatMap(carousel => carousel.slides ?? []) as StyledSourceItem[];
      const identity = catalogSourceNodeId(item, viewport);
      const ownerItem: StyledSourceItem | undefined = itemRows.find(row => (row.selector ?? row.sourceNodeId) === identity) ?? (() => {
        const atoms = block.textAtoms.filter(atom => sourceDescendant(atom, identity));
        return atoms.length ? { selector: identity, atoms } : undefined;
      })();
      if (!ownerItem) continue;
      // Source wording only locates the frozen source field inside its already proved owner; target wording never selects style.
      const ownerAtoms = [...(ownerItem.atoms ?? []), ...(ownerItem.textAtoms ?? [])].filter(atom => normalText(atom.text ?? '') === normalText(text.text));
      if (!ownerAtoms.length) continue;
      const originalOwner = packet.textOwners?.find(owner => owner.blockId === source.id && owner.sourceTextId === id);
      const candidates = block.textAtoms.filter(atom => normalText(atom.text ?? '') === normalText(text.text) && (originalOwner ? atom.selector === originalOwner.selector && (!originalOwner.href || atom.href === originalOwner.href) : ownerAtoms.some(owner => atom.selector === owner.selector && (!owner.href || atom.href === owner.href))));
      const usable = [...candidates, ...ownerAtoms].filter(atom => {
        if (atom.visible !== true || !atom.rect || !Number.isFinite(atom.rect.x) || !Number.isFinite(atom.rect.y) || !Number.isFinite(atom.rect.width) || !Number.isFinite(atom.rect.height) || atom.rect.width <= 0 || atom.rect.height <= 0 || !atom.style || typeof atom.style !== 'object' || typeof atom.style.color !== 'string') return false;
        // CSS-visible offscreen carousel clones cannot choose a convenient template.
        const width = packet.observedPage?.viewport.width ?? source.presentationDetails?.viewports[viewport]?.width ?? source.geometry[viewport]?.width;
        const ownerBox = (ownerItem as StyledSourceItem & { rect?: PresentationRect }).rect;
        const clipping = ownerBox ?? block.rect;
        const intersects = (box: PresentationRect) => Math.min(atom.rect!.x! + atom.rect!.width, box.x + box.width) > Math.max(atom.rect!.x!, box.x) && Math.min(atom.rect!.y! + atom.rect!.height, box.y + box.height) > Math.max(atom.rect!.y!, box.y);
        if (width !== undefined && !(atom.rect.x! < width && atom.rect.x! + atom.rect.width > 0)) return false;
        return !clipping || intersects(clipping);
      });
      const seen = new Set<string>();
      for (const atom of usable) {
        const css = atom.style as Record<string, unknown>;
        if (['color', 'font-size', 'font-weight', 'line-height', 'font-family'].some(key => typeof css[key] !== 'string')) continue;
        const paint: CatalogRolePaint = { color: String(css.color), fontSize: String(css['font-size']), fontWeight: String(css['font-weight']), lineHeight: String(css['line-height']), fontFamily: String(css['font-family']), rect: { x: atom.rect?.x ?? 0, y: atom.rect?.y ?? 0, width: atom.rect!.width, height: atom.rect!.height }, domPath: atom.selector, visible: true, evidence: [packet.evidencePath] };
        const signature = `${atom.selector}:${paintSignature(paint)}`; if (seen.has(signature)) continue; seen.add(signature);
        rows.push({ textId: id, item: identity, selector: atom.selector ?? '', evidence: packet.evidencePath, paint, oldPrice: String(css['text-decoration-line'] ?? '').split(/\s+/).includes('line-through') });
      }
    }
  }
  return rows;
}

type LayoutProblem = { code: string; severity: 'error' | 'warning'; message: string; property?: string; expected?: unknown; actual?: unknown };
/** Product facts are replaceable; measured card and allocated slot geometry are not. */
export function catalogCardLayoutProblems(template: PresentationCatalogTemplate | undefined, actual: CatalogCardLayout | undefined, tolerancePx = 3, colorTolerance = 4): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  const add = (code: string, message: string, expected?: unknown, obtained?: unknown, property?: string, severity: 'error' | 'warning' = 'error') => problems.push({ code, severity, message, expected, actual: obtained, property });
  if (!template) return [{ code: 'catalog-card-template-unproven', severity: 'warning', message: 'No same-viewport visible source card template was frozen; block height cannot prove card fidelity.' }];
  if (template.visibleFraction < .6 || !template.evidence.length || !template.sourceNodeId || !Object.values(template.rect).every(Number.isFinite)) return [{ code: 'catalog-card-template-unproven', severity: 'error', message: 'Source card template is not physically visible or has no finite geometry and evidence.' }];
  if (!actual || !actual.domPath || !actual.evidence?.length || !Object.values(actual.rect).every(Number.isFinite)) return [{ code: 'catalog-card-layout-unmeasured', severity: 'warning', message: 'Actual target product card and its owned display slots were not measured.' }];
  for (const property of ['backgroundColor', 'borderWidth', 'borderColor', 'borderRadius', 'boxShadow'] as const) if (template.paint[property] === undefined) add('catalog-card-frame-unproven', 'Source card frame paint is incomplete; an empty paint object cannot prove border/background fidelity.', property, undefined, property, 'warning');
  for (const role of ['image', 'name'] as const) if (!template.slots.some(slot => slot.role === role && slot.visible)) add('catalog-card-slot-unproven', 'Source card template lacks a required visible product display slot.', role, undefined, role, 'warning');
  const imageSlot = template.slots.find(slot => slot.role === 'image');
  for (const property of ['fit', 'objectPosition'] as const) if (imageSlot && imageSlot[property] === undefined) add('catalog-card-image-style-unproven', 'Source product image fit and position must be independently observed.', property, undefined, property, 'warning');
  // Offscreen siblings are retained for catalog data provenance but cannot prove visible layout.
  if (actual.visibleFraction < .6) return [{ code: 'catalog-card-offscreen', severity: 'warning', message: 'This target card is outside the visible carousel window; it is not a visual template sample.' }];
  const tol = Math.min(3, Math.max(0, tolerancePx));
  const paint = (expected: PresentationPaint | undefined, got: PresentationPaint | undefined, prefix: string) => {
    for (const [property, value] of Object.entries(expected ?? {})) {
      const measured = got?.[property as keyof PresentationPaint];
      const expectedColor = typeof value === 'string' && /color/i.test(property) ? colorChannels(value) : undefined;
      const actualColor = typeof measured === 'string' && /color/i.test(property) ? colorChannels(measured) : undefined;
      const same = typeof value === 'number' && typeof measured === 'number' ? Number.isFinite(value) && Number.isFinite(measured) && Math.abs(value - measured) <= (property === 'opacity' ? .02 : property === 'borderWidth' ? .25 : 1) : expectedColor && actualColor ? expectedColor.every((v, i) => Math.abs(v - actualColor[i]) <= colorTolerance) : value === measured;
      if (!same) add('catalog-card-paint', 'Target card or slot paint differs despite intentional product-data replacement.', value, measured, `${prefix}.${property}`);
    }
  };
  for (const axis of ['width', 'height'] as const) if (Math.abs(template.rect[axis] - actual.rect[axis]) > tol) add('catalog-card-geometry', 'Target card dimensions differ from its source template.', template.rect[axis], actual.rect[axis], axis);
  paint(template.paint, actual.paint, 'card');
  if (new Set(actual.slots.map(slot => slot.role)).size !== actual.slots.length) add('catalog-card-slot-duplicate', 'A display role has ambiguous target slot ownership.');
  for (const expected of template.slots) {
    const slot = actual.slots.find(slot => slot.role === expected.role);
    if (!slot || !slot.domPath || !Object.values(slot.rect).every(Number.isFinite)) { add('catalog-card-slot-unmeasured', 'An evidenced source slot has no unique measured target equivalent.', expected.role, slot); continue; }
    if (slot.visible !== expected.visible) add('catalog-card-slot-visibility', 'Product data replacement changed a source display role visibility.', expected.visible, slot.visible, expected.role);
    if (!expected.visible || !slot.visible) continue;
    const rect = expected.geometryBasis === 'allocation' ? slot.allocationRect : slot.rect;
    if (!rect || !Object.values(rect).every(Number.isFinite) || expected.geometryBasis === 'allocation' && (slot.allocationProof?.kind !== 'computed-margin-box' || !slot.allocationProof.domPath || !['marginTop', 'marginRight', 'marginBottom', 'marginLeft'].every(key => Number.isFinite(slot.allocationProof![key as 'marginTop'])))) { add('catalog-card-slot-allocation-unmeasured', 'Allocated source slots require independently measured actual DOM margin-box proof.', expected.role, slot.allocationProof); continue; }
    for (const axis of ['x', 'y', 'width', 'height'] as const) {
      if (axis === 'height' && expected.heightMode === 'content') {
        if (expected.maxHeight !== undefined && rect.height > expected.maxHeight + tol) add('catalog-card-slot-overflow', 'Dynamic text exceeds the source allocated content-height constraint.', expected.maxHeight, rect.height, expected.role);
      } else if (Math.abs(expected.rect[axis] - rect[axis]) > tol) add('catalog-card-slot-geometry', 'Target product slot geometry differs from the source card layout.', expected.rect[axis], rect[axis], `${expected.role}.${axis}`);
    }
    paint(expected.paint, slot.paint, expected.role);
    for (const property of ['fit', 'objectPosition', 'overflow'] as const) if (expected[property] !== undefined && expected[property] !== slot[property]) add('catalog-card-slot-style', 'Target product slot rendering differs from source evidence.', expected[property], slot[property], `${expected.role}.${property}`);
    if (expected.maxLines !== undefined && (slot.lineCount === undefined || slot.lineCount > expected.maxLines)) add('catalog-card-slot-lines', 'Dynamic product copy exceeds the evidenced source line budget.', expected.maxLines, slot.lineCount, expected.role);
  }
  const sourceRoles = new Set(template.slots.filter(slot => slot.visible).map(slot => slot.role));
  for (const slot of actual.slots.filter(slot => slot.visible)) if (!sourceRoles.has(slot.role)) add('catalog-card-unexpected-slot', 'A new target display role has no source equivalent; data substitution does not add display layers.', undefined, slot.role);
  if (JSON.stringify(template.order) !== JSON.stringify(actual.order)) add('catalog-card-slot-order', 'Target product name/image/rating/price slot order differs from source evidence.', template.order, actual.order);
  for (const gap of template.gaps ?? []) {
    const from = actual.slots.find(slot => slot.role === gap.from), to = actual.slots.find(slot => slot.role === gap.to);
    if (!from || !to) continue;
    const fromRect = template.slots.find(slot => slot.role === gap.from)?.geometryBasis === 'allocation' ? from.allocationRect : from.rect;
    const toRect = template.slots.find(slot => slot.role === gap.to)?.geometryBasis === 'allocation' ? to.allocationRect : to.rect;
    if (!fromRect || !toRect) continue;
    const obtained = gap.axis === 'x' ? toRect.x - fromRect.x - fromRect.width : toRect.y - fromRect.y - fromRect.height;
    if (Math.abs(obtained - gap.valuePx) > tol) add('catalog-card-slot-gap', 'Target display slot spacing differs from its independently measured source gap.', gap.valuePx, obtained, `${gap.from}:${gap.to}`);
  }
  if (!template.hover || template.hover.status === 'unobserved') add('catalog-card-hover-unproven', 'Source product hover behavior is not proved or explicitly not applicable.', undefined, template.hover, undefined, 'warning');
  else if (template.hover.status === 'observed') {
    if (!actual.hover?.evidence.length) add('catalog-card-hover-unmeasured', 'Actual native product hover paint has not been exercised and measured.', template.hover.paint, undefined, undefined, 'warning');
    else paint(template.hover.paint, actual.hover.paint, 'hover');
  }
  return problems;
}

/** Compare role styles even after target catalog text/media replacement. Missing proof stays a gap. */
export function compareCatalogRolePaint(contract: BlockContract, program: NativeProgram, packets: SourceTextPaintPacket[], renders: CatalogRenderEvidence[]): CatalogRolePaintReport {
  const bindings = validateTargetCatalogBindings(contract, program), checks: CatalogRolePaintCheck[] = [], issues: CatalogRolePaintIssue[] = [];
  const issue = (check: CatalogRolePaintCheck, code: string, message: string, severity: 'error' | 'warning', property?: string, expected?: unknown, actual?: unknown) => {
    issues.push({ code, message, severity, viewport: check.viewport, blockId: check.blockId, role: check.role, productId: check.productId, property, expected, actual });
    if (severity === 'error') check.status = 'mismatch'; else if (check.status !== 'mismatch' && check.status !== 'not-applicable') check.status = 'unverified';
  };
  for (const source of contract.blocks) {
    const binding = bindings.get(source.id); if (!binding) continue;
    const matchedRenders = renders.filter(render => render.blockId === source.id && render.widgetKey === binding.query.widgetKey && render.widgetType === binding.query.widgetType);
    const viewports = [...new Set([...Object.keys(source.geometry), ...matchedRenders.map(render => render.viewport)])];
    for (const viewport of viewports) {
      const render = matchedRenders.find(render => render.viewport === viewport);
      const template = source.presentationDetails?.viewports[viewport]?.catalogTemplate;
      const visibleProducts = render?.products.filter(product => (product.cardLayout?.visibleFraction ?? 0) >= .6) ?? [];
      const layoutProducts = visibleProducts.length ? visibleProducts : render?.products.slice(0, 1) ?? [undefined];
      for (const product of layoutProducts) {
        const check: CatalogRolePaintCheck = { viewport, blockId: source.id, role: 'card', productId: product?.id, status: 'matched', sourceTextIds: [], sourceSelectors: template ? [template.sourceNodeId] : [], evidence: [...template?.evidence ?? [], ...render?.evidence ?? []] }; checks.push(check);
        if (template && source.dynamicData?.items.filter(item => catalogTemplateOwnedBy(item, template, viewport)).length !== 1) issue(check, 'catalog-card-template-ownership', 'Source card template must belong to exactly one evidenced repeated product item.', 'error');
        for (const problem of catalogCardLayoutProblems(template, product?.cardLayout, contract.tolerances.geometryPx, contract.tolerances.colorChannel)) issue(check, problem.code, problem.message, problem.severity, problem.property, problem.expected, problem.actual);
      }
      for (const role of ['name', 'price'] as const) {
        const explicit = binding.query.styleBindings;
        const ids = explicit ? role === 'name' ? explicit.nameSourceTextIds : explicit.priceSourceTextIds : source.texts.filter(text => binding.textIds.has(text.id) && text.kind === (role === 'name' ? 'product-name' : 'price') && (role === 'name' || requiresTargetProductQuery(source.role))).map(text => text.id);
        if (!ids.length) {
          const check: CatalogRolePaintCheck = { viewport, blockId: source.id, role, status: role === 'price' && !requiresTargetProductQuery(source.role) ? 'not-applicable' : 'unverified', sourceTextIds: [], sourceSelectors: [], evidence: source.dynamicData?.evidence ?? [] }; checks.push(check);
          issue(check, 'catalog-source-role-unproven', role === 'price' ? 'The source repeated promotion has no proven actual product-price role; newly displayed target prices have no source price-style equivalent' : 'The source repeated caption has no proven product-name role or explicit caption-to-name style binding', 'warning'); continue;
        }
        const sources = sourceRolePaints(source, ids, viewport, packets), saleItems = new Set(sources.filter(row => row.oldPrice).map(row => row.item));
        const base = { viewport, blockId: source.id, role, sourceTextIds: ids, sourceSelectors: [...new Set(sources.map(row => row.selector))], evidence: [...new Set(sources.map(row => row.evidence))] };
        if (!render?.products.length) { const check: CatalogRolePaintCheck = { ...base, status: 'unverified' }; checks.push(check); issue(check, 'catalog-role-paint-unmeasured', 'Actual native target product-role DOM paint was not collected', 'warning'); continue; }
        // Catalog identity is checked for every item separately. Paint acceptance
        // samples physically visible cards; hidden carousel siblings are not failures
        // and cannot supply favorable source/target visual proof.
        for (const product of visibleProducts.length ? visibleProducts : render.products) {
          const actual = role === 'name' ? product.namePaint : product.pricePaint;
          const check: CatalogRolePaintCheck = { ...base, productId: product.id, actual, status: 'matched', evidence: [...new Set([...base.evidence, ...render.evidence, ...(actual?.evidence ?? [])])] }; checks.push(check);
          let references = sources;
          if (role === 'price') {
            const registered = render.catalog.products.find(row => row.id === product.id), onSale = registered?.onSale;
            let priceState: 'regular' | 'sale' | undefined = typeof onSale === 'boolean' ? onSale ? 'sale' : 'regular' : actual?.priceState === 'sale' || actual?.priceState === 'regular' ? actual.priceState : saleItems.size ? undefined : 'regular';
            if (registered && typeof onSale === 'boolean' && product.onSale !== onSale) issue(check, 'catalog-price-state', 'Actual native card sale state does not match the actual target catalog record', 'error', 'onSale', onSale, product.onSale);
            if (saleItems.size && typeof onSale !== 'boolean') issue(check, 'catalog-price-state-unverified', 'Source prices have regular and sale styles, but target catalog sale-state provenance is unavailable', 'warning');
            if (!priceState) { issue(check, 'catalog-price-state-unverified', 'No semantic target price state is proved; no favorable source color was selected', 'warning'); continue; }
            check.priceState = priceState;
            references = sources.filter(row => !row.oldPrice && (priceState === 'sale' ? saleItems.has(row.item) : !saleItems.has(row.item)));
          }
          const groups = new Map<string, RoleSource>(); for (const row of references) groups.set(paintSignature(row.paint), row);
          if (!groups.size) { issue(check, 'catalog-source-role-paint-unproven', 'The exact source item role has no complete same-viewport computed style evidence for this semantic state', 'warning'); continue; }
          if (groups.size !== 1) issue(check, 'catalog-source-role-paint-ambiguous', 'Source item role styles differ within this semantic state; only properties invariant across source items can be compared', 'warning', undefined, [...groups.values()].map(row => row.paint));
          const expected = [...groups.values()][0].paint; if (groups.size === 1) check.expected = expected;
          if (!actual || actual.visible === false || !actual.domPath || !Number.isFinite(actual.rect?.width) || !Number.isFinite(actual.rect?.height) || actual.rect.width <= 0 || actual.rect.height <= 0 || !render.evidence.length) { issue(check, 'catalog-role-paint-unmeasured', 'The actual visible native product-role glyph has no owned DOM path, rectangle and browser evidence', 'warning'); continue; }
          const actualParts = [actual, ...(actual.parts ?? [])];
          for (const measured of actualParts) {
            if (!measured.domPath || measured.visible === false || !Number.isFinite(measured.rect?.width) || !Number.isFinite(measured.rect?.height) || measured.rect.width <= 0 || measured.rect.height <= 0) { issue(check, 'catalog-role-paint-unmeasured', 'A target role glyph part lacks an actual visible DOM-path and rectangle proof', 'warning'); continue; }
            let roleGroups = groups;
            if (role === 'price' && measured.priceState === 'old') {
              roleGroups = new Map(); for (const row of sources.filter(row => row.oldPrice)) roleGroups.set(paintSignature(row.paint), row);
              if (!roleGroups.size) { issue(check, 'catalog-source-old-price-unproven', 'Actual target old-price glyphs have no proved source old-price style equivalent', 'warning'); continue; }
              if (roleGroups.size !== 1) issue(check, 'catalog-source-role-paint-ambiguous', 'Source old-price styles vary; only invariant old-price properties can be compared', 'warning');
            }
            const expected = [...roleGroups.values()][0].paint;
            const invariant = (property: 'color' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'fontFamily') => new Set([...roleGroups.values()].map(row => JSON.stringify(property === 'color' ? colorChannels(row.paint.color) : property === 'fontWeight' ? weightValue(row.paint.fontWeight) : property === 'fontFamily' ? primaryFamily(row.paint.fontFamily) : pxValue(row.paint[property])))).size === 1;
            const expectedColor = colorChannels(expected.color), actualColor = colorChannels(measured.color ?? '');
            if (invariant('color')) {
              if (!expectedColor || !actualColor) issue(check, 'catalog-role-color-unmeasured', 'Source or target role color has no comparable computed color evidence', 'warning', 'color', expected.color, measured.color);
              else if (expectedColor.some((value, index) => Math.abs(value - actualColor[index]) > contract.tolerances.colorChannel)) issue(check, 'catalog-role-color', 'Target catalog data replacement changed its source role color', 'error', 'color', expected.color, measured.color);
            }
            // Role font scale gets a fixed 1px rounding allowance, never the block geometry's wide pixel tolerance.
            for (const property of ['fontSize', 'lineHeight'] as const) {
              if (!invariant(property)) continue;
              const wanted = pxValue(expected[property]), obtained = pxValue(measured[property] ?? '');
              if (wanted === undefined || obtained === undefined) issue(check, 'catalog-role-metric-unmeasured', 'Source or target role typography lacks actual pixel metric evidence', 'warning', property, expected[property], measured[property]);
              else if (Math.abs(wanted - obtained) > 1) issue(check, 'catalog-role-metric', 'Target catalog data replacement changed its source role font scale or line height', 'error', property, expected[property], measured[property]);
            }
            const expectedWeight = weightValue(expected.fontWeight), actualWeight = weightValue(measured.fontWeight ?? '');
            if (invariant('fontWeight')) {
              if (expectedWeight === undefined || actualWeight === undefined) issue(check, 'catalog-role-weight-unmeasured', 'Source or target role weight lacks comparable computed evidence', 'warning', 'fontWeight', expected.fontWeight, measured.fontWeight);
              else if (expectedWeight !== actualWeight) issue(check, 'catalog-role-weight', 'Target catalog data replacement changed its source role font weight', 'error', 'fontWeight', expected.fontWeight, measured.fontWeight);
            }
            if (invariant('fontFamily')) {
              if (!measured.fontFamily || !expected.fontFamily) issue(check, 'catalog-role-font-unmeasured', 'Source or target role font family is unmeasured', 'warning', 'fontFamily', expected.fontFamily, measured.fontFamily);
              else if (primaryFamily(expected.fontFamily) !== primaryFamily(measured.fontFamily)) issue(check, 'catalog-role-font-fallback', 'Target role uses a different font family; retain the named font fallback and its glyph-width limitation', 'warning', 'fontFamily', expected.fontFamily, measured.fontFamily);
            }
          }
        }
      }
    }
  }
  const errors = issues.filter(issue => issue.severity === 'error').length, unverified = issues.filter(issue => issue.severity === 'warning').length;
  return { version: 1, passed: !errors && !unverified, colorTypographyPassed: !errors, status: errors ? 'failed' : unverified ? 'needs-review' : 'passed', checks, issues, counts: { matched: checks.filter(check => check.status === 'matched').length, errors, unverified, notApplicable: checks.filter(check => check.status === 'not-applicable').length } };
}
