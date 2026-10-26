/**
 * The front page's buttons, resolved into what the page should draw.
 *
 * A LOGBOOK IS A BUTTON THE WAY A LIST IS. A single "Submit a Report" leading
 * to a page that asked which logbook was the front door for one format and
 * not the other.
 *
 * THE ORDER IS THE EMPHASIS. The first button is the accent and every other
 * is secondary, so there is no per-button colour to store. One screen has one
 * main action; a colour picker would be a setting whose wrong value nothing
 * can catch. An operator who wants a different button emphasised moves it to
 * the top.
 *
 * A LABEL IS AN OVERRIDE, BLANK BY DEFAULT. "Report a problem at your polling
 * place" is a call to action and "Election incidents 2026" is what the
 * archive calls it, and one string cannot be both. Blank falls back to the
 * logbook's or list's own title, so renaming a logbook renames its button,
 * and nothing drifts unless an operator deliberately makes it. EVERY
 * BUTTON MAY BE RELABELLED, the site's own included (decision 76, amending the
 * rule that a built-in kept its wording). The button's target is a dropdown of
 * things this site owns, never an address typed in, so wording cannot send
 * anybody somewhere the operator did not choose; it can only say what the
 * operator chose to say.
 *
 * A SECOND LINE (the subtext) is an override in the same way: blank falls back
 * to the target's own description, and no key is stored unless it is set.
 *
 * NOTHING HERE DECIDES WHETHER SOMETHING IS OPEN. It asks the module that owns
 * the question (`openLogbooks`, and the lists workstream's own source), so a
 * closed logbook cannot appear because of a stale row in an ordering. The
 * ordering is an ORDER, not a permission. Nothing here is sealed.
 */
import { resolveSocialLinks, shownSocialLinks } from '@reportlog/contracts';
import type {
  ArrangementEntry,
  AvailableButton,
  ButtonTarget,
  HomeButton,
} from '@reportlog/contracts';
import type { Kysely } from 'kysely';
import { publicArchiveAvailable } from '../board/publication.ts';
import type { DB } from '../db/schema.gen.ts';
import { allMaps } from '../maps/rows.ts';
import { readSettings } from '../site/settings.ts';
import { launchedLogbooks, openLogbooks } from './logbooks.ts';
import { refuse } from './refusals.ts';

type Db = Kysely<DB>;

/** The destinations the software owns. Their wording is not the operator's. */
export const BUILTINS: readonly Omit<AvailableButton, 'kind' | 'blurb'>[] = [
  {
    ref: 'board',
    label: 'View Live Report Board',
    href: '/board',
    action: null,
    help: 'The published record.',
  },
  {
    ref: 'alerts',
    label: 'Get alerts as reports come in',
    // Not a route: it opens the alert sign-up in place.
    href: null,
    action: 'alerts',
    help: 'The sign-up for the alert list.',
  },
  {
    // NOT in the shipped arrangement when there is a logbook to name, but
    // available: an archive with fifteen logbooks may want one button and a
    // picker rather than fifteen buttons, and that is the operator's call.
    ref: 'submit',
    label: 'Submit a Report',
    href: '/submit',
    action: null,
    help:
      'A single button leading to a page that asks which logbook. Worth adding instead of the ' +
      'individual logbooks once there are more of them than belong on a front page.',
  },
  // The pages below are never added on their own: an operator who wants one
  // picks it, so a site that never did is unchanged.
  {
    ref: 'journalists',
    label: 'For journalists',
    href: '/journalists',
    action: null,
    help: 'The page for journalists: the desk, and how to ask for access.',
  },
  {
    ref: 'illegal-content',
    label: 'Report illegal content',
    href: '/illegal-content',
    action: null,
    help: 'Where anybody can report content that should not be on the site.',
  },
  {
    ref: 'about',
    label: 'About this site',
    href: '/about',
    action: null,
    help: 'Who runs the site and how it works.',
  },
];

export const BUILTIN_REFS: readonly string[] = BUILTINS.map((b) => b.ref);
export const BUTTON_KINDS = ['logbook', 'list', 'map', 'builtin', 'social'] as const;
type ButtonKind = (typeof BUTTON_KINDS)[number];
const isKind = (k: unknown): k is ButtonKind => BUTTON_KINDS.includes(k as ButtonKind);

export interface ListButton {
  ref: string;
  label: string;
  href: string;
  blurb: string | null;
  /** Whether it would be drawn now. Absent means it would be. */
  showing?: boolean;
  /** Why not, in words, when it would not. */
  why_not?: string | null;
}

/**
 * Where the buttons that are not logbooks come from. LISTS BELONG TO THE LISTS
 * WORKSTREAM, which answers for itself whether a list is listed and accepting;
 * a second opinion about that here would be a second thing to be wrong. Until
 * it supplies a source, there are no list buttons.
 */
export interface ButtonSources {
  lists?: (db: Db) => Promise<ListButton[]>;
}

/** What would be drawn right now, by kind. */
export interface Available {
  logbooks: AvailableButton[];
  lists: AvailableButton[];
  builtins: AvailableButton[];
  maps?: AvailableButton[];
  social?: AvailableButton[];
}

/** The target as the page draws it: without what only the editor needs. */
const stripState = (t: ButtonTarget): AvailableButton => ({
  kind: t.kind,
  ref: t.ref,
  label: t.label,
  href: t.href,
  action: t.action,
  blurb: t.blurb,
  help: t.help,
  ...(t.social ? { social: t.social } : {}),
});

/**
 * Everything a button could lead to, drawn or not, with the reason in words
 * for each that would not be. The editor lists them all; the page draws only
 * the ones that are showing.
 *
 * NOTHING HERE DECIDES WHETHER SOMETHING IS OPEN. Logbooks ask `openLogbooks`,
 * lists ask the lists module, maps ask whether the public archive is on and
 * the map is: a closed target cannot appear because of a stale row.
 */
export async function buttonTargets(db: Db, sources: ButtonSources = {}): Promise<ButtonTarget[]> {
  const open = await openLogbooks(db);
  const openSlugs = new Set(open.map((l) => l.slug));
  const launched = await launchedLogbooks(db);
  const bySlug = new Map(launched.map((l) => [l.slug, l]));
  // The open ones in their own order first; the closed after, so the dropdown
  // leads with what could be drawn.
  const ordered = [
    ...open.map((l) => bySlug.get(l.slug) ?? l),
    ...launched.filter((l) => !openSlugs.has(l.slug)),
  ];
  const logbooks = ordered.map((l): ButtonTarget => {
    const why = !openSlugs.has(l.slug)
      ? l.state === 'scheduled'
        ? 'It has not opened yet.'
        : 'It is closed.'
      : !l.show_on_front
        ? 'Its own settings say not to show it on the front page.'
        : null;
    return {
      kind: 'logbook',
      ref: l.slug,
      label: l.title,
      href: l.short_slug ? `/${l.short_slug}` : `/file/${l.slug}`,
      action: null,
      blurb: l.blurb,
      help: null,
      showing: why === null,
      why_not: why,
    };
  });
  const lists = (sources.lists ? await sources.lists(db) : []).map(
    ({ showing, why_not, ...l }): ButtonTarget => ({
      kind: 'list',
      ...l,
      action: null,
      help: null,
      showing: showing !== false,
      why_not: showing === false ? (why_not ?? 'It would not show.') : null,
    }),
  );
  const archive = await publicArchiveAvailable(db);
  const maps = (await allMaps(db)).map((m): ButtonTarget => {
    const why = !archive
      ? 'The public archive is off, so no map is shown.'
      : !m.enabled
        ? 'The map is switched off.'
        : null;
    return {
      kind: 'map',
      ref: m.slug,
      label: m.title,
      href: `/maps/${m.slug}`,
      action: null,
      blurb: m.blurb,
      help: null,
      showing: why === null,
      why_not: why,
    };
  });
  const builtins = BUILTINS.map((b): ButtonTarget => ({
    kind: 'builtin',
    ...b,
    blurb: null,
    showing: true,
    why_not: null,
  }));
  const accounts = shownSocialLinks(resolveSocialLinks((await readSettings(db)).social_links));
  const social: ButtonTarget = {
    kind: 'social',
    ref: 'links',
    label: 'Follow us',
    href: null,
    action: null,
    blurb: null,
    help: 'The social media accounts switched on under Site, Social media, as a row of icons.',
    social: accounts,
    showing: accounts.length > 0,
    why_not: accounts.length > 0 ? null : 'No social media account is switched on.',
  };
  return [...logbooks, ...lists, ...maps, ...builtins, social];
}

/** What can be on the front page right now, whatever the order says. */
export async function availableButtons(
  db: Db,
  sources: ButtonSources = {},
): Promise<Required<Available>> {
  const shown = (await buttonTargets(db, sources)).filter((t) => t.showing).map(stripState);
  const of = (kind: AvailableButton['kind']) => shown.filter((t) => t.kind === kind);
  return {
    logbooks: of('logbook'),
    lists: of('list'),
    builtins: of('builtin'),
    maps: of('map'),
    social: of('social'),
  };
}

interface Entry {
  kind: ButtonKind;
  ref: string;
  label?: string;
  sub?: string;
  hidden?: true;
}

/** Blank, missing and whitespace are ONE ANSWER: no override, stored as no key. */
function labelOf(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

/** The stored order, or null where nobody has arranged the page. */
export async function storedOrder(db: Db): Promise<ArrangementEntry[] | null> {
  const row = await db.selectFrom('home_buttons').select('buttons').executeTakeFirst();
  const raw: unknown = row?.buttons ?? null;
  // NULL means unarranged and [] means arranged to nothing. Different answers.
  if (!Array.isArray(raw)) return null;
  return raw
    .filter(
      (
        e,
      ): e is { kind: ButtonKind; ref: string; label?: unknown; sub?: unknown; hidden?: unknown } =>
        typeof e === 'object' &&
        e !== null &&
        isKind((e as Entry).kind) &&
        typeof (e as Entry).ref === 'string',
    )
    .map((e) => {
      if (e.hidden === true) return { kind: e.kind, ref: e.ref, hidden: true as const };
      const label = labelOf(e.label);
      const sub = labelOf(e.sub);
      // Each key only when set: one shape for "no override".
      return { kind: e.kind, ref: e.ref, ...(label ? { label } : {}), ...(sub ? { sub } : {}) };
    });
}

/**
 * The shipped arrangement: every logbook, then every list, then the board,
 * then the alert sign-up.
 *
 * THE GENERIC SUBMIT BUTTON COMES BACK WHEN THERE ARE NO LOGBOOKS. Otherwise
 * an archive whose only logbook has closed would have a front page with no way
 * to file at all; the submit page is what explains there is nothing open.
 */
export function defaultOrder(available: Pick<Available, 'logbooks' | 'lists'>): Entry[] {
  const out: Entry[] = [
    ...available.logbooks.map((l) => ({ kind: 'logbook' as const, ref: l.ref })),
    ...available.lists.map((l) => ({ kind: 'list' as const, ref: l.ref })),
  ];
  if (!available.logbooks.length) out.push({ kind: 'builtin', ref: 'submit' });
  out.push({ kind: 'builtin', ref: 'board' }, { kind: 'builtin', ref: 'alerts' });
  return out;
}

/**
 * The buttons, in order, with the accent on the first. PURE, so the two rules
 * are testable without a database:
 *
 *   an entry naming something that is gone (a closed logbook, a list that was
 *   deleted) is SKIPPED;
 *
 *   anything available and not named is APPENDED, in the shipped order.
 *
 * Without the second, a logbook made after somebody arranged the page would
 * never appear on it, and nothing would tell the operator that arranging the
 * page once had opted them out of every logbook they made afterwards.
 *
 * A built-in is NOT appended: an operator who removed the board button meant
 * to. A logbook appearing is the safe failure; a deleted button coming back
 * is not.
 *
 * AND A LOGBOOK OR LIST THE OPERATOR HID IS NOT APPENDED EITHER. Hiding one
 * used to mean leaving it out, and the append rule put it straight back, so
 * Hide on a logbook did nothing. A hidden one is now stored as such: it is
 * mentioned, so it is not new, and it is never drawn.
 */
export function resolveButtons(
  available: Available,
  order: readonly ArrangementEntry[] | null,
): HomeButton[] {
  const everything = [
    ...available.logbooks,
    ...available.lists,
    ...(available.maps ?? []),
    ...available.builtins,
    ...(available.social ?? []),
  ];
  const byKey = new Map<string, AvailableButton>();
  for (const b of everything) byKey.set(`${b.kind}:${b.ref}`, b);
  const chosen = order ?? defaultOrder(available);

  const out: Omit<HomeButton, 'accent'>[] = [];
  const seen = new Set<string>();
  for (const entry of chosen) {
    const key = `${entry.kind}:${entry.ref}`;
    const button = byKey.get(key);
    if (seen.has(key) || !button) continue;
    seen.add(key);
    if (entry.hidden === true) continue;
    // THE FALLBACK IS HERE AND ONLY HERE. `title` carries the record's own
    // name either way, so the arranging screen can show what a blank box falls
    // back to. The same for the second line: blank is the target's own blurb.
    out.push({
      ...button,
      label: labelOf(entry.label) ?? button.label,
      blurb: labelOf(entry.sub) ?? button.blurb,
      title: button.label,
    });
  }

  // The append rule. Logbooks and lists only; see above. `available` holds
  // only what is showing, which includes each one's own "show on the front
  // page" switch: a logbook switched off there is not in it.
  if (order !== null) {
    for (const b of [...available.logbooks, ...available.lists]) {
      const key = `${b.kind}:${b.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...b, title: b.label });
    }
  }

  // THE ACCENT IS A POSITION, NOT A STORED VALUE, decided in exactly one place,
  // so an arrangement can never be saved with two accents or none. A row of
  // icons is not a button, so it never takes it: the first real button does.
  const first = out.findIndex((b) => b.kind !== 'social');
  return out.map((b, i) => ({ ...b, accent: i === first }));
}

/**
 * The rows the editor starts from: what the page would resolve to, but KEEPING
 * the ones whose target would not draw (a closed logbook, a switched-off map),
 * so the editor can mark them "not showing" instead of silently losing them.
 * Hidden entries are not rows: the operator took them off the page.
 */
export function editorRows(
  targets: readonly ButtonTarget[],
  order: readonly ArrangementEntry[] | null,
): ArrangementEntry[] {
  const known = new Set(targets.map((t) => `${t.kind}:${t.ref}`));
  const showing = (kind: string) => targets.filter((t) => t.kind === kind && t.showing);
  const chosen: readonly ArrangementEntry[] =
    order ??
    defaultOrder({
      logbooks: showing('logbook'),
      lists: showing('list'),
    });
  const out: ArrangementEntry[] = [];
  const seen = new Set<string>();
  for (const entry of chosen) {
    const key = `${entry.kind}:${entry.ref}`;
    if (seen.has(key) || !known.has(key)) continue;
    seen.add(key);
    if (entry.hidden === true) continue;
    const label = labelOf(entry.label);
    const sub = labelOf(entry.sub);
    out.push({
      kind: entry.kind,
      ref: entry.ref,
      ...(label ? { label } : {}),
      ...(sub ? { sub } : {}),
    });
  }
  if (order !== null) {
    for (const t of [...showing('logbook'), ...showing('list')]) {
      const key = `${t.kind}:${t.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: t.kind, ref: t.ref });
    }
  }
  return out;
}

export async function homeButtons(db: Db, sources: ButtonSources = {}): Promise<HomeButton[]> {
  return resolveButtons(await availableButtons(db, sources), await storedOrder(db));
}

/**
 * Save an arrangement.
 *
 * REFUSES AN ENTRY IT CANNOT PLACE rather than storing it and skipping it
 * later. The read path skips an unknown entry because a logbook can close
 * after the page was arranged; the write path has the whole list in front of
 * it, so an entry it cannot find is a screen sending something wrong, and
 * storing it would mean an operator arranging a button that never appears.
 *
 * A TARGET THAT EXISTS BUT WOULD NOT DRAW NOW (a closed logbook) IS ACCEPTED:
 * the editor shows it as "not showing" and an operator may keep its place for
 * when it reopens. An order, not a permission.
 */
export async function setHomeButtons(
  db: Db,
  order: unknown,
  sources: ButtonSources = {},
): Promise<ArrangementEntry[]> {
  if (!Array.isArray(order)) return refuse('not-a-list');
  if (order.length > 50) refuse('too-many');

  const known = new Set((await buttonTargets(db, sources)).map((b) => `${b.kind}:${b.ref}`));

  const clean: Entry[] = [];
  const seen = new Set<string>();
  for (const raw of order as unknown[]) {
    const entry = raw as Partial<
      Record<'kind' | 'ref' | 'label' | 'sub' | 'hidden', unknown>
    > | null;
    if (
      !entry ||
      typeof entry !== 'object' ||
      !isKind(entry.kind) ||
      typeof entry.ref !== 'string'
    ) {
      return refuse('bad-entry');
    }
    const key = `${entry.kind}:${entry.ref}`;
    if (!known.has(key)) refuse('unknown-button', `It was “${entry.ref}”.`);
    // A button listed twice would draw twice, and the second one would be a
    // button nobody meant to add.
    if (seen.has(key)) refuse('duplicate');
    seen.add(key);

    if (entry.hidden === true) {
      clean.push({ kind: entry.kind, ref: entry.ref, hidden: true });
      continue;
    }
    for (const [text, bad, long] of [
      [entry.label, 'bad-label', 'label-too-long'],
      [entry.sub, 'bad-sub', 'sub-too-long'],
    ] as const) {
      if (text !== undefined && text !== null && typeof text !== 'string') refuse(bad);
      const value = labelOf(text);
      if (value && value.length > (text === entry.label ? 80 : 160)) refuse(long);
    }
    // Blank means no override, stored as NO KEY rather than `label: null`, so
    // the read path has one shape.
    const label = labelOf(entry.label);
    const sub = labelOf(entry.sub);
    clean.push({
      kind: entry.kind,
      ref: entry.ref,
      ...(label ? { label } : {}),
      ...(sub ? { sub } : {}),
    });
  }

  await db
    .insertInto('home_buttons')
    .values({ id: true, buttons: JSON.stringify(clean), updated_at: new Date() })
    .onConflict((oc) =>
      oc.column('id').doUpdateSet({ buttons: JSON.stringify(clean), updated_at: new Date() }),
    )
    .execute();
  return clean;
}

/** Back to the shipped arrangement, which is NULL and not an empty list. */
export async function clearHomeButtons(db: Db): Promise<void> {
  await db
    .insertInto('home_buttons')
    .values({ id: true, buttons: null, updated_at: new Date() })
    .onConflict((oc) => oc.column('id').doUpdateSet({ buttons: null, updated_at: new Date() }))
    .execute();
}
