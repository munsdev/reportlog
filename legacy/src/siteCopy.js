/**
 * The words on this deployment's own pages.
 *
 * The front page, the lede under it and the moderation standard were all
 * written into public/index.html with a note beside each saying an operator
 * replaces this. There was no way for one to do it — the same gap the
 * imprint had before migration 013, and the same answer.
 *
 * WHAT THIS IS NOT. It is not a page builder and it is not HTML. Each slot
 * is one piece of plain text, published exactly as typed, in a place the
 * design already put it. An operator changes what the page SAYS; they do
 * not change what the page IS. That keeps the layout, the contrast and the
 * print rules intact, which are the parts a person writing their front page
 * at midnight should not be able to break.
 *
 * ADDING A SLOT IS A LINE HERE AND AN ATTRIBUTE IN THE MARKUP. No
 * migration: the table is key/value precisely so that another editable
 * paragraph never needs one. The suite checks the two agree, because a slot
 * offered in the editor with nothing on the page reading it is a text box
 * that does nothing.
 *
 * NULL MEANS "use what ships", which is NOT what the legal text does.
 * Deliberate, and the difference is the difference between the two kinds of
 * text: a missing privacy policy must say it is missing, because a
 * placeholder that reads like a policy is dangerous. A missing front page
 * has a safe default that already ships and already says the operator has
 * not written one.
 *
 * NEVER HASHED, and nothing here goes near a report.
 */
import { pool } from './db.js';

export const MAX_COPY_LEN = 20000;
export const MAX_LINE_LEN = 300;

/**
 * The slots, in the order the editor shows them.
 *
 *   kind 'line'  one sentence, rendered into an element as it stands.
 *   kind 'block' a paragraph or several, rendered pre-wrap so the
 *                operator's own line breaks survive.
 *
 * `fallback` is what the page says when nobody has written anything. It is
 * held here rather than in the markup so that the editor can show an
 * operator what they are replacing, and so the page and the editor cannot
 * drift apart.
 */
/**
 * `page` names the pane each slot appears on, and it is here rather than in the
 * browser because the admin page has to be able to SEND somebody to the words
 * rather than edit them blind. A map kept on the client would be a second
 * source of truth for something this list already knows.
 *
 * `policy` marks a slot that is a published position rather than a page's
 * voice — it belongs with the imprint and the privacy policy under Legal, even
 * though it is edited on its own page like every other slot.
 *
 * `optional` marks a slot that shows NOTHING until somebody writes it. The
 * others carry a fallback saying the deployment has not written that page yet,
 * which is the right default for a front page: obviously unfinished beats
 * looking finished. It is the wrong default for an extra paragraph on the
 * reporting form, where the reader is somebody filing an account of something
 * that happened to them and should not be shown our note to the operator.
 *
 * WHAT IS DELIBERATELY NOT HERE. The reporting form's lede — timestamped,
 * sealed, chained, a moderator reviews every report — is the SOFTWARE'S promise
 * about what it does, not the operator's voice. Nor are the field labels, the
 * consent wording, the verify page's explanation of how a fingerprint is
 * checked, or any error text. An operator who could rewrite those could make
 * the form lie about what happens to what somebody tells it. The rule is: the
 * operator owns what this archive is FOR; the software owns what it DOES.
 */
export const COPY_SLOTS = [
  {
    key: 'home_headline',
    kind: 'line',
    page: 'home',
    label: 'Front page headline',
    help: 'The first line anybody reads. One sentence.',
    fallback: 'A record of what happened, that cannot be quietly changed.',
  },
  {
    key: 'home_lede',
    kind: 'block',
    page: 'home',
    label: 'Front page lede',
    help: 'The paragraph under the headline, above the buttons.',
    fallback: 'File a report. A moderator reviews it. Once it is filed, nobody '
      + '— including whoever runs this archive — can alter or remove it without '
      + 'that being visible.',
  },
  {
    key: 'home_intro',
    kind: 'block',
    page: 'home',
    label: 'What this archive is for',
    help: 'Under the buttons. Who should file into this archive, and about what.',
    fallback: 'This deployment has not written its front page yet. An operator '
      + 'replaces this text with what this archive is for and who should file into it.',
  },
  {
    key: 'about_archive',
    kind: 'block',
    page: 'about',
    label: 'About this archive',
    help: 'The first thing on the About page. Who runs this archive, why it '
      + 'exists, what it covers and what it will not do, and how to reach you. '
      + 'The section under it explains the software and is written already.',
    // A FRESH INSTALL MUST NOT COME UP WITH AN EMPTY ABOUT, and it must not
    // come up with something that reads like a real answer either. This is
    // the same family as the gate defaulting to on: the safe default is the
    // one that is obviously unfinished rather than the one that looks done.
    fallback: 'This deployment has not written its About page yet.\n\n'
      + 'An operator says here who runs this archive, why it exists, what it '
      + 'covers and what it will not do, and how to get in touch. The section '
      + 'below — about the software itself, and how to check the record '
      + 'without taking anybody\u2019s word for it — is already written and '
      + 'needs nothing from you.',
  },
  {
    // OPTIONAL, so an unwritten one shows a reporter nothing at all. Every slot
    // above has a fallback that says the deployment has not written its page
    // yet, which is the right default for a front page — obviously unfinished
    // beats looking finished. It is the wrong default here: somebody filing an
    // account of something that happened to them should not be reading our note
    // to the operator. See `optional` below.
    key: 'submit_intro',
    kind: 'block',
    page: 'submit',
    optional: true,
    label: 'Your own words on the reporting form',
    help: 'Shown above the form, under the heading. Who should file here and '
      + 'about what — anything particular to this archive. Left empty, the form '
      + 'simply starts.',
    fallback: '',
  },
  {
    key: 'board_intro',
    kind: 'block',
    page: 'dash',
    label: 'What the board is',
    help: 'Under the board\u2019s heading. What somebody is looking at, and what '
      + 'it covers.',
    fallback: 'Every submitted report, in real time.',
  },
  {
    key: 'how_intro',
    kind: 'block',
    page: 'how',
    optional: true,
    label: 'Your own words on the how-to page',
    help: 'Above the instructions, which are about the software and are written '
      + 'already. Anything particular to this deployment \u2014 who to ask, local '
      + 'rules, when somebody reads what you file.',
    fallback: '',
  },
  {
    key: 'alliance_intro',
    kind: 'block',
    page: 'alliance',
    optional: true,
    label: 'Your own words on the directory',
    help: 'Above the list of organizations. What this directory is for here. The '
      + 'note saying that listing is not verification is the software\u2019s and '
      + 'stays.',
    fallback: '',
  },
  {
    key: 'standards',
    kind: 'block',
    page: 'standards',
    policy: true,
    label: 'Moderation standard',
    help: 'What gets approved, what gets refused, and who decides. Publishing this '
      + 'is not optional if you take moderator applications, and it is difficult to '
      + 'write honestly after the fact.',
    fallback: 'An operator publishes their moderation standard here — what gets '
      + 'approved, what gets refused, and who decides.\n\nPublishing this is not '
      + 'optional if a deployment takes moderator applications, and it is difficult '
      + 'to write honestly after the fact. Write it before opening an intake, not '
      + 'afterwards.',
  },
];

export const COPY_KEYS = COPY_SLOTS.map((s) => s.key);
const BY_KEY = new Map(COPY_SLOTS.map((s) => [s.key, s]));

const TTL_MS = Number(process.env.SITE_COPY_TTL_MS ?? 30 * 1000);
let cache = { at: 0, rows: null };

export async function copyRows() {
  if (Date.now() - cache.at < TTL_MS && cache.rows) return cache.rows;
  try {
    const { rows } = await pool.query('SELECT key, body FROM site_copy');
    cache = { at: Date.now(), rows };
  } catch {
    // A database that cannot answer must not blank the front page. Every
    // slot falls back to what ships, which is what every page said before
    // this table existed.
    cache = { at: Date.now(), rows: [] };
  }
  return cache.rows;
}

export function clearCopyCache() {
  cache = { at: 0, rows: null };
}

/** Pure, so the fallback rule is testable without a database. */
export function resolveCopy(rows, key) {
  const slot = BY_KEY.get(key);
  if (!slot) return null;
  const stored = (rows || []).find((r) => r.key === key)?.body;
  const text = typeof stored === 'string' ? stored.trim() : '';
  return text || slot.fallback;
}

/** Every slot resolved, which is what the page asks for in one go. */
export function resolveAll(rows) {
  return Object.fromEntries(COPY_SLOTS.map((s) => [s.key, resolveCopy(rows, s.key)]));
}

export async function siteCopy() {
  return resolveAll(await copyRows());
}

/** What the editor opens with, and whether it is the operator's or ours. */
export function editorCopy(rows) {
  return COPY_SLOTS.map((s) => {
    const stored = (rows || []).find((r) => r.key === s.key)?.body;
    const written = typeof stored === 'string' && stored.trim() ? stored : null;
    return {
      key: s.key,
      kind: s.kind,
      label: s.label,
      help: s.help,
      page: s.page,
      policy: Boolean(s.policy),
      optional: Boolean(s.optional),
      fallback: s.fallback,
      body: written ?? s.fallback,
      // So the editor can say "this is still the shipped wording" rather
      // than letting an operator believe they wrote it.
      written: written !== null,
    };
  });
}

export function validateCopy(key, raw) {
  const slot = BY_KEY.get(key);
  if (!slot) return { ok: false, error: 'There is no such piece of text on this site.' };
  const value = String(raw ?? '');
  const limit = slot.kind === 'line' ? MAX_LINE_LEN : MAX_COPY_LEN;
  if (value.length > limit) {
    return { ok: false, error: `Keep this under ${limit} characters.` };
  }
  // A headline with a line break in it is a headline that will not lay out.
  if (slot.kind === 'line' && /[\r\n]/.test(value)) {
    return { ok: false, error: 'This one is a single line.' };
  }
  // Cleared means "go back to what ships", stored as no row at all.
  return { ok: true, value: value.trim() ? value : null };
}
