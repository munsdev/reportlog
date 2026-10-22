/**
 * Two walks that need reports to already exist, so they run after every other
 * project (playwright.config.ts) and file nothing: filing is limited per
 * address, and the whole suite shares one.
 *
 *   1. Severity and incidents on the moderation screen, as a moderator, on two
 *      reports nobody has rated or linked.
 *   2. The public board with the site password ON. The board is never a door:
 *      while the site is locked, every board page is the password screen and
 *      every board read is refused, even with a logbook opened outside the
 *      password for filing. With the password, the same reader walks the board,
 *      a report, the numbers and the press pack.
 *
 * No page asks another host for anything.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { MODERATOR } from '../auth.ts';
import { identityState } from '../identity/mail.ts';

test.describe.configure({ mode: 'serial' });

const API = fileURLToPath(new URL('../../../api/', import.meta.url));
function filingState(...args: string[]): void {
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/filing/dev-state.ts', ...args], {
    cwd: API,
  });
}

const BASE = 'http://127.0.0.1:4173';
const PASSWORD = `board-locked-${Date.now().toString(36)}`;
/** A report on the board, approved by the board tests that ran before this project. */
let ref = '';
/** Two reports in the queue that nobody has rated or linked. */
let first = '';
let second = '';

const lockHeading = (page: Page) =>
  page.getByRole('heading', { name: 'This site needs a password' });

/** A fresh visitor, with every board read and every outside request it makes written down. */
async function visitor(browser: Browser, storageState?: string) {
  const context = await browser.newContext(storageState ? { storageState } : {});
  const page = await context.newPage();
  const reads: { url: string; status: number }[] = [];
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  page.on('response', (r) => {
    const path = new URL(r.url()).pathname;
    if (/^\/api\/(board|press|chain|v1)\b/.test(path))
      reads.push({ url: path, status: r.status() });
  });
  return { context, page, reads, outside };
}

test.beforeAll(async ({ playwright }) => {
  // A moderator, because the identity tests before this take the
  // administrators' seats away.
  const anon = await playwright.request.newContext({ baseURL: BASE });
  const mod = await playwright.request.newContext({ baseURL: BASE, storageState: MODERATOR });
  const board = (await (await anon.get('/api/board/reports')).json()) as {
    reports?: { public_ref: string }[];
  };
  ref = board.reports?.[0]?.public_ref ?? '';
  expect(ref, 'an earlier project left a report on the board').not.toBe('');
  const queue = (await (await mod.get('/api/moderation/reports?status=pending')).json()) as {
    reports: { public_ref: string; severity: string | null; incident_size: number }[];
  };
  const fresh = queue.reports.filter((r) => r.severity === null && r.incident_size === 0);
  expect(fresh.length, 'two unrated reports are waiting').toBeGreaterThanOrEqual(2);
  first = fresh[0]?.public_ref ?? '';
  second = fresh[1]?.public_ref ?? '';
  await anon.dispose();
  await mod.dispose();
});
test.afterAll(() => {
  filingState('outside', 'demo', 'closed');
  identityState('set-up');
});

test('a moderator rates a report and links it to another; the queue says so', async ({
  browser,
}) => {
  const v = await visitor(browser, MODERATOR);
  const page = v.page;
  await page.goto(`/moderate?status=all&q=${first}`);
  await page.getByRole('link', { name: `Open ${first}` }).click();
  const severity = page.getByRole('region', { name: 'Severity' });
  await expect(severity).toContainText('Nobody has rated it yet.');
  // Nothing is preselected: saving is a deliberate act.
  await expect(severity.getByRole('button', { name: 'Record the rating' })).toBeDisabled();
  await severity.getByLabel('Rate it').selectOption('serious');
  await severity.getByLabel('Why this rating').fill('People were shut out of the hall.');
  await severity.getByRole('button', { name: 'Record the rating' }).click();
  await expect(severity).toContainText('Rated Serious');

  const incident = page.getByRole('region', { name: 'Same incident' });
  await expect(incident).toContainText('Not linked to any other report.');
  await incident.getByLabel('Link it to').fill(second);
  await incident.getByLabel('Why they are the same incident').fill('Same hall, same morning.');
  await incident.getByRole('button', { name: 'Link them' }).click();
  await expect(incident.getByRole('list', { name: 'Linked reports' })).toContainText(second);
  // Both are waiting for a moderator, so neither counts as corroboration yet.
  await expect(incident).toContainText('0 of the 2 accounts are published');
  await expect(page.getByRole('region', { name: 'What happened to it' })).toContainText(
    'Rated its severity: serious',
  );

  await page.goto('/moderate');
  await page.getByLabel('Showing').selectOption('all');
  await page.getByLabel('Severity').selectOption('serious');
  await page.getByLabel('Search the words or a reference').fill(first);
  await page.getByRole('button', { name: 'Show' }).click();
  const row = page.getByRole('link', { name: `Open ${first}` });
  await expect(row).toContainText('Severity: Serious');
  await expect(row).toContainText('Linked with 1 other report · 0 of the 2 published');
  // The other one is linked but not rated, so a filter on the rating leaves it out.
  await page.getByLabel('Search the words or a reference').fill(second);
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Nothing here.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Corroboration' })).toContainText(
    'Accounts corroborated by at least one other',
  );
  expect(v.outside).toEqual([]);
  await v.context.close();
});

test('locked: every board page is the password screen, and every board read is refused', async ({
  browser,
}) => {
  // The password on, and the demo logbook opened outside it, for filing only.
  filingState('outside', 'demo', 'door');
  filingState('curtain', PASSWORD);
  const v = await visitor(browser);
  for (const path of [
    '/board',
    `/board?q=${ref}`,
    `/board/${ref}`,
    '/board/numbers',
    '/board/press',
  ]) {
    await v.page.goto(path);
    await expect(lockHeading(v.page)).toBeVisible();
    await expect(v.page.getByRole('heading', { name: 'Live report board' })).toHaveCount(0);
    await expect(v.page.getByText(ref)).toHaveCount(0);
  }
  // Whatever the page asked for while locked, it was refused.
  expect(v.reads.filter((r) => r.status !== 401)).toEqual([]);
  // And asked directly, the same.
  for (const url of [
    '/api/board',
    `/api/board/reports?q=${ref}`,
    `/api/board/reports/${ref}`,
    '/api/board/stats',
    '/api/board/reports.csv',
    '/api/press',
    '/api/chain/demo',
    '/api/v1/stats',
    // Behind the password until the owner decides otherwise (parity §8 item 2).
    '/api/v1',
    '/api/v1/consent-texts',
  ]) {
    const res = await v.page.request.get(url);
    expect({ url, status: res.status() }).toEqual({ url, status: 401 });
    expect(await res.text()).not.toContain(ref);
  }
  expect(v.outside).toEqual([]);
  await v.context.close();
});

test('the door is for filing only: the demo logbook opens, the board beside it does not', async ({
  browser,
}) => {
  const v = await visitor(browser);
  await v.page.goto('/file/demo');
  await expect(lockHeading(v.page)).toHaveCount(0);
  await v.page.goto('/board');
  await expect(lockHeading(v.page)).toBeVisible();
  expect(v.reads.filter((r) => r.status !== 401)).toEqual([]);
  await v.context.close();
});

test('with the password, a reader walks the board, a report, the numbers and the press pack', async ({
  browser,
}) => {
  const v = await visitor(browser);
  await v.page.goto('/board');
  await expect(lockHeading(v.page)).toBeVisible();
  await v.page.getByLabel('Site password').fill(PASSWORD);
  await v.page.getByRole('button', { name: 'Continue' }).click();
  await expect(v.page.getByRole('heading', { level: 1, name: 'Live report board' })).toBeVisible();

  await v.page.getByLabel('Search the words').fill(ref);
  await v.page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(v.page.getByRole('status').filter({ hasText: /^1 report\b/ })).toBeVisible();
  await v.page.getByRole('link', { name: `Read in full: ${ref}` }).click();
  await expect(v.page.getByRole('heading', { level: 1, name: ref })).toBeVisible();
  await expect(v.page.getByRole('region', { name: 'What the reporter said' })).toBeVisible();

  await v.page.goto('/board');
  await v.page.getByRole('link', { name: 'By the numbers' }).click();
  await expect(v.page.getByRole('heading', { level: 1, name: 'By the numbers' })).toBeVisible();
  await v.page.goto('/board');
  await v.page.getByRole('link', { name: 'Press pack' }).click();
  await expect(v.page.getByRole('heading', { level: 1, name: 'Press pack' })).toBeVisible();
  await expect(v.page.getByText('Nothing has been published here yet.')).toBeVisible();

  await expect(lockHeading(v.page)).toHaveCount(0);
  expect(v.outside).toEqual([]);
  await v.context.close();
});
