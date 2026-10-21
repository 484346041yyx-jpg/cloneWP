import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readJson } from '../core/config.js';
import { writeJson } from '../core/files.js';
import { insideProject, loadOriginalDesign } from '../original/validate.js';
import { businessProfileSchema } from './profile.js';
import type { ReferenceCaptureReport, ReferencePreparedJob } from './types.js';
import type { OriginalNode } from '../original/types.js';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const fileHash = async (file: string) => digest(await readFile(file));
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const explanation = z.string().trim().min(12).max(4000);
export const designRationaleSchema = z.strictObject({
  version: z.literal(1), referenceReportSha256: sha, profileSha256: sha,
  decisions: z.array(z.strictObject({ evidence: z.array(z.string().min(1)).min(1), principle: explanation, application: explanation, targetKeys: z.array(z.string().min(1)).min(1), changeFromProposal: explanation })).min(3).max(30),
  contentNotes: z.array(explanation).min(1).max(30), limitations: z.array(z.string()).max(50),
});
interface ApprovedAsset { key: string; path: string; sha256: string; provenance: string }
export interface OriginalityAudit {
  version: 1; passed: boolean; designPath: string; checkedAt: string;
  designSha256: string; rationaleSha256: string; referenceReportSha256: string; profileSha256: string;
  issues: string[]; approvedAssets: ApprovedAsset[];
  summary: { nativeNodes: number; sections: number; decisions: number; layoutChanged: boolean; sourceMediaImported: false; sourceTreeImported: false };
}
const flatten = (roots: OriginalNode[]): OriginalNode[] => roots.flatMap(node => [node, ...flatten(node.children ?? [])]);
const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const layoutTree = (nodes: OriginalNode[]): unknown => nodes.map(node => ({ kind: node.kind, headingTag: node.headingTag, style: node.style, children: layoutTree(node.children ?? []) }));
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
const canonicalHash = (value: unknown): string => digest(Buffer.from(JSON.stringify(canonical(value))));

export async function checkReferenceDesign(directory: string, options: { root?: string } = {}): Promise<OriginalityAudit> {
  const root = await realpath(path.resolve(options.root ?? process.cwd()));
  const jobDir = insideProject(root, directory);
  insideProject(root, await realpath(jobDir));
  if (!path.relative(path.join(root, 'references'), jobDir) || path.dirname(jobDir).toLowerCase() !== path.join(root, 'references').toLowerCase()) throw new Error('Reference design check requires a current job inside references/');
  const job = await readJson<ReferencePreparedJob>(path.join(jobDir, 'job.json'));
  if (job.workflow !== 'reference-to-original' || job.status !== 'awaiting-codex-design' || path.resolve(job.jobDir).toLowerCase() !== jobDir.toLowerCase()) throw new Error('The job has no usable current reference design task');
  const checkedPath = async (file: string) => { const absolute = insideProject(root, file); insideProject(root, await realpath(absolute)); if (!absolute.toLowerCase().startsWith(`${jobDir.toLowerCase()}${path.sep}`)) throw new Error('Reference job artifacts must stay inside this job'); return absolute; };
  const reportPath = await checkedPath(job.referencePath), profilePath = await checkedPath(job.profilePath);
  const brief = await readJson<{ referenceReportSha256: string; profileSha256: string; profileAssetsSha256: string; proposalSha256: string; evidenceKeys: string[] }>(await checkedPath(job.generationBriefPath!));
  const reference = await readJson<ReferenceCaptureReport>(reportPath), profile = businessProfileSchema.parse(await readJson(profilePath));
  if (reference.url !== job.url) throw new Error('The reference job identity differs from its frozen capture report');
  if (reference.status === 'blocked' || !reference.viewports.length) throw new Error('The reference report contains no usable rendered evidence');
  const designPath = await checkedPath(path.join(jobDir, 'design.json'));
  const rationalePath = await checkedPath(path.join(jobDir, 'design-rationale.json'));
  const design = await loadOriginalDesign(root, designPath);
  const rationale = designRationaleSchema.parse(await readJson(rationalePath));
  const proposalPath = await checkedPath(job.proposalPath!);
  const proposal = await readJson<{ sections: OriginalNode[] }>(proposalPath);
  const referenceReportSha256 = await fileHash(reportPath), profileSha256 = await fileHash(profilePath);
  const issues: string[] = [], nodes = flatten(design.sections), keys = new Set(nodes.map(node => node.key));
  if (brief.referenceReportSha256 !== referenceReportSha256 || brief.profileSha256 !== profileSha256 || rationale.referenceReportSha256 !== referenceReportSha256 || rationale.profileSha256 !== profileSha256) issues.push('Reference, business profile or rationale hashes changed; the design decisions require fresh review');
  if (brief.proposalSha256 !== await fileHash(proposalPath) || brief.profileAssetsSha256 !== await fileHash(path.join(jobDir, 'profile-assets.json'))) issues.push('The frozen proposal or own-media proof changed; prepare a fresh reference job');
  if (design.brand !== profile.brand || design.language !== profile.language) issues.push('The design must retain the saved own brand and language');
  const evidence = new Set(reference.viewports.flatMap(viewport => [`${viewport.name}:layout`, `${viewport.name}:colors`, `${viewport.name}:typography`, `${viewport.name}:navigation`, ...viewport.sections.map(section => `${viewport.name}:${section.id}`)]));
  for (const [index, decision] of rationale.decisions.entries()) {
    if (decision.evidence.some(value => !evidence.has(value) || !brief.evidenceKeys.includes(value))) issues.push(`Decision ${index + 1} cites unavailable reference evidence`);
    if (decision.targetKeys.some(value => !keys.has(value))) issues.push(`Decision ${index + 1} cites missing target nodes`);
  }
  const layoutChanged = canonicalHash(layoutTree(design.sections)) !== canonicalHash(layoutTree(proposal.sections));
  if (!layoutChanged) issues.push('Codex must make and document deliberate layout choices; the unchanged deterministic proposal is not a final authored design');
  const ownAssets = z.array(z.object({ key: z.string().min(1), path: z.string().min(1), sha256: sha, provenance: z.string().trim().min(1) })).parse(await readJson(path.join(jobDir, 'profile-assets.json')));
  if (ownAssets.some(record => !profile.assets.some(asset => asset.key === record.key && path.resolve(root, asset.path).toLowerCase() === path.resolve(root, record.path).toLowerCase() && asset.provenance === record.provenance)) || ownAssets.length !== profile.assets.length) issues.push('Own-media proof differs from the frozen business profile');
  const generatedSchema = z.array(z.strictObject({ key: z.string(), path: z.string(), sha256: sha, origin: z.enum(['ai-generated', 'user-provided']), provenance: explanation, tool: z.string().optional(), prompt: z.string().optional() }));
  let additional: Array<z.infer<typeof generatedSchema>[number]> = [];
  try { additional = generatedSchema.parse(await readJson(path.join(jobDir, 'asset-provenance.json'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const approvedAssets: ApprovedAsset[] = [];
  for (const asset of design.assets) {
    const checksum = await fileHash(asset.path);
    const existing = ownAssets.find(record => record.key === asset.key && record.sha256 === checksum && path.resolve(record.path).toLowerCase() === path.resolve(asset.path).toLowerCase());
    const created = additional.find(record => record.key === asset.key && record.sha256 === checksum && path.resolve(root, record.path).toLowerCase() === path.resolve(asset.path).toLowerCase());
    if (!existing && !created) issues.push(`Image ${asset.key} lacks matching own-media hash and provenance`);
    if (created?.origin === 'ai-generated' && (!created.tool || !created.prompt || created.prompt.trim().length < 12)) issues.push(`Generated image ${asset.key} needs the real generation tool and prompt`);
    if (asset.path.toLowerCase().startsWith(`${path.join(jobDir, 'reference').toLowerCase()}${path.sep}`)) issues.push(`Reference screenshot or source resource cannot become target image ${asset.key}`);
    if (existing || created) approvedAssets.push({ key: asset.key, path: asset.path, sha256: checksum, provenance: (existing ?? created)!.provenance });
  }
  const outputStrings = [design.title, design.description, ...design.assets.map(asset => asset.alt), ...nodes.flatMap(node => [node.text ?? '', node.alt ?? '', ...(node.items ?? []).flatMap(item => [item.title, item.content])])];
  const output = normalize(outputStrings.join(' ')), ownText = normalize(JSON.stringify(profile));
  const referenceText = reference.viewports.flatMap(viewport => [viewport.title, ...viewport.headings.map(heading => heading.text), ...viewport.ctas.map(cta => cta.text), ...viewport.sections.flatMap(section => [section.heading ?? '', section.textPreview ?? ''])]);
  const copied = new Set<string>();
  for (const fragment of referenceText) {
    const words = normalize(fragment).split(' ').filter(Boolean);
    for (let start = 0; start + 12 <= words.length; start++) {
      const span = words.slice(start, start + 12).join(' ');
      if (span.length >= 65 && output.includes(span) && !ownText.includes(span)) copied.add(span);
      if (copied.size >= 3) break;
    }
    if (copied.size >= 3) break;
  }
  if (copied.size) issues.push(`Output contains ${copied.size} long verbatim reference passages absent from the own business profile`);
  const sourceHost = new URL(job.url).hostname.replace(/^www\./, '').split('.').slice(0, -1).join(' ');
  if (normalize(sourceHost).replace(/ /g, '').length >= 5 && output.replace(/ /g, '').includes(normalize(sourceHost).replace(/ /g, '')) && !ownText.replace(/ /g, '').includes(normalize(sourceHost).replace(/ /g, ''))) issues.push('The output appears to import the reference website identity');
  const serialized = JSON.stringify(design);
  const remoteImages = new Set(reference.viewports.flatMap(viewport => viewport.images.map(image => image.url)).filter(url => /^https?:\/\//.test(url)));
  if ([...remoteImages].some(url => serialized.includes(url)) || serialized.includes(job.url)) issues.push('Reference page or media URLs appear in the target design');
  if (profile.demo && !/demonstration|demo brand|示范|演示/i.test(outputStrings.join(' '))) issues.push('The demonstration business needs a visible truthful demonstration notice');
  const audit: OriginalityAudit = { version: 1, passed: issues.length === 0, designPath, checkedAt: new Date().toISOString(), designSha256: await fileHash(designPath), rationaleSha256: await fileHash(rationalePath), referenceReportSha256, profileSha256, issues, approvedAssets, summary: { nativeNodes: nodes.length, sections: design.sections.length, decisions: rationale.decisions.length, layoutChanged, sourceMediaImported: false, sourceTreeImported: false } };
  await writeJson(path.join(jobDir, 'originality-audit.json'), audit);
  return audit;
}

/** Enforce the matching reference review before any WordPress credentials are loaded. */
export async function assertReferenceDesignApproved(root: string, filename: string, loadedDesign?: unknown): Promise<OriginalityAudit | undefined> {
  const file = path.resolve(root, filename), referenceRoot = path.join(root, 'references');
  if (!file.toLowerCase().startsWith(`${referenceRoot.toLowerCase()}${path.sep}`)) return;
  const audit = await checkReferenceDesign(path.dirname(file), { root });
  if (path.basename(file) !== 'design.json' || !audit.passed || audit.designSha256 !== await fileHash(file)) throw new Error(`Reference-derived design has not passed current originality checks: ${audit.issues.join('; ')}`);
  if (loadedDesign && canonicalHash(loadedDesign) !== canonicalHash(await loadOriginalDesign(root, file))) throw new Error('The reference design changed between validation and construction');
  return audit;
}
