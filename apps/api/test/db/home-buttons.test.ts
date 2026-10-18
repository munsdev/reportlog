/**
 * The front page's buttons, against a real database. The port of
 * legacy/scripts/home-buttons-selftest.mjs.
 *
 * Two rules that pull in opposite directions:
 *
 *   an entry naming something that is gone is SKIPPED;
 *   anything available and not named is APPENDED.
 *
 * THE SECOND IS WHY THIS FILE EXISTS. Without it, arranging the front page
 * once quietly opts an operator out of every logbook they make afterwards.
 *
 * And the tri-state: NULL is "nobody has arranged it" and gets the shipped
 * order; [] is an operator who removed every button. Only a round trip
 * through Postgres tells them apart.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BUILTIN_REFS,
  availableButtons,
  clearHomeButtons,
  homeButtons,
  setHomeButtons,
  storedOrder,
} from '../../src/logbooks/homeButtons.ts';
import type { ButtonSources } from '../../src/logbooks/homeButtons.ts';
import * as L from '../../src/logbooks/logbooks.ts';
import { testDatabase, uniqueSlug } from './helpers.ts';

const db = testDatabase();

/** A launched logbook, with the question `launch` insists on. */
async function logbook(title: string) {
  const lb = await L.createLogbook(db, { title, slug: uniqueSlug('hb') });
  await L.addField(db, lb.id, { key: 'account', kind: 'long_text', label: 'What happened?' });
  return L.launch(db, lb.id);
}

let first: Awaited<ReturnType<typeof logbook>>;
beforeAll(async () => {
  await clearHomeButtons(db);
  first = await logbook('The first logbook');
});
afterAll(async () => {
  await clearHomeButtons(db);
  await db.destroy();
});

const refs = (bs: { ref: string }[]) => bs.map((b) => b.ref);

async function refusedWith(order: unknown, code: string) {
  await expect(setHomeButtons(db, order)).rejects.toMatchObject({ code });
}

describe('an unarranged front page', () => {
  it('is NULL, not an empty list, and shows every open logbook with one accent', async () => {
    expect(await storedOrder(db)).toBeNull();
    const buttons = await homeButtons(db);
    expect(buttons.some((b) => b.kind === 'logbook' && b.ref === first.slug)).toBe(true);
    expect(refs(buttons)).toEqual(expect.arrayContaining(['board', 'alerts']));
    expect(buttons.filter((b) => b.accent)).toHaveLength(1);
    expect(buttons[0]?.accent).toBe(true);
    // The generic Submit button is NOT there, because the logbooks are named.
    expect(refs(buttons)).not.toContain('submit');
  });
});

describe("the order is the operator's, and so is the accent", () => {
  it('puts the accent on the first entry, whatever kind, and a removed built-in stays removed', async () => {
    await setHomeButtons(db, [
      { kind: 'builtin', ref: 'board' },
      { kind: 'logbook', ref: first.slug },
    ]);
    const buttons = await homeButtons(db);
    expect(buttons[0]).toMatchObject({ ref: 'board', accent: true });
    expect(buttons.filter((b) => b.accent)).toHaveLength(1);
    expect(refs(buttons)).not.toContain('alerts');
  });
});

describe('a logbook made AFTER the page was arranged', () => {
  it('is appended after what was arranged, without taking the accent', async () => {
    const later = await logbook('Made afterwards');
    const buttons = await homeButtons(db);
    expect(refs(buttons)).toContain(later.slug);
    expect(buttons[0]).toMatchObject({ ref: 'board', accent: true });
    expect(buttons.filter((b) => b.accent)).toHaveLength(1);
    // A built-in is NOT appended: a button the operator deleted coming back
    // is not the safe failure.
    expect(refs(buttons)).not.toContain('alerts');
  });
});

describe('a logbook that closes', () => {
  it('drops off, the accent moves, and the stored order still names it', async () => {
    const gone = await logbook('Closes again');
    await setHomeButtons(db, [
      { kind: 'logbook', ref: gone.slug },
      { kind: 'logbook', ref: first.slug },
    ]);
    expect(refs(await homeButtons(db))).toContain(gone.slug);

    await L.setClosed(db, gone.id, true);
    const buttons = await homeButtons(db);
    expect(refs(buttons)).not.toContain(gone.slug);
    expect(buttons[0]?.accent).toBe(true);
    expect(buttons.filter((b) => b.accent)).toHaveLength(1);
    // AN ORDER AND NOT A PERMISSION: reopening restores its place.
    expect(refs((await storedOrder(db)) ?? [])).toContain(gone.slug);
    await L.setClosed(db, gone.id, false);
    expect((await homeButtons(db))[0]?.ref).toBe(gone.slug);
  });
});

describe('a label', () => {
  it('overrides the title, falls back to it when blank, and follows a rename', async () => {
    await setHomeButtons(db, [
      { kind: 'logbook', ref: first.slug, label: '  Report a problem at your polling place ' },
      { kind: 'builtin', ref: 'board', label: '' },
    ]);
    const stored = await storedOrder(db);
    // Blank is stored as NO KEY, so there is one shape for "no override".
    expect(stored).toEqual([
      { kind: 'logbook', ref: first.slug, label: 'Report a problem at your polling place' },
      { kind: 'builtin', ref: 'board' },
    ]);
    let [btn] = await homeButtons(db);
    expect(btn).toMatchObject({
      label: 'Report a problem at your polling place',
      title: 'The first logbook',
    });

    await setHomeButtons(db, [{ kind: 'logbook', ref: first.slug, label: '   ' }]);
    await L.updateDetails(db, first.id, { title: 'The first logbook, renamed' });
    [btn] = await homeButtons(db);
    expect(btn?.label).toBe('The first logbook, renamed');
  });

  it("is refused on the site's own buttons, and when it is too long for a button", async () => {
    await refusedWith([{ kind: 'builtin', ref: 'board', label: 'Our board' }], 'builtin-label');
    await refusedWith(
      [{ kind: 'logbook', ref: first.slug, label: 'x'.repeat(81) }],
      'label-too-long',
    );
  });
});

describe('what a write refuses', () => {
  it('refuses each wrong arrangement by name, and changes nothing', async () => {
    const before = await storedOrder(db);
    await refusedWith('nope', 'not-a-list');
    await refusedWith([{ kind: 'logbook', ref: 'no-such-logbook-anywhere' }], 'unknown-button');
    await refusedWith(
      [
        { kind: 'builtin', ref: 'board' },
        { kind: 'builtin', ref: 'board' },
      ],
      'duplicate',
    );
    await refusedWith([{ kind: 'spaceship', ref: 'board' }], 'bad-entry');
    await refusedWith(
      Array.from({ length: 51 }, () => ({ kind: 'builtin', ref: 'board' })),
      'too-many',
    );
    expect(await storedOrder(db)).toEqual(before);
  });
});

describe('an operator who removes every button', () => {
  it('gets an empty list, and the logbooks are still appended so the page is never a dead end', async () => {
    await setHomeButtons(db, []);
    expect(await storedOrder(db)).toEqual([]);
    const buttons = await homeButtons(db);
    expect(buttons.some((b) => b.kind === 'logbook')).toBe(true);
    expect(buttons.some((b) => BUILTIN_REFS.includes(b.ref))).toBe(false);
  });
});

describe('back to the shipped order', () => {
  it('is NULL again, and the built-ins are back', async () => {
    await clearHomeButtons(db);
    expect(await storedOrder(db)).toBeNull();
    expect(refs(await homeButtons(db))).toContain('board');
  });
});

describe('what the panel is offered', () => {
  it('offers every open logbook, every built-in including Submit, and no closed logbook', async () => {
    const closed = await logbook('Closed for the panel');
    await L.setClosed(db, closed.id, true);
    const avail = await availableButtons(db);
    expect(refs(avail.logbooks)).toContain(first.slug);
    expect(refs(avail.logbooks)).not.toContain(closed.slug);
    expect(refs(avail.builtins)).toContain('submit');
    expect(avail.lists).toEqual([]);
  });

  it('offers lists as lists when the lists workstream supplies them, and appends them too', async () => {
    const sources: ButtonSources = {
      lists: () =>
        Promise.resolve([{ ref: 'tips', label: 'The Tip List', href: '/list/tips', blurb: null }]),
    };
    const avail = await availableButtons(db, sources);
    expect(avail.lists).toEqual([expect.objectContaining({ kind: 'list', ref: 'tips' })]);
    await setHomeButtons(db, [{ kind: 'builtin', ref: 'board' }], sources);
    expect(refs(await homeButtons(db, sources))).toContain('tips');
    await setHomeButtons(db, [{ kind: 'list', ref: 'tips' }], sources);
    expect((await homeButtons(db, sources))[0]).toMatchObject({
      kind: 'list',
      ref: 'tips',
      accent: true,
    });
    // A list nobody supplies is not a button anybody can arrange.
    await refusedWith([{ kind: 'list', ref: 'tips' }], 'unknown-button');
    await clearHomeButtons(db);
  });
});
