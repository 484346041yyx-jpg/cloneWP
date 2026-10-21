import type { BrowserContext, Page, Response } from 'playwright';

export const PUBLIC_PAGE_OPEN_BUDGET_MS = 180_000;
export const PUBLIC_PAGE_OPEN_STAGGER_MS = 15_000;
export const PUBLIC_PAGE_OPEN_MAX_CANDIDATES = 3;

export interface OpenReadOnlyPageOptions {
  maxCandidates?: number;
  staggerMs?: number;
  budgetMs?: number;
  /** A caller may require a specific page root, rather than treating any body as success. */
  ready?: (page: Page) => Promise<boolean>;
}

function sameDocument(actual: string, expected: URL): boolean {
  try {
    const url = new URL(actual);
    return url.origin === expected.origin && url.pathname === expected.pathname && url.search === expected.search;
  } catch { return false; }
}

/** Race only read-only browser pages. The caller owns the returned page; every loser is closed here. */
export async function openReadOnlyPage(context: BrowserContext, url: string, options: OpenReadOnlyPageOptions = {}): Promise<{ page: Page; attempts: number; status: number | null }> {
  const expected = new URL(url);
  if (!['http:', 'https:'].includes(expected.protocol) || expected.username || expected.password) throw Error('public_page_open_url_invalid');
  const maxCandidates = options.maxCandidates ?? PUBLIC_PAGE_OPEN_MAX_CANDIDATES;
  const staggerMs = options.staggerMs ?? PUBLIC_PAGE_OPEN_STAGGER_MS;
  const budgetMs = options.budgetMs ?? PUBLIC_PAGE_OPEN_BUDGET_MS;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > PUBLIC_PAGE_OPEN_MAX_CANDIDATES
    || !Number.isInteger(staggerMs) || staggerMs < 0 || !Number.isInteger(budgetMs) || budgetMs < 1) throw Error('public_page_open_options_invalid');
  const started = performance.now();
  const pages = new Set<Page>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const wait = (ms: number): Promise<void> => new Promise(resolve => {
    const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms);
    timers.add(timer);
  });
  const cancelWaits = () => { for (const timer of timers) clearTimeout(timer); timers.clear(); };
  let finished = false;
  let attempts = 0;
  const workers = Array.from({ length: maxCandidates }, async (_, index) => {
    if (index) await wait(staggerMs * index);
    if (finished || performance.now() - started >= budgetMs) throw Error('public_page_open_superseded');
    const page = await context.newPage();
    pages.add(page);
    if (finished) { await page.close().catch(() => undefined); throw Error('public_page_open_superseded'); }
    attempts++;
    const remaining = Math.max(1, Math.floor(budgetMs - (performance.now() - started)));
    try {
      const response: Response | null = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: remaining });
      if (!sameDocument(page.url(), expected) || !response || response.status() >= 400) throw Error('public_page_open_wrong_document');
      const body = page.locator('body');
      await body.waitFor({ state: 'attached', timeout: Math.min(10_000, Math.max(1, Math.floor(budgetMs - (performance.now() - started)))) });
      const text = (await body.innerText({ timeout: Math.min(5_000, Math.max(1, Math.floor(budgetMs - (performance.now() - started)))) })).slice(0, 1000);
      const title = await page.title();
      if (/just a moment|checking your browser|access denied|verify (?:that )?you are human|captcha/i.test(`${title} ${text}`) && text.length < 800
        || await page.locator('#loginform, input[name="log"]').count() > 0) throw Error('public_page_open_access_required');
      if (options.ready && !await options.ready(page)) throw Error('public_page_open_not_ready');
      if (finished) throw Error('public_page_open_superseded');
      return { page, status: response.status() };
    } catch (error) {
      await page.close().catch(() => undefined);
      throw error;
    }
  });
  const deadline = wait(budgetMs).then((): never => { throw Error('public_page_open_budget_exhausted'); });
  try {
    const winner = await Promise.race([Promise.any(workers), deadline]);
    finished = true;
    cancelWaits();
    await Promise.allSettled([...pages].filter(page => page !== winner.page).map(page => page.close()));
    return { ...winner, attempts };
  } catch (error) {
    finished = true;
    cancelWaits();
    await Promise.allSettled([...pages].map(page => page.close()));
    if (error instanceof AggregateError && error.errors.some(item => item instanceof Error && item.message === 'public_page_open_access_required')) throw Error('public_page_open_access_required');
    throw Error(error instanceof Error && error.message === 'public_page_open_budget_exhausted' ? error.message : 'public_page_open_failed_after_bounded_candidates');
  }
}
