/**
 * Normalizing one answer against the question that asked for it, with a
 * reason when it is refused.
 *
 * THE SHAPE OF AN ANSWER IS @reportlog/fields', the same one a logbook seals.
 * That package is kept apart from the sealing code precisely so a list can use
 * it (legacy had to duplicate its normalizer to keep the same guarantee). What
 * is added here is what a list needs and a logbook does not:
 *
 *   - A REFUSAL WITH A REASON. `normalizeAnswer` answers null for anything it
 *     cannot use, which is right for sealing. A list form tells the person
 *     what to fix, so a non-blank answer that normalizes to nothing is named.
 *   - LINKS ARE STRICTER. A list exists to collect links, so a link goes
 *     through `normalizeUrl` here (no shorteners, no bare addresses, trackers
 *     stripped) and is stored in that normalized form.
 *   - TEXT IS REFUSED, NOT CUT. A logbook seals a cut answer; a list asks the
 *     person to shorten it, since nothing is sealed and they are still there.
 *
 * Never throws: every caller is handling something a stranger typed. A blank
 * answer comes back as `value: undefined`, and the caller OMITS THE KEY: a
 * count has to tell "never asked" from "asked and skipped".
 */
import { isFieldKind, normalizeAnswer } from '@reportlog/fields';
import type { AnswerValue } from '@reportlog/fields';
import { FORBIDDEN_KINDS, optionsOf } from './fields.ts';
import type { ListField } from './fields.ts';
import { normalizeUrl } from './urls.ts';
import type { NormalizedUrl } from './urls.ts';

export const MAX_SHORT_TEXT = 200;
export const MAX_LONG_TEXT = 1000;

export type ValueResult =
  | { ok: true; value: AnswerValue | undefined; url?: Extract<NormalizedUrl, { ok: true }> }
  | { ok: false; reason: string };

/** The spellings a form actually sends for yes and no, onto the two the package reads. */
const YES = new Set(['true', 'yes', 'on', '1']);
const NO = new Set(['false', 'no', 'off', '0']);

const isBlank = (raw: unknown): boolean =>
  raw === null ||
  raw === undefined ||
  (typeof raw === 'string' && raw.trim() === '') ||
  (Array.isArray(raw) && raw.every(isBlank));

const text = (raw: unknown) =>
  typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';

/** What a refusal is called, by kind, when the package answered nothing. */
const REFUSED: Record<string, string> = {
  email: 'not-an-email',
  number: 'not-a-number',
  date: 'not-a-date',
  time: 'not-a-time',
  datetime: 'not-a-datetime',
  choice_one: 'not-an-option',
  choice_many: 'not-an-option',
  place: 'not-an-option',
  location: 'not-a-place',
  yes_no: 'not-a-yes-or-no',
  short_text: 'not-text',
  long_text: 'not-text',
};

export function normalizeValue(field: ListField, raw: unknown): ValueResult {
  const kind = field.kind;
  if (FORBIDDEN_KINDS.has(kind)) return { ok: false, reason: 'kind-not-available-on-a-list' };
  if (!isFieldKind(kind)) return { ok: false, reason: 'unknown-field-kind' };
  if (isBlank(raw)) return { ok: true, value: undefined };
  const settings = field.settings ?? {};

  switch (kind) {
    case 'url': {
      const norm = normalizeUrl(raw);
      if (!norm.ok) return { ok: false, reason: norm.reason };
      // The normalized form is stored, so two spellings of one link are one.
      return { ok: true, value: norm.url, url: norm };
    }
    case 'short_text':
    case 'long_text': {
      const cap = kind === 'short_text' ? MAX_SHORT_TEXT : MAX_LONG_TEXT;
      if (typeof raw !== 'string') return { ok: false, reason: 'not-text' };
      if (raw.trim().length > cap) return { ok: false, reason: 'too-long' };
      break;
    }
    case 'place': {
      if (text(raw).length > MAX_SHORT_TEXT) return { ok: false, reason: 'too-long' };
      break;
    }
    case 'choice_one':
    case 'choice_many': {
      // A choice with nothing to choose from is a broken form, not a bad
      // answer, and saying so names the right thing.
      const options = optionsOf(field);
      if (!options.length) return { ok: false, reason: 'field-has-no-options' };
      // An answer outside the offered list is REFUSED here, where the package
      // would drop it: the person is still on the form and can pick again.
      const given = (Array.isArray(raw) ? raw : [raw]).map(text).filter(Boolean);
      if (given.some((v) => !options.includes(v))) return { ok: false, reason: 'not-an-option' };
      break;
    }
    case 'yes_no': {
      if (typeof raw === 'string') {
        const v = raw.trim().toLowerCase();
        if (YES.has(v)) return { ok: true, value: true };
        if (NO.has(v)) return { ok: true, value: false };
      }
      break;
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(text(raw));
      if (!Number.isFinite(n)) return { ok: false, reason: 'not-a-number' };
      const value = normalizeAnswer(kind, raw, settings);
      return value === null ? { ok: false, reason: 'out-of-range' } : { ok: true, value };
    }
    case 'date':
    case 'time':
    case 'datetime': {
      // A real day or time outside the question's limits (owner decision E4)
      // is named as that, not as "not a date".
      const value = normalizeAnswer(kind, raw, settings);
      if (value === null && normalizeAnswer(kind, raw, {}) !== null)
        return { ok: false, reason: 'outside-dates' };
      if (value === null) return { ok: false, reason: REFUSED[kind] ?? 'not-an-answer' };
      return { ok: true, value };
    }
    default:
      break;
  }

  const value = normalizeAnswer(kind, raw, settings);
  if (value === null) return { ok: false, reason: REFUSED[kind] ?? 'not-an-answer' };
  return { ok: true, value };
}
