/**
 * Sending a report and CONFIRMING it, through the routes.
 *
 * Ported from legacy/scripts/confirm-selftest.mjs, which exists because the
 * old suites all stopped at the POST: when confirming started throwing on
 * every click, three suites stayed green while the site could not accept a
 * report at all. A path that runs only when somebody clicks a link in an
 * email is the path no test reaches by accident, so every link here is read
 * out of the email the server sent.
 *
 * Not ported here: the board's filters and CSV export (the board is
 * workstream D's), the snapshot (D's), and a confirmation arriving while
 * files are still being prepared (F's: no uploads exist yet).
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import { openContact } from '../../src/filing/contactKeys.ts';
import { launchedLogbook } from './helpers.ts';
import {
  COORDINATOR,
  RING,
  confirm,
  fileThroughRoutes,
  filingHarness,
  look,
  send,
  spine,
  threadOf,
  tokenFor,
} from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { address } from './identity-helpers.ts';

let h: FilingHarness;
let lb: { id: number; slug: string };

const QS = [
  { key: 'what_happened', kind: 'short_text', label: 'What happened?', required: true },
  { key: 'when_was_it', kind: 'date', label: 'When was it?' },
];

beforeAll(async () => {
  h = await filingHarness();
  lb = await launchedLogbook(h.db, QS);
});
afterAll(async () => {
  await h.close();
});

const verifies = (v: Awaited<ReturnType<typeof verifyReport>>) =>
  v?.content.ok === true && v.link.ok && v.position.ok;

describe('a report must name a logbook', () => {
  it('refuses a submission that names none, and emails nothing', async () => {
    const email = address('nolog');
    const sent = await send(h, { ...spine(email), answers: { what_happened: 'Nowhere to go' } });
    expect(sent.status).toBe(400);
    expect(JSON.stringify(sent.body)).toMatch(/logbook/i);
    expect(tokenFor(h.mailer, email)).toBeUndefined();
  });
});

describe('a report filed through a logbook', () => {
  let email: string;
  let token: string;

  it('is accepted and emails a confirmation link to the website', async () => {
    email = address('filed');
    const sent = await send(h, {
      ...spine(email),
      logbook: lb.slug,
      answers: { what_happened: 'The door was locked', when_was_it: '2026-09-11' },
    });
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({ pending: true });
    const mail = h.mailer.lastTo(email);
    expect(mail?.subject).toBe('Confirm your report');
    expect(mail?.text).toMatch(/^https:\/\/reports\.example\.test\/file\/confirm\/[a-f0-9]{64}$/m);
    token = tokenFor(h.mailer, email) ?? '';
    expect(token).toHaveLength(64);
  });

  it('files NOTHING until the link is used, and looking at the link is not using it', async () => {
    const before = await h.db
      .selectFrom('reports')
      .select('id')
      .where('logbook_id', '=', lb.id)
      .execute();
    expect(before).toHaveLength(0);
    // A mail scanner opening the link.
    for (let i = 0; i < 3; i += 1) {
      const seen = await look(h, token);
      expect(seen.status).toBe(200);
      expect(seen.body.confirmation).toMatchObject({
        state: 'unconfirmed',
        logbook_title: `Logbook ${lb.slug}`,
      });
    }
    const after = await h.db
      .selectFrom('reports')
      .select('id')
      .where('logbook_id', '=', lb.id)
      .execute();
    expect(after).toHaveLength(0);
  });

  it('keeps only a hash of the token', async () => {
    const rows = await h.db.selectFrom('report_submissions').select('token_hash').execute();
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
    const hash = createHash('sha256').update(token, 'utf8').digest('hex');
    expect(rows.some((r) => r.token_hash === hash)).toBe(true);
  });

  let ref: string;
  it('confirming files it, with the answers and the logbook', async () => {
    const done = await confirm(h, token);
    expect(done.status).toBe(200);
    expect(done.body.just_confirmed).toBe(true);
    expect(done.body.confirmation.state).toBe('received');
    ref = done.body.confirmation.public_ref ?? '';
    const row = await h.db
      .selectFrom('reports')
      .select(['logbook_id', 'answers'])
      .where('public_ref', '=', ref)
      .executeTakeFirstOrThrow();
    // THE BUG THE OLD BRANCH WAS HELD BACK FOR: the answers validated, the
    // email went, and then they vanished.
    expect(row.answers).toEqual({
      what_happened: 'The door was locked',
      when_was_it: '2026-09-11',
    });
    expect(row.logbook_id).toBe(lb.id);
  });

  it('verifies, names its logbook by slug, and seals nothing else of its own', async () => {
    const v = await verifyReport(h.db, ref);
    expect(verifies(v)).toBe(true);
    expect(v?.hashed_fields.logbook).toBe(lb.slug);
    expect(Object.keys(v?.hashed_fields ?? {}).sort()).toEqual([
      'answers',
      'corrects_id',
      'logbook',
      'logbook_form',
      'may_publish',
      'may_publish_digest',
      'public_ref',
      'received_at',
      'thread_id',
    ]);
  });

  it('NEVER SEALS THE ADDRESS, and keeps it only under the report’s own key', async () => {
    const v = await verifyReport(h.db, ref);
    expect(v?.canonical_json).not.toContain(email);
    const thread = await threadOf(h.db, ref);
    // Gone from the waiting row the moment it was used.
    const waiting = await h.db
      .selectFrom('report_submissions')
      .select(['email', 'thread_id'])
      .where('thread_id', '=', thread)
      .executeTakeFirstOrThrow();
    expect(waiting.email).toBeNull();
    // Encrypted at rest: the bytes on disk are not the address.
    const stored = await h.db
      .selectFrom('report_contacts')
      .select(['contact_enc', 'filed_by'])
      .where('thread_id', '=', thread)
      .executeTakeFirstOrThrow();
    expect(stored.filed_by).toBe('reporter');
    expect(stored.contact_enc.toString('utf8')).not.toContain(email);
    expect((await openContact(h.db, RING, thread))?.email).toBe(email);
    const head = await h.db
      .selectFrom('report_heads')
      .select(['moderation_status', 'withdrawn'])
      .where('thread_id', '=', thread)
      .executeTakeFirstOrThrow();
    // Nothing is public until a moderator approves it.
    expect(head).toEqual({ moderation_status: 'pending', withdrawn: false });
  });

  it('a second press does not file it again, and the link shows where it stands', async () => {
    const again = await confirm(h, token);
    expect(again.body.just_confirmed).toBe(false);
    expect(again.body.confirmation).toMatchObject({ state: 'received', public_ref: ref });
    const n = await h.db
      .selectFrom('reports')
      .select('id')
      .where('logbook_id', '=', lb.id)
      .execute();
    expect(n).toHaveLength(1);
    expect((await look(h, token)).body.confirmation).toMatchObject({
      state: 'received',
      public_ref: ref,
    });
  });

  it('two presses at once file it once', async () => {
    const twice = address('twice');
    await send(h, { ...spine(twice), logbook: lb.slug, answers: { what_happened: 'Once' } });
    const t = tokenFor(h.mailer, twice) ?? '';
    const both = await Promise.all([confirm(h, t), confirm(h, t)]);
    expect(both.filter((b) => b.body.just_confirmed)).toHaveLength(1);
    expect(both[0].body.confirmation.public_ref).toBe(both[1].body.confirmation.public_ref);
  });

  it('never writes the token into a log line', () => {
    expect(h.logs.join('\n')).not.toContain(token);
    expect(h.logs.join('\n')).toContain('/api/reports/confirm/:token');
  });
});

describe('what is refused before anything is staged', () => {
  const refusedAndNothingSent = async (body: Record<string, unknown>, email: string) => {
    const r = await send(h, body);
    expect(tokenFor(h.mailer, email)).toBeUndefined();
    return r;
  };

  it('a missing required answer', async () => {
    const email = address('missing');
    const r = await refusedAndNothingSent(
      { ...spine(email), logbook: lb.slug, answers: { when_was_it: '2026-09-11' } },
      email,
    );
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('What happened? is needed');
  });

  it('no address, or something that is not one', async () => {
    for (const bad of ['', 'not-an-address']) {
      const r = await send(h, { ...spine(bad), logbook: lb.slug, answers: { what_happened: 'x' } });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toMatch(/email address/);
    }
  });

  it('the statement on the last card not confirmed', async () => {
    const email = address('noconsent');
    const r = await refusedAndNothingSent(
      { ...spine(email, { consent: false }), logbook: lb.slug, answers: { what_happened: 'x' } },
      email,
    );
    expect(r.status).toBe(400);
  });

  it('a publication digest the server never issued, or the coordinators’ one', async () => {
    for (const digest of ['a'.repeat(64), COORDINATOR, 'nonsense', undefined]) {
      const email = address('digest');
      const r = await refusedAndNothingSent(
        {
          ...spine(email, { may_publish_digest: digest }),
          logbook: lb.slug,
          answers: { what_happened: 'x' },
        },
        email,
      );
      expect(r.status).toBe(400);
      expect((r.body.error as { code: string }).code).toBe('unknown_wording');
    }
  });

  it('a draft logbook does not exist, and one that names nothing is refused', async () => {
    const draft = await h.db
      .insertInto('logbooks')
      .values({ slug: `draft-${String(Date.now())}`, title: 'A draft' })
      .returning('slug')
      .executeTakeFirstOrThrow();
    const email = address('draft');
    const r = await send(h, { ...spine(email), logbook: draft.slug, answers: {} });
    expect(r.status).toBe(404);
  });
});

describe('the publication answer', () => {
  it('NOT ANSWERING IS "NO", sealed with the wording it answered', async () => {
    const email = address('unanswered');
    const ref = await fileThroughRoutes(h, lb.slug, { what_happened: 'x' }, email, {
      may_publish: undefined,
    });
    const v = await verifyReport(h.db, ref);
    expect(v?.hashed_fields.may_publish).toBe(false);
    expect(v?.hashed_fields.may_publish_digest).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('the questions a report was answered against', () => {
  it('seals the form the reporter was ASKED, not the one at the click', async () => {
    const book = await launchedLogbook(h.db, [
      QS[0] ?? { key: 'x', kind: 'short_text', label: 'x' },
    ]);
    const formOf = async (ref: string) => {
      const v = await verifyReport(h.db, ref);
      const form = await h.db
        .selectFrom('logbook_forms')
        .select(['form_hash', 'definition'])
        .where('logbook_id', '=', book.id)
        .where('form_hash', '=', String(v?.hashed_fields.logbook_form))
        .executeTakeFirst();
      return { v, form };
    };

    const a = address('forma');
    await send(h, { ...spine(a), logbook: book.slug, answers: { what_happened: 'First' } });
    // An optional question added AFTER sending and BEFORE the click: the
    // one change a launched logbook may still take.
    await h.db
      .insertInto('logbook_fields')
      .values({
        logbook_id: book.id,
        key: 'anything_else',
        kind: 'short_text',
        label: 'Anything else?',
        required: false,
        position: 9,
      })
      .execute();
    const first = await confirm(h, tokenFor(h.mailer, a) ?? '');
    const one = await formOf(first.body.confirmation.public_ref ?? '');
    expect(verifies(one.v)).toBe(true);
    expect(one.form).toBeDefined();
    expect(
      createHash('sha256')
        .update(one.form?.definition ?? '', 'utf8')
        .digest('hex'),
    ).toBe(one.form?.form_hash);
    expect(one.form?.definition).not.toContain('anything_else');

    const secondRef = await fileThroughRoutes(
      h,
      book.slug,
      { what_happened: 'Second', anything_else: 'Yes' },
      address('formb'),
    );
    const two = await formOf(secondRef);
    expect(two.form?.definition).toContain('anything_else');
    expect(two.form?.form_hash).not.toBe(one.form?.form_hash);
    expect(verifies((await formOf(first.body.confirmation.public_ref ?? '')).v)).toBe(true);

    const thirdRef = await fileThroughRoutes(
      h,
      book.slug,
      { what_happened: 'Third' },
      address('formc'),
    );
    expect((await formOf(thirdRef)).form?.form_hash).toBe(two.form?.form_hash);
    const versions = await h.db
      .selectFrom('logbook_forms')
      .select('id')
      .where('logbook_id', '=', book.id)
      .execute();
    expect(versions).toHaveLength(2);
  });
});

describe('a link that is not, or is no longer, usable', () => {
  it('an unknown token is not found, on both methods', async () => {
    expect((await look(h, 'f'.repeat(64))).status).toBe(404);
    expect((await confirm(h, 'f'.repeat(64))).status).toBe(404);
    expect((await look(h, 'not-even-hex')).status).toBe(404);
  });

  it('an expired link says so and files nothing', async () => {
    const email = address('expired');
    await send(h, { ...spine(email), logbook: lb.slug, answers: { what_happened: 'Late' } });
    const token = tokenFor(h.mailer, email) ?? '';
    await h.db
      .updateTable('report_submissions')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('email', '=', email)
      .execute();
    expect((await look(h, token)).body.confirmation).toMatchObject({ state: 'expired' });
    const done = await confirm(h, token);
    expect(done.body.just_confirmed).toBe(false);
    expect(done.body.confirmation.state).toBe('expired');
  });

  it('a report sent while open can be confirmed after its logbook closes', async () => {
    const book = await launchedLogbook(h.db, QS);
    const email = address('closing');
    await send(h, {
      ...spine(email),
      logbook: book.slug,
      answers: { what_happened: 'Just in time' },
    });
    await h.db
      .updateTable('logbooks')
      .set({ closed_at: new Date() })
      .where('id', '=', book.id)
      .execute();
    const done = await confirm(h, tokenFor(h.mailer, email) ?? '');
    expect(done.body.just_confirmed).toBe(true);

    // And a closed logbook refuses a new one, saying why.
    const late = await send(h, {
      ...spine(address('late')),
      logbook: book.slug,
      answers: { what_happened: 'x' },
    });
    expect(late.status).toBe(503);
    expect(JSON.stringify(late.body)).toMatch(/closed/);
  });
});

describe('a site with no contact key', () => {
  it('refuses reports with a sentence rather than storing an address unprotected', async () => {
    const bare = await filingHarness({ contactKey: null });
    try {
      const book = await launchedLogbook(bare.db, QS);
      const email = address('nokey');
      const r = await send(bare, {
        ...spine(email),
        logbook: book.slug,
        answers: { what_happened: 'x' },
      });
      expect(r.status).toBe(503);
      expect((r.body.error as { code: string }).code).toBe('not_configured');
      expect(tokenFor(bare.mailer, email)).toBeUndefined();
    } finally {
      await bare.close();
    }
  });
});
