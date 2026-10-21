import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { OriginalEditorSectionReport } from '../original/verify.js';
import type { NativeEditabilityReport } from '../verification/types.js';
import type { FidelityCarouselEditorReport, CatalogQueryEditorReport } from './acceptance.js';

export interface StyleRevisionEditorReceipt {
  version: 1; runDir: string; runId: string; pageId: number;
  beforeHash: string; afterHash: string; assertStyleRevisionPassed: true;
  unchanged: { nativeTree: true; productQueries: true; staticContent: true; media: true; sourceContract: true; assetsManifest: true };
}
export interface EditorCheckpointOptions {
  sourceReportPath: string; expectedBeforeHash: string; afterHash: string;
  rootIds: string[]; nativeOwnerCount: number; styleRevisionReceipt: StyleRevisionEditorReceipt;
}
export interface ReusableEditorCheckpoint {
  version: 1;
  editorSections: OriginalEditorSectionReport; editability: NativeEditabilityReport;
  carouselEditor: FidelityCarouselEditorReport; catalogQueryEditor: CatalogQueryEditorReport;
  reuse: {
    kind: 'same-run-style-only-editor-proof'; sourceReportPath: string; sourceReportSha256: string;
    runId: string; pageId: number; sourceDocumentHash: string; targetDocumentHash: string;
    originalVerificationTime: { startedAt: string; finishedAt: string; source: 'original-report-runtime' };
    currentRevisionUITested: false;
    scope: string[]; excludes: string[]; styleRevisionReceipt: StyleRevisionEditorReceipt;
  };
}
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{64}$/.test(value);
const fail = (reason: string): never => { throw new Error(`Editor checkpoint is not reusable: ${reason}`); };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const flags = (value: unknown, names: string[]) => names.every(name => object(value)[name] === true);
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Load historical UI evidence only after a caller has proved a pure owned style revision.
 * This never grants visual/data/responsive completion and never performs a target request.
 */
export async function loadReusableEditorCheckpoint(options: EditorCheckpointOptions): Promise<ReusableEditorCheckpoint> {
  const receipt = object(options.styleRevisionReceipt);
  if (!hash(options.expectedBeforeHash) || !hash(options.afterHash) || receipt.version !== 1 || receipt.assertStyleRevisionPassed !== true || receipt.beforeHash !== options.expectedBeforeHash || receipt.afterHash !== options.afterHash) fail('the exact before/after document hashes and successful assertStyleRevision receipt are required');
  if (!flags(receipt.unchanged, ['nativeTree', 'productQueries', 'staticContent', 'media', 'sourceContract', 'assetsManifest'])) fail('native tree, query, static content, media, contract and manifest must all be explicitly unchanged');
  if (typeof receipt.runDir !== 'string' || !path.isAbsolute(receipt.runDir) || typeof receipt.runId !== 'string' || !Number.isInteger(receipt.pageId) || receipt.pageId < 1) fail('the current owned run/page identity is required');
  const runDir = await realpath(receipt.runDir);
  if (runDir.toLowerCase() !== path.resolve(receipt.runDir).toLowerCase() || path.basename(runDir) !== receipt.runId || path.basename(path.dirname(runDir)) !== 'runs') fail('the owned run path is redirected or has a different identity');
  const reportPath = await realpath(path.resolve(options.sourceReportPath)), relative = path.relative(runDir, reportPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.basename(reportPath) !== 'final.json' || path.basename(path.dirname(reportPath)) !== 'verification' || reportPath.toLowerCase() !== path.resolve(options.sourceReportPath).toLowerCase()) fail('source verification/final.json must remain inside this exact owned run');
  const identity = object(JSON.parse(await readFile(path.join(runDir, 'result.json'), 'utf8')));
  if (identity.runId !== receipt.runId || identity.pageId !== receipt.pageId || typeof identity.runDir !== 'string' || path.resolve(identity.runDir).toLowerCase() !== runDir.toLowerCase()) fail('source report cannot borrow another run or page');
  if (!Array.isArray(options.rootIds) || !options.rootIds.length || options.rootIds.length > 60 || options.rootIds.some(id => typeof id !== 'string' || !/^[a-f\d]{7}$/.test(id)) || new Set(options.rootIds).size !== options.rootIds.length || !Number.isInteger(options.nativeOwnerCount) || options.nativeOwnerCount < options.rootIds.length || options.nativeOwnerCount > 2500) fail('current native root order and unique owner count are not valid');
  const information = await stat(reportPath);
  if (!information.isFile() || information.size < 1 || information.size > 64 * 1024 * 1024) fail('source report is not a bounded regular file');
  const bytes = await readFile(reportPath), sourceReportSha256 = sha256(bytes), report = object(JSON.parse(bytes.toString('utf8'))), document = object(report.nativeDocument);
  if (report.version !== 1 || report.workflow !== 'block-replication' || report.readOnly === true || report.editorVisited === false) fail('a complete actual native editor verification report is required');
  if (report.restoredHash !== options.expectedBeforeHash || document.readbackHash !== options.expectedBeforeHash || document.passed !== true) fail('source restored/readback hashes do not match the exact current baseline');
  if (!same(document.rootOrder, options.rootIds) || document.uniqueOwners !== options.nativeOwnerCount || document.mappedOwners !== options.nativeOwnerCount || !Array.isArray(document.duplicateNativeIDs) || document.duplicateNativeIDs.length) fail('native root order or unique owner mapping changed');
  const editorSections = object(report.editorSections), editability = object(report.editability), carouselEditor = object(report.carouselEditor), catalogQueryEditor = object(report.catalogQueryEditor);
  if (editorSections.passed !== true || !Array.isArray(editorSections.sections) || !same(editorSections.sections.map((section: any) => section.targetId), options.rootIds) || editorSections.sections.some((section: any) => !flags(section, ['selected', 'panelLoaded', 'nativeContainer']) || section.panelModelId !== section.targetId) || !Array.isArray(editorSections.issues) || editorSections.issues.length) fail('every original native root must have successful actual editor selection proof');
  const checks = array(editability.checks);
  if (editability.status !== 'verified' || !Array.isArray(editability.checks) || !Array.isArray(editability.verifiedFields) || !['title', 'image', 'style'].every(field => editability.verifiedFields.includes(field) && checks.some(check => check.field === field && flags(check, ['selected', 'changed', 'saved', 'frontendConfirmed', 'restored']))) || checks.some(check => !flags(check, ['selected', 'changed', 'saved', 'frontendConfirmed', 'restored'])) || !Array.isArray(editability.issues) || editability.issues.length) fail('title, image and style all require actual changed/saved/frontend/restored editor proof');
  for (const [name, proof] of [['carouselEditor', carouselEditor], ['catalogQueryEditor', catalogQueryEditor]] as const) {
    if (proof.passed !== true || proof.restoredHash !== options.expectedBeforeHash || !Array.isArray(proof.panels) || proof.panels.some((panel: any) => !flags(panel, ['selected', 'nativeWidget']) || typeof panel.targetId !== 'string' || !panel.targetId) || !Array.isArray(proof.issues) || proof.issues.length) fail(`${name} is not fully passed and restored to the original baseline`);
    if (proof.panels.length && (!flags(proof.check, ['changed', 'saved', 'readbackConfirmed', 'frontendConfirmed', 'restored']) || !proof.panels.some((panel: any) => panel.targetId === object(proof.check).targetId))) fail(`${name} lacks its real native save/readback/frontend/restoration check`);
  }
  const runtime = object(report.runtime), finished = array(runtime.phases).map(phase => phase.finishedAt).filter(validDate).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
  if (!validDate(runtime.startedAt) || !finished || Date.parse(finished) < Date.parse(runtime.startedAt)) fail('original verification time is not recorded in the source report');
  if (sha256(await readFile(reportPath)) !== sourceReportSha256) fail('source report changed while its proof was loading');
  return {
    version: 1, editorSections: structuredClone(report.editorSections), editability: structuredClone(report.editability), carouselEditor: structuredClone(report.carouselEditor), catalogQueryEditor: structuredClone(report.catalogQueryEditor),
    reuse: { kind: 'same-run-style-only-editor-proof', sourceReportPath: reportPath, sourceReportSha256, runId: receipt.runId, pageId: receipt.pageId, sourceDocumentHash: options.expectedBeforeHash, targetDocumentHash: options.afterHash, originalVerificationTime: { startedAt: runtime.startedAt, finishedAt: finished!, source: 'original-report-runtime' }, currentRevisionUITested: false,
      scope: ['Previously selected unchanged native section owners', 'Previously saved and restored native title/image/style controls', 'Previously saved and restored native carousel and WooCommerce query controls'],
      excludes: ['Fresh UI tests in this style revision', 'Current visual or responsive fidelity', 'Current product facts, price fitting or media pixels', 'Current frontend hover/carousel/runtime behavior', 'Whole-task completion'], styleRevisionReceipt: structuredClone(options.styleRevisionReceipt) },
  };
}
