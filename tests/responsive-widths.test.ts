import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { discoverResponsiveWidths, observeLoadedWidths, planResponsiveWidths } from '../src/reference/responsive.js';

test('responsive discovery retains inactive and range-syntax CSS widths while reporting inaccessible CSS and container queries',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.route('https://unavailable-css.example/**',route=>route.fulfill({contentType:'text/css',body:'@media(max-width:1234px){body{color:red}}'}));
    await page.setContent('<!doctype html><link rel="stylesheet" href="https://unavailable-css.example/third-party.css"><style>@media(max-width:767px){.x{display:none}}@media(900px < width < 1200px){.x{display:block}}@media(min-width:40em){.y{display:block}}@container(width > 400px){.z{display:none}}</style><main class="x">Public responsive evidence</main>');
    await page.waitForLoadState('load');await page.evaluate('globalThis.__name=target=>target');
    const result=await discoverResponsiveWidths(page);
    assert.deepEqual(result.breakpoints,[767,900,1200]);assert.ok(result.conditions.some(condition=>!condition.matches&&condition.widthBreakpoints.includes(900)));
    assert.ok(result.gaps.some(gap=>gap.includes('inaccessible')));assert.ok(result.gaps.some(gap=>gap.includes('unsupported unit')));assert.ok(result.gaps.some(gap=>gap.includes('Container-query')));
    assert.ok(!result.breakpoints.includes(1234),'inaccessible stylesheet rules must not be invented from its network URL');
    const bounded=await discoverResponsiveWidths(page,{maxRules:1});assert.ok(bounded.gaps.some(gap=>gap.includes('bounded limit')));
  }finally{await browser.close();}
});

test('responsive planning adds complete nearest boundary bundles and discloses omitted breakpoints under its eight-width budget',()=>{
  const plan=planResponsiveWidths({breakpoints:[767,900,1024,767]},{currentWidth:390});
  assert.deepEqual(plan.widths,[360,390,430,766,767,768]);assert.deepEqual(plan.selectedBreakpoints,[767]);assert.deepEqual(plan.omittedBreakpoints,[900,1024]);
  const fractional=planResponsiveWidths({breakpoints:[400.5,767]},{currentWidth:390});
  assert.deepEqual(fractional.widths,[360,390,430,400,401,766,767,768]);assert.equal(fractional.widths.length,8);
  assert.throws(()=>planResponsiveWidths({breakpoints:[]},{currentWidth:390,baseWidths:[NaN]}),/bounded integer/);
});

test('loaded-width measurement preserves the actual touch/DPR context and restores viewport after a callback failure without navigation',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
    await context.addInitScript('globalThis.__name=target=>target');const page=await context.newPage();
    await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main style="min-height:2000px">Touch evidence</main>');await page.evaluate('globalThis.__name=target=>target');
    let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
    const rows=await observeLoadedWidths(page,[360,390,430],async page=>page.locator('main').innerText());
    assert.deepEqual(rows.map(row=>row.facts.innerWidth),[360,390,430]);assert.ok(rows.every(row=>row.facts.touch&&row.facts.coarsePointer&&row.facts.devicePixelRatio===2));assert.equal(navigations,0);
    await assert.rejects(observeLoadedWidths(page,[360],async()=>{throw new Error('Actual measurement failed');}),/Actual measurement failed/);
    assert.equal(page.viewportSize()?.width,390);
    await context.close();
  }finally{await browser.close();}
});
