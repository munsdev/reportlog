// Run once a week via cron. Same as hourly-notify.js, wider window.
import 'dotenv/config';
import { pool } from '../src/db.js';
import { runDigest } from '../src/digest.js';

const n = await runDigest({
  mode: 'weekly',
  windowMs: 7 * 24 * 60 * 60 * 1000,
  subject: (k) => `Weekly digest — ${k} report(s)`,
  intro: (k) => `${k} report(s) in the last week.`,
});
console.log(`weekly-notify: checked ${n} subscriber(s).`);
await pool.end();
