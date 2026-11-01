import { expect, test } from '@playwright/test';

// A form's paper copy (features/paper/): reached from the form's first card,
// drawn from the same questions, and like every public page it asks no
// other host for anything.
test('a logbook prints as a paper copy, asking no third party for anything', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await page.goto('/file/demo');
  await page.getByRole('link', { name: 'Print a paper copy' }).click();
  await expect(page).toHaveURL(/\/file\/demo\/paper$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Demo logbook' })).toBeVisible();
  await expect(page.getByText('It fits on one page.')).toBeVisible();
  // The publication question, in the wording coordinator intake seals.
  await expect(
    page.getByText('The organization this was filed through is part of the report'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print it or save it as a PDF' })).toBeVisible();
  expect(outside).toEqual([]);
});
