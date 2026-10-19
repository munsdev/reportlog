/**
 * Organization invitations: A NEW DOOR INTO ROLE GRANTING, so most of what is
 * here is about what must not be possible.
 *
 *   A manager may hand out an organization role and nothing else. Never a
 *   system role. Checked here and again at the route.
 *
 *   Inviting a COORDINATOR is a manager's own business. Inviting another
 *   MANAGER is a leadership grant: it is created awaiting an administrator,
 *   with no link and no email, because an approval that arrives after the
 *   person has been told they are invited approves nothing.
 *
 *   LOOKING IS NOT ACCEPTING. Reading an invitation does not consume it, so a
 *   mail client opening the link does nothing, and the person sees what the
 *   role can do before they press anything.
 *
 *   The link is a credential for ONE address, works once, and is stored as a
 *   hash. Resending makes a new link and kills the old one.
 *
 * There is no decline button, deliberately: ignoring an unexpected email is
 * enough. So silence is the only signal, and the manager's list shows what
 * is still waiting, with resend and withdraw.
 */
import type { OrgRole } from '@reportlog/access';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { isOrgRole, organizationName } from './organizations.ts';
import { recordRoleChange } from './roles.ts';
import { looksLikeEmail, normalizeEmail, randomToken, sha256Hex } from './secrets.ts';

/** Seven days: long enough for somebody who reads email at the weekend. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Not tuning knobs. They are what keeps this from being a way to send
// unsolicited mail in bulk.
export const MAX_OUTSTANDING_PER_ORG = 50;
export const MAX_PER_DAY_PER_EMAIL = 2;
const SEND_LOG_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * What each role can do, in the words the invitee reads before accepting.
 * Here, beside the check that enforces the role, so the two cannot drift.
 */
export const ROLE_DESCRIPTIONS: Record<
  OrgRole,
  { label: string; can: string[]; cannot: string[] }
> = {
  coordinator: {
    label: 'Coordinator',
    can: [
      'File reports under this organization’s name, including in batches from paper.',
      'See the reports they have filed for it.',
    ],
    cannot: [
      'Add or remove anybody.',
      'Change how the organization appears.',
      'See anything about reports filed by anyone else.',
    ],
  },
  manager: {
    label: 'Manager',
    can: [
      'Everything a coordinator can.',
      'Invite and remove that organization’s coordinators.',
      'Change how the organization appears on the reports it files.',
    ],
    cannot: [
      'See or moderate reports filed by anybody outside this organization.',
      'Grant any role outside this organization.',
    ],
  },
};

/** The ceiling, stated once. */
export function mayInvite({
  actorIsManager,
  role,
}: {
  actorIsManager: boolean;
  role: unknown;
}): { ok: true; role: OrgRole; requiresApproval: boolean } | { ok: false; reason: 'unknown-role' } {
  if (!isOrgRole(role)) return { ok: false, reason: 'unknown-role' };
  return { ok: true, role, requiresApproval: actorIsManager && role === 'manager' };
}

async function sendsToday(db: Kysely<DB>, email: string): Promise<number> {
  const row = await db
    .selectFrom('organization_invite_sends')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('email', '=', email)
    .where('sent_at', '>', new Date(Date.now() - 86_400_000))
    .executeTakeFirstOrThrow();
  return row.n;
}

async function recordSend(db: Kysely<DB>, email: string): Promise<void> {
  await db.insertInto('organization_invite_sends').values({ email }).execute();
}

export type InviteRefusal =
  | 'unknown-role'
  | 'bad-email'
  | 'no-such-organization'
  | 'already-a-member'
  | 'too-many-outstanding'
  | 'too-many-to-this-address';

/**
 * Create an invitation. A token comes back only when one should be emailed
 * NOW; one awaiting an administrator has none, because nothing may be sent.
 * One address at a time, and there must never be a bulk field.
 */
export async function createInvitation(
  db: Kysely<DB>,
  args: {
    actor: { email: string };
    actorIsManager: boolean;
    organizationId: number;
    email: string;
    role: unknown;
  },
): Promise<
  | { ok: true; token: string | null; role: OrgRole; organizationName: string; email: string }
  | { ok: false; reason: InviteRefusal }
> {
  const gate = mayInvite({ actorIsManager: args.actorIsManager, role: args.role });
  if (!gate.ok) return gate;
  const email = normalizeEmail(args.email);
  if (!looksLikeEmail(email)) return { ok: false, reason: 'bad-email' };

  return db.transaction().execute(async (trx) => {
    const orgName = await organizationName(trx, args.organizationId);
    if (orgName === null) return { ok: false as const, reason: 'no-such-organization' as const };

    const already = await trx
      .selectFrom('organization_memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select('m.id')
      .where('m.organization_id', '=', args.organizationId)
      .where('u.email', '=', email)
      .executeTakeFirst();
    if (already) return { ok: false as const, reason: 'already-a-member' as const };

    await trx
      .deleteFrom('organization_invite_sends')
      .where('sent_at', '<', new Date(Date.now() - SEND_LOG_TTL_MS))
      .execute();
    // Expired links are not outstanding. Counting them would slowly lock an
    // organization out of inviting anybody at all.
    await trx
      .deleteFrom('organization_invites')
      .where('status', '=', 'pending')
      .where('expires_at', '<', new Date())
      .execute();

    const outstanding = await trx
      .selectFrom('organization_invites')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('organization_id', '=', args.organizationId)
      .executeTakeFirstOrThrow();
    if (outstanding.n >= MAX_OUTSTANDING_PER_ORG) {
      return { ok: false as const, reason: 'too-many-outstanding' as const };
    }
    if ((await sendsToday(trx, email)) >= MAX_PER_DAY_PER_EMAIL) {
      return { ok: false as const, reason: 'too-many-to-this-address' as const };
    }

    const held = gate.requiresApproval;
    const token = held ? null : randomToken();
    const row = {
      role: gate.role,
      status: held ? 'awaiting_approval' : 'pending',
      invited_by: normalizeEmail(args.actor.email),
      token_hash: token ? sha256Hex(token) : null,
      expires_at: held ? null : new Date(Date.now() + INVITE_TTL_MS),
      last_sent_at: held ? null : new Date(),
      approved_by: null,
      approved_at: null,
    };
    await trx
      .insertInto('organization_invites')
      .values({ organization_id: args.organizationId, email, ...row })
      .onConflict((oc) => oc.columns(['organization_id', 'email']).doUpdateSet(row))
      .execute();
    if (!held) await recordSend(trx, email);

    // An invitation was issued; nothing was granted yet. The grant is its own
    // row, written when they accept.
    await recordRoleChange(trx, {
      actorEmail: args.actor.email,
      subjectEmail: email,
      axis: 'organization',
      action: 'grant',
      detail: held
        ? `invited as ${gate.role} of ${orgName}, awaiting an administrator’s approval`
        : `invited as ${gate.role} of ${orgName}`,
      organizationId: args.organizationId,
    });
    return { ok: true as const, token, role: gate.role, organizationName: orgName, email };
  });
}

/** An administrator approves a manager invitation: only now is there a link. */
export async function approveInvitation(
  db: Kysely<DB>,
  args: { actor: { email: string }; organizationId: number; email: string },
): Promise<
  | { ok: true; token: string; role: OrgRole; email: string }
  | { ok: false; reason: 'nothing-awaiting-approval' }
> {
  const email = normalizeEmail(args.email);
  const token = randomToken();
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable('organization_invites')
      .set({
        status: 'pending',
        token_hash: sha256Hex(token),
        expires_at: new Date(Date.now() + INVITE_TTL_MS),
        approved_by: normalizeEmail(args.actor.email),
        approved_at: new Date(),
        last_sent_at: new Date(),
      })
      .where('organization_id', '=', args.organizationId)
      .where('email', '=', email)
      .where('status', '=', 'awaiting_approval')
      .returning('role')
      .executeTakeFirst();
    if (!row || !isOrgRole(row.role))
      return { ok: false as const, reason: 'nothing-awaiting-approval' as const };
    await recordSend(trx, email);
    await recordRoleChange(trx, {
      actorEmail: args.actor.email,
      subjectEmail: email,
      axis: 'organization',
      action: 'grant',
      detail: `approved the invitation as ${row.role}`,
      organizationId: args.organizationId,
    });
    return { ok: true as const, token, role: row.role, email };
  });
}

/**
 * Resend. A new link every time, so the previous one stops working: an
 * invitation resent because the first went to the wrong address must not
 * leave the wrong address holding a live credential.
 */
export async function resendInvitation(
  db: Kysely<DB>,
  args: { organizationId: number; email: string },
): Promise<
  | { ok: true; token: string; role: OrgRole; email: string }
  | { ok: false; reason: 'too-many-to-this-address' | 'no-such-invitation' }
> {
  const email = normalizeEmail(args.email);
  if ((await sendsToday(db, email)) >= MAX_PER_DAY_PER_EMAIL) {
    return { ok: false, reason: 'too-many-to-this-address' };
  }
  const token = randomToken();
  const row = await db
    .updateTable('organization_invites')
    .set({
      token_hash: sha256Hex(token),
      expires_at: new Date(Date.now() + INVITE_TTL_MS),
      last_sent_at: new Date(),
    })
    .where('organization_id', '=', args.organizationId)
    .where('email', '=', email)
    .where('status', '=', 'pending')
    .returning('role')
    .executeTakeFirst();
  if (!row || !isOrgRole(row.role)) return { ok: false, reason: 'no-such-invitation' };
  await recordSend(db, email);
  return { ok: true, token, role: row.role, email };
}

export async function withdrawInvitation(
  db: Kysely<DB>,
  organizationId: number,
  email: string,
): Promise<number> {
  const out = await db
    .deleteFrom('organization_invites')
    .where('organization_id', '=', organizationId)
    .where('email', '=', normalizeEmail(email))
    .executeTakeFirst();
  return Number(out.numDeletedRows);
}

/** What the invitee is asked to accept, read WITHOUT consuming the link. */
export async function describeInvitation(db: Kysely<DB>, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await db
    .selectFrom('organization_invites as i')
    .innerJoin('organizations as o', 'o.id', 'i.organization_id')
    .select(['i.email', 'i.role', 'i.invited_by', 'i.expires_at', 'o.name'])
    .where('i.token_hash', '=', sha256Hex(token))
    .where('i.status', '=', 'pending')
    .where('i.expires_at', '>', new Date())
    .executeTakeFirst();
  if (!row?.expires_at || !isOrgRole(row.role)) return null;
  return {
    email: row.email,
    role: row.role,
    organization: row.name,
    invitedBy: row.invited_by,
    expiresAt: row.expires_at,
    permissions: ROLE_DESCRIPTIONS[row.role],
  };
}

/**
 * Accept: the membership is made and the invitation consumed in one
 * transaction, so nobody is ever a member while a live link to make them one
 * again still exists. The role is checked once more on the way out; it is
 * the last gate before a membership exists.
 */
export async function acceptInvitation(
  db: Kysely<DB>,
  args: { token: string; userId: number; email: string },
): Promise<
  | { ok: true; organizationId: number; organization: string; role: OrgRole }
  | { ok: false; reason: 'no-such-invitation' }
  | { ok: false; reason: 'wrong-account'; invitedEmail: string }
> {
  if (!/^[a-f0-9]{64}$/.test(args.token)) return { ok: false, reason: 'no-such-invitation' };
  const me = normalizeEmail(args.email);
  return db.transaction().execute(async (trx) => {
    const invite = await trx
      .selectFrom('organization_invites')
      .select(['id', 'organization_id', 'email', 'role'])
      .where('token_hash', '=', sha256Hex(args.token))
      .where('status', '=', 'pending')
      .where('expires_at', '>', new Date())
      .forUpdate()
      .executeTakeFirst();
    if (!invite || !isOrgRole(invite.role))
      return { ok: false as const, reason: 'no-such-invitation' as const };
    // A forwarded email must not become an account somebody else controls.
    if (invite.email !== me) {
      return { ok: false as const, reason: 'wrong-account' as const, invitedEmail: invite.email };
    }
    await trx.deleteFrom('organization_invites').where('id', '=', invite.id).execute();
    await trx
      .insertInto('organization_memberships')
      .values({ organization_id: invite.organization_id, user_id: args.userId, role: invite.role })
      .onConflict((oc) =>
        oc.columns(['organization_id', 'user_id']).doUpdateSet({ role: invite.role }),
      )
      .execute();
    const name =
      (await organizationName(trx, invite.organization_id)) ?? String(invite.organization_id);
    await recordRoleChange(trx, {
      actorEmail: me,
      subjectEmail: me,
      axis: 'organization',
      action: 'grant',
      detail: `accepted the invitation as ${invite.role} of ${name}`,
      organizationId: invite.organization_id,
    });
    return {
      ok: true as const,
      organizationId: invite.organization_id,
      organization: name,
      role: invite.role,
    };
  });
}

/** What a manager sees. The link is never in it: it is the credential. */
export async function listInvitations(db: Kysely<DB>, organizationId: number) {
  const rows = await db
    .selectFrom('organization_invites')
    .select([
      'email',
      'role',
      'status',
      'invited_by',
      'created_at',
      'expires_at',
      'last_sent_at',
      'approved_by',
      'approved_at',
    ])
    .where('organization_id', '=', organizationId)
    .orderBy('created_at', 'desc')
    .execute();
  const now = new Date();
  return rows.map((r) => ({ ...r, expired: r.expires_at !== null && r.expires_at < now }));
}
