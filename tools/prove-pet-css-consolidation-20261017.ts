import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createNative44CompareDependencies } from '../src/native44/compare-cli.js';
import { fingerprintNative44Snapshot, prepareNative44CapturePage } from '../src/native44/compare.js';
import { canonicalNative44CSS } from '../src/native44/css-handoff.js';
import * as cssTree from 'css-tree';
import { createHash } from 'node:crypto';
const run = 'D:/cloneWP/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c', dir = run + '/amendments/20261017-unified-repair', out = 'D:/cloneWP/runs/2026-10-17-pet-unified-repair-15621';
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const before = await json(dir + '/before.json'), candidate = await readFile(dir + '/page-custom.css', 'utf8');
const manifest = await json(out + '/compare-manifest.json'); Object.assign(manifest, fingerprintNative44Snapshot(before));
const dep = await createNative44CompareDependencies('D:/cloneWP', manifest);
await mkdir(out, { recursive: true });
try {
  const initial = await dep.readSnapshot(); if (initial.documentHash !== before.hash) throw Error('Current draft differs from cleanup baseline');
  const page = await dep.openPage(manifest.targetUrl, 'target');
  const styles = await page.evaluate(() => Array.from(document.querySelectorAll('style')).map(style => ({ id: style.id, length: style.textContent?.length ?? 0, customStart: style.textContent?.indexOf('Start custom CSS') ?? -1, customEnd: style.textContent?.indexOf('End custom CSS') ?? -1 })));
  console.log(JSON.stringify({ styles }));
  if (process.argv.includes('--inspect')) {
    await writeFile(out + '/stylesheet-inspection.json', JSON.stringify(styles, null, 2));
    const declarations: Array<{ property: string; value: string }> = [];
    cssTree.walk(cssTree.parse(before.settings.custom_css), node => { if (node.type === 'Declaration') declarations.push({ property: node.property, value: cssTree.generate(node.value) }); });
    const supported: string[] = [];
    for (let index = 0; index < declarations.length; index += 200) supported.push(...await page.evaluate(items => items.filter(item => CSS.supports(item.property, item.value)).map(item => item.property + ':' + item.value), declarations.slice(index, index + 200)));
    await writeFile(out + '/browser-css-support.json', JSON.stringify({ sourceDocumentHash: before.hash, cssSha256: createHash('sha256').update(before.settings.custom_css).digest('hex'), supported: [...new Set(supported)], observedAt: new Date().toISOString() }, null, 2));
  }
  else {
    const style = styles.filter(item => item.customStart >= 0 && item.customEnd >= 0);
    if (style.length !== 1) throw Error('Custom CSS block owner is not unique');
    const locator = page.locator('style' + (style[0].id ? '#' + style[0].id : ''));
    if (await locator.count() !== 1) throw Error('Custom CSS stylesheet is not uniquely addressable');
    const original = await locator.textContent(); if (!original) throw Error('Current CSS stylesheet missing');
    const startMarker = /\/\*\s*Start custom CSS[\s\S]*?\*\//.exec(original), endMarker = /\/\*\s*End custom CSS\s*\*\//.exec(original);
    if (!startMarker || !endMarker) throw Error('Custom CSS marker boundaries missing');
    const start = startMarker.index + startMarker[0].length, end = endMarker.index;
    if (canonicalNative44CSS(original.slice(start, end)) !== canonicalNative44CSS(before.settings.custom_css)) throw Error('Browser CSS does not equal actual saved page CSS');
    const swapped = original.slice(0, start) + candidate + original.slice(end), evidence: any[] = [];
    const inspect = async () => page.evaluate(() => {
      const output: Array<{ node: string; style: string; box: number[] }> = [];
      for (const [index, element] of Array.from(document.querySelectorAll('.elementor-15621, .elementor-15621 *')).entries()) {
        for (const pseudo of ['', '::before', '::after']) {
          const computed = getComputedStyle(element, pseudo || null), rect = element.getBoundingClientRect();
          // Animated transforms and transition clocks are deliberately excluded;
          // layout and every paint/style property are compared at a stable frame.
          const values = Array.from(computed).filter(property => !/^(?:animation|transition)/.test(property)).map(property => property + ':' + computed.getPropertyValue(property)).join(';');
          output.push({ node: index + ':' + element.tagName + ':' + pseudo, style: values, box: [rect.x, rect.y + scrollY, rect.width, rect.height] });
        }
      }
      return output;
    });
    for (const viewport of manifest.viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await prepareNative44CapturePage(page, manifest.interactionChecks, viewport.name);
      await page.evaluate(() => document.fonts.ready.then(() => true)); await page.mouse.move(viewport.width - 1, viewport.height - 1);
      const beforeStyles = await inspect();
      await locator.evaluate((node, value) => { node.textContent = value; }, swapped);
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const afterStyles = await inspect(), differences = afterStyles.flatMap((item, index) => {
        const old = beforeStyles[index]; if (!old || old.node !== item.node || old.style !== item.style || old.box.some((value, n) => Math.abs(value - item.box[n]) > 0.02)) return [{ node: item.node, styleChanged: old?.style !== item.style, beforeBox: old?.box, afterBox: item.box }]; return [];
      });
      evidence.push({ viewport: viewport.name, elementsAndPseudos: beforeStyles.length, differences: differences.slice(0, 30), differenceCount: differences.length });
      await page.screenshot({ path: out + '/' + viewport.name + '-candidate-top.png' });
      await locator.evaluate((node, value) => { node.textContent = value; }, original);
      if (differences.length || beforeStyles.length !== afterStyles.length) throw Error('CSS cleanup changed actual computed style or geometry: ' + JSON.stringify(evidence.at(-1)));
    }
    const final = await dep.readSnapshot(); if (final.documentHash !== initial.documentHash) throw Error('Saved draft changed during temporary CSS equivalence proof');
    await writeFile(out + '/css-equivalence.json', JSON.stringify({ kind: 'actual-browser-computed-css-equivalence', sourceDocumentHash: before.hash, savedDocumentUnchanged: true, documentWrites: 0, captures: evidence, observedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ equivalent: true, evidence }));
  }
} finally { await dep.close?.(); }
