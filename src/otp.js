import crypto from 'node:crypto';
import { pool } from './db.js';
import { sha256Hex } from './crypto.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // matches the session_token cookie's maxAge

export function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

export async function createCode(emailHmac) {
  const code = generateCode();
  const codeHash = sha256Hex(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await pool.query(
    'INSERT INTO otp_codes (email_hmac, code_hash, expires_at) VALUES ($1, $2, $3)',
    [emailHmac, codeHash, expiresAt],
  );
  return code;
}

// Returns true/false. Marks the code used on success so it can't be replayed.
// Does not itself rate-limit attempts — that's the route's job.
export async function verifyCode(emailHmac, code) {
  const codeHash = sha256Hex(String(code || ''));
  const { rows } = await pool.query(
    `SELECT id FROM otp_codes
     WHERE email_hmac = $1 AND code_hash = $2 AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [emailHmac, codeHash],
  );
  if (!rows[0]) return false;
  await pool.query('UPDATE otp_codes SET used_at = now() WHERE id = $1', [rows[0].id]);
  return true;
}

export async function createSession(emailHmac) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    'INSERT INTO self_sessions (token, email_hmac, expires_at) VALUES ($1, $2, $3)',
    [token, emailHmac, expiresAt],
  );
  return { token, expiresAt };
}

export async function getSession(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    'SELECT email_hmac FROM self_sessions WHERE token = $1 AND expires_at > now()',
    [token],
  );
  return rows[0] || null;
}

export async function destroySession(token) {
  await pool.query('DELETE FROM self_sessions WHERE token = $1', [token]);
}
