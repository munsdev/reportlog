// Print today's public snapshot without publishing anything.
//
//   npm run snapshot            the whole file
//   npm run snapshot -- --check just the summary and any mismatches
//
// The nightly anchor writes this file into the transparency log itself
// (scripts/anchor.js). This exists so the same output can be looked at, or
// diffed, without waiting for cron or touching the public repository.
import 'dotenv/config';
import { pool } from '../src/db.js';
import { buildSnapshot, serializeSnapshot } from '../src/snapshot.js';

const checkOnly = process.argv.includes('--check');
const date = new Date().toISOString().slice(0, 10);
const snapshot = await buildSnapshot(date);

if (checkOnly) {
  console.log(`date          ${snapshot.date}`);
  console.log(`published     ${snapshot.report_count} report(s)`);
  console.log(`chain head    ${snapshot.chain_head || '(no reports yet)'}`);
  const bad = snapshot.reports_not_matching_their_own_hash || 0;
  console.log(`hashes        ${bad ? `${bad} DO NOT MATCH` : 'all match their recorded value'}`);
  if (bad) {
    console.log('\nReports whose contents no longer hash to what was recorded:');
    for (const r of snapshot.reports) {
      if (r.content_hash_recomputed) {
        console.log(`  ${r.public_ref}\n    recorded   ${r.content_hash}\n    recomputed ${r.content_hash_recomputed}`);
      }
    }
    process.exitCode = 1;
  }
} else {
  process.stdout.write(serializeSnapshot(snapshot));
}

await pool.end();
