/**
 * The public board with the site password ON, walked in a browser.
 *
 * The board is never a door: while the site is locked, every board page is
 * the password screen and every board read is refused, even with a logbook
 * opened outside the password for filing. With the password, the same reader
 * walks the board, a report, the numbers and the press pack, and no page asks
 * another host for anything.
 *
 * Its own project, after the other password tests (playwright.config.ts):
 * the password is the whole site's, and two files turning it on and off would
 * collide.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { MODERATOR } from '../auth.ts';
import { countTo, identityState, lastMessageTo, linkIn } from '../identity/mail.ts';

test.describe.configure({ mode: 'serial' });

const API = fileURLToPath(new URL('../../../api/', import.meta.url));
function filingState(...args: string[]): void {
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/filing/dev-state.ts', ...args], {
    cwd: API,
  });
}

const BASE = 'http://127.0.0.1:4173';
const PASSWORD = `board-locked-${Date.now().toString(36)}`;
const word = `bl${Date.now().toString(36)}`;
let ref = '';

const lockHeading = (page: Page) =>
  page.getByRole('heading', { name: 'This site needs a password' });

/** A fresh visitor, with every board read and every outside request it makes written down. */
async function visitor(browser: Browser) {
  const context = await browser.newContext();
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
  // Filed by link and approved by a moderator through the real routes, while
  // the site is still open. A moderator, because the identity tests before
  // this take the administrators' seats away.
  const anon = await playwright.request.newContext({ baseURL: BASE });
  const mod = await playwright.request.newContext({ baseURL: BASE, storageState: MODERATOR });
  const email = `locked-${word}@example.org`;
  const card = (await (await anon.get('/api/publication-card')).json()) as { digest: string };
  const before = countTo(email);
  const sent = await anon.post('/api/reports', {
    data: {
      logbook: 'demo',
      email,
      consent: true,
      answers: { what: `Posters taped over the door of hall ${word}.` },
      may_publish: true,
      may_publish_digest: card.digest,
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  const token = /\/file\/confirm\/([a-f0-9]{64})/.exec(
    linkIn(await lastMessageTo(email, before)),
  )?.[1];
  const done = (await (await anon.post(`/api/reports/confirm/${token ?? ''}`)).json()) as {
    confirmation: { public_ref: string };
  };
  ref = done.confirmation.public_ref;
  const queue = (await (
    await mod.get(`/api/moderation/reports?status=pending&q=${word}`)
  ).json()) as { reports: { thread_id: string }[] };
  const ok = await mod.post(
    `/api/moderation/reports/${queue.reports[0]?.thread_id ?? ''}/decision`,
    { data: { status: 'valid', comment: 'Approved for the locked-board walk.' } },
  );
  expect(ok.ok(), await ok.text()).toBe(true);
  await anon.dispose();
  await mod.dispose();

  // The password on, and the demo logbook opened outside it, for filing only.
  filingState('outside', 'demo', 'door');
  filingState('curtain', PASSWORD);
});
test.afterAll(() => {
  filingState('outside', 'demo', 'closed');
  identityState('set-up');
});

test('locked: every board page is the password screen, and every board read is refused', async ({
  browser,
}) => {
  const v = await visitor(browser);
  for (const path of [
    '/board',
    `/board?q=${word}`,
    `/board/${ref}`,
    '/board/numbers',
    '/board/press',
  ]) {
    await v.page.goto(path);
    await expect(lockHeading(v.page)).toBeVisible();
    await expect(v.page.getByRole('heading', { name: 'Report board' })).toHaveCount(0);
    await expect(v.page.getByText(word)).toHaveCount(0);
  }
  // Whatever the page asked for while locked, it was refused.
  expect(v.reads.filter((r) => r.status !== 401)).toEqual([]);
  // And asked directly, the same.
  for (const url of [
    '/api/board',
    `/api/board/reports?q=${word}`,
    `/api/board/reports/${ref}`,
    '/api/board/stats',
    '/api/board/reports.csv',
    '/api/press',
    '/api/chain/demo',
    '/api/v1/stats',
  ]) {
    const res = await v.page.request.get(url);
    expect({ url, status: res.status() }).toEqual({ url, status: 401 });
    expect(await res.text()).not.toContain(word);
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
  await v.page.getByRole('button', { name: 'Enter' }).click();
  await expect(v.page.getByRole('heading', { level: 1, name: 'Report board' })).toBeVisible();

  await v.page.getByLabel('Search the words').fill(word);
  await v.page.getByRole('button', { name: 'Show reports' }).click();
  await expect(
    v.page.getByRole('status').filter({ hasText: '1 published report match' }),
  ).toBeVisible();
  await v.page.getByRole('link', { name: `Read ${ref} in full` }).click();
  await expect(v.page.getByRole('heading', { level: 1, name: `Report ${ref}` })).toBeVisible();
  await expect(v.page.getByRole('region', { name: 'What the reporter said' })).toContainText(word);

  await v.page.goto('/board');
  await v.page.getByRole('link', { name: 'By the numbers' }).click();
  await expect(v.page.getByRole('heading', { name: 'Every confirmed report' })).toBeVisible();
  await v.page.goto('/board');
  await v.page.getByRole('link', { name: 'Press pack' }).click();
  await expect(v.page.getByRole('heading', { level: 1, name: 'Press pack' })).toBeVisible();
  await expect(v.page.getByText('Nothing has been published here yet.')).toBeVisible();

  await expect(lockHeading(v.page)).toHaveCount(0);
  expect(v.outside).toEqual([]);
  await v.context.close();
});
