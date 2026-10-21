/**
 * The journalist alert list (plan D, J1 to J6): signing up, confirming by
 * button, an alert that carries counts and nothing else, turning alerts off
 * and changing them by its links (decision 47), and leaving.
 */
import type { FieldDefinition } from '@reportlog/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { randomBytes } from 'node:crypto';
import { emailDigest, keyringFrom, openWithDek } from '../../src/filing/contactKeys.ts';
import { hashPassword } from '../../src/identity/secrets.ts';
import { dekOf, issueLink } from '../../src/journalists/list.ts';
import { rotateSubscriberKeys } from '../../src/journalists/rotate.ts';
import { runJournalistAlerts } from '../../src/journalists/alerts.ts';
import { SETTLE_MS } from '../../src/site/digest.ts';
import { CONTACT_KEY } from './filing-helpers.ts';
import { fileReport, launchedLogbook, testDatabase } from './helpers.ts';
import { address, liftCurtain, SITE } from './identity-helpers.ts';

const db = testDatabase();
const mailer = capturingMailer();
const ring = keyringFrom(CONTACT_KEY);
let app: Awaited<ReturnType<typeof buildApp>>;

const WHERE: FieldDefinition[] = [
  // County depth, so one Arizona report below can be a county (decision 44).
  { key: 'where', kind: 'location', label: 'Where?', settings: { scope: 'us', depth: 'county' } },
  { key: 'what', kind: 'long_text', label: 'What?' },
];
const NAME = 'Pat Reporter';
const OUTLET = 'The Daily Example';
const email = address('journalist');
const other = address('journalist-tx');

const signup = (body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/journalists/signup', payload: body });
const tokenIn = (kind: 'confirm' | 'stop' | 'settings', text: string) =>
  new RegExp(`/journalists/${kind}/([a-f0-9]{64})`).exec(text)?.[1] ?? '';
const rowOf = (who: string) =>
  db
    .selectFrom('journalist_subscribers')
    .selectAll()
    .where('email_hmac', '=', emailDigest(ring, who))
    .executeTakeFirst();

let clock = Date.now();
async function approved(lb: { id: number; slug: string }, place: string, status = 'valid') {
  const { row } = await fileReport(
    db,
    lb,
    { where: place, what: 'SECRET-WORDS-OF-A-REPORT' },
    { questions: WHERE },
  );
  await db
    .insertInto('report_heads')
    .values({
      thread_id: row.thread_id,
      current_report_id: row.id,
      moderation_status: status,
      updated_at: new Date((clock += 1000)),
    })
    .execute();
  return row.public_ref;
}

beforeAll(async () => {
  app = await buildApp({
    config: { LOG_LEVEL: 'silent', SITE_ORIGIN: SITE, CONTACT_KEY },
    db,
    mailer,
  });
});
afterAll(async () => {
  await db.deleteFrom('journalist_subscribers').execute();
  await liftCurtain(db);
  await app.close();
  await db.destroy();
});

describe('signing up, and double opt-in', () => {
  let token = '';

  it('collects four answers, refuses an unknown state, and sends a link', async () => {
    const bad = await signup({ name: NAME, outlet: OUTLET, email, states: ['US-ZZ'] });
    expect(bad.statusCode).toBe(400);
    expect(mailer.lastTo(email)).toBeUndefined();

    const res = await signup({ name: NAME, outlet: OUTLET, email, states: ['US-AZ'] });
    expect(res.statusCode).toBe(200);
    token = tokenIn('confirm', mailer.lastTo(email)?.text ?? '');
    expect(token).not.toBe('');
  });

  it('is not on the list yet, and nothing readable is stored', async () => {
    const row = await rowOf(email);
    expect(row?.status).toBe('pending');
    const stored = JSON.stringify(row);
    for (const secret of [email, NAME, OUTLET]) {
      expect(stored).not.toContain(secret);
      expect(stored).not.toContain(Buffer.from(secret).toString('base64'));
    }
  });

  it('opening the link, however often, changes nothing', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/journalists/confirm/${token}` });
      expect(res.json()).toMatchObject({ state: 'pending', states: ['Arizona'] });
    }
    expect((await rowOf(email))?.status).toBe('pending');
  });

  it('only the button puts the address on the list, and twice is harmless', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: 'POST', url: `/api/journalists/confirm/${token}` });
      expect(res.json()).toMatchObject({ state: 'confirmed' });
    }
    expect((await rowOf(email))?.status).toBe('active');
  });

  it('gives the same answer for a listed address and sends it nothing', async () => {
    const before = mailer.messages.length;
    const res = await signup({ name: 'X', outlet: 'Y', email, states: ['US-TX'] });
    expect(res.json()).toEqual({ ok: true });
    expect(mailer.messages.length).toBe(before);
    expect((await rowOf(email))?.states).toEqual(['US-AZ']);
  });

  it('an unknown or malformed link is gone, the same either way', async () => {
    for (const t of ['x', 'a'.repeat(64)]) {
      const res = await app.inject({ method: 'GET', url: `/api/journalists/confirm/${t}` });
      expect(res.json()).toEqual({ state: 'gone' });
    }
  });
});

describe('the alert', () => {
  const run = (now: number) =>
    runJournalistAlerts({
      db,
      mailer,
      siteOrigin: SITE,
      log: () => undefined,
      contactKey: CONTACT_KEY,
      now: () => new Date(now),
    });
  let refs: string[] = [];

  beforeAll(async () => {
    // The window opens here, so reports other test files approved earlier are not in it.
    const opened = (clock = Date.now());
    const lb = await launchedLogbook(db, WHERE);
    refs = [
      await approved(lb, 'US-AZ'),
      // A county counts toward its state, as on the heat maps.
      await approved(lb, 'US-AZ-04013'),
      await approved(lb, 'US-TX'),
      await approved(lb, 'US-AZ', 'pending'),
    ];
    await db
      .updateTable('journalist_subscribers')
      .set({ last_sent_at: new Date(opened) })
      .execute();
  });

  it('counts approved reports in the subscriber’s states, with no content and no links but its own settings', async () => {
    const out = await run(clock + 2 * SETTLE_MS);
    expect(out.ok).toBe(true);
    const mail = mailer.lastTo(email);
    expect(mail?.text).toContain('Arizona: 2');
    expect(mail?.subject).toBe('2 new approved reports in the states you cover');
    expect(mail?.text).not.toContain('Texas');
    const text = mail?.text ?? '';
    expect(text).not.toContain('SECRET-WORDS');
    for (const ref of refs) expect(text).not.toContain(ref);
    expect(text).not.toMatch(/tip/i);
    // The only links are about the alerts: change them, or stop them. One token for both.
    expect(
      [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0].replace(/[a-f0-9]{64}/, 'T')),
    ).toEqual([`${SITE}/journalists/settings/T`, `${SITE}/journalists/stop/T`]);
    expect(tokenIn('settings', text)).toBe(tokenIn('stop', text));
    expect(text).toContain('Change your alerts');
  });

  it('is not repeated, and a pending address is never mailed', async () => {
    await signup({ name: 'P', outlet: 'Q', email: other, states: ['US-TX'] });
    const before = mailer.messages.length;
    await run(clock + 4 * SETTLE_MS);
    expect(mailer.messages.slice(before).map((m) => m.to)).toEqual([]);
  });
});

describe('stopping, changing and leaving, and what being listed does not do', () => {
  let token = '';
  const run = (now: number) =>
    runJournalistAlerts({
      db,
      mailer,
      siteOrigin: SITE,
      log: () => undefined,
      contactKey: CONTACT_KEY,
      now: () => new Date(now),
    });
  const get = (path: string) => app.inject({ method: 'GET', url: path });
  const post = (path: string, payload?: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: path, ...(payload ? { payload } : {}) });
  beforeAll(() => {
    token = tokenIn('stop', mailer.lastTo(email)?.text ?? '');
  });

  it('opening the stop link or the change link changes nothing', async () => {
    const before = await rowOf(email);
    for (let i = 0; i < 2; i++) {
      expect((await get(`/api/journalists/stop/${token}`)).json()).toMatchObject({
        state: 'active',
        states: ['Arizona'],
      });
      expect((await get(`/api/journalists/settings/${token}`)).json()).toEqual({
        state: 'open',
        address: expect.any(String) as string,
        states: ['US-AZ'],
        alerts: 'on',
      });
    }
    expect(await rowOf(email)).toEqual(before);
  });

  it('works in front of the site password, while signing up stays behind it', async () => {
    await db
      .updateTable('site_access')
      .set({ enabled: true, password_hash: await hashPassword('journalist-pw') })
      .where('id', '=', true)
      .execute();
    try {
      expect((await get(`/api/journalists/stop/${token}`)).statusCode).toBe(200);
      expect((await get(`/api/journalists/settings/${token}`)).statusCode).toBe(200);
      expect(
        (await signup({ name: 'a', outlet: 'b', email: other, states: ['US-TX'] })).statusCode,
      ).not.toBe(200);
    } finally {
      await liftCurtain(db);
    }
  });

  it('grants no access: being listed creates no user, session or role', async () => {
    const users = await db
      .selectFrom('users')
      .select('id')
      .where('email', 'in', [email, other])
      .execute();
    expect(users).toEqual([]);
  });

  it('the stop button, one POST, turns alerts off and keeps the address on the list', async () => {
    const res = await post(`/api/journalists/stop/${token}`);
    expect(res.json()).toMatchObject({ state: 'paused' });
    const row = await rowOf(email);
    expect(row?.status).toBe('active');
    const at = row?.alerts_paused_at;
    expect(at).toBeInstanceOf(Date);
    // A second press keeps the first time; the page now says it is off.
    expect((await post(`/api/journalists/stop/${token}`)).json()).toMatchObject({
      state: 'paused',
    });
    expect((await rowOf(email))?.alerts_paused_at).toEqual(at);
    expect((await get(`/api/journalists/stop/${token}`)).json()).toMatchObject({
      state: 'paused',
    });
  });

  it('a stop link issued the old way, before alerts could be changed, pauses too', async () => {
    const who = address('journalist-old-link');
    await signup({ name: 'O', outlet: 'L', email: who, states: ['US-NM'] });
    await post(`/api/journalists/confirm/${tokenIn('confirm', mailer.lastTo(who)?.text ?? '')}`);
    const id = (await rowOf(who))?.id ?? 0;
    const old = await issueLink(db, id, 'stop');
    expect((await post(`/api/journalists/stop/${old}`)).json()).toMatchObject({ state: 'paused' });
    expect((await rowOf(who))?.alerts_paused_at).toBeInstanceOf(Date);
    // And it opens the change page.
    expect((await get(`/api/journalists/settings/${old}`)).json()).toMatchObject({
      state: 'open',
      alerts: 'off',
    });
  });

  it('the alert job skips a paused subscriber, and their window does not move', async () => {
    const lb = await launchedLogbook(db, WHERE);
    await approved(lb, 'US-AZ');
    const before = await rowOf(email);
    const sent = mailer.messages.length;
    const out = await run(clock + 2 * SETTLE_MS);
    expect(out.ok).toBe(true);
    expect(mailer.messages.slice(sent).map((m) => m.to)).not.toContain(email);
    expect((await rowOf(email))?.last_sent_at).toEqual(before?.last_sent_at);
  });

  it('a change of states is checked as on signup, and a refused one changes nothing', async () => {
    const before = await rowOf(email);
    for (const states of [[], ['US-ZZ'], ['FR']]) {
      const res = await post(`/api/journalists/settings/${token}`, { states, alerts: 'on' });
      expect(res.statusCode, JSON.stringify(states)).toBe(400);
    }
    expect(
      (await post(`/api/journalists/settings/${token}`, { states: ['US-AZ'], alerts: 'maybe' }))
        .statusCode,
    ).toBe(400);
    expect(await rowOf(email)).toEqual(before);
  });

  it('turning alerts back on, with new states, starts the window now: no backlog', async () => {
    const before = new Date();
    const res = await post(`/api/journalists/settings/${token}`, {
      states: ['us-tx', 'US-AZ', 'US-TX'],
      alerts: 'on',
    });
    expect(res.json()).toMatchObject({ state: 'open', states: ['US-AZ', 'US-TX'], alerts: 'on' });
    const row = await rowOf(email);
    expect(row?.alerts_paused_at).toBeNull();
    expect(row?.last_sent_at?.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);

    // Alerts arrive again, in a state just added. (The counts themselves follow
    // this file's own clock, which runs ahead of the database's, so only the
    // state is checked; the window start above is what stops a backlog.)
    clock = Math.max(clock, Date.now()) + 60_000;
    const lb = await launchedLogbook(db, WHERE);
    await approved(lb, 'US-TX');
    await run(clock + 2 * SETTLE_MS);
    expect(mailer.lastTo(email)?.text).toMatch(/Texas: \d/);
  });

  it('turning alerts off from the change page keeps the address listed', async () => {
    const res = await post(`/api/journalists/settings/${token}`, {
      states: ['US-AZ'],
      alerts: 'off',
    });
    expect(res.json()).toMatchObject({ state: 'open', states: ['US-AZ'], alerts: 'off' });
    expect((await rowOf(email))?.status).toBe('active');
  });

  it('"remove me from the list entirely" deletes the subscriber and every link', async () => {
    const res = await post(`/api/journalists/settings/${token}/remove`);
    expect(res.json()).toEqual({ state: 'removed' });
    expect(await rowOf(email)).toBeUndefined();
    for (const path of [`settings/${token}`, `stop/${token}`]) {
      expect((await get(`/api/journalists/${path}`)).json()).toEqual({ state: 'gone' });
    }
    expect((await post(`/api/journalists/settings/${token}/remove`)).json()).toEqual({
      state: 'gone',
    });
  });
});

describe('rotating CONTACT_KEY', () => {
  it('moves a subscriber to the new key, and the address still opens and is still found', async () => {
    const who = address('journalist-rotating');
    await signup({ name: 'R', outlet: 'S', email: who, states: ['US-AZ'] });
    const next = keyringFrom(randomBytes(32).toString('base64'));
    const moved = await db.transaction().execute((trx) => rotateSubscriberKeys(trx, next, ring));
    expect(moved).toBeGreaterThanOrEqual(1);
    const row = await db
      .selectFrom('journalist_subscribers')
      .selectAll()
      .where('email_hmac', '=', emailDigest(next, who))
      .executeTakeFirstOrThrow();
    expect(openWithDek(dekOf(next, row.dek_wrapped), row.email_enc)).toBe(who);
    expect(await rowOf(who)).toBeUndefined();
  });
});
