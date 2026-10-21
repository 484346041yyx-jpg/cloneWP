import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { observeSourceReadiness } from '../src/reference/readiness.js';

test('readiness observes >=600ms of actual frames and catches debounced card-width changes with constant page height', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent('<style>body{margin:0;height:600px}.track{display:flex;height:100px;overflow:hidden}.card{width:200px;flex-shrink:0}</style><main><div class="track"><article class="card"><a href="#">One</a></article><article class="card"><a href="#">Two</a></article></div></main>');
    await page.evaluate(() => { setTimeout(() => { document.querySelectorAll<HTMLElement>('.card').forEach(card => card.style.width = '125px'); }, 400); });
    const result = await observeSourceReadiness(page, { stableMs: 600, timeoutMs: 2500 });
    assert.equal(result.passed, true); assert.ok(result.elapsedMs >= 950, JSON.stringify(result));
    assert.ok(result.stableForMs >= 600); assert.ok(result.sampledFrames > 2); assert.ok(result.observedComponents > 0);
    assert.equal(await page.locator('.card').first().evaluate(element => element.getBoundingClientRect().width), 125);
  } finally { await browser.close(); }
});

test('continuously moving item bounds time out with a named layout gap even when document dimensions are stable', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<style>body{height:600px}.track{display:flex;height:100px}.card{width:100px;flex-shrink:0}</style><main><div class="track"><article class="card"><a href="#">One</a></article><article class="card"><a href="#">Two</a></article></div></main>');
    await page.evaluate(() => { let width = 100; setInterval(() => { width = width === 100 ? 101 : 100; document.querySelectorAll<HTMLElement>('.card').forEach(card => card.style.width = `${width}px`); }, 100); });
    const result = await observeSourceReadiness(page, { stableMs: 600, timeoutMs: 900 });
    assert.equal(result.passed, false); assert.equal(result.status, 'partial');
    assert.ok(result.gaps.some(gap => gap.code === 'source-layout-not-stable'));
  } finally { await browser.close(); }
});

test('failed visible images and bounded DOM scanning remain named gaps, never a readiness pass', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><img width="100" height="100" src="data:image/png;base64,broken"><div><article><a href="#">One</a></article><article><a href="#">Two</a></article></div></main>');
    const result = await observeSourceReadiness(page, { stableMs: 600, timeoutMs: 750, maxScanNodes: 1 });
    assert.equal(result.passed, false);
    assert.ok(result.gaps.some(gap => gap.code === 'source-images-not-ready'));
    assert.ok(result.gaps.some(gap => gap.code === 'source-readiness-scan-limit'));
    await assert.rejects(observeSourceReadiness(page, { stableMs: 599 }), /at least 600ms/);
  } finally { await browser.close(); }
});

test('subpixel drift accumulates across the observation window instead of passing frame-to-frame tolerance', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><div class="track" style="display:flex;height:100px"><article class="card" style="width:100px"><a href="#">One</a></article><article class="card" style="width:100px"><a href="#">Two</a></article></div></main>');
    await page.evaluate(() => { let position = 0; setInterval(() => { position += .1; document.querySelector<HTMLElement>('.track')!.style.transform = `translateX(${position}px)`; }, 20); });
    const result = await observeSourceReadiness(page, { stableMs: 600, timeoutMs: 900, tolerancePx: .25 });
    assert.equal(result.passed, false); assert.ok(result.gaps.some(gap => gap.code === 'source-layout-not-stable'));
  } finally { await browser.close(); }
});
