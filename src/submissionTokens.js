import crypto from 'node:crypto';
import { pool } from './db.js';

// HOW LONG A CONFIRMATION LINK LASTS, and the staged uploads with it.
//
// Twenty-four hours, down from forty-eight, decided as part of closing the staging-quota hole: an unauthenticated caller could
// mint draft tokens and park roughly 8 GB of staging per quarter hour, and
// halving the window halves what one of them can hold.
//
// WHAT IT COSTS, SAID PLAINLY: somebody who files on a Friday night and gets
// to their mail on Sunday now finds the link dead. That was the argument for
// forty-eight and it is a real person; the trade was made deliberately.
//
// `SLOT_TTL_MS` in src/attachments.js MUST MATCH. The two expire together on
// purpose — a staged upload outliving its submission is an orphan, and a
// submission outliving its uploads is a reporter confirming a report whose
// files have silently gone. The suite asserts they are equal.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export async function createSubmissionToken(email, payload) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await pool.query(
    'INSERT INTO report_submission_tokens (token, email, payload, expires_at) VALUES ($1, $2, $3, $4)',
    [token, email, payload, expiresAt],
  );
  return token;
}

export async function getSubmissionToken(token) {
  const { rows } = await pool.query(
    'SELECT * FROM report_submission_tokens WHERE token = $1',
    [token],
  );
  return rows[0] || null;
}
