/**
 * `/submit`, where the front page's "Submit a Report" goes: a choice of the
 * logbooks open now (legacy's logbook.test.js and form.js).
 *
 * Several open logbooks are real ones, made for the test. The other cases
 * need a site with exactly one open logbook, or none, or an intro written,
 * which the whole suite shares, so those answers are stood in for in this
 * page alone and nothing is changed for the tests running beside it.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from '../auth.ts';
import { expectAccessible } from './axe.ts';

const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

const chooser = (page: Page) =>
  page.getByRole('heading', { level: 1, name: 'What are you reporting?' });

/** The answers on the card: each a link named by what it opens and what pressing it does. */
const answers = (page: Page) =>
  page.getByRole('main').getByRole('link', { name: /(File a report|Send a link)$/ });

/** This page alone is told these are the logbooks open now. */
async function onlyOpen(page: Page, logbooks: { slug: string; title: string; blurb: string }[]) {
  await page.route(
    (url) => url.pathname === '/api/logbooks',
    (route) =>
      route.fulfill({
        json: { logbooks: logbooks.map((l) => ({ ...l, state: 'open', questions: 1 })) },
      }),
  );
}

/** This page alone is told the operator wrote this intro. */
async function intro(page: Page, text: string) {
  await page.route(
    (url) => url.pathname === '/api/site',
    async (route) => {
      const real = await route.fetch();
      const site = (await real.json()) as { copy: Record<string, string> };
      await route.fulfill({
        response: real,
        json: { ...site, copy: { ...site.copy, submit_intro: text } },
      });
    },
  );
}

test('several open logbooks: each is offered, with what it is for, and opens its own form', async ({
  page,
  playwright,
}, info) => {
  const admin = await playwright.request.newContext({
    baseURL: info.project.use.baseURL ?? 'http://127.0.0.1:4173',
    storageState: ADMIN,
  });
  const made: { slug: string; title: string; blurb: string }[] = [];
  for (const what of ['Polling places', 'Postal votes']) {
    const title = `${what} ${info.project.name} ${run()}`;
    const blurb = `For anything about ${what.toLowerCase()}.`;
    const r = await admin.post('/api/admin/logbooks', { data: { title, blurb } });
    expect(r.ok(), await r.text()).toBe(true);
    const lb = (await r.json()) as { id: number; slug: string };
    const q = await admin.post(`/api/admin/logbooks/${String(lb.id)}/fields`, {
      data: { kind: 'private_text', label: 'What happened?', required: true },
    });
    expect(q.ok(), await q.text()).toBe(true);
    expect((await admin.post(`/api/admin/logbooks/${String(lb.id)}/launch`)).ok()).toBe(true);
    made.push({ slug: lb.slug, title, blurb });
  }
  await admin.dispose();

  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await page.goto('/submit');
  await expect(chooser(page)).toBeVisible();
  for (const lb of made) {
    const option = page.getByRole('link', { name: new RegExp(lb.title) });
    await expect(option).toBeVisible();
    await expect(page.getByText(lb.blurb).first()).toBeVisible();
  }
  await expectAccessible(page, '/submit with several logbooks');

  const second = made[1];
  if (!second) throw new Error('two logbooks were made');
  // Each answer is a card that is a link: pressing it opens the form.
  await page.getByRole('link', { name: new RegExp(second.title) }).click();
  await expect(page).toHaveURL(new RegExp(`/file/${second.slug}$`));
  await expect(page.getByRole('heading', { level: 1, name: second.title })).toBeVisible();
  expect(outside).toEqual([]);
});

/** This page alone is told these are the lists open now. */
async function openLists(page: Page, lists: { slug: string; title: string; blurb: string }[]) {
  await page.route(
    (url) => url.pathname === '/api/lists',
    // Shaped as the API answers, or the page refuses the answer.
    (route) =>
      route.fulfill({
        json: { lists: lists.map((l) => ({ ...l, on_get_involved: false, is_contact: false })) },
      }),
  );
}

test('one open logbook and an intro written: the intro and the one answer, and a button', async ({
  page,
}) => {
  const words = 'Read this before you start: we never ask for your name.';
  await onlyOpen(page, [{ slug: 'demo', title: 'The only one open', blurb: 'What it is for.' }]);
  await openLists(page, []);
  await intro(page, words);
  await page.goto('/submit');
  await expect(chooser(page)).toBeVisible();
  await expect(page.getByText(words)).toBeVisible();
  await expectAccessible(page, '/submit with an intro');
  await page.getByRole('link', { name: /The only one open/ }).click();
  await expect(page).toHaveURL(/\/file\/demo$/);
});

test('one open logbook and no intro: still a card, never a redirect (E2, E3)', async ({ page }) => {
  await onlyOpen(page, [{ slug: 'demo', title: 'The only one open', blurb: '' }]);
  await openLists(page, []);
  await intro(page, '');
  await page.goto('/submit');
  await expect(chooser(page)).toBeVisible();
  await expect(page).toHaveURL(/\/submit$/);
  // Nothing moves on by itself: the card waits to be pressed.
  await expect(page.getByRole('link', { name: /The only one open/ })).toBeVisible();
});

test('a link or tip is the other answer, and goes to the tip form', async ({ page }) => {
  await onlyOpen(page, [{ slug: 'demo', title: 'I was at a polling place', blurb: '' }]);
  await openLists(page, [{ slug: 'tips', title: 'Send a link', blurb: 'A post or video.' }]);
  await page.goto('/submit');
  await expect(answers(page)).toHaveCount(2);
  await expectAccessible(page, '/submit with the tip answer');
  await page
    .getByRole('link', { name: /Send a link/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/list\/tips$/);
});

test('nothing open: it says so, rather than showing an empty list', async ({ page }) => {
  await onlyOpen(page, []);
  await page.goto('/submit');
  await expect(chooser(page)).toBeVisible();
  await expect(page.getByText('Nothing is taking reports at the moment.')).toBeVisible();
  // No answers to choose from; the page still links to the front page and the board.
  await expect(answers(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'The board' })).toBeVisible();
  await expectAccessible(page, '/submit with nothing open');
});

/** The tips form as the API describes it: a state to choose and a time. */
const TIPS_FORM = {
  slug: 'tips',
  title: 'Send a link',
  blurb: null,
  accepting: true,
  opens_at: null,
  closes_at: null,
  asks_email: false,
  email_when: 'never',
  email_reason: 'erase',
  write_back: false,
  personal_keys: [],
  personal_days: null,
  fields: [
    {
      key: 'state',
      kind: 'choice_one',
      label: 'Where',
      help: null,
      required: true,
      max_values: 1,
      options: ['Not sure', 'Ohio', 'Texas'],
      allow_other: false,
      erased: false,
    },
    {
      key: 'time',
      kind: 'time',
      label: 'About when',
      help: null,
      required: false,
      max_values: 1,
      options: [],
      allow_other: false,
      erased: false,
    },
  ],
};

test('E5: the tip form starts with the filed report’s state and time, and sends no reference', async ({
  page,
}) => {
  // What the filing form leaves in this browser when a report is sent.
  await page.addInitScript(() => {
    localStorage.setItem(
      'reportlog:tip-prefill',
      JSON.stringify({ at: Date.now(), values: { state: 'Ohio', time: '07:30' } }),
    );
  });
  await page.route(
    (url) => url.pathname === '/api/lists/tips',
    (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: TIPS_FORM });
      return route.fulfill({ json: { ok: true } });
    },
  );
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') sent.push(`${r.url()}\n${r.postData() ?? ''}`);
  });
  await page.goto('/list/tips');
  await page
    .getByRole('button', { name: /start|begin|next|continue/i })
    .first()
    .click();
  await expect(page.getByRole('radio', { name: 'Ohio' })).toBeChecked();
  await page
    .getByRole('button', { name: /next|continue/i })
    .first()
    .click();
  await expect(page.getByRole('textbox', { name: /^About when/ })).toHaveValue('07:30');
  await page
    .getByRole('button', { name: /^(send|file|submit)/i })
    .first()
    .click();
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  const filing = sent.join('\n');
  expect(filing).toContain('Ohio');
  // Nothing says which report this follows.
  expect(filing).not.toMatch(/RL-|public_ref|thread|token|report/i);
});
