/**
 * NO IP ADDRESS REACHES A REPORT OR TIP TABLE, THE APP LOGS OR ERROR TRACKING
 * (owner decision E2; the brief's §02 and §08).
 *
 * One app, behind one proxy as on a server (TRUST_PROXY=1), its log lines
 * captured and its error tracker pointed at a stand-in Bugsink. Everything a
 * visitor can do at the door is done from two recognisable addresses (the
 * proxy's and the visitor's): a report that asks for an email, sent and
 * confirmed; one sealed on arrival; a tip; refusals at every check; a request
 * over the read limit; and an unexpected error. Then every row of every table
 * in the database, every log line and everything Bugsink received is searched
 * for either address, and for the keyed hash the rate limits count under.
 */
import { sql } from 'kysely';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { processHasher } from '../../src/door/clients.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { createErrorTracker } from '../../src/telemetry/tracker.ts';
import { standInBugsink } from '../stand-in-bugsink.ts';
import type { StandInBugsink } from '../stand-in-bugsink.ts';
import { doorPass, startToken } from '../door-pass.ts';
import { launchedLogbook, testDatabase, uniqueSlug } from './helpers.ts';
import { CONTACT_KEY, spine, spineWithoutEmail } from './filing-helpers.ts';
import { address } from './identity-helpers.ts';

const VISITOR = '203.0.113.77';
const PROXY = '192.0.2.200';

const db = testDatabase();
const mailer = capturingMailer();
const logs: string[] = [];
let bugsink: StandInBugsink;
let app: FastifyInstance;

const from = (opts: InjectOptions) =>
  app.inject({
    ...opts,
    remoteAddress: PROXY,
    headers: { ...(opts.headers ?? {}), 'x-forwarded-for': VISITOR },
  });

beforeAll(async () => {
  bugsink = await standInBugsink();
  app = await buildApp({
    config: {
      LOG_LEVEL: 'trace',
      CONTACT_KEY,
      TRUST_PROXY: 1,
      DOOR_REQUESTS_PER_MINUTE: 200,
    },
    db,
    mailer,
    errors: createErrorTracker({
      config: { ERROR_TRACKING_DSN: bugsink.dsn, ERROR_TRACKING_ENVIRONMENT: 'test' },
    }),
    logStream: { write: (line) => logs.push(line) },
  });
  // A bug on a submission route's scope, the way an unexpected error happens.
  app.post('/api/door-privacy-test', () => {
    throw new Error('the database said no');
  });

  const withEmail = await launchedLogbook(db, [
    { key: 'what', kind: 'short_text', label: 'What happened?', required: true },
  ]);
  const choices = await launchedLogbook(db, [
    {
      key: 'how',
      kind: 'choice_one',
      label: 'How?',
      required: true,
      settings: { options: ['ok'] },
    },
  ]);

  // A report that asks for an email, sent and confirmed.
  const email = address('privacy');
  const sent = await from({
    method: 'POST',
    url: '/api/reports',
    payload: {
      ...(await doorPass(app)),
      ...spine(email),
      logbook: withEmail.slug,
      answers: { what: 'x' },
    },
  });
  expect(sent.statusCode).toBe(200);
  const token = /\/file\/confirm\/([a-f0-9]{64})/.exec(mailer.lastTo(email)?.text ?? '')?.[1] ?? '';
  expect((await from({ method: 'POST', url: `/api/reports/confirm/${token}` })).statusCode).toBe(
    200,
  );

  // One sealed on arrival.
  const sealed = await from({
    method: 'POST',
    url: '/api/reports',
    payload: {
      ...(await doorPass(app)),
      ...spineWithoutEmail(),
      logbook: choices.slug,
      answers: { how: 'ok' },
    },
  });
  expect(sealed.json()).toEqual({ filed: true });

  // A tip.
  const slug = uniqueSlug('privacy-tips');
  const list = await db
    .insertInto('lists')
    .values({ slug, title: 'Privacy tips', visibility: 'listed' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('list_fields')
    .values({
      list_id: list.id,
      key: 'kind',
      kind: 'choice_one',
      label: 'What kind?',
      required: true,
      position: 0,
      settings: JSON.stringify({ options: ['a'] }),
      retention: 'durable',
    })
    .execute();
  const tip = await from({
    method: 'POST',
    url: `/api/lists/${slug}/entries`,
    payload: { ...(await doorPass(app)), answers: { kind: 'a' } },
  });
  expect(tip.statusCode).toBe(200);

  // A refusal at each check.
  for (const door of [
    { website: 'filled' },
    { start: startToken(app, 1) },
    { altcha: '' },
    { altcha: 'garbage' },
  ]) {
    const r = await from({
      method: 'POST',
      url: '/api/reports',
      payload: {
        ...(await doorPass(app)),
        ...spineWithoutEmail(),
        logbook: choices.slug,
        answers: { how: 'ok' },
        ...door,
      },
    });
    expect(r.statusCode).toBe(400);
  }
  // And an unexpected error.
  expect(
    (await from({ method: 'POST', url: '/api/door-privacy-test', payload: {} })).statusCode,
  ).toBe(500);
  // Over the read limit.
  for (let i = 0; i < 205; i += 1) await from({ method: 'GET', url: '/api/intake-switch' });
  await app.close();
}, 60_000);

afterAll(async () => {
  await bugsink.close();
  await db.destroy();
});

/** Each address, and the hash the limits count it under, in every form it could be written. */
const needles = () => [VISITOR, PROXY, processHasher.of(VISITOR), processHasher.of(PROXY)];

describe('where an address could have gone', () => {
  it('is in no row of any table: not the reports, the submissions, the tips, nor anywhere else', async () => {
    const { rows: tables } = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`.execute(db);
    expect(tables.map((t) => t.table_name)).toEqual(
      expect.arrayContaining([
        'reports',
        'report_submissions',
        'list_entries',
        'intake_refusal_counts',
      ]),
    );
    for (const { table_name } of tables) {
      const { rows } = await sql<{ row: string }>`
        SELECT row_to_json(t)::text AS row FROM ${sql.table(table_name)} t`.execute(db);
      const text = rows.map((r) => r.row).join('\n');
      for (const needle of needles())
        expect(text, `${table_name} holds ${needle}`).not.toContain(needle);
    }
  });

  it('is in no log line, though every request was logged', () => {
    expect(logs.length).toBeGreaterThan(100);
    // The request lines are there: route patterns, never addresses or URLs.
    expect(logs.some((l) => l.includes('"route":"/api/reports"'))).toBe(true);
    expect(logs.some((l) => l.includes('/api/reports/confirm/:token'))).toBe(true);
    expect(logs.some((l) => /\/confirm\/[a-f0-9]{64}/.test(l))).toBe(false);
    const all = logs.join('\n');
    for (const needle of needles()) expect(all).not.toContain(needle);
    expect(all).not.toMatch(/remoteAddress|x-forwarded-for|"ip"/i);
  });

  it('is in nothing error tracking received', async () => {
    // Give the transport a moment: capture does not wait.
    for (let i = 0; i < 50 && !bugsink.received.length; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(bugsink.received.length).toBeGreaterThan(0);
    const all = JSON.stringify(bugsink.received);
    expect(all).toContain('the database said no');
    for (const needle of needles()) expect(all).not.toContain(needle);
    expect(all).not.toMatch(/ip_address|x-forwarded-for/i);
  });

  it('the refusals were counted by check, and nothing else about them was kept', async () => {
    const rows = await db.selectFrom('intake_refusal_counts').selectAll().execute();
    const checks = new Set(rows.map((r) => r.check_name));
    for (const c of ['honeypot', 'too_fast', 'puzzle_missing', 'puzzle_wrong', 'requests'])
      expect(checks).toContain(c);
    // The hour, the check and the count: no column for anything more.
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['check_name', 'hour', 'refusals']);
  });
});
