/**
 * The two revocable reporter permissions, against a real database.
 *
 * These cannot live in the main suite. The whole feature is a PROJECTION over
 * an append-only log — the newest row for a thread and a permission wins —
 * and a projection only exists once rows round-trip through Postgres in an
 * order the database chose. The append-only guarantee is the same: a trigger
 * refusing UPDATE, DELETE and TRUNCATE cannot be tested without a trigger.
 *
 *   DATABASE_URL="postgres://…/scratch" node scripts/permissions-selftest.mjs
 */
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to a scratch database with the migrations applied.');
  process.exit(2);
}
process.env.TIER_B_ENCRYPTION_KEY ||= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.CONTACT_HMAC_KEY ||= '0123456789abcdef0123456789abcdef';
const { pool } = await import('../src/db.js');
const P = await import('../src/reportPermissions.js');

let pass = 0; let fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (x ? ' — ' + x : ''))); };
const uuid = async () => (await pool.query('SELECT gen_random_uuid() AS u')).rows[0].u;

console.log('\nnothing granted until somebody grants it');
const t1 = await uuid();
let now = await P.permissionsFor(t1);
ok('a thread with no rows has neither permission',
  now[P.CONTACT_PASSING] === false && now[P.ATTACHMENT_PUBLICATION] === false);
ok('and that is the shape every caller gets, not a missing key',
  Object.keys(now).sort().join(',') === P.PERMISSIONS.slice().sort().join(','));
// This is the whole reason there is no DEFAULT on the table: every thread
// filed before migration 030 has to read as never-granted, and does, without
// a backfill touching a single existing row.
ok('which is what every thread filed before this feature reads as',
  (await P.permissionsFor(await uuid()))[P.CONTACT_PASSING] === false);

console.log('\nthe projection: the newest row wins');
await P.setPermission({ threadId: t1, permission: P.CONTACT_PASSING, granted: true });
ok('granting shows as granted', (await P.permissionsFor(t1))[P.CONTACT_PASSING] === true);
await P.setPermission({ threadId: t1, permission: P.CONTACT_PASSING, granted: false, reason: 'changed my mind' });
ok('revoking shows as revoked', (await P.permissionsFor(t1))[P.CONTACT_PASSING] === false);
await P.setPermission({ threadId: t1, permission: P.CONTACT_PASSING, granted: true });
ok('and it can be given back again', (await P.permissionsFor(t1))[P.CONTACT_PASSING] === true);
ok('every step is still in the log, which is the point of a log',
  (await P.permissionHistory(t1)).length === 3);
ok('history is newest first', (await P.permissionHistory(t1))[0].granted === true);
ok('and carries the reason that was given',
  (await P.permissionHistory(t1)).some((r) => r.reason === 'changed my mind'));

console.log('\nthe two permissions are independent');
const t2 = await uuid();
await P.setPermission({ threadId: t2, permission: P.ATTACHMENT_PUBLICATION, granted: true });
now = await P.permissionsFor(t2);
ok('granting one does not grant the other',
  now[P.ATTACHMENT_PUBLICATION] === true && now[P.CONTACT_PASSING] === false);
await P.setPermission({ threadId: t2, permission: P.CONTACT_PASSING, granted: true });
await P.setPermission({ threadId: t2, permission: P.ATTACHMENT_PUBLICATION, granted: false });
now = await P.permissionsFor(t2);
ok('and revoking one does not revoke the other',
  now[P.ATTACHMENT_PUBLICATION] === false && now[P.CONTACT_PASSING] === true);

console.log('\none thread cannot read or change another');
const t3 = await uuid();
ok('a thread nobody has touched is unaffected by either of the above',
  (await P.permissionsFor(t3))[P.CONTACT_PASSING] === false);
const many = await P.permissionsForMany([t1, t2, t3]);
ok('the batched projection agrees with the single one for each thread',
  P.fromMap(many, t1)[P.CONTACT_PASSING] === true
  && P.fromMap(many, t2)[P.ATTACHMENT_PUBLICATION] === false
  && P.fromMap(many, t3)[P.CONTACT_PASSING] === false);
ok('and a thread with no rows falls back rather than going missing',
  Object.keys(P.fromMap(many, t3)).length === P.PERMISSIONS.length);

console.log('\nthe log is append-only, and the database is what enforces it');
const refuses = async (sql) => {
  try { await pool.query(sql); return false; } catch (e) { return /append-only/.test(e.message); }
};
ok('UPDATE is refused', await refuses('UPDATE report_permissions_log SET granted = false'));
ok('DELETE is refused', await refuses('DELETE FROM report_permissions_log'));
// 007 closed exactly this hole on eight other tables: row triggers do not
// fire for TRUNCATE, so "append-only" was never true of it until it was said
// separately.
ok('TRUNCATE is refused, which a row trigger alone would not catch',
  await refuses('TRUNCATE report_permissions_log'));

console.log('\nwhat the table refuses to record at all');
const rejects = async (sql, params) => {
  try { await pool.query(sql, params); return false; } catch (e) { return /violates check constraint/.test(e.message); }
};
ok('an unknown permission name',
  await rejects('INSERT INTO report_permissions_log (thread_id, permission, granted) VALUES ($1, $2, true)',
    [t3, 'publish_my_identity']));
// A moderator granting a permission on somebody's behalf would write the
// operator's decision under the reporter's name. The constraint states it so
// that a future route cannot quietly become the exception.
ok('and any actor other than the reporter',
  await rejects('INSERT INTO report_permissions_log (thread_id, permission, granted, actor) VALUES ($1, $2, true, $3)',
    [t3, P.CONTACT_PASSING, 'moderator']));
ok('the module refuses an unknown name before the database has to', await (async () => {
  try { await P.setPermission({ threadId: t3, permission: 'whatever', granted: true }); return false; } catch { return true; }
})());

console.log('\nnone of this is in the record');
// The one that must never go red. These permissions are deliberately outside
// the fingerprint, so nothing that computes one may even be able to see them.
const core = await import('../src/reportCore.js');
const verify = await import('../src/verify.js');
ok('reportCore exports nothing about permissions',
  !Object.keys(core).some((k) => /permission/i.test(k)));
ok('verify exports nothing about permissions',
  !Object.keys(verify).some((k) => /permission/i.test(k)));
const built = core.buildImmutableFields({
  publicRef: 'RL-000000-000000', receivedAt: '2026-09-29T00:00:00.000Z',
  threadId: t1, correctsId: null, fields: { logbook_slug: 'x', consent: true },
});
ok('and a hashed object built for a thread WITH permissions carries none of them',
  !JSON.stringify(built).includes('contact_passing')
  && !JSON.stringify(built).includes('attachment_publication')
  && !JSON.stringify(built).includes('permission'));

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
