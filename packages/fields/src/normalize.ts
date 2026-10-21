/**
 * Turning what a form sent into what gets sealed.
 *
 * ONE SHAPE PER TYPE, decided here and nowhere else. A report that sealed
 * '3 Nov 2026' could never be compared with one that sealed '2026-11-03', so
 * normalizing is not tidying: it is what makes a seal meaningful.
 *
 * `null` MEANS NOT ANSWERED, and a not-answered question gets NO KEY in the
 * sealed map, never a key whose value is null. Under RFC 8785 those
 * serialize differently. That is the whole reason the rule exists.
 */
import { FILE_TYPE, LOCATION_TYPE } from './fieldTypes.ts';
import { normalizeLocation } from './gazetteer.ts';
import { offeredCodes } from './options.ts';
import type { Answers, AnswerValue, FieldSettings } from './types.ts';

/**
 * What a question's answer may depend on: the answers to the questions
 * before it (an option set, a county inside its state). Optional, and a
 * caller without it gets the lenient reading (every code any set offers).
 */
export interface AnswerContext {
  answers?: Partial<Answers> | undefined;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The one written form of a time of day: HH:MM:SS, zero-padded.
 *
 * `<input type="time">` sends "09:30"; PostgreSQL renders a `time` back as
 * "09:30:00". Whichever string is sealed has to be the one that comes back
 * out, so there is exactly one written form.
 *
 * Anything that is not a clock time is null. (The old implementation sealed
 * unparseable input as typed, so "noon" became a sealed "time". It does not
 * here.)
 */
export function toTimeString(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
  if (!m) return null;
  const [, h = '', min = '', sec = '00'] = m;
  if (Number(h) > 23 || Number(min) > 59 || Number(sec) > 59) return null;
  return `${h.padStart(2, '0')}:${min}:${sec}`;
}

/** A plain calendar day, or null if it is not a real one. */
function normalizeDate(v: unknown): string | null {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Rejects 2026-02-31, which the pattern alone accepts.
  return d.toISOString().slice(0, 10) === s ? s : null;
}

/** A moment, kept as UTC ISO so it means the same thing read anywhere. */
function normalizeDateTime(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A date, a time or a date and time, in its one written form, or null. */
function momentOf(kind: string, v: unknown): string | null {
  if (kind === 'date') return normalizeDate(v);
  if (kind === 'time') return toTimeString(v);
  return normalizeDateTime(v);
}

/** The kinds that may carry an earliest and a latest answer (owner decision E4). */
export const LIMITED_KINDS: ReadonlySet<string> = new Set(['date', 'time', 'datetime']);

/**
 * A question's earliest and latest answers, each in the kind's own written
 * form (a day, HH:MM:SS, or a UTC ISO moment), or absent. A limit that is
 * not one of those is ignored here; the builder refuses it on the way in.
 */
export function limitsOf(
  kind: string,
  settings: FieldSettings = {},
): { earliest?: string; latest?: string } {
  if (!LIMITED_KINDS.has(kind)) return {};
  const earliest = momentOf(kind, settings.earliest);
  const latest = momentOf(kind, settings.latest);
  return { ...(earliest ? { earliest } : {}), ...(latest ? { latest } : {}) };
}

/**
 * AN ANSWER OUTSIDE ITS LIMITS IS NOT AN ANSWER, the way a number outside its
 * bounds is not (owner decision E4). Each written form compares as text: a
 * day and HH:MM:SS by construction, and a moment because both sides are UTC
 * ISO with milliseconds. A question without limits reads exactly as before,
 * so no earlier form, seal or vector changes.
 */
function withinLimits(kind: string, v: string | null, settings: FieldSettings): string | null {
  if (v === null) return null;
  const { earliest, latest } = limitsOf(kind, settings);
  if (earliest !== undefined && v < earliest) return null;
  if (latest !== undefined && v > latest) return null;
  return v;
}

/**
 * A finite number within the operator's bounds. A blank box is NOT zero.
 * (The old implementation sealed `Number('')`, which is 0.)
 */
function normalizeNumber(v: unknown, settings: FieldSettings): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else {
    const s = str(v);
    if (!s) return null;
    n = Number(s);
  }
  if (!Number.isFinite(n)) return null;
  // Written only when true, so a number question made before it is unchanged.
  if (settings.integer === true && !Number.isInteger(n)) return null;
  if (typeof settings.min === 'number' && n < settings.min) return null;
  if (typeof settings.max === 'number' && n > settings.max) return null;
  return n;
}

function normalizeUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  // Only the two schemes a person can be shown. A javascript: or data: URL in
  // an archive that renders links is an attack, not an address.
  return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
}

function normalizeEmail(v: unknown): string | null {
  const s = str(v).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/**
 * The CODES a choice accepts. A plain string option is its own code, so a
 * form with string options accepts and seals exactly what it always did.
 */
function optionsOf(settings: FieldSettings, context?: AnswerContext): string[] {
  return offeredCodes(settings, context?.answers);
}

function normalizeChoice(
  v: unknown,
  settings: FieldSettings,
  context?: AnswerContext,
): string | null {
  const s = str(v);
  if (!s) return null;
  // An answer outside the offered list is not an answer.
  return optionsOf(settings, context).includes(s) ? s : null;
}

function normalizeChoiceMany(
  v: unknown,
  settings: FieldSettings,
  context?: AnswerContext,
): string[] | null {
  const list: unknown[] = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  const options = optionsOf(settings, context);
  const kept = [...new Set(list.map(str).filter((s) => options.includes(s)))];
  // ORDER IS THE OPERATOR'S, NOT THE REPORTER'S: the same boxes ticked in a
  // different order must produce the same seal.
  kept.sort((a, b) => options.indexOf(a) - options.indexOf(b));
  return kept.length ? kept : null;
}

function normalizePlace(v: unknown, settings: FieldSettings): string | null {
  const s = str(v);
  if (!s) return null;
  const options = optionsOf(settings);
  if (!options.length || settings.allowOther) return s.slice(0, 200);
  return options.includes(s) ? s : null;
}

function normalizeYesNo(v: unknown, settings: FieldSettings = {}): boolean | null {
  if (v === true || v === 'true' || v === 'yes') return true;
  // A TICK BOX SEALS TRUE OR NOTHING: unticked is "not ticked", never a
  // sealed false, so its key exists only when the box was ticked.
  if (settings.checkbox === true) return null;
  if (v === false || v === 'false' || v === 'no') return false;
  return null;
}

/**
 * A text question's length limit. Unset, zero or nonsense means the type's
 * default, never "zero characters": that would seal an empty string, and an
 * empty string is an answer.
 */
function lengthLimit(settings: FieldSettings, fallback: number): number {
  const n = settings.maxLength;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Normalize ONE answer. `null` means the key will be absent. */
export function normalizeAnswer(
  kind: string,
  value: unknown,
  settings: FieldSettings = {},
  context?: AnswerContext,
): AnswerValue | null {
  switch (kind) {
    case 'short_text': {
      const s = str(value);
      return s ? s.slice(0, lengthLimit(settings, 200)) : null;
    }
    case 'long_text': {
      const s = str(value);
      return s ? s.slice(0, lengthLimit(settings, 5000)) : null;
    }
    case 'date':
    case 'time':
    case 'datetime':
      return withinLimits(kind, momentOf(kind, value), settings);
    case 'place':
      return normalizePlace(value, settings);
    case LOCATION_TYPE:
      return normalizeLocation(value, settings, context?.answers);
    case 'choice_one':
      return normalizeChoice(value, settings, context);
    case 'choice_many':
      return normalizeChoiceMany(value, settings, context);
    // The declaration seals a BOOLEAN exactly as yes_no does, through the same
    // call: two normalizers for one shape is how the two come to disagree.
    case 'yes_no':
      return normalizeYesNo(value, settings);
    case 'evidence_declaration':
      return normalizeYesNo(value);
    case 'number':
      return normalizeNumber(value, settings);
    case 'email':
      return normalizeEmail(value);
    case 'url':
      return normalizeUrl(value);
    // NEVER SEALED HERE. Files are sealed in the top-level `attachments` key.
    case FILE_TYPE:
      return null;
    default:
      return null;
  }
}
