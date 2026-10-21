import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { captureReplicaV2, readCheckActualV2 } from '../src/replica-v2/verify.js';
import type { CompiledReplicaV2, ProgramV2 } from '../src/replica-v2/types.js';

/** Browser environment fixture: real CSS transform/transitionend, two original
 * slides and loop clones. A physical snap offset deliberately differs from the
 * source index, as in the registered native looping carousel. */
function documentFixture(mode: 'fraction' | 'bullets', frozen: boolean): string {
  return `<!doctype html><html><head><title>Carousel environment</title><style>
  html,body{margin:0}.elementor{width:600px;margin:20px auto}.swiper{width:300px;height:120px;overflow:hidden}.swiper-wrapper{display:flex;width:1200px;height:120px;transform:translateX(-300px);transition:transform .08s linear}.swiper-slide{flex:0 0 300px;height:120px;box-sizing:border-box;padding:20px}.swiper-pagination{display:flex;gap:8px;height:24px;align-items:center}.swiper-pagination-bullet{display:block;width:12px;height:12px;background:#ccc}.swiper-pagination-bullet-active{background:#004cdb}button{width:80px;height:32px}
  @media(prefers-reduced-motion:reduce){.swiper-wrapper{transition-duration:0s!important}}
  </style></head><body><main class="elementor"><section data-id="aaaaaaa"><div data-id="bbbbbbb" data-widget_type="nested-carousel.default" data-settings='{"autoplay":"no","infinite":"yes"}'>
  <div class="swiper"><div class="swiper-wrapper"><div class="swiper-slide swiper-slide-duplicate" data-swiper-slide-index="1">Second clone</div><div class="swiper-slide swiper-slide-active" data-swiper-slide-index="0">First actual slide</div><div class="swiper-slide" data-swiper-slide-index="1">Second actual slide</div><div class="swiper-slide swiper-slide-duplicate" data-swiper-slide-index="0">First clone</div></div></div>
  <button class="elementor-swiper-button-prev" aria-label="Previous slide">Previous</button><button class="elementor-swiper-button-next" aria-label="Next slide">Next</button>
  <div class="swiper-pagination">${mode === 'fraction' ? '<span class="swiper-pagination-current">1</span>/<span class="swiper-pagination-total">2</span>' : '<span class="swiper-pagination-bullet swiper-pagination-bullet-active"></span><span class="swiper-pagination-bullet"></span>'}</div></div></section></main>
  <script>
  const area=document.querySelector('.swiper'),track=document.querySelector('.swiper-wrapper'),slides=[...track.children],original=slides.filter(slide=>!slide.classList.contains('swiper-slide-duplicate'));
  const runtime=area.swiper={initialized:true,destroyed:false,animating:false,realIndex:0,snapIndex:1,params:{slidesPerView:1,slidesPerGroup:1,loop:true},autoplay:{running:false}};
  track.addEventListener('transitionend',event=>{if(event.propertyName==='transform')runtime.animating=false});
  function move(delta){if(runtime.animating)return;runtime.realIndex=(runtime.realIndex+delta+2)%2;runtime.snapIndex=runtime.realIndex+1;runtime.animating=true;slides.forEach(slide=>slide.classList.remove('swiper-slide-active'));original[runtime.realIndex].classList.add('swiper-slide-active');track.style.transform='translateX('+(-runtime.snapIndex*300)+'px)';if(!${frozen}){const fraction=document.querySelector('.swiper-pagination-current');if(fraction)fraction.textContent=String(runtime.realIndex+1);document.querySelectorAll('.swiper-pagination-bullet').forEach((bullet,index)=>bullet.classList.toggle('swiper-pagination-bullet-active',index===runtime.realIndex))}}
  document.querySelector('.elementor-swiper-button-next').addEventListener('click',()=>move(1));document.querySelector('.elementor-swiper-button-prev').addEventListener('click',()=>move(-1));
  </script></body></html>`;
}

const compiled = { sectionIds: ['aaaaaaa'], sections: [{ key: 'hero', targetId: 'aaaaaaa', elementIds: ['aaaaaaa', 'bbbbbbb'] }], queryReceipts: [] } as unknown as CompiledReplicaV2;
const program = { viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }] } as ProgramV2;
const sourceFacts = { snapshots: [{ id: 'desktop-1', viewport: { name: 'desktop' } }], facts: {} };

test('v2 capture keeps real transitions, logical source identities and loop pagination synchronized despite physical clone offsets', async () => {
  const base = 'D:/cloneWP/.cache/replica-v2-carousel-browser-tests'; await mkdir(base, { recursive: true }); const runDir = await mkdtemp(path.join(base, 'run-'));
  let mutationRequests = 0;
  const server = createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) mutationRequests++;
    const url = new URL(request.url ?? '/', 'http://fixture.test'); response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(documentFixture(url.searchParams.get('mode') === 'bullets' ? 'bullets' : 'fraction', url.searchParams.get('frozen') === '1'));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw Error('Fixture server failed'); const origin = `http://127.0.0.1:${address.port}`;
  const capture = (mode: 'fraction' | 'bullets', frozen = false) => captureReplicaV2({ program, compiled, sourceFacts, componentPlan: { components: [{ id: 'hero', parentId: null }], requirements: [{ id: 'manual-carousel', componentId: 'hero', factIds: [], verification: { kind: 'interaction', selector: '[data-id="bbbbbbb"]', property: 'carousel', expected: { manual: true, pagination: mode } } }] }, checkpoint: 'desktop', runDir, previewUrl: `${origin}/?mode=${mode}&frozen=${frozen ? '1' : '0'}`, pageId: 42, cookies: [], documentHash: '1'.repeat(64), programHash: '2'.repeat(64), sourceFactsHash: '3'.repeat(64), componentPlanHash: '4'.repeat(64) });
  try {
    for (const mode of ['fraction', 'bullets'] as const) {
      const receipt = await capture(mode), check = receipt.checks.find(item => item.id === 'manual-carousel');
      assert.equal(receipt.automatedPassed, true, JSON.stringify(receipt.checks)); assert.equal(receipt.motionPreference, 'no-preference'); assert.equal(check?.status, 'passed');
      const actual = await readCheckActualV2(check!, runDir) as any;
      assert.equal(actual.before.reducedMotion, false); assert.equal(actual.before.transitionDuration, '0.08s'); assert.equal(actual.before.animating, false); assert.equal(actual.after.animating, false);
      assert.equal(actual.before.activeIdentityVerified, true); assert.equal(actual.after.activeIdentityVerified, true); assert.equal(actual.before.visibilityVerified, true); assert.equal(actual.after.visibilityVerified, true);
      assert.deepEqual(actual.before.activeSourceIds, ['index:0']); assert.deepEqual(actual.after.activeSourceIds, ['index:1']); assert.deepEqual(actual.restored.activeSourceIds, ['index:0']);
      assert.equal(actual.beforePagination.snapIndex, 1); assert.equal(actual.beforePagination.logicalPage, 0); assert.equal(actual.afterPagination.snapIndex, 2); assert.equal(actual.afterPagination.logicalPage, 1);
      assert.equal(mode === 'fraction' ? actual.afterPagination.current : actual.afterPagination.active, mode === 'fraction' ? 2 : 1);
      assert.deepEqual(actual.loopBoundary.wrapped.activeSourceIds, ['index:1']); assert.deepEqual(actual.loopBoundary.restored.activeSourceIds, ['index:0']); assert.equal(actual.loopBoundary.wrappedPagination.logicalPage, 1); assert.equal(actual.loopBoundary.restoredPagination.logicalPage, 0);
      assert.equal(receipt.editorSessions, 0); assert.equal(receipt.blockedMutationRequests, 0);
    }
    const frozen = await capture('fraction', true), failed = frozen.checks.find(item => item.id === 'manual-carousel');
    assert.equal(frozen.automatedPassed, false); assert.equal(failed?.status, 'failed'); assert.match(failed?.error ?? '', /pagination did not synchronize/);
    const bad = await readCheckActualV2(failed!, runDir) as any; assert.deepEqual(bad.after.activeSourceIds, ['index:1']); assert.equal(bad.afterPagination.realIndex, 1); assert.equal(bad.afterPagination.current, 1); assert.equal(bad.after.animating, false); assert.equal(mutationRequests, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(runDir, { recursive: true, force: true }); }
});
