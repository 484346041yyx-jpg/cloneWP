import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { consolidateNative44CSS } from '../src/native44/consolidate-css.js';
import { readNative44CurrentState } from '../src/native44/current-state.js';
import { fingerprintNative44Snapshot } from '../src/native44/compare.js';
const root = 'D:/cloneWP', run = root + '/runs/2026-10-17T02-00-02-486Z-n44-1f0d432c';
const dir = run + '/amendments/20261017-unified-repair', out = root + '/runs/2026-10-17-pet-unified-repair-15621';
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sort = (value: any): any => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)])) : value;
const current = await readNative44CurrentState(root, run);
if (!current || current.status !== 'delivered' || current.pageId !== 15621) throw Error('Current saved revision is not verified');
const before = await json(current.currentSnapshot.path), manifest = await json(run + '/amendments/20261017-products-and-css/compare-manifest.json');
let browserSupportedDeclarations: string[] = [];
try { const support = await json(out + '/browser-css-support.json'); if (support.sourceDocumentHash !== before.hash || support.cssSha256 !== sha(before.settings.custom_css)) throw Error('Browser support proof belongs to another CSS revision'); browserSupportedDeclarations = support.supported; }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const result = consolidateNative44CSS(before.settings.custom_css, { modules: manifest.modules, elements: before.elements, browserSupportedDeclarations });
const css = `/* cloneWP page 15621. Current complete page CSS; native widget settings remain native.\n * Modules are independent in the verified saved element tree. Cascade barriers are retained. */\n${result.css}`;
const settings = { ...before.settings, custom_css: css }, elements = before.elements;
const payload = JSON.stringify(sort({ elements, settings })), expected = { ...before, settings, hash: sha(payload) };
await mkdir(dir, { recursive: true }); await mkdir(out, { recursive: true });
await writeFile(dir + '/request.json', JSON.stringify({ kind: 'explicit-user-unified-project-repair', pageId: 15621, runId: before.runId, instruction: '那你把这些问题统一修复，商品按刚才说的规则写进项目，CSS 合并整理，任务状态也统一，别每次都要我提醒。修完再做复核。', scope: 'Consolidate only the complete current page CSS; preserve all elements, native settings, product queries, copy and media.' }, null, 2));
await writeFile(dir + '/before.json', JSON.stringify(before, null, 2));
await writeFile(dir + '/expected.json', JSON.stringify(expected, null, 2));
await writeFile(dir + '/page-custom.css', css); await writeFile(out + '/page-custom.css', css);
await writeFile(dir + '/intent.json', JSON.stringify({ version: 1, kind: 'explicit-user-owned-draft-amendment', pageId: 15621, runId: before.runId, beforeHash: before.hash, expectedHash: expected.hash, requestSha256: sha(await readFile(dir + '/request.json')), replacementIds: [], payloadSha256: sha(payload), cssSha256: sha(css), allowedPageSettingKeys: ['custom_css'], status: 'prepared', createdAt: new Date().toISOString() }, null, 2));
await writeFile(out + '/css-consolidation.json', JSON.stringify({ before: result.before, after: { ...result.after, characters: css.length }, independentModuleOwners: manifest.modules.map((module: any) => module.key), sourceDocumentHash: before.hash, expectedDocumentHash: expected.hash, bodyChanged: false }, null, 2));
await writeFile(out + '/compare-manifest.json', JSON.stringify({ ...manifest, ...fingerprintNative44Snapshot(expected) }, null, 2));
console.log(JSON.stringify({ prepared: true, before: result.before, after: result.after, hash: expected.hash, remoteWrites: 0 }));
