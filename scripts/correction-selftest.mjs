/**
 * A correction keeps the files, and both versions still verify.
 *
 * THE BUG THIS EXISTS FOR. `attachments.report_id` names ONE version of a
 * report, and until migration 033 every read of a report's files joined it
 * against `report_heads.current_report_id`. A correction mints a new version
 * and moves the head, so the published photographs vanished from the report,
 * the rows became reachable by nothing, and — the reason no suite caught it —
 * the new version's manifest came back empty, its hashed object therefore had
 * no `attachments` key, and it VERIFIED CLEANLY. Nothing went red. A reporter
 * fixing a typo lost their video with no warning and no way back.
 *
 * `scripts/chain-selftest.mjs` already exercises corrections. It has always
 * done so on reports with no files, which is why the gap stayed open: the
 * path was tested, the combination was not.
 *
 * WHY THE ATTACHMENT ROWS ARE WRITTEN BY HAND HERE. Reaching them the real
 * way needs object storage, a presigned PUT and the media worker, none of
 * which exist in a test run. What is under test is not the upload — it is
 * what the archive does to files it already holds when a new version of
 * their report arrives. So the rows are inserted exactly as `promoteSlots`
 * inserts them, and everything after that is the real code.
 *
 * Run by `npm run test:db` against a throwaway database.
 */
import 'dotenv/config';
import crypto from 'node:crypto';

const { pool } = await import('../src/db.js');
const L = await import('../src/logbooks.js');
const { insertReportVersion, normalizeReportFields } = await import('../src/reportCore.js');
const { verifyReport, manifestFor } = await import('../src/verify.js');
const {
  attachmentsOfReport, linkAttachments, manifestFromRows, nextOrdinal, buildManifest,
} = await import('../src/attachments.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

const DIGEST = 'd'.repeat(64);

async function launched(slug) {
  const made = await L.createLogbook({ title: `Correction ${slug}`, slug });
  await L.addField(made.logbook.id, { kind: 'long_text', label: 'What happened' });
  await L.launch(made.logbook.id);
  return L.logbookById(made.logbook.id);
}

/**
 * One attachment on a thread, inserted the way promoteSlots inserts one —
 * including the report_attachments link, which is the thing under test.
 */
async function attach(client, { threadId, reportId, name }) {
  const ordinal = await nextOrdinal(client, threadId);
  const { rows } = await client.query(
    `INSERT INTO attachments (thread_id, report_id, ordinal, original_name, media_type,
                              byte_size, sha256, storage_key)
     VALUES ($1,$2,$3,$4,'image/jpeg',$5,$6,$7) RETURNING id, ordinal, sha256, byte_size, media_type`,
    [threadId, reportId, ordinal, name, 1234 + ordinal,
      crypto.createHash('sha256').update(name).digest('hex'), `evidence/${name}`],
  );
  await client.query(
    "INSERT INTO attachment_heads (attachment_id, dek_wrapped, scan_status) VALUES ($1, $2, 'clean')",
    [rows[0].id, Buffer.from('wrapped-key')],
  );
  await linkAttachments(client, { reportId, attachmentIds: [rows[0].id] });
  return rows[0];
}

const lb = await launched('corr-files');

// ---------------------------------------------------------------------
// A report with two photographs, then a correction to its text only.
// ---------------------------------------------------------------------
const threadId = crypto.randomUUID();
let first = null;
let files = [];

{
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The manifest has to be known before the row is hashed, so the files
    // are staged, the manifest built from them, and the rows written after —
    // which is the order the confirm handler uses.
    const staged = [
      { sha256: crypto.createHash('sha256').update('one.jpg').digest('hex'), byte_size: 1234, media_type: 'image/jpeg' },
      { sha256: crypto.createHash('sha256').update('two.jpg').digest('hex'), byte_size: 1235, media_type: 'image/jpeg' },
    ];
    first = await insertReportVersion(client, {
      threadId,
      correctsId: null,
      logbookId: lb.id,
      attachmentManifest: buildManifest(staged, { ordinalFrom: 0 }),
      fields: normalizeReportFields({
        logbook: lb.slug,
        answers: { what_happened: 'A queue nobody could stand in.' },
        may_publish: true,
        may_publish_digest: DIGEST,
      }),
    });
    await client.query(
      "INSERT INTO report_heads (thread_id, current_report_id, moderation_status) VALUES ($1, $2, 'valid')",
      [threadId, first.id],
    );
    files = [
      await attach(client, { threadId, reportId: first.id, name: 'one.jpg' }),
      await attach(client, { threadId, reportId: first.id, name: 'two.jpg' }),
    ];
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

ok('a new report seals its files', (await manifestFor(first.id)).length === 2);
{
  const v = await verifyReport(first.public_ref);
  ok('and it verifies', v.content.ok && v.link.ok && v.position.ok,
    JSON.stringify({ c: v.content.ok, l: v.link.ok, p: v.position.ok }));
}
ok('ordinals start at zero on a fresh thread',
  files[0].ordinal === 0 && files[1].ordinal === 1);

// The correction, through the same two steps the route uses.
let second = null;
{
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inherited = await attachmentsOfReport(client, first.id);
    ok('the version being corrected is known to hold both files', inherited.length === 2);
    second = await insertReportVersion(client, {
      threadId,
      correctsId: first.id,
      logbookId: lb.id,
      attachmentManifest: inherited.length ? manifestFromRows(inherited) : null,
      fields: normalizeReportFields({
        logbook: lb.slug,
        answers: { what_happened: 'A queue nobody could stand in. It was two hours.' },
        may_publish: true,
        may_publish_digest: DIGEST,
      }),
    });
    await linkAttachments(client, {
      reportId: second.id,
      attachmentIds: inherited.map((a) => a.id),
    });
    await client.query(
      'UPDATE report_heads SET current_report_id = $1 WHERE thread_id = $2',
      [second.id, threadId],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

// THE FOUR CHECKS THAT WOULD HAVE CAUGHT IT.
const m2 = await manifestFor(second.id);
ok('THE CORRECTION STILL HOLDS BOTH FILES', m2 && m2.length === 2,
  `got ${m2 ? m2.length : 'null'} — this is the bug migration 033 fixed`);

const m1 = await manifestFor(first.id);
ok('and the manifest is byte-identical to the one before it',
  JSON.stringify(m1) === JSON.stringify(m2));

{
  const v = await verifyReport(second.public_ref);
  ok('the corrected version verifies', v.content.ok && v.link.ok && v.position.ok,
    JSON.stringify({ c: v.content.ok, l: v.link.ok, p: v.position.ok }));
  ok('and its hashed object has an attachments key', 'attachments' in v.hashed_fields);
}
{
  // The old version must still verify too: a correction adds a row, it does
  // not reach back. If carrying a file forward had been done by moving
  // anything, this is the check that would have gone red.
  const v = await verifyReport(first.public_ref);
  ok('the version it corrects verifies unchanged', v.content.ok && v.link.ok && v.position.ok);
}

// ---------------------------------------------------------------------
// A correction on a report with no files seals no attachments key at all.
// The absent-key rule: an empty manifest is null, never [].
// ---------------------------------------------------------------------
{
  const bareThread = crypto.randomUUID();
  const client = await pool.connect();
  let a = null; let b = null;
  try {
    await client.query('BEGIN');
    a = await insertReportVersion(client, {
      threadId: bareThread, correctsId: null, logbookId: lb.id,
      fields: normalizeReportFields({
        logbook: lb.slug, answers: { what_happened: 'No files here.' },
        may_publish: true, may_publish_digest: DIGEST,
      }),
    });
    await client.query(
      "INSERT INTO report_heads (thread_id, current_report_id, moderation_status) VALUES ($1, $2, 'valid')",
      [bareThread, a.id],
    );
    const inherited = await attachmentsOfReport(client, a.id);
    b = await insertReportVersion(client, {
      threadId: bareThread, correctsId: a.id, logbookId: lb.id,
      attachmentManifest: inherited.length ? manifestFromRows(inherited) : null,
      fields: normalizeReportFields({
        logbook: lb.slug, answers: { what_happened: 'No files here either.' },
        may_publish: true, may_publish_digest: DIGEST,
      }),
    });
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }

  ok('a fileless report has no manifest', (await manifestFor(a.id)) === null);
  const v = await verifyReport(b.public_ref);
  ok('and its correction writes no attachments key',
    !('attachments' in v.hashed_fields) && v.content.ok,
    'an empty manifest must be absent, never []');
}

// ---------------------------------------------------------------------
// Ordinals are per thread. A file arriving with a correction must not
// reuse a position the first version already sealed.
// ---------------------------------------------------------------------
{
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const next = await nextOrdinal(client, threadId);
    ok('the next ordinal continues the thread rather than restarting', next === 2,
      `got ${next} — two files already hold 0 and 1`);
    await client.query('ROLLBACK');
  } finally { client.release(); }
}

// ---------------------------------------------------------------------
// Erasure reaches every version, because a file is one row and the
// versions link to it. This is what the link table buys over copied rows.
// ---------------------------------------------------------------------
{
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT report_id FROM report_attachments WHERE attachment_id = $1 ORDER BY report_id',
      [files[0].id],
    );
    ok('one file, linked from both versions', rows.length === 2
      && String(rows[0].report_id) === String(first.id)
      && String(rows[1].report_id) === String(second.id));
  } finally { client.release(); }

  // Destroying the key is one UPDATE on one attachment_heads row. If the
  // correction had copied the attachment instead of linking it, the copy
  // would still hold a live key to an object that had just been deleted.
  await pool.query(
    'UPDATE attachment_heads SET dek_wrapped = NULL, dek_destroyed_at = now() WHERE attachment_id = $1',
    [files[0].id],
  );
  const { rows: live } = await pool.query(
    `SELECT count(*)::int AS n FROM report_attachments ra
     JOIN attachment_heads ah ON ah.attachment_id = ra.attachment_id
     WHERE ra.attachment_id = $1 AND ah.dek_wrapped IS NOT NULL`,
    [files[0].id],
  );
  ok('erasing it leaves no version holding a live key', live[0].n === 0);

  // And the manifests are untouched: the fingerprint of a report must not
  // move because a file was erased. That is the whole point of shredding a
  // key rather than deleting a row.
  ok('and both versions still verify after the erasure',
    (await verifyReport(first.public_ref)).content.ok
    && (await verifyReport(second.public_ref)).content.ok);
}

// ---------------------------------------------------------------------
// The link table is append-only, like everything else recording what a
// version said.
// ---------------------------------------------------------------------
{
  let refusedUpdate = null; let refusedDelete = null;
  try {
    await pool.query('UPDATE report_attachments SET report_id = report_id WHERE attachment_id = $1',
      [files[1].id]);
  } catch (e) { refusedUpdate = e; }
  try {
    await pool.query('DELETE FROM report_attachments WHERE attachment_id = $1', [files[1].id]);
  } catch (e) { refusedDelete = e; }
  ok('report_attachments refuses UPDATE', !!refusedUpdate);
  ok('report_attachments refuses DELETE', !!refusedDelete);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
