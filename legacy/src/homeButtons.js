/**
 * The front page's buttons, resolved into what the page should draw.
 *
 * A LOGBOOK IS A BUTTON THE WAY A LIST IS. The front page used to carry one
 * accent button, "Submit a Report", leading to a page whose only job was to
 * ask which logbook — so a deployment with three logbooks named none of
 * them on its front page, while each LIST had its own button right there.
 * Two formats with two different front doors, for no reason either could
 * explain. Migration 050 has the rest of the reasoning.
 *
 * A LABEL IS OPTIONAL AND BLANK BY DEFAULT. The column stored an order and
 * nothing else, deliberately, because a second place to name a thing is a
 * second thing to disagree — and then an operator pointed out that a button
 * label and a record title do different jobs. "Report a problem at your
 * polling place" is a call to action; "Election incidents 2026" is what the
 * archive calls it, and one string cannot be both without one of them
 * reading badly.
 *
 * SO IT IS AN OVERRIDE AND NOT A LABEL FIELD, and the difference is the
 * whole of it: blank falls back to the logbook's or list's own title, so the
 * default stays self-maintaining — rename a logbook and its button follows —
 * and nothing drifts unless an operator deliberately makes it drift. A
 * required label would have made every button a second name to keep true.
 *
 * NO MIGRATION. `home_buttons` is jsonb holding one object per button, so an
 * extra optional key is additive on its own. Nothing here is hashed; it is
 * the front page's layout.
 *
 * A BUILT-IN CANNOT BE RELABELLED. See BUILTINS below: those labels are not
 * the operator's, and that is a rule about the page not lying rather than a
 * limitation nobody got round to.
 *
 * THE ORDER IS THE EMPHASIS, and that is the one design decision here worth
 * defending. The first button is the accent and every other is secondary,
 * so there is no per-button colour to set. One screen has one primary
 * action; three accent buttons is no accent at all, and a colour picker is
 * a setting whose wrong value nothing can catch — it does not error, it
 * just flattens the hierarchy the palette exists to create. An operator who
 * wants a different button emphasised moves it to the top, which is the
 * same decision expressed once instead of twice.
 *
 * NOTHING HERE DECIDES WHETHER SOMETHING IS OPEN. It asks the modules that
 * own that question — `openLogbooks` and the lists' own `isAccepting` — so
 * a closed logbook cannot appear on the front page because of a stale row
 * in an ordering. The ordering is an ORDER, not a permission.
 */
import { pool } from './db.js';
import { openLogbooks } from './logbooks.js';
import { listBySlug, isAccepting } from './lists/entries.js';

/**
 * The destinations the software owns.
 *
 * THEIR LABELS ARE NOT THE OPERATOR'S, deliberately, and this is the same
 * rule the on-page copy editor states: an operator who could rewrite
 * "Submit a report" could make the front page lie about what the button
 * does. A logbook or list button wears its own title, which the operator
 * edits where that logbook or list is edited — one name for one thing, in
 * one place.
 *
 * `submit` is the old generic button. It is NOT in the shipped arrangement
 * when there is a logbook to name, because naming the logbooks is the whole
 * point of this change — but it stays available, because an archive with
 * fifteen logbooks wants one button and a picker rather than fifteen
 * buttons, and that is the operator's call to make.
 */
export const BUILTINS = [
  {
    ref: 'board',
    label: 'View Live Report Board',
    href: '/board',
    nav: 'dash',
    help: 'The published record.',
  },
  {
    ref: 'alerts',
    label: 'Get alerts as reports come in',
    href: null,
    // Not a route: it opens the alert sign-up in place.
    action: 'alerts',
    help: 'The sign-up for the alert list.',
  },
  {
    ref: 'submit',
    label: 'Submit a Report',
    href: '/submit',
    nav: 'submit',
    help: 'A single button leading to a page that asks which logbook. Worth '
      + 'adding instead of the individual logbooks once there are more of them '
      + 'than belong on a front page.',
  },
];

export const BUILTIN_REFS = BUILTINS.map((b) => b.ref);
export const BUTTON_KINDS = ['logbook', 'list', 'builtin'];

function builtin(ref) {
  return BUILTINS.find((b) => b.ref === ref) || null;
}

/** What can be on the front page right now, whatever the order says. */
export async function availableButtons(client = pool) {
  const logbooks = (await openLogbooks(client)).map((l) => ({
    kind: 'logbook',
    ref: l.slug,
    label: l.title,
    href: `/file/${l.slug}`,
    blurb: l.blurb || null,
  }));

  /* The same question the front page's own list endpoint asks, asked the
     same way: listed, and accepting right now. `isAccepting` is the lists'
     module's own answer and is not reimplemented here — a second opinion
     about whether a list is open is a second thing to be wrong. */
  const lists = [];
  const { rows } = await client.query(
    "SELECT slug FROM lists WHERE visibility = 'listed' ORDER BY created_at, id",
  );
  for (const r of rows) {
    const list = await listBySlug(r.slug);
    if (!list || !isAccepting(list)) continue;
    lists.push({
      kind: 'list',
      ref: list.slug,
      label: list.title,
      href: `/list/${list.slug}`,
      blurb: list.blurb || null,
    });
  }

  const builtins = BUILTINS.map((b) => ({
    kind: 'builtin',
    ref: b.ref,
    label: b.label,
    href: b.href,
    nav: b.nav || null,
    action: b.action || null,
    help: b.help,
  }));

  return { logbooks, lists, builtins };
}

/** The stored order, or null where nobody has arranged the page. */
export async function storedOrder(client = pool) {
  const { rows } = await client.query(
    'SELECT home_buttons FROM site_settings WHERE id = true',
  );
  const raw = rows[0] ? rows[0].home_buttons : null;
  // NULL means unarranged and `[]` means arranged-to-nothing. Those are
  // different answers and the tri-state is the point of the column.
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((e) => e && BUTTON_KINDS.includes(e.kind) && typeof e.ref === 'string')
    .map((e) => ({
      kind: e.kind,
      ref: e.ref,
      // Blank, missing and whitespace are ONE ANSWER — no override — so a
      // row saved with an empty box behaves exactly like a row saved before
      // labels existed.
      label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : null,
    }));
}

/**
 * The shipped arrangement: every logbook, then every list, then the board,
 * then the alert sign-up.
 *
 * THE GENERIC SUBMIT BUTTON COMES BACK WHEN THERE ARE NO LOGBOOKS. An
 * archive whose only logbook has closed would otherwise have a front page
 * with no way to file at all, which is worse than the page it replaced. The
 * /submit pane is the thing that explains there is nothing open, and it can
 * only do that if something leads to it.
 */
export function defaultOrder({ logbooks, lists }) {
  const out = [
    ...logbooks.map((l) => ({ kind: 'logbook', ref: l.ref })),
    ...lists.map((l) => ({ kind: 'list', ref: l.ref })),
  ];
  if (!logbooks.length) out.push({ kind: 'builtin', ref: 'submit' });
  out.push({ kind: 'builtin', ref: 'board' });
  out.push({ kind: 'builtin', ref: 'alerts' });
  return out;
}

/**
 * The buttons the front page draws, in order, with the accent on the first.
 *
 * TWO RULES AND THE SECOND ONE IS THE IMPORTANT ONE:
 *
 *   an entry naming something that is gone — a closed logbook, a deleted
 *   list, a built-in that no longer exists — is SKIPPED;
 *
 *   anything available and not named is APPENDED, in the shipped order.
 *
 * Without the second, a logbook created after somebody arranged the front
 * page would never appear on it, and nothing would tell the operator that
 * arranging the page once had opted them out of every logbook they made
 * afterwards. That is the kind of fault somebody finds months later from a
 * reporter asking where the form went.
 *
 * A built-in is NOT appended, because an operator who removed the board
 * button meant to remove it. The asymmetry is deliberate: a logbook
 * appearing is the safe failure, and a button the operator deleted coming
 * back is not.
 */
export async function homeButtons(client = pool) {
  const available = await availableButtons(client);
  const byKey = new Map();
  for (const b of [...available.logbooks, ...available.lists, ...available.builtins]) {
    byKey.set(`${b.kind}:${b.ref}`, b);
  }

  const order = await storedOrder(client);
  const chosen = order === null ? defaultOrder(available) : order;

  const out = [];
  const seen = new Set();
  for (const entry of chosen) {
    const key = `${entry.kind}:${entry.ref}`;
    if (seen.has(key)) continue;
    const button = byKey.get(key);
    if (!button) continue;
    seen.add(key);
    /* THE FALLBACK IS HERE AND ONLY HERE. `title` carries the record's own
       name whether or not it is being used, so the arrange control can show
       an operator what the blank box will fall back to without asking a
       second endpoint for it. A built-in is never overridden: the entry
       cannot carry a label (setHomeButtons refuses one), and this does not
       read one either, so a row stored by an older or a hand-edited copy
       cannot rename the board button. */
    const label = entry.label && button.kind !== 'builtin' ? entry.label : button.label;
    out.push({ ...button, label, title: button.label });
  }

  // The append rule. Logbooks and lists only; see the note above.
  if (order !== null) {
    for (const b of [...available.logbooks, ...available.lists]) {
      const key = `${b.kind}:${b.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Appended, and therefore unlabelled: nobody has said anything about
      // this one yet.
      out.push({ ...b, title: b.label });
    }
  }

  /* THE ACCENT IS A POSITION, NOT A STORED VALUE. Computed here so there is
     exactly one place that decides it, and so an arrangement can never be
     saved with two accents or none. */
  return out.map((b, i) => ({ ...b, accent: i === 0 }));
}

export class HomeButtonRefusal extends Error {
  constructor(reason, message) { super(message || reason); this.reason = reason; }
}

/**
 * Save an arrangement.
 *
 * REFUSES AN ENTRY IT CANNOT PLACE rather than storing it and skipping it
 * later. The read path skips an unknown entry because a logbook can close
 * after the page was arranged; the WRITE path has the whole list in front
 * of it, so an entry it cannot find is a panel sending something wrong, and
 * storing it would mean an operator arranging a button that never appears.
 */
export async function setHomeButtons(order, client = pool) {
  if (!Array.isArray(order)) {
    throw new HomeButtonRefusal('not-a-list', 'An arrangement is a list of buttons.');
  }
  if (order.length > 50) {
    throw new HomeButtonRefusal('too-many', 'That is more buttons than a front page can carry.');
  }

  const available = await availableButtons(client);
  const known = new Set([
    ...available.logbooks.map((l) => `logbook:${l.ref}`),
    ...available.lists.map((l) => `list:${l.ref}`),
    ...available.builtins.map((b) => `builtin:${b.ref}`),
  ]);

  const clean = [];
  const seen = new Set();
  for (const entry of order) {
    if (!entry || !BUTTON_KINDS.includes(entry.kind) || typeof entry.ref !== 'string') {
      throw new HomeButtonRefusal('bad-entry', 'One of those buttons is not a button.');
    }
    const key = `${entry.kind}:${entry.ref}`;
    if (!known.has(key)) {
      throw new HomeButtonRefusal('unknown-button',
        `There is nothing on this deployment called "${entry.ref}".`);
    }
    // A button listed twice would draw twice, and the second one would be a
    // button nobody meant to add.
    if (seen.has(key)) {
      throw new HomeButtonRefusal('duplicate', 'That button is in the list twice.');
    }
    seen.add(key);

    /* THE LABEL, and the three ways it can be wrong.

       A BUILT-IN IS REFUSED rather than quietly dropped. The read path
       ignores a label on a built-in, so storing one would be harmless and
       invisible — which is exactly why it is refused here: an operator who
       typed one would be told it is not theirs to set instead of watching
       it disappear on save. */
    let label = null;
    if (entry.label !== undefined && entry.label !== null && entry.label !== '') {
      if (typeof entry.label !== 'string') {
        throw new HomeButtonRefusal('bad-label', 'A button label is text.');
      }
      label = entry.label.trim();
      if (label.length > 80) {
        throw new HomeButtonRefusal('label-too-long',
          'That label is longer than a button can carry. Eighty characters at most.');
      }
      if (label && entry.kind === 'builtin') {
        throw new HomeButtonRefusal('builtin-label',
          'The site\u2019s own buttons keep their own wording.');
      }
      if (!label) label = null;
    }
    clean.push(label
      // Blank means no override, and no override is stored as NO KEY.
      // Writing `label: null` would be a second way to say the same thing,
      // and the read path would then have two shapes to agree about.
      ? { kind: entry.kind, ref: entry.ref, label }
      : { kind: entry.kind, ref: entry.ref });
  }

  await client.query(
    'UPDATE site_settings SET home_buttons = $1 WHERE id = true',
    [JSON.stringify(clean)],
  );
  return clean;
}

/** Back to the shipped arrangement, which is NULL and not an empty list. */
export async function clearHomeButtons(client = pool) {
  await client.query('UPDATE site_settings SET home_buttons = NULL WHERE id = true');
}
