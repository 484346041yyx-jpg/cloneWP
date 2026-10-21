import path from 'node:path';
import { readFile, realpath, mkdir, stat, writeFile, open, rename, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { loadConfig, readJson, redactor } from '../core/config.js';
import { acquireLock, writeJson } from '../core/files.js';
import { assertCreationTaskMode } from '../core/creation-mode.js';
import { previewCookies } from '../core/runner.js';
import { WordPressClient, getAssetImportFailure, type AssetImportCheckpoint, type RecoverableAssetImportOptions, type ImportedAsset, type DraftSnapshot, type LegacySchema, type ElementorElement } from '../wordpress/client.js';
import { compileEditorElements } from '../wordpress/editor-serialization.js';
import { assertFidelityEnvironment } from '../fidelity/runner.js';
import { retainRegisteredInactiveDefaults } from '../fidelity/revision.js';
import type { TargetCatalogEvidence } from '../fidelity/catalog-contract.js';
import { compileReplicaV2, referencedAssetsV2, usedWidgetTypesV2, replicaIdV2, preflightReplicaV2 } from './compile.js';
import { validateProgramV2 } from './validate.js';
import { renderStaticHTML } from './html.js';
import { buildCapabilitySampleV2 } from './capability-sample.js';
import { validateSourceFactsV2, verifySourceFactsEvidenceV2, type SourceFactsV2 } from './source.js';
import { validateComponentPlanV2, type ComponentPlanV2 } from './component-plan.js';
import type { SceneInventoryV2 } from './scene-inventory.js';
import { walkComponentsV2, type ProgramV2, type CompiledReplicaV2, type ImportedAssetV2, type ReplicaStage, type FileRef, type GeneratedHtmlProof } from './types.js';
import { canonicalV2, hashV2, documentHashV2, ensureDiskSpaceV2, readJournalV2, saveJournalV2, newMutationIntentV2, reconcileMutationV2, retryReadV2, assertResumeIdentityV2, proveImmutableInputExtensionV2, mergeOwnedBlocksV2, assertCompletableV2, assertStageOrderV2, restoreSnapshotV2, beginStageAttemptV2, finishStageAttemptV2, readSnapshotRefV2, writeSnapshotRefV2, safeErrorV2, type RuntimeJournalV2, type ImmutableInputExtensionProofV2 } from './journal.js';
import { captureReplicaV2, loadValidReviewV2, verifyProductCapabilityProbeV2, hasVerifiedViewportCoverageV2, type VisualCheckpointV2, type CaptureReceiptV2, type ReviewResumeSealV2 } from './verify.js';
import { verifyReplicaEditorV2 } from './editor.js';
import { reconcileLateProductEditorSaveV2 } from './editor-recovery.js';

export { recordVisualReviewV2 } from './verify.js';
export interface ReplicaRunResultV2 { version: 2; workflow: 'block-replication'; mode: 'replica'; taskId: string; runId: string; runDir: string; status: RuntimeJournalV2['status']; stage: ReplicaStage; checkpoint?: string; stagePassed: boolean; completed: boolean; wholeTaskComplete: boolean; pageId?: number; editUrl?: string; previewUrl?: string; finalHash?: string; evidence: string[]; error?: string; metrics: Record<string, number> }
interface ManifestAssetV2 { key: string; localPath: string; sourceUrl: string; observedResourceUrl?: string; sha256: string; mediaType: string; alt?: string; originalSourcePath?: string; originalSha256?: string; width?: number; height?: number }
interface AssetManifestV2 { assets: ManifestAssetV2[] }
interface MediaMutationIntentV2 { id: string; kind: 'media-upload' | 'media-register'; pageId: number; runId: string; assetKey: string; beforeHash: string; expectedAfterHash: string; status: 'intent' | 'confirmed' | 'write-unknown'; createdAt: string }
interface MediaLedgerV2 { version: 2; runId: string; pageId: number; assets: Array<{ key: string; sha256: string; status: 'importing' | 'complete' | 'unknown' | 'retryable'; phase?: AssetImportCheckpoint['phase']; remoteWriteStarted?: boolean; recovery?: 'registered' | 'staged' | 'before'; operations?: MediaMutationIntentV2[]; imported?: ImportedAssetV2 }> }
interface LocalInputV2 { program: ProgramV2; sourceFacts: SourceFactsV2; sceneInventories: SceneInventoryV2[]; componentPlan: ComponentPlanV2; manifest: AssetManifestV2; jobDir: string; programHash: string; sourceFactsHash: string; componentPlanHash: string; assetsManifestHash: string }

function inside(root: string, file: string): void { const relative = path.relative(root, file); if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('Replica v2 path must stay within its explicit task/project root'); }
async function readRef(jobDir: string, ref: FileRef): Promise<Buffer> { const file = await realpath(path.resolve(jobDir, ref.path)); inside(jobDir, file); const bytes = await readFile(file); if (hashV2(bytes) !== ref.sha256) throw Error(`Replica v2 immutable file hash mismatch: ${path.basename(file)}`); return bytes; }
export function assertSafeSVGBytesV2(bytes: Buffer): void {
  const text = bytes.toString('utf8'); if (!/<svg\b/i.test(text)) return;
  if (/<(?:script|foreignObject)\b|\bon\w+\s*=|<!ENTITY|<!DOCTYPE|(?:href|src)\s*=\s*["'](?!#)|@import\b|url\(\s*(?:["'](?!#)|[^"'\s#])/i.test(text)) throw Error('Source SVG has executable or external references');
}
export async function validateAssetBytesV2(bytes: Buffer, declaredMime: string): Promise<{ width: number; height: number; mimeType: string }> {
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw Error('Current-job image exceeds the 1 byte to 20 MiB media limit');
  assertSafeSVGBytesV2(bytes);
  const metadata = await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata(), format = metadata.format;
  if (format === 'svg') throw Error('Safe SVG must be rasterized to a verified PNG before native media import');
  const mimeByFormat: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', ...(format === 'heif' && metadata.compression === 'av1' ? { heif: 'image/avif' } : {}) };
  const mimeType = format ? mimeByFormat[format] : undefined;
  if (!mimeType || mimeType !== declaredMime || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw Error('Current-job media MIME, dimensions or static-image bytes do not match the manifest');
  return { width: metadata.width, height: metadata.height, mimeType };
}
export async function validateLocalInputV2(filename: string, root: string, stage: ReplicaStage): Promise<LocalInputV2> {
  const actualRoot = await realpath(root), actual = await realpath(path.resolve(actualRoot, filename)); inside(actualRoot, actual);
  const bytes = await readFile(actual), program = validateProgramV2(JSON.parse(bytes.toString('utf8'))), jobDir = path.dirname(actual);
  const factsBytes = await readRef(jobDir, program.sourceFacts), planBytes = await readRef(jobDir, program.componentPlan), manifestBytes = await readRef(jobDir, program.assetsManifest);
  const sourceFacts = validateSourceFactsV2(JSON.parse(factsBytes.toString('utf8')));
  if (sourceFacts.sourceUrl !== program.sourceUrl) throw Error('Source facts and program identify different public URLs');
  for (const ref of [sourceFacts.observation, ...sourceFacts.snapshots.flatMap(snapshot => [snapshot.screenshot, ...snapshot.evidence]), ...(sourceFacts.sceneInventories ?? [])]) await readRef(jobDir, ref);
  const sceneInventories = await verifySourceFactsEvidenceV2(sourceFacts);
  const componentPlan = validateComponentPlanV2(JSON.parse(planBytes.toString('utf8')), sourceFacts, { stage, sceneInventories });
  if (componentPlan.sourceFacts.sha256 !== program.sourceFacts.sha256) throw Error('Component plan is not bound to the exact source facts');
  const programKeys = new Set(program.blocks.map(block => block.key)), roots = componentPlan.components.filter(component => component.parentId === null);
  if (roots.length !== program.blocks.length || roots.some((component, index) => !programKeys.has(component.id) || component.id !== program.blocks[index].key)) throw Error('Program roots must equal the ordered independently authored component plan roots');
  const programComponents = new Map(walkComponentsV2(program.blocks).map(component => [component.key, component]));
  for (const component of componentPlan.components) { const actual = programComponents.get(component.id), renderer = actual?.kind === 'html-static' ? 'html' : actual?.kind === 'native-carousel' ? 'carousel' : actual?.kind === 'native-products' ? 'products' : actual?.kind; if (!actual || component.renderer !== renderer) throw Error(`Planned component renderer does not match its actual implementation: ${component.id}`); }
  for (const component of programComponents.values()) if (component.sourceFactIds?.some(id => !sourceFacts.facts[id])) throw Error(`Component references an unknown source fact: ${component.key}`);
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as AssetManifestV2;
  if (!Array.isArray(manifest.assets) || new Set(manifest.assets.map(asset => asset.key)).size !== manifest.assets.length) throw Error('Current job has an invalid or duplicate asset manifest');
  for (const requirement of componentPlan.requirements.filter(item => item.disposition === 'preserve' && item.verification.kind === 'media')) {
    const specification = requirement.verification.expected as { assetKey?: string } | undefined;
    if (specification?.assetKey) { const asset = manifest.assets.find(item => item.key === specification.assetKey); if (!asset) throw Error(`Preserved media has no current-job source asset: ${requirement.id}`); for (const fact of requirement.factIds.map(id => sourceFacts.facts[id]).filter(fact => fact.kind === 'media')) { const source = fact.value.resource as { url?: string }; if (source?.url !== asset.sourceUrl && source?.url !== asset.observedResourceUrl) throw Error(`Preserved media source ownership differs from its actual asset: ${requirement.id}`); } }
  }
  for (const key of referencedAssetsV2(program, stage)) {
    const asset = manifest.assets.find(asset => asset.key === key); if (!asset) throw Error(`Current component references missing source asset: ${key}`);
    const bytes = await readRef(jobDir, { path: asset.localPath, sha256: asset.sha256 }), metadata = await validateAssetBytesV2(bytes, asset.mediaType);
    if (asset.width !== undefined && asset.width !== metadata.width || asset.height !== undefined && asset.height !== metadata.height) throw Error(`Declared source image dimensions differ from bytes: ${key}`);
    if (asset.originalSourcePath || asset.originalSha256) {
      let original: Buffer;
      if (asset.originalSourcePath && asset.originalSha256) original = await readRef(jobDir, { path: asset.originalSourcePath, sha256: asset.originalSha256 });
      else if (asset.originalSha256 && asset.sourceUrl.startsWith('data:image/')) { const comma = asset.sourceUrl.indexOf(','); original = /;base64$/i.test(asset.sourceUrl.slice(0, comma)) ? Buffer.from(asset.sourceUrl.slice(comma + 1), 'base64') : Buffer.from(decodeURIComponent(asset.sourceUrl.slice(comma + 1))); if (hashV2(original) !== asset.originalSha256) throw Error(`Inline conversion provenance hash differs: ${key}`); }
      else throw Error(`Converted source image requires its original current-job bytes and hash: ${key}`);
      assertSafeSVGBytesV2(original);
    }
  }
  return { program, sourceFacts, sceneInventories, componentPlan, manifest, jobDir, programHash: hashV2(bytes), sourceFactsHash: hashV2(factsBytes), componentPlanHash: hashV2(planBytes), assetsManifestHash: hashV2(manifestBytes) };
}
/** Input filenames identify original bytes, never the serialization of a parsed schema. */
export async function archiveRawInputV2(options: { runDir: string; kind: 'program' | 'component-plan' | 'source-facts' | 'assets-manifest'; sha256: string; bytes: Buffer; normalize: (value: unknown) => unknown }): Promise<{ path: string; sha256: string; repaired: boolean; historyRef?: { path: string; sha256: string } }> {
  if (!/^[a-f\d]{64}$/.test(options.sha256) || hashV2(options.bytes) !== options.sha256) throw Error('Original raw input bytes do not match their immutable hash');
  const directory = path.join(options.runDir, 'inputs'); await mkdir(directory, { recursive: true }); inside(options.runDir, await realpath(directory));
  const filename = path.join(directory, `${options.kind}-${options.sha256}.json`), normalized = canonicalV2(options.normalize(JSON.parse(options.bytes.toString('utf8'))));
  let previous: Buffer | undefined; try { previous = await readFile(filename); inside(directory, await realpath(filename)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (previous && hashV2(previous) === options.sha256) return { path: filename, sha256: options.sha256, repaired: false };
  if (previous && canonicalV2(options.normalize(JSON.parse(previous.toString('utf8')))) !== normalized) throw Error('Existing raw-input cache differs from the actual schema-validated input');
  const operationId = randomUUID(), temporary = path.join(directory, `.${options.kind}-${operationId}.raw.tmp`), displaced = path.join(directory, `.${options.kind}-${operationId}.before.tmp`);
  const handle = await open(temporary, 'wx'); try { await handle.writeFile(options.bytes); await handle.sync(); } finally { await handle.close(); }
  let historyRef: { path: string; sha256: string } | undefined, receiptPath: string | undefined, moved = false;
  const history: Record<string, unknown> = { version: 2, kind: 'raw-input-cache-repair', operationId, inputKind: options.kind, inputPath: filename, expectedRawHash: options.sha256, status: 'intent', createdAt: new Date().toISOString() };
  try {
    if (previous) {
      const beforeHash = hashV2(previous), archive = path.join(directory, 'raw-cache-history'); await mkdir(archive, { recursive: true }); inside(directory, await realpath(archive));
      const beforePath = path.join(archive, `${beforeHash}.json`);
      try { await writeFile(beforePath, previous, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      if (hashV2(await readFile(beforePath)) !== beforeHash) throw Error('Archived previous raw input bytes changed');
      historyRef = { path: beforePath, sha256: beforeHash }; history.before = historyRef; receiptPath = path.join(archive, `${options.kind}-${options.sha256}-${operationId}.json`); await writeJson(receiptPath, history);
      // Moving then exclusively linking avoids replacing a third party's newer path between a read and rename.
      await rename(filename, displaced); moved = true;
      if (hashV2(await readFile(displaced)) !== beforeHash) throw Error('Raw-input cache changed concurrently before replacement');
    }
    try { await link(temporary, filename); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Error('Raw-input cache path changed concurrently; current bytes were preserved'); throw error; }
    if (hashV2(await readFile(filename)) !== options.sha256) throw Error('Installed original raw input bytes changed during readback');
    if (receiptPath) { history.status = 'confirmed'; history.confirmedAt = new Date().toISOString(); await writeJson(receiptPath, history); }
    if (moved) { await unlink(displaced); moved = false; }
    return { path: filename, sha256: options.sha256, repaired: !!previous, ...(historyRef ? { historyRef } : {}) };
  } catch (error) {
    if (moved) { try { await link(displaced, filename); await unlink(displaced); moved = false; } catch { /* Preserve both the displaced bytes and any independently created current path. */ } }
    if (receiptPath) { history.status = 'conflict'; history.error = safeErrorV2(error); if (moved) history.displacedPath = displaced; await writeJson(receiptPath, history); }
    throw error;
  } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}
async function archiveRunInputsV2(runDir: string, filename: string, input: LocalInputV2, stage: ReplicaStage): Promise<void> {
  const programPath = await realpath(path.resolve(filename)); inside(input.jobDir, programPath);
  await archiveRawInputV2({ runDir, kind: 'program', sha256: input.programHash, bytes: await readFile(programPath), normalize: validateProgramV2 });
  await archiveRawInputV2({ runDir, kind: 'source-facts', sha256: input.sourceFactsHash, bytes: await readRef(input.jobDir, input.program.sourceFacts), normalize: validateSourceFactsV2 });
  await archiveRawInputV2({ runDir, kind: 'component-plan', sha256: input.componentPlanHash, bytes: await readRef(input.jobDir, input.program.componentPlan), normalize: value => validateComponentPlanV2(value, input.sourceFacts, { stage, sceneInventories: input.sceneInventories }) });
  await archiveRawInputV2({ runDir, kind: 'assets-manifest', sha256: input.assetsManifestHash, bytes: await readRef(input.jobDir, input.program.assetsManifest), normalize: value => value });
}
/** Desktop dependency identity excludes only explicitly responsive additions. Existing source facts remain immutable. */
export function desktopDependencyV2(input: LocalInputV2): string {
  const snapshotId = input.componentPlan.desktopSnapshotId, snapshot = input.sourceFacts.snapshots.find(item => item.id === snapshotId)!;
  const desktopKeys = new Set(walkComponentsV2(input.program.blocks, 'desktop').map(component => component.key));
  const prune = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.filter(item => !(item && typeof item === 'object' && (item as any).stage === 'responsive')).map(prune);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['responsiveCss', 'responsive'].includes(key) && !/_(?:tablet|mobile)(?:_extra)?$/.test(key)).map(([key, item]) => [key, prune(item)]));
    return value;
  };
  const desktopFacts = Object.values(input.sourceFacts.facts).filter(fact => fact.snapshotId === snapshotId).map(fact => ({ ...fact, evidence: { sha256: fact.evidence.sha256 } }));
  const componentPlan = { components: input.componentPlan.components.filter(component => desktopKeys.has(component.id)).map(component => ({ ...component, variants: component.variants.filter(variant => variant.snapshotId === snapshotId) })), requirements: input.componentPlan.requirements.filter(requirement => requirement.factIds.some(id => input.sourceFacts.facts[id]?.snapshotId === snapshotId)).map(requirement => ({ ...requirement, factIds: requirement.factIds.filter(id => input.sourceFacts.facts[id]?.snapshotId === snapshotId) })), gapResolutions: (input.componentPlan.gapResolutions ?? []).filter(resolution => resolution.snapshotId === snapshotId), inventoryResolutions: (input.componentPlan.inventoryResolutions ?? []).filter(resolution => resolution.snapshotId === snapshotId) };
  const assets = [...referencedAssetsV2(input.program, 'desktop')].sort().map(key => { const asset = input.manifest.assets.find(item => item.key === key)!; return { key, sourceUrl: asset.sourceUrl, sha256: asset.sha256, mediaType: asset.mediaType }; });
  return hashV2(canonicalV2({ taskId: input.program.taskId, title: input.program.title, sourceUrl: input.program.sourceUrl, viewports: input.program.viewports.filter(view => view.stage === 'desktop'), blocks: prune(input.program.blocks), snapshot: { id: snapshot.id, viewport: snapshot.viewport, screenshot: snapshot.screenshot.sha256, evidence: snapshot.evidence.map(ref => ref.sha256) }, sceneInventories: (input.sourceFacts.sceneInventories ?? []).filter(inventory => inventory.snapshotId === snapshotId).map(inventory => ({ snapshotId: inventory.snapshotId, sha256: inventory.sha256 })), ...(input.sourceFacts.sourceCommerce ? { sourceCommerce: input.sourceFacts.sourceCommerce.filter(group => group.snapshotId === snapshotId).map(group => ({ ...group, evidence: { sha256: group.evidence.sha256 } })) } : {}), facts: desktopFacts, gaps: input.sourceFacts.gaps.filter(gap => gap.snapshotId === snapshotId), plan: componentPlan, assets }));
}
function firstFoldProgram(input: Pick<LocalInputV2, 'program' | 'componentPlan'>): ProgramV2 {
  const marked = input.componentPlan.components.filter(component => component.parentId === null && component.firstFold).map(component => component.id);
  const keys = marked.length ? marked : [input.program.blocks[0].key], index = input.program.blocks.reduce((last, block, index) => keys.includes(block.key) ? index : last, -1);
  if (input.program.blocks.slice(0, index + 1).some(block => !keys.includes(block.key))) throw Error('First-fold blocks must be an ordered prefix of the desktop page');
  return { ...input.program, blocks: input.program.blocks.slice(0, index + 1) };
}
/** The first fold has its own complete dependency, independent of later page roots. */
export function firstFoldDependencyV2(input: Pick<LocalInputV2, 'program' | 'componentPlan' | 'sourceFactsHash' | 'assetsManifestHash'>): string {
  const projection = firstFoldProgram(input), keys = new Set(walkComponentsV2(projection.blocks).map(component => component.key));
  return hashV2(canonicalV2({ version: input.program.version, workflow: input.program.workflow, taskId: input.program.taskId, sourceUrl: input.program.sourceUrl, title: input.program.title, sourceFactsHash: input.sourceFactsHash, assetsManifestHash: input.assetsManifestHash, viewports: input.program.viewports.filter(view => view.stage === 'desktop'), blocks: projection.blocks, desktopSnapshotId: input.componentPlan.desktopSnapshotId, components: input.componentPlan.components.filter(component => keys.has(component.id)), requirements: input.componentPlan.requirements.filter(requirement => keys.has(requirement.componentId)), gapResolutions: (input.componentPlan.gapResolutions ?? []).filter(resolution => keys.has(resolution.componentId)), inventoryResolutions: (input.componentPlan.inventoryResolutions ?? []).filter(resolution => keys.has(resolution.componentId)) }));
}
export interface FirstFoldReuseV2 { version: 2; kind: 'first-fold-reuse'; firstFoldInputHash: string; currentProgramHash: string; currentComponentPlanHash: string; priorProgramHash: string; priorComponentPlanHash: string; sourceFactsHash: string; assetsManifestHash: string; sourceDocumentHash: string; captureRef: { path: string; sha256: string }; reviewRef: { path: string; sha256: string } }
export async function loadDesktopReviewResumeV2(input: Pick<LocalInputV2, 'program' | 'programHash' | 'componentPlanHash' | 'sourceFactsHash' | 'assetsManifestHash'>, journal: RuntimeJournalV2, environmentLockBytes: Buffer): Promise<{ capture: CaptureReceiptV2; reportPath: string; reportHash: string; seal: ReviewResumeSealV2 } | undefined> {
  if (journal.status !== 'awaiting-review' || journal.stage !== 'desktop' || journal.checkpoint !== 'desktop' || !journal.pageId || !journal.documentHash || journal.completed || journal.mutations.some(intent => intent.status !== 'confirmed') || journal.capabilityProbe?.status !== 'passed') return;
  try {
    const filename = path.join(journal.runDir, 'verification', 'desktop', 'capture.json'), bytes = await readFile(filename), capture = JSON.parse(bytes.toString('utf8')) as CaptureReceiptV2, seal = capture.reviewResume;
    if (!seal || seal.version !== 1 || !capture.automatedPassed || capture.documentHash !== journal.documentHash || capture.programHash !== input.programHash || capture.componentPlanHash !== input.componentPlanHash || capture.sourceFactsHash !== input.sourceFactsHash || seal.assetsManifestHash !== input.assetsManifestHash || seal.environmentLockHash !== hashV2(environmentLockBytes) || seal.environmentHash !== journal.environmentHash || !await hasVerifiedViewportCoverageV2(capture, input.program, 'desktop', journal.runDir)) return;
    if ((await loadValidReviewV2(journal.runDir, 'desktop', capture.documentHash))?.verdict !== 'passed') return;
    const file = await realpath(seal.capabilitiesRef.path); inside(journal.runDir, file); const capabilityBytes = await readFile(file); if (hashV2(capabilityBytes) !== seal.capabilitiesRef.sha256) throw Error('Sealed stage native capability evidence changed');
    const capabilities = JSON.parse(capabilityBytes.toString('utf8')) as Awaited<ReturnType<WordPressClient['discoverCapabilities']>>, used = reviewCheckpointTypesV2(input.program), verified = assertFidelityEnvironment(capabilities, JSON.parse(environmentLockBytes.toString('utf8')), used);
    if (canonicalV2(capabilities.checkpointProof) !== canonicalV2(seal.checkpointProof) || seal.checkpointProof.version !== 1 || !/^[a-f\d]{64}$/.test(seal.checkpointProof.sha256) || canonicalV2(seal.checkpointProof.types) !== canonicalV2([...used].sort()) || hashV2(canonicalV2({ mode: verified.mode, versions: verified.versions, responsiveDevices: verified.responsiveDevices, sourceProof: capabilities.sourceProof })) !== seal.environmentHash) return;
    // Parent synchronization uses the generated default excluded from the lightweight proof.
    if (walkComponentsV2(input.program.blocks).some(component => component.kind === 'native-products' && (component.widgetSettings.carousel_sync ?? capabilities.legacySchemas.wd_products?.controls.carousel_sync?.default) === 'parent')) return;
    const reportPath = capture.reportPath ?? filename; inside(journal.runDir, await realpath(reportPath)); const reportHash = hashV2(await readFile(reportPath)); if (reportHash !== hashV2(bytes)) throw Error('Immutable stage report differs from the reviewed summary');
    return { capture, reportPath, reportHash, seal };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}
const reviewCheckpointTypesV2 = (program: ProgramV2): string[] => [...new Set([...usedWidgetTypesV2(program, 'final'), ...(walkComponentsV2(program.blocks).some(component => component.kind === 'native-carousel') ? ['heading'] : [])])];
export async function confirmDesktopReviewResumeV2(options: { input: Pick<LocalInputV2, 'program' | 'sourceFactsHash' | 'assetsManifestHash'>; journal: RuntimeJournalV2; candidate: NonNullable<Awaited<ReturnType<typeof loadDesktopReviewResumeV2>>>; desktopDependencyHash: string; client: Pick<WordPressClient, 'readOwnedReviewCheckpoint'> }): Promise<DraftSnapshot> {
  const { input, journal, candidate } = options, actual = await retryReadV2(() => options.client.readOwnedReviewCheckpoint(journal.pageId!, journal.runId, candidate.seal.checkpointProof.types));
  assertResumeIdentityV2(journal, { taskId: input.program.taskId, sourceUrl: input.program.sourceUrl, targetUrl: journal.targetUrl, sourceFactsHash: input.sourceFactsHash, assetsManifestHash: input.assetsManifestHash, desktopDependencyHash: options.desktopDependencyHash, environmentHash: candidate.seal.environmentHash }, actual.snapshot);
  if (actual.snapshot.hash !== candidate.capture.documentHash || canonicalV2(actual.proof) !== canonicalV2(candidate.seal.checkpointProof)) throw Error('Native controls, source files, global presentation or the document changed after stage capture; fresh verification is required');
  return actual.snapshot;
}
/** Retains the original screenshot/review identity; never certifies a new document hash. */
export async function loadReusableFirstFoldV2(runDir: string, input: Pick<LocalInputV2, 'program' | 'componentPlan' | 'sourceFactsHash' | 'assetsManifestHash' | 'programHash' | 'componentPlanHash'>, options: { journal: RuntimeJournalV2; snapshot: DraftSnapshot; schemas: Record<string, LegacySchema>; catalog?: TargetCatalogEvidence; pageSettings?: Record<string, unknown> }): Promise<FirstFoldReuseV2 | undefined> {
  try {
    const directory = path.join(runDir, 'verification', 'desktop-firstfold'), latestPath = path.join(directory, 'capture.json'), captureBytes = await readFile(latestPath), capture = JSON.parse(captureBytes.toString('utf8')) as CaptureReceiptV2;
    // Historical normalized input snapshots were not sealed with semantic hashes.
    // Keep their full plan hash exact and additionally prove actual saved target bytes below.
    if (!capture.automatedPassed || capture.sourceFactsHash !== input.sourceFactsHash || capture.componentPlanHash !== input.componentPlanHash || !await hasVerifiedViewportCoverageV2(capture, input.program, 'desktop-firstfold', runDir)) return;
    const review = await loadValidReviewV2(runDir, 'desktop-firstfold', capture.documentHash); if (review?.verdict !== 'passed') return;
    if (![capture.programHash, capture.componentPlanHash, capture.sourceFactsHash].every(value => /^[a-f\d]{64}$/.test(value))) throw Error('First-fold capture has invalid immutable input references');
    const previousProgram = validateProgramV2(await readJson(path.join(runDir, 'inputs', `program-${capture.programHash}.json`))), previousPlan = await readJson<ComponentPlanV2>(path.join(runDir, 'inputs', `component-plan-${capture.componentPlanHash}.json`));
    if (previousProgram.componentPlan.sha256 !== capture.componentPlanHash || previousProgram.sourceFacts.sha256 !== capture.sourceFactsHash || previousProgram.assetsManifest.sha256 !== input.assetsManifestHash || previousPlan.sourceFacts.sha256 !== capture.sourceFactsHash || !Array.isArray(previousPlan.components) || !Array.isArray(previousPlan.requirements)) return;
    const inputHash = firstFoldDependencyV2(input), previousHash = firstFoldDependencyV2({ program: previousProgram, componentPlan: previousPlan, sourceFactsHash: capture.sourceFactsHash, assetsManifestHash: previousProgram.assetsManifest.sha256 }); if (inputHash !== previousHash) return;
    const candidates = [path.join(runDir, 'documents', `${capture.documentHash}.json`), ...options.journal.mutations.filter(intent => intent.expectedAfterHash === capture.documentHash).map(intent => path.join(runDir, 'mutations', `${intent.id}-expected.json`)), path.join(runDir, 'target', 'accepted-snapshot.json')]; let baseline: DraftSnapshot | undefined;
    for (const filename of candidates) { try { const value = await readSnapshotRefV2(runDir, filename); if (value.hash === capture.documentHash && value.pageId === options.snapshot.pageId && value.runId === options.snapshot.runId) { baseline = value; break; } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    if (!baseline) return;
    const assets = await readJson<ImportedAssetV2[]>(path.join(runDir, 'assets', 'imported.json')), projection = firstFoldProgram(input);
    // Dynamic product records may change without a document mutation; the full current data check remains mandatory.
    if (walkComponentsV2(projection.blocks, 'desktop').some(component => component.kind === 'native-products') || [...referencedAssetsV2(projection, 'desktop', options.schemas)].some(key => !assets.some(asset => asset.key === key))) return;
    const compiled = compileReplicaV2(projection, options.schemas, assets, options.catalog, 'desktop'), serialized = serializeOwnedProjectionV2(compiled.composition.elements, options.schemas, baseline.elements).elements;
    const oldRoots = baseline.elements.filter(node => compiled.sectionIds.includes(node.id)), currentRoots = options.snapshot.elements.filter(node => compiled.sectionIds.includes(node.id));
    if (canonicalV2(oldRoots) !== canonicalV2(serialized) || canonicalV2(currentRoots) !== canonicalV2(oldRoots) || canonicalV2(baseline.settings) !== canonicalV2({ ...options.snapshot.settings, ...compiled.composition.pageSettings, ...options.pageSettings })) return;
    const reportPath = capture.reportPath ?? latestPath, reportBytes = await readFile(reportPath); inside(runDir, await realpath(reportPath)); if (hashV2(reportBytes) !== hashV2(captureBytes)) throw Error('Immutable first-fold capture differs from the reviewed summary');
    const reviewPath = path.join(directory, 'visual-review.json');
    return { version: 2, kind: 'first-fold-reuse', firstFoldInputHash: inputHash, currentProgramHash: input.programHash, currentComponentPlanHash: input.componentPlanHash, priorProgramHash: capture.programHash, priorComponentPlanHash: capture.componentPlanHash, sourceFactsHash: input.sourceFactsHash, assetsManifestHash: input.assetsManifestHash, sourceDocumentHash: capture.documentHash, captureRef: { path: reportPath, sha256: hashV2(reportBytes) }, reviewRef: { path: reviewPath, sha256: hashV2(await readFile(reviewPath)) } };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}
function serializeOwnedProjectionV2(authored: ElementorElement[], schemas: Record<string, LegacySchema>, baseline: ElementorElement[]): { elements: ElementorElement[]; retained: ReturnType<typeof retainRegisteredInactiveDefaults>['retained'] } {
  const serialized = compileEditorElements(authored, schemas), flatten = (nodes: ElementorElement[]): ElementorElement[] => nodes.flatMap(node => [node, ...flatten(node.elements ?? [])]), originals = new Map(flatten(authored).map(node => [node.id, node])), saved = new Map(flatten(baseline).map(node => [node.id, node])); const retained: ReturnType<typeof retainRegisteredInactiveDefaults>['retained'] = [];
  for (const node of flatten(serialized)) { const original = originals.get(node.id), prior = saved.get(node.id); if (!original || !prior || node.widgetType !== prior.widgetType || node.elType !== prior.elType) continue; const result = retainRegisteredInactiveDefaults({ authored: [{ ...original, elements: [] }], serialized: [{ ...node, elements: [] }], baseline: [{ ...prior, elements: [] }], schemas }); node.settings = result.elements[0].settings; retained.push(...result.retained); }
  return { elements: serialized, retained };
}
export function resultFromV2(journal: RuntimeJournalV2, input: Pick<LocalInputV2, 'programHash' | 'componentPlanHash' | 'sourceFactsHash' | 'assetsManifestHash'>, stage: ReplicaStage): ReplicaRunResultV2 {
  const accepted = journal.stage === stage && journal.programHash === input.programHash && journal.componentPlanHash === input.componentPlanHash && journal.sourceFactsHash === input.sourceFactsHash && journal.assetsManifestHash === input.assetsManifestHash;
  const stagePassed = accepted && ['stage-passed', 'completed'].includes(journal.status) && journal.stages[stage].status === 'passed', completed = accepted && journal.status === 'completed' && journal.completed;
  return { version: 2, workflow: 'block-replication', mode: 'replica', taskId: journal.taskId, runId: journal.runId, runDir: journal.runDir, status: journal.status, stage, checkpoint: journal.checkpoint, stagePassed, completed, wholeTaskComplete: completed, pageId: journal.pageId, editUrl: journal.editUrl, previewUrl: journal.previewUrl, finalHash: journal.documentHash, evidence: accepted ? journal.stages[stage].evidence ?? [] : [], error: journal.error, metrics: journal.metrics };
}
/** Stage attempts describe the measured current document, never a prior accepted stage's hash. */
export async function bindStageCaptureV2(journal: RuntimeJournalV2, stage: ReplicaStage, capture: CaptureReceiptV2, actualDocumentHash: string): Promise<void> {
  if (capture.documentHash !== actualDocumentHash || journal.documentHash !== actualDocumentHash || capture.programHash !== journal.programHash || capture.componentPlanHash !== journal.componentPlanHash || capture.sourceFactsHash !== journal.sourceFactsHash) throw Error('Stage capture does not identify the current accepted inputs and actual document');
  const reportPath = capture.reportPath ?? path.join(journal.runDir, 'verification', capture.checkpoint, 'capture.json'), filename = await realpath(reportPath); inside(journal.runDir, filename); const bytes = await readFile(filename);
  if (canonicalV2(JSON.parse(bytes.toString('utf8'))) !== canonicalV2(capture)) throw Error('Stage capture report changed before its attempt was recorded');
  journal.stages[stage].documentHash = actualDocumentHash; journal.stages[stage].evidence = [reportPath]; journal.stages[stage].evidenceRefs = [{ path: reportPath, sha256: hashV2(bytes) }]; journal.checkpoint = capture.checkpoint;
}
/** Local-only revision proof is created before authentication and cannot be supplied by program JSON. */
export async function proveResumeInputsV2(journal: RuntimeJournalV2, input: Pick<LocalInputV2, 'jobDir' | 'program' | 'sourceFactsHash' | 'assetsManifestHash' | 'manifest'>): Promise<ImmutableInputExtensionProofV2 | undefined> {
  if (journal.sourceFactsHash === input.sourceFactsHash && journal.assetsManifestHash === input.assetsManifestHash) return;
  const proof = proveImmutableInputExtensionV2({ previousSourceFactsHash: journal.sourceFactsHash, sourceFactsHash: input.sourceFactsHash, previousAssetsManifestHash: journal.assetsManifestHash, assetsManifestHash: input.assetsManifestHash, previousSourceFactsBytes: await readFile(path.join(journal.runDir, 'inputs', `source-facts-${journal.sourceFactsHash}.json`)), sourceFactsBytes: await readRef(input.jobDir, input.program.sourceFacts), previousAssetsManifestBytes: await readFile(path.join(journal.runDir, 'inputs', `assets-manifest-${journal.assetsManifestHash}.json`)), assetsManifestBytes: await readRef(input.jobDir, input.program.assetsManifest) });
  let ledger: MediaLedgerV2; try { ledger = await readJson(path.join(journal.runDir, 'assets', 'ledger.json')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return proof; throw error; }
  if (ledger.version !== 2 || ledger.runId !== journal.runId || ledger.pageId !== journal.pageId || !Array.isArray(ledger.assets) || new Set(ledger.assets.map(asset => asset.key)).size !== ledger.assets.length) throw Error('Resume media ledger belongs to a different owned draft');
  for (const entry of ledger.assets) if (!input.manifest.assets.some(asset => asset.key === entry.key && asset.sha256 === entry.sha256) || entry.status === 'complete' && (!entry.imported || entry.imported.key !== entry.key || entry.imported.sha256 !== entry.sha256)) throw Error(`Resume changed an existing imported source asset: ${entry.key}`);
  return proof;
}

/** Woodmart generates this inactive synchronization text default per registry request.
 * Its entire control contract, dependencies and all other native fields stay exact. */
export function assertReusableNativeSchemasV2(previous: Record<string, LegacySchema>, current: Record<string, LegacySchema>, program: ProgramV2): Array<{ nativeType: string; control: string; previousDefaultHash: string; currentDefaultHash: string; reason: string }> {
  const reconciled: ReturnType<typeof assertReusableNativeSchemasV2> = [];
  for (const [type, schema] of Object.entries(previous)) {
    const actual = current[type]; if (!actual) throw Error(`Previously used native widget is unavailable: ${type}`);
    if (canonicalV2(schema) === canonicalV2(actual)) continue;
    const oldControl = schema.controls.sync_parent_id, newControl = actual.controls.sync_parent_id;
    const withoutDefault = (control: unknown) => control && typeof control === 'object' ? Object.fromEntries(Object.entries(control).filter(([key]) => key !== 'default')) : control;
    const consumers = walkComponentsV2(program.blocks).filter(component => 'widgetType' in component && component.widgetType === type);
    const inactive = (controls: LegacySchema['controls'], settings: Record<string, unknown>) => {
      const value = (key: string) => Object.hasOwn(settings, key) ? settings[key] : controls[key]?.default;
      return ['layout', 'carousel_sync'].every(key => controls[key] && value(key) !== undefined && (value(key) === null || typeof value(key) !== 'object')) && (value('layout') !== 'carousel' || value('carousel_sync') !== 'parent');
    };
    if (type !== 'wd_products' || !oldControl || !newControl || oldControl.type !== 'text' || !/^wd_[a-f\d]{13}$/.test(String(oldControl.default)) || !/^wd_[a-f\d]{13}$/.test(String(newControl.default)) || canonicalV2(withoutDefault(oldControl)) !== canonicalV2(withoutDefault(newControl)) || canonicalV2(newControl.condition) !== canonicalV2({ layout: 'carousel', carousel_sync: ['parent'] }) || newControl.conditions !== undefined || !consumers.length || consumers.some(component => !('widgetSettings' in component) || Object.hasOwn(component.widgetSettings, 'sync_parent_id') || !inactive(schema.controls, component.widgetSettings) || !inactive(actual.controls, component.widgetSettings))) throw Error(`Previously used native widget controls changed: ${type}`);
    const normalized = structuredClone(actual); normalized.controls.sync_parent_id.default = oldControl.default;
    if (canonicalV2(schema) !== canonicalV2(normalized)) throw Error(`Previously used native widget controls changed: ${type}`);
    reconciled.push({ nativeType: type, control: 'sync_parent_id', previousDefaultHash: hashV2(canonicalV2(oldControl.default)), currentDefaultHash: hashV2(canonicalV2(newControl.default)), reason: 'Only the registered per-request Woodmart synchronization ID default changed; its complete contract and dependencies are identical, author input omits it, and the real parent-sync condition is inactive for every consumer.' });
  }
  return reconciled;
}

export async function saveOwnedBatchV2(options: { client: Pick<WordPressClient, 'snapshotDraft' | 'buildDraft'>; snapshot: DraftSnapshot; compiled: CompiledReplicaV2; schemas: Record<string, LegacySchema>; journal: RuntimeJournalV2; checkpoint: string; changedRootIds?: string[] }): Promise<DraftSnapshot> {
  const current = await retryReadV2(() => options.client.snapshotDraft(options.snapshot.pageId));
  if (current.hash !== options.snapshot.hash) throw Error('Draft changed before the owned block save; concurrent edits are preserved');
  const { elements: desired, retained } = serializeOwnedProjectionV2(options.compiled.composition.elements, options.schemas, current.elements), elements = mergeOwnedBlocksV2(current.elements, desired, options.journal.ownedRootIds, options.changedRootIds ?? desired.map(node => node.id));
  if (retained.length) await writeJson(path.join(options.journal.runDir, 'target', `retained-inactive-defaults-${options.checkpoint}.json`), { version: 2, beforeHash: current.hash, retained });
  const settings = { ...current.settings, ...options.compiled.composition.pageSettings }, afterHash = documentHashV2(elements, settings);
  if (afterHash === current.hash) return current;
  await ensureDiskSpaceV2(path.resolve(options.journal.runDir, '..', '..'));
  const intent = newMutationIntentV2({ kind: 'document-save', checkpoint: options.checkpoint, pageId: current.pageId, runId: current.runId, beforeHash: current.hash, expectedAfterHash: afterHash, affectedBlockKeys: options.compiled.sections.filter(section => !options.changedRootIds || options.changedRootIds.includes(section.targetId)).map(section => section.key) });
  await writeSnapshotRefV2(options.journal.runDir, path.join(options.journal.runDir, 'mutations', `${intent.id}-before.json`), current); await writeSnapshotRefV2(options.journal.runDir, path.join(options.journal.runDir, 'mutations', `${intent.id}-expected.json`), { ...current, elements, settings, hash: afterHash });
  options.journal.mutations.push(intent); await saveJournalV2(options.journal);
  try {
    await options.client.buildDraft(current.pageId, { elements, pageSettings: settings }, undefined, { expectedCurrent: current, htmlProofs: options.compiled.htmlProofs, preserveUnknownWrite: true });
    const actual = await retryReadV2(() => options.client.snapshotDraft(current.pageId));
    if (reconcileMutationV2(intent, actual) !== 'confirmed') throw Error('Saved component batch does not equal its exact expected document');
    options.journal.documentHash = actual.hash; await writeSnapshotRefV2(options.journal.runDir, path.join(options.journal.runDir, 'target', 'accepted-snapshot.json'), actual); await saveJournalV2(options.journal); return actual;
  } catch (error) {
    intent.status = 'write-unknown'; options.journal.status = 'write-unknown'; intent.error = safeErrorV2(error); await saveJournalV2(options.journal);
    try { const actual = await retryReadV2(() => options.client.snapshotDraft(current.pageId)); const decision = reconcileMutationV2(intent, actual); if (decision === 'confirmed') { options.journal.documentHash = actual.hash; options.journal.status = 'running'; await writeSnapshotRefV2(options.journal.runDir, path.join(options.journal.runDir, 'target', 'accepted-snapshot.json'), actual); await saveJournalV2(options.journal); return actual; } await saveJournalV2(options.journal); }
    catch (readError) { if (intent.status === 'write-unknown') intent.error = `Write outcome unknown; ${safeErrorV2(readError)}`; await saveJournalV2(options.journal); }
    throw error;
  }
}

export async function resumeMutationsV2(journal: RuntimeJournalV2, client: Pick<WordPressClient, 'restoreDraft' | 'snapshotDraft'>, actual: DraftSnapshot, htmlProofs?: GeneratedHtmlProof[]): Promise<DraftSnapshot> {
  for (const intent of journal.mutations.filter(item => ['intent', 'write-unknown', 'restore-pending'].includes(item.status))) {
    if (intent.kind === 'editor-test') {
      if (actual.hash === intent.beforeHash) { intent.status = 'confirmed'; continue; }
      if (actual.hash !== intent.expectedAfterHash) { intent.status = 'conflict'; await saveJournalV2(journal); throw Error('Interrupted editor test has concurrent content; restoration refused'); }
      const before = await readSnapshotRefV2(journal.runDir, path.join(journal.runDir, 'mutations', `${intent.id}-before.json`)); if (before.hash !== intent.beforeHash || documentHashV2(before.elements, before.settings) !== before.hash) throw Error('Interrupted editor restoration baseline changed');
      await saveJournalV2(journal); actual = await restoreSnapshotV2(client, before, actual, journal, intent.checkpoint, intent.affectedBlockKeys, htmlProofs); intent.status = 'confirmed'; journal.documentHash = actual.hash; await saveJournalV2(journal);
    } else { const decision = reconcileMutationV2(intent, actual); if (decision === 'conflict') { await saveJournalV2(journal); throw Error('Interrupted write differs from before and expected-after; concurrent content preserved'); } if (intent.kind === 'restore' && decision === 'retryable') { const expected = await readSnapshotRefV2(journal.runDir, path.join(journal.runDir, 'mutations', `${intent.id}-expected.json`)); if (expected.hash !== intent.expectedAfterHash) throw Error('Pending restoration expected snapshot changed'); actual = await restoreSnapshotV2(client, expected, actual, journal, intent.checkpoint, intent.affectedBlockKeys, htmlProofs); intent.status = 'confirmed'; } journal.documentHash = actual.hash; }
  }
  if (!journal.mutations.some(intent => ['intent', 'write-unknown', 'restore-pending', 'conflict'].includes(intent.status))) journal.status = 'running';
  await saveJournalV2(journal); return actual;
}

/** Only an in-process proof that no write started permits automatic transient retries. */
export async function importAssetAttemptV2(client: Pick<WordPressClient, 'importAsset'>, localPath: string, options: RecoverableAssetImportOptions): Promise<ImportedAsset> {
  for (let attempt = 0; ; attempt++) try { return await client.importAsset(localPath, options); }
  catch (error) { const state = getAssetImportFailure(error), value = error as { code?: string; message?: string; status?: number }; if (state?.remoteWriteStarted !== false || attempt >= 2 || !/network_error|timeout|temporar|ECONNRESET|fetch failed|invalid.*(?:json|response)|machine-readable JSON|unexpected token/i.test(`${value.code ?? ''} ${value.message ?? ''}`)) throw error; }
}
async function importStageMedia(input: LocalInputV2, projection: ProgramV2, stage: ReplicaStage, journal: RuntimeJournalV2, client: WordPressClient, schemas: Record<string, LegacySchema>, progress: (message: string) => Promise<void>): Promise<ImportedAssetV2[]> {
  const ledgerPath = path.join(journal.runDir, 'assets', 'ledger.json');
  let ledger: MediaLedgerV2; try { ledger = await readJson(ledgerPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ledger = { version: 2, runId: journal.runId, pageId: journal.pageId!, assets: [] }; }
  if (ledger.runId !== journal.runId || ledger.pageId !== journal.pageId) throw Error('Media ledger belongs to a different owned draft');
  if (!Array.isArray(ledger.assets) || new Set(ledger.assets.map(entry => entry.key)).size !== ledger.assets.length || ledger.assets.some(entry => entry.status === 'complete' && (!entry.imported || entry.imported.sha256 !== entry.sha256 || entry.imported.key !== entry.key))) throw Error('Completed media ledger identity or local byte hash changed');
  const previouslyComplete = ledger.assets.filter(entry => entry.status === 'complete' && entry.imported).map(entry => entry.imported!);
  for (let index = 0; index < previouslyComplete.length; index += 100) await retryReadV2(() => client.verifyImportedAssets(journal.pageId!, previouslyComplete.slice(index, index + 100)));
  const required = referencedAssetsV2(projection, stage, schemas);
  for (const key of required) {
    const source = input.manifest.assets.find(asset => asset.key === key)!;
    let entry = ledger.assets.find(asset => asset.key === key); if (entry && entry.sha256 !== source.sha256) throw Error(`Media ledger bytes changed for ${key}`);
    if (entry?.status === 'complete' && entry.imported) continue;
    const duplicate = ledger.assets.find(asset => asset.status === 'complete' && asset.sha256 === source.sha256 && asset.imported);
    if (duplicate?.imported) { const alias = { key, sha256: source.sha256, status: 'complete' as const, imported: { ...duplicate.imported, key } }; if (entry) Object.assign(entry, alias); else ledger.assets.push(alias); await writeJson(ledgerPath, ledger); continue; }
    const recovering = !!entry; entry ??= { key, sha256: source.sha256, status: 'importing' }; if (!ledger.assets.includes(entry)) ledger.assets.push(entry);
    await ensureDiskSpaceV2(path.resolve(journal.runDir, '..', '..')); entry.status = 'importing'; await writeJson(ledgerPath, ledger);
    const localPath = await realpath(path.resolve(input.jobDir, source.localPath)); inside(input.jobDir, localPath); const bytes = await readFile(localPath);
    if (hashV2(bytes) !== source.sha256) throw Error(`Source asset bytes changed before import: ${key}`);
    await validateAssetBytesV2(bytes, source.mediaType);
    const baseOptions = { runId: journal.runId, pageId: journal.pageId!, sourceUrl: source.sourceUrl, mimeType: source.mediaType, alt: source.alt, verifiedSha256: source.sha256, originalSha256: source.originalSha256 };
    const previousWriteStarted = entry.remoteWriteStarted;
    try {
      let imported: ImportedAsset | undefined;
      if (recovering) {
        try { imported = await retryReadV2(() => client.importAsset(localPath, { ...baseOptions, requireExisting: true })); entry.recovery = 'registered'; }
        catch (error) { if ((error as { code?: string }).code !== 'existing_asset_required') throw error; }
      }
      if (!imported) {
        let recoverPendingUpload = false;
        if (recovering && previousWriteStarted !== false) {
          const pending = await retryReadV2(() => client.inspectPendingAsset(localPath, baseOptions));
          if (pending.status === 'attachment-present') throw Error(`Unresolved media registration: ${key} has matching attachment bytes without exact current-run metadata; no upload was retried`);
          recoverPendingUpload = pending.status === 'staged'; entry.recovery = recoverPendingUpload ? 'staged' : 'before';
          // Exact attachment lookup plus the owned-page byte scan and constrained-path
          // inspection distinguish response loss from the unchanged before state.
          await writeJson(ledgerPath, ledger);
        } else if (recovering) entry.recovery = 'before';
        imported = await importAssetAttemptV2(client, localPath, { ...baseOptions, recoverPendingUpload, onCheckpoint: async checkpoint => {
          await ensureDiskSpaceV2(path.resolve(journal.runDir, '..', '..'));
          entry!.phase = checkpoint.phase; entry!.remoteWriteStarted = checkpoint.remoteWriteStarted;
          if (checkpoint.phase === 'uploading' || checkpoint.phase === 'registering') {
            const identity = { runId: journal.runId, pageId: journal.pageId!, assetKey: key, sha256: source.sha256, mimeType: source.mediaType };
            (entry!.operations ??= []).push({ id: randomUUID(), kind: checkpoint.phase === 'uploading' ? 'media-upload' : 'media-register', pageId: journal.pageId!, runId: journal.runId, assetKey: key, beforeHash: hashV2(canonicalV2({ ...identity, state: checkpoint.phase === 'uploading' ? 'absent' : 'staged' })), expectedAfterHash: checkpoint.phase === 'uploading' ? source.sha256 : hashV2(canonicalV2({ ...identity, state: 'registered' })), status: 'intent', createdAt: new Date().toISOString() });
          }
          if (checkpoint.phase === 'complete') for (const operation of entry!.operations ?? []) operation.status = 'confirmed';
          await writeJson(ledgerPath, ledger);
        } });
      }
      entry.imported = { ...imported, key }; entry.status = 'complete'; entry.phase = 'complete'; for (const operation of entry.operations ?? []) operation.status = 'confirmed'; await writeJson(ledgerPath, ledger); await progress(`media-${ledger.assets.filter(asset => asset.status === 'complete').length}`);
    } catch (error) { const state = getAssetImportFailure(error); if (state && (!recovering || entry.recovery === 'before' || state.remoteWriteStarted)) { entry.phase = state.phase; entry.remoteWriteStarted = state.remoteWriteStarted; } entry.status = entry.remoteWriteStarted === false ? 'retryable' : 'unknown'; if (entry.status === 'unknown') for (const operation of entry.operations ?? []) if (operation.status === 'intent') operation.status = 'write-unknown'; await writeJson(ledgerPath, ledger); throw error; }
  }
  const assets = ledger.assets.filter(entry => entry.status === 'complete' && entry.imported).map(entry => entry.imported!);
  for (let index = 0; index < assets.length; index += 100) await retryReadV2(() => client.verifyImportedAssets(journal.pageId!, assets.slice(index, index + 100)));
  await writeJson(path.join(journal.runDir, 'assets', 'imported.json'), assets); return assets;
}

/** Run one explicit stage; a passed desktop/responsive stage never means the whole task completed. */
export async function runReplicaV2(filename: string, options: { root?: string; stage?: ReplicaStage; resume?: string; onProgress?: (message: string) => void | Promise<void> } = {}): Promise<ReplicaRunResultV2> {
  const root = await realpath(path.resolve(options.root ?? process.cwd())), stage = options.stage ?? 'desktop';
  if (!['desktop', 'responsive', 'final'].includes(stage)) throw Error('Unknown replica v2 stage');
  const input = await validateLocalInputV2(filename, root, stage), desktopDependencyHash = desktopDependencyV2(input); await assertCreationTaskMode(root, filename, 'replica'); await ensureDiskSpaceV2(root);
  const loaded = await loadConfig(root), redact = redactor(loaded.credentials), release = await acquireLock(root), started = performance.now();
  const client = new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, networkRoute:loaded.config.wordpressNetworkRoute });
  let journal: RuntimeJournalV2 | undefined, attemptId: string | undefined;
  const progress = async (message: string) => { if (journal) { journal.checkpoint = message; await saveJournalV2(journal); } await options.onProgress?.(message); };
  const finish = async () => { const elapsed = Math.round(performance.now() - started); journal!.metrics.elapsedMs += elapsed; if (attemptId) { finishStageAttemptV2(journal!.stages[stage], attemptId, journal!.status === 'awaiting-review' ? 'awaiting-review' : journal!.stages[stage].status, elapsed, journal!.checkpoint); attemptId = undefined; } const metrics = client.diagnostics(); for (const [key, value] of Object.entries(metrics)) journal!.metrics[key] = (journal!.metrics[key] ?? 0) + value; journal!.metrics.uploadBytes = journal!.metrics.mediaUploadBytes ?? 0; await saveJournalV2(journal!); const result = resultFromV2(journal!, input, stage); await writeJson(path.join(journal!.runDir, 'result.json'), result); await writeJson(path.join(input.jobDir, 'build-result.json'), result); return result; };
  try {
    if (options.resume) { const runDir = await realpath(path.resolve(root, options.resume)); inside(path.join(root, 'runs'), runDir); journal = await readJournalV2(runDir); if (path.resolve(journal.runDir) !== runDir) throw Error('Resume journal directory identity changed'); const extension = await proveResumeInputsV2(journal, input); assertResumeIdentityV2(journal, { taskId: input.program.taskId, sourceUrl: input.program.sourceUrl, targetUrl: loaded.config.targetUrl, sourceFactsHash: input.sourceFactsHash, assetsManifestHash: input.assetsManifestHash, desktopDependencyHash, stage }, undefined, extension); }
    else { const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-v2-${randomUUID().slice(0, 8)}`, runDir = path.join(root, 'runs', runId); await mkdir(runDir, { recursive: true }); journal = { version: 2, workflow: 'block-replication', taskId: input.program.taskId, runId, runDir, targetUrl: loaded.config.targetUrl, sourceUrl: input.program.sourceUrl, sourceFactsHash: input.sourceFactsHash, componentPlanHash: input.componentPlanHash, assetsManifestHash: input.assetsManifestHash, programHash: input.programHash, desktopDependencyHash, ownedBlockKeys: input.program.blocks.map(block => block.key), ownedRootIds: input.program.blocks.map(block => replicaIdV2(input.program.taskId, block.key)), status: 'running', stage, stages: { desktop: { status: 'pending' }, responsive: { status: 'pending' }, final: { status: 'pending' } }, mutations: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completed: false, metrics: { elapsedMs: 0, uploadBytes: 0, editorSessions: 0, captures: 0 } }; await saveJournalV2(journal); }
    if (!options.resume && stage !== 'desktop') throw Error('A fresh replica v2 task must start with desktop');
    assertStageOrderV2(journal, stage);
    const reviewResume = options.resume && stage === 'desktop' ? await loadDesktopReviewResumeV2(input, journal, await readFile(path.join(root, 'config/environment-lock.json'))) : undefined;
    if (journal.programHash !== input.programHash || journal.componentPlanHash !== input.componentPlanHash || journal.sourceFactsHash !== input.sourceFactsHash || journal.assetsManifestHash !== input.assetsManifestHash) { const sameDesktop = journal.desktopDependencyHash === desktopDependencyHash; for (const [name, record] of Object.entries(journal.stages)) if (name !== 'desktop' || !sameDesktop) record.status = 'stale'; journal.programHash = input.programHash; journal.componentPlanHash = input.componentPlanHash; journal.sourceFactsHash = input.sourceFactsHash; journal.assetsManifestHash = input.assetsManifestHash; journal.desktopDependencyHash = desktopDependencyHash; journal.completed = false; if (!sameDesktop && stage !== 'desktop') throw Error('Changed desktop component program requires desktop review before responsive/final'); }
    assertStageOrderV2(journal, stage);
    await archiveRunInputsV2(journal.runDir, path.resolve(root, filename), input, stage);
    journal.stage = stage; journal.status = 'running'; journal.error = undefined; const attempt = beginStageAttemptV2(journal.stages[stage], stage === 'desktop' ? desktopDependencyHash : hashV2(canonicalV2({ program: input.programHash, plan: input.componentPlanHash, source: input.sourceFactsHash, stage }))); journal.stages[stage] = attempt.record; attemptId = attempt.attemptId; await saveJournalV2(journal);
    if (reviewResume) {
      await progress('read-only-reviewed-checkpoint'); const actual = await confirmDesktopReviewResumeV2({ input, journal, candidate: reviewResume, desktopDependencyHash, client });
      journal.stages.desktop.status = 'passed'; journal.stages.desktop.documentHash = actual.hash; journal.stages.desktop.evidence = [reviewResume.reportPath]; journal.stages.desktop.evidenceRefs = [{ path: reviewResume.reportPath, sha256: reviewResume.reportHash }]; journal.status = 'stage-passed'; journal.checkpoint = 'desktop-reviewed-checkpoint';
      await writeSnapshotRefV2(journal.runDir, path.join(journal.runDir, 'target', 'accepted-snapshot.json'), actual); await writeJson(path.join(journal.runDir, 'elementor-template.json'), { version: '0.4', title: input.program.title, type: 'page', content: actual.elements, page_settings: actual.settings }); return await finish();
    }
    await progress('read-only-native-preflight'); const preflight = await retryReadV2(() => client.preflight()); if (preflight.blockers.length) throw Error(preflight.blockers.join(' '));
    const used = reviewCheckpointTypesV2(input.program), capabilities = await retryReadV2(() => client.discoverCapabilities(used)), lock = await readJson<any>(path.join(root, 'config/environment-lock.json'));
    const compatibility = assertFidelityEnvironment(capabilities, lock, used), environmentHash = hashV2(canonicalV2({ mode: compatibility.mode, versions: compatibility.versions, responsiveDevices: compatibility.responsiveDevices, sourceProof: capabilities.sourceProof }));
    if (journal.environmentHash && journal.environmentHash !== environmentHash) throw Error('Native environment changed since this owned run; fresh capability review is required'); journal.environmentHash = environmentHash;
    let previousEnvironment: { widgets: Record<string, unknown> } | undefined;
    try { previousEnvironment = await readJson(path.join(journal.runDir, 'target', 'environment.json')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (previousEnvironment) {
      let previousCapabilities: typeof capabilities; try { previousCapabilities = await readJson(path.join(journal.runDir, 'target', 'accepted-capabilities.json')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; try { previousCapabilities = await readJson(path.join(journal.runDir, 'target', 'capabilities-desktop.json')); } catch { throw Error('Owned run lacks its actual previous native registry evidence'); } }
      const verifiedPrevious = assertFidelityEnvironment(previousCapabilities, lock, Object.keys(previousEnvironment.widgets));
      if (canonicalV2(verifiedPrevious.widgets) !== canonicalV2(previousEnvironment.widgets)) throw Error('Previous native registry evidence does not match the accepted environment');
      const reconciled = assertReusableNativeSchemasV2(previousCapabilities.legacySchemas, capabilities.legacySchemas, input.program);
      if (reconciled.length) await writeJson(path.join(journal.runDir, 'target', `generated-default-reconciliation-${stage}.json`), { version: 2, passed: true, reconciled });
    }
    await writeJson(path.join(journal.runDir, 'target', `capabilities-${stage}.json`), capabilities); await writeJson(path.join(journal.runDir, 'target', 'accepted-capabilities.json'), capabilities); await writeJson(path.join(journal.runDir, 'target', 'environment.json'), compatibility); await saveJournalV2(journal);
    let reviewResumeSeal: ReviewResumeSealV2 | undefined;
    if (capabilities.checkpointProof?.version === 1 && /^[a-f\d]{64}$/.test(capabilities.checkpointProof.sha256) && canonicalV2(capabilities.checkpointProof.types) === canonicalV2([...used].sort())) {
      const capabilityPath = path.join(journal.runDir, 'target', `capabilities-${hashV2(canonicalV2(capabilities))}.json`); await writeJson(capabilityPath, capabilities);
      reviewResumeSeal = { version: 1, environmentHash, environmentLockHash: hashV2(await readFile(path.join(root, 'config/environment-lock.json'))), assetsManifestHash: input.assetsManifestHash, capabilitiesRef: { path: capabilityPath, sha256: hashV2(await readFile(capabilityPath)) }, checkpointProof: capabilities.checkpointProof };
    }
    const catalog: TargetCatalogEvidence | undefined = input.program.blocks.some(block => canonicalV2(block).includes('native-products')) ? await retryReadV2(() => client.readTargetCatalog(200)) : undefined;
    if (catalog) { const identity = hashV2(canonicalV2({ ...catalog, evidence: [] })); catalog.evidence = [path.join(journal.runDir, 'target', `catalog-${identity}.json`)]; await writeJson(catalog.evidence[0], catalog); }
    // Validate registered controls and all component relationships with symbolic local media before draft/media writes.
    preflightReplicaV2(input.program, capabilities.legacySchemas, catalog, stage);
    const sampleDefinition = buildCapabilitySampleV2(input.program, capabilities.legacySchemas, catalog, stage);
    const rechecked = await validateLocalInputV2(filename, root, stage); if (rechecked.programHash !== input.programHash || rechecked.componentPlanHash !== input.componentPlanHash) throw Error('Current component program changed during read-only preflight');
    await progress('owned-draft'); await writeJson(path.join(journal.runDir, 'draft-create-intent.json'), { version: 2, runId: journal.runId, requireExistingPageId: journal.pageId ?? null, title: input.program.title });
    const draft = await client.createDraft(journal.runId, input.program.title, journal.pageId ? { requireExistingPageId: journal.pageId } : undefined); journal.pageId = draft.pageId; journal.editUrl = draft.editUrl; await saveJournalV2(journal);
    let snapshot = await retryReadV2(() => client.snapshotDraft(draft.pageId)); assertResumeIdentityV2(journal, { taskId: input.program.taskId, sourceUrl: input.program.sourceUrl, targetUrl: loaded.config.targetUrl, sourceFactsHash: input.sourceFactsHash, assetsManifestHash: input.assetsManifestHash, desktopDependencyHash, environmentHash }, snapshot);
    const recoveryProofs: GeneratedHtmlProof[] = [];
    if (journal.mutations.some(intent => ['intent', 'write-unknown', 'restore-pending'].includes(intent.status))) try { const prior = await readJson<{ program: ProgramV2; stage: ReplicaStage }>(path.join(journal.runDir, 'target', 'accepted-program.json')), assets = await readJson<ImportedAssetV2[]>(path.join(journal.runDir, 'assets', 'imported.json')); const previous = validateProgramV2(prior.program); for (const component of walkComponentsV2(previous.blocks, prior.stage)) if (component.kind === 'html-static') recoveryProofs.push(renderStaticHTML(component, previous.taskId, replicaIdV2(previous.taskId, `${component.key}-content`), assets, prior.stage)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let recoveredEditor: Awaited<ReturnType<typeof reconcileLateProductEditorSaveV2>> | undefined;
    const pendingEditor = journal.mutations.filter(intent => ['intent', 'write-unknown', 'restore-pending'].includes(intent.status));
    if (stage === 'final' && pendingEditor.length === 1 && pendingEditor[0].kind === 'editor-test' && pendingEditor[0].checkpoint === 'native-product-query' && snapshot.hash === pendingEditor[0].expectedAfterHash) {
      if (!catalog) throw Error('Late product editor recovery requires current target catalog evidence');
      // Reconcile the original UI save before restoring its temporary query. No
      // editor is reopened and the immutable failed attempt remains evidence.
      const originBytes = await readFile(path.join(journal.runDir, 'verification', 'editor-v2', 'receipt.json'));
      const origin = JSON.parse(originBytes.toString('utf8')) as { reportPath?: string };
      if (!origin.reportPath) throw Error('Late editor save lacks its immutable originating attempt');
      const originPath = await realpath(origin.reportPath); inside(path.join(journal.runDir, 'verification', 'editor-v2', 'attempts'), originPath);
      if (hashV2(await readFile(originPath)) !== hashV2(originBytes)) throw Error('Late editor receipt alias differs from its immutable origin');
      const baseline = await readSnapshotRefV2(journal.runDir, path.join(journal.runDir, 'mutations', `${pendingEditor[0].id}-before.json`));
      const recoveryAssets = await readJson<ImportedAssetV2[]>(path.join(journal.runDir, 'assets', 'imported.json'));
      const recoveryCompiled = compileReplicaV2(input.program, capabilities.legacySchemas, recoveryAssets, catalog, 'final');
      const recoveryAccess = await client.getPreviewAccess(draft.pageId);
      if (new URL(recoveryAccess.previewUrl).origin !== new URL(loaded.config.targetUrl).origin) throw Error('Recovery preview escaped the configured target');
      const recoveryCookies = await previewCookies(recoveryAccess.adminAccessUrl, loaded.config.targetUrl);
      await progress('editor-save-response-reconciliation');
      try {
        recoveredEditor = await reconcileLateProductEditorSaveV2({ originReceipt: { path: originPath, sha256: hashV2(originBytes) }, programRef: { path: path.resolve(root, filename), sha256: input.programHash }, program: input.program, compiled: recoveryCompiled, schemas: capabilities.legacySchemas, assets: recoveryAssets, catalog, baseline, actual: snapshot, client, journal, cookies: recoveryCookies, previewUrl: recoveryAccess.previewUrl, runDir: journal.runDir });
      } catch (error) {
        const additional = (error as { evidence?: { additionalMetrics?: Record<string, number> } }).evidence?.additionalMetrics;
        for (const [key, value] of Object.entries(additional ?? {})) if (Number.isFinite(value) && value >= 0) journal.metrics[key] = (journal.metrics[key] ?? 0) + value;
        await saveJournalV2(journal); throw error;
      }
      snapshot = recoveredEditor.snapshot;
      for (const [key, value] of Object.entries(recoveredEditor.additionalMetrics)) journal.metrics[key] = (journal.metrics[key] ?? 0) + value;
      await saveJournalV2(journal);
    }
    snapshot = await resumeMutationsV2(journal, client, snapshot, recoveryProofs);
    if (!journal.documentHash && snapshot.elements.length) throw Error('New owned draft unexpectedly contains content'); journal.documentHash = snapshot.hash; await saveJournalV2(journal);
    const shell = await client.configureCanvasShell(draft.pageId, true); await writeJson(path.join(journal.runDir, 'target', 'canvas-shell.json'), shell);
    const access = await client.getPreviewAccess(draft.pageId); for (const url of [access.editUrl, access.previewUrl]) if (new URL(url).origin !== new URL(loaded.config.targetUrl).origin) throw Error('Owned draft links must stay on the configured target'); journal.editUrl = access.editUrl; journal.previewUrl = access.previewUrl; await saveJournalV2(journal);
    const cookies = await previewCookies(access.adminAccessUrl, loaded.config.targetUrl);
    if (sampleDefinition.sampleProgram.blocks.length) {
      const dependencyHash = hashV2(canonicalV2({ environmentHash, blocks: sampleDefinition.sampleProgram.blocks, selected: sampleDefinition.products?.productIds }));
      if (journal.capabilityProbe?.status !== 'passed' || journal.capabilityProbe.dependencyHash !== dependencyHash) {
        await progress('mixed-native-capability-sample');
        const baselinePath = path.join(journal.runDir, 'target', 'capability-mixed-baseline.json');
        let baseline = snapshot;
        if (journal.capabilityProbe && ['running', 'interrupted'].includes(journal.capabilityProbe.status)) {
          baseline = await readSnapshotRefV2(journal.runDir, journal.capabilityProbe.kind === 'mixed' ? baselinePath : path.join(journal.runDir, 'target', 'capability-product-baseline.json')); if (baseline.hash !== journal.capabilityProbe.baselineHash || documentHashV2(baseline.elements, baseline.settings) !== baseline.hash) throw Error('Capability recovery baseline changed');
          if (snapshot.hash !== baseline.hash) { const intent = [...journal.mutations].reverse().find(item => ['product-capability-probe', 'mixed-capability-probe'].includes(item.checkpoint) && item.status === 'confirmed'); if (snapshot.hash !== journal.capabilityProbe.probeHash && snapshot.hash !== intent?.expectedAfterHash) throw Error('Capability sample changed concurrently; recovery refused'); snapshot = await restoreSnapshotV2(client, baseline, snapshot, journal, 'mixed-capability-recovery', [input.program.blocks[0].key], recoveryProofs); }
        }
        await writeSnapshotRefV2(journal.runDir, baselinePath, baseline); journal.capabilityProbe = { kind: 'mixed', status: 'running', dependencyHash, baselineHash: baseline.hash }; await saveJournalV2(journal);
        const sample = compileReplicaV2(sampleDefinition.sampleProgram, capabilities.legacySchemas, [], catalog, stage);
        // Exact prior compiler artifacts authenticate retained HTML in other owned roots.
        try { const prior = await readJson<{ program: ProgramV2; stage: ReplicaStage }>(path.join(journal.runDir, 'target', 'accepted-program.json')), imported = await readJson<ImportedAssetV2[]>(path.join(journal.runDir, 'assets', 'imported.json')), ids = new Set(sample.htmlProofs.map(proof => proof.elementId)); for (const component of walkComponentsV2(prior.program.blocks, prior.stage)) if (component.kind === 'html-static') { const proof = renderStaticHTML(component, prior.program.taskId, replicaIdV2(prior.program.taskId, `${component.key}-content`), imported, prior.stage); if (!ids.has(proof.elementId)) sample.htmlProofs.push(proof); } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (shell.enabled && shell.css) sample.composition.pageSettings = { ...sample.composition.pageSettings, custom_css: shell.css };
        let probeError: unknown;
        try { snapshot = await saveOwnedBatchV2({ client, snapshot, compiled: sample, schemas: capabilities.legacySchemas, journal, checkpoint: 'mixed-capability-probe' }); journal.capabilityProbe.probeHash = snapshot.hash; await saveJournalV2(journal); const checked = await verifyProductCapabilityProbeV2({ compiled: sample, sample: sampleDefinition, catalog, previewUrl: access.previewUrl, cookies, runDir: journal.runDir, documentHash: snapshot.hash }); journal.capabilityProbe.evidence = checked.evidence; if (!checked.passed) throw Error(checked.error ?? 'Required HTML/carousel/product capability was not proved'); }
        catch (error) { probeError = error; journal.capabilityProbe.error = redact(error); }
        finally {
          const actual = await retryReadV2(() => client.snapshotDraft(snapshot.pageId));
          const intent = [...journal.mutations].reverse().find(item => item.checkpoint === 'mixed-capability-probe');
          if (actual.hash !== baseline.hash && actual.hash !== snapshot.hash && actual.hash !== intent?.expectedAfterHash) { journal.capabilityProbe.status = 'interrupted'; journal.status = 'restore-pending'; await saveJournalV2(journal); throw Error('Native capability sample has concurrent changes; restoration refused'); }
          snapshot = await restoreSnapshotV2(client, baseline, actual, journal, 'mixed-capability-restore', [input.program.blocks[0].key]); journal.documentHash = snapshot.hash; journal.capabilityProbe.status = probeError ? 'failed' : 'passed'; if (!journal.mutations.some(intent => ['intent', 'write-unknown', 'restore-pending', 'conflict'].includes(intent.status))) journal.status = 'running'; await saveJournalV2(journal);
        }
        if (probeError) throw probeError;
      }
    }
    let assets: ImportedAssetV2[] = [], compiled: CompiledReplicaV2;
    const ensureBuilt = async (projection: ProgramV2, checkpoint: string) => {
      assets = await importStageMedia(input, projection, stage, journal!, client, capabilities.legacySchemas, progress); compiled = compileReplicaV2(projection, capabilities.legacySchemas, assets, catalog, stage);
      // A partial first-fold rebuild must still authenticate unchanged HTML in retained owned roots.
      try { const previous = await readJson<{ program: ProgramV2; stage: ReplicaStage }>(path.join(journal!.runDir, 'target', 'accepted-program.json')); if (projection.blocks.length < input.program.blocks.length) { const old = compileReplicaV2(previous.program, capabilities.legacySchemas, assets, catalog, previous.stage); const ids = new Set(compiled.htmlProofs.map(proof => proof.elementId)); compiled.htmlProofs.push(...old.htmlProofs.filter(proof => !ids.has(proof.elementId))); } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (shell.enabled && shell.css) compiled.composition.pageSettings = { ...compiled.composition.pageSettings, custom_css: shell.css };
      await writeJson(path.join(journal!.runDir, `${checkpoint}-plan.json`), { ...compiled, htmlProofs: compiled.htmlProofs.map(proof => ({ componentKey: proof.componentKey, elementId: proof.elementId, sha256: proof.sha256, bindings: proof.bindings })) });
      const before = snapshot.hash; snapshot = await saveOwnedBatchV2({ client, snapshot, compiled, schemas: capabilities.legacySchemas, journal: journal!, checkpoint });
      if (snapshot.hash !== before) for (const later of stage === 'desktop' ? ['responsive', 'final'] as const : stage === 'responsive' ? ['final'] as const : []) if (journal!.stages[later].status === 'passed') journal!.stages[later].status = 'stale';
      await writeJson(path.join(journal!.runDir, 'target', 'accepted-program.json'), { program: projection, stage }); journal!.ownedBlockKeys = input.program.blocks.map(block => block.key); journal!.ownedRootIds = input.program.blocks.map(block => replicaIdV2(input.program.taskId, block.key)); await saveJournalV2(journal!);
    };
    const inspect = async (projection: ProgramV2, checkpoint: VisualCheckpointV2) => {
      let prior = await loadValidReviewV2(journal!.runDir, checkpoint, snapshot.hash); if (prior?.verdict === 'passed') { const reviewed = await readJson<CaptureReceiptV2>(path.join(journal!.runDir, 'verification', checkpoint, 'capture.json')); if (reviewed.programHash === input.programHash && reviewed.componentPlanHash === input.componentPlanHash && reviewed.sourceFactsHash === input.sourceFactsHash && await hasVerifiedViewportCoverageV2(reviewed, projection, checkpoint, journal!.runDir)) { await bindStageCaptureV2(journal!, stage, reviewed, snapshot.hash); return true; } prior = undefined; }
      let capture: CaptureReceiptV2 | undefined; try { const existing = await readJson<CaptureReceiptV2>(path.join(journal!.runDir, 'verification', checkpoint, 'capture.json')); if (existing.automatedPassed && existing.documentHash === snapshot.hash && existing.programHash === input.programHash && existing.componentPlanHash === input.componentPlanHash && existing.sourceFactsHash === input.sourceFactsHash && await hasVerifiedViewportCoverageV2(existing, projection, checkpoint, journal!.runDir) && !prior) capture = existing; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (!capture) { journal!.metrics.captures++; capture = await captureReplicaV2({ program: projection, compiled, assets, catalog, responsiveEnvironment: capabilities.sourceProof?.responsiveDevices as any, sourceFacts: input.sourceFacts, componentPlan: input.componentPlan, checkpoint, runDir: journal!.runDir, previewUrl: access.previewUrl, pageId: snapshot.pageId, cookies, documentHash: snapshot.hash, programHash: input.programHash, sourceFactsHash: input.sourceFactsHash, componentPlanHash: input.componentPlanHash, reviewResume: reviewResumeSeal, firstFoldKeys: firstFoldProgram(input).blocks.map(block => block.key), onProgress: progress }); journal!.metrics.browserRequests = (journal!.metrics.browserRequests ?? 0) + (capture.browserRequests ?? 0); }
      await bindStageCaptureV2(journal!, stage, capture, snapshot.hash);
      if (!capture.automatedPassed) { journal!.stages[stage].status = 'failed'; journal!.status = 'failed'; journal!.error = `Required ${checkpoint} checks failed; later stages did not start`; } else journal!.status = 'awaiting-review'; await saveJournalV2(journal!); return false;
    };
    if (stage === 'desktop') {
      const firstFold = firstFoldProgram(input), reuse = await loadReusableFirstFoldV2(journal.runDir, input, { journal, snapshot, schemas: capabilities.legacySchemas, catalog, pageSettings: shell.enabled && shell.css ? { custom_css: shell.css } : {} }); journal.stages.desktop.firstFoldReuse = undefined;
      if (reuse) { for (const ref of [reuse.captureRef, reuse.reviewRef]) { const bytes = await readFile(ref.path); if (hashV2(bytes) !== ref.sha256) throw Error('Reviewed first-fold evidence changed before reuse'); const filename = path.join(journal.runDir, 'verification', 'desktop-firstfold', 'reused-evidence', `${ref.sha256}.json`); await mkdir(path.dirname(filename), { recursive: true }); try { await writeFile(filename, bytes, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || hashV2(await readFile(filename)) !== ref.sha256) throw error; } ref.path = filename; } const filename = path.join(journal.runDir, 'verification', 'desktop-firstfold', `reuse-${reuse.firstFoldInputHash}-${input.programHash}.json`); await writeJson(filename, reuse); journal.stages.desktop.firstFoldReuse = { path: filename, sha256: hashV2(await readFile(filename)), inputHash: reuse.firstFoldInputHash, sourceDocumentHash: reuse.sourceDocumentHash }; await saveJournalV2(journal); }
      else { await ensureBuilt(firstFold, 'desktop-firstfold'); if (!await inspect(firstFold, 'desktop-firstfold')) return await finish(); }
      await ensureBuilt(input.program, 'desktop'); if (!await inspect(input.program, 'desktop')) return await finish();
    } else {
      await ensureBuilt(input.program, stage);
      if (stage === 'responsive') { if (!await inspect(input.program, 'responsive')) return await finish(); }
      else {
        const desktopCapture = await readJson<CaptureReceiptV2>(path.join(journal.runDir, 'verification', 'desktop', 'capture.json')), desktopReview = await loadValidReviewV2(journal.runDir, 'desktop', desktopCapture.documentHash), responsiveCapture = await readJson<CaptureReceiptV2>(path.join(journal.runDir, 'verification', 'responsive', 'capture.json')), responsiveReview = await loadValidReviewV2(journal.runDir, 'responsive', snapshot.hash);
        if (desktopReview?.verdict !== 'passed' || journal.stages.desktop.dependencyHash !== desktopDependencyHash || !responsiveReview || responsiveReview.verdict !== 'passed' || responsiveCapture.programHash !== input.programHash || responsiveCapture.componentPlanHash !== input.componentPlanHash || responsiveCapture.sourceFactsHash !== input.sourceFactsHash || !await hasVerifiedViewportCoverageV2(responsiveCapture, input.program, 'responsive', journal.runDir)) throw Error('Final editing requires the exact reviewed desktop dependency and same-document regression at every frozen desktop and responsive viewport');
        if (!recoveredEditor) { journal.metrics.editorSessions++; await saveJournalV2(journal); }
        const edited = recoveredEditor?.aggregate ?? await verifyReplicaEditorV2({ program: input.program, compiled: compiled!, schemas: capabilities.legacySchemas, assets, client, snapshot, cookies, editUrl: access.editUrl, previewUrl: access.previewUrl, runDir: journal.runDir, journal, onProgress: progress });
        if (!recoveredEditor) { journal.metrics.editorLoads = (journal.metrics.editorLoads ?? 0) + edited.editorLoads; journal.metrics.browserRequests = (journal.metrics.browserRequests ?? 0) + edited.browserRequests; }
        journal.stages.final.evidence = [edited.reportPath ?? path.join(journal.runDir, 'verification', 'editor-v2', 'receipt.json')]; if (!edited.passed) { if (edited.restorePending) journal.status = 'restore-pending'; throw Error(edited.error ?? 'Actual native editing checks remain unverified'); }
        snapshot = await retryReadV2(() => client.snapshotDraft(snapshot.pageId)); if (snapshot.hash !== edited.finalHash) throw Error('Document changed after final editor restoration');
        const editable = await retryReadV2(() => client.verifyEditable(snapshot.pageId, compiled!.htmlProofs)); if (!editable.editable || editable.status !== 'draft') throw Error('Final restored draft is not editable in Elementor'); await writeJson(path.join(journal.runDir, 'verification', 'editor-v2', 'native-document-editable.json'), editable);
      }
    }
    journal.stages[stage].status = 'passed'; journal.stages[stage].finishedAt = new Date().toISOString(); journal.stages[stage].durationMs = Math.round(performance.now() - started); journal.stages[stage].documentHash = snapshot.hash; journal.documentHash = snapshot.hash; journal.status = 'stage-passed';
    await writeSnapshotRefV2(journal.runDir, path.join(journal.runDir, 'target', 'accepted-snapshot.json'), snapshot); await writeJson(path.join(journal.runDir, 'elementor-template.json'), { version: '0.4', title: input.program.title, type: 'page', content: snapshot.elements, page_settings: snapshot.settings });
    if (stage === 'final') { assertCompletableV2(journal); journal.status = 'completed'; journal.completed = true; }
    return await finish();
  } catch (error) {
    if (!journal) throw error; journal.error = redact(error); if (!['write-unknown', 'restore-pending'].includes(journal.status)) journal.status = 'failed'; if (journal.stages[stage]?.status === 'running') journal.stages[stage].status = journal.status === 'restore-pending' || journal.status === 'write-unknown' ? 'interrupted' : 'failed'; journal.stages[stage].error = journal.error; journal.stages[stage].finishedAt = new Date().toISOString(); journal.completed = false; await options.onProgress?.(`v2-${journal.status}: ${journal.error}`); return await finish();
  } finally { await client.close().catch(() => undefined); await release(); }
}
