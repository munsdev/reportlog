/**
 * A signed-in account on the journalist pages (decision 80): it joins alerts
 * with no link to confirm, applies for the desk in one step that includes the
 * agreement, is approved by someone who decides, and the email's link opens
 * the desk; a rejected request reads "not approved" and may be made again.
 *
 * Then coverage (decision 84): a journalist links an article, a moderator
 * approves it, and it is on the public Coverage tab.
 *
 * Its own file, in the desk's project (it takes the owner's seat and gives it
 * back, and publishes a journalist agreement, which nothing can take back).
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
const OWNER = `e2e-acct-owner-${run}@example.org`;

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
});
test.afterAll(() => {
  node('src/anchor/dev-owner.ts', 'give-back', previous, OWNER);
});

test('a signed-in account joins alerts and applies in one step; approval opens the desk; not approved stays visible', async ({
  browser,
}) => {
  const outside: string[] = [];
  // The agreement the applicants accept: published here so this test stands alone.
  const publisher = await (await signedIn(browser, OWNER)).newPage();
  await publisher.goto('/access/journalists/agreement');
  await publisher.getByLabel('The new version').fill(`Use what you read here with care. ${run}`);
  await stepUp(publisher.request);
  await publisher.getByRole('button', { name: 'Publish this version' }).click();
  await expect(publisher.getByText('Published.')).toBeVisible();
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
  await expect(applicant.getByRole('heading', { name: 'Journalist access' })).toBeVisible();
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
  await expect(
    owner
      .getByRole('row', { name: /Alex Applicant/ })
      .getByRole('button', { name: 'Revoke access' }),
  ).toBeVisible();

  // The email's link opens the desk itself: they accepted the agreement when they applied.
  const approval = (await lastMessageTo(APPLICANT, before)).text;
  expect(approval).toContain('already accepted');
  const link = linkIn(approval, '/desk');
  expect(link).not.toBe('');
  await applicant.goto(new URL(link).pathname);
  // Decision 81: they land on the board like anyone, with the journalists' extras on it.
  await expect(applicant).toHaveURL(/\/board$/);
  await expect(applicant.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  await expect(
    applicant
      .getByRole('navigation', { name: 'Report views' })
      .getByRole('link', { name: 'Links' }),
  ).toBeVisible();
  // Search is the board's; "My states" is theirs, because they chose Delaware for alerts.
  await expect(applicant.getByRole('searchbox', { name: 'Search reports' })).toBeVisible();
  await applicant.getByRole('checkbox', { name: 'My states' }).check();
  await expect(applicant).toHaveURL(/mine=true/);
  await expect(
    applicant.getByRole('button', { name: 'Remove the filter My states' }),
  ).toBeVisible();
  await expect(
    applicant.getByRole('heading', { name: 'Read and accept the agreement' }),
  ).toHaveCount(0);

  // Not approved stays visible, and they may ask again.
  const turned = await (await signedIn(browser, TURNED_DOWN)).newPage();
  outside.push(...outsideRequests(turned));
  await turned.goto('/desk');
  await expect(turned.getByRole('heading', { level: 1, name: 'Journalist access' })).toBeVisible();
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

// Coverage (decision 84): its own journalist and an article on the reserved
// `.invalid` domain, so the server's read of the page fails at once and the
// card shows the address itself. Here, not in a file of its own, because it
// needs the owner's seat this file holds, and files run side by side.
const COV_JOURNALIST = `e2e-cov-journalist-${run}@example.org`;
const ARTICLE = `https://news-${run}.invalid/2026/11/03/lines`;

/** Accept an agreement if the page asks for one (another test may have published it). */
async function acceptIfAsked(page: Page) {
  const box = page.getByLabel('I have read this and I accept it');
  if (await box.isVisible().catch(() => false)) {
    await box.check();
    await page.getByRole('button', { name: /accept/i }).click();
  }
}

test('a journalist links an article; a moderator approves it; it is on the public Coverage tab', async ({
  browser,
}) => {
  const outside: string[] = [];
  const owner = await (await signedIn(browser, OWNER)).newPage();
  outside.push(...outsideRequests(owner));

  // A journalist agreement to accept, published here so this test stands alone.
  await owner.goto('/access/journalists/agreement');
  await owner.getByLabel('The new version').fill(`Coverage agreement ${run}`);
  await stepUp(owner.request);
  await owner.getByRole('button', { name: 'Publish this version' }).click();
  await expect(owner.getByText('Published.')).toBeVisible();

  // Apply from the account, and be approved.
  const journalist = await (await signedIn(browser, COV_JOURNALIST)).newPage();
  outside.push(...outsideRequests(journalist));
  await journalist.goto('/journalists/alerts');
  await journalist.getByLabel('Your name').fill('Casey Columnist');
  await journalist.getByLabel('Your outlet').fill('Coverage Daily');
  await journalist.getByLabel('Your role there').fill('Reporter');
  await journalist.getByLabel('Who are you?').fill('Elections reporter.');
  await journalist.getByLabel('I have read the journalist agreement and I accept it.').check();
  await journalist.getByRole('button', { name: 'Apply for desk access' }).click();
  await expect(journalist.getByText(/Your request is pending since/)).toBeVisible();
  await owner.goto('/access/journalists');
  await stepUp(owner.request);
  await owner
    .getByRole('article', { name: 'Request from Casey Columnist' })
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect(
    owner
      .getByRole('row', { name: /Casey Columnist/ })
      .getByRole('button', { name: 'Revoke access' }),
  ).toBeVisible();

  // The profile: a byline, then an article in Delaware and nationally.
  await journalist.goto('/journalists/coverage');
  await expect(journalist.getByRole('heading', { level: 1, name: 'Your coverage' })).toBeVisible();
  await noViolations(journalist);
  await journalist.getByLabel('Name', { exact: true }).fill('Casey Columnist');
  await journalist.getByLabel('Outlet').fill('Coverage Daily');
  await journalist.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(journalist.getByText('Saved.')).toBeVisible();

  await journalist.getByLabel('Address of the article').fill(ARTICLE);
  await journalist.getByLabel('When did it happen?').fill('2026-11-03');
  await journalist.getByRole('checkbox', { name: /National: the United States/ }).check();
  await journalist.getByLabel('State', { exact: true }).selectOption({ label: 'Delaware' });
  await journalist.getByRole('button', { name: 'Add' }).first().click();
  await expect(journalist.getByRole('list', { name: 'Places added' })).toContainText('Delaware');
  await journalist.getByRole('button', { name: 'Link it' }).click();
  await expect(journalist.getByText('Linked. It is waiting for a moderator.')).toBeVisible();
  const mine = journalist.getByRole('article').filter({ hasText: ARTICLE });
  await expect(mine).toContainText('Waiting for a moderator');
  await expect(mine).toContainText('National · Delaware');

  // Not public while it waits.
  const reader = await (await browser.newContext()).newPage();
  outside.push(...outsideRequests(reader));
  await reader.goto('/board/coverage');
  await expect(reader.getByText(ARTICLE)).toHaveCount(0);

  // The moderator's queue: the owner satisfies administrator, whom the queue admits.
  await owner.goto('/moderate/coverage');
  await acceptIfAsked(owner);
  await expect(owner.getByRole('heading', { level: 1, name: 'Coverage' })).toBeVisible();
  // The innermost article: the staff page's own frame is one too.
  const queued = owner.getByRole('article').filter({ hasText: ARTICLE }).last();
  await expect(queued).toContainText('Linked by Casey Columnist, Coverage Daily');
  await noViolations(owner);
  await queued.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(owner.getByText(ARTICLE)).toHaveCount(0);

  // Public now: on the Coverage tab, and narrowed by a place in the address.
  await reader.goto('/board/coverage');
  await expect(
    reader
      .getByRole('navigation', { name: 'Report views' })
      .getByRole('link', { name: 'Coverage' }),
  ).toBeVisible();
  const card = reader.getByRole('article').filter({ hasText: ARTICLE });
  await expect(card).toContainText('Linked by Casey Columnist, Coverage Daily');
  await expect(card.getByRole('link', { name: ARTICLE })).toHaveAttribute(
    'rel',
    'noopener noreferrer nofollow',
  );
  await noViolations(reader);
  await reader.goto('/board/coverage?place=US-DE');
  await expect(reader.getByRole('article').filter({ hasText: ARTICLE })).toBeVisible();
  await reader.goto('/board/coverage?place=US-TX');
  await expect(reader.getByText('No articles about this place yet.')).toBeVisible();

  // The author keeps it to the profile: it leaves the public list at once.
  await journalist.reload();
  await journalist
    .getByRole('article')
    .filter({ hasText: ARTICLE })
    .getByRole('button', { name: 'Keep it to my profile' })
    .click();
  await expect(journalist.getByRole('article').filter({ hasText: ARTICLE })).toContainText(
    'On your profile only.',
  );
  await reader.goto('/board/coverage');
  await expect(reader.getByText(ARTICLE)).toHaveCount(0);

  expect(outside).toEqual([]);
});
