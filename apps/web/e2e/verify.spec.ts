import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const refs = JSON.parse(
  readFileSync(fileURLToPath(new URL('./.refs.json', import.meta.url)), 'utf8'),
) as string[];
const ref = refs[0] ?? '';

test('a reader checks a report from the front page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Report reference').fill(ref);
  await page.getByRole('button', { name: 'Check it' }).click();

  await expect(page).toHaveURL(new RegExp(`/verify/${ref}$`));
  const checks = page.getByRole('list', { name: 'Checks' }).getByRole('listitem');
  await expect(checks).toHaveCount(4);
  for (const item of await checks.all()) await expect(item).toContainText('Holds:');
});

test('an unknown reference says so plainly', async ({ page }) => {
  await page.goto('/verify/RL-NOT-REAL');
  await expect(page.getByRole('alert')).toContainText('There is no report with that reference.');
});

test('the site asks no third party for anything', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await page.goto(`/verify/${ref}`);
  await expect(page.getByRole('list', { name: 'Checks' })).toBeVisible();
  expect(outside).toEqual([]);
});
