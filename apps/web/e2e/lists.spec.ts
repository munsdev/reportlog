/**
 * Lists in a real browser against the real server: an administrator makes a
 * list, a visitor fills it in, and the two links that only ever arrive by
 * email are FOLLOWED OUT OF THE EMAIL the server wrote. A path that only runs
 * when somebody clicks a link in an email is the path nothing reaches by
 * accident.
 *
 *   - the erasure link: opening it erases nothing (mail scanners open every
 *     link); pressing its button does.
 *   - the link that agrees to receive a list's entries: likewise.
 */
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { saveChanges } from './save-bar.ts';
import { countTo, lastMessageTo, linkIn } from './identity/mail.ts';

test.use({ storageState: ADMIN });

const unique = (stem: string, project: string) =>
  `${stem}-${project}-${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

/** Make a Tip List through the screens, make it listed, and return its address. */
async function makeTipList(page: Page, project: string): Promise<{ slug: string; title: string }> {
  const slug = unique('tips', project);
  const title = `Tips ${slug}`;
  await page.goto('/lists');
  await page.getByRole('button', { name: 'Make a list' }).click();
  await page.getByRole('radio', { name: 'No: links, check-ins or messages' }).click();
  await page.getByRole('radio', { name: 'Send a link' }).click();
  await page.getByLabel('Title (optional)').fill(title);
  await page.getByLabel('Web address (optional)').fill(slug);
  await page.getByRole('button', { name: 'Make the list' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Settings' }).click();
  await page.getByLabel('Who can see it').selectOption({ label: 'Listed' });
  await saveChanges(page);
  await expect(page.getByRole('button', { name: 'Edit Settings' })).toBeVisible();
  return { slug, title };
}

/** A visitor with no session at all. */
async function visitor(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return context.newPage();
}

test('a visitor sends a tip; the emailed link erases what they wrote, and only when they press the button', async ({
  page,
  browser,
}, info) => {
  const { slug } = await makeTipList(page, info.project.name);
  const email = `${unique('tipster', info.project.name)}@example.org`;
  const words = `SEEN-ON-THE-NEWS-${info.project.name}`;

  const v = await visitor(browser);
  const outside: string[] = [];
  v.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await v.goto(`/list/${slug}`);
  await expect(
    v.getByText('Nothing you send here is published. A moderator reads it.'),
  ).toBeVisible();
  await expect(v.getByText(/Nothing you send here is published/)).toBeVisible();
  await v.getByRole('button', { name: 'Start' }).click();

  await v
    .getByRole('textbox', { name: 'Link' })
    .fill('https://news.example.org/story?utm_source=x');
  await v.getByRole('button', { name: 'Next' }).click();
  await v.getByRole('radio', { name: 'Not sure' }).click();
  await v.getByRole('button', { name: 'Next' }).click();
  await v.getByRole('radio', { name: 'Not sure' }).click();
  await v.getByRole('button', { name: 'Next' }).click();
  await v.getByRole('textbox', { name: /Anything we should know/ }).fill(words);
  await v.getByRole('button', { name: 'Next' }).click();
  await expect(v.getByText(/Needed, because you wrote something/)).toBeVisible();
  await v.getByLabel(/Your email address/).fill(email);
  // A form sent faster than it can be read is taken for a script and quietly
  // dropped (MIN_FILL_MS on the server). A person takes longer than this.
  await v.waitForTimeout(2600);
  const before = countTo(email);
  await v.getByRole('button', { name: 'Send' }).click();
  await expect(v.getByRole('heading', { name: 'Sent. Thank you.' })).toBeVisible();
  await expect(v.getByText(/We emailed you a link that deletes/)).toBeVisible();
  expect(outside).toEqual([]);

  // The moderator sees the words, waiting.
  const review = async () => {
    await page.goto('/lists');
    await page.getByRole('link', { name: 'Review entries' }).click();
    await page.getByRole('link', { name: new RegExp(slug.replace(/-/g, '.')) }).click();
  };
  await review();
  await expect(page.getByText(words)).toBeVisible();

  // FOLLOW THE LINK OUT OF THE EMAIL. Opening it is what a mail scanner does,
  // and must erase nothing.
  const link = linkIn(await lastMessageTo(email, before));
  expect(link).toMatch(/\/api\/forget\/[A-Za-z0-9_-]{40,}$/);
  await v.goto(link);
  await expect(v.getByRole('heading', { name: 'Delete what you wrote' })).toBeVisible();
  await page.reload();
  await expect(page.getByText(words)).toBeVisible();

  await v.getByRole('button', { name: 'Delete it' }).click();
  await expect(v.getByRole('heading', { name: 'Deleted' })).toBeVisible();
  await page.reload();
  await expect(page.getByText(words)).toHaveCount(0);
  await expect(page.getByText(/Its personal half and its links have been deleted/)).toBeVisible();
  // Its link went with it, value and key (Plan D T3).
  await expect(page.getByText('news.example.org')).toHaveCount(0);

  // A link works once.
  await v.goto(link);
  await v.getByRole('button', { name: 'Delete it' }).click();
  await expect(v.getByRole('heading', { name: 'This link is finished' })).toBeVisible();
  await v.context().close();
});

test('an address named to receive entries agrees by its emailed link, and not by opening it', async ({
  page,
}, info) => {
  const { title } = await makeTipList(page, info.project.name);
  const to = `${unique('desk', info.project.name)}@example.org`;
  const before = countTo(to);
  await page.getByRole('button', { name: 'Edit Settings' }).click();
  await page.getByRole('checkbox', { name: 'Email each new entry' }).click();
  await page.getByLabel('Send them to (optional)').fill(to);
  await saveChanges(page);
  await expect(page.getByText(/A link was emailed to the new address/)).toBeVisible();

  const mail = await lastMessageTo(to, before);
  expect(mail.subject).toContain(title);
  const link = linkIn(mail);
  expect(link).toMatch(/\/api\/list-mail\//);

  const editor = page.url();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Receive new entries by email' })).toBeVisible();
  await page.goto(editor);
  await expect(page.getByText(`Waiting for ${to} to agree`, { exact: false })).toBeVisible();

  await page.goto(link);
  await page.getByRole('button', { name: 'Yes, send them to me' }).click();
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
  await expect(page.getByText(to)).toBeVisible();
  await page.goto(editor);
  await expect(page.getByText(`Going to ${to}.`)).toBeVisible();
});

test('a moderator approves the entries ticked on screen, and a published count moves with it', async ({
  page,
  browser,
}, info) => {
  const { slug } = await makeTipList(page, info.project.name);
  await page.getByRole('button', { name: 'Edit Settings' }).click();
  await page.getByRole('checkbox', { name: 'Publish the counts' }).click();
  await saveChanges(page);
  await expect(page.getByRole('button', { name: 'Edit Settings' })).toBeVisible();

  // Two entries with nothing personal in them: a link and two choices need
  // no address, so none is asked for.
  const v = await visitor(browser);
  for (const n of [1, 2]) {
    await v.goto(`/list/${slug}`);
    await v.getByRole('button', { name: 'Start' }).click();
    await v.getByRole('textbox', { name: 'Link' }).fill(`https://example.org/${String(n)}`);
    await v.getByRole('button', { name: 'Next' }).click();
    await v.getByRole('radio', { name: 'Not sure' }).click();
    await v.getByRole('button', { name: 'Next' }).click();
    await v.getByRole('radio', { name: 'Not sure' }).click();
    await v.getByRole('button', { name: 'Next' }).click();
    await v.getByRole('button', { name: 'Next' }).click();
    await expect(v.getByText(/Not needed: you have not written anything/)).toBeVisible();
    await v.waitForTimeout(2600);
    await v.getByRole('button', { name: 'Send' }).click();
    await expect(v.getByRole('heading', { name: 'Sent. Thank you.' })).toBeVisible();
  }

  const counts = async () =>
    (await v.request.get(`/api/lists/${slug}/counts`)).json() as Promise<{
      totals: { received: number; approved: number };
    }>;
  expect((await counts()).totals).toMatchObject({ received: 2, approved: 0 });

  await page.goto('/lists/review');
  await page.getByRole('link', { name: new RegExp(slug.replace(/-/g, '.')) }).click();
  const entries = page
    .getByRole('list', { name: 'Entries' })
    .getByRole('listitem')
    .filter({
      has: page.getByRole('checkbox'),
    });
  await expect(entries).toHaveCount(2);
  const approve = page.getByRole('button', { name: 'Approve the ticked entries' });
  await expect(approve).toBeDisabled();
  await entries.first().getByRole('checkbox').click();
  await approve.click();
  await expect(entries).toHaveCount(1);
  expect((await counts()).totals).toMatchObject({ received: 2, approved: 1 });
  await v.context().close();
});

test('a contact list that writes back says so on the form, and a reviewer can show the address', async ({
  page,
  browser,
}, info) => {
  const slug = unique('reach', info.project.name);
  const title = `Reach ${slug}`;
  await page.goto('/lists');
  await page.getByRole('button', { name: 'Make a list' }).click();
  await page.getByRole('radio', { name: 'No: links, check-ins or messages' }).click();
  await page.getByRole('radio', { name: 'Get in touch' }).click();
  await page.getByLabel('Title (optional)').fill(title);
  await page.getByLabel('Web address (optional)').fill(slug);
  await page.getByRole('button', { name: 'Make the list' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  // The contact starting point comes with the switch on.
  await page.getByRole('button', { name: 'Edit Settings' }).click();
  await expect(page.getByRole('checkbox', { name: 'We’ll write back' })).toBeChecked();
  await page.getByLabel('Who can see it').selectOption({ label: 'Listed' });
  await saveChanges(page);
  await expect(page.getByRole('button', { name: 'Edit Settings' })).toBeVisible();

  const email = `${unique('writer', info.project.name)}@example.org`;
  const v = await visitor(browser);
  await v.goto(`/list/${slug}`);
  await v.getByRole('button', { name: 'Start' }).click();
  await v.getByRole('textbox', { name: 'What is this about' }).fill('A question');
  await v.getByRole('button', { name: 'Next' }).click();
  await v.getByRole('textbox', { name: 'Your message' }).fill('Please reply to me');
  await v.getByRole('button', { name: 'Next' }).click();
  await expect(v.getByText(/The team will use this address to write back to you/)).toBeVisible();
  await v.getByLabel(/Your email address/).fill(email);
  // Faster than a person could read it is taken for a script (MIN_FILL_MS).
  await v.waitForTimeout(2600);
  await v.getByRole('button', { name: 'Send' }).click();
  await expect(v.getByRole('heading', { name: 'Sent. Thank you.' })).toBeVisible();
  await v.context().close();

  await page.goto('/lists/review');
  await page.getByRole('link', { name: new RegExp(slug.replace(/-/g, '.')) }).click();
  const entry = page.getByRole('list', { name: 'Entries' }).getByRole('listitem').first();
  // Nothing about the address is on the page until it is asked for.
  await expect(entry).not.toContainText(email);
  await entry.getByRole('button', { name: /^Show address for entry/ }).click();
  await expect(entry.getByText(email)).toBeVisible();
});

test('making a list asks first whether it should be a logbook', async ({ page }) => {
  await page.goto('/lists');
  await page.getByRole('button', { name: 'Make a list' }).click();
  await page.getByRole('radio', { name: 'Yes, it has to be permanent and checkable' }).click();
  await expect(page.getByText('Make a logbook instead')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to the logbooks' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make the list' })).toHaveCount(0);
});
