import path from 'node:path';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { assertPublicUrl } from '../capture/url-safety.js';
import { makeRunId, writeJson } from '../core/files.js';
import { insideProject } from '../original/validate.js';
import type { ReferenceCaptureReport, ReferencePreparedJob } from './types.js';
import type { FidelityPreparedJob } from '../fidelity/types.js';
import { relocateReferenceEvidence } from './relocate.js';

interface BrowserObservationProvenance {
  version: 1; method: 'user-opened-browser'; sourceUrl: string; observedUrl: string;
  /** Historical observations may contain this flag; live public-page checks no longer require a separate user reply. */
  userCompletedValidation?: boolean; observedAt: string; browser: 'chrome' | 'edge' | 'iab'; observer: 'cua_repl';
}
type ObservedPage = {
  url: string; title: string; viewport: { width: number; height: number }; screenshotSha256: string;
  screenshotDimensions?: { width: number; height: number };
};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const normalizedUrl = (url: string) => { const value = new URL(url); value.hash = ''; return value.href; };
const samePath = (left: string, right: string) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const assertPublicFields = (value: unknown): void => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:cookies?|set-cookie|authorization|storageState|localStorage|sessionStorage|accessToken|consumer_secret|wp_app_password)$/i.test(key)) throw new Error('Browser observations must not include authentication or session exports');
    assertPublicFields(child);
  }
};

/** Import observations from the public page the user opened. This never fetches the source, exports a browser session or reads target credentials. */
export async function prepareObservedReference(url: string, observedDirectory: string, options: { root?: string } = {}): Promise<FidelityPreparedJob> {
  return prepareObservationJob(url, observedDirectory, options, false) as Promise<FidelityPreparedJob>;
}
/** Explicit historical original-design intake; never called by the active reference workflow. */
export async function prepareObservedOriginalReference(url: string, observedDirectory: string, options: { root?: string } = {}): Promise<ReferencePreparedJob> {
  return prepareObservationJob(url, observedDirectory, options, true) as Promise<ReferencePreparedJob>;
}
async function prepareObservationJob(url: string, observedDirectory: string, options: { root?: string }, historicalOriginal: boolean): Promise<ReferencePreparedJob | FidelityPreparedJob> {
  await assertPublicUrl(url);
  const root = await realpath(path.resolve(options.root ?? process.cwd()));
  const observationDir = insideProject(root, observedDirectory);
  if (!samePath(await realpath(observationDir), observationDir)) throw new Error('Browser observations must stay inside their real project directory');
  if (!(await stat(observationDir)).isDirectory()) throw new Error('Browser observation directory is required');
  const localBytes = async (filename: string, maxBytes: number) => {
    const absolute = path.resolve(observationDir, filename), relative = path.relative(observationDir, absolute);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !samePath(await realpath(absolute), absolute)) throw new Error('Every browser evidence file must belong to this observation directory');
    const information = await stat(absolute);
    if (!information.isFile() || information.size === 0 || information.size > maxBytes) throw new Error('Browser evidence must be a nonempty regular file within its size limit');
    return { filename: absolute, bytes: await readFile(absolute) };
  };
  const reportFile = await localBytes('report.json', 1_000_000), provenanceFile = await localBytes('provenance.json', 100_000);
  const report = JSON.parse(reportFile.bytes.toString('utf8')) as ReferenceCaptureReport;
  const provenance = JSON.parse(provenanceFile.bytes.toString('utf8')) as BrowserObservationProvenance;
  assertPublicFields(report); assertPublicFields(provenance);
  if (report.version !== 1 || report.url !== url || !samePath(report.artifactPath, reportFile.filename)) throw new Error('The browser report must identify the exact current source URL and its actual local report');
  if (report.status === 'blocked' || !['complete', 'partial'].includes(report.status) || !Array.isArray(report.viewports) || !report.viewports.length) throw new Error('Blocked browser observations cannot become usable reference evidence');
  if (!Array.isArray(report.gaps) || !/untrusted/i.test(report.evidenceNotice ?? '') || !Number.isFinite(Date.parse(report.capturedAt))) throw new Error('The browser report must disclose untrusted facts, capture time and evidence gaps');
  if (provenance.version !== 1 || provenance.method !== 'user-opened-browser' || provenance.sourceUrl !== url || provenance.userCompletedValidation !== undefined && provenance.userCompletedValidation !== true || provenance.observer !== 'cua_repl' || !['chrome', 'edge', 'iab'].includes(provenance.browser) || !Number.isFinite(Date.parse(provenance.observedAt))) throw new Error('The browser observation must identify the actual user-opened public page');
  await assertPublicUrl(provenance.observedUrl);
  if (normalizedUrl(provenance.observedUrl) !== normalizedUrl(report.finalUrl ?? url) || normalizedUrl(provenance.observedUrl) !== normalizedUrl(url)) throw new Error('The observed public page does not match the current reference URL');
  const names = new Set<string>();
  const files: Array<{ filename: string; bytes: Buffer; destination: string; kind: string }> = [];
  for (const viewport of report.viewports) {
    if (!/^[a-z][a-z0-9-]{0,30}$/i.test(viewport.name) || names.has(viewport.name) || !positive(viewport.width) || !positive(viewport.height) || !positive(viewport.pageHeight) || !viewport.title?.trim() || /access denied|verify (?:you are|your identity)|captcha|just a moment/i.test(viewport.title)) throw new Error('Browser viewports must identify distinct, usable rendered pages and actual dimensions');
    names.add(viewport.name);
    for (const field of ['headings', 'navigation', 'ctas', 'sections', 'images', 'typography', 'colors', 'disclosures'] as const) if (!Array.isArray(viewport[field])) throw new Error(`Browser viewport has no ${field} observation array`);
    if (!viewport.layout?.hero?.layout || !viewport.layout.density || !viewport.metadata || !viewport.counts) throw new Error('Browser viewport is missing public layout or metadata observations');
    const screenshot = await localBytes(viewport.screenshotPath, 20_971_520), dom = await localBytes(viewport.domPath, 10_000_000), evidence = await localBytes(viewport.evidencePath, 30_000_000);
    const metadata = await sharp(screenshot.bytes, { limitInputPixels: 80_000_000 }).metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw new Error('Browser screenshot must contain actual static PNG, JPEG or WebP image bytes');
    const document = JSON.parse(evidence.bytes.toString('utf8')) as Record<string, unknown>, observed = document.observedPage as ObservedPage | undefined;
    assertPublicFields(document);
    if (!observed || normalizedUrl(observed.url) !== normalizedUrl(provenance.observedUrl) || observed.title !== viewport.title || observed.viewport?.width !== viewport.width || observed.viewport?.height !== viewport.height || observed.screenshotSha256 !== hash(screenshot.bytes)) throw new Error('Screenshot and public DOM evidence do not identify the same observed page and actual bytes');
    if (observed.screenshotDimensions) {
      if (observed.screenshotDimensions.width !== metadata.width || observed.screenshotDimensions.height !== metadata.height) throw new Error('Declared browser screenshot dimensions do not match actual image bytes');
    } else if (Math.abs(metadata.width - viewport.width) > 24 || metadata.height < viewport.height) throw new Error('Browser screenshot dimensions do not match the observed viewport');
    if (!(Array.isArray(document.observedNodes) && document.observedNodes.length) && !(typeof document.documentSnapshot === 'string' && document.documentSnapshot.trim().length >= 50)) throw new Error('Browser evidence needs actual loaded public DOM facts or a document snapshot');
    const html = dom.bytes.toString('utf8');
    if (!/Content-Security-Policy/i.test(html) || !/script-src\s+'none'/i.test(html) || /<(?:script|iframe|object|embed|base|form|button|input|textarea)\b/i.test(html) || /\s(?:on[a-z]+|srcdoc|href|src|srcset|action)\s*=/i.test(html)) throw new Error('Saved browser DOM must be inert public evidence without executable or remote resource attributes');
    const visibleText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (visibleText.length < 30 || /access denied|verify (?:that )?you are human|just a moment|checking your browser|captcha/i.test(`${viewport.title} ${visibleText.slice(0, 1000)}`)) throw new Error('Browser observation does not show usable normal public page content');
    const extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
    files.push({ ...screenshot, destination: `${viewport.name}.${extension}`, kind: 'screenshot' }, { ...dom, destination: `${viewport.name}.html`, kind: 'inert-dom' }, { ...evidence, destination: `${viewport.name}.json`, kind: 'dom-evidence' });
  }
  const missing = ['desktop', 'tablet', 'mobile'].filter(name => !names.has(name));
  if (missing.length && (report.status !== 'partial' || !report.gaps.some(gap => /viewport|responsive|尺寸|tablet|mobile/i.test(`${gap.code} ${gap.message}`)))) throw new Error('Unavailable responsive views must be disclosed as partial browser evidence');
  for (let index = 0; index < report.gaps.length; index++) {
    const gap = report.gaps[index];
    if (gap.evidencePath && !files.some(file => samePath(file.filename, gap.evidencePath!))) {
      const evidence = await localBytes(gap.evidencePath, 10_000_000);
      files.push({ ...evidence, destination: `gap-${index}${path.extname(evidence.filename)}`, kind: 'gap-evidence' });
    }
  }
  const references = path.join(root, 'references');
  await mkdir(references, { recursive: true });
  if (!samePath(await realpath(references), references)) throw new Error('Reference jobs must stay inside the real project references directory');
  const jobId = `reference-${makeRunId(url)}`, jobDir = path.join(references, jobId), referenceDir = path.join(jobDir, 'reference');
  await mkdir(jobDir); await mkdir(referenceDir);
  const relocated = await relocateReferenceEvidence({ root, sourceReportPath: reportFile.filename, destinationDirectory: referenceDir, expectedReportSha256: hash(reportFile.bytes), expectedSourceUrl: url, sourceProvenancePath: provenanceFile.filename, expectedArtifactHashes: files.map(file => ({ path: file.filename, sha256: hash(file.bytes) })), normalizeObservedScenes: true });
  const imported = relocated.report;
  const records = relocated.manifest.artifacts.filter(record => record.kind !== 'report').map(record => ({ kind: record.kind, file: record.destinationPath, sourceSha256: record.sourceSha256, sha256: record.sha256 }));
  await writeJson(path.join(referenceDir, 'observation-provenance.json'), {
    ...provenance, importedAt: new Date().toISOString(), sourceReportSha256: hash(reportFile.bytes), sourceProvenanceSha256: hash(provenanceFile.bytes),
    notice: 'These files are public facts observed in the already-opened user browser. The loaded page is checked from its recorded URL, DOM and screenshot bytes; no separate user confirmation, session, cookie or challenge solution is imported. Missing views remain disclosed.', artifacts: records,
  });
  const common = { version: 1 as const, jobId, url, jobDir, referencePath: imported.artifactPath, referenceReportSha256: hash(await readFile(imported.artifactPath)) };
  const job: ReferencePreparedJob | FidelityPreparedJob = historicalOriginal
    ? { ...common, workflow: 'reference-to-original', status: 'awaiting-business-profile', profilePath: path.join(jobDir, 'business-profile.json') }
    : { ...common, workflow: 'block-replication', mode: 'replica', status: 'awaiting-block-contract', contractPath: path.join(jobDir, 'block-contract.json'), assetsManifestPath: path.join(jobDir, 'asset-manifest.json'), programPath: path.join(jobDir, 'program.json') };
  await writeJson(path.join(jobDir, 'job.json'), job);
  return job;
}
