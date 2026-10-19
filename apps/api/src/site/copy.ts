/**
 * The words on this deployment's own pages.
 *
 * NOT A PAGE BUILDER AND NOT HTML. Each slot is one piece of plain text,
 * published exactly as typed, in a place the design already put it. An
 * operator changes what a page SAYS, not what it IS, so the layout, the
 * contrast and the print rules stay intact.
 *
 * THE OPERATOR OWNS WHAT THIS ARCHIVE IS FOR; THE SOFTWARE OWNS WHAT IT
 * DOES. The form's explanation of sealing, the consent wording, field
 * labels, the verify page and every error are deliberately not slots: an
 * operator who could rewrite those could make the form lie about what
 * happens to what somebody tells it.
 *
 * NULL MEANS "use what ships", unlike the legal text. A missing privacy
 * policy must say it is missing; a missing front page has a safe default
 * that already says the operator has not written one. A slot marked
 * `optional` shows nothing until written instead, where our note to the
 * operator would be the wrong thing for a reader to see.
 *
 * All nine of legacy's slots, each read by a page (see COPY_KEYS in
 * @reportlog/contracts).
 *
 * FIGURES. A slot may carry {{ … }} placeholders (board/figures.ts). The
 * stored text keeps the placeholder, so the editor edits what was written;
 * the public read renders it (site.ts), and a save is refused if a
 * placeholder would not work (routes.ts), rather than it showing "?" on a
 * page the operator may never look at.
 */
import type { CopyKey, CopySlot } from '@reportlog/contracts';
import type { Checked } from './result.ts';

export const MAX_COPY_LEN = 20000;
export const MAX_LINE_LEN = 300;

interface SlotDefinition {
  key: CopyKey;
  /** `line` is one sentence; `block` keeps the operator's own line breaks. */
  kind: 'line' | 'block';
  label: string;
  help: string;
  optional?: boolean;
  fallback: string;
}

export const COPY_SLOTS: readonly SlotDefinition[] = [
  {
    key: 'home_headline',
    kind: 'line',
    label: 'Front page headline',
    help: 'The first line anybody reads. One sentence.',
    fallback: 'A record of what happened, that cannot be quietly changed.',
  },
  {
    key: 'home_lede',
    kind: 'block',
    label: 'Front page lede',
    help: 'The paragraph under the headline, above the buttons.',
    fallback:
      'File a report. A moderator reviews it. Once it is filed, nobody — including whoever runs this archive — can alter or remove it without that being visible.',
  },
  {
    key: 'home_intro',
    kind: 'block',
    label: 'What this archive is for',
    help: 'Under the buttons. Who should file into this archive, and about what.',
    fallback:
      'This deployment has not written its front page yet. An operator replaces this text with what this archive is for and who should file into it.',
  },
  {
    key: 'about_archive',
    kind: 'block',
    label: 'About this archive',
    help: 'The first thing on the About page. Who runs this archive, why it exists, what it covers and what it will not do, and how to reach you. The part under it explains the software and is written already.',
    // A fresh install must not come up with an empty About, nor with
    // something that reads like a real answer. The safe default is the one
    // that is obviously unfinished.
    fallback:
      'This deployment has not written its About page yet.\n\nAn operator says here who runs this archive, why it exists, what it covers and what it will not do, and how to get in touch. The part below, about the software itself and how to check the record without taking anybody’s word for it, is already written and needs nothing from you.',
  },
  {
    // OPTIONAL, so an unwritten one shows a reporter nothing at all. Somebody
    // filing an account of something that happened to them should not be
    // reading our note to the operator.
    key: 'submit_intro',
    kind: 'block',
    optional: true,
    label: 'Your own words before filing',
    help: 'Shown where somebody chooses what to report, under the heading. Who should file here and about what. Left empty, nothing is shown.',
    fallback: '',
  },
  {
    key: 'board_intro',
    kind: 'block',
    optional: true,
    label: 'Your own words on the board',
    help: 'Under the board’s heading. What somebody is looking at here, and what it covers. The sentence saying that published is not the same as true is the software’s and stays.',
    // OPTIONAL here, unlike legacy, whose fallback ("Every submitted report,
    // in real time") described the board wrongly. The board's own lede
    // already says what it shows; a shipped default would only repeat it.
    fallback: '',
  },
  {
    key: 'how_intro',
    kind: 'block',
    optional: true,
    label: 'Your own words on the how-to page',
    help: 'Above the instructions, which are about the software and are written already. Anything particular to this archive: who to ask, local rules, when somebody reads what you file.',
    fallback: '',
  },
  {
    key: 'alliance_intro',
    kind: 'block',
    optional: true,
    label: 'Your own words on the directory',
    help: 'Above the list of organizations. What this directory is for here. The note saying that listing is not verification is the software’s and stays.',
    fallback: '',
  },
  {
    key: 'standards',
    kind: 'block',
    label: 'Moderation standard',
    help: 'What gets approved, what gets refused, and who decides. Publishing this is not optional if you take moderator applications, and it is difficult to write honestly after the fact.',
    fallback:
      'An operator publishes their moderation standard here — what gets approved, what gets refused, and who decides.\n\nPublishing this is not optional if a deployment takes moderator applications, and it is difficult to write honestly after the fact. Write it before opening an intake, not afterwards.',
  },
];

const BY_KEY = new Map<string, SlotDefinition>(COPY_SLOTS.map((s) => [s.key, s]));

export interface CopyRow {
  key: string;
  body: string;
}

function written(rows: readonly CopyRow[], key: string): string | null {
  const stored = rows.find((r) => r.key === key)?.body;
  return typeof stored === 'string' && stored.trim() ? stored : null;
}

/** Every slot resolved. Never missing a key, so a page never has to check. */
export function resolveCopy(rows: readonly CopyRow[]): Record<CopyKey, string> {
  return Object.fromEntries(
    COPY_SLOTS.map((s) => [s.key, written(rows, s.key)?.trim() ?? s.fallback]),
  ) as Record<CopyKey, string>;
}

/** What the editor opens with, and whether it is the operator's or ours. */
export function editorCopy(rows: readonly CopyRow[]): CopySlot[] {
  return COPY_SLOTS.map((s) => {
    const own = written(rows, s.key);
    return {
      key: s.key,
      kind: s.kind,
      label: s.label,
      help: s.help,
      optional: Boolean(s.optional),
      fallback: s.fallback,
      body: own ?? s.fallback,
      // So the editor can say "this is still the shipped wording" rather
      // than letting an operator believe they wrote it.
      written: own !== null,
    };
  });
}

/** Null means "go back to what ships", stored as no row at all. */
export function validateCopy(
  key: string,
  raw: string,
): Checked<{ key: CopyKey; body: string | null }> {
  const slot = BY_KEY.get(key);
  if (!slot) return { ok: false, error: 'There is no such piece of text on this site.' };
  const limit = slot.kind === 'line' ? MAX_LINE_LEN : MAX_COPY_LEN;
  if (raw.length > limit) {
    return { ok: false, error: `Keep this under ${String(limit)} characters.` };
  }
  // A headline with a line break in it is a headline that will not lay out.
  if (slot.kind === 'line' && /[\r\n]/.test(raw)) {
    return { ok: false, error: 'This one is a single line.' };
  }
  return { ok: true, value: { key: slot.key, body: raw.trim() ? raw : null } };
}
