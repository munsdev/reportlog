/**
 * Vetted journalist access, followed through its emails (plan D, J7a to J13;
 * review item 15): a subscriber asks for the request form, opens the emailed
 * link, sends a request; the owner approves it; the approval email's desk
 * link opens the agreement and then the desk, which shows the checked link
 * and not the unchecked one; the owner revokes, and the next look is refused.
 *
 * Its own project, after the owner's: it hands the owner's seat to a test
 * address (apps/api/src/anchor/dev-owner.ts) and gives it back afterwards,
 * and it publishes a journalist agreement, which nothing can take back.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { axe, describeViolation } from '../a11y.ts';
import { codeIn, countTo, lastMessageTo } from '../identity/mail.ts';
import { passSecondFactor, stepUp } from '../second-factor.ts';

const API = fileURLToPath(new URL('../../../api/', import.meta.url));
const OUTBOX = fileURLToPath(new URL('../.outbox/', import.meta.url));
const run = `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;
const OWNER = `e2e-desk-owner-${run}@example.org`;
const JOURNALIST = `e2e-desk-journalist-${run}@example.org`;
const CHECKED = `https://checked-${run}.example.org/post/1`;
const UNCHECKED = `https://unchecked-${run}.example.org/post/1`;
const COMMENT = `Matches the original upload ${run}.`;
let previous = '-';

/** The same key the test server runs with (playwright.config.ts). */
const env = {
  ...process.env,
  MAIL_OUTBOX: OUTBOX,
  CONTACT_KEY: Buffer.alloc(32, 9).toString('base64'),
};
const node = (script: string, ...args: string[]) =>
  execFileSync('node', ['--env-file-if-exists=../../.env', script, ...args], {
    cwd: API,
    env,
    encoding: 'utf8',
  }).trim();

async function signIn(request: APIRequestContext, email: string) {
  const before = countTo(email);
  const asked = await request.post('/api/auth/code', { data: { email } });
  expect(asked.ok(), await asked.text()).toBe(true);
  const code = codeIn(await lastMessageTo(email, before));
  const signed = await request.post('/api/auth/sign-in', { data: { email, code } });
  expect(signed.ok(), await signed.text()).toBe(true);
  await passSecondFactor(request, email);
}

async function signedIn(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  await signIn(context.request, email);
  return context;
}

function outsideRequests(page: Page) {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

async function noViolations(page: Page) {
  expect((await axe(page)).violations.map(describeViolation)).toEqual([]);
}

const linkIn = (text: string, path: string) =>
  new RegExp(`https?://\\S+${path}(?:/[a-f0-9]{64})?`).exec(text)?.[0] ?? '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  previous = node('src/anchor/dev-owner.ts', 'take', OWNER);
  node('src/dev/desk-state.ts', 'links', CHECKED, UNCHECKED, COMMENT);
});
test.afterAll(() => {
  node('src/anchor/dev-owner.ts', 'give-back', previous, OWNER);
});

test('a journalist asks, the owner approves, the desk shows checked links, and revoking ends it', async ({
  browser,
  request,
}) => {
  const outside: string[] = [];

  // On the alert list first (its own browser test follows that link).
  let before = countTo(JOURNALIST);
  const signup = await request.post('/api/journalists/signup', {
    data: { name: 'Pat Reporter', outlet: 'Desk Daily', email: JOURNALIST, states: ['US-VT'] },
  });
  expect(signup.ok(), await signup.text()).toBe(true);
  const confirm = linkIn((await lastMessageTo(JOURNALIST, before)).text, '/journalists/confirm');
  expect(
    (
      await request.post(new URL(confirm).pathname.replace('/journalists', '/api/journalists'))
    ).ok(),
  ).toBe(true);

  // J7a: ask for the form; the link arrives by email.
  const asking = await (await browser.newContext()).newPage();
  outside.push(...outsideRequests(asking));
  await asking.goto('/journalists/access');
  await noViolations(asking);
  await asking.getByLabel('The address you joined the alert list with').fill(JOURNALIST);
  before = countTo(JOURNALIST);
  await asking.getByRole('button', { name: 'Email me the request form' }).click();
  await expect(asking.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  const form = linkIn((await lastMessageTo(JOURNALIST, before)).text, '/journalists/access');
  expect(form).toMatch(/[a-f0-9]{64}$/);

  const link = await (await browser.newContext()).newPage();
  outside.push(...outsideRequests(link));
  await link.goto(form);
  await expect(
    link.getByRole('heading', { level: 1, name: 'Ask for access to the journalist desk' }),
  ).toBeVisible();
  await noViolations(link);
  await link.getByLabel('Your outlet').fill('Desk Daily');
  await link.getByLabel('Your role there').fill('Reporter');
  await link
    .getByLabel('Who are you?')
    .fill('Pat, covering Vermont for Desk Daily. https://deskdaily.example.org/by/pat');
  await link.getByLabel('Press card number (optional)').fill('PC-777');
  await link.getByRole('button', { name: 'Send my request to the owner' }).click();
  await expect(
    link.getByRole('heading', { level: 1, name: 'Your request is with the owner' }),
  ).toBeVisible();

  // J7b, J7: the owner's queue, and the agreement the desk waits for (J8).
  const owner = await (await signedIn(browser, OWNER)).newPage();
  outside.push(...outsideRequests(owner));
  await owner.goto('/access/journalists/agreement');
  await owner.getByLabel('The new version').fill(`Use what you read here with care. ${run}`);
  // Publishing an agreement and deciding a journalist ask for a step-up (plan E, E3).
  await stepUp(owner.request);
  await owner.getByRole('button', { name: 'Publish this version' }).click();
  await expect(owner.getByText('Published.')).toBeVisible();

  await owner.goto('/access/journalists');
  const card = owner.getByRole('article', { name: 'Request from Pat Reporter' });
  await expect(card.getByText('PC-777')).toBeVisible();
  await expect(card.getByText('https://deskdaily.example.org/by/pat')).toBeVisible();
  await noViolations(owner);
  before = countTo(JOURNALIST);
  await stepUp(owner.request);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card.getByRole('button', { name: 'Revoke access' })).toBeVisible();

  // The approval email's link, followed: the agreement, then the desk.
  // It points straight at the desk (which asks for a sign-in), and says what happens next.
  const approval = (await lastMessageTo(JOURNALIST, before)).text;
  expect(approval).toMatch(/https?:\/\/\S+\/desk\s/);
  expect(approval).toContain('journalist agreement');
  const reader = await (await signedIn(browser, JOURNALIST)).newPage();
  outside.push(...outsideRequests(reader));
  // Already signed in by the helper, so the link's landing page is the desk itself.
  await reader.goto('/desk');
  await expect(
    reader.getByRole('heading', { level: 1, name: 'Read and accept the agreement' }),
  ).toBeVisible();
  await noViolations(reader);
  await reader.getByRole('button', { name: 'I have read this and I accept it' }).click();
  await expect(reader.getByRole('heading', { level: 1, name: 'Checked links' })).toBeVisible();
  const entry = reader.locator('[data-desk-link]').filter({ hasText: CHECKED });
  await expect(entry).toBeVisible();
  await expect(entry.getByText(COMMENT)).toBeVisible();
  await expect(reader.getByText(UNCHECKED)).toHaveCount(0);
  // K6: text, never an anchor.
  await expect(reader.locator(`a[href*="checked-${run}"]`)).toHaveCount(0);
  await noViolations(reader);

  // Decision 47: their own alerts, changed from the desk with no email. Off keeps the desk.
  await reader
    .getByRole('navigation')
    .getByRole('link', { name: 'Your alerts', exact: true })
    .first()
    .click();
  await expect(reader.getByRole('heading', { level: 1, name: 'Your alerts' })).toBeVisible();
  const alerts = reader.getByRole('region', { name: 'Your alerts' });
  await expect(alerts.getByRole('radio', { name: 'Send me alerts' })).toBeChecked();
  await alerts.getByRole('radio', { name: /Turn alerts off for now/ }).click();
  await alerts.getByRole('checkbox', { name: 'Nevada' }).click();
  await alerts.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(alerts.getByText('Your alert settings are saved.')).toBeVisible();
  expect(node('src/dev/journalists-state.ts', 'listed', JOURNALIST)).toBe('paused');
  await reader.reload();
  await expect(reader.getByRole('heading', { level: 1, name: 'Your alerts' })).toBeVisible();
  await expect(alerts.getByRole('radio', { name: /Turn alerts off for now/ })).toBeChecked();
  await expect(alerts.getByRole('checkbox', { name: 'Nevada' })).toBeChecked();
  await reader.goto('/desk');
  await expect(entry).toBeVisible();
  // Decision 72: a search applies when asked for, and finds the link by its words.
  await reader.getByRole('searchbox', { name: 'Search' }).fill('no-such-words-here');
  await expect(entry).toBeVisible();
  await reader.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(entry).toHaveCount(0);
  await noViolations(reader);

  // J13: revoked, and the next look is refused.
  await card.getByRole('button', { name: 'Revoke access' }).click();
  await expect(card.getByText('Revoked', { exact: true })).toBeVisible();
  await reader.reload();
  // Decision 80: no dead end. The desk says the access ended and offers a new request.
  await expect(reader.getByRole('heading', { level: 1, name: 'Journalist desk' })).toBeVisible();
  await expect(reader.getByText('Your access to the desk has ended.')).toBeVisible();
  await expect(reader.getByRole('button', { name: 'Apply for desk access' })).toBeVisible();
  await expect(reader.getByText(CHECKED)).toHaveCount(0);

  expect(outside).toEqual([]);
});

test('a signed-in account joins alerts and applies in one step; approval opens the desk; not approved stays visible', async ({
  browser,
}) => {
  const outside: string[] = [];
  const APPLICANT = `e2e-desk-applicant-${run}@example.org`;
  const TURNED_DOWN = `e2e-desk-turned-down-${run}@example.org`;
  const apply = async (page: Page, name: string) => {
    await page.getByLabel('Your name').fill(name);
    await page.getByLabel('Your outlet').fill('Desk Daily');
    await page.getByLabel('Your role there').fill('Reporter');
    await page.getByLabel('Who are you?').fill('Covering Delaware for Desk Daily.');
    await expect(page.getByText(`Use what you read here with care. ${run}`)).toBeVisible();
    // The acceptance is part of the same step: ticking it is what sends it.
    await page.getByRole('button', { name: 'Apply for desk access' }).click();
    await expect(page.getByText('Tick the box to accept the agreement.')).toBeVisible();
    await page.getByLabel('I have read the journalist agreement and I accept it.').check();
    await page.getByRole('button', { name: 'Apply for desk access' }).click();
  };

  // Alerts: no name or address to type, no link to confirm, and an email saying what changed.
  const applicant = await (await signedIn(browser, APPLICANT)).newPage();
  outside.push(...outsideRequests(applicant));
  await applicant.goto('/journalists/alerts');
  await expect(
    applicant.getByRole('heading', { level: 1, name: 'Alerts and desk access' }),
  ).toBeVisible();
  await expect(applicant.getByLabel('Your email address')).toHaveCount(0);
  await expect(applicant.getByRole('heading', { name: 'Journalist desk' })).toBeVisible();
  await noViolations(applicant);
  await applicant.getByRole('checkbox', { name: 'Delaware' }).check();
  let before = countTo(APPLICANT);
  await applicant.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(applicant.getByText('Your alert settings are saved.')).toBeVisible();
  const changed = await lastMessageTo(APPLICANT, before);
  expect(changed.subject).toBe('Your alerts changed');
  expect(changed.text).toMatch(/\/journalists\/stop\/[a-f0-9]{64}/);
  expect(node('src/dev/journalists-state.ts', 'listed', APPLICANT)).toBe('active');

  // One form, one button; the people who decide are told, and the applicant sees the status.
  const owner = await (await signedIn(browser, OWNER)).newPage();
  outside.push(...outsideRequests(owner));
  const ownerBefore = countTo(OWNER);
  before = countTo(APPLICANT);
  await apply(applicant, 'Alex Applicant');
  await expect(applicant.getByText(/Your request is pending since/)).toBeVisible();
  await expect(applicant.getByRole('button', { name: 'Apply for desk access' })).toHaveCount(0);
  expect((await lastMessageTo(APPLICANT, before)).subject).toContain('was received');
  const waiting = await lastMessageTo(OWNER, ownerBefore);
  expect(waiting.subject).toBe('A journalist desk request is waiting');
  expect(waiting.text).not.toContain('Alex Applicant');
  await applicant.reload();
  await expect(applicant.getByText(/Your request is pending since/)).toBeVisible();
  await noViolations(applicant);

  // Approved by someone who decides (the owner satisfies administrator; the
  // administrator and access manager are checked in the database tests).
  await owner.goto('/access/journalists');
  const card = owner.getByRole('article', { name: 'Request from Alex Applicant' });
  await stepUp(owner.request);
  before = countTo(APPLICANT);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card.getByRole('button', { name: 'Revoke access' })).toBeVisible();

  // The email's link opens the desk itself: they accepted the agreement when they applied.
  const approval = (await lastMessageTo(APPLICANT, before)).text;
  expect(approval).toContain('already accepted');
  const link = linkIn(approval, '/desk');
  expect(link).not.toBe('');
  await applicant.goto(new URL(link).pathname);
  await expect(applicant.getByRole('heading', { level: 1, name: 'Checked links' })).toBeVisible();
  await expect(
    applicant.getByRole('heading', { name: 'Read and accept the agreement' }),
  ).toHaveCount(0);

  // Not approved stays visible, and they may ask again.
  const turned = await (await signedIn(browser, TURNED_DOWN)).newPage();
  outside.push(...outsideRequests(turned));
  await turned.goto('/desk');
  await expect(turned.getByRole('heading', { level: 1, name: 'Journalist desk' })).toBeVisible();
  await apply(turned, 'Sam Turned-down');
  await expect(turned.getByText(/Your request is pending since/)).toBeVisible();
  await owner.reload();
  const other = owner.getByRole('article', { name: 'Request from Sam Turned-down' });
  await stepUp(owner.request);
  await other.getByRole('button', { name: 'Reject' }).click();
  await owner.getByRole('dialog').getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(other).toHaveCount(0);
  await turned.reload();
  await expect(turned.getByText(/was not approved/)).toBeVisible();
  await expect(turned.getByRole('button', { name: 'Apply for desk access' })).toBeVisible();

  expect(outside).toEqual([]);
});
