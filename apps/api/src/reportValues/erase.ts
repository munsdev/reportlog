/**
 * Erasing a held value, and the tombstone that says it was (K8, X2, X3).
 *
 * ERASING IS DELETING THE ROW: the ciphertext, the nonce inside it and the
 * value's own key go together, so no copy of the database or of a backup can
 * open it again once the link secret it hangs from has moved on. The report
 * is never touched. Its fingerprint stays, which is why it still verifies.
 *
 * THE TOMBSTONE IS APPEND-ONLY (a database trigger refuses UPDATE and DELETE)
 * and records which report, which value (question, position and the sealed
 * fingerprint), when, who and a reason CATEGORY. Never the value, and never a
 * description of it: a written description of illegal material is a copy.
 *
 * ONE VALUE, EVERY COPY OF IT. A version that only adds files carries the
 * value unchanged, so the same fingerprint can sit on several versions of a
 * thread; erasing it erases every copy and writes one tombstone per version.
 * A correction that re-sent the words made a new value with a new nonce and
 * a new fingerprint: that one is NOT erased with it, as the brief asks.
 */
import { REASON_CATEGORIES } from '../links/blocklist.ts';
import { dropEmptyGroups } from '../links/store.ts';
import type { Db } from '../links/rows.ts';

/**
 * Why a held value was erased. The illegal-content categories of the link
 * store, so one moderator vocabulary covers both, and two that are not about
 * illegality at all.
 */
export const ERASURE_REASONS = [
  ...REASON_CATEGORIES,
  // It names or identifies a private person, the reporter included.
  'personal-data',
  // The reporter asked, from My reports.
  'reporter-request',
  // The link store's blocklist matched it as the report was filed, so it was
  // never kept (links/reportLinks.ts).
  'blocklisted',
] as const;
export type ErasureReason = (typeof ERASURE_REASONS)[number];

export const isErasureReason = (v: unknown): v is ErasureReason =>
  typeof v === 'string' && (ERASURE_REASONS as readonly string[]).includes(v);

export interface EraseInput {
  reason: ErasureReason;
  /** A staff member's address, `reporter`, or `system` for a named sweep. */
  actor: string;
}

/**
 * Erase one value, by its row, and every carried copy of it. Returns how
 * many rows went: 0 when it was already erased (no second tombstone).
 */
export async function eraseHeldValue(trx: Db, valueId: number, input: EraseInput): Promise<number> {
  const row = await trx
    .selectFrom('report_values')
    .select('fingerprint')
    .where('id', '=', valueId)
    .executeTakeFirst();
  if (!row) return 0;
  return eraseWhere(trx, { fingerprint: row.fingerprint }, input);
}

/**
 * Erase every copy of a link group's address that reports hold (W3, X3): the
 * report half of an "illegal" link check. One tombstone per version that held
 * it. Returns how many rows went.
 */
export async function eraseHeldGroup(
  trx: Db,
  groupId: number,
  input: EraseInput,
): Promise<number> {
  return eraseWhere(trx, { groupId }, input);
}

/** Erase everything these versions hold: a reporter erasing their own words. */
export async function eraseHeldValuesOf(
  trx: Db,
  reportIds: readonly number[],
  input: EraseInput,
): Promise<number> {
  if (!reportIds.length) return 0;
  const prints = await trx
    .selectFrom('report_values')
    .select('fingerprint')
    .distinct()
    .where('report_id', 'in', [...reportIds])
    .execute();
  let n = 0;
  for (const p of prints) n += await eraseWhere(trx, { fingerprint: p.fingerprint }, input);
  return n;
}

async function eraseWhere(
  trx: Db,
  where: { fingerprint: string } | { groupId: number },
  input: EraseInput,
): Promise<number> {
  if (!(ERASURE_REASONS as readonly string[]).includes(input.reason)) {
    throw new Error(`Not an erasure reason: ${input.reason}`);
  }
  if (!input.actor.trim()) throw new Error('An erasure needs somebody to have done it.');
  const del = trx.deleteFrom('report_values');
  const gone = await ('fingerprint' in where
    ? del.where('fingerprint', '=', where.fingerprint)
    : del.where('group_id', '=', where.groupId)
  )
    .returning(['report_id', 'field_key', 'kind', 'position', 'fingerprint', 'group_id'])
    .execute();
  if (!gone.length) return 0;
  // A redacted copy was made from the words that just went (W4): it goes with
  // them. Written here, not through moderation/, because the chain reaches
  // this file and may not reach moderation.
  const prints = [...new Set(gone.map((g) => g.fingerprint))];
  await trx
    .deleteFrom('text_redactions')
    .where('item_id', 'in', (eb) =>
      eb.selectFrom('text_items').select('id').where('fingerprint', 'in', prints),
    )
    .execute();
  const groups = [...new Set(gone.flatMap((g) => (g.group_id === null ? [] : [g.group_id])))];
  // An erased GROUP is the caller's to settle (checkGroup marks it illegal).
  if (groups.length && 'fingerprint' in where) await dropEmptyGroups(trx, groups);
  await trx
    .insertInto('report_value_erasures')
    .values(
      gone.map((g) => ({
        report_id: g.report_id,
        field_key: g.field_key,
        kind: g.kind,
        position: g.position,
        fingerprint: g.fingerprint,
        reason_category: input.reason,
        actor: input.actor,
      })),
    )
    .execute();
  return gone.length;
}
