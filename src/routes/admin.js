import express from 'express';
import { pool } from '../db.js';
import { schemaState } from '../schemaState.js';
import { sha256Hex } from '../crypto.js';
import fs from 'node:fs';
import { requireRole } from '../authMiddleware.js';
import { getSiteSettings } from '../siteAccess.js';
import { getDevMode, setDevMode, DEV_MODE_HOURS } from '../devMode.js';
import {
  reviewKeywords, setReviewKeywords, DEFAULT_REVIEW_KEYWORDS,
} from '../reviewKeywords.js';
import {
  attachmentsEnabled, attachmentSettings, enabledKinds, ALL_KINDS,
  clearAttachmentSettingsCache, LIMIT_RANGES, limitLayers, setSiteLimits, validateLimits,
} from '../attachments.js';
import {
  publicationSettings, publicArchiveEnabled, distributionEnabled,
  clearPublicationSettingsCache,
} from '../publication.js';
import { intakeSettings, intakeOpen, clearIntakeSettingsCache } from '../intakeGate.js';
import {
  PALETTES, THEMES, LAYOUTS, currentLook, validateLook, clearLookCache,
} from '../look.js';
import { copyRows, editorCopy, validateCopy, clearCopyCache } from '../siteCopy.js';
import { catalogue as figureCatalogue, figureValues, checkText } from '../figures.js';
import { templateSummaries, TEMPLATE_IDS } from '../templates.js';
import { applyTemplate } from '../applyTemplate.js';
import {
  identitySettings, resolveSiteName, validateSiteName, clearIdentityCache,
  SOFTWARE_NAME, MAX_SITE_NAME,
} from '../siteIdentity.js';
import { validateCurtainPassword, MIN_CURTAIN_PASSWORD } from '../setup.js';
import {
  legalSettings, editorStartingText, validateLegalText, clearLegalTextCache,
  LEGAL_KINDS, MAX_LEGAL_TEXT,
} from '../legalText.js';
import { isConfigured as storageIsConfigured } from '../storage.js';
import { asyncRoute } from '../asyncRoute.js';
import { checkForUpdate, forgetCache, BRANCH } from '../updateCheck.js';
import {
  readStatus, writeRequest, clearRequest, updateInProgress,
} from '../updateRequest.js';
import { workerState, canApply } from '../updateWorker.js';
import {
  allHeatMaps, mapCandidates, createHeatMap, updateHeatMap, deleteHeatMap,
  setFieldMapFlags, HeatMapRefusal, MAP_PLANES, MAP_VIEWS, MIN_AREA_FLOOR,
  listMapCandidates, setListMapFlag,
} from '../heatMaps.js';
import { MAP_SLOTS } from '../mapSlots.js';
import {
  settings as logSettings, saveSettings as saveLogSettings, makeDeployKey,
  testRemote, LogRefusal,
} from '../transparencyLog.js';
import { backupSettings, backupHealth, ours, DEFAULT_KEEP, restoreCommand } from '../backup.js';
import os from 'node:os';
import nodePath from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  homeButtons, availableButtons, storedOrder, setHomeButtons, clearHomeButtons,
  HomeButtonRefusal,
} from '../homeButtons.js';

const router = express.Router();
router.use(requireRole('admin'));

/*
 * THE MODERATOR ROUTES THAT WERE HERE ARE GONE — 14 September.
 *
 * `GET`, `POST` and `DELETE /moderators` wrote `users.role` with raw SQL,
 * around `setSystemRole`, so they went through neither the role ceiling nor
 * the audit trail. No escalation: the router is admin-only and the delete
 * was fenced to `role = 'moderator'`. But `src/roles.js` opens by saying the
 * audit row and the change must be impossible to separate, and these were
 * the counter-example.
 *
 * They were also already dead. The panel that called them was removed in
 * `c28ce93`, which pointed the work at `/api/orgs/system-role` — the same
 * job done through the ceiling, with the trail written in the same
 * transaction, and open to an Access Manager, whose whole remit this is.
 * Nothing in `public/index.html` has referenced these since.
 *
 * Appointing a moderator: `POST /api/orgs/system-role`.
 * Who holds what:        `GET /api/orgs/roster`.
 */

// Site-wide password gate (src/siteAccess.js) — separate from user auth
// entirely, a soft "not on the open internet yet" switch. The password
// itself is never readable back, only whether one's set.
router.get('/site-access', asyncRoute(async (req, res) => {
  const settings = await getSiteSettings();
  res.json({
    enabled: settings.access_enabled,
    hasPassword: Boolean(settings.access_password_hash),
    // Same number, same source, same reason as the wizard's: the rule is
    // stated at the field before anybody types, and it is read from the
    // server so the screen cannot disagree with what the server enforces.
    minPassword: MIN_CURTAIN_PASSWORD,
  });
}));

/**
 * The other door onto the same secret.
 *
 * This route used to accept any non-empty string, while the wizard refused
 * anything under eight characters — so the two paths that set the one
 * password disagreed about what a password is, and this was the weaker.
 * Both now go through validateCurtainPassword, and both require the
 * password twice. A mistyped site password locks everybody out of a site
 * nobody can now reach to fix it.
 */
router.post('/site-access', asyncRoute(async (req, res) => {
  const { password, passwordConfirm, enabled } = req.body || {};
  const sets = [];
  const params = [];
  if (typeof enabled === 'boolean') {
    params.push(enabled);
    sets.push(`access_enabled = $${params.length}`);
  }
  // An absent or empty password is "leave it as it is", which is what the
  // field says and is not an error. Anything else is a real attempt to set
  // one and is held to the rule.
  if (typeof password === 'string' && password.length) {
    const check = validateCurtainPassword(password);
    if (!check.ok) return res.status(400).json({ error: check.error });
    if (String(passwordConfirm ?? '') !== check.password) {
      return res.status(400).json({ error: 'The two passwords do not match' });
    }
    params.push(sha256Hex(check.password));
    sets.push(`access_password_hash = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  sets.push('updated_at = now()');
  await pool.query(`UPDATE site_settings SET ${sets.join(', ')} WHERE id = true`, params);
  res.json({ ok: true });
}));

/**
 * What may be attached, and whether anything may be.
 *
 * These used to be environment variables, which meant changing either was
 * a file edit and a service restart — a deploy, not a setting, and not
 * something to be doing on election day with one hand.
 *
 * `storageConfigured` is reported separately and is not settable here. It
 * is a property of the server's configuration, and a switch that appears
 * to turn attachments on while there is nowhere to put them would be a
 * switch that lies.
 */
router.get('/attachments', asyncRoute(async (req, res) => {
  const settings = await attachmentSettings();
  res.json({
    enabled: attachmentsEnabled(settings),
    kinds: enabledKinds(settings),
    allKinds: ALL_KINDS,
    storageConfigured: storageIsConfigured(),
  });
}));

router.post('/attachments', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const sets = [];
  const params = [];
  if (typeof body.enabled === 'boolean') {
    params.push(body.enabled);
    sets.push(`attachments_enabled = $${params.length}`);
  }
  if (Array.isArray(body.kinds)) {
    const kinds = body.kinds.filter((k) => ALL_KINDS.includes(k));
    if (kinds.length !== body.kinds.length) {
      return res.status(400).json({ error: 'Unknown kind of attachment.' });
    }
    // Stored as given, empty array included: "none of them" is a real
    // answer and has to survive a round trip as itself rather than
    // collapsing into NULL, which means "all of them".
    params.push(kinds);
    sets.push(`attachment_kinds = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  sets.push('updated_at = now()');
  await pool.query(`UPDATE site_settings SET ${sets.join(', ')} WHERE id = true`, params);
  // The reader caches for a few seconds; an admin who just pressed the
  // button should not have to wait them out to see what they did.
  clearAttachmentSettingsCache();
  res.json({ ok: true });
}));

/**
 * What this deployment calls itself.
 *
 * Reported with what it RESOLVED to rather than the raw column, because an
 * administrator needs to know what the site is currently called, not which
 * of three places the answer came from. `isDefault` says whether anybody
 * has chosen, which is otherwise invisible.
 */
router.get('/identity', asyncRoute(async (req, res) => {
  const settings = await identitySettings();
  const name = resolveSiteName(settings);
  res.json({
    siteName: name,
    isDefault: name === SOFTWARE_NAME,
    stored: settings?.site_name || null,
    software: SOFTWARE_NAME,
    maxLength: MAX_SITE_NAME,
  });
}));

/* ---- the review-flag keyword list -----------------------------------
 *
 * Words and phrases that raise a flag for a second pair of eyes. The
 * shipped set has never met a real report, so an operator who cannot cut a
 * term that fires on half their submissions will turn the whole flag off
 * instead — which is why this is editable at all.
 */

/**
 * THE SITE'S UPLOAD LIMITS, where six environment variables used to be.
 *
 * An environment variable is not an operator control: it needs shell access
 * to a production box, it is invisible from the interface meant to describe
 * the deployment, nothing records who changed it or when, and on this
 * project there is no SSH from a session — so the person who runs the
 * archive could not change them and the person who could was not the
 * operator. migration 038 says the same at greater length.
 *
 * Each number is reported with the layer it came from, because an operator
 * shown only the effective value cannot tell a limit they set from one they
 * inherited — and the first thing they do then is set all of them to the
 * numbers already showing, which freezes the deployment against every later
 * change to the shipped floor.
 */
router.get('/upload-limits', asyncRoute(async (req, res) => {
  res.json({
    limits: await limitLayers(null),
    ranges: LIMIT_RANGES,
    storageConfigured: storageIsConfigured(),
  });
}));

router.post('/upload-limits', asyncRoute(async (req, res) => {
  const check = validateLimits(req.body || {});
  if (!check.ok) {
    const msg = {
      'limit-not-a-number': 'A limit has to be a whole number.',
      'limit-out-of-range': check.key
        ? `${check.key} has to be between ${check.min} and ${check.max}.`
        : 'That limit is outside what this software can enforce.',
      'total-under-one-file': 'The total for a whole report is smaller than the '
        + 'ceiling for one file of that kind, so the form would accept a file and '
        + 'then refuse the report carrying it. Raise the total or lower the '
        + 'per-file limit.',
      'kinds-shape': 'Send the kinds as a list.',
      'kinds-unknown': 'That is not a kind of file this software handles.',
    }[check.reason] || 'Refused';
    return res.status(400).json({ error: msg });
  }
  await setSiteLimits(check.values);
  res.json({ ok: true, limits: await limitLayers(null) });
}));

router.get('/review-keywords', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT review_keywords, review_keywords_set_by, review_keywords_set_at
       FROM site_settings WHERE id = true`,
  );
  const row = rows[0] || {};
  const chosen = row.review_keywords;
  res.json({
    // THREE STATES, AND THE INTERFACE HAS TO SHOW WHICH ONE IT IS IN.
    // Not chosen, chosen, and chosen-as-empty are different things: the last
    // is an operator deliberately running no keyword matching, and showing
    // it as "using the defaults" would be a lie that loses their decision
    // the next time somebody presses save.
    usingDefault: chosen === null || chosen === undefined,
    terms: await reviewKeywords(),
    defaultCount: DEFAULT_REVIEW_KEYWORDS.length,
    setBy: row.review_keywords_set_by || null,
    setAt: row.review_keywords_set_at || null,
  });
}));

router.post('/review-keywords', asyncRoute(async (req, res) => {
  const b = req.body || {};

  // "Back to the shipped set" is its own action rather than sending the
  // shipped set back: an operator who had cut forty terms and presses Reset
  // should get whatever this release ships, not whatever the page happened
  // to be showing them.
  if (b.reset === true) {
    const out = await setReviewKeywords(null, { byEmail: req.user.email });
    return res.json({ ok: true, usingDefault: true, terms: out.terms });
  }

  // A textarea, one term per line, because that is what a list of four
  // hundred phrases is to edit. Commas would make 'turned away, sent home'
  // ambiguous for no gain.
  const raw = b.terms;
  const list = Array.isArray(raw) ? raw
    : (typeof raw === 'string' ? raw.split(/\r?\n/) : null);
  if (list === null) return res.status(400).json({ error: 'Send the terms, one per line.' });

  const out = await setReviewKeywords(list, { byEmail: req.user.email });
  if (!out.ok) {
    return res.status(400).json({
      error: out.reason === 'too-many'
        ? 'That is more than 2000 terms. A list that long stops being triage and starts slowing every submission down.'
        : 'Refused',
    });
  }
  res.json({ ok: true, usingDefault: false, terms: out.terms });
}));

router.post('/identity', asyncRoute(async (req, res) => {
  const raw = (req.body || {}).siteName;

  // An empty string is a real answer: it means "go back to the default".
  // Distinguished from an absent key, which is nothing to do.
  if (raw === undefined) return res.status(400).json({ error: 'Nothing to update' });
  if (String(raw).trim() === '') {
    await pool.query('UPDATE site_settings SET site_name = NULL, updated_at = now() WHERE id = true');
    clearIdentityCache();
    return res.json({ ok: true, siteName: resolveSiteName(null) });
  }

  const check = validateSiteName(raw);
  if (!check.ok) return res.status(400).json({ error: check.error });
  await pool.query(
    'UPDATE site_settings SET site_name = $1, updated_at = now() WHERE id = true',
    [check.value],
  );
  clearIdentityCache();
  res.json({ ok: true, siteName: check.value });
}));

/**
 * Whether this deployment publishes an archive, and whether it distributes.
 *
 * Both are delivery-layer settings and neither is in the hashed object —
 * see migration 009. They gate what leaves the building; they change
 * nothing about what was recorded, and turning either off hides nothing
 * from a moderator and deletes nothing.
 *
 * `publicArchive` is reported with what NULL resolved to rather than as the
 * raw column, because an admin needs to know what is happening now, not
 * which of two ways it came to be happening. `hasOpinion` says whether
 * anybody has ever pressed this, which is the part that would otherwise be
 * invisible.
 */
router.get('/publication', asyncRoute(async (req, res) => {
  const settings = await publicationSettings();
  res.json({
    publicArchive: publicArchiveEnabled(settings),
    publicArchiveSet: settings?.public_archive_enabled !== null
      && settings?.public_archive_enabled !== undefined,
    distribution: distributionEnabled(settings),
    distributionSet: settings?.distribution_enabled !== null
      && settings?.distribution_enabled !== undefined,
    // Said plainly rather than left for somebody to discover: this switch
    // currently governs nothing, because there is no distribution. It is
    // here so that when there is, no deployment is already doing it.
    distributionImplemented: false,
  });
}));

router.post('/publication', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const sets = [];
  const params = [];
  if (typeof body.publicArchive === 'boolean') {
    params.push(body.publicArchive);
    sets.push(`public_archive_enabled = $${params.length}`);
  }
  if (typeof body.distribution === 'boolean') {
    params.push(body.distribution);
    sets.push(`distribution_enabled = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  sets.push('updated_at = now()');
  await pool.query(`UPDATE site_settings SET ${sets.join(', ')} WHERE id = true`, params);
  clearPublicationSettingsCache();
  res.json({ ok: true });
}));

/**
 * Deployment templates.
 *
 * A template is a bundle of settings applied once — see src/templates.js.
 * Nothing reads which one was applied to decide anything; it is reported
 * here so an operator can answer "where did these defaults come from" six
 * months later.
 *
 * `sets` is a plain list of what pressing this will change, because a
 * bundle that applies invisibly is a bundle nobody can agree to.
 */
router.get('/templates', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT template_applied, template_applied_at FROM site_settings WHERE id = true',
  );
  res.json({
    templates: templateSummaries(),
    applied: rows[0]?.template_applied || null,
    appliedAt: rows[0]?.template_applied_at || null,
  });
}));

router.post('/templates', asyncRoute(async (req, res) => {
  const id = (req.body || {}).template;
  if (!TEMPLATE_IDS.includes(id)) return res.status(400).json({ error: 'No such template.' });
  const out = await applyTemplate(id);
  if (!out.ok) return res.status(400).json({ error: out.error });
  res.json(out);
}));

/**
 * The words on this deployment's own pages.
 *
 * Each slot reports whether what is in the box is the operator's or still
 * the shipped wording, so nobody can believe they wrote a paragraph they
 * have not touched.
 */
/**
 * The numbers an operator can put in their own wording, for the editor's
 * "Insert a number" menu: id, label, group and today's value. src/figures.js
 * says which numbers are offered and why only those.
 */
router.get('/figures', asyncRoute(async (req, res) => {
  res.json({ figures: await figureCatalogue() });
}));

router.get('/copy', asyncRoute(async (req, res) => {
  res.json({ slots: editorCopy(await copyRows()) });
}));

router.post('/copy', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const check = validateCopy(body.key, body.body);
  if (!check.ok) return res.status(400).json({ error: check.error });
  // A NUMBER THAT WILL NOT WORK IS REFUSED HERE, in words, rather than
  // rendering as "?" on the front page where the operator may not look.
  if (check.value) {
    const problems = checkText(check.value, await figureValues());
    if (problems.length) return res.status(400).json({ error: problems.join(' · ') });
  }

  // Cleared means "go back to what ships", and that is stored as the
  // absence of a row rather than as an empty string — so a slot an operator
  // reset reads identically to one they never touched.
  if (check.value === null) {
    await pool.query('DELETE FROM site_copy WHERE key = $1', [body.key]);
  } else {
    await pool.query(
      `INSERT INTO site_copy (key, body, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`,
      [body.key, check.value],
    );
  }
  clearCopyCache();
  res.json({ ok: true, written: check.value !== null });
}));

/**
 * How this deployment looks: palette and theme.
 *
 * `layouts` is still in the response, as an empty list. The admin page
 * and the wizard both read it, and an older page left open in a tab
 * should find an empty list of widths rather than nothing at all.
 *
 * Three orthogonal axes — see src/look.js for which owns what and why a
 * theme may not name a colour.
 */
router.get('/look', asyncRoute(async (req, res) => {
  res.json({ look: await currentLook(), palettes: PALETTES, themes: THEMES, layouts: LAYOUTS });
}));

router.post('/look', asyncRoute(async (req, res) => {
  const check = validateLook(req.body || {});
  if (!check.ok) return res.status(400).json({ error: check.error });
  // One axis or all three. A request naming only a palette leaves the theme
  // and the width alone, which is what the editor sends as you turn each
  // dial and is why a preview does not have to send the whole state back.
  const sets = [];
  const params = [];
  for (const key of ['palette', 'theme']) {
    if (check.value[key] === undefined) continue;
    params.push(check.value[key]);
    sets.push(`${key} = $${params.length}`);
  }
  sets.push('updated_at = now()');
  await pool.query(`UPDATE site_settings SET ${sets.join(', ')} WHERE id = true`, params);
  clearLookCache();
  res.json({ ok: true, look: await currentLook() });
}));

/**
 * Whether this deployment is accepting new reports.
 *
 * The other end of the site from the publishing switches, and independent
 * of them on purpose — see src/intakeGate.js. Reported with what NULL
 * resolved to rather than the raw column, because an admin needs to know
 * whether the form is open right now, not which of two ways it came to be
 * open. `hasOpinion` says whether anybody has ever pressed this.
 */
router.get('/intake', asyncRoute(async (req, res) => {
  const settings = await intakeSettings();
  res.json({
    open: intakeOpen(settings),
    isSet: settings?.intake_enabled !== null && settings?.intake_enabled !== undefined,
  });
}));

router.post('/intake', asyncRoute(async (req, res) => {
  const open = (req.body || {}).open;
  if (typeof open !== 'boolean') return res.status(400).json({ error: 'Nothing to update' });
  await pool.query(
    'UPDATE site_settings SET intake_enabled = $1, updated_at = now() WHERE id = true',
    [open],
  );
  clearIntakeSettingsCache();
  res.json({ ok: true, open });
}));

/* The volunteer catalogue's editor stood here. Volunteering is a list now
   (migration 047), and its roles are that list's options, edited on the
   Lists tab like any other question's. */

/**
 * The operator's imprint and privacy policy.
 *
 * Free text, stored as written. There is no validation of what is in it,
 * no completeness check and no warning that something is missing, because
 * there is nothing this software could check it against: what a legal
 * notice must contain is decided by the jurisdiction the deployment runs
 * from, and a field list here would be us asserting we know which fields
 * those are.
 *
 * The editor opens on a labelled outline when nothing has been written,
 * and `published` says which of the two the text is. That flag is the
 * point of serving the skeleton from here rather than defaulting the
 * column to it: an operator who opens the editor, reads the outline and
 * closes the tab has published nothing, and the pane goes on saying this
 * deployment has not published a notice.
 */
router.get('/legal', asyncRoute(async (req, res) => {
  const settings = await legalSettings();
  res.json({
    ...Object.fromEntries(LEGAL_KINDS.map((k) => [k, editorStartingText(settings, k)])),
    maxLength: MAX_LEGAL_TEXT,
  });
}));

router.post('/legal', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const kind = body.kind;
  if (!LEGAL_KINDS.includes(kind)) {
    return res.status(400).json({ error: 'Say which of the two this is.' });
  }
  // An absent key is nothing to do; an empty one is "take mine down",
  // which is a real thing to want and stores NULL rather than a blank page.
  if (body.text === undefined) return res.status(400).json({ error: 'Nothing to update' });

  const check = validateLegalText(body.text);
  if (!check.ok) return res.status(400).json({ error: check.error });

  const column = kind === 'impressum' ? 'impressum_text' : 'privacy_text';
  await pool.query(
    `UPDATE site_settings SET ${column} = $1, updated_at = now() WHERE id = true`,
    [check.value],
  );
  clearLegalTextCache();
  res.json({ ok: true, published: check.value !== null });
}));

// The "under active development" notice. A deploy arms this by itself
// (src/devMode.js), so these are the manual overrides: turn it on for a
// window, or clear it early once things have settled.
router.get('/dev-mode', asyncRoute(async (req, res) => {
  const dev = await getDevMode();
  res.json({ ...dev, defaultHours: DEV_MODE_HOURS });
}));

router.post('/dev-mode', asyncRoute(async (req, res) => {
  const body = req.body || {};
  if (body.off === true) return res.json(await setDevMode(null));
  const hours = Number(body.hours ?? DEV_MODE_HOURS);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
    return res.status(400).json({ error: 'hours must be between 0 and 168' });
  }
  res.json(await setDevMode(hours));
}));

/*
 * UPDATES.
 *
 * The admin presses a button; this writes a file naming the commit the
 * application just saw on the remote. It does not pull, merge, install or
 * restart — `contrib/update-apply.sh` does all of that as root, from a
 * timer, after re-checking the request against a remote URL baked into its
 * systemd unit.
 *
 * SO NOTHING HERE IS A PRIVILEGE. The worst an attacker holding an admin
 * session can do through these two routes is cause the deployment to
 * install genuine upstream code earlier than its operator intended. They
 * cannot choose what runs, because the commit they name is only accepted if
 * it is the exact tip the ROOT side fetches for itself.
 */
router.get('/update', asyncRoute(async (req, res) => {
  const [check, status, busy, worker] = await Promise.all([
    checkForUpdate({ force: req.query.refresh === '1' }),
    readStatus(),
    updateInProgress(),
    // IS ANYTHING LISTENING? Asked on every load, because the answer is a
    // property of the box and changes without the application knowing —
    // somebody runs install-units.sh, or a deploy adds a unit nobody
    // installed. src/updateWorker.js says why this had to exist.
    workerState({ force: req.query.refresh === '1' }),
  ]);
  const { rows } = await pool.query(
    `SELECT requested_email, requested_at, from_version, target_version, outcome, applied_at
       FROM update_requests ORDER BY requested_at DESC LIMIT 10`,
  );
  // THE SCHEMA, beside the commit. They are two different answers: `git
  // pull` moves the checkout and `npm run migrate` moves the database, so a
  // deploy that did one and not the other runs new code against an old
  // schema with nothing reporting a fault.
  const schema = await schemaState();
  res.json({ ...check, branch: BRANCH, status, busy, history: rows, schema, worker });
}));

router.post('/update', asyncRoute(async (req, res) => {
  /* REFUSED BEFORE ANYTHING IS WRITTEN, when nothing would pick it up.
     Hiding the button is the pane's job and is not enough on its own: a page
     left open across an `install-units.sh` that was never run, or a second
     tab, or somebody curling the route, would all write a request that sits
     in `var/` forever while the pane says it starts within a minute. The
     refusal is what makes that impossible rather than unlikely. */
  const worker = await workerState({ force: true });
  if (!canApply(worker)) {
    return res.status(503).json({ error: worker.reason, reason: 'no-worker' });
  }

  if (await updateInProgress()) {
    return res.status(409).json({ error: 'an update is already being applied' });
  }

  // Checked fresh. A cached answer could name a commit the remote has since
  // moved past, and the root worker would refuse it — which would read to
  // the admin as the button being broken.
  forgetCache();
  const check = await checkForUpdate({ force: true });
  if (!check.available || !check.availableCommit) {
    return res.status(503).json({ error: check.reason || 'cannot reach the remote' });
  }
  if (!check.state || !check.state.hasUpdate) {
    return res.status(400).json({ error: 'already up to date' });
  }

  // THE COMMIT IS NEVER TAKEN FROM THE REQUEST BODY. It is what this server
  // just read from the remote. A body-supplied commit would be an admin
  // session choosing which code runs on the box.
  const target = check.availableCommit;

  const { rows } = await pool.query(
    `INSERT INTO update_requests
       (requested_by, requested_email, from_commit, target_commit, from_version, target_version)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [req.user?.id ?? null, req.user?.email ?? null, check.currentCommit, target,
      check.currentVersion, check.availableVersion],
  );

  await writeRequest({
    targetCommit: target,
    requestedBy: req.user?.id ?? null,
    requestId: String(rows[0].id),
  });

  res.json({ ok: true, targetCommit: target, targetVersion: check.availableVersion });
}));

router.delete('/update', asyncRoute(async (req, res) => {
  // Only useful between pressing the button and the worker's next pass.
  const status = await readStatus();
  if (status.state === 'running') {
    return res.status(409).json({ error: 'the update is already running' });
  }
  res.json({ ok: true, cleared: await clearRequest() });
}));

/* ---------------- the front page's buttons ----------------
 *
 * AN ORDER, AND AN OPTIONAL LABEL PER BUTTON. The order was once the whole
 * of it, on the argument that a second place to name a thing is a second
 * thing to disagree. That still holds for the DEFAULT — a blank label falls
 * back to the logbook's or list's own title, so renaming a logbook renames
 * its button — but a call to action and a record's title do different jobs,
 * and an operator should be able to say both. The site's own buttons keep
 * their own wording and a label on one is refused.
 *
 * STILL NO COLOURS: the first button is the accent, so the order is the
 * emphasis. src/homeButtons.js argues all of it at length.
 */
router.get('/home-buttons', asyncRoute(async (req, res) => {
  const [buttons, available, order] = await Promise.all([
    homeButtons(), availableButtons(), storedOrder(),
  ]);
  res.json({
    // What the page draws right now, in order, with the accent resolved —
    // so the panel shows the operator what a visitor sees rather than a
    // reconstruction of it.
    buttons,
    available,
    // null means nobody has arranged it and the shipped order applies. The
    // panel needs the difference to know whether to offer "back to the
    // shipped order" at all.
    arranged: order !== null,
  });
}));

router.put('/home-buttons', asyncRoute(async (req, res) => {
  try {
    await setHomeButtons((req.body || {}).order);
    res.json({ ok: true, buttons: await homeButtons() });
  } catch (e) {
    if (e instanceof HomeButtonRefusal) {
      return res.status(400).json({ error: e.message, reason: e.reason });
    }
    throw e;
  }
}));

router.delete('/home-buttons', asyncRoute(async (req, res) => {
  await clearHomeButtons();
  res.json({ ok: true, buttons: await homeButtons() });
}));

/* ---------------- heat maps ----------------
 *
 * CONFIGURATION ONLY. Every rule about what a reader may see lives in
 * src/mapData.js and none of it is reachable from here: this router writes
 * rows saying which maps exist, what they are fed by and where they go, and
 * the aggregate re-applies the three publication gates and the threshold
 * from scratch on every read. So the worst an admin can do by getting a
 * form wrong is publish a map that shows less than they meant.
 *
 * The threshold is the one setting worth naming twice. It is checked here
 * against the floor, checked again by a CHECK constraint in migration 049,
 * and clamped a third time in the aggregate. That is not belt and braces
 * for its own sake: it is the only setting on this panel whose wrong value
 * is a disclosure rather than a broken page.
 */
function refuseMap(res, e) {
  if (e instanceof HeatMapRefusal) {
    return res.status(400).json({ error: e.message, reason: e.reason });
  }
  throw e;
}

router.get('/heat-maps', asyncRoute(async (req, res) => {
  const [maps, candidates, lists] = await Promise.all([
    allHeatMaps(), mapCandidates(), listMapCandidates(),
  ]);
  res.json({
    maps,
    candidates,
    /* SENT UNDER THEIR OWN KEY rather than folded in beside the logbooks.
       The two are different id spaces and the panel ticks them into two
       different columns; one array would need a tag on every row to say
       which, and a row that lost its tag would feed the wrong thing. */
    lists,
    // The vocabulary the panel draws its controls from, sent rather than
    // duplicated in the page: a second copy is a second thing to keep in
    // step, and the failure when it drifts is a control for a value the
    // server refuses.
    slots: MAP_SLOTS,
    planes: MAP_PLANES,
    views: MAP_VIEWS,
    floor: MIN_AREA_FLOOR,
  });
}));

router.post('/heat-maps', asyncRoute(async (req, res) => {
  try {
    res.status(201).json(await createHeatMap(req.body || {}));
  } catch (e) { refuseMap(res, e); }
}));

router.patch('/heat-maps/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'no such map' });
  try {
    res.json(await updateHeatMap(id, req.body || {}));
  } catch (e) { refuseMap(res, e); }
}));

router.delete('/heat-maps/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'no such map' });
  // No confirmation step on the server. A heat map holds no reports and is
  // referenced by none, so deleting one removes a view and nothing else —
  // the panel asks, because the operator loses their settings.
  res.json({ ok: await deleteHeatMap(id) });
}));

/* The two flags live on a QUESTION, not on a map, so they are set here and
   not inside a map's form. One question places a report; which map draws it
   is the map's business. Marking the question in the map's own form would
   read as though the mark belonged to that map, and the next map would
   appear to need its own. */
router.post('/heat-maps/question/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'no such question' });
  try {
    res.json(await setFieldMapFlags(id, req.body || {}));
  } catch (e) { refuseMap(res, e); }
}));

/* AND THE SAME FOR A LIST'S QUESTION, on its own route because it writes a
   different table. One route taking "a question id" of either kind would
   have to guess which table the id belonged to, and the two sequences
   overlap from the first row. */
router.post('/heat-maps/list-question/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'no such question' });
  try {
    res.json(await setListMapFlag(id, req.body?.map_location === true));
  } catch (e) { refuseMap(res, e); }
}));

/* ============ THE TRANSPARENCY LOG ============

   WHERE THE PROOF GOES IS THE ONE QUESTION THAT DECIDES WHETHER THE
   INTEGRITY CLAIM IS WORTH ANYTHING, and until now it could only be
   answered by editing .env. An operator with an admin panel and no shell
   had a deployment that anchored to whatever `origin` happened to be, or
   to nothing, and no screen said which.

   OWNER ONLY, not admin. This decides where a public record of the
   archive is published and holds the key that publishes it. Every other
   setting on this page is reversible by the next administrator; pointing
   the log somewhere else is not, because what is published is published. */
const ownerOnly = requireRole('owner');

function refuseLog(res, e) {
  if (e instanceof LogRefusal) return res.status(400).json({ error: e.message, field: e.field });
  throw e;
}

router.get('/transparency-log', ownerOnly, asyncRoute(async (req, res) => {
  res.json(await logSettings());
}));

router.patch('/transparency-log', ownerOnly, asyncRoute(async (req, res) => {
  try {
    res.json(await saveLogSettings(req.body || {}));
  } catch (e) { refuseLog(res, e); }
}));

router.post('/transparency-log/key', ownerOnly, asyncRoute(async (req, res) => {
  try {
    // The PUBLIC half and the fingerprint come back. The private half is
    // not returned by makeDeployKey at all — a value that is never
    // returned cannot be logged, cached or rendered by accident.
    res.json(await makeDeployKey({ replace: req.body?.replace === true }));
  } catch (e) { refuseLog(res, e); }
}));

router.post('/transparency-log/test/:name', ownerOnly, asyncRoute(async (req, res) => {
  try {
    res.json(await testRemote(String(req.params.name || '')));
  } catch (e) { refuseLog(res, e); }
}));

/* ============ BACKUPS ============

   READ-ONLY, AND THAT IS A DECISION RATHER THAN A STAGE WE HAVE NOT
   REACHED. Taking a backup from here would be fine; RESTORING one means
   the application dropping and rebuilding the database it is currently
   answering requests from, which cannot be done by the thing being
   restored. So the panel reports what exists and hands over the exact
   command, which is the honest division: the screen knows what the
   operator cannot see from a shell, and the shell does what a web request
   must not. */
router.get('/backups', ownerOnly, asyncRoute(async (req, res) => {
  const cfg = backupSettings();
  let names = [];
  let readable = true;
  try {
    names = ours(fs.readdirSync(cfg.dir));
  } catch { readable = false; }
  const health = backupHealth(names, { maxAgeHours: cfg.maxAgeHours, keep: cfg.keep });
  res.json({
    dir: cfg.dir,
    keep: cfg.keep ?? DEFAULT_KEEP,
    readable,
    count: names.length,
    newest: names.length ? names[names.length - 1] : null,
    health,
    // The command, with this deployment's own paths already in it, so
    // nobody has to reconstruct it under pressure at the moment they
    // need it most.
    //
    // RUN AS THE SERVICE USER, and that is not a detail. The dumps sit in
    // a directory only that user can read, so a restore run as postgres
    // cannot open the file at all; and $DATABASE_URL was never set in
    // anybody's shell — it lives in .env. Both are written in here.
    restoreHint: restoreCommand({ user: os.userInfo().username, repo: process.cwd(), dir: cfg.dir }),
  });
}));

/* ============ THE ARCHIVE, OUT AND IN ============

   THESE DRIVE THE EXISTING SCRIPTS RATHER THAN REIMPLEMENTING THEM, and
   that is the decision rather than a shortcut. scripts/export-archive.js
   and scripts/import-archive.js are written as a pair, their own header
   says they must be changed together, and a round-trip test is the only
   thing that proves they still agree. A second copy of either inside a
   route is exactly the drift this repository keeps finding: two sides of
   one promise, maintained separately, agreeing until the day they do not.

   A separate process is also the safer shape for this particular job. An
   import rewrites the whole archive; doing that inside the web worker
   would hold a request open across it and leave a half-applied state
   reachable by the next one. Here it either completes or it does not, and
   the route reports which.

   OWNER ONLY, AND THE EXPORT IS THE REASON. It carries the reports, the
   restricted fields, the contact keys, the user accounts and the access
   log — the whole archive, in one file, over HTTP. */
const runScript = promisify(execFile);
const SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;

function scratchFile(name) {
  return nodePath.join(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'reportlog-archive-')), name);
}

router.get('/archive/export', ownerOnly, asyncRoute(async (req, res) => {
  const file = scratchFile('archive.json');
  const root = nodePath.join(nodePath.dirname(new URL(import.meta.url).pathname), '..', '..');
  try {
    await runScript(process.execPath, ['scripts/export-archive.js', file],
      { cwd: root, timeout: SCRIPT_TIMEOUT_MS, maxBuffer: 1 << 22 });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="reportlog-archive-${stamp}.json"`);
    // NEVER CACHED, by a browser or by anything between. It is the whole
    // archive; a copy sitting in a proxy is a copy nobody decided to make.
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(file, () => fs.rmSync(nodePath.dirname(file), { recursive: true, force: true }));
  } catch (e) {
    fs.rmSync(nodePath.dirname(file), { recursive: true, force: true });
    res.status(500).json({
      error: 'The export did not finish.',
      // The script's own words. It runs as this user against this
      // database, so there is nothing in its output a reader of this
      // page is not already entitled to.
      detail: String(e.stderr || e.message || '').slice(0, 2000),
    });
  }
}));

router.post('/archive/import', ownerOnly, express.text({ type: '*/*', limit: '256mb' }),
  asyncRoute(async (req, res) => {
    /* IT REFUSES A POPULATED ARCHIVE, and the script refuses it again.
       Checked here as well so the operator is told before a 200 MB upload
       rather than after it, and checked there because that is the copy
       that is true no matter who calls it. */
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM reports');
    if (rows[0].n > 0) {
      return res.status(409).json({
        error: `This archive already holds ${rows[0].n} report(s). Importing would `
          + 'interleave two histories, so it only runs into an empty archive.',
      });
    }
    let payload;
    try {
      payload = JSON.parse(req.body || '');
    } catch {
      return res.status(400).json({ error: 'That file is not JSON.' });
    }
    if (!payload || !Array.isArray(payload.logbooks)) {
      return res.status(400).json({
        error: 'That JSON is not an archive export — it has no logbooks in it.',
      });
    }

    const file = scratchFile('import.json');
    const root = nodePath.join(nodePath.dirname(new URL(import.meta.url).pathname), '..', '..');
    try {
      fs.writeFileSync(file, req.body);
      const { stdout } = await runScript(process.execPath, ['scripts/import-archive.js', file],
        { cwd: root, timeout: SCRIPT_TIMEOUT_MS, maxBuffer: 1 << 22 });
      const after = await pool.query('SELECT count(*)::int AS n FROM reports');
      res.json({ ok: true, reports: after.rows[0].n, detail: String(stdout).slice(-4000) });
    } catch (e) {
      res.status(500).json({
        error: 'The import did not finish. Nothing partial is left: it runs in one '
          + 'transaction and either applies or does not.',
        detail: String(e.stderr || e.message || '').slice(0, 4000),
      });
    } finally {
      fs.rmSync(nodePath.dirname(file), { recursive: true, force: true });
    }
  }));

export default router;
