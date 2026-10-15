/**
 * Export the whole archive to one JSON file.
 *
 * Deliberately LOGICAL rather than a column-for-column dump: threads, each
 * holding its versions in order, its moderation state, its restricted
 * fields and its attachments. pg_dump already does the physical version and
 * does it better — what this is for is moving the archive's *meaning*
 * across a schema change, which a physical dump cannot do.
 *
 * This is not a backup. It re-encodes; a backup preserves bytes. Take a
 * pg_dump before relying on either.
 *
 * Pairs with import-archive.js. The two are written together and should be
 * changed together — a round-trip test is the only thing that proves they
 * still agree.
 */
import 'dotenv/config';
import fs from 'node:fs';
import { pool } from '../src/db.js';

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/export-archive.js <file.json>');
  process.exit(1);
}

// Every column, discovered rather than listed. A column added to reports
// and forgotten here would be silently dropped at the moment it mattered
// most, and nobody would find out until a verification failed.
async function columnsOf(table) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

const has = async (table) => (await columnsOf(table)).length > 0;

const reportCols = await columnsOf('reports');
const { rows: reports } = await pool.query(
  `SELECT ${reportCols.join(', ')} FROM reports ORDER BY id`,
);

const { rows: heads } = await pool.query('SELECT * FROM report_heads');
const headByThread = new Map(heads.map((h) => [h.thread_id, h]));

const restricted = (await has('reports_restricted'))
  ? (await pool.query('SELECT * FROM reports_restricted')).rows : [];
// Keyed by thread, not by report: the contact details belong to the
// thread as a whole, so a correction does not get its own copy.
const restrictedByThread = new Map(restricted.map((r) => [String(r.thread_id), r]));
// The per-thread keys newer contact details are sealed under (migration
// 029). Still wrapped by the master key, so this file is no more readable
// than it was — and a thread whose key was destroyed simply has none.
const contactKeys = (await has('contact_keys'))
  ? (await pool.query('SELECT * FROM contact_keys')).rows : [];
const keyByThread = new Map(contactKeys.map((k) => [String(k.thread_id), k]));

const attachments = (await has('attachments'))
  ? (await pool.query('SELECT * FROM attachments ORDER BY id')).rows : [];
const attHeads = (await has('attachment_heads'))
  ? (await pool.query('SELECT * FROM attachment_heads')).rows : [];
const attHeadById = new Map(attHeads.map((a) => [String(a.attachment_id), a]));

// WHICH VERSIONS CARRY WHICH FILES (migration 033), which is not the same
// question as which version a file arrived with. A correction carries a file
// forward by linking it, so `attachments.report_id` names the first version
// only — and an archive that recorded nothing else would replay a corrected
// report with its files dropped, which is the exact fault 033 fixed.
const attLinks = (await has('report_attachments'))
  ? (await pool.query('SELECT report_id, attachment_id FROM report_attachments')).rows : [];
const attById = new Map(attachments.map((a) => [String(a.id), a]));
const carriedByReport = new Map();
for (const l of attLinks) {
  const k = String(l.report_id);
  const a = attById.get(String(l.attachment_id));
  if (!a) continue;
  if (!carriedByReport.has(k)) carriedByReport.set(k, []);
  // The id, so the importer can link its own row, AND the four manifest
  // fields, because the replay has to rebuild the version's hashed object
  // from the files it committed to — not from the subset that happened to
  // arrive with it.
  carriedByReport.get(k).push({
    id: Number(a.id),
    ordinal: a.ordinal,
    sha256: a.sha256,
    byte_size: Number(a.byte_size),
    media_type: a.media_type,
  });
}
for (const list of carriedByReport.values()) list.sort((x, y) => x.ordinal - y.ordinal);

// Grouped by thread so the importer can replay each one in order and keep
// corrections attached to what they correct.
const byThread = new Map();
for (const r of reports) {
  if (!byThread.has(r.thread_id)) byThread.set(r.thread_id, []);
  byThread.get(r.thread_id).push(r);
}

const threads = [...byThread.entries()].map(([threadId, versions]) => ({
  thread_id: threadId,
  head: headByThread.get(threadId) || null,
  restricted: restrictedByThread.get(String(threadId)) || null,
  contact_key: keyByThread.get(String(threadId)) || null,
  versions: versions.map((v) => ({
    ...v,
    // The files that FIRST arrived with this version — the rows to recreate.
    attachments: attachments
      .filter((a) => String(a.report_id) === String(v.id))
      .map((a) => ({ ...a, head: attHeadById.get(String(a.id)) || null })),
    // Every file this version commits to, including ones it inherited from
    // the version it corrects. Ids are this archive's own and the importer
    // maps them; absent on an archive written before migration 033, which
    // the importer reads as "just the ones that arrived here".
    carries: carriedByReport.get(String(v.id)) || [],
  })),
}));

// Ordered by the thread's first report, so a replay reproduces the original
// sequence of events rather than an arbitrary one.
threads.sort((a, b) =>
  new Date(a.versions[0].received_at) - new Date(b.versions[0].received_at));

// EVERY LOGBOOK, launched or not, with its questions. Every report is in
// one, so an archive without them cannot be replayed at all.
const logbooks = (await has('logbooks'))
  ? (await pool.query('SELECT * FROM logbooks ORDER BY id')).rows : [];
const logbookForms = (await has('logbook_forms'))
  ? (await pool.query('SELECT * FROM logbook_forms ORDER BY id')).rows : [];
const logbookFields = (await has('logbook_fields'))
  ? (await pool.query('SELECT * FROM logbook_fields ORDER BY logbook_id, position, id')).rows : [];

// One chain per logbook, so one head per logbook.
const chainHeads = {};
for (const r of reports) {
  const lb = logbooks.find((l) => String(l.id) === String(r.logbook_id));
  if (lb) chainHeads[lb.slug] = r.chain_hash;
}

const payload = {
  exported_at: new Date().toISOString(),
  // What the archive claimed at the moment of export, one head per logbook.
  // Recorded for the record, NOT to be restored: a reimport builds new
  // chains, and copying the old heads across would be a claim the new
  // chains cannot support.
  previous_chain_heads: chainHeads,
  previous_report_count: reports.length,
  columns: reportCols,
  logbooks: logbooks.map((l) => ({
    ...l, fields: logbookFields.filter((f) => String(f.logbook_id) === String(l.id)),
    // The form versions, so a replayed report can seal the same one.
    forms: logbookForms.filter((f) => String(f.logbook_id) === String(l.id)),
  })),
  threads,
  users: (await has('users'))
    ? (await pool.query('SELECT * FROM users')).rows : [],
  access_log: (await has('access_log'))
    ? (await pool.query('SELECT * FROM access_log ORDER BY id')).rows : [],
  feedback: (await has('feedback'))
    ? (await pool.query('SELECT * FROM feedback ORDER BY id')).rows : [],
  feedback_events: (await has('feedback_events'))
    ? (await pool.query('SELECT * FROM feedback_events ORDER BY id')).rows : [],
  site_settings: (await has('site_settings'))
    ? (await pool.query('SELECT * FROM site_settings')).rows : [],
  // Organizations and who belongs to them. Carried because a reset that
  // dropped them would leave every third-party report in the archive
  // naming an organization that no longer exists as a row — the seal would
  // still say "filed via Indivisible Abroad Munich" and nothing in the
  // system would agree.
  organizations: (await has('organizations'))
    ? (await pool.query('SELECT * FROM organizations ORDER BY id')).rows : [],
  organization_memberships: (await has('organization_memberships'))
    ? (await pool.query(
      `SELECT m.organization_id, u.email, m.role, m.joined_at
       FROM organization_memberships m JOIN users u ON u.id = m.user_id
       ORDER BY m.id`,
    )).rows : [],
  organization_invites: (await has('organization_invites'))
    ? (await pool.query('SELECT * FROM organization_invites ORDER BY id')).rows : [],
  // The grant trail. Append-only and about people rather than reports, so
  // a chain reset has no business dropping it.
  role_audit: (await has('role_audit'))
    ? (await pool.query('SELECT * FROM role_audit ORDER BY id')).rows : [],
  feedback_comments: (await has('feedback_comments'))
    ? (await pool.query('SELECT * FROM feedback_comments ORDER BY id')).rows : [],

  // Exported to be READ, never to be restored. A reimport builds a new
  // chain, so every one of these anchors describes a head that will not
  // exist afterwards — importing them would be the archive asserting
  // timestamps it cannot support.
  //
  // They are carried anyway because the reset marker has to name them:
  // "these published proofs no longer reconcile, and here is exactly
  // which" is the disclosure. Without them in the file it would have to
  // read a table the wipe has already emptied, and would truthfully
  // report that no anchors were affected.
  //
  // The RFC 3161 tokens themselves are left behind: they are large, they
  // are already published in the transparency log, and the marker names
  // the anchors rather than reproducing their evidence.
  previous_chain_anchors: (await has('chain_anchors'))
    ? (await pool.query(
      'SELECT anchor_date, root_chain_hash, public_log_ref FROM chain_anchors ORDER BY anchor_date',
    )).rows : [],
};

fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');

console.log(`  logbooks     ${logbooks.length}`);
console.log(`  threads      ${threads.length}`);
console.log(`  reports      ${reports.length}`);
console.log(`  attachments  ${attachments.length}`);
console.log(`  file links   ${attLinks.length}`);
console.log(`  contacts     ${restricted.length}`);
console.log(`  organizations ${payload.organizations.length}`);
console.log(`  memberships  ${payload.organization_memberships.length}`);
console.log(`  anchors      ${payload.previous_chain_anchors.length} (recorded, not restored)`);
console.log(`  users        ${payload.users.length}`);
for (const [slug, head] of Object.entries(chainHeads)) console.log(`  chain head   ${slug}  ${head}`);
console.log(`\nwritten to ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
await pool.end();
