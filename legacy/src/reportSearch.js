// Shared full-text search fragment for report queries. It searches every
// string in a report's answers, and its reference. The expression here
// must stay character-for-character in step with the GIN index in
// migrations/029_logbooks_only.sql — Postgres matches an expression index
// by the expression tree, so a drifted column list silently falls back to
// a sequential scan rather than erroring.
//
// websearch_to_tsquery (not to_tsquery) because it accepts whatever a
// human types: quoted phrases, OR, -exclusions, and stray punctuation all
// parse instead of throwing a syntax error at the user.
const VECTOR = `(jsonb_to_tsvector('english'::regconfig, coalesce(r.answers, '{}'::jsonb), '["string"]')
  || to_tsvector('english'::regconfig, r.public_ref))`;

export const MAX_SEARCH_LEN = 200;

export function normalizeSearch(q) {
  const s = String(q || '').trim();
  return s ? s.slice(0, MAX_SEARCH_LEN) : null;
}

// Returns a clause to AND into an existing WHERE, given the parameter
// number the caller has allocated for the search term.
export function searchClause(paramIndex) {
  return `${VECTOR} @@ websearch_to_tsquery('english', $${paramIndex})`;
}

// A plain ISO date, or nothing. Anything else is dropped rather than passed
// to Postgres, so a junk value narrows nothing instead of erroring. There is
// no built-in date filter on the board — a date is a question a logbook
// asks — so this is for the places that filter on when a report arrived.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeDate(v) {
  const s = String(v || '').trim();
  return ISO_DATE.test(s) ? s : null;
}

// Only ever interpolated as a bare ASC/DESC keyword, never user text.
export function sortDirection(v) {
  return String(v || '').toLowerCase() === 'oldest' ? 'ASC' : 'DESC';
}

// Reporter type is a second, independent axis alongside moderation status.
// It is deliberately NOT a credibility ranking: a credentialed observer is
// differently positioned (inside access, training, an organization), not
// automatically more accurate than a voter who watched it happen. The
// credibility judgement is moderation status; these two compose.

// THE VERACITY FILTER IS GONE, with the verdict it filtered on. See
// src/taxonomy.js for why the verdict was withdrawn. Nothing writes
// `report_heads.veracity` any more, so a filter over it would narrow a
// board by a value every row shares — a control that looks like it does
// something and cannot.
