import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureSource } from '../src/capture/index.js';
import type { SourceCapture, SourceElement } from '../src/capture/types.js';
import { CodexPlanner, compactSource, compactWidgetSchemas, createPlannerIsolation, EvidenceBudgetError, expandCompactSource, inlineAssetAlias, isForbiddenPlanningEvent, planningImagePaths, planningPrompt, packPlanningEvidence, unpackPlanningEvidence, staticPageSchemas } from '../src/planning/codex.js';

test('static capability projection preserves exact registered definitions and transitive conditions', () => {
  const schemas = { heading: { controls: { title: { type: 'text' }, typography_font_size: { type: 'slider', condition: { 'typography_typography!': '' } }, typography_typography: { type: 'select', options: { custom: 'Custom' } }, motion_fx_speed: { type: 'slider' }, custom_setting: { type: 'text', conditions: { terms: [{ name: 'wd_dependency', operator: '===', value: 'yes' }] } }, wd_dependency: { type: 'switcher', condition: { wd_parent: 'yes' } }, wd_parent: { type: 'switcher' } } } };
  const projected = staticPageSchemas(schemas);
  assert.ok(projected.heading.controls);
  assert.equal(projected.heading.controls.motion_fx_speed, undefined);
  for (const name of ['title', 'typography_font_size', 'typography_typography', 'custom_setting', 'wd_dependency', 'wd_parent']) assert.deepEqual(projected.heading.controls[name], schemas.heading.controls[name as keyof typeof schemas.heading.controls]);
  assert.ok(schemas.heading.controls.motion_fx_speed);
});

test('transport dictionaries retain exact facts, aliases and repeated nested control structures', () => {
  const control = { default: 'long repeated native font family name', options: { classic: 'Classic', custom: 'Custom' }, condition: { mode: 'classic' } };
  const value = { source: { text: '~0', literal: '~~test', arbitrary: '$', geometry: [1.25, null, false] }, widgets: Array.from({ length: 100 }, (_, index) => ({ id: `widget-${index}`, controls: { title: control, body: control } })) };
  const packed = packPlanningEvidence(value);
  assert.deepEqual(unpackPlanningEvidence(packed), value);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(value).length / 2);
  const readable = packPlanningEvidence({ ...value, '$': { '$': 0 }, '$literal': '~0' }, { preserveKeys: true });
  assert.deepEqual(unpackPlanningEvidence(readable), { ...value, '$': { '$': 0 }, '$literal': '~0' });
  assert.ok(JSON.stringify(readable).includes('widgets'));
});
import { startMarketingFixture } from './fixtures/marketing.js';

function syntheticSource(): SourceCapture {
  const node = (id: string, kind: SourceElement['kind'], style: Record<string, string>, text = ''): SourceElement => ({ id, parentId: id === 'root' ? null : 'root', tag: kind === 'container' ? 'section' : kind === 'image' ? 'img' : 'h1', domPath: `body > ${id}`, text, directText: kind === 'container' ? '' : text, attributes: { id, class: 'source-implementation-class', loading: 'lazy', 'aria-label': text }, style, rect: { x: 20, y: id === 'root' ? 0 : 50, width: 700, height: 50 }, kind });
  const imageUrl = 'data:image/png;base64,iVBORw0KGgo=';
  const desktop = [node('root', 'container', { display: 'grid', color: 'rgb(0, 0, 0)', gap: '24px', width: '1440px', '::before.content': '"*"' }, 'Aggregate text is repeated below'), node('title', 'text', { display: 'block', color: 'rgb(0, 0, 0)', 'font-size': '48px', width: '700px' }, 'Visible exact heading'), node('picture', 'image', { display: 'block', color: 'rgb(0, 0, 0)', width: '700px' })];
  desktop[2].image = { url: imageUrl, alt: 'Exact alt', naturalWidth: 1200, naturalHeight: 600, objectFit: 'cover', objectPosition: '60% 50%' };
  const mobile = structuredClone(desktop);
  mobile[0].style = { display: 'flex', color: 'rgb(0, 0, 0)', gap: '16px', width: '390px' };
  mobile[1].style['font-size'] = '32px'; mobile[1].rect.width = 340;
  mobile[1].text = 'Different mobile title'; mobile[1].directText = mobile[1].text;
  mobile[2].image!.url = 'https://example.com/mobile.png';
  const make = (name: string, width: number, elements: SourceElement[]) => ({ name, width, height: 844, url: 'https://example.com/', title: 'Fixture', pageHeight: 1400, screenshotPath: '/not-used.png', domPath: '/not-used.html', evidencePath: '/not-used.json', elements, sections: [], interactions: [], assets: [], warnings: [] });
  return { version: 1, complete: true, url: 'https://example.com/', title: 'Fixture', capturedAt: '2026-01-01', viewports: [make('desktop', 1440, desktop), make('mobile', 390, mobile)], sections: [], assets: [{ url: imageUrl, kind: 'image', sourceNodeIds: ['picture'], viewports: ['desktop'] }], warnings: [], evidenceNotice: 'untrusted', artifactPath: '/not-used.json' };
}

test('compression reconstructs exact viewport node membership, rects, source IDs, computed styles, text and responsive changes', () => {
  const source = syntheticSource();
  source.viewports[0].elements[1].renderedFonts = [{ familyName: 'Segoe UI', postScriptName: 'SegoeUI', isCustomFont: false, glyphCount: 21 }];
  source.viewports[0].elements[1].effectiveOpacity = .6;
  const compact = compactSource(source); const expanded = expandCompactSource(compact);
  for (const [index, viewport] of source.viewports.entries()) {
    assert.deepEqual(expanded[index].elements.map(element => element.id), viewport.elements.map(element => element.id));
    for (const original of viewport.elements) {
      const decoded = expanded[index].elements.find(element => element.id === original.id)!;
      assert.deepEqual(decoded.rect, original.rect);
      assert.deepEqual(decoded.style, original.style);
      assert.equal(decoded.parentId, original.parentId);
      assert.equal(decoded.directText, original.directText);
      assert.deepEqual(decoded.renderedFonts, original.renderedFonts);
      assert.equal(decoded.effectiveOpacity, original.effectiveOpacity);
      if (original.kind !== 'container') assert.equal(decoded.text, original.text);
      assert.equal(decoded.attributes.class, undefined);
      assert.equal(decoded.attributes.id, original.id);
      assert.equal(decoded.attributes['aria-label'], original.attributes['aria-label']);
    }
  }
  assert.ok(compact.viewports[1].elements.some(element => element.nodeDelta));
  assert.equal(expanded[1].elements[0].style['::before.content'], undefined);
  const alias = inlineAssetAlias(source.assets[0].url);
  assert.equal(expanded[0].elements[2].image.url, alias);
  assert.deepEqual(compact.resourceAliases[alias].sourceNodeIds, ['picture']);
  assert.equal(expanded[1].elements[2].image.url, 'https://example.com/mobile.png');
  assert.ok(!JSON.stringify(compact).includes('iVBORw0KGgo='));
});

test('shared control dictionary preserves options, conditions, defaults, responsive and Repeater metadata', () => {
  const typography = { type: 'select', default: 'normal', options: { normal: 'Normal', bold: 'Bold' }, condition: { typography: 'custom' }, responsive: true };
  const repeater = { type: 'repeater', fields: [{ name: 'label', type: 'text', default: 'Item' }, { name: 'style', ...typography }] };
  const schemas = { heading: { controls: { font_weight: typography, items: repeater } }, button: { controls: { font_weight: structuredClone(typography), items: structuredClone(repeater) } } };
  const compact = compactWidgetSchemas(schemas);
  assert.equal(Object.keys(compact.controlDefinitions).length, 2);
  for (const [type, schema] of Object.entries(schemas)) for (const [name, metadata] of Object.entries(schema.controls)) {
    const reference = (compact.widgets as any)[type].controls[name];
    assert.deepEqual(compact.controlDefinitions[reference], metadata);
  }
});

test('correction inputs preserve full source and fresh target screenshots before optional crops', () => {
  const source = syntheticSource();
  source.viewports.forEach((viewport, index) => { viewport.screenshotPath = path.resolve(`source-${index}.png`); });
  source.sections = Array.from({ length: 6 }, (_, index) => ({ id: `section-${index}`, sourceNodeId: 'root', viewport: 'desktop', label: '', tag: 'section', rect: source.viewports[0].elements[0].rect, screenshotPath: path.resolve(`crop-${index}.png`), atomIds: [] }));
  const targetScreenshots = ['desktop', 'tablet', 'mobile'].map(name => path.resolve(`target-${name}.png`));
  const evidence = { source, widgetSchemas: {}, capabilities: {}, assets: [], targetScreenshots };
  const images = planningImagePaths(evidence);
  assert.deepEqual(images.slice(0, 5), [...source.viewports.map(viewport => viewport.screenshotPath), ...targetScreenshots]);
  assert.equal(images.length, 9);
  assert.match(planningPrompt(evidence, 'legacy-verified', 700), /fresh target viewports/);
});

test('actual responsive fixture compresses substantially without dropping required content or styles', async () => {
  const fixture = await startMarketingFixture(); const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-evidence-'));
  try {
    const source = await captureSource({ url: fixture.url, runDir: directory, allowLocalForTests: true });
    const previousShape = { url: source.url, title: source.title, warnings: source.warnings, viewports: source.viewports.map(viewport => ({ name: viewport.name, width: viewport.width, height: viewport.height, pageHeight: viewport.pageHeight, sections: viewport.sections.map(section => ({ id: section.id, sourceNodeId: section.sourceNodeId, rect: section.rect, atomIds: section.atomIds })), elements: viewport.elements.map(element => ({ id: element.id, parentId: element.parentId, kind: element.kind, tag: element.tag, text: element.directText || (element.kind === 'container' ? '' : element.text), rect: element.rect, style: element.style, image: element.image, link: element.link, attributes: element.attributes })), interactions: viewport.interactions })) };
    const compact = compactSource(source); const decoded = expandCompactSource(compact);
    const originalBytes = Buffer.byteLength(JSON.stringify(previousShape)); const compactBytes = Buffer.byteLength(JSON.stringify(compact));
    assert.ok(compactBytes < originalBytes * .45, `${compactBytes} / ${originalBytes}`);
    for (const [index, viewport] of source.viewports.entries()) for (const [nodeIndex, element] of viewport.elements.entries()) {
      assert.deepEqual(decoded[index].elements[nodeIndex].style, element.style);
      assert.deepEqual(decoded[index].elements[nodeIndex].rect, element.rect);
      assert.equal(decoded[index].elements[nodeIndex].directText, element.directText);
    }
  } finally { await fixture.close(); await rm(directory, { recursive: true, force: true }); }
});

test('oversized or expired planning fails before SDK/auth preparation, never silently truncates evidence', async () => {
  const source = syntheticSource(); const evidence = { source, widgetSchemas: {}, capabilities: {}, assets: [] };
  assert.throws(() => planningPrompt(evidence, 'legacy-verified', 700, 200), EvidenceBudgetError);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-budget-'));
  const planner = new CodexPlanner({ runDir: directory, mode: 'legacy-verified', timeoutMs: 1000, maxElements: 700, maxPromptBytes: 200 });
  try { await assert.rejects(planner.plan(evidence), EvidenceBudgetError); assert.deepEqual(await readdir(directory), []); }
  finally { await planner.dispose(); await rm(directory, { recursive: true, force: true }); }
  const expired = new CodexPlanner({ runDir: directory, mode: 'legacy-verified', timeoutMs: 1000, maxElements: 700, deadlineAt: Date.now() - 1 });
  await assert.rejects(expired.plan(evidence), /time budget exhausted/); await expired.dispose();
});

test('isolated constructor config copies only fake local auth and safe model preferences, excludes global servers/plugins and secret env, cleans itself', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-isolation-fixture-')); const fakeHome = path.join(directory, 'fake-home');
  await mkdir(fakeHome); await writeFile(path.join(fakeHome, 'auth.json'), '{"fixture":"FAKE_TEST_TOKEN"}');
  await writeFile(path.join(fakeHome, 'config.toml'), 'model = "fixture-model"\nmodel_reasoning_effort = "high"\napi_secret = "DO_NOT_COPY"\n[mcp_servers."dangerous-plugin"]\nurl = "https://evil.example/"\n[mcp_servers.\'other-plugin\'.env]\nSECRET = "DO_NOT_COPY"\n');
  await mkdir(path.join(fakeHome, 'plugins')); await writeFile(path.join(fakeHome, 'plugins', 'plugin.json'), 'DO_NOT_COPY');
  const isolation = await createPlannerIsolation({ sourceHome: fakeHome, tempRoot: directory, environment: { PATH: 'fixture/path', SystemRoot: 'fixture/system', SECRET_TOKEN: 'DO_NOT_COPY', OPENAI_API_KEY: 'DO_NOT_COPY', CODEX_HOME: fakeHome } });
  try {
    assert.equal(await readFile(path.join(isolation.home, 'auth.json'), 'utf8'), '{"fixture":"FAKE_TEST_TOKEN"}');
    assert.deepEqual((await readdir(isolation.home)).sort(), ['auth.json', 'config.toml']);
    assert.deepEqual(await readdir(isolation.workDir), []);
    const config = await readFile(path.join(isolation.home, 'config.toml'), 'utf8');
    assert.ok(config.includes('model = "fixture-model"')); assert.ok(config.includes('model_reasoning_effort = "high"'));
    assert.ok(!config.includes('DO_NOT_COPY')); assert.ok(!config.includes('evil.example')); assert.ok(!config.includes('dangerous-plugin'));
    assert.deepEqual(isolation.sdkOptions.config?.mcp_servers, {});
    assert.equal((isolation.sdkOptions.config?.features as any).shell_tool, false);
    assert.equal((isolation.sdkOptions.config?.features as any).apply_patch_tool, false);
    assert.equal((isolation.sdkOptions.config?.features as any).plugins, false);
    assert.equal(isolation.sdkOptions.env?.SECRET_TOKEN, undefined); assert.equal(isolation.sdkOptions.env?.OPENAI_API_KEY, undefined);
    assert.equal(isolation.sdkOptions.env?.CODEX_HOME, isolation.home);
  } finally { await isolation.dispose(); await isolation.dispose(); await assert.rejects(access(isolation.directory)); await rm(directory, { recursive: true, force: true }); }
});

test('forbidden SDK actions are recognized as soon as they start, including unknown future tool types', () => {
  for (const type of ['command_execution', 'mcp_tool_call', 'file_change', 'web_search', 'future_tool']) for (const eventType of ['item.started', 'item.updated', 'item.completed']) assert.equal(isForbiddenPlanningEvent({ type: eventType, item: { type } }), true);
  for (const type of ['agent_message', 'reasoning', 'todo_list', 'error']) assert.equal(isForbiddenPlanningEvent({ type: 'item.started', item: { type } }), false);
  assert.equal(isForbiddenPlanningEvent({ type: 'thread.started' }), false);
});
