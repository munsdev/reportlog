/**
 * Everything that expires. Run it on a timer, beside the anchor.
 *
 *   npm run sweep
 *
 * TWO SWEEPS, DOING DIFFERENT THINGS, run by one timer.
 *
 * `src/sweep.js` DELETES whole rows from four named tables of expired
 * credentials. Nothing depends on it for correctness — every expiring row
 * is checked against its own `expires_at` when used, so an expired one has
 * never been accepted. It stops the tables growing forever with dead
 * credentials.
 *
 * `src/lists/sweep.js` ERASES COLUMNS and leaves the row standing: the
 * erasable half of a list entry, and the day's address-hashing secrets.
 * **THIS ONE IS A PROMISE BEING KEPT.** A deployment that documents a
 * ninety-day retention period and never runs it holds people's words
 * indefinitely while saying it does not — and destroying the day's secret
 * is what makes an address hash one-way at all. Without this, the hashes
 * stay correlatable forever.
 *
 * They are kept as two modules on purpose. Neither one's table list is
 * discovered by scanning for a column, and a list table must never be added
 * to the first one — `src/sweep.js` would delete the row, and the links are
 * the half that stays.
 *
 * Safe to run at any time and safe to run twice.
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import { sweepExpired, SWEPT } from '../src/sweep.js';
import { sweepLists } from '../src/lists/sweep.js';

const removed = await sweepExpired();
const labels = Object.fromEntries(SWEPT);

let total = 0;
for (const [table, count] of Object.entries(removed)) {
  if (typeof count === 'number') {
    total += count;
    if (count) console.log(`  ${String(count).padStart(7)}  ${labels[table] || table}`);
  } else {
    console.error(`  FAILED   ${labels[table] || table}: ${count.error}`);
  }
}
console.log(total ? `\n${total} expired row(s) deleted.` : 'Nothing had expired.');

// The second sweep. Reported separately because it is a different
// operation: these rows are not deleted, they are emptied of the half that
// was only ever kept for a while.
const LIST_LABELS = {
  list_entries: "list entries whose personal half expired (the row and its links stay)",
  list_salts: "days' address-hashing secrets destroyed",
  list_erasures: 'spent or expired erasure links',
};
const erased = await sweepLists({});
let erasedTotal = 0;
for (const [table, count] of Object.entries(erased)) {
  if (typeof count === 'number') {
    erasedTotal += count;
    if (count) console.log(`  ${String(count).padStart(7)}  ${LIST_LABELS[table] || table}`);
  } else {
    console.error(`  FAILED   ${LIST_LABELS[table] || table}: ${count.error}`);
  }
}
console.log(erasedTotal
  ? `${erasedTotal} list row(s) had something erased.`
  : 'No list entry had anything to erase.');

await pool.end();
const failed = [...Object.values(removed), ...Object.values(erased)]
  .some((v) => typeof v !== 'number');
process.exit(failed ? 1 : 0);
