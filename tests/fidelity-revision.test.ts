import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { assertStyleRevision, retainRegisteredInactiveDefaults, reviseFidelityBlocks } from '../src/fidelity/revision.js';
import { compileEditorElements } from '../src/wordpress/editor-serialization.js';
import type { CompiledFidelity } from '../src/fidelity/native.js';
import type { DraftSnapshot, LegacySchema } from '../src/wordpress/types.js';
import type { ElementorElement } from '../src/planning/plan.js';
import type { WordPressClient } from '../src/wordpress/client.js';
import type { NativeProgram } from '../src/fidelity/types.js';

async function cleanup(directory: string) { const target = resolve(directory), suffix = relative(resolve('D:/cloneWP/.cache'), target); if (!suffix || suffix.startsWith('..') || isAbsolute(suffix)) throw new Error('Test cleanup escaped the verified workspace cache'); await rm(target, { recursive: true, force: true }); }
const canonical = (input: unknown): string => JSON.stringify(input && typeof input === 'object' ? Array.isArray(input) ? input.map(value => JSON.parse(canonical(value))) : Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, JSON.parse(canonical(value))])) : input);
const hash = (elements: DraftSnapshot['elements'], settings: Record<string, unknown>) => createHash('sha256').update(canonical({ elements, settings })).digest('hex');
const schemas: Record<string, LegacySchema> = { container: { type: 'container', class: 'NativeContainer', controls: { color: { type: 'color' } } } };
const block = (id: string, color = '#fff'): ElementorElement => ({ id, elType: 'container', settings: { color }, elements: [] });
function fixture() {
  const elements = [block('1111111'), block('2222222'), block('3333333')], settings = { custom_css: 'owned canvas setting', background_color: '#fff' };
  let current: DraftSnapshot = { pageId: 123, runId: 'current-owned-run', title: 'Owned reference draft', status: 'draft', elements, settings, hash: hash(elements, settings) };
  const calls: Array<{ expected: string; elements: DraftSnapshot['elements'] }> = [];
  const client: Pick<WordPressClient, 'snapshotDraft' | 'buildDraft'> = {
    snapshotDraft: async () => structuredClone(current),
    buildDraft: async (_page, composition, _assets, options) => {
      assert.equal(options?.expectedCurrent.hash, current.hash); assert.ok('elements' in composition);
      if (!('elements' in composition)) throw new Error('Unexpected composition');
      calls.push({ expected: current.hash, elements: structuredClone(composition.elements) });
      current = { ...current, elements: structuredClone(composition.elements), settings: structuredClone(composition.pageSettings ?? {}), hash: hash(composition.elements, composition.pageSettings ?? {}) };
      return structuredClone(current);
    },
  };
  const compiled: CompiledFidelity = { composition: { elements: structuredClone(elements), pageSettings: { background_color: '#wrong-would-reset-page' } }, sectionIds: elements.map(node => node.id), sections: elements.map(node => ({ key: node.id, targetId: node.id, elementIds: [node.id] })), usedTypes: ['container'], scopedCSS: [], elementMap: {}, plan: { title: current.title, mode: 'legacy-verified', compositionJson: '{}', mappings: [], unsupported: [], rationale: 'Fixture' } };
  return { client, compiled, calls, baseline: structuredClone(current), getCurrent: () => current, concurrentEdit: () => { current.elements[2].settings.color = '#user'; current.hash = hash(current.elements, current.settings); } };
}

test('revision writes only changed native blocks serially, preserves page settings and reuses the same page', async () => {
  const f = fixture(), directory = await mkdtemp(join('D:/cloneWP/.cache', 'clonewp-revision-'));
  try {
    f.compiled.composition.elements[0].settings.color = '#0047d2'; f.compiled.composition.elements[2].settings.color = '#ffc000';
    const result = await reviseFidelityBlocks({ client: f.client, snapshot: f.baseline, expectedCurrentHash: f.baseline.hash, compiled: f.compiled, schemas, runDir: directory });
    assert.equal(result.changedBlocks, 2); assert.equal(result.skippedBlocks, 1); assert.equal(f.calls.length, 2); assert.equal(result.snapshot.pageId, 123);
    assert.equal(f.calls[0].elements[2].settings.color, '#fff', 'later block is not prematurely replaced');
    assert.equal(f.calls[1].elements[0].settings.color, '#0047d2', 'prior accepted change is retained');
    assert.notEqual(f.calls[0].expected, f.calls[1].expected); assert.deepEqual(result.snapshot.settings, f.baseline.settings);
  } finally { await cleanup(directory); }
});

test('unchanged program performs no document save', async () => {
  const f = fixture(), directory = await mkdtemp(join('D:/cloneWP/.cache', 'clonewp-revision-'));
  try { const result = await reviseFidelityBlocks({ client: f.client, snapshot: f.baseline, expectedCurrentHash: f.baseline.hash, compiled: f.compiled, schemas, runDir: directory }); assert.equal(result.changedBlocks, 0); assert.equal(f.calls.length, 0); assert.equal(result.snapshot.hash, f.baseline.hash); }
  finally { await cleanup(directory); }
});

test('stale hash and reordered ownership reject before any revision write', async () => {
  const f = fixture(), directory = await mkdtemp(join('D:/cloneWP/.cache', 'clonewp-revision-'));
  try {
    f.concurrentEdit();
    await assert.rejects(reviseFidelityBlocks({ client: f.client, snapshot: f.baseline, expectedCurrentHash: f.baseline.hash, compiled: f.compiled, schemas, runDir: directory }), /concurrent change/);
    assert.equal(f.calls.length, 0);
    f.compiled.composition.elements.reverse();
    await assert.rejects(reviseFidelityBlocks({ client: f.client, snapshot: f.baseline, expectedCurrentHash: f.baseline.hash, compiled: f.compiled, schemas, runDir: directory }), /ordered native source blocks/);
  } finally { await cleanup(directory); }
});

test('user edit between block writes is preserved and no stale recovery save is attempted', async () => {
  const f = fixture(), directory = await mkdtemp(join('D:/cloneWP/.cache', 'clonewp-revision-'));
  try {
    f.compiled.composition.elements[0].settings.color = '#0047d2'; f.compiled.composition.elements[1].settings.color = '#ffc000';
    await assert.rejects(reviseFidelityBlocks({ client: f.client, snapshot: f.baseline, expectedCurrentHash: f.baseline.hash, compiled: f.compiled, schemas, runDir: directory, onSnapshot: () => f.concurrentEdit() }), /concurrent change/);
    assert.equal(f.calls.length, 1); assert.equal(f.getCurrent().elements[0].settings.color, '#0047d2'); assert.equal(f.getCurrent().elements[2].settings.color, '#user');
  } finally { await cleanup(directory); }
});

test('style revision rejects bound text, query, media and element-tree replacement', () => {
  const before = { title: 'Reference', sourceUrl: 'https://source.example/', sourceContract: { path: 'contract', sha256: 'a' }, assetsManifest: { path: 'assets', sha256: 'b' }, elements: [{ key: 'root', type: 'container', settings: {}, children: [{ key: 'title', type: 'heading', settings: { title: 'Original text' } }, { key: 'image', type: 'image', settings: { image: { $asset: 'source-image' } } }, { key: 'query', type: 'wd_products', settings: { items_per_page: 12, spacing: '10' } }] }], blocks: [{ sourceBlockId: 'block', rootKey: 'root', bindings: [{ sourceTextId: 'title', elementKey: 'title', settingPath: 'title' }], productQuery: { widgetKey: 'query', queryControlKeys: ['items_per_page'] } }] } as unknown as NativeProgram;
  const after = structuredClone(before); after.elements[0].children![0].settings.color = '#0047d2'; assert.doesNotThrow(() => assertStyleRevision(before, after));
  for (const modify of [(p: NativeProgram) => p.elements[0].children![0].settings.title = 'Rewritten', (p: NativeProgram) => p.elements[0].children![2].settings.items_per_page = 99, (p: NativeProgram) => p.elements[0].children![1].settings.image = { $asset: 'other-image' }, (p: NativeProgram) => p.elements[0].children!.reverse()]) { const changed = structuredClone(before); modify(changed); assert.throws(() => assertStyleRevision(before, changed), /Style revision/); }
});

const generatedSchemas=(value:string):Record<string,LegacySchema>=>({...schemas,wd_products:{type:'wd_products',class:'RegisteredProducts',controls:{layout:{type:'select',default:'grid',options:{grid:'Grid',carousel:'Carousel'}},carousel_sync:{type:'select',default:'',options:{'':'Disabled',parent:'As parent',child:'As child'}},sync_parent_id:{type:'text',default:value,condition:{layout:'carousel',carousel_sync:['parent']}}}}});
function withGeneratedField(){
  const f=fixture(),widget:ElementorElement={id:'4444444',elType:'widget',widgetType:'wd_products',settings:{layout:'carousel',sync_parent_id:'owned-existing-value'},elements:[]};
  f.baseline.elements[1].elements=[structuredClone(widget)];f.getCurrent().elements[1].elements=[structuredClone(widget)];f.compiled.composition.elements[1].elements=[structuredClone(widget)];delete f.compiled.composition.elements[1].elements[0].settings.sync_parent_id;
  f.baseline.hash=hash(f.baseline.elements,f.baseline.settings);f.getCurrent().hash=hash(f.getCurrent().elements,f.getCurrent().settings);return f;
}
test('registered inactive serializer defaults retain the exact owned value and a repeated style revision performs zero saves',async()=>{
  const f=withGeneratedField(),directory=await mkdtemp(join('D:/cloneWP/.cache','clonewp-revision-default-'));
  try{
    f.compiled.composition.elements[0].settings.color='#0047d2';
    const first=await reviseFidelityBlocks({client:f.client,snapshot:f.baseline,expectedCurrentHash:f.baseline.hash,compiled:f.compiled,schemas:generatedSchemas('fresh-registry-default-1'),runDir:directory});
    assert.equal(first.changedBlocks,1);assert.equal(first.snapshot.elements[1].elements[0].settings.sync_parent_id,'owned-existing-value');assert.equal(f.calls.length,1);
    const second=await reviseFidelityBlocks({client:f.client,snapshot:first.snapshot,expectedCurrentHash:first.snapshot.hash,compiled:f.compiled,schemas:generatedSchemas('fresh-registry-default-2'),runDir:directory});
    assert.equal(second.changedBlocks,0);assert.equal(f.calls.length,1);assert.equal(second.snapshot.hash,first.snapshot.hash);assert.equal(Object.hasOwn(f.compiled.composition.elements[1].elements[0].settings,'sync_parent_id'),false,'The author input is never mutated into an explicit control value');
  }finally{await cleanup(directory);}
});
test('explicit authored values and controls without conclusive registered inactivity are never exempt from exact revision writes',async()=>{
  for(const variant of ['explicit','no-condition','unknown-dependency','complex-condition','active-before']as const){
    const f=withGeneratedField(),directory=await mkdtemp(join('D:/cloneWP/.cache','clonewp-revision-default-')),registry=generatedSchemas('fresh-registry-default'),control=registry.wd_products.controls.sync_parent_id;
    if(variant==='explicit')f.compiled.composition.elements[1].elements[0].settings.sync_parent_id='explicit-author-value';
    if(variant==='no-condition')delete control.condition;
    if(variant==='unknown-dependency'){control.condition={unobserved_mode:'parent'};}
    if(variant==='complex-condition')control.conditions={relation:'or',terms:[]};
    if(variant==='active-before'){f.baseline.elements[1].elements[0].settings.carousel_sync='parent';f.getCurrent().elements[1].elements[0].settings.carousel_sync='parent';f.baseline.hash=hash(f.baseline.elements,f.baseline.settings);f.getCurrent().hash=hash(f.getCurrent().elements,f.getCurrent().settings);}
    try{const result=await reviseFidelityBlocks({client:f.client,snapshot:f.baseline,expectedCurrentHash:f.baseline.hash,compiled:f.compiled,schemas:registry,runDir:directory});assert.equal(result.changedBlocks,1,variant);assert.equal(f.calls.length,1,variant);assert.equal(result.snapshot.elements[1].elements[0].settings.sync_parent_id,variant==='explicit'?'explicit-author-value':'fresh-registry-default',variant);}
    finally{await cleanup(directory);}
  }
});
test('default retention requires identical native identity/type/tree, an actual baseline value, and the exact registered default',()=>{
  for(const variant of ['changed-id','changed-type','changed-tree','missing-baseline','nondefault-serialized']as const){
    const f=withGeneratedField(),registry=generatedSchemas('fresh-registry-default'),serialized=compileEditorElements(f.compiled.composition.elements,registry);
    if(variant==='changed-id')serialized[1].elements[0].id='5555555';
    if(variant==='changed-type')serialized[1].elements[0].widgetType='different-widget';
    if(variant==='changed-tree')serialized[1].elements.push({id:'5555555',elType:'container',settings:{},elements:[]});
    if(variant==='missing-baseline')delete f.baseline.elements[1].elements[0].settings.sync_parent_id;
    if(variant==='nondefault-serialized')serialized[1].elements[0].settings.sync_parent_id='unproven-renderer-value';
    const before=JSON.stringify({compiled:f.compiled,baseline:f.baseline,serialized}),result=retainRegisteredInactiveDefaults({authored:f.compiled.composition.elements,serialized,baseline:f.baseline.elements,schemas:registry});assert.equal(result.retained.length,0,variant);assert.equal(JSON.stringify({compiled:f.compiled,baseline:f.baseline,serialized}),before,'The guard is pure');
  }
});
