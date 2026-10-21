import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, deriveOriginal } from '../src/reference/derive.js';
import { validateOriginalDesign } from '../src/original/validate.js';
import type { OriginalNode } from '../src/original/types.js';
import type { BusinessProfile, ReferenceCaptureReport, ReferenceSection, ReferenceViewport } from '../src/reference/types.js';

function profile(): BusinessProfile {
  return {
    version: 1, brand: 'MoriPaws', language: 'en', description: 'Own pet-care demonstration concept.', demo: true,
    business: 'Own everyday pet-care concept', audience: 'People living with dogs and cats', goal: 'Explain our own gentle care approach',
    hero: { eyebrow: 'OUR OWN CARE CONCEPT', title: 'Care, close to home.', description: 'Own copy for little shared moments.', primaryLabel: 'Explore care', secondaryLabel: 'Our approach' },
    services: [
      { key: 'brushing', title: 'Own gentle brushing', description: 'Our original brushing description.' },
      { key: 'play', title: 'Own everyday play', description: 'Our original play description.' },
      { key: 'rest', title: 'Own comfortable rest', description: 'Our original rest description.' },
    ],
    story: { title: 'Our original approach', paragraphs: ['Our own story paragraph.'] },
    process: { title: 'Our original steps', steps: [{ title: 'Observe', description: 'Notice your pet.' }, { title: 'Pause', description: 'Keep things gentle.' }] },
    articles: { title: 'Our original notes', items: [{ key: 'comfort', title: 'Own comfort note', description: 'Our own note copy.' }] },
    faq: [{ title: 'Is this a demonstration?', content: 'Yes. This is our own demonstration.' }],
    cta: { title: 'An own shared moment.', description: 'Our own closing copy.', label: 'Explore our care' },
    assets: [{ key: 'hero', path: 'D:/cloneWP/original/assets/hero-pets.png', alt: 'Our own original dog and cat photograph', provenance: 'Original AI artwork created for our own brand' }, { key: 'care', path: 'D:/cloneWP/original/assets/care-lifestyle.png', alt: 'Our own original care photograph', provenance: 'Original AI artwork created for our own brand' }],
  };
}
function section(id: string, role: ReferenceSection['role'], position: number): ReferenceSection {
  return { id, role, inferred: true, confidence: 0.8, selector: `#foreign-${id}`, rect: { x: 30, y: position, width: 1200, height: 400 }, heading: 'FOREIGN COPY NEVER REUSE', textPreview: 'FOREIGN BRAND 230000 REVIEWS $49', columns: role === 'services' ? 3 : undefined, layout: 'flex', direction: 'row' };
}
function capture(): ReferenceCaptureReport {
  const viewport: ReferenceViewport = {
    name: 'desktop', width: 1440, height: 900, title: 'FOREIGN BRAND NEVER REUSE', pageHeight: 3200,
    screenshotPath: 'D:/cloneWP/reference-jobs/test/source-desktop.png', domPath: 'D:/cloneWP/reference-jobs/test/source.html', evidencePath: 'D:/cloneWP/reference-jobs/test/evidence.json',
    headings: [{ level: 1, text: 'FOREIGN HERO COPY NEVER REUSE', selector: '#foreign-heading', rect: { x: 30, y: 200, width: 500, height: 120 } }],
    navigation: [{ text: 'FOREIGN STORE', href: 'https://foreign.example/products', selector: '#foreign-nav' }],
    ctas: [{ text: 'BUY FOREIGN PRODUCT $49', href: 'https://foreign.example/cart', tag: 'button', selector: '#foreign-cart', rect: { x: 30, y: 330, width: 140, height: 40 } }],
    sections: [section('hero', 'hero', 0), section('story', 'story', 700), section('services', 'services', 1200), section('faq', 'faq', 2200)],
    images: [{ url: 'https://foreign.example/foreign-product.png', alt: 'FOREIGN PRODUCT', width: 1000, height: 1000, selector: '#foreign-image', loaded: true, rect: { x: 700, y: 100, width: 500, height: 500 } }],
    typography: [{ family: 'Arial, sans-serif', size: 16, weight: '400', lineHeight: '24px', count: 80 }],
    colors: [{ hex: '#E8541D', weight: 20, role: 'accent' }, { hex: '#FFFFFF', weight: 80, role: 'background' }],
    layout: { contentWidth: 1187, hero: { layout: 'split', imageSide: 'left' }, density: 'airy', cardColumns: 3, cornerStyle: 'round' },
    disclosures: [], metadata: { language: 'en', description: 'FOREIGN SEARCH COPY NEVER REUSE', ogImage: 'https://foreign.example/logo.png' }, counts: { images: 10 },
  };
  return { version: 1, url: 'https://foreign.example/', finalUrl: 'https://foreign.example/', capturedAt: '2026-10-13T03:00:00Z', status: 'complete', evidenceNotice: 'Fixture facts only', viewports: [viewport], gaps: [], artifactPath: 'D:/cloneWP/reference-jobs/test/reference-report.json' };
}
function flat(nodes: OriginalNode[]): OriginalNode[] { return nodes.flatMap(node => [node, ...flat(node.children ?? [])]); }

test('reference proposal creates a valid native original tree with only own text, assets and anchors', () => {
  const own = profile(), source = capture(), beforeOwn = JSON.stringify(own), beforeSource = JSON.stringify(source);
  const { design, transfer } = deriveOriginal(source, own);
  validateOriginalDesign(design);
  assert.equal(transfer.nature, 'deterministic-starting-proposal');
  assert.deepEqual(transfer.originality, { sourceTextUsed: false, sourceMediaUsed: false, sourceTreeUsed: false, ownBusinessFactsOnly: true });
  const json = JSON.stringify(design);
  for (const forbidden of ['FOREIGN', 'foreign.example', '$49', '230000', '#foreign', 'foreign-product.png']) assert.ok(!json.includes(forbidden), forbidden);
  assert.ok(json.includes(own.hero.title));
  assert.deepEqual(design.assets, own.assets);
  assert.ok(flat(design.sections).every(node => ['container', 'heading', 'text', 'image', 'button', 'accordion'].includes(node.kind)));
  assert.equal(JSON.stringify(own), beforeOwn); assert.equal(JSON.stringify(source), beforeSource);
});

test('observed hero relationship and semantic role sequence affect new own layout', () => {
  const source = capture();
  const split = deriveOriginal(source, profile()).design;
  assert.equal(split.sections[1].style?.direction, 'row');
  assert.deepEqual(split.sections[1].children?.map(node => node.key), ['hero-copy', 'hero-visual']);
  assert.ok(split.sections.findIndex(node => node.key === 'story') < split.sections.findIndex(node => node.key === 'offerings'));
  source.viewports[0].layout.hero.layout = 'centered';
  source.viewports[0].sections = [section('hero', 'hero', 0), section('services', 'services', 700), section('process', 'process', 1100), section('story', 'story', 1600)];
  const centered = deriveOriginal(source, profile()).design;
  assert.equal(centered.sections[1].style?.direction, 'column');
  assert.equal(centered.sections[1].children?.[0].style?.alignItems, 'center');
  assert.ok(centered.sections.findIndex(node => node.key === 'offerings') < centered.sections.findIndex(node => node.key === 'story'));
  assert.ok(centered.sections.findIndex(node => node.key === 'process') < centered.sections.findIndex(node => node.key === 'story'));
  assert.notEqual(JSON.stringify(split), JSON.stringify(centered));
});

test('card rhythm, density, corners and type family change proposal structure and native styling', () => {
  const source = capture();
  const airy = deriveOriginal(source, profile()).design;
  source.viewports[0].layout = { contentWidth: 1800, hero: { layout: 'image-led' }, density: 'dense', cardColumns: 1, cornerStyle: 'square' };
  source.viewports[0].typography = [{ family: 'Georgia, serif', size: 40, weight: '700', lineHeight: '48px', count: 10 }];
  const dense = deriveOriginal(source, profile()).design;
  const airyCard = flat(airy.sections).find(node => node.key === 'offering-0-card')!;
  const denseCard = flat(dense.sections).find(node => node.key === 'offering-0-card')!;
  assert.ok(airyCard.style!.width! < 40); assert.equal(denseCard.style!.width, 100);
  assert.ok(airyCard.style!.radius! > denseCard.style!.radius!);
  assert.ok(airy.sections[2].style!.padding![0] > dense.sections[2].style!.padding![0]);
  assert.equal(dense.tokens.font, 'Georgia'); assert.equal(dense.tokens.contentWidth, 1280);
  assert.equal(dense.sections[1].children?.[0].key, 'hero-visual');
  validateOriginalDesign(dense);
});

test('reference color mood is transformed and proposal text meets light-surface contrast', () => {
  const source = capture(), first = deriveOriginal(source, profile()).design;
  assert.notEqual(first.tokens.colors.forest, '#E8541D');
  source.viewports[0].colors[0].hex = '#2756C8';
  const second = deriveOriginal(source, profile()).design;
  assert.notEqual(first.tokens.colors.forest, second.tokens.colors.forest);
  for (const design of [first, second]) for (const foreground of ['forest', 'ink', 'muted', 'clay']) for (const background of ['white', 'ivory', 'sage', 'sand']) assert.ok(contrastRatio(design.tokens.colors[foreground], design.tokens.colors[background]) >= 4.5, `${foreground}/${background}`);
  const own = profile(); own.colors = { primary: '#6F2547' };
  const ownedFirst = deriveOriginal(source, own).design.tokens.colors;
  source.viewports[0].colors[0].hex = '#E8541D';
  assert.deepEqual(deriveOriginal(source, own).design.tokens.colors, ownedFirst);
});

test('unsupported source claims and functional roles are omitted rather than invented', () => {
  const source = capture();
  source.viewports[0].sections.push(section('reviews', 'proof', 2800), section('signup', 'newsletter', 3000), section('products', 'products', 3200));
  const { design, transfer } = deriveOriginal(source, profile());
  assert.ok(transfer.omitted.some(row => row.role === 'proof'));
  assert.ok(transfer.omitted.some(row => row.role === 'newsletter'));
  assert.ok(transfer.omitted.some(row => row.role === 'products'));
  assert.ok(!JSON.stringify(design).includes('Reviews'));
  assert.ok(!flat(design.sections).some(node => node.kind as string === 'html' || node.href?.startsWith('http')));
  const own = profile(); own.story = undefined; own.process = undefined; own.articles = undefined; own.faq = [];
  const reduced = deriveOriginal(source, own);
  assert.ok(!reduced.design.sections.some(node => ['story', 'process', 'guides', 'faq'].includes(node.key)));
  assert.ok(reduced.transfer.omitted.some(row => row.role === 'story'));
  validateOriginalDesign(reduced.design);
});

test('low-confidence roles and missing media are disclosed instead of silently claimed', () => {
  const source = capture(); source.status = 'partial'; source.gaps = [{ code: 'MOBILE_BLOCKED', message: 'Mobile evidence was unavailable.', viewport: 'mobile' }];
  source.viewports[0].sections.forEach(section => section.confidence = 0.2);
  const own = profile(); own.assets = [];
  const result = deriveOriginal(source, own);
  assert.ok(result.transfer.limitations.some(text => text.includes('MOBILE_BLOCKED')));
  assert.ok(result.transfer.limitations.some(text => text.includes('No confidently')));
  assert.ok(result.transfer.limitations.some(text => text.includes('No target media')));
  assert.equal(result.design.sections[1].children?.length, 1);
  validateOriginalDesign(result.design);
});

test('blocked or empty reference evidence cannot masquerade as a reference-derived design', () => {
  const blocked = capture(); blocked.status = 'blocked';
  assert.throws(() => deriveOriginal(blocked, profile()), /no usable captured evidence/);
  const empty = capture(); empty.viewports = [];
  assert.throws(() => deriveOriginal(empty, profile()), /no usable captured evidence/);
});

test('an unknown source hero selects a disclosed own starting recipe rather than claiming source understanding', () => {
  const source = capture(); source.viewports[0].layout.hero.layout = 'unknown';
  const result = deriveOriginal(source, profile());
  validateOriginalDesign(result.design);
  assert.equal(result.design.sections[1].style?.direction, 'row');
  assert.ok(result.transfer.limitations.some(text => text.includes('hero relationship is unknown')));
  assert.ok(result.transfer.adopted[0].transformation.includes('not attributed to the reference'));
});

test('source screenshot artwork and remote source image assignments are rejected', () => {
  const source = capture(), own = profile(); own.assets[0].path = source.viewports[0].screenshotPath;
  assert.throws(() => deriveOriginal(source, own), /reference screenshots/);
  own.assets[0].path = 'https://foreign.example/foreign-product.png';
  assert.throws(() => deriveOriginal(source, own), /owned local media/);
});

test('all transfer application keys resolve and adopted order ignores foreign DOM structure', () => {
  const source = capture(), { design, transfer } = deriveOriginal(source, profile()), keys = new Set(flat(design.sections).map(node => node.key));
  for (const row of transfer.adopted) for (const key of row.targetKeys) assert.ok(keys.has(key), key);
  assert.ok(transfer.adopted.every(row => row.evidence.every(path => path.startsWith(source.viewports[0].evidencePath))));
  assert.ok(transfer.adopted.some(row => row.transformation.includes('foreign DOM hierarchy')));
});
