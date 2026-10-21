// Current Pet task only: bind authored components to independent source facts.
// This script never alters observations, imports media, authenticates or writes WordPress.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { proveCanonicalCloneEvidenceV2, proveCarouselRealItemSlot, proveResponsiveExplicitNodeMappingV2, sameResponsiveNodeRoleV2 } from './pet-v2-responsive-mapping.mjs';
import { ownedMediaCompatibleV2, proveCssBackgroundVariantV2 } from './pet-v2-media-variants.mjs';

const defaultJob = 'D:/cloneWP/references/reference-v2-2026-10-15T04-35-43-856Z-www-petsupermarket-com-67f02b1e';
const sha = value => createHash('sha256').update(value).digest('hex');
const idFor = (task, key) => sha(`clonewp-replica-v2:${task}:${key}`).slice(0, 7);
const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const descendants = component => component.kind === 'composite' || component.kind === 'native' ? component.children ?? [] : component.kind === 'native-carousel' ? component.slides : [];
const flatten = (components, parentId = null, depth = 0) => components.flatMap(component => [{ component, parentId, depth }, ...flatten(descendants(component), component.key, depth + 1)]);
const write = async (directory, filename, value) => fs.writeFile(path.join(directory, filename), JSON.stringify(value, null, 2) + '\n');

export async function authorPetPlanV2(directory = defaultJob, authoredFilename = 'authored-desktop.json') {
  const jobDir = await fs.realpath(directory), project = await fs.realpath('D:/cloneWP');
  const relative = path.relative(path.join(project, 'references'), jobDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Pet authoring must use a current isolated reference job');
  const authoredPath = path.resolve(jobDir, authoredFilename), authoredRelative = path.relative(jobDir, authoredPath);
  if (!authoredRelative || authoredRelative.startsWith('..') || path.isAbsolute(authoredRelative)) throw Error('Authored input must stay inside the current reference job');
  const authored = JSON.parse(await fs.readFile(authoredPath, 'utf8'));
  const sourceFactsFile = authored.sourceFactsFile ?? 'source-facts.json', assetsManifestFile = authored.assetsManifestFile ?? 'asset-manifest.json';
  if (![sourceFactsFile, assetsManifestFile].every(filename => typeof filename === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.json$/.test(filename))) throw Error('Authored evidence revisions must be safe JSON filenames within this same task');
  const sourceBytes = await fs.readFile(path.join(jobDir, sourceFactsFile)), source = JSON.parse(sourceBytes), sourceHash = sha(sourceBytes);
  if (authored.sourceHash !== sourceHash) throw Error('Authored desktop is not bound to the exact source-facts bytes');
  const manifestBytes = await fs.readFile(path.join(jobDir, assetsManifestFile)), manifest = JSON.parse(manifestBytes);
  let frozenPlan;
  if (authored.desktopComponentPlan !== undefined) {
    const reference = authored.desktopComponentPlan;
    if (!reference || typeof reference.path !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.json$/.test(reference.path) || !/^[a-f\d]{64}$/.test(reference.sha256 ?? '')) throw Error('Frozen desktop component plan needs an exact same-task JSON path and hash');
    const bytes = await fs.readFile(path.join(jobDir, reference.path)); if (sha(bytes) !== reference.sha256) throw Error('Frozen desktop component plan bytes changed'); frozenPlan = JSON.parse(bytes);
    const basePath = path.resolve(jobDir, frozenPlan.sourceFacts?.path ?? ''), baseRelative = path.relative(jobDir, basePath);
    if (!baseRelative || baseRelative.startsWith('..') || path.isAbsolute(baseRelative)) throw Error('Frozen desktop source facts must stay inside this same task');
    const baseBytes = await fs.readFile(basePath); if (sha(baseBytes) !== frozenPlan.sourceFacts.sha256) throw Error('Frozen desktop source facts bytes changed');
    const base = JSON.parse(baseBytes);
    if (base.sourceUrl !== source.sourceUrl || Object.entries(base.facts ?? {}).some(([id, fact]) => JSON.stringify(source.facts[id]) !== JSON.stringify(fact))) throw Error('Frozen desktop facts are not an immutable subset of the responsive source evidence');
  }
  const entries = flatten(authored.blocks), components = new Map(entries.map(entry => [entry.component.key, entry])), bindings = new Map();
  const gaps = [], requirements = [], decisions = [];
  for (const binding of authored.bindings) {
    if (bindings.has(binding.componentKey)) throw Error(`Duplicate authored binding: ${binding.componentKey}`);
    if (!components.has(binding.componentKey)) throw Error(`Binding has no actual component: ${binding.componentKey}`);
    bindings.set(binding.componentKey, binding);
  }
  const packets = [], packetBySnapshotRegion = new Map();
  for (const evidence of source.snapshots.flatMap(snapshot => snapshot.evidence)) {
    const bytes = await fs.readFile(evidence.path); if (sha(bytes) !== evidence.sha256) throw Error('Source packet changed');
    const packet = JSON.parse(bytes); packets.push(packet);
    for (const region of packet.regions) packetBySnapshotRegion.set(`${packet.snapshot.id}:${region.id}`, packet);
  }
  const snapshot = source.snapshots.find(snapshot => snapshot.viewport.name === 'desktop'); if (!snapshot) throw Error('Desktop evidence is missing');
  if (frozenPlan && frozenPlan.desktopSnapshotId !== snapshot.id) throw Error('Frozen component plan belongs to another desktop snapshot');
  const evidenceAliases = new Map();
  for (const binding of bindings.values()) for (const proof of binding.evidenceAliases ?? []) {
    const packet = packetBySnapshotRegion.get(`${snapshot.id}:${proof.regionId}`), actual = packet && proveCanonicalCloneEvidenceV2({ packet, nodeId: proof.sourceNodeId });
    if (!binding.regionIds.includes(proof.regionId) || JSON.stringify(actual) !== JSON.stringify(proof) || !binding.evidenceNodeIds?.includes(proof.canonicalNodeId)) throw Error(`Component ${binding.componentKey} has an unproved canonical clone evidence alias`);
    if (evidenceAliases.has(proof.sourceNodeId) && evidenceAliases.get(proof.sourceNodeId) !== proof.canonicalNodeId) throw Error('Canonical clone evidence aliases conflict');
    evidenceAliases.set(proof.sourceNodeId,proof.canonicalNodeId);
  }
  const allNodes = new Map();
  for (const packet of packets) for (const [id, node] of Object.entries(packet.nodes)) allNodes.set(`${packet.snapshot.id}:${id}`, { ...node, packet });
  const nodeAt = (snapshotId, nodeId) => allNodes.get(`${snapshotId}:${nodeId}`);
  const ancestry = (snapshotId, nodeId) => { const result = [], seen = new Set(); while (nodeId) { if (seen.has(nodeId)) throw Error('Cyclic source node ownership'); seen.add(nodeId); const node = nodeAt(snapshotId, nodeId); if (!node) break; result.push(node); nodeId = node.parentId; } return result; };
  const canonicalNode = fact => {
    const chain = ancestry(fact.snapshotId, fact.nodeId), clone = chain.find(node => /(?:slick-cloned|swiper-slide-duplicate)/.test(node.attributes.class ?? ''));
    if (!clone) return fact.nodeId;
    const interaction = Object.values(clone.packet.interactions).find(item => item.kind === 'carousel' && item.cloneNodeIds?.includes(clone.id));
    if (!interaction?.itemNodeIds.length) return fact.nodeId;
    const track = clone.packet.nodes[interaction.trackNodeId], firstReal = track?.childIds.indexOf(interaction.itemNodeIds[0]), cloneIndex = track?.childIds.indexOf(clone.id);
    if (firstReal < 0 || cloneIndex < 0) return fact.nodeId;
    let current = interaction.itemNodeIds[((cloneIndex - firstReal) % interaction.itemNodeIds.length + interaction.itemNodeIds.length) % interaction.itemNodeIds.length];
    const pathNodes = chain.slice(0, chain.indexOf(clone)).reverse();
    for (const descendant of pathNodes) { const position = clone.packet.nodes[descendant.parentId]?.childIds.indexOf(descendant.id); current = clone.packet.nodes[current]?.childIds[position]; if (!current) return fact.nodeId; }
    return current;
  };
  const inside = (snapshotId, nodeId, ancestorId) => ancestry(snapshotId, nodeId).some(node => node.id === ancestorId);
  const related = (snapshotId, nodeId, bindingId) => inside(snapshotId, nodeId, bindingId) || inside(snapshotId, bindingId, nodeId);
  // Responsive bindings are separate, snapshot-qualified evidence. Never use a
  // coincidentally equal numeric ID, selector or text to fill an absent mapping.
  const variantBindings = new Map(), variantNodeMappings = new Map(), mappedSnapshots = new Set();
  const mappingRecords = [];
  const unpackMappings = value => {
    if (Array.isArray(value)) { value.forEach(unpackMappings); return; }
    if (!value || typeof value !== 'object') throw Error('responsiveMappings must contain explicit mapping records');
    if (Array.isArray(value.mappings)) {
      mappingRecords.push(...value.mappings);
      for (const gap of value.gaps ?? []) gaps.push({ ...gap, code: gap.code ?? 'responsive-mapping-gap', snapshotId: gap.snapshotId ?? value.mappings[0]?.snapshotId, reason: gap.message ?? 'The responsive mapper reported an unresolved source identity' });
    } else mappingRecords.push(value);
  };
  if (authored.responsiveMappings !== undefined) unpackMappings(authored.responsiveMappings);
  const linkAt = (snapshotId, nodeId) => ancestry(snapshotId, nodeId).find(node => node.tag === 'a' && node.attributes.href)?.attributes.href ?? null;
  const isClone = (snapshotId, nodeId) => ancestry(snapshotId, nodeId).some(node => /(?:^|\s)(?:slick-cloned|swiper-slide-duplicate)(?:\s|$)/.test(node.attributes.class ?? ''));
  const mediaAt = (packet, nodeId) => {
    const families = new Map();
    for (const usage of Object.values(packet.usages ?? {}).filter(item => item.nodeId === nodeId)) {
      const resource = packet.resources?.[usage.resourceId]; if (!resource) continue;
      const family = ['img', 'picture'].includes(usage.kind) ? 'image' : usage.kind, identity = resource.inline ? `inline:${resource.inline}` : resource.url;
      if (!families.has(family)) families.set(family, new Set()); families.get(family).add(identity);
    }
    return families;
  };
  for (const mapping of mappingRecords) {
    const binding = bindings.get(mapping.componentKey), later = source.snapshots.find(item => item.id === mapping.snapshotId), key = `${mapping.snapshotId}:${mapping.componentKey}`;
    const fail = reason => gaps.push({ code: 'responsive-binding-invalid', snapshotId: mapping.snapshotId, componentKey: mapping.componentKey, reason });
    if (!binding || !later || later.id === snapshot.id || mapping.desktopSnapshotId !== snapshot.id || mapping.viewport !== later.viewport.name) { fail('The responsive component mapping needs its actual desktop identity and independently captured later snapshot/viewport'); continue; }
    if (variantBindings.has(key)) { fail('A component has duplicate bindings for this actual snapshot'); continue; }
    if (!Array.isArray(mapping.regionIds) || mapping.regionIds.length !== binding.regionIds.length || mapping.regionIds.some(id => !binding.regionIds.includes(id)) || !Array.isArray(mapping.nodeMappings)) { fail('The responsive mapping must retain the desktop component region owners and explicit node-path evidence'); continue; }
    const proofs = new Map(), mappedIds = new Set(); let invalid = false;
    const mediaVariants = mapping.explicitMediaVariants ?? [];
    if (!Array.isArray(mediaVariants) || new Set(mediaVariants.map(item => `${item.desktopUsageId}:${item.variantUsageId}`)).size !== mediaVariants.length) { fail('Explicit CSS background variants must be unique exact usage pairs'); continue; }
    for (const declaration of mediaVariants) {
      const original = source.facts[`${snapshot.id}:media:${declaration.desktopUsageId}`], variant = source.facts[`${later.id}:media:${declaration.variantUsageId}`];
      try {
        if (!mapping.regionIds.includes(declaration.regionId) || !original || !variant || original.nodeId !== declaration.desktopNodeId || variant.nodeId !== declaration.variantNodeId || JSON.stringify(original.evidence) !== JSON.stringify(declaration.desktopEvidence) || JSON.stringify(variant.evidence) !== JSON.stringify(declaration.variantEvidence)) throw Error('Background declaration is not bound to its two exact independently hashed source facts');
        proveCssBackgroundVariantV2({ desktopPacket: packetBySnapshotRegion.get(`${snapshot.id}:${declaration.regionId}`), variantPacket: packetBySnapshotRegion.get(`${later.id}:${declaration.regionId}`), declaration });
      } catch (error) { fail(`Explicit CSS background variant is unproven: ${error.message}`); invalid = true; }
    }
    for (const proof of mapping.nodeMappings) {
      const desktopPacket = packetBySnapshotRegion.get(`${snapshot.id}:${proof.regionId}`), laterPacket = packetBySnapshotRegion.get(`${later.id}:${proof.regionId}`);
      const requiredEvidence = ['same-source-region-root', 'relative-child-slot-path', 'all-ancestor-tags'];
      if (!mapping.regionIds.includes(proof.regionId) || !desktopPacket || !laterPacket || !Array.isArray(proof.path) || proof.path.some(index => !Number.isInteger(index) || index < 0) || !Array.isArray(proof.evidence) || !requiredEvidence.every(item => proof.evidence.includes(item))) { fail(`Node ${proof.desktopNodeId} lacks same-owner relative-path evidence`); invalid = true; continue; }
      if (proof.explicitNodeVariant) {
        try {
          const declaration = proof.explicitNodeVariant.declaration, desktopEvidence = snapshot.evidence.find(item => item.path === declaration.desktopEvidence?.path), variantEvidence = later.evidence.find(item => item.path === declaration.variantEvidence?.path);
          if (!desktopEvidence || !variantEvidence || desktopEvidence.sha256 !== declaration.desktopEvidence.sha256 || variantEvidence.sha256 !== declaration.variantEvidence.sha256 || declaration.desktopSnapshotId !== snapshot.id || declaration.snapshotId !== later.id || declaration.regionId !== proof.regionId) throw Error('Explicit owner pairing does not identify its two actual independently hashed packet files');
          const actual = proveResponsiveExplicitNodeMappingV2({desktopPacket,variantPacket:laterPacket,desktopPacketSha256:desktopEvidence.sha256,variantPacketSha256:variantEvidence.sha256,declaration});
          if (JSON.stringify(actual) !== JSON.stringify(proof)) throw Error('Explicit owner pairing proof no longer equals its actual independent replay');
          if (proofs.has(proof.desktopNodeId) && proofs.get(proof.desktopNodeId).variantNodeId !== proof.variantNodeId) throw Error('Explicit owner pairing conflicts with an already mapped responsive node');
          proofs.set(proof.desktopNodeId,proof);mappedIds.add(proof.variantNodeId);continue;
        } catch(error) {fail(`Explicit source owner mapping is unproven: ${error.message}`);invalid=true;continue;}
      }
      let before = desktopPacket.nodes[desktopPacket.regions.find(item => item.id === proof.regionId)?.nodeId], after = laterPacket.nodes[laterPacket.regions.find(item => item.id === proof.regionId)?.nodeId];
      let valid = before && after && before.tag === after.tag;
      const carouselSlots = proof.carouselSlots ?? [], consumedSlots = new Set();
      if (!Array.isArray(carouselSlots) || carouselSlots.some(slot => !slot || typeof slot !== 'object' || !Number.isInteger(slot.pathOffset) || slot.pathOffset < 0 || slot.pathOffset >= proof.path.length) || new Set(carouselSlots.map(slot => slot.pathOffset)).size !== carouselSlots.length || carouselSlots.length && !['canonical-carousel-real-item-slot', 'carousel-item-owned-destinations-and-media'].every(item => proof.evidence.includes(item))) valid = false;
      if (valid) for (const [pathOffset, index] of proof.path.entries()) {
        const desktopParent = before, variantParent = after;
        before = desktopPacket.nodes[desktopParent?.childIds?.[index]];
        const slot = carouselSlots.find(item => item.pathOffset === pathOffset);
        if (slot) {
          try {
            const actual = proveCarouselRealItemSlot({ desktopPacket, variantPacket: laterPacket, desktopTrackNodeId: desktopParent?.id, variantTrackNodeId: variantParent?.id, desktopItemNodeId: before?.id, pathOffset, explicitMediaVariants: mediaVariants });
            if (JSON.stringify(actual) !== JSON.stringify(slot)) { valid = false; break; }
            after = laterPacket.nodes[actual.variantItemNodeId]; consumedSlots.add(pathOffset);
          } catch { valid = false; break; }
        } else after = laterPacket.nodes[variantParent?.childIds?.[index]];
        valid &&= !!before && !!after && before.tag === after.tag;
        if (!valid) break;
      }
      valid &&= consumedSlots.size === carouselSlots.length;
      valid &&= before?.id === proof.desktopNodeId && after?.id === proof.variantNodeId && before.regionId === proof.regionId && after.regionId === proof.regionId;
      if (valid) valid = sameResponsiveNodeRoleV2(before,after);
      if (valid) valid = linkAt(snapshot.id, before.id) === linkAt(later.id, after.id) && isClone(snapshot.id, before.id) === isClone(later.id, after.id);
      if (valid) valid = ownedMediaCompatibleV2({ desktopPacket, variantPacket: laterPacket, desktopNodeId: before.id, variantNodeId: after.id, explicitMediaVariants: mediaVariants });
      if (!valid || proofs.has(proof.desktopNodeId) && proofs.get(proof.desktopNodeId).variantNodeId !== proof.variantNodeId) { fail(`Node ${proof.desktopNodeId} does not match the actual recorded path, ancestor tags, link, clone or media ownership`); invalid = true; continue; }
      proofs.set(proof.desktopNodeId, proof); mappedIds.add(proof.variantNodeId);
    }
    const declaredIds = [...(mapping.sourceNodeIds ?? []), ...(mapping.evidenceNodeIds ?? []), ...Object.values(mapping.slotNodes ?? {}).flatMap(slots => Object.values(slots).flat()), ...Object.keys(mapping.layoutNodes ?? {})];
    if (!Array.isArray(mapping.sourceNodeIds) || !mapping.sourceNodeIds.length || declaredIds.some(nodeId => !mappedIds.has(nodeId))) { fail('Every responsive source, typed slot and layout node requires its own actual path mapping'); invalid = true; }
    if (binding.evidenceNodeIds !== undefined && (!Array.isArray(mapping.evidenceNodeIds) || new Set(binding.evidenceNodeIds).size !== mapping.evidenceNodeIds.length || binding.evidenceNodeIds.some(nodeId => !proofs.has(nodeId) || !mapping.evidenceNodeIds.includes(proofs.get(nodeId).variantNodeId)))) { fail('Every explicitly declared desktop evidence node requires its own independently replayed responsive mapping'); invalid = true; }
    if (mediaVariants.some(item => proofs.get(item.desktopNodeId)?.variantNodeId !== item.variantNodeId)) { fail('Every explicit CSS background variant must also retain its independently replayed exact DOM owner path'); invalid = true; }
    if (invalid) continue;
    variantBindings.set(key, { ...binding, ...mapping }); variantNodeMappings.set(key, proofs); mappedSnapshots.add(later.id);
  }
  const bindingFor = (key, snapshotId = snapshot.id) => snapshotId === snapshot.id ? bindings.get(key) : variantBindings.get(`${snapshotId}:${key}`);
  const renderer = component => ({ 'html-static': 'html', 'native-carousel': 'carousel', 'native-products': 'products' })[component.kind] ?? component.kind;
  const editability = component => component.kind === 'html-static' ? 'code' : component.kind === 'native-products' ? 'woocommerce' : component.kind === 'composite' ? 'mixed' : 'controls';
  const rootSelector = key => `[data-id="${idFor(authored.taskId, key)}"]`;
  const widgetSelector = component => rootSelector(component.key + (component.kind === 'native-carousel' ? '-carousel' : component.kind === 'native-products' ? '-products' : component.kind === 'html-static' ? '-content' : '-native'));
  const scopeSelector = key => `#cwp-${idFor(authored.taskId, `${key}-content`)}`;
  const slotSelector = (component, kind, slot) => kind === 'native' ? widgetSelector(component) : `${scopeSelector(component.key)} [data-cwp-${kind === 'links' ? 'link' : kind === 'media' ? component.template.includes(`data-cwp-background="${slot}"`) ? 'background' : 'media' : 'text'}="${slot}"]`;
  const facts = Object.values(source.facts);
  const nodeFacts = new Map();
  for (const fact of facts) { const key = `${fact.snapshotId}:${fact.nodeId}`; if (!nodeFacts.has(key)) nodeFacts.set(key, []); nodeFacts.get(key).push(fact); }
  const boundEntries = entries.filter(entry => bindings.has(entry.component.key));
  const candidatesFor = fact => boundEntries.filter(entry => bindingFor(entry.component.key, fact.snapshotId)?.regionIds.includes(fact.regionId)).sort((a, b) => b.depth - a.depth);
  const relationScore = (fact, ids) => ids.some(id => id === fact.nodeId) ? 3 : ids.some(id => inside(fact.snapshotId, fact.nodeId, id)) ? 2 : ids.some(id => inside(fact.snapshotId, id, fact.nodeId)) ? 1 : 0;
  const ownerFor = fact => candidatesFor(fact).map(entry => ({ ...entry, score: relationScore(fact, bindingFor(entry.component.key, fact.snapshotId).sourceNodeIds ?? []) })).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || b.depth - a.depth)[0];
  const sourceHref = fact => fact.kind === 'interaction' && fact.value.kind === 'link' ? fact.value.href : ancestry(fact.snapshotId, fact.nodeId).find(node => /^https?:/.test(node.attributes.href ?? ''))?.attributes.href;
  const matchedSlots = (fact, kinds = ['text', 'media', 'links', 'native']) => {
    const canonical = canonicalNode(fact), lookup = canonical === fact.nodeId ? fact : { ...fact, nodeId: canonical };
    const found = [];
    for (const entry of candidatesFor(fact)) {
      const binding = bindingFor(entry.component.key, fact.snapshotId);
      for (const kind of kinds) for (const [slot, nodeIds] of Object.entries(binding.slotNodes?.[kind] ?? {})) {
        const score = relationScore(lookup, nodeIds);
        if (score) found.push({ ...entry, kind, slot, nodeIds, score });
      }
    }
    return found.sort((a, b) => b.score - a.score || b.depth - a.depth);
  };
  const namedGap = (fact, reason, detail = {}) => gaps.push({ code: `unbound-${fact.kind}`, factId: fact.id, snapshotId: fact.snapshotId, regionId: fact.regionId, sourceNodeId: fact.nodeId, sourceSelector: nodeAt(fact.snapshotId, fact.nodeId)?.selector, reason, ...detail });
  const add = (fact, entry, disposition, rule, verification) => {
    if (!entry || !verification?.selector) { namedGap(fact, 'Disposition has no exact component and target selector'); return; }
    requirements.push({ id: `requirement-${sha(fact.id).slice(0, 20)}`, factIds: [fact.id], componentId: entry.component.key, disposition, rule, verification: { ...verification, snapshotId: fact.snapshotId, viewport: source.snapshots.find(snapshot => snapshot.id === fact.snapshotId).viewport.name } });
    decisions.push({ factId: fact.id, componentKey: entry.component.key, disposition, verification: verification.kind, selector: verification.selector });
  };
  const actualSlot = (match) => match.kind === 'native' ? match.component.widgetSettings?.[match.slot] : match.component.slots?.[match.kind]?.[match.slot];
  const ownsExactSlot = (fact,match) => canonicalNode(fact) === fact.nodeId && bindingFor(match.component.key,fact.snapshotId)?.slotNodes?.[match.kind]?.[match.slot]?.includes(fact.nodeId);
  const sourceCopyAt = (fact, ids) => facts.filter(other => other.kind === 'text' && other.snapshotId === fact.snapshotId && ids.includes(other.nodeId)).map(other => other.value.text).join(' ');
  const textRequirement = (fact, match, overrideRule) => {
    const value = actualSlot(match), actual = typeof value === 'string' ? value : undefined;
    if (actual === undefined) return false;
    const sourceText = norm(fact.value.text), combined = norm(sourceCopyAt(fact, match.nodeIds));
    if (norm(actual) !== sourceText && norm(actual) !== combined && !overrideRule) return false;
    const canonicalOrHidden = canonicalNode(fact) !== fact.nodeId || nodeAt(fact.snapshotId, fact.nodeId)?.visible === false, exact = ownsExactSlot(fact,match) && norm(actual) === sourceText;
    add(fact, match, exact || norm(actual) === sourceText && !canonicalOrHidden ? 'preserve' : 'adapt', overrideRule ?? (exact ? 'Preserve the exact source wording and observed layout visibility in this independently owned stable text slot.' : canonicalOrHidden ? 'Use the same canonical typed slot for cloned or responsive-inactive source copy; preserve its wording without copying the redundant source DOM or inactive display state.' : norm(actual) === sourceText ? 'Preserve the exact normalized source copy in its own typed component slot.' : 'Consolidate source-owned text atoms in their authored shared label, preserving the complete normalized wording.'), { kind: 'text', selector: slotSelector(match.component, match.kind, match.slot), expected: { text: actual, ...(exact ? {visible:fact.value.visible ?? nodeAt(fact.snapshotId,fact.nodeId).visible} : {}) } }); return true;
  };
  const externalMatch = (fact) => {
    const href = sourceHref(fact); if (!/^https?:/.test(href ?? '')) return;
    const direct = matchedSlots(fact, ['links']).filter(match => actualSlot(match)?.url === href);
    if (direct.length) return { match: direct[0], href };
    if (fact.snapshotId !== snapshot.id) return;
    const equal = candidatesFor(fact).flatMap(entry => Object.entries(entry.component.slots?.links ?? {}).filter(([, link]) => link.url === href).map(([slot]) => ({ ...entry, kind: 'links', slot })));
    if (equal.length) return { match: equal[0], href };
  };
  const explicitBySnapshot = new Map(), authoredAdaptations = authored.adaptations ?? [];
  const appliesToSnapshot = (item, snapshotId) => item.snapshotId ? item.snapshotId === snapshotId : item.sourceFactIds?.length ? item.sourceFactIds.some(id => source.facts[id]?.snapshotId === snapshotId) : snapshotId === snapshot.id;
  explicitBySnapshot.set(snapshot.id, authoredAdaptations.filter(item => appliesToSnapshot(item, snapshot.id)));
  const uniqueMappedNode = (snapshotId, desktopNodeId) => {
    const canonical = evidenceAliases.get(desktopNodeId) ?? desktopNodeId;
    const candidates = [...new Set([...variantNodeMappings].filter(([key]) => key.startsWith(`${snapshotId}:`)).map(([, proofs]) => proofs.get(canonical)?.variantNodeId).filter(Boolean))];
    return candidates.length === 1 ? candidates[0] : undefined;
  };
  const sameFactRole = (a,b) => a.kind === b.kind && (a.value.kind === b.value.kind || a.kind === 'media' && ['img','picture'].includes(a.value.kind) && ['img','picture'].includes(b.value.kind)) && a.value.purpose === b.value.purpose && (a.value.kind !== 'control' || a.value.details?.type === b.value.details?.type);
  const carouselFactCache = new Map();
  const responsiveFactAlternatives = (original,snapshotId) => {
    if (original.kind === 'interaction' && original.value.kind === 'carousel') {
      const key=`${snapshotId}:${original.id}`;if(carouselFactCache.has(key))return carouselFactCache.get(key);
      let result=[];
      try {
        const track=uniqueMappedNode(snapshotId,original.value.trackNodeId),before=packetBySnapshotRegion.get(`${snapshot.id}:${original.regionId}`),after=packetBySnapshotRegion.get(`${snapshotId}:${original.regionId}`);
        const candidates=facts.filter(fact=>fact.snapshotId===snapshotId&&fact.regionId===original.regionId&&fact.kind==='interaction'&&fact.value.kind==='carousel'&&fact.value.trackNodeId===track);
        if(!track||!before||!after||candidates.length!==1)throw Error('Carousel requires one exact mapped actual track');
        const candidate=candidates[0],controls=candidate.value.controlNodeIds??[],mediaVariants=[...new Map(mappingRecords.filter(m=>m.snapshotId===snapshotId).flatMap(m=>m.explicitMediaVariants??[]).map(item=>[JSON.stringify(item),item])).values()];if(!inside(snapshotId,track,candidate.nodeId)||controls.some(id=>!inside(snapshotId,id,candidate.nodeId)))throw Error('Actual carousel track and controllers leave their widened source owner');
        for(const [ordinal,item] of original.value.itemNodeIds.entries()){const proof=proveCarouselRealItemSlot({desktopPacket:before,variantPacket:after,desktopTrackNodeId:original.value.trackNodeId,variantTrackNodeId:track,desktopItemNodeId:item,pathOffset:0,explicitMediaVariants:mediaVariants});if(proof.realItemOrdinal!==ordinal||proof.variantItemNodeId!==candidate.value.itemNodeIds[ordinal])throw Error('Actual real-item ownership changed');}
        if((original.value.controlNodeIds??[]).some(id=>!controls.includes(uniqueMappedNode(snapshotId,id))))throw Error('A previously owned controller has no proved continuation');
        result=[candidate];
      }catch{}
      carouselFactCache.set(key,result);return result;
    }
    const nodeId=uniqueMappedNode(snapshotId,original.nodeId);let alternatives=nodeId?(nodeFacts.get(`${snapshotId}:${nodeId}`)??[]).filter(fact=>sameFactRole(original,fact)):[];
    if(alternatives.length>1&&original.kind==='media')alternatives=alternatives.filter(fact=>fact.value.attribute===original.value.attribute&&fact.value.resource?.url===original.value.resource?.url);
    return alternatives;
  };
  for (const snapshotId of mappedSnapshots) {
    const explicit = [...authoredAdaptations.filter(item => appliesToSnapshot(item, snapshotId)), ...mappingRecords.filter(mapping => mapping.snapshotId === snapshotId).flatMap(mapping => (mapping.adaptations ?? []).map(item => ({ ...item, snapshotId })))];
    const inherited = [];
    const adaptationGap = (item, nodeId, reason) => gaps.push({ code: 'responsive-adaptation-unmapped', snapshotId, desktopNodeId: nodeId, componentKey: item.target?.componentKey ?? item.componentKey ?? item.component, reason, rule: item.rule });
    for (const item of explicitBySnapshot.get(snapshot.id)) {
      if (!item.target) continue;
      if (item.sourceNodeIds?.length) {
        const mapped = item.sourceNodeIds.map(nodeId => uniqueMappedNode(snapshotId, nodeId));
        if (mapped.some(nodeId => !nodeId)) { item.sourceNodeIds.forEach((nodeId, index) => { if (!mapped[index]) adaptationGap(item, nodeId, 'Desktop adaptation source node has no exact, independently proved responsive path mapping'); }); continue; }
        const kind = item.target.kind ?? item.target.verification?.kind, property = item.target.property ?? item.target.verification?.property;
        if (kind === 'layout' || kind === 'interaction' && property === 'hover') {
          const unhandled = facts.filter(fact => fact.snapshotId === snapshotId && mapped.some(nodeId => inside(snapshotId, fact.nodeId, nodeId))).filter(fact => !explicit.some(candidate => candidate.sourceFactIds?.includes(fact.id) || candidate.sourceNodeIds?.some(nodeId => inside(snapshotId, fact.nodeId, nodeId))));
          if (unhandled.length) adaptationGap(item, item.sourceNodeIds[0], 'A subtree geometry or desktop-hover adaptation requires an explicitly authored later viewport rule; desktop dimensions and pointer behavior cannot be copied wholesale');
          continue;
        }
        inherited.push({ ...item, snapshotId, sourceNodeIds: mapped, sourceFactIds: [] });
      }
      for (const factId of item.sourceFactIds ?? []) {
        const original = source.facts[factId]; if (original?.snapshotId !== snapshot.id) continue;
        const alternatives = responsiveFactAlternatives(original,snapshotId);
        if (alternatives.length !== 1) { adaptationGap(item, original.nodeId, 'Desktop fact adaptation needs one exact mapped responsive fact with the same factual role'); continue; }
        const fact = alternatives[0];
        if (explicit.some(candidate => candidate.sourceFactIds?.includes(fact.id) || candidate.sourceNodeIds?.some(id => inside(snapshotId, fact.nodeId, id)))) continue;
        const target = structuredClone(item.target), kind = target.kind ?? target.verification?.kind;
        if (kind === 'interaction' && (target.property ?? target.verification?.property) === 'hover') { adaptationGap(item, original.nodeId, 'A desktop hover adaptation requires an explicitly authored touch/disclosure rule for the later viewport'); continue; }
        if (kind === 'text' && original.kind === 'text' && norm(original.value.text) !== norm(fact.value.text)) { adaptationGap(item, original.nodeId, 'Changed responsive source wording requires an explicitly authored variant slot/rule'); continue; }
        if (kind === 'layout') {
          const property = target.property ?? target.verification?.property, expected = target.expected ?? target.verification?.expected;
          if (property) {
            const value = fact.value.style?.[property];
            if (value === undefined) { adaptationGap(item, original.nodeId, `Responsive source fact has no actual ${property} paint evidence`); continue; }
            target.expected = value;
          } else if (expected && typeof expected === 'object') {
            const node = nodeAt(snapshotId, fact.nodeId), raw = fact.value.layout?.rect ?? fact.value.rect ?? node?.packet.layouts?.[node.layoutId]?.rect, dimensions = Object.keys(expected.rect ?? expected);
            if (!raw || !dimensions.length || dimensions.some(key => !['x', 'y', 'width', 'height'].includes(key) || !Number.isFinite(raw[key]))) { adaptationGap(item, original.nodeId, 'Responsive layout adaptation has no corresponding actual measured dimensions'); continue; }
            const rect = Object.fromEntries(dimensions.map(key => [key, raw[key]])); target.expected = expected.rect ? { ...expected, rect } : rect;
          }
        }
        inherited.push({ ...item, snapshotId, sourceFactIds: [fact.id], sourceNodeIds: [], target });
      }
    }
    explicitBySnapshot.set(snapshotId, [...explicit, ...inherited]);
  }
  const explicitAdaptation = fact => (explicitBySnapshot.get(fact.snapshotId) ?? []).find(item => (item.sourceFactIds?.includes(fact.id) || item.sourceNodeIds?.some(id => inside(fact.snapshotId, fact.nodeId, id))) && item.target);
  const frozenIndex = new Map(), frozenCanonicalCache = new Map();
  const frozenCanonical = fact => {
    const key = `${fact.snapshotId}:${fact.nodeId}`; if (frozenCanonicalCache.has(key)) return frozenCanonicalCache.get(key);
    const packet = nodeAt(fact.snapshotId,fact.nodeId)?.packet, proof = packet && proveCanonicalCloneEvidenceV2({packet,nodeId:fact.nodeId}), id = proof?.canonicalNodeId ?? fact.nodeId; frozenCanonicalCache.set(key,id); return id;
  };
  if (frozenPlan) for (const requirement of frozenPlan.requirements ?? []) {
    if (!['text','external','interaction','media'].includes(requirement.verification?.kind) || requirement.verification.property === 'hover') continue;
    if (!components.has(requirement.componentId)) throw Error(`Frozen desktop requirement has no current component: ${requirement.componentId}`);
    for (const factId of requirement.factIds ?? []) {
      const original = source.facts[factId]; if (!original || original.snapshotId !== snapshot.id || !['text','interaction','media'].includes(original.kind)) continue;
      for (const snapshotId of mappedSnapshots) {
        const nodeId = original.kind==='interaction'&&original.value.kind==='carousel' ? responsiveFactAlternatives(original,snapshotId)[0]?.nodeId : uniqueMappedNode(snapshotId,frozenCanonical(original)); if (!nodeId) continue;
        const key = `${snapshotId}:${requirement.componentId}:${nodeId}:${original.kind}`, rows = frozenIndex.get(key) ?? []; rows.push({requirement,original}); frozenIndex.set(key,rows);
      }
    }
  }
  const frozenDisposition = fact => {
    if (!frozenPlan || fact.snapshotId === snapshot.id || !['text','interaction','media'].includes(fact.kind)) return;
    const rows = candidatesFor(fact).flatMap(entry => frozenIndex.get(`${fact.snapshotId}:${entry.component.key}:${frozenCanonical(fact)}:${fact.kind}`) ?? []).filter(({original}) => sameFactRole(original,fact) && (fact.kind !== 'text' || norm(original.value.text) === norm(fact.value.text)) && (fact.value.kind !== 'link' || original.value.href === fact.value.href));
    const targets = new Map();
    for (const {requirement,original} of rows) {
      const verification = structuredClone(requirement.verification); delete verification.snapshotId; delete verification.viewport;
      if(fact.kind==='text'&&verification.kind==='text'&&(original.value.visible??nodeAt(original.snapshotId,original.nodeId).visible)!==(fact.value.visible??nodeAt(fact.snapshotId,fact.nodeId).visible))continue;
      if(fact.kind==='media'){
        const href=sourceHref(fact),oldHref=sourceHref(original);
        if(verification.kind==='external'){if(nodeAt(fact.snapshotId,fact.nodeId).visible||href!==oldHref||verification.expected!==href)continue;}
        else if(verification.kind==='media'){
          const url=fact.value.resource?.url,oldURL=original.value.resource?.url,packet=nodeAt(fact.snapshotId,fact.nodeId).packet,selected=Object.values(packet.usages).find(usage=>usage.nodeId===frozenCanonical(fact)&&['img','picture'].includes(usage.kind)&&['src','currentSrc'].includes(usage.attribute)),actualURL=['img','picture'].includes(fact.value.kind)?packet.resources[selected?.resourceId]?.url:url,asset=manifest.assets.find(asset=>asset.key===verification.expected?.assetKey),slotName=/data-cwp-(?:media|background)="([^"]+)"/.exec(verification.selector)?.[1],slot=components.get(requirement.componentId).component.slots?.media?.[slotName];
          if(!url||url!==oldURL||actualURL!==url||!asset||![asset.sourceUrl,asset.observedResourceUrl].includes(url)||!slot||![slot.assetKey,...(slot.responsive??[]).map(item=>item.assetKey)].includes(asset.key))continue;
        }else continue;
      }
      if (verification.kind === 'text' && requirement.disposition === 'preserve' && frozenCanonical(fact) === fact.nodeId) verification.expected = { ...(typeof verification.expected === 'object' ? verification.expected : {text:verification.expected}), visible:fact.value.visible ?? nodeAt(fact.snapshotId,fact.nodeId).visible };
      const value = {entry:components.get(requirement.componentId),disposition:frozenCanonical(fact) === fact.nodeId ? requirement.disposition : 'adapt',rule:requirement.rule + ' The frozen desktop target binding is carried only through independently replayed same-component responsive ownership and unchanged static factual role.',verification};
      targets.set(JSON.stringify({componentId:requirement.componentId,verification}),value);
    }
    return targets.size === 1 ? [...targets.values()][0] : undefined;
  };
  const applyExplicit = (fact, adaptation) => {
    const target = adaptation.target, entry = components.get(target.componentKey ?? adaptation.componentKey ?? adaptation.component);
    if (!entry) { namedGap(fact, 'Explicit adaptation references an absent component'); return true; }
    const kind = target.kind ?? target.verification?.kind;
    const selector = target.selector ?? (target.slot ? slotSelector(entry.component, kind === 'external' ? 'links' : kind, target.slot) : undefined);
    if (!selector || !kind) { namedGap(fact, 'Explicit adaptation lacks a typed target selector'); return true; }
    const expected = target.expected ?? target.verification?.expected ?? (target.slot && kind === 'external' ? entry.component.slots.links[target.slot]?.url : undefined);
    const disposition = adaptation.disposition ?? target.disposition ?? (kind === 'external' && /^https?:/.test(sourceHref(fact) ?? '') && sourceHref(fact) === expected ? 'external' : 'adapt');
    add(fact, entry, disposition, adaptation.rule, { ...(target.verification ?? {}), kind, selector, ...(expected !== undefined ? { expected } : {}), ...(target.property ? { property: target.property } : {}), ...(target.tolerance !== undefined ? { tolerance: target.tolerance } : {}) }); return true;
  };
  const sourceCarouselFor = fact => {
    const sourceCandidates = Object.values(nodeAt(fact.snapshotId, fact.nodeId).packet.interactions).filter(item => item.kind === 'carousel');
    const a = ancestry(fact.snapshotId, fact.nodeId).map(node => node.id);
    const scored = sourceCandidates.map(interaction => { const b = ancestry(fact.snapshotId, interaction.nodeId).map(node => node.id), shared = a.findIndex(id => b.includes(id)); return { interaction, distance: shared < 0 ? Infinity : shared + b.indexOf(a[shared]) }; }).sort((left, right) => left.distance - right.distance);
    if (!scored.length || !Number.isFinite(scored[0].distance) || scored[1]?.distance === scored[0].distance) return;
    const actual = scored[0].interaction;
    return candidatesFor(fact).filter(entry => ['native-carousel', 'native-products'].includes(entry.component.kind)).map(entry => ({ ...entry, score: relationScore({ ...fact, nodeId: actual.nodeId }, bindingFor(entry.component.key, fact.snapshotId).sourceNodeIds ?? []) })).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score)[0];
  };

  for (const fact of facts) {
    if (fact.snapshotId !== snapshot.id && !mappedSnapshots.has(fact.snapshotId)) { namedGap(fact, 'The desktop authoring recipe has no explicit responsive snapshot identity/slot binding; matching numeric DOM IDs across viewports is not evidence'); continue; }
    const node = nodeAt(fact.snapshotId, fact.nodeId), owner = ownerFor(fact), explicit = explicitAdaptation(fact);
    if (!node) { namedGap(fact, 'Source fact node has no packet owner'); continue; }
    if (explicit && applyExplicit(fact, explicit)) continue;
    const exact = fact.kind==='text' ? matchedSlots(fact,['text','native']).filter(match=>ownsExactSlot(fact,match)&&norm(actualSlot(match))===norm(fact.value.text)) : fact.kind==='interaction'&&fact.value.kind==='link' ? matchedSlots(fact,['links']).filter(match=>ownsExactSlot(fact,match)&&actualSlot(match)?.url===fact.value.href) : [];
    if(exact.length>1){namedGap(fact,'One actual source node is ambiguously assigned to multiple exact target slots; declare the authoritative owner/slot or an explicit adaptation',{slots:exact.map(match=>({componentKey:match.component.key,slot:match.slot,kind:match.kind}))});continue;}
    const carried = exact.length ? undefined : frozenDisposition(fact);
    if (carried) { add(fact,carried.entry,carried.disposition,carried.rule,carried.verification); continue; }
    if (fact.kind === 'region' || fact.kind === 'layout') {
      const packet = node.packet, region = packet.regions.find(region => region.id === fact.regionId), isContent = fact.kind === 'layout' && fact.value.purpose === 'content';
      const exact = candidatesFor(fact).filter(entry => bindingFor(entry.component.key, fact.snapshotId).sourceNodeIds?.includes(fact.nodeId));
      const chosen = exact.find(entry => entry.component.kind !== 'native-carousel' && entry.component.kind !== 'native-products') ?? exact[0];
      const layoutBinding = candidatesFor(fact).map(entry => ({ entry, target: bindingFor(entry.component.key, fact.snapshotId).layoutNodes?.[fact.nodeId] })).find(item => item.target);
      if (layoutBinding) {
        const { entry, target } = layoutBinding, raw = fact.kind === 'region' ? packet.layouts[node.layoutId].rect : fact.value.rect;
        const dimensions = target.dimensions ?? ['x', 'width', ...(target.adaptHeight ? [] : ['height'])];
        const expected = Object.fromEntries(dimensions.map(key => [key, raw[key]]));
        add(fact, entry, target.adaptHeight ? 'adapt' : 'preserve', target.rule ?? 'Preserve the independently observed target content frame and centered insets in an explicitly mapped same-component container.', { kind: 'layout', selector: target.selector ?? `${entry.component.kind === 'html-static' ? scopeSelector(entry.component.key) : rootSelector(entry.component.key)} ${target.localSelector}`.trim(), expected, tolerance: 20 }); continue;
      }
      if (!chosen || isContent && fact.nodeId !== region.nodeId) { namedGap(fact, 'Measured source content container needs an explicit same-component layoutNodes target; an empty wrapper cannot be mapped to the outer root'); continue; }
      const rect = fact.kind === 'region' ? packet.layouts[node.layoutId].rect : fact.value.rect;
      const dynamicHeight = chosen.component.kind === 'native-products' || chosen.component.kind === 'composite' && descendants(chosen.component).some(component => component.kind === 'native-products');
      add(fact, chosen, dynamicHeight ? 'adapt' : 'preserve', dynamicHeight ? 'Preserve source width and horizontal insets; height follows verified target catalog records and is an explicit dynamic-data adaptation.' : 'Preserve observed outer component bounds, horizontal inset and height; vertical document position follows natural preceding blocks.', { kind: 'layout', selector: rootSelector(chosen.component.key), expected: { x: rect.x, width: rect.width, ...(dynamicHeight ? {} : { height: rect.height }) }, tolerance: 20 }); continue;
    }
    const dynamic = owner?.component.kind === 'native-products' ? owner : candidatesFor(fact).find(entry => entry.component.kind === 'native-products' && (bindingFor(entry.component.key, fact.snapshotId).sourceNodeIds ?? []).some(id => inside(fact.snapshotId, fact.nodeId, id)));
    if (dynamic) {
      add(fact, dynamic, 'adapt', 'Source product fields and controls belong to the actual repeated catalog query. Replace names, images, prices, ratings, availability and product links with the frozen target WooCommerce records; independent runtime catalog identity, ordering and field checks are mandatory.', fact.kind === 'interaction' && fact.value.kind === 'carousel' ? { kind: 'interaction', selector: widgetSelector(dynamic.component), property: 'carousel', expected: { manual: true } } : { kind: 'presence', selector: widgetSelector(dynamic.component), expected: true }); continue;
    }
    const chrome = ancestry(fact.snapshotId, fact.nodeId).some(ancestor => /(?:slick-(?:counter|nav|dots|arrow)|header-controls-wrapper|pagination-wrapper|old-product-tile-arrows|^controls$)/.test(ancestor.attributes.class ?? ''));
    const chromeOwner = chrome ? sourceCarouselFor(fact) : undefined;
    if (chromeOwner && ['text', 'media', 'interaction'].includes(fact.kind)) {
      add(fact, chromeOwner, 'adapt', 'Source counter, dot/arrow artwork and shared controls are replaced by the registered manual carousel presentation. Verify actual switching, synchronized pagination and return to the original logical slide instead of static source counter digits or icon snapshots.', { kind: 'interaction', selector: widgetSelector(chromeOwner.component), property: 'carousel', expected: { manual: true } }); continue;
    }
    if (fact.kind === 'text') {
      const direct = matchedSlots(fact, ['text', 'native']);
      const match = direct.find(match => norm(actualSlot(match)) === norm(fact.value.text) || norm(actualSlot(match)) === norm(sourceCopyAt(fact, match.nodeIds)));
      if (match && textRequirement(fact, match)) continue;
      const sameCopy = fact.snapshotId !== snapshot.id ? [] : candidatesFor(fact).flatMap(entry => [...Object.entries(entry.component.slots?.text ?? {}).filter(([, text]) => norm(text) === norm(fact.value.text)).map(([slot]) => ({ ...entry, kind: 'text', slot, nodeIds: [fact.nodeId] })), ...Object.entries(bindingFor(entry.component.key, fact.snapshotId).slotNodes?.native ?? {}).filter(([setting]) => norm(entry.component.widgetSettings?.[setting]) === norm(fact.value.text)).map(([slot]) => ({ ...entry, kind: 'native', slot, nodeIds: [fact.nodeId] }))]);
      if (sameCopy.length === 1 && (node.visible === false || ancestry(fact.snapshotId, fact.nodeId).some(ancestor => /slick-cloned|swiper-slide-duplicate/.test(ancestor.attributes.class ?? '')))) { textRequirement(fact, sameCopy[0], 'Responsive-inactive or cloned source copy maps to the same evidenced semantic item and its unique authored text slot; duplicate DOM implementation is not duplicated in the target.'); continue; }
      const external = externalMatch(fact);
      if (node.visible === false && external) { add(fact, external.match, 'external', 'Source session/mobile-only panel copy remains part of the actual source destination; this draft preserves the verified external entrance and does not claim to recreate that hidden panel.', { kind: 'external', selector: slotSelector(external.match.component, 'links', external.match.slot), expected: external.href }); continue; }
      namedGap(fact, 'Source copy has no exact owned text/native slot, canonical duplicate or explicit external/adaptation mapping', { text: fact.value.text, possibleSlots: direct.map(match => ({ componentKey: match.component.key, slot: match.slot, value: actualSlot(match) })) }); continue;
    }
    if (fact.kind === 'media') {
      const sourceURL = fact.value.resource?.url;
      const direct = matchedSlots(fact, ['media']);
      if (fact.snapshotId !== snapshot.id) {
        const slotAssets = match => { const slot = actualSlot(match), keys = [slot?.assetKey, ...(slot?.responsive ?? []).map(item => item.assetKey)]; return manifest.assets.filter(asset => keys.includes(asset.key)); };
        const matches = direct.filter(match => slotAssets(match).some(asset => [asset.sourceUrl, asset.observedResourceUrl].includes(sourceURL)));
        if (matches.length) {
          const match = matches[0], canonical = canonicalNode(fact), ownerUsages = Object.values(node.packet.usages).filter(usage => usage.nodeId === canonical);
          // The collector's actual src usage records currentSrc. Srcset/media
          // declarations are candidates only; CSS conditions never choose here.
          const selected = ownerUsages.find(usage => ['img', 'picture'].includes(usage.kind) && usage.attribute === 'src') ?? ownerUsages.find(usage => ['img', 'picture'].includes(usage.kind) && usage.attribute === 'currentSrc');
          const imageFact = ['img', 'picture'].includes(fact.value.kind), actualURL = imageFact ? node.packet.resources[selected?.resourceId]?.url : sourceURL;
          const asset = typeof actualURL === 'string' && actualURL ? slotAssets(match).find(asset => [asset.sourceUrl, asset.observedResourceUrl].includes(actualURL)) : undefined;
          if (!asset) { namedGap(fact, 'Responsive media needs its actual same-owner src/currentSrc usage and a corresponding typed slot candidate; inactive picture declarations cannot choose the rendered asset', { sourceURL, actualURL }); continue; }
          const preserved = sourceURL === actualURL && canonical === fact.nodeId && node.visible;
          add(fact, match, preserved ? 'preserve' : 'adapt', preserved ? 'Preserve this snapshot’s independently observed same-owner currentSrc or painted background through its actual typed responsive asset slot.' : 'Map the same owner’s inactive picture candidate or canonical duplicate to its actually observed currentSrc resource in this snapshot; do not guess from CSS media conditions or require inactive candidates to paint.', { kind: 'media', selector: slotSelector(match.component, 'media', match.slot), expected: { assetKey: asset.key, allowDeferred: true } }); continue;
        }
      }
      const matchesResource = match => manifest.assets.some(asset => asset.key === actualSlot(match)?.assetKey && [asset.sourceUrl, asset.observedResourceUrl].includes(sourceURL));
      let match = fact.snapshotId === snapshot.id ? direct.find(matchesResource) : undefined;
      let inactivePicture = false;
      if (!match && fact.snapshotId === snapshot.id && fact.value.kind === 'picture') {
        match = direct.find(candidate => manifest.assets.some(asset => asset.key === actualSlot(candidate)?.assetKey && Object.values(node.packet.usages).some(usage => usage.nodeId === canonicalNode(fact) && [asset.sourceUrl, asset.observedResourceUrl].includes(node.packet.resources[usage.resourceId]?.url))));
        inactivePicture = !!match;
      }
      if (!match && fact.snapshotId === snapshot.id) { const equal = candidatesFor(fact).flatMap(entry => Object.entries(entry.component.slots?.media ?? {}).map(([slot]) => ({ ...entry, kind: 'media', slot }))).filter(matchesResource); if (equal.length === 1) match = equal[0]; }
      if (match) { const preserved = direct.includes(match) && !inactivePicture && canonicalNode(fact) === fact.nodeId && node.visible; add(fact, match, preserved ? 'preserve' : 'adapt', preserved ? 'Preserve this independently owned source image/background use through its actual current-job asset slot.' : inactivePicture ? 'This source picture candidate is not the selected desktop resource; use the same image owner’s actually selected currentSrc in its typed media slot. Responsive candidates remain recorded for the responsive stage.' : 'Canonical duplicated or responsive-inactive use of the same actual resource maps to its unique same-region static slot; asset bytes and target paint remain verified.', { kind: 'media', selector: slotSelector(match.component, 'media', match.slot), expected: { assetKey: actualSlot(match).assetKey, allowDeferred: true } }); continue; }
      const glyph = matchedSlots(fact, ['text']).find(match => /^[\p{S}\p{P}\s]+$/u.test(String(actualSlot(match))) && String(actualSlot(match)).length < 10);
      if (glyph) { add(fact, glyph, 'adapt', 'Replace the minor source icon artwork with the explicitly authored local Unicode glyph; verify its real typed text slot rather than pretending to preserve source media.', { kind: 'text', selector: slotSelector(glyph.component, 'text', glyph.slot), expected: { text: actualSlot(glyph) } }); continue; }
      const external = externalMatch(fact);
      if (!node.visible && external) { add(fact, external.match, 'external', 'Hidden source panel media is rendered by the actual source service; preserve its verified external entrance without claiming local media equality.', { kind: 'external', selector: slotSelector(external.match.component, 'links', external.match.slot), expected: external.href }); continue; }
      namedGap(fact, 'Source media usage has no owned current-job asset slot or explicit glyph/external adaptation', { sourceURL }); continue;
    }
    if (fact.kind === 'interaction') {
      if (fact.value.kind === 'link') {
        const external = externalMatch(fact);
        if (external) { add(fact, external.match, 'external', 'Preserve the actual observed absolute href as the corresponding typed external entry; source business services are not claimed to be recreated.', { kind: 'external', selector: slotSelector(external.match.component, 'links', external.match.slot), expected: external.href }); continue; }
      }
      const carousel = candidatesFor(fact).find(entry => entry.component.kind === 'native-carousel' && (bindingFor(entry.component.key, fact.snapshotId).sourceNodeIds ?? []).some(id => related(fact.snapshotId, fact.nodeId, id)));
      const interactionOwner = carousel ?? (owner?.component.kind === 'native-carousel' ? owner : undefined);
      if (interactionOwner && (fact.value.kind === 'carousel' || (node.packet.interactions && Object.values(node.packet.interactions).some(interaction => interaction.kind === 'carousel' && (interaction.controlNodeIds ?? []).includes(fact.nodeId))))) {
        add(fact, interactionOwner, 'adapt', 'Use a manual registered native carousel with real synchronized next/previous and pagination controls. Source engine clones, autoplay and control glyph details are explicitly adapted; actual browser switching and restoration are mandatory.', { kind: 'interaction', selector: widgetSelector(interactionOwner.component), property: 'carousel', expected: { manual: true } }); continue;
      }
      namedGap(fact, 'Source interaction needs an actual external href, same-owner native carousel or explicit supported adaptation', { sourceInteraction: fact.value });
    }
  }

  // Share the actual test only when component, disposition, rule and complete
  // verification are identical. Every independently captured fact remains bound.
  const groupedRequirements = new Map();
  for (const requirement of requirements) {
    const key = JSON.stringify({ componentId: requirement.componentId, disposition: requirement.disposition, rule: requirement.rule, verification: requirement.verification });
    const existing = groupedRequirements.get(key);
    if (existing) existing.factIds.push(...requirement.factIds);
    else groupedRequirements.set(key, { ...requirement, factIds: [...requirement.factIds] });
  }
  const finalRequirements = [...groupedRequirements.values()];
  const componentPlan = { version: 2, kind: 'component-plan', sourceFacts: { path: sourceFactsFile, sha256: sourceHash }, desktopSnapshotId: snapshot.id, components: entries.map(entry => {
    const component = entry.component, binding = bindings.get(component.key);
    if (!binding) { gaps.push({ code: 'component-binding-missing', componentKey: component.key }); return null; }
    const itemSlots = [];
    if (component.kind === 'native-carousel') for (const child of component.slides) { const nodes = bindings.get(child.key)?.sourceNodeIds ?? []; if (nodes.length) itemSlots.push({ id: child.key, nodeIds: [...new Set(nodes)] }); }
    else if (component.kind === 'native-products') {
      const packet = packets.find(packet => packet.snapshot.id === snapshot.id && packet.regions.some(region => binding.regionIds.includes(region.id)));
      const sourceCarousel = Object.values(packet?.interactions ?? {}).filter(interaction => interaction.kind === 'carousel' && interaction.itemNodeIds?.length).find(interaction => (binding.sourceNodeIds ?? []).some(nodeId => related(packet.snapshot.id, interaction.nodeId, nodeId)));
      if (sourceCarousel) for (const [index, nodeId] of sourceCarousel.itemNodeIds.entries()) itemSlots.push({ id: `catalog-item-${index + 1}`, nodeIds: [nodeId] });
    }
    else if (component.kind === 'html-static') {
      if ((binding.sourceNodeIds ?? []).length > 1) {
        for (const [index, nodeId] of binding.sourceNodeIds.entries()) itemSlots.push({ id: `source-card-${index + 1}`, nodeIds: [nodeId] });
      } else {
      const mediaNodes = Object.values(binding.slotNodes?.media ?? {}).flat(), groups = new Map();
      for (const nodeId of mediaNodes) { const anchor = ancestry(snapshot.id, nodeId).find(node => node.tag === 'a' && node.attributes.href); if (anchor?.parentId) { if (!groups.has(anchor.parentId)) groups.set(anchor.parentId, new Set()); groups.get(anchor.parentId).add(anchor.id); } }
      for (const [parent, nodes] of groups) if (nodes.size > 1) for (const nodeId of nodes) itemSlots.push({ id: `item-${sha(`${parent}:${nodeId}`).slice(0, 10)}`, nodeIds: [nodeId] });
      }
    }
    const variants = [{ snapshotId: snapshot.id, nodeIds: binding.sourceNodeIds.filter(nodeId => snapshot.nodes[nodeId]), visible: binding.sourceNodeIds.some(nodeId => nodeAt(snapshot.id, nodeId)?.visible) }];
    for (const later of source.snapshots.filter(item => mappedSnapshots.has(item.id))) {
      const variant = bindingFor(component.key, later.id);
      if (!variant) { gaps.push({ code: 'responsive-component-binding-missing', snapshotId: later.id, componentKey: component.key, reason: 'Every stable desktop component needs an explicit later snapshot identity; a matching number or omitted fact cannot establish its variant' }); continue; }
      variants.push({ snapshotId: later.id, nodeIds: variant.sourceNodeIds, visible: variant.sourceNodeIds.some(nodeId => nodeAt(later.id, nodeId)?.visible) });
    }
    return { id: component.key, parentId: entry.parentId, role: binding.role ?? binding.regionIds.join('+'), renderer: renderer(component), editability: editability(component), sourceRegionIds: binding.regionIds, sourceNodeIds: binding.sourceNodeIds, variants, ...(itemSlots.length ? { itemSlots } : {}), ...(entry.parentId === null && ['site-header', 'promo', 'hero', 'categories','bogo'].includes(component.key) ? { firstFold: true } : {}) };
  }).filter(Boolean), requirements: finalRequirements };
  for(const ref of source.sceneInventories??[]){
    const inventory=JSON.parse(await fs.readFile(ref.path,'utf8'));
    const vendorEntries=Object.values(inventory.entries).filter(item=>item.utility);
    if(vendorEntries.length){
      const target=finalRequirements.find(item=>item.componentId==='header'&&item.verification.kind==='external'&&item.verification.expected===source.sourceUrl&&item.verification.snapshotId===ref.snapshotId);
      if(!target){if(ref.snapshotId===snapshot.id)throw Error('Current source homepage entrance is required for the external vendor-utility adaptation');gaps.push({code:'responsive-vendor-entry-unmapped',snapshotId:ref.snapshotId,reason:'This snapshot needs its own explicitly mapped actual source homepage entrance for vendor utility adaptation'});continue;}
      target.disposition='adapt';target.rule='Keep the real source-homepage entrance for its Feedback and Salesforce chat vendor services. These third-party controls remain on the source page and are explicitly omitted from the draft; no local chat or feedback service is claimed.';
      componentPlan.inventoryResolutions??=[];componentPlan.inventoryResolutions.push({snapshotId:ref.snapshotId,entryIds:vendorEntries.map(item=>item.id),componentId:'header',rule:target.rule,requirementId:target.id});
    }
  }
  const report = { version: 2, taskId: authored.taskId, sourceFactsHash: sourceHash, facts: facts.length, bound: requirements.length, requirements: finalRequirements.length, gaps, dispositions: requirements.reduce((counts, requirement) => ({ ...counts, [requirement.disposition]: (counts[requirement.disposition] ?? 0) + 1 }), {}), decisions };
  await write(jobDir, 'plan-gaps.json', report);
  if (gaps.length) throw Error(`${gaps.length} named source planning gaps remain; see ${path.join(jobDir, 'plan-gaps.json')}`);
  const planBytes = JSON.stringify(componentPlan, null, 2) + '\n'; await fs.writeFile(path.join(jobDir, 'component-plan.json'), planBytes);
  const program = { version: 2, workflow: 'block-replication', taskId: authored.taskId, title: 'Pet Supermarket — replica v2 technical draft', sourceUrl: source.sourceUrl, sourceFacts: { path: sourceFactsFile, sha256: sourceHash }, componentPlan: { path: 'component-plan.json', sha256: sha(planBytes) }, assetsManifest: { path: assetsManifestFile, sha256: sha(manifestBytes) }, viewports: source.snapshots.map(view => ({ name: view.viewport.name, width: view.viewport.width, height: view.viewport.height, stage: view.viewport.name === 'desktop' ? 'desktop' : 'responsive' })), blocks: authored.blocks };
  await write(jobDir, 'program.json', program); return { jobDir, blocks: program.blocks.length, components: componentPlan.components.length, facts: facts.length, requirements: finalRequirements.length, gaps: 0 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(await authorPetPlanV2(process.argv[2] ?? defaultJob, process.argv[3] ?? 'authored-desktop.json')));
