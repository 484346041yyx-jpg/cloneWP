import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Cookie } from 'playwright';
import { writeJson } from '../core/files.js';
import { assertAuthorizedEditorChanges, assertDraftHash } from '../core/runner.js';
import { WordPressClient, type DraftSnapshot, type LegacySchema } from '../wordpress/client.js';
import type { TargetCatalogSnapshot } from '../wordpress/types.js';
import { verifyNativeEditor } from '../verification/index.js';
import type { OriginalDesign } from './types.js';
import type { OriginalImportedAsset } from './compile.js';
import { verifyOriginal, verifyOriginalEditorSections } from './verify.js';
import { verifyOriginalNativeEditor } from './native-verification.js';
import type { OriginalNativeComponent } from './components.js';

/** Shared live acceptance for a newly built or explicitly identified owned draft. */
export async function checkOriginalDraft(options: {
  design: OriginalDesign; client: WordPressClient; snapshot: DraftSnapshot;
  schemas: Record<string, LegacySchema>; assets: OriginalImportedAsset[];
  elementMap: Record<string, string>; editUrl: string; previewUrl: string;
  cookies: Cookie[]; runDir: string;
  nativeComponents?: OriginalNativeComponent[]; catalog?: TargetCatalogSnapshot;
  onProgress?: (message: string) => void | Promise<void>;
  onSnapshot?: (snapshot: DraftSnapshot) => void;
}) {
  const { design, client, snapshot, schemas, assets, elementMap, editUrl, previewUrl, cookies, runDir } = options;
  const expectedMedia = Object.fromEntries(assets.map(asset => [asset.key, { attachmentId: asset.attachmentId, url: asset.url, variants: asset.variants }]));
  const nativeComponents = options.nativeComponents ?? [];
  const nativeCapture = { nativeDocumentId: snapshot.pageId, nativeRootIds: snapshot.elements.map(element => element.id), nativeCatalogIds: nativeComponents.filter(component => component.kind === 'products').map(component => component.nativeId), nativeComponents, catalog: options.catalog };
  const viewports = [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 900, height: 1024 }, { name: 'mobile', width: 390, height: 844 }];
  assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash, snapshot.hash);
  await options.onProgress?.('live-frontend-verification');
  const browser = await verifyOriginal({ design, composition: { elements: snapshot.elements, pageSettings: snapshot.settings }, elementMap, previewUrl, runDir, auth: { cookies }, viewports, expectedMedia, ...nativeCapture });
  await writeJson(path.join(runDir, 'verification/browser-initial.json'), browser);
  await options.onProgress?.('all-section-editor-selection');
  const editorSections = await verifyOriginalEditorSections({ design, elementMap, editorUrl: editUrl, runDir, auth: { cookies } });
  await writeJson(path.join(runDir, 'verification/editor-sections.json'), editorSections);
  assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash, snapshot.hash);
  const authored = (function flatten(nodes: typeof design.sections): typeof design.sections { return nodes.flatMap(node => [node, ...flatten(node.children ?? [])]); })(design.sections);
  let replacement: { attachmentId: number; url: string } | undefined;
  if (authored.some(node => node.kind === 'image')) {
    const replacementPath = path.join(runDir, 'assets/editor-check.png');
    const replacementBytes = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#a319cc' } }).png().toBuffer();
    await writeJson(path.join(runDir, 'assets/editor-check-provenance.json'), { purpose: 'Temporary owned native editor image test' });
    await writeFile(replacementPath, replacementBytes);
    replacement = await client.importAsset(replacementPath, { runId: snapshot.runId, pageId: snapshot.pageId, sourceUrl: `data:image/png;base64,${replacementBytes.toString('base64')}`, mimeType: 'image/png', alt: 'Temporary owned native Elementor image verification' });
  }
  await options.onProgress?.('native-editor-save-and-restore');
  const editability = await verifyNativeEditor({
    editorUrl: editUrl, previewUrl, pageId: snapshot.pageId, runDir, cookies, widgetMap: elementMap,
    imageReplacement: replacement, requiredFields: ['title', 'style', ...(replacement ? ['image' as const] : [])],
    restore: async edits => {
      await writeJson(path.join(runDir, 'verification/editor/authorized-edits.json'), edits);
      const modified = await client.snapshotDraft(snapshot.pageId);
      assertAuthorizedEditorChanges(snapshot, modified, edits, schemas);
      const restored = await client.restoreDraft(snapshot.pageId, snapshot, { expectedCurrent: modified });
      options.onSnapshot?.(restored);
      return restored.hash === snapshot.hash;
    },
  });
  await writeJson(path.join(runDir, 'verification/editability.json'), editability);
  assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash, snapshot.hash);
  await options.onProgress?.('native-components-editor-save-and-restore');
  const nativeEditability = await verifyOriginalNativeEditor({ design, components: nativeComponents, client, snapshot, schemas, elementMap, editorUrl: editUrl, previewUrl, cookies, runDir, catalog: options.catalog, onSnapshot: options.onSnapshot });
  await writeJson(path.join(runDir, 'verification/native-component-editability.json'), nativeEditability);
  assertDraftHash((await client.snapshotDraft(snapshot.pageId)).hash, snapshot.hash);
  await options.onProgress?.('final-frontend-verification');
  const finalBrowser = await verifyOriginal({ design, composition: { elements: snapshot.elements, pageSettings: snapshot.settings }, elementMap, previewUrl, runDir: path.join(runDir, 'final'), auth: { cookies }, viewports, expectedMedia, ...nativeCapture });
  const readback = await client.snapshotDraft(snapshot.pageId);
  assertDraftHash(readback.hash, snapshot.hash);
  const passed = browser.passed && finalBrowser.passed && editorSections.passed && editability.status === 'verified' && nativeEditability.passed;
  const verificationPath = path.join(runDir, 'verification/final.json');
  const report = { passed, workflow: 'original-elementor', mode: 'original', browser: finalBrowser, editorSections, editability, nativeEditability, restoredHash: readback.hash, sectionsBuilt: design.sections.length };
  await writeJson(verificationPath, report);
  return { passed, verificationPath, snapshot: readback, report };
}
