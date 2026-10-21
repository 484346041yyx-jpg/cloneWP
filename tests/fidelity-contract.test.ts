import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { writeJson } from '../src/core/files.js';
import { auditFidelityProgram, sha256, validateBlockBindings } from '../src/fidelity/check.js';
import { validateNativeProgram } from '../src/fidelity/validate.js';
import { verifyFidelity, type FidelityStateObservation } from '../src/fidelity/verify.js';
import type { BlockContract, NativeProgram, SourceAssetManifest } from '../src/fidelity/types.js';
import type { TargetElementEvidence, TargetViewportEvidence } from '../src/verification/types.js';

const sourceUrl = 'https://8.8.8.8/', imageUrl = `${sourceUrl}observed-product.png`;
const observed = { status: 'observed' as const, evidence: ['source-dom'] };
const none = { status: 'not-applicable' as const, evidence: [] };
function contracts(): { contract: BlockContract; program: NativeProgram; manifest: SourceAssetManifest } {
  const contract: BlockContract = {
    version: 1, workflow: 'block-replication', sourceUrl, capturedAt: '2026-10-13T05:00:00Z', referenceReport: { path: 'reference/report.json', sha256: '0'.repeat(64) },
    evidence: [{ id: 'source-dom', path: 'reference/desktop.json', sha256: '0'.repeat(64), kind: 'dom' }], tolerances: { geometryPx: 30, geometryRatio: 0.1, colorChannel: 4 }, limitations: [],
    blocks: [
      { id: 'header', role: 'header', presentation: 'static', texts: [{ id: 'header-title', text: 'Pet Supermarket', kind: 'heading' }], assets: [], evidence: ['source-dom'], geometry: { desktop: { width: 1200, height: 100 } }, colors: { background: '#ffffff' }, states: { normal: observed, hover: none, interaction: none } },
      { id: 'products', role: 'reference-cards', presentation: 'carousel', requiredWidgetTypes: ['nested-carousel'], texts: [{ id: 'product-name', text: 'Example Pet Food & Care', kind: 'product-name' }, { id: 'product-price', text: '$16.99', kind: 'price' }], assets: ['product-photo'], evidence: ['source-dom'], geometry: { desktop: { width: 1200, height: 300, columns: 4 } }, colors: { background: '#ffffff' }, states: { normal: observed, hover: { ...observed, properties: { color: '#0056b8' } }, interaction: { ...observed, properties: { arrows: true } } } },
    ],
  };
  const manifest: SourceAssetManifest = { version: 1, sourceUrl, downloadedAt: '2026-10-13T05:01:00Z', assets: [{ key: 'product-photo', sourceUrl: imageUrl, localPath: 'assets/product.png', sha256: '0'.repeat(64), alt: 'Example Pet Food & Care', mediaType: 'image/png', provenance: 'Downloaded observed public source image' }] };
  const program: NativeProgram = {
    version: 1, workflow: 'block-replication', title: 'Pet Supermarket reference draft', sourceUrl, sourceContract: { path: 'block-contract.json', sha256: '0'.repeat(64) }, assetsManifest: { path: 'asset-manifest.json', sha256: '0'.repeat(64) }, deviations: [],
    elements: [
      { key: 'header-root', type: 'container', settings: { background_color: '#ffffff' }, children: [{ key: 'header-title', type: 'heading', settings: { title: 'Pet Supermarket' } }] },
      { key: 'products-root', type: 'container', settings: { background_color: '#ffffff' }, children: [{ key: 'product-carousel', type: 'nested-carousel', settings: { carousel_items: [{ _id: 'a1', slide_title: 'Product 1' }] }, children: [{ key: 'product-card', type: 'container', settings: {}, children: [{ key: 'product-image', type: 'image', settings: { image: { $asset: 'product-photo' } } }, { key: 'product-title', type: 'heading', settings: { title: 'Example Pet Food &amp; Care' } }, { key: 'product-price', type: 'heading', settings: { title: '$16.99' } }] }] }] },
    ],
    blocks: [
      { sourceBlockId: 'header', rootKey: 'header-root', presentation: 'static', bindings: [{ sourceTextId: 'header-title', elementKey: 'header-title', settingPath: 'title' }], states: contract.blocks[0].states },
      { sourceBlockId: 'products', rootKey: 'products-root', presentation: 'carousel', bindings: [{ sourceTextId: 'product-name', elementKey: 'product-title', settingPath: 'title' }, { sourceTextId: 'product-price', elementKey: 'product-price', settingPath: 'title' }], states: contract.blocks[1].states },
    ],
  };
  for (let index = 0; index < contract.blocks.length; index++) {
    contract.blocks[index].contentBounds = { desktop: { x: 0, width: 1200, viewportWidth: 1440, sourceNodeId: `${contract.blocks[index].id}-source-content`, evidence: ['source-dom'] } };
    program.blocks[index].contentBindings = { desktop: program.blocks[index].rootKey };
  }
  return { contract: structuredClone(contract), program: structuredClone(program), manifest: structuredClone(manifest) };
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clonewp-fidelity-contract-')), jobDir = path.join(root, 'references/reference-fidelity-fixture');
  t.after(async () => { assert.ok(path.relative(os.tmpdir(), root).startsWith('clonewp-fidelity-contract-')); await rm(root, { recursive: true, force: true }); });
  await mkdir(path.join(jobDir, 'reference'), { recursive: true }); await mkdir(path.join(jobDir, 'assets')); await mkdir(path.join(root, 'config'));
  await writeFile(path.join(root, 'config/credentials.local.json'), 'TARGET CREDENTIALS MUST NOT BE READ');
  const value = contracts(), image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await writeFile(path.join(jobDir, 'assets/product.png'), image); value.manifest.assets[0].sha256 = sha256(image);
  await writeJson(path.join(jobDir, 'reference/report.json'), { version: 1, url: sourceUrl, status: 'complete', viewports: [{ name: 'desktop' }] });
  value.contract.referenceReport.sha256 = sha256(await readFile(path.join(jobDir, 'reference/report.json')));
  await writeJson(path.join(jobDir, 'reference/desktop.json'), { observedUrl: sourceUrl, imageUrl, text: 'Pet Supermarket Example Pet Food & Care $16.99' });
  value.contract.evidence[0].sha256 = sha256(await readFile(path.join(jobDir, 'reference/desktop.json')));
  await writeJson(path.join(jobDir, 'job.json'), { version: 1, workflow: 'block-replication', jobId: path.basename(jobDir), jobDir, url: sourceUrl, status: 'awaiting-block-contract', referencePath: path.join(jobDir, 'reference/report.json'), referenceReportSha256: value.contract.referenceReport.sha256 });
  await writeJson(path.join(jobDir, 'block-contract.json'), value.contract); await writeJson(path.join(jobDir, 'asset-manifest.json'), value.manifest);
  value.program.sourceContract.sha256 = sha256(await readFile(path.join(jobDir, 'block-contract.json'))); value.program.assetsManifest.sha256 = sha256(await readFile(path.join(jobDir, 'asset-manifest.json')));
  const programPath = path.join(jobDir, 'program.json'); await writeJson(programPath, value.program);
  return { root, jobDir, programPath, ...value };
}
test('local fidelity audit verifies bytes and bindings but legacy evidence cannot claim complete source coverage before credentials', async t => {
  const value = await fixture(t), checked = await auditFidelityProgram(value.programPath, { root: value.root });
  assert.equal(checked.audit.passed, false); assert.equal(checked.audit.status, 'needs-review'); assert.ok(checked.audit.sourceCoverage?.issues.some(issue => issue.code === 'source-scene-inventory-missing')); assert.equal(checked.audit.blocks, 2); assert.equal(checked.audit.textBindings, 3);
  assert.equal(await readFile(path.join(value.root, 'config/credentials.local.json'), 'utf8'), 'TARGET CREDENTIALS MUST NOT BE READ');
});
test('source blocks cannot be dropped, duplicated or reordered', () => {
  for (const edit of [(program: NativeProgram) => program.blocks.pop(), (program: NativeProgram) => program.blocks.reverse(), (program: NativeProgram) => program.blocks[1] = program.blocks[0]]) {
    const value = contracts(); edit(value.program); assert.throws(() => validateBlockBindings(value.contract, value.program, value.manifest), /complete source block order/);
  }
});
test('a reference carousel cannot become static cards even if its source text is retained', () => {
  const value = contracts(); value.program.elements[1].children![0].type = 'container'; assert.throws(() => validateBlockBindings(value.contract, value.program, value.manifest), /Carousel cannot be replaced/);
});
test('source copy, names and prices are exact native setting bindings while markup and whitespace may differ', () => {
  const value = contracts(); assert.equal(validateBlockBindings(value.contract, value.program, value.manifest).textBindings, 3);
  value.program.elements[1].children![0].children![0].children![2].settings.title = '$14.99'; assert.throws(() => validateBlockBindings(value.contract, value.program, value.manifest), /rewritten or omitted: product-price/);
});
test('a text binding cannot cross its source block or duplicate one native source text identity', () => {
  const value = contracts(); value.program.blocks[1].bindings[0].elementKey = 'header-title'; assert.throws(() => validateBlockBindings(value.contract, value.program, value.manifest), /crosses its source block/);
  const second = contracts(); second.program.blocks[1].bindings[1].sourceTextId = 'product-name'; assert.throws(() => validateBlockBindings(second.contract, second.program, second.manifest), /exactly one native binding/);
});
test('HTML screenshots, remote CSS and executable attributes cannot impersonate native editable blocks', () => {
  for (const settings of [{ editor: '<img onerror="bad()">' }, { custom_css: 'selector {background:url(https://8.8.8.8/p.png)}' }, { htmlCache: '<div>fake</div>' }]) {
    const value = contracts(); value.program.elements[0].settings = settings; assert.throws(() => validateNativeProgram(value.program), /Executable|CSS|Non-native/);
  }
  const value = contracts(); value.program.elements[0].children![0].type = 'html'; assert.throws(() => validateNativeProgram(value.program), /HTML, shortcodes/);
});
test('observed hover and carousel state evidence cannot be silently discarded or fabricated', () => {
  const value = contracts(); value.program.blocks[1].states.hover.properties!.color = '#ff0000'; assert.throws(() => validateBlockBindings(value.contract, value.program, value.manifest), /state property changed/);
  const second = contracts(); second.program.blocks[1].states.interaction.status = 'not-applicable'; assert.throws(() => validateBlockBindings(second.contract, second.program, second.manifest), /coverage cannot be fabricated/);
});
test('unobserved source states require explicit limitations rather than a fabricated observed claim', () => {
  const value = contracts(); value.contract.blocks[1].states.hover = { status: 'unobserved', evidence: [], note: 'Public hover state was unavailable' }; value.program.blocks[1].states.hover = structuredClone(value.contract.blocks[1].states.hover);
  assert.match(validateBlockBindings(value.contract, value.program, value.manifest).limitations.join(' '), /hover.*unavailable/);
  value.program.blocks[1].states.hover.status = 'observed'; assert.throws(() => validateBlockBindings(value.contract, value.program, value.manifest), /coverage cannot be fabricated/);
});
test('changed downloaded media or source evidence bytes fail before target authentication', async t => {
  const first = await fixture(t); await writeFile(path.join(first.jobDir, 'assets/product.png'), 'tampered bytes'); await assert.rejects(auditFidelityProgram(first.programPath, { root: first.root }), /source asset bytes changed/);
  const second = await fixture(t); await writeFile(path.join(second.jobDir, 'reference/desktop.json'), '{}'); await assert.rejects(auditFidelityProgram(second.programPath, { root: second.root }), /Source evidence bytes changed/);
});

test('reused image metadata never exempts actual source asset bytes from rehashing', async t => {
  const value = await fixture(t), cache = new Map<string, { format?: string; width?: number; height?: number; pages?: number }>();
  await auditFidelityProgram(value.programPath, { root: value.root, assetMetadataCache: cache, writeAudit: false });
  assert.equal(cache.size, 1);
  await writeFile(path.join(value.jobDir, 'assets/product.png'), 'different actual bytes');
  await assert.rejects(auditFidelityProgram(value.programPath, { root: value.root, assetMetadataCache: cache, writeAudit: false }), /source asset bytes changed/);
});
test('unchanged metadata cannot authorize new foreign media URLs or historical original jobs', async t => {
  const value = await fixture(t); value.manifest.assets[0].sourceUrl = 'https://8.8.8.8/foreign.png'; await writeJson(path.join(value.jobDir, 'asset-manifest.json'), value.manifest); value.program.assetsManifest.sha256 = sha256(await readFile(path.join(value.jobDir, 'asset-manifest.json'))); await writeJson(value.programPath, value.program);
  await assert.rejects(auditFidelityProgram(value.programPath, { root: value.root }), /not supported by current source evidence/);
  const second = await fixture(t); const jobPath = path.join(second.jobDir, 'job.json'), job = JSON.parse(await readFile(jobPath, 'utf8')); job.workflow = 'reference-to-original'; await writeJson(jobPath, job); await assert.rejects(auditFidelityProgram(second.programPath, { root: second.root }), /historical original job/);
});
test('current job paths prevent asset or source contract traversal into another run', async t => {
  const value = await fixture(t); value.program.sourceContract.path = '../other-job/block-contract.json'; await writeJson(value.programPath, value.program); await assert.rejects(auditFidelityProgram(value.programPath, { root: value.root }), /inside the current real job|ENOENT/);
});

function measured(value: ReturnType<typeof contracts>): TargetViewportEvidence {
  const element = (sourceId: string, y: number, text = '', widgetType?: string): TargetElementEvidence => ({ sourceId, targetId: sourceId, selector: `[data-id="${sourceId}"]`, found: true, count: 1, nativeElement: true, visible: true, text, rect: { x: 0, y, width: 1200, height: sourceId === 'header-root' ? 100 : 300 }, style: { 'background-color': 'rgb(255, 255, 255)' }, images: [], widgetType });
  return { name: 'desktop', width: 1440, height: 900, url: sourceUrl, title: 'Rendered draft', pageHeight: 1000, screenshotPath: 'actual.png', evidencePath: 'actual.json', elements: [element('header-root', 0), element('header-title', 0, 'Pet Supermarket', 'heading'), element('products-root', 100), element('product-carousel', 100, 'Example Pet Food & Care $16.99', 'nested-carousel'), element('product-title', 100, 'Example Pet Food & Care', 'heading'), element('product-price', 100, '$16.99', 'heading')], overflow: [], clipping: [], imageFailures: [], consoleErrors: [], pageErrors: [], responseStatus: 200 };
}
const stateMeasurements: FidelityStateObservation[] = [{ viewport: 'desktop', blockId: 'products', state: 'hover', status: 'verified', properties: { color: 'rgb(0, 86, 184)' }, evidence: ['actual-hover.json'] }, { viewport: 'desktop', blockId: 'products', state: 'interaction', status: 'verified', properties: { arrows: true }, evidence: ['actual-carousel.json'] }];
test('fidelity acceptance needs actual native browser content, colors and interactive states, not an aggregate screenshot score', () => {
  const value = contracts(); const report = verifyFidelity(value.contract, value.program, [measured(value)], stateMeasurements); assert.equal(report.structurePassed, true); assert.equal(report.passed, false); assert.equal(report.presentationDetails.status, 'needs-review'); assert.equal(report.coverage[0].matchedTexts, 3);
  const missingState = verifyFidelity(value.contract, value.program, [measured(value)]); assert.equal(missingState.passed, false); assert.equal(missingState.status, 'needs-review'); assert.equal(missingState.statesVerified, false);
});
test('actual source text mismatch, swapped block geometry and changed colors fail live fidelity acceptance', () => {
  const value = contracts(), view = measured(value); view.elements[0].rect.y = 500; view.elements[4].text = 'New creative concept'; view.elements[2].style['background-color'] = '#ff0000';
  const report = verifyFidelity(value.contract, value.program, [view], stateMeasurements); assert.equal(report.passed, false); assert.equal(report.structurePassed, false); assert.ok(report.issues.some(issue => issue.code === 'source-text')); assert.ok(report.issues.some(issue => issue.code === 'block-order')); assert.ok(report.issues.some(issue => issue.code === 'block-color'));
});

test('paint verification distinguishes transparent and opaque black instead of comparing only their RGB channels',()=>{
  const value=contracts(),view=measured(value);value.contract.blocks[0].colors.background='transparent';view.elements[0].style['background-color']='rgba(0, 0, 0, 0)';
  assert.equal(verifyFidelity(value.contract,value.program,[view],stateMeasurements).structurePassed,true);
  view.elements[0].style['background-color']='rgb(0, 0, 0)';assert.ok(verifyFidelity(value.contract,value.program,[view],stateMeasurements).issues.some(issue=>issue.code==='block-color'));
});

test('observed viewport-hidden arrows use real swipe movement without exempting visible, unknown or incompletely evidenced source controls',()=>{
  const value=contracts(),source=value.contract.blocks[1],view=measured(value);view.name='mobile';view.width=390;view.elements.forEach(element=>{element.rect.width=390;});
  value.contract.evidence.push({id:'mobile-dom',path:'reference/mobile.json',sha256:'0'.repeat(64),kind:'dom'});
  for(let index=0;index<value.contract.blocks.length;index++){const block=value.contract.blocks[index];block.geometry.mobile={...block.geometry.desktop,width:390};block.contentBounds!.mobile={...block.contentBounds!.desktop,width:390,viewportWidth:390,evidence:['mobile-dom']};value.program.blocks[index].contentBindings!.mobile=value.program.blocks[index].rootKey;}
  source.states.interaction.properties={subject:'arrow-next',arrows:true,nextChangesSlide:true};
  const evidence=['mobile-dom'],rect={x:0,y:0,width:390,height:300};source.presentationDetails={version:1,viewports:{mobile:{status:'observed',width:390,evidence,regions:[{id:'window',sourceNodeId:'.source-window',evidence,rect,visible:true}],controlGroups:[{id:'controls',sourceNodeId:'.source-controls',evidence,rect,visible:true,ownerId:'window',layout:'row',pagination:'none',controls:[{id:'prev',sourceNodeId:'.source-prev',evidence,rect:{x:0,y:0,width:0,height:0},visible:false,role:'previous'},{id:'next',sourceNodeId:'.source-next',evidence,rect:{x:0,y:0,width:0,height:0},visible:false,role:'next'}]}],media:[],relations:[]}}};
  const observations=stateMeasurements.map(item=>({...structuredClone(item),viewport:'mobile'}));observations[1].properties={subject:'swipe',arrows:false,nextChangesSlide:false,swipeChangesSlide:true};
  const verify=()=>verifyFidelity(value.contract,value.program,[view],observations),stateIssues=()=>verify().issues.filter(issue=>issue.code==='state-property');
  assert.equal(verify().statesVerified,true);assert.equal(stateIssues().length,0);assert.equal(verify().interactionOverrides?.length,1);
  observations[1].properties.swipeChangesSlide=false;assert.ok(stateIssues().length>0,'A static carousel cannot borrow hidden arrows as successful movement');observations[1].properties.swipeChangesSlide=true;
  observations[1].properties.arrows=true;assert.ok(stateIssues().length>0,'Extra visible target arrows still contradict the hidden source controls');observations[1].properties.arrows=false;
  const detail=source.presentationDetails.viewports.mobile;
  detail.status='unobserved';assert.ok(stateIssues().length>0);detail.status='observed';detail.width=430;assert.ok(stateIssues().length>0);detail.width=390;
  detail.controlGroups[0].controls[0].visible=true;assert.ok(stateIssues().length>0,'Visible source arrows retain their actual arrow-click requirement');detail.controlGroups[0].controls[0].visible=false;
  detail.controlGroups[0].controls.pop();assert.ok(stateIssues().length>0,'One missing source control cannot imply that both are hidden');detail.controlGroups[0].absentControls=['next'];assert.equal(stateIssues().length,0,'An explicit source absence can prove the missing counterpart');
  detail.controlGroups[0].controls[0].evidence=['source-dom'];assert.ok(stateIssues().length>0,'A desktop-only observation cannot prove a mobile exception');
});
