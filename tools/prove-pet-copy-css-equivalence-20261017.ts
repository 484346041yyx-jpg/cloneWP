import { readFile, writeFile } from 'node:fs/promises';
import { createNative44CompareDependencies } from '../src/native44/compare-cli.js';
import { prepareNative44CapturePage } from '../src/native44/compare.js';
import { canonicalNative44CSS } from '../src/native44/css-handoff.js';
const run = 'D:/cloneWP/runs/2026-10-17-pet-unified-draft', dir = run + '/amendments/20261017-unified-copy', out = 'D:/cloneWP/runs/2026-10-17-pet-unified-review';
const manifest = JSON.parse(await readFile(run + '/compare-manifest.json', 'utf8')), saved = JSON.parse(await readFile(dir + '/after.json', 'utf8'));
const currentCSS = canonicalNative44CSS(await readFile(dir + '/page-custom.css', 'utf8')), baselineCSS = canonicalNative44CSS(await readFile(dir + '/baseline-page-custom.css', 'utf8'));
console.log(JSON.stringify({ phase: 'owned-preview-preflight', pageId: 15734 }));
const dep = await createNative44CompareDependencies('D:/cloneWP', manifest);
try {
  const initial = await dep.readSnapshot(); if (initial.documentHash !== saved.hash) throw Error('Current repair draft changed');
  const page = await dep.openPage(manifest.targetUrl, 'target');
  console.log(JSON.stringify({ phase: 'preview-opened' }));
  const href = await page.locator('#elementor-post-15734-css').getAttribute('href'); if (!href) throw Error('Actual page stylesheet owner missing');
  const response = await page.request.get(href); if (!response.ok()) throw Error('Actual current page stylesheet unavailable');
  const originalFull = canonicalNative44CSS(await response.text()), index = originalFull.indexOf(currentCSS);
  if (index < 0 || originalFull.indexOf(currentCSS, index + 1) >= 0) throw Error('Full saved custom CSS cannot be uniquely bound inside generated native CSS');
  const baselineFull = originalFull.slice(0, index) + baselineCSS + originalFull.slice(index + currentCSS.length);
  const inspect = () => page.evaluate(async () => {
    const output: Array<{ node: string; style: string; box: number[] }> = [];
    for (const [index, element] of Array.from(document.querySelectorAll('.elementor-15734,.elementor-15734 *')).entries()) for (const pseudo of ['', '::before', '::after']) {
    const computed = getComputedStyle(element, pseudo || null), box = element.getBoundingClientRect();
    // Custom-property token whitespace can change under canonical serialization;
    // its resolved effect is covered by every standard computed property below.
    const values = Array.from(computed).filter(property => !property.startsWith('--') && !/^(?:animation|transition)/.test(property)).map(property => property + ':' + computed.getPropertyValue(property)).join(';');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(values));
    output.push({ node: index + ':' + element.tagName + ':' + pseudo, style: Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join(''), box: [box.x, box.y + scrollY, box.width, box.height] });
    }
    return output;
  });
  const differences = (a: any[], b: any[]) => b.flatMap((next, index) => {
    const previous = a[index]; return !previous || previous.node !== next.node || previous.style !== next.style || previous.box.some((value: number, i: number) => Math.abs(value - next.box[i]) > 0.02) ? [{ node: next.node, styleChanged: previous?.style !== next.style, previousBox: previous?.box, nextBox: next.box }] : [];
  });
  const captures: any[] = [];
  for (const viewport of manifest.viewports) {
    console.log(JSON.stringify({ phase: 'computed-style-proof', viewport: viewport.name }));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await prepareNative44CapturePage(page, manifest.interactionChecks, viewport.name);
    await page.evaluate(() => document.fonts.ready.then(() => true)); await page.mouse.move(viewport.width - 1, viewport.height - 1);
    const live = await inspect();
    await page.evaluate(value => {
      const link = document.getElementById('elementor-post-15734-css') as HTMLLinkElement;
      let replacement = document.getElementById('cwp-local-css-equivalence') as HTMLStyleElement | null;
      if (!replacement) { replacement = document.createElement('style'); replacement.id = 'cwp-local-css-equivalence'; link.insertAdjacentElement('beforebegin', replacement); }
      replacement.textContent = value; link.sheet!.disabled = true;
    }, originalFull);
    const wrapperDifferences = differences(live, await inspect()); if (wrapperDifferences.length) throw Error('Temporary stylesheet replacement changed native CSS: ' + JSON.stringify(wrapperDifferences.slice(0, 5)));
    await page.locator('#cwp-local-css-equivalence').evaluate((node, value) => { node.textContent = value; }, baselineFull);
    const before = await inspect();
    await page.locator('#cwp-local-css-equivalence').evaluate((node, value) => { node.textContent = value; }, originalFull);
    const after = await inspect(), diff = differences(before, after);
    captures.push({ viewport: viewport.name, elementsAndPseudos: before.length, differenceCount: diff.length, differences: diff.slice(0, 20), nativeStylesheetWrapperEquivalent: true });
    if (diff.length || before.length !== after.length) throw Error('Consolidation changed actual computed CSS: ' + JSON.stringify(captures.at(-1)));
    console.log(JSON.stringify(captures.at(-1)));
  }
  const final = await dep.readSnapshot(); if (final.documentHash !== initial.documentHash) throw Error('Saved page changed during local CSS equivalence check');
  await writeFile(out + '/css-equivalence.json', JSON.stringify({ kind: 'actual-browser-computed-css-equivalence', pageId: 15734, documentHash: final.documentHash, savedDocumentUnchanged: true, documentWrites: 0, captures, observedAt: new Date().toISOString() }, null, 2));
} finally { await dep.close?.(); }
