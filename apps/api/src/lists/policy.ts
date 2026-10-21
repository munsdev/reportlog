/**
 * The rules about an entry, separated from the writes so the unit suite can
 * reach them without a database.
 */
import type { AnswerValue } from '@reportlog/fields';
import { LINK_KINDS, isCollected, retentionOf } from './fields.ts';
import type { ListField } from './fields.ts';
import { CLASSES } from './retention.ts';
import { normalizeValue } from './values.ts';

/**
 * May this be counted publicly. The UNIT of review is what differs from a
 * logbook, not whether there is one: a report is read one by one, a page of
 * entries is skimmed and approved together.
 */
export const REVIEW_STATES = ['received', 'approved', 'rejected'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/**
 * Has an editor dealt with it. A DIFFERENT question from review, in a
 * different column: one column answering both is the two-notions-of-approved
 * mistake, and the failure is a published count that disagrees with the queue.
 */
export const TRIAGE_STATES = ['new', 'triaged', 'actioned', 'closed'] as const;
export type TriageState = (typeof TRIAGE_STATES)[number];

/**
 * The columns an erasure blanks, named rather than discovered. The email is
 * three: its ciphertext, its own key and its keyed digest (ruling 40). The
 * entry's links are erased with them, in the links module (lists/erasure.ts).
 */
export const ERASABLE_COLUMNS = [
  'erasable_answers',
  'email_enc',
  'email_key',
  'email_hmac',
] as const;

/** A link, normalized, on its way to the links module. NEVER in `answers`. */
export interface PreparedLink {
  fieldKey: string;
  /** The normalized form (lists/urls.ts): what is encrypted and what is matched. */
  url: string;
  host: string;
  /** What kind of link it is, a code from the question's `link_types`, when it has them. */
  type?: string;
}

/** The kinds of link a link question asks for beside each link, when it does. */
export function linkTypesOf(field: Pick<ListField, 'kind' | 'settings'>): string[] {
  const t = field.settings?.link_types;
  return field.kind === 'url' && Array.isArray(t)
    ? t.filter((o) => typeof o.code === 'string').map((o) => o.code)
    : [];
}

/** One row as sent: a link and its kind. Anything else in it is not a row. */
function rowOf(raw: unknown): { url: unknown; type: unknown } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => k !== 'url' && k !== 'type')) return null;
  return { url: r.url, type: r.type };
}

export type Prepared =
  | {
      ok: true;
      answers: Record<string, AnswerValue>;
      /** NULL rather than {} when nothing is erasable, as the table's CHECK says. */
      erasable: Record<string, AnswerValue> | null;
      links: PreparedLink[];
    }
  | { ok: false; reason: string; key?: string; keys?: string[] };

const blank = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Normalize every answer in a submission against the form that asked, and
 * split the result BY LIFETIME.
 *
 * THE SPLIT IS THE STRUCTURAL HEART OF THE FORMAT. `answers` holds what is
 * durable; `erasable` holds what the sweep blanks. A KEY IS PRESENT ONLY WHEN
 * IT WAS ANSWERED. Keys the form does not ask are dropped silently: a form
 * left open in a tab must not fail on a question nobody can see.
 *
 * A LINK IS IN NEITHER HALF (Plan D §5). It goes to `links`, and from there
 * to its own encrypted row: a copy in the answers would be a plaintext link
 * store all over again.
 */
export function prepareAnswers(
  fields: readonly ListField[],
  submitted: Record<string, unknown>,
  { strict = false }: { strict?: boolean } = {},
): Prepared {
  const answers: Record<string, AnswerValue> = {};
  const erasable: Record<string, AnswerValue> = {};
  const links: PreparedLink[] = [];
  const missing: string[] = [];

  // A STRICT FORM (lists.strict, ruling 49) refuses what the lenient one
  // drops: a key it does not ask. Blank is not an answer, so never refused.
  if (strict) {
    const asked = new Set(fields.filter(isCollected).map((f) => f.key));
    const stray = Object.entries(submitted).find(
      ([k, v]) => !asked.has(k) && !blank(v) && !(Array.isArray(v) && v.every(blank)),
    );
    if (stray) return { ok: false, reason: 'not-asked', key: stray[0] };
  }

  for (const field of fields) {
    if (!isCollected(field)) continue;
    // An unstated lifetime is the one the KIND implies, never a blanket
    // default: an unstated retention read as transient would put a state or a
    // verdict in the erasable half, and its count would then shrink.
    const retention = retentionOf(field);
    const raw = submitted[field.key];
    const cap = field.max_values ?? 1;
    let value: AnswerValue | undefined;

    const types = linkTypesOf(field);
    if (types.length) {
      // ROWS OF A LINK AND ITS KIND (the tip list, §04). Positional: row 1 is
      // the first row sent, so a required question needs row 1 filled, which
      // is the row the form marks. Both or neither in every row.
      const rows = Array.isArray(raw) ? raw : blank(raw) ? [] : [raw];
      if (rows.length > cap) return { ok: false, reason: 'too-many-values', key: field.key };
      const out: string[] = [];
      const seen = new Set<string>();
      for (const [i, item] of rows.entries()) {
        const row = item === null || item === undefined ? { url: '', type: '' } : rowOf(item);
        if (!row) return { ok: false, reason: 'not-a-link-row', key: field.key };
        const noUrl = blank(row.url);
        const noType = blank(row.type);
        if (noUrl && noType) {
          if (i === 0 && field.required) missing.push(field.key);
          continue;
        }
        if (noUrl) return { ok: false, reason: 'type-without-link', key: field.key };
        if (noType) return { ok: false, reason: 'link-without-type', key: field.key };
        if (typeof row.type !== 'string' || !types.includes(row.type.trim()))
          return { ok: false, reason: 'not-an-option', key: field.key };
        const got = normalizeValue(field, row.url);
        if (!got.ok) return { ok: false, reason: got.reason, key: field.key };
        if (!got.url) continue;
        if (seen.has(got.url.url)) continue;
        seen.add(got.url.url);
        out.push(got.url.url);
        links.push({ ...linkOf(field.key, got.url), type: row.type.trim() });
      }
      if (missing.includes(field.key)) continue;
      if (!out.length && field.required) missing.push(field.key);
      continue;
    }

    if (cap > 1 && field.kind !== 'choice_many') {
      // A repeated single-value question, such as a tip's up-to-three links.
      const list = (Array.isArray(raw) ? raw : [raw]).filter((v) => !blank(v));
      if (list.length > cap) return { ok: false, reason: 'too-many-values', key: field.key };
      const out: string[] = [];
      const seen = new Set<string>();
      for (const item of list) {
        const got = normalizeValue(field, item);
        if (!got.ok) return { ok: false, reason: got.reason, key: field.key };
        if (got.value === undefined) continue;
        // ONE PERSON PASTING THE SAME LINK TWICE IS ONE LINK: the whole value
        // of a submission count is that it counts people.
        const dedup = got.url ? got.url.url : JSON.stringify(got.value);
        if (seen.has(dedup)) continue;
        seen.add(dedup);
        out.push(String(got.value));
        if (got.url && LINK_KINDS.has(field.kind)) links.push(linkOf(field.key, got.url));
      }
      value = out.length ? out : undefined;
    } else {
      const got = normalizeValue(
        field,
        Array.isArray(raw) && field.kind !== 'choice_many' ? raw[0] : raw,
      );
      if (!got.ok) return { ok: false, reason: got.reason, key: field.key };
      value = got.value;
      if (value !== undefined && got.url && LINK_KINDS.has(field.kind)) {
        links.push(linkOf(field.key, got.url));
      }
    }

    if (value === undefined) {
      if (field.required) missing.push(field.key);
      continue;
    }
    if (LINK_KINDS.has(field.kind)) continue;
    if (retention === CLASSES.DURABLE) answers[field.key] = value;
    else erasable[field.key] = value;
  }

  if (missing.length) {
    return { ok: false, reason: 'missing-required', key: missing[0] ?? '', keys: missing };
  }
  return { ok: true, answers, erasable: Object.keys(erasable).length ? erasable : null, links };
}

function linkOf(fieldKey: string, url: { url: string; host: string }): PreparedLink {
  return { fieldKey, url: url.url, host: url.host };
}
