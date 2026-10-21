/** Local media transfer for this Pet job only; no network, target credentials or WordPress writes. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { assertSafeSVGBytesV2, validateAssetBytesV2 } from '../src/replica-v2/runtime.js';
import { ensureDiskSpaceV2 } from '../src/replica-v2/journal.js';
import type { Native44Asset } from '../src/native44/media.js';

const ROOT = 'D:/cloneWP';
const JOB = 'D:/cloneWP/references/reference-v2-2026-10-16T02-41-14-135Z-www-petsupermarket-com-5ee9a70d';
const BUNDLE = 'C:/Users/Administrator/AppData/Local/Temp/browser-use/assets/395efb73-1458-4d21-931d-5cc0104de5bf/manifest.json';
interface BundleAsset { kind: string; url: string; path: string; contentType: string; name?: string }
interface RequiredAsset { key: string; sourceUrl: string; resourceIds: string[]; roles: string[] }
interface LocalAsset extends Native44Asset { width: number; height: number; observedResourceUrl: string; originalSourcePath?: string }
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const petAssetKey = (url: string) => `asset-${hash(url).slice(0,16)}`;
function within(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error(`Local asset path escaped its owned directory: ${target}`);
}
export async function importPetNative44Assets(): Promise<{ assets: LocalAsset[]; failures: Array<{ key: string; sourceUrl: string; reason: string }> }> {
  const started = performance.now(); await ensureDiskSpaceV2(ROOT);
  const sourceRoot = await realpath(path.dirname(BUNDLE));
  const bundleBytes = await readFile(BUNDLE), bundle = JSON.parse(bundleBytes.toString('utf8')) as { assets: BundleAsset[] };
  if (!Array.isArray(bundle.assets)) throw Error('Observed browser bundle has no asset table');
  const requiredBytes = await readFile(path.join(JOB,'required-assets.json'));
  const required = JSON.parse(requiredBytes.toString('utf8')) as RequiredAsset[];
  if (!Array.isArray(required) || new Set(required.map(row=>row.key)).size !== required.length) throw Error('Required asset identities are missing or duplicated');
  const assets: LocalAsset[] = [], failures: Array<{ key: string; sourceUrl: string; reason: string }> = [];
  const files = new Map<string,string>(); const written = new Set<string>();
  const bundleByUrl = new Map<string,BundleAsset[]>();
  for (const item of bundle.assets.filter(item=>item.kind==='image')) bundleByUrl.set(item.url,[...bundleByUrl.get(item.url)??[],item]);
  await mkdir(path.join(JOB,'assets','originals'),{recursive:true});
  const save = async (relative: string, bytes: Buffer) => {
    const full = path.resolve(JOB,relative); within(path.join(JOB,'assets'),full);
    if (written.has(full)) return;
    let existing: Buffer | undefined; try { existing = await readFile(full); } catch (error) { if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
    if (existing && hash(existing)!==hash(bytes)) throw Error(`Content-addressed local asset changed: ${relative}`);
    if (!existing) await writeFile(full,bytes);
    written.add(full);
  };
  for (const item of required) {
    try {
      if (typeof item.sourceUrl!=='string' || item.key!==petAssetKey(item.sourceUrl)) throw Error('Required key is not the full observed source URL hash');
      if (!/^(?:https?:\/\/|data:image\/|inline-svg:)/i.test(item.sourceUrl)) throw Error('Required media URL is not an observed image resource');
      const candidates = bundleByUrl.get(item.sourceUrl);
      if (!candidates?.length) throw Error('Required resource is absent from the current observed browser bundle; no download attempted');
      const originals: Buffer[]=[];
      for (const candidate of candidates) {
        if (/^(?:normalUI|screenshot(?:-|\.|$))/i.test(candidate.name??'')) throw Error('UI screenshots cannot enter the media manifest');
        const source = await realpath(candidate.path); within(sourceRoot,source); originals.push(await readFile(source));
      }
      if (new Set(originals.map(hash)).size!==1) throw Error('One observed resource URL has conflicting captured bytes');
      const original = originals[0]!; if (!original.length || original.length>20*1024*1024) throw Error('Observed media violates the 20 MiB source byte bound');
      const originalSha256 = hash(original);
      const metadata = await sharp(original,{limitInputPixels:80_000_000}).metadata();
      const converted = metadata.format==='svg';
      const declared = candidates[0]!.contentType?.split(';')[0]?.trim().toLowerCase();
      let bytes = original, mediaType: string, originalSourcePath: string|undefined;
      if (converted) {
        assertSafeSVGBytesV2(original);
        if (declared && declared!=='image/svg+xml') throw Error(`Observed SVG bytes disagree with declared MIME ${declared}`);
        originalSourcePath=`assets/originals/${originalSha256}.svg`; await save(originalSourcePath,original);
        bytes=await sharp(original,{density:144,limitInputPixels:80_000_000}).png().toBuffer(); mediaType='image/png';
      } else {
        const actual: Record<string,string>={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif',...(metadata.format==='heif'&&metadata.compression==='av1'?{heif:'image/avif'}:{})};
        mediaType=metadata.format ? actual[metadata.format]! : '';
        if (!mediaType) throw Error(`Unsupported observed static media bytes: ${metadata.format}`);
        if (declared && declared!==mediaType) throw Error(`Observed media bytes disagree with declared MIME ${declared} / ${mediaType}`);
      }
      const validated=await validateAssetBytesV2(bytes,mediaType),sha256=hash(bytes);
      const extensions: Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif'};
      const localPath=files.get(sha256)??`assets/${sha256}.${extensions[mediaType]}`;
      files.set(sha256,localPath); await save(localPath,bytes);
      assets.push({key:item.key,localPath,sourceUrl:item.sourceUrl,observedResourceUrl:item.sourceUrl,sha256,mediaType,width:validated.width,height:validated.height,...converted?{originalSha256,originalSourcePath}: {}});
    } catch (error) { failures.push({key:item.key,sourceUrl:item.sourceUrl,reason:error instanceof Error?error.message:String(error)}); }
  }
  await writeFile(path.join(JOB,'assets-manifest.json'),JSON.stringify({assets},null,2)+'\n');
  await writeFile(path.join(JOB,'assets','import-report.json'),JSON.stringify({kind:'current-task-local-observed-media-import',job:JOB,bundleManifest:BUNDLE,bundleManifestSha256:hash(bundleBytes),requiredManifestSha256:hash(requiredBytes),importedAt:new Date().toISOString(),durationMs:Math.round(performance.now()-started),required:required.length,imported:assets.length,uniqueMediaFiles:files.size,convertedSvg:assets.filter(asset=>asset.originalSha256).length,downloaded:0,remoteWrites:0,failures},null,2)+'\n');
  return {assets,failures};
}
if (process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) importPetNative44Assets().then(result=>{
  console.log(JSON.stringify({imported:result.assets.length,uniqueFiles:new Set(result.assets.map(asset=>asset.localPath)).size,failures:result.failures},null,2)); if(result.failures.length)process.exitCode=1;
}).catch(error=>{console.error(error.message);process.exitCode=1;});
