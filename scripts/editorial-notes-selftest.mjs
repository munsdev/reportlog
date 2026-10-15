/**
 * The archive's own statement about a report, against a real database.
 *
 * WHAT NEEDS POSTGRES HERE is everything that matters: that versions are
 * append-only at the database rather than by convention, that the current
 * note is a projection over them, that the public shape cannot carry the
 * author's address, and that a note survives its report being withdrawn.
 *
 * THE TWO CHECKS THAT MUST NEVER GO RED, both near the end:
 *
 *   - the public query does not select author_email. The byline is a house
 *     one, and that policy is expressed in SQL precisely so a template
 *     cannot forget it. A `SELECT *` here would put a moderator's address
 *     one careless res.json from the public board.
 *
 *   - a withdrawn report's note is still there. If a note followed its
 *     report automatically, pressuring a reporter would become a way to
 *     erase the editorial record — the suppression route the whole chain
 *     design exists to close. Taking a note down is a decision somebody
 *     records, not a consequence.
 *
 * Run by `npm run test:db` against a throwaway database.
 */
import 'dotenv/config';
import crypto from 'node:crypto';

const { pool } = await import('../src/db.js');
const L = await import('../src/logbooks.js');
const { insertReportVersion, normalizeReportFields } = await import('../src/reportCore.js');
const { verifyReport } = await import('../src/verify.js');
const N = await import('../src/editorialNotes.js');
const { toFile, createFromFile } = await import('../src/logbookFile.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

const DIGEST = 'f'.repeat(64);
const EDITOR = 'editor@example.org';
const OTHER = 'second-editor@example.org';
const SAY = 'The county office confirmed the machine was replaced at 10:40. '
  + 'We have not established why the line was not told.';

async function launched(slug) {
  const made = await L.createLogbook({ title: `Notes ${slug}`, slug });
  await L.addField(made.logbook.id, { kind: 'long_text', label: 'What happened' });
  await L.launch(made.logbook.id);
  return L.logbookById(made.logbook.id);
}

async function file(lb, what) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const threadId = crypto.randomUUID();
    const report = await insertReportVersion(client, {
      threadId, correctsId: null, logbookId: lb.id,
      fields: normalizeReportFields({
        logbook: lb.slug, answers: { what_happened: what },
        may_publish: true, may_publish_digest: DIGEST,
      }),
    });
    await client.query(
      "INSERT INTO report_heads (thread_id, current_report_id, moderation_status) VALUES ($1, $2, 'valid')",
      [threadId, report.id],
    );
    await client.query('COMMIT');
    return { threadId, report };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

const lb = await launched('notes-test');
const { threadId, report } = await file(lb, 'The machine went down and the line was not told.');

// ---------------------------------------------------------------------
// The switch, and that it is off by default.
// ---------------------------------------------------------------------
ok('a logbook does not use editorial notes unless somebody says so',
  lb.editorial_notes_enabled === false, JSON.stringify(lb.editorial_notes_enabled));
{
  const on = await L.setEditorialNotes(lb.id, true);
  ok('and the switch turns them on', on.ok && on.logbook.editorial_notes_enabled === true,
    JSON.stringify(on));
}

// ---------------------------------------------------------------------
// Writing one, and the floor under what counts as a note.
// ---------------------------------------------------------------------
ok('a verdict-length note is refused', N.validateBody('Probably true.') !== null,
  'this replaced a one-word judgement; the floor is what stops it coming back');
ok('and an empty one is', N.validateBody('') !== null);
ok('but a real statement is accepted', N.validateBody(SAY) === null, N.validateBody(SAY));

{
  const out = await N.writeNote({ threadId, body: SAY, authorEmail: EDITOR });
  ok('a note is written', out.ok && out.versions === 1, JSON.stringify(out));
}
{
  const note = await N.noteFor(threadId);
  ok('and reads back with its author recorded', note && note.author_email === EDITOR,
    JSON.stringify(note && note.author_email));
  ok('and it is published by default', note.state === N.PUBLISHED);
}

// ---------------------------------------------------------------------
// Revision: append-only, and the projection.
// ---------------------------------------------------------------------
{
  const second = SAY + ' The office has since said the delay was a staffing one.';
  const out = await N.writeNote({
    threadId, body: second, authorEmail: OTHER, revisionReason: 'The office came back to us.',
  });
  ok('a revision appends a version', out.ok && out.versions === 2, JSON.stringify(out));

  const note = await N.noteFor(threadId);
  ok('and the current note is the newest version', note.body === second, note.body.slice(0, 40));
  ok('and names the person who revised it', note.author_email === OTHER);

  const versions = await N.versionsFor(threadId);
  ok('both versions are kept, oldest first',
    versions.length === 2 && versions[0].body === SAY && versions[1].body === second);
  ok('and the first version still names its own author', versions[0].author_email === EDITOR,
    'a revision must not rewrite who wrote what came before');
  ok('the revision carries its reason', versions[1].revision_reason === 'The office came back to us.');
}

// ---------------------------------------------------------------------
// APPEND-ONLY AT THE DATABASE, not by convention.
// ---------------------------------------------------------------------
{
  let refusedUpdate = null; let refusedDelete = null;
  try {
    await pool.query("UPDATE editorial_note_versions SET body = 'rewritten' WHERE id = (SELECT min(id) FROM editorial_note_versions)");
  } catch (e) { refusedUpdate = e; }
  try {
    await pool.query('DELETE FROM editorial_note_versions WHERE id = (SELECT min(id) FROM editorial_note_versions)');
  } catch (e) { refusedDelete = e; }
  ok('a published version cannot be rewritten', !!refusedUpdate,
    'an archive whose own statements could be edited silently needs the trust it exists to replace');
  ok('and cannot be deleted', !!refusedDelete);
}

// ---------------------------------------------------------------------
// THE BYLINE. The public shape carries no address.
// ---------------------------------------------------------------------
{
  const pub = await N.publicNoteFor(threadId);
  ok('the public note carries the text', pub && typeof pub.body === 'string');
  ok('AND NOT THE AUTHOR, AT ALL', !('author_email' in pub) && !JSON.stringify(pub).includes('@'),
    JSON.stringify(pub));
  ok('and it says it has been revised, so a change shows as a change', pub.revised === true);
}
{
  // The policy in the query rather than in a template. A SELECT * here would
  // put a moderator's address one careless res.json from the public board.
  const src = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../src/editorialNotes.js', import.meta.url), 'utf8'));
  const fn = src.slice(src.indexOf('export async function publicNoteFor'),
    src.indexOf('export async function writeNote'));
  ok('publicNoteFor never names author_email in its SQL', !fn.includes('author_email'),
    'the byline policy is expressed in the query on purpose');
  const many = src.slice(src.indexOf('export async function publicNotesForMany'),
    src.indexOf('/* ---- external links'));
  ok('and neither does the many-at-once version', !many.includes('author_email'));
}

// ---------------------------------------------------------------------
// States. Under review is visible; withdrawn holds the text, not the fact.
// ---------------------------------------------------------------------
{
  await N.setState(threadId, N.UNDER_REVIEW);
  const pub = await N.publicNoteFor(threadId);
  ok('a note under review is still there, marked', pub.state === N.UNDER_REVIEW && !!pub.notice,
    JSON.stringify(pub));
  ok('and its text is held back rather than its existence', !('body' in pub),
    'silent removal is the thing this archive exists to prevent, our own material included');

  await N.setState(threadId, N.WITHDRAWN);
  ok('a withdrawn note says so', (await N.publicNoteFor(threadId)).state === N.WITHDRAWN);

  await N.setState(threadId, N.PUBLISHED);
  ok('and it can come back', (await N.publicNoteFor(threadId)).state === N.PUBLISHED);
  ok('an unknown state is refused', !(await N.setState(threadId, 'deleted')).ok);
}

// ---------------------------------------------------------------------
// THE ONE THAT MATTERS MOST. A withdrawn REPORT does not take its note.
// ---------------------------------------------------------------------
{
  await pool.query('UPDATE report_heads SET withdrawn = true WHERE thread_id = $1', [threadId]);
  const note = await N.noteFor(threadId);
  ok('WITHDRAWING THE REPORT DOES NOT REMOVE THE NOTE', !!note && note.state === N.PUBLISHED,
    'if it did, pressuring a reporter would be a way to erase the editorial record');
  ok('and the note still reads as it did', note.body.includes('staffing one'));
  await pool.query('UPDATE report_heads SET withdrawn = false WHERE thread_id = $1', [threadId]);
}

// ---------------------------------------------------------------------
// Citations.
// ---------------------------------------------------------------------
{
  const add = await N.addLink({
    threadId, title: 'County says machine replaced at 10:40', publisher: 'Example Herald',
    publishedOn: '2026-11-04', url: 'https://example.org/story', addedBy: EDITOR,
  });
  ok('a citation can be added', add.ok, JSON.stringify(add));
  ok('a javascript: URL is refused',
    !(await N.addLink({ threadId, title: 'x', url: 'javascript:alert(1)', addedBy: EDITOR })).ok,
    'a URL in an archive that renders links is an attack surface, not an address');
  ok('and so is a note-less report',
    !(await N.addLink({
      threadId: (await file(lb, 'No note here.')).threadId,
      title: 'x', url: 'https://example.org', addedBy: EDITOR,
    })).ok);

  const links = await N.linksFor(threadId, { forPublic: true });
  ok('the public citation list carries the source', links.length === 1
    && links[0].title.startsWith('County says'));
  ok('and not who added it', !('added_by' in links[0]), JSON.stringify(links[0]));

  ok('a citation is withdrawn by timestamp, not deleted', await N.removeLink(add.linkId));
  ok('and then no longer listed', (await N.linksFor(threadId)).length === 0);
  const { rows } = await pool.query('SELECT removed_at FROM editorial_note_links WHERE id = $1', [add.linkId]);
  ok('but the row says it was cited', rows[0] && rows[0].removed_at !== null,
    'a source quietly removed would leave a published note resting on nothing');
}

// ---------------------------------------------------------------------
// AND NONE OF IT TOUCHES THE REPORT'S FINGERPRINT.
// ---------------------------------------------------------------------
{
  const v = await verifyReport(report.public_ref);
  ok('the report still verifies, with a note and two revisions on it',
    v.content.ok && v.link.ok && v.position.ok,
    JSON.stringify({ c: v.content.ok, l: v.link.ok, p: v.position.ok }));
  // KEYS, not the serialized object. The first version of this check
  // searched the JSON for "note" and matched the logbook's own slug,
  // `notes-test`, which is answer data and has every right to be in there.
  // What must be absent is a hashed KEY about the archive's own speech.
  const keys = Object.keys(v.hashed_fields);
  ok('and no hashed key relates to the archive\'s own speech',
    !keys.some((k) => /note|editorial|byline/i.test(k)), JSON.stringify(keys));
  ok('the hashed object is exactly the keys it was before notes existed',
    keys.sort().join(',') === ['answers', 'corrects_id', 'logbook', 'logbook_form',
      'may_publish', 'may_publish_digest', 'public_ref', 'received_at', 'thread_id'].join(','),
    JSON.stringify(keys));
}

// ---------------------------------------------------------------------
// The logbook file carries the switch, both ways.
// ---------------------------------------------------------------------
{
  const f = await toFile(lb.id);
  ok('a downloaded logbook says it uses notes', f.editorial_notes === true, JSON.stringify(f.editorial_notes));
  const back = await createFromFile({ ...f, slug: 'notes-copy', title: 'Copy' });
  ok('and uploading it reproduces that',
    back.ok && (await L.logbookById(back.logbook.id)).editorial_notes_enabled === true,
    JSON.stringify(back.errors || back.reason));

  const off = await launched('notes-off');
  const offFile = await toFile(off.id);
  ok('a logbook that does not use notes carries no key for it',
    !('editorial_notes' in offFile),
    'a file from a plain logbook must look exactly as it did before 036');
}

// ---------------------------------------------------------------------
// THE MISTAKE THIS FILE'S MIGRATION MADE FIRST TIME.
//
// 036 adds four actions to self_service_log's CHECK. The first version
// restated the whole list from 001 and silently dropped 'erase', which 028
// had added in between — so erasing a reporter's contact details began
// failing with "Something went wrong", because the log insert in the same
// transaction violated a constraint this migration had narrowed.
//
// Asserted here rather than left to the erasure test to notice again,
// because the erasure test's failure named nothing about the constraint and
// took a while to read.
// ---------------------------------------------------------------------
{
  const { rows } = await pool.query(
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'self_service_log_action_check'",
  );
  const def = rows[0] ? rows[0].def : '';
  for (const action of ['correct', 'withdraw', 'restore', 'review', 'incident', 'media',
    'upload_rejected', 'severity', 'erase', 'veracity',
    'note', 'note_revised', 'note_state', 'note_link']) {
    ok(`the staff log still admits '${action}'`, new RegExp(`\\b${action}\\b`).test(def),
      'a migration narrowed the log under its own history');
  }
  // And the values are the bare strings. An earlier attempt parsed them out
  // of this very definition and wrote back `correct'::text`.
  ok('and the allowed values are bare strings, not mangled casts',
    !/::text,|'::text\}/.test(def.replace(/'\{|\}'::text\[\]/g, '')), def);
  // Every action the code actually writes has to be in there. The list above
  // is hand-written; this catches one added to a route and nowhere else.
  const used = await pool.query('SELECT DISTINCT action FROM self_service_log');
  for (const r of used.rows) {
    ok(`and '${r.action}', which is in the table, is allowed`,
      new RegExp(`\\b${r.action}\\b`).test(def));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
