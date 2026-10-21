import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

async function helper() { return import(pathToFileURL('D:/cloneWP/tools/explicit-source-node-variants.mjs').href); }
function fixtures() {
  const packet = (prefix: string, viewport: string) => {
    const p: any = { snapshot: { id: prefix + 'snapshot', url: 'https://source.example/', viewport: { name: viewport } }, regions: [{ id: 'header', nodeId: prefix + 'root' }], nodes: {}, resources: { icon: { url: 'inline-svg:' + prefix, inline: '<svg><path d="M0 0L1 1"/></svg>' } }, usages: { icon: { nodeId: prefix + 'icon', kind: 'svg', attribute: 'outerHTML', resourceId: 'icon' } }, texts: {} };
    for (const [key, parent, tag, children, attributes] of [['root', null, 'header', ['left', 'right'], { class: 'site-header' }], ['left', 'root', 'div', [], { class: 'left' }], ['right', 'root', 'div', ['owner'], { class: 'right' }], ['owner', 'right', 'div', ['link'], { class: 'business-entry' }], ['link', 'owner', 'a', ['icon'], { id: 'account', href: 'https://source.example/account/' }], ['icon', 'link', 'svg', [], { class: 'account-icon' }]] as Array<[string, string | null, string, string[], Record<string, string>]>) p.nodes[prefix + key] = { id: prefix + key, regionId: 'header', parentId: parent ? prefix + parent : null, childIds: children.map(id => prefix + id), tag, attributes, visible: true };
    return p;
  };
  const desktop = packet('d-', 'desktop'), variant = packet('t-', 'tablet'); variant.nodes['t-left'].childIds = ['t-owner']; variant.nodes['t-right'].childIds = []; variant.nodes['t-owner'].parentId = 't-left';
  const declaration: any = { version: 1, desktopSnapshotId: desktop.snapshot.id, snapshotId: variant.snapshot.id, regionId: 'header', desktopEvidence: { path: 'desktop-packet.json', sha256: 'a'.repeat(64) }, variantEvidence: { path: 'tablet-packet.json', sha256: 'b'.repeat(64) }, desktopOwnerPath: [1, 0], variantOwnerPath: [0, 0], ownerIdentity: { tag: 'div', attributes: { class: 'business-entry' } }, desktopPath: [0, 0], variantPath: [0, 0], desktopNodeId: 'd-icon', variantNodeId: 't-icon', leafIdentity: { tag: 'svg', attributes: { class: 'account-icon' } } };
  return { desktopPacket: desktop, variantPacket: variant, desktopPacketSha256: 'a'.repeat(64), variantPacketSha256: 'b'.repeat(64), declaration };
}
test('explicit source owner paths prove moved subtrees across entirely different generated IDs and snapshot SVG locators', async () => {
  const { proveExplicitSourceNodeVariantV2, validateExplicitSourceNodeVariants } = await helper(), input = fixtures(), proof = proveExplicitSourceNodeVariantV2(input);
  assert.equal(proof.variantNodeId, 't-icon'); assert.deepEqual(proof.path, [1, 0, 0, 0]); assert.deepEqual(proof.variantPath, [0, 0, 0, 0]); assert.equal(proof.inlineHashes.length, 1); assert.equal(proof.sourceDestinations.href, 'https://source.example/account/'); assert.match(proof.proofSha256, /^[a-f\d]{64}$/); assert.deepEqual(proof.declaration, input.declaration);
  assert.deepEqual(validateExplicitSourceNodeVariants({ ...input, declarations: [input.declaration] }).nodePairs, { 'd-icon': 't-icon' });
});
test('explicit variants reject changed actual owners, wrong endpoint paths, different links/media, ambiguous slots and changed packet identity', async () => {
  const { proveExplicitSourceNodeVariantV2 } = await helper();
  for (const mutate of [(x: any) => { x.variantPacket.nodes['t-owner'].attributes.class = 'other-owner'; }, (x: any) => { x.declaration.variantOwnerPath = [1, 0]; }, (x: any) => { x.variantPacket.nodes['t-link'].attributes.href = 'https://source.example/unrelated/'; }, (x: any) => { x.variantPacket.resources.icon.inline = '<svg><path d="changed"/></svg>'; }, (x: any) => { x.variantPacketSha256 = 'c'.repeat(64); }, (x: any) => { x.variantPacket.snapshot.id = 'different'; }, (x: any) => { const original = x.variantPacket.nodes['t-icon']; x.variantPacket.nodes.duplicate = { ...original, id: 'duplicate' }; x.variantPacket.nodes['t-link'].childIds.push('duplicate'); x.variantPacket.usages.duplicate = { ...x.variantPacket.usages.icon, nodeId: 'duplicate' }; }]) { const changed = fixtures(); mutate(changed); assert.throws(() => proveExplicitSourceNodeVariantV2(changed), /unproven/); }
});
test('search hydration preserves its exact observed action and placeholder difference in the proof, without allowing other ancestor changes', async () => {
  const { proveExplicitSourceNodeVariantV2 } = await helper(), input = fixtures();
  for (const [p, prefix] of [[input.desktopPacket, 'd-'], [input.variantPacket, 't-']] as const) { const link = p.nodes[prefix + 'link']; link.tag = 'form'; link.attributes = { role: 'search' }; link.childIds.push(prefix + 'input'); p.nodes[prefix + 'input'] = { id: prefix + 'input', regionId: 'header', parentId: prefix + 'link', childIds: [], tag: 'input', attributes: { id: 'search-input', type: 'search', role: 'combobox' } }; }
  input.variantPacket.nodes['t-link'].attributes.action = 'https://source.example/search/'; input.variantPacket.nodes['t-input'].attributes.placeholder = 'Search product, brand, services or more';
  assert.throws(() => proveExplicitSourceNodeVariantV2(input), /ancestor identity/);
  input.declaration.hydration = { kind: 'search-external', desktopFormPath: [0], variantFormPath: [0], beforeAction: null, afterAction: 'https://source.example/search/', targetExternalHref: 'https://source.example/search/', rule: 'Use the observed source search destination as an external entry; no local search service.', input: { desktopPath: [0, 1], variantPath: [0, 1], beforePlaceholder: null, afterPlaceholder: 'Search product, brand, services or more' } };
  const proof = proveExplicitSourceNodeVariantV2(input); assert.deepEqual(proof.declaredDifferences.map((item: any) => [item.attribute, item.before, item.after]), [['action', null, 'https://source.example/search/'], ['placeholder', null, 'Search product, brand, services or more']]);
  input.variantPacket.nodes['t-link'].attributes['aria-label'] = 'Changed structural owner'; assert.throws(() => proveExplicitSourceNodeVariantV2(input), /ancestor identity/); delete input.variantPacket.nodes['t-link'].attributes['aria-label']; input.declaration.hydration.targetExternalHref = 'https://other.example/search/'; assert.throws(() => proveExplicitSourceNodeVariantV2(input), /exact observed/);
});
