/**
 * The hourly and weekly digests, and choosing them.
 *
 * Legacy had no self-test for digest.js (the only digest check in
 * selftest.js is about the doctor and its timers, which are the operations
 * workstream's). These check what legacy/src/digest.js and notifyTemplates.js
 * promised, above all the line its header comment fixes: a digest carries
 * exactly what the public board carries and nothing more.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { findJob } from '../../src/jobs/registry.ts';
import { SETTLE_MS, answerText, runDigest } from '../../src/site/digest.ts';
import { fileReport, launchedLogbook } from './helpers.ts';
import { address, as, harness, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
let followed: { id: number; slug: string };
let other: { id: number; slug: string };
const readerEmail = address('reader');
const everythingEmail = address('everything');
const weeklyEmail = address('weekly');
let readerSession = '';
const refs: Record<string, string> = {};

/**
 * The test's own timeline. Every report's head is stamped one second after
 * the last thing that happened, and every run happens two minutes after
 * that: a run stops a minute behind its clock (SETTLE_MS), so it always
 * reaches what was just published.
 */
let clock = Date.now();
const later = () => new Date((clock += 2 * SETTLE_MS));

/** File a report and give its head a moderation state, as moderation will. */
async function report(
  logbook: { id: number; slug: string },
  what: string,
  head: { status: string; withdrawn?: boolean; mayPublish?: boolean },
) {
  const { row } = await fileReport(
    h.db,
    logbook,
    { what, has: 'no' },
    { submission: { may_publish: head.mayPublish ?? true } },
  );
  await h.db
    .insertInto('report_heads')
    .values({
      thread_id: row.thread_id,
      current_report_id: row.id,
      moderation_status: head.status,
      withdrawn: head.withdrawn ?? false,
      // On the test's own timeline (below), one second after the last thing.
      updated_at: new Date((clock += 1000)),
    })
    .execute();
  return row.public_ref;
}

async function subscribe(email: string, frequency: string, logbooks: string[] | null) {
  const userId = await seat(h.db, email, 'user');
  await h.db
    .insertInto('digest_subscriptions')
    .values({ user_id: userId, frequency, logbooks })
    .execute();
}

const run = (frequency: 'hourly' | 'weekly', mailer = capturingMailer()) =>
  runDigest({
    db: h.db,
    mailer,
    siteOrigin: 'https://reports.example.test',
    log: () => undefined,
    frequency,
    now: later,
  }).then((out) => ({ out, mailer }));

beforeAll(async () => {
  h = await harness();
  followed = await launchedLogbook(h.db);
  other = await launchedLogbook(h.db);
  refs.published = await report(followed, 'Published and permitted.', { status: 'valid' });
  refs.pending = await report(followed, 'Waiting for a moderator.', { status: 'pending' });
  refs.refused = await report(followed, 'Approved, but the reporter said no.', {
    status: 'valid',
    mayPublish: false,
  });
  refs.withdrawn = await report(followed, 'Approved, then withdrawn.', {
    status: 'valid',
    withdrawn: true,
  });
  refs.invalid = await report(followed, 'Judged not credible.', { status: 'invalid' });
  refs.elsewhere = await report(other, 'Published in another logbook.', { status: 'valid' });

  await subscribe(readerEmail, 'hourly', [followed.slug]);
  readerSession = await signIn(h, readerEmail);
});
afterAll(async () => {
  await h.db.deleteFrom('digest_subscriptions').execute();
  await h.close();
});

describe('only what the board would show', () => {
  let text = '';

  beforeAll(async () => {
    const { mailer } = await run('hourly');
    text = mailer.lastTo(readerEmail)?.text ?? '';
  });

  it('carries a report a moderator approved and the reporter permitted', () => {
    expect(text).toContain(refs.published);
  });

  it('never one waiting for a moderator, judged not credible, or withdrawn', () => {
    for (const k of ['pending', 'invalid', 'withdrawn']) expect(text, k).not.toContain(refs[k]);
  });

  it('never one whose reporter said no, approved or not', () => {
    // The old digest checked only approval and withdrawal, and emailed these.
    expect(text).not.toContain(refs.refused);
  });

  it('only from the logbooks followed', () => {
    expect(text).not.toContain(refs.elsewhere);
  });

  it('shows each answer under the question’s own words, and links the board and the settings', () => {
    expect(text).toContain('What happened?: Published and permitted.');
    expect(text).toContain('Do you have photos?: No');
    expect(text).toContain('https://reports.example.test/board');
    expect(text).toContain('https://reports.example.test/notifications');
  });
});

describe('the clock', () => {
  it('stops a minute behind its clock, so a moderation still committing is not skipped', async () => {
    const ref = await report(followed, 'Published a moment ago.', { status: 'valid' });
    const soon = new Date(clock + SETTLE_MS / 2);
    const first = capturingMailer();
    await runDigest({
      db: h.db,
      mailer: first,
      siteOrigin: 'https://x.test',
      log: () => undefined,
      frequency: 'hourly',
      now: () => soon,
    });
    expect(first.lastTo(readerEmail)?.text ?? '').not.toContain(ref);
    // Not sent yet, and not lost: the next run, later, has it.
    const { mailer } = await run('hourly');
    expect(mailer.lastTo(readerEmail)?.text).toContain(ref);
  });

  it('a second run sends nothing new, and moves the clock anyway', async () => {
    const { out, mailer } = await run('hourly');
    expect(mailer.messages.filter((m) => m.to === readerEmail)).toHaveLength(0);
    expect(out.ok).toBe(true);
    const sub = await h.db
      .selectFrom('digest_subscriptions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select('s.last_sent_at')
      .where('u.email', '=', readerEmail)
      .executeTakeFirstOrThrow();
    expect(sub.last_sent_at).not.toBeNull();
  });

  it('a report published after the last email is in the next', async () => {
    const ref = await report(followed, 'Published later.', { status: 'valid' });
    const { mailer } = await run('hourly');
    const mail = mailer.lastTo(readerEmail);
    expect(mail?.subject).toBe('Hourly update: one new report');
    expect(mail?.text).toContain(ref);
    expect(mail?.text).not.toContain(refs.published);
  });

  it('a failed send is not counted as sent: the same reports are tried again', async () => {
    const ref = await report(followed, 'Published while the mail was down.', { status: 'valid' });
    const broken = { send: () => Promise.reject(new Error('down')) };
    const out = await runDigest({
      db: h.db,
      mailer: broken,
      siteOrigin: 'https://x.test',
      log: () => undefined,
      frequency: 'hourly',
      now: later,
    });
    expect(out.ok).toBe(false);
    expect(out.summary).toMatch(/tried again/);
    const { mailer } = await run('hourly');
    expect(mailer.lastTo(readerEmail)?.text).toContain(ref);
  });
});

describe('subscribers who follow every logbook, weekly', () => {
  it('get every logbook, and only the weekly run sends to them', async () => {
    await subscribe(everythingEmail, 'weekly', null);
    await subscribe(weeklyEmail, 'weekly', [other.slug]);
    const hourly = await run('hourly');
    expect(hourly.mailer.lastTo(everythingEmail)).toBeUndefined();

    const { mailer } = await run('weekly');
    const all = mailer.lastTo(everythingEmail);
    expect(all?.subject).toMatch(/^Weekly digest: \d+ new reports$/);
    expect(all?.text).toContain(refs.published);
    expect(all?.text).toContain(refs.elsewhere);
    expect(all?.text).not.toContain(refs.refused);
    const one = mailer.lastTo(weeklyEmail)?.text ?? '';
    expect(one).toContain(refs.elsewhere);
    expect(one).not.toContain(refs.published);
  });
});

describe('answers in words', () => {
  it('a list joined, yes and no in words, a place by its name', () => {
    expect(answerText(['a', 'b'], 'choice_many')).toBe('a, b');
    expect(answerText(true, 'yes_no')).toBe('Yes');
    expect(answerText(false, 'evidence_declaration')).toBe('No');
    expect(answerText('US-CA', 'location')).toBe('California');
    expect(answerText(12, 'number')).toBe('12');
  });
});

describe('choosing email updates', () => {
  const get = () => as(h, readerSession)({ method: 'GET', url: '/api/notifications' });
  const put = (payload: unknown) =>
    as(h, readerSession)({ method: 'PUT', url: '/api/notifications', payload: payload as object });

  it('shows the choice and every launched logbook that can be followed', async () => {
    const res = await get();
    expect(res.json()).toMatchObject({ frequency: 'hourly', logbooks: [followed.slug] });
    const slugs = res.json<{ choices: { slug: string }[] }>().choices.map((c) => c.slug);
    expect(slugs).toEqual(expect.arrayContaining([followed.slug, other.slug]));
  });

  it('an empty list means every logbook', async () => {
    const res = await put({ frequency: 'weekly', logbooks: [] });
    expect(res.json()).toMatchObject({ frequency: 'weekly', logbooks: null });
  });

  it('refuses a logbook that does not exist and a draft alike, with the same sentence', async () => {
    const draft = await h.db
      .insertInto('logbooks')
      .values({ slug: `draft-${String(process.pid)}-${String(Date.now())}`, title: 'A draft' })
      .returning('slug')
      .executeTakeFirstOrThrow();
    const a = await put({ frequency: 'hourly', logbooks: [draft.slug] });
    const b = await put({ frequency: 'hourly', logbooks: ['no-such-logbook'] });
    expect(a.statusCode).toBe(400);
    expect(a.json()).toEqual(b.json());
  });

  it('refuses a frequency that is not offered', async () => {
    expect((await put({ frequency: 'daily', logbooks: null })).statusCode).toBe(400);
  });

  it('"no emails" removes the subscription', async () => {
    const res = await put({ frequency: 'none', logbooks: null });
    expect(res.json()).toMatchObject({ frequency: 'none', logbooks: null });
    const rows = await h.db
      .selectFrom('digest_subscriptions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select('s.user_id')
      .where('u.email', '=', readerEmail)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('is only for somebody signed in', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/notifications' })).statusCode).toBe(401);
  });
});

describe('the job runner', () => {
  it('runs all three email jobs from the registry, through the mailer it is given', async () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://unused',
      SITE_ORIGIN: 'https://reports.example.test',
    });
    for (const name of ['digest-hourly', 'digest-weekly', 'feedback-digest']) {
      const job = findJob(name);
      expect(job?.run, name).toBeDefined();
      const out = await job?.run?.({
        config,
        db: h.db,
        mailer: capturingMailer(),
        log: () => undefined,
        args: [],
        now: () => new Date(),
      });
      expect(out?.ok, `${name}: ${out?.summary ?? ''}`).toBe(true);
    }
  });
});
