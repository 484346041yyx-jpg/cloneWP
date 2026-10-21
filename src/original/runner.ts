import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { loadConfig, readJson, redactor } from '../core/config.js';
import { acquireLock, writeJson } from '../core/files.js';
import { assertDraftHash, previewCookies } from '../core/runner.js';
import { WordPressClient, type DraftSnapshot } from '../wordpress/client.js';
import { compileOriginal, type OriginalImportedAsset } from './compile.js';
import { loadOriginalDesign } from './validate.js';
import { writeOriginalPrototype } from './prototype.js';
import { checkOriginalDraft } from './acceptance.js';
import { assertReferenceDesignApproved } from '../reference/audit.js';
import { assertCreationTaskMode } from '../core/creation-mode.js';
import { preflightOriginal } from './compile.js';
import { assertFidelityEnvironment } from '../fidelity/runner.js';

export interface OriginalRunResult {
  version: 1; workflow: 'original-elementor'; runId: string; brand: string; targetUrl: string;
  mode?: 'original';
  inputDesignSha256?: string; inputDesignPath?: string;
  status: 'running' | 'completed' | 'needs-review' | 'failed'; stage: string; runDir: string;
  startedAt: string; finishedAt?: string; pageId?: number; editUrl?: string; previewUrl?: string;
  sectionsBuilt: number; limitations: string[]; verificationPath?: string; finalHash?: string;
  restored?: boolean; error?: string;
}
export async function runOriginal(filename: string, options: { root?: string; onProgress?: (message: string) => void } = {}): Promise<OriginalRunResult> {
  const projectRoot = path.resolve(options.root ?? process.cwd());
  // Authored inputs are validated before loading credentials or contacting WordPress.
  const task = await assertCreationTaskMode(projectRoot, filename, 'original');
  const design = await loadOriginalDesign(projectRoot, filename);
  const referenceAudit = task.legacyReferenceOriginal ? await assertReferenceDesignApproved(projectRoot, filename, design) : undefined;
  // Freeze actual input bytes before target authentication; check them again before every write.
  const assetHashes = new Map<string, string>();
  for (const asset of design.assets) assetHashes.set(asset.key, createHash('sha256').update(await readFile(asset.path)).digest('hex'));
  const designHash = createHash('sha256').update(JSON.stringify(design)).digest('hex');
  const assertInputs = async () => {
    const current = await loadOriginalDesign(projectRoot, filename);
    if (createHash('sha256').update(JSON.stringify(current)).digest('hex') !== designHash) throw new Error('Original design changed after input validation; concurrent authored edits are preserved');
    for (const asset of design.assets) if (createHash('sha256').update(await readFile(asset.path)).digest('hex') !== assetHashes.get(asset.key)) throw new Error(`Original image bytes changed after input validation: ${asset.key}`);
  };
  const { root, config, credentials } = await loadConfig(projectRoot);
  const redact = redactor(credentials), release = await acquireLock(root);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-original-${design.brand.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30)}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(root, 'runs', runId);
  const result: OriginalRunResult = { version: 1, workflow: 'original-elementor', mode: 'original', inputDesignPath: path.resolve(projectRoot, filename), inputDesignSha256: designHash, runId, brand: design.brand, targetUrl: config.targetUrl, status: 'running', stage: 'design', runDir, startedAt: new Date().toISOString(), sectionsBuilt: 0, limitations: [] };
  const persist = async () => { await writeJson(path.join(runDir, 'result.json'), result); if (design.workflow === 'original-design') await writeJson(path.join(path.dirname(result.inputDesignPath!), 'build-result.json'), result); };
  const update = async (message: string) => { result.stage = message; await persist(); options.onProgress?.(message); };
  const client = new WordPressClient({ targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password, networkRoute:config.wordpressNetworkRoute });
  let initial: DraftSnapshot | undefined, accepted: DraftSnapshot | undefined, recoveryExpected: DraftSnapshot | undefined;
  let editorStarted = false;
  try {
    await mkdir(runDir, { recursive: true });
    await writeJson(path.join(runDir, 'original-design.json'), design);
    await writeOriginalPrototype(design, path.join(runDir, 'prototype'));
    await update('preflight');
    const preflight = await client.preflight();
    await writeJson(path.join(runDir, 'target/preflight.json'), preflight);
    if (preflight.blockers.length) throw new Error(preflight.blockers.join(' '));
    const usedTypes = [...new Set((function flatten(nodes: typeof design.sections): string[] { return nodes.flatMap(node => [node.kind === 'text' ? 'text-editor' : node.kind === 'products' ? 'wd_products' : node.kind === 'carousel' ? 'nested-carousel' : node.kind, ...flatten(node.children ?? [])]); })(design.sections))];
    const capabilities = await client.discoverCapabilities(usedTypes);
    await writeJson(path.join(runDir, 'target/capabilities.json'), capabilities);
    if (capabilities.mode !== 'legacy-verified') throw new Error('This original compiler requires the actually verified native legacy Elementor controls');
    const lock = await readJson<{ mode: string; versions: Record<string, string>; responsiveDevices?: unknown }>(path.join(root, 'config/environment-lock.json'));
    const environment = assertFidelityEnvironment(capabilities, lock, usedTypes);
    await writeJson(path.join(runDir, 'target/native-source-proof.json'), environment);
    result.limitations.push(...capabilities.limitations);
    const hasProducts = (nodes: typeof design.sections): boolean => nodes.some(node => node.kind === 'products' || hasProducts(node.children ?? []));
    if (hasProducts(design.sections)) await writeJson(path.join(runDir, 'target/product-query-source.json'), await client.readNativeProductQuerySourceProof());
    const catalog = hasProducts(design.sections) ? await client.readTargetCatalog(200) : undefined;
    if (catalog) { catalog.evidence = [path.join(runDir, 'target/catalog.json')]; await writeJson(catalog.evidence[0], catalog); }
    const compileOptions = { targetOrigin: new URL(config.targetUrl).origin, ...(catalog ? { catalog } : {}) };
    // Registered control/type/media structure checks precede createDraft and importAsset.
    // This plan contains no invented attachment receipt and is never submitted to WordPress.
    const plan = preflightOriginal(design, capabilities.legacySchemas, compileOptions);
    await writeJson(path.join(runDir, 'native-preflight.json'), plan);
    await assertInputs();
    preflightOriginal(design, capabilities.legacySchemas, compileOptions);
    await update('create-owned-draft');
    const draft = await client.createDraft(runId, design.title);
    result.pageId = draft.pageId; result.editUrl = draft.editUrl;
    initial = await client.snapshotDraft(draft.pageId); accepted = initial;
    await writeJson(path.join(runDir, 'target/initial-snapshot.json'), initial);
    await update('import-original-images');
    const assets: OriginalImportedAsset[] = [];
    for (const asset of design.assets) {
      await assertInputs();
      const bytes = await readFile(asset.path), sha256 = createHash('sha256').update(bytes).digest('hex');
      if (referenceAudit && !referenceAudit.approvedAssets.some(record => record.key === asset.key && record.sha256 === sha256)) throw new Error(`Approved original image bytes changed before import: ${asset.key}`);
      const metadata = await sharp(bytes).metadata();
      const mimeType = metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'webp' ? 'image/webp' : metadata.format === 'png' ? 'image/png' : '';
      if (!mimeType) throw new Error(`Invalid original image bytes: ${asset.key}`);
      const imported = await client.importAsset(asset.path, { runId, pageId: draft.pageId, sourceUrl: `data:${mimeType};base64,${bytes.toString('base64')}`, mimeType, alt: asset.alt, originalSha256: sha256, verifiedSha256: sha256 });
      assets.push({ ...imported, key: asset.key });
    }
    await client.verifyImportedAssets(draft.pageId, assets);
    await writeJson(path.join(runDir, 'assets/imported.json'), assets.map(({ sourceUrl, ...asset }) => ({ ...asset, source: 'original-local-generated-image', sourceReference: `sha256:${asset.sha256}`, provenance: design.assets.find(record => record.key === asset.key)?.provenance })));
    await assertInputs();
    const compiled = compileOriginal(design, capabilities.legacySchemas, assets, compileOptions);
    const shell = await client.configureCanvasShell(draft.pageId, true);
    await writeJson(path.join(runDir, 'target/canvas-shell-proof.json'), { ...shell, reason: 'Original Canvas homepage has no Woodmart global mobile toolbar or padding' });
    await writeJson(path.join(runDir, 'native-plan.json'), compiled);
    // Incremental native construction: each step is saved and read back before adding the next section.
    for (let index = 0; index < compiled.sections.length; index++) {
      await assertInputs();
      await update(`native-section-${index + 1}-${compiled.sections[index].key}`);
      assertDraftHash((await client.snapshotDraft(draft.pageId)).hash, accepted!.hash);
      accepted = await client.buildDraft(draft.pageId, { ...compiled.composition, elements: compiled.composition.elements.slice(0, index + 1) }, assets, { expectedCurrent: accepted! });
      recoveryExpected = accepted; result.sectionsBuilt = index + 1;
      if (accepted.elements.length !== index + 1) throw new Error('Saved native section count does not match the authored incremental build');
      await writeJson(path.join(runDir, `target/section-${index + 1}.json`), accepted);
    }
    const access = await client.getPreviewAccess(draft.pageId);
    result.previewUrl = access.previewUrl;
    const cookies = await previewCookies(access.adminAccessUrl, config.targetUrl);
    const checked = await checkOriginalDraft({
      design, client, snapshot: accepted!, schemas: capabilities.legacySchemas, assets,
      elementMap: compiled.elementMap, editUrl: access.editUrl, previewUrl: access.previewUrl,
      cookies, runDir,
      nativeComponents: compiled.nativeComponents, catalog,
      onProgress: async message => { if (message === 'native-editor-save-and-restore' || message === 'native-components-editor-save-and-restore') editorStarted = true; await update(message); },
      onSnapshot: snapshot => { accepted = snapshot; recoveryExpected = snapshot; },
    });
    const readback = checked.snapshot;
    await writeJson(path.join(runDir, 'target/final-snapshot.json'), readback);
    await writeJson(path.join(runDir, 'elementor-document.json'), { elements: readback.elements, pageSettings: readback.settings });
    await writeJson(path.join(runDir, 'elementor-template.json'), { version: '0.4', title: design.title, type: 'page', content: readback.elements, page_settings: readback.settings });
    result.restored = true; result.finalHash = readback.hash;
    const passed = checked.passed;
    result.status = passed ? 'completed' : 'needs-review';
    result.verificationPath = checked.verificationPath;
    if (!passed) result.limitations.push('The saved verification report contains unresolved browser or native editor checks');
    result.stage = 'finished'; result.finishedAt = new Date().toISOString();
    await persist();
    if (referenceAudit) await writeJson(path.join(path.dirname(referenceAudit.designPath), 'build-result.json'), { ...result, referenceDesignSha256: referenceAudit.designSha256, originalityAuditPath: path.join(path.dirname(referenceAudit.designPath), 'originality-audit.json') });
    options.onProgress?.(`${result.status}: original native homepage ${draft.pageId}`);
    return result;
  } catch (error) {
    result.status = 'failed'; result.error = redact(error); result.finishedAt = new Date().toISOString(); result.restored = false;
    if (result.pageId && initial && accepted) {
      try {
        const current = await client.snapshotDraft(result.pageId);
        if (![accepted.hash, recoveryExpected?.hash].includes(current.hash)) throw new Error('Owned draft differs from the last accepted save; concurrent edits are preserved');
        // Keep a complete owned homepage on a verification failure, otherwise restore its initial empty draft.
        const baseline = result.sectionsBuilt === design.sections.length ? accepted : initial;
        result.restored = (await client.restoreDraft(result.pageId, baseline, { expectedCurrent: current })).hash === baseline.hash;
      } catch (restoreError) { result.limitations.push(`Guarded recovery: ${redact(restoreError)}`); }
    }
    if (editorStarted && result.restored !== true) result.limitations.push('Native editor temporary changes lack exact restoration proof');
    await persist();
    options.onProgress?.(`failed: ${result.error}`);
    return result;
  } finally { await client.close().catch(() => undefined); await release(); }
}
