import { createHash } from 'node:crypto';
import type { OriginalDesign, OriginalNode } from '../original/types.js';
import type { BusinessProfile, ReferenceCaptureReport, ReferenceRole, ReferenceTransfer, ReferenceViewport } from './types.js';

interface Palette {
  ivory: string; white: string; forest: string; ink: string; muted: string;
  clay: string; sage: string; sand: string; line: string;
}

const clamp = (value: number, lower: number, upper: number): number => Math.max(lower, Math.min(upper, value));
const hexBytes = (hex: string): number[] | undefined => {
  const expanded = /^#[a-f\d]{3}$/i.test(hex) ? `#${hex.slice(1).split('').map(c => c + c).join('')}` : hex;
  return /^#[a-f\d]{6}$/i.test(expanded) ? [1, 3, 5].map(i => parseInt(expanded.slice(i, i + 2), 16)) : undefined;
};
const luminance = (hex: string): number => {
  const channels = (hexBytes(hex) ?? [0, 0, 0]).map(c => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
export const contrastRatio = (foreground: string, background: string): number => {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
function hueSaturation(hex: string): { hue: number; saturation: number } {
  const [r, g, b] = (hexBytes(hex) ?? [35, 74, 62]).map(c => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  if (delta) { hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4; hue *= 60; }
  return { hue: (hue + 360) % 360, saturation: delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0 };
}
function hsl(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation, h = ((hue % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs(h % 2 - 1)), m = lightness - chroma / 2;
  const rgb = h < 1 ? [chroma, x, 0] : h < 2 ? [x, chroma, 0] : h < 3 ? [0, chroma, x] : h < 4 ? [0, x, chroma] : h < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${rgb.map(c => Math.round((c + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
function readable(seed: string, backgrounds: string[], minimum = 4.5): string {
  const { hue, saturation } = hueSaturation(seed);
  for (let lightness = 0.31; lightness >= 0.04; lightness -= 0.02) {
    const candidate = hsl(hue, Math.min(saturation, 0.68), lightness);
    if (backgrounds.every(bg => contrastRatio(candidate, bg) >= minimum)) return candidate;
  }
  return '#15221F';
}
function transformedPalette(brand: string, sourceAccent: string | undefined, ownPrimary?: string): Palette {
  const seed = createHash('sha256').update(brand).digest()[0];
  const source = hueSaturation(sourceAccent ?? '#234A3E');
  const own = ownPrimary && hexBytes(ownPrimary) ? hueSaturation(ownPrimary) : undefined;
  // Preserve the reference's color mood while giving the target its own palette and contrast.
  const hue = own?.hue ?? (source.hue + 11 + seed % 23) % 360;
  const ivory = hsl(39, 0.4, 0.972), white = '#FFFFFF', sage = hsl(hue, 0.18, 0.932), sand = hsl(34, 0.28, 0.924);
  const forest = readable(hsl(hue, own ? clamp(own.saturation, 0.2, 0.65) : 0.4, 0.25), [ivory, white, sage, sand]);
  const clay = readable(hsl((hue + 155) % 360, 0.44, 0.33), [ivory, white, sage, sand]);
  return { ivory, white, forest, ink: readable(hsl(hue, 0.25, 0.22), [ivory, white, sage, sand]), muted: readable(hsl(hue, 0.14, 0.35), [ivory, white, sage, sand]), clay, sage, sand, line: hsl(hue, 0.1, 0.81) };
}

type SectionRole = 'offerings' | 'story' | 'process' | 'guides' | 'faq';
interface OwnContent {
  brand: string; language: string; description: string; demo: boolean;
  hero: { eyebrow?: string; title: string; description: string; primaryLabel: string; secondaryLabel?: string };
  offerings: { title: string; description?: string; items: Array<{ title: string; description: string }> };
  story?: { title: string; paragraphs: string[] };
  process?: { title: string; description?: string; steps: Array<{ title: string; description: string }> };
  guides?: { title: string; description?: string; items: Array<{ title: string; description: string }> };
  faq: { title: string; items: Array<{ title: string; content: string }> };
  cta: { title: string; description: string; label: string };
  footer: string; assets: OriginalDesign['assets'];
}
interface DesignSignals {
  heroLayout: 'split' | 'centered' | 'image-led' | 'text-led';
  sourceImageSide: 'left' | 'right'; density: 'airy' | 'balanced' | 'dense';
  columns: number; rounded: boolean; serif: boolean; width: number;
  order: SectionRole[]; sourceAccent?: string; ownPrimary?: string;
}

function buildOwnDesign(content: OwnContent, signals: DesignSignals): { design: OriginalDesign; composition: { hero: string; columns: number; sectionOrder: string[] } } {
  const C = transformedPalette(content.brand, signals.sourceAccent, signals.ownPrimary);
  const chinese = content.language.toLowerCase().startsWith('zh');
  const copy = chinese ? { back: '返回顶部 ↑', faq: '常见问题', story: '品牌理念', demo: '此页面为原创示范品牌展示，不提供实际交易、预约或订阅。' } : { back: 'Back to top ↑', faq: 'Questions', story: 'Our approach', demo: 'This is an original demonstration brand. No real products, bookings or subscriptions are offered on this page.' };
  const gap = signals.density === 'airy' ? 30 : signals.density === 'dense' ? 18 : 24;
  const sectionPadding = signals.density === 'airy' ? 88 : signals.density === 'dense' ? 54 : 70;
  const radius = signals.rounded ? 16 : 4;
  const text = (key: string, value: string, style: OriginalNode['style'] = {}): OriginalNode => ({ key, kind: 'text', text: value, style: { fontSize: 17, mobileFontSize: 16, lineHeight: 1.6, color: C.muted, ...style } });
  const heading = (key: string, value: string, size = 40, style: OriginalNode['style'] = {}, tag: 'h1' | 'h2' | 'h3' | 'p' = 'h2'): OriginalNode => ({ key, kind: 'heading', headingTag: tag, text: value, style: { fontSize: size, mobileFontSize: size > 35 ? 34 : size, weight: 700, lineHeight: 1.15, color: C.forest, ...style } });
  const box = (key: string, children: OriginalNode[], style: OriginalNode['style'] = {}, anchor?: string): OriginalNode => ({ key, kind: 'container', children, anchor, style: { direction: 'column', gap, ...style } });
  const section = (key: string, children: OriginalNode[], background: string, style: OriginalNode['style'] = {}): OriginalNode => box(key, children, { boxed: true, background, padding: [sectionPadding, 28, sectionPadding, 28], mobilePadding: [48, 22, 48, 22], ...style }, key);
  const button = (key: string, value: string, href: string, secondary = false): OriginalNode => ({ key, kind: 'button', text: value, href, style: { fontSize: 14, weight: 700, color: secondary ? C.forest : C.white, background: secondary ? C.white : C.forest, borderColor: C.forest, borderWidth: 1, radius: Math.min(radius, 12), padding: [15, 23, 15, 23] } });
  const image = (key: string, asset: OriginalDesign['assets'][number], height: number): OriginalNode => ({ key, kind: 'image', asset: asset.key, alt: asset.alt, style: { width: 100, mobileWidth: 100, imageHeight: height, mobileImageHeight: 300, radius } });
  const introduction = (key: string, title: string, description?: string, centered = true): OriginalNode => box(`${key}-intro`, [heading(`${key}-title`, title), ...(description ? [text(`${key}-description`, description)] : [])], { gap: 14, align: centered ? 'center' : 'left', alignItems: centered ? 'center' : 'flex-start', margin: [0, 0, gap, 0] });

  const available = new Map<SectionRole, OriginalNode>();
  const columns = clamp(Math.round(signals.columns), 1, Math.min(3, content.offerings.items.length));
  const cards = (key: string, items: Array<{ title: string; description: string }>, numbered = false): OriginalNode => box(`${key}-collection`, items.map((item, i) => {
    const children: OriginalNode[] = [...(numbered ? [heading(`${key}-${i}-number`, String(i + 1).padStart(2, '0'), 36, { color: C.clay }, 'p')] : []), heading(`${key}-${i}-title`, item.title, 27, {}, 'h3'), text(`${key}-${i}-copy`, item.description)];
    return box(`${key}-${i}-card`, children, { width: columns === 1 ? 100 : (100 - (columns - 1) * 4) / columns, mobileWidth: 100, gap: 18, background: i % 2 ? C.sand : C.sage, radius, padding: [30, 25, 30, 25], alignItems: 'flex-start' });
  }), { direction: 'row', mobileDirection: 'column', wrap: 'wrap', mobileWrap: 'nowrap', justify: columns === 1 ? 'flex-start' : 'space-between', alignItems: 'stretch', gap });
  available.set('offerings', section('offerings', [introduction('offerings', content.offerings.title, content.offerings.description, signals.columns !== 1), cards('offering', content.offerings.items)], C.white));
  if (content.story) {
    const body = box('story-copy', [introduction('story', content.story.title, undefined, false), ...content.story.paragraphs.map((value, i) => text(`story-paragraph-${i}`, value)), button('story-action', content.hero.primaryLabel, '#offerings')], { width: content.assets[1] ? 48 : 100, mobileWidth: 100, alignItems: 'flex-start' });
    const visual = content.assets[1] ? box('story-visual', [image('story-image', content.assets[1], 420)], { width: 47, mobileWidth: 100 }) : undefined;
    available.set('story', section('story', visual ? (signals.sourceImageSide === 'left' ? [body, visual] : [visual, body]) : [body], C.ivory, { direction: 'row', mobileDirection: 'column', justify: 'space-between', alignItems: 'center', gap: gap + 14 }));
  }
  if (content.process?.steps.length) available.set('process', section('process', [introduction('process', content.process.title, content.process.description), cards('process-step', content.process.steps, true)], C.white));
  if (content.guides?.items.length) available.set('guides', section('guides', [introduction('guides', content.guides.title, content.guides.description, false), cards('guide', content.guides.items)], C.sage));
  if (content.faq.items.length) {
    const faqTitle = introduction('faq', content.faq.title, undefined, signals.heroLayout === 'centered');
    const accordion: OriginalNode = { key: 'faq-items', kind: 'accordion', items: content.faq.items.map(item => ({ ...item })), style: { fontSize: 17, mobileFontSize: 16, lineHeight: 1.6, color: C.forest, borderWidth: 1, borderColor: C.line, radius } };
    if (signals.heroLayout !== 'centered') { faqTitle.style = { ...faqTitle.style, width: 35, mobileWidth: 100 }; accordion.style = { ...accordion.style, width: 60, mobileWidth: 100 }; }
    available.set('faq', section('faq', [faqTitle, accordion], C.ivory, { direction: signals.heroLayout === 'centered' ? 'column' : 'row', mobileDirection: 'column', justify: 'space-between', gap: gap + 12 }));
  }

  const ownOrder = Array.from(new Set([...signals.order, 'offerings', 'story', 'process', 'guides', 'faq'] as SectionRole[])).filter(role => available.has(role));
  const sections = ownOrder.map(role => available.get(role)!);
  const navigation = [button('nav-offerings', content.offerings.title, '#offerings', true), ...(available.has('story') ? [button('nav-story', copy.story, '#story', true)] : []), ...(available.has('faq') ? [button('nav-faq', copy.faq, '#faq', true)] : [])];
  for (const nav of navigation) nav.style = { ...nav.style, background: C.ivory, borderWidth: 0, radius: 0, padding: [10, 3, 10, 3], fontSize: 13 };
  const header = section('header', [heading('brand-wordmark', content.brand, 28, {}, 'p'), box('main-navigation', navigation, { direction: 'row', mobileDirection: 'row', wrap: 'wrap', mobileWrap: 'wrap', gap: 18, justify: 'center', alignItems: 'center' })], C.ivory, { direction: 'row', mobileDirection: 'column', justify: 'space-between', alignItems: 'center', padding: [24, 28, 24, 28], mobilePadding: [20, 22, 20, 22] });
  header.anchor = 'top';
  const centerHero = signals.heroLayout === 'centered' || signals.heroLayout === 'image-led';
  const heroCopy = box('hero-copy', [...(content.hero.eyebrow ? [text('hero-eyebrow', content.hero.eyebrow, { fontSize: 12, weight: 700, color: C.clay })] : []), heading('hero-title', content.hero.title, signals.density === 'dense' ? 48 : 58, { mobileFontSize: 40, align: centerHero ? 'center' : 'left' }, 'h1'), text('hero-description', content.hero.description, { fontSize: 18, align: centerHero ? 'center' : 'left' }), box('hero-actions', [button('hero-primary', content.hero.primaryLabel, '#offerings'), ...(content.hero.secondaryLabel && available.has('story') ? [button('hero-secondary', content.hero.secondaryLabel, '#story', true)] : [])], { direction: 'row', mobileDirection: 'column', gap: 12, justify: centerHero ? 'center' : 'flex-start', alignItems: centerHero ? 'center' : 'flex-start' })], { width: centerHero || signals.heroLayout === 'text-led' || !content.assets[0] ? 100 : 46, mobileWidth: 100, gap: 24, alignItems: centerHero ? 'center' : 'flex-start' });
  const heroVisual = content.assets[0] ? box('hero-visual', [image('hero-image', content.assets[0], centerHero ? 450 : 480)], { width: centerHero ? 100 : 48, mobileWidth: 100 }) : undefined;
  const heroChildren = signals.heroLayout === 'text-led' || !heroVisual ? [heroCopy] : signals.heroLayout === 'image-led' ? [heroVisual, heroCopy] : signals.heroLayout === 'centered' ? [heroCopy, heroVisual] : signals.sourceImageSide === 'left' ? [heroCopy, heroVisual] : [heroVisual, heroCopy];
  const hero = section('hero', heroChildren, C.ivory, { direction: centerHero || signals.heroLayout === 'text-led' ? 'column' : 'row', mobileDirection: 'column', justify: 'space-between', alignItems: 'center', gap: gap + 18, padding: [36, 28, sectionPadding, 28], mobilePadding: [28, 22, 48, 22] });
  const cta = section('next-step', [heading('next-step-title', content.cta.title, 46, { color: C.white, align: 'center', mobileFontSize: 34 }), text('next-step-copy', content.cta.description, { color: C.white, align: 'center', fontSize: 18 }), button('next-step-action', content.cta.label, '#offerings', true)], C.forest, { align: 'center', alignItems: 'center' });
  const footer = section('footer', [box('footer-row', [heading('footer-wordmark', content.brand, 28, {}, 'p'), ...(available.has('guides') ? [button('footer-guides', content.guides!.title, '#guides', true)] : []), button('footer-top', copy.back, '#top', true)], { direction: 'row', mobileDirection: 'column', justify: 'space-between', alignItems: 'center', gap: 16 }), text('footer-copy', content.footer, { fontSize: 13 }), ...(content.demo ? [text('demo-notice', copy.demo, { fontSize: 12 })] : [])], C.ivory, { padding: [38, 28, 30, 28], mobilePadding: [32, 22, 28, 22], gap: 14 });
  const full = [header, hero, ...sections, cta, footer];
  return { design: { version: 1, brand: content.brand, title: `${content.brand} — ${content.hero.title.replaceAll('\n', ' ')}`.slice(0, 200), language: content.language, description: content.description, tokens: { colors: { ...C }, font: signals.serif ? 'Georgia' : 'Arial', contentWidth: Math.round(clamp(signals.width, 1050, 1280)) }, assets: content.assets.map(asset => ({ ...asset })), sections: full }, composition: { hero: signals.heroLayout, columns, sectionOrder: full.map(section => section.key) } };
}

const roleMap: Partial<Record<ReferenceRole, SectionRole>> = { services: 'offerings', categories: 'offerings', products: 'offerings', story: 'story', process: 'process', articles: 'guides', faq: 'faq' };
const omittedReasons: Partial<Record<ReferenceRole, string>> = {
  proof: 'Reference testimonials, review counts, awards and numerical claims are not facts about the target business.',
  products: 'Reference products, prices, inventories and product IDs are excluded; only the visual concept of grouped offerings can inform the target’s own services.',
  categories: 'Reference category labels, taxonomy IDs and catalogue links are excluded; groupings are rebuilt from the target profile.',
  gallery: 'Reference photos and social posts are not reused. The proposal uses only the target’s declared local assets.',
  newsletter: 'A source signup form does not establish a working target subscription backend. No unconnected form is generated.',
  unknown: 'This section’s role was not established with enough evidence to turn it into a target business requirement.',
};

function primaryViewport(report: ReferenceCaptureReport): ReferenceViewport {
  const candidates = report.viewports.filter(viewport => viewport.sections.length || viewport.headings.length || viewport.images.length);
  if (report.status === 'blocked' || !candidates.length) throw new Error('Reference has no usable captured evidence; an original proposal cannot be presented as reference-derived');
  return [...candidates].sort((a, b) => b.width - a.width)[0];
}

/** An evidence-driven starting proposal for Codex to review and re-author.
 * This is a bounded recipe transformer, not a claim that the reference's business or creative intent has been understood by an AI.
 * Only coarse visual signals and inferred section roles cross the reference boundary. Target text and assets come from the saved business profile.
 */
export function deriveOriginal(reference: ReferenceCaptureReport, profile: BusinessProfile): { design: OriginalDesign; transfer: ReferenceTransfer } {
  const desktop = primaryViewport(reference);
  if (profile.version !== 1 || !profile.brand.trim() || !profile.hero.title.trim() || !profile.services.length || !profile.hero.primaryLabel.trim()) throw new Error('The target business profile needs its own brand, hero copy and offerings');
  const sourceArtifacts = new Set(reference.viewports.flatMap(viewport => [viewport.screenshotPath, viewport.domPath, viewport.evidencePath]).map(value => value.replaceAll('\\', '/').toLowerCase()));
  for (const asset of profile.assets) {
    if (!asset.path || /^https?:\/\//i.test(asset.path) || sourceArtifacts.has(asset.path.replaceAll('\\', '/').toLowerCase())) throw new Error('Target assets must be owned local media; reference screenshots and remote reference media cannot be proposal artwork');
    if (!asset.provenance?.trim()) throw new Error(`Target media needs its own provenance: ${asset.key}`);
  }
  const sourceAccent = [...desktop.colors].filter(color => hexBytes(color.hex) && hueSaturation(color.hex).saturation >= 0.18 && luminance(color.hex) < 0.7).sort((a, b) => Number(b.role === 'accent') - Number(a.role === 'accent') || b.weight - a.weight)[0]?.hex;
  const confident = desktop.sections.filter(section => section.confidence >= 0.55);
  const order = confident.flatMap(section => roleMap[section.role] ? [roleMap[section.role]!] : []);
  const heroRole = desktop.sections.find(section => section.role === 'hero');
  const serif = desktop.typography.some(font => /(?:georgia|times|garamond|baskerville|bodoni|playfair|lora|merriweather|cormorant|libre caslon|^serif$)/i.test(font.family) && !/sans-serif/i.test(font.family));
  const rawColumns = desktop.layout.cardColumns ?? confident.find(section => ['services', 'products', 'categories', 'articles'].includes(section.role) && section.columns)?.columns ?? 3;
  const signals: DesignSignals = {
    heroLayout: profile.assets.length ? (desktop.layout.hero.layout === 'unknown' ? 'split' : desktop.layout.hero.layout) : 'text-led',
    sourceImageSide: desktop.layout.hero.imageSide ?? (heroRole?.imageSide === 'left' ? 'left' : 'right'),
    density: desktop.layout.density,
    columns: Number.isFinite(rawColumns) ? clamp(rawColumns, 1, 3) : 3,
    rounded: desktop.layout.cornerStyle !== 'square', serif,
    width: desktop.layout.contentWidth && Number.isFinite(desktop.layout.contentWidth) ? Math.round(desktop.layout.contentWidth / 40) * 40 : 1200,
    order, sourceAccent, ownPrimary: profile.colors?.forest ?? profile.colors?.primary,
  };
  const chinese = profile.language.toLowerCase().startsWith('zh');
  const own: OwnContent = {
    brand: profile.brand, language: profile.language, description: profile.description, demo: profile.demo,
    hero: { ...profile.hero }, offerings: { title: chinese ? '从这里开始' : 'Start with what matters.', items: profile.services.map(item => ({ title: item.title, description: item.description })) },
    story: profile.story ? { title: profile.story.title, paragraphs: [...profile.story.paragraphs] } : undefined,
    process: profile.process ? { title: profile.process.title, steps: profile.process.steps.map(item => ({ ...item })) } : undefined,
    guides: profile.articles ? { title: profile.articles.title, items: profile.articles.items.map(item => ({ title: item.title, description: item.description })) } : undefined,
    faq: { title: chinese ? '你可能想了解' : 'A little more to know.', items: profile.faq.map(item => ({ ...item })) },
    cta: { ...profile.cta }, footer: profile.description, assets: profile.assets.map(asset => ({ ...asset })),
  };
  const { design, composition } = buildOwnDesign(own, signals);
  const refPath = desktop.evidencePath || `${reference.artifactPath}#${desktop.name}`;
  const evidenceFor = (role: SectionRole): string[] => confident.filter(section => roleMap[section.role] === role).map(section => `${refPath}#section:${section.id}`);
  const adopted: ReferenceTransfer['adopted'] = [
    { principle: 'Hero emphasis and copy–image relationship', evidence: [refPath + '#layout.hero', ...(heroRole ? [refPath + '#section:' + heroRole.id] : [])], targetKeys: ['hero', 'hero-copy', ...(composition.hero === 'text-led' ? [] : ['hero-visual'])], transformation: desktop.layout.hero.layout === 'unknown' ? `The captured hero relationship is unproven. A ${composition.hero} starting recipe is chosen from the target’s own available assets, not attributed to the reference. Codex must inspect the screenshot before making a final hero decision.` : `The observed ${desktop.layout.hero.layout} composition informed a ${composition.hero} recipe. The split image position is reversed when applicable; copy, photo, proportions and actions are authored for ${profile.brand}.` },
    { principle: 'Density, shape and visual pacing', evidence: [refPath + '#layout.density', refPath + '#layout.cornerStyle'], targetKeys: design.sections.map(section => section.key), transformation: `A ${signals.density} spacing scale and ${signals.rounded ? 'soft' : 'square'} shape family are rebuilt with bounded native controls. Source pixel values and the foreign DOM hierarchy are not copied.` },
    { principle: 'Grouped offerings', evidence: [refPath + '#layout.cardColumns', ...evidenceFor('offerings')], targetKeys: ['offerings', 'offering-collection'], transformation: `${composition.columns} column(s) organize only the ${profile.services.length} offerings supplied by the target profile. No source products, prices or categories become target records.` },
    { principle: 'Information sequence', evidence: [...new Set(order)].flatMap(evidenceFor), targetKeys: composition.sectionOrder, transformation: `Confident semantic roles inform priority; unsupported roles are omitted, available target sections are added, and the header, hero, closing action and footer are independently rebuilt. Target order: ${composition.sectionOrder.join(' → ')}.` },
    { principle: 'Palette and readable typography', evidence: [refPath + '#colors', refPath + '#typography'], targetKeys: ['hero-title', 'offerings-title', 'next-step'], transformation: `${signals.ownPrimary ? 'The declared target primary hue takes priority.' : 'The observed accent mood is shifted using the target brand seed.'} Foregrounds are recalculated to meet 4.5:1 contrast against the proposal’s light surfaces. ${signals.serif ? 'Georgia' : 'Arial'} is a locally available interpretation of the observed type family.` },
  ];
  const omitted: ReferenceTransfer['omitted'] = [];
  for (const role of [...new Set(desktop.sections.map(section => section.role))]) {
    const reason = omittedReasons[role];
    if (reason) omitted.push({ role, reason });
    const mapped = roleMap[role];
    if (mapped && !design.sections.some(section => section.key === mapped)) omitted.push({ role, reason: `The target profile supplies no own ${mapped} content; the source cannot supply missing business facts.` });
  }
  const limitations = [
    'This file is a deterministic starting proposal. Codex must inspect the screenshots and evidence, adapt the design to the target business and write a final original design with rationale before building.',
    'Captured appearance does not establish source conversion performance, user research, backend behavior or a complete site architecture.',
    'Section roles and hero/card signals are inferred from visible DOM measurements; unclear roles require screenshot review.',
    'Only declared target copy and local artwork are used. Commerce, search, filtering, signup, accounts and bookings are not created from source interactions.',
    ...reference.gaps.map(gap => `Capture gap ${gap.code}${gap.viewport ? ' (' + gap.viewport + ')' : ''}: ${gap.message}`),
  ];
  if (!order.length) limitations.push('No confidently inferred semantic content order was available; the proposal follows the target profile’s available content order.');
  if (desktop.layout.hero.layout === 'unknown') limitations.push('The reference hero relationship is unknown; the proposal’s split or text-led hero is an own starting choice, not a proven source design principle.');
  if (!profile.assets.length) limitations.push('No target media was supplied. The proposal is text-led; Codex can generate original artwork before final design.');
  if (!profile.language.startsWith('en') && !profile.language.startsWith('zh')) limitations.push('Generic navigation labels currently use English; Codex must localize these labels to the target language.');
  return { design, transfer: { version: 1, nature: 'deterministic-starting-proposal', sourceUrl: reference.url, targetBrand: profile.brand, adopted, omitted, originality: { sourceTextUsed: false, sourceMediaUsed: false, sourceTreeUsed: false, ownBusinessFactsOnly: true }, limitations } };
}
