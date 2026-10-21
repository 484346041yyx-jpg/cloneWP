import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { verifyInteractionV2 } from '../src/replica-v2/verify.js';

test('native disclosure verifies exact owned copy and destination only after actual opening, then restores on success or failure', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const markup = (hidden = false) => `<details id="menu"><summary>Shop</summary><span class="outside">Dog</span><div class="mega"><strong><span class="category"${hidden ? ' style="display:none"' : ''}>Dog</span></strong><a class="track" href="https://source.example/order/">Track My Order</a></div></details><p id="foreign">Dog</p>`;
    const expected = { target: '.mega', initialOpen: false, ownedContent: [{ selector: ':scope .mega .category', text: 'Dog' }, { selector: ':scope .mega .track', text: 'Track My Order', href: 'https://source.example/order/' }] };
    await page.setContent(markup());
    const receipt = await verifyInteractionV2(page, '#menu', 'disclosure', expected) as any;
    assert.equal(receipt.before.open, false); assert.equal(receipt.after.open, true); assert.equal(receipt.restored.open, false);
    assert.equal(await page.locator('#menu').evaluate(node => (node as HTMLDetailsElement).open), false);
    for (const bad of [
      { expected: { ...expected, ownedContent: [{ selector: ':scope .mega .category', text: 'Cat' }] }, hidden: false },
      { expected: { ...expected, ownedContent: [{ selector: ':scope .mega .track', text: 'Track My Order', href: 'https://source.example/wrong/' }] }, hidden: false },
      { expected, hidden: true },
      { expected: { ...expected, ownedContent: [{ selector: ':scope .outside', text: 'Dog' }] }, hidden: false },
    ]) {
      await page.setContent(markup(bad.hidden));
      await assert.rejects(() => verifyInteractionV2(page, '#menu', 'disclosure', bad.expected));
      assert.equal(await page.locator('#menu').evaluate(node => (node as HTMLDetailsElement).open), false, 'failed content verification must restore the real disclosure state');
    }
  } finally { await browser.close(); }
});
