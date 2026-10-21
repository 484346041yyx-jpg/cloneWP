import { readFile, statfs, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadConfig, redactor } from '../src/core/config.js';
import { acquireLock, writeJson } from '../src/core/files.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { NovamiraTransport } from '../src/wordpress/mcp.js';
import { NATIVE44_ALL_TYPES } from '../src/native44/catalog.js';
import { readNative44CurrentState } from '../src/native44/current-state.js';
import { documentHashV2 } from '../src/replica-v2/journal.js';
import { fingerprintNative44Snapshot } from '../src/native44/compare.js';
const root = 'D:/cloneWP', out = root + '/runs/2026-10-17-pet-unified-final-review';
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8')), sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const target = await json(out + '/repair-target.json'), { dir, run, runId, pageId } = target;
if (run !== root + '/runs/2026-10-17-pet-unified-draft' || dir !== run + '/amendments/20261017-visual-corrections' || runId !== '2026-10-17-pet-unified-draft' || pageId !== 15734) throw Error('Unexpected repair copy owner');
const sort = (value: any): any => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)])) : value;
const canonical = (value: any) => JSON.stringify(sort(value)), php = (value: any) => `json_decode(base64_decode('${Buffer.from(JSON.stringify(value)).toString('base64')}'),true)`;
const pointerFile = run + '/current-user-amendment.json', pointerBytes = await readFile(pointerFile), previous = JSON.parse(pointerBytes.toString('utf8'));
const current = await readNative44CurrentState(root, run);
if (!current || current.pageId !== pageId || current.runId !== runId) throw Error('Verified current draft identity is missing');
if (previous.amendments.some((step: any) => path.resolve(step.intent.path) === path.resolve(dir, 'intent.json'))) {
  console.log(JSON.stringify({ status: 'already-recorded-locally', pageId, runId, documentHash: current.documentHash, remoteReads: 0, remoteWrites: 0 })); process.exit(0);
}
const intent = await json(dir + '/intent.json'), before = await json(dir + '/before.json'), expected = await json(dir + '/expected.json');
if (previous.documentHash !== before.hash || previous.pageId !== pageId || previous.runId !== runId || current.documentHash !== before.hash || previous.currentSnapshot.sha256 !== sha(await readFile(current.currentSnapshot.path))) throw Error('Current amendment chain changed before visual correction');
const css = await readFile(dir + '/page-custom.css'), request = await json(dir + '/request.json'), preparedManifest = await json(out + '/prepared-manifest.json');
if ([before, expected].some(snapshot => snapshot.pageId !== pageId || snapshot.runId !== runId || snapshot.status !== 'draft' || !Array.isArray(snapshot.elements) || documentHashV2(snapshot.elements, snapshot.settings) !== snapshot.hash) || intent.version !== 1 || intent.kind !== 'explicit-user-owned-draft-amendment' || intent.pageId !== pageId || intent.runId !== runId || intent.beforeHash !== before.hash || intent.expectedHash !== expected.hash || intent.requestSha256 !== sha(await readFile(dir + '/request.json')) || request.pageId !== pageId || request.runId !== runId || intent.payloadSha256 !== expected.hash || intent.payloadSha256 !== sha(canonical({ elements: expected.elements, settings: expected.settings })) || intent.cssSha256 !== sha(css) || expected.settings.custom_css !== css.toString('utf8') || before.settings.post_status !== 'draft' || expected.settings.post_status !== 'draft' || expected.settings.post_title !== before.settings.post_title || expected.title !== before.title) throw Error('Repair intent, owner, whole snapshot, request or CSS do not match');
const expectedFingerprint = fingerprintNative44Snapshot(expected);
if (preparedManifest.pageId !== pageId || preparedManifest.runId !== runId || preparedManifest.taskId !== previous.taskId || Object.entries(expectedFingerprint).some(([key, value]) => preparedManifest[key] !== value)) throw Error('Prepared current comparison manifest differs from expected draft');
const guarded = new Map<string, string>();
for (const file of [out + '/repair-target.json', pointerFile, dir + '/intent.json', dir + '/before.json', dir + '/expected.json', dir + '/request.json', dir + '/page-custom.css', out + '/prepared-manifest.json', run + '/compare-manifest.json', run + '/journal.json']) { if (await realpath(file) !== path.resolve(file)) throw Error('Task evidence alias is not allowed'); guarded.set(file, sha(await readFile(file))); }
guarded.set(pointerFile, sha(pointerBytes));
const assertLocalCAS = async () => { for (const [file, expectedHash] of guarded) if (sha(await readFile(file)) !== expectedHash) throw Error('Local repair input or current pointer changed; preserve concurrent state: ' + path.basename(file)); };
const free = await statfs(root); if (Number(free.bavail) * Number(free.bsize) < 512 * 1024 * 1024) throw Error('Insufficient evidence space');
const loaded = await loadConfig(root), origin = new URL(loaded.config.targetUrl).origin, authorization = 'Basic ' + Buffer.from(loaded.credentials.wp_user + ':' + loaded.credentials.wp_app_password).toString('base64');
const fetcher: typeof fetch = async (input, init = {}) => { if (new URL(input instanceof Request ? input.url : input.toString()).origin !== origin) throw Error('Different origin rejected'); const headers = new Headers(init.headers); headers.set('Authorization', authorization); const response = await fetch(input, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(45000) }); if (response.status >= 300 && response.status < 400) throw Error('Redirect rejected'); return response; };
const transport = new NovamiraTransport(new URL('/wp-json/mcp/novamira', origin), fetcher), client = new WordPressClient({ targetUrl: origin, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, executionStrategy: 'native44-css-handoff', allowedWidgetTypes: NATIVE44_ALL_TYPES }), unlock = await acquireLock(root);
let attempted = false;
try {
  await assertLocalCAS();
  const status = await client.probeOwnedReviewStatus(pageId, runId); if (status.status !== 'draft' || !status.ownerMatches || !status.canEdit || !status.uniqueRunPage || !status.documentExists || !status.builtWithElementor) throw Error('Repair copy is not an editable unique owned draft: ' + (status.status ?? 'missing'));
  const types = (await json(run + '/compare-manifest.json')).widgetTypes;
  const { snapshot } = await client.readOwnedReviewCheckpoint(pageId, runId, types);
  if (snapshot.hash !== expected.hash) {
    if (snapshot.hash !== before.hash || !['prepared', 'retryable'].includes(intent.status)) throw Error('Copy state changed or outcome unknown; reconcile instead of writing');
    const code = `$id=${pageId};$run=${php(runId)};if(get_post_type($id)!=='page'||get_post_status($id)!=='draft'||get_post_meta($id,'_clonewp_run_id',true)!==$run||!current_user_can('edit_post',$id)){throw new RuntimeException('owned_draft_guard');}require_once ABSPATH.'wp-admin/includes/post.php';if(wp_check_post_lock($id)){throw new RuntimeException('another_user_editing');}$pages=get_posts(['post_type'=>'page','post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);if(count($pages)!==1||(int)$pages[0]!==$id){throw new RuntimeException('ambiguous_copy_run');}$doc=\\Elementor\\Plugin::$instance->documents->get($id);if(!$doc||!$doc->is_built_with_elementor()){throw new RuntimeException('document_missing');}$normalize=function($v)use(&$normalize){if(!is_array($v)){return $v;}$keys=array_keys($v);if($keys!==range(0,count($v)-1)){ksort($v,SORT_STRING);}foreach($v as $k=>$x){$v[$k]=$normalize($x);}return $v;};$before=${php({ elements: before.elements, settings: before.settings })};$actual=['elements'=>$doc->get_elements_data(),'settings'=>$doc->get_settings()];if(json_encode($normalize($actual))!==json_encode($normalize($before))){throw new RuntimeException('concurrent_document_change');}$input=${php({ elements: expected.elements, settings: expected.settings })};if(!$doc->save($input)){throw new RuntimeException('native_save_failed');}return ['saved'=>true,'pageId'=>$id,'status'=>get_post_status($id)];`;
    await assertLocalCAS(); await writeJson(dir + '/intent.json', { ...intent, status: 'intent', attemptedAt: new Date().toISOString() }); guarded.set(dir + '/intent.json', sha(await readFile(dir + '/intent.json'))); await assertLocalCAS(); attempted = true;
    const response: any = await transport.execute('novamira/execute-php', { code }); if (response.success !== true || response.return_value?.saved !== true || response.return_value.status !== 'draft') throw Error('Native save outcome unconfirmed');
  }
  const after = await client.snapshotDraft(pageId); await writeJson(dir + '/after.json', after); if (after.hash !== expected.hash) throw Error('Actual complete draft differs from exact expected copy');
  const counts = { containers: 0, widgets: 0, html: 0, productWidgets: 0 }; const walk = (nodes: any[]) => nodes.forEach(node => { if (node.elType === 'container') counts.containers++; else counts.widgets++; if (node.widgetType === 'html') counts.html++; if (node.widgetType === 'wd_products') counts.productWidgets++; walk(node.elements ?? []); }); walk(after.elements);
  await assertLocalCAS();
  try { const oldReceipt = await readFile(dir + '/receipt.json'); await writeJson(dir + '/receipt-history-' + randomUUID() + '.json', JSON.parse(oldReceipt.toString('utf8'))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await writeJson(dir + '/receipt.json', { version: 1, status: 'confirmed', pageId, runId, beforeHash: before.hash, afterHash: after.hash, cssApplied: true, bodySubtreesReplaced: after.elements.length, productWidgets: counts.productWidgets, observedAt: new Date().toISOString() });
  const reference = async (file: string) => ({ path: file, sha256: sha(await readFile(file)) });
  await assertLocalCAS(); await writeJson(run + '/compare-manifest.json', preparedManifest); guarded.set(run + '/compare-manifest.json', sha(await readFile(run + '/compare-manifest.json'))); await assertLocalCAS();
  await writeJson(pointerFile, { version: 1, kind: 'completed-explicit-user-draft-amendment', pageId, runId, taskId: previous.taskId, status: 'applied-pending-review', unpublished: true, documentHash: after.hash, cssApplied: true, requestedScope: 'Explicitly authorized unpublished copy of the actual published source; product content may differ, native layouts/styles/interactions required; CSS consolidated and applied; project rules and task state unified; two-desktop review required.', counts, amendments: [...previous.amendments, { intent: await reference(dir + '/intent.json'), receipt: await reference(dir + '/receipt.json'), beforeHash: before.hash, afterHash: after.hash }], currentSnapshot: await reference(dir + '/after.json'), currentCSS: await reference(dir + '/page-custom.css') });
  console.log(JSON.stringify({ status: 'applied-pending-review', pageId, hash: after.hash, counts, originalPublishedPagePreserved: true }));
} catch (error) {
  if (attempted) { const evidenceFile = dir + '/reconciliation-' + randomUUID() + '.json'; try { const actual = await client.snapshotDraft(pageId); await writeJson(evidenceFile, { version: 1, status: actual.hash === expected.hash ? 'confirmed' : actual.hash === before.hash ? 'retryable' : 'conflict', pageId, runId, beforeHash: before.hash, expectedHash: expected.hash, snapshot: actual, observedAt: new Date().toISOString() }); } catch { await writeJson(evidenceFile, { version: 1, status: 'write-unknown', pageId, runId, observedAt: new Date().toISOString() }); } }
  console.error(redactor(loaded.credentials)(error)); process.exitCode = 1;
} finally { await transport.close(); await client.close(); await unlock(); }
