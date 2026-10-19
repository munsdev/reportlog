/**
 * The staff menu, feedback, email updates, the directory and the guides,
 * in a real browser against the real server.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';

/** Every request a page makes to a host other than this site's. */
function outsideRequests(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

test.describe('signed out', () => {
  test('there is no staff menu', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Staff' })).toHaveCount(0);
  });

  test('the guides and the directory ask no third party for anything', async ({ page }) => {
    const outside = outsideRequests(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1, name: 'Guides' })).toBeVisible();
    await page.getByRole('link', { name: 'Your first logbook' }).click();
    await expect(
      page.getByRole('heading', { name: '4 · Launch it: this is the one-way door' }),
    ).toBeVisible();
    await page.goto('/docs/checking');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Checking it actually works');
    await page.goto('/organizations');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Participating organizations' }),
    ).toBeVisible();
    // The sentence that says what the list is not comes with it.
    await expect(page.getByText('Listing here is not verification.')).toBeVisible();
    expect(outside).toEqual([]);
  });
});

test.describe('an administrator', () => {
  test.use({ storageState: ADMIN });

  test('reaches the staff screens from the menu', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Staff' });
    await expect(nav).toBeVisible();
    for (const name of ['Access', 'Logbooks', 'Lists', 'List review', 'Settings', 'Feedback']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await nav.getByRole('link', { name: 'Logbooks', exact: true }).click();
    await expect(page).toHaveURL(/\/logbooks$/);
    await nav.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('files feedback, then answers it from the queue', async ({ page }, info) => {
    const title = `Nothing happens on save (${info.project.name} ${Date.now().toString(36)})`;
    await page.goto('/settings');
    await page
      .getByRole('navigation', { name: 'Staff' })
      .getByRole('link', { name: 'Feedback' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Feedback' })).toBeVisible();
    await page.getByRole('radio', { name: 'Something is broken' }).click();
    await page.getByRole('radio', { name: 'It gets in the way' }).click();
    await page.getByLabel('A title').fill(title);
    await page
      .getByLabel('What happened?')
      .fill('I pressed save on the look screen and nothing happened.');
    await page.getByRole('button', { name: 'File it' }).click();
    await expect(page.getByText(/Filed as #\d+/)).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible();

    await page.goto('/settings/feedback');
    const card = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: title }) });
    await card.getByRole('button', { name: 'Open' }).click();
    // Where it was filed from came with it, as the screen's name, not its address.
    await expect(card.getByText('/(staff)/settings')).toBeVisible();
    await card.getByLabel('Move it to').selectOption('fixed');
    await card.getByLabel(/A note for/).fill('Fixed now. Thank you for the clear steps.');
    await card.getByRole('button', { name: 'Move it and send the note' }).click();
    await expect(card.getByText(/moved it to Fixed/)).toBeVisible();
  });

  test('chooses email updates from some logbooks, and the choice is kept', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Email updates' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Email updates' })).toBeVisible();
    await page.getByRole('radio', { name: /Once a week/ }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved. You will be emailed once a week.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('radio', { name: /Once a week/ })).toBeChecked();
    await page.getByRole('radio', { name: /No emails/ }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved. You will not be emailed.')).toBeVisible();
  });
});
