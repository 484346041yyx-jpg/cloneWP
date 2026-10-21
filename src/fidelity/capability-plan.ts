import { createHash } from 'node:crypto';
import type { LegacySchema } from '../wordpress/types.js';
import type { BlockContract, NativeElement, NativeProgram } from './types.js';
import { hasNativeFractionBinding, NATIVE_FRACTION_ADAPTER } from './native-fraction.js';
import { validateScopedNativeCSS } from './native.js';

export type NativeFeature = 'catalog.query' | 'carousel' | 'controls.arrows' | 'controls.no-arrows' | 'controls.no-pagination' | 'controls.bullets' | 'controls.fraction' | 'controls.autoplay-toggle' | 'behavior.autoplay' | 'behavior.pause-on-hover' | 'behavior.loop';
export interface NativeFeatureRule { controls: Array<{ key: string; value?: string; type?: string }>; styleAdapter?: typeof NATIVE_FRACTION_ADAPTER; visualAbsence?: 'elementor-native-arrows'; }
/** Adapters describe known native rendering branches. Names/labels alone never prove a feature. */
export interface NativeAdapter {
  id: string; widgetType: string; className: string;
  prerequisites?: NativeFeatureRule;
  features: Partial<Record<NativeFeature, NativeFeatureRule>>;
}
export interface NativeResponsiveEnvironment { active: string[]; breakpoints: Record<string, { value: number; direction: 'max' | 'min' }>; }
export interface NativeRequirement { blockId: string; ownerId: string; viewport: string; features: NativeFeature[]; expected?: Partial<Record<NativeFeature, boolean>>; ambiguousBehavior?: boolean; evidence: string[]; }
export interface NativeCapabilityPlan {
  version: 1; status: 'expressible' | 'needs-review' | 'blocked'; passed: boolean;
  sourceSha256: string; registrySha256: string; renderVerificationRequired: true;
  scope: 'registered-query-and-interaction-branches'; presentationVerificationRequired: true;
  responsiveEnvironmentSha256?: string;
  requirements: Array<NativeRequirement & { candidates: Array<{ adapter: string; widgetType: string; registryExpressible: boolean; missing: NativeFeature[]; controlProof: string[] }>; selected?: { elementKey: string; adapter: string; configured: boolean; missing: NativeFeature[] } }>;
  gaps: Array<{ code: string; blockId: string; viewport?: string; ownerId?: string; message: string }>;
}
export const nativeAdapters: readonly NativeAdapter[] = [
  { id: 'elementor-nested-carousel', widgetType: 'nested-carousel', className: 'ElementorPro\\Modules\\NestedCarousel\\Widgets\\Nested_Carousel', features: {
    carousel: { controls: [{ key: 'carousel_items', type: 'nested-elements-repeater' }] },
    'controls.arrows': { controls: [{ key: 'arrows', type: 'switcher', value: 'yes' }] },
    'controls.no-arrows': { controls: [{ key: 'arrows', type: 'switcher', value: '' }], visualAbsence: 'elementor-native-arrows' },
    'controls.no-pagination': { controls: [{ key: 'pagination', value: '' }] },
    'controls.bullets': { controls: [{ key: 'pagination', value: 'bullets' }] },
    'controls.fraction': { controls: [{ key: 'pagination', value: 'fraction' }] },
    'behavior.autoplay': { controls: [{ key: 'autoplay', value: 'yes' }] },
    'behavior.pause-on-hover': { controls: [{ key: 'pause_on_hover', value: 'yes' }] },
    'behavior.loop': { controls: [{ key: 'infinite', value: 'yes' }] },
  } },
  { id: 'woodmart-native-products', widgetType: 'wd_products', className: 'XTS\\Elementor\\Products', features: {
    'catalog.query': { controls: [{ key: 'post_type', value: 'product' }, { key: 'items_per_page', type: 'number' }] },
    carousel: { controls: [{ key: 'layout', value: 'carousel' }] },
    'controls.arrows': { controls: [{ key: 'layout', value: 'carousel' }, { key: 'hide_prev_next_buttons', value: 'no' }] },
    'controls.no-arrows': { controls: [{ key: 'layout', value: 'carousel' }, { key: 'hide_prev_next_buttons', value: 'yes' }] },
    'controls.no-pagination': { controls: [{ key: 'layout', value: 'carousel' }, { key: 'hide_pagination_control', value: 'yes' }] },
    'controls.bullets': { controls: [{ key: 'layout', value: 'carousel' }, { key: 'hide_pagination_control', value: 'no' }] },
    'controls.fraction': { controls: [{ key: 'layout', value: 'carousel' }, { key: 'hide_pagination_control', value: 'no' }, { key: 'dynamic_pagination_control', value: 'no' }, { key: 'custom_css', type: 'code' }], styleAdapter: NATIVE_FRACTION_ADAPTER },
    'behavior.autoplay': { controls: [{ key: 'layout', value: 'carousel' }, { key: 'autoplay', value: 'yes' }] },
  } },
];
const canonical = (input: unknown): string => JSON.stringify(input && typeof input === 'object' ? Array.isArray(input) ? input.map(value => JSON.parse(canonical(value))) : Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(canonical(v))])) : input ?? null);
const hash = (input: unknown) => createHash('sha256').update(canonical(input)).digest('hex');
const flatten = (nodes: NativeElement[]): NativeElement[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);

export function collectNativeRequirements(contract: BlockContract): NativeRequirement[] {
  const output: NativeRequirement[] = [];
  for (const block of contract.blocks) {
    const viewports = new Set([...Object.keys(block.geometry), ...Object.keys(block.presentationDetails?.viewports ?? {})]);
    for (const viewport of viewports) {
      const view = block.presentationDetails?.viewports[viewport];
      const groups = view?.status === 'observed' ? view.controlGroups : [];
      // A carousel may keep arrows, fraction and dots in separate sibling
      // groups. Requirements belong to the proved engine owner, never to the
      // number of visual control groups used to arrange that one engine.
      const distinctOwners = new Set(groups.map(group => group.ownerId));
      const visibleOwners = new Set(groups.filter(group => group.visible).map(group => group.ownerId));
      const requirements: NativeRequirement[] = [...visibleOwners].map(ownerId => {
        const ownerGroups = groups.filter(group => group.ownerId === ownerId);
        const roles = new Set(ownerGroups.filter(group => group.visible).flatMap(group => group.controls.filter(control => control.visible).map(control => control.role)));
        const features: NativeFeature[] = ['carousel'];
        if (roles.has('previous') || roles.has('next')) features.push('controls.arrows');
        else if (ownerGroups.every(group => ['previous', 'next'].every(role => group.absentControls?.includes(role as 'previous' | 'next') || group.controls.some(control => control.role === role && !control.visible)))) features.push('controls.no-arrows');
        const fraction = roles.has('fraction') || ownerGroups.some(group => group.visible && group.pagination === 'fraction');
        const bullets = roles.has('dot') || ownerGroups.some(group => group.visible && group.pagination === 'bullets');
        if (fraction) features.push('controls.fraction');
        if (bullets) features.push('controls.bullets');
        // An arrows-only group cannot prove that the same owner's separate
        // pagination group is absent. All groups must agree on real absence.
        if (!fraction && !bullets && ownerGroups.every(group => group.pagination === 'none')) features.push('controls.no-pagination');
        if (roles.has('autoplay')) features.push('controls.autoplay-toggle');
        return { blockId: block.id, ownerId, viewport, features, evidence: [...new Set([...view!.evidence, ...ownerGroups.flatMap(group => group.evidence)])] };
      });
      if (!requirements.length && !groups.length && (block.presentation === 'carousel' || block.dynamicData)) requirements.push({ blockId: block.id, ownerId: block.id, viewport, features: block.presentation === 'carousel' ? ['carousel'] : [], evidence: block.evidence });
      for (const requirement of requirements) {
        if (block.dynamicData) requirement.features.push('catalog.query');
        const ownerBehaviors = groups.filter(group => group.ownerId === requirement.ownerId && group.behavior).map(group => group.behavior!);
        const own: Record<string, boolean> = {}, conflicting = new Set<string>();
        for (const behavior of ownerBehaviors) for (const [key, value] of Object.entries(behavior)) if (typeof value === 'boolean') {
          if (Object.hasOwn(own, key) && own[key] !== value) conflicting.add(key);
          else own[key] = value;
        }
        for (const key of conflicting) delete own[key];
        const inherited = block.states.interaction.status === 'observed' ? block.states.interaction.properties ?? {} : {};
        if (conflicting.size || !ownerBehaviors.length && distinctOwners.size > 1 && ['autoplay','pauseOnHover','loop','infinite'].some(key => typeof inherited[key] === 'boolean')) requirement.ambiguousBehavior = true;
        const properties: Record<string, unknown> = ownerBehaviors.length ? own : distinctOwners.size <= 1 ? inherited : {};
        const desired: Array<[NativeFeature, unknown]> = [['behavior.autoplay', properties.autoplay], ['behavior.pause-on-hover', properties.pauseOnHover], ['behavior.loop', properties.loop ?? properties.infinite]];
        for (const [feature, value] of desired) if (typeof value === 'boolean') { requirement.features.push(feature); (requirement.expected ??= {})[feature] = value; }
        requirement.features = [...new Set(requirement.features)]; output.push(requirement);
      }
    }
  }
  return output;
}

function registryRule(schema: LegacySchema, rule?: NativeFeatureRule): boolean {
  return !!rule && rule.controls.every(({ key, value, type }) => {
    const control = schema.controls[key];
    if (!control || type && control.type !== type) return false;
    if (value === undefined) return true;
    // Switcher values without explicit options are still native registered defaults/return values.
    if (control.type === 'switcher') return value === control.default || value === control.return_value || value === '' || typeof control.return_value !== 'string' && ['yes', 'no'].includes(value) && !control.options || !!control.options && Object.hasOwn(control.options, value);
    return !!control.options && Object.hasOwn(control.options, value);
  });
}
/** A registered native control may intentionally remain mounted but visually
 * hidden at an observed breakpoint. This never creates a missing interaction.
 * Accept only exact native arrow selectors, bounded media queries and their
 * actual display cascade; browser visibility is still independently required. */
function configuredArrowAbsence(schema: LegacySchema, node: NativeElement, width?: number): boolean {
  if (schema.controls.custom_css?.type !== 'code' || typeof node.settings.custom_css !== 'string' || !Number.isFinite(width)) return false;
  const css = node.settings.custom_css;
  try { validateScopedNativeCSS(css); } catch { return false; }
  const state = { previous: undefined as string | undefined, next: undefined as string | undefined };
  let ambiguous = false;
  const consume = (text: string, applies: boolean) => {
    if (!applies) return;
    for (const [, selectorList, declarations] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const display = [...declarations.matchAll(/(?:^|;)\s*display\s*:\s*([\w-]+)\s*(?:;|$)/g)].at(-1)?.[1];
      if (!display) continue;
      for (const selector of selectorList.split(',').map(value => value.trim())) {
        if (!selector.includes('.elementor-swiper-button')) continue;
        if (selector === 'selector .elementor-swiper-button') { state.previous = display; state.next = display; }
        else if (selector === 'selector .elementor-swiper-button-prev') state.previous = display;
        else if (selector === 'selector .elementor-swiper-button-next') state.next = display;
        else ambiguous = true;
      }
    }
  };
  const pattern = /@media\s*\(\s*(max|min)-width\s*:\s*(\d+)px\s*\)\s*\{((?:\s*selector[^{}]*\{[^{}]*\}\s*)+)\}|selector[^{}]*\{[^{}]*\}/g;
  for (const match of css.matchAll(pattern)) consume(match[1] ? match[3] : match[0], !match[1] || (match[1] === 'max' ? width! <= Number(match[2]) : width! >= Number(match[2])));
  return !ambiguous && state.previous === 'none' && state.next === 'none';
}

function configuredRule(schema: LegacySchema, node: NativeElement, rule: NativeFeatureRule, viewport: string, feature: NativeFeature, expected = true, deviceChain?: string[], viewportWidth?: number): boolean {
  if (rule.styleAdapter === NATIVE_FRACTION_ADAPTER && !hasNativeFractionBinding(node)) return false;
  // A fraction presentation intentionally consumes the native bullets. It is
  // not also a visible bullet pager, even though Swiper still owns bullet DOM.
  if (feature === 'controls.bullets' && hasNativeFractionBinding(node)) return false;
  let unknown = false;
  const matches = rule.controls.map(({ key, value }) => {
    if (value === undefined) return true;
    // Query mode may intentionally select a verified target subset; it remains a real query.
    if (feature === 'catalog.query' && key === 'post_type') return Object.hasOwn(schema.controls[key].options ?? {}, String(node.settings[key] ?? schema.controls[key].default));
    const chain = deviceChain ?? (viewport === 'mobile' ? ['mobile', 'tablet'] : viewport === 'tablet' ? ['tablet'] : viewport === 'desktop' ? [] : [viewport]);
    const responsive = schema.controls[key].responsive;
    const registeredResponsive = !!responsive && typeof responsive === 'object';
    // Unknown custom/probe device inheritance is not inferred from its name.
    if (!deviceChain && !['desktop','tablet','mobile'].includes(viewport) && registeredResponsive) { unknown = true; return false; }
    let actual: unknown;
    for (const device of chain) {
      const responsiveKey = `${key}_${device}`;
      if ((schema.controls[responsiveKey] || registeredResponsive) && Object.hasOwn(node.settings, responsiveKey) && node.settings[responsiveKey] !== '') { actual = node.settings[responsiveKey]; break; }
    }
    actual ??= node.settings[key] ?? schema.controls[key].default;
    if (actual === undefined) { unknown = true; return false; }
    return actual === value;
  });
  return !unknown && (expected ? matches.every(Boolean) : !matches.every(Boolean)) || expected && rule.visualAbsence === 'elementor-native-arrows' && configuredArrowAbsence(schema, node, viewportWidth);
}

/** Runs before compilation/target mutations; registry expressibility never claims browser fidelity. */
export function planNativeCapabilities(contract: BlockContract, schemas: Record<string, LegacySchema>, program?: NativeProgram, adapters: readonly NativeAdapter[] = nativeAdapters, environment?: NativeResponsiveEnvironment): NativeCapabilityPlan {
  const gaps: NativeCapabilityPlan['gaps'] = [];
  const requirements = collectNativeRequirements(contract).map(requirement => {
    const candidates = adapters.flatMap(adapter => {
      const schema = schemas[adapter.widgetType]; if (!schema || schema.class !== adapter.className) return [];
      const prerequisite = !adapter.prerequisites || registryRule(schema, adapter.prerequisites);
      const missing = requirement.features.filter(feature => !prerequisite || !registryRule(schema, adapter.features[feature]));
      return [{ adapter: adapter.id, widgetType: adapter.widgetType, registryExpressible: !missing.length, missing, controlProof: [...new Set(requirement.features.flatMap(feature => adapter.features[feature]?.controls.map(control => `${adapter.widgetType}.${control.key}`) ?? []))] }];
    });
    const source = contract.blocks.find(block => block.id === requirement.blockId)!;
    if (requirement.ambiguousBehavior) gaps.push({ code: 'source-owner-behavior-ambiguous', blockId: requirement.blockId, ownerId: requirement.ownerId, viewport: requirement.viewport, message: 'Source behavior observations conflict for this owner, or block-global flags cannot be assigned among multiple carousel owners. Freeze actual per-owner behavior before choosing native autoplay/loop settings.' });
    const viewportWidth = source.presentationDetails?.viewports[requirement.viewport]?.width ?? source.contentBounds?.[requirement.viewport]?.viewportWidth;
    const deviceChain = environment && viewportWidth ? Object.entries(environment.breakpoints).filter(([name, breakpoint]) => environment.active.includes(name) && Number.isFinite(breakpoint.value) && (breakpoint.direction === 'max' ? viewportWidth <= breakpoint.value : viewportWidth >= breakpoint.value)).sort(([, a], [, b]) => a.direction === b.direction ? a.direction === 'max' ? a.value - b.value : b.value - a.value : a.direction === 'max' ? -1 : 1).map(([name]) => name) : undefined;
    if (source.presentation === 'carousel' && !source.presentationDetails?.viewports[requirement.viewport]?.controlGroups.length) gaps.push({ code: 'source-carousel-requirements-unobserved', ...requirement, message: 'Source carousel controls and ownership must be observed before choosing a native rendering branch' });
    let selected: NativeCapabilityPlan['requirements'][number]['selected'];
    if (program) {
      const block = program.blocks.find(item => item.sourceBlockId === requirement.blockId), root = program.elements.find(node => node.key === block?.rootKey);
      const ownerBinding = block?.presentationBindings?.find(binding => binding.id === requirement.ownerId);
      const nodes = root ? flatten([root]) : [];
      const owner = ownerBinding ? nodes.find(node => node.key === ownerBinding.elementKey) : undefined;
      const isSyntheticOwner = requirement.ownerId === source.id && !source.presentationDetails?.viewports[requirement.viewport]?.controlGroups.length;
      let scope = owner ? flatten([owner]) : isSyntheticOwner ? nodes : [];
      if (block?.productQuery) scope = scope.filter(node => node.key === block.productQuery!.widgetKey);
      const choices = scope.flatMap(node => {
        const adapter = adapters.find(candidate => candidate.widgetType === node.type && schemas[node.type]?.class === candidate.className); if (!adapter) return [];
        const schema = schemas[node.type];
        const prerequisites = !adapter.prerequisites || registryRule(schema, adapter.prerequisites) && configuredRule(schema, node, adapter.prerequisites, requirement.viewport, 'carousel', true, deviceChain, viewportWidth);
        const missing = requirement.features.filter(feature => !prerequisites || !registryRule(schema, adapter.features[feature]) || !configuredRule(schema, node, adapter.features[feature]!, requirement.viewport, feature, requirement.expected?.[feature] ?? true, deviceChain, viewportWidth));
        return [{ elementKey: node.key, adapter: adapter.id, configured: !missing.length, missing }];
      });
      selected = choices.length === 1 ? choices[0] : undefined;
      if (choices.length > 1) gaps.push({ code: 'native-owner-ambiguous', blockId: requirement.blockId, viewport: requirement.viewport, ownerId: requirement.ownerId, message: 'Multiple native interaction components occur under the mapped source owner; a best-looking sibling cannot prove this source requirement' });
      if (!selected?.configured) gaps.push({ code: 'native-requirements-unmet', blockId: requirement.blockId, viewport: requirement.viewport, ownerId: requirement.ownerId, message: `Selected native component cannot express/configure: ${(selected?.missing ?? requirement.features).join(', ')}. Static text/CSS cannot substitute for missing dynamic controls.` });
    } else if (!candidates.some(candidate => candidate.registryExpressible)) gaps.push({ code: 'native-adapter-unavailable', blockId: requirement.blockId, viewport: requirement.viewport, ownerId: requirement.ownerId, message: `No registered adapter proves the complete feature bundle: ${requirement.features.join(', ')}` });
    return { ...requirement, candidates, ...(selected ? { selected } : {}) };
  });
  return { version: 1, status: gaps.some(gap => gap.code !== 'source-carousel-requirements-unobserved') ? 'blocked' : gaps.length ? 'needs-review' : 'expressible', passed: !gaps.length, sourceSha256: hash(contract), registrySha256: hash(schemas), scope: 'registered-query-and-interaction-branches', renderVerificationRequired: true, presentationVerificationRequired: true, ...(environment ? { responsiveEnvironmentSha256: hash(environment) } : {}), requirements, gaps };
}

export function assertNativeCapabilityPlan(plan: NativeCapabilityPlan, options: { reviewDraft?: boolean } = {}): void {
  // An explicitly authorized review draft may be rendered to inspect supported
  // behavior while a known native play/pause limitation remains visible. This
  // does not change plan status, waive data/query/carousel/fraction capability,
  // or grant any fidelity/completion pass.
  if (!plan.passed && options.reviewDraft && plan.requirements.every(requirement => requirement.selected && requirement.selected.missing.every(feature => feature === 'controls.autoplay-toggle')) && plan.gaps.every(gap => gap.code === 'source-carousel-requirements-unobserved' || gap.code === 'native-requirements-unmet' && plan.requirements.some(requirement => requirement.blockId === gap.blockId && requirement.ownerId === gap.ownerId && requirement.viewport === gap.viewport && requirement.selected?.missing.length && requirement.selected.missing.every(feature => feature === 'controls.autoplay-toggle')))) return;
  if (!plan.passed) throw new Error(`Native capability planning stopped before target writes: ${plan.gaps.map(gap => `${gap.blockId}/${gap.viewport ?? '*'} ${gap.code}: ${gap.message}`).join('; ')}`);
}
