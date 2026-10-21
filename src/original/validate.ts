import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { z } from 'zod';
import sharp from 'sharp';
import type { OriginalDesign, OriginalNode } from './types.js';

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,100}$/);
const color = z.string().regex(/^(?:#[0-9a-f]{3,8}|transparent|rgba?\([\d\s.,%]+\))$/i);
const number = z.number().finite().nonnegative();
const sides = z.tuple([number, number, number, number]);
const margins = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const justify = z.enum(['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']);
const alignItems = z.enum(['flex-start', 'center', 'flex-end', 'stretch']);
/** Public HTTP(S), target-root paths and authored anchors only; never credentials or active protocols. */
export function isSafeOriginalHref(value: string): boolean {
  if (!value || /[\s\\\u0000-\u001f\u007f<>"']/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) return false;
  if (/^#[A-Za-z][A-Za-z0-9_-]*$/.test(value)) return true;
  if (value.startsWith('/')) return !value.startsWith('//') && !/^\/%2f/i.test(value);
  try { const url = new URL(value); return /^https?:\/\//i.test(value) && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
const columns = z.number().int().min(1).max(12);
const pagination = z.enum(['none', 'dots', 'fraction']);
const productQuery = z.strictObject({ ids: z.array(z.number().int().positive().safe()).min(1).max(200).optional(), limit: z.number().int().min(1).max(200) });
const productDisplay = z.strictObject({
  layout: z.enum(['grid', 'carousel']), columns, tabletColumns: columns.optional(), mobileColumns: columns.optional(),
  showPrice: z.boolean().optional(), showRating: z.boolean().optional(), hoverStyle: z.string().regex(/^[a-z][a-z-]{0,50}$/).optional(),
  arrows: z.boolean().optional(), pagination: pagination.optional(), autoplay: z.boolean().optional(), autoplaySpeed: z.number().int().min(100).max(120000).optional(),
  loop: z.boolean().optional(), scrollPerPage: z.boolean().optional(),
});
const carousel = z.strictObject({
  slidesToShow: columns, tabletSlidesToShow: columns.optional(), mobileSlidesToShow: columns.optional(), slidesToScroll: columns.optional(),
  arrows: z.boolean(), pagination, autoplay: z.boolean(), autoplaySpeed: z.number().int().min(100).max(120000).optional(),
  pauseOnHover: z.boolean().optional(), pauseOnInteraction: z.boolean().optional(), loop: z.boolean(), speed: z.number().int().min(0).max(10000).optional(),
});
const hover = z.strictObject({ background: color.optional(), color: color.optional(), borderColor: color.optional(), borderWidth: number.optional(), radius: number.optional(), opacity: number.max(1).optional() }).refine(value => Object.keys(value).length > 0, 'Hover must declare an editable native change');
const style = z.strictObject({
  direction: z.enum(['row', 'column']).optional(), tabletDirection: z.enum(['row', 'column']).optional(), mobileDirection: z.enum(['row', 'column']).optional(),
  wrap: z.enum(['nowrap', 'wrap']).optional(), tabletWrap: z.enum(['nowrap', 'wrap']).optional(), mobileWrap: z.enum(['nowrap', 'wrap']).optional(),
  width: number.max(100).optional(), tabletWidth: number.max(100).optional(), mobileWidth: number.max(100).optional(), boxed: z.boolean().optional(),
  justify: justify.optional(), tabletJustify: justify.optional(), mobileJustify: justify.optional(),
  alignItems: alignItems.optional(), tabletAlignItems: alignItems.optional(), mobileAlignItems: alignItems.optional(),
  align: z.enum(['left', 'center', 'right']).optional(), tabletAlign: z.enum(['left', 'center', 'right']).optional(), mobileAlign: z.enum(['left', 'center', 'right']).optional(),
  gap: number.optional(), tabletGap: number.optional(), mobileGap: number.optional(), padding: sides.optional(), tabletPadding: sides.optional(), mobilePadding: sides.optional(),
  margin: margins.optional(), tabletMargin: margins.optional(), mobileMargin: margins.optional(),
  background: color.optional(), color: color.optional(), borderColor: color.optional(), borderWidth: number.optional(), radius: number.optional(),
  fontSize: number.positive().optional(), tabletFontSize: number.positive().optional(), mobileFontSize: number.positive().optional(), weight: z.number().int().min(100).max(900).optional(), lineHeight: number.positive().optional(),
  imageHeight: number.positive().optional(), tabletImageHeight: number.positive().optional(), mobileImageHeight: number.positive().optional(),
  minHeight: number.optional(), tabletMinHeight: number.optional(), mobileMinHeight: number.optional(),
});
const node: z.ZodType<OriginalNode> = z.lazy(() => z.strictObject({
  key, kind: z.enum(['container', 'heading', 'text', 'image', 'button', 'accordion', 'products', 'carousel']),
  text: z.string().max(20000).optional(), headingTag: z.enum(['h1', 'h2', 'h3', 'p']).optional(),
  href: z.string().max(4000).refine(isSafeOriginalHref, 'Invalid string: unsafe original link protocol or destination').optional(), anchor: key.optional(),
  asset: key.optional(), alt: z.string().max(1000).optional(),
  items: z.array(z.strictObject({ title: z.string().min(1).max(500), content: z.string().min(1).max(5000) })).max(30).optional(),
  children: z.array(node).max(100).optional(), style: style.optional(),
  productQuery: productQuery.optional(), productDisplay: productDisplay.optional(), carousel: carousel.optional(), hover: hover.optional(),
}));
export const originalDesignSchema: z.ZodType<OriginalDesign> = z.strictObject({
  version: z.literal(1), workflow: z.literal('original-design').optional(), brand: z.string().min(1).max(150), title: z.string().min(1).max(200),
  language: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/), description: z.string().min(1).max(2000),
  tokens: z.strictObject({ colors: z.record(z.string(), color), font: z.string().min(1).max(100), contentWidth: z.number().int().min(320).max(1920) }),
  assets: z.array(z.strictObject({ key, path: z.string().min(1), alt: z.string().min(1).max(1000), provenance: z.string().min(1).max(5000) })).max(30),
  sections: z.array(node).min(1).max(35),
});

export function insideProject(root: string, value: string): string {
  const resolved = path.resolve(root, value), relative = path.relative(root, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('Design and assets must stay inside the project');
  return resolved;
}
export function validateOriginalDesign(input: unknown): OriginalDesign {
  const design = originalDesignSchema.parse(input), keys = new Set<string>(), anchors = new Set<string>();
  const assets = new Set<string>();
  for (const asset of design.assets) { if (assets.has(asset.key)) throw new Error(`Duplicate authored asset: ${asset.key}`); assets.add(asset.key); }
  const nodes: OriginalNode[] = [];
  const visit = (n: OriginalNode, depth: number) => {
    if (depth > 25 || keys.size >= 700) throw new Error('Original design exceeds tree limits');
    if (keys.has(n.key)) throw new Error(`Duplicate authored node: ${n.key}`);
    keys.add(n.key); nodes.push(n);
    if (n.anchor) { if (anchors.has(n.anchor)) throw new Error(`Duplicate anchor: ${n.anchor}`); anchors.add(n.anchor); }
    if (n.kind === 'container' || n.kind === 'carousel') { if (!n.children?.length) throw new Error(`Empty original container: ${n.key}`); }
    else if (n.children?.length) throw new Error(`Native leaf cannot contain children: ${n.key}`);
    if (n.kind === 'carousel') {
      if (!n.carousel || n.children!.some(child => child.kind !== 'container')) throw new Error(`Original carousel needs settings and native container slides: ${n.key}`);
      if (!n.carousel.autoplay && [n.carousel.autoplaySpeed, n.carousel.pauseOnHover, n.carousel.pauseOnInteraction].some(value => value !== undefined)) throw new Error(`Original autoplay controls require autoplay: ${n.key}`);
    } else if (n.carousel) throw new Error(`Carousel settings belong only to carousel nodes: ${n.key}`);
    if (n.kind === 'products') {
      if (!n.productQuery || !n.productDisplay) throw new Error(`Original products require a target query and native display: ${n.key}`);
      if (n.text || n.asset || n.items || n.href) throw new Error(`Original products use actual target fields rather than static product content: ${n.key}`);
      if (n.productQuery.ids && (new Set(n.productQuery.ids).size !== n.productQuery.ids.length || n.productQuery.ids.length !== n.productQuery.limit)) throw new Error(`Explicit product IDs must be unique and match limit: ${n.key}`);
      const display = n.productDisplay;
      if (display.layout === 'grid' && [display.arrows, display.pagination, display.autoplay, display.autoplaySpeed, display.loop, display.scrollPerPage].some(value => value !== undefined)) throw new Error(`Product carousel controls require carousel layout: ${n.key}`);
      if (!display.autoplay && display.autoplaySpeed !== undefined) throw new Error(`Original autoplay speed requires autoplay: ${n.key}`);
    } else if (n.productQuery || n.productDisplay) throw new Error(`Product query/display belong only to products nodes: ${n.key}`);
    if (n.href && !['heading', 'image', 'button'].includes(n.kind)) throw new Error(`Original link is not supported by this node: ${n.key}`);
    if (n.asset && n.kind !== 'image' || n.items && n.kind !== 'accordion') throw new Error(`Original node contains unrelated content fields: ${n.key}`);
    if (['heading', 'text', 'button'].includes(n.kind) && !n.text?.trim()) throw new Error(`Empty original text: ${n.key}`);
    if (n.kind === 'image' && (!n.asset || !assets.has(n.asset))) throw new Error(`Undeclared original image: ${n.key}`);
    if (n.kind === 'button' && !n.href) throw new Error(`Missing original button destination: ${n.key}`);
    if (n.kind === 'accordion' && !n.items?.length) throw new Error(`Empty original FAQ: ${n.key}`);
    (n.children ?? []).forEach(child => visit(child, depth + 1));
  };
  for (const section of design.sections) { if (section.kind !== 'container') throw new Error('Top-level sections must be native containers'); visit(section, 0); }
  for (const n of nodes) if (n.href?.startsWith('#') && !anchors.has(n.href.slice(1))) throw new Error(`Missing original anchor destination: ${n.href}`);
  if (nodes.filter(n => n.kind === 'heading' && (n.headingTag === 'h1' || (!n.headingTag && n.key === 'hero-title'))).length !== 1) throw new Error('The original homepage must have exactly one H1');
  return design;
}
export async function loadOriginalDesign(root: string, filename: string): Promise<OriginalDesign> {
  const absoluteRoot = await realpath(root);
  const file = insideProject(absoluteRoot, filename);
  insideProject(absoluteRoot, await realpath(file));
  const designStat = await stat(file);
  if (!designStat.isFile() || designStat.size > 2_000_000) throw new Error('Original design must be a regular file within 2 MiB');
  const design = validateOriginalDesign(JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')));
  for (const asset of design.assets) {
    asset.path = insideProject(absoluteRoot, asset.path);
    insideProject(absoluteRoot, await realpath(asset.path));
    const imageStat = await stat(asset.path);
    if (!imageStat.isFile() || !/\.(?:png|jpe?g|webp)$/i.test(asset.path) || imageStat.size > 20_971_520) throw new Error(`Original image must be a local PNG/JPEG/WebP file within 20 MiB: ${asset.key}`);
    try {
      const metadata = await sharp(asset.path, { limitInputPixels: 80_000_000 }).metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new Error('Unsupported raster image');
    } catch { throw new Error(`Original image bytes cannot be decoded as a static PNG/JPEG/WebP: ${asset.key}`); }
  }
  return design;
}
