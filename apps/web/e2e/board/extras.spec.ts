/**
 * D3's screens: the transparency log (as an administrator) and the press pack
 * (as anybody). Neither asks another host for anything. Severity and
 * incidents are walked in board-locked/board.spec.ts, which runs after
 * everything else, because filing reports for them here would spend the
 * per-address filing limit the whole suite shares.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from '../auth.ts';
import { goViaMenu } from '../menu.ts';
import { stepUp } from '../second-factor.ts';

function watchOutside(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

test.describe('the transparency log', () => {
  test.use({ storageState: ADMIN });

  test('an administrator reads the anchor’s state and finds the complete chain files', async ({
    page,
  }) => {
    const outside = watchOutside(page);
    await page.goto('/');
    await goViaMenu(page, 'Transparency log', { area: 'Logs and system' });
    await expect(page.getByRole('heading', { level: 1, name: 'Transparency log' })).toBeVisible();
    // The test server anchors nothing and has no mirror, and the page says so.
    await expect(page.getByText('The anchor is not working')).toBeVisible();
    // The page's one question, answered first in a sentence.
    await expect(
      page.getByText('The archive’s daily claim has not reached the transparency log yet.'),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'The last anchors' })).toContainText(
      'Nothing has been anchored yet.',
    );
    const files = page.getByRole('region', { name: 'Complete chain files' });
    const demo = files.getByRole('link', { name: 'Demo logbook' });
    await expect(demo).toHaveAttribute('href', '/api/admin/chain/demo');
    // The complete chain file asks for the second factor again (plan E, E3);
    // without a fresh one the page opens the step-up dialog first.
    await stepUp(page.request);
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
    // The tab is hidden while the pack is empty, so go to the page itself.
    await page.goto('/board/press');
    await expect(page.getByRole('heading', { level: 1, name: 'Press pack' })).toBeVisible();
    await expect(page.getByText('Nothing has been published here yet.')).toBeVisible();
    expect(outside).toEqual([]);
  });
});
