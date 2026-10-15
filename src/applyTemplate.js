/**
 * Applying a template.
 *
 * ONE TRANSACTION, AND THROUGH THE SAME VALIDATION THE ADMIN ROUTES USE.
 * Both halves matter.
 *
 * One transaction, because a template half applied is worse than none: an
 * operator would be looking at a deployment that is partly one thing and
 * partly another, with nothing on screen saying which parts took.
 *
 * The same validation, because a template must not be able to write a value
 * an administrator could not. It is shipped data today and operator-supplied
 * data tomorrow, and the moment it can bypass a check it becomes a way to
 * put something into the database that the rest of the software believes
 * cannot be there. So every value goes through the validator that owns it —
 * validateSiteName, validateTheme, validateCopy, validateLogbookFile —
 * and a template carrying anything they refuse is refused WHOLE, before a
 * single row is written.
 *
 * What it never touches: the imprint, the privacy policy, and anything
 * hashed. See src/templates.js.
 */
import { pool } from './db.js';
import { validateTemplate, templateById } from './templates.js';
import { validateSiteName, clearIdentityCache } from './siteIdentity.js';
import { validateLook, clearLookCache } from './look.js';
import { validateCopy, clearCopyCache } from './siteCopy.js';
import { clearPublicationSettingsCache } from './publication.js';
import { clearAttachmentSettingsCache } from './attachments.js';
import { clearIntakeSettingsCache } from './intakeGate.js';
import { validateLogbookFile, createFromFile } from './logbookFile.js';
import { templateLogbook } from './templates.js';

/**
 * Check everything first, write nothing yet.
 *
 * Separated deliberately: the checking half is pure enough to test on its
 * own, and it means a refusal names what is wrong rather than leaving a
 * half-configured deployment behind.
 */
export function planTemplate(template) {
  const base = validateTemplate(template);
  if (!base.ok) return base;

  const s = template.settings || {};
  const problems = [];

  if (s.siteName !== undefined) {
    // The empty string is a real answer meaning "back to the shipped
    // default", the same answer POST /api/admin/identity understands.
    // validateSiteName refuses it — it is written for a person typing into a
    // box, where a blank box is a mistake — so it is not asked here.
    if (String(s.siteName).trim() !== '') {
      const c = validateSiteName(s.siteName);
      if (!c.ok) problems.push(`site name: ${c.error}`);
    }
  }
  // Two axes. `layout` is deliberately not among them: it is still a legal
  // template key so an old template does not become invalid, and writing
  // it would write a dead column.
  for (const axis of ['palette', 'theme']) {
    if (s[axis] === undefined) continue;
    const c = validateLook({ [axis]: s[axis] });
    if (!c.ok) problems.push(`${axis}: ${c.error}`);
  }
  for (const [key, body] of Object.entries(s.copy || {})) {
    const c = validateCopy(key, body);
    if (!c.ok) problems.push(`${key}: ${c.error}`);
  }
  if (s.logbook !== undefined) {
    const file = templateLogbook(s.logbook);
    if (!file) problems.push(`logbook: no template logbook called "${s.logbook}"`);
    else for (const e of validateLogbookFile(file)) problems.push(`logbook: ${e}`);
  }
  for (const key of ['publicArchive', 'distribution', 'attachments', 'intake', 'clearCopy']) {
    if (s[key] !== undefined && typeof s[key] !== 'boolean') {
      problems.push(`${key} has to be true or false`);
    }
  }

  if (problems.length) return { ok: false, error: problems.join('; ') };
  return { ok: true };
}

export async function applyTemplate(id, client = null) {
  const template = templateById(id);
  if (!template) return { ok: false, error: 'No such template.' };

  const plan = planTemplate(template);
  if (!plan.ok) return plan;

  const s = template.settings || {};
  const own = !client;
  const db = client || await pool.connect();
  let logbook = null;
  try {
    if (own) await db.query('BEGIN');

    // Every one of these is a column the admin panel already writes. A key
    // a template omits is LEFT ALONE rather than reset, so a narrow
    // template stays narrow.
    if (s.siteName !== undefined) {
      const blank = String(s.siteName).trim() === '';
      const value = blank ? null : validateSiteName(s.siteName).value;
      await db.query('UPDATE site_settings SET site_name = $1 WHERE id = true', [value]);
    }
    for (const axis of ['palette', 'theme']) {
      if (s[axis] === undefined) continue;
      // The column names are the axis names and both are a fixed list above,
      // so this cannot interpolate anything a template supplied.
      await db.query(`UPDATE site_settings SET ${axis} = $1 WHERE id = true`, [s[axis]]);
    }
    if (s.publicArchive !== undefined) {
      await db.query('UPDATE site_settings SET public_archive_enabled = $1 WHERE id = true',
        [s.publicArchive]);
    }
    if (s.distribution !== undefined) {
      await db.query('UPDATE site_settings SET distribution_enabled = $1 WHERE id = true',
        [s.distribution]);
    }
    if (s.attachments !== undefined) {
      await db.query('UPDATE site_settings SET attachments_enabled = $1 WHERE id = true',
        [s.attachments]);
    }
    if (s.intake !== undefined) {
      await db.query('UPDATE site_settings SET intake_enabled = $1 WHERE id = true', [s.intake]);
    }

    // CLEAR FIRST, then write. A template that both cleared and set copy
    // would otherwise clear what it had just written, and the order that
    // makes sense to a reader is the order that has to be true.
    if (s.clearCopy) {
      // No row means "use what ships" — see src/siteCopy.js. This is the
      // same state a deployment is in before anybody has written anything,
      // so nothing is lost that was not the operator's own words.
      await db.query('DELETE FROM site_copy');
    }

    for (const [key, body] of Object.entries(s.copy || {})) {
      const c = validateCopy(key, body);
      if (c.value === null) {
        await db.query('DELETE FROM site_copy WHERE key = $1', [key]);
      } else {
        await db.query(
          `INSERT INTO site_copy (key, body, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`,
          [key, c.value],
        );
      }
    }

    // THE TEMPLATE'S LOGBOOK, AS A DRAFT. Nothing is launched: the operator
    // reads the questions, changes whatever they like, and launches it
    // themselves — launching is the one step that cannot be undone, so it is
    // never done on their behalf. Applying the template twice makes a second
    // draft rather than touching the first, which may already be launched.
    if (s.logbook !== undefined) {
      const made = await createFromFile(templateLogbook(s.logbook), { client: db });
      if (!made.ok) throw new Error(`template logbook: ${made.errors.join('; ')}`);
      logbook = made.logbook;
    }

    await db.query(
      `UPDATE site_settings
          SET template_applied = $1, template_applied_at = now(), updated_at = now()
        WHERE id = true`,
      [id],
    );

    if (own) await db.query('COMMIT');
  } catch (e) {
    if (own) await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (own) db.release();
  }

  // Every reader caches for a few seconds, and an operator who just applied
  // a template should see it rather than wait them out.
  clearIdentityCache();
  clearLookCache();
  clearCopyCache();
  clearPublicationSettingsCache();
  clearAttachmentSettingsCache();
  clearIntakeSettingsCache();

  return {
    ok: true,
    applied: id,
    ...(logbook ? { logbook: { id: logbook.id, slug: logbook.slug, title: logbook.title } } : {}),
  };
}
