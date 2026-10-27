/**
 * THE ERASABLE STORE: a report's held text and links (W1).
 *
 * A `private_text` or `private_link` answer is kept here, never in the
 * report row, under a key of its own (K9). The report seals only its
 * fingerprint (packages/seal/src/held.ts), so the value can be erased and the
 * report still verify. Each row's ciphertext is the JSON `{nonce, value}`:
 * the nonce the fingerprint was made with goes with the value, and with it
 * when it is erased, so nothing left behind can test a guessed value.
 *
 * WHO CALLS WHAT
 *   storeHeldRows      appendReportVersion, inside the transaction that seals
 *   carryHeldRows      appendReportVersion, for a version that only adds files
 *   stageHeld / takeStagedHeld
 *                      filing, while a report waits for its confirmation link
 *   reads.ts           moderators, the desk, the reporter
 *   erase.ts           erasure, with its tombstone
 *
 * NOTHING HERE REACHES THE SEAL OR THE CHAIN, so the moderation screens and
 * the journalist desk can read through it without being able to write a
 * report (.dependency-cruiser.cjs). The fingerprints are made in
 * chain/held.ts and handed in.
 */
import type { HeldValues } from '@reportlog/fields';
import { openReportValue, sealReportValue } from '../links/keys.ts';
import type { LinkKeys } from '../links/keys.ts';
import type { Db } from '../links/rows.ts';

export type HeldKind = 'private_text' | 'private_link';

/** One held value about to be stored with the report that seals it. */
export interface HeldRow {
  fieldKey: string;
  kind: HeldKind;
  /** Which link of the question, from 0, in the order sent. 0 for text. */
  position: number;
  /** 64 lowercase hex, made for this value alone (chain/held.ts). */
  nonce: string;
  value: string;
  /** heldFingerprint(nonce, value), as the report seals it. */
  fingerprint: string;
}

/** What is stored of a value, without the value: enough to rebuild its fingerprint key. */
export interface HeldSlot {
  fieldKey: string;
  kind: HeldKind;
  position: number;
  fingerprint: string;
}

const isKind = (k: string): k is HeldKind => k === 'private_text' || k === 'private_link';

/** The plain text inside a row's ciphertext. */
export interface Opened {
  nonce: string;
  value: string;
}

export function openRow(keys: LinkKeys, enc: Buffer, key: Buffer): Opened {
  const parsed: unknown = JSON.parse(openReportValue(keys, enc, key));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).nonce !== 'string' ||
    typeof (parsed as Record<string, unknown>).value !== 'string'
  ) {
    throw new Error('A held report value did not open to a nonce and a value.');
  }
  const p = parsed as { nonce: string; value: string };
  return { nonce: p.nonce, value: p.value };
}

/** Store a version's held values. Inside the transaction that sealed them. */
export async function storeHeldRows(
  trx: Db,
  keys: LinkKeys,
  reportId: number,
  rows: readonly HeldRow[],
): Promise<void> {
  if (!rows.length) return;
  await trx
    .insertInto('report_values')
    .values(
      rows.map((r) => {
        const sealed = sealReportValue(keys, JSON.stringify({ nonce: r.nonce, value: r.value }));
        return {
          report_id: reportId,
          field_key: r.fieldKey,
          kind: r.kind,
          position: r.position,
          fingerprint: r.fingerprint,
          value_enc: sealed.enc,
          value_key: sealed.key,
        };
      }),
    )
    .execute();
}

/** The values a version still holds: not erased. In question, then position, order. */
export async function heldSlotsOf(db: Db, reportId: number): Promise<HeldSlot[]> {
  const rows = await db
    .selectFrom('report_values')
    .select(['field_key', 'kind', 'position', 'fingerprint'])
    .where('report_id', '=', reportId)
    .orderBy('field_key')
    .orderBy('position')
    .execute();
  return rows.flatMap((r) =>
    isKind(r.kind)
      ? [{ fieldKey: r.field_key, kind: r.kind, position: r.position, fingerprint: r.fingerprint }]
      : [],
  );
}

/**
 * Carry a version's held values onto the next one, unchanged: the same
 * ciphertext under the same key, so the same nonce and the same
 * fingerprint. For a version that changes no words (evidence added on
 * request). A value already erased from the earlier version is not carried:
 * the row is gone, and the new version seals only what it still holds.
 * Returns what was carried, for the seal.
 */
export async function carryHeldRows(
  trx: Db,
  fromReportId: number,
  toReportId: number,
): Promise<HeldSlot[]> {
  const rows = await trx
    .selectFrom('report_values')
    .select(['field_key', 'kind', 'position', 'group_id', 'fingerprint', 'value_enc', 'value_key'])
    .where('report_id', '=', fromReportId)
    .orderBy('field_key')
    .orderBy('position')
    .execute();
  if (!rows.length) return [];
  await trx
    .insertInto('report_values')
    .values(rows.map((r) => ({ ...r, report_id: toReportId })))
    .execute();
  return rows.flatMap((r) =>
    isKind(r.kind)
      ? [{ fieldKey: r.field_key, kind: r.kind, position: r.position, fingerprint: r.fingerprint }]
      : [],
  );
}

/**
 * While a report waits for its confirmation link, its held values wait
 * here, encrypted as one value under a key of their own, never in the
 * submission's payload (which is kept after confirmation).
 */
export async function stageHeld(
  trx: Db,
  keys: LinkKeys,
  submissionId: number,
  held: HeldValues,
): Promise<void> {
  const sealed = sealReportValue(keys, JSON.stringify(held));
  await trx
    .insertInto('report_submission_values')
    .values({ submission_id: submissionId, value_enc: sealed.enc, value_key: sealed.key })
    .execute();
}

/** The staged values, removed as they are read. Undefined when there were none. */
export async function takeStagedHeld(
  trx: Db,
  keys: LinkKeys,
  submissionId: number,
): Promise<HeldValues | undefined> {
  const row = await trx
    .deleteFrom('report_submission_values')
    .where('submission_id', '=', submissionId)
    .returning(['value_enc', 'value_key'])
    .executeTakeFirst();
  if (!row) return undefined;
  return JSON.parse(openReportValue(keys, row.value_enc, row.value_key)) as HeldValues;
}

/** Whether a submission has staged values, without opening them. */
export async function hasStagedHeld(db: Db, submissionId: number): Promise<boolean> {
  const row = await db
    .selectFrom('report_submission_values')
    .select('submission_id')
    .where('submission_id', '=', submissionId)
    .executeTakeFirst();
  return row !== undefined;
}
