import { leaseVerificationEditor } from '../editor-completion/session.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { captureTarget, createScopedContext } from '../verification/capture-target.js';
import { targetSelector } from '../verification/bindings.js';
import type { ScopedBrowserAuth, SourceInteractionEvidence, TargetViewportEvidence, VerificationIssue, Viewport } from '../verification/types.js';
import type { ElementorElement, LegacyComposition, TargetCatalogSnapshot } from '../wordpress/types.js';
import type { OriginalDesign, OriginalNode } from './types.js';
import { attachEditorStartupNetwork, awaitNativeEditorReady, type NativeEditorReadinessReport } from '../verification/editor-readiness.js';
import type { StylesheetReadinessReport } from '../verification/stylesheet-readiness.js';
import type { OriginalNativeComponent } from './components.js';
import { inspectOriginalNativeComponents, type OriginalNativeBrowserReport } from './native-verification.js';

export interface OriginalVerificationOptions {
  design: OriginalDesign;
  /** Must be the real saved and read-back Elementor document, not a planned tree. */
  composition: LegacyComposition;
  elementMap: Record<string, string>;
  previewUrl: string;
  runDir: string;
  auth?: ScopedBrowserAuth;
  viewports?: Viewport[];
  expectedMedia?: Record<string, { attachmentId: number; url: string; variants?: string[] }>;
  browser?: Browser;
  nativeDocumentId?: number;
  nativeRootIds?: string[];
  nativeCatalogIds?: string[];
  nativeComponents?: OriginalNativeComponent[];
  catalog?: TargetCatalogSnapshot;
}
export interface OriginalSectionVerification { key: string; targetId: string; native: boolean; visible: boolean; editableElementCount: number }
export interface OriginalNavigationVerification { key: string; targetId: string; anchor: string; clicked: boolean; targetVisible: boolean; restored: boolean; error?: string }
export interface OriginalViewportExtras { viewport: string; documentWidth: number; viewportWidth: number; rawBodyScrollWidth?: number; bodyOverflowX?: string; scrollRoot?: string; anchorCounts: Record<string, number>; navigation: OriginalNavigationVerification[] }
export interface OriginalVerificationReport {
  version: 1;
  kind: 'original-homepage';
  passed: boolean;
  issues: VerificationIssue[];
  screenshots: Array<{ viewport: string; target: string }>;
  measurements: TargetViewportEvidence[];
  sections: OriginalSectionVerification[];
  browserChecks: OriginalViewportExtras[];
  nativeElementCount: number;
  coverage: Array<{ viewport: string; expected: number; matched: number }>;
  editability: { status: 'native-document-verified'; actualEditorSaveRequired: true };
  nativeComponents: OriginalNativeBrowserReport[];
}
export interface OriginalEditorSectionReport {
  version: 1;
  passed: boolean;
  readOnly: true;
  sections: Array<{ key: string; targetId: string; selected: boolean; panelLoaded: boolean; nativeContainer: boolean; panelModelId?: string; controls: string[]; screenshot?: string; error?: string }>;
  issues: VerificationIssue[];
  startupDiagnostic?: { evidencePath: string; screenshot?: string };
  readiness?: NativeEditorReadinessReport;
}

const defaultViewports: Viewport[] = [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 900, height: 1024 }, { name: 'mobile', width: 390, height: 844 }];
const widgetKinds: Record<OriginalNode['kind'], string> = { container: '', heading: 'heading', text: 'text-editor', image: 'image', button: 'button', accordion: 'accordion', products: 'wd_products', carousel: 'nested-carousel' };
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
function designNodes(roots: OriginalNode[]): OriginalNode[] { return roots.flatMap(node => [node, ...designNodes(node.children ?? [])]); }
function documentNodes(roots: ElementorElement[]): ElementorElement[] { return roots.flatMap(node => [node, ...documentNodes(node.elements ?? [])]); }

/** Failure evidence is read-only and excludes cookies, private query strings and input values. */
export async function captureOriginalEditorStartupDiagnosis(page: Page, firstId: string | undefined, directory: string, documentResponses: Array<{ location: string; status: number }> = []) {
  const publicLocation = (raw: string) => { try { const value = new URL(raw); return ['http:', 'https:'].includes(value.protocol) ? `${value.origin}${value.pathname}` : value.protocol === 'about:' ? 'about:blank' : 'unavailable'; } catch { return 'unavailable'; } };
  const bounded = async <T>(operation: Promise<T>): Promise<T | { inspectionUnavailable: true }> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation, new Promise<{ inspectionUnavailable: true }>(resolve => { timer = setTimeout(() => resolve({ inspectionUnavailable: true }), 5_000); })]); }
    catch { return { inspectionUnavailable: true }; }
    finally { if (timer) clearTimeout(timer); }
  };
  const safeId = firstId && /^[\w-]+$/.test(firstId) ? firstId : undefined;
  const frames = [];
  for (const frame of page.frames()) {
    const state = await bounded(frame.evaluate(id => {
      const inspect = (selector: string) => Array.from(document.querySelectorAll(selector)).slice(0, 6).map(element => {
        const box = element.getBoundingClientRect(), style = getComputedStyle(element);
        return { tag: element.tagName.toLowerCase(), nativeId: element.getAttribute('data-id'), elementType: element.getAttribute('data-element_type'), width: box.width, height: box.height, display: style.display, visibility: style.visibility };
      });
      return { readyState: document.readyState, loginForm: !!document.querySelector('#loginform'), nativeIdCount: document.querySelectorAll('[data-id]').length, dataIdMatches: id ? inspect(`[data-id="${id}"]`) : [], sharedSelectorMatches: id ? inspect(`[data-id="${id}"], .elementor-element-${id}, .e-${id}`) : [], navigatorPresent: !!document.querySelector('#elementor-navigator'), panelPresent: !!document.querySelector('#elementor-panel'), safeErrors: Array.from(document.querySelectorAll('.wp-die-message,.php-error-message')).slice(0, 4).map(element => (element.textContent ?? '').replace(/https?:\/\/[^\s<>"']+/g, '[URL omitted]').slice(0, 300)) };
    }, safeId));
    frames.push({ location: publicLocation(frame.url()), state });
  }
  const evidencePath = path.join(directory, 'startup-diagnosis.json');
  const screenshot = path.join(directory, 'startup-failure.png');
  let capturedScreenshot: string | undefined;
  try { await page.screenshot({ path: screenshot, fullPage: false, timeout: 5_000 }); capturedScreenshot = screenshot; } catch { /* The failure remains explicit when a stalled editor cannot be captured. */ }
  const iframeAttributes = await bounded(page.evaluate(() => Array.from(document.querySelectorAll('iframe')).map(frame => {
    let location = 'unavailable';
    try { const source = new URL(frame.getAttribute('src') ?? '', document.location.href); location = `${source.origin}${source.pathname}`; } catch { /* Incomplete loading frame. */ }
    const box = frame.getBoundingClientRect();
    return { id: frame.id, location, width: box.width, height: box.height };
  })));
  await writeFile(evidencePath, JSON.stringify({ version: 1, readOnly: true, location: publicLocation(page.url()), firstId: safeId, frames, iframeAttributes, documentResponses: documentResponses.map(response => ({ location: publicLocation(response.location), status: response.status })) }, null, 2));
  return { evidencePath, ...(capturedScreenshot ? { screenshot: capturedScreenshot } : {}) };
}

/** Opens the real editor and selects each authored section. It never fills controls or saves. */
export async function verifyOriginalEditorSections(options: { design: OriginalDesign; elementMap: Record<string, string>; editorUrl: string; runDir: string; auth?: ScopedBrowserAuth; browser?: Browser }): Promise<OriginalEditorSectionReport> {
  const url = new URL(options.editorUrl);
  if (!/^\d+$/.test(url.searchParams.get('post') ?? '') || url.searchParams.get('action') !== 'elementor' || !url.pathname.endsWith('/wp-admin/post.php')) throw new Error('A native Elementor editor URL is required.');
  const ownBrowser = !options.browser, browser = options.browser ?? await chromium.launch({ headless: true });
  const report: OriginalEditorSectionReport = { version: 1, passed: false, readOnly: true, sections: [], issues: [] };
  const directory = path.join(options.runDir, 'verification', 'editor-sections');
  await mkdir(directory, { recursive: true });
  const lease = await leaseVerificationEditor(browser, options.editorUrl, options.auth).catch(async error => { if (ownBrowser) await browser.close(); throw error; });
  const context = lease.context;
  let editorPage: Page | undefined;
  const documentResponses: Array<{ location: string; status: number }> = [];
  try {
    const page = lease.page;
    editorPage = page;
    const startupResponses = attachEditorStartupNetwork(page);
    page.on('response', response => { if (response.request().resourceType() === 'document' && documentResponses.length < 20) { const address = new URL(response.url()); documentResponses.push({ location: `${address.origin}${address.pathname}`, status: response.status() }); } });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await lease.navigate();
    if (new URL(page.url()).origin !== url.origin || /wp-login\.php/.test(page.url())) throw new Error('The authenticated browser did not reach the intended Elementor editor.');
    const frame = page.frameLocator('#elementor-preview-iframe');
    const firstId = options.elementMap[options.design.sections[0]?.key ?? ''];
    if (!firstId || !/^[\w-]+$/.test(firstId)) throw new Error('The authored first section has no valid native mapping.');
    report.readiness = await awaitNativeEditorReady({ page, editorUrl: options.editorUrl, rootIds: options.design.sections.map(section => options.elementMap[section.key]), runDir: options.runDir, label: 'sections', requirePanelAPI: true, responses: startupResponses });
    if (!await page.locator('#elementor-navigator').isVisible()) {
      const opener = page.locator('#elementor-panel-footer-navigator').or(page.getByRole('button', { name: /^(Navigator|Structure|导航器|導航器|结构|結構)$/ })).first();
      if (await opener.isVisible()) await opener.click();
      else await page.keyboard.press('Control+i');
    }
    await page.locator('#elementor-navigator').waitFor({ state: 'visible', timeout: 10_000 });
    const expand = page.locator('#elementor-navigator__toggle-all[data-elementor-action="expand"]');
    if (await expand.isVisible()) await expand.click();
    for (const [index, section] of options.design.sections.entries()) {
      const targetId = options.elementMap[section.key];
      const proof: OriginalEditorSectionReport['sections'][number] = { key: section.key, targetId: targetId ?? '', selected: false, panelLoaded: false, nativeContainer: false, controls: [] };
      report.sections.push(proof);
      try {
        if (!targetId || !/^[\w-]+$/.test(targetId) || section.kind !== 'container') throw new Error('The authored section must map to a native container.');
        const widget = frame.locator(targetSelector({ targetId })).first();
        proof.nativeContainer = await widget.evaluate(element => element.getAttribute('data-element_type') === 'container' && !!element.closest('.elementor,[data-elementor-type]'));
        if (!proof.nativeContainer) throw new Error('The editor iframe section is not a native Elementor container.');
        const row = page.locator(`#elementor-navigator .elementor-navigator__element[data-id="${targetId}"]`).first();
        await row.locator(':scope > .elementor-navigator__item').click({ timeout: 10_000 });
        await page.waitForFunction(id => {
          const elementor = (window as unknown as { elementor?: { getPanelView?: () => { getCurrentPageView?: () => { model?: { get?: (key: string) => unknown; id?: string } } } } }).elementor;
          const model = elementor?.getPanelView?.().getCurrentPageView?.().model;
          return String(model?.get?.('id') ?? model?.id ?? '') === id;
        }, targetId, { timeout: 10_000 });
        const panel = await page.evaluate(() => {
          const elementor = (window as unknown as { elementor?: { getPanelView?: () => { getCurrentPageView?: () => { model?: { get?: (key: string) => unknown; id?: string } } } } }).elementor;
          const model = elementor?.getPanelView?.().getCurrentPageView?.().model;
          return { modelId: String(model?.get?.('id') ?? model?.id ?? ''), controls: Array.from(document.querySelectorAll('#elementor-panel [data-setting]')).filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; }).map(element => element.getAttribute('data-setting') ?? '').filter(Boolean) };
        });
        proof.panelModelId = panel.modelId;
        proof.controls = [...new Set(panel.controls)];
        proof.selected = panel.modelId === targetId;
        proof.panelLoaded = proof.controls.some(control => ['content_width', 'width', 'flex_direction', 'boxed_width', 'min_height'].includes(control));
        if (!proof.panelLoaded) throw new Error('The selected native container did not expose its layout controls.');
        proof.screenshot = path.join(directory, `${String(index + 1).padStart(2, '0')}-${section.key.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`);
        await page.screenshot({ path: proof.screenshot, fullPage: false });
      } catch (error) {
        proof.error = error instanceof Error ? error.message : String(error);
        report.issues.push({ code: 'native-section-editor-selection', status: 'unverified', severity: 'error', sourceId: section.key, targetId, message: proof.error });
      }
    }
  } catch (error) {
    report.issues.push({ code: 'native-section-editor-unavailable', status: 'unverified', severity: 'error', message: error instanceof Error ? error.message : String(error) });
    if (editorPage) report.startupDiagnostic = await captureOriginalEditorStartupDiagnosis(editorPage, options.elementMap[options.design.sections[0]?.key ?? ''], directory, documentResponses).catch(() => undefined);
  }
  finally { await lease.release(report.issues.length === 0); if (ownBrowser) await browser.close(); }
  report.passed = report.issues.length === 0 && report.sections.length === options.design.sections.length && report.sections.every(section => section.selected && section.panelLoaded && section.nativeContainer);
  await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(report, null, 2));
  return report;
}

/** Verifies an authored design against the native document and real browser. No foreign-page or pixel-clone score is used. */
export async function verifyOriginal(options: OriginalVerificationOptions): Promise<OriginalVerificationReport> {
  const issues: VerificationIssue[] = [];
  const add = (code: string, message: string, details: Partial<VerificationIssue> = {}) => issues.push({ code, message, status: 'mismatch', severity: 'error', ...details });
  const authored = designNodes(options.design.sections), saved = documentNodes(options.composition.elements);
  const nativeComponents = options.nativeComponents ?? [];
  const componentNodes = authored.filter(node => node.kind === 'products' || node.kind === 'carousel');
  for (const node of componentNodes) if (!nativeComponents.some(component => component.key === node.key && component.kind === node.kind && component.nativeId === options.elementMap[node.key])) add('original-native-component-proof-missing', `Native component ${node.key} lacks its actually compiled data/interaction binding.`, { sourceId: node.key });
  if (!options.design.sections.length) add('original-design-empty', 'An authored homepage must contain native sections.');
  const savedById = new Map<string, ElementorElement[]>();
  for (const element of saved) savedById.set(element.id, [...(savedById.get(element.id) ?? []), element]);
  const designKeys = new Set<string>(), mappedIds = new Set<string>();
  for (const node of authored) {
    const id = options.elementMap[node.key];
    if (designKeys.has(node.key)) add('design-key-duplicate', `Authored key ${node.key} is repeated.`, { sourceId: node.key });
    designKeys.add(node.key);
    if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) { add('native-mapping-missing', `No legal native mapping exists for ${node.key}.`, { sourceId: node.key }); continue; }
    if (mappedIds.has(id)) add('native-mapping-duplicate', `Two authored nodes use the same native element ${id}.`, { sourceId: node.key, targetId: id });
    mappedIds.add(id);
    const matches = savedById.get(id) ?? [];
    if (matches.length !== 1) { add('native-document-count', `Authored node ${node.key} must have exactly one saved native element.`, { sourceId: node.key, targetId: id, expected: 1, actual: matches.length }); continue; }
    const element = matches[0];
    if (node.kind === 'container' ? element.elType !== 'container' : element.elType !== 'widget' || element.widgetType !== widgetKinds[node.kind]) add('native-document-kind', `The saved native type does not match ${node.kind} for ${node.key}.`, { sourceId: node.key, targetId: id, expected: widgetKinds[node.kind] || 'container', actual: element.widgetType ?? element.elType });
    const expectedChildren = (node.children ?? []).map(child => options.elementMap[child.key]);
    if (JSON.stringify(element.elements.map(child => child.id)) !== JSON.stringify(expectedChildren)) add('native-parent-order', `Saved children differ from the authored parent and order for ${node.key}.`, { sourceId: node.key, targetId: id, expected: expectedChildren, actual: element.elements.map(child => child.id) });
    if (node.kind === 'image') {
      const image = element.settings.image as { id?: number; url?: string } | undefined;
      if (!image || !Number.isInteger(image.id) || Number(image.id) <= 0 || !image.url || !/^https?:\/\//.test(image.url)) add('native-media-import', `Image ${node.key} has no real imported WordPress media control.`, { sourceId: node.key, targetId: id });
      const expected = node.asset ? options.expectedMedia?.[node.asset] : undefined;
      if (expected && (image?.id !== expected.attachmentId || image?.url !== expected.url)) add('native-media-identity', `The saved image does not match the import receipt for ${node.key}.`, { sourceId: node.key, targetId: id });
    }
  }
  if (JSON.stringify(options.composition.elements.map(element => element.id)) !== JSON.stringify(options.design.sections.map(section => options.elementMap[section.key]))) add('native-section-order', 'The saved top-level sections differ from the authored order.');
  for (const element of saved) if (!mappedIds.has(element.id)) add('native-unmapped-element', `Saved element ${element.id} is outside the authored design.`, { targetId: element.id });
  const bindings = Object.fromEntries(authored.filter(node => options.elementMap[node.key] && /^[a-zA-Z0-9_-]{1,100}$/.test(options.elementMap[node.key])).map(node => [node.key, { targetId: options.elementMap[node.key], kind: node.kind, selector: `[data-id="${options.elementMap[node.key]}"]:not(.swiper-slide-duplicate *, .slick-cloned *)` }]));
  const interactions: SourceInteractionEvidence[] = authored.filter(node => node.kind === 'accordion').flatMap(node => (node.items ?? []).map(item => ({ sourceNodeId: node.key, tag: 'button', role: 'button', text: item.title, controlledContentText: item.content, expanded: 'false', disabled: false })));
  const viewports = options.viewports ?? defaultViewports;
  if (interactions.length > 20) add('faq-verification-limit', 'The authored FAQ exceeds the safe native verification limit of 20 items.');
  const ownBrowser = !options.browser, browser = options.browser ?? await chromium.launch({ headless: true });
  let measurements: TargetViewportEvidence[] = [], browserChecks: OriginalViewportExtras[] = [];
  const nativeReports: OriginalNativeBrowserReport[] = [];
  // Navigation shares the same CSS-ready, vertically warmed and initialized page
  // as the native/data capture. No second page can race its lazy runtime.
  const inspectNavigation = async (page: Page, viewport: Viewport) => {
    const anchors = authored.filter(node => node.anchor).map(node => node.anchor!);
    const geometry = await page.evaluate(keys => ({ documentWidth: (document.scrollingElement ?? document.documentElement).scrollWidth, rawBodyScrollWidth: document.body.scrollWidth, bodyOverflowX: getComputedStyle(document.body).overflowX, scrollRoot: (document.scrollingElement ?? document.documentElement).tagName.toLowerCase(), viewportWidth: window.innerWidth, anchorCounts: Object.fromEntries(keys.map(key => [key, Array.from(document.querySelectorAll('[id]')).filter(element => element.id === key).length])) }), anchors);
    const extras: OriginalViewportExtras = { viewport: viewport.name, ...geometry, navigation: [] };
    browserChecks.push(extras);
    if (geometry.documentWidth > geometry.viewportWidth + 4) add('document-horizontal-overflow', 'The whole page is wider than its viewport.', { viewport: viewport.name, expected: geometry.viewportWidth, actual: geometry.documentWidth });
    for (const anchor of anchors) if (geometry.anchorCounts[anchor] !== 1) add('authored-anchor-count', `Anchor ${anchor} must exist exactly once.`, { viewport: viewport.name, expected: 1, actual: geometry.anchorCounts[anchor] });
    for (const node of authored.filter(node => node.href?.startsWith('#'))) {
      const anchor = node.href!.slice(1), targetId = options.elementMap[node.key];
      const proof: OriginalNavigationVerification = { key: node.key, targetId, anchor, clicked: false, targetVisible: false, restored: false };
      extras.navigation.push(proof);
      try {
        if (!targetId || !/^[a-zA-Z0-9_-]{1,100}$/.test(targetId) || !anchors.includes(anchor) || geometry.anchorCounts[anchor] !== 1) throw new Error('The authored in-page target is missing or ambiguous.');
        const root = page.locator(targetSelector({ targetId })).first(), links = root.locator('a');
        const matching = [];
        for (let index = 0; index < await links.count(); index++) if ((await links.nth(index).getAttribute('href')) === node.href) matching.push(links.nth(index));
        if (matching.length !== 1) throw new Error('The native widget has no unique authored local anchor link.');
        const start = new URL(page.url());
        await matching[0].click({ timeout: 5_000 });
        proof.clicked = true;
        const after = new URL(page.url());
        if (after.origin !== start.origin || after.pathname !== start.pathname || after.search !== start.search || after.hash !== node.href) throw new Error('The local link navigated away from the same preview page.');
        const destination = page.locator(`[id="${anchor}"]`);
        for (let attempt = 0; attempt < 20; attempt++) {
          proof.targetVisible = await destination.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0; });
          if (proof.targetVisible) break;
          await page.waitForTimeout(100);
        }
        if (!proof.targetVisible) throw new Error('The local link did not scroll its destination into view.');
        await page.evaluate(url => { history.replaceState(history.state, '', url); window.scrollTo(0, 0); }, start.href);
        proof.restored = page.url() === start.href;
      } catch (error) { proof.error = error instanceof Error ? error.message : String(error); }
      if (!proof.clicked || !proof.targetVisible || !proof.restored) add('native-navigation', `In-page navigation ${node.key} was not verified.`, { viewport: viewport.name, sourceId: node.key, targetId, actual: proof });
    }
  };

  try {
    try { measurements = await captureTarget({ previewUrl: options.previewUrl, runDir: options.runDir, viewports, elementMap: bindings, auth: options.auth, browser, sourceInteractions: Object.fromEntries(viewports.map(viewport => [viewport.name, interactions])), nativeDocumentId: options.nativeDocumentId, nativeRootIds: options.nativeRootIds ?? options.design.sections.map(section => options.elementMap[section.key]), nativeCatalogIds: options.nativeCatalogIds ?? nativeComponents.filter(component => component.kind === 'products').map(component => component.nativeId), inspectPage: async (page, viewport) => { const proof = await inspectOriginalNativeComponents({ page, viewport, design: options.design, elementMap: options.elementMap, components: nativeComponents, catalog: options.catalog, runDir: options.runDir }); nativeReports.push(proof); issues.push(...proof.issues); await inspectNavigation(page, viewport); } }); }
    catch (error) { add('original-target-capture-unavailable', error instanceof Error ? error.message : 'Actual target browser capture unavailable', { status: 'unverified' }); }
    if (measurements.length !== viewports.length) add('original-viewport-evidence-incomplete', 'Every requested viewport requires actual target measurements and screenshot proof.', { expected: viewports.length, actual: measurements.length });
    for (const measurement of measurements) {
      const detail = { viewport: measurement.name };
      const styles = (measurement as TargetViewportEvidence & { stylesheetReadiness?: StylesheetReadinessReport }).stylesheetReadiness;
      if (!styles?.ready || options.nativeDocumentId && styles.attempts.at(-1)?.documentStyleScope?.status !== 'observed') add('original-document-stylesheet-readiness', 'The actual document CSS scope must be observed and ready before original acceptance.', { ...detail, actual: styles });
      if (measurement.screenshotGeometry?.status !== 'unchanged') add('original-screenshot-geometry', 'Screenshot capture did not retain the measured browser geometry.', { ...detail, actual: measurement.screenshotGeometry });
      for (const gap of measurement.screenshotGeometry?.gaps ?? []) add(`original-${gap.code}`, gap.message, { ...detail, status: 'unverified' });
      if (measurement.screenshotCapture?.passed !== true) add('original-screenshot-capture', 'Actual screenshot retains unresolved named capture limitations.', { ...detail, actual: measurement.screenshotCapture, status: 'unverified' });
      const nativeProof = nativeReports.find(report => report.viewport === measurement.name);
      const clippedIds = new Set(nativeProof?.carousels.filter(proof => proof.initialized && proof.changed && proof.restored && !proof.error).flatMap(proof => proof.clippedNativeIds) ?? []);
      if (!measurement.responseStatus || measurement.responseStatus < 200 || measurement.responseStatus >= 400) add('preview-http-status', 'The native preview did not return a successful HTTP response.', { ...detail, actual: measurement.responseStatus });
      const measured = new Map(measurement.elements.map(element => [element.sourceId, element]));
      for (const node of authored) {
        const target = measured.get(node.key), identity = { ...detail, sourceId: node.key, targetId: options.elementMap[node.key] };
        if (!target?.found || target.count !== 1 || !target.nativeElement) { add('native-browser-element', `Native element ${node.key} is missing, repeated or outside Elementor.`, { ...identity, actual: target?.count ?? 0 }); continue; }
        if ((!target.visible || (target.effectiveOpacity ?? 1) === 0) && !clippedIds.has(options.elementMap[node.key])) add('native-browser-hidden', `Authored element ${node.key} is not visible and lacks actual canonical carousel window/interaction proof.`, identity);
        if (node.kind !== 'container' && target.widgetType?.split('.')[0] !== widgetKinds[node.kind]) add('native-browser-widget', `Rendered widget ${node.key} has the wrong native type.`, { ...identity, expected: widgetKinds[node.kind], actual: target.widgetType });
        if (['heading', 'text', 'button'].includes(node.kind) && node.text && !normalize(target.text).includes(normalize(node.text))) add('authored-text-missing', `The authored text for ${node.key} is missing from the rendered widget.`, { ...identity, expected: node.text, actual: target.text });
        if (node.href) { let expected: string | undefined; try { const url = new URL(node.href, options.previewUrl); if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) && !url.username && !url.password) expected = url.href; } catch { /* An invalid destination cannot pass. */ } if (!expected || target.href !== expected) add('authored-link-destination', `The native destination for ${node.key} differs from its explicit safe authored href.`, { ...identity, expected, actual: target.href }); }
        if (node.kind === 'image' && (!target.images.length || target.images.some(image => !image.complete || image.naturalWidth === 0 || image.naturalHeight === 0))) add('authored-image-broken', `The real image for ${node.key} did not load.`, identity);
        if (node.kind === 'image') {
          const receipt = node.asset ? options.expectedMedia?.[node.asset] : undefined;
          const savedImage = (savedById.get(options.elementMap[node.key])?.[0]?.settings.image ?? {}) as { url?: string };
          const permitted = new Set(receipt ? [receipt.url, ...(receipt.variants ?? [])] : [savedImage.url].filter((url): url is string => typeof url === 'string'));
          if (target.images.length && target.images.some(image => !permitted.has(image.url))) add('authored-media-render', `Rendered image ${node.key} does not match its actual imported attachment URLs.`, { ...identity, expected: [...permitted], actual: target.images.map(image => image.url) });
          const alt = node.alt ?? options.design.assets.find(asset => asset.key === node.asset)?.alt;
          if (alt && target.images.some(image => normalize(image.alt) !== normalize(alt))) add('authored-image-alt', `The authored alternative text for ${node.key} is missing.`, { ...identity, expected: alt, actual: target.images.map(image => image.alt) });
        }
      }
      let previousBottom = -1;
      for (const section of options.design.sections) {
        const target = measured.get(section.key);
        if (!target?.visible) continue;
        if (target.rect.y < previousBottom - 4) add('browser-section-order', `Section ${section.key} overlaps or precedes the previous section.`, { ...detail, sourceId: section.key, actual: target.rect });
        previousBottom = target.rect.y + target.rect.height;
      }
      const clips = (measurement as TargetViewportEvidence & { nativeCarouselClips?: Array<{ selector: string; carouselId: string; documentWidth: number; viewportWidth: number }> }).nativeCarouselClips ?? [];
      const provedCarouselIds = new Set(nativeProof?.carousels.filter(proof => proof.initialized && proof.changed && proof.restored && !proof.error).map(proof => proof.nativeId) ?? []);
      const provedProductIds = new Set(nativeProof?.products.filter(proof => proof.passed && nativeComponents.some(component => component.nativeId === proof.nativeId && component.kind === 'products' && component.display.layout === 'carousel')).map(proof => proof.nativeId) ?? []);
      const overflow = measurement.overflow.filter(row => !clips.some(clip => clip.selector === row.selector && clip.documentWidth <= clip.viewportWidth + 4 && (provedCarouselIds.has(clip.carouselId) || provedProductIds.has(clip.carouselId))));
      if (overflow.length) add('horizontal-overflow', 'Rendered native elements exceed the viewport width without actual controlled native clipping proof.', { ...detail, actual: overflow });
      if (measurement.imageFailures.length) add('preview-image-failures', 'The preview contains visible images that did not load.', { ...detail, actual: measurement.imageFailures });
      if (measurement.canvasShell?.visibleToolbarCount) add('unexpected-theme-toolbar', 'An unrelated theme toolbar is visible on the authored Canvas page.', detail);
      if (measurement.canvasShell && Math.abs(Number.parseFloat(measurement.canvasShell.bodyPaddingBottom) || 0) > 1) add('unexpected-theme-padding', 'The Canvas body has unexpected bottom padding.', { ...detail, actual: measurement.canvasShell.bodyPaddingBottom });
      for (const [index, item] of interactions.entries()) {
        const proof = measurement.interactions?.[index];
        if (!proof || proof.status !== 'verified' || !proof.clicked || !proof.restored) add('faq-behavior', `The native FAQ ${item.text} did not expand and restore correctly.`, { ...detail, sourceId: item.sourceNodeId, actual: proof });
        if (!proof?.controlledContentText || !normalize(proof.controlledContentText).includes(normalize(item.controlledContentText ?? ''))) add('faq-answer', `The native FAQ ${item.text} did not reveal its authored answer.`, { ...detail, sourceId: item.sourceNodeId, expected: item.controlledContentText, actual: proof?.controlledContentText });
      }
      if (measurement.pageErrors.length) add('preview-javascript-errors', 'The rendered page reported JavaScript exceptions.', { ...detail, actual: measurement.pageErrors });
    }

  } finally { if (ownBrowser) await browser.close(); }
  const sections = options.design.sections.map(section => {
    const keys = designNodes([section]).map(node => node.key);
    const allMeasured = measurements.flatMap(measurement => measurement.elements.filter(element => keys.includes(element.sourceId)));
    const native = allMeasured.length === keys.length * viewports.length && allMeasured.every(element => element.found && element.count === 1 && element.nativeElement);
    return { key: section.key, targetId: options.elementMap[section.key] ?? '', native, visible: measurements.every(measurement => measurement.elements.find(element => element.sourceId === section.key)?.visible === true), editableElementCount: native ? keys.length : 0 };
  });
  const report: OriginalVerificationReport = {
    version: 1, kind: 'original-homepage', passed: !issues.some(issue => issue.severity === 'error'), issues,
    screenshots: measurements.map(measurement => ({ viewport: measurement.name, target: measurement.screenshotPath })), measurements, sections, browserChecks,
    nativeElementCount: saved.length,
    coverage: measurements.map(measurement => ({ viewport: measurement.name, expected: authored.length, matched: measurement.elements.filter(element => element.found && element.count === 1 && element.nativeElement).length })),
    editability: { status: 'native-document-verified', actualEditorSaveRequired: true },
    nativeComponents: nativeReports,
  };
  await mkdir(path.join(options.runDir, 'verification'), { recursive: true });
  await writeFile(path.join(options.runDir, 'verification', 'original.json'), JSON.stringify(report, null, 2));
  return report;
}
