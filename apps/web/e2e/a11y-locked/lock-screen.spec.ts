/**
 * THE LOCK SCREEN PASSES THE ACCESSIBILITY CHECK (decision 12, "every page").
 *
 * The walk of every page (accessibility.spec.ts) runs with the site password
 * off, so the one screen a visitor to a passworded site sees first was never
 * checked. This turns the password on and checks it in each state it has:
 * bare; with the operator's name, paragraph and development badge, and the
 * doors a visitor may still open; with the badge's notice open; and after a
 * wrong password. Each at desktop and phone width.
 *
 * Runs alone (the `accessibility-behind-password` project), because the
 * password, the site's name and the development notice are the whole site's.
 * Everything is put back after.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { axe, describeViolation } from '../a11y.ts';
import { signedIn } from '../files/helpers.ts';
import { identityState } from '../identity/mail.ts';

test.describe.configure({ mode: 'serial' });

const BASE = 'http://127.0.0.1:4173';
const API = fileURLToPath(new URL('../../../api/', import.meta.url));
const devState = (...args: string[]) => {
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/filing/dev-state.ts', ...args], {
    cwd: API,
  });
};
const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;
const lockHeading = (page: Page) =>
  page.getByRole('heading', { level: 1, name: 'This site needs a password' });

const WIDTHS = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'phone', width: 412, height: 839 },
];

/** No violation at either width, named by state. */
async function checked(page: Page, state: string) {
  for (const size of WIDTHS) {
    await page.setViewportSize(size);
    const { violations } = await axe(page);
    expect(violations.map(describeViolation).join('\n\n'), `${state}, ${size.name}`).toBe('');
  }
}

let admin: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  // Its own administrator: the projects before this one rearrange the seats.
  const email = `a11y-locked-admin-${run()}@example.org`;
  identityState('seat', email, 'admin');
  admin = await signedIn(playwright, BASE, email);
});

test.afterAll(async () => {
  // Password off first: the settings routes are behind it.
  identityState('set-up');
  devState('outside', 'demo', 'closed');
  await admin.put('/api/admin/site/name', { data: { name: null } });
  await admin.put('/api/admin/site/copy/lock_intro', { data: { body: '' } });
  await admin.put('/api/admin/site/dev-mode', { data: { hours: null } });
  await admin.dispose();
});

test('the bare lock screen passes the accessibility check', async ({ page }) => {
  devState('curtain', `a11y-${run()}`);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(lockHeading(page)).toBeVisible();
  await expect(page.locator('[data-copy="lock_intro"]')).toHaveCount(0);
  await checked(page, 'bare');
});

test('the lock screen with everything an operator can put on it passes, and so does its notice', async ({
  page,
}) => {
  // Written while the password is off: the settings are behind it.
  identityState('set-up');
  expect((await admin.put('/api/admin/site/name', { data: { name: 'Harbour Watch' } })).ok()).toBe(
    true,
  );
  const intro = await admin.put('/api/admin/site/copy/lock_intro', {
    data: { body: 'Run by the harbour residents.\nAsk at the office for the password.' },
  });
  expect(intro.ok(), await intro.text()).toBe(true);
  expect((await admin.put('/api/admin/site/dev-mode', { data: { hours: 1 } })).ok()).toBe(true);
  devState('outside', 'demo', 'door');
  devState('curtain', `a11y-${run()}`);

  await page.goto('/board/', { waitUntil: 'networkidle' });
  await expect(lockHeading(page)).toBeVisible();
  await expect(page.getByText('Harbour Watch')).toBeVisible();
  await expect(page.locator('[data-copy="lock_intro"]')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Open without the password' }).getByRole('link'),
  ).not.toHaveCount(0);
  const badge = page.getByRole('button', { name: 'Under active development' });
  await expect(badge).toBeVisible();
  await checked(page, 'name, paragraph, doors and badge');

  await badge.click();
  await expect(
    page.getByRole('dialog', { name: 'This site is under active development' }),
  ).toBeVisible();
  await checked(page, 'the development notice open');
});

test('the lock screen after a wrong password passes the accessibility check', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(lockHeading(page)).toBeVisible();
  await page.getByLabel('Site password').fill('not the password');
  await page.getByRole('button', { name: 'Continue' }).click();
  // The refusal is on the screen before it is checked.
  await expect(page.getByRole('alert')).toContainText('That password is not right.');
  // Back on the field, to type it again.
  await expect(page.getByLabel('Site password')).toBeFocused();
  await checked(page, 'a wrong password');
});
