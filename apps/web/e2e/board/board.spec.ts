/**
 * The public board as a reader sees it: the page, a report in full, the
 * numbers, and the promise that no page here asks another host for anything.
 * The reports are approved through the API by an administrator, so this file
 * does not depend on the moderation screens.
 */
import { expect, test } from '@playwright/test';
import { ADMIN } from '../auth.ts';
import { countTo, lastMessageTo, linkIn } from '../identity/mail.ts';
import { doorFields } from '../door.ts';

const unique = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1e6))}`;

test.describe('the board', () => {
  let ref = '';
  let word = '';

  test.beforeAll(async ({ playwright }) => {
    // An administrator's API session approves a report filed by link.
    const admin = await playwright.request.newContext({
      baseURL: 'http://127.0.0.1:4173',
      storageState: ADMIN,
    });
    const anon = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4173' });
    word = `bq${unique()}`;
    const email = `reader-${word}@example.org`;
    const card = (await (await anon.get('/api/publication-card')).json()) as { digest: string };
    const before = countTo(email);
    const sent = await anon.post('/api/reports', {
      data: {
        ...(await doorFields(anon)),
        logbook: 'demo',
        email,
        consent: true,
        answers: { what: `Leaflets handed out inside polling place ${word}.` },
        may_publish: true,
        may_publish_digest: card.digest,
      },
    });
    expect(sent.ok(), await sent.text()).toBe(true);
    const token = /\/file\/confirm\/([a-f0-9]{64})/.exec(
      linkIn(await lastMessageTo(email, before)),
    )?.[1];
    const done = (await (await anon.post(`/api/reports/confirm/${token ?? ''}`)).json()) as {
      confirmation: { public_ref: string };
    };
    ref = done.confirmation.public_ref;
    const queue = (await (
      await admin.get(`/api/moderation/reports?status=pending&q=${word}`)
    ).json()) as { reports: { thread_id: string }[] };
    const thread = queue.reports[0]?.thread_id ?? '';
    const ok = await admin.post(`/api/moderation/reports/${thread}/decision`, {
      data: { status: 'valid', comment: 'Approved for the board test.' },
    });
    expect(ok.ok(), await ok.text()).toBe(true);
    await admin.dispose();
    await anon.dispose();
  });

  test('a reader finds a report by its words and reads it in full', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'View Live Report Board' }).click();
    await expect(page).toHaveURL(/\/board$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Live report board' })).toBeVisible();
    await page.getByLabel('Search the words').fill(word);
    // Nothing changes until the reader asks (decision 59).
    await expect(page.getByRole('status').filter({ hasText: word })).toHaveCount(0);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /^1 report\b/ })).toBeVisible();
    await page.getByRole('link', { name: `Read in full: ${ref}` }).click();
    await expect(page.getByRole('heading', { level: 1, name: ref })).toBeVisible();
    await expect(page.getByRole('region', { name: 'What the reporter said' })).toContainText(word);
    await page.getByRole('link', { name: 'Check this report' }).click();
    await expect(page).toHaveURL(new RegExp(`/verify/${ref}$`));
  });

  test('offers no built-in date or place filter', async ({ page }) => {
    await page.goto('/board');
    await page.getByRole('button', { name: /^Filter/ }).click();
    const form = page.getByRole('form', { name: 'Narrow the board' });
    await expect(form).toBeVisible();
    await expect(form.getByLabel(/date|when|where|place/i)).toHaveCount(0);
  });

  test('the numbers count published reports only, with the not-a-sample line beside them (decision 36, P3)', async ({
    page,
  }) => {
    await page.goto('/board/numbers');
    await expect(page.getByRole('heading', { level: 1, name: 'By the numbers' })).toBeVisible();
    await expect(
      page.getByText(/They are not a sample and cannot be read as a rate\./),
    ).toBeVisible();
    // No count of what was not approved is anywhere on the page.
    await expect(page.getByText('Under review')).toHaveCount(0);
    await expect(page.getByText('Declined')).toHaveCount(0);
    await expect(page.getByText('Every confirmed report')).toHaveCount(0);
  });

  test('no board page asks a third party for anything', async ({ page }) => {
    const outside: string[] = [];
    page.on('request', (r) => {
      const host = new URL(r.url()).hostname;
      if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
    });
    await page.goto('/board');
    await expect(page.getByRole('heading', { level: 1, name: 'Live report board' })).toBeVisible();
    await page.goto(`/board/${ref}`);
    await expect(page.getByRole('region', { name: 'What the reporter said' })).toBeVisible();
    await page.goto('/board/numbers');
    await expect(page.getByRole('heading', { level: 1, name: 'By the numbers' })).toBeVisible();
    expect(outside).toEqual([]);
  });
});

test.describe('the moderation screens', () => {
  test.use({ storageState: ADMIN });

  test('ask no third party for anything either', async ({ page }) => {
    const outside: string[] = [];
    page.on('request', (r) => {
      const host = new URL(r.url()).hostname;
      if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
    });
    await page.goto('/moderate');
    await expect(page.getByRole('heading', { level: 1, name: 'Reports queue' })).toBeVisible();
    await page.goto('/moderate/settings');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Moderation settings' }),
    ).toBeVisible();
    expect(outside).toEqual([]);
  });

  test('an administrator sees which state the keyword list is in', async ({ page }) => {
    await page.goto('/moderate/settings');
    await expect(
      page.getByRole('region', { name: 'Words that ask for a second read' }),
    ).toContainText(/The list that ships|This site’s own list|None: an administrator chose/);
  });

  test('downloads are off until an administrator offers them, and the board follows', async ({
    page,
  }, info) => {
    // A site-wide switch: one project turns it, or desktop and phone would
    // flip it under each other.
    test.skip(info.project.name !== 'chromium', 'a site-wide switch, turned by one project');
    const csvLink = page.getByRole('link', { name: 'Download these (CSV)' });
    await page.goto('/moderate/settings');
    const archive = page.getByRole('region', { name: 'The public archive' });
    await expect(archive).toContainText('Nobody has chosen, which means no downloads.');
    expect((await page.request.get('/api/board/reports.csv')).status()).toBe(404);
    await page.goto('/board');
    await expect(page.getByRole('status').filter({ hasText: /^\d+ reports?\b/ })).toBeVisible();
    await expect(csvLink).toHaveCount(0);

    await page.goto('/moderate/settings');
    // A setting panel: Edit, tick, then the Save bar, which names what it saves.
    await archive.getByRole('button', { name: 'Edit The public archive' }).click();
    await archive.getByRole('checkbox', { name: 'Offer downloads of the whole archive' }).click();
    const bar = page.getByRole('region', { name: 'Save changes' });
    await expect(bar).toContainText('The public archive');
    await bar.getByRole('button', { name: 'Save' }).click();
    await expect(archive).toContainText('Offered: the board as a spreadsheet');
    try {
      await page.goto('/board');
      await expect(csvLink).toBeVisible();
      const csv = await page.request.get('/api/board/reports.csv');
      expect(csv.status()).toBe(200);
      expect(csv.headers()['content-type']).toMatch(/text\/csv/);
    } finally {
      // Put back as the run found it, so a retry starts from "nobody chose".
      await page.request.put('/api/admin/moderation/archive', { data: { distribution: null } });
    }
    await page.goto('/board');
    await expect(page.getByRole('status').filter({ hasText: /^\d+ reports?\b/ })).toBeVisible();
    await expect(csvLink).toHaveCount(0);
  });
});
