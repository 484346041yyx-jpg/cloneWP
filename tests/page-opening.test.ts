import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { openReadOnlyPage } from '../src/verification/page-opening.js';

const browserOptions = existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' };

test('a later healthy read-only page wins and every losing owned tab is closed', async () => {
  const browser = await chromium.launch(browserOptions);
  try {
    const context = await browser.newContext();
    let requests = 0;
    await context.route('https://reference.example/shop/', route => {
      requests++;
      return route.fulfill({ status: requests === 1 ? 503 : 200, contentType: 'text/html', body: requests === 1 ? 'Unavailable' : '<main>Actual reference page</main>' });
    });
    const result = await openReadOnlyPage(context, 'https://reference.example/shop/', { staggerMs: 10, budgetMs: 3000 });
    assert.ok(result.attempts >= 2 && result.attempts <= 3);
    assert.equal(await result.page.locator('main').innerText(), 'Actual reference page');
    assert.deepEqual(context.pages(), [result.page]);
  } finally { await browser.close(); }
});

test('read-only opening rejects a login redirect and exhausts bounded candidates', async () => {
  const browser = await chromium.launch(browserOptions);
  try {
    const context = await browser.newContext();
    await context.route('https://target.example/**', route => route.request().url().endsWith('/preview/')
      ? route.fulfill({ status: 302, headers: { location: '/wp-login.php' }, body: '' })
      : route.fulfill({ status: 200, contentType: 'text/html', body: 'Login' }));
    await assert.rejects(openReadOnlyPage(context, 'https://target.example/preview/', {
      maxCandidates: 2, staggerMs: 10, budgetMs: 2000,
    }), /bounded_candidates|budget_exhausted/);
    assert.equal(context.pages().length, 0);
  } finally { await browser.close(); }
});
