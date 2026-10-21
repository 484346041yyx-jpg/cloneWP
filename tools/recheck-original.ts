/** Guarded diagnostics for an explicitly identified owned original run.
 * Reuses its media and draft; never creates an unrelated page or imports assets. */
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { loadConfig, readJson, redactor } from '../src/core/config.js';
import { acquireLock, writeJson } from '../src/core/files.js';
import { assertCreationTaskMode } from '../src/core/creation-mode.js';
import { assertDraftHash, previewCookies } from '../src/core/runner.js';
import { loadOriginalDesign } from '../src/original/validate.js';
import { compileOriginal, preflightOriginal, type OriginalImportedAsset } from '../src/original/compile.js';
import { checkOriginalDraft } from '../src/original/acceptance.js';
import type { OriginalRunResult } from '../src/original/runner.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { assertFidelityEnvironment } from '../src/fidelity/runner.js';
import { compileEditorElements } from '../src/wordpress/editor-serialization.js';
import { retainRegisteredInactiveDefaults } from '../src/fidelity/revision.js';
import sharp from 'sharp';

const root = await realpath(process.cwd());
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const inside = (filename: string) => { const relative = path.relative(root, filename); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Original diagnostic paths must remain inside the project'); return filename; };
try {
  if (process.argv.length !== 3) throw Error('Usage: tsx tools/recheck-original.ts <OWNED_RUN_DIR>');
  const runDir = inside(await realpath(path.resolve(root, process.argv[2])));
  if (path.dirname(runDir).toLowerCase() !== path.join(root, 'runs').toLowerCase()) throw Error('Only an existing project run may be rechecked');
  const prior = await readJson<OriginalRunResult>(path.join(runDir, 'result.json'));
  if (prior.mode !== 'original' || prior.workflow !== 'original-elementor' || prior.runId !== path.basename(runDir) || !prior.pageId || !prior.finalHash || !prior.restored || !prior.inputDesignPath || !prior.inputDesignSha256) throw Error('Original recheck requires complete ownership, input and restored snapshot receipts');
  await assertCreationTaskMode(root, prior.inputDesignPath, 'original');
  const design = await loadOriginalDesign(root, prior.inputDesignPath);
  const inputHash = digest(JSON.stringify(design));
  if (inputHash !== prior.inputDesignSha256) throw Error('Authored design changed; it requires a separate explicit task');
  const assets = await readJson<OriginalImportedAsset[]>(path.join(runDir, 'assets/imported.json'));
  if (assets.length !== design.assets.length) throw Error('Original asset receipt count changed');
  for (const asset of design.assets) {
    const imported = assets.filter(item => item.key === asset.key);
    const bytes = await readFile(asset.path);
    if (imported.length !== 1 || imported[0].sha256 !== digest(bytes)) throw Error('Original asset bytes/receipt identity changed');
    const metadata = await sharp(bytes).metadata(), mimeType = metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'png' ? 'image/png' : metadata.format === 'webp' ? 'image/webp' : undefined;
    if (!mimeType || imported[0].mimeType !== mimeType) throw Error('Original asset MIME proof changed');
    imported[0].sourceUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;
  }
  const lock = await readJson<{ mode: string; versions: Record<string, string>; responsiveDevices?: unknown }>(path.join(root, 'config/environment-lock.json'));
  const { config, credentials } = await loadConfig(root), release = await acquireLock(root);
  const client = new WordPressClient({targetUrl: config.targetUrl, username: credentials.wp_user, applicationPassword: credentials.wp_app_password});
  const revisionDir = path.join(runDir, 'revisions', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  try {
    if (prior.targetUrl !== config.targetUrl) throw Error('Owned original run belongs to a different configured target');
    const flatten = (nodes: typeof design.sections): typeof design.sections => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
    const kinds = {container: 'container', heading: 'heading', text: 'text-editor', image: 'image', button: 'button', accordion: 'accordion', products: 'wd_products', carousel: 'nested-carousel'};
    const usedTypes = [...new Set(flatten(design.sections).map(node => kinds[node.kind]))];
    const capabilities = await client.discoverCapabilities(usedTypes);
    await writeJson(path.join(revisionDir, 'target/capabilities.json'), capabilities);
    assertFidelityEnvironment(capabilities, lock, usedTypes);
    if (usedTypes.includes('wd_products')) await writeJson(path.join(revisionDir, 'target/product-query-source.json'), await client.readNativeProductQuerySourceProof());
    const catalog = usedTypes.includes('wd_products') ? await client.readTargetCatalog(200) : undefined;
    if (catalog) { catalog.evidence = [path.join(revisionDir, 'target/catalog.json')]; await writeJson(catalog.evidence[0], catalog); }
    const compileOptions = {targetOrigin: client.origin, catalog};
    await writeJson(path.join(revisionDir, 'native-preflight.json'), preflightOriginal(design, capabilities.legacySchemas, compileOptions));
    const compiled = compileOriginal(design, capabilities.legacySchemas, assets, compileOptions);
    if (digest(JSON.stringify(await loadOriginalDesign(root, prior.inputDesignPath))) !== inputHash) throw Error('Concurrent authored input changed before the recheck');
    await client.createDraft(prior.runId, design.title, {requireExistingPageId: prior.pageId});
    const baseline = await client.snapshotDraft(prior.pageId); assertDraftHash(baseline.hash, prior.finalHash);
    // Canvas isolation is per-client state; rediscover it on every guarded reuse.
    await writeJson(path.join(revisionDir, 'target/canvas-shell-proof.json'), await client.configureCanvasShell(prior.pageId, true));
    await client.verifyImportedAssets(prior.pageId, assets);
    await writeJson(path.join(revisionDir, 'target/baseline.json'), baseline);
    const serialized = compileEditorElements(compiled.composition.elements, capabilities.legacySchemas);
    const retained = retainRegisteredInactiveDefaults({authored: compiled.composition.elements, serialized, baseline: baseline.elements, schemas: capabilities.legacySchemas});
    console.error('[cloneWP original recheck] guarded-native-save');
    const saved = await client.buildDraft(prior.pageId, {...compiled.composition, elements: retained.elements}, assets, {expectedCurrent: baseline});
    await writeJson(path.join(revisionDir, 'target/saved-snapshot.json'), saved);
    await writeJson(path.join(revisionDir, 'native-plan.json'), compiled);
    const access = await client.getPreviewAccess(prior.pageId), cookies = await previewCookies(access.adminAccessUrl, config.targetUrl);
    const checked = await checkOriginalDraft({design, client, snapshot: saved, schemas: capabilities.legacySchemas, assets, elementMap: compiled.elementMap, editUrl: access.editUrl, previewUrl: access.previewUrl, cookies, runDir: revisionDir, nativeComponents: compiled.nativeComponents, catalog, onProgress: message => console.error(`[cloneWP original recheck] ${message}`)});
    const status = checked.passed ? 'completed' : 'needs-review';
    await writeJson(path.join(revisionDir, 'target/final-snapshot.json'), checked.snapshot);
    await writeJson(path.join(revisionDir, 'elementor-document.json'), {elements: checked.snapshot.elements, pageSettings: checked.snapshot.settings});
    await writeJson(path.join(revisionDir, 'elementor-template.json'), {version: '0.4', title: design.title, type: 'page', content: checked.snapshot.elements, page_settings: checked.snapshot.settings});
    const result = {...prior, status, stage: 'finished', finishedAt: new Date().toISOString(), finalHash: checked.snapshot.hash, restored: true, verificationPath: checked.verificationPath, revisionDir, limitations: [...capabilities.limitations, ...(checked.passed ? [] : ['The saved original verification contains unresolved actual frontend/editor checks'])]};
    await writeJson(path.join(revisionDir, 'result.json'), result);
    await writeJson(path.join(runDir, 'result.json'), result);
    await writeJson(path.join(path.dirname(prior.inputDesignPath), 'build-result.json'), result);
    console.log(JSON.stringify({mode: 'original', status, pageId: prior.pageId, editUrl: access.editUrl, previewUrl: access.previewUrl, verificationPath: checked.verificationPath}, null, 2));
    process.exitCode = checked.passed ? 0 : 3;
  } finally {await client.close(); await release();}
} catch (error) {console.error(redactor()(error)); process.exitCode = 1;}
