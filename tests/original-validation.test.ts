import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink, rm } from 'node:fs/promises';
import sharp from 'sharp';
import { insideProject, loadOriginalDesign, validateOriginalDesign } from '../src/original/validate.js';
import { originalDesign } from '../src/original/design.js';
import type { OriginalDesign } from '../src/original/types.js';
import { runOriginal } from '../src/original/runner.js';

const fixtureDesign = (): OriginalDesign => ({
  version: 1, brand: 'MoriPaws', title: 'Original pet-care homepage', language: 'en', description: 'Authored demonstration content.',
  tokens: { font: 'Arial', contentWidth: 1200, colors: { ink: '#203C31', ivory: '#FCFBF8' } },
  assets: [{ key: 'hero', path: 'assets/pets.png', alt: 'Dog and cat', provenance: 'Original locally generated demonstration artwork.' }],
  sections: [{ key: 'hero', kind: 'container', anchor: 'home', children: [
    { key: 'hero-title', kind: 'heading', headingTag: 'h1', text: 'Small paws. Big love.' },
    { key: 'hero-image', kind: 'image', asset: 'hero', alt: 'Dog and cat' },
    { key: 'hero-button', kind: 'button', text: 'Read care notes', href: '#care' },
  ] }, { key: 'care', kind: 'container', anchor: 'care', children: [{ key: 'care-title', kind: 'heading', text: 'Care, together.' }] }],
});
async function inWorkspace<T>(fn: (paths: { base: string; project: string; outside: string }) => Promise<T>): Promise<T> {
  const temp = path.resolve(os.tmpdir());
  const base = await mkdtemp(path.join(temp, 'clonewp-original-validation-'));
  const project = path.join(base, 'project'), outside = path.join(base, 'outside');
  await mkdir(project); await mkdir(outside);
  try { return await fn({ base, project, outside }); }
  finally {
    // The test cleanup remains within the exact generated temporary workspace; no computed foreign deletion.
    assert.equal(path.dirname(path.resolve(base)), temp);
    assert.match(path.basename(base), /^clonewp-original-validation-/);
    await rm(base, { recursive: true, force: true });
  }
}
const writeDesign = async (project: string, design = fixtureDesign()) => {
  const file = path.join(project, 'design.json');
  await writeFile(file, JSON.stringify(design));
  return file;
};
const validPNG = () => sharp({ create: { width: 16, height: 12, channels: 3, background: '#E5EBDD' } }).png().toBuffer();

test('original validator accepts the authored MoriPaws homepage without foreign source facts', () => {
  const validated = validateOriginalDesign(originalDesign);
  assert.equal(validated.sections.length, 9);
  assert.equal(validated.assets.length, 2);
  assert.equal(validated.brand, 'MoriPaws');
  assert.equal(Object.hasOwn(validated, 'sourceUrl'), false);
  assert.equal(Object.hasOwn(validated, 'sourceCapture'), false);
});

test('original design rejects source URLs, active links and undeclared style instructions', () => {
  assert.throws(() => validateOriginalDesign({ ...fixtureDesign(), sourceUrl: 'https://foreign.example/' }), /Unrecognized key/);
  for (const href of ['javascript:alert(1)', 'data:text/html,test', 'https://user:secret@foreign.example/', 'file:///D:/private', '//foreign.example/', '/\\foreign.example/', '/%2fforeign.example/', '#']) {
    const input = fixtureDesign(); input.sections[0].children![2].href = href;
    assert.throws(() => validateOriginalDesign(input), /Invalid string/);
  }
  const customCss = fixtureDesign(); (customCss.sections[0].style as unknown) = { custom_css: 'body{display:none}' };
  assert.throws(() => validateOriginalDesign(customCss), /Unrecognized key/);
  const controls = fixtureDesign(); (controls.sections[0] as unknown as Record<string, unknown>).settings = { arbitrary_native_setting: 'value' };
  assert.throws(() => validateOriginalDesign(controls), /Unrecognized key/);
});

test('original workflow and public HTTP(S), root-relative and anchor links are explicit and safe', () => {
  for (const href of ['https://business.example/shop?tag=care', 'http://business.example/shop', '/shop/?tag=care#items', '#care']) {
    const input = fixtureDesign(); input.workflow = 'original-design'; input.sections[0].children![2].href = href;
    assert.equal(validateOriginalDesign(input).workflow, 'original-design');
  }
  assert.equal(validateOriginalDesign(fixtureDesign()).workflow, undefined, 'Historical valid authored designs retain their legacy shape');
  assert.throws(() => validateOriginalDesign({ ...fixtureDesign(), workflow: 'block-replication' }), /original-design/);
  for (const href of ['https://example.com/%0aheader', 'https://example.com/a b', '/%5celsewhere', ' https://example.com/', 'https://example.com/\n']) {
    const input = fixtureDesign(); input.sections[0].children![2].href = href; assert.throws(() => validateOriginalDesign(input), /Invalid string/);
  }
});

test('original typed component responsibilities and finite responsive/hover input are validated', () => {
  const input = fixtureDesign();
  input.sections[1].children!.push({ key: 'own-products', kind: 'products', productQuery: { limit: 2, ids: [21, 22] }, productDisplay: { layout: 'grid', columns: 2, tabletColumns: 2, mobileColumns: 1 } });
  input.sections[0].style = { tabletDirection: 'row', tabletPadding: [16, 20, 16, 20], tabletGap: 15 };
  input.sections[0].children![2].hover = { background: '#112233', color: '#FFFFFF' };
  assert.equal(validateOriginalDesign(input).sections[1].children![1].kind, 'products');
  const badCount = structuredClone(input); badCount.sections[1].children![1].productQuery!.ids = [21, 21];
  assert.throws(() => validateOriginalDesign(badCount), /unique and match limit/);
  const foreignSettings = fixtureDesign(); foreignSettings.sections[1].productQuery = { limit: 1 };
  assert.throws(() => validateOriginalDesign(foreignSettings), /only to products/);
  const nonFinite = structuredClone(input); nonFinite.sections[0].style!.tabletGap = Infinity;
  assert.throws(() => validateOriginalDesign(nonFinite), /Invalid input/);
  const fakeChildren = structuredClone(input); fakeChildren.sections[1].children![1].children = [{ key: 'fake-product-copy', kind: 'text', text: 'Copied product' }];
  assert.throws(() => validateOriginalDesign(fakeChildren), /leaf cannot contain children/);
  const badSlides = fixtureDesign(); badSlides.sections[1].children!.push({ key: 'story-slider', kind: 'carousel', carousel: { slidesToShow: 1, arrows: true, pagination: 'dots', autoplay: false, loop: false }, children: [{ key: 'flat-slide', kind: 'text', text: 'Needs container' }] });
  assert.throws(() => validateOriginalDesign(badSlides), /native container slides/);
});

test('original design validates unique identities, complete content and actual anchor destinations', () => {
  const duplicate = fixtureDesign(); duplicate.sections[1].children![0].key = 'hero-title';
  assert.throws(() => validateOriginalDesign(duplicate), /Duplicate authored node/);
  const anchor = fixtureDesign(); anchor.sections[1].anchor = 'home';
  assert.throws(() => validateOriginalDesign(anchor), /Duplicate anchor/);
  const missing = fixtureDesign(); missing.sections[0].children![2].href = '#missing';
  assert.throws(() => validateOriginalDesign(missing), /Missing original anchor destination/);
  const missingButtonLink = fixtureDesign(); delete missingButtonLink.sections[0].children![2].href;
  assert.throws(() => validateOriginalDesign(missingButtonLink), /Missing original button destination/);
  const undeclared = fixtureDesign(); undeclared.sections[0].children![1].asset = 'unregistered';
  assert.throws(() => validateOriginalDesign(undeclared), /Undeclared original image/);
  const twoH1 = fixtureDesign(); twoH1.sections[1].children![0].headingTag = 'h1';
  assert.throws(() => validateOriginalDesign(twoH1), /exactly one H1/);
  const empty = fixtureDesign(); empty.sections[1].children = [];
  assert.throws(() => validateOriginalDesign(empty), /Empty original container/);
});

test('local design and asset paths must remain inside the exact project root', async () => {
  await inWorkspace(async ({ project, outside }) => {
    assert.equal(insideProject(project, 'original/design.json'), path.join(project, 'original', 'design.json'));
    for (const value of ['../outside/design.json', path.join(outside, 'design.json'), project, path.join(project, '..', 'project-neighbor', 'design.json')]) assert.throws(() => insideProject(project, value), /inside the project/);
    await assert.rejects(loadOriginalDesign(project, '../outside/design.json'), /inside the project/);
    const design = fixtureDesign(); design.assets[0].path = path.join(outside, 'pets.png');
    await writeFile(path.join(outside, 'pets.png'), Buffer.from([1]));
    await writeDesign(project, design);
    await assert.rejects(loadOriginalDesign(project, 'design.json'), /inside the project/);
  });
});

test('original loading rejects an asset junction that resolves outside the project', async () => {
  await inWorkspace(async ({ project, outside }) => {
    await writeFile(path.join(outside, 'pets.png'), Buffer.from([1]));
    await symlink(outside, path.join(project, 'assets'), 'junction');
    await writeDesign(project);
    await assert.rejects(loadOriginalDesign(project, 'design.json'), /inside the project/);
    assert.deepEqual(await readFile(path.join(outside, 'pets.png')), Buffer.from([1]));
  });
});

test('original loading rejects a design directory junction that resolves outside the project', async () => {
  await inWorkspace(async ({ project, outside }) => {
    await writeFile(path.join(outside, 'design.json'), JSON.stringify(fixtureDesign()));
    await symlink(outside, path.join(project, 'linked-design'), 'junction');
    await assert.rejects(loadOriginalDesign(project, 'linked-design/design.json'), /inside the project/);
  });
});

test('original loading resolves ordinary local assets and rejects unsupported formats', async () => {
  await inWorkspace(async ({ project }) => {
    await mkdir(path.join(project, 'assets')); await writeFile(path.join(project, 'assets', 'pets.png'), await validPNG());
    await writeDesign(project);
    const design = await loadOriginalDesign(project, 'design.json');
    assert.equal(design.assets[0].path, path.join(project, 'assets', 'pets.png'));
    // This valid fixture has real decoded dimensions; a filename alone is not image proof.
    const unsupported = fixtureDesign(); unsupported.assets[0].path = 'assets/pets.svg';
    await writeFile(path.join(project, 'assets', 'pets.svg'), '<svg/>'); await writeDesign(project, unsupported);
    await assert.rejects(loadOriginalDesign(project, 'design.json'), /PNG\/JPEG\/WebP/);
  });
});

test('malformed original image bytes fail before credentials, configuration or target writes', async () => {
  await inWorkspace(async ({ project }) => {
    await mkdir(path.join(project, 'assets'));
    await writeFile(path.join(project, 'assets', 'pets.png'), Buffer.from('not a PNG despite the extension'));
    await writeDesign(project);
    await assert.rejects(loadOriginalDesign(project, 'design.json'), /image|decode|format/i);
    // This workspace deliberately has no target config or credentials. An image-specific failure
    // proves the public runner rejects this local input before attempting to load either.
    await assert.rejects(runOriginal('design.json', { root: project }), error => {
      const message = String(error);
      assert.match(message, /image|decode|format/i);
      assert.doesNotMatch(message, /credentials|project\.json|ENOENT/);
      return true;
    });
    await assert.rejects(stat(path.join(project, 'runs')), { code: 'ENOENT' });
  });
});

test('original image input must be a regular local file rather than a named directory', async () => {
  await inWorkspace(async ({ project }) => {
    await mkdir(path.join(project, 'assets', 'pets.png'), { recursive: true });
    await writeDesign(project);
    await assert.rejects(loadOriginalDesign(project, 'design.json'), /regular|file|image/i);
  });
});
