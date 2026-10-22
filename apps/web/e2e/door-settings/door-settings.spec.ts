/**
 * The door's setting in the administration screens (Settings → Report and
 * tip forms): the minimum time a form must be open before it is sent.
 *
 * ITS OWN PROJECT, after the flood's (playwright.config.ts): the minimum
 * is the whole site's, and every other project files reports with it at 0
 * (global-setup.ts). The test puts it back to 0 however it ends.
 */
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { axe, describeViolation } from '../a11y.ts';
import { identityState } from '../identity/mail.ts';
import { signInWithSecondFactor } from '../second-factor.ts';

const unique = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1e6))}`;

/** An administrator of this file's own, signed in as a person would be (code, then second factor). */
async function administrator(browser: Browser): Promise<Page> {
  const email = `e2e-door-admin-${unique()}@example.org`;
  identityState('seat', email, 'admin');
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await signInWithSecondFactor(context.request, email);
  return context.newPage();
}

test('an administrator sets the minimum time on a form, and nobody else can', async ({
  browser,
}) => {
  const page = await administrator(browser);
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  try {
    await page.goto('/settings');
    // The overview says what is set before anything is opened.
    const summary = page.getByRole('region', { name: 'Report and tip forms' });
    await expect(summary).toContainText('Not checked');
    await summary.getByRole('link', { name: 'Change Report and tip forms' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Report and tip forms' }),
    ).toBeVisible();
    const box = page.getByLabel('Minimum time on a form, in seconds');
    await expect(box).toHaveValue('0');
    const bar = page.getByRole('region', { name: 'Save changes' });
    // Nothing to save, so no Save bar.
    await expect(bar).toHaveCount(0);
    // Where the rest of the door is set, named on the page.
    await expect(
      page.getByRole('main').getByRole('link', { name: 'flood screen', exact: true }),
    ).toHaveAttribute('href', '/moderate/flood');
    const found = await axe(page);
    expect(found.violations.map(describeViolation)).toEqual([]);

    await box.fill('three');
    await expect(page.getByText('Write a whole number of seconds from 0 to 600.')).toBeVisible();
    // Save with a mistake in the box sends nothing.
    await bar.getByRole('button', { name: 'Save' }).click();
    expect(await (await page.request.get('/api/admin/door')).json()).toEqual({
      min_form_seconds: 0,
    });
    await box.fill('4');
    await expect(bar).toContainText('Saving: Minimum time on a form');
    await bar.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('Saved. Forms are checked with the new time from now.'),
    ).toBeVisible();
    await expect(bar).toHaveCount(0);
    const stored = await page.request.get('/api/admin/door');
    expect(await stored.json()).toEqual({ min_form_seconds: 4 });
    await page.reload();
    await expect(page.getByLabel('Minimum time on a form, in seconds')).toHaveValue('4');

    // A stranger can neither read nor change it.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const nobody = await context.request.put('/api/admin/door', { data: { min_form_seconds: 0 } });
    expect(nobody.ok()).toBe(false);
    await context.close();
    expect(outside).toEqual([]);
  } finally {
    const back = await page.request.put('/api/admin/door', { data: { min_form_seconds: 0 } });
    expect(back.ok(), await back.text()).toBe(true);
    await page.context().close();
  }
});
