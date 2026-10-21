// Current Pet task only. Assemble already captured public evidence locally;
// never fetch a resource, authenticate, import media or write WordPress.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { observationCountsV2, readObservationDirectoryV2, validateObservationPacketV2 } from '../src/replica-v2/observation.ts';
import { assertSourceFactsExtensionV2, buildSourceFactsV2, validateSourceFactsV2, verifySourceFactsEvidenceV2 } from '../src/replica-v2/source.ts';
import { validateSceneInventoryV2 } from '../src/replica-v2/scene-inventory.ts';
export { resolvePetResponsiveAssetV2 } from './pet-v2-responsive-assets.mjs';

const project = 'D:/cloneWP';
const defaultJob = project + '/references/reference-v2-2026-10-15T04-35-43-856Z-www-petsupermarket-com-67f02b1e';
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const normalizeUrl = value => { const url = new URL(value); url.hash = ''; return url.href; };
function inside(root, filename) { const relative = path.relative(root, filename); if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('Responsive evidence must stay in its explicit current project/task directory'); return filename; }
async function localFile(root, filename, limit = 50_000_000) {
  const absolute = inside(root, path.resolve(root, filename)), actual = await fs.realpath(absolute); inside(root, actual);
  if (actual.toLowerCase() !== absolute.toLowerCase()) throw Error('Responsive evidence cannot redirect through a symbolic link');
  const stat = await fs.stat(actual); if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw Error('Responsive evidence file is empty or exceeds its bounded size');
  return { path: actual, bytes: await fs.readFile(actual) };
}
async function immutableFile(filename, bytes) {
  try { await fs.writeFile(filename, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; if (!Buffer.from(await fs.readFile(filename)).equals(Buffer.from(bytes))) throw Error(`Immutable responsive output already has different bytes: ${path.basename(filename)}`); }
}
function decodeBridge(bytes) {
  let value = JSON.parse(bytes.toString('utf8'));
  for (let pass = 0; pass < 4; pass++) {
    if (typeof value === 'string') value = JSON.parse(value);
    else if (Array.isArray(value) && value.length && value.every(part => typeof part === 'string' && part.length <= 80000)) value = JSON.parse(value.join(''));
    else return value;
  }
  throw Error('Responsive bridge output has excessive serialization wrappers');
}
function unpackPackets(value) {
  if (value?.kind === 'observation-packet') return [value];
  if (value?.kind === 'observation-transport' && Array.isArray(value.chunks) && value.chunks.length) return value.chunks.map(chunk => {
    if (typeof chunk.json !== 'string') throw Error('Responsive transport chunk has no serialized packet');
    const packet = JSON.parse(chunk.json);
    if (chunk.snapshotId && chunk.snapshotId !== packet.snapshot?.id || chunk.regionIds && !equal(chunk.regionIds, packet.regions?.map(region => region.id))) throw Error('Responsive transport chunk identities disagree with its actual packet');
    return packet;
  });
  throw Error('Responsive file is neither a complete packet nor a serialized observation transport');
}
async function validateAssets(jobDir, manifest) {
  if (!Array.isArray(manifest.assets) || new Set(manifest.assets.map(asset => asset.key)).size !== manifest.assets.length) throw Error('Responsive asset manifest needs unique actual asset keys');
  for (const asset of manifest.assets) {
    const file = await localFile(jobDir, asset.localPath, 20 * 1024 * 1024); if (sha(file.bytes) !== asset.sha256) throw Error(`Current-task asset bytes changed: ${asset.key}`);
    const metadata = await sharp(file.bytes, { limitInputPixels: 80_000_000 }).metadata(), mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', ...(metadata.format === 'heif' && metadata.compression === 'av1' ? { heif: 'image/avif' } : {}) }[metadata.format];
    if (!mime || mime !== asset.mediaType || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw Error(`Responsive asset is not actual safe static raster media: ${asset.key}`);
    if (asset.originalSourcePath || asset.originalSha256) {
      if (!asset.originalSourcePath || !asset.originalSha256) throw Error(`Converted responsive media requires its actual original bytes: ${asset.key}`);
      const original = await localFile(jobDir, asset.originalSourcePath, 20 * 1024 * 1024); if (sha(original.bytes) !== asset.originalSha256) throw Error(`Original responsive asset bytes changed: ${asset.key}`);
    }
  }
}

/** Capture directories contain capture-meta.json, already serialized packets,
 * the actual screenshot, and an independently collected whole-body inventory. */
export async function appendPetResponsiveV2(options = {}) {
  const root = await fs.realpath(project), jobDir = await fs.realpath(options.jobDir ?? defaultJob); inside(path.join(root, 'references'), jobDir);
  const disk = await fs.statfs(jobDir); if (disk.bavail * disk.bsize < 512 * 1024 * 1024) throw Error('Responsive evidence assembly requires at least 512 MiB free space; no historical files are removed automatically');
  const revision = options.revision ?? 'responsive'; if (!/^[a-z][a-z0-9-]{0,60}$/.test(revision) || revision === 'desktop') throw Error('Responsive revision needs a distinct safe immutable name');
  const captureDirectories = options.captureDirectories ?? [];
  if (!Array.isArray(captureDirectories) || !captureDirectories.length) throw Error('Supply actual new capture directories; no source state is inferred');
  const previousFile = await localFile(jobDir, options.previousFactsFile ?? 'source-facts.json'), previous = validateSourceFactsV2(JSON.parse(previousFile.bytes.toString('utf8')));
  await verifySourceFactsEvidenceV2(previous);
  const referenceDir = await fs.realpath(path.dirname(previous.observation.path)); inside(jobDir, referenceDir);
  const base = await readObservationDirectoryV2(referenceDir, previous.sourceUrl, { manifestName: path.basename(previous.observation.path) });
  const baseManifestBytes = await fs.readFile(base.manifestPath), assetsFile = await localFile(jobDir, options.assetsManifestFile ?? 'asset-manifest.json'), baseAssets = JSON.parse(assetsFile.bytes.toString('utf8'));
  await validateAssets(jobDir, baseAssets);
  const assets = structuredClone(baseAssets.assets), captures = [], staged = [], seenSnapshots = new Set(previous.snapshots.map(snapshot => snapshot.id));
  const manifest = { ...structuredClone(base.manifest), sceneInventories: [...(base.manifest.sceneInventories ?? [])] };
  const expectedRegions = new Set(base.packets.filter(packet => packet.snapshot.viewport.name === 'desktop').flatMap(packet => packet.regions.map(region => region.id)));
  for (const captureDirectory of captureDirectories) {
    const directory = await fs.realpath(path.resolve(root, captureDirectory)); inside(path.join(root, 'references'), directory);
    const metaFile = await localFile(directory, 'capture-meta.json', 100_000), meta = JSON.parse(metaFile.bytes.toString('utf8'));
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,120}$/.test(meta.snapshotId ?? '') || !/^[A-Za-z][A-Za-z0-9_-]{0,100}$/.test(meta.viewportName ?? '') || meta.viewportName === 'desktop' || seenSnapshots.has(meta.snapshotId) || meta.sourceUrl && normalizeUrl(meta.sourceUrl) !== normalizeUrl(previous.sourceUrl)) throw Error('Responsive capture metadata needs a new real snapshot, non-desktop viewport name and the same actual source URL');
    if (!Array.isArray(meta.packetFiles) || !meta.packetFiles.length || new Set(meta.packetFiles).size !== meta.packetFiles.length) throw Error('Capture metadata must enumerate actual unique packetFiles');
    seenSnapshots.add(meta.snapshotId);
    const screenshot = await localFile(directory, meta.screenshotFile ?? 'source.jpg', 30_000_000), image = await sharp(screenshot.bytes, { limitInputPixels: 120_000_000 }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(image.format) || !image.width || !image.height || (image.pages ?? 1) !== 1) throw Error('Responsive source screenshot is not one actual static image');
    const screenshotName = `${revision}-${meta.snapshotId}-${sha(screenshot.bytes).slice(0, 12)}.${image.format === 'jpeg' ? 'jpg' : image.format}`, screenshotInfo = { path: screenshotName, sha256: sha(screenshot.bytes), width: image.width, height: image.height };
    manifest.screenshots.push({ path: screenshotName, sha256: screenshotInfo.sha256, snapshotId: meta.snapshotId }); staged.push({ filename: path.join(referenceDir, screenshotName), bytes: screenshot.bytes });
    const packets = [], regionIds = new Set(); let commonSnapshot;
    for (const inputName of meta.packetFiles) {
      const file = await localFile(directory, inputName);
      for (const raw of unpackPackets(decodeBridge(file.bytes))) {
        if (raw.snapshot?.id !== meta.snapshotId || raw.snapshot?.viewport?.name !== meta.viewportName || normalizeUrl(raw.snapshot.url) !== normalizeUrl(previous.sourceUrl)) throw Error('Responsive metadata does not identify the actual captured packet snapshot');
        const oldScreenshot = raw.snapshot.screenshot;
        if (!oldScreenshot || oldScreenshot.sha256 !== '0'.repeat(64) && (oldScreenshot.sha256 !== screenshotInfo.sha256 || oldScreenshot.width !== image.width || oldScreenshot.height !== image.height)) throw Error('Responsive packet is already bound to a different source screenshot');
        if (meta.capturedAt && raw.snapshot.capturedAt !== meta.capturedAt || meta.viewport && Object.entries(meta.viewport).some(([key, value]) => raw.snapshot.viewport[key] !== value)) throw Error('Responsive capture-meta conflicts with actually measured packet time or viewport');
        const packet = validateObservationPacketV2({ ...raw, snapshot: { ...raw.snapshot, screenshot: screenshotInfo } });
        if (commonSnapshot && !equal(commonSnapshot, packet.snapshot)) throw Error('Chunks of one responsive snapshot disagree on actual viewport, time, URL, title or page height'); commonSnapshot = packet.snapshot;
        if (!packet.commerceEvidence) throw Error('New responsive packets require actual source-commerce observation evidence');
        for (const region of packet.regions) { if (regionIds.has(region.id)) throw Error('Responsive capture duplicated a visual region packet'); regionIds.add(region.id); }
        const bytes = json(packet), filename = `${revision}-${meta.snapshotId}-packet-${packets.length + 1}-${sha(bytes).slice(0, 12)}.json`;
        manifest.packets.push({ path: filename, sha256: sha(bytes), snapshotId: meta.snapshotId, regionIds: packet.regions.map(region => region.id), counts: observationCountsV2(packet), dependencies: [] }); staged.push({ filename: path.join(referenceDir, filename), bytes }); packets.push(packet);
      }
    }
    if (regionIds.size !== expectedRegions.size || [...regionIds].some(id => !expectedRegions.has(id))) throw Error('Responsive scene must retain the explicitly observed desktop region responsibilities; missing/new owners need a reviewed source revision');
    const inventoryFile = await localFile(directory, meta.sceneInventoryFile ?? 'scene-inventory.json', 30_000_000), inventory = validateSceneInventoryV2(decodeBridge(inventoryFile.bytes));
    if (inventory.snapshotId !== meta.snapshotId || normalizeUrl(inventory.sourceUrl) !== normalizeUrl(previous.sourceUrl) || inventory.viewport.name !== meta.viewportName || inventory.viewport.width !== commonSnapshot.viewport.width || inventory.viewport.height !== commonSnapshot.viewport.height) throw Error('Responsive independent inventory identifies a different actual page or viewport');
    const inventoryBytes = json(inventory), inventoryName = `${revision}-${meta.snapshotId}-scene-${sha(inventoryBytes).slice(0, 12)}.json`;
    manifest.sceneInventories.push({ path: inventoryName, sha256: sha(inventoryBytes), snapshotId: meta.snapshotId }); staged.push({ filename: path.join(referenceDir, inventoryName), bytes: inventoryBytes });
    captures.push({ snapshotId: meta.snapshotId, viewport: commonSnapshot.viewport, captureMeta: { path: metaFile.path, sha256: sha(metaFile.bytes) }, packets, screenshot: screenshotInfo, inventory: inventoryName });
  }
  if (options.supplementalAssetsFile) {
    const supplement = JSON.parse((await localFile(jobDir, options.supplementalAssetsFile)).bytes.toString('utf8')); await validateAssets(jobDir, supplement);
    for (const asset of supplement.assets) { const old = assets.find(item => item.key === asset.key); if (old && !equal(old, asset)) throw Error(`Responsive media changed an existing asset record: ${asset.key}`); if (!old) assets.push(asset); }
  }
  const resourceUses = [], pending = new Map();
  for (const capture of captures) for (const packet of capture.packets) for (const usage of Object.values(packet.usages)) {
    const resource = packet.resources[usage.resourceId]; let asset = assets.find(item => item.sourceUrl === resource.url || item.observedResourceUrl === resource.url);
    if (!asset && resource.inline) {
      const originalHash = sha(Buffer.from(resource.inline)), sameBytes = assets.find(item => item.originalSha256 === originalHash);
      if (sameBytes) { asset = { ...sameBytes, key: `asset-${sha(resource.url).slice(0, 16)}`, observedResourceUrl: resource.url }; const existing = assets.find(item => item.key === asset.key); if (existing && !equal(existing, asset)) throw Error('Responsive inline media alias collides with another actual asset'); if (!existing) assets.push(asset); else asset = existing; }
    }
    resourceUses.push({ snapshotId: packet.snapshot.id, regionId: usage.regionId, nodeId: usage.nodeId, usageId: usage.id, resourceId: resource.id, kind: usage.kind, sourceUrl: resource.url, ...(usage.attribute ? { attribute: usage.attribute } : {}), ...(usage.media ? { media: usage.media } : {}), ...(asset ? { assetKey: asset.key } : {}) });
    if (!asset) { const row = pending.get(resource.url) ?? { sourceUrl: resource.url, resourceKind: resource.kind, ...(resource.inline ? { inlineSha256: sha(Buffer.from(resource.inline)) } : {}), uses: 0, snapshots: [] }; row.uses++; if (!row.snapshots.includes(packet.snapshot.id)) row.snapshots.push(packet.snapshot.id); pending.set(resource.url, row); }
  }
  for (const file of staged) await immutableFile(file.filename, file.bytes);
  const manifestName = `observation-manifest-${revision}.json`, manifestPath = path.join(referenceDir, manifestName); await immutableFile(manifestPath, json(manifest));
  const observation = await readObservationDirectoryV2(referenceDir, previous.sourceUrl, { manifestName }), facts = buildSourceFactsV2(observation); assertSourceFactsExtensionV2(previous, facts);
  for (const [id, fact] of Object.entries(previous.facts)) if (!equal(fact, facts.facts[id])) throw Error('Responsive assembly changed a previously captured desktop fact byte representation');
  await verifySourceFactsEvidenceV2(facts);
  const factsName = `source-facts-${revision}.json`, assetsName = `asset-manifest-${revision}.json`, usesName = `resource-uses-${revision}.json`;
  await immutableFile(path.join(jobDir, factsName), json(facts)); await immutableFile(path.join(jobDir, assetsName), json({ ...baseAssets, assets }));
  await immutableFile(path.join(jobDir, usesName), json({ version: 2, revision, resourceUses, pending: [...pending.values()], notice: 'Unmatched observed resources are evidence candidates, not fabricated or remotely imported assets. Select required static source assets in the responsive component plan; product data remains the configured target catalog.' }));
  if (!(await fs.readFile(base.manifestPath)).equals(baseManifestBytes) || !(await fs.readFile(previousFile.path)).equals(previousFile.bytes) || !(await fs.readFile(assetsFile.path)).equals(assetsFile.bytes)) throw Error('Concurrent changes to the protected desktop evidence prevented responsive assembly');
  const receipt = { version: 2, revision, jobDir, manifestPath, sourceFactsFile: factsName, assetsManifestFile: assetsName, resourceUsesFile: usesName, sourceFactsHash: sha(json(facts)), assetsManifestHash: sha(json({ ...baseAssets, assets })), snapshots: captures.map(({ packets, ...capture }) => ({ ...capture, packetCount: packets.length })), facts: Object.keys(facts.facts).length, addedFacts: Object.keys(facts.facts).length - Object.keys(previous.facts).length, assets: assets.length, addedAssets: assets.length - baseAssets.assets.length, pendingResources: pending.size, remoteRequests: 0, targetWrites: 0 };
  await immutableFile(path.join(jobDir, `append-${revision}-receipt.json`), json(receipt)); return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw Error('Usage: npx tsx tools/append-pet-v2-responsive.mjs <current-task-assembly-options.json>');
  const spec = await localFile(await fs.realpath(project), process.argv[2], 100_000); console.log(JSON.stringify(await appendPetResponsiveV2(JSON.parse(spec.bytes.toString('utf8')))));
}
