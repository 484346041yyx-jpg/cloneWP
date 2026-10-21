import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { assertPublicUrl } from '../capture/url-safety.js';
import { writeJson } from '../core/files.js';
import { blockContractSchema, normalizeText, readSettingPath, sourceAssetManifestSchema, validateContentBoundsBindings, validateNativeProgram } from './validate.js';
import { validateCatalogSourceOwnership, validateTargetCatalogBindings } from './catalog-contract.js';
import { validatePresentationBindings } from './presentation-contract.js';
import { loadSourceCoverage } from './source-coverage.js';
import { validateNativeProgramCSS } from './scoped-css.js';
import type { BlockContract, FidelityAudit, NativeElement, NativeProgram, SourceAssetManifest } from './types.js';

export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export function sourceVisibleText(value: string): string {
  return normalizeText(value.replace(/<[^>]*>/g, ' ').replace(/&#x([a-f\d]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16))).replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number))).replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'"));
}
export function flattenNative(elements: NativeElement[]): NativeElement[] { return elements.flatMap(element => [element, ...flattenNative(element.children ?? [])]); }
function assetsIn(input: unknown): string[] {
  if (Array.isArray(input)) return input.flatMap(assetsIn);
  if (!input || typeof input !== 'object') return [];
  const value = input as Record<string, unknown>;
  if (Object.hasOwn(value, '$asset')) {
    if (Object.keys(value).length !== 1 || typeof value.$asset !== 'string') throw new Error('Media placeholder must contain exactly one declared $asset key');
    return [value.$asset];
  }
  return Object.values(value).flatMap(assetsIn);
}
function rejectUnboundMedia(input: unknown) {
  if (Array.isArray(input)) { input.forEach(rejectUnboundMedia); return; }
  if (!input || typeof input !== 'object') return;
  for (const [name, value] of Object.entries(input)) {
    if (/^(?:image|background_image|background_hover_image|gallery)$/i.test(name) && typeof value === 'string') throw new Error('Native media must use a downloaded asset placeholder');
    if (name === 'url' && typeof value === 'string' && /^data:/i.test(value)) throw new Error('Native media cannot be an unverified data URI');
    if (name === 'url' && typeof value === 'string' && /\.(?:png|jpe?g|webp|svg)(?:[?#]|$)/i.test(value)) throw new Error('Native source media must use downloaded placeholders before target authentication');
    rejectUnboundMedia(value);
  }
}
export function validateBlockBindings(contract: BlockContract, program: NativeProgram, manifest: SourceAssetManifest): { nativeElements: number; textBindings: number; limitations: string[] } {
  const sourceIds = contract.blocks.map(block => block.id), programIds = program.blocks.map(block => block.sourceBlockId);
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error('Source block IDs must be unique');
  if (JSON.stringify(sourceIds) !== JSON.stringify(programIds)) throw new Error('The complete source block order must be preserved without dropped, duplicated or reordered blocks');
  if (program.elements.length !== sourceIds.length) throw new Error('Every source block requires exactly one top-level native container');
  validateContentBoundsBindings(contract, program);
  const catalogBindings = validateTargetCatalogBindings(contract, program);
  const declared = new Set(manifest.assets.map(asset => asset.key));
  if (declared.size !== manifest.assets.length) throw new Error('Downloaded asset keys must be unique');
  const evidenceIds = new Set(contract.evidence.map(item => item.id));
  if (evidenceIds.size !== contract.evidence.length) throw new Error('Source evidence IDs must be unique');
  const checkEvidence = (ids: string[]) => { for (const id of ids) if (!evidenceIds.has(id)) throw new Error(`Unknown source evidence ID: ${id}`); };
  const all = flattenNative(program.elements), nodes = new Map(all.map(node => [node.key, node]));
  const limits = [...contract.limitations, ...validatePresentationBindings(contract, program)]; let bindings = 0;
  const sourceTextIds = new Set<string>();
  for (let index = 0; index < contract.blocks.length; index++) {
    const source = contract.blocks[index], target = program.blocks[index], root = program.elements[index];
    if (target.rootKey !== root.key) throw new Error(`Source block must mount into its corresponding top-level container: ${source.id}`);
    if (source.presentation !== target.presentation) throw new Error(`Source block presentation changed: ${source.id}`);
    const descendants = flattenNative([root]), allowedKeys = new Set(descendants.map(node => node.key)), types = new Set(descendants.map(node => node.type));
    const catalog = catalogBindings.get(source.id);
    if (source.presentation === 'carousel' && !catalog?.query.carouselMode && !Array.from(types).some(type => /(?:carousel|slider|^slides$)/i.test(type))) throw new Error(`Carousel cannot be replaced by a static block: ${source.id}`);
    if (source.presentation === 'accordion' && !Array.from(types).some(type => /accordion|toggle/i.test(type))) throw new Error(`Accordion requires a native accordion or toggle: ${source.id}`);
    for (const type of source.requiredWidgetTypes ?? []) if (!types.has(type)) throw new Error(`Source block requires native widget ${type}: ${source.id}`);
    for (const asset of source.assets) if (!declared.has(asset) || (!catalog?.assetKeys.has(asset) && !assetsIn(root).includes(asset))) throw new Error(`Source block has missing downloaded native media: ${source.id}/${asset}`);
    if (catalog && assetsIn(root).some(asset => catalog.assetKeys.has(asset))) throw new Error(`Target product query cannot keep source product media mounted: ${source.id}`);
    const bound = new Map(target.bindings.map(binding => [binding.sourceTextId, binding]));
    const staticTexts = source.texts.filter(text => !catalog?.textIds.has(text.id));
    if (bound.size !== target.bindings.length || bound.size !== staticTexts.length || target.bindings.some(binding => !staticTexts.some(text => text.id === binding.sourceTextId))) throw new Error(`Every source text must have exactly one native binding: ${source.id}`);
    for (const text of source.texts) {
      if (sourceTextIds.has(text.id)) throw new Error(`Repeated source text ID: ${text.id}`); sourceTextIds.add(text.id);
      if (catalog?.textIds.has(text.id)) continue;
      const binding = bound.get(text.id);
      if (!binding || !allowedKeys.has(binding.elementKey)) throw new Error(`Source text is unbound or crosses its source block: ${text.id}`);
      const value = readSettingPath(nodes.get(binding.elementKey)!.settings, binding.settingPath);
      if (typeof value !== 'string' || sourceVisibleText(value) !== sourceVisibleText(text.text)) throw new Error(`Source text was rewritten or omitted: ${text.id}`);
      bindings++;
    }
    checkEvidence(source.evidence);
    if(typeof source.states.hover.properties?.sourceTextId==='string'&&!source.texts.some(text=>text.id===source.states.hover.properties!.sourceTextId))throw new Error(`Source hover text identity must belong to its exact source block: ${source.id}`);
    for (const stateName of ['normal', 'hover', 'interaction'] as const) {
      const observed = source.states[stateName], implementation = target.states[stateName];
      checkEvidence(observed.evidence); checkEvidence(implementation.evidence);
      if (observed.status === 'observed' && !observed.evidence.length) throw new Error(`Observed source state has no proof: ${source.id}/${stateName}`);
      if (implementation.status !== observed.status) throw new Error(`State coverage cannot be fabricated or discarded: ${source.id}/${stateName}`);
      for (const [name, expected] of Object.entries(observed.properties ?? {})) if (implementation.properties?.[name] !== expected) throw new Error(`Observed state property changed: ${source.id}/${stateName}/${name}`);
      if (observed.status === 'unobserved') {
        if (!observed.note?.trim() || !implementation.note?.trim()) throw new Error(`Unobserved state requires an honest limitation: ${source.id}/${stateName}`);
        limits.push(`${source.id}/${stateName}: ${observed.note}`);
      }
    }
  }
  for (const asset of assetsIn(program.elements)) if (!declared.has(asset)) throw new Error(`Undeclared native asset placeholder: ${asset}`);
  rejectUnboundMedia(program.elements);
  for (const deviation of program.deviations) { if (!sourceIds.includes(deviation.blockId)) throw new Error('Deviation must belong to a current source block'); checkEvidence(deviation.evidence); limits.push(`${deviation.blockId}/${deviation.category}: ${deviation.reason}`); }
  return { nativeElements: all.length, textBindings: bindings, limitations: [...new Set(limits)] };
}

/** This entire check completes locally before WordPress credentials may be loaded. */
export async function auditFidelityProgram(filename: string, options: { root?: string; writeAudit?: boolean; assetMetadataCache?: Map<string, { format?: string; width?: number; height?: number; pages?: number }> } = {}): Promise<{ program: NativeProgram; contract: BlockContract; manifest: SourceAssetManifest; audit: FidelityAudit }> {
  const root = await realpath(path.resolve(options.root ?? process.cwd())), programPath = path.resolve(root, filename), jobDir = path.dirname(programPath), references = path.join(root, 'references');
  if (path.dirname(jobDir).toLowerCase() !== references.toLowerCase() || path.basename(programPath) !== 'program.json') throw new Error('Native program must be program.json directly inside a current references job');
  if ((await realpath(references)).toLowerCase() !== references.toLowerCase() || (await realpath(jobDir)).toLowerCase() !== jobDir.toLowerCase()) throw new Error('Reference jobs cannot use redirected directories');
  const files = new Map<string, string>();
  const bytesFor = async (filename: string, max = 20_971_520) => {
    const file = path.resolve(jobDir, filename), relative = path.relative(jobDir, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || (await realpath(file)).toLowerCase() !== file.toLowerCase()) throw new Error('Fidelity artifacts must stay inside the current real job');
    const information = await stat(file); if (!information.isFile() || information.size < 1 || information.size > max) throw new Error('Fidelity artifact is not a bounded regular file');
    const bytes = await readFile(file); files.set(file, sha256(bytes)); return bytes;
  };
  const programBytes = await bytesFor(programPath, 4_000_000), program = validateNativeProgram(JSON.parse(programBytes.toString('utf8').replace(/^\uFEFF/, '')));
  validateNativeProgramCSS(program.elements);
  await assertPublicUrl(program.sourceUrl);
  const job = JSON.parse((await bytesFor('job.json', 200_000)).toString('utf8'));
  if (job.version !== 1 || job.workflow !== 'block-replication' || job.url !== program.sourceUrl || job.jobId !== path.basename(jobDir) || path.resolve(job.jobDir).toLowerCase() !== jobDir.toLowerCase() || job.status === 'blocked') throw new Error('Native replication requires the current independent block-replication job, not a historical original job');
  const contractBytes = await bytesFor(program.sourceContract.path, 4_000_000), manifestBytes = await bytesFor(program.assetsManifest.path, 2_000_000);
  if (sha256(contractBytes) !== program.sourceContract.sha256 || sha256(manifestBytes) !== program.assetsManifest.sha256) throw new Error('Frozen source contract or downloaded asset manifest changed');
  const contract = blockContractSchema.parse(JSON.parse(contractBytes.toString('utf8'))), manifest = sourceAssetManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
  if (contract.sourceUrl !== program.sourceUrl || manifest.sourceUrl !== program.sourceUrl) throw new Error('Native program, source contract and media must identify the same current source URL');
  const reportBytes = await bytesFor(contract.referenceReport.path, 2_000_000);
  if (path.resolve(jobDir, job.referencePath).toLowerCase() !== path.resolve(jobDir, contract.referenceReport.path).toLowerCase() || (job.referenceReportSha256 && job.referenceReportSha256 !== contract.referenceReport.sha256)) throw new Error('Contract reference identity must match the frozen current job report');
  if (sha256(reportBytes) !== contract.referenceReport.sha256) throw new Error('Captured reference report changed');
  const report = JSON.parse(reportBytes.toString('utf8'));
  if (report.url !== program.sourceUrl || !['complete', 'partial'].includes(report.status) || !report.viewports?.length) throw new Error('The source contract needs matching usable public rendered evidence');
  let observedResources = reportBytes.toString('utf8');
  const sourceEvidence = new Map<string, unknown>();
  for (const evidence of contract.evidence) { const bytes = await bytesFor(evidence.path); if (sha256(bytes) !== evidence.sha256) throw new Error(`Source evidence bytes changed: ${evidence.id}`); if (evidence.kind !== 'screenshot') { observedResources += bytes.toString('utf8'); try { sourceEvidence.set(evidence.id, JSON.parse(bytes.toString('utf8'))); } catch { /* Non-JSON evidence cannot prove repeated item ownership. */ } } }
  for (const asset of manifest.assets) {
    await assertPublicUrl(asset.sourceUrl);
    const bytes = await bytesFor(asset.localPath);
    if (sha256(bytes) !== asset.sha256) throw new Error(`Downloaded source asset bytes changed: ${asset.key}`);
    if (!observedResources.includes(asset.sourceUrl) && !observedResources.includes(asset.sourceUrl.replace(/&/g, '&amp;'))) throw new Error(`Downloaded media URL is not supported by current source evidence: ${asset.key}`);
    // Metadata reuse is allowed only after hashing the actual bytes again.
    const metadata = options.assetMetadataCache?.get(asset.sha256) ?? await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata();
    options.assetMetadataCache?.set(asset.sha256, metadata);
    const expected = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[asset.mediaType];
    if (metadata.format !== expected || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new Error(`Downloaded source media is not the declared static raster: ${asset.key}`);
  }
  validateCatalogSourceOwnership(contract, manifest, sourceEvidence, sourceVisibleText);
  const bindingResult = validateBlockBindings(contract, program, manifest);
  const sourceCoverage = await loadSourceCoverage(contract, jobDir, { report, program });
  for (const [filename, expected] of files) if (sha256(await readFile(filename)) !== expected) throw new Error('Fidelity files changed during local validation');
  const passed = sourceCoverage.passed && !bindingResult.limitations.length;
  const audit: FidelityAudit = { version: 1, workflow: 'block-replication', passed, status: passed ? 'passed' : sourceCoverage.status === 'failed' ? 'failed' : 'needs-review', sourceCoverage, programPath, programSha256: sha256(programBytes), contractSha256: sha256(contractBytes), assetsManifestSha256: sha256(manifestBytes), blocks: contract.blocks.length, nativeElements: bindingResult.nativeElements, textBindings: bindingResult.textBindings, assets: manifest.assets, limitations: [...bindingResult.limitations, ...sourceCoverage.issues.map(issue => `${issue.code}: ${issue.message}`)] };
  if (options.writeAudit !== false) await writeJson(path.join(jobDir, 'fidelity-audit.json'), audit);
  return { program, contract, manifest, audit };
}
export const loadFidelityProgram = auditFidelityProgram;
