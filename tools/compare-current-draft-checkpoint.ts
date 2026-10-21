import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadConfig } from '../src/core/config.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { compileFidelity } from '../src/fidelity/native.js';
import { compileEditorElements } from '../src/wordpress/editor-serialization.js';
import { retainRegisteredInactiveDefaults } from '../src/fidelity/revision.js';

const root='D:/cloneWP',runId='2026-10-15T01-39-43-444Z-blocks-www-petsupermarket-com-b1a67d75',pageId=14866;
const baseline=JSON.parse(await readFile(`${root}/runs/${runId}/revisions/2026-10-15T02-12-22-260Z-7f335cf4/target/revision-block-14.json`,'utf8'));
const {config,credentials}=await loadConfig(root);
const client=new WordPressClient({targetUrl:config.targetUrl,username:credentials.wp_user,applicationPassword:credentials.wp_app_password});
const normalize=(value:unknown):unknown=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,normalize(child)])):value;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
try{
  await client.createDraft(runId,'Pet Supermarket reference review',{requireExistingPageId:pageId});
  const current=await client.snapshotDraft(pageId);
  const changed=current.elements.flatMap((element,index)=>hash(element)===hash(baseline.elements[index])?[]:[{index:index+1,id:element.id,widgetCount:element.elements?.length??0}]);
  const job=`${root}/references/reference-2026-10-15T01-35-56-997Z-www-petsupermarket-com-1698bebb`;
  const parse=async(file:string)=>JSON.parse(await readFile(file,'utf8'));
  const program=await parse(`${job}/program.json`),capabilities=await parse(`${root}/runs/${runId}/target/capabilities.json`),assets=await parse(`${root}/runs/${runId}/assets/imported.json`),catalog=await parse(`${root}/runs/${runId}/target/catalog.json`);
  const compiled=compileFidelity(program,capabilities.legacySchemas,assets,catalog),serialized=compileEditorElements(compiled.composition.elements,capabilities.legacySchemas);
  const expected=retainRegisteredInactiveDefaults({authored:compiled.composition.elements,serialized,baseline:current.elements,schemas:capabilities.legacySchemas}).elements;
  const expectedChanged=current.elements.flatMap((element,index)=>hash(element)===hash(expected[index])?[]:[index+1]);
  process.stdout.write(JSON.stringify({currentHash:current.hash,baselineHash:baseline.hash,changedRoots:changed,expectedChangedRoots:expectedChanged,status:current.status,elementCount:current.elements.length})+'\n');
}finally{await client.close().catch(()=>undefined);}
