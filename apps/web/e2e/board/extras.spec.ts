/**
 * D3's screens: severity and incidents on a report in the queue (as a
 * moderator), the transparency log (as an administrator), and the press pack
 * (as anybody). Every one asks no other host for anything.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN, MODERATOR } from '../auth.ts';

function watchOutside(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

/**
 * The two demo reports global-setup files. Filing more here would spend the
 * server's per-address filing limit, which the whole suite shares.
 */
const refs = JSON.parse(
  readFileSync(fileURLToPath(new URL('../.refs.json', import.meta.url)), 'utf8'),
) as string[];

test.describe('severity and incidents', () => {
  test.use({ storageState: MODERATOR });

  test('a moderator rates a report and links it to another; the queue says so', async ({
    page,
  }) => {
    // Once per run, not per device: it changes the demo reports' assessment.
    test.skip(test.info().project.name !== 'chromium', 'Runs on the desktop project only.');
    const first = refs[0] ?? '';
    const second = refs[1] ?? '';
    const outside = watchOutside(page);

    await page.goto(`/moderate?status=all&q=${first}`);
    await page.getByRole('link', { name: `Open ${first}` }).click();
    const severity = page.getByRole('region', { name: 'Severity' });
    await expect(severity).toContainText('Nobody has rated it yet.');
    // Nothing is preselected: saving is a deliberate act.
    await expect(severity.getByRole('button', { name: 'Record the rating' })).toBeDisabled();
    await severity.getByLabel('Rate it').selectOption('serious');
    await severity.getByLabel('Why this rating').fill('People were shut out of the hall.');
    await severity.getByRole('button', { name: 'Record the rating' }).click();
    await expect(severity).toContainText('Rated Serious');

    const incident = page.getByRole('region', { name: 'Same incident' });
    await expect(incident).toContainText('Not linked to any other report.');
    await incident.getByLabel('Link it to').fill(second);
    await incident.getByLabel('Why they are the same incident').fill('Same hall, same morning.');
    await incident.getByRole('button', { name: 'Link them' }).click();
    await expect(incident.getByRole('list', { name: 'Linked reports' })).toContainText(second);
    await expect(incident).toContainText(/\d of the 2 accounts are published/);
    await expect(page.getByRole('region', { name: 'What happened to it' })).toContainText(
      'Rated its severity: serious',
    );

    await page.goto('/moderate');
    await page.getByLabel('Showing').selectOption('all');
    await page.getByLabel('Severity').selectOption('serious');
    await page.getByLabel('Search the words or a reference').fill(first);
    await page.getByRole('button', { name: 'Show' }).click();
    const row = page.getByRole('link', { name: `Open ${first}` });
    await expect(row).toContainText('Severity: Serious');
    await expect(row).toContainText('Linked with 1 other report');
    // The other one is linked but not rated, so a filter on the rating leaves it out.
    await page.getByLabel('Search the words or a reference').fill(second);
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Nothing here.' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Corroboration' })).toContainText(
      'Accounts corroborated by at least one other',
    );
    expect(outside).toEqual([]);
  });
});

test.describe('the transparency log', () => {
  test.use({ storageState: ADMIN });

  test('an administrator reads the anchor’s state and finds the complete chain files', async ({
    page,
  }) => {
    const outside = watchOutside(page);
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Staff' })
      .getByRole('link', { name: 'Transparency log' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Transparency log' })).toBeVisible();
    // The test server anchors nothing and has no mirror, and the page says so.
    await expect(page.getByText('The anchor is not working')).toBeVisible();
    await expect(page.getByRole('region', { name: 'The last anchors' })).toContainText(
      'Nothing has been anchored yet.',
    );
    const files = page.getByRole('region', { name: 'Complete chain files' });
    const demo = files.getByRole('link', { name: 'Demo logbook' });
    await expect(demo).toHaveAttribute('href', '/api/admin/chain/demo');
    const download = page.waitForEvent('download');
    await demo.click();
    expect((await download).suggestedFilename()).toMatch(
      /^demo-chain-complete-\d{4}-\d\d-\d\d\.json$/,
    );
    expect(outside).toEqual([]);
  });
});

test.describe('the press pack', () => {
  test('says plainly that nothing is published, and asks no other host', async ({ page }) => {
    const outside = watchOutside(page);
    await page.goto('/board');
    await page.getByRole('link', { name: 'Press pack' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Press pack' })).toBeVisible();
    await expect(page.getByText('Nothing has been published here yet.')).toBeVisible();
    expect(outside).toEqual([]);
  });
});
