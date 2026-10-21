import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, statfs, writeFile } from 'node:fs/promises';
import { createNative44CompareDependencies } from '../src/native44/compare-cli.js';
import { fingerprintNative44Snapshot, prepareNative44CapturePage, type Native44CompareManifest } from '../src/native44/compare.js';
import { verifyNative44AppliedCSS } from '../src/native44/css-handoff.js';
import { documentHashV2 } from '../src/replica-v2/journal.js';
import type { DraftSnapshot } from '../src/wordpress/types.js';

const root = 'D:/cloneWP';
const properties = ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'color', 'text-decoration', 'text-decoration-line'] as const;
type Check = { region: string; id: string; text: string; selector: string; sourceFact: string; expected: Record<string, string>; required?: boolean };
type StyleMap = { checks: Check[]; skipped?: unknown[]; sourceFactHash: string };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fail = (code: string): never => { throw Error(`pet_style_${code}`); };
const json = async (filename: string) => JSON.parse(await readFile(filename, 'utf8'));
const inside = (base: string, filename: string) => { const relative = path.relative(base, filename); return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative); };

function argument(name: string): string {
  const at = process.argv.indexOf(name), value = process.argv[at + 1];
  if (at < 0 || !value || value.startsWith('--')) return fail(`missing_${name.slice(2)}`);
  return path.resolve(value);
}
const firstFamily = (value: string) => value.split(',')[0].trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase().replace(/\s+/g, ' ');
function normalized(property: string, value: string): string {
  const v = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (property === 'font-family') return firstFamily(v);
  if (property === 'font-weight') return v === 'normal' ? '400' : v === 'bold' ? '700' : v;
  if (property === 'letter-spacing' && v === 'normal') return '0px';
  if (property.startsWith('text-decoration')) {
    const lines = v.match(/\b(?:underline|overline|line-through|blink)\b/g) ?? [];
    return [...new Set(lines)].sort().join(' ') || 'none';
  }
  if (property === 'color') {
    if (v === 'transparent') return 'rgba(0,0,0,0)';
    const color = /^rgba?\((.*)\)$/.exec(v);
    if (color) {
      const parts = color[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
      if (parts.length === 3) parts.push('1');
      if (parts.length === 4) return `rgba(${parts.map((part, index) => Number((parseFloat(part) * (part.endsWith('%') ? index === 3 ? 0.01 : 2.55 : 1)).toFixed(4))).join(',')})`;
    }
  }
  return v;
}
function equivalent(property: string, expected: string, actual: string): boolean {
  const a = normalized(property, expected), b = normalized(property, actual);
  if (a === b) return true;
  if (/^(?:font-size|line-height|letter-spacing)$/.test(property) && /^-?[\d.]+px$/.test(a) && /^-?[\d.]+px$/.test(b)) return Math.abs(parseFloat(a) - parseFloat(b)) <= 0.02;
  return false;
}

async function main() {
  if (process.argv.includes('--help')) { console.log('tsx tools/verify-pet-block-styles-20261017.ts --run <absolute run> --amendment <absolute amendment> --out <new independent output> [--validate-only]'); return; }
  const run = await realpath(argument('--run')), amendment = await realpath(argument('--amendment')), out = argument('--out');
  const runsRoot = await realpath(path.join(root, 'runs'));
  if (!inside(runsRoot, run) || !inside(path.join(run, 'amendments'), amendment) || !inside(runsRoot, out) || out === run || inside(amendment, out) || inside(out, run)) fail('input_or_output_path_boundary');
  const mapFile = path.join(amendment, 'static-style-map.json'), cssFile = path.join(amendment, 'page-custom.css'), rulesFile = path.join(amendment, 'rules.json');
  const [mapBytes, cssBytes, ruleBytes, snapshotBytes, manifestBytes] = await Promise.all([mapFile, cssFile, rulesFile, path.join(amendment, 'after.json'), path.join(run, 'compare-manifest.json')].map(file => readFile(file)));
  const map = JSON.parse(mapBytes.toString()) as StyleMap, saved = JSON.parse(snapshotBytes.toString()) as DraftSnapshot;
  const manifest = JSON.parse(manifestBytes.toString()) as Native44CompareManifest, intent = await json(path.join(amendment, 'intent.json'));
  if (saved.status !== 'draft' || saved.pageId !== manifest.pageId || saved.runId !== manifest.runId || saved.hash !== documentHashV2(saved.elements, saved.settings) || intent.pageId !== saved.pageId || intent.runId !== saved.runId || intent.expectedHash !== saved.hash || intent.cssSha256 !== sha(cssBytes)) fail('amendment_snapshot_or_css_binding');
  const cssBinding = verifyNative44AppliedCSS(cssBytes.toString(), String(saved.settings.custom_css ?? ''), manifest.replicationProfile);
  if (!cssBinding.applied) fail('saved_css_differs_from_revision');
  Object.assign(manifest, fingerprintNative44Snapshot(saved));
  if (!manifest.sourceCaptures || map.sourceFactHash !== manifest.sourceCaptures.sourceFacts.sha256) fail('source_fact_identity');
  const sourceCaptures = manifest.sourceCaptures!;
  const factsPath = await realpath(path.resolve(root, sourceCaptures.sourceFacts.path));
  if (!inside(root, factsPath) || (await stat(factsPath)).size > 64 * 1024 * 1024) fail('source_fact_file_boundary');
  const factBytes = await readFile(factsPath);
  if (sha(factBytes) !== map.sourceFactHash) fail('source_fact_bytes_changed');
  const facts = JSON.parse(factBytes.toString());
  if (!Array.isArray(map.checks) || !map.checks.length || map.checks.length > 5000 || !Array.isArray(manifest.viewports) || manifest.viewports.length !== 2 || !manifest.viewports.some(v => v.width === 1920 && v.height === 1080) || !manifest.viewports.some(v => v.width === 1440 && v.height === 1000)) fail('style_map_or_desktop_coverage');
  const viewports = manifest.viewports!;
  for (const check of map.checks) {
    const source = facts.facts[check.sourceFact];
    if (!check.id || !check.region || !check.selector.startsWith(`.elementor-${manifest.pageId} `) || !check.expected || !source || source.kind !== 'text' || !Object.keys(check.expected).length) fail('unbound_style_check');
    for (const [property, value] of Object.entries(check.expected)) if (!(properties as readonly string[]).includes(property) || typeof value !== 'string' || typeof source.value.style[property] !== 'string' || !equivalent(property, value, source.value.style[property])) fail('expected_style_differs_from_source_fact');
  }
  const checks = map.checks.map((check, index) => {
    // A link inside an already required heading/list text is supplementary.
    // Missing the primary selector is never waived because a child is optional.
    const base = check.selector.endsWith(' a') ? check.selector.slice(0, -2) : undefined;
    const supplemental = !!base && map.checks.some(other => other.selector === base && other.id === check.id && other.sourceFact === check.sourceFact);
    return { ...check, index, required: check.required ?? !supplemental };
  });
  const binding = { pageId: manifest.pageId, runId: manifest.runId, taskId: manifest.taskId, documentHash: saved.hash, snapshotSha256: sha(snapshotBytes), cssSha256: sha(cssBytes), rulesSha256: sha(ruleBytes), styleMapSha256: sha(mapBytes), sourceFactsSha256: sha(factBytes), manifestSha256: sha(manifestBytes) };
  if (process.argv.includes('--validate-only')) { console.log(JSON.stringify({ status: 'local-style-inputs-verified', binding, checks: checks.length, primary: checks.filter(c => c.required).length, supplemental: checks.filter(c => !c.required).length, remoteReads: 0, documentWrites: 0 })); return; }
  await mkdir(out, { recursive: true });
  if (!inside(runsRoot, await realpath(out))) fail('resolved_output_path_boundary');
  const existing = await readFile(path.join(out, 'style-review-input.json'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; });
  if (existing && JSON.stringify(JSON.parse(existing).binding) !== JSON.stringify(binding)) fail('output_belongs_to_different_revision');
  const disk = await statfs(out); if (disk.bavail * disk.bsize < 512 * 1024 * 1024) fail('insufficient_evidence_disk');
  await writeFile(path.join(out, 'style-review-input.json'), JSON.stringify({ version: 1, kind: 'read-only-static-style-review-input', binding, run, amendment, normalization: 'Primary font family; CSS normal/bold weights; normal letter spacing = 0px; numeric pixel tolerance 0.02px; text-decoration-line only; RGB/A formatting. Original raw values retained.' }, null, 2));
  const dep = await createNative44CompareDependencies(root, manifest);
  const captures: unknown[] = [];
  try {
    const initial = await dep.readSnapshot(); if (initial.documentHash !== saved.hash || !verifyNative44AppliedCSS(cssBytes.toString(), initial.pageCss, manifest.replicationProfile).applied) fail('current_document_or_css_changed_before_review');
    const page = await dep.openPage(manifest.targetUrl, 'target');
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const preparation = await prepareNative44CapturePage(page, manifest.interactionChecks ?? [], viewport.name);
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await page.mouse.move(viewport.width - 1, viewport.height - 1);
      const snapshotId = sourceCaptures.viewports.find(view => view.viewport === viewport.name)?.snapshotId;
      if (!snapshotId) fail('viewport_source_binding_missing');
      const scopedChecks = checks.map(check => {
        const source = facts.facts[check.sourceFact], actualFact = `${snapshotId}:${check.sourceFact.split(':').slice(1).join(':')}`;
        const scopedFact = facts.facts[actualFact];
        if (!scopedFact || scopedFact.kind !== source.kind || scopedFact.regionId !== source.regionId || scopedFact.value.text !== source.value.text) fail('matching_desktop_source_fact_missing');
        const expected = Object.fromEntries(Object.keys(check.expected).map(property => [property, scopedFact.value.style[property]]));
        return { ...check, expected, expectedSourceFact: actualFact };
      });
      const observer = ({ checks, controls, properties, productChecks }: { checks: typeof scopedChecks; controls: NonNullable<Native44CompareManifest['interactionChecks']>; properties: string[]; productChecks: NonNullable<Native44CompareManifest['productChecks']> }) => {
        const cloned = (node: Element) => Boolean(node.closest('.swiper-slide-duplicate,.slick-cloned'));
        const box = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; };
        const rows = checks.map(check => {
          const all = [...document.querySelectorAll(check.selector)], originals = all.filter(node => !cloned(node));
          return { index: check.index, totalCount: all.length, excludedClones: all.length - originals.length, samples: originals.map(node => { const s = getComputedStyle(node); return { tag: node.tagName, text: (node.textContent ?? '').trim().slice(0, 240), widgetId: node.closest('[data-id]')?.getAttribute('data-id') ?? null, box: box(node), display: s.display, visibility: s.visibility, opacity: s.opacity, styles: Object.fromEntries(properties.map(property => [property, s.getPropertyValue(property === 'text-decoration' ? 'text-decoration-line' : property)])) }; }) };
        });
        const arrows = controls.map(control => {
          const owners = [...document.querySelectorAll(control.selector)].filter(node => !cloned(node));
          const buttons = owners.flatMap(owner => ['previous', 'next'].flatMap(direction => [...owner.querySelectorAll(direction === 'next' ? control.nextSelector ?? '.elementor-swiper-button-next' : control.previousSelector ?? '.elementor-swiper-button-prev')].filter(node => !cloned(node)).map(node => { const s = getComputedStyle(node); return { direction, tag: node.tagName, classes: node.className, box: box(node), background: s.background, backgroundImage: s.backgroundImage, backgroundColor: s.backgroundColor, backgroundSize: s.backgroundSize, borderRadius: s.borderRadius, boxShadow: s.boxShadow, color: s.color, display: s.display, visibility: s.visibility, before: { content: getComputedStyle(node, '::before').content, backgroundImage: getComputedStyle(node, '::before').backgroundImage }, icon: [...node.querySelectorAll('svg,i,img')].map(icon => ({ tag: icon.tagName, box: box(icon), display: getComputedStyle(icon).display, opacity: getComputedStyle(icon).opacity })) }; })));
          return { key: control.componentKey, selector: control.selector, originalOwnerCount: owners.length, buttons };
        });
        const describe = (node: Element | null) => {
          if (!node) return null;
          const s = getComputedStyle(node);
          return { tag: node.tagName, classes: node.className, box: box(node), padding: s.padding, margin: s.margin, gap: s.gap, display: s.display, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, color: s.color, border: s.border, boxSizing: s.boxSizing, text: (node.textContent ?? '').trim().slice(0, 240) };
        };
        const horizontallyVisible = (node: Element | null) => {
          if (!node) return false;
          const r = node.getBoundingClientRect(); let left = Math.max(0, r.left), right = Math.min(document.documentElement.clientWidth, r.right);
          if (r.width <= 0 || r.height <= 0) return false;
          for (let owner: Element | null = node; owner; owner = owner.parentElement) { const s = getComputedStyle(owner); if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return false; if (owner !== node && /^(hidden|clip|auto|scroll)$/.test(s.overflowX)) { const clip = owner.getBoundingClientRect(); left = Math.max(left, clip.left); right = Math.min(right, clip.right); } }
          return right - left > 1;
        };
        const products = productChecks.map(check => {
          const all = [...document.querySelectorAll(check.selector)], originals = all.filter(node => !cloned(node));
          const root = originals.length === 1 ? originals[0] : undefined;
          const card = root?.querySelector('.wd-product') ?? root?.querySelector('.product') ?? null;
          const wrapper = card?.querySelector('.wd-product-wrapper,.product-wrapper') ?? null;
          const title = card?.querySelector('.wd-entities-title') ?? null;
          const image = card?.querySelector('.product-element-top img') ?? card?.querySelector('img') ?? null;
          return { key: check.componentKey, region: check.componentKey.replace(/-product-.*$/, ''), selector: check.selector, originalOwnerCount: originals.length, excludedClones: all.length - originals.length, expectedProductIds: check.expectedProductIds, actualWidgetId: root?.getAttribute('data-id'), actualWidgetType: root?.getAttribute('data-widget_type'), horizontallyVisible: horizontallyVisible(card), owner: describe(root ?? null), card: describe(card), wrapper: describe(wrapper), title: describe(title), titleLink: describe(title?.querySelector('a') ?? null), imageFrame: describe(card?.querySelector('.product-element-top') ?? null), image: describe(image), price: describe(card?.querySelector('.price') ?? null), slide: describe(root?.closest('.swiper-slide') ?? null) };
        });
        const visibleProducts: Record<string, typeof products> = {};
        for (const product of products.filter(item => item.horizontallyVisible)) { const group = visibleProducts[product.region] ?? []; if (group.length < 5) group.push(product); visibleProducts[product.region] = group; }
        return { rows, arrows, products, firstFiveHorizontallyVisibleProducts: visibleProducts, viewport: { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth }, fonts: [...document.fonts].map(font => ({ family: font.family, weight: font.weight, style: font.style, status: font.status })) };
      };
      // tsx can annotate nested function names; supply that lexical helper
      // inside the serialized read-only observer, as the existing QA helpers do.
      const observed = await page.evaluate(new Function('input', `const __name=value=>value;return (${observer.toString()})(input);`) as (input: unknown) => ReturnType<typeof observer>, { checks: scopedChecks, controls: manifest.interactionChecks ?? [], properties: [...properties], productChecks: manifest.productChecks ?? [] });
      const requiredMissing: unknown[] = [], optionalMissing: unknown[] = [], requiredDifferences: unknown[] = [], optionalDifferences: unknown[] = [], ownershipProblems: unknown[] = [];
      const results = scopedChecks.map(check => {
        const actual = observed.rows.find(row => row.index === check.index)!;
        if (!actual.samples.length) (check.required ? requiredMissing : optionalMissing).push({ index: check.index, region: check.region, id: check.id, selector: check.selector, text: check.text, expectedSourceFact: check.expectedSourceFact });
        const differences: unknown[] = [];
        actual.samples.forEach((sample, sampleIndex) => {
          if (sample.widgetId !== check.id) ownershipProblems.push({ index: check.index, selector: check.selector, expectedId: check.id, actualId: sample.widgetId, sampleIndex });
          for (const [property, expected] of Object.entries(check.expected)) {
            const value = sample.styles[property];
            if (!equivalent(property, String(expected), value)) { const difference = { index: check.index, region: check.region, selector: check.selector, id: check.id, text: check.text, sampleIndex, property, expected, actual: value, expectedNormalized: normalized(property, String(expected)), actualNormalized: normalized(property, value) }; differences.push(difference); (check.required ? requiredDifferences : optionalDifferences).push(difference); }
          }
        });
        return { ...check, ...actual, differences };
      });
      const capture = { viewport: viewport.name, observedViewport: observed.viewport, binding, requiredMissing, optionalMissing, requiredDifferences, optionalDifferences, ownershipProblems, results, arrows: observed.arrows, products: observed.products, firstFiveHorizontallyVisibleProducts: observed.firstFiveHorizontallyVisibleProducts, fonts: observed.fonts, preparation };
      captures.push(capture); await writeFile(path.join(out, `${viewport.name}-styles.json`), JSON.stringify(capture, null, 2));
      console.log(JSON.stringify({ viewport: viewport.name, checks: checks.length, requiredMissing: requiredMissing.length, optionalMissing: optionalMissing.length, requiredDifferences: requiredDifferences.length, optionalDifferences: optionalDifferences.length, ownershipProblems: ownershipProblems.length, observedArrowButtons: observed.arrows.reduce((n, row) => n + row.buttons.length, 0) }));
    }
    const final = await dep.readSnapshot(); if (final.documentHash !== initial.documentHash) fail('document_changed_during_style_review');
    const appliedCSS = verifyNative44AppliedCSS(cssBytes.toString(), final.pageCss, manifest.replicationProfile);
    if (!appliedCSS.applied) fail('css_changed_during_style_review');
    const failed = (captures as any[]).some(c => c.requiredMissing.length || c.requiredDifferences.length || c.optionalDifferences.length || c.ownershipProblems.length);
    await writeFile(path.join(out, 'block-styles-report.json'), JSON.stringify({ version: 1, kind: 'actual-two-desktop-static-style-review', status: failed ? 'differences' : 'passed', binding, documentUnchanged: true, appliedCSS, captures, skippedSourceMappings: map.skipped ?? [], limits: ['Typography/color/decoration checks do not prove complete pixel or interaction fidelity.', 'Supplementary anchors may be absent; when present their actual styles are checked.', 'Arrow geometry and backgrounds are actual observations, without an automatic equivalence claim.'], metrics: { documentWrites: 0, editorSessions: 0, targetSnapshotReads: 2, viewports: 2 }, observedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ status: failed ? 'style-differences-recorded' : 'styles-passed', output: path.join(out, 'block-styles-report.json'), documentHash: final.documentHash, documentWrites: 0 }));
    if (failed) process.exitCode = 1;
  } finally { await dep.close?.(); }
}

await main().catch(error => { console.error(error instanceof Error && /^pet_style_[a-z_]+$/.test(error.message) ? error.message : 'pet_style_read_only_review_failed; inspect the guarded comparison setup or the last completed viewport evidence'); process.exitCode = 1; });
