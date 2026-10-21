import { ownedMediaCompatibleV2 } from './pet-v2-media-variants.mjs';
import { proveExplicitSourceNodeVariantV2 } from './explicit-source-node-variants.mjs';
export function proveResponsiveExplicitNodeMappingV2(options) {
  const proof = proveExplicitSourceNodeVariantV2(options);
  return { desktopNodeId:proof.desktopNodeId,variantNodeId:proof.variantNodeId,regionId:proof.regionId,path:proof.path,evidence:proof.evidence,desktopVisible:proof.desktopVisible,visible:proof.visible,explicitNodeVariant:{declaration:proof.declaration,proofSha256:proof.proofSha256} };
}
export function sameResponsiveNodeRoleV2(before,after) {
  return !!before && !!after && before.tag === after.tag && (before.tag !== 'input' || ['id','name','type'].every(key => (before.attributes?.[key] ?? null) === (after.attributes?.[key] ?? null)));
}
export function proveCanonicalCloneEvidenceV2({ packet, nodeId }) {
  const chain = [], seen = new Set(); let node = packet.nodes?.[nodeId];
  while (node) { if (seen.has(node.id)) throw Error('Clone evidence has cyclic ancestry'); seen.add(node.id); chain.push(node); node = packet.nodes[node.parentId]; }
  const clone = chain.find(item => /(?:^|\s)(?:slick-cloned|swiper-slide-duplicate)(?:\s|$)/.test(item.attributes?.class ?? '')); if (!clone) return null;
  const interactions = Object.values(packet.interactions ?? {}).filter(item => item.kind === 'carousel' && item.cloneNodeIds?.includes(clone.id));
  if (interactions.length !== 1) throw Error('Clone evidence needs one actual owned carousel record');
  const interaction = interactions[0], track = packet.nodes[interaction.trackNodeId], firstReal = track?.childIds.indexOf(interaction.itemNodeIds?.[0]), cloneIndex = track?.childIds.indexOf(clone.id), count = interaction.itemNodeIds?.length;
  if (!track || clone.parentId !== track.id || !(count > 0) || firstReal < 0 || cloneIndex < 0) throw Error('Clone evidence has no actual reciprocal track ordering');
  const ordinal = ((cloneIndex - firstReal) % count + count) % count, canonicalItemNodeId = interaction.itemNodeIds[ordinal];
  proveCarouselRealItemSlot({ desktopPacket: packet, variantPacket: packet, desktopTrackNodeId: track.id, variantTrackNodeId: track.id, desktopItemNodeId: canonicalItemNodeId, pathOffset: 0 });
  if (clone.attributes?.['data-slick-index'] !== undefined) { const index = Number(clone.attributes['data-slick-index']); if (!Number.isInteger(index) || ((index % count) + count) % count !== ordinal) throw Error('Clone actual engine index disagrees with its canonical real item'); }
  const directCopy = id => Object.values(packet.texts ?? {}).filter(item => item.nodeId === id).map(item => String(item.text).normalize('NFC').replace(/\s+/g, ' ').trim());
  const verifySubtree = (a,b) => { if (!a || !b || a.tag !== b.tag || a.regionId !== b.regionId || a.childIds.length !== b.childIds.length || a.attributes?.href !== b.attributes?.href || JSON.stringify(directCopy(a.id)) !== JSON.stringify(directCopy(b.id)) || !ownedMediaCompatibleV2({desktopPacket:packet,variantPacket:packet,desktopNodeId:a.id,variantNodeId:b.id})) throw Error('Clone card does not preserve its complete canonical real-item child, copy, source href and media relationships'); for (const [index,id] of a.childIds.entries()) { const left=packet.nodes[id],right=packet.nodes[b.childIds[index]];if(left?.parentId!==a.id||right?.parentId!==b.id)throw Error('Clone card children are not reciprocal');verifySubtree(left,right); } };
  verifySubtree(clone,packet.nodes[canonicalItemNodeId]);
  const path = [], subtree = chain.slice(0, chain.indexOf(clone)).reverse(); let counterpart = packet.nodes[canonicalItemNodeId];
  for (const descendant of subtree) { const parent = packet.nodes[descendant.parentId], index = parent?.childIds.indexOf(descendant.id); if (!(index >= 0)) throw Error('Clone descendant has no reciprocal owned child slot'); path.push(index); counterpart = packet.nodes[counterpart?.childIds[index]]; if (!counterpart || counterpart.tag !== descendant.tag || counterpart.regionId !== clone.regionId) throw Error('Clone descendant does not match the canonical real item child path'); }
  const original = packet.nodes[nodeId], href = id => { while (packet.nodes[id]) { const current = packet.nodes[id]; if (current.tag === 'a' && current.attributes?.href) return current.attributes.href; id = current.parentId; } return null; }, copy = id => Object.values(packet.texts ?? {}).filter(item => item.nodeId === id).map(item => String(item.text).normalize('NFC').replace(/\s+/g, ' ').trim());
  if (original.tag !== counterpart?.tag || href(nodeId) !== href(counterpart.id) || JSON.stringify(copy(nodeId)) !== JSON.stringify(copy(counterpart.id)) || !ownedMediaCompatibleV2({ desktopPacket: packet, variantPacket: packet, desktopNodeId: nodeId, variantNodeId: counterpart.id })) throw Error('Clone node changed the canonical item copy, source destination or owned media');
  return { snapshotId:packet.snapshot.id,regionId:clone.regionId,sourceNodeId:nodeId,interactionId:interaction.id,trackNodeId:track.id,cloneItemNodeId:clone.id,canonicalItemNodeId,canonicalNodeId:counterpart.id,realItemOrdinal:ordinal,relativePath:path };
}
/** Extra evidence is explicitly attached to the desktop component that already
 * owns the authored decision. It supplies node proofs, never content slots or
 * a wider source subtree. No numeric-ID or text search chooses later nodes. */
export function deriveResponsiveEvidenceBindingsV2({ bindings, adaptations = [], sourceFacts, desktopPackets, desktopSnapshotId, componentPlan }) {
  if (!sourceFacts?.snapshots?.some(snapshot => snapshot.id === desktopSnapshotId)) throw Error('Responsive evidence needs its actual desktop source snapshot');
  const output = structuredClone(bindings), byKey = new Map(output.map(binding => [binding.componentKey, binding]));
  const add = (componentKey, nodeId) => {
    const binding = byKey.get(componentKey); if (!binding) throw Error(`Responsive evidence decision has no component binding: ${componentKey}`);
    const owners = (binding.regionIds ?? []).filter(regionId => desktopPackets[regionId]?.snapshot?.id === desktopSnapshotId && desktopPackets[regionId]?.nodes?.[nodeId]?.regionId === regionId);
    if (owners.length !== 1) throw Error(`Responsive evidence node ${nodeId} does not have one actual declared region owner in ${componentKey}`);
    const proof = proveCanonicalCloneEvidenceV2({packet:desktopPackets[owners[0]],nodeId});
    if (proof) { const aliases = binding.evidenceAliases ??= []; if (!aliases.some(item => item.sourceNodeId === nodeId)) aliases.push(proof); nodeId = proof.canonicalNodeId; }
    const ids = binding.evidenceNodeIds ??= []; if (!ids.includes(nodeId)) ids.push(nodeId);
  };
  const addFact = (componentKey, factId) => { const fact = sourceFacts.facts?.[factId]; if (!fact) throw Error(`Responsive evidence refers to an unknown source fact: ${factId}`); if (fact.snapshotId === desktopSnapshotId) { add(componentKey, fact.nodeId); if(fact.kind==='interaction'&&fact.value?.kind==='carousel'){ add(componentKey,fact.value.trackNodeId);for(const id of [...(fact.value.itemNodeIds??[]),...(fact.value.controlNodeIds??[])])add(componentKey,id); } } };
  for (const adaptation of adaptations) {
    if (adaptation.snapshotId && adaptation.snapshotId !== desktopSnapshotId || !adaptation.target) continue;
    const componentKey = adaptation.target.componentKey ?? adaptation.componentKey ?? adaptation.component;
    for (const nodeId of adaptation.sourceNodeIds ?? []) add(componentKey, nodeId);
    for (const factId of adaptation.sourceFactIds ?? []) addFact(componentKey, factId);
  }
  for (const requirement of componentPlan?.requirements ?? []) for (const factId of requirement.factIds ?? []) addFact(requirement.componentId, factId);
  return output;
}
/** Pure evidence mapping. IDs and selector/text equality never choose a node.
 * A later viewport keeps a component identity only through its same region's
 * relative DOM slots, with tag, destination and media-relationship checks. */
export function mapResponsiveBindings({ desktopPackets, variantPackets, bindings, explicitMediaVariants = [], explicitNodeVariants = [] }) {
  const gaps = [], mappings = [];
  const values = value => Object.values(value || {});
  const normalize = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const links = (packet, id) => { const seen = new Set(); while (id && !seen.has(id)) { seen.add(id); const node = packet.nodes[id]; if (!node) return null; if (node.tag === 'a' && node.attributes?.href) return node.attributes.href; id = node.parentId; } return null; };
  const clone = (packet, id) => { const seen = new Set(); while (id && !seen.has(id)) { seen.add(id); const node = packet.nodes[id]; if (!node) return false; if (/(?:^|\s)(?:slick-cloned|swiper-slide-duplicate)(?:\s|$)/.test(node.attributes?.class || '')) return true; id = node.parentId; } return false; };
  const media = (packet, id) => {
    const groups = new Map();
    for (const usage of values(packet.usages).filter(usage => usage.nodeId === id)) {
      const resource = packet.resources?.[usage.resourceId]; if (!resource) continue;
      const family = ['img', 'picture'].includes(usage.kind) ? 'image' : usage.kind;
      const identities = groups.get(family) || new Set(); identities.add(resource.inline ? `inline:${resource.inline}` : resource.url); groups.set(family, identities);
    }
    return groups;
  };
  const directText = (packet, id) => values(packet.texts).filter(text => text.nodeId === id).map(text => normalize(text.text)).join('\n');
  const regionAt = (packet, regionId) => packet?.regions?.find(region => region.id === regionId);
  const mappingCache = new Map(), carouselProofCache = new Map();
  for (const binding of bindings) {
    const componentGaps = [], nodeMappings = [], regionIds = [...new Set(binding.regionIds || [])];
    const addGap = (code, nodeId, message, location) => { const gap = { componentKey: binding.componentKey, code, ...(nodeId ? { desktopNodeId: nodeId } : {}), ...(location ? { location } : {}), message }; if (!componentGaps.some(old => old.code === code && old.desktopNodeId === nodeId && old.location === location)) componentGaps.push(gap); };
    const desktopIds = new Set(regionIds.map(regionId => desktopPackets[regionId]?.snapshot?.id).filter(Boolean)), variantIds = new Set(regionIds.map(regionId => variantPackets[regionId]?.snapshot?.id).filter(Boolean));
    const mediaVariants = explicitMediaVariants.filter(item => regionIds.includes(item.regionId) && desktopIds.has(item.desktopSnapshotId) && variantIds.has(item.snapshotId));
    if (desktopIds.size !== 1 || variantIds.size !== 1) addGap('snapshot-identity-unproven', null, 'All component regions must belong to one actual desktop and one actual variant snapshot');
    const mapNode = (nodeId, location) => {
      const owners = regionIds.filter(regionId => desktopPackets[regionId]?.nodes?.[nodeId]?.regionId === regionId && regionAt(desktopPackets[regionId], regionId));
      if (owners.length !== 1) { addGap('source-owner-unproven', nodeId, 'The desktop node must have exactly one actual declared region owner', location); return null; }
      const regionId = owners[0], desktop = desktopPackets[regionId], variant = variantPackets[regionId], original = desktop.nodes[nodeId], root = regionAt(desktop, regionId), laterRoot = regionAt(variant, regionId);
      if (!variant || !laterRoot) { addGap('responsive-region-missing', nodeId, `Actual responsive region ${regionId} was not captured`, location); return null; }
      const cacheKey = `${regionId}\0${nodeId}\0${variant.snapshot.id}`;
      let cached = mappingCache.get(cacheKey);
      if (!cached) {
        const declarations = explicitNodeVariants.filter(item => item.desktopSnapshotId === desktop.snapshot.id && item.snapshotId === variant.snapshot.id && item.regionId === regionId && item.desktopNodeId === nodeId);
        if (declarations.length) {
          try { if (declarations.length !== 1) throw Error('An actual desktop node has duplicate explicit variant declarations'); const declaration = declarations[0]; cached = proveResponsiveExplicitNodeMappingV2({desktopPacket:desktop,variantPacket:variant,desktopPacketSha256:declaration.desktopEvidence.sha256,variantPacketSha256:declaration.variantEvidence.sha256,declaration}); }
          catch (error) { cached = {failure:`Explicit responsive owner/path pairing is unproven: ${error.message}`}; }
          mappingCache.set(cacheKey,cached);
        }
      }
      if (!cached) {
        const steps = [], seen = new Set(); let current = original, failure;
        while (current?.id !== root.nodeId) {
          if (!current || seen.has(current.id) || !current.parentId || !desktop.nodes[current.parentId]) { failure = 'Desktop node ancestry does not reach its actual region root'; break; }
          seen.add(current.id); const parent = desktop.nodes[current.parentId], index = parent.childIds.indexOf(current.id);
          if (index < 0) { failure = 'Desktop child slot is not reciprocal'; break; }
          steps.unshift({ index, tag: current.tag, nodeId: current.id, parentId: parent.id }); current = parent;
        }
        let candidate = variant.nodes[laterRoot.nodeId];
        if (!failure && (!candidate || candidate.tag !== desktop.nodes[root.nodeId]?.tag || candidate.regionId !== regionId)) failure = 'Responsive root does not preserve the actual source region and tag';
        const carouselSlots = [];
        if (!failure) for (const [pathOffset, step] of steps.entries()) {
          const boundaries = values(desktop.interactions).filter(interaction => interaction.kind === 'carousel' && interaction.trackNodeId === step.parentId && interaction.itemNodeIds?.includes(step.nodeId));
          if (boundaries.length) {
            try { const key = `${regionId}\0${desktop.snapshot.id}\0${variant.snapshot.id}\0${step.parentId}\0${candidate.id}\0${step.nodeId}\0${pathOffset}`; if (!carouselProofCache.has(key)) carouselProofCache.set(key, proveCarouselRealItemSlot({ desktopPacket: desktop, variantPacket: variant, desktopTrackNodeId: step.parentId, variantTrackNodeId: candidate.id, desktopItemNodeId: step.nodeId, pathOffset, explicitMediaVariants: mediaVariants })); const slot = carouselProofCache.get(key); carouselSlots.push(slot); candidate = variant.nodes[slot.variantItemNodeId]; }
            catch (error) { failure = `Responsive carousel real-item ownership is unproven: ${error.message}`; break; }
          } else candidate = variant.nodes[candidate.childIds[step.index]];
          if (!candidate || candidate.tag !== step.tag || candidate.regionId !== regionId) { failure = 'Responsive relative child-slot path or tag differs from the desktop owner'; break; }
        }
        const evidence = ['same-source-region-root', 'relative-child-slot-path', 'all-ancestor-tags'];
        if (carouselSlots.length) evidence.push('canonical-carousel-real-item-slot', 'carousel-item-owned-destinations-and-media');
        if (!failure && links(desktop, nodeId) !== links(variant, candidate.id)) failure = 'Actual source destination relationship differs at the relative node';
        else if (!failure && links(desktop, nodeId)) evidence.push('actual-source-href');
        if (!failure && !sameResponsiveNodeRoleV2(original,candidate)) failure = 'Actual typed source node role differs at the relative slot; input id, name and type require independent identity';
        if (!failure && clone(desktop, nodeId) !== clone(variant, candidate.id)) failure = 'A real item cannot be mapped to a carousel clone';
        if (!failure) {
          const before = media(desktop, nodeId);
          if (!ownedMediaCompatibleV2({ desktopPacket: desktop, variantPacket: variant, desktopNodeId: nodeId, variantNodeId: candidate.id, explicitMediaVariants: mediaVariants })) failure = 'Media resources have no verified identity, shared owner-bound picture/srcset candidate or exact declared CSS background variant';
          else if (before.size) evidence.push('owner-bound-media-candidate-intersection');
        }
        cached = failure ? { failure } : { desktopNodeId: nodeId, variantNodeId: candidate.id, regionId, path: steps.map(step => step.index), ...(carouselSlots.length ? { carouselSlots } : {}), evidence, desktopVisible: original.visible, visible: candidate.visible };
        mappingCache.set(cacheKey, cached);
      }
      if (cached.failure) { addGap('responsive-node-identity-unproven', nodeId, cached.failure, location); return null; }
      if (!nodeMappings.some(mapping => mapping.desktopNodeId === nodeId && mapping.regionId === regionId)) nodeMappings.push({ ...cached });
      if (location.startsWith('slotNodes.text.') && directText(desktop, nodeId) !== directText(variant, cached.variantNodeId)) addGap('responsive-text-variant-required', nodeId, 'The same owner now contains different source copy; author an explicit responsive text variant', location);
      return cached.variantNodeId;
    };
    const sourceNodeIds = (binding.sourceNodeIds || []).map(nodeId => mapNode(nodeId, 'sourceNodeIds')).filter(Boolean), slotNodes = {};
    const evidenceNodeIds = binding.evidenceNodeIds === undefined ? undefined : [...new Set(binding.evidenceNodeIds)].map(nodeId => mapNode(nodeId, 'evidenceNodeIds')).filter(Boolean);
    for (const [kind, slots] of Object.entries(binding.slotNodes || {})) {
      slotNodes[kind] = {};
      for (const [slot, nodeIds] of Object.entries(slots)) slotNodes[kind][slot] = nodeIds.map(nodeId => mapNode(nodeId, `slotNodes.${kind}.${slot}`)).filter(Boolean);
    }
    const layoutNodes = {};
    for (const [nodeId, probe] of Object.entries(binding.layoutNodes || {})) { const mapped = mapNode(nodeId, 'layoutNodes'); if (mapped) { if (layoutNodes[mapped]) addGap('responsive-layout-collision', nodeId, 'Two desktop layout probes collide at one responsive owner', 'layoutNodes'); else layoutNodes[mapped] = structuredClone(probe); } }
    for (const declaration of mediaVariants) { const mapped = mapNode(declaration.desktopNodeId, 'explicitMediaVariants'); if (mapped && mapped !== declaration.variantNodeId) addGap('responsive-background-variant-owner-mismatch', declaration.desktopNodeId, 'The declared CSS background variant is not at its independently proved owner path', 'explicitMediaVariants'); }
    const variant = regionIds.map(regionId => variantPackets[regionId]).find(Boolean);
    mappings.push({ componentKey: binding.componentKey, desktopSnapshotId: [...desktopIds][0] || null, snapshotId: [...variantIds][0] || null, viewport: variant?.snapshot?.viewport?.name || null, regionIds, sourceNodeIds, slotNodes, layoutNodes, nodeMappings, ...(evidenceNodeIds === undefined ? {} : { evidenceNodeIds }), ...(mediaVariants.length ? { explicitMediaVariants: mediaVariants } : {}) });
    gaps.push(...componentGaps);
  }
  return { version: 2, kind: 'responsive-binding-mapping', mappings, gaps };
}

/** Recompute a canonical carousel boundary from the actual two source packets.
 * Replay validators may compare this result to the recorded slot; no supplied
 * item/interaction ID is accepted without rechecking the DOM ownership tables. */
export function proveCarouselRealItemSlot({ desktopPacket, variantPacket, desktopTrackNodeId, variantTrackNodeId, desktopItemNodeId, pathOffset, explicitMediaVariants = [] }) {
  const values = table => Object.values(table || {});
  const pathWithin = (packet, nodeId, ownerId) => {
    const path = [], seen = new Set(); let node = packet.nodes[nodeId];
    while (node?.id !== ownerId) { if (!node || seen.has(node.id) || !node.parentId || !packet.nodes[node.parentId]) throw Error('Node does not reach its actual owner'); seen.add(node.id); const parent = packet.nodes[node.parentId], index = parent.childIds.indexOf(node.id); if (index < 0) throw Error('Non-reciprocal child relationship'); path.unshift(index); node = parent; }
    return path;
  };
  const atPath = (packet, root, path) => { let node = packet.nodes[root]; for (const index of path) node = packet.nodes[node?.childIds[index]]; return node; };
  const isClone = node => /(?:^|\s)(?:slick-cloned|swiper-slide-duplicate)(?:\s|$)/.test(node?.attributes?.class || '');
  const interactionAt = (packet, trackId) => {
    const items = values(packet.interactions).filter(interaction => interaction.kind === 'carousel' && interaction.trackNodeId === trackId), track = packet.nodes[trackId];
    if (items.length !== 1 || !track || typeof items[0].id !== 'string' || !items[0].id) throw Error('Carousel track needs one actual interaction record');
    const interaction = items[0], real = interaction.itemNodeIds, clones = interaction.cloneNodeIds;
    if (!Array.isArray(real) || !real.length || !Array.isArray(clones) || new Set([...real, ...clones]).size !== real.length + clones.length) throw Error('Real/clone item lists must be complete, unique and disjoint');
    if ([...real, ...clones].some(id => !packet.nodes[id] || packet.nodes[id].parentId !== trackId || packet.nodes[id].regionId !== track.regionId) || real.some(id => isClone(packet.nodes[id])) || clones.some(id => !isClone(packet.nodes[id]))) throw Error('Real/clone items are not actual direct children of their owned track');
    if (JSON.stringify(track.childIds.filter(id => !clones.includes(id))) !== JSON.stringify(real) || track.childIds.some(id => !real.includes(id) && !clones.includes(id))) throw Error('Real item ordering does not agree with the actual track DOM');
    if (!packet.nodes[interaction.nodeId] || packet.nodes[interaction.nodeId].regionId !== track.regionId) throw Error('Carousel owner is absent or belongs to another source region');
    const ownerPath = pathWithin(packet, trackId, interaction.nodeId), region = packet.regions?.find(region => region.id === track.regionId);
    if (!region || !packet.nodes[region.nodeId]) throw Error('Carousel track has no actual region root');
    const rootPath = pathWithin(packet, trackId, region.nodeId); pathWithin(packet, interaction.nodeId, region.nodeId);
    return { interaction, track, ownerPath, region, rootPath };
  };
  const before = interactionAt(desktopPacket, desktopTrackNodeId), after = interactionAt(variantPacket, variantTrackNodeId);
  if (!Number.isInteger(pathOffset) || pathOffset < 0 || before.track.regionId !== after.track.regionId || JSON.stringify(before.rootPath) !== JSON.stringify(after.rootPath) || [...Array(before.rootPath.length + 1).keys()].some(length => atPath(desktopPacket, before.region.nodeId, before.rootPath.slice(0, length))?.tag !== atPath(variantPacket, after.region.nodeId, after.rootPath.slice(0, length))?.tag)) throw Error('Responsive carousel track and actual region-root path/tag relationship changed');
  const ordinal = before.interaction.itemNodeIds.indexOf(desktopItemNodeId);
  if (ordinal < 0 || before.interaction.itemNodeIds.length !== after.interaction.itemNodeIds.length) throw Error('Real item ordinal/count is not supported by both actual interaction records');
  const variantItemNodeId = after.interaction.itemNodeIds[ordinal], original = desktopPacket.nodes[desktopItemNodeId], candidate = variantPacket.nodes[variantItemNodeId];
  if (original.tag !== candidate.tag) throw Error('Canonical real item tag changed');
  const descendants = (packet, root) => { const result = [], pending = [root], seen = new Set(); while (pending.length) { const id = pending.shift(); if (seen.has(id) || !packet.nodes[id]) throw Error('Invalid carousel card subtree'); seen.add(id); const node = packet.nodes[id]; result.push(node); pending.push(...node.childIds); } return result; };
  const subtreeBefore = descendants(desktopPacket, desktopItemNodeId), subtreeAfter = descendants(variantPacket, variantItemNodeId);
  const destinations = (packet, root, nodes) => nodes.filter(node => node.tag === 'a' && node.attributes?.href).map(node => ({ path: pathWithin(packet, node.id, root), href: node.attributes.href }));
  const sourceLinks = destinations(desktopPacket, desktopItemNodeId, subtreeBefore), variantLinks = destinations(variantPacket, variantItemNodeId, subtreeAfter);
  if (JSON.stringify(sourceLinks) !== JSON.stringify(variantLinks)) throw Error('Canonical real item actual destination/path differs; real item reordering is not allowed');
  const mediaAt = (packet, id) => { const groups = new Map(); for (const usage of values(packet.usages).filter(usage => usage.nodeId === id)) { const asset = packet.resources?.[usage.resourceId]; if (!asset) throw Error('Missing real-item media resource'); const family = ['img', 'picture'].includes(usage.kind) ? 'image' : usage.kind, identities = groups.get(family) || new Set(); identities.add(asset.inline ? `inline:${asset.inline}` : asset.url); groups.set(family, identities); } return groups; };
  const sourceMedia = subtreeBefore.filter(node => mediaAt(desktopPacket, node.id).size), variantMedia = subtreeAfter.filter(node => mediaAt(variantPacket, node.id).size);
  if (sourceMedia.length !== variantMedia.length) throw Error('Canonical real item media owner count changed');
  for (const node of sourceMedia) {
    const path = pathWithin(desktopPacket, node.id, desktopItemNodeId), counterpart = atPath(variantPacket, variantItemNodeId, path), initial = mediaAt(desktopPacket, node.id), later = counterpart ? mediaAt(variantPacket, counterpart.id) : new Map();
    if (!counterpart || counterpart.tag !== node.tag || !ownedMediaCompatibleV2({ desktopPacket, variantPacket, desktopNodeId: node.id, variantNodeId: counterpart.id, explicitMediaVariants })) throw Error('Canonical real item media has no same-owner candidate relationship or exact declared CSS background variant; real item reordering is not allowed');
  }
  if (!sourceLinks.length && !sourceMedia.length) throw Error('Canonical real item needs an actual owned destination or media identity');
  return { desktopInteractionId: before.interaction.id, variantInteractionId: after.interaction.id, desktopTrackNodeId, variantTrackNodeId, desktopItemNodeId, variantItemNodeId, realItemOrdinal: ordinal, desktopChildIndex: before.track.childIds.indexOf(desktopItemNodeId), variantChildIndex: after.track.childIds.indexOf(variantItemNodeId), pathOffset };
}
