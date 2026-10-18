// Run every hour via cron. Batches new published reports since each
// hourly subscriber's last send into one email, limited to the logbooks
// they follow. See src/digest.js.
import 'dotenv/config';
import { pool } from '../src/db.js';
import { runDigest } from '../src/digest.js';

const n = await runDigest({
  mode: 'hourly',
  windowMs: 60 * 60 * 1000,
  subject: (k) => `Hourly update — ${k} new report(s)`,
  intro: (k) => `${k} new report(s) in the last hour.`,
});
console.log(`hourly-notify: checked ${n} subscriber(s).`);
await pool.end();
