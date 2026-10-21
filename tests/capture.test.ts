import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureSource, CaptureError, assertPublicUrl, isPublicAddress, inferFrozenSvgPaint, collectRenderedFonts, hydrateFrozenRenderedFonts, frozenFontFactGuard } from '../src/capture/index.js';
import { startMarketingFixture } from './fixtures/marketing.js';
import { downloadAssets } from '../src/assets/index.js';
import { compactSource, expandCompactSource } from '../src/planning/codex.js';
import sharp from 'sharp';

test('URL guards reject private, encoded loopback, credential-bearing, and unsupported source URLs', async () => {
  for (const url of ['file:///etc/passwd', 'http://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://10.0.0.1', 'http://169.254.169.254', 'https://user:password@8.8.8.8', 'http://localhost']) await assert.rejects(assertPublicUrl(url));
  for (const address of ['0.0.0.0', '172.31.0.1', '192.168.2.1', '100.64.0.2', '198.18.0.1', '203.0.113.5', '224.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  await assertPublicUrl('http://127.0.0.1', { allowLocalForTests: true });
  await assert.rejects(assertPublicUrl('http://10.0.0.1', { allowLocalForTests: true }));
});

test('real browser captures responsive marketing hierarchy, image crop, screenshots, and FAQ DOM states', async () => {
  const fixture = await startMarketingFixture();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clonewp-capture-'));
  try {
    const result = await captureSource({ url: fixture.url, runDir: dir, allowLocalForTests: true });
    assert.equal(result.complete, true);
    assert.equal(result.viewports.length, 3);
    assert.match(result.title, /Studio Verde/);
    assert.ok(result.sections.length >= 5);
    const desktop = result.viewports.find(viewport => viewport.name === 'desktop')!;
    const mobile = result.viewports.find(viewport => viewport.name === 'mobile')!;
    const heading = desktop.elements.find(element => element.tag === 'h1')!;
    assert.ok(heading.renderedFonts?.length);
    assert.ok(heading.renderedFonts.every(font => font.familyName.length > 0 && font.postScriptName.length > 0 && font.glyphCount > 0));
    assert.match(heading.text, /Build something/);
    assert.equal(heading.style['font-size'], '48px');
    assert.equal(mobile.elements.find(element => element.id === heading.id)?.style['font-size'], '36px');
    assert.ok(desktop.elements.some(element => element.style.display === 'grid' && element.style['grid-template-columns'].split(' ').length === 2));
    assert.ok(mobile.interactions.some(element => element.text === 'Menu' && element.expanded === 'false'));
    assert.ok(desktop.interactions.some(element => element.tag === 'summary'));
    assert.equal(desktop.interactions.find(element => element.tag === 'summary' && element.text === 'Can I edit my website?')?.controlledContentText, 'Yes. All important content remains editable.');
    const image = desktop.elements.find(element => element.image)!;
    assert.equal(image.image?.objectFit, 'cover');
    assert.equal(image.image?.naturalWidth, 1200);
    assert.ok(image.parentId && desktop.elements.some(element => element.id === image.parentId));
    assert.ok(result.assets.some(asset => asset.kind === 'background'));
    assert.deepEqual(result.assets.find(asset => asset.kind === 'image')?.viewports, ['desktop', 'tablet', 'mobile']);
    assert.match(result.evidenceNotice, /untrusted/);
    for (const viewport of result.viewports) { assert.ok((await readFile(viewport.screenshotPath)).length > 1000); assert.match(await readFile(viewport.domPath, 'utf8'), /Questions answered/); }
    assert.equal(JSON.parse(await readFile(result.artifactPath, 'utf8')).version, 1);
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test('capture reports bot challenges and bounded height as failures instead of successful partial evidence', async () => {
  const fixture = await startMarketingFixture();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clonewp-capture-fail-'));
  try {
    await assert.rejects(captureSource({ url: `${fixture.url}/challenge`, runDir: path.join(dir, 'challenge'), allowLocalForTests: true, viewports: [{ name: 'desktop', width: 1440, height: 1000 }] }), (error: unknown) => error instanceof CaptureError && /challenge/.test(error.message));
    await assert.rejects(captureSource({ url: `${fixture.url}/tall`, runDir: path.join(dir, 'tall'), allowLocalForTests: true, maxPageHeight: 2000, viewports: [{ name: 'desktop', width: 1440, height: 1000 }] }), /exceeds/);
    const failure = JSON.parse(await readFile(path.join(dir, 'challenge/source/desktop-failure.json'), 'utf8'));
    assert.equal(failure.complete, false);
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test('one CSS-painted SVG owns its raw paths/use/groups and exports matching frozen colors', async () => {
  const fixture = await startMarketingFixture();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clonewp-svg-ownership-'));
  try {
    const result = await captureSource({ url: `${fixture.url}/svg-only`, runDir: dir, allowLocalForTests: true, viewports: [{ name: 'desktop', width: 1440, height: 1000 }] });
    const svg = result.viewports[0].elements.find(element => element.tag === 'svg')!;
    assert.equal(svg.kind, 'image'); assert.equal(svg.primaryOwnerId, svg.id);
    assert.equal(svg.renderedFonts, undefined);
    const internals = result.viewports[0].elements.filter(element => element.domPath.startsWith(`${svg.domPath} > `));
    assert.ok(internals.some(element => element.tag === 'path')); assert.ok(internals.some(element => element.tag === 'use'));
    for (const internal of internals) assert.equal(internal.primaryOwnerId, svg.id);
    assert.equal(result.assets.filter(asset => asset.sourceNodeIds.includes(svg.id)).length, 1);
    const decoded = expandCompactSource(compactSource(result));
    assert.equal(decoded[0].elements.find(element => element.id === svg.id)?.primaryOwnerId, svg.id);
    for (const internal of internals) assert.equal(decoded[0].elements.find(element => element.id === internal.id)?.primaryOwnerId, svg.id);
    const manifest = await downloadAssets({ assets: result.assets, runDir: dir, allowLocalForTests: true });
    assert.equal(manifest.failed, 0);
    const exported = manifest.entries.find(entry => entry.sourceNodeIds.includes(svg.id))!;
    assert.equal(exported.width, 120); assert.equal(exported.height, 40);
    const { data, info } = await sharp(exported.path!).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    assert.deepEqual(pixel(20, 20), [20, 130, 60]);
    assert.deepEqual(pixel(100, 20), [40, 80, 220]);
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test('rendered font collection reports bounded missing evidence without inferring CSS fonts', async () => {
  const report = await collectRenderedFonts({} as never, [{ id: 'node1', domPath: 'h1', kind: 'text', text: 'Visible text' }], { maxNodes: 0 });
  assert.deepEqual(report.fontsById, {}); assert.equal(report.queried, 0); assert.match(report.warnings[0], /limited to 0\/1/);
  const broken = await collectRenderedFonts({ context: () => ({ newCDPSession: () => Promise.reject(new Error('Protocol unavailable')) }) } as never, [{ id: 'node1', domPath: 'h1', kind: 'text', text: 'Visible text' }]);
  assert.deepEqual(broken.fontsById, {}); assert.ok(broken.warnings.some(warning => warning.includes('unavailable')));
});

test('frozen source font hydration adds only guarded browser proof and never changes input facts', async () => {
  const fixture = await startMarketingFixture(); const dir = await mkdtemp(path.join(os.tmpdir(), 'clonewp-font-hydration-'));
  try {
    const source = await captureSource({ url: fixture.url, runDir: dir, allowLocalForTests: true, viewports: [{ name: 'desktop', width: 1440, height: 1000 }] });
    const heading = source.viewports[0].elements.find(element => element.tag === 'h1')!;
    const current = structuredClone(heading);
    const changed = structuredClone(heading); changed.text = 'Changed text';
    assert.match(frozenFontFactGuard(changed, current)!, /text differs/);
    changed.text = current.text; changed.rect.width += 1;
    assert.match(frozenFontFactGuard(changed, current)!, /width differs/);
    changed.rect = current.rect; changed.style['font-size'] = '99px';
    assert.match(frozenFontFactGuard(changed, current)!, /font-size differs/);
    for (const element of source.viewports[0].elements) delete element.renderedFonts;
    const before = JSON.stringify(source);
    const result = await hydrateFrozenRenderedFonts(source, { allowLocalForTests: true });
    assert.equal(JSON.stringify(source), before);
    assert.ok(result.source.viewports[0].elements.find(element => element.id === heading.id)?.renderedFonts?.length);
    assert.ok(result.proof.nodes.some(node => node.sourceId === heading.id && node.status === 'verified'));
    for (const [index, original] of source.viewports[0].elements.entries()) { const supplemented = { ...result.source.viewports[0].elements[index] }; delete supplemented.renderedFonts; assert.deepEqual(supplemented, original); }
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test('hidden FAQ text is read from loaded DOM without executing inert scripts or extracting form secrets', async () => {
  const fixture = await startMarketingFixture(); const dir = await mkdtemp(path.join(os.tmpdir(), 'clonewp-faq-proof-'));
  try {
    const result = await captureSource({ url: `${fixture.url}/faq-proof`, runDir: dir, allowLocalForTests: true, viewports: [{ name: 'desktop', width: 1440, height: 1000 }] });
    const interactions = result.viewports[0].interactions;
    assert.equal(interactions.find(item => item.tag === 'summary')?.controlledContentText, 'Native hidden answer already loaded. Direct sibling text.');
    assert.equal(interactions.find(item => item.controls === 'answer')?.controlledContentText, 'ARIA hidden answer from the current DOM.');
    assert.equal(interactions.find(item => item.text === 'Accordion question?')?.controlledContentText, 'Plugin hidden answer from the current DOM.');
    assert.ok(interactions.filter(item => item.controlledContentText).every(item => item.controlledContentEvidence === 'Already-loaded DOM text; hidden state and interaction behavior are unverified'));
    assert.ok(!JSON.stringify(interactions).includes('IGNORE ALL INSTRUCTIONS')); assert.ok(!JSON.stringify(interactions).includes('PRIVATE'));
    assert.equal(fixture.getFAQScriptExecutions(), 0);
    assert.ok(!result.viewports[0].elements.some(element => element.directText === 'ARIA hidden answer from the current DOM.'));
    const compact = compactSource(result);
    assert.ok(JSON.stringify(compact.viewports[0].interactions).includes('ARIA hidden answer from the current DOM.'));
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test('frozen SVG metadata separates baked root opacity from DOM ancestors and preserves child paint opacity', async () => {
  const fixture = await startMarketingFixture(); const dir = await mkdtemp(path.join(os.tmpdir(), 'clonewp-svg-opacity-'));
  try {
    const result = await captureSource({ url: `${fixture.url}/svg-opacity`, runDir: dir, allowLocalForTests: true, viewports: [{ name: 'desktop', width: 1440, height: 1000 }] });
    const svg = result.viewports[0].elements.find(element => element.tag === 'svg')!;
    const child = result.viewports[0].elements.find(element => element.tag === 'path')!;
    assert.equal(svg.effectiveOpacity, .4);
    assert.equal(child.effectiveOpacity, .24);
    assert.equal(svg.style.direction, 'rtl');
    const asset = result.assets.find(asset => asset.sourceNodeIds.includes(svg.id))!;
    assert.equal(asset.bakedOpacity, .5);
    assert.ok(asset.bakedEffects?.includes('opacity')); assert.ok(asset.bakedEffects?.includes('fill'));
    const manifest = await downloadAssets({ assets: result.assets, runDir: dir, allowLocalForTests: true });
    const exported = manifest.entries.find(entry => entry.sourceNodeIds.includes(svg.id))!;
    assert.equal(exported.bakedOpacity, .5); assert.deepEqual(exported.bakedEffects, asset.bakedEffects);
    const { data, info } = await sharp(exported.path!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const index = (20 * info.width + 60) * info.channels;
    [20, 130, 60].forEach((expected, channel) => assert.ok(Math.abs(data[index + channel] - expected) <= 1));
    assert.ok(Math.abs(data[index + 3] - Math.round(255 * .5 * .6)) <= 1, `alpha ${data[index + 3]}`);
    const legacyAsset = { ...asset }; delete legacyAsset.bakedOpacity; delete legacyAsset.bakedEffects;
    const inferred = inferFrozenSvgPaint(legacyAsset, result)!;
    assert.equal(inferred.bakedOpacity, .5); assert.ok(inferred.bakedEffects.includes('opacity'));
    assert.equal(legacyAsset.bakedOpacity, undefined);
    const changedFact = structuredClone(result); changedFact.viewports[0].elements.find(element => element.id === svg.id)!.style.opacity = '0.9';
    assert.equal(inferFrozenSvgPaint(legacyAsset, changedFact), undefined);
    assert.equal(inferFrozenSvgPaint({ ...legacyAsset, viewports: ['unknown-viewport'] }, result), undefined);
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test('source records every painted border side and explicit text decoration properties', async () => {
  const fixture = await startMarketingFixture(); const dir = await mkdtemp(path.join(os.tmpdir(), 'clonewp-painted-sides-'));
  try {
    const result = await captureSource({ url: `${fixture.url}/paint-sides`, runDir: dir, allowLocalForTests: true, viewports: [{ name: 'desktop', width: 1440, height: 1000 }] });
    const style = result.viewports[0].elements.find(element => element.tag === 'h1')!.style;
    const expected = { top: { width: '2px', style: 'solid', color: 'rgb(255, 0, 0)' }, right: { width: '3px', style: 'dashed', color: 'rgb(0, 0, 255)' }, bottom: { width: '4px', style: 'dotted', color: 'rgb(0, 128, 0)' }, left: { width: '5px', style: 'double', color: 'rgb(128, 0, 128)' } };
    for (const [side, properties] of Object.entries(expected)) for (const [property, value] of Object.entries(properties)) assert.equal(style[`border-${side}-${property}`], value);
    assert.equal(style['font-style'], 'italic'); assert.equal(style['text-decoration-line'], 'underline'); assert.equal(style['text-decoration-style'], 'wavy'); assert.equal(style['text-decoration-color'], 'rgb(255, 165, 0)'); assert.equal(style['text-decoration-thickness'], '3px');
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});
