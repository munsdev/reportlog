/**
 * AT THE DOOR (Plan E, session PE2; the brief's §02 and §08). Each rule has a
 * test that fails if the rule breaks:
 *
 *   - a filled honeypot is refused;
 *   - a form sent sooner than the minimum, or with no start token, is refused;
 *   - a missing, wrong, foreign, expired or reused puzzle solution is refused;
 *     a real one, solved from the challenge route, is taken;
 *   - every refusal is the same plain sentence, never naming the check, and is
 *     counted by check, with nothing of the content stored;
 *   - reports and tips per address are limited per minute and per hour, and
 *     requests of any kind by a separate, higher limit, behind one proxy;
 *   - on a door (the site password on) the puzzle and start token are
 *     reachable, and a report and a tip can be sent;
 *   - E1: a choice-only form seals on arrival, with no contact row and no
 *     email; a text form still emails a confirmation; the operator's switch;
 *     a decline of a report that never had an address records no failure;
 *   - E4: a date outside its limits is refused, by a report and a tip.
 *
 * The tests that are about the IP address itself (never in a report, a tip,
 * a log line or an error report) are in door-privacy.test.ts.
 */
import { createChallenge, solveChallenge } from 'altcha-lib';
import type { Challenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { verifyReport } from '../../src/chain/verify.ts';
import { writeDoorSettings } from '../../src/door/settings.ts';
import { PUZZLE_ALGORITHM } from '../../src/door/puzzle.ts';
import { hashPassword } from '../../src/identity/secrets.ts';
import { createFromFile, toFile } from '../../src/logbooks/logbookFile.ts';
import { createFromStartingPoint } from '../../src/logbooks/templates.ts';
import { solvedPuzzle, startToken } from '../door-pass.ts';
import { doorPass } from '../door-pass.ts';
import { launchedLogbook, uniqueSlug } from './helpers.ts';
import {
  CONTACT_KEY,
  filingHarness,
  send,
  spine,
  spineWithoutEmail,
  threadOf,
  tokenFor,
} from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { address, as, liftCurtain, seat, signIn } from './identity-helpers.ts';

const PLAIN = 'Something went wrong. Please try again.';

let h: FilingHarness;
let text: { id: number; slug: string };
let choices: { id: number; slug: string };

const CHOICES = [
  {
    key: 'how',
    kind: 'choice_one',
    label: 'How did it go?',
    required: true,
    settings: { options: ['fine', 'badly'] },
  },
  {
    key: 'day',
    kind: 'date',
    label: 'What day?',
    settings: { earliest: '2026-10-01', latest: '2026-11-10' },
  },
];

beforeAll(async () => {
  h = await filingHarness();
  text = await launchedLogbook(h.db, [
    { key: 'what', kind: 'short_text', label: 'What happened?', required: true },
  ]);
  choices = await launchedLogbook(h.db, CHOICES);
});
afterAll(async () => {
  await writeDoorSettings(h.db, { minFormMs: 3000 });
  await h.db.updateTable('flood_settings').set({ puzzle_level: 'normal' }).execute();
  await h.close();
});
beforeEach(async () => {
  await writeDoorSettings(h.db, { minFormMs: 3000 });
  await h.db.updateTable('flood_settings').set({ puzzle_level: 'normal' }).execute();
});

const refusals = async (check: string) => {
  const rows = await h.db
    .selectFrom('intake_refusal_counts')
    .select((eb) => eb.fn.sum<string>('refusals').as('n'))
    .where('check_name', '=', check)
    .executeTakeFirst();
  return Number(rows?.n ?? 0);
};
const submissions = async () =>
  Number(
    (
      await h.db
        .selectFrom('report_submissions')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow()
    ).n,
  );
const reportsIn = async (logbookId: number) =>
  Number(
    (
      await h.db
        .selectFrom('reports')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('logbook_id', '=', logbookId)
        .executeTakeFirstOrThrow()
    ).n,
  );

/** A text report with this much of the door, and how it went. */
async function textReport(door: Record<string, unknown>, stem = 'door') {
  const email = address(stem);
  const r = await send(h, {
    ...spine(email),
    logbook: text.slug,
    answers: { what: 'The doors opened late' },
    ...door,
  });
  return { ...r, email };
}

/** Refused at the door: the one sentence, and nothing kept or sent. */
async function refusedPlainly(door: Record<string, unknown>, check: string, status = 400) {
  const before = {
    subs: await submissions(),
    counted: await refusals(check),
    mail: h.mailer.messages.length,
  };
  const r = await textReport(door, check);
  expect(r.status).toBe(status);
  expect(r.body).toEqual({ error: { code: 'try_again', message: PLAIN } });
  expect(await submissions()).toBe(before.subs);
  expect(h.mailer.messages.length).toBe(before.mail);
  expect(await refusals(check)).toBe(before.counted + 1);
}

describe('the honeypot', () => {
  it('a report with the hidden box filled is refused, counted and not stored', async () => {
    await refusedPlainly({ website: 'http://spam.example' }, 'honeypot');
  });

  it('an empty hidden box is no refusal', async () => {
    const r = await textReport({ website: '' });
    expect(r.status).toBe(200);
  });
});

describe('the minimum time on the form', () => {
  it('a form sent sooner than the minimum is refused', async () => {
    await refusedPlainly({ start: startToken(h.app, 500) }, 'too_fast');
  });

  it('a form with no start token, or one this server did not sign, is refused', async () => {
    await refusedPlainly({ start: '' }, 'start_missing');
    const forged = `${String(Date.now() - 3_600_000)}.${'A'.repeat(43)}`;
    await refusedPlainly({ start: forged }, 'start_missing');
  });

  it('follows the setting: at 0 the same form is taken', async () => {
    await writeDoorSettings(h.db, { minFormMs: 0 });
    const r = await textReport({ start: startToken(h.app, 0) });
    expect(r.status).toBe(200);
  });

  it('the start token is a signed moment and nothing else', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/door/start' });
    const { start } = res.json<{ start: string }>();
    expect(start).toMatch(/^\d{13}\.[A-Za-z0-9_-]{43}$/);
    expect(Math.abs(Number(start.split('.')[0]) - Date.now())).toBeLessThan(5000);
  });
});

describe('the puzzle', () => {
  it('a report without a solution is refused', async () => {
    await refusedPlainly({ altcha: '' }, 'puzzle_missing');
  });

  it('a wrong solution, or one to a challenge another key signed, is refused', async () => {
    const good = JSON.parse(Buffer.from(await solvedPuzzle(h.app), 'base64').toString()) as {
      challenge: Challenge;
      solution: { counter: number; derivedKey: string };
    };
    const wrong = { ...good, solution: { ...good.solution, derivedKey: 'ab'.repeat(32) } };
    await refusedPlainly(
      { altcha: Buffer.from(JSON.stringify(wrong)).toString('base64') },
      'puzzle_wrong',
    );
    await refusedPlainly(
      { altcha: await solvedPuzzle(h.app, { secret: 'not-ours' }) },
      'puzzle_wrong',
    );
    await refusedPlainly({ altcha: 'bm90IGEgcGF5bG9hZA==' }, 'puzzle_wrong');
  });

  it('an expired solution is refused', async () => {
    await refusedPlainly(
      { altcha: await solvedPuzzle(h.app, { expiresInS: -1 }) },
      'puzzle_expired',
    );
  });

  it('a solution is taken once, and refused the second time', async () => {
    const altcha = await solvedPuzzle(h.app);
    const first = await textReport({ altcha });
    expect(first.status).toBe(200);
    await refusedPlainly({ altcha }, 'puzzle_reused');
  });

  it('a real challenge from the route, solved the way the widget solves it, is taken', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/door/challenge' });
    expect(res.statusCode).toBe(200);
    const challenge = res.json<Challenge>();
    expect(challenge.parameters).toMatchObject({ algorithm: PUZZLE_ALGORITHM, keyPrefix: '000' });
    expect(challenge.parameters.expiresAt).toBeGreaterThan(Date.now() / 1000);
    const solution = await solveChallenge({ challenge, deriveKey });
    expect(solution).not.toBeNull();
    const altcha = Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
    const r = await textReport({ altcha });
    expect(r.status).toBe(200);
  });

  it('the moderators’ “Harder puzzle” switch asks more of the browser', async () => {
    // The switch's own value (moderation/switches.ts reads it), set without
    // writing the public switch record other tests read.
    await h.db.updateTable('flood_settings').set({ puzzle_level: 'harder' }).execute();
    const res = await h.app.inject({ method: 'GET', url: '/api/door/challenge' });
    const p = res.json<Challenge>().parameters;
    expect(p.keyPrefix.length).toBeGreaterThan(3);
    expect(p.cost).toBeGreaterThan(250);
  });

  it('a challenge whose signature is right but whose parameters were changed is refused', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/door/challenge' });
    const challenge = res.json<Challenge>();
    // Make it trivial: no prefix at all. The signature no longer matches.
    const easy = { ...challenge, parameters: { ...challenge.parameters, keyPrefix: '' } };
    const solution = await solveChallenge({ challenge: easy, deriveKey });
    const altcha = Buffer.from(JSON.stringify({ challenge: easy, solution })).toString('base64');
    await refusedPlainly({ altcha }, 'puzzle_wrong');
  });

  it('a payload a hosted verification service would sign is not a solution here', async () => {
    const challenge = await createChallenge({
      algorithm: 'SHA-256',
      cost: 1,
      counter: 0,
      deriveKey,
      hmacSignatureSecret: 'whatever',
    });
    const altcha = Buffer.from(
      JSON.stringify({
        algorithm: 'SHA-256',
        verificationData: 'verified=true',
        signature: challenge.signature,
        verified: true,
      }),
    ).toString('base64');
    await refusedPlainly({ altcha }, 'puzzle_wrong');
  });
});

describe('every refusal looks the same', () => {
  it('the operator can word it, and it still names no check', async () => {
    await h.db
      .insertInto('site_copy')
      .values({ key: 'refusal_message', body: 'That did not go through. Please send it again.' })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({ body: 'That did not go through. Please send it again.' }),
      )
      .execute();
    try {
      const a = await textReport({ website: 'x' });
      const b = await textReport({ altcha: '' });
      const c = await textReport({ start: startToken(h.app, 1) });
      for (const r of [a, b, c]) {
        expect(r.body).toEqual({
          error: { code: 'try_again', message: 'That did not go through. Please send it again.' },
        });
      }
    } finally {
      await h.db.deleteFrom('site_copy').where('key', '=', 'refusal_message').execute();
    }
  });
});

describe('rate limits per address', () => {
  let limited: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    limited = await buildApp({
      config: {
        LOG_LEVEL: 'silent',
        CONTACT_KEY,
        TRUST_PROXY: 1,
        DOOR_SUBMITS_PER_MINUTE: 2,
        DOOR_SUBMITS_PER_HOUR: 3,
        DOOR_REQUESTS_PER_MINUTE: 40,
      },
      db: h.db,
    });
  });
  afterAll(async () => {
    await limited.close();
  });
  const from = async (ip: string, door = true) =>
    limited.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { 'x-forwarded-for': ip },
      payload: {
        ...(door ? await doorPass(limited) : {}),
        ...spine(address('rate')),
        logbook: text.slug,
        answers: { what: 'Counted' },
      },
    });

  it('per minute: the third from one address is refused, another address is not', async () => {
    const before = await refusals('rate_minute');
    expect((await from('198.51.100.1')).statusCode).toBe(200);
    expect((await from('198.51.100.1')).statusCode).toBe(200);
    const third = await from('198.51.100.1');
    expect(third.statusCode).toBe(429);
    expect(third.json()).toEqual({ error: { code: 'try_again', message: PLAIN } });
    expect(await refusals('rate_minute')).toBe(before + 1);
    // Behind one proxy, the visitor's address is the one the proxy names.
    expect((await from('198.51.100.2')).statusCode).toBe(200);
  });

  it('a refused attempt still counts: the limit is on trying, not on succeeding', async () => {
    // No door fields: refused at the door, after the limit has counted it.
    expect((await from('198.51.100.3', false)).statusCode).toBe(400);
    expect((await from('198.51.100.3', false)).statusCode).toBe(400);
    expect((await from('198.51.100.3')).statusCode).toBe(429);
  });

  it('requests of any kind have their own, higher limit; the health check is never limited', async () => {
    const ip = '198.51.100.9';
    const get = () =>
      limited.inject({
        method: 'GET',
        url: '/api/intake-switch',
        headers: { 'x-forwarded-for': ip },
      });
    for (let i = 0; i < 40; i += 1) expect((await get()).statusCode).toBe(200);
    const over = await get();
    expect(over.statusCode).toBe(429);
    expect(over.headers['retry-after']).toBe('60');
    const health = await limited.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-forwarded-for': ip },
    });
    expect(health.statusCode).not.toBe(429);
    // Another address reads on.
    const other = await limited.inject({
      method: 'GET',
      url: '/api/intake-switch',
      headers: { 'x-forwarded-for': '198.51.100.10' },
    });
    expect(other.statusCode).toBe(200);
  });

  it('without a trusted proxy, a forwarded address a visitor writes is not believed', async () => {
    const direct = await buildApp({
      config: { LOG_LEVEL: 'silent', CONTACT_KEY, DOOR_SUBMITS_PER_MINUTE: 1 },
      db: h.db,
    });
    try {
      const go = async (ip: string) =>
        direct.inject({
          method: 'POST',
          url: '/api/reports',
          headers: { 'x-forwarded-for': ip },
          payload: {
            ...(await doorPass(direct)),
            ...spine(address('direct')),
            logbook: text.slug,
            answers: { what: 'x' },
          },
        });
      expect((await go('192.0.2.1')).statusCode).toBe(200);
      // A different header, the same connection: the same client.
      expect((await go('192.0.2.2')).statusCode).toBe(429);
    } finally {
      await direct.close();
    }
  });
});

describe('E1: when a form asks for an email', () => {
  it('a choice-only form seals on arrival: no link, no contact row, no email', async () => {
    const before = {
      subs: await submissions(),
      mail: h.mailer.messages.length,
      n: await reportsIn(choices.id),
    };
    const r = await send(h, {
      ...spineWithoutEmail(),
      logbook: choices.slug,
      answers: { how: 'badly', day: '2026-11-03' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ filed: true, public_ref: expect.any(String) });
    expect(await submissions()).toBe(before.subs);
    expect(h.mailer.messages.length).toBe(before.mail);
    expect(await reportsIn(choices.id)).toBe(before.n + 1);
    const report = await h.db
      .selectFrom('reports')
      .select(['public_ref', 'thread_id'])
      .where('logbook_id', '=', choices.id)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    const verified = await verifyReport(h.db, report.public_ref);
    expect(verified?.content.ok && verified.link.ok && verified.position.ok).toBe(true);
    const contacts = await h.db
      .selectFrom('report_contacts')
      .select('thread_id')
      .where('thread_id', '=', report.thread_id)
      .execute();
    expect(contacts).toEqual([]);
    const head = await h.db
      .selectFrom('report_heads')
      .select('moderation_status')
      .where('thread_id', '=', report.thread_id)
      .executeTakeFirstOrThrow();
    // Hidden until a moderator accepts it, like every report.
    expect(head.moderation_status).toBe('pending');
  });

  it('the public form says it asks for no email; the text form says it does', async () => {
    const a = await h.app.inject({ method: 'GET', url: `/api/logbooks/${choices.slug}` });
    const b = await h.app.inject({ method: 'GET', url: `/api/logbooks/${text.slug}` });
    expect(a.json<{ asks_email: boolean }>().asks_email).toBe(false);
    expect(b.json<{ asks_email: boolean }>().asks_email).toBe(true);
  });

  it('an address sent to a form that does not ask for one is refused, not kept', async () => {
    const r = await send(h, {
      ...spine(address('extra')),
      logbook: choices.slug,
      answers: { how: 'fine' },
    });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/does not ask for an email address/);
  });

  it('a text form still emails a confirmation, and files nothing until it is used', async () => {
    const r = await textReport({}, 'still-mails');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ pending: true });
    expect(tokenFor(h.mailer, r.email)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('the operator can require an address on a choice-only form', async () => {
    const lb = await launchedLogbook(h.db, CHOICES);
    await h.db
      .updateTable('logbooks')
      .set({ email_required: true })
      .where('id', '=', lb.id)
      .execute();
    const form = await h.app.inject({ method: 'GET', url: `/api/logbooks/${lb.slug}` });
    expect(form.json<{ asks_email: boolean }>().asks_email).toBe(true);
    const without = await send(h, {
      ...spineWithoutEmail(),
      logbook: lb.slug,
      answers: { how: 'fine' },
    });
    expect(without.status).toBe(400);
    expect(JSON.stringify(without.body)).toMatch(/Enter an email address/);
    const email = address('override');
    const withIt = await send(h, { ...spine(email), logbook: lb.slug, answers: { how: 'fine' } });
    expect(withIt.body).toEqual({ pending: true });
    expect(tokenFor(h.mailer, email)).toBeDefined();
  });

  it('the switch is the builder’s, changeable after launch, and cannot take an address away', async () => {
    const admin = address('door-admin');
    await seat(h.db, admin, 'admin');
    const call = as(h, await signIn(h, admin));
    const patch = (id: number, on: boolean) =>
      call({
        method: 'PATCH',
        url: `/api/admin/logbooks/${String(id)}`,
        payload: { email_required: on },
      });
    const on = await patch(choices.id, true);
    expect(on.json<{ email_required: boolean; asks_email: boolean }>()).toMatchObject({
      email_required: true,
      asks_email: true,
    });
    const off = await patch(choices.id, false);
    expect(off.json<{ asks_email: boolean }>().asks_email).toBe(false);
    // A text form asks whatever the switch says.
    const t = await patch(text.id, false);
    expect(t.json<{ asks_email: boolean }>().asks_email).toBe(true);
  });

  it('declining a report that never had an address records no failure to notify', async () => {
    await send(h, { ...spineWithoutEmail(), logbook: choices.slug, answers: { how: 'fine' } });
    const report = await h.db
      .selectFrom('reports')
      .select(['public_ref', 'thread_id'])
      .where('logbook_id', '=', choices.id)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    const mod = address('door-mod');
    await seat(h.db, mod, 'moderator');
    const call = as(h, await signIn(h, mod));
    const mailBefore = h.mailer.messages.length;
    const decided = await call({
      method: 'POST',
      url: `/api/moderation/reports/${report.thread_id}/decision`,
      payload: { status: 'invalid', reason_code: 'outside_scope', comment: 'Not about voting.' },
    });
    expect(decided.json()).toMatchObject({ ok: true, notice: 'none' });
    const notices = await h.db
      .selectFrom('decision_notices')
      .select('outcome')
      .where('thread_id', '=', report.thread_id)
      .execute();
    expect(notices).toEqual([]);
    // Only the moderator's own sign-in code went out, before the decision.
    expect(h.mailer.messages.length).toBe(mailBefore);
    expect(await threadOf(h.db, report.public_ref)).toBe(report.thread_id);
  });
});

describe('E4: date limits', () => {
  it('a report with a date outside the limits is refused in a sentence; inside is taken', async () => {
    const early = await send(h, {
      ...spineWithoutEmail(),
      logbook: choices.slug,
      answers: { how: 'fine', day: '2026-09-30' },
    });
    expect(early.status).toBe(400);
    expect(JSON.stringify(early.body)).toMatch(
      /What day\? is outside the dates or times this form takes/,
    );
    const late = await send(h, {
      ...spineWithoutEmail(),
      logbook: choices.slug,
      answers: { how: 'fine', day: '2026-11-11' },
    });
    expect(late.status).toBe(400);
    const edge = await send(h, {
      ...spineWithoutEmail(),
      logbook: choices.slug,
      answers: { how: 'fine', day: '2026-11-10' },
    });
    expect(edge.body).toMatchObject({ filed: true, public_ref: expect.any(String) });
  });

  it('the public form carries the limits, so the page offers nothing outside them', async () => {
    const form = await h.app.inject({ method: 'GET', url: `/api/logbooks/${choices.slug}` });
    const day = form
      .json<{ fields: { key: string; settings: Record<string, unknown> }[] }>()
      .fields.find((f) => f.key === 'day');
    expect(day?.settings).toMatchObject({ earliest: '2026-10-01', latest: '2026-11-10' });
  });
});

describe('on a door', () => {
  let doorLb: { id: number; slug: string };
  beforeAll(async () => {
    doorLb = await launchedLogbook(h.db, [
      { key: 'what', kind: 'short_text', label: 'What?', required: true },
    ]);
    await h.db
      .updateTable('logbooks')
      .set({ outside_access: 'door' })
      .where('id', '=', doorLb.id)
      .execute();
    await h.db
      .updateTable('site_access')
      .set({ enabled: true, password_hash: await hashPassword('the door test') })
      .where('id', '=', true)
      .execute();
  });
  afterAll(async () => {
    await liftCurtain(h.db);
    // Other files expect every logbook and list to be closed to outsiders.
    await h.db.updateTable('logbooks').set({ outside_access: 'closed' }).execute();
    await h.db.updateTable('lists').set({ outside_access: 'closed' }).execute();
  });

  it('the puzzle and the start token are in front of the password, and a report goes through', async () => {
    const challenge = await h.app.inject({ method: 'GET', url: '/api/door/challenge' });
    const start = await h.app.inject({ method: 'GET', url: '/api/door/start' });
    expect([challenge.statusCode, start.statusCode]).toEqual([200, 200]);
    const email = address('on-door');
    const r = await send(h, {
      ...spine(email),
      logbook: doorLb.slug,
      answers: { what: 'Through the door' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ pending: true });
  });

  it('the door settings stay behind the password and a role', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/api/admin/door' });
    expect(r.statusCode).toBe(401);
  });

  it('a list open outside takes a tip through the door', async () => {
    const slug = uniqueSlug('door-tips');
    const list = await h.db
      .insertInto('lists')
      .values({
        slug,
        title: 'Door tips',
        visibility: 'listed',
        outside_access: 'door',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('list_fields')
      .values({
        list_id: list.id,
        key: 'kind',
        kind: 'choice_one',
        label: 'What kind?',
        required: true,
        position: 0,
        settings: JSON.stringify({ options: ['a', 'b'] }),
        retention: 'durable',
      })
      .execute();
    const ok = await h.app.inject({
      method: 'POST',
      url: `/api/lists/${slug}/entries`,
      payload: { ...(await doorPass(h.app)), answers: { kind: 'a' } },
    });
    expect(ok.statusCode).toBe(200);
    const refused = await h.app.inject({
      method: 'POST',
      url: `/api/lists/${slug}/entries`,
      payload: { ...(await doorPass(h.app)), website: 'filled', answers: { kind: 'a' } },
    });
    expect(refused.json()).toEqual({ error: { code: 'try_again', message: PLAIN } });
  });
});

describe('E1 and E4 in a logbook file and a starting point', () => {
  it('limits and the email switch round-trip through a file, each only when set', async () => {
    const made = await createFromFile(h.db, {
      reportlog_logbook: 1,
      title: 'Limits round trip',
      slug: uniqueSlug('limits'),
      ask_email: 'always',
      questions: [
        { key: 'how', kind: 'choice_one', label: 'How?', options: ['ok'] },
        { key: 'day', kind: 'date', label: 'Day', earliest: '2026-09-18', latest: '2026-11-10' },
        { key: 'other', kind: 'date', label: 'Another day' },
      ],
    });
    expect(made.email_required).toBe(true);
    expect(made.asks_email).toBe(true);
    const day = made.fields.find((f) => f.key === 'day');
    expect(day?.settings).toEqual({ earliest: '2026-09-18', latest: '2026-11-10' });
    // The absent-key rule: a date without limits has no limit keys at all.
    expect(made.fields.find((f) => f.key === 'other')?.settings).toEqual({});
    const file = await toFile(h.db, made.id);
    expect(file?.ask_email).toBe('always');
    expect(file?.questions.find((q) => q.key === 'day')).toMatchObject({
      earliest: '2026-09-18',
      latest: '2026-11-10',
    });
    const plain = file?.questions.find((q) => q.key === 'other') ?? {};
    expect('earliest' in plain || 'latest' in plain).toBe(false);
  });

  it('a file with a bad limit is refused whole', async () => {
    await expect(
      createFromFile(h.db, {
        reportlog_logbook: 1,
        title: 'Bad limit',
        questions: [{ key: 'day', kind: 'date', label: 'Day', earliest: 'soon' }],
      }),
    ).rejects.toThrow(/earliest or latest/);
  });

  it('The voting starting point asks no email, and its date carries the placeholder window', async () => {
    const lb = await createFromStartingPoint(h.db, {
      starting_point: 'how-voting-went',
      title: 'Voting window',
      slug: uniqueSlug('el-window'),
    });
    expect(lb.asks_email).toBe(false);
    expect(lb.fields.find((f) => f.key === 'date')?.settings).toMatchObject({
      earliest: '2026-09-18',
      latest: '2026-11-10',
    });
  });
});
