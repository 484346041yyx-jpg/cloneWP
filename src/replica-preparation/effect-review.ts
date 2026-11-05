import path from 'node:path';
import { z } from 'zod';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import type { FullReplicaManifest, FullReplicaFileRef } from '../replica-full/types.js';
import { native44ModuleClass, native44Id } from '../native44/adapters.js';
import { readObservationDirectoryV2 } from '../replica-v2/observation.js';
import { buildSourceFactsV2 } from '../replica-v2/source.js';
import { assertEffectFindings, checkEffectRender, projectEffectLayouts, effectProbeSchema, effectRefSchema, effectTargetBindingSchema, type EffectFinding } from './effect-trace.js';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const rowSchema = effectProbeSchema.extend({
  snapshotId: z.string(), viewport: z.object({ width: z.number(), height: z.number(), clientWidth: z.number(), devicePixelRatio: z.number() }).strict(),
  expected: z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))]),
  sourceScreenshot: effectRefSchema.extend({ width: z.number(), height: z.number() }),
  sourceEvidence: z.array(effectRefSchema).min(1),
});
const traceSchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-source-effect-trace'), taskId: z.string(), runId: z.string(),
  rows: z.array(rowSchema), implementations: z.record(z.string(), z.string()),
}).strict();
const batch = z.object({ observation: effectRefSchema, bindings: z.array(effectTargetBindingSchema).min(1) }).strict();
const reviewSchema = z.object({
  version: z.literal(1), pageId: z.number().int().positive(), fingerprint: sha,
  frontend: z.array(batch).min(1), elementor: z.array(batch.extend({ editorFrame: effectRefSchema })).min(1),
}).strict();

const editorFrameSchema = z.object({ url: z.url(), observedAt: z.iso.datetime(), html: z.string().min(1), width: z.number().positive(), height: z.number().positive() }).strict();
function matchesEditorFrame(frame: z.infer<typeof editorFrameSchema>, target: string, pageId: number, reviewed: number) {
  const editor = new URL(frame.url), preview = new URL(target), observed = Date.parse(frame.observedAt);
  if (!cleanUrl(frame.url) || editor.origin !== preview.origin || !editor.pathname.endsWith('/wp-admin/post.php') || editor.searchParams.get('post') !== String(pageId) || editor.searchParams.get('action') !== 'elementor' || observed > reviewed || reviewed - observed > 60 * 60 * 1000) return false;
  const nodes: DefaultTreeAdapterMap['node'][] = [parse(frame.html)];
  let count = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if ('childNodes' in node) nodes.push(...node.childNodes);
    if (!('tagName' in node) || node.tagName !== 'iframe' || !node.attrs.some(attribute => attribute.name === 'id' && attribute.value === 'elementor-preview-iframe')) continue;
    const src = node.attrs.find(attribute => attribute.name === 'src')?.value;
    if (src && cleanUrl(new URL(src, editor).href) === cleanUrl(preview.href)) count++;
  }
  return count === 1;
}

type Input = {
  manifest: FullReplicaManifest; pageId: number; fingerprint: string; observedAt: string;
  evidence: unknown; base: string; frontUrls: Set<string>;
  read: (ref: FullReplicaFileRef, base?: string) => Promise<{ filename: string; bytes: Buffer }>;
};
const cleanUrl = (value: string) => {
  const url = new URL(value); url.hash = '';
  if (url.username || url.password || [...url.searchParams.keys()].some(key => /nonce|token|secret|password|authorization/i.test(key))) return '';
  return url.href;
};

export async function verifyEffectReview(input: Input) {
  const traceRef = input.manifest.effectTrace;
  if (!traceRef) return;
  const trace = traceSchema.parse(JSON.parse((await input.read(traceRef)).bytes.toString('utf8')));
  if (trace.taskId !== input.manifest.taskId || trace.runId !== input.manifest.runId) throw Error('replica_full_effect_trace_identity');
  if (!trace.rows.length) return;
  const parsed = reviewSchema.safeParse(input.evidence);
  if (!parsed.success || parsed.data.pageId !== input.pageId || parsed.data.fingerprint !== input.fingerprint) {
    assertEffectFindings(trace.rows.map(row => ({ stage: 'review', section: row.section, effectId: row.id, label: row.label, code: 'paired-frontend-elementor-evidence-required' })));
    return;
  }
  const review = parsed.data, findings: EffectFinding[] = [], frontUrls = new Set([...input.frontUrls].map(cleanUrl));
  const rowsById = new Map(trace.rows.map(row => [row.id, row]));
  for (const surface of ['frontend', 'elementor'] as const) {
    const seen = new Set<string>();
    for (const item of review[surface]) {
      const rows = item.bindings.map(binding => {
        const row = rowsById.get(binding.effectId);
        if (!row || seen.has(row.id)) throw Error('replica_full_effect_review_duplicate_or_unknown');
        seen.add(row.id);
        return row;
      });
      try {
        const file = await input.read(item.observation, input.base);
        const observation = await readObservationDirectoryV2(path.dirname(file.filename), undefined, { manifestName: path.basename(file.filename) });
        const address = observation.manifest.sourceUrl, url = new URL(address);
        const expected = surface === 'frontend' ? frontUrls.has(cleanUrl(address)) && !url.searchParams.has('elementor-preview') : url.searchParams.get('elementor-preview') === String(input.pageId);
        if (!cleanUrl(address) || !expected || url.origin !== input.manifest.targetOrigin || observation.manifestSha256 !== item.observation.sha256 || observation.manifest.provenance.method === 'public-capture') throw Error('identity');
        const reviewed = Date.parse(input.observedAt);
        if (surface === 'elementor') {
          const editorFrame = 'editorFrame' in item ? item.editorFrame : undefined;
          if (!editorFrame) throw Error('editor-frame-missing');
          const shell = editorFrameSchema.parse(JSON.parse((await input.read(editorFrame, input.base)).bytes.toString('utf8')));
          if (!matchesEditorFrame(shell, address, input.pageId, reviewed) || observation.packets.some(packet => packet.snapshot.viewport.width !== shell.width || packet.snapshot.viewport.height !== shell.height)) throw Error('editor-frame-mismatch');
        }
        if (observation.packets.some(packet => { const time = Date.parse(packet.snapshot.capturedAt); return time > reviewed || reviewed - time > 60 * 60 * 1000; })) throw Error('stale');
        const target = projectEffectLayouts(buildSourceFactsV2(observation), observation.packets, observation.packetFiles);
        findings.push(...checkEffectRender(rows, surface, target, item.bindings, (view, fact, row) => {
          const key = trace.implementations[row.id];
          if (!key) return false;
          const classes = [native44ModuleClass(key), `elementor-element-${native44Id(trace.taskId, key)}`];
          const visited = new Set<string>();
          for (let node: string | null = fact.nodeId; node && !visited.has(node); node = view.nodes[node]?.parentId ?? null) {
            visited.add(node);
            const list = view.nodes[node]?.attributes?.class?.split(/\s+/) ?? [];
            if (classes.some(cls => list.includes(cls))) return true;
          }
          return false;
        }));
      } catch {
        for (const row of rows) findings.push({ stage: 'review', surface, section: row.section, effectId: row.id, label: row.label, code: 'target-observation-invalid-stale-or-wrong-page' });
      }
    }
    for (const row of trace.rows) if (!seen.has(row.id)) findings.push({ stage: 'review', surface, section: row.section, effectId: row.id, label: row.label, code: 'effect-not-reviewed-on-surface' });
  }
  assertEffectFindings(findings);
}
