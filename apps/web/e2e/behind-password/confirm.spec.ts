/**
 * Filing and confirming with the site password ON, for a logbook opened
 * outside it: the case where the confirmation link is the only way back in,
 * and a link that sent the reporter to the password screen would lose their
 * report.
 *
 * The reporter never has the password. The link is read out of the email
 * the server wrote, and followed in a fresh browser.
 *
 * Runs alone, after the identity tests (the `behind-password` project),
 * because the password is the whole site's.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { countTo, identityState, lastMessageTo, linkIn } from '../identity/mail.ts';

test.describe.configure({ mode: 'serial' });

const API = fileURLToPath(new URL('../../../api/', import.meta.url));
function filingState(...args: string[]): void {
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/filing/dev-state.ts', ...args], {
    cwd: API,
  });
}

const lockHeading = (page: Page) =>
  page.getByRole('heading', { name: 'This site needs a password' });
const heading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });

async function fresh(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test.beforeAll(() => {
  // The seed's demo logbook, opened by link only, behind a password.
  filingState('outside', 'demo', 'link');
  filingState('curtain', `filing-door-${String(Date.now())}`);
});
test.afterAll(() => {
  filingState('outside', 'demo', 'closed');
  identityState('set-up');
});

test('a reporter without the password files, and confirms from the email', async ({ browser }) => {
  const { context, page } = await fresh(browser);
  // The rest of the site is behind the password.
  await page.goto('/');
  await expect(lockHeading(page)).toBeVisible();

  await page.goto('/file/demo');
  await expect(lockHeading(page)).toHaveCount(0);
  await expect(heading(page, 'Demo logbook')).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await page
    .getByRole('textbox', { name: 'What happened?' })
    .fill('Filed from behind the password.');
  const next = () => page.getByRole('button', { name: 'Next' }).click();
  await next(); // what
  await next(); // when (optional)
  await next(); // where (optional)
  await expect(heading(page, 'Should this report be published?')).toBeVisible();
  await page.getByRole('radio', { name: 'No, keep it out of the public archive' }).click();
  await next();
  const email = `door-${Date.now().toString(36)}@example.org`;
  await page.getByLabel('Your email address').fill(email);
  await next();
  await page.getByRole('checkbox', { name: /I confirm this report is accurate/ }).check();
  const before = countTo(email);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(heading(page, 'Check your email to finish')).toBeVisible();
  // A door page asks for nothing it may not have, so the lock never came back.
  await expect(lockHeading(page)).toHaveCount(0);
  await context.close();

  const link = linkIn(await lastMessageTo(email, before));
  const inbox = await fresh(browser);
  await inbox.page.goto(link);
  await expect(lockHeading(inbox.page)).toHaveCount(0);
  await expect(heading(inbox.page, 'Confirm your report')).toBeVisible();
  await inbox.page.getByRole('button', { name: 'Confirm and file my report' }).click();
  await expect(heading(inbox.page, 'Your report is filed')).toBeVisible();
  await expect(inbox.page.getByText(/Its reference is RL-/)).toBeVisible();
  // On a door the page offers nothing that leads behind the password.
  await expect(inbox.page.getByRole('link', { name: 'Check it has not been changed' })).toHaveCount(
    0,
  );
  await expect(lockHeading(inbox.page)).toHaveCount(0);

  // The link keeps working there, without the password.
  await inbox.page.goto(link);
  await expect(heading(inbox.page, 'Your report is filed')).toBeVisible();
  await inbox.context.close();
});

test('a logbook not opened outside is behind the password, form and all', async ({ browser }) => {
  filingState('outside', 'demo', 'closed');
  const { context, page } = await fresh(browser);
  await page.goto('/file/demo');
  await expect(lockHeading(page)).toBeVisible();
  await context.close();
});
