/**
 * Questions that are only asked sometimes, against a real database. The port
 * of legacy/scripts/conditions-selftest.mjs.
 *
 * The pure half (what a condition means, what normalizeCondition refuses) is
 * in packages/fields. This is the part where a condition travels: stored on a
 * question, carried through a logbook file, sealed into the form definition,
 * and honoured by a report that is actually filed and verified.
 *
 * THE CHECK THAT MATTERS MOST IS THE LAST ONE: a logbook with no conditions
 * must hash exactly as it would have before conditions existed.
 */
import { buildAnswers } from '@reportlog/fields';
import { formText } from '@reportlog/seal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import { createFromFile, toFile } from '../../src/logbooks/logbookFile.ts';
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

async function refusal(p: Promise<unknown>): Promise<L.LogbookRefusal> {
  const err: unknown = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(L.LogbookRefusal);
  return err as L.LogbookRefusal;
}

let id: number;
let slug: string;
let gateId: number;
let dependentId: number;

describe('authoring', () => {
  beforeAll(async () => {
    slug = uniqueSlug('cond');
    id = (await L.createLogbook(db, { title: 'Conditions', slug })).id;
    gateId = (
      await L.addField(db, id, {
        kind: 'yes_no',
        label: 'Do you have photos, video, audio or documents?',
        key: 'has_files',
        required: true,
      })
    ).id;
  });

  it('refuses a condition naming a question that does not exist yet', async () => {
    const r = await refusal(
      L.addField(db, id, {
        kind: 'private_text',
        label: 'Too early',
        key: 'too_early',
        shown_when: { field: 'not_yet', in: ['yes'] },
      }),
    );
    expect(r.code).toBe('shown-when-unknown-field');
  });

  it('stores a condition on an earlier question', async () => {
    const dependent = await L.addField(db, id, {
      kind: 'private_text',
      label: 'What is it of?',
      key: 'clip_of',
      shown_when: { field: 'has_files', in: [' yes '] },
    });
    dependentId = dependent.id;
    expect(dependent.shown_when).toEqual({ field: 'has_files', in: ['yes'] });
  });

  it('refuses a condition on free prose, and creates nothing', async () => {
    await L.addField(db, id, { kind: 'private_text', label: 'Account', key: 'account' });
    const r = await refusal(
      L.addField(db, id, {
        kind: 'private_text',
        label: 'No',
        key: 'nope',
        shown_when: { field: 'account', in: ['police'] },
      }),
    );
    expect(r.code).toBe('shown-when-kind');
    expect((await L.fieldsFor(db, id)).some((f) => f.key === 'nope')).toBe(false);
  });

  it('refuses a condition on an answer that question cannot give, and names it', async () => {
    const r = await refusal(
      L.addField(db, id, {
        kind: 'private_text',
        label: 'No',
        key: 'nope2',
        shown_when: { field: 'has_files', in: ['maybe'] },
      }),
    );
    expect(r.code).toBe('shown-when-unknown-value');
    expect(r.message).toContain('“maybe”');
  });

  it('lets an upload question be asked about nothing, and carry no condition', async () => {
    const r = await refusal(
      L.addField(db, id, {
        kind: 'file',
        label: 'Photos',
        key: 'files',
        shown_when: { field: 'has_files', in: ['yes'] },
      }),
    );
    expect(r.code).toBe('shown-when-unsupported-kind');
    await L.addField(db, id, { kind: 'file', label: 'Photos', key: 'files' });
  });

  it('will not let a question depend on itself', async () => {
    const r = await refusal(
      L.updateField(db, id, dependentId, { shown_when: { field: 'clip_of', in: ['yes'] } }),
    );
    expect(r.code).toBe('shown-when-unknown-field');
  });

  // Three ways to break a condition AFTER it was written. The legacy module
  // allowed all three and left a question that could never be asked.
  it('will not remove a question another one depends on', async () => {
    const r = await refusal(L.removeField(db, id, gateId));
    expect(r.code).toBe('depended-on');
    expect(r.message).toContain('What is it of?');
  });

  it('will not reorder a question in front of the one it depends on', async () => {
    const fields = await L.fieldsFor(db, id);
    const ids = fields.map((f) => f.id);
    const r = await refusal(
      L.reorderFields(db, id, [dependentId, ...ids.filter((x) => x !== dependentId)]),
    );
    expect(r.code).toBe('order-breaks-condition');
  });

  it('will not take away an answer a condition is waiting for', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('opts'), title: 'Options' });
    const role = await L.addField(db, lb.id, {
      kind: 'choice_one',
      label: 'Your role',
      key: 'role',
      settings: { options: ['Voter', 'Observer'] },
    });
    await L.addField(db, lb.id, {
      kind: 'private_text',
      label: 'Which organisation?',
      key: 'org',
      shown_when: { field: 'role', in: ['Observer'] },
    });
    const r = await refusal(
      L.updateField(db, lb.id, role.id, { settings: { options: ['Voter'] } }),
    );
    expect(r.code).toBe('breaks-condition');
    await L.updateField(db, lb.id, role.id, {
      settings: { options: ['Voter', 'Observer', 'Staff'] },
    });
  });

  it('turns a condition off again with null', async () => {
    const lb = await L.createLogbook(db, { slug: uniqueSlug('off'), title: 'Off' });
    await L.addField(db, lb.id, { kind: 'yes_no', label: 'Hurt?', key: 'hurt' });
    const q = await L.addField(db, lb.id, {
      kind: 'private_text',
      label: 'How?',
      key: 'how',
      shown_when: { field: 'hurt', in: ['yes'] },
    });
    expect((await L.updateField(db, lb.id, q.id, { shown_when: null })).shown_when).toBeNull();
  });
});

describe('the logbook file carries it, both ways', () => {
  it('downloads with the condition, and without a key where there is none', async () => {
    const file = await toFile(db, id);
    if (!file) throw new Error('no file');
    expect(file.questions.find((x) => x.key === 'clip_of')?.shown_when).toEqual({
      field: 'has_files',
      in: ['yes'],
    });
    const plain = file.questions.find((x) => x.key === 'has_files');
    expect(plain && 'shown_when' in plain).toBe(false);

    const back = await createFromFile(db, { ...file, slug: uniqueSlug('copy'), title: 'Copy' });
    const copied = await L.fieldsFor(db, back.id);
    expect(copied.find((f) => f.key === 'clip_of')?.shown_when).toEqual({
      field: 'has_files',
      in: ['yes'],
    });
  });
});

describe('a question nobody was asked seals nothing', () => {
  let questions: ReturnType<typeof L.toDefinitions>;
  beforeAll(async () => {
    // These two were authored above as held notes, which is all `addField`
    // allows now. This part is about what a SEALED text answer does when it
    // was not asked, so before launch they become the sealed kinds a
    // logbook made earlier still holds (a draft allows it).
    for (const [key, kind] of [
      ['clip_of', 'short_text'],
      ['account', 'long_text'],
    ] as const)
      await db
        .updateTable('logbook_fields')
        .set({ kind, settings: JSON.stringify(L.settingsFor(kind, undefined)) })
        .where('logbook_id', '=', id)
        .where('key', '=', key)
        .execute();
    await L.launch(db, id);
    questions = L.toDefinitions(await L.fieldsFor(db, id));
  });

  it('asks the dependent question only on yes', () => {
    const said = buildAnswers(questions, {
      has_files: 'yes',
      clip_of: 'thirty seconds of the line',
      account: 'x',
    });
    expect(said.answers?.clip_of).toBe('thirty seconds of the line');
    const not = buildAnswers(questions, { has_files: 'no', clip_of: 'stale' });
    expect(not.answers && 'clip_of' in not.answers).toBe(false);
    expect(not.errors).toEqual([]);
  });

  it('files two reports that both verify, asked different questions of ONE form', async () => {
    const lb = { id, slug };
    const withFiles = await fileReport(
      db,
      lb,
      { has_files: 'yes', clip_of: 'the queue outside', account: 'Long wait.' },
      { questions },
    );
    const without = await fileReport(
      db,
      lb,
      { has_files: 'no', account: 'Long wait.' },
      { questions },
    );
    const a = await verifyReport(db, withFiles.row.public_ref);
    const b = await verifyReport(db, without.row.public_ref);
    if (!a || !b) throw new Error('not found');
    expect([a.content.ok, a.link.ok, a.position.ok]).toEqual([true, true, true]);
    expect([b.content.ok, b.link.ok, b.position.ok]).toEqual([true, true, true]);
    const answersOf = (v: typeof a) => v.hashed_fields.answers as Record<string, unknown>;
    expect(answersOf(a).clip_of).toBe('the queue outside');
    // NO KEY, rather than a null: an absent key and a null one hash differently.
    expect('clip_of' in answersOf(b)).toBe(false);
    expect(a.hashed_fields.logbook_form).toBe(b.hashed_fields.logbook_form);
  });
});

describe('THE REGRESSION THAT WOULD BE WORST', () => {
  it('a logbook with no conditions hashes exactly as it did before conditions existed', async () => {
    const plainSlug = uniqueSlug('plain');
    const lb = await L.createLogbook(db, { title: 'Plain', slug: plainSlug });
    await addStoredQuestion(db, lb.id, { kind: 'short_text', label: 'What happened?', key: 'what' });
    const rows = await L.fieldsFor(db, lb.id);
    expect(rows[0]?.shown_when).toBeNull();

    const actual = formText(plainSlug, L.toDefinitions(rows));
    const asBefore = formText(
      plainSlug,
      rows.map((f) => ({
        key: f.key,
        kind: f.kind,
        label: f.label,
        required: f.required,
        settings: f.settings,
      })),
    );
    expect(actual.hash).toBe(asBefore.hash);
    expect(actual.definition).not.toContain('shown_when');
    expect(actual.definition).not.toContain('help');
  });
});
