/**
 * Publishing a file, taking it down, and erasing it.
 *
 * WHAT IS PUBLISHED IS NEVER THE FILE. It is the re-encoded copy the worker
 * made, decrypted and copied into the renditions bucket. AN OBJECT THERE IS
 * THE PUBLICATION DECISION, and it is served only through the site, which
 * checks again at every request (`servable`).
 *
 * CONSENT IS THE CEILING, MODERATION IS THE FLOOR. A file is published only
 * while the reporter permits their files to be published AND the report's
 * own sealed answer allows publishing. Read now, never trusted from earlier;
 * the database refuses it too (attachment_heads_guard).
 *
 * ONE PATH DOWN. A moderator withholding or refusing a file and a reporter
 * taking their permission back both go through `takeDown`, so the two cannot
 * drift: an un-publish that left the object in the public bucket would not be
 * an un-publish. The object's deletion is recorded in the same transaction as
 * the decision (storage_deletions) and attempted at once and again by the
 * worker until it succeeds.
 */
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { permissionsFor } from '../permissions/log.ts';
import type { Files } from './context.ts';
import { OVERHEAD, decryptStream } from './envelope.ts';
import { evidenceKeys, queueDeletion } from './slots.ts';
import { randomKey } from './storage.ts';
import { drainDeletions } from './worker.ts';

const refuse = (status: number, code: string, message: string) =>
  new HttpError(status, code, message);

/** The public objects of one published file. */
export function publicKeys(
  renditionKey: string,
  hasPoster: boolean,
  pageCount: number | null,
): string[] {
  const keys = [renditionKey];
  if (hasPoster) keys.push(`${renditionKey}.poster`);
  for (let i = 2; i <= (pageCount ?? 1); i++) keys.push(`${renditionKey}.page${String(i)}`);
  return keys;
}

/** The evidence object behind each public one. */
function evidenceFor(storageKey: string, publicKey: string, renditionKey: string): string {
  const suffix = publicKey.slice(renditionKey.length);
  return suffix ? `${storageKey}${suffix}` : `${storageKey}.rendition`;
}

async function fileRow(db: Kysely<DB>, attachmentId: number) {
  return db
    .selectFrom('attachment_heads as h')
    .innerJoin('attachments as a', 'a.id', 'h.attachment_id')
    .select([
      'h.attachment_id',
      'h.thread_id',
      'h.publication',
      'h.rendition_key',
      'h.has_poster',
      'h.page_count',
      'h.dek_wrapped',
      'a.storage_key',
    ])
    .where('h.attachment_id', '=', attachmentId)
    .executeTakeFirst();
}

export type Actor =
  { actor: 'moderator'; email: string } | { actor: 'reporter' } | { actor: 'system' };

/**
 * TAKE PUBLISHED FILES DOWN. The one path, for a moderator and a reporter
 * alike. In the caller's transaction; call `afterCommit` once it commits.
 */
export async function takeDown(
  trx: Transaction<DB>,
  input: {
    attachmentIds?: readonly number[];
    threadId?: string;
    /** What the file's publication becomes: withheld (can be published again) or refused. */
    to: 'withheld' | 'refused';
    action: 'withheld' | 'refused' | 'taken_down';
    who: Actor;
    reason: string | null;
  },
): Promise<number> {
  let q = trx
    .selectFrom('attachment_heads')
    .select([
      'attachment_id',
      'thread_id',
      'publication',
      'rendition_key',
      'has_poster',
      'page_count',
    ])
    .forUpdate();
  if (input.attachmentIds)
    q = q.where('attachment_id', 'in', input.attachmentIds.length ? input.attachmentIds : [-1]);
  if (input.threadId)
    q = q.where('thread_id', '=', input.threadId).where('publication', '=', 'published');
  const rows = await q.execute();
  for (const r of rows) {
    if (r.rendition_key) {
      for (const key of publicKeys(r.rendition_key, r.has_poster, r.page_count)) {
        await queueDeletion(trx, 'renditions', key);
      }
    }
    await trx
      .updateTable('attachment_heads')
      .set({ publication: input.to, rendition_key: null, updated_at: new Date() })
      .where('attachment_id', '=', r.attachment_id)
      .execute();
    await trx
      .insertInto('attachment_events')
      .values({
        attachment_id: r.attachment_id,
        thread_id: r.thread_id,
        action: input.action,
        actor: input.who.actor,
        actor_email: input.who.actor === 'moderator' ? input.who.email : null,
        reason: input.reason,
      })
      .execute();
  }
  return rows.length;
}

/** After a takedown commits: delete the objects now rather than at the worker's next pass. */
export async function afterCommit(files: Files | null): Promise<void> {
  if (files) await drainDeletions(files).catch(() => undefined);
}

/**
 * THE REPORTER TAKES THEIR FILES PERMISSION BACK. Every published file of the
 * thread comes down, as `withheld` (not `refused`: that is a moderator's
 * judgement of the file, and this is the reporter changing their mind; a
 * moderator may publish again if the reporter grants it again).
 */
export function takeDownForReporter(
  trx: Transaction<DB>,
  threadId: string,
  why = 'the reporter took back permission to publish their files',
) {
  return takeDown(trx, {
    threadId,
    to: 'withheld',
    action: 'taken_down',
    who: { actor: 'reporter' },
    reason: why,
  });
}

/** A moderator publishing a file: the re-encoded copy, with alt text. */
export async function publish(
  files: Files,
  input: { attachmentId: number; altText: string; reason: string; by: string },
): Promise<void> {
  const alt = input.altText.trim();
  // For people who cannot see the file, and proof somebody looked at it.
  if (alt.length < 3)
    throw refuse(400, 'no_alt_text', 'Describe the file in a few words before publishing it.');
  if (!input.reason.trim()) throw refuse(400, 'no_reason', 'Say why, for the record.');
  const row = await fileRow(files.db, input.attachmentId);
  if (!row) throw refuse(404, 'not_found', 'There is no such file.');
  if (!row.dek_wrapped) throw refuse(410, 'erased', 'This file has been erased.');
  const perms = await permissionsFor(files.db, row.thread_id);
  if (!perms.attachment_publication) {
    throw refuse(
      409,
      'not_permitted',
      'The reporter has not given permission for their files to be published. The report itself may still be published.',
    );
  }
  const current = await files.db
    .selectFrom('report_heads as h')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .innerJoin('report_attachments as ra', (j) =>
      j.onRef('ra.report_id', '=', 'r.id').on('ra.attachment_id', '=', input.attachmentId),
    )
    .select(['r.may_publish'])
    .where('h.thread_id', '=', row.thread_id)
    .executeTakeFirst();
  if (!current)
    throw refuse(409, 'not_current', 'This file is not part of the current version of the report.');
  if (!current.may_publish) {
    throw refuse(
      409,
      'not_permitted',
      'The reporter did not agree to this report being published, so its files are not either.',
    );
  }

  const dek = files.ring.unwrap(row.dek_wrapped);
  const renditionKey = row.rendition_key ?? randomKey('rendition');
  const keys = publicKeys(renditionKey, row.has_poster, row.page_count);
  // Copy first, then record; if the record is refused, the copies go again.
  for (const key of keys) {
    const src = await files.storage.get(
      'evidence',
      evidenceFor(row.storage_key, key, renditionKey),
    );
    if (!src)
      throw refuse(
        502,
        'storage',
        'The file could not be found in storage. Nothing was published.',
      );
    await files.storage.put(
      'renditions',
      key,
      src.body.pipe(decryptStream(dek)),
      src.size - OVERHEAD,
    );
  }
  try {
    await files.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('attachment_heads')
        .set({
          publication: 'published',
          rendition_key: renditionKey,
          alt_text: alt,
          updated_at: new Date(),
        })
        .where('attachment_id', '=', row.attachment_id)
        .execute();
      await trx
        .insertInto('attachment_events')
        .values({
          attachment_id: row.attachment_id,
          thread_id: row.thread_id,
          action: 'published',
          actor: 'moderator',
          actor_email: input.by,
          reason: input.reason.trim(),
        })
        .execute();
    });
  } catch (e) {
    for (const key of keys) await files.storage.delete('renditions', key).catch(() => undefined);
    throw e;
  }
}

/** A moderator withholding or refusing a file. The same path down as the reporter's. */
export async function withhold(
  files: Files,
  input: { attachmentId: number; to: 'withheld' | 'refused'; reason: string; by: string },
): Promise<void> {
  if (!input.reason.trim()) throw refuse(400, 'no_reason', 'Say why, for the record.');
  const row = await fileRow(files.db, input.attachmentId);
  if (!row) throw refuse(404, 'not_found', 'There is no such file.');
  await files.db.transaction().execute((trx) =>
    takeDown(trx, {
      attachmentIds: [row.attachment_id],
      to: input.to,
      action: input.to,
      who: { actor: 'moderator', email: input.by },
      reason: input.reason.trim(),
    }),
  );
  await afterCommit(files);
}

/**
 * ERASE ONE FILE: destroy its key. Every copy of it, in every bucket and
 * every backup of a bucket, is ciphertext nobody can open from now on, and
 * the location stripped out of it goes with it. Its digest stays in the
 * sealed manifest, so the report still verifies and the archive still says
 * a file was submitted and later erased. Administrators only; irreversible.
 */
export async function erase(
  files: Files,
  input: { attachmentId: number; reason: string; by: string },
): Promise<void> {
  if (!input.reason.trim()) throw refuse(400, 'no_reason', 'Say why, for the record.');
  const row = await fileRow(files.db, input.attachmentId);
  if (!row) throw refuse(404, 'not_found', 'There is no such file.');
  if (!row.dek_wrapped) throw refuse(409, 'erased', 'This file was already erased.');
  await files.db.transaction().execute(async (trx) => {
    await takeDown(trx, {
      attachmentIds: [row.attachment_id],
      to: 'refused',
      action: 'refused',
      who: { actor: 'moderator', email: input.by },
      reason: input.reason.trim(),
    });
    await trx
      .updateTable('attachment_heads')
      .set({
        dek_wrapped: null,
        dek_destroyed_at: new Date(),
        meta_enc: null,
        original_name: null,
        alt_text: null,
      })
      .where('attachment_id', '=', row.attachment_id)
      .execute();
    // The ciphertext goes too, but that is tidiness: destroying the key is
    // what makes this irreversible.
    for (const key of evidenceKeys(row.storage_key, row.page_count))
      await queueDeletion(trx, 'evidence', key);
    await trx
      .insertInto('attachment_events')
      .values({
        attachment_id: row.attachment_id,
        thread_id: row.thread_id,
        action: 'erased',
        actor: 'moderator',
        actor_email: input.by,
        reason: input.reason.trim(),
      })
      .execute();
  });
  await afterCommit(files);
}

/**
 * MAY THIS PUBLIC OBJECT BE SERVED NOW. Asked at every request, whatever the
 * bucket holds: the file is published, the reporter still permits it, it is
 * part of the CURRENT version, and the report itself is public.
 */
export async function servable(db: Kysely<DB>, renditionKey: string) {
  const row = await db
    .selectFrom('attachment_heads as fh')
    .innerJoin('report_heads as h', 'h.thread_id', 'fh.thread_id')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .innerJoin('report_attachments as ra', (j) =>
      j.onRef('ra.report_id', '=', 'r.id').onRef('ra.attachment_id', '=', 'fh.attachment_id'),
    )
    .select([
      'fh.thread_id',
      'fh.rendition_media_type',
      'fh.has_poster',
      'fh.page_count',
      'fh.alt_text',
    ])
    .where('fh.rendition_key', '=', renditionKey)
    .where('fh.publication', '=', 'published')
    .where('h.moderation_status', '=', 'valid')
    .where('h.withdrawn', '=', false)
    .where('r.may_publish', '=', true)
    .executeTakeFirst();
  if (!row) return null;
  const perms = await permissionsFor(db, row.thread_id);
  return perms.attachment_publication ? row : null;
}

/** The files of a public report, published or not, for its page on the board. */
export async function publicFilesOf(db: Kysely<DB>, publicRef: string) {
  const report = await db
    .selectFrom('reports as r')
    .innerJoin('report_heads as h', 'h.current_report_id', 'r.id')
    .select(['r.id', 'r.thread_id', 'r.may_publish', 'h.moderation_status', 'h.withdrawn'])
    .where('r.public_ref', '=', publicRef)
    .executeTakeFirst();
  if (!report || !report.may_publish || report.withdrawn || report.moderation_status !== 'valid')
    return null;
  const perms = await permissionsFor(db, report.thread_id);
  const rows = await db
    .selectFrom('report_attachments as ra')
    .innerJoin('attachments as a', 'a.id', 'ra.attachment_id')
    .innerJoin('attachment_heads as fh', 'fh.attachment_id', 'a.id')
    .select([
      'a.ordinal',
      'a.sha256',
      'a.media_type',
      'fh.publication',
      'fh.rendition_key',
      'fh.rendition_media_type',
      'fh.alt_text',
      'fh.has_poster',
      'fh.page_count',
    ])
    .where('ra.report_id', '=', report.id)
    .orderBy('a.ordinal')
    .execute();
  const shown = rows.filter(
    (r) => perms.attachment_publication && r.publication === 'published' && r.rendition_key,
  );
  return {
    // "3 attachments, 1 published" is more honest than either number alone.
    attached: rows.length,
    published: shown.map((r) => ({
      ordinal: r.ordinal,
      // The digest of the ORIGINAL, which the report seals. The published
      // copy is re-encoded, so it is not the bytes this digest describes.
      sha256: r.sha256,
      media_type: r.rendition_media_type,
      alt_text: r.alt_text ?? '',
      key: (r.rendition_key ?? '').slice('rendition/'.length),
      has_poster: r.has_poster,
      pages: r.page_count ?? 1,
    })),
  };
}
