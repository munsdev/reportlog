/**
 * The owner's backups and exports (decision 10), as the owner uses them: open
 * the screen, make an export and a backup, download each, and find the
 * download in the audit trail. And an administrator who is not the owner is
 * turned away, and the page asks nobody else for anything.
 *
 * Its own project, last: it hands the owner's seat to a test address
 * (apps/api/src/anchor/dev-owner.ts) and gives it back afterwards.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Browser, BrowserContext } from '@playwright/test';
import { codeIn, countTo, identityState, lastMessageTo } from '../identity/mail.ts';
import { passSecondFactor, stepUp } from '../second-factor.ts';

const API = fileURLToPath(new URL('../../../api/', import.meta.url));
const run = Date.now().toString(36);
const OWNER = `e2e-owner-${run}@example.org`;
const ADMIN = `e2e-copies-admin-${run}@example.org`;
let previous = '-';

function ownerSeat(...args: string[]): string {
  return execFileSync(
    'node',
    ['--env-file-if-exists=../../.env', 'src/anchor/dev-owner.ts', ...args],
    { cwd: API, encoding: 'utf8' },
  ).trim();
}

async function signIn(request: APIRequestContext, email: string) {
  const before = countTo(email);
  const asked = await request.post('/api/auth/code', { data: { email } });
  expect(asked.ok(), await asked.text()).toBe(true);
  const code = codeIn(await lastMessageTo(email, before));
  const signed = await request.post('/api/auth/sign-in', { data: { email, code } });
  expect(signed.ok(), await signed.text()).toBe(true);
  await passSecondFactor(request, email);
}

async function contextFor(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext({ acceptDownloads: true });
  await signIn(context.request, email);
  return context;
}

test.beforeAll(() => {
  previous = ownerSeat('take', OWNER);
  identityState('seat', ADMIN, 'admin');
});
test.afterAll(() => {
  ownerSeat('give-back', previous, OWNER);
});

test('the owner makes an export and downloads it, and the trail says so', async ({ browser }) => {
  const context = await contextFor(browser, OWNER);
  const page = await context.newPage();
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });

  await page.goto('/');
  await page.getByRole('link', { name: 'Backups and exports' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Backups and exports' })).toBeVisible();
  await expect(page.getByText(/Every download is recorded/)).toBeVisible();

  // Making and downloading copies ask for a step-up (plan E, E3).
  await stepUp(page.request);
  await page.getByRole('button', { name: 'Make an export' }).click();
  await expect(page.getByText('The export is ready')).toBeVisible({ timeout: 60_000 });
  const link = page.getByRole('link', { name: /^Download reportlog-archive-/ }).first();
  const name = ((await link.textContent()) ?? '').replace(/^Download\s*/, '').trim();
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(download.suggestedFilename()).toBe(name);
  const file = JSON.parse(readFileSync((await download.path()) || '', 'utf8')) as {
    reportlog_archive: number;
    reports: unknown[];
  };
  expect(file.reportlog_archive).toBe(1);
  expect(file.reports.length).toBeGreaterThan(0);

  await page.goto('/access/audit');
  await expect(page.getByText(`downloaded the archive export ${name}`)).toBeVisible();
  expect(outside).toEqual([]);
  await context.close();
});

test('the owner takes a backup and downloads the dump', async ({ browser }) => {
  const context = await contextFor(browser, OWNER);
  const page = await context.newPage();
  await page.goto('/backups');
  await stepUp(page.request);
  await page.getByRole('button', { name: 'Take a backup now' }).click();
  await expect(page.getByText('The backup is ready')).toBeVisible({ timeout: 60_000 });
  const link = page.getByRole('link', { name: /^Download reportlog-.*\.dump$/ }).first();
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  // pg_dump's custom format begins with its own signature.
  const bytes = readFileSync((await download.path()) || '');
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('PGDMP');
  await context.close();
});

test('an administrator who is not the owner is turned away, by the page and the server', async ({
  browser,
}) => {
  const context = await contextFor(browser, ADMIN);
  const page = await context.newPage();
  await page.goto('/backups');
  await expect(page.getByRole('heading', { name: 'Not for this account' })).toBeVisible();
  await expect(page.getByText('Only the owner can open this page.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Backups and exports' })).toHaveCount(0);
  expect((await context.request.get('/api/admin/copies')).status()).toBe(403);
  await context.close();
});
