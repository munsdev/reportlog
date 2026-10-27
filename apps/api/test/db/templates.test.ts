/**
 * Starting a logbook from a shipped question set, against a real database.
 * The logbook half of legacy/scripts/template-selftest.mjs.
 *
 * The claim it rests on: A STARTING POINT ADDS ONE DRAFT LOGBOOK AND THEN HAS
 * NO FURTHER EFFECT, and it does not disturb a logbook or a report already
 * there. So this files a report into a launched logbook first, makes
 * logbooks from every starting point over the top, and checks the first
 * logbook and its report are exactly as they were.
 *
 * The deployment half of the legacy test (site settings, page copy, the look)
 * is not here: those tables belong to the site workstream and do not exist
 * yet. See the pull request.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import * as L from '../../src/logbooks/logbooks.ts';
import {
  createFromStartingPoint,
  templateLogbook,
  STARTING_POINTS,
} from '../../src/logbooks/templates.ts';
import { recordCardTexts } from '../../src/consent/cards.ts';
import { fileReport, testDatabase, uniqueSlug } from './helpers.ts';
import { addStoredQuestion } from '../support/stored-questions.ts';

const db = testDatabase();
// A report seals an answer to card wording the server recorded.
beforeAll(() => recordCardTexts(db));
afterAll(async () => {
  await db.destroy();
});

const verifies = (v: Awaited<ReturnType<typeof verifyReport>>) =>
  v?.content.ok === true && v.link.ok && v.position.ok;

let own: { id: number; slug: string };
let ownBefore: string;
let filedRef: string;

beforeAll(async () => {
  const lb = await L.createLogbook(db, { title: 'Our own', slug: uniqueSlug('own') });
  await addStoredQuestion(db, lb.id, { kind: 'long_text', label: 'What happened', key: 'what' });
  await L.launch(db, lb.id);
  own = lb;
  const questions = L.toDefinitions(await L.fieldsFor(db, lb.id));
  const r = await fileReport(
    db,
    lb,
    { what: 'Filed before any starting point was used.' },
    { questions },
  );
  filedRef = r.row.public_ref;
  ownBefore = JSON.stringify(await L.fieldsFor(db, own.id));
});

describe('a starting point', () => {
  it('makes the logbook its file describes, AS A DRAFT, with every question in order', async () => {
    const file = templateLogbook('how-voting-went');
    const lb = await createFromStartingPoint(db, {
      starting_point: 'how-voting-went',
      title: '',
    });
    // Launching is never done on anybody's behalf.
    expect(lb.state).toBe('draft');
    expect(lb.title).toBe(file.title);
    expect(lb.fields.map((q) => q.key)).toEqual(file.questions.map((q) => q.key));
    expect(lb.asks_for_files).toBe(false);
  });

  it("takes the operator's own title and address over the file's", async () => {
    const slug = uniqueSlug('mine');
    const lb = await createFromStartingPoint(db, {
      starting_point: 'workplace',
      title: 'Night shift incidents',
      slug,
    });
    expect([lb.title, lb.slug]).toEqual(['Night shift incidents', slug]);
  });

  it("makes a SECOND draft when used again, rather than joining the first one's chain", async () => {
    const first = await createFromStartingPoint(db, { starting_point: 'general', title: '' });
    const second = await createFromStartingPoint(db, { starting_point: 'general', title: '' });
    expect(second.slug).not.toBe(first.slug);
    expect(second.slug.startsWith(templateLogbook('general').slug ?? '')).toBe(true);
  });

  it("turns an old file's accepts_files into an upload question", async () => {
    const lb = await createFromStartingPoint(db, { starting_point: 'elections', title: '' });
    expect(lb.asks_for_files).toBe(true);
    expect(lb.fields.filter((q) => q.kind === 'file')).toHaveLength(1);
  });

  it('is an ordinary logbook afterwards: it gains questions like any other', async () => {
    const lb = await createFromStartingPoint(db, {
      starting_point: 'how-voting-went',
      title: '',
    });
    await addStoredQuestion(db, lb.id, {
      kind: 'long_text',
      label: 'Anything else, in your own words?',
    });
    await addStoredQuestion(db, lb.id, { kind: 'file', label: 'Photos, video or documents' });
    expect((await L.logbookById(db, lb.id))?.asks_for_files).toBe(true);
  });

  it('works for every starting point that ships', async () => {
    for (const id of STARTING_POINTS) {
      const lb = await createFromStartingPoint(db, { starting_point: id, title: '' });
      expect(lb.state, id).toBe('draft');
    }
  });

  it('refuses one that does not ship, rather than making half a logbook', async () => {
    const before = (await L.listLogbooks(db)).length;
    await expect(
      createFromStartingPoint(db, { starting_point: 'no_such_template', title: 'X' }),
    ).rejects.toMatchObject({ code: 'no-starting-point' });
    await expect(
      createFromStartingPoint(db, { starting_point: '../../etc/passwd', title: 'X' }),
    ).rejects.toMatchObject({ code: 'no-starting-point' });
    expect((await L.listLogbooks(db)).length).toBe(before);
  });
});

describe('what a starting point must never touch', () => {
  it('leaves a logbook that was already there exactly as it was, and its report verifies', async () => {
    expect(JSON.stringify(await L.fieldsFor(db, own.id))).toBe(ownBefore);
    expect((await L.logbookById(db, own.id))?.state).not.toBe('draft');
    expect(verifies(await verifyReport(db, filedRef))).toBe(true);
  });
});
