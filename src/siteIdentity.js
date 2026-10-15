/**
 * What this deployment calls itself.
 *
 * Three answers in order: what an administrator set, what the installer put
 * in `SITE_NAME`, and failing both the software's own name. Same shape as
 * the attachment and publication settings, and for the same reason — an
 * operator can change it without a deploy, and a deployment that has never
 * been asked keeps working.
 *
 * NEVER HASHED. This is presentation. A report must not verify differently
 * because somebody renamed the site, and nothing in reportCore.js or
 * verify.js may ever read it.
 *
 * The SOFTWARE is still called ReportLog and the footer says so. A
 * deployment naming itself is not a deployment claiming to have written
 * this.
 */
import { pool } from './db.js';
import { plainName, accentMarksClose } from './look.js';
import { cleanTyped } from './lineEdit.js';

export const SOFTWARE_NAME = 'ReportLog';

// A name has to fit in a page header and a mail subject.
export const MAX_SITE_NAME = 60;

const SETTINGS_TTL_MS = Number(process.env.SITE_IDENTITY_TTL_MS ?? 30 * 1000);
let cache = { at: 0, row: null };

export async function identitySettings() {
  if (Date.now() - cache.at < SETTINGS_TTL_MS) return cache.row;
  try {
    const { rows } = await pool.query('SELECT site_name FROM site_settings WHERE id = true');
    cache = { at: Date.now(), row: rows[0] || null };
  } catch {
    // A database that cannot answer must not blank the site's name. Falling
    // through to the environment and then the default is what every page
    // did before this column existed.
    cache = { at: Date.now(), row: null };
  }
  return cache.row;
}

export function clearIdentityCache() {
  cache = { at: 0, row: null };
}

/** Pure, so the resolution order is testable without a database. */
export function resolveSiteName(settings, env = process.env) {
  const stored = typeof settings?.site_name === 'string' ? settings.site_name.trim() : '';
  if (stored) return stored;
  // Through cleanTyped: a name typed at the install prompt before it could
  // edit a line holds the arrow keys pressed while typing it. See lineEdit.js.
  const fromEnv = cleanTyped(env.SITE_NAME ?? '').trim();
  if (fromEnv) return fromEnv;
  return SOFTWARE_NAME;
}

export async function siteName() {
  return resolveSiteName(await identitySettings());
}

/**
 * The name with no accent marks in it.
 *
 * The stored name may mark runs as accents — Report"Log", Munich'Log' —
 * and the quotes are presentation, not part of what the site is called. A mail
 * subject, a browser tab and a document stamp all want this one; only the
 * rendered brand wants the parts. See parseBrand in src/look.js.
 */
export async function plainSiteName() {
  return plainName(await siteName());
}

export function validateSiteName(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: false, error: 'Enter a name, or clear it to use the default.' };
  // Measured on the NAME, not on the markup: two quote characters should
  // not cost an operator two characters of their own title.
  if (plainName(value).length > MAX_SITE_NAME) {
    return { ok: false, error: `Keep it under ${MAX_SITE_NAME} characters.` };
  }
  // A double quote that does not close is a typo, and saying so at the
  // point of typing beats letting it be found on the rendered page. A
  // SINGLE quote that does not close is an apostrophe — `Sam's Archive`
  // — and is left alone: parseBrand reads it as text, and refusing it would
  // refuse every possessive somebody might reasonably call their archive.
  if (!accentMarksClose(value)) {
    return { ok: false, error: 'Close the quotes, or leave them out. A pair of double quotes marks a part of the name in the accent colour.' };
  }
  return { ok: true, value };
}
