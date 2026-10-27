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
import { buttonTargets, editorRows } from '../../src/logbooks/homeButtons.ts';
import { writeSettings } from '../../src/site/settings.ts';
import { testDatabase, uniqueSlug } from './helpers.ts';
import { addStoredQuestion } from '../support/stored-questions.ts';

const db = testDatabase();

/** A launched logbook, with the question `launch` insists on. */
async function logbook(title: string) {
  const lb = await L.createLogbook(db, { title, slug: uniqueSlug('hb') });
  await addStoredQuestion(db, lb.id, { key: 'account', kind: 'long_text', label: 'What happened?' });
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

  it('may be set on the site’s own buttons too, and is refused when too long for a button', async () => {
    await setHomeButtons(db, [{ kind: 'builtin', ref: 'board', label: 'Our board' }]);
    expect(await storedOrder(db)).toEqual([{ kind: 'builtin', ref: 'board', label: 'Our board' }]);
    expect((await homeButtons(db))[0]).toMatchObject({
      label: 'Our board',
      title: 'View Live Report Board',
    });
    await refusedWith(
      [{ kind: 'logbook', ref: first.slug, label: 'x'.repeat(81) }],
      'label-too-long',
    );
    await refusedWith([{ kind: 'logbook', ref: first.slug, sub: 'x'.repeat(161) }], 'sub-too-long');
    await refusedWith([{ kind: 'logbook', ref: first.slug, sub: 5 }], 'bad-sub');
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

describe('"Show on the front page"', () => {
  it('keeps a logbook off the page, arranged or not, and the editor says why', async () => {
    const quiet = await logbook('Not advertised');
    await L.updateDetails(db, quiet.id, { show_on_front: false });
    // Unarranged: not in the shipped order.
    await clearHomeButtons(db);
    expect(refs(await homeButtons(db))).not.toContain(quiet.slug);
    // Arranged without it: not appended.
    await setHomeButtons(db, [{ kind: 'builtin', ref: 'board' }]);
    expect(refs(await homeButtons(db))).not.toContain(quiet.slug);
    // Arranged WITH it: still not drawn, but the arrangement keeps its place.
    await setHomeButtons(db, [{ kind: 'logbook', ref: quiet.slug }]);
    expect(refs(await homeButtons(db))).not.toContain(quiet.slug);
    expect(refs((await storedOrder(db)) ?? [])).toContain(quiet.slug);
    const target = (await buttonTargets(db)).find((t) => t.ref === quiet.slug);
    expect(target).toMatchObject({ showing: false });
    expect(target?.why_not).toMatch(/settings say not to show it/);
    expect(refs(editorRows(await buttonTargets(db), await storedOrder(db)))).toContain(quiet.slug);

    // On again (the default for every logbook): back, appended when unmentioned.
    await L.updateDetails(db, quiet.id, { show_on_front: true });
    await setHomeButtons(db, [{ kind: 'builtin', ref: 'board' }]);
    expect(refs(await homeButtons(db))).toContain(quiet.slug);
    await clearHomeButtons(db);
  });

  it('a list switched off is not drawn, and a list nobody supplied is still unknown', async () => {
    const sources: ButtonSources = {
      lists: () =>
        Promise.resolve([
          { ref: 'on', label: 'On', href: '/list/on', blurb: null },
          {
            ref: 'off',
            label: 'Off',
            href: '/list/off',
            blurb: null,
            showing: false,
            why_not: 'Its own settings say not to show it on the front page.',
          },
        ]),
    };
    await setHomeButtons(db, [{ kind: 'builtin', ref: 'board' }], sources);
    expect(refs(await homeButtons(db, sources))).toContain('on');
    expect(refs(await homeButtons(db, sources))).not.toContain('off');
    await setHomeButtons(db, [{ kind: 'list', ref: 'off' }], sources);
    expect(refs(await homeButtons(db, sources)).includes('off')).toBe(false);
    await clearHomeButtons(db);
  });
});

describe('the second line, and the new kinds of target', () => {
  it('stores a second line only when set, and falls back to the target’s own', async () => {
    await L.updateDetails(db, first.id, { blurb: 'The logbook’s own line' });
    await setHomeButtons(db, [
      { kind: 'logbook', ref: first.slug, sub: '   ' },
      { kind: 'builtin', ref: 'board', sub: 'Everything published' },
    ]);
    expect(await storedOrder(db)).toEqual([
      { kind: 'logbook', ref: first.slug },
      { kind: 'builtin', ref: 'board', sub: 'Everything published' },
    ]);
    const [a, b] = await homeButtons(db);
    expect(a?.blurb).toBe('The logbook’s own line');
    expect(b?.blurb).toBe('Everything published');
    await clearHomeButtons(db);
  });

  it('offers the site’s pages, none of them added on their own', async () => {
    const targets = await buttonTargets(db);
    for (const ref of ['board', 'alerts', 'submit', 'journalists', 'illegal-content', 'about']) {
      expect(targets.find((t) => t.kind === 'builtin' && t.ref === ref)).toMatchObject({
        showing: true,
      });
    }
    await clearHomeButtons(db);
    const shipped = refs(await homeButtons(db));
    for (const ref of ['journalists', 'illegal-content', 'about']) {
      expect(shipped).not.toContain(ref);
    }
    await setHomeButtons(db, [{ kind: 'builtin', ref: 'illegal-content' }]);
    expect((await homeButtons(db))[0]).toMatchObject({
      ref: 'illegal-content',
      href: '/illegal-content',
      accent: true,
    });
    await clearHomeButtons(db);
  });

  it('a public map is a button; one switched off is not drawn but keeps its place', async () => {
    const slug = uniqueSlug('hbmap');
    await db
      .insertInto('heat_maps')
      .values({ slug, title: 'Where it happened', enabled: true })
      .execute();
    await setHomeButtons(db, [{ kind: 'map', ref: slug }]);
    expect((await homeButtons(db))[0]).toMatchObject({
      kind: 'map',
      ref: slug,
      href: `/maps/${slug}`,
      accent: true,
    });
    await db.updateTable('heat_maps').set({ enabled: false }).where('slug', '=', slug).execute();
    expect(refs(await homeButtons(db))).not.toContain(slug);
    expect(refs((await storedOrder(db)) ?? [])).toContain(slug);
    expect(refs(editorRows(await buttonTargets(db), await storedOrder(db)))).toContain(slug);
    expect((await buttonTargets(db)).find((t) => t.ref === slug)?.why_not).toBe(
      'The map is switched off.',
    );
    await clearHomeButtons(db);
    await db.deleteFrom('heat_maps').where('slug', '=', slug).execute();
  });

  it('the social links are a row of icons, drawn only while an account is on, and never the accent', async () => {
    await setHomeButtons(db, [
      { kind: 'social', ref: 'links' },
      { kind: 'builtin', ref: 'board' },
    ]);
    // No account is on: not drawn, but arranged.
    const ours = <T extends { ref: string }>(bs: T[]) =>
      bs.filter((b) => ['links', 'board'].includes(b.ref));
    expect(refs(ours(await homeButtons(db)))).toEqual(['board']);
    await writeSettings(db, {
      social_links: JSON.stringify([
        { id: 'bluesky', url: 'https://bsky.app/profile/x.bsky.social', shown: true },
      ]),
    });
    const buttons = await homeButtons(db);
    expect(ours(buttons).map((b) => [b.ref, b.accent])).toEqual([
      ['links', false],
      ['board', true],
    ]);
    expect(buttons[0]?.social).toEqual([
      { id: 'bluesky', url: 'https://bsky.app/profile/x.bsky.social' },
    ]);
    await writeSettings(db, { social_links: JSON.stringify([]) });
    await clearHomeButtons(db);
  });

  it('accepts a closed logbook in an arrangement, and still refuses one that does not exist', async () => {
    const shut = await logbook('Shut for the editor');
    await L.setClosed(db, shut.id, true);
    await setHomeButtons(db, [{ kind: 'logbook', ref: shut.slug }]);
    expect(refs(await homeButtons(db))).not.toContain(shut.slug);
    const rows = editorRows(await buttonTargets(db), await storedOrder(db));
    expect(rows[0]).toEqual({ kind: 'logbook', ref: shut.slug });
    await refusedWith([{ kind: 'map', ref: 'no-such-map' }], 'unknown-button');
    await clearHomeButtons(db);
  });
});
