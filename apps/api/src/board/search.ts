/**
 * Searching reports: every string in a report's answers, and its reference.
 *
 * THE EXPRESSION MUST STAY CHARACTER FOR CHARACTER IN STEP with the GIN index
 * in migrations/20261019180411_moderation.sql. Postgres matches an expression
 * index by its tree, so a drifted copy silently falls back to a sequential
 * scan rather than erroring.
 *
 * 'simple', not 'english': no stemming, because nothing says a deployment's
 * reports are in English, and English stemming applied to Dutch or German
 * text finds less than no stemming does.
 *
 * websearch_to_tsquery accepts whatever a person types: quoted phrases, OR,
 * -exclusions and stray punctuation parse instead of throwing.
 */
import { sql } from 'kysely';
import type { RawBuilder } from 'kysely';
import { GAZETTEER } from '@reportlog/fields';

export const MAX_SEARCH_LEN = 200;

export function normalizeSearch(q: unknown): string | null {
  const s = typeof q === 'string' ? q.trim() : '';
  return s ? s.slice(0, MAX_SEARCH_LEN) : null;
}

/**
 * PLACES ARE SEALED AS CODES, so searching their names found nothing: a
 * report from Arizona holds `US-AZ`, or `US-AZ-04013` for a county in it, and
 * "Arizona" is in no answer. A query that IS a place's name (a state, a
 * county with or without "County", a country) is also matched against that
 * code, and a state's against every county inside it.
 */
const SUFFIX = / (county|parish|borough|census area|city and borough|municipality|municipio)$/;
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();

export function placeCodesFor(q: string): { exact: string[]; within: string[] } {
  const want = fold(q).replace(/^"|"$/g, '');
  if (want.length < 3) return { exact: [], within: [] };
  const exact: string[] = [];
  const within: string[] = [];
  for (const [code, name] of Object.entries(GAZETTEER.countries)) {
    if (fold(name) === want) exact.push(code);
  }
  for (const subs of Object.values(GAZETTEER.subdivisions)) {
    for (const [code, name] of Object.entries(subs)) {
      if (fold(name) !== want) continue;
      // A state answered by postal code (`AZ`) is the same state.
      exact.push(code, code.replace(/^US-/, ''));
      within.push(`${code}-`);
    }
  }
  for (const [code, name] of Object.entries(GAZETTEER.counties)) {
    const n = fold(name);
    if (n === want || n.replace(SUFFIX, '') === want) exact.push(code);
  }
  return { exact, within };
}

/**
 * A CODED CHOICE IS SEALED AS ITS CODE (`problem`), shown as its label
 * ("Something went wrong"). A query found in an option's label matches the
 * reports that chose that option, on that logbook's question: one choice
 * (the code itself) or several (an array holding it).
 */
function choiceMatches(q: string): RawBuilder<boolean> {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM logbook_fields AS f,
      jsonb_array_elements(CASE WHEN jsonb_typeof(f.settings -> 'options') = 'array'
        THEN f.settings -> 'options' ELSE '[]'::jsonb END) AS o
    WHERE f.logbook_id = r.logbook_id
      AND jsonb_typeof(o) = 'object'
      AND position(lower(${q}) IN lower(o ->> 'label')) > 0
      AND (r.answers -> f.key = to_jsonb(o ->> 'code')
           OR r.answers -> f.key @> jsonb_build_array(o ->> 'code'))
  )`;
}

/** A condition to AND into a query over `reports as r`. */
export function searchMatches(q: string): RawBuilder<boolean> {
  // The text match stays exactly as the index has it (see the top of this file).
  const text = sql<boolean>`(jsonb_to_tsvector('simple'::regconfig, coalesce(r.answers, '{}'::jsonb), '["string"]'::jsonb) || to_tsvector('simple'::regconfig, r.public_ref)) @@ websearch_to_tsquery('simple', ${q})`;
  const { exact, within } = placeCodesFor(q);
  const like = within.map((p) => `${p}%`);
  const place = exact.length
    ? sql<boolean>` OR EXISTS (
    SELECT 1 FROM jsonb_each_text(coalesce(r.answers, '{}'::jsonb)) AS e(key, value)
    WHERE e.value = ANY(${exact}::text[])${like.length ? sql` OR e.value LIKE ANY(${like}::text[])` : sql``}
  )`
    : sql``;
  return sql<boolean>`(${text} OR ${choiceMatches(q)}${place})`;
}

/** The only sort words there are; anything else is newest first. */
export const sortDirection = (v: unknown): 'asc' | 'desc' => (v === 'oldest' ? 'asc' : 'desc');

/** A question key, in the shape the schema enforces. Nothing else reaches a query. */
export const ANSWER_KEY = /^[a-z0-9][a-z0-9_]{0,38}$/;

/**
 * One answer filter. THREE TESTS, OR'd, because one answer shape does not
 * cover them all:
 *
 *   {"station": "Station 12"}  a plain answer, matched by containment
 *   {"tags": ["Police"]}       one value inside a multiple choice
 *   {"hurt": true, "n": 3}     not strings at all
 *
 * The middle one is the trap: jsonb's "an array contains a scalar" applies
 * only at the top level of the operand, so `{"tags":["Police"]} @>
 * {"tags":"Police"}` is false and the value must be wrapped in an array.
 */
export function answerMatches(key: string, value: string): RawBuilder<boolean> {
  return sql<boolean>`(r.answers @> jsonb_build_object(${key}::text, ${value}::text) OR r.answers @> jsonb_build_object(${key}::text, jsonb_build_array(${value}::text)) OR (r.answers ->> ${key}::text) = ${value})`;
}
