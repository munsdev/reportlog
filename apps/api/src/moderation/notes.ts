/**
 * The archive's own statement about a report it published.
 *
 * NOT PART OF THE RECORD. Nothing here is hashed or chained, and the seal and
 * chain code may never reach this folder (a boundary rule). A report's
 * fingerprint covers what its reporter said; what the archive concluded about
 * it afterwards is the archive's own speech, and a report must not verify
 * differently because an editor corrected a sentence.
 *
 * WHAT IS IMMUTABLE IS THE HISTORY, NOT THE TEXT. Journalistic care includes
 * correcting things, so a note can be revised; every version is kept by the
 * database (append-only) and the current note is the newest one. A revision
 * shows as one.
 *
 * THE AUTHOR IS RECORDED AND THE BYLINE IS A HOUSE ONE. `author_email` is
 * stored, because an editorial record that cannot say who decided is not one,
 * and the public reads (`publicNoteFor`, `publicNotesForMany`, `linksFor`
 * with `forPublic`) never select it. That policy lives in the queries rather
 * than in a template, and a test reads this file to keep it so.
 *
 * PLAIN TEXT, never markdown or HTML: an HTML sanitizer on a public surface
 * is a dependency that earns security advisories, and blank lines as
 * paragraphs is all a note needs.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export const NOTE_STATES = ['published', 'under_review', 'withdrawn'] as const;
export type NoteState = (typeof NOTE_STATES)[number];

/**
 * What the public is told about a note that is not plainly published. The
 * note is still there, marked: silent removal is the thing this archive
 * exists to prevent, and that applies to its own material too.
 */
export const STATE_NOTICE: Record<Exclude<NoteState, 'published'>, string> = {
  under_review: 'This note is under editorial review.',
  withdrawn: 'This note has been withdrawn.',
};

export const MAX_BODY = 20000;
const MIN_BODY = 20;

/**
 * Check a note's text. A floor that is not one character: the note replaced
 * a one-word verdict, and "Probably true." fits in fifteen.
 */
export function validateBody(raw: unknown): string | null {
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (!body) return 'A note needs something in it.';
  if (body.length < MIN_BODY) {
    return 'A note has to say more than a verdict would. A sentence or two is the point of it.';
  }
  if (body.length > MAX_BODY) return `Please keep a note under ${String(MAX_BODY)} characters.`;
  return null;
}

export const isNoteState = (v: unknown): v is NoteState => NOTE_STATES.includes(v as NoteState);

// A correlated count, written as SQL because the outer alias is the point.
const versionCount = () =>
  sql<string>`(SELECT count(*) FROM editorial_note_versions x WHERE x.note_id = n.id)`;

/** The note on one report, in full, for staff: author, reason and state. */
export async function noteFor(db: Kysely<DB>, threadId: string) {
  const row = await db
    .selectFrom('editorial_notes as n')
    .innerJoin('editorial_note_versions as v', 'v.note_id', 'n.id')
    .select([
      'n.id',
      'n.thread_id',
      'n.state',
      'n.created_at',
      'n.updated_at',
      'v.body',
      'v.author_email',
      'v.revision_reason',
      'v.created_at as written_at',
      versionCount().as('versions'),
    ])
    .where('n.thread_id', '=', threadId)
    .orderBy('v.id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? { ...row, state: row.state as NoteState, versions: Number(row.versions) } : null;
}

export type PublicNote =
  | { state: 'published'; body: string; revised: boolean; versions: number; written_at: Date }
  | {
      state: 'under_review' | 'withdrawn';
      notice: string;
      revised: boolean;
      written_at: Date;
    };

function present(row: {
  state: string;
  body: string;
  versions: string | number | null;
  written_at: Date;
}): PublicNote {
  const versions = Number(row.versions ?? 1);
  // SO A REVISION SHOWS AS ONE. A note silently on its third version is the
  // archive editing its own published statement without saying so.
  const revised = versions > 1;
  if (row.state === 'published') {
    return { state: 'published', body: row.body, revised, versions, written_at: row.written_at };
  }
  const state = row.state === 'withdrawn' ? 'withdrawn' : 'under_review';
  return { state, notice: STATE_NOTICE[state], revised, written_at: row.written_at };
}

/**
 * The note as the public sees it. DOES NOT SELECT author_email. A note under
 * review or withdrawn still comes back, with its notice and without its text.
 */
export async function publicNoteFor(db: Kysely<DB>, threadId: string): Promise<PublicNote | null> {
  const row = await db
    .selectFrom('editorial_notes as n')
    .innerJoin('editorial_note_versions as v', 'v.note_id', 'n.id')
    .select(['n.state', 'v.body', 'v.created_at as written_at', versionCount().as('versions')])
    .where('n.thread_id', '=', threadId)
    .orderBy('v.id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? present(row) : null;
}

/** The notes on many reports at once, for the board: one query, public shape. */
export async function publicNotesForMany(
  db: Kysely<DB>,
  threadIds: readonly string[],
): Promise<Map<string, PublicNote>> {
  const out = new Map<string, PublicNote>();
  if (!threadIds.length) return out;
  const rows = await db
    .selectFrom('editorial_notes as n')
    .innerJoin('editorial_note_versions as v', 'v.note_id', 'n.id')
    .distinctOn('n.thread_id')
    .select([
      'n.thread_id',
      'n.state',
      'v.body',
      'v.created_at as written_at',
      versionCount().as('versions'),
    ])
    .where('n.thread_id', 'in', threadIds)
    .orderBy('n.thread_id')
    .orderBy('v.id', 'desc')
    .execute();
  for (const r of rows) out.set(r.thread_id, present(r));
  return out;
}

export type WriteNoteResult =
  | { ok: true; noteId: number; versions: number; state: NoteState }
  | { ok: false; reason: 'body'; message: string };

/**
 * Write a note, or a new version of one: the same act, appending what the
 * archive now says, so a "create" and an "update" cannot drift apart.
 */
export async function writeNote(
  db: Kysely<DB>,
  input: { threadId: string; body: unknown; authorEmail: string; revisionReason?: string | null },
): Promise<WriteNoteResult> {
  const problem = validateBody(input.body);
  if (problem) return { ok: false, reason: 'body', message: problem };
  if (!input.authorEmail) throw new Error('writeNote: an editorial note has to have an author');
  const body = (input.body as string).trim();
  const reason = input.revisionReason?.trim();
  return db.transaction().execute(async (trx) => {
    const note = await trx
      .insertInto('editorial_notes')
      .values({ thread_id: input.threadId })
      .onConflict((oc) => oc.column('thread_id').doUpdateSet({ updated_at: new Date() }))
      .returning(['id', 'state'])
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('editorial_note_versions')
      .values({
        note_id: note.id,
        body,
        author_email: input.authorEmail,
        revision_reason: reason?.length ? reason : null,
      })
      .execute();
    const { n } = await trx
      .selectFrom('editorial_note_versions')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('note_id', '=', note.id)
      .executeTakeFirstOrThrow();
    return {
      ok: true as const,
      noteId: note.id,
      versions: Number(n),
      state: note.state as NoteState,
    };
  });
}

/**
 * Move a note between states: the one mutable thing about it, because a note
 * goes under review when its author is removed and comes back afterwards.
 * What it SAID is append-only regardless.
 */
export async function setNoteState(
  db: Kysely<DB>,
  threadId: string,
  state: unknown,
): Promise<{ ok: true; state: NoteState } | { ok: false; reason: 'state' | 'no-note' }> {
  if (!isNoteState(state)) return { ok: false, reason: 'state' };
  const row = await db
    .updateTable('editorial_notes')
    .set({ state, updated_at: new Date() })
    .where('thread_id', '=', threadId)
    .returning('state')
    .executeTakeFirst();
  return row ? { ok: true, state: row.state as NoteState } : { ok: false, reason: 'no-note' };
}

/** Every version, oldest first: the editorial record, for staff. */
export async function versionsFor(db: Kysely<DB>, threadId: string) {
  return db
    .selectFrom('editorial_notes as n')
    .innerJoin('editorial_note_versions as v', 'v.note_id', 'n.id')
    .select(['v.id', 'v.body', 'v.author_email', 'v.revision_reason', 'v.created_at'])
    .where('n.thread_id', '=', threadId)
    .orderBy('v.id')
    .execute();
}

// ── citations ────────────────────────────────────────────────────────────

export type AddLinkResult =
  { ok: true; linkId: number } | { ok: false; reason: 'title' | 'url' | 'no-note' };

/**
 * Cite outside coverage beside a note. WHAT QUALIFIES is editorial policy,
 * not a check here. The SCHEME is checked, here and by the database: a
 * javascript: or data: address in an archive that renders links is an attack.
 */
export async function addLink(
  db: Kysely<DB>,
  input: {
    threadId: string;
    title: unknown;
    publisher?: unknown;
    publishedOn?: unknown;
    url: unknown;
    addedBy: string;
  },
): Promise<AddLinkResult> {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 300) return { ok: false, reason: 'title' };
  let url: URL;
  try {
    url = new URL(typeof input.url === 'string' ? input.url : '');
  } catch {
    return { ok: false, reason: 'url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'url' };
  if (!input.addedBy) throw new Error('addLink: a citation has to have somebody behind it');
  const note = await db
    .selectFrom('editorial_notes')
    .select('id')
    .where('thread_id', '=', input.threadId)
    .executeTakeFirst();
  if (!note) return { ok: false, reason: 'no-note' };
  const publisher = typeof input.publisher === 'string' ? input.publisher.trim().slice(0, 200) : '';
  const publishedOn =
    typeof input.publishedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.publishedOn)
      ? input.publishedOn
      : null;
  const row = await db
    .insertInto('editorial_note_links')
    .values({
      note_id: note.id,
      title,
      publisher: publisher || null,
      published_on: publishedOn,
      url: url.toString(),
      added_by: input.addedBy,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { ok: true, linkId: row.id };
}

/** Withdraw a citation on this thread's note. A timestamp, never a DELETE. */
export async function removeLink(
  db: Kysely<DB>,
  threadId: string,
  linkId: number,
): Promise<boolean> {
  const out = await db
    .updateTable('editorial_note_links')
    .set({ removed_at: new Date() })
    .where('id', '=', linkId)
    .where('removed_at', 'is', null)
    .where('note_id', '=', (eb) =>
      eb.selectFrom('editorial_notes').select('id').where('thread_id', '=', threadId),
    )
    .executeTakeFirst();
  return out.numUpdatedRows > 0n;
}

/**
 * The live citations on a note, for staff (with who added them). There is
 * no public twin: sources are shown only to staff and vetted journalists
 * (owner decision 37).
 */
export async function linksFor(db: Kysely<DB>, threadId: string) {
  return db
    .selectFrom('editorial_notes as n')
    .innerJoin('editorial_note_links as l', 'l.note_id', 'n.id')
    .select([
      'l.id',
      'l.title',
      'l.publisher',
      'l.published_on',
      'l.url',
      'l.added_by',
      'l.created_at',
    ])
    .where('n.thread_id', '=', threadId)
    .where('l.removed_at', 'is', null)
    .orderBy('l.id')
    .execute();
}

// ── the per-logbook switch ───────────────────────────────────────────────

/** Whether a logbook uses notes. Off unless an administrator said so. */
export async function notesEnabled(db: Kysely<DB>, logbookId: number): Promise<boolean> {
  const row = await db
    .selectFrom('logbook_editorial_notes')
    .select('enabled')
    .where('logbook_id', '=', logbookId)
    .executeTakeFirst();
  return row?.enabled === true;
}

export async function setNotesEnabled(
  db: Kysely<DB>,
  logbookId: number,
  enabled: boolean,
  byEmail: string,
): Promise<void> {
  await db
    .insertInto('logbook_editorial_notes')
    .values({ logbook_id: logbookId, enabled, set_by: byEmail })
    .onConflict((oc) =>
      oc.column('logbook_id').doUpdateSet({ enabled, set_by: byEmail, set_at: new Date() }),
    )
    .execute();
}
