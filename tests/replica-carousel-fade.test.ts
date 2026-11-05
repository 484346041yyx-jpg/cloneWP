import assert from 'node:assert/strict';
import test from 'node:test';
import { carouselMotionFrameSchema, compareCarouselMotion, hasSettledCarouselFade } from '../src/replica-responsive/motion-review.js';

const settled = (activeIndex: number) => carouselMotionFrameSchema.parse({
  viewportWidth: 390, activeIndex, items: [0, 1, 2].map(index => ({
    index, x: 0, width: 390, opacity: index === activeIndex ? 1 : 0,
  })),
});

test('fade review accepts the opacity transfer without track movement', () => {
  const first = settled(0), second = settled(1);
  assert.ok(hasSettledCarouselFade(first, second));
  assert.deepEqual(compareCarouselMotion(first, second, first, second, 'fade'), []);
  const onlyIndexChanged = { ...first, activeIndex: 1 };
  assert.equal(hasSettledCarouselFade(first, onlyIndexChanged), false);
  assert.deepEqual(compareCarouselMotion(first, second, first, onlyIndexChanged, 'fade'), ['fade opacity transfer']);
  const slide = { ...second, items: second.items.map(item => ({ ...item, x: -390 })) };
  assert.equal(hasSettledCarouselFade(first, slide), false);
});
