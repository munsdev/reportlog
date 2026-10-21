/**
 * A coordinator attaches a photo to an account they are typing up, and it is
 * sealed into the report when the batch is filed.
 *
 * The photo goes through the real server and its real worker (the test
 * server runs it inline), so "Ready" in the dialog means the file was
 * re-encoded, and the fingerprint at the end is what the chain holds.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ADMIN } from '../auth.ts';
import { filesState, photoWithLocation } from '../files/helpers.ts';
import { codeIn, countTo, lastMessageTo } from '../identity/mail.ts';
import { passSecondFactor } from '../second-factor.ts';

const API = fileURLToPath(new URL('../../../api/', import.meta.url));
const filingState = (...args: string[]) =>
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/filing/dev-state.ts', ...args], {
    cwd: API,
  });

const stamp = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

async function signIn(page: Page, email: string) {
  const before = countTo(email);
  const asked = await page.request.post('/api/auth/code', { data: { email } });
  expect(asked.ok(), await asked.text()).toBe(true);
  const code = codeIn(await lastMessageTo(email, before));
  const signed = await page.request.post('/api/auth/sign-in', { data: { email, code } });
  expect(signed.ok(), await signed.text()).toBe(true);
  await passSecondFactor(page.request, email);
}

test('a photo attached to an account is filed with it, and nothing else is contacted', async ({
  page,
  playwright,
}, info) => {
  const id = stamp();
  const email = `coord-files-${id}@example.org`;
  const org = `Photo Forms Group ${id}`;
  const slug = `photos-${id}`;
  const title = `Accounts with photos ${id}`;
  filingState('coordinator', email, org);
  filesState('logbook', slug, title);
  await signIn(page, email);
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });

  await page.goto('/intake');
  await page.getByRole('button', { name: 'Start a new batch' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Batch for ${org}` })).toBeVisible();
  await page.getByRole('button', { name: 'Add an account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Account 1' });
  await dialog.getByLabel('Which logbook').selectOption({ label: title });
  await dialog.getByRole('textbox', { name: 'What happened?' }).fill('Photographed the notice.');
  // Said in a coordinator's terms: filed with the batch, not "confirm from your email".
  await expect(
    dialog.getByText(/It is filed with the account, when you file the batch/),
  ).toBeVisible();
  await expect(dialog.getByText(/confirm from your email/)).toHaveCount(0);
  await dialog
    .getByLabel('Photos or video (optional)')
    .setInputFiles({ name: 'notice.jpg', mimeType: 'image/jpeg', buffer: photoWithLocation() });
  const files = dialog.getByRole('list', { name: 'Your files' });
  await expect(files).toContainText('notice.jpg');
  // Prepared on the server while the coordinator carries on typing.
  await expect(files.getByText('Ready')).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel('How it was collected').selectOption({ label: 'A paper form' });
  await dialog.getByRole('radio', { name: 'No, keep it out of the public archive' }).click();
  await dialog.getByRole('button', { name: 'Save this account' }).click();
  await expect(dialog).toBeHidden();

  // Opened again, the file is still on the account.
  const accounts = page.getByRole('region', { name: 'Accounts' });
  await accounts.getByRole('button', { name: 'Change account 1' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Account 1' }).getByRole('list', { name: 'Your files' }),
  ).toContainText('notice.jpg');
  await page
    .getByRole('dialog', { name: 'Account 1' })
    .getByRole('button', { name: 'Cancel' })
    .click();

  const check = page.getByRole('region', { name: 'Before filing' });
  await expect(check).toContainText('1 ready to file');
  await check.getByRole('button', { name: 'File the ready accounts' }).click();
  const attest = page.getByRole('dialog', { name: 'File this batch' });
  await attest.getByRole('checkbox', { name: /transcribed them faithfully/ }).click();
  await attest.getByRole('button', { name: 'File them' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Filed 1 account' })).toBeVisible();

  const ref = /RL-[A-Z0-9-]+/.exec(
    (await accounts.getByText(/Filed as RL-/).textContent()) ?? '',
  )?.[0];
  expect(ref).toBeTruthy();
  // The sealed fields come whole to staff only: verifying an unpublished
  // report shows anybody else its fingerprints alone (decisions.md §1).
  const staff = await playwright.request.newContext({
    baseURL: info.project.use.baseURL ?? 'http://127.0.0.1:4173',
    storageState: ADMIN,
  });
  const v = (await (await staff.get(`/api/reports/${ref ?? ''}/verify`)).json()) as {
    content: { ok: boolean };
    hashed_fields: {
      third_party?: boolean;
      attachments?: { media_type: string; ordinal: number }[];
    };
  };
  expect(v.content.ok).toBe(true);
  expect(v.hashed_fields.third_party).toBe(true);
  expect(v.hashed_fields.attachments).toEqual([
    expect.objectContaining({ ordinal: 1, media_type: 'image/jpeg' }),
  ]);
  await staff.dispose();
  expect(outside).toEqual([]);
});
