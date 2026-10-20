/**
 * The journalist alert list (plan D, J1 to J6): signing up, confirming by
 * button, an alert that carries counts and nothing else, and leaving.
 */
import type { FieldDefinition } from '@reportlog/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { randomBytes } from 'node:crypto';
import { emailDigest, keyringFrom, openWithDek } from '../../src/filing/contactKeys.ts';
import { hashPassword } from '../../src/identity/secrets.ts';
import { dekOf } from '../../src/journalists/list.ts';
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
  { key: 'where', kind: 'location', label: 'Where?', settings: { scope: 'us' } },
  { key: 'what', kind: 'long_text', label: 'What?' },
];
const NAME = 'Pat Reporter';
const OUTLET = 'The Daily Example';
const email = address('journalist');
const other = address('journalist-tx');

const signup = (body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/journalists/signup', payload: body });
const tokenIn = (kind: 'confirm' | 'stop', text: string) =>
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
    const lb = await launchedLogbook(db, WHERE);
    refs = [
      await approved(lb, 'US-AZ'),
      await approved(lb, 'US-AZ'),
      await approved(lb, 'US-TX'),
      await approved(lb, 'US-AZ', 'pending'),
    ];
    await db
      .updateTable('journalist_subscribers')
      .set({ last_sent_at: new Date(clock - 60 * 60 * 1000) })
      .execute();
  });

  it('counts approved reports in the subscriber’s states, with no content and no links but the exit', async () => {
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
    // The only link is the one that leaves.
    expect(
      [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0].replace(/[a-f0-9]{64}/, 'T')),
    ).toEqual([`${SITE}/journalists/stop/T`]);
  });

  it('is not repeated, and a pending address is never mailed', async () => {
    await signup({ name: 'P', outlet: 'Q', email: other, states: ['US-TX'] });
    const before = mailer.messages.length;
    await run(clock + 4 * SETTLE_MS);
    expect(mailer.messages.slice(before).map((m) => m.to)).toEqual([]);
  });
});

describe('leaving, and what being listed does not do', () => {
  let token = '';
  beforeAll(() => {
    token = tokenIn('stop', mailer.lastTo(email)?.text ?? '');
  });

  it('opening the unsubscribe link changes nothing', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/journalists/stop/${token}` });
    expect(res.json()).toMatchObject({ state: 'active', states: ['Arizona'] });
    expect(await rowOf(email)).toBeDefined();
  });

  it('works in front of the site password, while signing up stays behind it', async () => {
    await db
      .updateTable('site_access')
      .set({ enabled: true, password_hash: await hashPassword('journalist-pw') })
      .where('id', '=', true)
      .execute();
    try {
      const get = await app.inject({ method: 'GET', url: `/api/journalists/stop/${token}` });
      expect(get.statusCode).toBe(200);
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

  it('the button deletes the subscriber and every link; a second use is gone', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/journalists/stop/${token}` });
    expect(res.json()).toEqual({ state: 'stopped' });
    expect(await rowOf(email)).toBeUndefined();
    const again = await app.inject({ method: 'POST', url: `/api/journalists/stop/${token}` });
    expect(again.json()).toEqual({ state: 'gone' });
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
