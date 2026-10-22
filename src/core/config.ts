import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const viewport = z.object({ name: z.string(), width: z.number().int().positive(), height: z.number().int().positive() });
export const projectSchema = z.object({
  siteKey: z.string(), targetUrl: z.url(), credentialsFile: z.string(),
  wordpressNetworkRoute:z.enum(['environment','direct']).optional(),
  viewports: z.array(viewport).min(1), maxCorrectionRounds: z.number().int().min(0).max(3),
  maxSourceSections: z.number().int().positive(), maxSourceElements: z.number().int().positive().default(4000), maxElements: z.number().int().positive(),
  maxAssets: z.number().int().positive(), maxAssetBytes: z.number().int().positive(),
  maxPageHeight: z.number().int().positive(), pageStatus: z.enum(['draft', 'publish']),
  pageTemplate: z.literal('elementor_canvas'), agentTimeoutMs: z.number().int().positive(),
  maxTotalMs: z.number().int().positive(),
});
export type ProjectConfig = z.infer<typeof projectSchema>;
export type Credentials = { wp_user: string; wp_app_password: string };
export async function readJson<T = unknown>(file: string): Promise<T> {
  return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')) as T;
}
export async function loadConfig(root = process.cwd()): Promise<{ root: string; config: ProjectConfig; credentials: Credentials }> {
  root = path.resolve(root);
  const config = projectSchema.parse(await readJson(path.join(root, 'config/project.json')));
  const credentialPath = path.resolve(root, config.credentialsFile);
  if (!credentialPath.startsWith(root + path.sep)) throw new Error('Credentials path must stay inside the project');
  const credentialsFromEnvironment = process.env.CLONEWP_WP_USER !== undefined || process.env.CLONEWP_WP_APP_PASSWORD !== undefined;
  const credentials = z.object({ wp_user: z.string().min(1), wp_app_password: z.string().min(1) }).parse(
    credentialsFromEnvironment
      ? { wp_user: process.env.CLONEWP_WP_USER, wp_app_password: process.env.CLONEWP_WP_APP_PASSWORD }
      : await readJson(credentialPath),
  );
  if (new URL(config.targetUrl).protocol !== 'https:') throw new Error('Target must use HTTPS');
  return { root, config, credentials };
}
export function redactor(credentials?: Credentials) {
  const secrets = credentials ? [credentials.wp_app_password, credentials.wp_app_password.replace(/\s/g, ''), Buffer.from(`${credentials.wp_user}:${credentials.wp_app_password}`).toString('base64')] : [];
  return (value: unknown): string => {
    let text = value instanceof Error ? value.message : String(value);
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[REDACTED]');
    return text.replace(/\b(?:ck|cs)_[a-zA-Z0-9]+\b/g, '[REDACTED]').replace(/(Authorization[\s"':=]+)(?:Basic|Bearer)\s+[^\s",}]+/gi, '$1[REDACTED]').replace(/(\b(?:cookie|set-cookie)\s*:\s*)[^\r\n]*/gi, '$1[REDACTED]').replace(/([?&](?:token|key|nonce|_wpnonce|preview_nonce|password|secret|authorization)=)[^&\s]+/gi, '$1[REDACTED]');
  };
}
