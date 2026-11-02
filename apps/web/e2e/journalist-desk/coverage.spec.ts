/**
 * Coverage (decision 84), in a browser: a journalist links an article to
 * their profile and names where it is about; it waits; a moderator approves
 * it; it appears on the board's public Coverage tab with its byline, and the
 * map offers a News coverage layer. No page asks another site for anything:
 * the card is read by the server, and the article's address here is on the
 * reserved `.invalid` domain, so that read fails at once and the card shows
 * the address itself.
 *
 * In the desk's project, after account.spec.ts: it takes the owner's seat and
 * gives it back, and publishes agreements, which nothing can take back.
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
const OWNER = `e2e-cov-owner-${run}@example.org`;
const JOURNALIST = `e2e-cov-journalist-${run}@example.org`;
const ARTICLE = `https://news-${run}.invalid/2026/11/03/lines`;
let previous = '-';

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

/** Accept an agreement if the page asks for one (another test may have published it). */
async function acceptIfAsked(page: Page) {
  const box = page.getByLabel('I have read this and I accept it');
  if (await box.isVisible().catch(() => false)) {
    await box.check();
    await page.getByRole('button', { name: /accept/i }).click();
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  previous = node('src/anchor/dev-owner.ts', 'take', OWNER);
});
test.afterAll(() => {
  node('src/anchor/dev-owner.ts', 'give-back', previous, OWNER);
});

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
  const journalist = await (await signedIn(browser, JOURNALIST)).newPage();
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
