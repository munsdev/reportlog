/**
 * THE ERASABLE ANSWERS: text and links held outside the report (W1).
 *
 * A `private_text` or `private_link` answer never enters `answers`, so it is
 * never sealed as typed and never reaches anything that reads `answers` (the
 * board, the counts, the exports, the chain file). It is normalized here, by
 * the same rules for every path that files a report, and handed on as a
 * separate set of values: the server keeps each under a key of its own, and
 * the seal commits only to a fingerprint of the value and a random value kept
 * with it (packages/seal/src/report.ts).
 *
 * NORMALIZING STILL MATTERS, though nothing here is sealed as written: the
 * fingerprint is of what is stored, so what is stored has to be decided once.
 *
 * Pure, no database, and no reach into the seal: a list could read this file
 * without being able to write a chain (.dependency-cruiser.cjs).
 */
import { PRIVATE_LINK_TYPE, PRIVATE_TEXT_TYPE } from './fieldTypes.ts';
import { isAsked } from './options.ts';
import type { Answers, FieldDefinition, FieldSettings } from './types.ts';

/** The most links one `private_link` question takes. The mock-up's "Up to three". */
export const MAX_PRIVATE_LINKS = 3;

/** As sent, at most (K1, the same cap the tip line uses). */
export const MAX_PRIVATE_LINK_LENGTH = 2000;

/** Text's own default, the existing `long_text` one (gap report D6). */
export const PRIVATE_TEXT_MAX = 5000;

/**
 * The values a submission held, by question. A text question holds one
 * string; a link question holds its links in the order sent, duplicates
 * dropped. A question with nothing in it has no key, as in `answers`.
 */
export interface HeldValues {
  text?: Record<string, string>;
  links?: Record<string, string[]>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function lengthLimit(settings: FieldSettings): number {
  const n = settings.maxLength;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= PRIVATE_TEXT_MAX
    ? n
    : PRIVATE_TEXT_MAX;
}

/** How many links a link question takes: 1 to MAX_PRIVATE_LINKS, one when unset. */
export function maxLinksOf(settings: FieldSettings | null | undefined): number {
  const n = settings?.maxValues;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1
    ? Math.min(n, MAX_PRIVATE_LINKS)
    : 1;
}

/** One piece of erasable text, or null when there is none. */
export function normalizePrivateText(v: unknown, settings: FieldSettings = {}): string | null {
  const s = str(v);
  return s ? s.slice(0, lengthLimit(settings)) : null;
}

/**
 * One link, or null when it is not one. Only http and https, as for `url`;
 * longer than MAX_PRIVATE_LINK_LENGTH as sent is not a link either. Written
 * as the URL parser writes it, so " HTTPS://Example.org" and
 * "https://example.org/" are one link. Matching for the link store's groups
 * is a different, stricter form, made by the server (lists/urls.ts).
 */
export function normalizePrivateLink(v: unknown): string | null {
  const s = str(v);
  if (!s || s.length > MAX_PRIVATE_LINK_LENGTH) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
}

export type HeldProblemReason = 'not-accepted' | 'too-many';

export interface BuiltHeld {
  held: HeldValues | undefined;
  /** Required questions left empty, in the words `buildAnswers` uses. */
  errors: string[];
  /** Values sent that are not ones the question takes. Refused, never dropped. */
  problems: { key: string; reason: HeldProblemReason }[];
}

/**
 * The held values of one submission, against one question set.
 *
 * `answers` is what `buildAnswers` built from the same body: whether a held
 * question was asked depends on the answers before it, exactly as for any
 * other question. A held question that was not asked holds nothing, and a
 * value sent for it is dropped as `buildAnswers` drops one (`strictProblems`
 * refuses it where a path promises to).
 *
 * UNLIKE A PLAIN ANSWER, A VALUE THAT IS NOT ACCEPTED IS REFUSED, not
 * dropped: a link the reporter believes they sent and that silently is not
 * there is worse than being asked to fix it.
 */
export function buildHeldValues(
  fields: readonly FieldDefinition[],
  body: Record<string, unknown> | null | undefined,
  answers: Answers | undefined,
): BuiltHeld {
  const text: Record<string, string> = {};
  const links: Record<string, string[]> = {};
  const errors: string[] = [];
  const problems: BuiltHeld['problems'] = [];
  const known = answers ?? {};
  for (const f of fields) {
    if (f.kind !== PRIVATE_TEXT_TYPE && f.kind !== PRIVATE_LINK_TYPE) continue;
    if (!isAsked(f, known)) continue;
    const raw = body?.[f.key];
    if (f.kind === PRIVATE_TEXT_TYPE) {
      if (raw !== undefined && raw !== null && typeof raw !== 'string') {
        problems.push({ key: f.key, reason: 'not-accepted' });
        continue;
      }
      const v = normalizePrivateText(raw, f.settings ?? {});
      if (v === null) {
        if (f.required) errors.push(`${f.label} is needed`);
        continue;
      }
      text[f.key] = v;
      continue;
    }
    const list: unknown[] = Array.isArray(raw)
      ? raw
      : raw === undefined || raw === null
        ? []
        : [raw];
    const sent = list.filter((x) => !(typeof x === 'string' && x.trim() === '') && x != null);
    if (sent.length > maxLinksOf(f.settings)) {
      problems.push({ key: f.key, reason: 'too-many' });
      continue;
    }
    const out: string[] = [];
    let refused = false;
    for (const item of sent) {
      const v = normalizePrivateLink(item);
      if (v === null) {
        refused = true;
        break;
      }
      // The same link pasted twice is one link.
      if (!out.includes(v)) out.push(v);
    }
    if (refused) {
      problems.push({ key: f.key, reason: 'not-accepted' });
      continue;
    }
    if (!out.length) {
      if (f.required) errors.push(`${f.label} is needed`);
      continue;
    }
    links[f.key] = out;
  }
  const held: HeldValues = {
    ...(Object.keys(text).length ? { text } : {}),
    ...(Object.keys(links).length ? { links } : {}),
  };
  return { held: held.text || held.links ? held : undefined, errors, problems };
}

/** Whether a submission held anything at all. */
export const holdsAnything = (h: HeldValues | undefined): h is HeldValues =>
  !!h && (!!h.text || !!h.links);
