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

export const MAX_SEARCH_LEN = 200;

export function normalizeSearch(q: unknown): string | null {
  const s = typeof q === 'string' ? q.trim() : '';
  return s ? s.slice(0, MAX_SEARCH_LEN) : null;
}

/** A condition to AND into a query over `reports as r`. */
export function searchMatches(q: string): RawBuilder<boolean> {
  return sql<boolean>`(jsonb_to_tsvector('simple'::regconfig, coalesce(r.answers, '{}'::jsonb), '["string"]'::jsonb) || to_tsvector('simple'::regconfig, r.public_ref)) @@ websearch_to_tsquery('simple', ${q})`;
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
