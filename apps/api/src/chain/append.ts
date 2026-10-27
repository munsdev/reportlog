/**
 * Append one version of a report to its logbook's chain.
 *
 * Shared by a new submission, a correction and a coordinator's batch: all of
 * them "append a version", differing only in whether the thread is new and
 * whether `correctsId` points at a prior version.
 *
 * ONE CHAIN PER LOGBOOK. The previous link is the newest row IN THIS
 * LOGBOOK, and a logbook's first report links to its genesis. The lock is per
 * logbook, so two logbooks never wait on each other. The database checks the
 * link again on insert (reports_link_guard), so a mistake here is an error,
 * not a fork.
 *
 * MUST RUN INSIDE A TRANSACTION, which the signature insists on: the lock
 * lasts exactly as long as it does.
 *
 * FILES. `attachments` is the manifest being sealed. Whoever passes one must
 * link exactly those files to the returned row (report_attachments) in the
 * same transaction; the verifier rebuilds the manifest from that table and a
 * difference shows as a report that no longer matches its fingerprint.
 *
 * HELD VALUES (W1). Erasable text and links are sealed as fingerprints and
 * stored outside the report. Both are written HERE, from the same rows, in
 * the same transaction, so the fingerprints sealed and the values kept cannot
 * disagree: a caller hands over the values (`held.rows`, from prepareHeld) or
 * the version to carry them from, never fingerprints of its own. Only a
 * replayed archive brings fingerprints in its fields, because the values do
 * not travel with it (anchor/archive.ts).
 */
import {
  buildSealedObject,
  chainGenesis,
  chainHash,
  contentHash,
  genPublicRef,
  heldFingerprint,
} from '@reportlog/seal';
import type { AttachmentEntry, ReportFields, SealedReport } from '@reportlog/seal';
import { sql } from 'kysely';
import type { Selectable, Transaction } from 'kysely';
import type { DB, Reports } from '../db/schema.gen.ts';
import type { LinkKeys } from '../links/keys.ts';
import { carryHeldRows, heldSlotsOf, storeHeldRows } from '../reportValues/store.ts';
import type { HeldRow, HeldSlot } from '../reportValues/store.ts';
import { ensureFormVersion } from './forms.ts';
import { fingerprintKeys } from './held.ts';
import { questionsFor } from './questions.ts';

export interface AppendInput {
  logbookId: number;
  threadId: string;
  correctsId?: number | null;
  /** From normalizeReportFields. `fields.logbook` must be this logbook's slug. */
  fields: ReportFields;
  attachments?: readonly AttachmentEntry[] | null;
  /**
   * Which version of the form the answers were checked against. Left out,
   * the current questions are used, so no path files a report without its
   * form. Pass the id of THE reading you validated against when you have one.
   */
  formId?: number;
  publicRefPrefix: string;
  /** Only for replaying an exported archive into a new chain. */
  replay?: { publicRef: string; receivedAt: string };
  /**
   * The version's held values: fresh ones, each with its nonce (prepareHeld
   * in held.ts), or every value an earlier version of the thread still
   * holds, carried unchanged. Left out, the version holds none.
   */
  held?: { keys: LinkKeys; rows: readonly HeldRow[] } | { carryFrom: number };
}

export interface AppendResult {
  row: Selectable<Reports>;
  sealed: SealedReport;
}

export class ChainError extends Error {
  override name = 'ChainError';
}

export async function appendReportVersion(
  trx: Transaction<DB>,
  input: AppendInput,
): Promise<AppendResult> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`reports_chain:${String(input.logbookId)}`}))`.execute(
    trx,
  );

  const logbook = await trx
    .selectFrom('logbooks')
    .select(['id', 'slug', 'launched_at'])
    .where('id', '=', input.logbookId)
    .executeTakeFirst();
  if (!logbook) throw new ChainError(`No logbook ${String(input.logbookId)}`);
  if (!logbook.launched_at) throw new ChainError(`Logbook ${logbook.slug} has not launched`);
  if (input.fields.logbook !== logbook.slug) {
    throw new ChainError(
      `The report says it belongs to "${input.fields.logbook}" and is being filed in "${logbook.slug}"`,
    );
  }

  // The form is resolved inside the transaction and folded into the fields
  // here, the one place both the seal and the row are written from.
  let form: { id: number; hash: string };
  if (input.formId === undefined) {
    form = await ensureFormVersion(trx, logbook, await questionsFor(trx, logbook.id));
  } else {
    const row = await trx
      .selectFrom('logbook_forms')
      .select(['id', 'form_hash'])
      .where('id', '=', input.formId)
      .where('logbook_id', '=', logbook.id)
      .executeTakeFirst();
    if (!row) throw new ChainError("That form version is not this logbook's");
    form = { id: row.id, hash: row.form_hash };
  }
  // The fingerprint keys come from the held values and from nowhere else.
  if (
    !input.replay &&
    (input.fields.text_fingerprints !== undefined || input.fields.link_fingerprints !== undefined)
  ) {
    throw new ChainError('Fingerprints of held values are made here, from the values themselves');
  }
  let slots: HeldSlot[] = [];
  if (input.held && 'rows' in input.held) {
    slots = checkedRows(input.held.rows);
  } else if (input.held) {
    slots = await heldSlotsOf(trx, input.held.carryFrom);
  }
  const fields: ReportFields = {
    ...input.fields,
    ...fingerprintKeys(slots),
    logbook_form: form.hash,
  };

  const latest = await trx
    .selectFrom('reports')
    .select('chain_hash')
    .where('logbook_id', '=', logbook.id)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const prev = latest?.chain_hash ?? chainGenesis(logbook.slug);

  const sealed = buildSealedObject({
    publicRef: input.replay?.publicRef ?? genPublicRef(input.publicRefPrefix),
    receivedAt: input.replay?.receivedAt ?? new Date().toISOString(),
    threadId: input.threadId,
    correctsId: input.correctsId ?? null,
    fields,
    attachments: input.attachments,
  });
  const content = contentHash(sealed);

  const row = await trx
    .insertInto('reports')
    .values({
      public_ref: sealed.public_ref,
      received_at: sealed.received_at,
      thread_id: sealed.thread_id,
      corrects_id: sealed.corrects_id,
      recipe: sealed.recipe ?? 1,
      content_hash: content,
      prev_chain_hash: prev,
      chain_hash: chainHash(content, prev),
      logbook_id: logbook.id,
      form_id: form.id,
      // The SAME object that was sealed, written from `sealed` and never from
      // the request, so the column cannot drift from the seal. Absent is
      // NULL, never {}.
      answers: sealed.answers ? JSON.stringify(sealed.answers) : null,
      // Likewise: what was sealed under these keys, never {}. NAMED ONLY WHEN
      // PRESENT (the column default is NULL), so a report without a held
      // value is the same INSERT as before the columns existed: this code
      // files it on a database that has not yet run their migration, which
      // is how the upgrade test files its "before" reports.
      ...(sealed.text_fingerprints
        ? { text_fingerprints: JSON.stringify(sealed.text_fingerprints) }
        : {}),
      ...(sealed.link_fingerprints
        ? { link_fingerprints: JSON.stringify(sealed.link_fingerprints) }
        : {}),
      may_publish: sealed.may_publish,
      may_publish_digest: sealed.may_publish_digest,
      // Null on a direct report, so the row and the seal say the same thing.
      third_party: sealed.third_party ?? null,
      filed_via: sealed.filed_via ?? null,
      intake_method: sealed.intake_method ?? null,
      attested_at: sealed.attested_at ?? null,
      collected_on: sealed.collected_on ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  if (input.held && 'rows' in input.held) {
    await storeHeldRows(trx, input.held.keys, row.id, input.held.rows);
  } else if (input.held) {
    const carried = await carryHeldRows(trx, input.held.carryFrom, row.id);
    // Read twice in one transaction: an erasure that landed in between would
    // seal a fingerprint with nothing behind it. Refuse; the caller retries.
    if (JSON.stringify(carried) !== JSON.stringify(slots)) {
      throw new ChainError('The held values changed while this version was being written');
    }
  }

  return { row, sealed };
}

/** Fresh rows: each fingerprint really is of its own nonce and value, and no slot twice. */
function checkedRows(rows: readonly HeldRow[]): HeldSlot[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    const slot = `${r.fieldKey}/${String(r.position)}`;
    if (seen.has(slot)) throw new ChainError(`Two held values for ${slot}`);
    seen.add(slot);
    if (heldFingerprint(r.nonce, r.value) !== r.fingerprint) {
      throw new ChainError(`The fingerprint of ${slot} is not of its value`);
    }
    return { fieldKey: r.fieldKey, kind: r.kind, position: r.position, fingerprint: r.fingerprint };
  });
}
