/**
 * Turning what a form sent into what gets sealed.
 *
 * ONE SHAPE PER TYPE, decided here and nowhere else. A report that hashed
 * '3 Nov 2026' could never be checked against one that hashed '2026-11-03',
 * so normalizing is not tidying — it is the thing that makes two people's
 * answers comparable and a seal meaningful.
 *
 * THE ABSENT-KEY RULE APPLIES INSIDE THE MAP. A field nobody answered has
 * no entry at all, rather than an entry whose value is null. "Not answered"
 * and "answered with nothing" are different claims, and under RFC 8785 they
 * serialize differently — which is the whole reason the rule exists.
 * `src/reportCore.js` states it for the top level; this is the same rule one
 * level down.
 */
import { toTimeString } from './reportCore.js';
import { FILE_TYPE, UNSEALED_TYPES, LOCATION_TYPE } from './fieldTypes.js';
import { conditionMet } from './conditions.js';
import { normalizeLocation } from './gazetteer.js';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** A plain calendar day, or null if it is not one. */
function normalizeDate(v) {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Rejects 2026-02-31, which the regex alone is happy with.
  return d.toISOString().slice(0, 10) === s ? s : null;
}

/** A moment, kept as UTC ISO so it means the same thing read anywhere. */
function normalizeDateTime(v) {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeNumber(v, settings = {}) {
  const n = typeof v === 'number' ? v : Number(str(v));
  if (!Number.isFinite(n)) return null;
  if (settings.min !== null && settings.min !== undefined && n < settings.min) return null;
  if (settings.max !== null && settings.max !== undefined && n > settings.max) return null;
  return n;
}

function normalizeUrl(v) {
  const s = str(v);
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  // Only the two schemes a person can be shown. A javascript: or data: URL
  // in an archive that renders links is an attack, not an address.
  return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
}

function normalizeEmail(v) {
  const s = str(v).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

function normalizeChoice(v, settings = {}) {
  const s = str(v);
  const options = Array.isArray(settings.options) ? settings.options : [];
  if (!s) return null;
  // An answer outside the offered list is not an answer. The list is frozen
  // at launch, so this cannot fail for a reason the reporter could fix.
  return options.includes(s) ? s : null;
}

function normalizeChoiceMany(v, settings = {}) {
  const list = Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]);
  const options = Array.isArray(settings.options) ? settings.options : [];
  const kept = [...new Set(list.map(str).filter((s) => options.includes(s)))];
  // ORDER IS THE OPERATOR'S, NOT THE REPORTER'S. Two people ticking the same
  // boxes in a different order must produce the same seal.
  kept.sort((a, b) => options.indexOf(a) - options.indexOf(b));
  return kept.length ? kept : null;
}

function normalizePlace(v, settings = {}) {
  const s = str(v);
  if (!s) return null;
  const options = Array.isArray(settings.options) ? settings.options : [];
  if (!options.length || settings.allowOther) return s.slice(0, 200);
  return options.includes(s) ? s : null;
}

function normalizeYesNo(v) {
  if (v === true || v === 'true' || v === 'yes') return true;
  if (v === false || v === 'false' || v === 'no') return false;
  return null;
}

/**
 * Normalize ONE answer. Returns null for anything that is not a usable
 * answer of that type — and null means the key will be absent, never
 * present-and-null.
 */
export function normalizeAnswer(kind, value, settings = {}) {
  switch (kind) {
    case 'short_text': {
      const s = str(value);
      return s ? s.slice(0, settings.maxLength || 200) : null;
    }
    case 'long_text': {
      const s = str(value);
      return s ? s.slice(0, settings.maxLength || 5000) : null;
    }
    case 'date':        return normalizeDate(value);
    case 'time':        return str(value) ? toTimeString(value) : null;
    case 'datetime':    return normalizeDateTime(value);
    case 'place':       return normalizePlace(value, settings);
    // A CODE FROM THE GAZETTEER AND NOTHING ELSE. Uppercased first, so a
    // browser that sent `us-az` seals the same string as one that sent
    // `US-AZ`; a name is never accepted in place of a code, because
    // "Arizona" arriving where `US-AZ` was meant is a bug and sealing a
    // guess for it would hide the bug in the archive. One string, so no
    // new shape in the hashed object — src/gazetteer.js has the rest.
    case LOCATION_TYPE: return normalizeLocation(value, settings);
    case 'choice_one':  return normalizeChoice(value, settings);
    case 'choice_many': return normalizeChoiceMany(value, settings);
    case 'yes_no':      return normalizeYesNo(value);
    // A BOOLEAN, exactly as yes_no is, so the declaration adds no new shape
    // to the hashed object. Deliberately the same call and not a copy of
    // it: two normalizers for one shape is how the two come to disagree.
    case 'evidence_declaration': return normalizeYesNo(value);
    case 'number':      return normalizeNumber(value, settings);
    case 'email':       return normalizeEmail(value);
    case 'url':         return normalizeUrl(value);
    // NEVER SEALED HERE, and this case exists to say so rather than to let
    // the default below do it by accident. A report's files are sealed in the
    // top-level `attachments` key, computed from the manifest of what was
    // actually stored. Returning a value here would seal the same fact twice,
    // in two shapes, and would change the fingerprint of every report ever
    // filed. src/fieldTypes.js has the whole reasoning.
    case FILE_TYPE:     return null;
    default:            return null;
  }
}

/**
 * Build the sealed answers map for one submission against one field set.
 *
 * Returns { answers, errors }. `answers` is undefined — not an empty object
 * — when the logbook asked nothing or nothing was answered, so a report
 * with no answers carries no `answers` key in the seal at all.
 *
 * FIELDS THE LOGBOOK DOES NOT HAVE ARE DROPPED SILENTLY, not rejected. A
 * form open in a tab across a relaunch would otherwise fail on a key nobody
 * can see; the same trade the retired `layout` key took.
 */
export function buildAnswers(fields, body) {
  const answers = {};
  const errors = [];
  for (const f of fields) {
    // WAS THIS QUESTION ASKED AT ALL? Evaluated against the answers
    // accumulated so far, which works in one pass because a condition may
    // only name an earlier question — `normalizeCondition` refuses forward
    // references, and that is what makes this loop sufficient rather than
    // needing a second pass or a dependency sort.
    //
    // A QUESTION THAT WAS NOT PUT SEALS NOTHING, and its `required` does not
    // apply. Sealing an answer to a question the reporter never saw would
    // put words in the record nobody was asked for; failing the submission
    // because a hidden required question is unanswered would make the
    // condition useless.
    //
    // An answer that arrives for a hidden question is DROPPED rather than
    // rejected, the same trade the unknown-key case below takes: a form open
    // in a tab while somebody changed an earlier answer should not fail, and
    // the answer cannot be sealed either way.
    if (f.shown_when && !conditionMet(f.shown_when, answers)) continue;
    // An upload question is skipped outright, before the required check. It
    // never produces a sealed answer, so a `required` one would make every
    // submission fail forever on a field nobody can satisfy here — whether
    // files are actually needed is the attachment layer's question, asked
    // where the files are. addField refuses a required upload field for the
    // same reason; this is the second half of that care, because a row
    // written before that guard existed must not brick a logbook.
    if (UNSEALED_TYPES.has(f.kind)) continue;
    const raw = body ? body[f.key] : undefined;
    const value = normalizeAnswer(f.kind, raw, f.settings || {});
    if (value === null || value === undefined) {
      if (f.required) errors.push(`${f.label} is needed`);
      continue;
    }
    answers[f.key] = value;
  }
  return { answers: Object.keys(answers).length ? answers : undefined, errors };
}
