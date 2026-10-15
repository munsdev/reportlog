/**
 * Organization invitations, against a real database and a real app.
 *
 * This is a permission system and a NEW DOOR INTO ROLE GRANTING, so most of
 * what is asserted here is about what must NOT be possible. The pure half —
 * that the ceiling function refuses non-org roles — is in the main suite.
 * What needs a database is everything about state: that looking does not
 * consume, that a link works once, that the wrong account cannot use it,
 * that a manager cannot approve their own leadership grant, and that the
 * limits actually bite.
 *
 *   npm run test:db
 */
import pg from 'pg';
import { pool } from '../src/db.js';
import { MAX_PER_DAY_PER_EMAIL, MAX_OUTSTANDING_PER_ORG } from '../src/invitations.js';

const BASE = process.env.BASE || 'http://localhost:3000';

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};

const call = (path, opts = {}) => fetch(BASE + path, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

/* ---- cast ------------------------------------------------------------ */
const ORG = 'Invitations Test Org';
const { rows: orgRows } = await pool.query(
  `INSERT INTO organizations (name) VALUES ($1)
   ON CONFLICT (name) DO UPDATE SET updated_at = now() RETURNING id`, [ORG],
);
const orgId = orgRows[0].id;

async function person(email, role, hmac) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, email_hmac, role) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role RETURNING id`,
    [email, hmac, role],
  );
  const token = ('t' + hmac).padEnd(45, '0');
  await pool.query(
    `INSERT INTO self_sessions (token, email_hmac, expires_at)
     VALUES ($1, $2, now() + interval '1 hour') ON CONFLICT DO NOTHING`, [token, hmac],
  );
  return { id: rows[0].id, email, token };
}

const admin = await person('inv-admin@example.org', 'admin', 'invadminh');
const mgr = await person('inv-mgr@example.org', 'user', 'invmgrh');
const invitee = await person('inv-invitee@example.org', 'user', 'invinviteeh');
const other = await person('inv-other@example.org', 'user', 'invotherh');

await pool.query(
  `INSERT INTO organization_memberships (organization_id, user_id, role)
   VALUES ($1, $2, 'manager') ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'manager'`,
  [orgId, mgr.id],
);
// Start from a clean slate: this suite counts things.
await pool.query('DELETE FROM organization_invites WHERE organization_id = $1', [orgId]);
await pool.query("DELETE FROM organization_invite_sends WHERE email LIKE 'inv-%'");
await pool.query(
  'DELETE FROM organization_memberships WHERE organization_id = $1 AND user_id = ANY($2)',
  [orgId, [invitee.id, other.id]],
);

const as = (who) => (path, opts = {}) => call(path, {
  ...opts, headers: { Cookie: `session_token=${who.token}`, ...(opts.headers || {}) },
});
const asMgr = as(mgr); const asAdmin = as(admin);
const asInvitee = as(invitee); const asOther = as(other);
const anon = (path, opts) => call(path, opts);

const invite = (caller, email, role) => caller(`/api/orgs/${orgId}/invitations`,
  { method: 'POST', body: JSON.stringify({ email, role }) });
const tokenFor = async (email) => (await pool.query(
  'SELECT token FROM organization_invites WHERE organization_id = $1 AND email = $2',
  [orgId, email],
)).rows[0]?.token || null;

/* ---- the ceiling ----------------------------------------------------- */
console.log('\nthe role ceiling, at the new door');

for (const role of ['moderator', 'access_manager', 'admin', 'nonsense']) {
  const out = await invite(asMgr, `inv-${role}@example.org`, role);
  ok(`a manager cannot invite a ${role}`, out.status === 400, out.status + ' ' + JSON.stringify(out.body));
}

{
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM organization_invites WHERE organization_id = $1 AND role NOT IN ('manager','coordinator')",
    [orgId],
  );
  ok('and none of those attempts wrote a row', rows[0].n === 0, String(rows[0].n));
}

/* ---- a manager may invite coordinators ------------------------------- */
console.log('\nwhat a manager may do alone');

let out = await invite(asMgr, invitee.email, 'coordinator');
ok('a manager invites a coordinator without asking anybody', out.status === 200 && out.body?.ok,
  out.status + ' ' + JSON.stringify(out.body));
ok('and it is emailable immediately', !out.body?.awaitingApproval, JSON.stringify(out.body));

const link = await tokenFor(invitee.email);
ok('a token exists for the link', typeof link === 'string' && link.length >= 32, String(link));

/* ---- a manager may NOT mint another manager alone -------------------- */
console.log('\nwhat a manager may not do alone');

out = await invite(asMgr, other.email, 'manager');
ok('inviting another manager is accepted but held', out.status === 200 && out.body?.awaitingApproval === true,
  out.status + ' ' + JSON.stringify(out.body));
ok('and NOTHING is emailable yet — no token exists',
  (await tokenFor(other.email)) === null, String(await tokenFor(other.email)));

out = await asMgr(`/api/orgs/${orgId}/invitations/${other.email}/approve`, { method: 'POST' });
ok('a manager cannot approve their own leadership grant', out.status === 403, String(out.status));
ok('still no token', (await tokenFor(other.email)) === null, String(await tokenFor(other.email)));

out = await asAdmin(`/api/orgs/${orgId}/invitations/${other.email}/approve`, { method: 'POST' });
ok('an admin can', out.status === 200, out.status + ' ' + JSON.stringify(out.body));
ok('and only then does a token exist', typeof (await tokenFor(other.email)) === 'string');

/* ---- direct-add is closed to managers -------------------------------- */
console.log('\nthe door invitations replaced');

out = await asMgr(`/api/orgs/${orgId}/members`,
  { method: 'POST', body: JSON.stringify({ email: 'inv-sneak@example.org', role: 'coordinator' }) });
ok('a manager can no longer add somebody without their agreeing', out.status === 403, String(out.status));

out = await asAdmin(`/api/orgs/${orgId}/members`,
  { method: 'POST', body: JSON.stringify({ email: 'inv-boot@example.org', role: 'manager' }) });
ok('an admin still can, for bootstrapping a first manager', out.status === 201,
  out.status + ' ' + JSON.stringify(out.body));

/* ---- looking is not accepting ---------------------------------------- */
console.log('\nlooking is not accepting');

out = await anon(`/api/invitations/${link}`);
ok('anybody with the link can read what it offers', out.status === 200, String(out.status));
ok('and it names the organization, the role and who invited them',
  out.body?.organization === ORG && out.body?.role === 'coordinator' && out.body?.invitedBy === mgr.email,
  JSON.stringify(out.body));
ok('and what the role can and cannot do',
  (out.body?.permissions?.can || []).length > 0 && (out.body?.permissions?.cannot || []).length > 0,
  JSON.stringify(out.body?.permissions));

// A mail client prefetching the link must not join anybody to anything.
ok('looking twice changes nothing', (await anon(`/api/invitations/${link}`)).status === 200);
{
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
    [orgId, invitee.id],
  );
  ok('and nobody has been made a member by looking', rows[0].n === 0, String(rows[0].n));
}

/* ---- the link is a credential for ONE address ------------------------ */
console.log('\nwhose link it is');

out = await anon(`/api/invitations/${link}/accept`, { method: 'POST' });
ok('a signed-out caller cannot accept', out.status === 401, String(out.status));

out = await asOther(`/api/invitations/${link}/accept`, { method: 'POST' });
ok('and neither can somebody signed in as a different person', out.status === 403,
  out.status + ' ' + JSON.stringify(out.body));
ok('who is told which address it was for',
  /inv-invitee@example\.org/.test(out.body?.error || ''), out.body?.error);
ok('and the invitation survives being refused', (await tokenFor(invitee.email)) === link);

/* ---- accepting -------------------------------------------------------- */
console.log('\naccepting');

out = await asInvitee(`/api/invitations/${link}/accept`, { method: 'POST' });
ok('the invited person joins', out.status === 200 && out.body?.role === 'coordinator',
  out.status + ' ' + JSON.stringify(out.body));

{
  const { rows } = await pool.query(
    'SELECT role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
    [orgId, invitee.id],
  );
  ok('the membership is real', rows[0]?.role === 'coordinator', JSON.stringify(rows));
}

out = await asInvitee(`/api/invitations/${link}/accept`, { method: 'POST' });
ok('the link works exactly once', out.status === 404, String(out.status));

{
  const { rows } = await pool.query(
    `SELECT detail FROM role_audit WHERE subject_email = $1 AND organization_id = $2 ORDER BY id`,
    [invitee.email, orgId],
  );
  const details = rows.map((r) => r.detail).join(' | ');
  ok('the invitation and the acceptance are separate audit rows',
    /invited as coordinator/.test(details) && /accepted invitation/.test(details), details);
}

/* ---- the manager's view ---------------------------------------------- */
console.log('\nwhat the manager can see and do');

out = await asMgr(`/api/orgs/${orgId}/invitations`);
ok('a manager sees what is still waiting', out.status === 200, String(out.status));
ok('an accepted invitation has left the list',
  !(out.body?.invitations || []).some((i) => i.email === invitee.email),
  JSON.stringify((out.body?.invitations || []).map((i) => i.email)));

// The token is the credential. It has no business on a manager's screen.
ok('and no token is ever sent to the manager',
  !JSON.stringify(out.body).includes(link) && !(out.body?.invitations || []).some((i) => 'token' in i),
  Object.keys((out.body?.invitations || [])[0] || {}).join(', '));

const beforeResend = await tokenFor(other.email);
out = await asMgr(`/api/orgs/${orgId}/invitations/${other.email}/resend`, { method: 'POST' });
ok('resending works', out.status === 200, out.status + ' ' + JSON.stringify(out.body));
const afterResend = await tokenFor(other.email);
// Otherwise an invitation resent because the first went to the wrong
// address leaves the wrong address holding a live credential.
ok('and rotates the token, killing the old link', beforeResend !== afterResend,
  `${beforeResend} vs ${afterResend}`);
ok('the old link is dead', (await anon(`/api/invitations/${beforeResend}`)).status === 404);

/* ---- limits ----------------------------------------------------------- */
console.log('\nthe limits that stop this being a mail cannon');

// other@ has had: the approval send, and the resend. That is the cap.
out = await asMgr(`/api/orgs/${orgId}/invitations/${other.email}/resend`, { method: 'POST' });
ok(`no more than ${MAX_PER_DAY_PER_EMAIL} sends a day to one address`, out.status === 400,
  out.status + ' ' + JSON.stringify(out.body));

out = await asMgr(`/api/orgs/${orgId}/invitations/${other.email}`, { method: 'DELETE' });
ok('withdrawing works', out.status === 200 && out.body?.revoked === 1, JSON.stringify(out.body));
ok('and the invitation is gone', (await tokenFor(other.email)) === null);

ok(`the outstanding cap is ${MAX_OUTSTANDING_PER_ORG}`, MAX_OUTSTANDING_PER_ORG === 50,
  String(MAX_OUTSTANDING_PER_ORG));

// Fill to the cap directly, then prove the next one is refused.
await pool.query('DELETE FROM organization_invites WHERE organization_id = $1', [orgId]);
await pool.query(
  `INSERT INTO organization_invites (organization_id, email, role, invited_by, token, expires_at, status)
   SELECT $1, 'inv-bulk-' || g || '@example.org', 'coordinator', $2, 'tok-bulk-' || g,
          now() + interval '7 days', 'pending'
     FROM generate_series(1, $3) g`,
  [orgId, mgr.email, MAX_OUTSTANDING_PER_ORG],
);
out = await invite(asMgr, 'inv-one-too-many@example.org', 'coordinator');
ok('an organization at the cap cannot invite anybody else', out.status === 400,
  out.status + ' ' + JSON.stringify(out.body));

// An expired invitation is not outstanding: otherwise an organization
// slowly locks itself out of inviting anybody at all.
await pool.query(
  "UPDATE organization_invites SET expires_at = now() - interval '1 day' WHERE organization_id = $1",
  [orgId],
);
out = await invite(asMgr, 'inv-after-expiry@example.org', 'coordinator');
ok('but expired ones do not count against the cap forever', out.status === 200,
  out.status + ' ' + JSON.stringify(out.body));

/* ---- tidy up ---------------------------------------------------------- */
await pool.query('DELETE FROM organization_invites WHERE organization_id = $1', [orgId]);
await pool.query("DELETE FROM organization_invite_sends WHERE email LIKE 'inv-%'");

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
