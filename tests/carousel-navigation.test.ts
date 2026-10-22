import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertCarouselNavigationMapped, assertNativeCarouselArrowCSS } from '../src/replica-full/carousel-navigation.js';
import { native44ModuleClass } from '../src/native44/adapters.js';
import type { Native44Program } from '../src/native44/types.js';
import type { BodySourceUnits } from '../src/replica-full/body-prepare.js';
import type { ObservationPacketV2 } from '../src/replica-v2/observation.js';

const root = 'D:/cloneWP';
const read = async <T>(name: string): Promise<T> => JSON.parse(await readFile(name, 'utf8')) as T;

test('v3 carousel gate rejects a default glyph and accepts scoped graphic decisions', async () => {
  const base = `${root}/runs/sk-jewellery-20261020-r1-final-preparation/coordinator-merged-623f94ab-04f5-4bbe-ae1b-7b38a77888a1`;
  const program = await read<Native44Program>(`${base}/program.json`);
  const sourceUnits = await read<BodySourceUnits>(`${base}/source-units.json`);
  const snapshots = new Map<string, ObservationPacketV2>();
  for (const [id, prefix] of [['sk-desktop', 'desktop'], ['sk-narrow', 'narrow']] as const) {
    const packets = await Promise.all(['hero', 'collection', 'looks', 'reviews', 'socials'].map(name => read<ObservationPacketV2>(`${root}/references/sk-jewellery-20261020/${prefix}-${name}-packet.json`)));
    snapshots.set(id, { ...packets[0], nodes: Object.assign({}, ...packets.map(p => p.nodes)), styles: Object.assign({}, ...packets.map(p => p.styles)), layouts: Object.assign({}, ...packets.map(p => p.layouts)), usages: Object.assign({}, ...packets.map(p => p.usages)), resources: Object.assign({}, ...packets.map(p => p.resources)) });
  }
  assert.throws(() => assertCarouselNavigationMapped({ program, sourceUnits, snapshots, css: '' }), /carousel_navigation_graphic_unmapped/);
  const historicalCss = await readFile(`${base}/body.css`, 'utf8');
  assert.throws(() => assertNativeCarouselArrowCSS(historicalCss, native44ModuleClass('looks_carousel'), [native44ModuleClass('looks_carousel'), 'cwp-n44-95d09b6231e6']), /carousel_navigation_double_vertical_offset/);
  const css = ['hero_carousel', 'looks_carousel', 'reviews_carousel', 'socials_carousel'].map(key => `:page .${native44ModuleClass(key)} .elementor-swiper-button::after{border-right:1px solid currentColor}`).join('\n') +
    `:page .${native44ModuleClass('collection_products')} .wd-arrow-inner::after{border-right:1px solid currentColor}` +
    `@media(max-width:768px){:page .${native44ModuleClass('collection_products')} .wd-nav-arrows{display:none}}` +
    `:page .${native44ModuleClass('reviews_carousel')} .elementor-swiper-button{display:none}`;
  const observations = assertCarouselNavigationMapped({ program, sourceUnits, snapshots, css });
  assert.equal(observations.length, 10);
  assert.equal(observations.find(row => row.componentKey === 'hero_carousel')?.graphic.previous, 'svg');
  const singleArrowSnapshots = new Map([...snapshots].map(([id, packet]) => [id, structuredClone(packet)]));
  const singleArrowUnits = { ...sourceUnits, units: sourceUnits.units.map(unit => unit.componentKeys.includes('hero_carousel')
    ? { ...unit, nodeIds: unit.nodeIds.filter(id => !/splide__arrow--prev/.test(singleArrowSnapshots.get(unit.snapshotId)?.nodes[id]?.attributes.class ?? '')) }
    : unit) };
  for (const packet of singleArrowSnapshots.values()) packet.nodes['hero-n7'].attributes.class = 'aspire-button carousel-arrow chevron-square right unstyled';
  const singleArrowObservations = assertCarouselNavigationMapped({ program, sourceUnits: singleArrowUnits, snapshots: singleArrowSnapshots, css });
  assert.equal(singleArrowObservations.find(row => row.componentKey === 'hero_carousel')?.sourceNodeIds.previous, null);
  assert.equal(singleArrowObservations.find(row => row.componentKey === 'hero_carousel')?.sourceNodeIds.next, 'hero-n7');
  const phonePackets = await Promise.all([390, 430].flatMap(width => ['hero', 'collection', 'looks', 'reviews', 'socials'].map(name => read<ObservationPacketV2>(`${root}/references/sk-jewellery-20261020/phone${width}-${name}-packet.json`))));
  const sections = ['hero', 'collection', 'looks', 'reviews', 'socials'].map(key => ({ key, evidence: phonePackets.filter(packet => packet.nodes[`${key}-n1`]).map(packet => ({ snapshotId: packet.snapshot.id, nodeId: `${key}-n1` })) }));
  const withPhone = assertCarouselNavigationMapped({ program, sourceUnits, snapshots, css: css + `@media(max-width:768px){:page .${native44ModuleClass('hero_carousel')} .elementor-swiper-button{display:none}}`, phone: { packets: phonePackets, sections } });
  assert.equal(withPhone.length, 20);
  assert.equal(withPhone.find(row => row.componentKey === 'hero_carousel' && row.snapshotId === phonePackets[0].snapshot.id)?.visible.next, false);
  assert.equal(withPhone.find(row => row.componentKey === 'collection_products' && row.snapshotId === phonePackets[1].snapshot.id)?.visible.next, false);
  const noArrowUnits = { ...sourceUnits, units: sourceUnits.units.map(unit => unit.componentKeys.includes('collection_products')
    ? { ...unit, nodeIds: unit.nodeIds.filter(id => !/splide__arrow--(?:prev|next)|swiper-button-(?:prev|next)/.test(snapshots.get(unit.snapshotId)?.nodes[id]?.attributes.class ?? '')) }
    : unit) };
  assert.throws(() => assertCarouselNavigationMapped({ program, sourceUnits: noArrowUnits, snapshots, css }), /carousel_navigation_hidden_state_unmapped/);
  assert.doesNotThrow(() => assertCarouselNavigationMapped({ program, sourceUnits: noArrowUnits, snapshots, css: css + `:page .${native44ModuleClass('collection_products')} .wd-nav-arrows{display:none}` }));
});

test('native carousel arrow guard rejects a second vertical offset and a corner-anchored glyph', () => {
  const cls = native44ModuleClass('looks_carousel');
  assert.throws(() => assertNativeCarouselArrowCSS(`:page .${cls} .elementor-swiper-button{top:calc(28.5cqw - 25px);transform:none}`, cls), /carousel_navigation_double_vertical_offset/);
  assert.throws(() => assertNativeCarouselArrowCSS(`:page .${cls} .elementor-swiper-button::after{top:0;left:0;clip-path:polygon(0 0,100% 50%,0 100%)}`, cls), /carousel_navigation_glyph_top_left/);
  assert.doesNotThrow(() => assertNativeCarouselArrowCSS(`:page .${cls} .elementor-swiper-button{top:28.5cqw!important;transform:translateY(-50%)!important}:page .${cls} .elementor-swiper-button::after{top:50%;left:50%;transform:translate(-50%,-50%);clip-path:polygon(0 0,100% 50%,0 100%)}@media(max-width:768px){:page .${cls} .elementor-swiper-button{top:50cqw!important}}`, cls));
  assert.doesNotThrow(() => assertNativeCarouselArrowCSS(`:page .${cls} .elementor-swiper-button{top:calc(28.5cqw - 25px);transform:none!important}`, cls));
});
