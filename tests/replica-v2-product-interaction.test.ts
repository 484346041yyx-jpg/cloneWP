import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Locator } from 'playwright';
import { verifyProductCarouselInteractionV2 } from '../src/replica-v2/product-interaction.js';
import { createScopedContext } from '../src/verification/capture-target.js';

function fixture(options: { frozen?: boolean; allFit?: boolean; autoplay?: boolean; fraction?: boolean; unknownClone?: boolean; extraBullet?: boolean } = {}): string {
  return `<!doctype html><style>body{margin:0}.wd-carousel{width:${options.allFit ? 480 : 160}px;height:100px;overflow:hidden}.wd-carousel-wrap{width:480px;display:flex;transition:transform .06s linear;transform:translateX(0)}.wd-carousel-item{flex:0 0 160px;height:100px}.product{width:160px;height:100px}.actual-pagination{height:24px;display:flex;gap:8px}.actual-dot{width:12px;height:12px;display:block;background:#ccc}.actual-active{background:blue}button{width:80px;height:30px}</style>
  <section data-widget_type="wd_products.default" data-id="bbbbbbb"><div class="wd-carousel"><div class="wd-carousel-wrap">${[41, 42, 43].map((id, index) => `<article class="wd-carousel-item${options.unknownClone && index === 0 ? ' product-copy' : ''}"><div class="product-grid-item product" data-id="${options.unknownClone && index === 0 ? 999 : id}">Product ${id}</div></article>`).join('')}</div></div><button class="actual-previous">Previous</button><button class="actual-next">Next</button><div class="actual-pagination">${options.fraction ? '<span class="actual-current">1</span>/<span>3</span>' : (options.allFit ? [0] : options.extraBullet ? [0, 1, 2, 3] : [0, 1, 2]).map(index => `<span class="actual-dot${index === 0 ? ' actual-active' : ''}"></span>`).join('')}</div></section>
  <script>(()=>{const area=document.querySelector('.wd-carousel'),track=document.querySelector('.wd-carousel-wrap'),pager=document.querySelector('.actual-pagination'),next=document.querySelector('.actual-next'),previous=document.querySelector('.actual-previous');const engine=area.swiper={initialized:true,destroyed:false,animating:false,activeIndex:0,realIndex:0,snapGrid:${options.allFit ? '[0]' : '[0,160,320]'},wrapperEl:track,slides:[...track.children],params:{loop:false,slidesPerGroup:1,autoplay:${options.autoplay ? '{delay:3000}' : 'false'},slideDuplicateClass:'product-copy',pagination:{el:pager,type:'${options.fraction ? 'fraction' : 'bullets'}',bulletActiveClass:'actual-active',currentClass:'actual-current'}},autoplay:{running:${!!options.autoplay}},pagination:{el:pager,bullets:[...pager.querySelectorAll('.actual-dot')]},navigation:${options.allFit ? '{}' : '{nextEl:next,prevEl:previous}'}};track.addEventListener('transitionend',event=>{if(event.propertyName==='transform')engine.animating=false});function move(delta){if(engine.animating)return;const current=Math.max(0,Math.min(2,engine.realIndex+delta));if(current===engine.realIndex)return;engine.realIndex=current;engine.activeIndex=current;engine.animating=true;track.style.transform='translateX('+(-current*160)+'px)';if(!${!!options.frozen}){engine.pagination.bullets.forEach((bullet,index)=>bullet.classList.toggle('actual-active',index===current));const fraction=pager.querySelector('.actual-current');if(fraction)fraction.textContent=String(current+1)}}next.addEventListener('click',()=>move(1));previous.addEventListener('click',()=>move(-1));})();</script>`;
}

test('actual product runtime references drive Woodmart arrows, WooCommerce identities and pagination without generic Swiper DOM', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const fraction of [false, true]) {
      const context = await createScopedContext(browser, 'http://127.0.0.1', undefined, { readOnly: true }), page = await context.newPage(); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.setContent(fixture({ fraction }));
      const result = await verifyProductCarouselInteractionV2(page.locator('[data-id="bbbbbbb"]'), { manual: true, pagination: fraction ? 'fraction' : 'bullets' }) as any;
      assert.equal(result.before.initialized, true); assert.equal(result.after.animating, false); assert.deepEqual(result.before.activeIds, [41]); assert.deepEqual(result.after.activeIds, [42]); assert.deepEqual(result.after.visibleIds, [42]); assert.deepEqual(result.restored.activeIds, [41]); assert.deepEqual(result.restored.visibleIds, [41]);
      assert.equal(result.beforePagination.logicalPage, 0); assert.equal(result.afterPagination.logicalPage, 1); assert.equal(result.restoredPagination.logicalPage, 0); assert.equal(result.restoredPosition, true); assert.equal(await page.locator('.swiper,.swiper-wrapper,.swiper-button-next').count(), 0);
      assert.equal(result.beforePagination.pageCount, 3);
      await context.close();
    }
  } finally { await browser.close(); }
});

test('frozen native product pagination fails despite real settled card movement, then restores the actual previous state', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await createScopedContext(browser, 'http://127.0.0.1', undefined, { readOnly: true }), page = await context.newPage(); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.setContent(fixture({ frozen: true }));
    await assert.rejects(verifyProductCarouselInteractionV2(page.locator('[data-id="bbbbbbb"]'), { manual: true }), (error: unknown) => {
      const failure = error as Error & { evidence: any }; assert.match(failure.message, /pagination did not synchronize/); assert.deepEqual(failure.evidence.after.activeIds, [42]); assert.equal(failure.evidence.after.animating, false); assert.equal(failure.evidence.afterPagination.active, 0); assert.equal(failure.evidence.cleanup.restored, true); assert.deepEqual(failure.evidence.cleanup.state.activeIds, [41]); return true;
    });
  } finally { await browser.close(); }
});

test('native product all-fit acceptance needs its explicit adaptation and manual autoplay remains actual runtime proof', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await createScopedContext(browser, 'http://127.0.0.1', undefined, { readOnly: true }), page = await context.newPage(); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.setContent(fixture({ allFit: true })); const widget = page.locator('[data-id="bbbbbbb"]');
    await assert.rejects(verifyProductCarouselInteractionV2(widget, { manual: true }), /no uniquely owned next and previous controls/);
    const explicit = await verifyProductCarouselInteractionV2(widget, { manual: true, allowAllFit: true }); assert.equal(explicit.allSlidesFit, true); assert.equal(explicit.movementRequired, false);
    await page.setContent(fixture({ autoplay: true })); await assert.rejects(verifyProductCarouselInteractionV2(widget, { manual: true }), /autoplay off/);
    await page.setContent(fixture({ unknownClone: true })); await assert.rejects(verifyProductCarouselInteractionV2(widget, { manual: true }), /original WooCommerce product identities/);
    await page.setContent(fixture({ extraBullet: true })); await assert.rejects(verifyProductCarouselInteractionV2(widget, { manual: true }), /pagination does not identify/);
  } finally { await browser.close(); }
});

test('product controller and failed restoration errors redact preview credentials before evidence can be persisted', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await createScopedContext(browser, 'http://127.0.0.1', undefined, { readOnly: true }), page = await context.newPage(); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.setContent(fixture());
    const widget = page.locator('[data-id="bbbbbbb"]'), originalLocator = widget.locator.bind(widget);
    (widget as unknown as { locator: (selector: string) => Locator }).locator = selector => {
      const control = originalLocator(selector);
      if (selector.endsWith('button:nth-of-type(1)')) control.click = async () => { throw new Error('Call log: waiting for https://target.example/?preview_nonce=private-preview-value&token=private-auth-value'); };
      return control;
    };
    await assert.rejects(verifyProductCarouselInteractionV2(widget, { manual: true }), (error: unknown) => {
      const failure = error as Error & { evidence: any }, serialized = failure.message + JSON.stringify(failure.evidence);
      assert.equal(failure.evidence.cleanup.restored, false); assert.doesNotMatch(serialized, /private-preview-value|private-auth-value/); assert.match(serialized, /REDACTED/); return true;
    });
  } finally { await browser.close(); }
});
