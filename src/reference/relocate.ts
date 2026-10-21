import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import type { ReferenceCaptureReport } from './types.js';
import { normalizeSourceScene } from './source-scene.js';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const identity = (filename: string) => path.resolve(filename).toLowerCase();
const fields = new Map([
  ['screenshotPath', 'screenshotSha256'], ['evidencePath', 'evidenceSha256'],
  ['domPath', 'domSha256'], ['packetPath', 'packetSha256'],
  ['sourceEvidencePath', 'sourceEvidenceSha256'], ['sourceScreenshotPath', 'sourceScreenshotSha256'],
  ['probePath', 'probeSha256'], ['responsiveEvidencePath', 'responsiveEvidenceSha256'],
  ['boundaryEvidencePath', 'boundaryEvidenceSha256'], ['sourcePacketPath', 'sourcePacketSha256'],
  ['artifactPath', 'artifactSha256'],
]);
const arrayFields = new Set(['evidence', 'evidencePaths', 'packetPaths', 'screenshotPaths']);
const packetOwners = new Set(['packet', 'packets', 'evidencePacket', 'evidencePackets', 'sourcePacket', 'sourcePackets', 'probePacket', 'probePackets', 'artifacts']);
const forbiddenKeys = /^(?:cookies?|set-cookie|authorization|storageState|localStorage|sessionStorage|accessToken|consumer_secret|wp_app_password)$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const localReference = (value: string) => !/^[a-z][a-z\d+.-]*:/i.test(value) || /^[a-z]:[\\/]/i.test(value);
const splitReference = (value: string) => { const index = value.indexOf('#'); return index < 0 ? { filename: value, fragment: '' } : { filename: value.slice(0, index), fragment: value.slice(index) }; };
const evidenceReference = (value: string) => /^[a-z]:[\\/]|^[\\/]|^\.\.?[\\/]/i.test(value) || /^[^\s]+\.(?:json|html|png|jpe?g|webp|txt)(?:#.*)?$/i.test(value);

export interface RelocatedEvidenceRecord {
  sourcePath: string; destinationPath: string; sourceSha256: string; sha256: string; bytes: number;
  kind: 'report' | 'screenshot' | 'inert-dom' | 'dom-evidence' | 'gap-evidence';
  sourceUrl: string; capturedAt: string; viewports: Array<{ name: string; width: number; height: number }>;
}
export interface EvidenceRelocationManifest {
  version: 1; method: 'immutable-public-evidence-relocation'; migratedAt: string;
  sourceUrl: string; capturedAt: string; sourceReportPath: string; sourceDeclaredArtifactPath: string;
  sourceReportSha256: string; reportPath: string; reportSha256: string;
  sourceProvenance?: { path: string; sha256: string; document: Record<string, unknown> };
  missingSceneInventories: string[]; artifacts: RelocatedEvidenceRecord[];
  notice: string;
}
export interface RelocateReferenceOptions {
  root: string; sourceReportPath: string; destinationDirectory: string;
  expectedReportSha256?: string; expectedSourceUrl?: string; sourceProvenancePath?: string;
  expectedArtifactHashes?: Array<{ path: string; sha256: string }>;
  /** Fresh browser intake may normalize independently collected sourceScene facts. Historical migration never opts in. */
  normalizeObservedScenes?: boolean;
}
type Edge = { object: Record<string, unknown>; field: string; target: string; fragment: string; hashField?: string };
type Node = { filename: string; bytes: Buffer; document?: Record<string, unknown>; edges: Edge[]; contexts: Set<string>; destination?: string; output?: Buffer };

/** Copy the complete public evidence dependency graph into one owned job. Only typed path fields are rewritten. */
export async function relocateReferenceEvidence(options: RelocateReferenceOptions): Promise<{ report: ReferenceCaptureReport; reportPath: string; reportSha256: string; manifestPath: string; manifest: EvidenceRelocationManifest }> {
  const root = await realpath(path.resolve(options.root));
  const checked = async (filename: string, mustExist = true) => {
    const absolute = path.resolve(root, filename), relative = path.relative(root, absolute);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Public evidence relocation must stay inside the project root');
    if (relative.split(path.sep).some(part => /^(?:config|node_modules|\.git)$/i.test(part)) || /(?:credential|cookie|storage-state|auth-token)/i.test(path.basename(absolute))) throw new Error('Only public evidence artifacts may be relocated');
    if (mustExist && identity(await realpath(absolute)) !== identity(absolute)) throw new Error('Public evidence relocation refuses symlink escapes');
    return absolute;
  };
  const sourceReportPath = await checked(options.sourceReportPath);
  const destination = await checked(options.destinationDirectory, false);
  // Check the nearest existing ancestor before creating any destination directory.
  let ancestor = destination;
  while (true) { try { if (identity(await realpath(ancestor)) !== identity(ancestor)) throw new Error('Public evidence destination refuses symlink escapes'); break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); } }
  const reportBytes = await readFile(sourceReportPath);
  if (options.expectedReportSha256 && sha(reportBytes) !== options.expectedReportSha256) throw new Error('Source report byte hash mismatch');
  const report = JSON.parse(reportBytes.toString('utf8')) as ReferenceCaptureReport;
  if (report.version !== 1 || !Array.isArray(report.viewports) || !report.url || !Number.isFinite(Date.parse(report.capturedAt)) || options.expectedSourceUrl && options.expectedSourceUrl !== report.url) throw new Error('A valid source capture report and matching source URL are required');
  const nodes = new Map<string, Node>(), rootId = identity(sourceReportPath);
  const readNode = async (filename: string, contexts = new Set<string>()): Promise<Node> => {
    const absolute = await checked(filename), id = identity(absolute), existing = nodes.get(id);
    if (existing) { for (const context of contexts) existing.contexts.add(context); return existing; }
    if (!/\.(?:json|html|png|jpe?g|webp|txt)$/i.test(absolute)) throw new Error('Unsupported public evidence artifact type');
    const information = await stat(absolute);
    if (!information.isFile() || information.size < 1 || information.size > 30_000_000) throw new Error('Public evidence must be a nonempty regular file within its size limit');
    if (nodes.size >= 4096) throw new Error('Public evidence dependency graph exceeds its safe bound');
    const bytes = id === rootId ? reportBytes : await readFile(absolute), document = /\.json$/i.test(absolute) ? JSON.parse(bytes.toString('utf8')) : undefined;
    if (document !== undefined && !isRecord(document)) throw new Error('Public JSON evidence must contain an object');
    const node: Node = { filename: absolute, bytes, document, edges: [], contexts: new Set(contexts) }; nodes.set(id, node);
    const walk = async (value: unknown, owner = ''): Promise<void> => {
      if (Array.isArray(value)) { for (const entry of value) await walk(entry, owner); return; }
      if (!isRecord(value)) return;
      for (const [key, child] of Object.entries(value)) {
        if (forbiddenKeys.test(key)) throw new Error('Public evidence must not contain authentication or session exports');
        const packetPath = packetOwners.has(owner) && (key === 'path' || key === 'file');
        if ((fields.has(key) || packetPath) && typeof child === 'string' && !localReference(child)) throw new Error('Evidence path fields must name local public artifact files');
        if ((fields.has(key) || packetPath) && typeof child === 'string' && localReference(child)) {
          const reference = splitReference(child);
          // artifactPath declares this document's identity, even when a historical copy retained an old declaration.
          const target = key === 'artifactPath' ? absolute : path.resolve(path.dirname(absolute), reference.filename);
          const dependency = await readNode(target, node.contexts), hashField = packetPath ? 'sha256' : fields.get(key)!;
          const expected = value[hashField];
          if (expected !== undefined && (typeof expected !== 'string' || expected !== sha(dependency.bytes))) throw new Error(`Public evidence byte hash mismatch for ${key}`);
          node.edges.push({ object: value, field: key, target: identity(target), fragment: reference.fragment, ...(expected !== undefined ? { hashField } : {}) });
        } else if (arrayFields.has(key) && Array.isArray(child)) {
          for (let index = 0; index < child.length; index++) {
            const entry = child[index];
            if (typeof entry === 'string' && localReference(entry) && evidenceReference(entry)) {
              const reference = splitReference(entry), target = path.resolve(path.dirname(absolute), reference.filename);
              await readNode(target, node.contexts);
              node.edges.push({ object: child as unknown as Record<string, unknown>, field: String(index), target: identity(target), fragment: reference.fragment });
            } else await walk(entry, key);
          }
        } else await walk(child, key);
      }
    };
    if (document) await walk(document);
    return node;
  };
  await readNode(sourceReportPath);
  for (const attestation of options.expectedArtifactHashes ?? []) {
    const node = nodes.get(identity(await checked(attestation.path)));
    if (!node || sha(node.bytes) !== attestation.sha256) throw new Error('Validated source artifact byte hash mismatch');
  }
  // Propagate actual report viewport associations through shared transitive dependencies.
  for (const view of report.viewports) for (const field of ['evidencePath', 'screenshotPath', 'domPath'] as const) {
    if (typeof view[field] !== 'string') continue;
    const id = identity(path.resolve(path.dirname(sourceReportPath), splitReference(view[field]).filename));
    const visit = (nodeId: string, visited = new Set<string>()) => { if (visited.has(nodeId)) return; visited.add(nodeId); const node = nodes.get(nodeId); if (!node) return; node.contexts.add(view.name); for (const edge of node.edges) visit(edge.target, visited); }; visit(id);
  }
  let sourceProvenance: EvidenceRelocationManifest['sourceProvenance'];
  if (options.sourceProvenancePath) { const filename = await checked(options.sourceProvenancePath), bytes = await readFile(filename), document = JSON.parse(bytes.toString('utf8')); if (!isRecord(document)) throw new Error('Invalid observation provenance'); const rejectSessions = (value: unknown): void => { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { if (forbiddenKeys.test(key)) throw new Error('Observation provenance must not include authentication or session exports'); rejectSessions(child); } }; rejectSessions(document); sourceProvenance = { path: filename, sha256: sha(bytes), document }; }
  const basenames = new Map<string, number>();
  for (const [id, node] of nodes) if (id !== rootId) { const base = path.basename(node.filename).toLowerCase(); basenames.set(base, (basenames.get(base) ?? 0) + 1); }
  for (const [id, node] of nodes) {
    const base = path.basename(node.filename), extension = path.extname(base), stem = base.slice(0, -extension.length);
    const collision = (basenames.get(base.toLowerCase()) ?? 0) > 1 || /^(?:report|evidence-relocation-manifest|observation-provenance)\.json$/i.test(base);
    node.destination = path.join(destination, id === rootId ? 'report.json' : collision ? `${stem}-${sha(id).slice(0, 16)}${extension}` : base);
  }
  for (const node of nodes.values()) for (const edge of node.edges) edge.object[edge.field] = `${nodes.get(edge.target)!.destination}${edge.fragment}`;
  const missingSceneInventories: string[] = [];
  for (const view of report.viewports) {
    const owner = nodes.get(identity(path.resolve(path.dirname(sourceReportPath), splitReference(view.evidencePath).filename)));
    if (!owner?.document) continue;
    if (options.normalizeObservedScenes) {
      const screenshot = nodes.get(identity(path.resolve(path.dirname(sourceReportPath), splitReference(view.screenshotPath).filename)));
      const inventory = normalizeSourceScene(owner.document.sourceScene, { sourceUrl: report.url, capturedAt: report.capturedAt, evidencePath: owner.destination!, viewportName: view.name, deviceProfile: view.deviceFacts?.profile, screenshotPath: screenshot?.destination, screenshotSha256: screenshot ? sha(screenshot.bytes) : undefined });
      if (inventory) owner.document.sceneInventory = inventory;
      else delete owner.document.sceneInventory;
    }
    if (!isRecord(owner.document.sceneInventory)) missingSceneInventories.push(view.name);
  }
  const migrated = nodes.get(rootId)!.document as unknown as ReferenceCaptureReport;
  if (missingSceneInventories.length) {
    migrated.status = migrated.status === 'blocked' ? 'blocked' : 'partial';
    migrated.gaps ??= [];
    for (const viewport of missingSceneInventories) if (!migrated.gaps.some(gap => gap.code === 'legacy-scene-inventory-missing' && gap.viewport === viewport)) migrated.gaps.push({ code: 'legacy-scene-inventory-missing', viewport, message: 'Historical evidence has no independent source scene inventory. Migration preserves historical facts only; fresh public observation is required before completeness can pass.' });
  }
  const finalize = (id: string, ancestors = new Set<string>()): Buffer => {
    const node = nodes.get(id)!; if (node.output) return node.output;
    if (ancestors.has(id)) throw new Error('Cyclic evidence byte-hash dependencies cannot be relocated');
    const next = new Set(ancestors).add(id);
    for (const edge of node.edges) if (edge.hashField) edge.object[edge.hashField] = sha(finalize(edge.target, next));
    return node.output = node.document ? Buffer.from(`${JSON.stringify(node.document, null, 2)}\n`) : node.bytes;
  };
  for (const id of nodes.keys()) finalize(id);
  // Validation and dependency hashing finish before the first write. Never overwrite an existing job.
  await mkdir(destination, { recursive: true });
  for (const node of nodes.values()) await writeFile(node.destination!, node.output!, { flag: 'wx' });
  const artifacts: RelocatedEvidenceRecord[] = [...nodes.entries()].map(([id, node]) => ({ sourcePath: node.filename, destinationPath: node.destination!, sourceSha256: sha(node.bytes), sha256: sha(node.output!), bytes: node.output!.length, kind: id === rootId ? 'report' : /\.(?:png|jpe?g|webp)$/i.test(node.filename) ? 'screenshot' : /\.html$/i.test(node.filename) ? 'inert-dom' : 'dom-evidence', sourceUrl: report.url, capturedAt: report.capturedAt, viewports: report.viewports.filter(view => node.contexts.has(view.name)).map(({ name, width, height }) => ({ name, width, height })) }));
  const reportPath = nodes.get(rootId)!.destination!, reportSha256 = sha(nodes.get(rootId)!.output!);
  const manifest: EvidenceRelocationManifest = { version: 1, method: 'immutable-public-evidence-relocation', migratedAt: new Date().toISOString(), sourceUrl: report.url, capturedAt: report.capturedAt, sourceReportPath, sourceDeclaredArtifactPath: report.artifactPath, sourceReportSha256: sha(reportBytes), reportPath, reportSha256, ...(sourceProvenance ? { sourceProvenance } : {}), missingSceneInventories, artifacts, notice: 'Source bytes are never changed. Destination paths and dependent byte hashes are rewritten only in declared evidence path fields. Historical capture times remain historical; missing independent inventories require fresh observation.' };
  const manifestPath = path.join(destination, 'evidence-relocation-manifest.json'); await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { report: migrated, reportPath, reportSha256, manifestPath, manifest };
}
