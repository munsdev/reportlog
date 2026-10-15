/**
 * Organization invitations.
 *
 * This is a permission system, and it is a NEW DOOR INTO ROLE GRANTING. The
 * role ceiling in src/roles.js exists because a role that can mint itself
 * eventually becomes every role, and a second door that skips the check is
 * exactly how a ceiling leaks — quietly, because nothing looks wrong until
 * somebody audits it. So:
 *
 *   An organization manager may hand out ORG_ROLES and nothing else. Never
 *   `moderator`, never `access_manager`, never `admin`. Checked here, and
 *   again at the route.
 *
 * Inviting a COORDINATOR is a manager's own business — the whole point of
 * the role is that the maintainer is not the bottleneck for every volunteer, and an
 * organization role grants nothing outside that organization. Inviting
 * another MANAGER is a leadership grant and waits for an admin. Such an
 * invitation is created `awaiting_approval` and no email is sent until it is
 * approved, because an approval that arrives after the person has been told
 * they are invited is not an approval of anything.
 *
 * There is NO DECLINE BUTTON, deliberately — "ignore it if you didn't
 * request this" is enough, and a decline button on an unsolicited email
 * reads as scammy. Two things follow from that and both are required:
 * silence is now the only signal an invitee gives, so the manager gets a
 * list showing what is still unaccepted with resend and revoke, and only
 * ACCEPTED invitations count toward the Alliance member count.
 *
 * The flow follows volunteer.js rather than inventing a third shape: a
 * token row, an emailed link, and a `DELETE ... RETURNING` on acceptance so
 * a mail client prefetching the link cannot act twice.
 */
import crypto from 'node:crypto';
import { pool } from './db.js';
import { normalizeEmail, looksLikeEmail } from './crypto.js';
import { ORG_ROLES, recordRoleChange } from './roles.js';

// Seven days. Long enough that somebody who reads email in the evening, or
// over a weekend, is not locked out by an expiry they never saw.
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Every one of these was chosen deliberately; see the spec. They are not
// tuning knobs and loosening them has consequences outside this module.
export const MAX_OUTSTANDING_PER_ORG = 50;
export const MAX_PER_DAY_PER_EMAIL = 2;

// The ledger only exists to answer "how many today", so a fortnight is
// generous. Swept on write, like volunteer_requests, because a sweep on a
// timer is a thing that can be silently not running.
const SEND_LOG_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * What each role can do, in the words the invitee reads before accepting.
 *
 * Nobody should discover, after clicking a link in an email, that they can
 * now see restricted material. This is the text on the accept screen and it
 * lives here, beside the check that enforces the role, so the description
 * and the grant cannot drift apart.
 */
export const ROLE_DESCRIPTIONS = {
  coordinator: {
    label: 'Coordinator',
    can: [
      'File reports under this organization’s name, including in batches from paper.',
      'See the reports they have filed for it.',
    ],
    cannot: [
      'Add or remove anybody.',
      'Change how the organization appears, or whether it is listed publicly.',
      'See anything about reports filed by anyone else.',
    ],
  },
  manager: {
    label: 'Manager',
    can: [
      'Everything a coordinator can.',
      'Invite and remove that organization’s coordinators.',
      'Change how the organization appears on the reports it files.',
      'Decide whether the organization is listed in the public directory.',
    ],
    cannot: [
      'See or moderate reports filed by anybody outside this organization.',
      'Grant any role outside this organization.',
    ],
  },
};

/** Does this role need an admin before anybody is emailed? */
export function needsApproval(role) {
  return role === 'manager';
}

/**
 * The ceiling, stated once.
 *
 * `actorIsManager` means the caller reached this as an Organization Manager
 * rather than as an Admin or Access Manager. It is the only thing between a
 * manager and an organization they cannot be removed from.
 */
export function mayInvite({ actorIsManager, role }) {
  if (!ORG_ROLES.includes(role)) return { ok: false, reason: 'unknown-role' };
  // An admin or access manager inviting a manager does not wait for itself.
  if (!actorIsManager) return { ok: true, requiresApproval: false };
  return { ok: true, requiresApproval: needsApproval(role) };
}

/** Rows older than the window are irrelevant to every question asked here. */
async function sweepSendLog(client) {
  await client.query(
    'DELETE FROM organization_invite_sends WHERE sent_at < now() - ($1 || \' milliseconds\')::interval',
    [String(SEND_LOG_TTL_MS)],
  );
}

export async function recordSend(email, client = pool) {
  await client.query('INSERT INTO organization_invite_sends (email) VALUES ($1)', [email]);
}

export async function sendsToday(email, client = pool) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM organization_invite_sends WHERE email = $1 AND sent_at > now() - interval '1 day'",
    [email],
  );
  return rows[0].n;
}

export async function outstandingCount(organizationId, client = pool) {
  const { rows } = await client.query(
    'SELECT count(*)::int AS n FROM organization_invites WHERE organization_id = $1',
    [organizationId],
  );
  return rows[0].n;
}

/**
 * Create an invitation.
 *
 * Returns `{ ok, token, requiresApproval }`. A token comes back only when
 * one should be emailed NOW — an invitation awaiting an admin has no token
 * in its result, because nothing may be sent yet.
 *
 * ONE ADDRESS. There is no bulk entry and there must not be: the limits
 * below are what keep this from being an unsolicited-mail cannon, and a
 * bulk field would make a manager's typo into a hundred emails.
 */
export async function createInvitation({
  actor, actorIsManager, organizationId, email, role,
}) {
  const gate = mayInvite({ actorIsManager, role });
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const address = normalizeEmail(email);
  if (!address || !looksLikeEmail(address)) return { ok: false, reason: 'email-required' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: orgRows } = await client.query(
      'SELECT name FROM organizations WHERE id = $1', [organizationId],
    );
    if (!orgRows.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'no-such-organization' };
    }

    // Already in? Then this is not an invitation, and saying so is more use
    // than sending them a link that would do nothing.
    const { rows: already } = await client.query(
      `SELECT 1 FROM organization_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1 AND u.email = $2`,
      [organizationId, address],
    );
    if (already.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'already-a-member' };
    }

    await sweepSendLog(client);
    // Expired invitations are not outstanding and must not count against
    // the cap, or an organization slowly locks itself out of inviting.
    await client.query(
      'DELETE FROM organization_invites WHERE expires_at IS NOT NULL AND expires_at < now()',
    );

    if (await outstandingCount(organizationId, client) >= MAX_OUTSTANDING_PER_ORG) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'too-many-outstanding' };
    }
    if (await sendsToday(address, client) >= MAX_PER_DAY_PER_EMAIL) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'too-many-to-this-address' };
    }

    const requiresApproval = gate.requiresApproval;
    const token = requiresApproval ? null : crypto.randomBytes(32).toString('hex');
    const expiresAt = requiresApproval ? null : new Date(Date.now() + INVITE_TTL_MS);

    await client.query(
      `INSERT INTO organization_invites
         (organization_id, email, role, invited_by, token, expires_at, status, last_sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (organization_id, email) DO UPDATE
         SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by,
             token = EXCLUDED.token, expires_at = EXCLUDED.expires_at,
             status = EXCLUDED.status, last_sent_at = EXCLUDED.last_sent_at,
             approved_by = NULL, approved_at = NULL`,
      [organizationId, address, role, actor.email, token, expiresAt,
        requiresApproval ? 'awaiting_approval' : 'pending',
        requiresApproval ? null : new Date()],
    );

    if (!requiresApproval) await recordSend(address, client);

    // The audit row says an invitation was issued, not that a role was
    // granted — nobody has accepted anything yet. The grant is recorded
    // separately when they do.
    await recordRoleChange(client, {
      actorEmail: actor.email,
      subjectEmail: address,
      axis: 'organization',
      action: 'grant',
      detail: requiresApproval
        ? `invited as ${role} of ${orgRows[0].name}, awaiting admin approval`
        : `invited as ${role} of ${orgRows[0].name}`,
      organizationId,
    });

    await client.query('COMMIT');
    return {
      ok: true, token, requiresApproval, organizationName: orgRows[0].name, email: address,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * An admin approving a manager invitation. This is the point at which a
 * token is minted and the email becomes sendable.
 */
export async function approveInvitation({ actor, organizationId, email }) {
  const address = normalizeEmail(email);
  const token = crypto.randomBytes(32).toString('hex');
  const { rows } = await pool.query(
    `UPDATE organization_invites
        SET status = 'pending', token = $3, expires_at = now() + ($4 || ' milliseconds')::interval,
            approved_by = $5, approved_at = now(), last_sent_at = now()
      WHERE organization_id = $1 AND email = $2 AND status = 'awaiting_approval'
      RETURNING role`,
    [organizationId, address, token, String(INVITE_TTL_MS), actor.email],
  );
  if (!rows.length) return { ok: false, reason: 'nothing-awaiting-approval' };
  await recordSend(address);
  return { ok: true, token, role: rows[0].role, email: address };
}

/**
 * Resend. A new token every time, so the previous link stops working —
 * anything else means an invitation resent because the first was sent to
 * the wrong address leaves the wrong address holding a live credential.
 */
export async function resendInvitation({ organizationId, email }) {
  const address = normalizeEmail(email);
  if (await sendsToday(address) >= MAX_PER_DAY_PER_EMAIL) {
    return { ok: false, reason: 'too-many-to-this-address' };
  }
  const token = crypto.randomBytes(32).toString('hex');
  const { rows } = await pool.query(
    `UPDATE organization_invites
        SET token = $3, expires_at = now() + ($4 || ' milliseconds')::interval, last_sent_at = now()
      WHERE organization_id = $1 AND email = $2 AND status = 'pending'
      RETURNING role`,
    [organizationId, address, token, String(INVITE_TTL_MS)],
  );
  if (!rows.length) return { ok: false, reason: 'no-such-invitation' };
  await recordSend(address);
  return { ok: true, token, role: rows[0].role, email: address };
}

/**
 * What the invitee is being asked to accept, read WITHOUT consuming the
 * token. The accept screen has to say which organization, which role, who
 * invited them and what that role can see — and it has to say it before
 * they press anything, which means looking is not accepting.
 */
export async function describeInvitation(token) {
  const { rows } = await pool.query(
    `SELECT i.email, i.role, i.invited_by, i.expires_at, o.name AS organization_name
       FROM organization_invites i JOIN organizations o ON o.id = i.organization_id
      WHERE i.token = $1 AND i.status = 'pending' AND i.expires_at > now()`,
    [token],
  );
  if (!rows[0]) return null;
  return {
    email: rows[0].email,
    role: rows[0].role,
    organization: rows[0].organization_name,
    invitedBy: rows[0].invited_by,
    expiresAt: rows[0].expires_at,
    permissions: ROLE_DESCRIPTIONS[rows[0].role] || null,
  };
}

/**
 * Accept. Creates the membership and consumes the invitation in one
 * transaction, so there is no state where somebody is a member of an
 * organization that still has a live link to make them one again.
 *
 * The role is re-checked against ORG_ROLES on the way out. A row cannot
 * have carried anything else in, but this is the last gate before a
 * membership exists and it costs one comparison.
 */
export async function acceptInvitation({ token, userId, email }) {
  const address = normalizeEmail(email);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `DELETE FROM organization_invites
        WHERE token = $1 AND status = 'pending' AND expires_at > now()
        RETURNING organization_id, email, role, invited_by`,
      [token],
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'no-such-invitation' };
    }
    const invite = rows[0];

    // The link is a credential for ONE address. Somebody signed in as
    // another person following it must not get the membership — that is how
    // a forwarded email becomes an account somebody else controls.
    if (normalizeEmail(invite.email) !== address) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'wrong-account', invitedEmail: invite.email };
    }

    if (!ORG_ROLES.includes(invite.role)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'unknown-role' };
    }

    const { rows: orgRows } = await client.query(
      'SELECT name FROM organizations WHERE id = $1', [invite.organization_id],
    );

    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [invite.organization_id, userId, invite.role],
    );

    // NOW the grant happened, and it is on the record as its own event
    // rather than folded into the invitation that offered it.
    await recordRoleChange(client, {
      actorEmail: address,
      subjectEmail: address,
      axis: 'organization',
      action: 'grant',
      detail: `accepted invitation as ${invite.role} of ${orgRows[0]?.name || invite.organization_id}`,
      organizationId: invite.organization_id,
    });

    await client.query('COMMIT');
    return {
      ok: true,
      organizationId: invite.organization_id,
      organization: orgRows[0]?.name || null,
      role: invite.role,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * What a manager sees. Silence is the only signal an invitee gives, so this
 * has to show what is still unaccepted and how long it has been — a typo
 * must be recoverable without the invitee doing anything.
 *
 * The token is NEVER returned. It is the credential, and a manager's screen
 * is not where it belongs.
 */
export async function listInvitations(organizationId) {
  const { rows } = await pool.query(
    `SELECT email, role, invited_by, created_at, expires_at, status, last_sent_at,
            approved_by, approved_at, (expires_at IS NOT NULL AND expires_at < now()) AS expired
       FROM organization_invites
      WHERE organization_id = $1
      ORDER BY created_at DESC`,
    [organizationId],
  );
  return rows;
}
