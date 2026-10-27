/**
 * The switches a logbook carries that are not questions, as the builder and
 * the logbook file see them.
 *
 * Ports the half of legacy `editorial-notes-selftest` that
 * `editorial-notes.test.ts` left for workstream B: "the logbook file
 * carries the switch, both ways", check for check, plus the shipped
 * starting points that say `editorial_notes`. And checks the builder reads
 * `outside_access` and the freeze, which it shows and sets through other
 * workstreams' routes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/database.ts';
import { setOutsideAccess } from '../../src/identity/doors.ts';
import { createFromFile, toFile } from '../../src/logbooks/logbookFile.ts';
import * as L from '../../src/logbooks/logbooks.ts';
import { createFromStartingPoint } from '../../src/logbooks/templates.ts';
import * as N from '../../src/moderation/notes.ts';
import { launchedLogbook, testDatabase, uniqueSlug } from './helpers.ts';

const Q = [{ key: 'what_happened', kind: 'private_text', label: 'What happened', required: true }];
const EDITOR = 'editor@example.org';

let db: Database;
beforeAll(() => {
  db = testDatabase();
});
afterAll(async () => {
  await db.destroy();
});

describe('the logbook file carries the editorial-notes switch, both ways', () => {
  it('a downloaded logbook says it uses notes, and uploading it reproduces that', async () => {
    const lb = await launchedLogbook(db, Q);
    await N.setNotesEnabled(db, lb.id, true, EDITOR);
    const f = await toFile(db, lb.id);
    expect(f?.editorial_notes).toBe(true);

    const back = await createFromFile(
      db,
      { ...f, slug: uniqueSlug('notes-copy'), title: 'Copy' },
      { by: 'importer@example.org' },
    );
    expect(await N.notesEnabled(db, back.id)).toBe(true);
    const row = await db
      .selectFrom('logbook_editorial_notes')
      .select(['enabled', 'set_by'])
      .where('logbook_id', '=', back.id)
      .executeTakeFirstOrThrow();
    // Recorded as the person who uploaded it, not as the file.
    expect(row).toEqual({ enabled: true, set_by: 'importer@example.org' });
  });

  it('a logbook that does not use notes carries no key for it', async () => {
    const off = await launchedLogbook(db, Q);
    const offFile = await toFile(db, off.id);
    expect(offFile && 'editorial_notes' in offFile).toBe(false);

    // Turned on and off again is still off, and still no key.
    await N.setNotesEnabled(db, off.id, true, EDITOR);
    await N.setNotesEnabled(db, off.id, false, EDITOR);
    expect('editorial_notes' in ((await toFile(db, off.id)) ?? {})).toBe(false);
  });

  it('reads false as off, and writes no row for it', async () => {
    const lb = await createFromFile(db, {
      reportlog_logbook: 1,
      title: 'Notes said no',
      slug: uniqueSlug('notes-no'),
      editorial_notes: false,
      questions: Q,
    });
    expect(await N.notesEnabled(db, lb.id)).toBe(false);
    const rows = await db
      .selectFrom('logbook_editorial_notes')
      .select('logbook_id')
      .where('logbook_id', '=', lb.id)
      .execute();
    expect(rows).toEqual([]);
  });

  it('refuses a switch that is not true or false, with a sentence', async () => {
    await expect(
      createFromFile(db, {
        reportlog_logbook: 1,
        title: 'Notes said maybe',
        editorial_notes: 'yes',
        questions: Q,
      }),
    ).rejects.toThrow('"editorial_notes" must be true or false.');
  });

  it('a starting point that says so turns notes on, and one that says false does not', async () => {
    const on = await createFromStartingPoint(db, {
      starting_point: 'elections',
      title: 'Elections, with notes',
      slug: uniqueSlug('sp-on'),
      by: EDITOR,
    });
    expect(await N.notesEnabled(db, on.id)).toBe(true);
    const off = await createFromStartingPoint(db, {
      starting_point: 'workplace',
      title: 'Workplace, without',
      slug: uniqueSlug('sp-off'),
    });
    expect(await N.notesEnabled(db, off.id)).toBe(false);
  });

  it('a draft made with notes on can still be deleted, and its switch goes with it', async () => {
    // Found by the browser suite: the switch's table has no cascade, so a
    // draft from a starting point with notes on could not be deleted.
    const lb = await createFromStartingPoint(db, {
      starting_point: 'elections',
      title: 'Deleted draft',
      slug: uniqueSlug('sp-del'),
      by: EDITOR,
    });
    expect(await N.notesEnabled(db, lb.id)).toBe(true);
    await expect(L.deleteDraft(db, lb.id)).resolves.toBe(lb.slug);
    expect(await L.logbookById(db, lb.id)).toBeNull();
    expect(await N.notesEnabled(db, lb.id)).toBe(false);
  });

  it('a file from a plain logbook looks exactly as it did before the switch existed', async () => {
    const lb = await launchedLogbook(db, Q);
    const f = await toFile(db, lb.id);
    expect(Object.keys(f ?? {}).sort()).toEqual(
      ['accepts_files', 'questions', 'reportlog_logbook', 'slug', 'title'].sort(),
    );
  });
});

describe('what the builder reads beside the questions', () => {
  // DRAFTS, ON PURPOSE. The test database is shared by every file, and a
  // LAUNCHED logbook open outside the password opens the filing calls for
  // the whole site (identity/doors.ts), which filing-doors.test.ts checks
  // is not the case. The doors never count a draft; the builder shows the
  // setting either way.
  const draft = async (questions: { key: string; kind: string; label: string }[] = Q) => {
    const lb = await L.createLogbook(db, { title: 'Switches', slug: uniqueSlug('sw') });
    for (const q of questions) await L.addField(db, lb.id, q);
    return lb;
  };

  it('shows who can file without the password, as the door route set it', async () => {
    const lb = await draft();
    expect((await L.logbookById(db, lb.id))?.outside_access).toBe('closed');
    await setOutsideAccess(db, lb.slug, 'door');
    expect((await L.logbookById(db, lb.id))?.outside_access).toBe('door');
    await setOutsideAccess(db, lb.slug, 'link');
    expect((await L.listLogbooks(db)).find((l) => l.id === lb.id)?.outside_access).toBe('link');
    await setOutsideAccess(db, lb.slug, 'closed');
  });

  it('shows the freeze, and never puts either in the logbook file', async () => {
    const lb = await draft([...Q, { key: 'photos', kind: 'file', label: 'Photos' }]);
    await L.setFilesFrozen(db, lb.id, true);
    await setOutsideAccess(db, lb.slug, 'link');
    expect((await L.logbookById(db, lb.id))?.files_frozen_at).not.toBeNull();
    // Both are about this deployment, not about the questions: a copy made
    // elsewhere starts unfrozen and behind the password.
    const f = await toFile(db, lb.id);
    expect(JSON.stringify(f)).not.toMatch(/frozen|outside/);
    await setOutsideAccess(db, lb.slug, 'closed');
  });
});
