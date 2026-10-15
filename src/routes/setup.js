/**
 * The first-run setup wizard.
 *
 * Reachable only from behind the curtain, and only while the deployment has
 * no owner. The curtain password is the only thing gating it, and that is
 * deliberate — a separate single-use setup token was proposed and rejected
 * on 9 September. The reasoning, for whoever wonders later: the window
 * between install and setup is minutes, not weeks; the deployment holds no
 * archive, no chain and no reports at that point; and the worst outcome is
 * that somebody completes setup first and locks the real operator out,
 * which is loud, immediately obvious, and recovered by reinstalling onto an
 * empty box. A nuisance, not a breach. The token bought very little and
 * cost a printed secret, a file on disk, a recovery path and a
 * documentation section, all landing on the person least equipped to deal
 * with any of them.
 *
 * The defence that is not optional is the other one: the installer refuses
 * to finish without a curtain password the operator chose
 * (scripts/set-curtain-password.js). That is the whole of it.
 *
 * Ownership is proved by email, through the same one-time code every other
 * sign-in uses. That is worth more than a form field: it establishes that
 * the address is real and reachable, and that outbound mail works on this
 * deployment — which is the failure that otherwise surfaces later, as
 * nobody being able to sign in at all.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { normalizeEmail, looksLikeEmail, hmacEmail, sha256Hex } from '../crypto.js';
import { createCode, verifyCode, createSession } from '../otp.js';
import { sendEmail } from '../email.js';
import {
  setupState, markSetupComplete, validateCurtainPassword, MIN_CURTAIN_PASSWORD,
} from '../setup.js';
import { COOKIE_NAME } from './auth.js';
import { asyncRoute } from '../asyncRoute.js';
import { hasAdminAuthority } from '../roleRank.js';

const router = express.Router();
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 24 * 60 * 60 * 1000 };

const codeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyGenerator: (req) => req.ip });
const verifyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, keyGenerator: (req) => req.ip });

/**
 * Every writing route re-checks that setup is still needed.
 *
 * Not because the frontend would ask otherwise, but because the frontend is
 * not what makes this safe. Two people running the wizard at once, a stale
 * tab left open for a week, a replayed request — each arrives here, and
 * each has to be refused by the server rather than by the page that sent
 * it.
 */
const onlyWhileUnfinished = asyncRoute(async (req, res, next) => {
  const state = await setupState();
  if (!state.needed) {
    return res.status(409).json({ error: 'This deployment has already been set up', setupDone: true });
  }
  next();
});

// Stricter, and only for the two routes that mint the owner: a deployment
// that already has an admin has one, and a second wizard must not make
// another. The curtain step deliberately does NOT carry this — by the time
// it runs, the admin it requires is the one step two just created.
const onlyWhileOwnerless = asyncRoute(async (req, res, next) => {
  const state = await setupState();
  if (!state.needed || state.hasAdmin) {
    return res.status(409).json({ error: 'This deployment has already been set up', setupDone: true });
  }
  next();
});

router.get('/status', asyncRoute(async (req, res) => {
  const state = await setupState();
  // Two booleans, no more. Whether a deployment has been handed over, and
  // whether it got as far as minting an owner, are both facts anyone behind
  // the curtain may as well know — and the second is what lets a reloaded
  // tab resume at the step it was on instead of restarting a wizard whose
  // first two steps can no longer be run. When it happened, and to whom,
  // are not offered.
  // The password minimum travels with the status rather than being typed
  // into the markup. The wizard has to state the rule before somebody types
  // — an error after the fact was the whole complaint — and a number written
  // twice is a number that disagrees with itself the first time it changes.
  res.json({
    needed: state.needed,
    hasAdmin: state.hasAdmin,
    minPassword: MIN_CURTAIN_PASSWORD,
  });
}));

// Step one: who owns this deployment. Sends the code.
router.post('/request-code', codeLimiter, onlyWhileOwnerless, asyncRoute(async (req, res) => {
  const email = normalizeEmail((req.body || {}).email);
  if (!looksLikeEmail(email)) return res.status(400).json({ error: 'Enter a valid email' });

  const code = await createCode(hmacEmail(email));
  const result = await sendEmail({
    to: [{ email }],
    subject: 'Set up your ReportLog deployment',
    html: `<p>Your one-time code is <b>${code}</b>. It expires in 10 minutes.</p>
           <p>Entering it makes this address the administrator of this ReportLog
              deployment. If you were not expecting this, ignore it — nothing
              happens without the code.</p>`,
  });
  // The same fallback the sign-in route uses. On a deployment whose mail is
  // not configured yet this is the difference between a setup that can be
  // completed from the server's log and one that cannot be completed at all.
  if (!result.sent && result.reason === 'no-api-key') {
    console.log(`[setup] code for ${email}: ${code} (would have emailed — no email provider key configured yet)`);
  }
  res.json({ ok: true, emailed: !!result.sent });
}));

// Step two: the code. This is the moment the deployment gets an owner.
router.post('/verify-code', verifyLimiter, onlyWhileOwnerless, asyncRoute(async (req, res) => {
  const email = normalizeEmail((req.body || {}).email);
  const code = (req.body || {}).code;
  if (!looksLikeEmail(email) || !code) return res.status(400).json({ error: 'Email and code are required' });

  const emailHmac = hmacEmail(email);
  if (!await verifyCode(emailHmac, code)) return res.status(401).json({ error: 'Invalid or expired code' });

  // One transaction, and the admin check is repeated inside it against a
  // locked row. Without that, two wizards racing each other both pass
  // onlyWhileNeeded and both mint an admin — the check and the write have
  // to be atomic or the check is decoration.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const { rows: existing } = await client.query(
      "SELECT 1 FROM users WHERE role IN ('admin', 'owner') LIMIT 1",
    );
    if (existing.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This deployment has already been set up', setupDone: true });
    }
    // The first account is the OWNER, not an admin. The owner seat is
    // ungrantable through setSystemRole by design, so if the wizard minted
    // an admin instead there would be no way to ever produce an owner and
    // the deployment could never appoint a second administrator.
    await client.query(
      `INSERT INTO users (email, email_hmac, role) VALUES ($1, $2, 'owner')
       ON CONFLICT (email) DO UPDATE SET role = 'owner', updated_at = now()`,
      [email, emailHmac],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  const { token } = await createSession(emailHmac);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ ok: true, role: 'admin' });
}));

/**
 * Step three: the curtain password, and the end of setup.
 *
 * A decision is required. `keep` and `change` are both explicit; there is
 * no default and no skip, and a request carrying neither is refused.
 *
 * That is the point of the whole screen. Offered as an option, a password
 * the developer chose stays live in somebody else's deployment and neither party
 * notices. It is the same logic as revoking developer access at handover:
 * it feels unnecessary on the day, and that is exactly why it has to be
 * the software asking rather than the person remembering.
 */
router.post('/curtain', onlyWhileUnfinished, asyncRoute(async (req, res) => {
  const state = await setupState();
  // Only the person who just proved they own this deployment may finish it.
  if (!state.hasAdmin || !hasAdminAuthority(req.user?.role)) {
    return res.status(401).json({ error: 'Sign in as the administrator first' });
  }

  const decision = (req.body || {}).decision;
  if (decision !== 'keep' && decision !== 'change') {
    return res.status(400).json({ error: 'Choose whether to keep or change the password' });
  }

  if (decision === 'change') {
    const body = req.body || {};
    const check = validateCurtainPassword(body.password);
    if (!check.ok) return res.status(400).json({ error: check.error });
    // Checked at the server as well as at the field. A mistyped curtain
    // password on the last screen of setup locks the operator out of the
    // deployment they were just handed, with the installer's password
    // already dead — so the confirmation is part of the contract, not a
    // convenience the page offers.
    if (String(body.passwordConfirm ?? '') !== check.password) {
      return res.status(400).json({ error: 'The two passwords do not match' });
    }
    await pool.query(
      'UPDATE site_settings SET access_password_hash = $1, access_enabled = true, updated_at = now() WHERE id = true',
      [sha256Hex(check.password)],
    );
  }

  await markSetupComplete();
  // Changing the password does not evict the session that changed it: the
  // operator is mid-wizard behind that curtain, and logging them out at the
  // last step of setup would look exactly like the software breaking.
  res.json({ ok: true, changed: decision === 'change' });
}));

export default router;
