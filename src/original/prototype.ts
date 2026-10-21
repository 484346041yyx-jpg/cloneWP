import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { OriginalDesign, OriginalNode } from './types.js';

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const length = (value: number) => `${value}px`;
const spacing = (values?: number[]) => values?.map(length).join(' ');
function styleDeclarations(node: OriginalNode, device: 'desktop' | 'tablet' | 'mobile' = 'desktop'): string {
  const s = node.style ?? {};
  const rules: string[] = [];
  const add = (key: string, value: string | number | undefined) => { if (value !== undefined) rules.push(`${key}:${value}`); };
  if (device !== 'desktop') {
    const mobile = device === 'mobile';
    add('flex-direction', mobile ? s.mobileDirection ?? (node.kind === 'container' ? 'column' : undefined) : s.tabletDirection);
    add('flex-wrap', mobile ? s.mobileWrap : s.tabletWrap);
    const width = mobile ? s.mobileWidth ?? (s.width !== undefined && node.kind !== 'button' ? 100 : undefined) : s.tabletWidth;
    if (width !== undefined) add('width', `${width}%`);
    add('padding', spacing(mobile ? s.mobilePadding : s.tabletPadding));
    add('margin', spacing(mobile ? s.mobileMargin : s.tabletMargin));
    add('text-align', mobile ? s.mobileAlign : s.tabletAlign);
    add('justify-content', mobile ? s.mobileJustify : s.tabletJustify);
    add('align-items', mobile ? s.mobileAlignItems : s.tabletAlignItems);
    const gap = mobile ? s.mobileGap : s.tabletGap, font = mobile ? s.mobileFontSize : s.tabletFontSize;
    const height = mobile ? s.mobileImageHeight : s.tabletImageHeight, minHeight = mobile ? s.mobileMinHeight : s.tabletMinHeight;
    if (gap !== undefined) add('gap', length(gap));
    if (font !== undefined) add('font-size', length(font));
    if (height !== undefined) add('height', length(height));
    if (minHeight !== undefined) add('min-height', length(minHeight));
    return rules.map(rule => `${rule}!important`).join(';');
  }
  if (node.kind === 'container') {
    add('display', 'flex'); add('flex-direction', s.direction ?? 'column');
    add('flex-wrap', s.wrap); add('justify-content', s.justify); add('align-items', s.alignItems); add('gap', s.gap !== undefined ? length(s.gap) : undefined);
  }
  if (s.width !== undefined) add('width', `${s.width}%`);
  add('text-align', s.align); add('padding', spacing(s.padding)); add('margin', spacing(s.margin));
  add('background', s.background); add('color', s.color);
  if (s.borderWidth !== undefined) add('border', `${s.borderWidth}px solid ${s.borderColor ?? 'transparent'}`);
  if (s.radius !== undefined) add('border-radius', length(s.radius));
  if (s.fontSize !== undefined) add('font-size', length(s.fontSize));
  add('font-weight', s.weight); add('line-height', s.lineHeight);
  if (s.imageHeight !== undefined) add('height', length(s.imageHeight));
  if (s.minHeight !== undefined) add('min-height', length(s.minHeight));
  return rules.join(';');
}

/** Independent original preview; no captured source HTML or clone run is consumed. */
export function renderOriginalPrototype(design: OriginalDesign, assetUrls: Record<string, string> = {}): string {
  const mobileRules: string[] = [], tabletRules: string[] = [], hoverRules: string[] = [];
  let nativeOnly = false;
  const assetMap = Object.fromEntries(design.assets.map(a => [a.key, assetUrls[a.key] ?? `assets/${basename(a.path)}`]));
  function nodeHtml(node: OriginalNode, topLevel = false): string {
    const attrs = `data-original-key="${escape(node.key)}"${node.anchor ? ` id="${escape(node.anchor)}"` : ''}`;
    const mobile = styleDeclarations(node, 'mobile'), tablet = styleDeclarations(node, 'tablet');
    if (mobile) mobileRules.push(`[data-original-key="${escape(node.key)}"]{${mobile}}`);
    if (tablet) tabletRules.push(`[data-original-key="${escape(node.key)}"]{${tablet}}`);
    if (node.hover) {
      const h = node.hover, rules = [h.background === undefined ? '' : `background:${h.background}`, h.color === undefined ? '' : `color:${h.color}`, h.borderColor === undefined ? '' : `border-color:${h.borderColor}`, h.borderWidth === undefined ? '' : `border-width:${length(h.borderWidth)};border-style:solid`, h.radius === undefined ? '' : `border-radius:${length(h.radius)}`, h.opacity === undefined ? '' : `opacity:${h.opacity}`].filter(Boolean);
      hoverRules.push(`[data-original-key="${escape(node.key)}"]:hover{${rules.join(';')}}`);
    }
    const style = styleDeclarations(node);
    if (topLevel) {
      const background = node.style?.background ?? 'transparent';
      const styleWithoutBackground = style.replace(/(?:^|;)background:[^;]+/g, '');
      return `<section class="section-shell" style="background:${escape(background)}"><div class="section-inner" ${attrs} style="${escape(styleWithoutBackground)}${node.style?.boxed !== false ? `;max-width:${design.tokens.contentWidth}px;margin-left:auto;margin-right:auto` : ''}">${(node.children ?? []).map(n => nodeHtml(n)).join('')}</div></section>`;
    }
    switch (node.kind) {
      case 'container': return `<div ${attrs} style="${escape(style)}">${(node.children ?? []).map(n => nodeHtml(n)).join('')}</div>`;
      case 'heading': {
        const tag = node.headingTag ?? 'h2';
        return `<${tag} ${attrs} style="${escape(style)}">${escape(node.text ?? '').replaceAll('\n', '<br>')}</${tag}>`;
      }
      case 'text': return `<p ${attrs} style="${escape(style)}">${escape(node.text ?? '').replaceAll('\n', '<br>')}</p>`;
      case 'image': return `<img ${attrs} src="${escape(assetMap[node.asset ?? ''] ?? '')}" alt="${escape(node.alt ?? '')}" style="${escape(style)}" loading="${node.key === 'hero-image' ? 'eager' : 'lazy'}" width="1536" height="1024">`;
      case 'button': return `<a class="original-button" ${attrs} href="${escape(node.href ?? '#top')}" style="${escape(style)}">${escape(node.text ?? '')}</a>`;
      case 'accordion': return `<div class="original-accordion" ${attrs} style="${escape(style)}">${(node.items ?? []).map((item, i) => `<details${i === 0 ? ' open' : ''}><summary>${escape(item.title)}<span aria-hidden="true">+</span></summary><p>${escape(item.content)}</p></details>`).join('')}</div>`;
      // The independent authored preview cannot supply product data or native Swiper behavior.
      // Explicit placeholders retain block responsibilities without fabricating product cards or a working carousel.
      case 'products': nativeOnly = true; return `<div ${attrs} data-native-preview="requires-target-render" style="${escape(style)}"><p>Target product preview requires the native WordPress draft.</p></div>`;
      case 'carousel': nativeOnly = true; return `<div ${attrs} data-native-preview="static-slide-content" style="${escape(style)}">${(node.children ?? []).map(child => nodeHtml(child)).join('')}</div>`;
    }
  }
  const sections = design.sections.map(n => nodeHtml(n, true)).join('\n');
  return `<!doctype html><html lang="${escape(design.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escape(design.description)}"><title>${escape(design.title)}</title><style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:${design.tokens.colors.ivory ?? '#FFFFFF'};font-family:${escape(design.tokens.font)},sans-serif;color:${design.tokens.colors.ink ?? '#222222'};font-size:17px;line-height:1.65}h1,h2,h3,h4,p{margin:0;overflow-wrap:break-word}img{display:block;object-fit:cover;max-width:100%;height:auto}a{color:inherit} .section-inner{width:100%;min-width:0}.section-inner>*,[data-original-key]>div{min-width:0} .original-button{display:inline-flex;justify-content:center;align-items:center;text-decoration:none;width:auto;flex-shrink:0;line-height:1.3}.original-button:focus-visible,summary:focus-visible{outline:3px solid ${design.tokens.colors.clay ?? '#222222'};outline-offset:4px}.original-accordion{overflow:hidden}.original-accordion details{border-bottom:1px solid ${design.tokens.colors.line ?? '#DDDDDD'};background:${design.tokens.colors.ivory ?? '#FFFFFF'}}.original-accordion details:last-child{border-bottom:0}.original-accordion summary{display:flex;justify-content:space-between;align-items:center;padding:20px 22px;gap:16px;cursor:pointer;font-weight:700;font-size:17px;line-height:1.4;list-style:none}.original-accordion summary::-webkit-details-marker{display:none}.original-accordion details[open] summary span{transform:rotate(45deg)}.original-accordion details p{padding:0 22px 23px;font-size:16px;color:${design.tokens.colors.muted ?? '#555555'};line-height:1.65}
${hoverRules.join('\n')}
@media(max-width:1024px){${tabletRules.join('\n')}}
@media(max-width:768px){${mobileRules.join('\n')} .original-accordion summary{font-size:16px;padding:18px}.original-accordion details p{padding:0 18px 20px}.section-inner{max-width:100%!important}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.original-button{transition:none}}
</style></head><body>${nativeOnly ? '<aside role="note">Authored layout preview: native products and carousel behavior require verification in the WordPress draft.</aside>' : ''}<main>${sections}</main></body></html>`;
}

export async function writeOriginalPrototype(design: OriginalDesign, directory: string): Promise<{ htmlPath: string; designPath: string }> {
  await mkdir(join(directory, 'assets'), { recursive: true });
  const assetUrls: Record<string, string> = {};
  for (const asset of design.assets) {
    const filename = `${asset.key}${extname(asset.path)}`;
    const destination = join(directory, 'assets', filename);
    if (destination.toLowerCase() !== asset.path.replaceAll('/', '\\').toLowerCase()) await copyFile(asset.path, destination);
    assetUrls[asset.key] = `assets/${filename}`;
  }
  const htmlPath = join(directory, 'index.html');
  const designPath = join(directory, 'design.json');
  await writeFile(htmlPath, renderOriginalPrototype(design, assetUrls), 'utf8');
  await writeFile(designPath, `${JSON.stringify(design, null, 2)}\n`, 'utf8');
  return { htmlPath, designPath };
}
