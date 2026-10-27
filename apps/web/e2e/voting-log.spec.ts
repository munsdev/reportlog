/**
 * The voting forms in a real browser (docs/voting-questionnaires.md),
 * from the shipped presets:
 *
 *   the logbook through every card, in person with a problem and by mail
 *     going fine: a card with two dropdowns (the county inactive until a
 *     state is chosen, and cleared when the state changes), the hour shown
 *     only in person, the problem list that follows the method, provisional
 *     offered only in person, labels shown and codes sent;
 *   the tip card's three fixed rows of a link and its kind, no email card;
 *   the entry card's question and its two answers.
 *
 * Every card passes the accessibility check, and no page asks another host
 * for anything.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { expectAccessible } from './filing/axe.ts';

test.use({ storageState: ADMIN });

const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

function watch(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

/** The report the page sends, captured on its way. */
function sentReports(page: Page): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/reports') {
      sent.push(r.postDataJSON() as Record<string, unknown>);
    }
  });
  return sent;
}

/** This page alone is told the operator wrote these slots. */
async function copy(page: Page, slots: Record<string, string>) {
  await page.route(
    (url) => url.pathname === '/api/site',
    async (route) => {
      const real = await route.fetch();
      const site = (await real.json()) as { copy: Record<string, string> };
      await route.fulfill({ response: real, json: { ...site, copy: { ...site.copy, ...slots } } });
    },
  );
}

/** The voting logbook, from its starting point, launched. */
async function votingLogbook(page: Page): Promise<string> {
  const made = await page.request.post('/api/admin/logbooks', {
    data: { title: `Log how voting went ${run()}`, starting_point: 'how-voting-went' },
  });
  expect(made.ok(), await made.text()).toBe(true);
  const lb = (await made.json()) as { id: number; slug: string };
  const launched = await page.request.post(`/api/admin/logbooks/${String(lb.id)}/launch`);
  expect(launched.ok(), await launched.text()).toBe(true);
  return lb.slug;
}

const heading = (page: Page, name: string) =>
  expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true }).click();

/**
 * The spine's cards, then the review. No address card: the form asks no text
 * question and takes no files, so it asks for no email (owner decision E1).
 */
async function finish(page: Page) {
  await page.getByRole('radio', { name: 'Yes, it may be published' }).click();
  await next(page);
  await heading(page, 'Check your answers');
  await expect(page.getByText('Your email address')).toHaveCount(0);
}

async function send(page: Page) {
  await page.getByRole('checkbox', { name: /I confirm this report is accurate/ }).click();
  // Send waits for the puzzle, solved in the background in this page.
  await page.getByRole('button', { name: 'Send report' }).click();
  // Sealed on arrival: nothing to confirm, and no reference handed out.
  await expect(page.getByRole('heading', { level: 1, name: /is on the record/ })).toBeVisible();
  await expect(page.getByText(/A moderator reads it before anything is public/)).toBeVisible();
  await expect(page.getByText(/Thank you\. Have a link\?/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Send a link' })).toHaveAttribute(
    'href',
    '/list/tips',
  );
}

test('in person, something went wrong: every card, the parts of a card, the in-person lists', async ({
  page,
}) => {
  const slug = await votingLogbook(page);
  await copy(page, { send_note: "This report can't be changed or withdrawn after you send it." });
  const outside = watch(page);
  const sent = sentReports(page);
  await page.goto(`/file/${slug}`);
  await page.getByRole('button', { name: 'Start' }).click();

  await heading(page, 'How did it go?');
  await page.getByRole('radio', { name: 'Something went wrong' }).click();
  // No auto-advance: choosing moves nobody on.
  await heading(page, 'How did it go?');
  await expectAccessible(page, 'card 1');
  await next(page);

  await heading(page, 'How did you vote, or try to vote?');
  await page.getByRole('radio', { name: 'In person on election day' }).click();
  await next(page);

  await heading(page, 'Which state and county?');
  await expect(page.getByText('The county where the polling place was.')).toBeVisible();
  const state = page.getByRole('combobox', { name: 'State' });
  const county = page.getByRole('combobox', { name: 'County' });
  await expect(county).toBeDisabled();
  await state.selectOption({ label: 'Texas' });
  await expect(county).toBeEnabled();
  await county.selectOption({ label: 'Travis County' });
  // Changing the state clears the county.
  await state.selectOption({ label: 'Arizona' });
  await expect(county).toHaveValue('');
  await expect(county.getByRole('option', { name: 'Travis County' })).toHaveCount(0);
  await county.selectOption({ label: 'Maricopa County' });
  await expectAccessible(page, 'card 3');
  await next(page);

  await heading(page, 'When was it?');
  await page.getByLabel('Date').fill('2026-11-03');
  await page.getByRole('combobox', { name: 'Hour' }).selectOption({ label: '9 am' });
  await page.getByRole('checkbox', { name: 'Approximate' }).click();
  await expectAccessible(page, 'card 4');
  await next(page);

  await heading(page, 'Were you there as');
  await page.getByRole('radio', { name: 'A poll worker' }).click();
  await next(page);
  await heading(page, 'How long did you wait?');
  await page.getByRole('radio', { name: '1 to 2 hours' }).click();
  await next(page);

  await heading(page, 'What went wrong? Tick everything that applies.');
  await expect(page.getByRole('checkbox', { name: 'Ballot never arrived' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Wrong ballot, or a ballot with errors' }).click();
  await page.getByRole('checkbox', { name: 'Turned away without voting' }).click();
  await expectAccessible(page, 'card 7, in person');
  await next(page);

  await heading(page, 'Did you vote?');
  await page.getByRole('radio', { name: 'Yes, a provisional ballot' }).click();
  await expectAccessible(page, 'card 8, in person');
  await next(page);

  await finish(page);
  // The review says it in words, never codes.
  const review = page.getByRole('main');
  await expect(review.getByText('Maricopa County, Arizona')).toBeVisible();
  await expect(review.getByText('9 am', { exact: true })).toBeVisible();
  await expect(review.getByText('Yes, a provisional ballot')).toBeVisible();
  await expect(
    review.getByText("This report can't be changed or withdrawn after you send it."),
  ).toBeVisible();
  await expectAccessible(page, 'the send card');
  await send(page);

  expect(sent).toHaveLength(1);
  expect(sent[0]?.answers).toEqual({
    outcome: 'problem',
    method: 'election_day',
    state: 'AZ',
    county: '04013',
    date: '2026-11-03',
    hour: '9',
    hour_approx: 'yes',
    role: 'poll_worker',
    wait: '60_120',
    problems: ['turned_away', 'wrong_ballot'],
    voted: 'provisional',
  });
  expect(typeof sent[0]?.form).toBe('string');
  // The door, from this page: a start token, the puzzle solved here by the
  // widget (a solution to the server's own challenge), the empty hidden box,
  // and no address at all.
  expect(sent[0]?.start).toMatch(/^\d{13}\./);
  const solved = JSON.parse(Buffer.from(String(sent[0]?.altcha), 'base64').toString()) as {
    challenge: { parameters: { algorithm: string } };
    solution: { counter: number };
  };
  expect(solved.challenge.parameters.algorithm).toBe('PBKDF2/SHA-256');
  expect(typeof solved.solution.counter).toBe('number');
  expect(sent[0]?.website).toBe('');
  expect(sent[0]).not.toHaveProperty('email');
  expect(outside).toEqual([]);
});

test('by mail, it went fine: no clock, no role or wait, straight to sending', async ({ page }) => {
  const slug = await votingLogbook(page);
  const outside = watch(page);
  const sent = sentReports(page);
  await page.goto(`/file/${slug}`);
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('radio', { name: 'It went fine' }).click();
  await next(page);
  await page.getByRole('radio', { name: 'By mail' }).click();
  await next(page);

  await heading(page, 'Which state and county?');
  await expect(page.getByText('The county where you are registered.')).toBeVisible();
  await page.getByRole('combobox', { name: 'State' }).selectOption({ label: 'Louisiana' });
  await page.getByRole('combobox', { name: 'County' }).selectOption({ label: 'Orleans Parish' });
  await next(page);

  await heading(page, 'When was it?');
  await expect(page.getByRole('combobox', { name: 'Hour' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Approximate' })).toHaveCount(0);
  // One part left on the card: the card's own question names it.
  await page.getByLabel('When was it?').fill('2026-10-28');
  await expectAccessible(page, 'card 4, by mail');
  await next(page);

  // Fine: the next card is the publication card, then sending.
  await expect(page.getByRole('radio', { name: 'Yes, it may be published' })).toBeVisible();
  await finish(page);
  await send(page);
  expect(sent[0]?.answers).toEqual({
    outcome: 'fine',
    method: 'mail',
    state: 'LA',
    county: '22071',
    date: '2026-10-28',
  });
  expect(outside).toEqual([]);
});

test('by mail, something went wrong: the mail list, and no provisional ballot', async ({
  page,
}) => {
  const slug = await votingLogbook(page);
  await page.goto(`/file/${slug}`);
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('radio', { name: 'Something went wrong' }).click();
  await next(page);
  await page.getByRole('radio', { name: 'By mail' }).click();
  await next(page);
  await page.getByRole('combobox', { name: 'State' }).selectOption({ label: 'Arizona' });
  await page.getByRole('combobox', { name: 'County' }).selectOption({ label: 'Pima County' });
  await next(page);
  await page.getByLabel('When was it?').fill('2026-10-28');
  await next(page);
  await heading(page, 'What went wrong? Tick everything that applies.');
  await expect(page.getByRole('checkbox', { name: 'Turned away without voting' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Ballot arrived late' }).click();
  await expectAccessible(page, 'card 7, by mail');
  await next(page);
  await heading(page, 'Did you vote?');
  await expect(page.getByRole('radio', { name: 'Yes, a provisional ballot' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Not yet' }).click();
  await next(page);
  await finish(page);
});

test('the tip card: three rows of a link and its kind, and no email card', async ({
  page,
  browser,
}) => {
  const slug = `el-tips-${run()}`;
  const made = await page.request.post('/api/admin/lists', {
    data: { template: 'link-tips', slug },
  });
  expect(made.ok(), await made.text()).toBe(true);
  const { id } = (await made.json()) as { id: number };
  const listed = await page.request.patch(`/api/admin/lists/${String(id)}`, {
    data: { visibility: 'listed' },
  });
  expect(listed.ok(), await listed.text()).toBe(true);

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const v = await context.newPage();
  const outside = watch(v);
  const sent: unknown[] = [];
  v.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/api/lists/${slug}/entries`)) {
      sent.push(r.postDataJSON());
    }
  });
  await v.goto(`/list/${slug}`);
  await v.getByRole('button', { name: 'Start' }).click();
  await expect(v.getByTestId('link-wording')).toHaveText(
    "Links you send here are never published. A moderator checks each one, and links that pass may be shared with vetted journalists. Don't link to your own account if you want to stay anonymous.",
  );
  // Three rows, all there from the start, and nothing adds or removes one.
  for (const n of ['1', '2', '3'])
    await expect(v.getByRole('group', { name: new RegExp(`^Link ${n}`) })).toBeVisible();
  await expect(v.getByRole('button', { name: /Add another/ })).toHaveCount(0);
  // Send waits for the spam puzzle; check the card once it can be sent.
  await expect(v.getByRole('button', { name: 'Send' })).toBeEnabled();
  await expectAccessible(v, 'the tip card');

  const row = (n: string) => v.getByRole('group', { name: new RegExp(`^Link ${n}`) });
  await row('1').getByLabel('Link', { exact: true }).fill('https://video.example.org/watch/1');
  // The last card: the form asks for no email, so this one sends.
  await v.waitForTimeout(2600);
  await v.getByRole('button', { name: 'Send' }).click();
  await expect(v.getByText('Link 1 has no type. Choose what kind of thing it is.')).toBeVisible();
  await row('1').getByLabel('What kind of thing is it?').selectOption({ label: 'Video' });
  await row('3').getByLabel('What kind of thing is it?').selectOption({ label: 'News article' });
  await v.getByRole('button', { name: 'Send' }).click();
  await expect(
    v.getByText('Link 3 has a type but no link. Add the link, or clear the row.'),
  ).toBeVisible();
  await row('3').getByLabel('Link', { exact: true }).fill('https://news.example.org/story');
  await v.getByRole('button', { name: 'Send' }).click();
  await expect(v.getByRole('heading', { name: 'Sent. Thank you.' })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect((sent[0] as { answers: unknown; email: unknown }).answers).toEqual({
    links: [
      // The empty middle row is not an answer, so it is not sent.
      { url: 'https://video.example.org/watch/1', type: 'video' },
      { url: 'https://news.example.org/story', type: 'article' },
    ],
  });
  expect((sent[0] as { email: unknown }).email).toBeNull();
  // Each send carried a fresh solution from this page: one is good for one send.
  const solutions = sent.map((b) => (b as { altcha?: string }).altcha);
  expect(solutions.every((a) => typeof a === 'string' && a.length > 100)).toBe(true);
  expect(new Set(solutions).size).toBe(sent.length);
  expect(outside).toEqual([]);
  await context.close();
  await page.request.patch(`/api/admin/lists/${String(id)}`, { data: { closed: true } });
});

test('the entry card: what do you want to do, and its two answers', async ({ page }) => {
  await page.route(
    (url) => url.pathname === '/api/logbooks',
    (route) =>
      route.fulfill({
        json: {
          logbooks: [
            {
              slug: 'how-voting-went',
              title: 'Log how voting went',
              blurb: null,
              state: 'open',
              questions: 11,
            },
          ],
        },
      }),
  );
  await page.route(
    (url) => url.pathname === '/api/lists',
    (route) =>
      route.fulfill({ json: { lists: [{ slug: 'tips', title: 'Send a link', blurb: null }] } }),
  );
  await copy(page, { submit_question: 'What do you want to do?' });
  const outside = watch(page);
  await page.goto('/submit');
  await heading(page, 'What do you want to do?');
  await expect(
    page.getByRole('list', { name: 'What do you want to do?' }).getByRole('link'),
  ).toHaveCount(2);
  await expect(page.getByRole('link', { name: /Log how voting went/ })).toBeVisible();
  await expectAccessible(page, 'the entry card');
  await page.getByRole('link', { name: /Send a link/ }).click();
  await expect(page).toHaveURL(/\/list\/tips$/);
  expect(outside).toEqual([]);
});
