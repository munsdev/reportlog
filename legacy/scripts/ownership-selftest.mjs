/**
 * The owner's seat: the things that only a real database can prove.
 *
 * The unit suite checks the tables — who may grant what, who may change
 * whom. None of that touches Postgres. What needs a database is the part
 * where the rules are enforced by the schema rather than by JavaScript:
 * that a second owner is impossible, that the handover is atomic, and that
 * the audit trail cannot be separated from the change.
 *
 *   createdb ownertest
 *   DATABASE_URL=postgres://…/ownertest node scripts/migrate.js
 *   DATABASE_URL=postgres://…/ownertest \
 *   CONTACT_HMAC_KEY=$(openssl rand -base64 32) \
 *   TIER_B_ENCRYPTION_KEY=$(openssl rand -base64 32) \
 *     node scripts/ownership-selftest.mjs
 *
 * Never point it at a database with real reports in it: it writes.
 */
import 'dotenv/config';
const { pool } = await import('../src/db.js');
const R = await import('../src/roles.js');
const OWN = await import('../src/ownership.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

const seat = async () => (await pool.query("SELECT email FROM users WHERE role='owner'")).rows.map((r) => r.email);
const roleOf = async (e) => (await pool.query('SELECT role FROM users WHERE email=$1', [e])).rows[0]?.role;

// A clean slate for this file only: these five addresses, nothing else.
const EMAILS = ['own@example.org', 'heir@example.org', 'adm@example.org',
  'other@example.org', 'ghost@example.org'];
await pool.query('DELETE FROM ownership_transfers');
await pool.query('UPDATE users SET role = $2 WHERE email = ANY($1)', [EMAILS, 'user']);
for (const e of EMAILS) {
  await pool.query(`INSERT INTO users (email,email_hmac,role) VALUES ($1,$2,'user')
    ON CONFLICT (email) DO UPDATE SET role='user'`, [e, Buffer.from('h_' + e)]);
}
// Take the seat directly; it is ungrantable through setSystemRole by design.
await pool.query("UPDATE users SET role='owner' WHERE email='own@example.org'");
const owner = { email: 'own@example.org', role: 'owner' };
const admin = { email: 'adm@example.org', role: 'admin' };

console.log('\nthe seat is singular');
let threw = null;
try {
  await pool.query(`INSERT INTO users (email,email_hmac,role) VALUES ('second@example.org',$1,'owner')`,
    [Buffer.from('h_second')]);
} catch (e) { threw = e; }
ok('the database refuses a second owner', !!threw && /users_single_owner_idx/.test(threw.message), threw?.message);
ok('and there is still exactly one', (await seat()).length === 1);

console.log('\nthe seat cannot be granted');
let r = await R.setSystemRole({ actor: owner, email: 'heir@example.org', role: 'owner' });
ok('not even by the owner, through setSystemRole', !r.ok && r.reason === 'not-permitted');
ok('and the would-be heir is unchanged', (await roleOf('heir@example.org')) === 'user');

console.log('\nonly the owner makes an admin');
r = await R.setSystemRole({ actor: owner, email: 'adm@example.org', role: 'admin' });
ok('the owner appoints an administrator', r.ok);
ok('and it took effect', (await roleOf('adm@example.org')) === 'admin');
r = await R.setSystemRole({ actor: admin, email: 'other@example.org', role: 'admin' });
ok('an admin cannot appoint another admin', !r.ok && r.reason === 'not-permitted');

console.log('\nremoving an admin lands them wherever the owner chooses');
r = await R.setSystemRole({ actor: owner, email: 'adm@example.org', role: 'moderator' });
ok('the owner demotes an admin to moderator, not to nothing', r.ok);
ok('and they are a moderator', (await roleOf('adm@example.org')) === 'moderator');
await R.setSystemRole({ actor: owner, email: 'adm@example.org', role: 'admin' });

console.log('\nthe owner is untouchable through the role path');
r = await R.setSystemRole({ actor: admin, email: 'own@example.org', role: 'user' });
ok('an admin cannot demote the owner', !r.ok && r.reason === 'protected-subject');
ok('the owner still holds the seat', (await roleOf('own@example.org')) === 'owner');

console.log('\nthe handover needs both parties');
r = await OWN.proposeTransfer({ actor: admin, email: 'heir@example.org' });
ok('an admin cannot offer the seat', !r.ok && r.reason === 'not-owner');
r = await OWN.proposeTransfer({ actor: owner, email: 'own@example.org' });
ok('the owner cannot hand it to themselves', !r.ok && r.reason === 'self');

r = await OWN.proposeTransfer({ actor: owner, email: 'heir@example.org' });
ok('the owner offers it', r.ok);
ok('NOTHING has moved yet', (await roleOf('own@example.org')) === 'owner'
  && (await roleOf('heir@example.org')) === 'user');

r = await OWN.acceptTransfer({ actor: { email: 'other@example.org' } });
ok('somebody else cannot accept it', !r.ok && r.reason === 'not-yours');
ok('and it is still pending', !!(await OWN.pendingTransfer()));

r = await OWN.acceptTransfer({ actor: { email: 'heir@example.org' } });
ok('the person it was offered to accepts', r.ok);
ok('the seat moved', (await roleOf('heir@example.org')) === 'owner');
ok('the outgoing owner is an admin, not a user', (await roleOf('own@example.org')) === 'admin');
ok('there is still exactly one owner', (await seat()).length === 1);
ok('the proposal is gone', !(await OWN.pendingTransfer()));

console.log('\nthe handover is in the trail');
const trail = (await pool.query(
  "SELECT subject_email, action, detail FROM role_audit WHERE axis='owner' ORDER BY id",
)).rows;
ok('both halves were written', trail.length === 2, JSON.stringify(trail));
ok('the outgoing owner was revoked', trail.some((t) => t.subject_email === 'own@example.org' && t.action === 'revoke'));
ok('the incoming owner was granted', trail.some((t) => t.subject_email === 'heir@example.org' && t.action === 'grant'));

console.log('\nan expired offer is not a live claim');
const heir = { email: 'heir@example.org', role: 'owner' };
await OWN.proposeTransfer({ actor: heir, email: 'ghost@example.org' });
await pool.query("UPDATE ownership_transfers SET expires_at = now() - interval '1 day'");
ok('an expired proposal does not read as pending', !(await OWN.pendingTransfer()));
r = await OWN.acceptTransfer({ actor: { email: 'ghost@example.org' } });
ok('and it cannot be accepted', !r.ok && r.reason === 'expired');
ok('the seat did not move', (await roleOf('heir@example.org')) === 'owner'
  && (await roleOf('ghost@example.org')) === 'user');

console.log('\ncancelling');
await OWN.proposeTransfer({ actor: heir, email: 'ghost@example.org' });
ok('there is a proposal to cancel', !!(await OWN.pendingTransfer()));
r = await OWN.cancelTransfer({ actor: admin });
ok('an admin cannot cancel it', !r.ok && r.reason === 'not-owner');
r = await OWN.cancelTransfer({ actor: heir });
ok('the owner can', r.ok && !(await OWN.pendingTransfer()));

console.log('\nan unlocated, undated report behaves');
// THE POINT: these are Postgres semantics, not JavaScript ones, and they
// are the difference between a report that is merely unusual and one that
// silently does not exist. NULL is not false, and every filter in this
// application had to learn that.
const nullish = async (sql, args = []) => (await pool.query(sql, args)).rows[0];

ok('a NULL location passes the states CHECK, so the row can be stored',
  (await nullish("SELECT (cardinality(NULL::text[]) >= 1) IS NULL AS ok")).ok === true);
ok('but an EMPTY location is still rejected, so NULL means exactly "not asked"',
  (await nullish("SELECT (cardinality(ARRAY[]::text[]) >= 1) = false AS ok")).ok === true);

ok('text_of(NULL) is the empty string, not NULL',
  (await nullish("SELECT text_of(NULL) = '' AS ok")).ok === true);
ok('so a report with no location still produces a searchable index entry',
  (await nullish(`SELECT to_tsvector('english',
       coalesce('a narrative','') || ' ' || text_of(NULL) || ' ' || text_of(NULL))
     @@ plainto_tsquery('english','narrative') AS ok`)).ok === true);

ok('a bare overlap DROPS an unlocated report — the bug that was fixed',
  (await nullish("SELECT (NULL::text[] && ARRAY['OH']) IS NULL AS ok")).ok === true);
ok('and the guarded form lets it through to every subscriber',
  (await nullish(`SELECT (ARRAY['OH']::text[] IS NULL OR NULL::text[] IS NULL
       OR ARRAY['OH'] && NULL::text[]) AS ok`)).ok === true);

ok('a bare date range DROPS an undated report',
  (await nullish("SELECT (NULL::date >= '2026-01-01'::date) IS NULL AS ok")).ok === true);
ok('and the queue form keeps it visible for triage',
  (await nullish(`SELECT (NULL::date IS NULL OR NULL::date >= '2026-01-01'::date) AS ok`)).ok === true);

// Put the seat back down. The scratch database is shared with every other
// selftest in the run, and setup-selftest needs a deployment that looks
// untouched — an owner left behind makes its wizard return 409 and twenty
/* ---- the handover code is bound to the recipient ---------------------- */
// WHY THIS IS HERE AND NOT IN THE UNIT SUITE: it is the otp_codes table doing
// the work. The code is stored under a subject mixing the owner's address and
// the recipient's, so a code minted to hand the seat to one person cannot be
// spent handing it to another.
//
// That is what makes the email the owner receives a RECORD rather than a
// courtesy. It names where the seat is going, and this is the reason the seat
// cannot then go somewhere else on the same code.
console.log('\nthe handover code is bound to the address it was asked for');
{
  const OTP = await import('../src/otp.js');
  const owner = 'own@example.org';
  const intended = 'heir@example.org';
  const somebodyElse = 'other@example.org';

  const code = await OTP.createCode(OWN.handoverCodeSubject(owner, intended));

  // The wrong recipient first, because verifyCode SPENDS a code on success and
  // checking the good case first would leave nothing to fail with.
  ok('a code minted for one address does not verify for another',
    (await OTP.verifyCode(OWN.handoverCodeSubject(owner, somebodyElse), code)) === false);
  // And not merely because the subject differs in some way: the same code, the
  // same recipient, a different owner is also no.
  ok('nor for a different owner handing it to the same person',
    (await OTP.verifyCode(OWN.handoverCodeSubject(somebodyElse, intended), code)) === false);
  ok('and it does verify for the pair it was minted for',
    (await OTP.verifyCode(OWN.handoverCodeSubject(owner, intended), code)) === true);
  // Spent, so a code cannot be replayed to offer the seat twice.
  ok('and is spent once used',
    (await OTP.verifyCode(OWN.handoverCodeSubject(owner, intended), code)) === false);

  // Case and spacing must not make two subjects out of one pair, or a code
  // would fail for somebody who typed the same address with a capital letter.
  const c2 = await OTP.createCode(OWN.handoverCodeSubject(owner, intended));
  ok('the address is normalized, so capitals and spaces are the same pair',
    (await OTP.verifyCode(OWN.handoverCodeSubject(' OWN@Example.org ', 'Heir@EXAMPLE.org'), c2)) === true);
}

console.log('\nand it cannot be emptied, which is the state §8 asked about');
/* An instance has only one owner, and the seat is above
   admin. The unique index enforces NEVER TWO and says nothing about NEVER
   NONE — so an ownerless deployment is the thing to rule out, not resolve.

   Every route to zero, tried against the real tables. */
{
  // Re-seat, since the handover above moved it to the heir.
  await pool.query("UPDATE users SET role='user' WHERE role='owner'");
  await pool.query("UPDATE users SET role='owner' WHERE email='own@example.org'");
  const theOwner = { email: 'own@example.org', role: 'owner' };

  // 1 · Nobody demotes the owner, including the owner.
  let out = await R.setSystemRole({ actor: theOwner, email: 'own@example.org', role: 'admin' });
  ok('the owner cannot demote themselves', out.ok === false, out.reason);
  out = await R.setSystemRole({
    actor: { email: 'adm@example.org', role: 'admin' }, email: 'own@example.org', role: 'user',
  });
  ok('and an admin certainly cannot', out.ok === false && out.reason === 'protected-subject', out.reason);
  ok('so the seat is still filled', (await seat()).length === 1);

  // 2 · Nobody demotes them to 'user' either — the route that would leave
  //     the deployment with admins and no owner.
  out = await R.setSystemRole({ actor: theOwner, email: 'own@example.org', role: 'user' });
  ok('NOR TO user, which is the ownerless state', out.ok === false, out.reason);
  ok('and the seat survived that too', (await seat()).length === 1);

  // 3 · An expired transfer leaves the seat where it was rather than in
  //     limbo. A half-finished handover is the other way to reach zero.
  await OWN.proposeTransfer({ actor: theOwner, email: 'heir@example.org' });
  await pool.query("UPDATE ownership_transfers SET expires_at = now() - interval '1 day'");
  out = await OWN.acceptTransfer({ actor: { email: 'heir@example.org' } });
  ok('an expired offer cannot be accepted', out.ok === false && out.reason === 'expired', out.reason);
  ok('AND THE OUTGOING OWNER STILL HOLDS IT', (await roleOf('own@example.org')) === 'owner');
  ok('with exactly one seat filled', (await seat()).length === 1);

  // 4 · A cancelled transfer, same question.
  await OWN.proposeTransfer({ actor: theOwner, email: 'heir@example.org' });
  await OWN.cancelTransfer({ actor: theOwner });
  ok('a cancelled offer leaves the seat alone', (await roleOf('own@example.org')) === 'owner'
    && (await seat()).length === 1);

  // 5 · And the handover itself never passes through zero. Observed from
  //     OUTSIDE the transaction: it holds a table lock and does both halves
  //     in one commit, so no reader can ever see an empty seat.
  await OWN.proposeTransfer({ actor: theOwner, email: 'heir@example.org' });
  const moved = await OWN.acceptTransfer({ actor: { email: 'heir@example.org' } });
  ok('the handover completes', moved.ok === true);
  ok('exactly one owner afterwards, never zero and never two', (await seat()).length === 1);
  ok('and the outgoing owner is an admin rather than nothing',
    (await roleOf('own@example.org')) === 'admin');
}

// eight checks fail naming the wrong cause. Tidying up after yourself is
// not optional when the fixture is shared.
await pool.query('DELETE FROM ownership_transfers');
await pool.query("UPDATE users SET role = 'user' WHERE role IN ('owner', 'admin')");

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
