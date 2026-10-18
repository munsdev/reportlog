/**
 * The front page's buttons, resolved into what the page draws.
 *
 * A LOGBOOK IS A BUTTON THE WAY A LIST IS. Every open logbook is named on
 * the front page, rather than one generic "Submit a report" leading to a
 * page that asks which.
 *
 * THE ORDER IS THE ONLY THING STORED, and the first button is the accent.
 * No per-button colour: one screen has one main action, and a colour picker
 * is a setting whose wrong value nothing catches. An operator who wants a
 * different button emphasised moves it to the top. A label is an optional
 * override for a logbook or list (a call to action and a record's title do
 * different jobs), blank by default so a renamed logbook's button follows.
 *
 * Two rules that pull in opposite directions:
 *   an entry naming something that is gone is SKIPPED;
 *   a logbook or list available and not named is APPENDED.
 * Without the second, arranging the page once would quietly opt the
 * operator out of every logbook they make afterwards. A built-in is NOT
 * appended: an operator who removed the board button meant to.
 *
 * NOTHING HERE DECIDES WHETHER SOMETHING IS OPEN. The order is an order,
 * not a permission.
 *
 * NOT YET COMPLETE, and where it waits:
 *   - "open" is "launched" until workstream B adds closing a logbook;
 *     `openLogbooks` is the one place that learns about it.
 *   - lists appear when workstream E builds them; `openLists` returns none.
 */
import { BUTTON_KINDS, MAX_BUTTON_LABEL } from '@reportlog/contracts';
import type { ButtonEntry, HomeButton } from '@reportlog/contracts';
import type { Database } from '../db/database.ts';
import { HttpError } from '../http/errors.ts';
import { readSettings, writeSettings } from './settings.ts';

/**
 * The destinations the software owns. THEIR LABELS ARE NOT THE OPERATOR'S:
 * an operator who could rewrite "Submit a report" could make the front
 * page lie about what the button does. `submit` is not in the shipped
 * arrangement while there are logbooks to name, but stays available for an
 * archive with more logbooks than belong on a front page.
 */
export const BUILTINS = [
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
    href: null,
    // Not a page: it opens the alert sign-up in place.
    action: 'alerts',
    help: 'The sign-up for the alert list.',
  },
  {
    ref: 'submit',
    label: 'Submit a Report',
    href: '/submit',
    action: null,
    help: 'One button leading to a page that asks which logbook. Worth using instead of the individual logbooks once there are more of them than belong on a front page.',
  },
] as const;

export const BUILTIN_REFS: readonly string[] = BUILTINS.map((b) => b.ref);

export type Available = Omit<HomeButton, 'accent' | 'title'> & { help: string | null };

export class HomeButtonRefusal extends HttpError {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(400, 'refused', message);
    this.reason = reason;
  }
}

/** Launched logbooks, oldest first. */
async function openLogbooks(db: Database): Promise<Available[]> {
  const rows = await db
    .selectFrom('logbooks')
    .select(['slug', 'title', 'blurb'])
    .where('launched_at', 'is not', null)
    .orderBy('launched_at')
    .orderBy('id')
    .execute();
  return rows.map((l) => ({
    kind: 'logbook' as const,
    ref: l.slug,
    label: l.title,
    href: `/file/${l.slug}`,
    action: null,
    blurb: l.blurb?.trim() ? l.blurb : null,
    help: null,
  }));
}

/** Lists accepting entries. None until lists exist. */
function openLists(): Promise<Available[]> {
  return Promise.resolve([]);
}

export async function availableButtons(
  db: Database,
): Promise<{ logbooks: Available[]; lists: Available[]; builtins: Available[] }> {
  const builtins: Available[] = BUILTINS.map((b) => ({
    kind: 'builtin',
    ref: b.ref,
    label: b.label,
    href: b.href,
    action: b.action,
    blurb: null,
    help: b.help,
  }));
  return { logbooks: await openLogbooks(db), lists: await openLists(), builtins };
}

/** Read a stored value leniently: a malformed entry is skipped, never thrown on. */
export function parseStoredOrder(raw: unknown): ButtonEntry[] | null {
  // NULL is unarranged and `[]` is arranged-to-nothing. The tri-state is the
  // point of the column.
  if (!Array.isArray(raw)) return null;
  const out: ButtonEntry[] = [];
  for (const e of raw as unknown[]) {
    if (typeof e !== 'object' || e === null) continue;
    const { kind, ref, label } = e as Record<string, unknown>;
    if (typeof kind !== 'string' || !(BUTTON_KINDS as readonly string[]).includes(kind)) continue;
    if (typeof ref !== 'string') continue;
    out.push(typeof label === 'string' && label ? { kind, ref, label } : { kind, ref });
  }
  return out;
}

export async function storedOrder(db: Database): Promise<ButtonEntry[] | null> {
  return parseStoredOrder((await readSettings(db)).home_buttons);
}

/** The shipped order: every open logbook, every open list, then the board and alerts. */
function defaultOrder(available: Awaited<ReturnType<typeof availableButtons>>): ButtonEntry[] {
  return [
    ...available.logbooks.map((b) => ({ kind: b.kind, ref: b.ref })),
    ...available.lists.map((b) => ({ kind: b.kind, ref: b.ref })),
    { kind: 'builtin', ref: 'board' },
    { kind: 'builtin', ref: 'alerts' },
  ];
}

/** Pure: an order and what is available, resolved into buttons. */
export function resolveButtons(
  order: ButtonEntry[] | null,
  available: Awaited<ReturnType<typeof availableButtons>>,
): HomeButton[] {
  const byKey = new Map<string, Available>();
  for (const b of [...available.logbooks, ...available.lists, ...available.builtins]) {
    byKey.set(`${b.kind}:${b.ref}`, b);
  }
  const chosen = order ?? defaultOrder(available);
  const out: Omit<HomeButton, 'accent'>[] = [];
  const seen = new Set<string>();
  // The help text is for the settings screen, not for the public page.
  const strip = (b: Available) => ({
    kind: b.kind,
    ref: b.ref,
    label: b.label,
    href: b.href,
    action: b.action,
    blurb: b.blurb,
  });

  for (const entry of chosen) {
    const key = `${entry.kind}:${entry.ref}`;
    if (seen.has(key)) continue;
    const button = byKey.get(key);
    if (!button) continue;
    seen.add(key);
    // A built-in is never relabelled, even by a hand-edited row.
    const label = entry.label && button.kind !== 'builtin' ? entry.label : button.label;
    out.push({ ...strip(button), label, title: button.label });
  }

  // The append rule. Logbooks and lists only.
  if (order !== null) {
    for (const b of [...available.logbooks, ...available.lists]) {
      const key = `${b.kind}:${b.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...strip(b), title: b.label });
    }
  }

  // The accent is a position, decided here and only here.
  return out.map((b, i) => ({ ...b, accent: i === 0 }));
}

export async function homeButtons(db: Database): Promise<HomeButton[]> {
  return resolveButtons(await storedOrder(db), await availableButtons(db));
}

/**
 * Save an arrangement. REFUSES an entry it cannot place rather than storing
 * it and skipping it later: the read path skips because a logbook can close
 * after the page was arranged, but the write path has the whole list in
 * front of it, and storing an unknown entry would mean an operator arranging
 * a button that never appears.
 */
export async function setHomeButtons(db: Database, order: unknown): Promise<ButtonEntry[]> {
  if (!Array.isArray(order)) {
    throw new HomeButtonRefusal('not-a-list', 'An arrangement is a list of buttons.');
  }
  if (order.length > 50) {
    throw new HomeButtonRefusal('too-many', 'That is more buttons than a front page can carry.');
  }
  const available = await availableButtons(db);
  const known = new Set(
    [...available.logbooks, ...available.lists, ...available.builtins].map(
      (b) => `${b.kind}:${b.ref}`,
    ),
  );

  const clean: ButtonEntry[] = [];
  const seen = new Set<string>();
  for (const entry of order as unknown[]) {
    const e = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const { kind, ref } = e;
    if (
      typeof kind !== 'string' ||
      !(BUTTON_KINDS as readonly string[]).includes(kind) ||
      typeof ref !== 'string'
    ) {
      throw new HomeButtonRefusal('bad-entry', 'One of those buttons is not a button.');
    }
    const key = `${kind}:${ref}`;
    if (!known.has(key)) {
      throw new HomeButtonRefusal(
        'unknown-button',
        `There is nothing on this site called "${ref}".`,
      );
    }
    // Listed twice would draw twice, and the second is a button nobody meant.
    if (seen.has(key)) {
      throw new HomeButtonRefusal('duplicate', 'That button is in the list twice.');
    }
    seen.add(key);

    let label: string | null = null;
    if (e.label !== undefined && e.label !== null && e.label !== '') {
      if (typeof e.label !== 'string') {
        throw new HomeButtonRefusal('bad-label', 'A button label is text.');
      }
      label = e.label.trim() || null;
      if (label && label.length > MAX_BUTTON_LABEL) {
        throw new HomeButtonRefusal(
          'label-too-long',
          `That label is longer than a button can carry. ${String(MAX_BUTTON_LABEL)} characters at most.`,
        );
      }
      // Refused rather than dropped: the read path ignores it, so storing it
      // would let an operator watch their wording vanish on save.
      if (label && kind === 'builtin') {
        throw new HomeButtonRefusal(
          'builtin-label',
          'The site’s own buttons keep their own wording.',
        );
      }
    }
    // No override is stored as NO KEY, not `label: null`: one shape, not two.
    clean.push(label ? { kind, ref, label } : { kind, ref });
  }

  await writeSettings(db, { home_buttons: JSON.stringify(clean) });
  return clean;
}

/** Back to the shipped arrangement, which is NULL and not an empty list. */
export async function clearHomeButtons(db: Database): Promise<void> {
  await writeSettings(db, { home_buttons: null });
}
