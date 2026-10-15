/**
 * Review, in bulk.
 *
 * NOTHING IS COUNTED PUBLICLY UNTIL A MODERATOR APPROVES IT. The difference
 * from a logbook is the UNIT of review, not whether there is one: a report
 * is read one by one against criteria, a page of list entries is skimmed
 * and approved together — fifty links, none of them a sneaky link to
 * somewhere unpleasant, approve them all and send it through.
 *
 * SO THE PANE HAS TO SHOW WHAT MAKES SKIMMING SAFE, because a reviewer
 * approving fifty rows at a time can only catch what the page puts in front
 * of them. `reviewBatch` is what the pane reads: the host of every link
 * with unfamiliar ones marked, and submission clusters. A reviewer is not
 * going to read fifty URLs, so the unfamiliar host is flagged for them; and
 * a flood from one source is only ever visible as a cluster, never row by
 * row.
 *
 * APPROVAL IS RECORDED, AND IT IS NOT A DELETION. Rejecting an entry stops
 * it being counted and leaves it in the queue — the row is still there, the
 * retention clock still governs its erasable half, and a subject access
 * request can still be answered about it. Nothing here deletes anything.
 */
import { pool } from '../db.js';
import { REVIEW_STATES, TRIAGE_STATES } from './policy.js';

/**
 * A page of entries to review, with the two things that make bulk review
 * honest rather than a rubber stamp.
 *
 * `knownHosts` is the operator's familiar-domain list. It SORTS rather than
 * blocks — nothing is rejected for being unfamiliar, it is just the thing a
 * reviewer's eye should go to first.
 */
export async function reviewBatch(
  listId,
  { client = pool, limit = 100, state = 'received', knownHosts = [] } = {},
) {
  const size = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const { rows } = await client.query(
    `SELECT e.id, e.created_at, e.review_state, e.triage_state,
            e.answers, e.erasable_answers, e.ip_hash IS NOT NULL AS has_address,
            e.email IS NOT NULL AS has_email, e.erased_at,
            coalesce(
              (SELECT json_agg(json_build_object(
                 'fieldKey', l.field_key, 'urlRaw', l.url_raw,
                 'host', l.host, 'urlKey', l.url_key)
                 ORDER BY l.id)
                 FROM list_entry_links l WHERE l.entry_id = e.id),
              '[]'::json) AS links
       FROM list_entries e
      WHERE e.list_id = $1
        AND ($2::text IS NULL OR e.review_state = $2)
      ORDER BY e.created_at
      LIMIT $3`,
    [listId, state, size],
  );

  const known = new Set(knownHosts.map((h) => String(h).toLowerCase()));
  const entries = rows.map((r) => ({
    id: Number(r.id),
    createdAt: r.created_at,
    reviewState: r.review_state,
    triageState: r.triage_state,
    answers: r.answers,
    // Shown to a MODERATOR, who is the one person who has to read it to do
    // their job. It is not published and it is still swept on schedule.
    erasableAnswers: r.erasable_answers,
    hasEmail: r.has_email,
    hasAddress: r.has_address,
    erased: r.erased_at !== null,
    links: (r.links || []).map((l) => ({ ...l, knownHost: known.has(String(l.host).toLowerCase()) })),
  }));

  return { entries, clusters: clustersIn(entries, rows) };
}

/**
 * Suspicious sameness, which is the thing a reviewer cannot see row by row.
 *
 * WHAT A CLUSTER IS AND IS NOT: fifty check-ins from one state in one
 * minute is usually a local radio mention, which is the system working.
 * Fifty from one hashed address is one person pressing a button fifty
 * times. The two look identical in a list of timestamps, and the hashed
 * address is the only thing that tells them apart — which is one of the
 * reasons it is collected at all.
 *
 * Reported, never acted on. A cluster is a thing for a person to look at.
 */
export function clustersIn(entries, rows = []) {
  const byAddress = new Map();
  rows.forEach((r, i) => {
    // The hash itself never leaves this function: entries are grouped by it
    // and the group is reported by SIZE, not by which hash it was.
    const h = r.ip_hash;
    if (!h) return;
    if (!byAddress.has(h)) byAddress.set(h, []);
    byAddress.get(h).push(entries[i].id);
  });

  const repeated = [...byAddress.values()].filter((ids) => ids.length > 1);

  // Same minute, regardless of source — the shape of a burst.
  const byMinute = new Map();
  for (const e of entries) {
    const minute = new Date(e.createdAt).toISOString().slice(0, 16);
    if (!byMinute.has(minute)) byMinute.set(minute, 0);
    byMinute.set(minute, byMinute.get(minute) + 1);
  }
  const busiest = [...byMinute.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([minute, count]) => ({ minute, count }));

  return {
    repeatedSubmitters: repeated.length,
    largestRepeatedSubmitter: repeated.reduce((m, ids) => Math.max(m, ids.length), 0),
    entriesFromRepeatedSubmitters: repeated.flat(),
    busiestMinutes: busiest,
  };
}

/**
 * Approve or reject a set of entries in one statement.
 *
 * Takes explicit ids rather than "everything matching" on purpose: a
 * reviewer approves the page they actually looked at, and a filter that
 * moved between the render and the click would otherwise approve rows
 * nobody saw.
 */
export async function reviewEntries(
  listId, ids, { state, by = null, client = pool } = {},
) {
  if (!REVIEW_STATES.includes(state)) throw new Error(`unknown review state: ${state}`);
  if (state === 'received') throw new Error('an entry cannot be un-reviewed');
  const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isInteger);
  if (!list.length) return { changed: 0 };

  const { rowCount } = await client.query(
    `UPDATE list_entries
        SET review_state = $3, reviewed_at = now(), reviewed_by = $4
      WHERE list_id = $1 AND id = ANY($2::bigint[])`,
    [listId, list, state, by],
  );
  return { changed: rowCount };
}

export async function setTriageState(
  listId, ids, { state, client = pool } = {},
) {
  if (!TRIAGE_STATES.includes(state)) throw new Error(`unknown triage state: ${state}`);
  const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isInteger);
  if (!list.length) return { changed: 0 };
  const { rowCount } = await client.query(
    'UPDATE list_entries SET triage_state = $3 WHERE list_id = $1 AND id = ANY($2::bigint[])',
    [listId, list, state],
  );
  return { changed: rowCount };
}

/** How much is waiting, which is the number that says whether anybody is reading. */
export async function pendingCount(listId, { client = pool } = {}) {
  const { rows } = await client.query(
    `SELECT count(*) AS waiting, min(created_at) AS oldest
       FROM list_entries WHERE list_id = $1 AND review_state = 'received'`,
    [listId],
  );
  return { waiting: Number(rows[0].waiting), oldest: rows[0].oldest };
}
