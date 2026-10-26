/**
 * The staff menu, feedback, email updates, the directory and the guides,
 * in a real browser against the real server.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { goViaMenu, menuLink, openMenu } from './menu.ts';

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
    const nav = await openMenu(page);
    await expect(nav.getByRole('heading', { name: 'Staff' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });

  test('the guides and the directory ask no third party for anything', async ({ page }) => {
    const outside = outsideRequests(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1, name: 'Guides' })).toBeVisible();
    await page.getByRole('link', { name: 'Your first logbook' }).click();
    await expect(
      page.getByRole('heading', { name: 'Launch it: this is the one-way door' }),
    ).toBeVisible();
    await page.goto('/docs/checking');
    // The old address lands on the record tab of How to use this.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to use this');
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
    for (const [area, name] of [
      ['People', 'People and roles'],
      ['Content', 'Logbooks'],
      ['Content', 'Lists'],
      ['Review', 'List entries'],
      ['Site', 'Name'],
    ] as const) {
      await expect(await menuLink(page, name, { area })).toBeVisible();
    }
    await expect(await menuLink(page, 'Feedback')).toBeVisible();
    await goViaMenu(page, 'Logbooks', { area: 'Content' });
    await expect(page).toHaveURL(/\/logbooks$/);
    await goViaMenu(page, 'Name', { area: 'Site' });
    await expect(page).toHaveURL(/\/settings\/name$/);
    await expect(await menuLink(page, 'Name', { area: 'Site' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('files feedback, then answers it from the queue', async ({ page }, info) => {
    const title = `Nothing happens on save (${info.project.name} ${Date.now().toString(36)})`;
    await page.goto('/settings');
    // The menu's bug link says which screen it was opened from.
    await goViaMenu(page, 'Report a bug on this page');
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
    await goViaMenu(page, 'Email updates');
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
