/**
 * Organizations, their people, and the rules that keep them contained.
 *
 * Three constraints run through everything below, and each exists because
 * of a specific failure rather than tidiness:
 *
 *   Managers cannot promote Managers. Only Admin or Access Manager does
 *   that. Otherwise a compromised Manager account entrenches itself, and
 *   the containment the two-axis design provides is gone.
 *
 *   An organization always has at least one Manager. A removal that would
 *   empty it is refused — an organization nobody can administer needs an
 *   admin to rescue it, which is exactly the work delegation was meant to
 *   avoid.
 *
 *   Removal is forward-looking only. A coordinator removed from an
 *   organization keeps every submission already attributed to it. A
 *   departure must never retroactively strip provenance from records in
 *   the public log — that would be an edit to the record, made by leaving.
 */
import { pool } from './db.js';
import { normalizeEmail } from './crypto.js';
import { recordRoleChange, ORG_ROLES } from './roles.js';

export async function listOrganizations(client = pool) {
  const { rows } = await client.query(
    `SELECT o.id, o.name, o.logo_key, o.details, o.verified_by, o.verified_at, o.created_at,
            count(*) FILTER (WHERE m.role = 'manager')     AS manager_count,
            count(*) FILTER (WHERE m.role = 'coordinator') AS coordinator_count,
            (SELECT count(*) FROM reports r WHERE r.organization_id = o.id) AS report_count
     FROM organizations o
     LEFT JOIN organization_memberships m ON m.organization_id = o.id
     GROUP BY o.id
     ORDER BY o.name`,
  );
  return rows;
}

export async function createOrganization({ actor, name, details, managerEmails }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { ok: false, reason: 'name-required' };
  const emails = (managerEmails || []).map(normalizeEmail).filter(Boolean);
  if (!emails.length) return { ok: false, reason: 'manager-required' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO organizations (name, details, verified_by, verified_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (name) DO NOTHING
       RETURNING id, name`,
      [trimmed, details || null, actor.email],
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'name-taken' };
    }
    const org = rows[0];
    for (const email of emails) {
      await attachOrInvite(client, {
        actor, organizationId: org.id, organizationName: org.name, email, role: 'manager',
      });
    }
    await client.query('COMMIT');
    return { ok: true, organization: org };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Everything is keyed on email address, so an invitation has two cases and
 * both have to work: the address already has an account, in which case the
 * membership attaches now; or it does not, in which case a pending invite
 * waits and attaches on signup.
 */
async function attachOrInvite(client, { actor, organizationId, organizationName, email, role }) {
  const { rows } = await client.query('SELECT id FROM users WHERE email = $1', [email]);
  if (rows.length) {
    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [organizationId, rows[0].id, role],
    );
    await client.query(
      'DELETE FROM organization_invites WHERE organization_id = $1 AND email = $2',
      [organizationId, email],
    );
  } else {
    await client.query(
      `INSERT INTO organization_invites (organization_id, email, role, invited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, email) DO UPDATE SET role = EXCLUDED.role`,
      [organizationId, email, role, actor.email],
    );
  }
  await recordRoleChange(client, {
    actorEmail: actor.email,
    subjectEmail: email,
    axis: 'organization',
    action: 'grant',
    detail: `${role} of ${organizationName}`,
    organizationId,
  });
  return { pending: rows.length === 0 };
}

/**
 * Add someone to an organization.
 *
 * `actorIsManager` says the caller reached this as an Organization Manager
 * rather than as Admin or Access Manager, and it is the only thing
 * standing between a Manager and a self-entrenching account. A Manager may
 * add coordinators and nothing else.
 */
export async function addMember({
  actor, actorIsManager, organizationId, email, role,
}) {
  if (!ORG_ROLES.includes(role)) return { ok: false, reason: 'unknown-role' };
  if (actorIsManager && role === 'manager') return { ok: false, reason: 'manager-cannot-promote' };

  const address = normalizeEmail(email);
  if (!address) return { ok: false, reason: 'email-required' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT name FROM organizations WHERE id = $1', [organizationId],
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'no-such-organization' };
    }
    const out = await attachOrInvite(client, {
      actor, organizationId, organizationName: rows[0].name, email: address, role,
    });
    await client.query('COMMIT');
    return { ok: true, pending: out.pending };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function removeMember({ actor, actorIsManager, organizationId, email }) {
  const address = normalizeEmail(email);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // A pending invite is not a membership — revoking one is just tidying
    // up, and it must not be mistaken for removing an active person.
    const { rowCount: invites } = await client.query(
      'DELETE FROM organization_invites WHERE organization_id = $1 AND email = $2',
      [organizationId, address],
    );

    const { rows } = await client.query(
      `SELECT m.id, m.role, o.name
       FROM organization_memberships m
       JOIN organizations o ON o.id = m.organization_id
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND u.email = $2
       FOR UPDATE OF m`,
      [organizationId, address],
    );

    if (!rows.length) {
      await client.query('COMMIT');
      return invites ? { ok: true, revokedInvite: true } : { ok: false, reason: 'not-a-member' };
    }

    const member = rows[0];
    if (actorIsManager && member.role === 'manager') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'manager-cannot-remove-manager' };
    }

    if (member.role === 'manager') {
      const { rows: left } = await client.query(
        `SELECT count(*)::int AS n FROM organization_memberships
         WHERE organization_id = $1 AND role = 'manager' AND id <> $2`,
        [organizationId, member.id],
      );
      if (left[0].n === 0) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'last-manager' };
      }
    }

    await client.query('DELETE FROM organization_memberships WHERE id = $1', [member.id]);
    await recordRoleChange(client, {
      actorEmail: actor.email,
      subjectEmail: address,
      axis: 'organization',
      action: 'revoke',
      detail: `${member.role} of ${member.name}`,
      organizationId,
    });
    await client.query('COMMIT');
    // Said out loud because it is the surprising half of the rule: the
    // person is gone and everything they filed is still attributed.
    return { ok: true, submissionsKept: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function membersOf(organizationId, client = pool) {
  const { rows } = await client.query(
    `SELECT u.email, m.role, m.joined_at, false AS pending
     FROM organization_memberships m JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = $1
     UNION ALL
     SELECT i.email, i.role, i.created_at AS joined_at, true AS pending
     FROM organization_invites i
     WHERE i.organization_id = $1
     ORDER BY pending, role, email`,
    [organizationId],
  );
  return rows;
}

/**
 * Attach any invitations waiting for this address. Called at sign-in, so
 * an invited person is a member the first time they arrive rather than
 * needing someone to add them a second time.
 */
/**
 * Attach invitations that were created before invitations were links.
 *
 * ONLY those. A row with a token is an invitation somebody has to accept by
 * clicking, and attaching it here would defeat the whole point — the person
 * would be in the organization because they signed in, which is exactly the
 * silent membership this was changed to stop.
 *
 * Legacy rows keep the old behaviour deliberately: they are in inboxes and
 * in databases already, they were issued under the old rules, and changing
 * what happens to them retroactively would strand the people holding them.
 */
export async function claimInvites(userId, email, client = pool) {
  const address = normalizeEmail(email);
  const { rows } = await client.query(
    'SELECT organization_id, role FROM organization_invites WHERE email = $1 AND token IS NULL',
    [address],
  );
  for (const invite of rows) {
    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [invite.organization_id, userId, invite.role],
    );
  }
  if (rows.length) {
    await client.query(
      'DELETE FROM organization_invites WHERE email = $1 AND token IS NULL', [address],
    );
  }
  return rows.length;
}

export async function setOrganizationDetails({
  actor, organizationId, details, logoKey, isAdminOverride,
}) {
  const sets = [];
  const params = [];
  if (typeof details === 'string') { params.push(details); sets.push(`details = $${params.length}`); }
  if (typeof logoKey === 'string') { params.push(logoKey); sets.push(`logo_key = $${params.length}`); }
  if (!sets.length) return { ok: true, unchanged: true };
  params.push(organizationId);
  await pool.query(
    `UPDATE organizations SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
    params,
  );
  if (isAdminOverride) {
    // An admin replacing a logo is a moderation action against an
    // organization, not routine editing, so it is on the record.
    const client = await pool.connect();
    try {
      await recordRoleChange(client, {
        actorEmail: actor.email,
        subjectEmail: actor.email,
        axis: 'organization',
        action: 'grant',
        detail: 'admin replaced organization presentation',
        organizationId,
      });
    } finally { client.release(); }
  }
  return { ok: true };
}
