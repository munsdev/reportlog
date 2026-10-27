/**
 * E1: the confirmation link's life (D15), five reports per address per day
 * (D5), the day every report contact is deleted (D4), the optional email card
 * (D8, D20, D21) and the journalist sharing permission (G5).
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import { loadConfig } from '../../src/config.ts';
import { openContact } from '../../src/filing/contactKeys.ts';
import { LINK_TTL_MS } from '../../src/filing/filing.ts';
import {
  DEFAULT_CONTACTS_DELETE_ON,
  filingLimits,
  setFilingLimits,
} from '../../src/filing/limits.ts';
import { eraseDueContacts, runContactsSweep } from '../../src/jobs/contacts-sweep.ts';
import { JOBS } from '../../src/jobs/registry.ts';
import { runSweep } from '../../src/jobs/sweep.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import {
  permissionHistory,
  permissionsFor,
  setPermission,
  sharingGranted,
} from '../../src/permissions/log.ts';
import { launchedLogbook } from './helpers.ts';
import {
  RING,
  confirm,
  filingHarness,
  look,
  send,
  spine,
  spineWithoutEmail,
  threadOf,
  tokenFor,
} from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { address } from './identity-helpers.ts';

let h: FilingHarness;
let typed: { id: number; slug: string };
let silent: { id: number; slug: string };

const DAY = 86_400_000;

beforeAll(async () => {
  h = await filingHarness({ sendsPerClient: 1000 });
  typed = await launchedLogbook(h.db, [
    { key: 'what', kind: 'short_text', label: 'What happened?', required: true },
  ]);
  // No typed question, so no address is asked unless the card is turned on.
  silent = await launchedLogbook(h.db, [{ key: 'seen', kind: 'yes_no', label: 'Did you see it?' }]);
});
afterAll(async () => {
  await setFilingLimits(
    h.db,
    { link_days: null, address_daily_cap: null, contacts_delete_on: null },
    't',
  );
  await h.close();
});

const sendTyped = (email: string, extra: Record<string, unknown> = {}) =>
  send(h, {
    ...spine(email, extra),
    logbook: typed.slug,
    answers: { what: 'The door was locked' },
  });

const submissionOf = (email: string) =>
  h.db
    .selectFrom('report_submissions')
    .selectAll()
    .where('email', '=', email)
    .orderBy('id', 'desc')
    .executeTakeFirstOrThrow();

describe('D15: the confirmation link stays valid 90 days', () => {
  it('is 90 days by default, and the email says so, not 24 hours', async () => {
    const email = address('ttl');
    expect((await sendTyped(email)).status).toBe(200);
    const sub = await submissionOf(email);
    const life = sub.expires_at.getTime() - sub.created_at.getTime();
    expect(Math.abs(life - 90 * DAY)).toBeLessThan(60_000);
    expect(LINK_TTL_MS).toBe(90 * DAY);
    const text = h.mailer.lastTo(email)?.text ?? '';
    expect(text).toContain('90 days');
    expect(text).not.toMatch(/24 hours/);
  });

  it('is a setting; a report already waiting keeps the expiry it was given', async () => {
    const before = address('ttl-before');
    await sendTyped(before);
    const given = (await submissionOf(before)).expires_at.getTime();
    await setFilingLimits(h.db, { link_days: 30 }, 't');
    try {
      const after = address('ttl-after');
      await sendTyped(after);
      const sub = await submissionOf(after);
      expect(Math.abs(sub.expires_at.getTime() - sub.created_at.getTime() - 30 * DAY)).toBeLessThan(
        60_000,
      );
      expect(h.mailer.lastTo(after)?.text).toContain('30 days');
      expect((await submissionOf(before)).expires_at.getTime()).toBe(given);
    } finally {
      await setFilingLimits(h.db, { link_days: null }, 't');
    }
    expect((await filingLimits(h.db)).link_days).toBe(90);
  });

  it('a held report whose link runs out unused is deleted whole, address and file pointer included', async () => {
    const email = address('lapsed');
    await sendTyped(email);
    const token = tokenFor(h.mailer, email) ?? '';
    const sub = await submissionOf(email);
    // A staged file points at its submission; that must not stop the delete.
    const slot = await h.db
      .insertInto('upload_slots')
      .values({
        slot_token: 'a'.repeat(48),
        draft_hash: 'c'.repeat(64),
        declared_type: 'image/jpeg',
        logbook_id: typed.id,
        submission_id: sub.id,
        status: 'expired',
        declared_size: 1,
        staging_key: 'staging/e1-limits-test',
        expires_at: new Date(Date.now() - 1000),
      })
      .returning('id')

      .executeTakeFirstOrThrow();
    await h.db
      .updateTable('report_submissions')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', sub.id)
      .execute();
    // Unused, past its time: it cannot be followed.
    expect((await look(h, token)).body.confirmation).toMatchObject({ state: 'expired' });
    expect((await confirm(h, token)).body.just_confirmed).toBe(false);
    expect(
      await h.db.selectFrom('reports').select('id').where('logbook_id', '=', typed.id).execute(),
    ).toHaveLength(0);

    const ctx = {
      config: loadConfig({ DATABASE_URL: inject('databaseUrl') }),
      db: h.db,
      mailer: capturingMailer(),
      log: () => undefined,
      args: [],
      now: () => new Date(),
    };
    expect(await runSweep(ctx)).toMatchObject({ ok: true });
    expect(
      await h.db.selectFrom('report_submissions').select('id').where('id', '=', sub.id).execute(),
    ).toHaveLength(0);
    // Nothing of the contact is anywhere else.
    expect(
      await sql`SELECT 1 FROM report_submissions WHERE email = ${email}`
        .execute(h.db)
        .then((r) => r.rows),
    ).toHaveLength(0);
    {
      const left = await h.db
        .selectFrom('upload_slots')
        .select('submission_id')
        .where('id', '=', slot.id)
        .executeTakeFirst();
      expect(left?.submission_id).toBeNull();
    }
  });
});

describe('D5: five reports per address per day', () => {
  it('takes five and refuses the sixth in one plain sentence, sending nothing', async () => {
    const email = address('cap');
    for (let i = 0; i < 5; i += 1) expect((await sendTyped(email)).status).toBe(200);
    const mails = h.mailer.messages.filter((m) => m.to === email).length;
    const sixth = await sendTyped(email);
    expect(sixth.status).toBe(429);
    const message = JSON.stringify(sixth.body);
    expect(message).toContain('try again tomorrow');
    // It does not say which check refused.
    expect(message).not.toMatch(/five|5|address|limit|cap|per day/i);
    expect(h.mailer.messages.filter((m) => m.to === email)).toHaveLength(mails);
    expect(
      await h.db.selectFrom('report_submissions').select('id').where('email', '=', email).execute(),
    ).toHaveLength(5);
    // Another address is unaffected, and case does not make a new person.
    expect((await sendTyped(address('cap-other'))).status).toBe(200);
    expect((await sendTyped(email.toUpperCase())).status).toBe(429);
  });

  it('stores no address beside the count', async () => {
    const email = address('cap-private');
    await sendTyped(email);
    const rows = await h.db.selectFrom('filing_address_days').selectAll().execute();
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(email);
    expect(rows.every((r) => /^[a-f0-9]{64}$/.test(r.digest))).toBe(true);
    // The digest is not the contact digest "My reports" uses either.
    const contact =
      await sql`SELECT count(*)::int AS n FROM contact_keys WHERE email_hmac = ANY(${rows.map((r) => r.digest)})`.execute(
        h.db,
      );
    expect((contact.rows[0] as { n: number }).n).toBe(0);
  });

  it('a refused report counts nothing and keeps nothing', async () => {
    const email = address('cap-bad');
    const bad = await send(h, { ...spine(email), logbook: typed.slug, answers: {} });
    expect(bad.status).toBe(400);
    for (let i = 0; i < 5; i += 1) expect((await sendTyped(email)).status).toBe(200);
  });

  it('the cap is a setting', async () => {
    await setFilingLimits(h.db, { address_daily_cap: 1 }, 't');
    try {
      const email = address('cap-one');
      expect((await sendTyped(email)).status).toBe(200);
      expect((await sendTyped(email)).status).toBe(429);
    } finally {
      await setFilingLimits(h.db, { address_daily_cap: null }, 't');
    }
  });

  it('yesterday’s counts are swept', async () => {
    await h.db
      .insertInto('filing_address_days')
      .values({ day: '2020-01-01', digest: 'b'.repeat(64), n: 3 })
      .execute();
    await runSweep({
      config: loadConfig({ DATABASE_URL: inject('databaseUrl') }),
      db: h.db,
      mailer: capturingMailer(),
      log: () => undefined,
      args: [],
      now: () => new Date(),
    });
    expect(
      await h.db
        .selectFrom('filing_address_days')
        .select('day')
        .where('digest', '=', 'b'.repeat(64))
        .execute(),
    ).toHaveLength(0);
  });
});

describe('D4: report contacts are deleted on 31 January 2027', () => {
  it('defaults to that date, as a setting, with a named job', async () => {
    expect((await filingLimits(h.db)).contacts_delete_on).toBe('2027-01-31');
    expect(DEFAULT_CONTACTS_DELETE_ON).toBe('2027-01-31');
    expect(JOBS.some((j) => j.name === 'contacts-sweep')).toBe(true);
  });

  it('does nothing before the day, and on it erases the contact but not the report', async () => {
    const email = address('contact');
    await sendTyped(email);
    const done = await confirm(h, tokenFor(h.mailer, email) ?? '');
    const ref = done.body.confirmation.public_ref ?? '';
    const thread = await threadOf(h.db, ref);
    const held = address('held');
    await sendTyped(held);
    const heldId = (await submissionOf(held)).id;
    const only = { threads: [thread], submissions: [heldId] };

    const early = await eraseDueContacts(h.db, new Date('2027-01-30T23:59:00Z'), only);
    expect(early.due).toBe(false);
    expect((await openContact(h.db, RING, thread))?.email).toBe(email);

    const late = await eraseDueContacts(h.db, new Date('2027-01-31T00:00:00Z'), only);
    expect(late).toMatchObject({ due: true, erased: 1, waiting: 1 });
    expect(await openContact(h.db, RING, thread)).toMatchObject({ erased: true, email: null });
    expect(
      await h.db.selectFrom('report_submissions').select('id').where('id', '=', heldId).execute(),
    ).toHaveLength(0);
    // The report is untouched and still verifies.
    const v = await verifyReport(h.db, ref);
    expect(v?.content.ok === true && v.link.ok && v.position.ok).toBe(true);
    const acts = await h.db
      .selectFrom('reporter_actions')
      .select('action')
      .where('thread_id', '=', thread)
      .execute();
    expect(acts.map((a) => a.action)).toEqual(['erase']);
    // Run again: the reporter's own earlier erasure style, nothing left to do.
    expect(await eraseDueContacts(h.db, new Date('2027-02-01T00:00:00Z'), only)).toMatchObject({
      erased: 0,
      waiting: 0,
    });
  });

  it('the date is read from the setting', async () => {
    const ctxFor = (now: Date) => ({
      config: loadConfig({ DATABASE_URL: inject('databaseUrl') }),
      db: h.db,
      mailer: capturingMailer(),
      log: () => undefined,
      args: [],
      now: () => now,
    });
    await setFilingLimits(h.db, { contacts_delete_on: '2999-01-01' }, 't');
    try {
      expect(await runContactsSweep(ctxFor(new Date('2027-06-01T00:00:00Z')))).toMatchObject({
        ok: true,
        summary: expect.stringContaining('has not come') as string,
      });
    } finally {
      await setFilingLimits(h.db, { contacts_delete_on: null }, 't');
    }
  });
});

describe('D8, D20, D21: the optional email card', () => {
  it('is off for a logbook nobody turned it on for: an address is refused, as before', async () => {
    const lb = await h.db
      .selectFrom('logbooks')
      .select('email_optional')
      .where('id', '=', silent.id)
      .executeTakeFirstOrThrow();
    expect(lb.email_optional).toBeNull();
    const refused = await send(h, { ...spine(address('off')), logbook: silent.slug, answers: {} });
    expect(refused.status).toBe(400);
    const filed = await send(h, { ...spineWithoutEmail(), logbook: silent.slug, answers: {} });
    expect(filed.body).toMatchObject({ filed: true });
  });

  describe('turned on', () => {
    let on: { id: number; slug: string };
    beforeAll(async () => {
      on = await launchedLogbook(h.db, [{ key: 'seen', kind: 'yes_no', label: 'Did you see it?' }]);
      await h.db
        .updateTable('logbooks')
        .set({ email_optional: true })
        .where('id', '=', on.id)
        .execute();
    });

    it('is told to the form, only where it applies', async () => {
      const res = await h.app.inject({ method: 'GET', url: `/api/logbooks/${on.slug}` });
      const off = await h.app.inject({ method: 'GET', url: `/api/logbooks/${silent.slug}` });
      expect(res.json<{ email_optional?: boolean }>().email_optional).toBe(true);
      expect(off.json<Record<string, unknown>>()).not.toHaveProperty('email_optional');
    });

    it('skipped, files at once with no contact', async () => {
      const sent = await send(h, { ...spineWithoutEmail(), logbook: on.slug, answers: {} });
      expect(sent.body).toMatchObject({ filed: true });
      const blank = await send(h, {
        ...spineWithoutEmail({ email: '  ' }),
        logbook: on.slug,
        answers: {},
      });
      expect(blank.body).toMatchObject({ filed: true });
    });

    it('given, holds the report until the link is followed, then files with a contact', async () => {
      const email = address('optional');
      const sent = await send(h, { ...spine(email), logbook: on.slug, answers: {} });
      expect(sent.body).toEqual({ pending: true });
      expect(
        await h.db.selectFrom('reports').select('id').where('logbook_id', '=', on.id).execute(),
      ).toHaveLength(2);
      const done = await confirm(h, tokenFor(h.mailer, email) ?? '');
      expect(done.body.just_confirmed).toBe(true);
      const thread = await threadOf(h.db, done.body.confirmation.public_ref ?? '');
      expect((await openContact(h.db, RING, thread))?.email).toBe(email);
    });

    it('an address that is not one is refused', async () => {
      const bad = await send(h, { ...spine('not-an-address'), logbook: on.slug, answers: {} });
      expect(bad.status).toBe(400);
    });
  });
});

describe('G5: the journalist_sharing permission', () => {
  it('is no until given, is never sealed, and is the reporter’s to change', async () => {
    const email = address('share');
    await sendTyped(email, { journalist_sharing: true });
    const done = await confirm(h, tokenFor(h.mailer, email) ?? '');
    const ref = done.body.confirmation.public_ref ?? '';
    const thread = await threadOf(h.db, ref);
    expect(await sharingGranted(h.db, thread)).toBe(true);
    expect((await permissionsFor(h.db, thread)).journalist_sharing).toBe(true);
    const sealed = await h.db
      .selectFrom('reports')
      .select('answers')
      .where('public_ref', '=', ref)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(sealed)).not.toMatch(/sharing/);

    await setPermission(h.db, {
      threadId: thread,
      permission: 'journalist_sharing',
      granted: false,
    });
    expect(await sharingGranted(h.db, thread)).toBe(false);
    expect((await permissionHistory(h.db, thread)).map((p) => p.granted)).toEqual([false, true]);
    const v = await verifyReport(h.db, ref);
    expect(v?.content.ok === true && v.link.ok && v.position.ok).toBe(true);
  });

  it('not answering is no, on a held report and on one filed on arrival', async () => {
    const email = address('share-no');
    await sendTyped(email);
    const thread = await threadOf(
      h.db,
      (await confirm(h, tokenFor(h.mailer, email) ?? '')).body.confirmation.public_ref ?? '',
    );
    expect(await sharingGranted(h.db, thread)).toBe(false);
    const filed = await send(h, {
      ...spineWithoutEmail({ journalist_sharing: true }),
      logbook: silent.slug,
      answers: {},
    });
    expect(filed.body).toMatchObject({ filed: true });
    const t = await threadOf(h.db, (filed.body as { public_ref: string }).public_ref);
    expect(await sharingGranted(h.db, t)).toBe(true);
  });
});
