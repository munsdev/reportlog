/**
 * Who may grant what, and the record of every time someone did.
 *
 * Granting is funnelled through this module rather than done inline in
 * routes, for one reason: the audit row and the change must be impossible
 * to separate. A route that can update a role directly is a route that can
 * forget to write the trail, and the trail is only worth anything if it is
 * complete. Both happen in one transaction here or neither happens.
 */
import { pool } from './db.js';
import { roleSatisfies } from './roleRank.js';
import { normalizeDesks } from './desks.js';
import { normalizeEmail, hmacEmail } from './crypto.js';

export const SYSTEM_ROLES = ['user', 'moderator', 'access_manager', 'admin', 'owner'];
export const ORG_ROLES = ['manager', 'coordinator'];

/**
 * Which system roles each system role may hand out.
 *
 * The load-bearing line is Access Manager's: it can make Moderators and it
 * cannot make Access Managers — not even by demoting and re-granting,
 * because the value simply is not in its list. That is what stops the role
 * replicating. If Access Managers could mint each other, one grant would
 * eventually become every grant, and the ceiling this design depends on
 * would be gone. It is asserted here, tested in selftest, and checked again
 * at the route.
 */
export const MAY_GRANT = {
  // The owner is the only role that can make or unmake an administrator.
  // Nothing else in the application could, before or after this — 'admin'
  // was in no row at all, including admin's own, so this CREATES the power
  // rather than moving it.
  owner: ['user', 'moderator', 'access_manager', 'admin'],
  admin: ['user', 'moderator', 'access_manager'],
  access_manager: ['user', 'moderator'],
  moderator: [],
  user: [],
};

/**
 * THE SEAT IS UNGRANTABLE. 'owner' appears in no row above, its own
 * included, so `setSystemRole` cannot produce an owner by any argument.
 * The seat moves only by the handoff in `src/ownership.js` or by the setup
 * wizard minting the first one.
 *
 * This is the same trick the Access Manager ceiling uses one rung down, and
 * it is what stops a new rank above admin from reopening the problem that
 * ceiling exists to prevent: if the top role could hand itself out, one
 * grant would eventually become every grant. `scripts/selftest.js` asserts
 * no row contains it, so a later well-meaning edit cannot make the seat
 * grantable without turning the suite red — which is why the table above is
 * exported: a test that reads the real thing cannot drift from it, and a
 * test that restated it would be asserting its own copy.
 */

export function canGrantSystemRole(actorRole, targetRole) {
  return (MAY_GRANT[actorRole] || []).includes(targetRole);
}

/**
 * Who may change somebody who already holds a role.
 *
 * THE OWNER IS UNTOUCHABLE through this path, by anybody including
 * themselves. Handing the seat on is a two-party act in `src/ownership.js`,
 * not a role edit, because a one-sided transfer to a wrong address is the
 * one move here that cannot be undone.
 *
 * ADMIN USED TO BE UNTOUCHABLE TOO, and the comment here said why: an
 * Access Manager who could demote an admin could decapitate the system, and
 * an admin who did it to the last admin locked everyone out of their own
 * project. The first half still holds and is why this is owner-only. The
 * second half DISSOLVES under an owner: they can always mint another
 * administrator, so there is no last-admin lockout to protect against any
 * more. That is the strongest evidence the ladder is the right shape.
 */
export function canChangeSubject(actorRole, subjectRole) {
  if (subjectRole === 'owner') return false;
  if (subjectRole === 'admin') return actorRole === 'owner';
  if (subjectRole === 'access_manager') return roleSatisfies(actorRole, 'admin');
  return true;
}

export async function recordRoleChange(client, {
  actorEmail, subjectEmail, axis, action, detail, organizationId = null,
}) {
  await client.query(
    `INSERT INTO role_audit (actor_email, subject_email, axis, action, detail, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorEmail, subjectEmail, axis, action, detail, organizationId],
  );
}

/**
 * Set someone's system role, and say so in the audit trail.
 *
 * The account is created if the address has never signed in. That is
 * deliberate and predates this module: pre-authorising by email means a
 * moderator can be appointed before they have ever logged in, and the
 * upsert in auth.js preserves the role rather than resetting it.
 *
 * Returns {ok:false, reason} rather than throwing for the two refusals a
 * caller is expected to hit, because both are ordinary answers to a
 * legitimate request and the route turns them into a 403 with a sentence
 * the person can read.
 */
export async function setSystemRole({ actor, email, role }) {
  const subjectEmail = normalizeEmail(email);
  if (!SYSTEM_ROLES.includes(role)) return { ok: false, reason: 'unknown-role' };
  if (!canGrantSystemRole(actor.role, role)) return { ok: false, reason: 'not-permitted' };
  if (subjectEmail === normalizeEmail(actor.email) && role !== actor.role) {
    // Changing your own role is how someone either locks themselves out or
    // promotes themselves; neither should be possible by accident.
    return { ok: false, reason: 'self' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT role FROM users WHERE email = $1 FOR UPDATE', [subjectEmail],
    );
    const current = rows[0]?.role || 'user';
    if (!canChangeSubject(actor.role, current)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'protected-subject' };
    }
    if (current === role) {
      await client.query('ROLLBACK');
      return { ok: true, unchanged: true };
    }

    await client.query(
      `INSERT INTO users (email, email_hmac, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, updated_at = now()`,
      [subjectEmail, hmacEmail(subjectEmail), role],
    );

    // Both directions, always. "Revoked moderator, granted user" reads as
    // two halves of one change and answers a different question from a
    // single line saying the end state.
    if (current !== 'user') {
      await recordRoleChange(client, {
        actorEmail: actor.email, subjectEmail, axis: 'system', action: 'revoke', detail: current,
      });
    }
    if (role !== 'user') {
      await recordRoleChange(client, {
        actorEmail: actor.email, subjectEmail, axis: 'system', action: 'grant', detail: role,
      });
    }

    await client.query('COMMIT');
    return { ok: true, from: current, to: role };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The tester flag. Not a role: it composes with whatever someone already
 * holds, and it grants no access to any report — only to the bug form and
 * the issues list. Admin and Access Manager both manage it, which fits the
 * Access Manager remit exactly: granting and revoking access, nothing else.
 */
export async function setTesterFlag({ actor, email, isTester }) {
  const subjectEmail = normalizeEmail(email);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (email, email_hmac, is_tester)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET is_tester = EXCLUDED.is_tester, updated_at = now()`,
      [subjectEmail, hmacEmail(subjectEmail), Boolean(isTester)],
    );
    await recordRoleChange(client, {
      actorEmail: actor.email,
      subjectEmail,
      axis: 'flag',
      action: isTester ? 'grant' : 'revoke',
      detail: 'tester',
    });
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The team-member flag, and the desks beside it.
 *
 * MODELLED ON setTesterFlag ABOVE, deliberately and to the letter: same
 * shape, same two granters, same audit row. It is a FLAG and not a role
 * because the role ceiling is a load-bearing invariant with tests behind it
 * and a second check at the route, and every new grantable role is a new
 * way to get that wrong. This composes with whatever system role somebody
 * already holds and grants access to NO REPORT — it opens the staff portal
 * and nothing else.
 *
 * Desks are display only: they decide which portal tab opens first. They
 * are set in the same call because they are set by the same person at the
 * same moment, and a second route would be a second audit trail for one
 * act. Unknown desk ids are dropped rather than refused — a desk is not a
 * permission, and failing somebody's whole update because a list changed
 * under them would be the wrong trade.
 */
export async function setTeamMemberFlag({ actor, email, isTeamMember, desks }) {
  const subjectEmail = normalizeEmail(email);
  const on = Boolean(isTeamMember);
  // Somebody who is not on the team holds no desks. Leaving them behind
  // would mean a revoked person quietly keeping a job title.
  const clean = on ? normalizeDesks(desks) : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (email, email_hmac, is_team_member, desks)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET is_team_member = EXCLUDED.is_team_member,
         desks = EXCLUDED.desks, updated_at = now()`,
      [subjectEmail, hmacEmail(subjectEmail), on, clean],
    );
    await recordRoleChange(client, {
      actorEmail: actor.email,
      subjectEmail,
      axis: 'flag',
      action: on ? 'grant' : 'revoke',
      // The desks are in the detail so the audit says what was actually
      // granted, not merely that something was.
      detail: clean.length ? `team member: ${clean.join(', ')}` : 'team member',
    });
    await client.query('COMMIT');
    return { ok: true, desks: clean };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Every organization this person belongs to, with the role they hold. */
export async function membershipsFor(userId, client = pool) {
  const { rows } = await client.query(
    `SELECT m.organization_id, m.role, o.name
     FROM organization_memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = $1
     ORDER BY o.name`,
    [userId],
  );
  return rows;
}

export async function isManagerOf(userId, organizationId, client = pool) {
  const { rows } = await client.query(
    `SELECT 1 FROM organization_memberships
     WHERE user_id = $1 AND organization_id = $2 AND role = 'manager'`,
    [userId, organizationId],
  );
  return rows.length > 0;
}

export async function isCoordinatorOf(userId, organizationId, client = pool) {
  const { rows } = await client.query(
    `SELECT 1 FROM organization_memberships
     WHERE user_id = $1 AND organization_id = $2 AND role = 'coordinator'`,
    [userId, organizationId],
  );
  return rows.length > 0;
}
