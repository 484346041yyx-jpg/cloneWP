import path from 'node:path';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { loadConfig, readJson, redactor } from '../core/config.js';
import { assertFinalDeliveryPolicyIdentity, finalDeliveryNextAction, resolveFinalDeliveryPolicy } from '../core/delivery-policy.js';
import { acquireLock, writeJson } from '../core/files.js';
import { WordPressClient } from '../wordpress/client.js';
import { validateSourceFactsV2 } from '../replica-v2/source.js';
import { canonicalV2, ensureDiskSpaceV2, hashV2, retryReadV2, writeSnapshotRefV2 } from '../replica-v2/journal.js';
import { archiveRawInputV2 } from '../replica-v2/runtime.js';
import { NATIVE44_ALL_TYPES } from './catalog.js';
import { bindNative44CanvasShell, compileNative44, preflightNative44, referencedNative44Assets } from './compiler.js';
import { walkNative44 } from './types.js';
import { validateNative44Program } from './validate.js';
import { assertNative44EnvironmentLock, type Native44EnvironmentCheck } from './environment.js';
import { assertNative44Resume, saveNative44Body, saveNative44Journal, type Native44Journal } from './lifecycle.js';
import { emitNative44DeliverySummary } from './delivery-summary.js';
import { defaultEditorCompletionPolicy } from '../editor-completion/contract.js';
import { importNative44Media } from './media.js';
import { fingerprintNative44Snapshot, type Native44CompareManifest } from './compare.js';
import { NATIVE44_CAROUSEL_WIDGETS } from './interaction-check.js';
import { native44PostChecksFromReceipts } from './post-check.js';
import { prepareNative44JobSourceCaptures } from './source-captures.js';
import { assertNative44ReleaseIdentity, prepareNative44ReleaseLock } from './release-lock.js';
import { syncNative44ContextIndex } from './context-bookkeeping.js';
import { assertNative44OriginalRunWritable } from './current-state.js';

const within = (root: string, filename: string) => { const relative = path.relative(root, filename); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('native44 input escaped the project'); };
export { prepareLocalTask, validateLocalNative44Input } from './local-task.js';
export type { ValidatedTaskInput } from './local-task.js';
import { prepareLocalTask } from './local-task.js';
export { discoverNative44Contracts, prepareTargetContext } from './target-context.js';
export type { TargetContext, Native44TargetReader } from './target-context.js';
import { prepareTargetContext, Native44TargetContextError } from './target-context.js';
export async function runNative44Replica(filename: string, options: { root?: string; resume?: string; reviewDraft?: true; onProgress?: (message: string) => void | Promise<void> } = {}) {
  // Resolve revision ownership before frozen source validation or authentication;
  // old executable contracts may have changed after a reviewed amendment.
  if (options.resume) await assertNative44OriginalRunWritable(options.root ?? process.cwd(), options.resume);
  const input = await prepareLocalTask(filename, options.root ?? process.cwd(), options.reviewDraft ? { reviewDraft: true } : {}), { root, program } = input;
  // Source collection ownership and the frozen profile's actual viewport captures are
  // validated before target authentication, draft creation or media writes.
  const sourceCheckStarted = performance.now();
  const comparisonSource = await prepareNative44JobSourceCaptures(input);
  const sourceEvidenceMs = Math.round(performance.now() - sourceCheckStarted);
  const comparisonViewports = comparisonSource.viewports.map(reference => { const snapshot = input.sourceFacts.snapshots.find(item => item.id === reference.snapshotId); if (!snapshot) throw Error('Comparison source snapshot is missing'); return { name: reference.viewport, width: snapshot.viewport.width, height: snapshot.viewport.height }; });
  const comparisonModules = program.blocks.map(block => {
    const planned = input.componentPlan.components.find(component => component.id === block.key); if (!planned) throw Error(`Comparison component has no explicit authored source owner: ${block.key}`);
    const sourceVariants = comparisonSource.viewports.map(reference => { const snapshot = input.sourceFacts.snapshots.find(item => item.id === reference.snapshotId)!, variant = planned.variants.find(item => item.snapshotId === snapshot.id); if (!variant?.nodeIds.length) throw Error(`Comparison component lacks its explicit source viewport variant: ${block.key}/${snapshot.id}`); return { viewport: reference.viewport, snapshotId: snapshot.id, nodeIds: variant.nodeIds, selectors: variant.nodeIds.map(id => snapshot.nodes[id].selector), visible: variant.visible }; });
    return { key: block.key, sourceSelector: sourceVariants.find(variant => variant.snapshotId === input.componentPlan.desktopSnapshotId)!.selectors[0], sourceVariants, required: true };
  });
  await ensureDiskSpaceV2(root);
  const releaseLock = await prepareNative44ReleaseLock(root, input.jobDir, { filename: input.filename, sha256: input.programHash, program });
  if (releaseLock) await syncNative44ContextIndex(root, input.jobDir);
  type RuntimeJournal = Native44Journal & { reviewDraftOnly?: true; requirementsComplete?: false; reviewDraftIntent?: { path: string; sha256: string } };
  if (options.resume) { const directory = await realpath(path.resolve(root, options.resume)); within(path.join(root, 'runs'), directory); const previous = await readJson<RuntimeJournal>(path.join(directory, 'journal.json')); assertNative44ReleaseIdentity(previous.releaseLock, releaseLock); if (!!previous.reviewDraftOnly !== !!options.reviewDraft) throw Error('native44_review_draft_resume_mode_changed; preserve the existing run'); }
  // Durable whole-page intent must exist before credentials or authentication.
  // A retry must match the same immutable plan and preserve every named gap.
  let reviewDraftIntentRef: { path: string; sha256: string } | undefined;
  let reviewDraftIntent: typeof input.reviewDraftIntent;
  if (input.reviewDraftIntent) {
    reviewDraftIntent = { ...input.reviewDraftIntent, inputs: { ...input.reviewDraftIntent.inputs, releaseLock: releaseLock! } };
    const intentPath = path.join(input.jobDir, 'review-draft-intent.json');
    try { const existing = await readJson(intentPath); if (canonicalV2(existing) !== canonicalV2(reviewDraftIntent)) throw Error('native44_review_draft_intent_changed; preserve the previous intent'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await writeJson(intentPath, reviewDraftIntent); }
    reviewDraftIntentRef = { path: intentPath, sha256: hashV2(await readFile(intentPath)) };
  }
  const loaded = await loadConfig(root), redact = redactor(loaded.credentials), release = await acquireLock(root), start = performance.now();
  const client = new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, networkRoute:loaded.config.wordpressNetworkRoute, executionStrategy: 'native44-css-handoff', allowedWidgetTypes: NATIVE44_ALL_TYPES });
  let journal: RuntimeJournal | undefined, journalMutable = false;
  const progress = async (message: string) => { await options.onProgress?.(message); };
  try {
    if (options.resume) { const directory = await realpath(path.resolve(root, options.resume)); within(path.join(root, 'runs'), directory); journal = await readJson(path.join(directory, 'journal.json')); if (journal!.runDir !== directory) throw Error('Resume directory identity differs'); assertNative44Resume(journal!, program, input.programHash, loaded.config.targetUrl, releaseLock); }
    else { const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-n44-${randomUUID().slice(0, 8)}`, runDir = path.join(root, 'runs', runId); await mkdir(runDir, { recursive: true }); journal = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId: program.taskId, runId, runDir, targetUrl: loaded.config.targetUrl, programHash: input.programHash, sourceFactsHash: input.sourceFactsHash, componentPlanHash: input.componentPlanHash, assetsManifestHash: input.assetsManifestHash, componentCatalog: program.componentCatalog, knowledge: program.knowledge, targetEnvironment: program.targetEnvironment, status: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mutations: [], deliveryComplete: false, visualVerification: 'pending-comparison', metrics: { editorSessions: 0, documentRestores: 0, elapsedMs: 0 } }; }
    if (!options.resume) journal!.editorCompletionPolicy = defaultEditorCompletionPolicy();
    if (options.resume) assertFinalDeliveryPolicyIdentity(input, journal!);
    else if (input.finalDeliveryPolicy) journal!.finalDeliveryPolicy = input.finalDeliveryPolicy;
    if (journal!.deliveryComplete || journal!.status === 'delivered') throw Error('CSS has been handed off; use compare:replica for read-only verification');
    journalMutable = true;
    if (releaseLock) journal!.releaseLock = releaseLock;
    if (program.replicationProfile) Object.assign(journal!, { replicationProfile: program.replicationProfile, selectionRulesHash: program.selectionRulesHash });
    if (program.goalProfile) journal!.goalProfile = program.goalProfile;
    if (program.reviewWorkflow) journal!.reviewWorkflow = program.reviewWorkflow;
    if (program.articleListPolicy) journal!.articleListPolicy = program.articleListPolicy;
    if (reviewDraftIntentRef) {
      if (options.resume && (canonicalV2(journal!.reviewDraftIntent) !== canonicalV2(reviewDraftIntentRef) || journal!.requirementsComplete !== false)) throw Error('native44_review_draft_resume_intent_changed');
      Object.assign(journal!, { reviewDraftOnly: true, requirementsComplete: false, deliveryComplete: false, reviewDraftIntent: reviewDraftIntentRef });
      await writeJson(path.join(journal!.runDir, 'review-draft-intent.json'), reviewDraftIntent);
    }
    Object.assign(journal!.metrics, input.inputMetrics, { sourceEvidenceMs });
    await saveNative44Journal(journal!);
    await syncNative44ContextIndex(root, journal!.runDir);
    await archiveRawInputV2({ runDir: journal!.runDir, kind: 'program', sha256: input.programHash, bytes: input.bytes, normalize: validateNative44Program });
    await archiveRawInputV2({ runDir: journal!.runDir, kind: 'source-facts', sha256: input.sourceFactsHash, bytes: input.factsBytes, normalize: validateSourceFactsV2 });
    await archiveRawInputV2({ runDir: journal!.runDir, kind: 'component-plan', sha256: input.componentPlanHash, bytes: input.planBytes, normalize: value => value });
    await archiveRawInputV2({ runDir: journal!.runDir, kind: 'assets-manifest', sha256: input.assetsManifestHash, bytes: input.manifestBytes, normalize: value => value });
    await progress('read-only-environment-and-contracts'); const before = performance.now();
    let targetContext;
    try { targetContext = await prepareTargetContext(client, input, loaded.config.targetUrl); }
    catch (error) { if (error instanceof Native44TargetContextError) await writeJson(path.join(journal!.runDir, 'target', 'environment-observed.json'), error.environment); throw error; }
    const { capabilities, environment, knowledge, catalog, posts } = targetContext;
    await writeJson(path.join(journal!.runDir, 'target', 'environment-observed.json'), environment);
    const lockPath=path.join(journal!.runDir,'target','environment-lock.json');let previousLock:Native44EnvironmentCheck|undefined;
    try{previousLock=await readJson<Native44EnvironmentCheck>(lockPath);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(previousLock){assertNative44EnvironmentLock(previousLock,environment);if(journal!.environmentContractHash&&journal!.environmentContractHash!==previousLock.contractHash)throw Error('Native44 journal and actual environment lock disagree');}
    else{
      if(journal!.pageId||journal!.mutations.length||journal!.environmentContractHash)throw Error('An existing native44 draft has no durable environment contract lock; preserved');
      await writeJson(path.join(journal!.runDir,'target','capabilities.json'),capabilities);await writeJson(lockPath,environment);await writeJson(path.join(journal!.runDir,'target','environment.json'),environment);
    }
    Object.assign(journal!,{environmentPolicy:'component-contract',actualVersions:environment.actualVersions,environmentContractHash:environment.contractHash,schemaContractHash:environment.schemaContractHash,sourceContractHash:environment.sourceContractHash});
    await saveNative44Journal(journal!);journal!.metrics.preflightMs = Math.round(performance.now() - before);
    if (catalog) { const catalogPath = path.join(journal!.runDir, 'target', 'catalog.json'); catalog.evidence = [catalogPath]; await writeJson(catalogPath, catalog); }
    if (posts) for (const [index, snapshot] of posts.entries()) { const postsPath = path.join(journal!.runDir, 'target', `posts-${index + 1}.json`); snapshot.evidence = [postsPath]; await writeJson(postsPath, snapshot); }
    preflightNative44(program, { schemas: capabilities.legacySchemas, knowledge, catalog, posts, targetOrigin: new URL(loaded.config.targetUrl).origin });
    if (hashV2(await readFile(input.filename)) !== input.programHash) throw Error('Program changed during read-only preflight');
    await ensureDiskSpaceV2(root); await progress('create-or-recover-owned-draft');
    await writeJson(path.join(journal!.runDir, 'draft-create-intent.json'), { runId: journal!.runId, title: program.title, pageId: journal!.pageId ?? null, status: 'intent' });
    const draft = await client.createDraft(journal!.runId, program.title, journal!.pageId ? { requireExistingPageId: journal!.pageId } : undefined);
    journal!.pageId = draft.pageId; journal!.editUrl = draft.editUrl; await saveNative44Journal(journal!);
    const baseline = await retryReadV2(() => client.snapshotDraft(draft.pageId));
    await progress('prepare-complete-media-set'); const mediaStart = performance.now();
    const assets = await importNative44Media({ client, root, runDir: journal!.runDir, jobDir: input.jobDir, runId: journal!.runId, pageId: draft.pageId, manifest: input.manifest.assets, required: [...referencedNative44Assets(program)] }); journal!.metrics.mediaMs = Math.round(performance.now() - mediaStart);
    const compileStarted = performance.now();
    const compiled = compileNative44(program, { schemas: capabilities.legacySchemas, knowledge, assets, catalog, posts, targetOrigin: new URL(loaded.config.targetUrl).origin });
    journal!.metrics.compilationMs = Math.round(performance.now() - compileStarted);
    const emitted = (nodes: typeof compiled.composition.elements): typeof nodes => nodes.flatMap(node => [node, ...emitted(node.elements ?? [])]);
    const actualElements = emitted(compiled.composition.elements);
    Object.assign(journal!.metrics, { logicalComponents: walkNative44(program.blocks).length, emittedContainers: actualElements.filter(node => node.elType === 'container').length, emittedWidgets: actualElements.filter(node => node.elType === 'widget').length });
    const shell = await client.configureCanvasShell(draft.pageId, true, program.replicationProfile); bindNative44CanvasShell(compiled, shell);
    await writeJson(path.join(journal!.runDir, 'compiled.json'), { ...compiled, htmlProofs: compiled.htmlProofs.map(proof => ({ componentKey: proof.componentKey, elementId: proof.elementId, sha256: proof.sha256 })) });
    await progress('one-complete-body-commit'); const saveStart = performance.now();
    const saved = await saveNative44Body({ client, journal: journal!, baseline, compiled, schemas: capabilities.legacySchemas }); journal!.metrics.saveMs = Math.round(performance.now() - saveStart);
    journal!.metrics.bodyCommits = journal!.mutations.filter(mutation => mutation.kind === 'document-save' && mutation.status === 'confirmed').length;
    const preview = new URL(`/?page_id=${draft.pageId}&preview=true`, loaded.config.targetUrl).href;
    journal!.previewUrl = preview;
    await writeSnapshotRefV2(journal!.runDir, path.join(journal!.runDir, 'target', 'accepted-snapshot.json'), saved);
    await writeJson(path.join(journal!.runDir, 'elementor-template.json'), { version: '0.4', title: program.title, type: 'page', content: saved.elements, page_settings: saved.settings });
    await writeJson(path.join(journal!.runDir, 'query-receipts.json'), compiled.queryReceipts);
    if (compiled.postQueryReceipts) await writeJson(path.join(journal!.runDir, 'post-query-receipts.json'), compiled.postQueryReceipts);
    const manifest: Native44CompareManifest = { ...(releaseLock ? { releaseLock } : {}), version: 1, strategy: 'native44-css-handoff', taskId: program.taskId, runId: journal!.runId, pageId: draft.pageId, sourceUrl: program.sourceUrl, targetUrl: loaded.config.targetUrl, ...fingerprintNative44Snapshot(saved), canvasCss: shell.css ?? '', widgetTypes: compiled.usedTypes, cssRules: [], sourceCaptures: comparisonSource, viewports: comparisonViewports, modules: comparisonModules.map(module => ({ ...module, className: compiled.moduleClasses[module.key], targetSelector: `.elementor-${draft.pageId} .${compiled.moduleClasses[module.key]}` })),
      ...(program.replicationProfile ? { replicationProfile: program.replicationProfile, selectionRulesHash: program.selectionRulesHash } : {}),
      ...(program.reviewWorkflow ? { reviewWorkflow: program.reviewWorkflow } : {}),
      ...(program.visualAuditVersion ? { visualAuditVersion: program.visualAuditVersion } : {}),
      productChecks: catalog ? compiled.queryReceipts.map(receipt => ({ componentKey: receipt.componentKey, selector: `.elementor-${draft.pageId} [data-id="${receipt.elementId}"]`, widgetType: receipt.widgetType, collectionPath: receipt.collectionPath, expectedProductIds: receipt.productIds, catalog, carouselExpected: receipt.settings.layout === 'carousel' || (walkNative44(program.blocks).find(node => node.key === receipt.componentKey) as {widgetSettings?: Record<string, unknown>} | undefined)?.widgetSettings?.layout === 'carousel' })) : [],
      ...(compiled.postQueryReceipts ? { postChecks: native44PostChecksFromReceipts(compiled.postQueryReceipts, posts ?? [], draft.pageId) } : {}),
      interactionChecks: [
        ...walkNative44(program.blocks).filter(node => 'widgetType' in node && (NATIVE44_CAROUSEL_WIDGETS as readonly string[]).includes(node.widgetType) && (node.kind === 'native-carousel' || node.widgetType !== 'wd_testimonials')).map(node => ({ componentKey: node.key, sourceComponentKey: input.componentPlan.components.find(component => component.id === node.key)!.id, requireSourceAlignment: true, selector: `.elementor-${draft.pageId} [data-id="${compiled.widgetTargets[node.key]}"]`, widgetType: (node as {widgetType: string}).widgetType })),
        ...compiled.queryReceipts.filter(receipt => receipt.settings.layout === 'carousel' || (walkNative44(program.blocks).find(node => node.key === receipt.componentKey) as {widgetSettings?: Record<string, unknown>} | undefined)?.widgetSettings?.layout === 'carousel').map(receipt => ({ componentKey: receipt.componentKey, sourceComponentKey: input.componentPlan.components.find(component => component.id === receipt.componentKey)!.id, requireSourceAlignment: true, selector: `.elementor-${draft.pageId} [data-id="${receipt.elementId}"]`, widgetType: receipt.widgetType })),
        ...(compiled.postQueryReceipts ?? []).filter(receipt => receipt.settings.blog_design === 'carousel' || receipt.settings.blog_layout === 'carousel').map(receipt => ({ componentKey: receipt.componentKey, selector: `.elementor-${draft.pageId} [data-id="${receipt.elementId}"]`, widgetType: receipt.widgetType })),
      ],
      editingEvidence: { libraryFingerprint: input.knowledge.index.fingerprint, scope: 'historical-qualified library; page structure and resources read back; no per-page editing experiment', components: compiled.usedTypes.map(type => ({ type, evidence: input.knowledge.components[type]?.evidence })) } };
    await writeJson(path.join(journal!.runDir, 'compare-manifest.json'), manifest);
    journal!.status = 'awaiting-comparison'; await saveNative44Journal(journal!); await progress(program.reviewWorkflow ? 'complete-body-read-back-awaiting-consolidated-page-css' : reviewDraftIntentRef ? 'complete-review-draft-awaiting-current-page-review' : 'complete-draft-frozen-for-read-only-comparison');
  } catch (error) { if (!journal || !journalMutable) throw error; journal.error = redact(error); if (!['write-unknown', 'conflict'].includes(journal.status)) journal.status = 'failed'; await progress(journal.error); }
  finally {
    try { if (journal && journalMutable) { journal.metrics.elapsedMs += Math.round(performance.now() - start); Object.assign(journal.metrics, client.diagnostics()); await saveNative44Journal(journal); } }
    finally { await client.close().catch(() => undefined); await release(); }
  }
  const delivery = ['awaiting-comparison', 'draft-saved'].includes(journal!.status) ? await emitNative44DeliverySummary(root, journal!.runId) : undefined;
  const finalDeliveryPolicy = resolveFinalDeliveryPolicy(journal!);
  const result = { ...journal!, mode: 'replica', completed: false, finalDeliveryPolicy, nextAction: `${program.reviewWorkflow ? '整页正文已保存并读回；先整理整份页面 CSS，使用 revision prepare/apply 受保护应用并读回，再执行 compare:replica -- RUN --capture-current，一次完整检查两桌面视觉和原生交互。构建期间不做逐块正式截图验收。' : ''}${finalDeliveryNextAction(finalDeliveryPolicy, journal!.runId)}`, ...(delivery ? { delivery } : {}), editingEvidence: 'library-qualified plus page readback; no per-page editor mutation', evidence: [path.join(journal!.runDir, 'compare-manifest.json'), ...(delivery ? [delivery.summaryRef.path, delivery.markdownRef.path] : [])], resultFile: path.join(journal!.runDir, 'result.json') };
  await writeJson(result.resultFile, result); await writeJson(path.join(input.jobDir, 'build-result.json'), result); await syncNative44ContextIndex(root, journal!.runDir); return result;
}
