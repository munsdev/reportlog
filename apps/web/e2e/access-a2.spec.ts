/**
 * What identity left undone (workstream A2), in a real browser against the
 * real server: the roster and the team, and an organization's logo from
 * upload to the public directory.
 */
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';

const run = `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1e6))}`;

/** Every request a page makes to a host other than this site's. */
function outsideRequests(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

test.describe('an administrator', () => {
  test.use({ storageState: ADMIN });

  test('puts somebody on the team from the roster, with desks', async ({ page }) => {
    const email = `team-${run}@example.org`;
    const outside = outsideRequests(page);
    await page.goto('/access');
    await page.getByRole('link', { name: 'Roster', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Roster' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();

    await page.getByLabel('Their email address').fill(email);
    await page.getByRole('checkbox', { name: 'Outreach' }).check();
    await page.getByRole('checkbox', { name: 'Translation' }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toHaveText(
      `${email} is on the team: Translation, Outreach.`,
    );
    await expect(page.getByRole('row', { name: new RegExp(email) })).toContainText(
      'team (Translation, Outreach)',
    );

    // Taking them off the team takes the desks too.
    await page.getByRole('button', { name: `Change the team and desks of ${email}` }).click();
    await page.getByRole('checkbox', { name: 'On the team' }).uncheck();
    await expect(page.getByRole('checkbox', { name: 'Outreach' })).toBeDisabled();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toHaveText(`${email} is not on the team.`);

    await page.getByRole('link', { name: 'Access', exact: true }).first().click();
    await page.getByRole('link', { name: 'Who changed what' }).click();
    await expect(page.getByText(`took from ${email}: team member`)).toBeVisible();
    expect(outside).toEqual([]);
  });

  test('gives an organization a logo, which the directory shows once it is listed', async ({
    page,
    browser,
  }) => {
    const name = `Logo E2E ${run}`;
    const made = await page.request.post('/api/orgs', {
      data: { name, managerEmails: [`logo-manager-${run}@example.org`] },
    });
    expect(made.ok()).toBe(true);
    const { organization } = (await made.json()) as { organization: { id: number } };

    await page.goto(`/access/orgs/${String(organization.id)}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Logo' })).toBeVisible();
    await expect(page.getByText('There is no logo yet.')).toBeVisible();
    const png = execFileSync('convert', ['-size', '40x40', 'xc:green', 'png:-']);
    await page.getByLabel('A logo', { exact: true }).setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await page.getByRole('button', { name: 'Use this image' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    const shown = page.getByRole('img', { name: 'The organization’s logo as it is now' });
    await expect(shown).toBeVisible();
    // The image really loaded: the server served it to an administrator.
    await expect
      .poll(() => shown.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBe(40);

    const listed = await page.request.put(`/api/directory/listing/${String(organization.id)}`, {
      data: { listed: true },
    });
    expect(listed.ok()).toBe(true);

    // Anybody, signed out.
    const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const reader = await stranger.newPage();
    const outside = outsideRequests(reader);
    await reader.goto('/organizations');
    const card = reader.getByRole('listitem').filter({ hasText: name });
    await expect(card).toBeVisible();
    const logo = card.locator('img');
    await expect(logo).toHaveAttribute('src', /^\/api\/directory\/logos\/[a-f0-9]{32}\.png$/);
    await expect
      .poll(() => logo.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBe(40);
    expect(outside).toEqual([]);
    await stranger.close();

    // Out of the directory, out of sight again.
    await page.request.put(`/api/directory/listing/${String(organization.id)}`, {
      data: { listed: false },
    });
  });
});
