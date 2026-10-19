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

/** The columns an erasure blanks, named rather than discovered. */
export const ERASABLE_COLUMNS = ['erasable_answers', 'email', 'ip_hash'] as const;

export interface PreparedLink {
  fieldKey: string;
  urlRaw: string;
  url: string;
  urlKey: string;
  host: string;
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
 */
export function prepareAnswers(
  fields: readonly ListField[],
  submitted: Record<string, unknown>,
): Prepared {
  const answers: Record<string, AnswerValue> = {};
  const erasable: Record<string, AnswerValue> = {};
  const links: PreparedLink[] = [];
  const missing: string[] = [];

  for (const field of fields) {
    if (!isCollected(field)) continue;
    // An unstated lifetime is the one the KIND implies, never a blanket
    // default: an unstated retention read as transient would put a state or a
    // verdict in the erasable half, and its count would then shrink.
    const retention = retentionOf(field);
    const raw = submitted[field.key];
    const cap = field.max_values ?? 1;
    let value: AnswerValue | undefined;

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
        const dedup = got.url ? got.url.urlKey : JSON.stringify(got.value);
        if (seen.has(dedup)) continue;
        seen.add(dedup);
        out.push(String(got.value));
        if (got.url && LINK_KINDS.has(field.kind)) links.push(linkOf(field.key, item, got.url));
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
        links.push(linkOf(field.key, raw, got.url));
      }
    }

    if (value === undefined) {
      if (field.required) missing.push(field.key);
      continue;
    }
    if (retention === CLASSES.DURABLE) answers[field.key] = value;
    else erasable[field.key] = value;
  }

  if (missing.length) {
    return { ok: false, reason: 'missing-required', key: missing[0] ?? '', keys: missing };
  }
  return { ok: true, answers, erasable: Object.keys(erasable).length ? erasable : null, links };
}

function linkOf(
  fieldKey: string,
  raw: unknown,
  url: { url: string; urlKey: string; host: string },
): PreparedLink {
  const typed = (Array.isArray(raw) ? raw[0] : raw) as unknown;
  return {
    fieldKey,
    urlRaw: (typeof typed === 'string' ? typed : url.url).trim().slice(0, 2048),
    url: url.url,
    urlKey: url.urlKey,
    host: url.host,
  };
}
