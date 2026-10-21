import path from 'node:path';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assertPublicUrl } from '../capture/url-safety.js';
import { makeRunId, writeJson } from '../core/files.js';
import { redactor } from '../core/config.js';
import { insideProject } from '../original/validate.js';
import { captureReference } from './capture.js';
import type { ReferencePreparedJob } from './types.js';
import type { FidelityPreparedJob } from '../fidelity/types.js';

type PrepareOptions = {
  root?: string; onProgress?: (message: string) => void;
  /** Dependency injection for offline capture contract tests; not a CLI option. */
  capture?: typeof captureReference;
};
/** URL-only active route: capture source blocks before authoring, with no business profile or target authentication. */
export async function prepareReference(url: string, options: PrepareOptions = {}): Promise<FidelityPreparedJob> {
  return prepareJob(url, options, false) as Promise<FidelityPreparedJob>;
}
/** Historical original-design fixtures have an explicit entry and cannot be reached from the active reference CLI. */
export async function prepareOriginalReference(url: string, options: PrepareOptions = {}): Promise<ReferencePreparedJob> {
  return prepareJob(url, options, true) as Promise<ReferencePreparedJob>;
}
async function prepareJob(url: string, options: PrepareOptions, historicalOriginal: boolean): Promise<ReferencePreparedJob | FidelityPreparedJob> {
  await assertPublicUrl(url);
  const root = await realpath(path.resolve(options.root ?? process.cwd()));
  const references = path.join(root, 'references');
  await mkdir(references, { recursive: true });
  if (path.resolve(await realpath(references)).toLowerCase() !== references.toLowerCase()) throw new Error('Reference jobs must stay inside the project references directory');
  const jobId = `reference-${makeRunId(url)}`, jobDir = path.join(references, jobId);
  await mkdir(jobDir);
  if (!historicalOriginal) await writeJson(path.join(jobDir, 'requirement-profile.json'), { version: 2, kind: 'native44-requirement-profile', profile: 'source-requirements-v1', goalProfile: 'component-reference-v1' });
  const common = { version: 1 as const, jobId, url, jobDir, referencePath: path.join(jobDir, 'reference/report.json') };
  const job: ReferencePreparedJob | FidelityPreparedJob = historicalOriginal
    ? { ...common, workflow: 'reference-to-original', status: 'awaiting-business-profile', profilePath: path.join(jobDir, 'business-profile.json') }
    : { ...common, workflow: 'block-replication', mode: 'replica', status: 'awaiting-block-contract', contractPath: path.join(jobDir, 'block-contract.json'), assetsManifestPath: path.join(jobDir, 'asset-manifest.json'), programPath: path.join(jobDir, 'program.json') };
  try {
    options.onProgress?.('read-only-reference-capture');
    const reference = await (options.capture ?? captureReference)(url, { root, referenceDir: path.join(jobDir, 'reference'), onProgress: options.onProgress });
    const reportPath = insideProject(root, reference.artifactPath);
    if (reportPath.toLowerCase() !== job.referencePath.toLowerCase() || (await realpath(reportPath)).toLowerCase() !== reportPath.toLowerCase()) throw new Error('Reference evidence must belong to the new current job');
    job.referenceReportSha256 = createHash('sha256').update(await readFile(reportPath)).digest('hex');
    if (reference.url !== url) throw new Error('The capture report does not match the current reference URL');
    if (reference.status === 'blocked' || !reference.viewports.length) {
      job.status = 'blocked'; job.error = 'The reference has no usable public rendered evidence; no block contract, native program or WordPress page was generated';
    }
  } catch (error) { job.status = 'blocked'; job.error = redactor()(error); }
  await writeJson(path.join(jobDir, 'job.json'), job);
  options.onProgress?.(job.status);
  return job;
}
