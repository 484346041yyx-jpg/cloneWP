import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { mapResponsiveBindings } from './pet-v2-responsive-mapping.mjs';
import { proveCssBackgroundVariantV2 } from './pet-v2-media-variants.mjs';
const defaultJob = 'D:/cloneWP/references/reference-v2-2026-10-15T04-35-43-856Z-www-petsupermarket-com-67f02b1e';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children ?? node.slides ?? [])]);

/** Author this task's exact computed CSS variants from already captured owner
 * paths. The mapper must independently accept all selected component paths. */
export async function declarePetCssBackgroundVariantsV2({ jobDir = defaultJob, sourceFactsFile = 'source-facts-responsive.json', authoredFile = 'authored-desktop.json', outputFile = 'explicit-media-variants-responsive.json' } = {}) {
  const root = await fs.realpath(jobDir), relative = path.relative(await fs.realpath('D:/cloneWP/references'), root); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('CSS background declarations belong to the current task');
  for (const name of [sourceFactsFile, authoredFile, outputFile]) if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.json$/.test(name)) throw Error('CSS background declaration files must stay in this task');
  const sourceBytes = await fs.readFile(path.join(root, sourceFactsFile)), source = JSON.parse(sourceBytes), authored = JSON.parse(await fs.readFile(path.join(root, authoredFile), 'utf8')), components = new Map(flatten(authored.blocks).map(node => [node.key,node]));
  const desktop = source.snapshots.find(snapshot => snapshot.viewport.name === 'desktop'), packets = new Map();
  for (const snapshot of source.snapshots) for (const evidence of snapshot.evidence) { const bytes = await fs.readFile(evidence.path); if (sha(bytes) !== evidence.sha256) throw Error('Background declaration packet bytes changed'); const packet = JSON.parse(bytes); for (const region of packet.regions) packets.set(`${snapshot.id}:${region.id}`, packet); }
  const selectedBindings = authored.bindings.filter(binding => { const node = components.get(binding.componentKey); return node?.kind === 'html-static' && Object.keys(binding.slotNodes?.media ?? {}).some(slot => node.template.includes(`data-cwp-background="${slot}"`)); });
  const ownerNodes = new Map(); for (const binding of selectedBindings) { const node = components.get(binding.componentKey); for (const [slot, ids] of Object.entries(binding.slotNodes.media)) if (node.template.includes(`data-cwp-background="${slot}"`)) for (const id of ids) ownerNodes.set(id, binding.regionIds); }
  const variants = [], gaps = [];
  for (const snapshot of source.snapshots.filter(snapshot => snapshot.id !== desktop.id)) for (const [nodeId, regionIds] of ownerNodes) {
    const regionId = regionIds.find(regionId => packets.get(`${desktop.id}:${regionId}`)?.nodes[nodeId]), before = packets.get(`${desktop.id}:${regionId}`), after = packets.get(`${snapshot.id}:${regionId}`); if (!before || !after) { gaps.push({ snapshotId:snapshot.id,nodeId,reason:'Actual source region is absent' }); continue; }
    const steps = []; let current = before.nodes[nodeId], region = before.regions.find(region => region.id === regionId); const seen = new Set();
    while (current?.id !== region.nodeId) { if (!current || seen.has(current.id) || !current.parentId) throw Error('Background owner does not reach the actual region root'); seen.add(current.id); const parent = before.nodes[current.parentId], index = parent?.childIds.indexOf(current.id); if (index < 0) throw Error('Background owner path is not reciprocal'); steps.unshift({ index, parentId:parent.id, nodeId:current.id, tag:current.tag }); current = parent; }
    let candidate = after.nodes[after.regions.find(region => region.id === regionId)?.nodeId], valid = candidate?.tag === current?.tag;
    for (const step of steps) {
      const originalCarousel = Object.values(before.interactions).filter(item => item.kind === 'carousel' && item.trackNodeId === step.parentId && item.itemNodeIds?.includes(step.nodeId));
      if (originalCarousel.length) { const later = Object.values(after.interactions).filter(item => item.kind === 'carousel' && item.trackNodeId === candidate?.id), ordinal = originalCarousel[0].itemNodeIds.indexOf(step.nodeId); if (originalCarousel.length !== 1 || later.length !== 1 || later[0].itemNodeIds?.length !== originalCarousel[0].itemNodeIds.length) { valid=false; break; } candidate = after.nodes[later[0].itemNodeIds[ordinal]]; }
      else candidate = after.nodes[candidate?.childIds?.[step.index]];
      if (!candidate || candidate.tag !== step.tag || candidate.regionId !== regionId) { valid=false; break; }
    }
    if (!valid) { gaps.push({ snapshotId:snapshot.id,nodeId,reason:'CSS owner needs an explicit structural mapping before its media variant can be declared' }); continue; }
    const originalUses = Object.values(before.usages).filter(usage => usage.nodeId === nodeId && usage.kind === 'background' && usage.attribute === 'background-image'), laterUses = Object.values(after.usages).filter(usage => usage.nodeId === candidate.id && usage.kind === 'background' && usage.attribute === 'background-image');
    const oldChanged = originalUses.filter(usage => !laterUses.some(later => after.resources[later.resourceId].url === before.resources[usage.resourceId].url)), newChanged = laterUses.filter(usage => !originalUses.some(old => before.resources[old.resourceId].url === after.resources[usage.resourceId].url));
    if (!oldChanged.length && !newChanged.length) continue;
    if (oldChanged.length !== 1 || newChanged.length !== 1) { gaps.push({ snapshotId:snapshot.id,nodeId,reason:'Multiple changed CSS layers require individual explicit source declarations' }); continue; }
    const oldUsage = oldChanged[0], newUsage = newChanged[0], originalFact = source.facts[`${desktop.id}:media:${oldUsage.id}`], variantFact = source.facts[`${snapshot.id}:media:${newUsage.id}`];
    const declaration = { kind:'css-background',desktopSnapshotId:desktop.id,snapshotId:snapshot.id,regionId,desktopNodeId:nodeId,variantNodeId:candidate.id,desktopUsageId:oldUsage.id,variantUsageId:newUsage.id,desktopURL:before.resources[oldUsage.resourceId].url,variantURL:after.resources[newUsage.resourceId].url,desktopEvidence:originalFact.evidence,variantEvidence:variantFact.evidence };
    variants.push(proveCssBackgroundVariantV2({ desktopPacket:before,variantPacket:after,declaration }));
  }
  for (const snapshot of source.snapshots.filter(snapshot => snapshot.id !== desktop.id)) {
    const table = id => Object.fromEntries([...packets].filter(([key]) => key.startsWith(id+':')).map(([key,packet]) => [key.slice(id.length+1),packet]));
    const checked = mapResponsiveBindings({ desktopPackets:table(desktop.id),variantPackets:table(snapshot.id),bindings:selectedBindings,explicitMediaVariants:variants }); gaps.push(...checked.gaps.map(gap => ({...gap,snapshotId:snapshot.id})));
  }
  const report = {version:2,kind:'explicit-css-background-variants',sourceFacts:{path:sourceFactsFile,sha256:sha(sourceBytes)},variants,gaps};
  if (gaps.length) throw Error(`${gaps.length} background-owner proof gaps remain; no declarations were frozen`);
  const bytes = JSON.stringify(report,null,2)+'\n', filename = path.join(root,outputFile); try { await fs.writeFile(filename,bytes,{flag:'wx'}); } catch (error) { if (error.code !== 'EEXIST' || await fs.readFile(filename,'utf8') !== bytes) throw error; }
  return { path:filename,variants:variants.length,snapshots:source.snapshots.length,gaps:0 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(await declarePetCssBackgroundVariantsV2()));
