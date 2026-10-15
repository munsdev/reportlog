/**
 * The rules, separated from the writes.
 *
 * WHY THIS FILE EXISTS. Everything here is pure, so `npm test` can assert
 * it — the unit suite takes no database, and src/db.js reads DATABASE_URL
 * at import time, so a rule living in a module that imports the pool is a
 * rule only the database suite can reach. The rules are the part most worth
 * testing cheaply and most worth reading in one place.
 *
 * Nothing in here performs I/O or knows that Postgres exists.
 */
import { normalizeValue } from './values.js';
import { LINK_KINDS, defaultRetention } from './fields.js';

/**
 * May this be counted publicly. The unit of review is what differs from a
 * logbook, not whether there is one: a report is read one by one, a page of
 * list entries is skimmed and approved together.
 */
export const REVIEW_STATES = Object.freeze(['received', 'approved', 'rejected']);

/**
 * Has an editor dealt with it. A DIFFERENT question from review, kept in a
 * different column, because one column answering both is the
 * two-notions-of-approved mistake and the failure is a published count that
 * disagrees with the queue.
 */
export const TRIAGE_STATES = Object.freeze(['new', 'triaged', 'actioned', 'closed']);

/** The columns an erasure blanks, named rather than discovered. */
export const ERASABLE_COLUMNS = Object.freeze(['erasable_answers', 'email', 'ip_hash']);

export const DEFAULT_DURABLE_LINK_DAYS = 365;

/**
 * How long an erasure link lives.
 *
 * AS LONG AS THERE IS SOMETHING TO ERASE, which is the only defensible
 * answer: a link that expires before the data does leaves somebody holding
 * a promise this deployment has stopped being able to keep. So it follows
 * the entry's own `personal_expires_at`, and falls back to a configured
 * window only where that is NULL — the durable profile, where nothing
 * expires on its own and the link is the only route there is.
 */
export function erasureExpiry(personalExpiresAt, now = new Date(), env = process.env) {
  if (personalExpiresAt) return new Date(personalExpiresAt);
  const raw = Number((env.LIST_ERASURE_LINK_DAYS ?? '').toString().trim());
  const days = Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_DURABLE_LINK_DAYS;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Normalize every answer in a submission against the form that asked for
 * them, and split the result by LIFETIME.
 *
 * THE SPLIT IS THE STRUCTURAL HEART OF THE FORMAT. `answers` holds what is
 * durable; `erasable` holds what the sweep blanks. Two columns rather than
 * one with a convention, so a query that counts `answers` CANNOT reach
 * anything erasable — the guarantee is in the shape, not in the care of
 * whoever writes the next query.
 *
 * A KEY IS PRESENT ONLY WHEN IT WAS ANSWERED. An aggregate has to tell
 * "never asked" from "asked and skipped", and a null cannot carry that.
 */
export function prepareAnswers(fields = [], submitted = {}) {
  const answers = {};
  const erasable = {};
  const links = [];
  const missing = [];

  for (const field of fields) {
    if (field.retention === 'absent' || field.enabled === false) continue;
    // A field definition that does not state its lifetime gets the one its
    // KIND implies, never a blanket default. Treating an unstated retention
    // as transient would put a state or a verdict in the erasable half, and
    // its count would then shrink on its own when the sweep ran.
    const retention = field.retention ?? defaultRetention(field.kind);

    const raw = submitted[field.key];
    const multi = (field.max_values ?? field.maxValues ?? 1) > 1
      || field.kind === 'choice_many';

    let value;
    if (multi && field.kind !== 'choice_many') {
      // A repeated single-value field, such as a tip's up-to-three links.
      const list = (Array.isArray(raw) ? raw : [raw])
        .filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
      const cap = field.max_values ?? field.maxValues ?? 1;
      if (list.length > cap) {
        return { ok: false, reason: 'too-many-values', key: field.key };
      }
      const out = [];
      const seen = new Set();
      for (const item of list) {
        const got = normalizeValue(field, item);
        if (!got.ok) return { ok: false, reason: got.reason, key: field.key, value: item };
        if (got.value === undefined) continue;
        // Duplicates WITHIN one submission are dropped. One person pasting
        // the same clip twice is one link: the whole value of a submission
        // count is that it counts people.
        const dedup = got.url ? got.url.urlKey : String(got.value);
        if (seen.has(dedup)) continue;
        seen.add(dedup);
        out.push(got.value);
        if (LINK_KINDS.has(field.kind) && got.url) {
          links.push({
            fieldKey: field.key,
            urlRaw: String(item).trim(),
            url: got.url.url,
            urlKey: got.url.urlKey,
            host: got.url.host,
          });
        }
      }
      value = out.length ? out : undefined;
    } else {
      const got = normalizeValue(field, raw);
      if (!got.ok) return { ok: false, reason: got.reason, key: field.key, value: raw };
      value = got.value;
      if (value !== undefined && LINK_KINDS.has(field.kind) && got.url) {
        links.push({
          fieldKey: field.key,
          urlRaw: String(raw).trim(),
          url: got.url.url,
          urlKey: got.url.urlKey,
          host: got.url.host,
        });
      }
    }

    if (value === undefined) {
      if (field.required) missing.push(field.key);
      continue;
    }
    if (retention === 'durable') answers[field.key] = value;
    else erasable[field.key] = value;
  }

  if (missing.length) return { ok: false, reason: 'missing-required', keys: missing };

  return {
    ok: true,
    answers,
    // NULL rather than an empty object when there is nothing erasable, so
    // the table's CHECK and the sweep agree about what "nothing" looks like.
    erasable: Object.keys(erasable).length ? erasable : null,
    links,
  };
}
