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
 * and nothing drifts unless an operator deliberately makes it. A built-in
 * cannot be relabelled: an operator who could rewrite "Submit a Report" could
 * make the front page lie about what the button does.
 *
 * NOTHING HERE DECIDES WHETHER SOMETHING IS OPEN. It asks the module that owns
 * the question (`openLogbooks`, and the lists workstream's own source), so a
 * closed logbook cannot appear because of a stale row in an ordering. The
 * ordering is an ORDER, not a permission. Nothing here is sealed.
 */
import type { ArrangementEntry, AvailableButton, HomeButton } from '@reportlog/contracts';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { openLogbooks } from './logbooks.ts';
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
];

export const BUILTIN_REFS: readonly string[] = BUILTINS.map((b) => b.ref);
export const BUTTON_KINDS = ['logbook', 'list', 'builtin'] as const;
type ButtonKind = (typeof BUTTON_KINDS)[number];
const isKind = (k: unknown): k is ButtonKind => BUTTON_KINDS.includes(k as ButtonKind);

export interface ListButton {
  ref: string;
  label: string;
  href: string;
  blurb: string | null;
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

export interface Available {
  logbooks: AvailableButton[];
  lists: AvailableButton[];
  builtins: AvailableButton[];
}

/** What can be on the front page right now, whatever the order says. */
export async function availableButtons(db: Db, sources: ButtonSources = {}): Promise<Available> {
  const logbooks = (await openLogbooks(db)).map((l): AvailableButton => ({
    kind: 'logbook',
    ref: l.slug,
    label: l.title,
    href: `/file/${l.slug}`,
    action: null,
    blurb: l.blurb,
    help: null,
  }));
  const lists = (sources.lists ? await sources.lists(db) : []).map((l): AvailableButton => ({
    kind: 'list',
    ...l,
    action: null,
    help: null,
  }));
  const builtins = BUILTINS.map((b): AvailableButton => ({ kind: 'builtin', ...b, blurb: null }));
  return { logbooks, lists, builtins };
}

interface Entry {
  kind: ButtonKind;
  ref: string;
  label?: string;
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
      (e): e is { kind: ButtonKind; ref: string; label?: unknown } =>
        typeof e === 'object' &&
        e !== null &&
        isKind((e as Entry).kind) &&
        typeof (e as Entry).ref === 'string',
    )
    .map((e) => {
      const label = labelOf(e.label);
      return label ? { kind: e.kind, ref: e.ref, label } : { kind: e.kind, ref: e.ref };
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
 */
export function resolveButtons(
  available: Available,
  order: readonly ArrangementEntry[] | null,
): HomeButton[] {
  const byKey = new Map<string, AvailableButton>();
  for (const b of [...available.logbooks, ...available.lists, ...available.builtins]) {
    byKey.set(`${b.kind}:${b.ref}`, b);
  }
  const chosen = order ?? defaultOrder(available);

  const out: Omit<HomeButton, 'accent'>[] = [];
  const seen = new Set<string>();
  for (const entry of chosen) {
    const key = `${entry.kind}:${entry.ref}`;
    const button = byKey.get(key);
    if (seen.has(key) || !button) continue;
    seen.add(key);
    // THE FALLBACK IS HERE AND ONLY HERE. `title` carries the record's own
    // name either way, so the arranging screen can show what a blank box falls
    // back to. A built-in's label is never read, even from a hand-edited row.
    const own = labelOf(entry.label);
    out.push({
      ...button,
      label: own && button.kind !== 'builtin' ? own : button.label,
      title: button.label,
    });
  }

  // The append rule. Logbooks and lists only; see above.
  if (order !== null) {
    for (const b of [...available.logbooks, ...available.lists]) {
      const key = `${b.kind}:${b.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...b, title: b.label });
    }
  }

  // THE ACCENT IS A POSITION, NOT A STORED VALUE, decided in exactly one place,
  // so an arrangement can never be saved with two accents or none.
  return out.map((b, i) => ({ ...b, accent: i === 0 }));
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
 */
export async function setHomeButtons(
  db: Db,
  order: unknown,
  sources: ButtonSources = {},
): Promise<ArrangementEntry[]> {
  if (!Array.isArray(order)) return refuse('not-a-list');
  if (order.length > 50) refuse('too-many');

  const available = await availableButtons(db, sources);
  const known = new Set(
    [...available.logbooks, ...available.lists, ...available.builtins].map(
      (b) => `${b.kind}:${b.ref}`,
    ),
  );

  const clean: Entry[] = [];
  const seen = new Set<string>();
  for (const raw of order as unknown[]) {
    const entry = raw as Partial<Record<'kind' | 'ref' | 'label', unknown>> | null;
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

    if (entry.label !== undefined && entry.label !== null && typeof entry.label !== 'string') {
      refuse('bad-label');
    }
    const label = labelOf(entry.label);
    if (label && label.length > 80) refuse('label-too-long');
    // A BUILT-IN IS REFUSED rather than quietly dropped, so an operator who
    // typed one is told it is not theirs to set instead of watching it vanish.
    if (label && entry.kind === 'builtin') refuse('builtin-label');
    // Blank means no override, stored as NO KEY rather than `label: null`, so
    // the read path has one shape to agree about.
    clean.push(
      label ? { kind: entry.kind, ref: entry.ref, label } : { kind: entry.kind, ref: entry.ref },
    );
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
