import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

test('bounded scene-only observations avoid full paint export on large pages and disclose untouched regions',async context=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),expression=await readFile(new URL('../src/reference/collect-blocks.browser.js',import.meta.url),'utf8');
    const cards=Array.from({length:24},(_,i)=>'<article><a href="/item'+i+'"><div><span>Item '+i+'</span></div></a><div><span>$24</span></div></article>').join('');
    await page.setContent('<style>main{max-width:1200px;margin:auto}section{padding:10px}.rail{display:flex;width:900px;overflow-x:auto}article{min-width:200px;height:100px}button{width:40px;height:30px}</style><header><button>Shop</button></header><main>'+Array.from({length:24},(_,i)=>'<section id="section'+i+'"><h2>Section '+i+'</h2><div id="rail'+i+'" class="rail">'+cards+'</div><button aria-label="Next slide" aria-controls="rail'+i+'">›</button></section>').join('')+'</main><footer>Footer</footer>');
    const fast=await page.evaluate('(() => {const start=performance.now(),result=('+expression+')({sceneOnly:true,includeNodes:false,maxSceneNodes:600});return {elapsed:performance.now()-start,result};})()') as {elapsed:number;result:{sourceScene:{items:Array<{kind:string}>;gaps:Array<{code:string}>};observedNodes?:unknown[];blocks:unknown[]}};
    const scoped=await page.evaluate('(() => {const start=performance.now(),result=('+expression+')({sceneOnly:true,includeNodes:false,maxSceneNodes:600,sceneScope:"#section23"});return {elapsed:performance.now()-start,result};})()') as typeof fast;
    assert.equal(fast.result.observedNodes,undefined);assert.ok(fast.result.blocks.length>=24);assert.ok(fast.result.sourceScene.gaps.some(gap=>gap.code==='scene-node-limit'));assert.ok(scoped.result.sourceScene.gaps.some(gap=>gap.code==='scene-scoped-observation'));assert.equal(scoped.result.sourceScene.gaps.some(gap=>gap.code==='scene-node-limit'),false);assert.ok(scoped.result.sourceScene.items.some(item=>item.kind==='control'));
    context.diagnostic('Local Chromium large fixture: bounded global scene '+Math.round(fast.elapsed)+' ms; scoped scene '+Math.round(scoped.elapsed)+' ms. This is a local capture microbenchmark, not end-to-end production speed.');
  }finally{await browser.close();}
});
