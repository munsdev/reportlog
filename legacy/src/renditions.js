/**
 * Taking a published file back down.
 *
 * Its own module for a reason that is not tidiness. `mediaCache.js` reads its
 * directory into a `const` at import time, so importing it from a module the
 * unit suite loads early — `attachments.js` is one — decides the cache
 * directory before a test can set MEDIA_CACHE_DIR, and a check that has
 * nothing to do with attachments goes red. Keep this file imported only by
 * the two routes that actually take a file down.
 *
 * Shared by the moderator who withholds or refuses a file and by a reporter
 * revoking the attachment permission, so that the two cannot drift: an
 * un-publish that leaves the object in a public bucket is not an un-publish.
 */
import { pool } from './db.js';
import { storageConfig, deleteObject } from './storage.js';
import { forget } from './mediaCache.js';

/**
 * Remove a published rendition everywhere it exists: the public bucket, its
 * poster, and the local cache.
 *
 * Shared by the moderator who refuses or withholds a file and by a reporter
 * revoking the attachment permission, because an un-publish that leaves the
 * object in the bucket is not an un-publish. The gate would already refuse to
 * serve it, but leaving plaintext of a file we just withdrew sitting on disk
 * is not defensible, and a bucket served directly would make the withdrawal
 * cosmetic.
 *
 * Every step swallows its own failure deliberately: storage being down must
 * not leave the row saying "published" when the decision was to stop.
 */
export async function dropRendition(renditionKey) {
  if (!renditionKey) return;
  const c = storageConfig();
  await deleteObject(c.renditionBucket, renditionKey).catch(() => {});
  await deleteObject(c.renditionBucket, `${renditionKey}.poster`).catch(() => {});
  await forget(renditionKey);
  await forget(`${renditionKey}.poster`);
}

/**
 * Withhold every published file on a thread, and take its rendition down.
 *
 * Called when a reporter revokes the attachment permission. `withheld` and
 * not `refused`: refused is a moderator's judgement about the file, and this
 * is the reporter changing their mind, which is a different fact. A moderator
 * can publish again if the reporter grants it again — consent is the ceiling,
 * moderation is the floor, and this lowers the ceiling.
 *
 * Returns how many files it took down, so the caller can say so.
 */
export async function withdrawPublishedAttachments(threadId, client = pool) {
  const { rows } = await client.query(
    `SELECT ah.attachment_id, ah.rendition_key
     FROM attachment_heads ah JOIN attachments a ON a.id = ah.attachment_id
     WHERE a.thread_id = $1 AND ah.publication = 'published'`,
    [threadId],
  );
  for (const r of rows) {
    await dropRendition(r.rendition_key);
    await client.query(
      `UPDATE attachment_heads
       SET publication = 'withheld', rendition_key = NULL, updated_at = now()
       WHERE attachment_id = $1`,
      [r.attachment_id],
    );
  }
  return rows.length;
}
