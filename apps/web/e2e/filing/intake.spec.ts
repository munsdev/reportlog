/**
 * A coordinator types up accounts collected on paper: stages them, is told
 * what each is missing, fixes it, attests and files the batch. Then corrects
 * one of the filed accounts, as their own act.
 *
 * The coordinator, their organization and a logbook of the test's own are
 * made by filing's dev-state, so another test closing the demo logbook
 * cannot change what this one is told.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

test('somebody who coordinates nothing is told so', async ({ page }) => {
  await signIn(page, `nobody-${stamp()}@example.org`);
  await page.goto('/intake');
  await expect(page.getByRole('heading', { name: 'Not for this account' })).toBeVisible();
});

test('a coordinator stages accounts, fixes what is missing, files them and corrects one', async ({
  page,
}) => {
  const id = stamp();
  const email = `coord-${id}@example.org`;
  const org = `Paper Forms Group ${id}`;
  const slug = `paper-${id}`;
  filingState('coordinator', email, org);
  filingState('intake-logbook', slug, `Paper accounts ${id}`);
  await signIn(page, email);

  // Reached from the staff menu, which shows it by organization membership.
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Staff' })
    .getByRole('link', { name: 'Intake' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Filing for an organization' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start a new batch' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Batch for ${org}` })).toBeVisible();

  // ── account 1: complete ───────────────────────────────────────────────
  await page.getByRole('button', { name: 'Add an account' }).click();
  let dialog = page.getByRole('dialog', { name: 'Account 1' });
  await dialog.getByLabel('Which logbook').selectOption({ label: `Paper accounts ${id}` });
  await dialog
    .getByRole('textbox', { name: 'What happened?' })
    .fill('Turned away over a student ID.');
  await dialog.getByLabel('How it was collected').selectOption({ label: 'A paper form' });
  await dialog.getByLabel('The day it was collected').fill('2026-11-03');
  await dialog.getByLabel('Your own reference for it').fill('clipboard 3, sheet 7');
  await dialog.getByRole('radio', { name: 'Yes, it may be published' }).click();
  await dialog.getByRole('button', { name: 'Save this account' }).click();
  await expect(dialog).toBeHidden();

  // ── account 2: no method, no publication answer ───────────────────────
  await page.getByRole('button', { name: 'Add an account' }).click();
  dialog = page.getByRole('dialog', { name: 'Account 2' });
  await dialog.getByLabel('Which logbook').selectOption({ label: `Paper accounts ${id}` });
  await dialog.getByRole('textbox', { name: 'What happened?' }).fill('The queue was split in two.');
  await dialog.getByRole('button', { name: 'Save this account' }).click();
  await expect(dialog).toBeHidden();

  const check = page.getByRole('region', { name: 'Before filing' });
  await expect(check).toContainText('1 ready to file, 1 still needs work');
  await expect(check).toContainText('Account 2: needs to say how the account was collected');
  await expect(check).toContainText('needs the answer to whether it may be published');

  // ── fix account 2 ─────────────────────────────────────────────────────
  const accounts = page.getByRole('region', { name: 'Accounts' });
  await accounts.getByRole('button', { name: 'Change account 2' }).click();
  dialog = page.getByRole('dialog', { name: 'Account 2' });
  await expect(dialog.getByRole('textbox', { name: 'What happened?' })).toHaveValue(
    'The queue was split in two.',
  );
  await dialog.getByLabel('How it was collected').selectOption({ label: 'A phone call' });
  await dialog.getByRole('radio', { name: 'No, keep it out of the public archive' }).click();
  await dialog.getByRole('button', { name: 'Save this account' }).click();
  await expect(dialog).toBeHidden();
  await expect(check).toContainText('2 ready to file');
  await expect(check).not.toContainText('still need');

  // ── attest and file ───────────────────────────────────────────────────
  await check.getByRole('button', { name: 'File the ready accounts' }).click();
  const attest = page.getByRole('dialog', { name: 'File this batch' });
  await expect(attest).toContainText(`2 accounts are about to enter the permanent record`);
  await expect(attest).toContainText(org);
  const go = attest.getByRole('button', { name: 'File them' });
  await expect(go).toBeDisabled();
  await attest.getByRole('checkbox', { name: /transcribed them faithfully/ }).click();
  await go.click();
  await expect(page.getByRole('status').filter({ hasText: 'Filed 2 accounts' })).toBeVisible();
  await expect(accounts.getByText(/Filed as RL-/)).toHaveCount(2);
  await expect(accounts.getByRole('button', { name: /^Change account/ })).toHaveCount(0);

  // The batch list says it is filed.
  await page.getByRole('link', { name: 'All your batches' }).click();
  await expect(page.getByRole('region', { name: 'Your batches' })).toContainText('Filed');

  // ── correct account 1, as the coordinator ─────────────────────────────
  await page
    .getByRole('link', { name: /^Open the batch/ })
    .first()
    .click();
  await accounts.getByRole('link', { name: 'Correct account 1' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Correct RL-/ })).toBeVisible();
  const form = page.getByRole('region', { name: 'The correction' });
  await expect(form.getByRole('textbox', { name: 'What happened?' })).toHaveValue(
    'Turned away over a student ID.',
  );
  await form
    .getByRole('textbox', { name: 'What happened?' })
    .fill('Turned away over a student ID at nine.');
  await form.getByLabel('The day it was collected').fill('2026-11-04');
  await form.getByLabel('Why are you correcting it?').fill('I mistyped the time and the day.');
  const save = form.getByRole('button', { name: 'File the correction' });
  await save.click();
  await expect(form.getByText('Tick the statement first.')).toBeVisible();
  await form.getByRole('checkbox', { name: /transcribed it faithfully/ }).click();
  await save.click();
  await expect(
    page.getByRole('status').filter({ hasText: /Filed as a new version, RL-/ }),
  ).toBeVisible();
  const history = page.getByRole('region', { name: 'What has been done to it' });
  await expect(history).toContainText('I mistyped the time and the day.');
  await expect(history).toContainText(email);

  // The coordinator's own reports page is untouched: it is not theirs.
  await page.goto('/mine');
  await expect(page.getByText(/^There are no reports filed from this address\./)).toBeVisible();
});
