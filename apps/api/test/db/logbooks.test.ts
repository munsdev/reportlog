/**
 * Logbooks and their questions, against a real database. The port of
 * legacy/scripts/logbook-selftest.mjs.
 *
 * What needs Postgres is the part where the schema enforces something the
 * module cannot on its own: that a key is unique within its logbook and shaped
 * the way the seal requires, that a draft is not public, and that the one-way
 * door actually holds. The module refuses first, with a sentence; the
 * database is what holds if a path forgets to ask it.
 */
import { buildAnswers } from '@reportlog/fields';
import { canonicalJson } from '@reportlog/seal';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as L from '../../src/logbooks/logbooks.ts';
import { recordCardTexts } from '../../src/consent/cards.ts';
import { fileReport, testDatabase, uniqueSlug } from './helpers.ts';
import { addStoredQuestion } from '../support/stored-questions.ts';

const db = testDatabase();
// A report seals an answer to card wording the server recorded.
beforeAll(() => recordCardTexts(db));
afterAll(async () => {
  await db.destroy();
});

/** A promise that must be refused with this code, and a sentence. */
async function refused(p: Promise<unknown>, code: string) {
  const err: unknown = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected a refusal "${code}"`).toBeInstanceOf(L.LogbookRefusal);
  const r = err as L.LogbookRefusal;
  expect(r.code).toBe(code);
  // A sentence a person can read: a capital, some words, a full stop.
  expect(r.message).toMatch(/^[A-Z].{10,}[.]$/s);
  return r;
}

async function questionCount(id: number) {
  const row = await db
    .selectFrom('logbook_fields')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('logbook_id', '=', id)
    .executeTakeFirstOrThrow();
  return row.n;
}

describe('deleting one', () => {
  // THE ASYMMETRY IS THE WHOLE TEST. A draft is a half-built form. A launched
  // logbook is its own hash chain and is named on every anchor since.
  it('deletes a draft and its questions, and says so when there is nothing to delete', async () => {
    const draft = await L.createLogbook(db, { slug: uniqueSlug('doomed'), title: 'Doomed' });
    await addStoredQuestion(db, draft.id, { key: 'q', kind: 'short_text', label: 'Q' });
    expect(await questionCount(draft.id)).toBe(1);
    expect(await L.deleteDraft(db, draft.id)).toBe(draft.slug);
    expect(await questionCount(draft.id)).toBe(0);
    await refused(L.deleteDraft(db, draft.id), 'no-logbook');
  });

  it('never deletes a launched logbook, at any level', async () => {
    const live = await L.createLogbook(db, { slug: uniqueSlug('live'), title: 'Live' });
    await addStoredQuestion(db, live.id, { key: 'q', kind: 'short_text', label: 'Q' });
    await L.launch(db, live.id);
    await refused(L.deleteDraft(db, live.id), 'launched-not-deletable');
    expect(await L.logbookById(db, live.id)).not.toBeNull();
  });
});

describe('making one', () => {
  it('is a draft, with an address of its own', async () => {
    const slug = uniqueSlug('munich');
    const lb = await L.createLogbook(db, { title: 'Selftest: Munich 2026', slug });
    expect(lb.state).toBe('draft');
    await refused(L.createLogbook(db, { title: 'Again', slug }), 'slug-taken');
    await refused(L.createLogbook(db, { title: 'Bad', slug: 'Not A Slug' }), 'slug');
    await refused(L.createLogbook(db, { title: '   ' }), 'title');
  });

  it('makes the address from the title when none is given', async () => {
    const title = `Night shift ${uniqueSlug('t')}`;
    const lb = await L.createLogbook(db, { title });
    expect(lb.slug).toBe(L.slugify(title));
  });
});

describe('questions are made, not built in', () => {
  it('adds them in order, with keys from their labels, and only marked ones filter', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('qs'), title: 'Questions' });
    const when = await addStoredQuestion(db, lb.id, {
      kind: 'date',
      label: 'When did it happen?',
      required: true,
    });
    expect(when.key).toBe('when_did_it_happen');
    expect(
      (
        await addStoredQuestion(db, lb.id, {
          kind: 'place',
          label: 'Where it started',
          filterable: true,
        })
      ).filterable,
    ).toBe(true);
    // A SECOND PLACE FIELD: the thing a fixed column could never do.
    await addStoredQuestion(db, lb.id, {
      kind: 'place',
      label: 'Where it ended',
      filterable: true,
    });
    const notes = await addStoredQuestion(db, lb.id, {
      kind: 'long_text',
      label: 'Notes',
      filterable: true,
    });
    expect(notes.filterable, 'a filter flag on a type with no filter control').toBe(false);
    await refused(addStoredQuestion(db, lb.id, { kind: 'not_a_type', label: 'X' }), 'kind');
    await refused(
      addStoredQuestion(db, lb.id, { kind: 'date', label: 'When did it happen?' }),
      'key-taken',
    );
    await refused(addStoredQuestion(db, lb.id, { kind: 'date', label: '' }), 'label');
    await refused(
      addStoredQuestion(db, lb.id, { kind: 'date', label: 'X', key: 'Bad Key' }),
      'key',
    );

    const fields = await L.fieldsFor(db, lb.id);
    expect(fields.map((f) => f.key)).toEqual([
      'when_did_it_happen',
      'where_it_started',
      'where_it_ended',
      'notes',
    ]);
    const filters = await L.filterableFields(db, lb.id);
    expect(filters.map((f) => f.key)).toEqual(['where_it_started', 'where_it_ended']);

    // Answers, against the real field set.
    const defs = L.toDefinitions(fields);
    const built = buildAnswers(defs, {
      when_did_it_happen: '2026-11-03',
      where_it_started: 'Precinct 12',
      where_it_ended: 'The car park',
    });
    expect(built.answers?.where_it_started).toBe('Precinct 12');
    expect(built.answers?.where_it_ended).toBe('The car park');
    expect(built.answers && 'notes' in built.answers).toBe(false);
    expect(buildAnswers(defs, { where_it_started: 'X' }).errors).toHaveLength(1);
  });

  it('gives each type its default settings, and refuses settings that cannot work', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('set'), title: 'Settings' });
    const text = await addStoredQuestion(db, lb.id, { kind: 'short_text', label: 'Name' });
    expect(text.settings).toEqual({ maxLength: 200 });
    await refused(
      addStoredQuestion(db, lb.id, {
        kind: 'location',
        label: 'Where',
        settings: { scope: 'mars' },
      }),
      'location-scope',
    );
    await refused(
      addStoredQuestion(db, lb.id, {
        kind: 'location',
        label: 'Where',
        settings: { scope: 'world', depth: 'county' },
      }),
      'location-depth',
    );
    // `state` is what an absent depth means, so it is not stored (or sealed).
    const state = await addStoredQuestion(db, lb.id, {
      kind: 'location',
      label: 'Where',
      settings: { scope: 'us', depth: 'state' },
    });
    expect(state.settings).toEqual({ scope: 'us' });
    await refused(
      addStoredQuestion(db, lb.id, { kind: 'choice_one', label: 'Pick' }),
      'choice-options',
    );
    await refused(
      addStoredQuestion(db, lb.id, {
        kind: 'choice_one',
        label: 'Pick',
        settings: { options: ['A', ' '] },
      }),
      'choice-options',
    );
    const pick = await addStoredQuestion(db, lb.id, {
      kind: 'choice_one',
      label: 'Pick',
      settings: { options: [' A ', 'B'] },
    });
    expect(pick.settings.options).toEqual(['A', 'B']);
  });

  it('allows one upload question, never required and never conditional', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('files'), title: 'Files' });
    await refused(
      addStoredQuestion(db, lb.id, { kind: 'file', label: 'A photo', required: true }),
      'file-required',
    );
    await addStoredQuestion(db, lb.id, { kind: 'file', label: 'Photos' });
    expect((await L.logbookById(db, lb.id))?.asks_for_files).toBe(true);
    await refused(
      addStoredQuestion(db, lb.id, { kind: 'file', label: 'More files' }),
      'file-exists',
    );
  });
});

describe('the lifecycle', () => {
  it('will not launch a logbook that asks nothing', async () => {
    const empty = await L.createLogbook(db, { slug: uniqueSlug('empty'), title: 'Asks nothing' });
    await refused(L.launch(db, empty.id), 'no-fields');
  });

  it('launches once, and then the clock decides whether it is open', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('life'), title: 'Lifecycle' });
    expect(L.isAccepting(lb)).toBe(false);
    await addStoredQuestion(db, lb.id, { kind: 'short_text', label: 'What?' });
    const launched = await L.launch(db, lb.id);
    expect(launched.state).toBe('open');
    expect(launched.launched_at).not.toBeNull();
    await refused(L.launch(db, lb.id), 'already-launched');

    const day = 864e5;
    let live = await L.setSchedule(db, lb.id, {
      opensAt: new Date(Date.now() + day).toISOString(),
      closesAt: null,
    });
    expect(live.state, 'one that opens tomorrow').toBe('scheduled');
    live = await L.setSchedule(db, lb.id, {
      opensAt: new Date(Date.now() - day).toISOString(),
      closesAt: new Date(Date.now() - 1000).toISOString(),
    });
    // WITHOUT a timer having run: the clock is the only authority.
    expect(live.state, 'one whose closing time has passed').toBe('closed');
    await refused(
      L.setSchedule(db, lb.id, {
        opensAt: new Date(Date.now()).toISOString(),
        closesAt: new Date(Date.now() - day).toISOString(),
      }),
      'schedule-order',
    );
    await refused(
      L.setSchedule(db, lb.id, { opensAt: 'next tuesday', closesAt: null }),
      'schedule-time',
    );

    await L.setSchedule(db, lb.id, {
      opensAt: new Date(Date.now() - day).toISOString(),
      closesAt: null,
    });
    expect(
      (await L.setClosed(db, lb.id, true)).state,
      'a deliberate close beats the schedule',
    ).toBe('closed');
    expect((await L.setClosed(db, lb.id, false)).state, 'and reopening is one call').toBe('open');
  });

  it('cannot schedule or close a draft, because those are states of a launched logbook', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('ds'), title: 'Draft schedule' });
    await refused(L.setClosed(db, lb.id, true), 'not-launched');
    await refused(L.setSchedule(db, lb.id, { opensAt: null, closesAt: null }), 'not-launched');
  });

  it('lists a draft nowhere public, and a closed logbook only for the board', async () => {
    const draft = await L.createLogbook(db, { slug: uniqueSlug('hid'), title: 'Hidden' });
    const done = await L.createLogbook(db, { slug: uniqueSlug('done'), title: 'Done' });
    await addStoredQuestion(db, done.id, { kind: 'short_text', label: 'What?' });
    await L.launch(db, done.id);
    await L.setClosed(db, done.id, true);
    const open = (await L.openLogbooks(db)).map((l) => l.slug);
    const ever = (await L.launchedLogbooks(db)).map((l) => l.slug);
    expect(open).not.toContain(draft.slug);
    expect(ever).not.toContain(draft.slug);
    expect(open).not.toContain(done.slug);
    expect(ever).toContain(done.slug);
  });
});

describe('the one-way door', () => {
  it('refuses, in the module and with a reason, everything but an optional question', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('door'), title: 'Door' });
    await addStoredQuestion(db, lb.id, { kind: 'yes_no', label: 'Hurt?', key: 'hurt' });
    await addStoredQuestion(db, lb.id, { kind: 'short_text', label: 'Who?', key: 'who' });
    await L.launch(db, lb.id);
    const fields = await L.fieldsFor(db, lb.id);
    const [first] = fields;
    if (!first) throw new Error('no fields');

    const r = await refused(L.updateField(db, lb.id, first.id, { required: true }), 'launched');
    expect(r.status).toBe(409);
    await refused(L.removeField(db, lb.id, first.id), 'launched');
    await refused(
      L.updateField(db, lb.id, first.id, { shown_when: { field: 'who', in: ['x'] } }),
      'launched',
    );
    await refused(L.reorderFields(db, lb.id, fields.map((f) => f.id).reverse()), 'launched');

    // THE ONE OPENING, and why it is safe: a key enters the sealed object only
    // when it applies, so a question added now leaves every report already
    // filed hashing exactly as it did.
    await refused(
      addStoredQuestion(db, lb.id, { kind: 'short_text', label: 'Anything else?', required: true }),
      'launched-required',
    );
    const added = await addStoredQuestion(db, lb.id, {
      kind: 'short_text',
      label: 'Anything else?',
    });
    expect(added.required).toBe(false);

    const after = await L.fieldsFor(db, lb.id);
    expect(after.slice(0, fields.length)).toEqual(fields);

    // WORDING MAY CHANGE (ruling 48): a label and a help, as a new form version.
    const reworded = await L.updateField(db, lb.id, first.id, {
      label: 'Were you hurt?',
      help: 'More words',
    });
    expect([reworded.label, reworded.help]).toEqual(['Were you hurt?', 'More words']);
    expect(after.map((f) => f.key)).toEqual(['hurt', 'who', 'anything_else']);

    // Whether a question is a board filter is delivery, not meaning: it is not
    // in the form definition, so it stays the operator's after launch.
    const flagged = await L.updateField(db, lb.id, first.id, { filterable: true });
    expect(flagged.filterable).toBe(true);
  });

  it('is held by the database too, if a path forgets to ask the module', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('dbdoor'), title: 'DB door' });
    const f = await addStoredQuestion(db, lb.id, { kind: 'short_text', label: 'What?' });
    await L.launch(db, lb.id);
    // Wording may change after launch (ruling 48); what it is may not.
    await expect(
      db.updateTable('logbook_fields').set({ label: 'Reworded' }).where('id', '=', f.id).execute(),
    ).resolves.toBeDefined();
    await expect(
      db.updateTable('logbook_fields').set({ kind: 'long_text' }).where('id', '=', f.id).execute(),
    ).rejects.toThrow(/never changed/);
  });

  it('records the form version a launched logbook was launched with, and each one after', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('ver'), title: 'Versions' });
    await addStoredQuestion(db, lb.id, { kind: 'short_text', label: 'What?' });
    const count = async () =>
      (await db.selectFrom('logbook_forms').select('id').where('logbook_id', '=', lb.id).execute())
        .length;
    expect(await count()).toBe(0);
    await L.launch(db, lb.id);
    expect(await count()).toBe(1);
    await addStoredQuestion(db, lb.id, { kind: 'short_text', label: 'And then?' });
    expect(await count()).toBe(2);
  });

  it('serializes a launch against a change to the draft, so one of them wins whole', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('race'), title: 'Race' });
    const f = await addStoredQuestion(db, lb.id, { kind: 'short_text', label: 'What?' });
    const results = await Promise.allSettled([
      L.launch(db, lb.id),
      L.updateField(db, lb.id, f.id, { required: true }),
    ]);
    const launched = results[0].status === 'fulfilled';
    expect(launched).toBe(true);
    const [after] = await L.fieldsFor(db, lb.id);
    // Either the edit landed before the launch, or it was refused after it.
    if (results[1].status === 'rejected') {
      expect((results[1].reason as L.LogbookRefusal).code).toBe('launched');
      expect(after?.required).toBe(false);
    } else {
      expect(after?.required).toBe(true);
    }
  });
});

describe('the title is not the form', () => {
  it('stays editable after launch, and the slug never is', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('title'), title: 'Old title' });
    await addStoredQuestion(db, lb.id, { kind: 'short_text', label: 'What?' });
    await L.launch(db, lb.id);
    const renamed = await L.updateDetails(db, lb.id, {
      title: 'New title',
      blurb: 'Now with words',
    });
    expect([renamed.title, renamed.blurb, renamed.slug]).toEqual([
      'New title',
      'Now with words',
      lb.slug,
    ]);
    await expect(
      db.updateTable('logbooks').set({ slug: 'renamed' }).where('id', '=', lb.id).execute(),
    ).rejects.toThrow(/never changed/);
  });
});

describe('answers survive the round trip through jsonb', () => {
  // jsonb reorders keys and rewrites numbers. That is safe for one reason:
  // the value is an object both ways and RFC 8785 canonicalizes both sides.
  // If the storage type or the canonicalizer changes, this goes red first.
  const cases: [string, unknown][] = [
    ['keys out of order', { b: 'two', a: 'one' }],
    ['a trailing zero', { n: 1.5 }],
    ['an exponent', { x: 1e2, y: 1.0 }],
    ['a unicode escape', { s: 'Ab' }],
    ['a multiple choice', { tags: ['Police', 'Staff'] }],
    ['yes and no', { hurt: true, ok: false }],
    ['the largest safe integer', { n: 9007199254740991 }],
    ['float arithmetic', { n: 0.1 + 0.2 }],
    ['accents and emoji', { s: 'Müller 🚩 straße' }],
    ['an empty string', { s: '' }],
    ['text that looks like JSON', { s: '{"a":1}' }],
  ];
  for (const [what, value] of cases) {
    it(`${what} hashes the same after jsonb`, async () => {
      const { rows } = await sql<{
        j: unknown;
      }>`SELECT ${JSON.stringify(value)}::jsonb AS j`.execute(db);
      expect(canonicalJson(rows[0]?.j)).toBe(canonicalJson(value));
    });
  }
});

describe('the schema holds the line', () => {
  it('refuses a key that could not be sealed', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('key'), title: 'Keys' });
    await expect(
      db
        .insertInto('logbook_fields')
        .values({ logbook_id: lb.id, key: 'Bad Key', kind: 'date', label: 'X' })
        .execute(),
    ).rejects.toThrow(/logbook_fields_key_check/);
  });

  it('refuses a schedule on a draft even if a path forgets to ask', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('chk'), title: 'Check' });
    await expect(
      db.updateTable('logbooks').set({ closed_at: new Date() }).where('id', '=', lb.id).execute(),
    ).rejects.toThrow(/logbooks_schedule_needs_launch/);
  });
});

describe('a report filed against a logbook built here', () => {
  it('verifies', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('filed'), title: 'Filed' });
    await addStoredQuestion(db, lb.id, {
      kind: 'long_text',
      label: 'What happened',
      key: 'what',
      required: true,
    });
    await L.launch(db, lb.id);
    const questions = L.toDefinitions(await L.fieldsFor(db, lb.id));
    const r = await fileReport(db, lb, { what: 'It verifies.' }, { questions });
    expect(r.row.form_id).not.toBeNull();
  });
});
