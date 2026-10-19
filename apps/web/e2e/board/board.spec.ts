/**
 * The public board as a reader sees it: the page, a report in full, the
 * numbers, and the promise that no page here asks another host for anything.
 * The reports are approved through the API by an administrator, so this file
 * does not depend on the moderation screens.
 */
import { expect, test } from '@playwright/test';
import { ADMIN } from '../auth.ts';
import { countTo, lastMessageTo, linkIn } from '../identity/mail.ts';

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
    await expect(page.getByRole('heading', { level: 1, name: 'Report board' })).toBeVisible();
    await page.getByLabel('Search the words').fill(word);
    // Nothing changes until the reader asks.
    await expect(page.getByRole('status').first()).not.toContainText('match');
    await page.getByRole('button', { name: 'Show reports' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '1 published report match' }),
    ).toBeVisible();
    await page.getByRole('link', { name: `Read ${ref} in full` }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Report ${ref}` })).toBeVisible();
    await expect(page.getByRole('region', { name: 'What the reporter said' })).toContainText(word);
    await page.getByRole('link', { name: 'Check it has not been changed' }).click();
    await expect(page).toHaveURL(new RegExp(`/verify/${ref}$`));
  });

  test('offers no built-in date or place filter', async ({ page }) => {
    await page.goto('/board');
    const form = page.getByRole('form', { name: 'Narrow the board' });
    await expect(form).toBeVisible();
    await expect(form.getByLabel(/date|when|where|place/i)).toHaveCount(0);
  });

  test('the numbers come broken out, with the denominator', async ({ page }) => {
    await page.goto('/board/numbers');
    await expect(page.getByRole('heading', { name: 'Every confirmed report' })).toBeVisible();
    await expect(page.getByText('Under review')).toBeVisible();
    await expect(page.getByText('Declined')).toBeVisible();
  });

  test('no board page asks a third party for anything', async ({ page }) => {
    const outside: string[] = [];
    page.on('request', (r) => {
      const host = new URL(r.url()).hostname;
      if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
    });
    await page.goto('/board');
    await expect(page.getByRole('heading', { level: 1, name: 'Report board' })).toBeVisible();
    await page.goto(`/board/${ref}`);
    await expect(page.getByRole('region', { name: 'What the reporter said' })).toBeVisible();
    await page.goto('/board/numbers');
    await expect(page.getByRole('heading', { name: 'Every confirmed report' })).toBeVisible();
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
    await expect(page.getByRole('heading', { level: 1, name: 'Moderation' })).toBeVisible();
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
    ).toContainText(/Using the list that ships|this site’s own list|No keyword matching/);
  });
});
