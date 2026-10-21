// Explicit CSS background variants only. img/picture/svg identity still follows
// the existing same-owner candidate rules; a URL match never finds a DOM node.
const values = table => Object.values(table ?? {});
export function proveCssBackgroundVariantV2({ desktopPacket, variantPacket, declaration }) {
  const item = declaration, before = desktopPacket.nodes[item?.desktopNodeId], after = variantPacket.nodes[item?.variantNodeId];
  const keys = ['kind','desktopSnapshotId','snapshotId','regionId','desktopNodeId','variantNodeId','desktopUsageId','variantUsageId','desktopURL','variantURL','desktopEvidence','variantEvidence'];
  if (!item || Object.keys(item).length !== keys.length || keys.some(key => !Object.hasOwn(item, key)) || item.kind !== 'css-background' || item.desktopSnapshotId !== desktopPacket.snapshot.id || item.snapshotId !== variantPacket.snapshot.id || !before || !after || before.tag !== after.tag || before.regionId !== item.regionId || after.regionId !== item.regionId) throw Error('Explicit background variant must identify two actual same-region CSS owners');
  for (const evidence of [item.desktopEvidence, item.variantEvidence]) if (!evidence || Object.keys(evidence).length !== 2 || typeof evidence.path !== 'string' || !evidence.path || !/^[a-f0-9]{64}$/.test(evidence.sha256 ?? '')) throw Error('Explicit background variant needs both exact packet paths and byte hashes');
  const oldUsage = desktopPacket.usages[item.desktopUsageId], newUsage = variantPacket.usages[item.variantUsageId];
  if (!oldUsage || !newUsage || oldUsage.kind !== 'background' || newUsage.kind !== 'background' || oldUsage.attribute !== 'background-image' || newUsage.attribute !== 'background-image' || oldUsage.nodeId !== before.id || newUsage.nodeId !== after.id || oldUsage.regionId !== item.regionId || newUsage.regionId !== item.regionId || desktopPacket.resources[oldUsage.resourceId]?.url !== item.desktopURL || variantPacket.resources[newUsage.resourceId]?.url !== item.variantURL || typeof item.desktopURL !== 'string' || !item.desktopURL || typeof item.variantURL !== 'string' || !item.variantURL || item.desktopURL === item.variantURL) throw Error('Explicit background variant must bind the exact two changed observed CSS background usages, never img or SVG slots');
  return Object.fromEntries(keys.map(key => [key, item[key]]));
}

export function ownedMediaCompatibleV2({ desktopPacket, variantPacket, desktopNodeId, variantNodeId, explicitMediaVariants = [] }) {
  const before = values(desktopPacket.usages).filter(usage => usage.nodeId === desktopNodeId), after = values(variantPacket.usages).filter(usage => usage.nodeId === variantNodeId);
  const families = usages => { const result = new Map(); for (const usage of usages) { const key = ['img','picture'].includes(usage.kind) ? 'image' : usage.kind; if (!result.has(key)) result.set(key, []); result.get(key).push(usage); } return result; };
  const initial = families(before), later = families(after);
  if (initial.size !== later.size) return false;
  for (const [family, uses] of initial) {
    const other = later.get(family); if (!other) return false;
    const identity = (packet, usage) => { const resource = packet.resources[usage.resourceId]; return resource?.inline ? `inline:${resource.inline}` : resource?.url; };
    if (family !== 'background') { if (!uses.some(left => other.some(right => identity(desktopPacket,left) === identity(variantPacket,right)))) return false; continue; }
    if (uses.length !== other.length) return false;
    const consumed = new Set();
    for (const usage of uses) {
      const same = other.find(candidate => !consumed.has(candidate.id) && identity(desktopPacket,usage) === identity(variantPacket,candidate));
      if (same) { consumed.add(same.id); continue; }
      const declarations = explicitMediaVariants.filter(item => item.desktopNodeId === desktopNodeId && item.variantNodeId === variantNodeId && item.desktopUsageId === usage.id);
      if (declarations.length !== 1) return false;
      const proof = proveCssBackgroundVariantV2({ desktopPacket, variantPacket, declaration: declarations[0] });
      if (consumed.has(proof.variantUsageId) || !other.some(candidate => candidate.id === proof.variantUsageId)) return false;
      consumed.add(proof.variantUsageId);
    }
  }
  return true;
}
