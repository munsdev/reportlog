/**
 * P2's pages and settings in a real browser against the real server: About,
 * How to use this, the moderation standard and the public API page (each
 * asking no third party for anything), the footer's attribution, the
 * development notice, a figure in the page wording, the site's social media
 * accounts, and the warning before unsaved settings are lost.
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
  test('About, How to use this, the standard and the public API ask no third party for anything', async ({
    page,
  }) => {
    const outside = outsideRequests(page);
    const pages = [
      // About's heading is the operator's own words.
      ['/about', /\S/],
      ['/how', 'How it works'],
      ['/standards', 'Standards'],
      // The public API moved into How it works, under For developers.
      ['/public-api', 'How it works'],
    ] as const;
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      await page.waitForLoadState('networkidle');
    }
    expect(outside).toEqual([]);
  });

  test('About puts the operator’s words first; the software’s part is on How to use this', async ({
    page,
  }) => {
    await page.goto('/about');
    await expect(page.getByRole('heading', { name: 'What this is', exact: true })).toBeVisible();
    await expect(page.locator('[data-copy="about_archive"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'About the software' })).toHaveCount(0);
  });

  test('the footer credits the software, and reaches every new page', async ({ page }) => {
    await page.goto('/');
    const footer = page.getByRole('contentinfo');
    await expect(footer.locator('[data-attribution]')).toHaveText(/^Powered by ReportLog/);
    for (const [link, heading] of [
      ['About', /\S/],
      ['How it works', 'How it works'],
      ['Standards', 'Standards'],
    ] as const) {
      await footer.getByRole('link', { name: link, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    }
  });
});

test.describe('an administrator', () => {
  test.use({ storageState: ADMIN });
  // The notice and the wording are site-wide: run on one project only, or
  // the phone run turns the notice off while the desktop run looks for it.
  test.beforeEach(() => {
    test.skip(
      test.info().project.name !== 'chromium',
      'changes a site-wide setting; one project at a time',
    );
  });

  test('turns the development notice on, every page shows it, and turns it off', async ({
    page,
  }) => {
    await page.goto('/settings/development');
    const panel = page.getByRole('region', { name: 'Development notice' });
    // A switch, not a form: it applies when pressed, and a toast says so.
    const sw = panel.getByRole('switch');
    await expect(sw).not.toBeChecked();
    await sw.click();
    await expect(page.getByText(/The development notice is now on, until/)).toBeVisible();
    await expect(panel).toContainText(/The notice is showing until/);

    await page.goto('/');
    // One round "!" for every notice there is (owner, 28 Oct).
    const badge = page.getByRole('button', { name: 'Notices: 1' });
    await expect(badge).toBeVisible();
    await badge.click();
    await expect(
      page
        .getByRole('dialog', { name: 'Notices' })
        .getByRole('heading', { name: 'This site is under active development' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto('/settings/development');
    await expect(sw).toBeChecked();
    await sw.click();
    await expect(page.getByText('The development notice is now off.')).toBeVisible();
    await expect(panel).toContainText('The notice is not showing.');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(badge).toHaveCount(0);
  });

  test('puts a number in the How-to page’s wording, and the page shows the number', async ({
    page,
  }) => {
    await page.goto('/settings/words');
    const slot = 'Your own words on the how-to page';
    const card = page.getByRole('region', { name: slot });
    const bar = page.getByRole('region', { name: 'Unsaved changes' });
    await card.getByRole('button', { name: `Change ${slot}` }).click();
    const box = page.getByRole('textbox', { name: slot });
    await box.fill('Reports filed so far: ');
    await card.getByRole('button', { name: 'Insert a number' }).click();
    await card.getByLabel('Which number').selectOption({ label: 'Reports filed ever' });
    await card.getByRole('button', { name: 'Insert it' }).click();
    await expect(box).toHaveValue('Reports filed so far: {{ [reports.filed.all] }}');
    // Beside the editor, the piece where it sits, with the placeholder as its
    // number (hidden from screen readers: the field holds the same words).
    await expect(card.locator('.panel.quiet')).toContainText(/Reports filed so far: \d[\d,]*/);
    await expect(bar).toContainText(`Changes to ${slot} are not saved.`);
    await bar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved. The page shows it now.')).toBeVisible();

    await page.goto('/how');
    await expect(page.locator('[data-copy="how_intro"]')).toHaveText(
      /^Reports filed so far: \d[\d,]*$/,
    );

    // A placeholder that would not work is refused, in words, beside the field.
    await page.goto('/settings/words');
    await card.getByRole('button', { name: `Change ${slot}` }).click();
    await box.fill('{{ [no.such.figure] }}');
    await bar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(card.getByText(/no figure called \[no\.such\.figure\]/)).toBeVisible();

    // Put it back, so other tests see the shipped page.
    await box.fill('');
    await bar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(`${slot} is back to the shipped wording.`)).toBeVisible();
  });

  test('switches a social media account on, and the footer and the front page link it, fetching nothing elsewhere', async ({
    page,
  }) => {
    await page.goto('/settings/social');
    // A panel per platform; the switch is off until there is an address.
    const row = page.locator('[data-platform="bluesky"]');
    const show = row.getByRole('switch', { name: 'Show on the site' });
    await expect(show).toBeDisabled();
    await row.getByLabel('Address on Bluesky').fill('@munich.bsky.social');
    await expect(row.getByText('Links to bsky.app/profile/munich.bsky.social')).toBeVisible();
    await show.click();
    const bar = page.getByRole('region', { name: 'Unsaved changes' });
    await bar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved. 1 account is shown.')).toBeVisible();

    const outside = outsideRequests(page);
    await page.goto('/');
    const mark = page.getByRole('contentinfo').getByRole('link', { name: /on Bluesky$/ });
    await expect(mark).toHaveAttribute('href', 'https://bsky.app/profile/munich.bsky.social');
    await expect(mark).toHaveAttribute('rel', /noreferrer/);
    // The front page's "Follow along" band links it too.
    await expect(
      page.getByRole('main').locator('[data-follow-band] a[data-social="bluesky"]'),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(outside).toEqual([]);

    // The floating strip: off until asked, then on the chosen pages only.
    const strip = page.locator('[data-follow-us]');
    await expect(strip).toHaveCount(0);
    await page.goto('/settings/social');
    const placements = page.locator('[data-placements]');
    await placements.getByRole('switch', { name: 'Floating “Follow us” button' }).click();
    // A tick box is a label over a hidden input, so the label is what is clicked.
    await placements.locator('label').filter({ hasText: 'The maps' }).click();
    await bar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved. 1 account is shown.')).toBeVisible();
    await page.goto('/');
    await expect(strip.getByRole('link', { name: /on Bluesky$/ })).toHaveAttribute(
      'href',
      'https://bsky.app/profile/munich.bsky.social',
    );
    await page.goto('/about');
    await expect(strip).toBeVisible();
    // Never on a filing form, whatever is chosen.
    await page.goto('/submit');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(strip).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(outside).toEqual([]);

    // Put it back, so other tests see a site with no accounts.
    await page.goto('/settings/social');
    await placements.getByRole('switch', { name: 'Floating “Follow us” button' }).click();
    await row.getByLabel('Address on Bluesky').fill('');
    await bar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved. No account is shown.')).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Follow us elsewhere' })).toHaveCount(0);
  });

  test('is warned before leaving a settings screen with unsaved changes, by the panel’s name', async ({
    page,
  }) => {
    // A form opened in place and changed but not saved. (Publishing on the
    // overview became a switch that applies at once, so it has nothing to lose.)
    await page.goto('/settings/legal');
    await page.getByRole('button', { name: 'Change Privacy policy' }).click();
    await page.getByRole('textbox', { name: 'Privacy policy' }).pressSequentially('x');

    let asked = '';
    page.once('dialog', (d) => {
      asked = d.message();
      void d.dismiss();
    });
    await page
      .getByRole('navigation', { name: 'Staff areas' })
      .getByRole('link', { name: 'Name and look', exact: true })
      .click();
    await expect.poll(() => asked).toMatch(/changes to Privacy policy that are not saved/);
    await expect(page).toHaveURL(/\/settings\/legal$/);

    page.once('dialog', (d) => void d.accept());
    await page
      .getByRole('navigation', { name: 'Staff areas' })
      .getByRole('link', { name: 'Name and look', exact: true })
      .click();
    await expect(page).toHaveURL(/\/settings\/(name|look)$/);
  });

  test('is warned before leaving the Look screen with a look previewed and not applied', async ({
    page,
  }) => {
    // In from the overview, so Back stays inside the app and the router asks.
    await page.goto('/settings');
    await page.getByRole('link', { name: 'Change How this site looks' }).click();
    await expect(page).toHaveURL(/\/settings\/look$/);
    // A look's card is a label over a hidden radio.
    await page
      .locator('label')
      .filter({ has: page.getByRole('radio', { name: 'Green screen' }) })
      .last()
      .click();
    let asked = '';
    page.once('dialog', (d) => {
      asked = d.message();
      void d.dismiss();
    });
    await page.goBack();
    await expect.poll(() => asked).toMatch(/changes to the look that are not saved/);
    await expect(page).toHaveURL(/\/settings\/look$/);
  });
});
