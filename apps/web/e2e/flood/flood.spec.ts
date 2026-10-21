/**
 * Plan E, session PE3, in the browser: the flood screen, a bulk decline from
 * the queue, and pausing intake end to end (the report and tip forms say so,
 * a notice is on the site, the switch log shows it publicly with its time),
 * each with the accessibility check and no request to another host.
 *
 * ITS OWN PROJECT (playwright.config.ts): pausing intake is the whole site's
 * state, and every other project files reports. After the owner's and the
 * desk's projects, which hand seats around, so it seats and signs in an
 * administrator of its own rather than trusting the saved session.
 */
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { axe, describeViolation } from '../a11y.ts';
import { codeIn, countTo, identityState, lastMessageTo, linkIn } from '../identity/mail.ts';

const unique = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1e6))}`;

/** Every request a page makes to a host other than this site's. */
function outsideRequests(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') outside.push(r.url());
  });
  return outside;
}

async function noViolations(page: Page) {
  const found = await axe(page);
  expect(found.violations.map(describeViolation)).toEqual([]);
}

/** An administrator of this file's own, signed in the way a person would be. */
async function administrator(browser: Browser): Promise<Page> {
  const email = `e2e-flood-admin-${unique()}@example.org`;
  identityState('seat', email, 'admin');
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const before = countTo(email);
  const asked = await context.request.post('/api/auth/code', { data: { email } });
  expect(asked.ok(), await asked.text()).toBe(true);
  const code = codeIn(await lastMessageTo(email, before));
  const signed = await context.request.post('/api/auth/sign-in', { data: { email, code } });
  expect(signed.ok(), await signed.text()).toBe(true);
  return context.newPage();
}

async function stranger(browser: Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  return { context, page, outside: outsideRequests(page) };
}

/** File one report the way a reporter does, the link followed out of the email. */
async function fileAndConfirm(page: Page, browser: Browser, what: string) {
  const email = `flood-${unique()}@example.org`;
  const card = (await (await page.request.get('/api/publication-card')).json()) as {
    digest: string;
  };
  const before = countTo(email);
  const sent = await page.request.post('/api/reports', {
    data: {
      logbook: 'demo',
      email,
      consent: true,
      answers: { what },
      may_publish: true,
      may_publish_digest: card.digest,
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  const link = linkIn(await lastMessageTo(email, before));
  const v = await stranger(browser);
  await v.page.goto(link);
  await v.page.getByRole('button', { name: 'Confirm and file my report' }).click();
  await expect(v.page.getByRole('heading', { name: 'Your report is filed' })).toBeVisible();
  await v.context.close();
}

test('the flood screen shows the last 24 hours and the switches, accessibly', async ({
  browser,
}) => {
  const page = await administrator(browser);
  const outside = outsideRequests(page);
  await page.goto('/moderate/flood');
  await expect(page.getByRole('heading', { level: 1, name: 'Flood screen' })).toBeVisible();
  const hours = page.getByRole('region', { name: 'Submissions per hour, the last 24 hours' });
  // 24 hours and a header row.
  await expect(hours.getByRole('row')).toHaveCount(25);
  await expect(page.getByRole('region', { name: 'Switches' })).toContainText('Intake is open.');
  await expect(
    page.getByRole('region', { name: 'Refused at the door, per hour, by check' }),
  ).toBeVisible();
  await noViolations(page);
  expect(outside).toEqual([]);
});

test('a bulk decline from the queue declines what the filter shows, with one reason', async ({
  browser,
}) => {
  // Two reports filed through their emailed links first, then the queue.
  test.setTimeout(60_000);
  const page = await administrator(browser);
  const word = `flood${unique()}`;
  await fileAndConfirm(page, browser, `Copy of the same words ${word}.`);
  await fileAndConfirm(page, browser, `Copy of the same words ${word}.`);
  const outside = outsideRequests(page);
  await page.goto(`/moderate?status=pending&q=${word}`);
  await expect(page.getByRole('link', { name: /^Open RL-/ })).toHaveCount(2);
  await page.getByRole('button', { name: 'Select all of these' }).click();
  const form = page.getByRole('form', { name: 'Decline the selected reports' });
  await expect(form).toBeVisible();
  await noViolations(page);
  await form.getByLabel('The reason').selectOption('abusive_or_spam');
  await form.getByRole('button', { name: 'Decline 2' }).click();
  await expect(page.getByText('Declined 2.')).toBeVisible();
  await page.goto(`/moderate?status=invalid&q=${word}`);
  await expect(page.getByRole('link', { name: /^Open RL-/ })).toHaveCount(2);
  // Each one carries its own decision.
  await page
    .getByRole('link', { name: /^Open RL-/ })
    .first()
    .click();
  await expect(page.getByRole('region', { name: 'What happened to it' })).toContainText(
    'It is abusive, or it is spam or an advertisement.',
  );
  expect(outside).toEqual([]);
});

test('pause intake: both forms say so, the site shows a notice, the log shows the time', async ({
  browser,
}) => {
  const page = await administrator(browser);
  // A listed tip list, to see its form paused too.
  const slug = `flood-tips-${unique()}`;
  const made = await page.request.post('/api/admin/lists', {
    data: { template: 'tips', slug, title: `Tips ${slug}` },
  });
  expect(made.ok(), await made.text()).toBe(true);
  const { id } = (await made.json()) as { id: number };
  const listed = await page.request.patch(`/api/admin/lists/${String(id)}`, {
    data: { visibility: 'listed' },
  });
  expect(listed.ok(), await listed.text()).toBe(true);

  await page.goto('/moderate/flood');
  const switches = page.getByRole('region', { name: 'Switches' });
  try {
    await switches.getByRole('button', { name: 'Pause intake' }).click();
    await expect(switches).toContainText('Intake is paused since');
    // TODO(PE1 step-up): the second factor is asked here once PE1 is merged.

    const v = await stranger(browser);
    await v.page.goto('/file/demo');
    await expect(v.page.getByText(/^(Note: )?Intake is paused$/).first()).toBeVisible();
    await expect(v.page.getByRole('button', { name: 'Start' })).toHaveCount(0);
    await noViolations(v.page);

    await v.page.goto(`/list/${slug}`);
    await expect(v.page.getByRole('heading', { level: 1, name: `Tips ${slug}` })).toBeVisible();
    await expect(v.page.getByText(/^(Note: )?Intake is paused$/).first()).toBeVisible();

    // A notice on the site, with when it started.
    await v.page.goto('/board');
    await expect(v.page.getByText(/Paused since/)).toBeVisible();
    await noViolations(v.page);

    // The switch log, public, with its time and never who.
    await v.page.goto('/board/activity');
    const log = v.page.getByRole('listitem').filter({ hasText: 'Intake paused' });
    await expect(log.first()).toBeVisible();
    await expect(log.first().locator('time')).toHaveAttribute('datetime', /\d{4}-\d{2}-\d{2}T/);
    await expect(v.page.locator('main')).not.toContainText('@example');
    await noViolations(v.page);

    // And the server refuses a report sent anyway.
    const card = (await (await v.page.request.get('/api/publication-card')).json()) as {
      digest: string;
    };
    const refused = await v.page.request.post('/api/reports', {
      data: {
        logbook: 'demo',
        email: `paused-${unique()}@example.org`,
        consent: true,
        answers: { what: 'sent while paused' },
        may_publish: true,
        may_publish_digest: card.digest,
      },
    });
    expect(refused.status()).toBe(503);
    expect(v.outside).toEqual([]);
    await v.context.close();

    await switches.getByRole('button', { name: 'Resume intake' }).click();
    await expect(switches).toContainText('Intake is open.');
    const after = await stranger(browser);
    await after.page.goto('/file/demo');
    await expect(after.page.getByRole('button', { name: 'Start' })).toBeVisible();
    await after.context.close();
  } finally {
    // Whatever happened above, the site takes reports again for the projects after this one.
    await page.request.post('/api/moderation/switches/pause', { data: { paused: false } });
  }
});

test.fixme('pause intake asks for the second factor again (PE1 step-up, wired at merge)', () =>
  Promise.resolve());
