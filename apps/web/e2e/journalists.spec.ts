/**
 * The journalist alert list, as a stranger meets it (plan D, J1 to J6):
 * signing up, the confirmation link from the captured email, an alert, the
 * stop link in it (which turns alerts off, decision 47), and the "Change your
 * alerts" link in it: changing them, then removing the address entirely.
 * Every link is followed from the emails the server wrote, and each page is
 * checked for third-party requests and accessibility.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { axe, describeViolation } from './a11y.ts';
import { countTo, lastMessageTo } from './identity/mail.ts';

const API = fileURLToPath(new URL('../../api/', import.meta.url));
const OUTBOX = fileURLToPath(new URL('./.outbox/', import.meta.url));
const run = `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;
const EMAIL = `journalist-${run}@example.org`;

/** The same key the test server runs with (playwright.config.ts). */
const env = {
  ...process.env,
  MAIL_OUTBOX: OUTBOX,
  SITE_ORIGIN: 'http://127.0.0.1:4173',
  CONTACT_KEY: Buffer.alloc(32, 9).toString('base64'),
};
const devState = (...args: string[]) =>
  execFileSync(
    'node',
    ['--env-file-if-exists=../../.env', 'src/dev/journalists-state.ts', ...args],
    { cwd: API, env, encoding: 'utf8' },
  ).trim();

/** Every request to another host, and every call to this site's API, on a page. */
function watch(page: Page) {
  const outside: string[] = [];
  const calls: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') outside.push(r.url());
    else if (url.pathname.startsWith('/api/')) {
      calls.push(`${r.method()} ${url.pathname.replace(/\/[a-f0-9]{64}(?=\/|$)/, '/:token')}`);
    }
  });
  return { outside, calls };
}

async function noViolations(page: Page) {
  const found = await axe(page);
  expect(found.violations.map(describeViolation)).toEqual([]);
}

const linkIn = (text: string, kind: 'confirm' | 'stop' | 'settings') =>
  new RegExp(`https?://\\S+/journalists/${kind}/[a-f0-9]{64}`).exec(text)?.[0] ?? '';

test.describe.configure({ mode: 'serial' });

test('signing up, confirming from the email, an alert, and stopping, changing and leaving from it', async ({
  browser,
}, testInfo) => {
  // One state per project, and states no other test files reports in: the two projects share a database and run together.
  const state = testInfo.project.name === 'phone' ? 'Maine' : 'Vermont';
  const page = await (await browser.newContext()).newPage();
  const seen = watch(page);

  // J1, J6: a name, an address and the states (alerts are ticked to begin
  // with), and the legal notice and privacy policy before sending.
  await page.goto('/journalists/alerts');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Alerts and desk access' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'imprint and privacy policy' })).toHaveAttribute(
    'href',
    '/legal',
  );
  // Decision 80: signing in is offered as the easier way, and the form below is unchanged.
  await expect(
    page.locator('#main').getByRole('link', { name: 'Sign in', exact: true }),
  ).toHaveAttribute('href', /\/access\/sign-in\?next=%2Fjournalists%2Falerts/);
  await noViolations(page);
  await page.getByLabel('Your name').fill('Pat Reporter');
  await page.getByLabel('Your email address').fill(EMAIL);
  await page.getByLabel(state).check();
  const before = countTo(EMAIL);
  await page.getByRole('button', { name: 'Join the list' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  await noViolations(page);
  expect(devState('listed', EMAIL)).toBe('pending');

  // J2: the link in the captured email. Opening it, twice, as a scanner would, adds nobody.
  const confirm = linkIn((await lastMessageTo(EMAIL, before)).text, 'confirm');
  expect(confirm).not.toBe('');
  const link = await (await browser.newContext()).newPage();
  const linkSeen = watch(link);
  await link.goto(confirm);
  await expect(link.getByRole('heading', { level: 1, name: 'Join the alert list?' })).toBeVisible();
  await expect(link.getByText(state)).toBeVisible();
  await noViolations(link);
  await link.reload();
  await expect(link.getByRole('heading', { level: 1, name: 'Join the alert list?' })).toBeVisible();
  expect(devState('listed', EMAIL)).toBe('pending');
  await link.getByRole('button', { name: 'Join the alert list' }).click();
  await expect(
    link.getByRole('heading', { level: 1, name: 'You are on the alert list' }),
  ).toBeVisible();
  expect(devState('listed', EMAIL)).toBe('active');

  // J3, J4: an alert with counts only, and its two links: change the alerts, or stop them.
  const mailBefore = countTo(EMAIL);
  devState('alert-for', EMAIL);
  const alert = await lastMessageTo(EMAIL, mailBefore);
  expect(alert.text).toContain(`${state}: 2`);
  expect(alert.text).not.toContain('Wyoming');
  expect(alert.text.match(/https?:\/\/\S+/g)).toHaveLength(2);
  const stop = linkIn(alert.text, 'stop');
  expect(stop).not.toBe('');
  const change = linkIn(alert.text, 'settings');
  expect(change).not.toBe('');

  const leaving = await (await browser.newContext()).newPage();
  const leavingSeen = watch(leaving);
  await leaving.goto(stop);
  await expect(
    leaving.getByRole('heading', { level: 1, name: 'Stop these alerts?' }),
  ).toBeVisible();
  await noViolations(leaving);
  await leaving.reload();
  expect(devState('listed', EMAIL)).toBe('active');
  await leaving.getByRole('button', { name: 'Stop alerts' }).click();
  await expect(leaving.getByRole('heading', { level: 1, name: 'Alerts are off' })).toBeVisible();
  await noViolations(leaving);
  // Off, and still on the list.
  expect(devState('listed', EMAIL)).toBe('paused');

  // Decision 47: the "Change your alerts" link from the same email. Opening it changes nothing.
  const changing = await (await browser.newContext()).newPage();
  const changingSeen = watch(changing);
  await changing.goto(change);
  await expect(
    changing.getByRole('heading', { level: 1, name: 'Change your alerts' }),
  ).toBeVisible();
  await expect(changing.getByRole('checkbox', { name: state })).toBeChecked();
  await expect(changing.getByRole('radio', { name: /Turn alerts off for now/ })).toBeChecked();
  await noViolations(changing);
  await changing.reload();
  await expect(
    changing.getByRole('heading', { level: 1, name: 'Change your alerts' }),
  ).toBeVisible();
  expect(devState('listed', EMAIL)).toBe('paused');
  // Back on, with one more state.
  await changing.getByRole('radio', { name: 'Send me alerts' }).click();
  await changing.getByRole('checkbox', { name: 'New Hampshire' }).click();
  await changing.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(changing.getByText('Your alert settings are saved.')).toBeVisible();
  expect(devState('listed', EMAIL)).toBe('active');
  // Removing yourself entirely is its own button, and says what else it ends.
  const removal = changing.getByRole('region', { name: 'Remove me from the list entirely' });
  await expect(removal.getByText(/ends that too/)).toBeVisible();
  await removal.getByRole('button', { name: 'Remove me from the list entirely' }).click();
  // It asks again first (decision 46).
  await changing
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove me', exact: true })
    .click();
  await expect(
    changing.getByRole('heading', { level: 1, name: 'You are off the alert list' }),
  ).toBeVisible();
  await noViolations(changing);
  expect(devState('listed', EMAIL)).toBe('none');

  // No page asked another host for anything. (That a door makes only its own calls is
  // checked with the password on: test/door-quiet.test.tsx and the gate's db test.)
  expect([
    ...seen.outside,
    ...linkSeen.outside,
    ...leavingSeen.outside,
    ...changingSeen.outside,
  ]).toEqual([]);
  // Joining and stopping each happened by one POST, from the button; changing
  // and removing by one each, and opening any of the pages by none.
  expect(linkSeen.calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
  expect(leavingSeen.calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
  expect(changingSeen.calls.filter((c) => c.startsWith('POST'))).toEqual([
    'POST /api/journalists/settings/:token',
    'POST /api/journalists/settings/:token/remove',
  ]);
});

test('one sign-up asks for desk access with alerts off, and the page behind an alert asks for it too', async ({
  browser,
}, testInfo) => {
  // Decision 69. States of this test's own: the projects share a database.
  const state = testInfo.project.name === 'phone' ? 'Delaware' : 'Rhode Island';
  const deskOnly = `desk-only-${run}-${testInfo.project.name}@example.org`;
  const page = await (await browser.newContext()).newPage();
  const seen = watch(page);

  // The sign-up: alerts unticked, the journalist box ticked, and the request's questions open.
  await page.goto('/journalists/alerts');
  await page.getByLabel('Your name').fill('Sam Courts');
  await page.getByLabel('Your email address').fill(deskOnly);
  await page.getByRole('checkbox', { name: 'Send me alerts' }).click();
  await expect(page.getByLabel('Your outlet')).toHaveCount(0);
  await page
    .getByRole('checkbox', { name: 'I am a journalist and want access to the journalist desk' })
    .click();
  await page.getByLabel('Your outlet').fill('Courts Weekly');
  await page.getByLabel('Your role there').fill('Reporter');
  await page.getByLabel('Who are you?').fill('Sam, covering the state courts.');
  await noViolations(page);
  let before = countTo(deskOnly);
  await page.getByRole('button', { name: 'Join the list' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  await expect(page.getByText(/also sends your request for desk access/)).toBeVisible();

  // One confirmation link does both.
  const confirm = linkIn((await lastMessageTo(deskOnly, before)).text, 'confirm');
  const link = await (await browser.newContext()).newPage();
  const linkSeen = watch(link);
  await link.goto(confirm);
  await expect(link.getByText(/on the list with alerts off/)).toBeVisible();
  await expect(link.getByText(/also sends your request for access/)).toBeVisible();
  await noViolations(link);
  await link.getByRole('button', { name: 'Join the alert list' }).click();
  await expect(
    link.getByRole('heading', { level: 1, name: 'You are on the alert list' }),
  ).toBeVisible();
  await expect(
    link.getByText(/request for access to the journalist desk is with the owner/),
  ).toBeVisible();
  await noViolations(link);
  // On the list, with alerts off from the start.
  expect(devState('listed', deskOnly)).toBe('paused');

  // Somebody on the list for alerts only asks from the page an alert links to.
  const reader = `asks-later-${run}-${testInfo.project.name}@example.org`;
  const join = await (await browser.newContext()).newPage();
  await join.goto('/journalists/alerts');
  await join.getByLabel('Your name').fill('Alex Reader');
  await join.getByLabel('Your email address').fill(reader);
  await join.getByLabel(state).check();
  before = countTo(reader);
  await join.getByRole('button', { name: 'Join the list' }).click();
  await expect(join.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  await join.goto(linkIn((await lastMessageTo(reader, before)).text, 'confirm'));
  await join.getByRole('button', { name: 'Join the alert list' }).click();
  await expect(
    join.getByRole('heading', { level: 1, name: 'You are on the alert list' }),
  ).toBeVisible();
  before = countTo(reader);
  devState('alert-for', reader);
  const change = linkIn((await lastMessageTo(reader, before)).text, 'settings');
  expect(change).not.toBe('');

  const changing = await (await browser.newContext()).newPage();
  const changingSeen = watch(changing);
  await changing.goto(change);
  const desk = changing.getByRole('region', { name: 'The journalist desk' });
  await desk.getByRole('button', { name: 'Ask for access to the journalist desk' }).click();
  await desk.getByLabel('Your outlet').fill('The Valley Paper');
  await desk.getByLabel('Your role there').fill('Editor');
  await desk.getByLabel('Who are you?').fill('Alex, editing the Valley Paper.');
  await noViolations(changing);
  await desk.getByRole('button', { name: 'Send my request to the owner' }).click();
  await expect(desk.getByText('Your request for access is with the owner.')).toBeVisible();
  await noViolations(changing);
  // Still getting alerts: asking for the desk changed nothing else.
  expect(devState('listed', reader)).toBe('active');

  expect([...seen.outside, ...linkSeen.outside, ...changingSeen.outside]).toEqual([]);
  expect(changingSeen.calls.filter((c) => c.startsWith('POST'))).toEqual([
    'POST /api/journalists/settings/:token/access',
  ]);
});
