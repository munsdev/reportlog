/**
 * The archive's own statement about a report it published.
 *
 * NOT PART OF THE RECORD. Nothing here is hashed, nothing here is chained,
 * and `reportCore.js`, `verify.js`, `chainFile.js` and `snapshot.js` must
 * never import this file — `npm test` fails if any of them does, exactly as
 * it does for `reportPermissions.js`. A report's fingerprint covers what its
 * reporter said. What the archive concluded about it afterwards is the
 * archive's own speech, and a report must not verify differently because an
 * editor corrected a sentence.
 *
 * WHY IT IS NOT HASHED, which is the decision the whole feature turns on.
 * Permanence decides where a value lives: hash what must never change, and
 * put what may change where changing it is recorded. **Journalistic care
 * includes correcting things.** A note frozen at publication is a mistake
 * nobody can fix — the first time the archive had to correct its own
 * published statement it would have to choose between leaving an error up
 * and breaking a seal.
 *
 * SO WHAT IS IMMUTABLE IS THE HISTORY, NOT THE TEXT. Versions are
 * append-only and every one of them is published, so a change to the
 * archive's own statement shows as a change. The current note is a
 * PROJECTION over the versions — newest row wins — the same shape
 * `report_permissions_log` uses and for the same reason.
 *
 * THE AUTHOR IS RECORDED AND THE BYLINE IS A HOUSE ONE. Decided 4 October.
 * Moderator identity is protected everywhere else in this system, and a
 * published note carrying somebody's name would make the one place it is
 * not; neither Dutch nor German practice requires individual names where a
 * responsible editor is named. So `author_email` is stored, because an
 * editorial record that cannot say who decided is not one — and
 * `publicNoteFor` does not select it. Two visibilities, one stored author.
 */
import { pool } from './db.js';

/** The three states a note can be in. */
export const PUBLISHED = 'published';
/**
 * For a note whose author was removed for breaching the charter. Visible as
 * such, NOT deleted: silent removal is the thing this archive exists to
 * prevent, and that applies to our own material too.
 */
export const UNDER_REVIEW = 'under_review';
/**
 * The chief editor's decision to take a note down. NOT an automatic
 * consequence of the reporter withdrawing their report — if a note followed
 * its report, pressuring a reporter would become a way to erase the
 * editorial record, which is the suppression route the chain design exists
 * to close.
 */
export const WITHDRAWN = 'withdrawn';

export const STATES = [PUBLISHED, UNDER_REVIEW, WITHDRAWN];

/** What the public is told about a note that is not plainly published. */
export const STATE_NOTICE = {
  [UNDER_REVIEW]: 'This note is under editorial review.',
  [WITHDRAWN]: 'This note has been withdrawn.',
};

/**
 * PLAIN TEXT, not markdown, and the reason is a dependency count.
 *
 * The design asked for restricted rich text or markdown sanitised on render.
 * Doing that honestly needs a parser and an HTML sanitiser; this application
 * has seven dependencies, and an HTML sanitiser is the kind that earns CVEs
 * — on a surface where the input is staff-authored and the output is public.
 *
 * So a note is escaped and its blank lines become paragraphs, which is the
 * formatting an editorial note actually needs. A source that needs citing
 * goes in the citations table, where it is checkable, rather than as a link
 * buried in a sentence.
 */
export const BODY_IS_PLAIN_TEXT = true;

export const MAX_BODY = 20000;
const MIN_BODY = 20;

/**
 * Check a note's text before it is stored.
 *
 * A MINIMUM THAT IS NOT ONE CHARACTER. The note exists to be a considered
 * statement somebody can defend, and the thing it replaced was a two-word
 * verdict. A twenty-character floor does not make a note good, but it does
 * stop the feature quietly becoming the verdict again under a new name —
 * "Probably true." fits in fifteen.
 */
export function validateBody(raw) {
  const body = String(raw || '').trim();
  if (!body) return 'A note needs something in it.';
  if (body.length < MIN_BODY) {
    return 'A note has to say more than a verdict would. This replaced a '
      + 'one-word judgement; a sentence or two is the point of it.';
  }
  if (body.length > MAX_BODY) return `Please keep a note under ${MAX_BODY} characters.`;
  return null;
}

/**
 * The note on one report, in full, for staff.
 *
 * Carries the author, every version's reason, and the state — everything the
 * editorial record holds. Never handed to a public route.
 */
export async function noteFor(threadId, client = pool) {
  const { rows } = await client.query(
    `SELECT n.id, n.thread_id, n.state, n.created_at, n.updated_at,
            v.body, v.author_email, v.revision_reason, v.created_at AS written_at,
            (SELECT count(*)::int FROM editorial_note_versions x WHERE x.note_id = n.id) AS versions
     FROM editorial_notes n
     JOIN editorial_note_versions v ON v.note_id = n.id
     WHERE n.thread_id = $1
     ORDER BY v.id DESC
     LIMIT 1`,
    [threadId],
  );
  return rows[0] || null;
}

/**
 * The note on one report as the public sees it.
 *
 * DOES NOT SELECT author_email, and that is the byline policy expressed in
 * SQL rather than in a template somebody can forget. A `SELECT *` here would
 * put a moderator's address one careless `res.json` away from the public
 * board. The suite asserts this query never names the column.
 *
 * A note that is under review or withdrawn still returns — with its notice
 * and without its body, because the fact that the archive said something and
 * then marked it is itself part of the record. Only the text is held back.
 */
export async function publicNoteFor(threadId, client = pool) {
  const { rows } = await client.query(
    `SELECT n.state, n.updated_at,
            v.body, v.created_at AS written_at,
            (SELECT count(*)::int FROM editorial_note_versions x WHERE x.note_id = n.id) AS versions
     FROM editorial_notes n
     JOIN editorial_note_versions v ON v.note_id = n.id
     WHERE n.thread_id = $1
     ORDER BY v.id DESC
     LIMIT 1`,
    [threadId],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.state !== PUBLISHED) {
    return {
      state: row.state,
      notice: STATE_NOTICE[row.state] || null,
      revised: row.versions > 1,
      written_at: row.written_at,
    };
  }
  return {
    state: row.state,
    body: row.body,
    // SO A REVISION SHOWS AS ONE. A note silently on its third version is
    // the archive editing its own published statement without saying so.
    revised: row.versions > 1,
    versions: row.versions,
    written_at: row.written_at,
  };
}

/**
 * Write a note, or a new version of one.
 *
 * One call for both, because they are the same act: appending what the
 * archive now says. The caller does not have to know whether a note already
 * exists, which is what stops a "create" route and an "update" route
 * drifting apart on validation.
 */
export async function writeNote(
  { threadId, body, authorEmail, revisionReason = null }, client = pool,
) {
  const problem = validateBody(body);
  if (problem) return { ok: false, reason: 'body', message: problem };
  if (!authorEmail) throw new Error('writeNote: an editorial note has to have an author');

  const own = client === pool;
  const c = own ? await client.connect() : client;
  try {
    if (own) await c.query('BEGIN');
    const { rows: [note] } = await c.query(
      `INSERT INTO editorial_notes (thread_id) VALUES ($1)
       ON CONFLICT (thread_id) DO UPDATE SET updated_at = now()
       RETURNING id, state`,
      [threadId],
    );
    const { rows: [version] } = await c.query(
      `INSERT INTO editorial_note_versions (note_id, body, author_email, revision_reason)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [note.id, String(body).trim(), authorEmail, revisionReason || null],
    );
    const { rows: [{ n }] } = await c.query(
      'SELECT count(*)::int AS n FROM editorial_note_versions WHERE note_id = $1',
      [note.id],
    );
    if (own) await c.query('COMMIT');
    return { ok: true, noteId: note.id, versionId: version.id, versions: n, state: note.state };
  } catch (e) {
    if (own) await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (own) c.release();
  }
}

/**
 * Move a note between states.
 *
 * The state is the one mutable thing about a note, because it has to be: a
 * note goes under review when its author is removed and comes back when
 * that is resolved. What it SAID is append-only regardless, which is the
 * part that matters.
 */
export async function setState(threadId, state, client = pool) {
  if (!STATES.includes(state)) return { ok: false, reason: 'state' };
  const { rows } = await client.query(
    `UPDATE editorial_notes SET state = $1, updated_at = now()
     WHERE thread_id = $2 RETURNING id, state`,
    [state, threadId],
  );
  return rows[0] ? { ok: true, note: rows[0] } : { ok: false, reason: 'no-note' };
}

/** Every version of a note, oldest first — the editorial record, for staff. */
export async function versionsFor(threadId, client = pool) {
  const { rows } = await client.query(
    `SELECT v.id, v.body, v.author_email, v.revision_reason, v.created_at
     FROM editorial_notes n JOIN editorial_note_versions v ON v.note_id = n.id
     WHERE n.thread_id = $1 ORDER BY v.id`,
    [threadId],
  );
  return rows;
}

/**
 * The notes on many reports at once, for the board.
 *
 * One query rather than one per card: a list view that fetches per row is
 * how a board gets slow quietly, which is the same reasoning
 * `permissionsForMany` carries. Public shape — no author.
 */
export async function publicNotesForMany(threadIds, client = pool) {
  const out = new Map();
  if (!threadIds || !threadIds.length) return out;
  const { rows } = await client.query(
    `SELECT DISTINCT ON (n.thread_id) n.thread_id, n.state, v.body, v.created_at AS written_at,
            (SELECT count(*)::int FROM editorial_note_versions x WHERE x.note_id = n.id) AS versions
     FROM editorial_notes n JOIN editorial_note_versions v ON v.note_id = n.id
     WHERE n.thread_id = ANY($1::uuid[])
     ORDER BY n.thread_id, v.id DESC`,
    [threadIds],
  );
  for (const r of rows) {
    out.set(r.thread_id, r.state === PUBLISHED
      ? { state: r.state, body: r.body, revised: r.versions > 1, written_at: r.written_at }
      : { state: r.state, notice: STATE_NOTICE[r.state] || null, revised: r.versions > 1 });
  }
  return out;
}

/* ---- external links ------------------------------------------------- */

/**
 * Cite a piece of outside coverage beside a note.
 *
 * WHAT QUALIFIES IS EDITORIAL POLICY AND NOT A CHECK HERE. The charter says
 * what a linkable source is, because a link to a partisan outlet does more
 * damage to the non-partisan claim than the note does good — and a list of
 * approved domains in code would be both wrong within a month and an
 * assertion the software has no business making.
 *
 * The scheme IS checked, in code and again by the database: a `javascript:`
 * or `data:` URL in an archive that renders links is an attack, not an
 * address.
 */
export async function addLink(
  { threadId, title, publisher = null, publishedOn = null, url, addedBy }, client = pool,
) {
  const t = String(title || '').trim();
  if (!t || t.length > 300) return { ok: false, reason: 'title' };
  let u;
  try { u = new URL(String(url || '')); } catch { return { ok: false, reason: 'url' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'url' };
  if (!addedBy) throw new Error('addLink: a citation has to have somebody behind it');

  const { rows: [note] } = await client.query(
    'SELECT id FROM editorial_notes WHERE thread_id = $1', [threadId],
  );
  if (!note) return { ok: false, reason: 'no-note' };

  const { rows } = await client.query(
    `INSERT INTO editorial_note_links (note_id, title, publisher, published_on, url, added_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [note.id, t, publisher ? String(publisher).trim().slice(0, 200) : null,
      publishedOn || null, u.toString(), addedBy],
  );
  return { ok: true, linkId: rows[0].id };
}

/** Withdraw a citation. A timestamp, not a DELETE: the row says it was cited. */
export async function removeLink(linkId, client = pool) {
  const { rowCount } = await client.query(
    'UPDATE editorial_note_links SET removed_at = now() WHERE id = $1 AND removed_at IS NULL',
    [Number(linkId) || 0],
  );
  return rowCount > 0;
}

/** The live citations on a note. `added_by` is staff and is not public. */
export async function linksFor(threadId, { forPublic = false } = {}, client = pool) {
  const { rows } = await client.query(
    `SELECT l.id, l.title, l.publisher, l.published_on, l.url
            ${forPublic ? '' : ', l.added_by, l.created_at'}
     FROM editorial_notes n JOIN editorial_note_links l ON l.note_id = n.id
     WHERE n.thread_id = $1 AND l.removed_at IS NULL
     ORDER BY l.id`,
    [threadId],
  );
  return rows;
}
