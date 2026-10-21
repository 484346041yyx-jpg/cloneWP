import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { editCodeV2, beginEditorAttemptV2, persistEditorAttemptV2, type EditorReceiptV2 } from '../src/replica-v2/editor.js';
import { hashV2 } from '../src/replica-v2/journal.js';

/** The real target diagnostic proves Ace uses its two-space Tab command, not blur.
 * This local browser fixture reproduces its proxy-input/change contract without target access. */
test('HTML code input keeps trusted editor entry and exact model acknowledgment without Ace Tab indentation', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), original = 'x'.repeat(44512), expected = original + '<!-- unsaved diagnostic -->';
    await page.setContent(`<div id="elementor-panel"><h2 id="elementor-panel-header-title">Edit HTML</h2><div class="elementor-control-html"><textarea data-setting="html" style="display:none"></textarea><pre class="ace_editor" style="width:260px;height:200px;border:1px solid"><textarea class="ace_text-input" style="width:2px;height:1px;opacity:0"></textarea></pre></div><button id="save">Save</button></div><script>
      const editor=document.querySelector('.ace_editor'),proxy=document.querySelector('.ace_text-input');let documentValue=${JSON.stringify(original)},selected=false,saves=0;
      window.elementor={getContainer:()=>({settings:{get:key=>key==='html'?documentValue:undefined}})};editor.env={editor:{getValue:()=>documentValue}};
      editor.addEventListener('click',()=>proxy.focus());proxy.addEventListener('keydown',event=>{if(event.ctrlKey&&event.key.toLowerCase()==='a'){selected=true;event.preventDefault()}if(event.key==='Tab'){documentValue+='  ';proxy.value='  ';event.preventDefault()}});
      proxy.addEventListener('input',event=>{documentValue=(selected?'':documentValue)+(event.data??proxy.value);selected=false;proxy.value=''});document.querySelector('#save').onclick=()=>saves++;
      window.sample=()=>({model:elementor.getContainer().settings.get('html'),ace:editor.env.editor.getValue(),saves,active:document.activeElement.className});
    </script>`);
    assert.equal(expected.length, 44539);
    await editCodeV2(page, expected); await page.waitForFunction(value => (window as any).elementor.getContainer().settings.get('html') === value, expected, { timeout: 15_000 });
    const exact = await page.evaluate(() => (window as any).sample()); assert.equal(exact.model, expected); assert.equal(exact.ace, expected); assert.equal(exact.active, 'ace_text-input'); assert.equal(exact.saves, 0);
    await page.keyboard.press('Tab'); const oldBehavior = await page.evaluate(() => (window as any).sample()); assert.equal(oldBehavior.model.length, 44541); assert.equal(oldBehavior.model, expected + '  '); assert.notEqual(oldBehavior.model, expected);
    await editCodeV2(page, expected); const corrected = await page.evaluate(() => (window as any).sample()); assert.equal(corrected.model, expected); assert.equal(corrected.ace, expected); assert.equal(corrected.saves, 0);
  } finally { await browser.close(); }
});

test('a genuine plain HTML textarea still commits through its normal input and blur change events', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent('<div id="elementor-panel"><textarea data-setting="html">Before</textarea><button>Next field</button></div><script>window.model="Before";document.querySelector("textarea").addEventListener("change",event=>window.model=event.target.value)</script>');
    const value = '<p>Exact HTML &amp; text</p>\n'; await editCodeV2(page, value); assert.equal(await page.evaluate(() => (window as any).model), value);
  } finally { await browser.close(); }
});

const receipt = (passed = false): EditorReceiptV2 => ({ version: 2, passed, editorSessions: 1, editorLoads: 1, browserRequests: 679, pages: 2, sections: [{ key: 'header', elementId: 'aaaaaaa', selected: true, controls: ['html'] }], checks: [{ group: 'html-code', componentKey: 'header', elementId: 'bbbbbbb', selected: true, changed: true, saved: passed, frontendConfirmed: passed, restored: true }], restorePending: false, ...(passed ? { finalHash: '1'.repeat(64) } : { error: 'Exact model acknowledgment timed out' }) });
const base = 'D:/cloneWP/.cache/replica-v2-editor-attempt-tests';
async function temporary() { await mkdir(base, { recursive: true }); return mkdtemp(path.join(base, 'run-')); }

test('editor attempts preserve legacy failure bytes, separate screenshots, and keep one compatible same-byte latest alias', async () => {
  const run = await temporary();
  try {
    const root = path.join(run, 'verification', 'editor-v2'); await mkdir(root, { recursive: true }); const legacy = Buffer.from(JSON.stringify(receipt()) + '\r\n'); await writeFile(path.join(root, 'receipt.json'), legacy); await writeFile(path.join(root, 'old-screenshot.png'), 'legacy pixels');
    const first = await beginEditorAttemptV2(run, '1'.repeat(64)), firstReport = receipt(); await writeFile(path.join(first.directory, 'html-code.png'), 'failed attempt pixels'); await persistEditorAttemptV2(first, firstReport);
    const old = await readFile(path.join(root, 'history', hashV2(legacy), 'receipt.json')); assert.deepEqual(old, legacy); const firstBytes = await readFile(first.reportPath); assert.deepEqual(await readFile(path.join(root, 'receipt.json')), firstBytes); assert.equal(firstReport.reportPath, first.reportPath);
    const second = await beginEditorAttemptV2(run, '1'.repeat(64)), secondReport = receipt(true); await writeFile(path.join(second.directory, 'html-code.png'), 'successful attempt pixels'); await persistEditorAttemptV2(second, secondReport);
    assert.notEqual(first.id, second.id); assert.deepEqual(await readFile(first.reportPath), firstBytes); assert.deepEqual(await readFile(path.join(root, 'receipt.json')), await readFile(second.reportPath)); assert.equal(JSON.parse(firstBytes.toString()).passed, false); assert.equal(JSON.parse(await readFile(second.reportPath, 'utf8')).passed, true);
    assert.equal(await readFile(path.join(first.directory, 'html-code.png'), 'utf8'), 'failed attempt pixels'); assert.equal(await readFile(path.join(root, 'old-screenshot.png'), 'utf8'), 'legacy pixels'); assert.equal((await readdir(path.join(root, 'attempts'))).length, 2);
    await assert.rejects(persistEditorAttemptV2(first, receipt(true)), /EEXIST/); assert.deepEqual(await readFile(first.reportPath), firstBytes); assert.deepEqual(await readFile(path.join(root, 'history', hashV2(legacy), 'receipt.json')), legacy);
  } finally { await rm(run, { recursive: true, force: true }); }
});

test('editor receipt alias refuses concurrent third-state content while retaining both original failed and new immutable attempts', async () => {
  const run = await temporary();
  try {
    const first = await beginEditorAttemptV2(run, '1'.repeat(64)); await persistEditorAttemptV2(first, receipt()); const firstBytes = await readFile(first.reportPath), second = await beginEditorAttemptV2(run, '1'.repeat(64)), concurrent = Buffer.from(JSON.stringify({ ...receipt(), error: 'Independent receipt' })); await writeFile(second.latestPath, concurrent);
    await assert.rejects(persistEditorAttemptV2(second, receipt(true)), /changed concurrently/); assert.deepEqual(await readFile(second.latestPath), concurrent); assert.deepEqual(await readFile(first.reportPath), firstBytes); assert.equal(JSON.parse(await readFile(second.reportPath, 'utf8')).passed, true);
  } finally { await rm(run, { recursive: true, force: true }); }
});
