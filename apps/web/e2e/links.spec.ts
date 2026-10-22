/**
 * Tip links in a real browser (Plan D §5, §8): the visitor sees the wording
 * above the link field (K2); the moderator sees each link as TEXT, never an
 * anchor, and the page asks no other host for anything (K6, X1); a check, a
 * comment for journalists, and "illegal" with a domain block, after which a
 * later copy from that site is erased on arrival (K13).
 */
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { ADMIN } from './auth.ts';

test.use({ storageState: ADMIN });

const unique = (stem: string, project: string) =>
  `${stem}-${project}-${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

async function makeTipList(page: Page, project: string): Promise<string> {
  const slug = unique('links', project);
  await page.goto('/lists');
  await page.getByRole('button', { name: 'Make a list' }).click();
  await page.getByRole('radio', { name: 'No: links, check-ins or messages' }).click();
  await page.getByRole('radio', { name: 'Send a link' }).click();
  await page.getByLabel('Title (optional)').fill(`Links ${slug}`);
  await page.getByLabel('Web address (optional)').fill(slug);
  await page.getByRole('button', { name: 'Make the list' }).click();
  await page.getByLabel('Who can see it').selectOption({ label: 'Listed' });
  await page.getByRole('button', { name: 'Save the settings' }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  return slug;
}

/** A visitor sends one link and two "Not sure" answers, through the form. */
async function sendTip(browser: Browser, slug: string, link: string): Promise<void> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const v = await context.newPage();
  await v.goto(`/list/${slug}`);
  await v.getByRole('button', { name: 'Start' }).click();
  await expect(v.getByTestId('link-wording')).toHaveText(
    "Links you send here are never published. A moderator checks each one, and links that pass may be shared with vetted journalists. Don't link to your own account if you want to stay anonymous.",
  );
  await v.getByRole('textbox', { name: 'Link' }).fill(link);
  await v.getByRole('button', { name: 'Next' }).click();
  await v.getByRole('radio', { name: 'Not sure' }).click();
  await v.getByRole('button', { name: 'Next' }).click();
  await v.getByRole('radio', { name: 'Not sure' }).click();
  await v.getByRole('button', { name: 'Next' }).click();
  // The optional words, skipped. The Tip List always asks for an address.
  await v.getByRole('button', { name: 'Next' }).click();
  await v.getByLabel(/Your email address/).fill(`tipster-${String(Date.now())}@example.org`);
  await v.waitForTimeout(2600);
  await v.getByRole('button', { name: 'Send' }).click();
  await expect(v.getByRole('heading', { name: 'Sent. Thank you.' })).toBeVisible();
  await context.close();
}

test('a moderator checks a link as text, comments for journalists, and erases and blocks an illegal one', async ({
  page,
  browser,
}, info) => {
  const slug = await makeTipList(page, info.project.name);
  const tag = unique('k', info.project.name).toLowerCase();
  const good = `https://good-${tag}.example.org/clip`;
  const bad = `https://bad-${tag}.example.org/x`;
  await sendTip(browser, slug, good);
  await sendTip(browser, slug, bad);

  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await page.goto('/lists/links');
  await expect(page.getByRole('heading', { level: 1, name: 'Check links' })).toBeVisible();
  // X5: the procedure is linked from the screen.
  await expect(page.getByRole('link', { name: 'jugendschutz.net' })).toBeVisible();

  const card = (url: string) =>
    page.getByRole('list', { name: 'Links' }).getByRole('listitem').filter({ hasText: url });
  await expect(card(good)).toBeVisible();
  // K6: text, never an anchor, so nothing on the page can open or prefetch it.
  await expect(page.locator(`a[href*="${tag}"]`)).toHaveCount(0);

  await card(good)
    .getByLabel(/^Checked/)
    .check();
  await card(good).getByRole('button', { name: 'Record the check' }).click();
  await expect(card(good)).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Show links that are' })
    .getByRole('button', { name: 'Passed' })
    .click();
  await expect(card(good)).toBeVisible();
  await expect(card(good).getByText(/Journalists will read this/)).toBeVisible();
  await card(good).getByLabel('Comment for journalists').fill('The station’s own upload.');
  await card(good).getByRole('button', { name: 'Save the comment' }).click();
  await expect(card(good).getByText('Saved.')).toBeVisible();
  await card(good).getByRole('button', { name: 'Show the history' }).click();
  await expect(card(good).getByRole('list', { name: 'History' })).toContainText('comment');

  await page
    .getByRole('group', { name: 'Show links that are' })
    .getByRole('button', { name: 'Waiting' })
    .click();
  await card(bad)
    .getByLabel(/^Illegal/)
    .check();
  const erase = card(bad).getByRole('button', { name: 'Erase every copy' });
  await expect(erase).toBeDisabled();
  await card(bad).getByLabel('Why it is illegal').selectOption({ label: 'Other illegal content' });
  await card(bad).getByLabel('Stop it coming back').selectOption({ value: 'domain' });
  await card(bad)
    .getByLabel(/I have followed the procedure/)
    .check();
  await erase.click();
  await expect(card(bad)).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Blocked' })).toContainText('A whole site');

  // A later copy from a subdomain of the blocked site never arrives.
  await sendTip(browser, slug, `https://www.bad-${tag}.example.org/again`);
  await page.reload();
  await expect(page.getByText(`bad-${tag}`)).toHaveCount(0);
  expect(outside).toEqual([]);
});
