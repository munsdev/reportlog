/**
 * The front page's headline block (decision 79): an administrator switches
 * its layout and rewords it on the page, saves it live, a stranger sees it,
 * and Undo puts the page back.
 */
import { expect, test } from '@playwright/test';
import { ADMIN } from './auth.ts';

test.use({ storageState: ADMIN });

test('an administrator rewords the headline block, a stranger sees it, and Undo puts it back', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto('/');
  const before = (await page.getByRole('heading', { level: 1 }).textContent()) ?? '';
  await page.getByRole('button', { name: 'Edit headline' }).click();
  await page.getByLabel('Layout').selectOption('info');
  await page.getByLabel('Headline', { exact: true }).fill('Every report, kept as written');
  await page.getByLabel('Introduction').fill('Read the **record** and [how it works](/how).');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved. It is live.')).toBeVisible();

  const stranger = await browser.newContext({ baseURL: baseURL ?? '' });
  const seen = await stranger.newPage();
  await seen.goto('/');
  await expect(seen.getByRole('heading', { level: 1 })).toHaveText('Every report, kept as written');
  await expect(seen.getByRole('link', { name: 'how it works' })).toBeVisible();

  await page.getByRole('button', { name: 'Undo last save' }).click();
  await expect(page.getByText('Put back as it was before the last save.')).toBeVisible();
  await seen.reload();
  await expect(seen.getByRole('heading', { level: 1 })).toHaveText(before);
  await stranger.close();
});
