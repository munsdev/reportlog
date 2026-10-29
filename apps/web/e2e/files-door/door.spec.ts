/**
 * Attaching a photo with the site password ON, to a logbook opened outside
 * it by link. Uploading is part of filing, so its calls are in FILING_CALLS
 * (apps/api/src/identity/doors.ts) for a logbook that asks for files: the
 * reporter never has the password and the lock never comes back.
 *
 * Runs alone, last (the `files-behind-password` project): the password is
 * the whole site's.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { countTo, identityState, lastMessageTo, linkIn } from '../identity/mail.ts';
import { filesState, photoWithLocation } from '../files/helpers.ts';

test.describe.configure({ mode: 'serial' });

const API = fileURLToPath(new URL('../../../api/', import.meta.url));
const filingState = (...args: string[]) =>
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/filing/dev-state.ts', ...args], {
    cwd: API,
  });

const SLUG = 'files-door';
const lockHeading = (page: Page) =>
  page.getByRole('heading', { name: 'This site needs a password' });
const heading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });

test.beforeAll(() => {
  filesState('logbook', SLUG, 'Files by the door');
  filingState('outside', SLUG, 'link');
  filingState('curtain', `files-door-${String(Date.now())}`);
});
test.afterAll(() => {
  filingState('outside', SLUG, 'closed');
  identityState('set-up');
});

test('a reporter without the password attaches a photo, sends, and confirms from the email', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await expect(lockHeading(page)).toBeVisible();

  await page.goto(`/file/${SLUG}`);
  await expect(heading(page, 'Files by the door')).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await page
    .getByRole('textbox', { name: 'What happened?' })
    .fill('Filed from outside, with a photo.');
  const next = () => page.getByRole('button', { name: 'Next' }).click();
  await next();
  await next(); // the publication question, unanswered: no
  const email = `files-door-${Date.now().toString(36)}@example.org`;
  await page.getByLabel('Your email address').fill(email);
  await next();
  await expect(heading(page, 'Photos or video')).toBeVisible();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'door.jpg', mimeType: 'image/jpeg', buffer: photoWithLocation() });
  await expect(page.getByRole('list', { name: 'Your files' }).getByText('Uploaded')).toBeVisible();
  // Removing one and adding it again: the remove call passes the door too.
  await page.getByRole('button', { name: 'Remove door.jpg' }).click();
  await expect(page.getByRole('list', { name: 'Your files' })).toHaveCount(0);
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'door.jpg', mimeType: 'image/jpeg', buffer: photoWithLocation() });
  await expect(page.getByRole('list', { name: 'Your files' }).getByText('Uploaded')).toBeVisible();
  await next();
  await page.getByRole('checkbox', { name: /I confirm this report is accurate/ }).check();
  const before = countTo(email);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(heading(page, 'Check your email to finish')).toBeVisible();
  // A door page asks for nothing it may not have, so the lock never came back.
  await expect(lockHeading(page)).toHaveCount(0);
  await context.close();

  const inbox = await browser.newContext();
  const mail = await inbox.newPage();
  await mail.goto(linkIn(await lastMessageTo(email, before)));
  await expect(lockHeading(mail)).toHaveCount(0);
  await mail.getByRole('button', { name: 'Confirm and file my report' }).click();
  await expect(async () => {
    if (await heading(mail, 'Your files are still being prepared').isVisible()) {
      await mail.getByRole('button', { name: 'Try again' }).click();
    }
    await expect(heading(mail, 'Your report is filed')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await expect(mail.getByText('One file is part of the report.')).toBeVisible();
  await expect(lockHeading(mail)).toHaveCount(0);
  await inbox.close();
});
