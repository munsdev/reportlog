/**
 * The site password, first-run setup, signing in and an invitation, in a
 * real browser against the real server.
 *
 * Every code and link here is read from the email the server wrote, and the
 * invitation is opened BY FOLLOWING ITS LINK: a path that only runs when
 * somebody clicks a link in an email is the path nothing reaches by accident.
 *
 * Runs alone, after the rest of the suite (the `identity` project), because
 * it turns the site password on for everybody.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { devices, expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { AxeResults, RunOptions } from 'axe-core';
import {
  codeIn,
  countTo,
  digestFor,
  identityState,
  lastMessageTo,
  linkIn,
  stopLinkIn,
  subscriptionOf,
} from './mail.ts';
import { rememberSecret, stepUp, totp } from '../second-factor.ts';
import { openMenu, signOut } from '../menu.ts';

test.describe.configure({ mode: 'serial' });

const run = `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;
const OWNER = `owner-${run}@example.org`;
const MANAGER = `manager-${run}@example.org`;
const COORD = `coord-${run}@example.org`;
const MOD = `mod-${run}@example.org`;
const READER = `reader-${run}@example.org`;
const ORG = `E2E Org ${run}`;
const INSTALL_PW = 'installer-pw-1';
const SITE_PW = 'operator-pw-2';
const SITE_NAME = 'Polling "Watch"';

const lockHeading = (page: Page) =>
  page.getByRole('heading', { name: 'This site needs a password' });

async function unlock(page: Page, password: string) {
  await page.getByLabel('Site password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Sign in on the sign-in form in front of us, reading the code from the email. */
async function signInHere(page: Page, email: string) {
  const before = countTo(email);
  await page.getByLabel('Your email address').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  const code = codeIn(await lastMessageTo(email, before));
  await page.getByLabel('The code from the email').fill(code);
  await page.getByRole('button', { name: /^(Sign in|Become the owner)$/ }).click();
}

/**
 * axe-core from node_modules, evaluated inside the page and never fetched, as
 * e2e/accessibility.spec.ts runs it. That walk opens each page once, so it
 * never sees the sign-in form's second step; this does.
 */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(AXE_SOURCE);
  const found = await page.evaluate(
    (tags) =>
      (
        window as unknown as { axe: { run(d: Document, o: RunOptions): Promise<AxeResults> } }
      ).axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }),
    AXE_TAGS,
  );
  return found.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  );
}

/** Any six digits but these. */
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

let ownerContext: BrowserContext;
let owner: Page;

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test.beforeAll(() => {
  identityState('fresh-install', INSTALL_PW);
});
test.afterAll(async () => {
  await ownerContext.close();
  identityState('set-up');
});

test('while locked, only the password screen renders and the router goes nowhere', async ({
  page,
}) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });

  await page.goto('/verify/RL-ANYTHING');
  await expect(lockHeading(page)).toBeVisible();
  // Nothing behind the curtain: not the page asked for, not even the site's header.
  await expect(page.getByText('Check a report')).toHaveCount(0);
  await expect(page.locator('header')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Report RL-ANYTHING/ })).toHaveCount(0);

  // History moving under it changes nothing.
  await page.evaluate(() => {
    history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(lockHeading(page)).toBeVisible();
  await expect(page.locator('header')).toHaveCount(0);
  await page.goBack();
  await expect(lockHeading(page)).toBeVisible();
  await expect(page.getByText('Check a report')).toHaveCount(0);

  await unlock(page, 'not-the-password');
  await expect(page.getByRole('alert')).toContainText('That password is not right.');
  await expect(page.locator('header')).toHaveCount(0);
  expect(outside).toEqual([]);
});

test('the setup wizard seats the owner, asks every question, and ends on the password', async ({
  browser,
}) => {
  ownerContext = await browser.newContext();
  owner = await ownerContext.newPage();
  // The wizard is a page like any other: nothing it loads comes from elsewhere.
  const outside: string[] = [];
  owner.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await owner.goto('/');
  // In front of the password there is no wizard, only the lock.
  await expect(lockHeading(owner)).toBeVisible();
  await expect(owner.getByRole('heading', { name: 'Who will own this deployment?' })).toHaveCount(
    0,
  );
  expect(await owner.evaluate(async () => (await fetch('/api/setup/status')).status)).toBe(401);
  await unlock(owner, INSTALL_PW);

  await expect(owner.getByRole('heading', { name: 'Who will own this deployment?' })).toBeVisible();
  await expect(owner.getByText('Setting up · step 1 of 7')).toBeVisible();
  await signInHere(owner, OWNER);

  // The owner's seat opens nothing until a second factor is set up (plan E,
  // E3): an authenticator app here, its code computed from the key shown.
  await expect(
    owner.getByRole('heading', { name: 'Set up a second way to sign in' }),
  ).toBeVisible();
  expect(await axeViolations(owner)).toEqual([]);
  await owner.getByRole('radio', { name: 'An authenticator app' }).click();
  await owner.getByRole('button', { name: 'Next' }).click();
  await expect(
    owner.getByRole('img', { name: 'QR code to add this site to your authenticator app' }),
  ).toBeVisible();
  const secret = ((await owner.getByTestId('totp-secret').textContent()) ?? '').replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  rememberSecret(OWNER, secret);
  expect(await axeViolations(owner)).toEqual([]);
  await owner.getByLabel('The six-digit code the app shows now').fill(totp(secret));
  await owner.getByRole('button', { name: 'Turn it on' }).click();
  await expect(owner.getByRole('heading', { name: 'Your recovery codes' })).toBeVisible();
  await expect(
    owner.getByRole('listitem').filter({ hasText: /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/ }),
  ).toHaveCount(10);
  expect(await axeViolations(owner)).toEqual([]);
  await owner.getByRole('button', { name: 'I have kept them' }).click();

  // The name, required here.
  await expect(owner.getByRole('heading', { name: 'What is this archive called?' })).toBeVisible();
  await owner.getByRole('button', { name: 'Use this and continue' }).click();
  await expect(owner.getByRole('alert')).toHaveText('Give this archive a name.');
  await owner.getByLabel('Its name').fill(SITE_NAME);
  await owner.getByRole('button', { name: 'Use this and continue' }).click();

  // The starting point, which says what it will change before it is chosen.
  await expect(owner.getByRole('heading', { name: 'What kind of archive is this?' })).toBeVisible();
  const elections = owner.getByRole('radio', { name: 'Election incidents', exact: true });
  await expect(elections).toHaveAccessibleDescription(/^Observers/);
  await expect(owner.getByText(/Makes a draft logbook, “Election incidents”/)).toBeVisible();
  await elections.check();
  await owner.getByRole('button', { name: 'Use this and continue' }).click();

  // Publishing, arriving at what the starting point set.
  await expect(
    owner.getByRole('heading', { name: 'Does this deployment publish an archive?' }),
  ).toBeVisible();
  await expect(owner.getByRole('radio', { name: /Yes, publish approved reports/ })).toBeChecked();
  await owner.getByRole('button', { name: 'Use this and continue' }).click();

  // Files, likewise.
  await expect(
    owner.getByRole('heading', { name: 'Can people attach files to a report?' }),
  ).toBeVisible();
  await expect(owner.getByRole('radio', { name: /Yes, take files/ })).toBeChecked();
  await owner.getByRole('button', { name: 'Use this and continue' }).click();

  // The look, with the name just given in its preview.
  await expect(owner.getByRole('heading', { name: 'How should it look?' })).toBeVisible();
  await owner.getByLabel('Palette, the colours').selectOption('darkroom');
  await owner.getByRole('button', { name: 'Use this and continue' }).click();
  await expect(owner.locator('html')).toHaveAttribute('data-palette', 'darkroom');

  // Back shows what was saved.
  await expect(owner.getByRole('heading', { name: 'The site password' })).toBeVisible();
  await owner.getByRole('button', { name: 'Back' }).click();
  await expect(owner.getByLabel('Palette, the colours')).toHaveValue('darkroom');
  await owner.getByRole('button', { name: 'Use this and continue' }).click();

  await expect(owner.getByRole('heading', { name: 'The site password' })).toBeVisible();
  const finish = owner.getByRole('button', { name: 'Finish setting up' });
  // No default and no skip.
  await expect(finish).toBeDisabled();
  await owner.getByLabel(/Change it/).check();
  // Choosing moves nothing: the same screen, waiting for the button.
  await expect(owner.getByRole('heading', { name: 'The site password' })).toBeVisible();
  await owner.getByLabel('New site password').fill(SITE_PW);
  await owner.getByLabel('The same password again').fill(SITE_PW);
  await finish.click();

  await expect(owner.getByRole('heading', { name: 'Check a report' })).toBeVisible();
  // Signed in with a role: the menu offers the way into the staff area.
  await expect(
    (await openMenu(owner)).getByRole('link', { name: /^Your dashboard/ }),
  ).toBeVisible();
  await owner.keyboard.press('Escape');
  await expect(owner.getByRole('banner')).toContainText('Polling Watch');

  // Done means done: a reload shows the site, and setup refuses to run again.
  await owner.reload();
  await expect(owner.getByRole('heading', { name: 'Check a report' })).toBeVisible();
  await expect(owner.getByText(/Setting up · step/)).toHaveCount(0);
  const again = await owner.evaluate(async () => {
    const res = await fetch('/api/setup/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'somebody-else@example.org' }),
    });
    return res.status;
  });
  expect(again).toBe(409);

  // The draft the starting point made is a draft: nothing is launched for anybody.
  const newest = await owner.evaluate(async () => {
    const res = await fetch('/api/admin/logbooks');
    const body = (await res.json()) as { logbooks: { title: string; state: string }[] };
    return body.logbooks[0];
  });
  expect(newest).toMatchObject({ title: 'Election incidents', state: 'draft' });
  expect(outside).toEqual([]);

  // Put the name and look back, so the tests after this one (and the
  // projects after this one) find the site as they expect it.
  expect(
    await owner.evaluate(async () => {
      const put = (url: string, body: object) =>
        fetch(url, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).then((r) => r.status);
      return [
        await put('/api/admin/site/name', { name: null }),
        await put('/api/admin/site/look', { palette: 'platinum', theme: 'desk' }),
      ];
    }),
  ).toEqual([200, 200]);
});

test("the installer's password is retired and the owner's opens the site", async ({ browser }) => {
  const page = await freshPage(browser);
  await page.goto('/');
  await unlock(page, INSTALL_PW);
  await expect(page.getByRole('alert')).toContainText('That password is not right.');
  await unlock(page, SITE_PW);
  await expect(page.getByRole('heading', { name: 'Check a report' })).toBeVisible();
  await page.context().close();
});

test('a refused code is announced and tied to its field, and both steps pass axe on a phone', async ({
  browser,
}) => {
  const SIGNER = `signer-${run}@example.org`;
  // The phone project's device, in this project's browser.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 7'];
  const context = await browser.newContext({
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/access/sign-in');
  await unlock(page, SITE_PW);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  const sideways = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  expect(await axeViolations(page)).toEqual([]);
  expect(await sideways()).toBe(false);

  const before = countTo(SIGNER);
  await page.getByLabel('Your email address').fill(SIGNER);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  const code = codeIn(await lastMessageTo(SIGNER, before));

  // The code step: the second of the two, which a walk of pages never opens.
  const field = page.getByLabel('The code from the email');
  await expect(field).toBeVisible();
  await expect(field).not.toHaveAttribute('aria-invalid');
  expect(await axeViolations(page)).toEqual([]);
  expect(await sideways()).toBe(false);

  await field.fill(wrongCode(code));
  await page.getByRole('button', { name: 'Sign in' }).click();
  const alert = page.getByRole('alert');
  // role="alert" is read out as it appears; and the field now says it was
  // refused, and why, to somebody who goes back to it.
  await expect(alert).toHaveText('That code is wrong or has expired. Ask for a new one.');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription(
    'That code is wrong or has expired. Ask for a new one.',
  );
  // Refused, the step stays put, still signed out.
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  expect(await sideways()).toBe(false);

  // Use a different address: back to the first step, the refusal gone.
  await page.getByRole('button', { name: 'Use a different address' }).click();
  await expect(page.getByLabel('Your email address')).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test('a door: a logbook opened outside is offered, and only that page opens', async ({
  browser,
}) => {
  const setDoor = (access: string) =>
    owner.evaluate(async (outside_access) => {
      const res = await fetch('/api/access/doors/logbooks/demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outside_access }),
      });
      return res.status;
    }, access);
  expect(await setDoor('door')).toBe(200);

  const page = await freshPage(browser);
  await page.goto('/');
  await expect(lockHeading(page)).toBeVisible();
  await page.getByRole('link', { name: 'Demo logbook' }).click();
  await expect(page).toHaveURL(/\/file\/demo$/);
  await expect(lockHeading(page)).toHaveCount(0);

  // Nowhere else from here: the router is blocked on a door.
  await page.getByRole('banner').getByRole('link', { name: 'ReportLog' }).click();
  await expect(page).toHaveURL(/\/file\/demo$/);
  await expect(page.getByText('Check a report')).toHaveCount(0);

  // And Back is a fresh page load, through the gate.
  await page.goBack();
  await expect(lockHeading(page)).toBeVisible();
  await page.context().close();

  expect(await setDoor('closed')).toBe(200);
});

test('an invitation, followed from its email, joins the invited address', async ({ browser }) => {
  await owner.goto('/access/orgs');
  // Making an organization names its manager, and inviting is a grant too:
  // a step-up first (the dialog itself is tested in e2e/two-factor.spec.ts).
  await stepUp(owner.request);
  await owner.getByLabel('Its name').fill(ORG);
  await owner.getByLabel('Its first manager’s email address').fill(MANAGER);
  await owner.getByRole('button', { name: 'Make it' }).click();
  await expect(owner.getByRole('status')).toHaveText(`Made ${ORG}.`);
  await owner.getByRole('link', { name: ORG }).click();

  const before = countTo(COORD);
  await owner.getByLabel('Their email address').fill(COORD);
  await owner.getByRole('button', { name: 'Send the invitation' }).click();
  await expect(owner.getByRole('status')).toHaveText(`An invitation is on its way to ${COORD}.`);

  const mail = await lastMessageTo(COORD, before);
  expect(mail.subject).toBe(`You have been invited to ${ORG}`);
  const link = linkIn(mail);
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:4173\/access\/invitation\/[a-f0-9]{64}$/);

  // The invitee: a different browser, no password, no account.
  const page = await freshPage(browser);
  await page.goto(link);
  await expect(lockHeading(page)).toBeVisible();
  await unlock(page, SITE_PW);

  await expect(page.getByRole('heading', { name: `Join ${ORG} as coordinator` })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A coordinator can', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A coordinator cannot' })).toBeVisible();
  await expect(page.getByText(OWNER)).toBeVisible();

  await page.getByRole('link', { name: `sign in as ${COORD}` }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await signInHere(page, COORD);

  // Straight back to the invitation, which still needs a deliberate press.
  await expect(page).toHaveURL(link);
  await page.getByRole('button', { name: 'Accept the invitation' }).click();
  await expect(page.getByRole('status')).toContainText(`You are now a coordinator of ${ORG}.`);

  // The link works once.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'This invitation is not open' })).toBeVisible();
  await page.context().close();

  await owner.reload();
  await expect(owner.getByText(COORD)).toBeVisible();
});

test('the owner gives somebody a role, and it is on the record', async () => {
  await owner.goto('/access');
  await stepUp(owner.request);
  await owner.getByLabel('Their email address').fill(MOD);
  await owner.getByRole('radio', { name: 'Moderator' }).click();
  await owner.getByRole('button', { name: 'Save' }).click();
  await expect(owner.getByRole('status')).toHaveText(`${MOD} is now: Moderator.`);
  await expect(owner.getByRole('row', { name: new RegExp(MOD) })).toContainText('Moderator');

  await owner.getByRole('link', { name: 'Who granted what' }).click();
  await expect(owner.getByText(`${OWNER} gave ${MOD}: moderator`)).toBeVisible();
});

test('a digest is stopped from the link in its email, in front of the password, by the button only', async ({
  browser,
}) => {
  const before = countTo(READER);
  digestFor(READER);
  const link = stopLinkIn(await lastMessageTo(READER, before));

  // A stranger's browser: no session and not past the password.
  const page = await freshPage(browser);
  const outside: string[] = [];
  const calls: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') outside.push(r.url());
    else if (url.pathname.startsWith('/api/')) {
      calls.push(`${r.method()} ${url.pathname.replace(/\/stop\/[^/]+$/, '/stop/:token')}`);
    }
  });
  await page.goto(link);
  await expect(page.getByRole('heading', { level: 1, name: 'Stop these emails?' })).toBeVisible();
  await expect(lockHeading(page)).toHaveCount(0);
  // The address, partly hidden, and nothing else of the site.
  await expect(page.getByText(`${READER.slice(0, 1)}•••@example.org`)).toBeVisible();

  // Opening it, twice, as a mail scanner would, changed nothing.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Stop these emails?' })).toBeVisible();
  expect(subscriptionOf(READER)).toBe('hourly');

  await page.getByRole('button', { name: 'Stop these emails' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'These emails are stopped' }),
  ).toBeVisible();
  expect(subscriptionOf(READER)).toBe('none');

  // Every call the door made, in front of the password: the gate asking
  // whether the site is locked and which doors are open, error tracking's
  // setting, and the two stop calls. Nothing else of the site (identity/gate.ts,
  // IN_FRONT, names the same calls). The stop itself only by the button, once.
  const NAMED = new Set([
    'GET /api/site-access/status',
    'GET /api/doors',
    'GET /api/telemetry',
    'GET /api/notifications/stop/:token',
    'POST /api/notifications/stop/:token',
  ]);
  expect(calls.filter((c) => !NAMED.has(c))).toEqual([]);
  expect(calls.filter((c) => c === 'GET /api/notifications/stop/:token')).toHaveLength(2);
  expect(calls.filter((c) => c === 'POST /api/notifications/stop/:token')).toHaveLength(1);

  // Still a door: the rest of the site is behind the password.
  await page.goto('/organizations');
  await expect(lockHeading(page)).toBeVisible();
  expect(outside).toEqual([]);
  await page.context().close();
});

test('signing out', async () => {
  await owner.goto('/');
  await signOut(owner);
  await owner.goto('/access');
  await expect(owner.getByRole('heading', { name: 'Sign in first' })).toBeVisible();
});
