/**
 * The card frame (docs/design/screens/filing.md §02 to §05, checks.md §03
 * FILING), in a real browser on a desktop and a phone:
 *
 *   - the opening card carries the emergency notice, the three lines of what
 *     happens next, Start, and the seal line;
 *   - no card advances on its own; Next on an unanswered required card is not
 *     disabled, says why, and moves focus to the sentence;
 *   - Back, on the page or in the browser, returns to the card before with
 *     its answer kept;
 *   - a question whose "only if" does not hold is never sent, not even empty;
 *   - the tab names the question and where it is, "(n of m)";
 *   - on a phone Back and Next are fixed to the bottom of the screen, and the
 *     last choice can be scrolled clear of them;
 *   - the review says "Not answered" for an optional question left blank;
 *   - the progress is published on <html> for the header's rule;
 *   - nothing is asked of another host.
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { ADMIN } from '../auth.ts';
import { expectAccessible } from './axe.ts';

const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

const heading = (page: Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true });
const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });

/** A logbook with a choice, a follow-up only for one answer, and an optional note. */
async function logbook(admin: APIRequestContext, title: string) {
  const made = await admin.post('/api/admin/logbooks', { data: { title } });
  expect(made.ok(), await made.text()).toBe(true);
  const lb = (await made.json()) as { id: number; slug: string };
  const add = async (data: Record<string, unknown>) => {
    const r = await admin.post(`/api/admin/logbooks/${String(lb.id)}/fields`, { data });
    expect(r.ok(), await r.text()).toBe(true);
    return ((await r.json()) as { key: string }).key;
  };
  const went = await add({
    kind: 'choice_one',
    label: 'How did it go?',
    required: true,
    settings: { options: ['Fine', 'Badly'] },
  });
  const why = await add({
    kind: 'choice_many',
    label: 'What went wrong?',
    required: true,
    settings: { options: ['A long queue', 'A locked door', 'No ballots'] },
    shown_when: { field: went, in: ['Badly'] },
  });
  const seen = await add({ kind: 'yes_no', label: 'Did anybody else see it?' });
  const launched = await admin.post(`/api/admin/logbooks/${String(lb.id)}/launch`);
  expect(launched.ok(), await launched.text()).toBe(true);
  return { ...lb, keys: { went, why, seen } };
}

test('the card frame: the opening card, errors that take focus, Back that keeps answers, and only what was asked is sent', async ({
  page,
  playwright,
}, info) => {
  const baseURL = info.project.use.baseURL ?? 'http://127.0.0.1:4173';
  const admin = await playwright.request.newContext({ baseURL, storageState: ADMIN });
  const title = `Card frame ${info.project.name} ${run()}`;
  const lb = await logbook(admin, title);
  await admin.dispose();

  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  const sent: Record<string, unknown>[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/reports') {
      sent.push(r.postDataJSON() as Record<string, unknown>);
    }
  });

  await page.goto(`/file/${lb.slug}`);
  // THE OPENING CARD.
  await expect(heading(page, title)).toBeVisible();
  await expect(page.getByText('If someone needs help right now')).toBeVisible();
  await expect(page.locator('[data-copy="help_now"]')).not.toBeEmpty();
  await expect(page.getByText('A moderator reads it before anything is public.')).toBeVisible();
  // No progress yet, on the page or for the header.
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-filing-progress', /.*/);
  await expect(page).toHaveTitle(new RegExp(`^${title} · `));
  await expectAccessible(page, 'the opening card');
  await page.getByRole('button', { name: 'Start' }).click();

  // THE FIRST QUESTION: the tab says where it is; Next is never disabled.
  await expect(heading(page, 'How did it go?')).toBeFocused();
  await expect(page).toHaveTitle(/^How did it go\? \(1 of \d+\) · /);
  await expect(page.locator('html')).toHaveAttribute('data-filing-progress', '');
  await expect(next(page)).toBeEnabled();
  await next(page).click();
  const error = page.getByRole('alert').filter({ hasText: 'An answer is needed here.' });
  await expect(error).toBeVisible();
  await expect(error).toBeFocused();
  await expect(heading(page, 'How did it go?')).toBeVisible();

  // Choosing moves nobody on, and adds nothing to this card.
  await page.getByRole('radio', { name: 'Badly' }).check();
  await expect(heading(page, 'How did it go?')).toBeVisible();
  await expect(page.getByText('What went wrong?')).toHaveCount(0);
  await expectAccessible(page, 'a choice card with an answer');
  await next(page).click();

  // The follow-up is the NEXT card, and says what the kind needs said.
  await expect(heading(page, 'What went wrong?')).toBeFocused();
  await expect(page.getByText('Tick everything that applies.')).toBeVisible();
  if (info.project.name === 'phone') {
    // Fixed to the bottom of the screen, and the last choice scrolls clear of it.
    const bar = page.locator('[data-card-bar]');
    const box = await bar.boundingBox();
    const viewport = page.viewportSize();
    const gap = box && viewport ? Math.abs(viewport.height - (box.y + box.height)) : Infinity;
    expect(gap).toBeLessThanOrEqual(1);
    const last = page.getByRole('checkbox', { name: 'No ballots' });
    await last.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 2000);
    const lastBox = await last.boundingBox();
    const barBox = await bar.boundingBox();
    expect((lastBox?.y ?? 0) + (lastBox?.height ?? 0)).toBeLessThanOrEqual(barBox?.y ?? 0);
  }
  await page.getByRole('checkbox', { name: 'A long queue' }).check();

  // Back on the page returns with the answer kept; so does the browser's.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(heading(page, 'How did it go?')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Badly' })).toBeChecked();
  await next(page).click();
  await expect(page.getByRole('checkbox', { name: 'A long queue' })).toBeChecked();
  await next(page).click();
  await expect(heading(page, 'Did anybody else see it?')).toBeVisible();
  await page.goBack();
  await expect(heading(page, 'What went wrong?')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'A long queue' })).toBeChecked();
  await page.goBack();
  await expect(heading(page, 'How did it go?')).toBeVisible();

  // Now "Fine": the follow-up is no longer asked, so it must not be sent.
  await page.getByRole('radio', { name: 'Fine' }).check();
  await next(page).click();
  await expect(heading(page, 'Did anybody else see it?')).toBeVisible();
  // Optional, and left blank.
  await expect(page.getByText('Optional.', { exact: true })).toBeVisible();
  await next(page).click();
  await page.getByRole('radio', { name: 'Yes, it may be published' }).check();
  await next(page).click();

  // THE REVIEW.
  await expect(heading(page, 'Check your answers')).toBeVisible();
  await expect(page).toHaveTitle(/^Check your answers · /);
  const review = page.getByRole('main');
  await expect(review.getByText('Not answered', { exact: true })).toBeVisible();
  await expect(review.getByText('What went wrong?')).toHaveCount(0);
  await expect(
    review.getByText('This report can’t be changed or withdrawn after you send it.'),
  ).toBeVisible();
  await expectAccessible(page, 'the review card');
  // No statement ticked: said above the button, and focused.
  await page.getByRole('button', { name: 'Send report' }).click();
  const unticked = page.getByRole('alert').filter({ hasText: 'Tick the statement above' });
  await expect(unticked).toBeFocused();
  expect(sent).toHaveLength(0);
  await page.getByRole('checkbox', { name: /I confirm this report is accurate/ }).click();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /on the record/ })).toBeFocused({
    timeout: 30_000,
  });

  // What was sent: the answer given, and no key at all for the question not asked.
  expect(sent).toHaveLength(1);
  const answers = (sent[0]?.answers ?? {}) as Record<string, unknown>;
  expect(answers[lb.keys.went]).toBe('Fine');
  expect(lb.keys.why in answers).toBe(false);
  expect(lb.keys.seen in answers).toBe(false);

  // The receipt: quiet, the tip offer as a button, and no progress left behind.
  await expect(page.getByRole('link', { name: 'Send a link' })).toHaveAttribute(
    'href',
    '/list/tips',
  );
  await expect(page.locator('html')).not.toHaveAttribute('data-filing-progress', /.*/);
  await expectAccessible(page, 'the receipt');
  expect(outside).toEqual([]);
});

test('the bare /verify form and the entry card ask no other host', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await page.goto('/verify');
  await expect(heading(page, 'Check a report')).toBeVisible();
  await expectAccessible(page, '/verify');
  await page.getByLabel('Report reference').fill('RL-NOT-REAL');
  await page.getByLabel('Report reference').press('Enter');
  await expect(page).toHaveURL(/\/verify\/RL-NOT-REAL$/);
  await expect(page.getByRole('alert')).toContainText('There is no report with that reference.');
  // The field again, so a second check does not go back to the front page.
  await expect(page.getByLabel('Report reference')).toBeVisible();
  expect(outside).toEqual([]);
});
