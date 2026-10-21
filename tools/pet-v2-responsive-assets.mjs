import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { fetchPinnedBrowserResource } from '../src/capture/pinned-fetch.ts';
import { assertSafeSVGBytesV2 } from '../src/replica-v2/runtime.ts';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inflight = new WeakMap();
async function immutable(filename, bytes) { try { await fs.writeFile(filename, bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST' || !(await fs.readFile(filename)).equals(bytes)) throw error; } }
async function verify(jobDir, asset) {
  const filename = path.resolve(jobDir, asset.localPath), relative = path.relative(jobDir, filename); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Responsive asset escaped its current task');
  const actual = await fs.realpath(filename); if (actual.toLowerCase() !== filename.toLowerCase()) throw Error('Responsive asset must not follow a symbolic link');
  if (sha(await fs.readFile(actual)) !== asset.sha256) throw Error('Previously downloaded responsive asset bytes changed');
  return asset;
}

/** Resolve only a caller-selected, actually observed static resource. This does
 * not crawl resources, import media, write a manifest or create product facts.
 * The caller owns the mutable assets array and writes a new manifest revision. */
export async function resolvePetResponsiveAssetV2({ jobDir, resource, assets, alt = '' }) {
  const actualJob = await fs.realpath(jobDir), relative = path.relative(await fs.realpath('D:/cloneWP/references'), actualJob);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !resource || typeof resource.url !== 'string' || !resource.url || !Array.isArray(assets)) throw Error('Responsive asset resolver needs one actual observed resource in the current task');
  let cache = inflight.get(assets); if (!cache) { cache = new Map(); inflight.set(assets, cache); }
  if (cache.has(resource.url)) return cache.get(resource.url);
  const promise = (async () => {
    const old = assets.find(asset => asset.observedResourceUrl === resource.url || asset.sourceUrl === resource.url); if (old) return verify(actualJob, old);
    let bytes, sourceUrl = resource.url;
    if (typeof resource.inline === 'string') { bytes = Buffer.from(resource.inline); sourceUrl = 'data:image/svg+xml;base64,' + bytes.toString('base64'); }
    else {
      let url = resource.url;
      for (let redirects = 0; redirects <= 3; redirects++) {
        const response = await fetchPinnedBrowserResource({ url, method: 'GET', headers: { accept: 'image/*' }, body: null, maxBytes: 20 * 1024 * 1024, timeoutMs: 30000 });
        if (response.status >= 300 && response.status < 400 && response.headers.location) { if (redirects === 3) throw Error('Selected source image exceeded its public redirect bound'); url = new URL(response.headers.location, url).href; continue; }
        if (response.status < 200 || response.status >= 300) throw Error(`Selected responsive source image returned HTTP ${response.status}`);
        bytes = response.body; break;
      }
    }
    if (!bytes?.length || bytes.length > 20 * 1024 * 1024) throw Error('Selected responsive source image is empty or exceeds 20 MiB');
    assertSafeSVGBytesV2(bytes);
    let metadata = await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata(), original = {};
    await fs.mkdir(path.join(actualJob, 'assets'), { recursive: true });
    if (metadata.format === 'svg') { const originalSha256 = sha(bytes), originalSourcePath = `assets/${originalSha256}.svg`; await immutable(path.join(actualJob, originalSourcePath), bytes); original = { originalSha256, originalSourcePath, conversion: 'Original safe source SVG rasterized for WordPress' }; bytes = await sharp(bytes).png().toBuffer(); metadata = await sharp(bytes).metadata(); }
    const mediaType = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', ...(metadata.format === 'heif' && metadata.compression === 'av1' ? { heif: 'image/avif' } : {}) }[metadata.format];
    if (!mediaType || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw Error('Selected responsive resource is not supported static image media');
    const hash = sha(bytes), sameBytes = assets.find(asset => asset.sha256 === hash && asset.mediaType === mediaType), extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }[mediaType], localPath = sameBytes?.localPath ?? `assets/${hash}.${extension}`;
    if (sameBytes) await verify(actualJob, sameBytes); else await immutable(path.join(actualJob, localPath), bytes);
    const asset = { key: `asset-${sha(resource.url).slice(0, 16)}`, localPath, sourceUrl, sha256: hash, mediaType, alt, observedResourceUrl: resource.url, width: metadata.width, height: metadata.height, ...original };
    if (assets.some(item => item.key === asset.key)) throw Error('Selected responsive resource collides with an existing task asset key'); assets.push(asset); return asset;
  })();
  cache.set(resource.url, promise); return promise;
}
