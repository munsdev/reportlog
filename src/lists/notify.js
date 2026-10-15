/**
 * Who a list emails its new entries to, and how an address agrees to it.
 *
 * THE DEFAULT IS THE DEPLOYMENT'S ADMIN ADDRESS, read at send time, so a
 * list that never named its own follows the setting. ANY OTHER ADDRESS
 * CONFIRMS FIRST: it is held as pending, it is sent a
 * link, and until it clicks, mail keeps going where it went before. A typo
 * would otherwise send volunteers' applications to a stranger.
 *
 * The link is stored hashed, like an erasure token. Nothing here sends mail:
 * the route does, so this file stays reachable by `npm test`'s rules without
 * a mail transport.
 */
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { sha256Hex } from '../crypto.js';

export const CONFIRM_DAYS = 7;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Where this list's entries go right now, or null for nowhere. */
export function recipientFor(list, env = process.env) {
  if (!list || !list.notify) return null;
  return list.notify_email || String(env.ADMIN_EMAIL || '').trim() || null;
}

/**
 * Name an address. The admin address (or nothing) applies at once; any
 * other is held until it confirms. Returns { pending, token } — `token` is
 * the plaintext for the email, and the only moment it exists.
 */
export async function nameRecipient(listId, email, { client = pool, env = process.env, now = new Date() } = {}) {
  const want = String(email || '').trim().toLowerCase();
  const admin = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!want || want === admin) {
    await client.query(
      'UPDATE lists SET notify_email = NULL, notify_pending_email = NULL, updated_at = now() WHERE id = $1',
      [listId],
    );
    return { pending: false, token: null };
  }
  if (!EMAIL_RE.test(want)) return { pending: false, token: null, error: 'not-an-email' };
  const { rows } = await client.query('SELECT notify_email FROM lists WHERE id = $1', [listId]);
  if (rows[0] && rows[0].notify_email === want) {
    // Already confirmed. Clear anything pending and change nothing else.
    await client.query('UPDATE lists SET notify_pending_email = NULL WHERE id = $1', [listId]);
    return { pending: false, token: null };
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await client.query('UPDATE lists SET notify_pending_email = $2, updated_at = now() WHERE id = $1', [listId, want]);
  await client.query(
    `INSERT INTO list_notify_confirmations (token_hash, list_id, email, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [sha256Hex(token), listId, want, new Date(now.getTime() + CONFIRM_DAYS * 864e5)],
  );
  return { pending: true, token };
}

/**
 * The address clicked. Only the address the link was sent to, only while
 * it is still the one pending — naming a different one afterwards makes the
 * earlier link worthless.
 */
export async function confirmRecipient(token, { client = pool } = {}) {
  if (!token) return { ok: false };
  const hash = sha256Hex(String(token));
  const { rows } = await client.query(
    `SELECT c.list_id, c.email, c.used_at, c.expires_at, l.notify_pending_email, l.title
       FROM list_notify_confirmations c JOIN lists l ON l.id = c.list_id
      WHERE c.token_hash = $1`,
    [hash],
  );
  const r = rows[0];
  if (!r || r.used_at || new Date(r.expires_at) < new Date() || r.notify_pending_email !== r.email) {
    return { ok: false };
  }
  await client.query(
    'UPDATE lists SET notify_email = $2, notify_pending_email = NULL, updated_at = now() WHERE id = $1',
    [r.list_id, r.email],
  );
  await client.query('UPDATE list_notify_confirmations SET used_at = now() WHERE token_hash = $1', [hash]);
  return { ok: true, title: r.title, email: r.email };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const said = (v) => (Array.isArray(v) ? v.join(', ') : v === true ? 'Yes' : v === false ? 'No' : String(v));

/** The email for one entry: every answer, labelled as the form asked it. */
export function entryMail(list, { answers = {}, erasable = null, email = null, emailConsent = false }) {
  const all = { ...answers, ...(erasable || {}) };
  const rows = list.fields
    .filter((f) => all[f.key] !== undefined)
    .map((f) => `<p><b>${esc(f.label)}</b><br>${esc(said(all[f.key])).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return {
    subject: `New on ${list.title}`,
    html: `${rows || '<p>(No answers.)</p>'}
      ${email ? `<p><b>Their email address</b><br>${esc(email)}${emailConsent ? ' — and they said you may write back' : ' — they did not ask for a reply'}</p>` : ''}
      <p style="color:#666;font-size:13px">This copy is in your inbox now, and the site's deletion timer cannot reach it. If the person asks for what they sent to be deleted, delete this email too.</p>`,
  };
}
