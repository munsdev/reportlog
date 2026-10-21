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

  // J1, J6: four questions, and the legal notice and privacy policy before sending.
  await page.goto('/journalists/alerts');
  await expect(page.getByRole('heading', { level: 1, name: 'Journalist alerts' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'legal notice and privacy policy' })).toHaveAttribute(
    'href',
    '/legal',
  );
  await noViolations(page);
  await page.getByLabel('Your name').fill('Pat Reporter');
  await page.getByLabel('Your outlet').fill('The Daily Example');
  await page.getByLabel('Your email address').fill(EMAIL);
  await page.getByLabel(state).check();
  const before = countTo(EMAIL);
  await page.getByRole('button', { name: 'Send me a confirmation email' }).click();
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
  await changing.getByRole('button', { name: 'Save my alert settings' }).click();
  await expect(changing.getByText('Your alert settings are saved.')).toBeVisible();
  expect(devState('listed', EMAIL)).toBe('active');
  // Removing yourself entirely is its own button, and says what else it ends.
  const removal = changing.getByRole('region', { name: 'Remove me from the list entirely' });
  await expect(removal.getByText(/ends that too/)).toBeVisible();
  await removal.getByRole('button', { name: 'Remove me from the list entirely' }).click();
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
