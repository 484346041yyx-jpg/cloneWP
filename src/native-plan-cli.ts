import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { blockContractSchema } from './fidelity/validate.js';
import { planNativeCapabilities, type NativeResponsiveEnvironment } from './fidelity/capability-plan.js';
import { readJson, redactor } from './core/config.js';
import { writeJson } from './core/files.js';
import type { CapabilityReport } from './wordpress/types.js';
import { pathToFileURL } from 'node:url';
import { validateLocalInputV2 } from './replica-v2/runtime.js';
import { preflightReplicaV2, referencedAssetsV2, usedWidgetTypesV2 } from './replica-v2/compile.js';
import { walkComponentsV2, type ReplicaStage } from './replica-v2/types.js';
import type { TargetCatalogEvidence } from './fidelity/catalog-contract.js';

export interface NativePlanArguments { job: string; registry: string; stage?: ReplicaStage; catalog?: string; posts?: string }
export function parseNativePlanArguments(args: string[]): NativePlanArguments | undefined {
  const positional: string[] = []; let stage: ReplicaStage | undefined, catalog: string | undefined, posts: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--stage') { if (stage || !['desktop', 'responsive', 'final'].includes(args[index + 1])) return; stage = args[++index] as ReplicaStage; }
    else if (argument === '--catalog') { if (catalog || !args[index + 1] || /^(?:[a-z]+:\/\/|--)/i.test(args[index + 1])) return; catalog = args[++index]; }
    else if (argument === '--posts') { if (posts || !args[index + 1] || /^(?:[a-z]+:\/\/|--)/i.test(args[index + 1])) return; posts = args[++index]; }
    else { if (/^(?:[a-z]+:\/\/|--)/i.test(argument) || positional.length >= 2) return; positional.push(argument); }
  }
  return positional.length === 2 ? { job: positional[0], registry: positional[1], ...(stage ? { stage } : {}), ...(catalog ? { catalog } : {}), ...(posts ? { posts } : {}) } : undefined;
}
/** Offline planning consumes actual saved registry/catalog bytes. It never authenticates or writes target state. */
export async function createOfflineNativePlan(input: NativePlanArguments, projectRoot = process.cwd()) {
    const root = await realpath(projectRoot), jobDir = await realpath(path.resolve(root, input.job)), registryPath = await realpath(path.resolve(root, input.registry));
    const inside = (value: string) => { const relative = path.relative(root, value); return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
    if (path.dirname(jobDir).toLowerCase() !== path.join(root, 'references').toLowerCase() || !inside(registryPath)) throw new Error('Planning inputs must be a current reference job and saved registry inside this project');
    let program: { version?: unknown; executionStrategy?: unknown } | undefined;
    try { program = await readJson(path.join(jobDir, 'program.json')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (program && program.version !== 1 && program.version !== 2) throw new Error('Unknown replica program version');
    if (program?.executionStrategy !== undefined) {
      if (program.executionStrategy !== 'native44-css-handoff' || program.version !== 2) throw Error('Unknown or conflicting replica strategy');
      const { createOfflineNative44Plan } = await import('./native44/offline-plan.js');
      return createOfflineNative44Plan(input, root);
    }
    if (input.posts) throw new Error('Saved target posts queries require the native44 article-list contract');
    if (program?.version !== 2 && (input.stage || input.catalog)) throw new Error('Stage/catalog arguments require a version 2 replica program');
    const stage = input.stage ?? 'desktop';
    const localV2 = program?.version === 2 ? await validateLocalInputV2(path.join(jobDir, 'program.json'), root, stage) : undefined;
    const registryBytes = await readFile(registryPath), registry = JSON.parse(registryBytes.toString('utf8')) as CapabilityReport;
    const lock = await readJson<{ versions: Record<string, string>; mode: string }>(path.join(root, 'config/environment-lock.json'));
    if (!registry.legacySchemas || registry.mode !== lock.mode || Object.entries(lock.versions).some(([key, value]) => registry.versions?.[key] !== value)) throw new Error('Saved registry does not match the configured native environment; fresh authorized registry evidence is required');
    for (const name of ['save', 'get_elements_data', 'responsiveRegistration', 'responsiveCSSExpansion']) {
      const proof = registry.sourceProof?.[name] as { sha256?: string; source?: string } | undefined;
      if (!/^[a-f\d]{64}$/.test(proof?.sha256 ?? '') || !proof?.source?.trim()) throw new Error('Saved registry lacks native source proof');
    }
    const registryEvidence = { path: path.relative(jobDir, registryPath), sha256: createHash('sha256').update(registryBytes).digest('hex'), liveRediscoveryRequired: true };
    if (localV2) {
      const components = walkComponentsV2(localV2.program.blocks, stage);
      const hasProducts = components.some(component => component.kind === 'native-products');
      let catalog: TargetCatalogEvidence | undefined, catalogEvidence: { path: string; sha256: string } | undefined;
      if (hasProducts && !input.catalog) throw new Error('Version 2 product planning requires --catalog with an actual saved target WooCommerce snapshot');
      if (input.catalog) {
        const catalogPath = await realpath(path.resolve(root, input.catalog)); if (!inside(catalogPath)) throw new Error('Saved catalog must stay inside this project');
        const bytes = await readFile(catalogPath), candidate = JSON.parse(bytes.toString('utf8')) as TargetCatalogEvidence;
        const configured = await readJson<{ targetUrl: string }>(path.join(root, 'config/project.json'));
        if (!candidate || typeof candidate !== 'object' || new URL(candidate.targetOrigin).origin !== candidate.targetOrigin || new URL(configured.targetUrl).origin !== candidate.targetOrigin || !Array.isArray(candidate.evidence) || !candidate.evidence.length || !Array.isArray(candidate.products) || !candidate.products.length) throw new Error('Saved catalog must identify the actual configured target and its read-only evidence');
        const ids = new Set<number>();
        for (const product of candidate.products) {
          if (!Number.isInteger(product.id) || product.id < 1 || ids.has(product.id) || !product.name?.trim() || new URL(product.permalink).origin !== candidate.targetOrigin || !/^https?:\/\//.test(product.imageUrl)) throw new Error('Saved catalog has invalid or duplicate actual target products');
          for (const value of [product.permalink, product.imageUrl]) { const url = new URL(value); if (url.username || url.password) throw new Error('Saved catalog cannot contain credential-bearing URLs'); }
          ids.add(product.id);
        }
        catalogEvidence = { path: path.relative(jobDir, catalogPath), sha256: createHash('sha256').update(bytes).digest('hex') };
        catalog = { ...candidate, evidence: [catalogPath] };
      }
      const preflight = preflightReplicaV2(localV2.program, registry.legacySchemas, catalog, stage);
      const plan = { version: 2 as const, workflow: 'block-replication' as const, taskId: localV2.program.taskId, stage, passed: true, status: 'capability-planned', wholeTaskComplete: false, renderVerificationRequired: true, liveRediscoveryRequired: true, registryEvidence, ...(catalogEvidence ? { catalogEvidence } : {}), sourceFactsHash: localV2.sourceFactsHash, componentPlanHash: localV2.componentPlanHash, programHash: localV2.programHash, preflight, usedTypes: usedWidgetTypesV2(localV2.program, stage), symbolicAssets: [...referencedAssetsV2(localV2.program, stage)], components: components.map(component => ({ key: component.key, kind: component.kind, editability: component.kind === 'html-static' ? 'code' : component.kind === 'native-products' ? 'woocommerce' : component.kind === 'composite' ? 'mixed' : 'controls' })), ...(catalog ? { catalog: { targetOrigin: catalog.targetOrigin, verifiedProductCount: catalog.products.length } } : {}) };
      const resultFile = path.join(jobDir, `native-capability-plan-${stage}.json`);
      await writeJson(resultFile, plan); return { plan, resultFile };
    }
    const contract = blockContractSchema.parse(await readJson(path.join(jobDir, 'block-contract.json')));
    const plan = { ...planNativeCapabilities(contract, registry.legacySchemas, undefined, undefined, registry.sourceProof?.responsiveDevices as NativeResponsiveEnvironment | undefined), registryEvidence };
    const resultFile = path.join(jobDir, 'native-capability-plan.json'); await writeJson(resultFile, plan); return { plan, resultFile };
}

export function nativePlanConsoleOutput(result: Awaited<ReturnType<typeof createOfflineNativePlan>>) {
  const { plan, resultFile } = result;
  if ('executionStrategy' in plan) return { ...plan, resultFile };
  return plan.version === 2 ? { version: 2, status: plan.status, passed: plan.passed, stage: plan.stage, counts: { components: plan.components.length, widgetTypes: plan.usedTypes.length, assets: plan.symbolicAssets.length, targetProducts: plan.catalog?.verifiedProductCount ?? 0 }, resultFile, wholeTaskComplete: plan.wholeTaskComplete, liveRediscoveryRequired: plan.liveRediscoveryRequired } : { ...plan, resultFile };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseNativePlanArguments(process.argv.slice(2));
  if (!args) { console.error('Usage: npm run design:plan -- <REFERENCE_JOB_DIR> <SAVED_NATIVE_CAPABILITY_REPORT> [--stage desktop|responsive|final] [--catalog SAVED_TARGET_CATALOG] [--posts SAVED_TARGET_POST_QUERIES]'); process.exitCode = 2; }
  else try { const result = await createOfflineNativePlan(args); console.log(JSON.stringify(nativePlanConsoleOutput(result), null, 2)); process.exitCode = result.plan.passed ? 0 : 3; }
  catch (error) { console.error(redactor()(error)); process.exitCode = 1; }
}
