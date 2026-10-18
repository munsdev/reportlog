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
import type { AnswerValue, FieldSettings } from './types.ts';

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

function optionsOf(settings: FieldSettings): string[] {
  return Array.isArray(settings.options) ? settings.options : [];
}

function normalizeChoice(v: unknown, settings: FieldSettings): string | null {
  const s = str(v);
  if (!s) return null;
  // An answer outside the offered list is not an answer.
  return optionsOf(settings).includes(s) ? s : null;
}

function normalizeChoiceMany(v: unknown, settings: FieldSettings): string[] | null {
  const list: unknown[] = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  const options = optionsOf(settings);
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

function normalizeYesNo(v: unknown): boolean | null {
  if (v === true || v === 'true' || v === 'yes') return true;
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
      return normalizeDate(value);
    case 'time':
      return toTimeString(value);
    case 'datetime':
      return normalizeDateTime(value);
    case 'place':
      return normalizePlace(value, settings);
    case LOCATION_TYPE:
      return normalizeLocation(value, settings);
    case 'choice_one':
      return normalizeChoice(value, settings);
    case 'choice_many':
      return normalizeChoiceMany(value, settings);
    // The declaration seals a BOOLEAN exactly as yes_no does, through the same
    // call: two normalizers for one shape is how the two come to disagree.
    case 'yes_no':
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
