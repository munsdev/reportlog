import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { sha256Hex } from '../crypto.js';
import { getSiteSettings, gateApplies, SITE_ACCESS_COOKIE } from '../siteAccess.js';
import { getDevMode } from '../devMode.js';
import { RELEASE_VERSION } from '../appVersion.js';
import { siteName, SOFTWARE_NAME } from '../siteIdentity.js';
import { currentLook, parseBrand, isMarked, plainName } from '../look.js';
import { asyncRoute } from '../asyncRoute.js';

const router = express.Router();
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const unlockLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

// Also carries the dev-mode expiry: this is the one endpoint every visitor
// already hits before anything else renders, so the corner notice needs no
// extra request. The expiry (not just a boolean) lets the page hide the
// notice by itself when the window closes, without a poll.
router.get('/status', asyncRoute(async (req, res) => {
  const settings = await getSiteSettings();
  const dev = await getDevMode();
  // Read once: the name, its plain form and its runs are three views of the
  // same string and must not be able to disagree.
  const siteNameValue = await siteName();
  const devFields = {
    devMode: dev.active,
    devModeUntil: dev.active ? dev.until : null,
    // Rides along here so the footer can show it without another request.
    version: RELEASE_VERSION,
    // Same reason. This is the first call every page makes, and the brand
    // has to be right before anything renders — a page that says one name
    // and then swaps to another has already shown the wrong one.
    siteName: siteNameValue,
    // The name already split into its runs, so the page never parses a
    // name and never has to know the quote convention. `parts` is ordered
    // and each carries its own mark: '' plain, 'a' the first accent, 'b'
    // the second. A name with no marks is one part, which is why the page
    // needs no special case for the ordinary name.
    brand: {
      parts: parseBrand(siteNameValue),
      plain: plainName(siteNameValue),
      marked: isMarked(siteNameValue),
    },
    software: SOFTWARE_NAME,
    // Same reason as the name, and the lock screen wears it too: this is
    // the first call every page makes, and a site that paints one way and
    // then repaints has already shown the wrong one.
    look: await currentLook(),
  };
  /* THE SAME RULE THE GATE ITSELF USES. If this said "locked" while
     `hasSiteAccess` said "in", the lock screen would sit over an app whose
     every request succeeded — which is worse than either answer, because
     nothing on screen would explain it. A gate with no password set is not
     a gate; see src/siteAccess.js. */
  if (!gateApplies(settings)) return res.json({ locked: false, ...devFields });

  const token = req.cookies?.[SITE_ACCESS_COOKIE];
  if (!token) return res.json({ locked: true, ...devFields });
  const { rows } = await pool.query(
    'SELECT 1 FROM site_access_tokens WHERE token = $1 AND expires_at > now()',
    [token],
  );
  res.json({ locked: !rows.length, ...devFields });
}));

router.post('/unlock', unlockLimiter, asyncRoute(async (req, res) => {
  const settings = await getSiteSettings();
  if (!gateApplies(settings)) return res.json({ ok: true });

  const password = String((req.body || {}).password || '');
  if (!settings.access_password_hash || sha256Hex(password) !== settings.access_password_hash) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await pool.query('INSERT INTO site_access_tokens (token, expires_at) VALUES ($1, $2)', [token, expiresAt]);
  res.cookie(SITE_ACCESS_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: TOKEN_TTL_MS,
    path: '/',
  });
  res.json({ ok: true });
}));

export default router;
