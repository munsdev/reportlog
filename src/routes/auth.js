import express from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { claimInvites } from '../organizations.js';
import { normalizeEmail, looksLikeEmail, hmacEmail } from '../crypto.js';
import { createCode, verifyCode, createSession, getSession, destroySession } from '../otp.js';
import { sendEmail } from '../email.js';
import { plainSiteName } from '../siteIdentity.js';
import { asyncRoute } from '../asyncRoute.js';

const router = express.Router();

export const COOKIE_NAME = 'session_token';
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 24 * 60 * 60 * 1000 };

const requestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyGenerator: (req) => req.ip });
const verifyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, keyGenerator: (req) => req.ip });

router.post('/request-code', requestLimiter, asyncRoute(async (req, res) => {
  const email = normalizeEmail((req.body || {}).email);
  if (!looksLikeEmail(email)) return res.status(400).json({ error: 'Enter a valid email' });

  const emailHmac = hmacEmail(email);
  const code = await createCode(emailHmac);
  // Always send, regardless of whether this email has an account yet —
  // otherwise the response (or its timing) would leak who has one.
  const result = await sendEmail({
    to: [{ email }],
    // The deployment's name, not the software's: somebody signing in to
    // "Test Log 2" was sent "Your ReportLog access code" by a sender they had
    // never heard of.
    subject: `Your ${await plainSiteName()} access code`,
    html: `<p>Your one-time code is <b>${code}</b>. It expires in 10 minutes.</p>
           <p>If you didn't request this, you can ignore it — no account exists without this code.</p>`,
  });
  if (!result.sent && result.reason === 'no-api-key') {
    console.log(`[auth] OTP for ${email}: ${code} (would have emailed — no email provider key configured yet)`);
  }
  res.json({ ok: true });
}));

router.post('/verify-code', verifyLimiter, asyncRoute(async (req, res) => {
  const email = normalizeEmail((req.body || {}).email);
  const code = (req.body || {}).code;
  if (!looksLikeEmail(email) || !code) return res.status(400).json({ error: 'Email and code are required' });

  const emailHmac = hmacEmail(email);
  const ok = await verifyCode(emailHmac, code);
  if (!ok) return res.status(401).json({ error: 'Invalid or expired code' });

  // SIGNING IN NEVER CHANGES A ROLE. It once did: ADMIN_EMAIL promoted
  // whoever held that address to administrator on EVERY sign-in, which
  // meant it did not merely mint the first admin — it silently reversed any
  // later demotion, and it wrote no role_audit row, against the one rule
  // src/roles.js exists to enforce. Whoever could write .env already had a
  // shell, so it was never a hole; it was an ungoverned grant that left no
  // trace, which is worse in an archive that has to be able to say who
  // granted what.
  //
  // Appointing an administrator is the owner's alone now (migration 023),
  // and a second quieter way in would have hollowed that out on day one.
  // An existing admin is unaffected: this only stops sign-in from SETTING a
  // role, so everybody keeps whatever they hold.
  //
  // ADMIN_EMAIL itself stays — it is still where volunteer applications and
  // the feedback digest are sent. It is a notification address, not a
  // privilege.
  const { rows } = await pool.query(
    `INSERT INTO users (email, email_hmac, role)
     VALUES ($1, $2, 'user')
     ON CONFLICT (email) DO UPDATE SET updated_at = now()
     RETURNING id, role`,
    [email, emailHmac],
  );

  // An invitation waiting for this address becomes a membership the first
  // time they arrive, rather than needing whoever invited them to do it a
  // second time once the account exists.
  await claimInvites(rows[0].id, email);

  const { token } = await createSession(emailHmac);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ ok: true, role: rows[0].role });
}));

router.post('/logout', asyncRoute(async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) await destroySession(token);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
}));

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(req.user);
});

// Mounted globally in server.js — annotates req.user for every request
// (doesn't block unauthenticated ones; routes that need auth check req.user
// themselves via requireAuth/requireRole).
export async function attachUser(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const session = await getSession(token);
  if (!session) return next();

  // Memberships come along with the identity because almost everything
  // organization-shaped needs them, and a second round trip per request to
  // fetch a list that is nearly always empty or one row is not worth it.
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role, u.is_tester, u.is_team_member, u.desks,
            coalesce(json_agg(json_build_object(
              'organization_id', m.organization_id, 'name', o.name, 'role', m.role
            ) ORDER BY o.name) FILTER (WHERE m.id IS NOT NULL), '[]') AS memberships
     FROM users u
     LEFT JOIN organization_memberships m ON m.user_id = u.id
     LEFT JOIN organizations o ON o.id = m.organization_id
     WHERE u.email_hmac = $1
     GROUP BY u.id`,
    [session.email_hmac],
  );
  if (rows[0]) req.user = rows[0];
  next();
}

export default router;
