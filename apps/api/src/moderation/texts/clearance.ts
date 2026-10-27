/**
 * Which written accounts a vetted journalist may read (W5, D7).
 *
 * A text reaches the desk only if ALL of these hold, read now on every
 * request:
 *   - a moderator wrote a note for journalists (stored as `redacted`);
 *   - for a report, the reporter's `journalist_sharing` is granted, the
 *     report is the newest version of its thread, not withdrawn and not
 *     declined (reportValues/onDesk.ts). Revoking or withdrawing therefore
 *     takes it off at once. A correction that re-sent the words made a new
 *     fingerprint, which has no check, so it is off until checked again;
 *   - the desk shows THAT note. The original is never read: nothing here opens
 *     it, and an old `checked` row (the retired "as written") never matches.
 *
 * `clearedTexts` returns ids and context only: it decrypts nothing, so the
 * desk can write its access log before `readCleared` decrypts anything.
 * Never an email, never an entry id outward, never withheld or unchecked.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../../db/schema.gen.ts';
import type { LinkKeys } from '../../links/keys.ts';
import { openReportValue } from '../../links/keys.ts';
import { sharedHeldValues } from '../../reportValues/onDesk.ts';
import { placeOf } from './items.ts';

type Db = Kysely<DB>;

export interface Cleared {
  itemId: number;
  source: 'report' | 'tip';
  outcome: 'redacted';
  checkedAt: string;
  /** Report: the value row of the newest version. */
  valueId: number | null;
  reportId: number | null;
  threadId: string | null;
  reference: string | null;
  logbookId: number | null;
  entryId: number | null;
  fieldKey: string | null;
  /** The state it rolls up to (US-GA), for "My states". Null when it cannot be derived. */
  state: string | null;
}

/** The same rule as the alert job and the desk's other lists (journalists/desk.ts). */
const stateOf = (answers: ReturnType<typeof sql.ref>, f: ReturnType<typeof sql.ref>) =>
  sql<string | null>`CASE ${f}.settings ->> 'code'
    WHEN 'postal' THEN 'US-' || (${answers} ->> (${f}.key))
    WHEN 'fips' THEN NULL
    ELSE regexp_replace(${answers} ->> (${f}.key), '-[0-9]{5}$', '') END`;

export async function clearedTexts(db: Db): Promise<Cleared[]> {
  const reports = await sharedHeldValues(db)
    .innerJoin('text_items as ti', 'ti.fingerprint', 'rv.fingerprint')
    .select([
      'ti.id as item_id',
      'ti.outcome',
      'ti.checked_at',
      'rv.id as value_id',
      'rv.report_id',
      'h.thread_id',
      'r.public_ref',
      'r.logbook_id',
      sql<string | null>`(SELECT ${stateOf(sql.ref('r.answers'), sql.ref('lf'))}
        FROM logbook_fields lf WHERE lf.logbook_id = r.logbook_id AND lf.kind = 'location'
        ORDER BY lf.position LIMIT 1)`.as('state'),
    ])
    .where('rv.kind', '=', 'private_text')
    .where('ti.outcome', '=', 'redacted')
    // A note that was never saved shows nothing: there is nothing to show.
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('text_redactions as x')
          .select('x.item_id')
          .whereRef('x.item_id', '=', 'ti.id'),
      ),
    )
    .execute();
  const tips = await db
    .selectFrom('text_items as ti')
    .innerJoin('list_entries as e', 'e.id', 'ti.entry_id')
    .select([
      'ti.id as item_id',
      'ti.outcome',
      'ti.checked_at',
      'ti.entry_id',
      'ti.field_key',
      sql<string | null>`(SELECT ${stateOf(sql.ref('e.answers'), sql.ref('lf'))}
        FROM list_fields lf WHERE lf.list_id = e.list_id AND lf.kind = 'location'
        ORDER BY lf.position LIMIT 1)`.as('state'),
    ])
    .where('ti.source', '=', 'tip')
    .where('ti.outcome', '=', 'redacted')
    .where('e.review_state', '<>', 'rejected')
    .where(
      sql<boolean>`e.erasable_answers IS NOT NULL AND jsonb_exists(e.erasable_answers, ti.field_key)`,
    )
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('text_redactions as x')
          .select('x.item_id')
          .whereRef('x.item_id', '=', 'ti.id'),
      ),
    )
    .execute();
  const out: Cleared[] = [
    ...reports.map((r) => ({
      itemId: r.item_id,
      source: 'report' as const,
      outcome: 'redacted' as const,
      checkedAt: new Date(r.checked_at ?? 0).toISOString(),
      valueId: r.value_id,
      reportId: r.report_id,
      threadId: r.thread_id,
      reference: r.public_ref,
      logbookId: r.logbook_id,
      entryId: null,
      fieldKey: null,
      state: r.state,
    })),
    ...tips.map((t) => ({
      itemId: t.item_id,
      source: 'tip' as const,
      outcome: 'redacted' as const,
      checkedAt: new Date(t.checked_at ?? 0).toISOString(),
      valueId: null,
      reportId: null,
      threadId: null,
      reference: null,
      logbookId: null,
      entryId: t.entry_id,
      fieldKey: t.field_key,
      state: t.state,
    })),
  ];
  return out.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt) || b.itemId - a.itemId);
}

export interface DeskTextRead {
  text: string;
  place: string | null;
}

/**
 * Decrypt exactly these cleared items. Callers log first. Only the moderator's
 * note is opened; the reporter's original is never read here.
 */
export async function readCleared(
  db: Db,
  keys: LinkKeys,
  items: readonly Cleared[],
): Promise<Map<number, DeskTextRead>> {
  const out = new Map<number, DeskTextRead>();
  if (!items.length) return out;

  const copies = await db
    .selectFrom('text_redactions')
    .select(['item_id', 'body_enc', 'body_key'])
    .where(
      'item_id',
      'in',
      items.map((i) => i.itemId),
    )
    .execute();

  const reportIds = items.flatMap((i) => (i.reportId === null ? [] : [i.reportId]));
  const reports = reportIds.length
    ? await db
        .selectFrom('reports')
        .select(['id', 'logbook_id', 'answers'])
        .where('id', 'in', reportIds)
        .execute()
    : [];
  const logbookIds = [...new Set(reports.map((r) => r.logbook_id))];
  const lbFields = logbookIds.length
    ? await db
        .selectFrom('logbook_fields')
        .select(['logbook_id', 'key', 'settings'])
        .where('logbook_id', 'in', logbookIds)
        .where('kind', '=', 'location')
        .orderBy('position')
        .execute()
    : [];
  const entryIds = items.flatMap((i) => (i.entryId === null ? [] : [i.entryId]));
  const entries = entryIds.length
    ? await db
        .selectFrom('list_entries')
        .select(['id', 'list_id', 'answers', 'erasable_answers'])
        .where('id', 'in', entryIds)
        .execute()
    : [];
  const listFields = entries.length
    ? await db
        .selectFrom('list_fields')
        .select(['list_id', 'key', 'settings'])
        .where('list_id', 'in', [...new Set(entries.map((e) => e.list_id))])
        .where('kind', '=', 'location')
        .orderBy('position')
        .execute()
    : [];

  for (const i of items) {
    const c = copies.find((x) => x.item_id === i.itemId);
    const text = c ? openReportValue(keys, c.body_enc, c.body_key) : null;
    if (text === null) continue;
    let place: string | null = null;
    if (i.reportId !== null) {
      const r = reports.find((x) => x.id === i.reportId);
      if (r) {
        place = placeOf(
          lbFields.filter((f) => f.logbook_id === r.logbook_id),
          (r.answers ?? {}) as Record<string, unknown>,
        );
      }
    } else if (i.entryId !== null) {
      const e = entries.find((x) => x.id === i.entryId);
      if (e) {
        place = placeOf(
          listFields.filter((f) => f.list_id === e.list_id),
          (e.answers ?? {}) as Record<string, unknown>,
        );
      }
    }
    out.set(i.itemId, { text, place });
  }
  return out;
}
