/**
 * List templates: a named bundle of questions, applied once.
 *
 * THE RULE THIS FOLLOWS IS src/templates.js's, and it is worth restating
 * because it is what keeps the engine generic: a template is NOT a mode the
 * software runs in. Applying one writes the ordinary rows an administrator
 * could have typed by hand, and then it is over. NOTHING READS "WHICH
 * TEMPLATE IS THIS" TO DECIDE ANYTHING — there is no column recording it
 * and no branch asking.
 *
 * Which is why the Tip List, check-ins and a contact form are the same
 * code. Link handling happens because a list HAS a url field, not because
 * it is "a tip list". The test of that: delete this file and the three
 * JSON files, and no list already created behaves differently.
 *
 * THE `email` DECLARATION IS CHECKED AND THEN DISCARDED. Whether a form
 * requires an address is DERIVED from its fields — it is not an operator's
 * choice, because the whole point of the gate is that it cannot be
 * forgotten. So a template states what it believes, this module refuses a
 * template whose belief is wrong, and nothing is stored. A template that
 * collected free text while declaring `"email": "none"` would be a
 * template someone wrote carelessly, and it fails to apply rather than
 * quietly collecting unerasable words.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';
import { assertCollectable, collectionRequirements, defaultRetention } from './fields.js';

export const LIST_FILE_VERSION = 1;
export const TEMPLATE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'lists',
);

export const EMAIL_MODES = Object.freeze(['none', 'optional', 'required']);

/** Every shipped list template, by slug. */
export function shippedTemplates() {
  if (!fs.existsSync(TEMPLATE_DIR)) return [];
  return fs.readdirSync(TEMPLATE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => parseListTemplate(fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8'), f));
}

export function parseListTemplate(raw, name = 'a template') {
  let def;
  try {
    def = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    throw new Error(`${name} is not JSON: ${e.message}`);
  }
  if (def.reportlog_list !== LIST_FILE_VERSION) {
    throw new Error(
      `${name} is not a list template — it needs "reportlog_list": ${LIST_FILE_VERSION}`,
    );
  }
  if (!def.slug || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(def.slug)) {
    throw new Error(`${name} has no usable slug`);
  }
  if (!def.title || !String(def.title).trim()) throw new Error(`${name} has no title`);
  if (!Array.isArray(def.fields) || !def.fields.length) {
    throw new Error(`${name} asks nothing, and a list that asks nothing collects nothing`);
  }
  if (def.email !== undefined && !EMAIL_MODES.includes(def.email)) {
    throw new Error(`${name} declares an unknown email mode: ${def.email}`);
  }

  const fields = def.fields.map((f, i) => ({
    ...f,
    position: f.position ?? i,
    retention: f.retention ?? defaultRetention(f.kind),
    max_values: f.max_values ?? f.maxValues ?? 1,
  }));

  // Refuses a form that cannot be collected honestly, and returns the
  // derived requirement.
  const derived = collectionRequirements(fields);
  const checked = assertCollectable(fields, { hasRequiredEmail: derived.requiresEmail });

  // THE DECLARATION IS CHECKED AGAINST WHAT THE FIELDS ACTUALLY MEAN.
  if (def.email !== undefined) {
    const declaredRequired = def.email === 'required';
    if (declaredRequired !== derived.requiresEmail) {
      throw new Error(
        `${name} declares "email": "${def.email}" but its fields `
        + `${derived.requiresEmail ? 'DO' : 'do NOT'} require an address`
        + (derived.requiresEmail
          ? ` — ${derived.personalKeys.join(', ')} ${derived.personalKeys.length > 1 ? 'are' : 'is'} personal`
          : ' — nothing it collects is personal'),
      );
    }
  }

  return {
    slug: def.slug,
    title: String(def.title).trim(),
    blurb: def.blurb ? String(def.blurb) : null,
    aggregates_published: def.aggregates_published === true,
    // "ask_email": "always" — a form people use to reach the site asks for an
    // address from everybody (migration 048). Anything else leaves the rule
    // to the questions.
    email_mode: def.ask_email === 'always' ? 'required' : 'auto',
    requiresEmail: derived.requiresEmail,
    fields: checked.fields,
  };
}

/**
 * Create a list from a template.
 *
 * Refuses to overwrite one that exists. A list's form is editable
 * afterwards — there is no one-way door here — so re-applying a template
 * over a live list would silently discard an operator's edits.
 */
export async function applyListTemplate(def, { client = pool } = {}) {
  const t = typeof def === 'string' ? parseListTemplate(def) : def;
  const parsed = t.fields ? t : parseListTemplate(t);

  const owned = client === pool;
  const conn = owned ? await pool.connect() : client;
  try {
    if (owned) await conn.query('BEGIN');

    const exists = await conn.query('SELECT id FROM lists WHERE slug = $1', [parsed.slug]);
    if (exists.rows[0]) {
      if (owned) await conn.query('ROLLBACK');
      return { ok: false, reason: 'slug-taken', slug: parsed.slug };
    }

    const { rows } = await conn.query(
      `INSERT INTO lists (slug, title, blurb, aggregates_published, email_mode)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [parsed.slug, parsed.title, parsed.blurb, parsed.aggregates_published, parsed.email_mode || 'auto'],
    );
    const list = rows[0];

    for (const f of parsed.fields) {
      await conn.query(
        `INSERT INTO list_fields
           (list_id, key, kind, label, help, required, position, options,
            max_values, aggregatable, retention)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [list.id, f.key, f.kind, f.label, f.help ?? null, Boolean(f.required),
          f.position ?? 0, f.options ? JSON.stringify(f.options) : null,
          f.max_values ?? 1, Boolean(f.aggregatable), f.retention],
      );
    }

    if (owned) await conn.query('COMMIT');
    return {
      ok: true, id: Number(list.id), slug: list.slug, requiresEmail: parsed.requiresEmail,
    };
  } catch (e) {
    if (owned) await conn.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (owned) conn.release();
  }
}
