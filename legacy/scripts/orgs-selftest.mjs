/**
 * The parts of roles, organizations and third-party intake that need a
 * real database to mean anything: transactions, constraints, the
 * append-only trigger, and whether a coordinator-filed report actually
 * verifies once it is in the chain.
 *
 * npm test covers what can be checked without one. This is the other half,
 * and it needs a scratch database:
 *
 *   createdb orgtest
 *   DATABASE_URL=postgres://…/orgtest node scripts/migrate.js
 *   DATABASE_URL=postgres://…/orgtest \
 *   CONTACT_HMAC_KEY=$(openssl rand -base64 32) \
 *   TIER_B_ENCRYPTION_KEY=$(openssl rand -base64 32) \
 *     node scripts/orgs-selftest.mjs
 *
 * Never point it at a database with real reports in it: it writes.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
const { pool } = await import('../src/db.js');
const R = await import('../src/roles.js');
const O = await import('../src/organizations.js');
const V = await import('../src/verify.js');
const { insertReportVersion, normalizeReportFields } = await import('../src/reportCore.js');
const L = await import('../src/logbooks.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

const admin = { email: 'admin@example.org', role: 'admin' };
for (const [email, role] of [['admin@example.org', 'admin'], ['am@example.org', 'user'],
  ['mod@example.org', 'user'], ['mgr@example.org', 'user'], ['coord@example.org', 'user']]) {
  await pool.query(`INSERT INTO users (email,email_hmac,role) VALUES ($1,$2,$3)
    ON CONFLICT (email) DO UPDATE SET role=EXCLUDED.role`, [email, 'h_' + email, role]);
}

console.log('\nroles');
let r = await R.setSystemRole({ actor: admin, email: 'am@example.org', role: 'access_manager' });
ok('an admin can appoint an Access Manager', r.ok);

const am = { email: 'am@example.org', role: 'access_manager' };
r = await R.setSystemRole({ actor: am, email: 'mod@example.org', role: 'moderator' });
ok('an Access Manager can appoint a Moderator', r.ok);

r = await R.setSystemRole({ actor: am, email: 'someone@example.org', role: 'access_manager' });
ok('an Access Manager CANNOT appoint another Access Manager', !r.ok && r.reason === 'not-permitted', JSON.stringify(r));

r = await R.setSystemRole({ actor: am, email: 'admin@example.org', role: 'user' });
ok('an Access Manager cannot demote an admin', !r.ok, JSON.stringify(r));

r = await R.setSystemRole({ actor: am, email: 'am@example.org', role: 'user' });
ok('nobody changes their own role', !r.ok && r.reason === 'self');

const { rows: audit } = await pool.query('SELECT actor_email,subject_email,action,detail FROM role_audit ORDER BY id');
ok('every grant is on the record', audit.length >= 2, JSON.stringify(audit));

console.log('\norganizations');
let o = await O.createOrganization({ actor: am, name: 'Indivisible Abroad Munich', details: 'Test', managerEmails: ['mgr@example.org'] });
ok('an Access Manager can create an organization', o.ok, JSON.stringify(o));
const orgId = o.organization.id;

o = await O.createOrganization({ actor: am, name: 'No Managers', managerEmails: [] });
ok('an organization cannot be created with nobody to run it', !o.ok && o.reason === 'manager-required');

const mgr = { email: 'mgr@example.org', role: 'user' };
let a = await O.addMember({ actor: mgr, actorIsManager: true, organizationId: orgId, email: 'coord@example.org', role: 'coordinator' });
ok('a manager can add a coordinator', a.ok);

a = await O.addMember({ actor: mgr, actorIsManager: true, organizationId: orgId, email: 'other@example.org', role: 'manager' });
ok('a manager CANNOT promote another manager', !a.ok && a.reason === 'manager-cannot-promote');

a = await O.addMember({ actor: am, actorIsManager: false, organizationId: orgId, email: 'nobody@example.org', role: 'coordinator' });
ok('inviting an address with no account leaves a pending invite', a.ok && a.pending);

let rm = await O.removeMember({ actor: mgr, actorIsManager: true, organizationId: orgId, email: 'mgr@example.org' });
ok('a manager cannot remove a manager', !rm.ok);

rm = await O.removeMember({ actor: am, actorIsManager: false, organizationId: orgId, email: 'mgr@example.org' });
ok('the last manager cannot be removed', !rm.ok && rm.reason === 'last-manager', JSON.stringify(rm));

const members = await O.membersOf(orgId);
ok('pending invites are listed alongside members', members.some((m) => m.pending), JSON.stringify(members));

console.log('\nthe chain');
const made = await L.createLogbook({ title: 'Orgs selftest', slug: 'orgs-selftest' });
await L.addField(made.logbook.id, { kind: 'long_text', label: 'What happened' });
await L.launch(made.logbook.id);
const lbId = made.logbook.id;
const DIGEST = 'e'.repeat(64);
const client = await pool.connect();
await client.query('BEGIN');
const direct = await insertReportVersion(client, {
  threadId: crypto.randomUUID(),
  correctsId: null,
  logbookId: lbId,
  fields: normalizeReportFields({
    logbook: 'orgs-selftest', answers: { what_happened: 'A witness filing for themselves.' },
    may_publish: true, may_publish_digest: DIGEST,
  }),
});
await client.query('INSERT INTO report_heads (thread_id,current_report_id) VALUES ($1,$2)', [direct.thread_id, direct.id]);

const tid = crypto.randomUUID();
const viaOrg = await insertReportVersion(client, {
  threadId: tid,
  correctsId: null,
  logbookId: lbId,
  fields: normalizeReportFields({
    logbook: 'orgs-selftest', answers: { what_happened: 'An account taken off a paper form at the polling place.' },
    may_publish: true, may_publish_digest: DIGEST,
    third_party: true, filed_via: 'Indivisible Abroad Munich', intake_method: 'paper', attested_at: '2026-11-03T21:00:00.000Z', collected_on: '2026-11-03',
  }),
  organizationId: orgId,
  sourceRef: 'clipboard 3, entry 7',
});
await client.query('INSERT INTO report_heads (thread_id,current_report_id) VALUES ($1,$2)', [tid, viaOrg.id]);
await client.query('COMMIT');
client.release();

for (const ref of [direct.public_ref, viaOrg.public_ref]) {
  const v = await V.verifyReport(ref);
  ok('verifies: ' + ref, v.content.ok && v.link.ok && v.position.ok, JSON.stringify(v.content));
}
const v2 = await V.verifyReport(viaOrg.public_ref);
ok('the organization is inside the seal', v2.canonical_json.includes('Indivisible Abroad Munich'));
ok('the coordinator is NOT inside the seal', !v2.canonical_json.includes('coord@example.org'));
ok("the coordinator's private paper reference is not in the seal", !v2.canonical_json.includes('clipboard 3'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
