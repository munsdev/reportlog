/**
 * The archive's own statement about a report, against a real database. Port
 * of legacy scripts/editorial-notes-selftest.mjs.
 *
 * THE TWO CHECKS THAT MUST NEVER GO RED:
 *   - the public reads do not select author_email (the byline is a house one);
 *   - a withdrawn report's note is still there (if a note followed its report,
 *     pressuring a reporter would be a way to erase the editorial record).
 *
 * The logbook FILE carrying the switch (legacy `toFile` / `createFromFile`)
 * is checked in `logbook-file-switches.test.ts`, which workstream B's file
 * format made possible.
 */
import type { FieldDefinition } from '@reportlog/fields';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import type { Database } from '../../src/db/database.ts';
import * as N from '../../src/moderation/notes.ts';
import { launchedLogbook, testDatabase } from './helpers.ts';
import { fileThread } from './moderation-helpers.ts';
import type { Thread } from './moderation-helpers.ts';

const Q: FieldDefinition[] = [{ key: 'what_happened', kind: 'long_text', label: 'What happened' }];
const EDITOR = 'editor@example.org';
const OTHER = 'second-editor@example.org';
const SAY =
  'The county office confirmed the machine was replaced at 10:40. ' +
  'We have not established why the line was not told.';

let db: Database;
let lb: { id: number; slug: string };
let t: Thread;

beforeAll(async () => {
  db = testDatabase();
  lb = await launchedLogbook(db, Q);
  t = await fileThread(db, lb, Q, {
    what_happened: 'The machine went down and the line was not told.',
  });
});
afterAll(async () => {
  await db.destroy();
});

describe('the switch', () => {
  it('a logbook does not use notes unless somebody says so, and the switch turns them on', async () => {
    expect(await N.notesEnabled(db, lb.id)).toBe(false);
    await N.setNotesEnabled(db, lb.id, true, 'admin@example.org');
    expect(await N.notesEnabled(db, lb.id)).toBe(true);
  });
});

describe('writing one, and the floor under what counts as a note', () => {
  it('refuses a verdict-length note and an empty one, accepts a real statement', () => {
    expect(N.validateBody('Probably true.')).not.toBeNull();
    expect(N.validateBody('')).not.toBeNull();
    expect(N.validateBody(SAY)).toBeNull();
  });

  it('writes a note, published by default, with its author recorded', async () => {
    expect(
      await N.writeNote(db, { threadId: t.threadId, body: SAY, authorEmail: EDITOR }),
    ).toMatchObject({
      ok: true,
      versions: 1,
    });
    const note = await N.noteFor(db, t.threadId);
    expect(note?.author_email).toBe(EDITOR);
    expect(note?.state).toBe('published');
  });
});

describe('revision: append-only, and the projection', () => {
  const second = `${SAY} The office has since said the delay was a staffing one.`;
  it('a revision appends a version and becomes the current note', async () => {
    const out = await N.writeNote(db, {
      threadId: t.threadId,
      body: second,
      authorEmail: OTHER,
      revisionReason: 'The office came back to us.',
    });
    expect(out).toMatchObject({ ok: true, versions: 2 });
    const note = await N.noteFor(db, t.threadId);
    expect(note?.body).toBe(second);
    expect(note?.author_email).toBe(OTHER);
  });

  it('keeps both versions, oldest first, each with its own author and reason', async () => {
    const versions = await N.versionsFor(db, t.threadId);
    expect(versions.map((v) => v.body)).toEqual([SAY, second]);
    // A revision must not rewrite who wrote what came before.
    expect(versions[0]?.author_email).toBe(EDITOR);
    expect(versions[1]?.revision_reason).toBe('The office came back to us.');
  });
});

describe('APPEND-ONLY AT THE DATABASE, not by convention', () => {
  it('a version cannot be rewritten or deleted, and a note cannot be deleted', async () => {
    await expect(
      db
        .updateTable('editorial_note_versions')
        .set({ body: 'rewritten, quietly, after the fact' })
        .execute(),
    ).rejects.toThrow();
    await expect(db.deleteFrom('editorial_note_versions').execute()).rejects.toThrow();
    await expect(
      db.deleteFrom('editorial_notes').where('thread_id', '=', t.threadId).execute(),
    ).rejects.toThrow();
  });

  it('the database refuses a verdict-length body even if the module is bypassed', async () => {
    const note = await N.noteFor(db, t.threadId);
    await expect(
      db
        .insertInto('editorial_note_versions')
        .values({ note_id: note?.id ?? 0, body: 'Probably true.', author_email: EDITOR })
        .execute(),
    ).rejects.toThrow();
  });
});

describe('THE BYLINE: the public shape carries no address', () => {
  it('the public note carries the text and not the author, and says it was revised', async () => {
    const pub = await N.publicNoteFor(db, t.threadId);
    expect(pub && 'body' in pub && typeof pub.body).toBe('string');
    expect(pub && 'author_email' in pub).toBe(false);
    expect(JSON.stringify(pub)).not.toContain('@');
    expect(pub?.revised).toBe(true);
    const many = await N.publicNotesForMany(db, [t.threadId]);
    expect(JSON.stringify([...many.values()])).not.toContain('@');
  });

  it('the public queries never name author_email or added_by in their SQL', () => {
    // The policy in the query rather than a template. A select-all here would
    // put a moderator's address one careless response away from the board.
    const src = readFileSync(new URL('../../src/moderation/notes.ts', import.meta.url), 'utf8');
    const body = (name: string) => {
      const start = src.indexOf(`export async function ${name}(`);
      const next = src.indexOf('\nexport ', start + 1);
      return src.slice(start, next < 0 ? undefined : next);
    };
    for (const fn of ['publicNoteFor', 'publicNotesForMany']) {
      expect(body(fn).length).toBeGreaterThan(50);
      expect(body(fn)).not.toMatch(/author_email|added_by|selectAll/);
    }
  });
});

describe('states: under review is visible; withdrawn holds the text, not the fact', () => {
  it('moves through the states, holding back only the text', async () => {
    await N.setNoteState(db, t.threadId, 'under_review');
    const pub = await N.publicNoteFor(db, t.threadId);
    expect(pub?.state).toBe('under_review');
    expect(pub && 'notice' in pub && pub.notice).toBeTruthy();
    expect(pub && 'body' in pub).toBe(false);

    await N.setNoteState(db, t.threadId, 'withdrawn');
    expect((await N.publicNoteFor(db, t.threadId))?.state).toBe('withdrawn');
    await N.setNoteState(db, t.threadId, 'published');
    expect((await N.publicNoteFor(db, t.threadId))?.state).toBe('published');
    expect((await N.setNoteState(db, t.threadId, 'deleted')).ok).toBe(false);
  });
});

describe('THE ONE THAT MATTERS MOST: a withdrawn REPORT does not take its note', () => {
  it('withdrawing the report leaves the note exactly as it was', async () => {
    await db
      .updateTable('report_heads')
      .set({ withdrawn: true })
      .where('thread_id', '=', t.threadId)
      .execute();
    const note = await N.noteFor(db, t.threadId);
    expect(note?.state).toBe('published');
    expect(note?.body).toContain('staffing one');
    await db
      .updateTable('report_heads')
      .set({ withdrawn: false })
      .where('thread_id', '=', t.threadId)
      .execute();
  });
});

describe('citations', () => {
  it('adds one, refuses a javascript: URL and a note-less report, and hides who added it', async () => {
    const add = await N.addLink(db, {
      threadId: t.threadId,
      title: 'County says machine replaced at 10:40',
      publisher: 'Example Herald',
      publishedOn: '2026-11-04',
      url: 'https://example.org/story',
      addedBy: EDITOR,
    });
    expect(add.ok).toBe(true);
    expect(
      (
        await N.addLink(db, {
          threadId: t.threadId,
          title: 'x',
          url: 'javascript:alert(1)',
          addedBy: EDITOR,
        })
      ).ok,
    ).toBe(false);
    const other = await fileThread(db, lb, Q, { what_happened: 'No note here.' });
    expect(
      await N.addLink(db, {
        threadId: other.threadId,
        title: 'x',
        url: 'https://example.org',
        addedBy: EDITOR,
      }),
    ).toEqual({ ok: false, reason: 'no-note' });

    // Sources are staff-only (decision 37): no public twin of `linksFor` exists.
    expect('publicLinksFor' in N).toBe(false);
    const links = await N.linksFor(db, t.threadId);
    expect(links).toHaveLength(1);
    expect(links[0]?.title).toMatch(/^County says/);

    if (!add.ok) throw new Error('unreachable');
    expect(await N.removeLink(db, t.threadId, add.linkId)).toBe(true);
    expect(await N.linksFor(db, t.threadId)).toHaveLength(0);
    // But the row says it was cited.
    const row = await db
      .selectFrom('editorial_note_links')
      .select('removed_at')
      .where('id', '=', add.linkId)
      .executeTakeFirstOrThrow();
    expect(row.removed_at).not.toBeNull();
  });

  it('the database refuses a javascript: URL, a deleted citation and a revived one', async () => {
    const note = await N.noteFor(db, t.threadId);
    await expect(
      db
        .insertInto('editorial_note_links')
        .values({
          note_id: note?.id ?? 0,
          title: 'x',
          url: 'javascript:alert(1)',
          added_by: EDITOR,
        })
        .execute(),
    ).rejects.toThrow();
    await expect(db.deleteFrom('editorial_note_links').execute()).rejects.toThrow();
    await expect(
      db.updateTable('editorial_note_links').set({ removed_at: null }).execute(),
    ).rejects.toThrow();
  });
});

describe("AND NONE OF IT TOUCHES THE REPORT'S FINGERPRINT", () => {
  it('the report still verifies, and no sealed key relates to the archive’s own speech', async () => {
    const v = await verifyReport(db, t.publicRef);
    expect(v && v.content.ok && v.link.ok && v.position.ok).toBe(true);
    const keys = Object.keys(v?.hashed_fields ?? {});
    expect(keys.some((k) => /note|editorial|byline|flag|review/i.test(k))).toBe(false);
  });
});

describe('the staff log admits every action the code writes', () => {
  // Legacy's migration once restated a CHECK list and silently dropped an
  // action; the failure surfaced far away as "Something went wrong".
  it('every action written by moderation/ is in moderation_log’s CHECK', async () => {
    const { rows } = await import('kysely').then(({ sql }) =>
      sql<{ def: string }>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'moderation_log'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%action%'`.execute(
        db,
      ),
    );
    const def = rows.map((r) => r.def).join(' ');
    const src = ['queue.ts', 'routes.ts']
      .map((f) => readFileSync(new URL(`../../src/moderation/${f}`, import.meta.url), 'utf8'))
      .join('\n');
    // Every quoted word on an `action:` line, ternaries included.
    const written = [...src.matchAll(/action:[^,\n]*/g)].flatMap((m) =>
      [...m[0].matchAll(/'([a-z_]+)'/g)].map((w) => w[1] ?? ''),
    );
    expect(written.length).toBeGreaterThan(4);
    for (const action of new Set(written)) expect(def).toContain(`'${action}'`);
  });
});
