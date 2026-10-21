import { normalizeText, validateContentBoundsBindings } from './validate.js';
import { sourceVisibleText } from './check.js';
import type { BlockContract, NativeElement, NativeProgram } from './types.js';
import type { TargetViewportEvidence } from '../verification/types.js';
import { catalogRenderProblems, isVerifiedCatalogCarousel, validateTargetCatalogBindings, type CatalogBinding, type CatalogRenderEvidence } from './catalog-contract.js';
import { verifyPresentationDetails, type PresentationVerification, type TargetPresentationEvidence } from './presentation-contract.js';
import type { SourceTextPaintPacket } from './text-paint.js';
import { proveInactiveSourceText, retainedHiddenNativeText } from './source-static-text.js';

export interface FidelityStateObservation {
  viewport: string; blockId: string; state: 'normal' | 'hover' | 'interaction';
  status: 'verified' | 'failed' | 'unverified'; properties: Record<string, string | number | boolean>; evidence: string[]; note?: string;
}
export interface FidelityVerification {
  version: 1; workflow: 'block-replication'; passed: boolean; structurePassed: boolean; statesVerified: boolean;
  status: 'passed' | 'needs-review' | 'failed';
  issues: Array<{ code: string; severity: 'error' | 'warning'; viewport?: string; blockId?: string; message: string; expected?: unknown; actual?: unknown }>;
  coverage: Array<{ viewport: string; expectedBlocks: number; matchedBlocks: number; expectedTexts: number; matchedTexts: number }>;
  contentBoundsChecks?: Array<{ viewport: string; blockId: string; elementKey?: string; status: 'verified' | 'failed' | 'unverified'; expected?: { x: number; width: number; viewportWidth: number; leftInset: number; rightInset: number }; actual?: { x: number; width: number; viewportWidth: number; leftInset: number; rightInset: number }; evidence: string[] }>;
  productChecks?: Array<{ viewport: string; blockId: string; widgetKey: string; status: 'verified' | 'failed' | 'unverified'; productIds: number[]; replacedSourceTexts: number; replacedSourceAssets: number; carouselVerified: boolean; evidence: string[] }>;
  presentationDetails: PresentationVerification;
  interactionOverrides?:Array<{viewport:string;blockId:string;evidence:string[];reason:string}>;
  inactiveStaticText?:Array<{viewport:string;blockId:string;sourceTextId:string;elementKey:string;sourceSelectors:string[];evidence:string[];status:'source-inactive'}>;
  limitations: string[];
}
const rgb = (input: string): number[] | undefined => {
  const value = input.trim().toLowerCase();
  if(value==='transparent')return[0,0,0,0];
  if (/^#[a-f\d]{3}$/.test(value)) return [...Array.from(value.slice(1)).map(n => Number.parseInt(n + n, 16)),255];
  if (/^#[a-f\d]{6}(?:[a-f\d]{2})?$/.test(value)) return [...[1, 3, 5].map(index => Number.parseInt(value.slice(index, index + 2), 16)),value.length===9?Number.parseInt(value.slice(7,9),16):255];
  const match = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)/.exec(value);
  return match ? [...match.slice(1,4).map(Number),Number(match[4]??1)*255] : undefined;
};
function sameColor(expected: string, actual: string, tolerance: number) { const e = rgb(expected), a = rgb(actual); return e && a ? e.every((channel, index) => Math.abs(channel - a[index]) <= tolerance) : expected.trim().toLowerCase() === actual.trim().toLowerCase(); }
export const fidelityColorChannels = rgb;
export const compareFidelityColor = sameColor;
const styleAliases: Record<string, string> = { background: 'background-color', text: 'color', border: 'border-color' };

/** A global desktop action cannot override two explicitly hidden controls at an observed viewport. */
export function hiddenViewportArrowEvidence(contract:BlockContract,source:BlockContract['blocks'][number],viewport:string,width:number):string[]|undefined{
  const view=source.presentationDetails?.viewports[viewport],known=new Map(contract.evidence.map(item=>[item.id,item]));
  if(!view||view.status!=='observed'||view.width!==width)return;
  const current=new Set(view.evidence),proven=(ids:string[])=>ids.length>0&&ids.every(id=>known.has(id))&&ids.some(id=>{const item=known.get(id);return current.has(id)&&!!item&&['dom','observation'].includes(item.kind)&&/\.json$/i.test(item.path);});
  if(!proven(view.evidence))return;
  const groups=view.controlGroups.filter(group=>group.controls.some(control=>['previous','next'].includes(control.role))||group.absentControls?.some(role=>['previous','next'].includes(role)));
  if(!groups.length)return;
  const evidence=new Set(view.evidence);
  for(const group of groups){
    const owner=view.regions.find(region=>region.id===group.ownerId);
    if(!owner?.visible||!owner.sourceNodeId.trim()||!group.sourceNodeId.trim()||!proven(owner.evidence)||!proven(group.evidence))return;
    for(const role of ['previous','next']as const){
      const controls=group.controls.filter(control=>control.role===role);
      if(controls.length>1)return;
      if(controls.length===1){const control=controls[0];if(control.visible||!control.sourceNodeId.trim()||!proven(control.evidence))return;control.evidence.forEach(id=>evidence.add(id));}
      else if(!group.absentControls?.includes(role))return;
    }
    [...group.evidence,...owner.evidence].forEach(id=>evidence.add(id));
  }
  return[...evidence];
}
export function verifyFidelity(contract: BlockContract, program: NativeProgram, measurements: TargetViewportEvidence[], stateObservations: FidelityStateObservation[] = [], catalogRenders: CatalogRenderEvidence[] = [], presentationEvidence: TargetPresentationEvidence[] = [], sourceTextPackets:SourceTextPaintPacket[]=[]): FidelityVerification {
  const issues: FidelityVerification['issues'] = [], coverage: FidelityVerification['coverage'] = [];
  const interactionOverrides:NonNullable<FidelityVerification['interactionOverrides']>=[];
  const inactiveStaticText:NonNullable<FidelityVerification['inactiveStaticText']>=[];
  const contentBoundsChecks: NonNullable<FidelityVerification['contentBoundsChecks']> = [];
  const productChecks: NonNullable<FidelityVerification['productChecks']> = [];
  const add = (code: string, message: string, viewport?: string, blockId?: string, expected?: unknown, actual?: unknown, severity: 'error' | 'warning' = 'error') => issues.push({ code, severity, viewport, blockId, message, expected, actual });
  const sourceViewportNames = new Set(contract.blocks.flatMap(block => Object.keys(block.geometry)));
  try { validateContentBoundsBindings(contract, program); }
  catch (error) { add('content-bounds-binding', error instanceof Error ? error.message : 'Content bounds binding is invalid'); }
  let catalogBindings = new Map<string, CatalogBinding>();
  try { catalogBindings = validateTargetCatalogBindings(contract, program); }
  catch (error) { add('target-catalog-binding', error instanceof Error ? error.message : 'Target product query binding is invalid'); }
  for (const name of sourceViewportNames) if (!measurements.some(view => view.name === name)) add('viewport-missing', 'Source viewport has no actual target browser measurement', name);
  let statesVerified = true;
  for (const view of measurements) {
    const byKey = new Map(view.elements.map(element => [element.sourceId, element]));
    let previousY = -Infinity, matchedBlocks = 0, matchedTexts = 0, expectedTexts = 0;
    if ((view.responseStatus ?? 200) >= 400) add('target-response', 'Target preview did not render successfully', view.name, undefined, '<400', view.responseStatus);
    if (view.overflow.length) add('horizontal-overflow', 'Rendered target has horizontal overflow', view.name);
    if (view.imageFailures.length) add('image-failure', 'Rendered target has broken media', view.name, undefined, [], view.imageFailures);
    for (let index = 0; index < contract.blocks.length; index++) {
      const source = contract.blocks[index], target = program.blocks[index];
      const catalog = catalogBindings.get(source.id), renderedCatalog = catalogRenders.find(render => render.viewport === view.name && render.blockId === source.id && render.widgetKey === catalog?.query.widgetKey);
      const actual = byKey.get(target.rootKey) ?? byKey.get(source.id);
      if (!actual?.found || !actual.visible || !actual.nativeElement || actual.count !== 1) { add('block-missing', 'Source block has no unique visible native Elementor container', view.name, source.id); continue; }
      matchedBlocks++;
      if (actual.rect.y + 2 < previousY) add('block-order', 'Target block order differs from the source contract', view.name, source.id);
      previousY = actual.rect.y;
      const geometry = source.geometry[view.name];
      if (geometry) for (const dimension of ['width', 'height'] as const) {
        const tolerance = Math.max(contract.tolerances.geometryPx, geometry[dimension] * contract.tolerances.geometryRatio);
        if (Math.abs(actual.rect[dimension] - geometry[dimension]) > tolerance) add('block-geometry', `Block ${dimension} exceeds the disclosed pixel tolerance`, view.name, source.id, geometry[dimension], actual.rect[dimension]);
      }
      const expectedContent = source.contentBounds?.[view.name], contentKey = target.contentBindings?.[view.name];
      if (!expectedContent) {
        add('source-content-bounds-unverified', 'Source content width and horizontal insets have no frozen measured evidence; outer block width does not prove them', view.name, source.id, undefined, undefined, 'warning');
        contentBoundsChecks.push({ viewport: view.name, blockId: source.id, elementKey: contentKey, status: 'unverified', evidence: [] });
      } else {
        const content = contentKey ? byKey.get(contentKey) : undefined;
        const expected = { x: expectedContent.x, width: expectedContent.width, viewportWidth: expectedContent.viewportWidth, leftInset: expectedContent.x, rightInset: expectedContent.viewportWidth - expectedContent.x - expectedContent.width };
        const measured = content ? { x: content.rect.x, width: content.rect.width, viewportWidth: view.width, leftInset: content.rect.x, rightInset: view.width - content.rect.x - content.rect.width } : undefined;
        let contentPassed = true;
        if (Math.abs(view.width - expectedContent.viewportWidth) > 0.5) {
          add('content-bounds-viewport', 'Source and target content bounds were measured at different viewport widths', view.name, source.id, expectedContent.viewportWidth, view.width); contentPassed = false;
        }
        if (!content?.found || !content.visible || !content.nativeElement || content.count !== 1 || !Number.isFinite(content.rect.x) || !Number.isFinite(content.rect.width) || content.rect.width <= 0) {
          add('content-bounds-unmeasured', 'Source content box has no unique visible measured native Elementor binding', view.name, source.id, expected, measured); contentPassed = false;
        } else for (const dimension of ['width', 'leftInset', 'rightInset'] as const) {
          // Relative block-size tolerance can hide a missing centered gutter. Horizontal content bounds use the disclosed pixel tolerance only.
          if (Math.abs(measured![dimension] - expected[dimension]) > contract.tolerances.geometryPx) {
            add(`content-bounds-${dimension}`, `Content ${dimension} differs from the measured source beyond pixel tolerance`, view.name, source.id, expected[dimension], measured![dimension]); contentPassed = false;
          }
        }
        contentBoundsChecks.push({ viewport: view.name, blockId: source.id, elementKey: contentKey, status: contentPassed ? 'verified' : 'failed', expected, actual: measured, evidence: [...expectedContent.evidence, view.evidencePath] });
      }
      for (const [property, expected] of Object.entries(source.colors)) {
        const actualValue = actual.style[styleAliases[property] ?? property];
        if (!actualValue) add('color-unmeasured', `Block ${property} color has no actual browser measurement`, view.name, source.id, expected, undefined, 'warning');
        else if (!sameColor(expected, actualValue, contract.tolerances.colorChannel)) add('block-color', `Block ${property} color differs from source`, view.name, source.id, expected, actualValue);
      }
      for (const text of source.texts) {
        if (catalog?.textIds.has(text.id)) continue;
        expectedTexts++;
        const binding = target.bindings.find(item => item.sourceTextId === text.id), element = binding ? byKey.get(binding.elementKey) : undefined;
        const inactive=proveInactiveSourceText(source.id,text.text,view.name,sourceTextPackets);
        if(inactive&&binding&&retainedHiddenNativeText(program,source.id,text.id,text.text,element)){
          inactiveStaticText.push({viewport:view.name,blockId:source.id,sourceTextId:text.id,elementKey:binding.elementKey,sourceSelectors:inactive.selectors,evidence:[...inactive.evidence,view.evidencePath],status:'source-inactive'});
          // Retention is verified separately from painted-text matches. The
          // original static requirement remains in the coverage denominator.
          continue;
        }
        if(inactive){
          if(element?.visible)add('source-text-visibility','Source text is observed hidden at this viewport but its native bound widget is visible',view.name,source.id,false,true);
          else add('source-text-retention','Inactive source copy lacks its unique hidden native element and exact retained editable text setting',view.name,source.id,sourceVisibleText(text.text),element?.text);
          continue;
        }
        if (!element?.found || !element.nativeElement || element.count < 1 || (element.count !== 1 && source.presentation !== 'carousel') || !normalizeText(element.text).includes(sourceVisibleText(text.text))) add('source-text', `Exact source text was not found in its native bound widget: ${text.id}`, view.name, source.id, sourceVisibleText(text.text), element?.text);
        else matchedTexts++;
      }
      if (catalog) {
        const productElement = byKey.get(catalog.query.widgetKey);
        let problems: string[] = [];
        if (!renderedCatalog) add('target-products-unverified', 'Native product data has no actual target catalog and browser comparison', view.name, source.id, undefined, undefined, 'warning');
        else {
          problems = catalogRenderProblems(catalog, renderedCatalog, productElement);
          let measuredOrigin: string | undefined;
          try { measuredOrigin = new URL(view.url).origin; } catch { /* Invalid URL is a verification failure below. */ }
          if (measuredOrigin !== renderedCatalog.catalog.targetOrigin) problems.push('Catalog provenance does not belong to the measured target origin');
          for (const problem of problems) add('target-product-provenance', problem, view.name, source.id);
        }
        const carouselVerified = isVerifiedCatalogCarousel(catalog, renderedCatalog, productElement);
        productChecks.push({ viewport: view.name, blockId: source.id, widgetKey: catalog.query.widgetKey, status: !renderedCatalog ? 'unverified' : problems.length ? 'failed' : 'verified', productIds: renderedCatalog?.products.map(product => product.id) ?? [], replacedSourceTexts: catalog.textIds.size, replacedSourceAssets: catalog.assetKeys.size, carouselVerified, evidence: [...(renderedCatalog?.catalog.evidence ?? []), ...(renderedCatalog?.evidence ?? [])] });
      }
      if (source.presentation === 'carousel') {
        const rootDescendants = new Set<string>();
        const collect = (element: NativeElement) => { rootDescendants.add(element.key); for (const child of element.children ?? []) collect(child); }; collect(program.elements[index]);
        const nativeCarousel = catalog ? isVerifiedCatalogCarousel(catalog, renderedCatalog, byKey.get(catalog.query.widgetKey)) : view.elements.some(element => rootDescendants.has(element.sourceId) && element.found && element.nativeElement && /carousel|slider|^slides$/i.test(element.widgetType ?? ''));
        if (!nativeCarousel) add('native-carousel-missing', 'Source carousel did not render as a native carousel', view.name, source.id);
        if (catalog && renderedCatalog?.carousel && source.geometry[view.name]?.columns !== undefined && renderedCatalog.carousel.visibleColumns !== source.geometry[view.name].columns) add('product-carousel-columns', 'Target product carousel visible columns differ from the source layout', view.name, source.id, source.geometry[view.name].columns, renderedCatalog.carousel.visibleColumns);
      }
      for (const state of ['normal', 'hover', 'interaction'] as const) {
        const expected = source.states[state];
        if (expected.status === 'not-applicable') continue;
        if (expected.status === 'unobserved') { statesVerified = false; add('source-state-unobserved', expected.note ?? 'Source state is not observed', view.name, source.id, undefined, undefined, 'warning'); continue; }
        if (state === 'normal' && !Object.keys(expected.properties ?? {}).length) continue;
        const observed = stateObservations.find(item => item.viewport === view.name && item.blockId === source.id && item.state === state);
        if (!observed || observed.status !== 'verified' || !observed.evidence.length) { statesVerified = false; add('state-unverified', `Actual browser ${state} behavior was not verified`, view.name, source.id, expected.properties, observed?.properties, observed?.status === 'failed' ? 'error' : 'warning'); continue; }
        const hiddenArrows=state==='interaction'?hiddenViewportArrowEvidence(contract,source,view.name,view.width):undefined;
        const allFit=state==='interaction'&&observed.properties.allSlidesFit===true&&source.geometry[view.name]?.columns!==undefined&&typeof observed.properties.slideCount==='number'&&source.geometry[view.name].columns!>=observed.properties.slideCount;
        const nonArrowMoved=observed.properties.swipeChangesSlide===true||observed.properties.paginationChangesSlide===true;
        if(hiddenArrows){interactionOverrides.push({viewport:view.name,blockId:source.id,evidence:hiddenArrows,reason:'Observed source controls are hidden at this exact viewport; actual non-arrow movement is required instead of the global desktop arrow action.'});if(!allFit&&!nonArrowMoved){statesVerified=false;add('state-property','Hidden source arrows require verified actual non-arrow carousel movement',view.name,source.id,true,false);}}
        for (const [name, declaredValue] of Object.entries(expected.properties ?? {})) {
          // Target queries replace item identity and record count; presentation and interactions remain strict.
          if (catalog && ['sourceHref', 'sourceTextId', 'slideCount'].includes(name)) continue;
          if(allFit&&['subject','nextChangesSlide','swipeChangesSlide','arrows','arrowNext'].includes(name))continue;
          if(hiddenArrows&&name==='subject'&&declaredValue==='arrow-next'&&nonArrowMoved&&['swipe','pagination'].includes(String(observed.properties.subject)))continue;
          const value = hiddenArrows&&(name==='arrows'||name==='nextChangesSlide'||/^carousel\d+\.nextChangesSlide$/.test(name))?false:name === 'visibleSlides' && source.geometry[view.name]?.columns !== undefined ? source.geometry[view.name].columns! : declaredValue;
          const actualValue = observed.properties[name];
          const same = typeof value === 'string' && typeof actualValue === 'string' && rgb(value) ? sameColor(value, actualValue, contract.tolerances.colorChannel) : value === actualValue;
          if (!same) { statesVerified = false; add('state-property', `Actual ${state} property ${name} differs from source`, view.name, source.id, value, actualValue); }
        }
      }
    }
    coverage.push({ viewport: view.name, expectedBlocks: contract.blocks.length, matchedBlocks, expectedTexts, matchedTexts });
  }
  const presentationDetails = verifyPresentationDetails(contract, program, presentationEvidence);
  issues.push(...presentationDetails.issues);
  const structurePassed = !issues.some(issue => issue.severity === 'error'), passed = structurePassed && statesVerified && !issues.some(issue => issue.severity === 'warning');
  return { version: 1, workflow: 'block-replication', passed, structurePassed, statesVerified, status: passed ? 'passed' : structurePassed ? 'needs-review' : 'failed', issues, coverage, contentBoundsChecks, productChecks, presentationDetails, interactionOverrides, inactiveStaticText, limitations: [...contract.limitations, ...program.deviations.map(item => `${item.blockId}/${item.category}: ${item.reason}`)] };
}
