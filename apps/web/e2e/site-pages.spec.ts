/**
 * P2's pages and settings in a real browser against the real server: About,
 * How to use this, the moderation standard and the public API page (each
 * asking no third party for anything), the footer's attribution, the
 * development notice, a figure in the page wording, and the warning before
 * unsaved settings are lost.
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
      ['/about', /^About /],
      ['/how', 'How to use this'],
      ['/standards', 'Moderation standard'],
      ['/public-api', 'Public API'],
    ] as const;
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      await page.waitForLoadState('networkidle');
    }
    expect(outside).toEqual([]);
  });

  test('About puts the operator’s words first and the software’s after', async ({ page }) => {
    await page.goto('/about');
    const what = page.locator('#what');
    await expect(what.locator('[data-copy="about_archive"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'About the software' })).toBeVisible();
    // The part an operator writes comes before the part they cannot.
    const order = await page.evaluate(() => {
      const a = document.querySelector('[data-copy="about_archive"]');
      const b = document.querySelector('#chain');
      return a && b ? a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
    });
    expect(order).toBeTruthy();
  });

  test('the footer credits the software, and reaches every new page', async ({ page }) => {
    await page.goto('/');
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByText(/Powered by ReportLog/)).toBeVisible();
    for (const [link, heading] of [
      ['About', /^About /],
      ['How to use this', 'How to use this'],
      ['Moderation standard', 'Moderation standard'],
      ['Public API', 'Public API'],
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
    await expect(panel.getByRole('radio', { name: 'Off now' })).toBeChecked();
    // Choosing the card does nothing by itself; the button applies it, and a toast says so.
    await panel.getByRole('radio', { name: /^On for 6 hours from now/ }).click();
    await panel.getByRole('button', { name: 'Turn it on' }).click();
    await expect(page.getByText(/The development notice is now on, until/)).toBeVisible();
    await expect(panel).toContainText(/ShowingYes, until/);

    await page.goto('/');
    const badge = page.getByRole('button', { name: 'Under active development' });
    await expect(badge).toBeVisible();
    await badge.click();
    await expect(
      page.getByRole('dialog', { name: 'This site is under active development' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto('/settings/development');
    await panel.getByRole('radio', { name: 'Off now' }).click();
    await panel.getByRole('button', { name: 'Turn it off' }).click();
    await expect(page.getByText('The development notice is now off.')).toBeVisible();
    await expect(panel).toContainText('ShowingNo');
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
    const bar = page.getByRole('region', { name: 'Save changes' });
    await card.getByRole('button', { name: `Edit ${slot}` }).click();
    const box = page.getByRole('textbox', { name: slot });
    await box.fill('Reports filed so far: ');
    await card.getByRole('button', { name: 'Insert a number' }).click();
    await card.getByLabel('Which number').selectOption({ label: 'Reports filed ever' });
    await card.getByRole('button', { name: 'Insert it' }).click();
    await expect(box).toHaveValue('Reports filed so far: {{ [reports.filed.all] }}');
    // Beside the editor, the piece where it sits, with the placeholder as its number.
    await expect(card.getByRole('figure')).toContainText(/Reports filed so far: \d[\d,]*/);
    await expect(bar).toContainText(`Saving: ${slot}`);
    await bar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved. The page shows it now.')).toBeVisible();

    await page.goto('/how');
    await expect(page.locator('[data-copy="how_intro"]')).toHaveText(
      /^Reports filed so far: \d[\d,]*$/,
    );

    // A placeholder that would not work is refused, in words, beside the field.
    await page.goto('/settings/words');
    await card.getByRole('button', { name: `Edit ${slot}` }).click();
    await box.fill('{{ [no.such.figure] }}');
    await bar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(card.getByText(/no figure called \[no\.such\.figure\]/)).toBeVisible();

    // Put it back, so other tests see the shipped page.
    await box.fill('');
    await bar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(`${slot} is back to the shipped wording.`)).toBeVisible();
  });

  test('is warned before leaving a settings screen with unsaved changes, by the panel’s name', async ({
    page,
  }) => {
    // The overview's one form: Publishing, opened and changed but not saved.
    await page.goto('/settings');
    const publishing = page.getByRole('region', { name: 'Publishing' });
    await publishing.getByRole('button', { name: 'Edit Publishing' }).click();
    const off = publishing.getByRole('radio', { name: 'Off' });
    const on = publishing.getByRole('radio', { name: 'On' });
    await ((await on.isChecked()) ? off : on).click();

    let asked = '';
    page.once('dialog', (d) => {
      asked = d.message();
      void d.dismiss();
    });
    await page.getByRole('link', { name: 'Change This site’s name' }).click();
    await expect.poll(() => asked).toMatch(/changes to Publishing that are not saved/);
    await expect(page).toHaveURL(/\/settings$/);

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('link', { name: 'Change This site’s name' }).click();
    await expect(page).toHaveURL(/\/settings\/name$/);
  });

  test('is warned before leaving the Look screen with a look previewed and not applied', async ({
    page,
  }) => {
    // In from the overview, so Back stays inside the app and the router asks.
    await page.goto('/settings');
    await page.getByRole('link', { name: 'Change How this site looks' }).click();
    await expect(page).toHaveURL(/\/settings\/look$/);
    await page.getByRole('radio', { name: 'Green screen' }).click();
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
