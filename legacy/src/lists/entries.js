/**
 * Filing one entry on a list.
 *
 * AN ENTRY IS NOT A REPORT. It has no spine — the address is the list's one
 * built-in field rather than a consent-bearing contact detail, there is no
 * identity tier and no `may_publish`. Nothing here seals, chains, or writes
 * to the transparency log, and `npm test` walks the import graph to keep
 * that true.
 *
 * NOTHING A SUBMITTER WRITES IS PUBLISHED. What leaves the building is
 * counts over the fields an operator ticked as countable, and only after a
 * moderator approves. There is no state an entry can reach that publishes
 * its text, and there must not be one.
 */
import { pool } from '../db.js';
import { prepareAnswers } from './policy.js';
import { collectionRequirements } from './fields.js';
import { personalExpiresAt } from './retention.js';
import { hashAddress } from './salt.js';
import { mintErasureToken } from './erasure.js';

/** A list's form and its switches, in one read. */
export async function listBySlug(slug, { client = pool } = {}) {
  const { rows } = await client.query('SELECT * FROM lists WHERE slug = $1', [slug]);
  if (!rows[0]) return null;
  const list = rows[0];
  const { rows: fields } = await client.query(
    'SELECT * FROM list_fields WHERE list_id = $1 ORDER BY position, id', [list.id],
  );
  return { ...list, fields };
}

/**
 * Whether a list is accepting, COMPUTED at request time rather than read
 * from a flag a timer flips. Same shape as a logbook's, deliberately, so
 * the two formats answer "is this open" the same way.
 */
export function isAccepting(list, now = new Date()) {
  if (!list) return false;
  if (list.closed_at) return false;
  if (list.opens_at && new Date(list.opens_at) > now) return false;
  if (list.closes_at && new Date(list.closes_at) <= now) return false;
  return true;
}

/**
 * File one.
 *
 * Returns `{ ok: true, id, links, erasureToken }`, or `{ ok: false, reason }`.
 * `erasureToken` is the plaintext secret for the email and is the only
 * moment it exists anywhere.
 */
export async function fileEntry(
  slug,
  { answers: submitted = {}, email = null, emailConsent = false, address = null },
  { client = pool, now = new Date(), env = process.env } = {},
) {
  const list = await listBySlug(slug, { client });
  if (!list) return { ok: false, reason: 'no-such-list' };

  // CHECKED HERE RATHER THAN TRUSTED FROM THE FORM. A form somebody had
  // open when intake closed must not be able to submit, and the endpoint
  // cannot be the only thing that knows.
  if (!isAccepting(list, now)) return { ok: false, reason: 'closed' };

  const prepared = prepareAnswers(list.fields, submitted);
  if (!prepared.ok) return prepared;

  const address_ = email ? String(email).trim() : null;

  // WHAT THE FORM-LEVEL REQUIREMENT IS, AND WHY IT IS NOT CHECKED HERE.
  // `collectionRequirements(list.fields).requiresEmail` says the form MAY
  // collect personal data, so it has to render an address field and explain
  // the erasure route. It does not say every submission carries personal
  // data: the Tip List OFFERS a description and does not require one, so
  // somebody sending a link and two dropdowns has handed over nothing
  // personal and must not be asked for an address — that would collect a
  // contact detail in order to protect itself.
  //
  // So the gate below reads WHAT ACTUALLY ARRIVED. A form with a REQUIRED
  // free-text question is covered by the same line, because prepareAnswers
  // refuses the submission for a missing answer before it ever gets here.
  const req = collectionRequirements(list.fields);

  // THE GATE, ENFORCED ON THE SUBMISSION AND NOT ONLY ON THE FORM.
  // fields.js refuses a FORM that collects personal data without requiring
  // an address; this refuses a SUBMISSION that arrived without one anyway.
  // Both are needed: the first stops an operator building the wrong form,
  // and this stops any other caller — a route that forgot, a script, an
  // import path added later — writing a row that holds somebody's words
  // with no way to reach them and no way for them to take them back. It is
  // also what makes editing the form in devtools pointless.
  if (prepared.erasable && !address_) {
    return { ok: false, reason: 'email-required-for-personal-data' };
  }
  // A FORM THAT ALWAYS WANTS ONE (email_mode 'required', migration 048) — a
  // way to reach the site, like volunteering. Added on top of the gate above,
  // never instead of it.
  if (list.email_mode === 'required' && !address_) {
    return { ok: false, reason: 'email-required' };
  }

  const expires = personalExpiresAt(now, env);
  const ipHash = await hashAddress(address, { client });

  const owned = client === pool;
  const conn = owned ? await pool.connect() : client;
  try {
    if (owned) await conn.query('BEGIN');

    const { rows } = await conn.query(
      `INSERT INTO list_entries
         (list_id, answers, erasable_answers, email, email_consent,
          ip_hash, personal_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [list.id, JSON.stringify(prepared.answers),
        prepared.erasable ? JSON.stringify(prepared.erasable) : null,
        address_, Boolean(emailConsent), ipHash, expires],
    );
    const entry = rows[0];

    for (const l of prepared.links) {
      await conn.query(
        `INSERT INTO list_entry_links (entry_id, field_key, url_raw, url_key, host)
         VALUES ($1, $2, $3, $4, $5)`,
        [entry.id, l.fieldKey, l.urlRaw, l.urlKey, l.host],
      );
      // The durable layer. One row per distinct link with a count, and the
      // count is why the sweep leaves it alone: it holds no text and no
      // submitter, so there is nobody in it.
      await conn.query(
        `INSERT INTO link_index (url_key, host, submission_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (url_key) DO UPDATE
           SET last_seen = now(),
               submission_count = link_index.submission_count + 1`,
        [l.urlKey, l.host],
      );
    }

    // Only where there is both something to erase and somewhere to send the
    // link. A token minted with no address to mail it to is a row that can
    // never be redeemed.
    let erasureToken = null;
    const holdsPersonal = Boolean(prepared.erasable) || Boolean(address_) || Boolean(ipHash);
    if (holdsPersonal && address_) {
      erasureToken = await mintErasureToken(
        { entryId: entry.id, personalExpiresAt: expires },
        { client: conn, now, env },
      );
    }

    if (owned) await conn.query('COMMIT');
    return {
      ok: true,
      id: Number(entry.id),
      listId: Number(list.id),
      createdAt: entry.created_at,
      links: prepared.links,
      // What was stored, for the new-entry email. The route that gets it is
      // the one that already holds the submission; nothing new leaves here.
      answers: prepared.answers,
      erasable: prepared.erasable,
      personalExpiresAt: expires,
      erasureToken,
    };
  } catch (e) {
    if (owned) await conn.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (owned) conn.release();
  }
}
