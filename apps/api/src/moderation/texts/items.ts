/**
 * Checking written accounts (W4, D2, D7).
 *
 * WHAT IS CHECKED. Words, not rows. A report's text is named by its sealed
 * fingerprint (`report_values.fingerprint`), so a version that only adds
 * files keeps its check and a correction that re-sends the words makes a new
 * fingerprint and starts unchecked: the old clearance drops by itself. A tip's
 * long-text answer is named by entry and question.
 *
 * THE FOUR OUTCOMES. checked (journalists read it as written), redacted
 * (they read a separate copy, never the original), withheld (nobody outside
 * moderation reads it), illegal (the words are erased now). Without the
 * reporter's `journalist_sharing` a report's text can only be withheld or
 * illegal, and withdrawing or revoking takes it off the desk at once because
 * the desk reads that permission live (reportValues/onDesk.ts), not a copy of
 * it stored here.
 *
 * THE ORIGINAL NEVER CHANGES. Only erasing deletes it, through the same path
 * as every held value (reportValues/erase.ts), which writes the tombstone and
 * takes the redacted copy with it. A tip's words are erased by removing the
 * answer from the entry; its record is the history here.
 *
 * Nothing here reaches the seal or the chain.
 */
import { describeAnswer } from '@reportlog/fields';
import type { FieldSettings } from '@reportlog/fields';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../../db/schema.gen.ts';
import { HttpError, notFound } from '../../http/errors.ts';
import type { LinkKeys } from '../../links/keys.ts';
import { openReportValue, sealReportValue } from '../../links/keys.ts';
import { sharingGrantedAmong } from '../../permissions/log.ts';
import { eraseHeldValue } from '../../reportValues/erase.ts';
import { openRow } from '../../reportValues/store.ts';
import { parseRef, refOf } from './ref.ts';
import type { TextRef } from './ref.ts';

type Db = Kysely<DB>;

export const OUTCOMES = ['checked', 'redacted', 'withheld', 'illegal'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const MAX_REDACTED = 6000;
export const MIN_WHY = 10;
export const MAX_WHY = 500;

/** Why words are erased: a category, never a description (it would be a copy). */
export const TEXT_ERASE_REASONS = [
  'child-sexual-abuse',
  'terrorist-content',
  'non-consensual-intimate-imagery',
  'incitement-or-threats',
  'other-illegal',
  'personal-data',
] as const;
export type EraseReason = (typeof TEXT_ERASE_REASONS)[number];
export const isEraseReason = (v: unknown): v is EraseReason =>
  typeof v === 'string' && (TEXT_ERASE_REASONS as readonly string[]).includes(v);

const refuse = (status: number, code: string, message: string) =>
  new HttpError(status, code, message);

/**
 * The reason every decision about a written account carries. INTERNAL: it is
 * kept with who and when in text_checks, shown to staff in the account's
 * history, and selected by no reporter or journalist route.
 */
export function whyOf(raw: unknown): string {
  const why = typeof raw === 'string' ? raw.trim() : '';
  if (why.length < MIN_WHY || why.length > MAX_WHY) {
    throw refuse(
      400,
      'why_needed',
      `Say why, in ${String(MIN_WHY)} to ${String(MAX_WHY)} characters. It stays on the record for staff. Describe the kind of thing, not the words.`,
    );
  }
  return why;
}

export const NOT_SHARED = refuse(
  409,
  'not_shared',
  'The reporter has not allowed journalists to read this, so it can only be withheld or marked illegal.',
);

// ── the candidates ────────────────────────────────────────────────────────

/** Every written account that exists now: one row per piece of text. */
const CANDIDATES = sql`
  SELECT 'report'::text AS source, rv.id AS subject_id, NULL::text AS field_key,
         rv.fingerprint AS fingerprint, r.received_at AS at
    FROM report_values rv
    JOIN report_heads h ON h.current_report_id = rv.report_id
    JOIN reports r ON r.id = rv.report_id
   WHERE rv.kind = 'private_text' AND h.withdrawn = false
  UNION ALL
  SELECT 'tip', e.id, f.key, NULL, e.created_at
    FROM list_entries e
    JOIN list_fields f ON f.list_id = e.list_id AND f.kind = 'long_text'
   WHERE e.erasable_answers IS NOT NULL AND jsonb_exists(e.erasable_answers, f.key)
     AND e.review_state <> 'rejected'
     AND EXISTS (SELECT 1 FROM list_fields u WHERE u.list_id = e.list_id AND u.kind = 'url')`;

interface Candidate {
  source: 'report' | 'tip';
  subject_id: number;
  field_key: string | null;
  fingerprint: string | null;
  at: Date;
  item_id: number | null;
  outcome: Outcome | null;
  checked_at: Date | null;
  checked_by: string | null;
}

const WITH_ITEM = sql`
  SELECT c.*, ti.id AS item_id, ti.outcome, ti.checked_at, ti.checked_by
    FROM (${CANDIDATES}) c
    LEFT JOIN text_items ti
      ON (c.source = 'report' AND ti.fingerprint = c.fingerprint)
      OR (c.source = 'tip' AND ti.entry_id = c.subject_id AND ti.field_key = c.field_key)`;

export type Filter = 'waiting' | 'checked' | 'redacted' | 'withheld';

export async function countsOf(db: Db) {
  const r = await sql<{ outcome: string | null; n: string }>`
    SELECT outcome, count(*) AS n FROM (${WITH_ITEM}) x GROUP BY outcome`.execute(db);
  const out = { waiting: 0, checked: 0, redacted: 0, withheld: 0 };
  for (const row of r.rows) {
    const n = Number(row.n);
    if (row.outcome === null) out.waiting += n;
    else if (row.outcome === 'checked' || row.outcome === 'redacted' || row.outcome === 'withheld')
      out[row.outcome] += n;
  }
  return out;
}

/** Waiting text for the menu's number. */
export async function waitingCount(db: Db): Promise<number> {
  return (await countsOf(db)).waiting;
}

export interface Page {
  items: TextView[];
  total: number;
}

export interface RedactionView {
  redacted_by: string;
  redacted_at: string;
  reason: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_verdict: 'approved' | 'returned' | null;
}

export interface TextView {
  ref: string;
  source: 'report' | 'tip';
  text: string | null;
  length: number;
  outcome: Outcome | null;
  checked_at: string | null;
  checked_by: string | null;
  shared: boolean;
  reference: string | null;
  thread_id: string | null;
  place: string | null;
  form_title: string;
  answers_public: boolean;
  received_at: string;
  redaction: RedactionView | null;
}

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

export async function listPage(
  db: Db,
  keys: LinkKeys,
  filter: Filter,
  { limit, offset }: { limit: number; offset: number },
): Promise<Page> {
  const where = filter === 'waiting' ? sql`outcome IS NULL` : sql`outcome = ${filter}`;
  const total = await sql<{ n: string }>`
    SELECT count(*) AS n FROM (${WITH_ITEM}) x WHERE ${where}`.execute(db);
  const rows = await sql<Candidate>`
    SELECT * FROM (${WITH_ITEM}) x WHERE ${where}
     ORDER BY at DESC, subject_id DESC LIMIT ${limit} OFFSET ${offset}`.execute(db);
  return {
    items: await present(db, keys, rows.rows),
    total: Number(total.rows[0]?.n ?? 0),
  };
}

/** Candidates as the screens show them. The words are NOT included (`text` is null): see openText. */
export async function present(
  db: Db,
  keys: LinkKeys,
  rows: readonly Candidate[],
): Promise<TextView[]> {
  if (!rows.length) return [];
  const reportRows = rows.filter((r) => r.source === 'report');
  const tipRows = rows.filter((r) => r.source === 'tip');

  const values = reportRows.length
    ? await db
        .selectFrom('report_values as rv')
        .innerJoin('reports as r', 'r.id', 'rv.report_id')
        .innerJoin('logbooks as lb', 'lb.id', 'r.logbook_id')
        .select([
          'rv.id',
          'rv.value_enc',
          'rv.value_key',
          'r.thread_id',
          'r.public_ref',
          'r.may_publish',
          'r.answers',
          'r.logbook_id',
          'r.received_at',
          'lb.title',
        ])
        .where(
          'rv.id',
          'in',
          reportRows.map((r) => r.subject_id),
        )
        .execute()
    : [];
  const shared = await sharingGrantedAmong(
    db,
    values.map((v) => v.thread_id),
  );
  const logbookIds = [...new Set(values.map((v) => v.logbook_id))];
  const locationFields = logbookIds.length
    ? await db
        .selectFrom('logbook_fields')
        .select(['logbook_id', 'key', 'settings'])
        .where('logbook_id', 'in', logbookIds)
        .where('kind', '=', 'location')
        .orderBy('position')
        .execute()
    : [];

  const entries = tipRows.length
    ? await db
        .selectFrom('list_entries as e')
        .innerJoin('lists as l', 'l.id', 'e.list_id')
        .select(['e.id', 'e.list_id', 'e.answers', 'e.erasable_answers', 'e.created_at', 'l.title'])
        .where(
          'e.id',
          'in',
          tipRows.map((r) => r.subject_id),
        )
        .execute()
    : [];
  const tipLocation = entries.length
    ? await db
        .selectFrom('list_fields')
        .select(['list_id', 'key', 'settings'])
        .where('list_id', 'in', [...new Set(entries.map((e) => e.list_id))])
        .where('kind', '=', 'location')
        .orderBy('position')
        .execute()
    : [];

  const itemIds = rows.flatMap((r) => (r.item_id === null ? [] : [r.item_id]));
  const redactions = itemIds.length
    ? await db.selectFrom('text_redactions').selectAll().where('item_id', 'in', itemIds).execute()
    : [];

  return rows.flatMap((c): TextView[] => {
    const redaction = redactions.find((x) => x.item_id === c.item_id);
    const red: RedactionView | null = redaction
      ? {
          redacted_by: redaction.redacted_by,
          redacted_at: iso(redaction.redacted_at) ?? '',
          reason: redaction.reason,
          reviewed_by: redaction.reviewed_by,
          reviewed_at: iso(redaction.reviewed_at),
          review_verdict: redaction.review_verdict as 'approved' | 'returned' | null,
        }
      : null;
    const common = {
      outcome: c.outcome,
      checked_at: iso(c.checked_at),
      checked_by: c.checked_by,
      redaction: red,
    };
    if (c.source === 'report') {
      const v = values.find((x) => x.id === c.subject_id);
      if (!v) return [];
      // The length is counted here; the words leave only through openText,
      // which logs the opening first.
      const length = openRow(keys, v.value_enc, v.value_key).value.length;
      return [
        {
          ...common,
          ref: refOf({ source: 'report', valueId: v.id }),
          source: 'report',
          text: null,
          length,
          shared: shared.has(v.thread_id),
          reference: v.public_ref,
          thread_id: v.thread_id,
          place: placeOf(
            locationFields.filter((f) => f.logbook_id === v.logbook_id),
            (v.answers ?? {}) as Record<string, unknown>,
          ),
          form_title: v.title,
          answers_public: v.may_publish,
          received_at: iso(v.received_at) ?? '',
        },
      ];
    }
    const e = entries.find((x) => x.id === c.subject_id);
    if (!e || c.field_key === null) return [];
    const text = tipText(e.erasable_answers, c.field_key);
    if (text === null) return [];
    return [
      {
        ...common,
        ref: refOf({ source: 'tip', entryId: e.id, fieldKey: c.field_key }),
        source: 'tip',
        text: null,
        length: text.length,
        shared: true,
        reference: null,
        thread_id: null,
        place: placeOf(
          tipLocation.filter((f) => f.list_id === e.list_id),
          (e.answers ?? {}) as Record<string, unknown>,
        ),
        form_title: e.title,
        answers_public: false,
        received_at: iso(e.created_at) ?? '',
      },
    ];
  });
}

/** "Fulton County, Georgia": the first location answer a form asked, in words. */
export function placeOf(
  fields: readonly { key: string; settings: unknown }[],
  answers: Record<string, unknown>,
): string | null {
  for (const f of fields) {
    const v = answers[f.key];
    if (typeof v === 'string' && v) {
      const d = describeAnswer({ kind: 'location', settings: f.settings as FieldSettings }, v);
      if (d) return d;
    }
  }
  return null;
}

export function tipText(erasable: unknown, key: string): string | null {
  if (typeof erasable !== 'object' || erasable === null) return null;
  const v = (erasable as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : null;
}

// ── resolving a ref ───────────────────────────────────────────────────────

interface Subject {
  ref: TextRef;
  /** A report's sealed fingerprint; null for a tip. */
  fingerprint: string | null;
  threadId: string | null;
  text: string;
  valueId: number | null;
}

export async function resolve(db: Db, keys: LinkKeys, raw: string): Promise<Subject> {
  const ref = parseRef(raw);
  if (!ref) throw notFound('There is no such written account.');
  if (ref.source === 'report') {
    const v = await db
      .selectFrom('report_values as rv')
      .innerJoin('reports as r', 'r.id', 'rv.report_id')
      .select(['rv.id', 'rv.fingerprint', 'rv.value_enc', 'rv.value_key', 'r.thread_id'])
      .where('rv.id', '=', ref.valueId)
      .where('rv.kind', '=', 'private_text')
      .executeTakeFirst();
    if (!v) throw notFound('There is no such written account. It may have been erased.');
    return {
      ref,
      fingerprint: v.fingerprint,
      threadId: v.thread_id,
      text: openRow(keys, v.value_enc, v.value_key).value,
      valueId: v.id,
    };
  }
  const e = await db
    .selectFrom('list_entries')
    .select(['erasable_answers'])
    .where('id', '=', ref.entryId)
    .executeTakeFirst();
  const text = e ? tipText(e.erasable_answers, ref.fieldKey) : null;
  if (text === null) throw notFound('There is no such written account. It may have been erased.');
  return { ref, fingerprint: null, threadId: null, text, valueId: null };
}

async function ensureItem(trx: Kysely<DB>, s: Subject) {
  const find = () => {
    const q = trx.selectFrom('text_items').selectAll().forUpdate();
    return s.ref.source === 'report' && s.fingerprint
      ? q.where('fingerprint', '=', s.fingerprint)
      : q
          .where('entry_id', '=', s.ref.source === 'tip' ? s.ref.entryId : -1)
          .where('field_key', '=', s.ref.source === 'tip' ? s.ref.fieldKey : '');
  };
  const had = await find().executeTakeFirst();
  if (had) return had;
  await trx
    .insertInto('text_items')
    .values(
      s.ref.source === 'report'
        ? { source: 'report', fingerprint: s.fingerprint }
        : { source: 'tip', entry_id: s.ref.entryId, field_key: s.ref.fieldKey },
    )
    .onConflict((oc) => oc.doNothing())
    .execute();
  return find().executeTakeFirstOrThrow();
}

async function sharingOf(db: Kysely<DB>, s: Subject): Promise<boolean> {
  if (s.threadId === null) return true;
  return (await sharingGrantedAmong(db, [s.threadId])).has(s.threadId);
}

// ── the check ─────────────────────────────────────────────────────────────

export async function checkText(
  db: Db,
  keys: LinkKeys,
  rawRef: string,
  input: { outcome: unknown; reason: unknown; why: unknown; actor: string },
): Promise<{ outcome: Outcome; erased: boolean }> {
  const outcome = input.outcome;
  if (outcome !== 'checked' && outcome !== 'withheld' && outcome !== 'illegal') {
    throw refuse(
      400,
      'not_an_outcome',
      'A written account is checked, withheld or illegal. To check it with redaction, save a redacted copy.',
    );
  }
  if (outcome === 'illegal' && !isEraseReason(input.reason)) {
    throw refuse(400, 'reason_needed', 'Pick why it is illegal. It is recorded with the erasure.');
  }
  const why = whyOf(input.why);
  const subject = await resolve(db, keys, rawRef);
  return db.transaction().execute(async (trx) => {
    const item = await ensureItem(trx, subject);
    if (item.outcome === 'illegal') {
      throw refuse(
        409,
        'already_erased',
        'This was found illegal and erased. Nothing is left to check.',
      );
    }
    // Checked means "a journalist may read it": only if the reporter allows it.
    if (outcome === 'checked' && !(await sharingOf(trx, subject))) throw NOT_SHARED;
    await trx
      .insertInto('text_checks')
      .values({
        item_id: item.id,
        outcome,
        reason_category: outcome === 'illegal' ? (input.reason as string) : null,
        reason: why,
        actor_email: input.actor,
      })
      .execute();
    // Any move off "redacted" retires the journalists' copy: it was made from
    // words that are now read differently.
    await trx.deleteFrom('text_redactions').where('item_id', '=', item.id).execute();
    if (outcome === 'illegal') {
      const reason = input.reason as EraseReason;
      if (subject.valueId !== null) {
        await eraseHeldValue(trx, subject.valueId, { reason, actor: input.actor });
      } else if (subject.ref.source === 'tip') {
        await trx
          .updateTable('list_entries')
          .set({
            erasable_answers: sql`NULLIF(erasable_answers - ${subject.ref.fieldKey}::text, '{}'::jsonb)`,
          })
          .where('id', '=', subject.ref.entryId)
          .execute();
      }
    }
    await trx
      .updateTable('text_items')
      .set({ outcome, checked_at: new Date(), checked_by: input.actor })
      .where('id', '=', item.id)
      .execute();
    return { outcome, erased: outcome === 'illegal' };
  });
}

// ── the redacted copy ─────────────────────────────────────────────────────

/** The marks the copy must carry: a [bracketed] piece the original does not have. */
export function carriesNewMarker(original: string, copy: string): boolean {
  const marks = copy.match(/\[[^[\]\n]{1,80}\]/g) ?? [];
  return marks.some((m) => !original.includes(m));
}

export async function redactText(
  db: Db,
  keys: LinkKeys,
  rawRef: string,
  input: { body: unknown; why: unknown; actor: string },
): Promise<{ outcome: 'redacted' }> {
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body) throw refuse(400, 'copy_needed', 'Write the copy journalists will read.');
  if (body.length > MAX_REDACTED) {
    throw refuse(400, 'copy_too_long', `Keep the copy under ${String(MAX_REDACTED)} characters.`);
  }
  const why = whyOf(input.why);
  const subject = await resolve(db, keys, rawRef);
  if (body === subject.text.trim() || !carriesNewMarker(subject.text, body)) {
    throw refuse(
      400,
      'redaction_unmarked',
      'Mark what you removed in square brackets, for example [name removed], so a reader can tell it was edited.',
    );
  }
  return db.transaction().execute(async (trx) => {
    const item = await ensureItem(trx, subject);
    if (item.outcome === 'illegal') {
      throw refuse(
        409,
        'already_erased',
        'This was found illegal and erased. Nothing is left to redact.',
      );
    }
    if (!(await sharingOf(trx, subject))) throw NOT_SHARED;
    const sealed = sealReportValue(keys, body);
    await trx.deleteFrom('text_redactions').where('item_id', '=', item.id).execute();
    await trx
      .insertInto('text_redactions')
      .values({
        item_id: item.id,
        body_enc: sealed.enc,
        body_key: sealed.key,
        reason: why,
        redacted_by: input.actor,
      })
      .execute();
    await trx
      .insertInto('text_checks')
      .values({ item_id: item.id, outcome: 'redacted', reason: why, actor_email: input.actor })
      .execute();
    await trx
      .updateTable('text_items')
      .set({ outcome: 'redacted', checked_at: new Date(), checked_by: input.actor })
      .where('id', '=', item.id)
      .execute();
    return { outcome: 'redacted' as const };
  });
}

export async function reviewRedaction(
  db: Db,
  keys: LinkKeys,
  rawRef: string,
  input: { verdict: unknown; actor: string; isOwner: boolean },
): Promise<{ verdict: 'approved' | 'returned' }> {
  const verdict = input.verdict;
  if (verdict !== 'approved' && verdict !== 'returned') {
    throw refuse(400, 'not_a_verdict', 'A review approves the copy or returns it.');
  }
  const subject = await resolve(db, keys, rawRef);
  return db.transaction().execute(async (trx) => {
    const item = await ensureItem(trx, subject);
    const copy = await trx
      .selectFrom('text_redactions')
      .selectAll()
      .where('item_id', '=', item.id)
      .forUpdate()
      .executeTakeFirst();
    if (!copy) throw refuse(409, 'no_copy', 'There is no redacted copy to review.');
    // Another pair of eyes: the person who made the copy does not review it.
    // The owner may review any copy.
    if (copy.redacted_by === input.actor && !input.isOwner) {
      throw refuse(
        403,
        'own_copy',
        'Another moderator, or the owner, reviews a redacted copy. You made this one.',
      );
    }
    await trx
      .insertInto('text_checks')
      .values({
        item_id: item.id,
        outcome: verdict === 'approved' ? 'review_approved' : 'review_returned',
        actor_email: input.actor,
      })
      .execute();
    if (verdict === 'approved') {
      await trx
        .updateTable('text_redactions')
        .set({ reviewed_by: input.actor, reviewed_at: new Date(), review_verdict: 'approved' })
        .where('item_id', '=', item.id)
        .execute();
    } else {
      // Returned: the copy is deleted, not kept as a draft, and the account waits again.
      await trx.deleteFrom('text_redactions').where('item_id', '=', item.id).execute();
      await trx
        .updateTable('text_items')
        .set({ outcome: null, checked_at: null, checked_by: null })
        .where('id', '=', item.id)
        .execute();
    }
    return { verdict };
  });
}

// ── one item, with its copy and history ──────────────────────────────────

export async function detail(db: Db, keys: LinkKeys, rawRef: string) {
  const subject = await resolve(db, keys, rawRef);
  const itemRow = await (
    subject.ref.source === 'report' && subject.fingerprint
      ? db.selectFrom('text_items').selectAll().where('fingerprint', '=', subject.fingerprint)
      : db
          .selectFrom('text_items')
          .selectAll()
          .where('entry_id', '=', subject.ref.source === 'tip' ? subject.ref.entryId : -1)
          .where('field_key', '=', subject.ref.source === 'tip' ? subject.ref.fieldKey : '')
  ).executeTakeFirst();
  const cand: Candidate = {
    source: subject.ref.source,
    subject_id: subject.ref.source === 'report' ? subject.ref.valueId : subject.ref.entryId,
    field_key: subject.ref.source === 'tip' ? subject.ref.fieldKey : null,
    fingerprint: subject.fingerprint,
    at: new Date(),
    item_id: itemRow?.id ?? null,
    outcome: (itemRow?.outcome as Outcome | null | undefined) ?? null,
    checked_at: itemRow?.checked_at ?? null,
    checked_by: itemRow?.checked_by ?? null,
  };
  const [item] = await present(db, keys, [cand]);
  if (!item) throw notFound('There is no such written account.');
  const copy = itemRow
    ? await db
        .selectFrom('text_redactions')
        .select(['body_enc', 'body_key'])
        .where('item_id', '=', itemRow.id)
        .executeTakeFirst()
    : undefined;
  const history = itemRow
    ? await db
        .selectFrom('text_checks')
        .select(['outcome', 'reason_category', 'reason', 'actor_email', 'created_at'])
        .where('item_id', '=', itemRow.id)
        .orderBy('id')
        .execute()
    : [];
  return {
    item,
    redacted: copy ? openReportValue(keys, copy.body_enc, copy.body_key) : null,
    history: history.map((h) => ({
      at: new Date(h.created_at).toISOString(),
      by: h.actor_email,
      kind: h.outcome as Outcome | 'review_approved' | 'review_returned',
      reason_category: h.reason_category,
      // Internal: this route is for staff only (moderator scope).
      reason: h.reason,
    })),
  };
}

// ── opening the words ────────────────────────────────────────────────────

/**
 * Staff press "Show the written account" (or the link). THE ENTRY IS WRITTEN
 * FIRST and the words are decrypted second, so a look that was not logged
 * cannot happen; each press is one entry, and several moderators opening
 * one item are several entries. No typed reason is asked for.
 *
 * `link-<report_values.id>` names a link a report holds (its panel); the other
 * refs are the ones the queue uses.
 */
export async function openText(
  db: Db,
  keys: LinkKeys,
  rawRef: string,
  actor: string,
): Promise<{ text: string }> {
  const link = /^link-(\d{1,15})$/.exec(rawRef);
  const ref = link ? null : parseRef(rawRef);
  if (!link && !ref) throw notFound('There is no such written account.');

  let valueId: number | null = null;
  if (link?.[1]) valueId = Number(link[1]);
  else if (ref?.source === 'report') valueId = ref.valueId;

  let threadId: string | null = null;
  let reportId: number | null = null;
  if (valueId !== null) {
    // Ids only: nothing is decrypted to find where it belongs.
    const v = await db
      .selectFrom('report_values as rv')
      .innerJoin('reports as r', 'r.id', 'rv.report_id')
      .select(['rv.report_id', 'r.thread_id'])
      .where('rv.id', '=', valueId)
      .where('rv.kind', '=', link ? 'private_link' : 'private_text')
      .executeTakeFirst();
    if (!v) throw notFound('There is no such written account. It may have been erased.');
    threadId = v.thread_id;
    reportId = v.report_id;
  }
  await db
    .insertInto('contact_access_log')
    .values({
      staff_email: actor,
      kind: 'text_read',
      read_ref: rawRef,
      thread_id: threadId,
      report_id: reportId,
    })
    .execute();

  if (link && valueId !== null) {
    const row = await db
      .selectFrom('report_values')
      .select(['value_enc', 'value_key'])
      .where('id', '=', valueId)
      .executeTakeFirst();
    if (!row) throw notFound('There is no such link. It may have been erased.');
    return { text: openRow(keys, row.value_enc, row.value_key).value };
  }
  return { text: (await resolve(db, keys, rawRef)).text };
}
