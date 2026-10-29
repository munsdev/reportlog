/**
 * Moderation, end to end, as a moderator (not an administrator): a report
 * filed the way a reporter files it (the link followed out of the email),
 * waiting in the queue and absent from the board; its second read; who filed
 * it opened with a reason; approved, and then on the board; and the reporter,
 * signed in, seeing that their details were opened and why, without being
 * told who.
 *
 * And what docs/design/checks.md section 03 asks of the moderation screens:
 * deciding in the queue and on the report page record the same decision
 * row; a bulk decline sends no email and takes one reason from the fixed
 * list; "Who filed it" asks for a written reason, and closing it without one
 * writes nothing and shows nothing.
 *
 * Run on a desktop and on a phone (the chromium and phone projects): on a
 * phone the report page decides from the bar at the foot of the screen.
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { ADMIN, MODERATOR } from '../auth.ts';
import { codeIn, countTo, lastMessageTo, linkIn } from '../identity/mail.ts';
import { doorFields } from '../door.ts';
import { goViaMenu } from '../menu.ts';
import { stepUp } from '../second-factor.ts';

test.use({ storageState: MODERATOR });

const unique = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1e6))}`;

async function fileAndConfirm(page: Page, request: APIRequestContext, email: string, what: string) {
  const card = (await (await request.get('/api/publication-card')).json()) as { digest: string };
  const before = countTo(email);
  const sent = await request.post('/api/reports', {
    data: {
      ...(await doorFields(request)),
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
  // Confirmed by somebody with no session, as the reporter would be.
  const reporter = await page.context().browser()?.newContext();
  if (!reporter) throw new Error('no browser');
  const tab = await reporter.newPage();
  await tab.goto(link);
  await tab.getByRole('button', { name: 'Confirm and file my report' }).click();
  await expect(tab.getByRole('heading', { name: 'Your report is filed' })).toBeVisible();
  await reporter.close();
}

/** The queue, searched the way a moderator searches: typed, then Enter (decision 59). */
async function search(page: Page, words: string) {
  const field = page.getByLabel('Search words or a reference');
  await field.fill(words);
  await field.press('Enter');
  await expect(page).toHaveURL(new RegExp(`q=${words}`));
}

const rowOf = (page: Page, has: Locator) =>
  page.getByRole('list', { name: 'Reports' }).getByRole('listitem').filter({ has });

/** On a phone the report page decides from a bar at the foot; on a desktop, its Decide panel. */
async function decideOnReportPage(page: Page, choice: 'Approve' | 'Decline', note: string) {
  const phone = (page.viewportSize()?.width ?? 1280) < 1024;
  let form: Locator;
  if (phone) {
    await page
      .getByRole('region', { name: 'Decide' })
      .getByRole('button', { name: `${choice}…` })
      .click();
    form = page.getByRole('dialog');
    // The sheet opens with that choice already made.
    await expect(form.getByRole('radio', { name: choice })).toBeChecked();
  } else {
    form = page.getByRole('region', { name: 'Decide' });
    await form.getByRole('radio', { name: choice }).click();
  }
  await form.getByLabel(/^Note for the record \(never sent\)/).fill(note);
  await form.getByRole('button', { name: 'Record the decision' }).click();
}

interface Entry {
  action: string;
  new_status: string | null;
  actor_email: string | null;
  by: string;
  comment: string | null;
}

async function decisionsOn(request: APIRequestContext, thread: string): Promise<Entry[]> {
  const res = await request.get(`/api/moderation/reports/${thread}`);
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { history: Entry[] };
  return body.history.filter((h) => h.action === 'review');
}

const threadIn = (url: string) => /\/moderate\/([0-9a-f-]{36})/.exec(url)?.[1] ?? '';

test('a moderator reads, opens, approves; the board shows it; the reporter sees the opening', async ({
  page,
  request,
}) => {
  const word = `zq${unique()}`;
  const email = `board-${word}@example.org`;
  await fileAndConfirm(page, request, email, `They threatened me at the door of hall ${word}.`);

  // Not on the board yet.
  await page.goto(`/board?q=${word}`);
  await expect(page.getByText('No published report matches that', { exact: true })).toBeVisible();

  // Waiting in the queue, asking for a second read.
  await page.goto('/');
  await goViaMenu(page, 'Reports queue', { area: 'Review' });
  await expect(page.getByRole('heading', { level: 1, name: 'Reports queue' })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Show reports that are' }).getByRole('button', {
      name: /^Waiting/,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await search(page, word);
  const open = page.getByRole('link', { name: /^Open RL-/ });
  await expect(open).toHaveCount(1);
  await expect(rowOf(page, open)).toContainText('Second read asked for: threatened');
  await open.click();

  await expect(page.getByRole('region', { name: 'What the reporter said' })).toContainText(word);
  const second = page.getByRole('region', { name: 'Second read' });
  await expect(second).toContainText('threatened');
  await second.getByRole('button', { name: 'Clear Second read' }).click();
  const bar = page.getByRole('region', { name: 'Unsaved changes' });
  await bar.getByRole('button', { name: 'I have read it' }).click();
  await expect(second).toBeHidden();

  // Who filed it: closing it without a reason writes nothing and shows nothing.
  const who = page.getByRole('region', { name: 'Who filed it' });
  await expect(who).toContainText('Restricted. Every look is logged with your reason.');
  await who.getByRole('button', { name: 'Look… Who filed it' }).click();
  await bar.getByRole('button', { name: 'Open the details' }).click();
  await expect(who.getByText(/Say why you need them/)).toBeVisible();
  await bar.getByRole('button', { name: 'Cancel' }).click();
  await expect(who).toContainText('Restricted. Every look is logged with your reason.');
  await expect(who).not.toContainText(email);

  // Then with a reason, which the reporter will see. It asks for the second
  // factor again (plan E, E3).
  await who.getByRole('button', { name: 'Look… Who filed it' }).click();
  await who.getByLabel('Why you need them').fill('To ask which door of the hall it was.');
  await stepUp(page.request);
  await bar.getByRole('button', { name: 'Open the details' }).click();
  await expect(who).toContainText(email);
  await expect(who).toContainText('This look was recorded.');

  // Approve.
  await decideOnReportPage(page, 'Approve', 'Consistent and specific.');
  await expect(page.getByText('Public', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'The record' })).toContainText(
    'Consistent and specific.',
  );

  // On the board, without any of moderation's workings.
  await page.goto('/board');
  await page.getByLabel('Search the words').fill(word);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`q=${word}`));
  await page.getByRole('link', { name: /RL-[A-Z0-9-]+/ }).click();
  await expect(page.getByRole('region', { name: 'What the reporter said' })).toContainText(word);
  await expect(page.locator('main')).not.toContainText('second read');
  await expect(page.locator('main')).not.toContainText(email);

  // The reporter signs in and sees the one opening, with the reason, and not
  // who: the look closed without a reason left nothing.
  const reporter = await page.context().browser()?.newContext();
  if (!reporter) throw new Error('no browser');
  const tab = await reporter.newPage();
  await tab.goto('/access/sign-in?next=/mine');
  const before = countTo(email);
  await tab.getByLabel('Your email address').fill(email);
  await tab.getByRole('button', { name: 'Send me a code' }).click();
  await tab.getByLabel('The code from the email').fill(codeIn(await lastMessageTo(email, before)));
  await tab.getByRole('button', { name: 'Sign in' }).click();
  await tab.getByRole('link', { name: /^Open RL-/ }).click();
  const seen = tab.getByRole('region', { name: 'Who looked at your details' });
  await expect(seen).toContainText('To ask which door of the hall it was.');
  await expect(seen.getByRole('listitem')).toHaveCount(1);
  await expect(seen).not.toContainText('@');
  await reporter.close();
});

test('deciding in the queue and on the report page record the same decision row', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const word = `dq${unique()}`;
  await fileAndConfirm(page, request, `q1-${word}@example.org`, `First of two, ${word}.`);
  await fileAndConfirm(page, request, `q2-${word}@example.org`, `Second of two, ${word}.`);

  // Oldest first while waiting: the first filed is the first row.
  await page.goto('/moderate');
  await search(page, word);
  const rows = page.getByRole('list', { name: 'Reports' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  const firstRow = rows.first();
  const firstOpen = firstRow.getByRole('link', { name: /^Open RL-/ });
  const firstThread = threadIn((await firstOpen.getAttribute('href')) ?? '');
  const secondThread = threadIn(
    (await rows
      .nth(1)
      .getByRole('link', { name: /^Open RL-/ })
      .getAttribute('href')) ?? '',
  );
  const firstRef = ((await firstOpen.textContent()) ?? '').replace(/^Open\s*/, '').trim();

  // Decide here: the report page's own form, in place.
  const decideHere = firstRow.getByRole('button', { name: 'Decide here' });
  await decideHere.click();
  await expect(decideHere).toHaveAttribute('aria-expanded', 'true');
  const form = firstRow.getByRole('form', { name: `Decide ${firstRef}` });
  await form.getByRole('radio', { name: 'Approve' }).click();
  await form.getByLabel(/^Note for the record \(never sent\)/).fill('Checked against the photos.');
  await form.getByRole('button', { name: 'Record the decision' }).click();

  // It leaves the Waiting list with a toast, and focus moves to the next row's Decide here.
  await expect(page.getByText(`${firstRef} approved.`)).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole('button', { name: 'Decide here' })).toBeFocused();

  // The second, on its own page.
  await rows
    .first()
    .getByRole('link', { name: /^Open RL-/ })
    .click();
  await decideOnReportPage(page, 'Approve', 'Checked against the photos.');
  await expect(page.getByText('Public', { exact: true })).toBeVisible();

  // One decision row each, alike in everything but the report it is about.
  const fromQueue = await decisionsOn(page.request, firstThread);
  const fromPage = await decisionsOn(page.request, secondThread);
  expect(fromQueue).toHaveLength(1);
  expect(fromPage).toHaveLength(1);
  const shape = ({ action, new_status, actor_email, by, comment }: Entry) => ({
    action,
    new_status,
    actor_email,
    by,
    comment,
  });
  const [queued] = fromQueue;
  const [paged] = fromPage;
  if (!queued || !paged) throw new Error('a decision is missing');
  expect(shape(queued)).toEqual(shape(paged));
  expect(queued).toMatchObject({ action: 'review', new_status: 'valid', by: 'staff' });
});

test('a bulk decline takes one reason from the fixed list and emails nobody', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const word = `bd${unique()}`;
  const emails = [`b1-${word}@example.org`, `b2-${word}@example.org`];
  for (const email of emails) await fileAndConfirm(page, request, email, `Spam spam ${word}.`);
  const before = emails.map(countTo);

  await page.goto('/moderate');
  await search(page, word);
  await page
    .getByRole('checkbox', { name: /^Select RL-/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Select all 2' }).click();
  await page.getByRole('button', { name: 'Decline selected…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Decline 2 selected' });
  await expect(dialog).toContainText('Nobody is emailed when you decline in bulk.');
  // One reason, from the fixed list, and nothing goes without it.
  await dialog.getByRole('button', { name: 'Decline 2' }).click();
  await expect(dialog.getByText(/Choose the reason/)).toBeVisible();
  await dialog.getByLabel('The reason').selectOption('abusive_or_spam');
  await stepUp(page.request);
  await dialog.getByRole('button', { name: 'Decline 2' }).click();
  await expect(page.getByText('Declined 2. Nobody was emailed.')).toBeVisible();

  // Each is declined, with its own decision under that reason.
  await page.goto(`/moderate?status=invalid&q=${word}`);
  await expect(page.getByRole('link', { name: /^Open RL-/ })).toHaveCount(2);
  // Decision 51: nobody was emailed, though both reporters gave an address.
  expect(emails.map(countTo)).toEqual(before);
});

test('two on one report: each sees the other, and a stale decision is refused, not recorded', async ({
  page,
  request,
  playwright,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const word = `two${unique()}`;
  await fileAndConfirm(page, request, `two-${word}@example.org`, `Open twice, ${word}.`);
  await page.goto('/moderate');
  await search(page, word);
  const open = page.getByRole('link', { name: /^Open RL-/ });
  const thread = threadIn((await open.getAttribute('href')) ?? '');

  // An administrator already has it open: the page says so on its first heartbeat.
  const admin = await playwright.request.newContext({
    baseURL: baseURL ?? 'http://127.0.0.1:4173',
    storageState: ADMIN,
  });
  const beat = await admin.post(`/api/moderation/reports/${thread}/viewing`);
  expect(beat.ok(), await beat.text()).toBe(true);
  const { seen } = (await beat.json()) as { seen: string };
  await open.click();
  await expect(page.getByText(/has it open too\. If you are both deciding it/)).toBeVisible();

  // The administrator decides it while the moderator's page still shows it waiting.
  const decided = await admin.post(`/api/moderation/reports/${thread}/decision`, {
    data: { status: 'valid', comment: 'Decided first.', seen },
  });
  expect(decided.ok(), await decided.text()).toBe(true);
  await admin.dispose();

  // The page's own Decide form, beside the report on a desktop and under it on a phone.
  const form = page.getByRole('form', { name: /^Decide RL-/ }).first();
  await form.getByRole('radio', { name: 'Decline' }).check();
  await form.getByLabel('The reason the reporter is told').selectOption('duplicate');
  await form.getByLabel(/^Note for the record/).fill('Decided second, without knowing.');
  await form.getByRole('button', { name: 'Record the decision' }).click();
  await expect(
    form.getByText(/approved it after you opened it\. Nothing you sent was recorded\./),
  ).toBeVisible();

  // Only the administrator's decision is on the record.
  const record = await decisionsOn(page.request, thread);
  expect(record).toHaveLength(1);
  expect(record[0]).toMatchObject({ new_status: 'valid' });

  // Shown as it is now, the page says approved.
  await form.getByRole('button', { name: 'Show it as it is now' }).click();
  await expect(page.getByText(/ · Approved$/)).toBeVisible();
});

test('a moderator is not shown the administrators’ settings', async ({ page }) => {
  await page.goto('/moderate/settings');
  await expect(page.getByRole('heading', { name: 'Not for this account' })).toBeVisible();
  await expect(page.getByText('Only an administrator can open this page.')).toBeVisible();
});
