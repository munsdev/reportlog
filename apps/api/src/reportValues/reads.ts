/**
 * Reading held values back. EVERY READ DECRYPTS, so every read has a caller
 * that decided it may: these functions do not ask who is reading. That is the
 * route's job, behind its role guard, and for the desk behind the check, the
 * reporter's `journalist_sharing` permission and an access log row written
 * BEFORE the read (journalists/desk.ts does this for tip links today).
 *
 * Nothing public reads this module. A held value never appears on the board,
 * the report page, an export, a feed, `/api/v1`, the chain file, the anchor
 * archive or the transparency log (gap report D10, D17). What public views
 * may say is that a value WAS removed, and when (X3): `erasuresOf`.
 */
import { sql } from 'kysely';
import type { LinkKeys } from '../links/keys.ts';
import type { Db } from '../links/rows.ts';
import { openRow } from './store.ts';
import type { HeldKind } from './store.ts';

export interface HeldRead {
  /** The row: what a check or a clearance names. */
  id: number;
  reportId: number;
  fieldKey: string;
  kind: HeldKind;
  position: number;
  fingerprint: string;
  /** The link store's group, for a link it has grouped (K11). */
  groupId: number | null;
  value: string;
}

async function readWhere(
  db: Db,
  keys: LinkKeys,
  narrow: { reportIds?: readonly number[]; ids?: readonly number[] },
): Promise<HeldRead[]> {
  if (narrow.reportIds && !narrow.reportIds.length) return [];
  if (narrow.ids && !narrow.ids.length) return [];
  let q = db
    .selectFrom('report_values')
    .select([
      'id',
      'report_id',
      'field_key',
      'kind',
      'position',
      'fingerprint',
      'group_id',
      'value_enc',
      'value_key',
    ]);
  if (narrow.reportIds) q = q.where('report_id', 'in', [...narrow.reportIds]);
  if (narrow.ids) q = q.where('id', 'in', [...narrow.ids]);
  const rows = await q.orderBy('report_id').orderBy('field_key').orderBy('position').execute();
  return rows.map((r) => ({
    id: r.id,
    reportId: r.report_id,
    fieldKey: r.field_key,
    kind: r.kind as HeldKind,
    position: r.position,
    fingerprint: r.fingerprint,
    groupId: r.group_id,
    value: openRow(keys, r.value_enc, r.value_key).value,
  }));
}

/** Every value these report versions still hold. For moderation screens. */
export function readForModerator(
  db: Db,
  keys: LinkKeys,
  reportIds: readonly number[],
): Promise<HeldRead[]> {
  return readWhere(db, keys, { reportIds });
}

/**
 * Exactly these values, by row id, and nothing else. The desk passes only
 * ids it has already found cleared (checked, or checked with redaction, and
 * shared by the reporter) and logged; this function cannot tell.
 */
export function readForDesk(
  db: Db,
  keys: LinkKeys,
  valueIds: readonly number[],
): Promise<HeldRead[]> {
  return readWhere(db, keys, { ids: valueIds });
}

/** A reporter's own values for one version, to correct them from My reports. */
export function readForReporter(db: Db, keys: LinkKeys, reportId: number): Promise<HeldRead[]> {
  return readWhere(db, keys, { reportIds: [reportId] });
}

/** A tombstone, as anybody may see it: that a value went, and when (X3). */
export interface ErasureNotice {
  reportId: number;
  fieldKey: string;
  kind: HeldKind;
  position: number;
  fingerprint: string;
  erasedAt: string;
}

/** The tombstones of these reports. Never what was erased, nor who erased it, nor why. */
export async function erasuresOf(db: Db, reportIds: readonly number[]): Promise<ErasureNotice[]> {
  if (!reportIds.length) return [];
  const rows = await db
    .selectFrom('report_value_erasures')
    .select(['report_id', 'field_key', 'kind', 'position', 'fingerprint', 'created_at'])
    .where('report_id', 'in', [...reportIds])
    .orderBy('id')
    .execute();
  return rows.map((r) => ({
    reportId: r.report_id,
    fieldKey: r.field_key,
    kind: r.kind as HeldKind,
    position: r.position,
    fingerprint: r.fingerprint,
    erasedAt: new Date(r.created_at).toISOString(),
  }));
}

/** How many values each report holds, by kind, without opening any. */
export async function heldCounts(
  db: Db,
  reportIds: readonly number[],
): Promise<Map<number, { text: number; links: number }>> {
  const out = new Map<number, { text: number; links: number }>();
  if (!reportIds.length) return out;
  const rows = await db
    .selectFrom('report_values')
    .select([
      'report_id',
      sql<number>`count(*) FILTER (WHERE kind = 'private_text')::int`.as('text'),
      sql<number>`count(*) FILTER (WHERE kind = 'private_link')::int`.as('links'),
    ])
    .where('report_id', 'in', [...reportIds])
    .groupBy('report_id')
    .execute();
  for (const r of rows) out.set(r.report_id, { text: r.text, links: r.links });
  return out;
}
