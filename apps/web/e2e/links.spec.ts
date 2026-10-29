/**
 * Tip links in a real browser (Plan D §5, §8): the visitor sees the wording
 * above the link field (K2); the moderator sees each link as TEXT, never an
 * anchor, on the list entry that sent it, and the page asks no other host
 * for anything (K6, X1); a verdict, a comment for journalists, and "illegal"
 * with a domain block, after which a later copy from that site is erased on
 * arrival (K13). The Links page that did this is a filter now
 * (moderation-unified.md); its old address is followed too.
 */
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { doorFields } from './door.ts';
import { saveChanges } from './save-bar.ts';

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
  await page.getByRole('button', { name: 'Change Settings' }).click();
  await page.getByLabel('Who can see it').selectOption({ label: 'Listed' });
  await saveChanges(page);
  await expect(page.getByRole('button', { name: 'Change Settings' })).toBeVisible();
  return slug;
}

/**
 * A visitor opens the form and sees the wording above the link field (K2);
 * the tip itself goes straight to the API, as a form would send it, with the
 * door's fields. `description` is the optional words: a written account.
 */
async function sendTip(
  browser: Browser,
  slug: string,
  link: string,
  description?: string,
): Promise<void> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const v = await context.newPage();
  await v.goto(`/list/${slug}`);
  await v.getByRole('button', { name: 'Start' }).click();
  await expect(v.getByTestId('link-wording')).toHaveText(
    "Links you send here are never published. A moderator checks each one, and links that pass may be shared with vetted journalists. Don't link to your own account if you want to stay anonymous.",
  );
  const sent = await v.request.post(`/api/lists/${slug}/entries`, {
    data: {
      ...(await doorFields(v.request)),
      answers: {
        links: link,
        state: 'Not sure',
        category: 'Not sure',
        ...(description ? { description } : {}),
      },
      email: `tipster-${String(Date.now())}@example.org`,
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  await context.close();
}

test('a moderator judges a link as text on its entry, comments for journalists, and erases and blocks an illegal one', async ({
  page,
  browser,
}, info) => {
  const slug = await makeTipList(page, info.project.name);
  const tag = unique('k', info.project.name).toLowerCase();
  const good = `https://good-${tag}.example.org/clip`;
  const bad = `https://bad-${tag}.example.org/x`;
  await sendTip(browser, slug, good, `The council’s own clip ${tag}`);
  await sendTip(browser, slug, bad);

  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });

  // The Links page became a filter (moderation-unified.md): its address
  // still works, and lands on the reports queue, narrowed to links to check.
  await page.goto('/lists/links');
  await expect(page).toHaveURL(/\/moderate\?links=true$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Reports queue' })).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Only reports that' })
      .getByRole('button', { name: /^Has links to check/ }),
  ).toHaveAttribute('aria-pressed', 'true');

  // A list's entries are judged on its review page, the entries' hub.
  await page.goto('/lists/review');
  await page.getByRole('link', { name: `Open Links ${slug}` }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: `Review: Links ${slug}` }),
  ).toBeVisible();
  const only = page.getByRole('group', { name: 'Only entries that' });
  await only.getByRole('button', { name: 'Has links to check' }).click();
  await expect(page).toHaveURL(/links=true/);

  // Each entry is a panel of its own (the links inside it are a list).
  const entry = (url: string) =>
    page.getByRole('main').getByRole('article').filter({ hasText: url });
  await expect(entry(good)).toBeVisible();
  await expect(entry(bad)).toBeVisible();
  // K6: text, never an anchor, so nothing on the page can open or prefetch it.
  await expect(page.locator(`a[href*="${tag}"]`)).toHaveCount(0);

  await expect(entry(good).getByText(/^Not judged yet\./)).toBeVisible();
  await entry(good).getByRole('button', { name: 'Judge this link' }).click();
  await entry(good)
    .getByLabel(/^Passes/)
    .check();
  await entry(good).getByRole('button', { name: 'Record the verdict' }).click();
  // Judged, it is no longer "to check", so the filtered page lets it go.
  await expect(entry(good)).toHaveCount(0);
  await only.getByRole('button', { name: 'Has links to check' }).click();
  await expect(entry(good).getByText(/^Passes: vetted journalists may see it\./)).toBeVisible();
  await expect(entry(good).getByText(/Journalists will read this/)).toBeVisible();
  await entry(good).getByLabel('Comment for journalists').fill('The station’s own upload.');
  await entry(good).getByRole('button', { name: 'Save the comment' }).click();
  await expect(entry(good).getByText('Saved.')).toBeVisible();
  await entry(good).getByRole('button', { name: 'Show the link’s history' }).click();
  await expect(entry(good).getByRole('group', { name: 'History' })).toContainText('comment');

  // Its written account is decided on the entry too: a tip always allows a
  // note, and leaving it for staff asks no reason.
  const account = entry(good).getByRole('region', { name: /^Written account/ });
  await expect(account.getByRole('button', { name: 'Write a note for journalists' })).toBeVisible();
  await account.getByRole('button', { name: 'Leave it with the entry (staff only)' }).click();
  await expect(account).toContainText('Left here, for staff only');

  await entry(bad).getByRole('button', { name: 'Judge this link' }).click();
  await entry(bad)
    .getByLabel(/^Illegal/)
    .check();
  // X5: the procedure is beside the choice.
  await expect(entry(bad).getByRole('link', { name: 'jugendschutz.net' })).toBeVisible();
  const erase = entry(bad).getByRole('button', { name: 'Erase every copy' });
  await expect(erase).toBeDisabled();
  await entry(bad).getByLabel('Why it is illegal').selectOption({ label: 'Other illegal content' });
  await entry(bad).getByLabel('Stop it coming back').selectOption({ value: 'domain' });
  await entry(bad)
    .getByLabel(/I have followed the procedure/)
    .check();
  await erase.click();
  await expect(page.getByText(bad)).toHaveCount(0);

  // The blocklist is its own page now, in Safety.
  await page.goto('/moderate/blocklist');
  await expect(page.getByRole('heading', { level: 1, name: 'Link blocklist' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('A whole site');

  // A later copy from a subdomain of the blocked site never arrives.
  await sendTip(browser, slug, `https://www.bad-${tag}.example.org/again`);
  await page.goBack();
  await page.reload();
  await expect(entry(good)).toBeVisible();
  await expect(page.getByText(`bad-${tag}`)).toHaveCount(0);
  expect(outside).toEqual([]);
});
