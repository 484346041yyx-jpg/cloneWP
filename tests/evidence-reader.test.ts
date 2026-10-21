import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { EvidenceStore, EVIDENCE_TOOLS, type EvidenceBundle } from '../src/planning/evidence-store.js';
import { isForbiddenPlanningEvent } from '../src/planning/codex.js';

const fixture = (): EvidenceBundle => ({
  source: { encoding: 'clonewp-evidence-v2', url: 'https://source.example/', title: 'Public page', warnings: [], styleBase: { color: '#111', padding: '0px' }, stylePatches: { s0: {}, s1: { color: '#222', padding: null } }, resourceAliases: {}, resources: [], nodes: { root: { kind: 'container', tag: 'div', text: '', directText: '' }, text: { parentId: 'root', kind: 'text', tag: 'p', text: 'Desktop text', directText: 'Desktop text' } }, viewports: [{ name: 'desktop', width: 1440, height: 1000, pageHeight: 1000, sections: [], interactions: [], elements: [{ id: 'root', rect: { x: 0, y: 0, width: 500, height: 200 }, styleRef: 's0' }, { id: 'text', rect: { x: 20, y: 30, width: 200, height: 30 }, styleRef: 's0' }] }, { name: 'mobile', width: 390, height: 844, pageHeight: 844, sections: [], interactions: [], elements: [{ id: 'text', rect: { x: 10, y: 20, width: 180, height: 60 }, styleRef: 's1', nodeDelta: { text: 'Mobile text', directText: 'Mobile text' } }] }] },
  widgets: { heading: { controls: { title: { type: 'text' }, title_color: { type: 'color', default: '#111' } } } }, assets: [{ attachmentId: 1, url: 'https://target.example/image.png' }], capabilities: { mode: 'legacy-verified' },
  previous: { title: 'Existing', mode: 'legacy-verified', compositionJson: JSON.stringify({ elements: [{ id: 'ab00001', elType: 'container', settings: {}, elements: [{ id: 'ab00002', elType: 'widget', widgetType: 'heading', settings: { title: 'Existing title' }, elements: [] }] }] }), mappings: [{ sourceId: 'text', targetId: 'ab00002' }], unsupported: [] }, issues: [{ code: 'geometry', sourceId: 'text' }],
});

test('read-only evidence restores exact viewport deltas, CSS, hierarchy and previous native IDs', () => {
  const store = new EvidenceStore(fixture());
  const mobile = store.execute('read_nodes', { viewport: 'mobile', ids: ['text'] }) as any;
  const style = { ...mobile.styleBase }; for (const [key, value] of Object.entries(mobile.styles[mobile.nodes[0].styleRef])) { if (value === null) delete style[key]; else style[key] = value; }
  assert.equal(mobile.nodes[0].text, 'Mobile text'); assert.deepEqual(style, { color: '#222' }); assert.equal(mobile.nodes[0].rect.height, 60);
  const desktop = store.execute('read_nodes', { viewport: 'desktop', ids: ['root'] }) as any;
  assert.deepEqual(desktop.nodes[0].childIds, ['text']);
  const detached = fixture();
  detached.source.viewports[1].elements.unshift(detached.source.viewports[0].elements[0]);
  detached.source.viewports[1].elements[1].nodeDelta!.parentId = null;
  const detachedRoot = new EvidenceStore(detached).execute('read_nodes', { viewport: 'mobile', ids: ['root'] }) as any;
  assert.deepEqual(detachedRoot.nodes[0].childIds, []);
  const previous = store.execute('read_context', { section: 'previous' }) as any;
  assert.deepEqual(previous.nodes[0].elements, ['ab00002']); assert.equal(previous.nodes[1].parentId, 'ab00001'); assert.deepEqual(previous.nodes[1].sourceIds, ['text']);
  assert.throws(() => store.execute('read_nodes', { viewport: 'desktop', ids: ['../../config/credentials.local.json'] }), /absent/);
  assert.throws(() => store.execute('read_nodes', { viewport: 'desktop', ids: Array(41).fill('text') }), /1–40/);
  assert.throws(() => store.execute('read_controls', { widgetType: 'heading', names: ['guessed_field'] }), /unavailable/);
  const names = store.execute('read_controls', { widgetType: 'heading' }) as any;
  assert.deepEqual(names.controls, {}); assert.deepEqual(names.controlNames, ['title', 'title_color']);
  const dependent = fixture();
  dependent.widgets.heading.controls!.title_color.condition = { 'color_mode!': '' };
  dependent.widgets.heading.controls!.color_mode = { type: 'select', options: { custom: 'Custom' } };
  const selected = new EvidenceStore(dependent).execute('read_controls', { widgetType: 'heading', names: ['title_color'] }) as any;
  assert.ok(selected.controls.color_mode); assert.equal(selected.controls.title, undefined);
  assert.throws(() => store.execute('read_context', { section: '../../secret' }), /Unknown/);
  assert.throws(() => store.execute('write_page', {}), /Unknown/);
});

test('planner permits only explicitly enabled fixed-bundle evidence tools', () => {
  const event = { type: 'item.started', item: { type: 'mcp_tool_call', server: 'clonewp_evidence', tool: 'read_nodes' } };
  assert.equal(isForbiddenPlanningEvent(event), true); assert.equal(isForbiddenPlanningEvent(event, true), false);
  assert.equal(isForbiddenPlanningEvent({ ...event, item: { ...event.item, server: 'wordpress' } }, true), true);
  assert.equal(isForbiddenPlanningEvent({ ...event, item: { ...event.item, tool: 'read_file' } }, true), true);
});

test('real stdio MCP exposes only bounded public evidence queries and cannot read arbitrary files', async () => {
  const base = await realpath(os.tmpdir()), directory = await mkdtemp(path.join(base, 'clonewp-evidence-'));
  const client = new Client({ name: 'evidence-proof', version: '1' });
  const file = path.join(directory, 'public.json'); await writeFile(file, JSON.stringify(fixture()));
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../src/planning/evidence-server.ts', import.meta.url)), file], stderr: 'pipe' });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map(t => t.name).sort(), [...EVIDENCE_TOOLS].sort());
    assert.ok(tools.every(tool => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false && tool.annotations?.openWorldHint === false));
    const result = await client.callTool({ name: 'read_nodes', arguments: { viewport: 'mobile', ids: ['text'] } });
    const content = result.content as Array<{ type: string; text?: string }>;
    assert.equal(JSON.parse(content[0].text!).nodes[0].text, 'Mobile text');
    const invalid = await client.callTool({ name: 'read_nodes', arguments: { viewport: 'desktop', ids: ['../auth.json'] } });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close(); await transport.close();
    const resolved = await realpath(directory); assert.equal(path.dirname(resolved), base); assert.ok(path.basename(resolved).startsWith('clonewp-evidence-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
