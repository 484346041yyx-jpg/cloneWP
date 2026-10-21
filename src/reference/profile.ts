import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { z } from 'zod';
import { readJson } from '../core/config.js';
import { insideProject } from '../original/validate.js';
import type { BusinessProfile } from './types.js';

const content = z.string().trim().min(1).max(10000);
const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,100}$/);
export const businessProfileSchema: z.ZodType<BusinessProfile> = z.strictObject({
  version: z.literal(1), brand: content, language: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/), description: content, demo: z.boolean(),
  business: content, audience: content, goal: content,
  colors: z.record(z.string(), z.string().regex(/^#[a-f0-9]{6}$/i)).optional(),
  hero: z.strictObject({ eyebrow: content, title: content, description: content, primaryLabel: content, secondaryLabel: content.optional() }),
  services: z.array(z.strictObject({ key, title: content, description: content })).max(12),
  story: z.strictObject({ title: content, paragraphs: z.array(content).min(1).max(8) }).optional(),
  process: z.strictObject({ title: content, steps: z.array(z.strictObject({ title: content, description: content })).min(1).max(6) }).optional(),
  articles: z.strictObject({ title: content, items: z.array(z.strictObject({ key, title: content, description: content })).min(1).max(9) }).optional(),
  faq: z.array(z.strictObject({ title: content, content })).max(12),
  cta: z.strictObject({ title: content, description: content, label: content }),
  assets: z.array(z.strictObject({ key, path: content, alt: content, provenance: content })).max(30),
});
export async function loadBusinessProfile(root: string, filename: string): Promise<BusinessProfile> {
  const file = insideProject(root, filename);
  insideProject(root, await realpath(file));
  const profile = businessProfileSchema.parse(await readJson(file));
  for (const asset of profile.assets) {
    asset.path = insideProject(root, asset.path);
    insideProject(root, await realpath(asset.path));
    if (!/\.(?:png|jpe?g|webp)$/i.test(asset.path)) throw new Error(`Own brand asset must be a local raster image: ${asset.key}`);
    await readFile(asset.path);
  }
  if (new Set(profile.assets.map(asset => asset.key)).size !== profile.assets.length) throw new Error('Own brand asset keys must be unique');
  return profile;
}
