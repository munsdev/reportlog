/**
 * The doors through the site password, in a real browser with the password
 * ON, walked by a visitor who does not have it.
 *
 *   A list's door: a door list opens and takes an entry, a list not opened
 *   outside answers `locked`, /api/doors offers the door, and hiding the
 *   list closes it.
 *
 *   A logbook's door: filing only. The form works (Back included: each card
 *   is a history entry, and the door lets those through), the page asks the
 *   server for nothing but the filing calls, and everything else, typed or
 *   asked for, is the password screen.
 *
 * The server side of both is tested in the API's db suite (lists-routes,
 * filing-doors, doors). This is the page under the gate, which only a browser
 * shows. One file, serial, in a project of its own that runs after the
 * others: the password is the whole site's.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { codeIn, countTo, identityState, lastMessageTo } from '../identity/mail.ts';
import { passSecondFactor } from '../second-factor.ts';

test.describe.configure({ mode: 'serial' });

const API = fileURLToPath(new URL('../../../api/', import.meta.url));
const filingState = (...args: string[]) =>
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/filing/dev-state.ts', ...args], {
    cwd: API,
  });

const stamp = `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;
const PASSWORD = `doors-${stamp}`;
const DOOR = { slug: `door-${stamp}`, title: `Check in here ${stamp}`, id: 0 };
const SHUT = { slug: `shut-${stamp}`, title: `Team only ${stamp}`, id: 0 };

let admin: APIRequestContext;

const lockHeading = (page: Page) =>
  page.getByRole('heading', { name: 'This site needs a password' });
const heading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });

/** A visitor: no session, no password, and a record of every host asked. */
async function visitor(browser: Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const outside: string[] = [];
  const api: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') outside.push(r.url());
    else if (url.pathname.startsWith('/api/')) api.push(`${r.method()} ${url.pathname}`);
  });
  return { context, page, outside, api };
}

const codeOf = async (r: { json: () => Promise<unknown> }) =>
  ((await r.json()) as { error?: { code?: string } }).error?.code;

async function makeList(list: typeof DOOR, settings: Record<string, unknown>) {
  const made = await admin.post('/api/admin/lists', {
    data: { template: 'check-ins', slug: list.slug },
  });
  expect(made.ok(), await made.text()).toBe(true);
  list.id = ((await made.json()) as { id: number }).id;
  const set = await admin.patch(`/api/admin/lists/${String(list.id)}`, {
    data: { title: list.title, ...settings },
  });
  expect(set.ok(), await set.text()).toBe(true);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  // An administrator, signed in before the password goes on.
  const email = `doors-admin-${stamp}@example.org`;
  identityState('seat', email, 'admin');
  admin = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const before = countTo(email);
  expect((await admin.post('/api/auth/code', { data: { email } })).ok()).toBe(true);
  const code = codeIn(await lastMessageTo(email, before));
  expect((await admin.post('/api/auth/sign-in', { data: { email, code } })).ok()).toBe(true);
  await passSecondFactor(admin, email);

  await makeList(DOOR, { visibility: 'listed', outside_access: 'door' });
  await makeList(SHUT, { visibility: 'listed' });
  // The seed's demo logbook, offered on the password page for filing only.
  filingState('outside', 'demo', 'door');
  filingState('curtain', PASSWORD);
  // The administrator has the password too, to change the list later.
  const unlocked = await admin.post('/api/site-access/unlock', { data: { password: PASSWORD } });
  expect(unlocked.ok(), await unlocked.text()).toBe(true);
});

test.afterAll(async () => {
  filingState('outside', 'demo', 'closed');
  identityState('set-up');
  await admin.dispose();
});

test.describe('a list behind the password', () => {
  test('the password page offers the door list, and /api/doors does too', async ({ browser }) => {
    const v = await visitor(browser);
    await v.page.goto('/');
    await expect(lockHeading(v.page)).toBeVisible();
    await expect(v.page.getByRole('link', { name: DOOR.title })).toHaveAttribute(
      'href',
      `/list/${DOOR.slug}`,
    );
    await expect(v.page.getByRole('link', { name: SHUT.title })).toHaveCount(0);
    const offered = (await (await v.page.request.get('/api/doors')).json()) as {
      doors: { href: string }[];
    };
    expect(offered.doors.map((d) => d.href)).toContain(`/list/${DOOR.slug}`);
    expect(offered.doors.map((d) => d.href)).not.toContain(`/list/${SHUT.slug}`);
    await v.context.close();
  });

  test('a door list opens without the password and takes an entry', async ({ browser }) => {
    const v = await visitor(browser);
    await v.page.goto('/');
    await v.page.getByRole('link', { name: DOOR.title }).click();
    await expect(lockHeading(v.page)).toHaveCount(0);
    await expect(heading(v.page, DOOR.title)).toBeVisible();
    await v.page.getByRole('button', { name: 'Start' }).click();
    await v.page.getByRole('radio', { name: 'It went fine' }).click();
    await v.page.getByRole('button', { name: 'Next' }).click();
    await v.page.getByRole('radio', { name: 'Not sure' }).click();
    // A form sent faster than it can be read is taken for a script.
    await v.page.waitForTimeout(2600);
    await v.page.getByRole('button', { name: 'Send' }).click();
    await expect(v.page.getByRole('heading', { name: 'Sent. Thank you.' })).toBeVisible();
    await expect(lockHeading(v.page)).toHaveCount(0);
    expect(v.outside).toEqual([]);
    await v.context.close();
  });

  test('a list not opened outside answers locked: the page is the password screen', async ({
    browser,
  }) => {
    const v = await visitor(browser);
    await v.page.goto(`/list/${SHUT.slug}`);
    await expect(lockHeading(v.page)).toBeVisible();
    await expect(v.page.getByText(SHUT.title)).toHaveCount(0);
    const r = await v.page.request.get(`/api/lists/${SHUT.slug}`);
    expect(r.status()).toBe(401);
    expect(await codeOf(r)).toBe('locked');
    await v.context.close();
  });

  test('hiding the list closes its door', async ({ browser }) => {
    const v = await visitor(browser);
    await v.page.goto(`/list/${DOOR.slug}`);
    await expect(heading(v.page, DOOR.title)).toBeVisible();

    const hidden = await admin.patch(`/api/admin/lists/${String(DOOR.id)}`, {
      data: { visibility: 'hidden' },
    });
    expect(hidden.ok(), await hidden.text()).toBe(true);
    expect(((await hidden.json()) as { outside_access: string }).outside_access).toBe('closed');

    await v.page.reload();
    await expect(lockHeading(v.page)).toBeVisible();
    await expect(v.page.getByRole('link', { name: DOOR.title })).toHaveCount(0);
    const offered = (await (await v.page.request.get('/api/doors')).json()) as {
      doors: { href: string }[];
    };
    expect(offered.doors.map((d) => d.href)).not.toContain(`/list/${DOOR.slug}`);
    expect(await codeOf(await v.page.request.get(`/api/lists/${DOOR.slug}`))).toBe('locked');
    await v.context.close();
  });
});

test.describe('a logbook behind the password', () => {
  // What the filing form may ask for on a door, and nothing else.
  const FILING_CALLS = new Set([
    'GET /api/site-access/status',
    'GET /api/logbooks/demo',
    'GET /api/publication-card',
    'GET /api/intake-switch',
    // Plan E (PE3): "Intake is paused", asked by the form itself.
    'GET /api/intake-pause',
    // Plan E (PE2): the door's start token and puzzle, in front of the password.
    'GET /api/door/start',
    'GET /api/door/challenge',
  ]);

  test('filing only: the form works, Back included, and asks for nothing else', async ({
    browser,
  }) => {
    const v = await visitor(browser);
    await v.page.goto('/');
    await expect(lockHeading(v.page)).toBeVisible();
    // The password page asks what it offers (/api/doors); from here on is the door's.
    v.api.length = 0;
    await v.page.getByRole('link', { name: 'Demo logbook' }).click();
    await expect(lockHeading(v.page)).toHaveCount(0);
    await expect(heading(v.page, 'Demo logbook')).toBeVisible();
    await v.page.getByRole('button', { name: 'Start' }).click();
    await v.page.getByRole('textbox', { name: 'What happened?' }).fill('Seen from the door.');
    await v.page.getByRole('button', { name: 'Next' }).click();
    await expect(heading(v.page, 'What happened?')).toHaveCount(0);

    // The browser's Back goes back one question, on a door as anywhere.
    await v.page.goBack();
    await expect(heading(v.page, 'What happened?')).toBeVisible();
    await expect(v.page.getByRole('textbox', { name: 'What happened?' })).toHaveValue(
      'Seen from the door.',
    );
    await v.page.goForward();
    await expect(heading(v.page, 'What happened?')).toHaveCount(0);
    await expect(lockHeading(v.page)).toHaveCount(0);
    expect(v.page.url()).toMatch(/\/file\/demo$/);

    expect([...new Set(v.api)].filter((c) => !FILING_CALLS.has(c))).toEqual([]);
    expect(v.outside).toEqual([]);
    await v.context.close();
  });

  test('anything else is the password screen, typed or asked for', async ({ browser }) => {
    const v = await visitor(browser);
    for (const path of ['/', '/board', '/mine', '/lists', '/intake', '/file/not-a-logbook']) {
      await v.page.goto(path);
      await expect(lockHeading(v.page), path).toBeVisible();
    }
    for (const path of [
      '/api/logbooks',
      '/api/mine/reports',
      '/api/lists',
      '/api/intake/batches',
    ]) {
      const r = await v.page.request.get(path);
      expect(r.status(), path).toBe(401);
      expect(await codeOf(r), path).toBe('locked');
    }
    await v.context.close();
  });

  test('the server decides: a logbook closed while somebody is filing sends them to the password', async ({
    browser,
  }) => {
    const v = await visitor(browser);
    await v.page.goto('/file/demo');
    await v.page.getByRole('button', { name: 'Start' }).click();
    await v.page.getByRole('textbox', { name: 'What happened?' }).fill('Filed as it closed.');
    const next = () => v.page.getByRole('button', { name: 'Next' }).click();
    await next(); // what
    await next(); // when (optional)
    await next(); // where (optional)
    await next(); // publication (not answering is no)
    await v.page.getByLabel('Your email address').fill(`closing-${stamp}@example.org`);
    await next();
    await v.page.getByRole('checkbox', { name: /I confirm this report is accurate/ }).check();

    filingState('outside', 'demo', 'closed');
    try {
      await v.page.getByRole('button', { name: 'Send report' }).click();
      await expect(lockHeading(v.page)).toBeVisible();
      await expect(heading(v.page, 'Check your email')).toHaveCount(0);
    } finally {
      filingState('outside', 'demo', 'door');
    }
    await v.context.close();
  });
});
