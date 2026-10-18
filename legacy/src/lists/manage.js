/**
 * What an administrator does to a list: make one, change its switches,
 * change its questions, and remove one nobody has used.
 *
 * EVERY WRITE TO A LIST'S QUESTIONS GOES THROUGH `assertCollectable`, here
 * and not in the route, for the reason `assertDraft` lives in
 * src/logbooks.js: a guard in a route is a guard the next route forgets.
 * So the countable box beside a long-text question, an upload question, a
 * counted field the sweep would erase — all refused by this module whoever
 * calls it.
 *
 * THERE IS NO ONE-WAY DOOR. A list seals nothing, so its questions can be
 * reworded, removed and reordered after entries arrive. The one thing kept
 * fixed is a question's KEY once it exists, because the key is what every
 * stored answer is filed under: renaming one would leave every earlier
 * answer filed under a name the form no longer asks, and its count would
 * restart from nothing. A new key is a new question.
 *
 * NOTHING HERE READS WHICH TEMPLATE MADE A LIST. A template is applied once
 * and is then over — see src/lists/templates.js.
 */
import { pool } from '../db.js';
import { assertCollectable, collectionRequirements, defaultRetention } from './fields.js';
import { shippedTemplates, applyListTemplate } from './templates.js';
import { isAccepting } from './entries.js';
import { pendingCount } from './review.js';
import { FIELD_TYPE_IDS } from '../fieldTypes.js';

export const VISIBILITIES = Object.freeze(['hidden', 'password', 'listed']);
/* Past the site password: behind it (default), anybody with the link, or
   linked from the password page. Migration 047. */
export const OUTSIDE = Object.freeze(['closed', 'link', 'door']);
/* Ask for an address only of somebody who writes something, or always.
   Migration 048. */
export const EMAIL_MODES_LIST = Object.freeze(['auto', 'required']);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A refusal a route can turn into words. Never a stack trace on the page. */
export class ListRefusal extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

async function fieldsOf(listId, client) {
  const { rows } = await client.query(
    'SELECT * FROM list_fields WHERE list_id = $1 ORDER BY position, id', [listId],
  );
  return rows;
}

/** One list, by id, with its questions — or null. */
export async function listById(id, { client = pool } = {}) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  const { rows } = await client.query('SELECT * FROM lists WHERE id = $1', [n]);
  if (!rows[0]) return null;
  return { ...rows[0], fields: await fieldsOf(n, client) };
}

/** Every list, with what the admin table shows beside it. */
export async function allLists({ client = pool, now = new Date() } = {}) {
  const { rows } = await client.query(
    `SELECT l.*,
            (SELECT count(*) FROM list_entries e WHERE e.list_id = l.id) AS received,
            (SELECT count(*) FROM list_entries e
              WHERE e.list_id = l.id AND e.review_state = 'received') AS waiting
       FROM lists l
      ORDER BY l.created_at, l.id`,
  );
  const out = [];
  for (const r of rows) {
    const fields = await fieldsOf(r.id, client);
    out.push({
      ...describe({ ...r, fields }, now),
      received: Number(r.received),
      waiting: Number(r.waiting),
    });
  }
  return out;
}

/**
 * The shape the admin pane reads. `requiresEmail` is DERIVED here, every
 * time, from the questions — never stored — so it cannot disagree with them.
 */
export function describe(list, now = new Date()) {
  const req = collectionRequirements(list.fields || []);
  return {
    id: Number(list.id),
    slug: list.slug,
    title: list.title,
    blurb: list.blurb,
    visibility: list.visibility,
    outsideAccess: list.outside_access || 'closed',
    notify: list.notify === true,
    emailMode: list.email_mode || 'auto',
    notifyEmail: list.notify_email || null,
    notifyPendingEmail: list.notify_pending_email || null,
    opensAt: list.opens_at,
    closesAt: list.closes_at,
    closedAt: list.closed_at,
    accepting: isAccepting(list, now),
    aggregatesPublished: list.aggregates_published === true,
    requiresEmail: req.requiresEmail,
    personalKeys: req.personalKeys,
    countableKeys: req.aggregatableKeys,
    createdAt: list.created_at,
    fields: (list.fields || []).map((f) => ({
      id: Number(f.id),
      key: f.key,
      kind: f.kind,
      label: f.label,
      help: f.help,
      required: f.required,
      options: f.options,
      maxValues: f.max_values,
      aggregatable: f.aggregatable,
      retention: f.retention,
    })),
  };
}

/** The shipped starting points, as the "create a list" dialog lists them. */
export function templateChoices() {
  return shippedTemplates().map((t) => ({
    slug: t.slug,
    title: t.title,
    blurb: t.blurb,
    requiresEmail: t.requiresEmail,
    questions: t.fields.map((f) => f.label),
  }));
}

/**
 * Make a list from a shipped template, optionally under another address and
 * title — a deployment running two check-in lists needs two slugs.
 *
 * A NEW LIST STARTS HIDDEN AND CLOSED TO NOBODY: `visibility` defaults to
 * hidden in the table, so nobody outside reaches it until an administrator
 * says so. Making a list is not publishing one.
 */
export async function createFromTemplate(
  templateSlug, { slug = null, title = null } = {}, { client = pool } = {},
) {
  const t = shippedTemplates().find((x) => x.slug === templateSlug);
  if (!t) throw new ListRefusal('no-template');
  const useSlug = slug ? String(slug).trim().toLowerCase() : t.slug;
  if (!SLUG_RE.test(useSlug)) throw new ListRefusal('slug');
  const useTitle = title ? String(title).trim() : t.title;
  if (!useTitle || useTitle.length > 120) throw new ListRefusal('title');
  const got = await applyListTemplate({ ...t, slug: useSlug, title: useTitle }, { client });
  if (!got.ok) throw new ListRefusal(got.reason);
  return listById(got.id, { client });
}

/**
 * The switches: words, visibility, intake, and whether counts may leave.
 *
 * Only what is named is changed. `closed: true` stamps `closed_at`, which is
 * the hard stop; the schedule is the two timestamps beside it.
 */
export async function updateSettings(id, patch = {}, { client = pool } = {}) {
  const list = await listById(id, { client });
  if (!list) throw new ListRefusal('no-list');

  const sets = [];
  const vals = [list.id];
  const put = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

  if (patch.title !== undefined) {
    const t = String(patch.title || '').trim();
    if (!t || t.length > 120) throw new ListRefusal('title');
    put('title', t);
  }
  if (patch.blurb !== undefined) {
    const b = String(patch.blurb || '').trim();
    if (b.length > 1000) throw new ListRefusal('blurb');
    put('blurb', b || null);
  }
  const visibility = patch.visibility !== undefined ? patch.visibility : list.visibility;
  if (patch.visibility !== undefined) {
    if (!VISIBILITIES.includes(patch.visibility)) throw new ListRefusal('visibility');
    put('visibility', patch.visibility);
  }
  // OPEN WITHOUT THE PASSWORD ONLY WHILE LISTED, which the table's CHECK
  // also says. Asking for both at once is refused in words; making a list
  // hidden or team-only closes the outside door with it, because the
  // alternative is refusing to hide something — the wrong way round.
  let outside = patch.outsideAccess !== undefined ? patch.outsideAccess : list.outside_access;
  if (patch.outsideAccess !== undefined && !OUTSIDE.includes(patch.outsideAccess)) {
    throw new ListRefusal('outside');
  }
  if (visibility !== 'listed' && outside !== 'closed') {
    if (patch.outsideAccess !== undefined && patch.outsideAccess !== 'closed') {
      throw new ListRefusal('outside-needs-listed');
    }
    outside = 'closed';
  }
  if (outside !== list.outside_access) put('outside_access', outside);
  if (patch.notify !== undefined) put('notify', patch.notify === true);
  if (patch.emailMode !== undefined) {
    if (!EMAIL_MODES_LIST.includes(patch.emailMode)) throw new ListRefusal('email-mode');
    put('email_mode', patch.emailMode);
  }
  if (patch.aggregatesPublished !== undefined) {
    put('aggregates_published', patch.aggregatesPublished === true);
  }
  if (patch.closed !== undefined) {
    put('closed_at', patch.closed ? new Date() : null);
  }
  for (const [k, col] of [['opensAt', 'opens_at'], ['closesAt', 'closes_at']]) {
    if (patch[k] === undefined) continue;
    if (patch[k] === null || patch[k] === '') { put(col, null); continue; }
    const d = new Date(patch[k]);
    if (Number.isNaN(d.getTime())) throw new ListRefusal('when');
    put(col, d);
  }
  if (!sets.length) return list;
  sets.push('updated_at = now()');
  await client.query(`UPDATE lists SET ${sets.join(', ')} WHERE id = $1`, vals);
  return listById(list.id, { client });
}

/**
 * Replace a list's questions with the set given, in the order given.
 *
 * WHOLE SET, ONE TRANSACTION. The rules are about the form as a whole — the
 * address requirement is derived from every question at once — so they are
 * checked against the whole set the administrator is about to have, never
 * one question at a time against a half-edited form.
 *
 * A key that exists keeps its row; a key that is new is a new question; a
 * key left out is a question removed. Its earlier answers stay where they
 * were filed, and nothing is erased by removing the question that asked.
 */
export async function replaceFields(id, submitted, { client = pool } = {}) {
  if (!Array.isArray(submitted) || !submitted.length) throw new ListRefusal('no-fields');
  const list = await listById(id, { client });
  if (!list) throw new ListRefusal('no-list');

  const byId = new Map(list.fields.map((f) => [Number(f.id), f]));
  const fields = submitted.map((f, i) => {
    const prior = f.id !== undefined && f.id !== null ? byId.get(Number(f.id)) : null;
    if (f.id !== undefined && f.id !== null && !prior) throw new ListRefusal('no-field');
    // THE KEY OF AN EXISTING QUESTION IS ITS OWN, whatever was sent.
    const key = prior ? prior.key : String(f.key || '').trim();
    const kind = prior ? prior.kind : String(f.kind || '').trim();
    const options = f.options === undefined ? (prior ? prior.options : null) : f.options;
    return {
      id: prior ? Number(prior.id) : null,
      key,
      kind,
      label: String(f.label ?? '').trim(),
      help: f.help ? String(f.help).trim() : null,
      required: f.required === true,
      position: i,
      options: options || null,
      max_values: Math.min(Math.max(Number(f.maxValues ?? f.max_values ?? prior?.max_values ?? 1) || 1, 1), 20),
      aggregatable: f.aggregatable === true,
      retention: f.retention || (prior ? prior.retention : defaultRetention(kind)),
    };
  });

  for (const f of fields) {
    if (String(f.label).length > 200) throw new ListRefusal('label', `The question "${f.label.slice(0, 40)}…" is longer than 200 characters.`);
    // A kind nobody knows would be saved — fields.js treats it as personal,
    // which is the safe reading — and then refuse every answer anybody gave
    // it. Refused here instead, where the person who typed it can see why.
    if (!FIELD_TYPE_IDS.includes(f.kind)) throw new ListRefusal('kind', `There is no question type called "${f.kind}".`);
    // A choice with nothing to choose from is a card nobody can answer.
    if (['choice_one', 'choice_many'].includes(f.kind)) {
      const opts = Array.isArray(f.options?.options) ? f.options.options : [];
      if (!opts.length) throw new ListRefusal('options', `"${f.label || f.key}" has no options to choose from. Add at least one.`);
    }
  }

  let checked;
  try {
    // hasRequiredEmail is the DERIVED requirement, so this clause holds by
    // construction; what it is here for is every OTHER refusal in it.
    checked = assertCollectable(fields, {
      hasRequiredEmail: collectionRequirements(fields).requiresEmail,
    });
  } catch (e) {
    throw new ListRefusal('field-rule', e.message);
  }

  const owned = client === pool;
  const conn = owned ? await pool.connect() : client;
  try {
    if (owned) await conn.query('BEGIN');
    const keep = checked.fields.filter((f) => f.id).map((f) => f.id);
    await conn.query(
      'DELETE FROM list_fields WHERE list_id = $1 AND NOT (id = ANY($2::bigint[]))',
      [list.id, keep],
    );
    for (const f of checked.fields) {
      const params = [f.label, f.help, f.required, f.position,
        f.options ? JSON.stringify(f.options) : null, f.max_values, f.aggregatable, f.retention];
      if (f.id) {
        await conn.query(
          `UPDATE list_fields
              SET label = $3, help = $4, required = $5, position = $6, options = $7,
                  max_values = $8, aggregatable = $9, retention = $10, updated_at = now()
            WHERE list_id = $1 AND id = $2`,
          [list.id, f.id, ...params],
        );
      } else {
        await conn.query(
          `INSERT INTO list_fields
             (list_id, key, kind, label, help, required, position, options,
              max_values, aggregatable, retention)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [list.id, f.key, f.kind, ...params],
        );
      }
    }
    await conn.query('UPDATE lists SET updated_at = now() WHERE id = $1', [list.id]);
    if (owned) await conn.query('COMMIT');
  } catch (e) {
    if (owned) await conn.query('ROLLBACK').catch(() => {});
    // The table's own CHECKs are the backstop; a duplicate key is the one
    // an administrator can reach by typing.
    if (e.code === '23505') throw new ListRefusal('key-taken');
    if (e.code === '23514') throw new ListRefusal('field-rule', 'The database refused that question set.');
    throw e;
  } finally {
    if (owned) conn.release();
  }
  return listById(list.id, { client });
}

/**
 * Remove a list — ONLY ONE NOBODY HAS USED.
 *
 * Deleting a list cascades to its entries, links and erasure tokens, which
 * would destroy the very links the format exists to keep and leave every
 * erasure email already sent pointing at nothing. A list that has taken
 * entries is closed instead. Refused here rather than in the route.
 */
export async function deleteUnused(id, { client = pool } = {}) {
  const list = await listById(id, { client });
  if (!list) throw new ListRefusal('no-list');
  const { rows } = await client.query(
    'SELECT count(*) AS n FROM list_entries WHERE list_id = $1', [list.id],
  );
  if (Number(rows[0].n) > 0) throw new ListRefusal('has-entries');
  await client.query('DELETE FROM lists WHERE id = $1', [list.id]);
  return { deleted: list.slug };
}

/** Every list with something waiting, for the moderators' page. */
export async function reviewQueues({ client = pool } = {}) {
  const { rows } = await client.query('SELECT id, slug, title FROM lists ORDER BY created_at, id');
  const out = [];
  for (const r of rows) {
    const p = await pendingCount(r.id, { client });
    out.push({ id: Number(r.id), slug: r.slug, title: r.title, ...p });
  }
  return out;
}
