/**
 * Deleting your own account, as a person would: signing in by the code in the
 * email, finding "Your account" in the menu, typing the address back, and
 * landing on the front page signed out.
 */
import { expect, test } from '@playwright/test';
import { codeIn, countTo, lastMessageTo } from './identity/mail.ts';
import { goViaMenu } from './menu.ts';

test('a person deletes their own account and is signed out', async ({ page }, info) => {
  const email = `leaving-${info.project.name}-${Date.now().toString(36)}@example.org`;

  await page.goto('/access');
  await expect(page.getByRole('heading', { name: 'Sign in first' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).last().click();
  const before = countTo(email);
  await page.getByLabel('Your email address').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await page.getByLabel('The code from the email').fill(codeIn(await lastMessageTo(email, before)));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();

  // Found the way a person finds it: from the front page's menu.
  await page.goto('/');
  await goViaMenu(page, 'Your account');
  const panel = page.getByRole('region', { name: 'Delete your account' });
  await expect(panel).toBeVisible();
  const button = panel.getByRole('button', { name: 'Delete my account' });

  // Neither the address alone nor the box alone is enough.
  await panel.getByLabel('Type your email address to confirm').fill('someone-else@example.org');
  await panel.getByText('I understand this cannot be undone.').click();
  await expect(button).toBeDisabled();
  await expect(panel.getByText('That is not the address you are signed in with.')).toBeVisible();
  await panel.getByLabel('Type your email address to confirm').fill(email);
  await expect(button).toBeEnabled();
  await button.click();

  await expect(page).toHaveURL(/\/\?account=deleted$/);
  await expect(page.getByText('Your account is deleted, and you are signed out.')).toBeVisible();
  const me = await page.request.get('/api/auth/me');
  expect(await me.json()).toEqual({ signedIn: false });
});
