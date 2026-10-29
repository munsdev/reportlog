/**
 * Every kind of question a reporter can be asked, filed through the form in
 * a real browser, and what each one sealed (file.spec.ts files the first
 * four kinds; the upload question is files/attach.spec.ts's). A logbook asks
 * for words and links only as a note or link held apart from the report
 * (isPublishedFreeText): those are sealed as fingerprints, and a moderator
 * opening them reads what was written.
 *
 * The same walk checks two things on EVERY card, not only the first:
 *   - the accessibility check (decision 12), which the page walk can only
 *     run on the form's opening card, since every card is the same address;
 *   - the progress bar, which only ever moves forwards and is full on the
 *     last card. Here the first answer rules out a follow-up AND the
 *     follow-up hanging off it: a bar that still counted the second ended
 *     short of the end (legacy's nav.test.js, "the bar never goes
 *     backwards").
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { ADMIN } from '../auth.ts';
import { countTo, lastMessageTo, linkIn } from '../identity/mail.ts';
import { heldTextOf } from '../held.ts';
import { shownReference } from '../reference.ts';
import { expectAccessible } from './axe.ts';

const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

// The date-and-time box reads in the reporter's clock and is sealed as UTC.
test.use({ timezoneId: 'UTC' });

async function everyKind(admin: APIRequestContext, title: string) {
  const made = await admin.post('/api/admin/logbooks', { data: { title } });
  expect(made.ok(), await made.text()).toBe(true);
  const lb = (await made.json()) as { id: number; slug: string };
  // The note and link questions are asked only where the operator turned notes on.
  const notes = await admin.patch(`/api/admin/logbooks/${String(lb.id)}`, {
    data: { accepts_notes: true },
  });
  expect(notes.ok(), await notes.text()).toBe(true);
  const add = async (data: Record<string, unknown>) => {
    const r = await admin.post(`/api/admin/logbooks/${String(lb.id)}/fields`, { data });
    expect(r.ok(), await r.text()).toBe(true);
    return ((await r.json()) as { key: string }).key;
  };
  const k = {
    where: await add({
      kind: 'choice_one',
      label: 'Where were you?',
      required: true,
      settings: { options: ['Inside', 'Outside'] },
    }),
    queue: '',
    howLong: '',
    seen: '',
    started: '',
    ended: '',
    building: '',
    other: '',
    state: '',
    photos: '',
    turnedAway: '',
    link: '',
  };
  k.queue = await add({
    kind: 'yes_no',
    label: 'Were you in the queue?',
    shown_when: { field: k.where, in: ['Outside'] },
  });
  k.howLong = await add({
    kind: 'private_text',
    label: 'How long was the queue?',
    shown_when: { field: k.queue, in: ['yes'] },
  });
  k.seen = await add({
    kind: 'choice_many',
    label: 'What did you see?',
    settings: { options: ['A locked door', 'A long queue', 'Police'] },
  });
  k.started = await add({ kind: 'time', label: 'What time did it start?' });
  k.ended = await add({ kind: 'datetime', label: 'When did it end?' });
  k.building = await add({
    kind: 'place',
    label: 'Which building?',
    settings: { options: ['The school', 'The library'], allowOther: false },
  });
  k.other = await add({ kind: 'private_text', label: 'Anywhere else?' });
  k.state = await add({ kind: 'location', label: 'Which state?', settings: { scope: 'us' } });
  k.photos = await add({ kind: 'evidence_declaration', label: 'Do you have photos of it?' });
  k.turnedAway = await add({
    kind: 'number',
    label: 'How many people were turned away?',
    settings: { min: 0, max: 10000 },
  });
  k.link = await add({ kind: 'private_link', label: 'A link to anything published about it' });
  const launched = await admin.post(`/api/admin/logbooks/${String(lb.id)}/launch`);
  expect(launched.ok(), await launched.text()).toBe(true);
  return { ...lb, k };
}

const heading = (page: Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true });

test('every kind of question, filed card by card: each card passes the check, and the bar only fills', async ({
  page,
  playwright,
}, info) => {
  test.slow();
  const baseURL = info.project.use.baseURL ?? 'http://127.0.0.1:4173';
  const admin = await playwright.request.newContext({ baseURL, storageState: ADMIN });
  const title = `Every kind ${info.project.name} ${run()}`;
  const lb = await everyKind(admin, title);

  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });

  const bar: number[] = [];
  /** On the card named: the check, and where the bar stands. */
  const on = async (name: string) => {
    await expect(heading(page, name)).toBeVisible();
    await expect(heading(page, name)).toBeFocused();
    await expectAccessible(page, name);
    bar.push(
      Number(
        await page.getByRole('progressbar', { name: 'Progress' }).getAttribute('aria-valuenow'),
      ),
    );
  };
  const next = () => page.getByRole('button', { name: 'Next', exact: true }).click();
  const box = (name: string) => page.getByRole('textbox', { name, exact: true });

  await page.goto(`/file/${lb.slug}`);
  await expect(heading(page, title)).toBeVisible();
  // The opening card has no bar: nothing has been answered.
  await expectAccessible(page, 'the opening card');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start' }).click();

  await on('Where were you?');
  // Holding the reporter on a required card is part of the card: checked too.
  await next();
  await expect(page.getByText('An answer is needed here.')).toBeVisible();
  await expectAccessible(page, 'Where were you?, with its error');
  await page.getByRole('radio', { name: 'Inside' }).click();
  await next();

  // "Inside" rules out the queue AND what hangs off it: straight on.
  await on('What did you see?');
  // Ticked in the opposite order to the operator's; sealed in theirs.
  await page.getByRole('checkbox', { name: 'A long queue' }).check();
  await page.getByRole('checkbox', { name: 'A locked door' }).check();
  await next();

  await on('What time did it start?');
  await page.locator('input[type=time]').fill('09:30');
  await next();

  await on('When did it end?');
  await page.locator('input[type=datetime-local]').fill('2026-10-19T18:45');
  await next();

  await on('Which building?');
  await page.getByRole('radio', { name: 'The library' }).click();
  await next();

  await on('Anywhere else?');
  // A note's box is named for what it holds, whatever the card asks.
  await box('What happened (optional)').fill('The car park behind it');
  await next();

  await on('Which state?');
  await page.getByRole('combobox', { name: 'Which state?' }).selectOption({ label: 'Ohio' });
  await next();

  await on('Do you have photos of it?');
  await page.getByRole('radio', { name: 'Yes, I have something' }).click();
  await next();

  await on('How many people were turned away?');
  // Outside the operator's range is refused on the card, before anything is sent.
  await page.getByRole('spinbutton', { name: 'How many people were turned away?' }).fill('20000');
  await next();
  await expect(page.getByText('That is not an answer this question takes.')).toBeVisible();
  await expectAccessible(page, 'a number out of range');
  await page.getByRole('spinbutton', { name: 'How many people were turned away?' }).fill('12');
  await next();

  await on('A link to anything published about it');
  await box('Link (optional)').fill('https://example.org/news/queue');
  await next();

  await on('Should this report be published?');
  await page.getByRole('radio', { name: 'No, keep it out of the public archive' }).click();
  await next();

  // Something was written, so sharing it is asked, and the address is needed.
  await on('Can vetted journalists read what you wrote?');
  await page.getByRole('radio', { name: 'No, keep it for the moderators only' }).click();
  await next();

  await on('Your email address');
  const email = `kinds-${run()}@example.org`;
  await box('Email').fill(email);
  await next();

  await on('Check your answers');
  // In the words the reporter read: the place's name, not its code.
  // Each answer is the line beside its question, exactly as shown.
  const answer = (text: string) => page.getByRole('main').getByText(text, { exact: true });
  await expect(answer('Ohio')).toHaveCount(1);
  await expect(page.getByText('US-OH')).toHaveCount(0);
  await expect(answer('Yes, I have something')).toHaveCount(1);
  await expect(answer('A locked door, A long queue')).toHaveCount(1);
  await expect(page.getByText('Were you in the queue?')).toHaveCount(0);

  // THE BAR ONLY EVER FILLS, and the last card is the end of it.
  for (let i = 1; i < bar.length; i++) {
    expect(bar[i] ?? 0, `the bar went back: ${bar.join(' → ')}`).toBeGreaterThan(bar[i - 1] ?? 0);
  }
  expect(bar.at(-1), bar.join(' → ')).toBe(100);

  const before = countTo(email);
  await page.getByRole('checkbox', { name: /I confirm this report is accurate/ }).check();
  await expectAccessible(page, 'the review, ready to send');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(heading(page, 'Check your email to finish')).toBeVisible();
  await expectAccessible(page, 'the receipt');

  await page.goto(linkIn(await lastMessageTo(email, before)));
  await page.getByRole('button', { name: 'Confirm and file my report' }).click();
  await expect(heading(page, 'Your report is filed')).toBeVisible();
  const ref = await shownReference(page);
  expect(outside).toEqual([]);

  // What each kind sealed, read as staff (decisions.md §1: not published).
  const sealed = (await (await admin.get(`/api/reports/${ref}/verify`)).json()) as {
    content: { ok: boolean };
    hashed_fields: {
      answers: Record<string, unknown>;
      text_fingerprints?: Record<string, unknown>;
      link_fingerprints?: Record<string, unknown>;
    };
  };
  expect(sealed.content.ok).toBe(true);
  // The note and the link are sealed as fingerprints under their own keys,
  // never as written; what was written is kept, as a moderator opening it reads.
  expect(Object.keys(sealed.hashed_fields.text_fingerprints ?? {})).toEqual([lb.k.other]);
  expect(Object.keys(sealed.hashed_fields.link_fingerprints ?? {})).toEqual([lb.k.link]);
  expect(JSON.stringify(sealed)).not.toContain('The car park behind it');
  expect(JSON.stringify(sealed)).not.toContain('example.org/news/queue');
  expect(await heldTextOf(admin, ref)).toBe('The car park behind it');
  await admin.dispose();
  const { k } = lb;
  expect(sealed.hashed_fields.answers).toEqual({
    [k.where]: 'Inside',
    [k.seen]: ['A locked door', 'A long queue'],
    [k.started]: '09:30:00',
    [k.ended]: '2026-10-19T18:45:00.000Z',
    [k.building]: 'The library',
    [k.state]: 'US-OH',
    [k.photos]: true,
    [k.turnedAway]: 12,
  });
});
