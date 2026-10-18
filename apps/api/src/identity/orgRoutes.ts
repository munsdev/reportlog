/**
 * Organizations and invitations, over HTTP.
 *
 * Two audiences share these routes: those who grant access (administrators,
 * the owner, Access Managers), who make organizations and appoint their
 * managers; and an organization's own managers, who run it from inside and
 * can do nothing outside it.
 *
 * Every handler a manager can reach establishes membership FIRST, from the
 * session. An organization id in a URL is a claim, not a permission.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { grantsAccess, notAllowed, requireGranter, requireUser } from './guards.ts';
import { bodyOf, iso, isoOrNull, refused } from './http.ts';
import {
  INVITE_TTL_MS,
  MAX_OUTSTANDING_PER_ORG,
  MAX_PER_DAY_PER_EMAIL,
  ROLE_DESCRIPTIONS,
  acceptInvitation,
  approveInvitation,
  createInvitation,
  describeInvitation,
  listInvitations,
  resendInvitation,
  withdrawInvitation,
} from './invitations.ts';
import type { InviteRefusal } from './invitations.ts';
import {
  addMember,
  createOrganization,
  isOrgRole,
  listOrganizations,
  membersOf,
  organizationName,
  removeMember,
  setOrganizationDetails,
} from './organizations.ts';
import type { SignedIn } from './sessions.ts';

const INVITE_REFUSALS: Record<
  InviteRefusal | 'no-such-invitation' | 'nothing-awaiting-approval',
  string
> = {
  'unknown-role': 'That is not a role an organization can hand out.',
  'bad-email': 'Enter a valid email address.',
  'no-such-organization': 'There is no such organization.',
  'already-a-member': 'That address is already in this organization.',
  'too-many-outstanding': `This organization already has ${MAX_OUTSTANDING_PER_ORG} invitations waiting. Withdraw some before sending more.`,
  'too-many-to-this-address': `That address has already been sent ${MAX_PER_DAY_PER_EMAIL} invitations today. Try again tomorrow.`,
  'no-such-invitation': 'There is no invitation waiting for that address.',
  'nothing-awaiting-approval': 'There is no invitation waiting for approval for that address.',
};

const GONE =
  'This invitation is not valid any more. It may have been used, withdrawn, or simply expired. Ask whoever invited you to send another.';

export const invitationEmail = (args: {
  link: string;
  role: 'manager' | 'coordinator';
  organizationName: string;
  invitedBy: string;
}) => ({
  subject: `You have been invited to ${args.organizationName}`,
  text:
    `${args.invitedBy} has invited you to join ${args.organizationName} as a ` +
    `${ROLE_DESCRIPTIONS[args.role].label.toLowerCase()}.\n\n` +
    `Open the invitation to see exactly what that means, and decide:\n${args.link}\n\n` +
    `Nothing happens until you accept. The link works once and for ${String(INVITE_TTL_MS / 86_400_000)} days.\n\n` +
    'If you were not expecting this, ignore it. Nothing is made for you and nobody is told either way.',
});

const INVITE_STATUSES = ['awaiting_approval', 'pending', 'joins_on_sign_in'] as const;
const isInviteStatus = (s: string): s is (typeof INVITE_STATUSES)[number] =>
  (INVITE_STATUSES as readonly string[]).includes(s);

function membershipRole(user: SignedIn, organizationId: number) {
  return user.memberships.find((m) => m.organization_id === organizationId)?.role ?? null;
}

/** A granter, or a manager of THIS organization; anybody else is refused. */
function requireOrgAuthority(request: FastifyRequest, organizationId: number) {
  const user = requireUser(request);
  const granter = grantsAccess(user);
  const manager = membershipRole(user, organizationId) === 'manager';
  if (!granter && !manager) throw notAllowed();
  // Came as a manager, not as somebody who grants access: the ceiling for
  // what they may hand out is lower.
  return { user, granter, actorIsManager: !granter };
}

export function orgRoutes(
  app: FastifyInstance,
  { db, mailer, siteOrigin }: { db: Kysely<DB>; mailer: Mailer; siteOrigin: string },
): void {
  async function mailInvitation(args: {
    email: string;
    token: string;
    role: 'manager' | 'coordinator';
    organizationId: number;
    invitedBy: string;
  }) {
    const name = (await organizationName(db, args.organizationId)) ?? '';
    await mailer.send({
      to: args.email,
      ...invitationEmail({
        link: `${siteOrigin}/access/invitation/${args.token}`,
        role: args.role,
        organizationName: name,
        invitedBy: args.invitedBy,
      }),
    });
  }

  route(app, C.listOrganizations, async ({ request }) => {
    const user = requireUser(request);
    if (grantsAccess(user)) {
      const all = await listOrganizations(db);
      return {
        organizations: all.map((o) => ({
          id: o.id,
          name: o.name,
          role: membershipRole(user, o.id),
        })),
      };
    }
    return {
      organizations: user.memberships.map((m) => ({
        id: m.organization_id,
        name: m.name,
        role: m.role,
      })),
    };
  });

  route(app, C.createOrganization, async ({ request }) => {
    const actor = requireGranter(request);
    const { name, details, managerEmails } = bodyOf(C.createOrganization, request);
    const out = await createOrganization(db, {
      actor,
      name,
      ...(details !== undefined ? { details } : {}),
      managerEmails,
    });
    if (out.ok) return out;
    const messages = {
      'name-required': 'Give the organization a name.',
      'manager-required': 'An organization needs at least one manager to run it.',
      'name-taken': 'An organization with that name already exists.',
      'bad-email': 'One of the managers’ addresses is not a valid email address.',
    } as const;
    throw refused(400, out.reason, messages[out.reason]);
  });

  route(app, C.getOrganization, async ({ params, request }) => {
    const id = Number(params.id);
    const { granter, actorIsManager } = requireOrgAuthority(request, id);
    const org = (await listOrganizations(db)).find((o) => o.id === id);
    if (!org) throw notFound('There is no such organization.');
    return {
      organization: {
        id: org.id,
        name: org.name,
        details: org.details,
        manager_count: org.manager_count,
        coordinator_count: org.coordinator_count,
      },
      members: (await membersOf(db, id)).flatMap((m) =>
        isOrgRole(m.role)
          ? [{ email: m.email, role: m.role, joined_at: iso(m.joined_at), pending: m.pending }]
          : [],
      ),
      youManageIt: actorIsManager,
      youGrantAccess: granter,
    };
  });

  /**
   * Adding somebody without their agreeing. Administrators and Access
   * Managers only, since invitations exist: a manager who could do this
   * would never have to ask. It stays for seating an organization's first
   * manager, who has nobody to invite them, and for repairs.
   */
  route(app, C.addMember, async ({ params, request }) => {
    const actor = requireGranter(request);
    const { email, role } = bodyOf(C.addMember, request);
    const out = await addMember(db, {
      actor,
      actorIsManager: false,
      organizationId: Number(params.id),
      email,
      role,
    });
    if (out.ok) return out;
    const messages = {
      'manager-cannot-promote':
        'A manager cannot appoint another manager. Ask an administrator or an Access Manager.',
      'bad-email': 'Enter a valid email address.',
      'unknown-role': 'There is no such role in an organization.',
      'no-such-organization': 'There is no such organization.',
    } as const;
    throw refused(
      out.reason === 'no-such-organization' ? 404 : 400,
      out.reason,
      messages[out.reason],
    );
  });

  route(app, C.removeMember, async ({ params, request }) => {
    const id = Number(params.id);
    const { user, actorIsManager } = requireOrgAuthority(request, id);
    const out = await removeMember(db, {
      actor: user,
      actorIsManager,
      organizationId: id,
      email: params.email,
    });
    if (out.ok) return out;
    const messages = {
      'last-manager':
        'An organization must always have a manager. Appoint another before removing this one.',
      'manager-cannot-remove-manager':
        'A manager cannot remove another manager. Ask an administrator or an Access Manager.',
      'not-a-member': 'That address is not in this organization.',
    } as const;
    throw refused(out.reason === 'not-a-member' ? 404 : 403, out.reason, messages[out.reason]);
  });

  route(app, C.setOrganizationDetails, async ({ params, request }) => {
    const id = Number(params.id);
    const { user, granter } = requireOrgAuthority(request, id);
    const ok = await setOrganizationDetails(db, {
      actor: user,
      organizationId: id,
      details: bodyOf(C.setOrganizationDetails, request).details,
      isAdminOverride: granter && membershipRole(user, id) !== 'manager',
    });
    if (!ok) throw notFound('There is no such organization.');
    return { ok: true as const };
  });

  // Pending and accepted, so a manager can see what silence means.
  route(app, C.listInvitations, async ({ params, request }) => {
    const id = Number(params.id);
    requireOrgAuthority(request, id);
    const rows = await listInvitations(db, id);
    return {
      invitations: rows.flatMap((r) =>
        isOrgRole(r.role) && isInviteStatus(r.status)
          ? [
              {
                email: r.email,
                role: r.role,
                status: r.status,
                invited_by: r.invited_by,
                created_at: iso(r.created_at),
                expires_at: isoOrNull(r.expires_at),
                last_sent_at: isoOrNull(r.last_sent_at),
                approved_by: r.approved_by,
                approved_at: isoOrNull(r.approved_at),
                expired: r.expired,
              },
            ]
          : [],
      ),
      roles: ROLE_DESCRIPTIONS,
      maxOutstanding: MAX_OUTSTANDING_PER_ORG,
      maxPerDay: MAX_PER_DAY_PER_EMAIL,
    };
  });

  route(app, C.createInvitation, async ({ params, request }) => {
    const id = Number(params.id);
    const { user, actorIsManager } = requireOrgAuthority(request, id);
    const { email, role } = bodyOf(C.createInvitation, request);
    // The ceiling at the route as well as in the module: this is a new door
    // into granting, and two checks for one rule is the discipline here.
    if (!isOrgRole(role)) throw refused(400, 'unknown-role', INVITE_REFUSALS['unknown-role']);
    const out = await createInvitation(db, {
      actor: user,
      actorIsManager,
      organizationId: id,
      email,
      role,
    });
    if (!out.ok)
      throw refused(
        out.reason === 'no-such-organization' ? 404 : 400,
        out.reason,
        INVITE_REFUSALS[out.reason],
      );
    if (!out.token) {
      return {
        ok: true as const,
        awaitingApproval: true,
        message:
          'Inviting another manager needs an administrator to approve it. Nothing has been emailed yet.',
      };
    }
    await mailInvitation({
      email: out.email,
      token: out.token,
      role: out.role,
      organizationId: id,
      invitedBy: user.email,
    });
    return {
      ok: true as const,
      awaitingApproval: false,
      message: `An invitation is on its way to ${out.email}.`,
    };
  });

  route(app, C.withdrawInvitation, async ({ params, request }) => {
    const id = Number(params.id);
    requireOrgAuthority(request, id);
    return { ok: true as const, withdrawn: await withdrawInvitation(db, id, params.email) };
  });

  route(app, C.resendInvitation, async ({ params, request }) => {
    const id = Number(params.id);
    const { user } = requireOrgAuthority(request, id);
    const out = await resendInvitation(db, { organizationId: id, email: params.email });
    if (!out.ok) throw refused(400, out.reason, INVITE_REFUSALS[out.reason]);
    await mailInvitation({
      email: out.email,
      token: out.token,
      role: out.role,
      organizationId: id,
      invitedBy: user.email,
    });
    return { ok: true as const };
  });

  // The leadership grant the approval step exists for: a granter's, never a manager's.
  route(app, C.approveInvitation, async ({ params, request }) => {
    const actor = requireGranter(request);
    const id = Number(params.id);
    const out = await approveInvitation(db, { actor, organizationId: id, email: params.email });
    if (!out.ok) throw refused(400, out.reason, INVITE_REFUSALS[out.reason]);
    await mailInvitation({
      email: out.email,
      token: out.token,
      role: out.role,
      organizationId: id,
      invitedBy: actor.email,
    });
    return { ok: true as const };
  });

  /**
   * The invitee's side. LOOKING IS NOT ACCEPTING: this reads without
   * consuming, so the page can say what the role can see before anybody
   * presses anything, and a mail client opening the link does nothing.
   * One answer for expired, withdrawn, used and never-existed.
   */
  route(app, C.describeInvitation, async ({ params }) => {
    const offer = await describeInvitation(db, params.token);
    if (!offer) throw refused(404, 'not_found', GONE);
    return { ...offer, expiresAt: iso(offer.expiresAt) };
  });

  route(app, C.acceptInvitation, async ({ params, request }) => {
    const user = requireUser(request);
    const out = await acceptInvitation(db, {
      token: params.token,
      userId: user.id,
      email: user.email,
    });
    if (out.ok) return out;
    if (out.reason === 'wrong-account') {
      // The one failure the person can fix, so it is said precisely.
      throw notAllowed(
        `This invitation was sent to ${out.invitedEmail}. You are signed in as ${user.email}. Sign in as the invited address to accept it.`,
      );
    }
    throw refused(404, 'not_found', GONE);
  });
}
