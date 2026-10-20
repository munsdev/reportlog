/**
 * A threat to life or safety (D5).
 *
 * ITS OWN FLAG, NOT THE SEVERITY. Severity (assessment.ts) is a judgement
 * that is never sealed and that any moderator sets or clears quietly, and
 * nobody is told. This one wakes the owner at once and is a record: raising,
 * clearing, and whether the owner's email went are all rows in `threat_events`
 * (append-only), and "raised" is read off the newest raise-or-clear row.
 *
 * ON A REPORT OR ON A TIP. A report is named by its thread id and a tip by
 * its entry id. This module never reads a tip's words or a report's answers,
 * and the email carries neither: it names the thing and says where to look.
 *
 * THE EMAIL NEVER BLOCKS THE FLAG. The row is written first; a mail provider
 * that is down leaves a flag that stands and an `owner_email_failed` row that
 * says the owner was not reached, which the moderator is told.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { currentOwner } from '../identity/ownership.ts';

export type ThreatSubject = 'report' | 'tip';

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function exists(db: Kysely<DB>, kind: ThreatSubject, ref: string): Promise<boolean> {
  if (kind === 'report') {
    if (!/^[0-9a-f-]{36}$/i.test(ref)) return false;
    return (
      (await db
        .selectFrom('report_heads')
        .select('thread_id')
        .where('thread_id', '=', ref)
        .executeTakeFirst()) !== undefined
    );
  }
  if (!/^\d{1,18}$/.test(ref)) return false;
  return (
    (await db
      .selectFrom('list_entries')
      .select('id')
      .where('id', '=', Number(ref))
      .executeTakeFirst()) !== undefined
  );
}

function subject(kind: unknown, ref: unknown): { kind: ThreatSubject; ref: string } {
  if (kind !== 'report' && kind !== 'tip') {
    throw new HttpError(400, 'incomplete', 'Say whether this is a report or a tip.');
  }
  const r = clean(ref, 64);
  if (!r) throw new HttpError(400, 'incomplete', 'Say which one.');
  return { kind, ref: r };
}

function noteOf(raw: unknown): string {
  const note = clean(raw, 1000);
  if (note.length < 10) {
    throw new HttpError(
      400,
      'reason_required',
      'Say in a sentence what the threat is. The owner reads this.',
    );
  }
  return note;
}

export async function isRaised(db: Kysely<DB>, kind: ThreatSubject, ref: string): Promise<boolean> {
  const last = await db
    .selectFrom('threat_events')
    .select('action')
    .where('subject_kind', '=', kind)
    .where('subject_ref', '=', ref)
    .where('action', 'in', ['raise', 'clear'])
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return last?.action === 'raise';
}

export function ownerEmail(input: {
  kind: ThreatSubject;
  ref: string;
  siteOrigin: string;
  by: string;
}) {
  const where =
    input.kind === 'report'
      ? `${input.siteOrigin}/moderate/${input.ref}`
      : `${input.siteOrigin}/moderate/lists`;
  return {
    subject: 'A threat to life or safety has been flagged',
    text:
      `A moderator (${input.by}) flagged ${input.kind === 'report' ? 'a report' : 'a tip'} as a threat to life or safety.\n\n` +
      `Open it here: ${where}\n\n` +
      'This email does not repeat what was said. Read it where it is kept, and decide what to do.\n',
  };
}

export async function raiseThreat(
  deps: { db: Kysely<DB>; mailer: Mailer; siteOrigin: string },
  input: { kind: unknown; ref: unknown; note: unknown; actor: string },
): Promise<{ ownerEmailed: boolean }> {
  const { db } = deps;
  const s = subject(input.kind, input.ref);
  const note = noteOf(input.note);
  if (!(await exists(db, s.kind, s.ref))) {
    throw notFound(
      s.kind === 'report'
        ? 'There is no report with that reference.'
        : 'There is no tip with that number.',
    );
  }
  await db
    .insertInto('threat_events')
    .values({
      subject_kind: s.kind,
      subject_ref: s.ref,
      action: 'raise',
      actor_email: input.actor,
      note,
    })
    .execute();
  const owner = await currentOwner(db);
  let ok = false;
  if (owner) {
    try {
      await deps.mailer.send({
        to: owner,
        ...ownerEmail({ kind: s.kind, ref: s.ref, siteOrigin: deps.siteOrigin, by: input.actor }),
      });
      ok = true;
    } catch {
      ok = false;
    }
  }
  await db
    .insertInto('threat_events')
    .values({
      subject_kind: s.kind,
      subject_ref: s.ref,
      action: ok ? 'owner_emailed' : 'owner_email_failed',
      actor_email: 'system',
    })
    .execute();
  return { ownerEmailed: ok };
}

export async function clearThreat(
  db: Kysely<DB>,
  input: { kind: unknown; ref: unknown; note: unknown; actor: string },
): Promise<void> {
  const s = subject(input.kind, input.ref);
  const note = noteOf(input.note);
  if (!(await isRaised(db, s.kind, s.ref))) {
    throw new HttpError(409, 'not_raised', 'No threat is flagged there.');
  }
  await db
    .insertInto('threat_events')
    .values({
      subject_kind: s.kind,
      subject_ref: s.ref,
      action: 'clear',
      actor_email: input.actor,
      note,
    })
    .execute();
}

/** Every flag whose newest raise-or-clear row is a raise. */
export async function openThreats(db: Kysely<DB>) {
  const rows = await db
    .selectFrom('threat_events as e')
    .select([
      'e.subject_kind',
      'e.subject_ref',
      'e.action',
      'e.note',
      'e.actor_email',
      'e.created_at',
    ])
    .where('e.action', 'in', ['raise', 'clear'])
    .where((eb) =>
      eb(
        'e.id',
        '=',
        eb
          .selectFrom('threat_events as n')
          .select((x) => x.fn.max('n.id').as('m'))
          .whereRef('n.subject_kind', '=', 'e.subject_kind')
          .whereRef('n.subject_ref', '=', 'e.subject_ref')
          .where('n.action', 'in', ['raise', 'clear']),
      ),
    )
    .where('e.action', '=', 'raise')
    .orderBy('e.id', 'desc')
    .execute();
  return rows.map((r) => ({
    subject_kind: r.subject_kind as ThreatSubject,
    subject_ref: r.subject_ref,
    note: r.note ?? '',
    raised_by: r.actor_email,
    raised_at: r.created_at.toISOString(),
  }));
}
