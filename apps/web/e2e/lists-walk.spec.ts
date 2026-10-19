/**
 * The /api/lists walk, in a real browser with the site password off: every
 * kind of list as a visitor meets it, and as somebody signed in. C3's door
 * walks (doors/doors.spec.ts) cover the same routes with the password ON; this
 * covers what a visitor meets on an open site, where the list itself decides.
 *
 *   listed and open   offered by GET /api/lists, the form opens, counts are
 *                     not published until an administrator says so
 *   listed, closed    not offered; the page says it is not taking anything
 *   team only         404 to a visitor, NEVER 403 (a 403 says it exists);
 *                     opens for somebody signed in
 *   hidden            404 to a visitor; a preview for an administrator
 *
 * And the subject access search, end to end: a visitor writes something, an
 * administrator finds it by their address, the visitor follows the erasure
 * link OUT OF THE EMAIL, and the same search then finds nothing.
 *
 * No page here asks another host for anything.
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { countTo, lastMessageTo, linkIn } from './identity/mail.ts';

test.use({ storageState: ADMIN });

const unique = (stem: string, project: string) =>
  `${stem}-${project}-${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

interface Made {
  id: number;
  slug: string;
  title: string;
}

/** Make a list through the administrators' API, with these settings. */
async function make(
  admin: APIRequestContext,
  template: string,
  slug: string,
  settings: Record<string, unknown>,
): Promise<Made> {
  const title = `Walk ${slug}`;
  const made = await admin.post('/api/admin/lists', { data: { template, slug, title } });
  expect(made.ok(), await made.text()).toBe(true);
  const { id } = (await made.json()) as { id: number };
  if (Object.keys(settings).length) {
    const set = await admin.patch(`/api/admin/lists/${String(id)}`, { data: settings });
    expect(set.ok(), await set.text()).toBe(true);
  }
  return { id, slug, title };
}

/** A visitor with no session at all, and every host their pages ask. */
async function visitor(browser: Browser): Promise<{ page: Page; outside: string[] }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return { page, outside };
}

test('every kind of list, as a visitor and as somebody signed in', async ({
  page,
  browser,
}, info) => {
  const p = info.project.name;
  const open = await make(page.request, 'tips', unique('walk-open', p), {
    visibility: 'listed',
  });
  const closed = await make(page.request, 'tips', unique('walk-closed', p), {
    visibility: 'listed',
    closed: true,
  });
  const team = await make(page.request, 'contact', unique('walk-team', p), {
    visibility: 'password',
  });
  const hidden = await make(page.request, 'check-ins', unique('walk-hidden', p), {});

  const v = await visitor(browser);

  // GET /api/lists: listed and taking entries, and nothing else.
  const offered = (await (await v.page.request.get('/api/lists')).json()) as {
    lists: { slug: string; title: string }[];
  };
  const slugs = offered.lists.map((l) => l.slug);
  expect(slugs).toContain(open.slug);
  for (const s of [closed.slug, team.slug, hidden.slug]) expect(slugs).not.toContain(s);

  // Listed and open: the form opens, one card at a time.
  await v.page.goto(`/list/${open.slug}`);
  await expect(v.page.getByRole('heading', { level: 1, name: open.title })).toBeVisible();
  await v.page.getByRole('button', { name: 'Start' }).click();
  await expect(v.page.getByRole('textbox', { name: 'Link' })).toBeVisible();
  // Counts are not published until an administrator publishes them.
  expect((await v.page.request.get(`/api/lists/${open.slug}/counts`)).status()).toBe(404);

  // Listed and closed: the page says so, and an entry is refused in words.
  await v.page.goto(`/list/${closed.slug}`);
  await expect(v.page.getByText('This form is not taking anything at the moment.')).toBeVisible();
  const refused = await v.page.request.post(`/api/lists/${closed.slug}/entries`, {
    data: { answers: {}, elapsed_ms: 9000 },
  });
  expect(refused.ok()).toBe(false);
  expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(
    /not taking anything/,
  );

  // Team only and hidden: 404 to a visitor, never 403, on the page and the API.
  for (const l of [team, hidden]) {
    await v.page.goto(`/list/${l.slug}`);
    await expect(v.page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
    await expect(v.page.getByText(l.title)).toHaveCount(0);
    expect((await v.page.request.get(`/api/lists/${l.slug}`)).status()).toBe(404);
  }
  expect(v.outside).toEqual([]);
  await v.page.context().close();

  // Signed in (an administrator): team only opens, and hidden is a preview.
  for (const l of [team, hidden]) {
    await page.goto(`/list/${l.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: l.title })).toBeVisible();
  }
});

test('an administrator finds what somebody wrote, and after they erase it, finds nothing', async ({
  page,
  browser,
}, info) => {
  const p = info.project.name;
  const list = await make(page.request, 'tips', unique('walk-sar', p), { visibility: 'listed' });
  const email = `${unique('asker', p)}@example.org`;
  const words = `WHAT-I-SAW-${p}-${Date.now().toString(36)}`;

  const v = await visitor(browser);
  await v.page.goto(`/list/${list.slug}`);
  await v.page.getByRole('button', { name: 'Start' }).click();
  await v.page.getByRole('textbox', { name: 'Link' }).fill('https://news.example.org/sar');
  await v.page.getByRole('button', { name: 'Next' }).click();
  await v.page.getByRole('radio', { name: 'Not sure' }).click();
  await v.page.getByRole('button', { name: 'Next' }).click();
  await v.page.getByRole('radio', { name: 'Not sure' }).click();
  await v.page.getByRole('button', { name: 'Next' }).click();
  await v.page.getByRole('textbox', { name: /Anything we should know/ }).fill(words);
  await v.page.getByRole('button', { name: 'Next' }).click();
  await v.page.getByLabel(/Your email address/).fill(email);
  // A form sent faster than it can be read is taken for a script.
  await v.page.waitForTimeout(2600);
  const before = countTo(email);
  await v.page.getByRole('button', { name: 'Send' }).click();
  await expect(v.page.getByRole('heading', { name: 'Sent. Thank you.' })).toBeVisible();

  // The administrator looks them up by the address they gave.
  await page.goto('/lists');
  await page.getByRole('link', { name: "Find somebody's entries" }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: "Find somebody's entries" }),
  ).toBeVisible();
  const search = async (q: string) => {
    await page.getByRole('searchbox', { name: 'Look for' }).fill(q);
    await page.getByRole('button', { name: 'Search' }).click();
  };
  await search(email);
  const found = page.getByRole('list', { name: 'Entries' }).getByRole('listitem');
  await expect(found).toHaveCount(1);
  await expect(found.getByText(words)).toBeVisible();
  await expect(found.getByText(email)).toBeVisible();
  await expect(found.getByText(list.title)).toBeVisible();
  // What was looked for is in no address.
  expect(page.url()).not.toContain(encodeURIComponent(email));
  expect(page.url()).not.toContain(email);

  // FOLLOW THE ERASURE LINK OUT OF THE EMAIL, and press its button.
  const link = linkIn(await lastMessageTo(email, before));
  expect(link).toMatch(/\/api\/forget\/[A-Za-z0-9_-]{40,}$/);
  await v.page.goto(link);
  await v.page.getByRole('button', { name: 'Delete it' }).click();
  await expect(v.page.getByRole('heading', { name: 'Deleted' })).toBeVisible();
  expect(v.outside).toEqual([]);
  await v.page.context().close();

  // The same searches now find nothing: not by the address, not by the words.
  await search(email);
  await expect(
    page.getByText(`Nothing on any list has “${email}” in it.`, { exact: false }),
  ).toBeVisible();
  await search(words);
  await expect(
    page.getByText(`Nothing on any list has “${words}” in it.`, { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Entries' })).toHaveCount(0);
});
