/**
 * Identity and access: signing in, the role ladder, the owner's seat,
 * organizations and invitations, the site password and first-run setup.
 *
 * Addresses are plain strings here and checked by the server, so a person
 * who mistypes one is told so in a sentence rather than by a schema.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';
import { BrandPartSchema } from './site.ts';

const Email = z.string().max(320);
const Ok = z.object({ ok: z.literal(true) });
const Iso = z.string();

export const SystemRoleName = z.enum([
  'user',
  'moderator',
  'access_manager',
  'admin',
  'owner',
  'journalist',
]);
export const OrgRoleName = z.enum(['manager', 'coordinator']);
export type SystemRoleName = z.infer<typeof SystemRoleName>;
export type OrgRoleName = z.infer<typeof OrgRoleName>;

export const Membership = z.object({
  organization_id: z.number().int(),
  name: z.string(),
  role: OrgRoleName,
});

export const Me = z.discriminatedUnion('signedIn', [
  z.object({ signedIn: z.literal(false) }),
  z.object({
    signedIn: z.literal(true),
    email: z.string(),
    role: SystemRoleName,
    memberships: z.array(Membership),
    /** An administrator, the owner or an Access Manager: may open the access screens. */
    grantsAccess: z.boolean(),
    /** Holds the tester flag: may open the feedback tracker. A flag, not a role. */
    tester: z.boolean(),
    /** On the team: may open the team's pages. A flag, not a role. */
    teamMember: z.boolean(),
    /** What they do on the team (DESKS ids). Display only: grants nothing. */
    desks: z.array(z.string()),
    /**
     * The second factor (plan E, E3). `set-up` and `verify` mean this session
     * acts with no role (`role` is `user`, `memberships` empty) until it is
     * done; `heldRole` is the role it will then have.
     */
    secondFactor: z.enum(['not-needed', 'set-up', 'verify', 'done']),
    heldRole: SystemRoleName,
    /** Until when a step-up proved in this session counts, if one does. */
    stepUpUntil: Iso.nullable(),
  }),
]);
export type Me = z.infer<typeof Me>;

// ── signing in ──────────────────────────────────────────────────────────

export const requestSignInCode = defineRoute({
  method: 'POST',
  path: '/api/auth/code',
  summary:
    'Email a one-time code to an address. Answers the same whether or not it has an account.',
  body: z.object({ email: Email }),
  response: Ok,
});

export const signIn = defineRoute({
  method: 'POST',
  path: '/api/auth/sign-in',
  summary: 'Trade the code for a session. Never changes anybody’s role.',
  body: z.object({ email: Email, code: z.string().max(20) }),
  response: Me,
});

export const signOut = defineRoute({
  method: 'POST',
  path: '/api/auth/sign-out',
  summary: 'End this session.',
  response: Ok,
});

export const getMe = defineRoute({
  method: 'GET',
  path: '/api/auth/me',
  summary: 'Who is signed in, if anybody.',
  response: Me,
});

// ── the role ladder ─────────────────────────────────────────────────────

export const setSystemRole = defineRoute({
  method: 'POST',
  path: '/api/access/system-role',
  summary: 'Give somebody a system role. The ceiling is in @reportlog/access.',
  body: z.object({ email: Email, role: z.string().max(40) }),
  response: z.object({
    ok: z.literal(true),
    unchanged: z.boolean(),
    from: SystemRoleName.optional(),
    to: SystemRoleName.optional(),
  }),
});

export const Person = z.object({
  email: z.string(),
  role: SystemRoleName,
  organizations: z.array(z.object({ name: z.string(), role: OrgRoleName })),
});

export const listPeople = defineRoute({
  method: 'GET',
  path: '/api/access/people',
  summary: 'Everybody who holds a role or belongs to an organization.',
  response: z.object({ people: z.array(Person) }),
});

export const AuditRow = z.object({
  actor_email: z.string(),
  subject_email: z.string(),
  axis: z.string(),
  action: z.string(),
  detail: z.string(),
  organization: z.string().nullable(),
  created_at: Iso,
});

export const listAudit = defineRoute({
  method: 'GET',
  path: '/api/access/audit',
  summary: 'The most recent changes to who may do what, newest first.',
  response: z.object({ entries: z.array(AuditRow) }),
});

// ── the owner's seat ────────────────────────────────────────────────────

export const getOwner = defineRoute({
  method: 'GET',
  path: '/api/access/owner',
  summary:
    'Who holds the seat and whether a handover is waiting. Somebody who grants no access learns only whether one waits for them.',
  response: z.object({
    awaitingMyAcceptance: z.boolean(),
    owner: z.string().nullable().optional(),
    iAmOwner: z.boolean().optional(),
    pending: z.object({ from: z.string(), to: z.string(), expiresAt: Iso }).nullable().optional(),
  }),
});

export const requestHandoverCode = defineRoute({
  method: 'POST',
  path: '/api/access/owner/handover-code',
  summary: 'Email the owner a code that hands the seat to this one address and no other.',
  body: z.object({ email: Email }),
  response: z.object({ ok: z.literal(true), sentTo: z.string() }),
});

export const offerHandover = defineRoute({
  method: 'POST',
  path: '/api/access/owner/handover',
  summary: 'Offer the seat. Nothing moves until the other person accepts.',
  body: z.object({ email: Email, code: z.string().max(20) }),
  response: z.object({ ok: z.literal(true), to: z.string(), expiresAt: Iso }),
});

export const cancelHandover = defineRoute({
  method: 'DELETE',
  path: '/api/access/owner/handover',
  summary: 'Withdraw the offer.',
  response: Ok,
});

export const acceptHandover = defineRoute({
  method: 'POST',
  path: '/api/access/owner/accept',
  summary: 'Accept the seat offered to you. The outgoing owner becomes an administrator.',
  response: z.object({ ok: z.literal(true), from: z.string().nullable(), to: z.string() }),
});

// ── organizations ───────────────────────────────────────────────────────

const OrgParams = z.object({ id: z.coerce.number().int().positive() });
const OrgEmailParams = z.object({ id: z.coerce.number().int().positive(), email: Email });

export const Organization = z.object({
  id: z.number().int(),
  name: z.string(),
  details: z.string().nullable(),
  /** Where its logo is served from, or null. Served only while it is listed in the directory. */
  logo: z.string().nullable(),
  manager_count: z.number().int(),
  coordinator_count: z.number().int(),
});

export const listOrganizations = defineRoute({
  method: 'GET',
  path: '/api/orgs',
  summary: 'Every organization, for those who grant access; your own, for anybody else.',
  response: z.object({
    organizations: z.array(
      z.object({ id: z.number().int(), name: z.string(), role: OrgRoleName.nullable() }),
    ),
  }),
});

export const createOrganization = defineRoute({
  method: 'POST',
  path: '/api/orgs',
  summary: 'Make an organization, with at least one manager to run it.',
  body: z.object({
    name: z.string().max(160),
    details: z.string().max(2000).optional(),
    managerEmails: z.array(Email).max(10),
  }),
  response: z.object({
    ok: z.literal(true),
    organization: z.object({ id: z.number().int(), name: z.string() }),
  }),
});

export const getOrganization = defineRoute({
  method: 'GET',
  path: '/api/orgs/:id',
  summary: 'One organization and its people, for its managers and those who grant access.',
  params: OrgParams,
  response: z.object({
    organization: Organization,
    members: z.array(
      z.object({ email: z.string(), role: OrgRoleName, joined_at: Iso, pending: z.boolean() }),
    ),
    youManageIt: z.boolean(),
    youGrantAccess: z.boolean(),
  }),
});

export const addMember = defineRoute({
  method: 'POST',
  path: '/api/orgs/:id/members',
  summary:
    'Add somebody directly, without their agreeing. Administrators only: everybody else invites.',
  params: OrgParams,
  body: z.object({ email: Email, role: z.string().max(40) }),
  response: z.object({ ok: z.literal(true), pending: z.boolean() }),
});

export const removeMember = defineRoute({
  method: 'DELETE',
  path: '/api/orgs/:id/members/:email',
  summary: 'Remove somebody. What they filed stays filed under the organization.',
  params: OrgEmailParams,
  response: z.object({
    ok: z.literal(true),
    revokedInvite: z.boolean().optional(),
    submissionsKept: z.boolean().optional(),
  }),
});

export const setOrganizationDetails = defineRoute({
  method: 'POST',
  path: '/api/orgs/:id/details',
  summary: 'How the organization describes itself.',
  params: OrgParams,
  body: z.object({ details: z.string().max(2000) }),
  response: Ok,
});

// ── invitations ─────────────────────────────────────────────────────────

export const RoleDescription = z.object({
  label: z.string(),
  can: z.array(z.string()),
  cannot: z.array(z.string()),
});

export const Invitation = z.object({
  email: z.string(),
  role: OrgRoleName,
  status: z.enum(['awaiting_approval', 'pending', 'joins_on_sign_in']),
  invited_by: z.string(),
  created_at: Iso,
  expires_at: Iso.nullable(),
  last_sent_at: Iso.nullable(),
  approved_by: z.string().nullable(),
  approved_at: Iso.nullable(),
  expired: z.boolean(),
});

export const listInvitations = defineRoute({
  method: 'GET',
  path: '/api/orgs/:id/invitations',
  summary: 'What is still waiting. Never the link itself: it is the credential.',
  params: OrgParams,
  response: z.object({
    invitations: z.array(Invitation),
    roles: z.record(OrgRoleName, RoleDescription),
    maxOutstanding: z.number().int(),
    maxPerDay: z.number().int(),
  }),
});

export const createInvitation = defineRoute({
  method: 'POST',
  path: '/api/orgs/:id/invitations',
  summary: 'Invite one address. A manager inviting a manager waits for an administrator.',
  params: OrgParams,
  body: z.object({ email: Email, role: z.string().max(40) }),
  response: z.object({ ok: z.literal(true), awaitingApproval: z.boolean(), message: z.string() }),
});

export const withdrawInvitation = defineRoute({
  method: 'DELETE',
  path: '/api/orgs/:id/invitations/:email',
  summary: 'Withdraw an invitation. Its link stops working.',
  params: OrgEmailParams,
  response: z.object({ ok: z.literal(true), withdrawn: z.number().int() }),
});

export const resendInvitation = defineRoute({
  method: 'POST',
  path: '/api/orgs/:id/invitations/:email/resend',
  summary: 'Send a new link. The old one stops working.',
  params: OrgEmailParams,
  response: Ok,
});

export const approveInvitation = defineRoute({
  method: 'POST',
  path: '/api/orgs/:id/invitations/:email/approve',
  summary: 'An administrator approves a manager invitation, and only then is it sent.',
  params: OrgEmailParams,
  response: Ok,
});

const TokenParams = z.object({ token: z.string().max(128) });

export const InvitationOffer = z.object({
  email: z.string(),
  role: OrgRoleName,
  organization: z.string(),
  invitedBy: z.string(),
  expiresAt: Iso,
  permissions: RoleDescription,
});

export const describeInvitation = defineRoute({
  method: 'GET',
  path: '/api/invitations/:token',
  summary: 'What an invitation offers. Looking does not accept it.',
  params: TokenParams,
  response: InvitationOffer,
});

export const acceptInvitation = defineRoute({
  method: 'POST',
  path: '/api/invitations/:token/accept',
  summary: 'Accept, signed in as the invited address. The link works once.',
  params: TokenParams,
  response: z.object({
    ok: z.literal(true),
    organizationId: z.number().int(),
    organization: z.string(),
    role: OrgRoleName,
  }),
});

// ── the site password and its doors ─────────────────────────────────────

/** The site's name and the operator's paragraph for the password screen. Nothing else. */
export const LockScreenSite = z.object({
  name_parts: z.array(BrandPartSchema).min(1),
  plain_name: z.string(),
  /** The operator's `lock_intro`, absent when unwritten. */
  intro: z.string().optional(),
});
export type LockScreenSite = z.infer<typeof LockScreenSite>;

export const getSiteAccessStatus = defineRoute({
  method: 'GET',
  path: '/api/site-access/status',
  summary: 'Whether this visitor still needs the site password. In front of the password.',
  response: z.object({
    locked: z.boolean(),
    /**
     * Only while locked: everything the password screen shows of the site
     * (decisions.md §3), so it needs no call behind the gate.
     */
    site: LockScreenSite.optional(),
    /**
     * When the development notice ends, or null. Here so the badge shows on
     * the lock screen and on a door, where /api/site is not asked.
     */
    dev_mode_until: z.string().nullable(),
  }),
});

export const unlockSite = defineRoute({
  method: 'POST',
  path: '/api/site-access/unlock',
  summary: 'Trade the site password for a cookie. In front of the password.',
  body: z.object({ password: z.string().max(200) }),
  response: Ok,
});

export const Door = z.object({
  kind: z.enum(['logbook', 'list']),
  slug: z.string(),
  title: z.string(),
  href: z.string(),
});
export type Door = z.infer<typeof Door>;

export const listDoors = defineRoute({
  method: 'GET',
  path: '/api/doors',
  summary: 'What the password page offers without the password. Titles and addresses only.',
  response: z.object({ doors: z.array(Door) }),
});

export const getSiteAccessSettings = defineRoute({
  method: 'GET',
  path: '/api/access/site-access',
  summary: 'Whether the site password is on. Administrators only.',
  response: z.object({
    enabled: z.boolean(),
    hasPassword: z.boolean(),
    minPassword: z.number().int(),
  }),
});

export const updateSiteAccess = defineRoute({
  method: 'POST',
  path: '/api/access/site-access',
  summary: 'Turn the site password on or off, or set a new one (with its confirmation).',
  body: z.object({
    enabled: z.boolean().optional(),
    password: z.string().max(200).optional(),
    passwordConfirm: z.string().max(200).optional(),
  }),
  response: Ok,
});

export const OutsideAccessName = z.enum(['closed', 'link', 'door']);

export const setLogbookOutsideAccess = defineRoute({
  method: 'POST',
  path: '/api/access/doors/logbooks/:slug',
  summary:
    'Whether a logbook can be filed to without the site password: closed, by its address (link), or offered on the password page (door).',
  params: z.object({ slug: z.string().max(63) }),
  body: z.object({ outside_access: OutsideAccessName }),
  response: Ok,
});

// ── first-run setup ─────────────────────────────────────────────────────

export const getSetupStatus = defineRoute({
  method: 'GET',
  path: '/api/setup/status',
  summary: 'Whether this deployment still needs setting up, and whether it has an owner yet.',
  response: z.object({ needed: z.boolean(), hasOwner: z.boolean(), minPassword: z.number().int() }),
});

export const requestSetupCode = defineRoute({
  method: 'POST',
  path: '/api/setup/code',
  summary: 'Step one: email a code to the address that will own this deployment.',
  body: z.object({ email: Email }),
  response: Ok,
});

export const claimOwnership = defineRoute({
  method: 'POST',
  path: '/api/setup/owner',
  summary: 'Step two: the code. This address becomes the owner, once.',
  body: z.object({ email: Email, code: z.string().max(20) }),
  response: Me,
});

export const decideCurtain = defineRoute({
  method: 'POST',
  path: '/api/setup/curtain',
  summary: 'Step three: keep or change the site password. There is no skip. Ends setup.',
  body: z.object({
    decision: z.string().max(20).optional(),
    password: z.string().max(200).optional(),
    passwordConfirm: z.string().max(200).optional(),
  }),
  response: z.object({ ok: z.literal(true), changed: z.boolean() }),
});

// ── the team-member flag and desks ──────────────────────────────────────

/**
 * What somebody on the team does. DISPLAY ONLY: a desk says where their
 * account page suggests they start, and nothing else. It hides nothing and
 * grants nothing. The ids are the old application's, so a desk stored there
 * keeps its meaning here.
 */
export const DESKS = [
  { id: 'lead_dev', label: 'Lead developer' },
  { id: 'dev', label: 'Developer, supporting' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'moderating', label: 'Moderating reports' },
  { id: 'testing', label: 'Testing the site before it is public' },
  { id: 'group', label: 'Bringing an organization onto the record' },
  { id: 'policy', label: 'Policy or legal' },
  { id: 'translation', label: 'Translation' },
  { id: 'design', label: 'Design or writing' },
  { id: 'outreach', label: 'Outreach' },
] as const;
export type DeskId = (typeof DESKS)[number]['id'];
export const DESK_IDS: readonly DeskId[] = DESKS.map((d) => d.id);

export const setTeamMember = defineRoute({
  method: 'POST',
  path: '/api/access/team-member',
  summary:
    'Put somebody on the team, change their desks, or take them off it. Administrators and Access Managers.',
  body: z.object({
    email: Email,
    teamMember: z.boolean(),
    desks: z.array(z.string().max(40)).max(20),
  }),
  response: z.object({ ok: z.literal(true), unchanged: z.boolean(), desks: z.array(z.string()) }),
});

// ── the roster ──────────────────────────────────────────────────────────

export const RosterPerson = z.object({
  email: z.string(),
  role: SystemRoleName,
  tester: z.boolean(),
  teamMember: z.boolean(),
  desks: z.array(z.string()),
  organizations: z.array(z.object({ name: z.string(), role: OrgRoleName })),
  /** Reports this person typed up as a coordinator in the period. */
  filedByThem: z.number().int(),
  /** Reports typed up for any organization they belong to in the period, by anybody. */
  filedForTheirOrganizations: z.number().int(),
  /** The last time they moderated, opened contact details or a file, or changed somebody's access. */
  lastStaffAction: Iso.nullable(),
});

export const getRoster = defineRoute({
  method: 'GET',
  path: '/api/access/roster',
  summary:
    'Everybody with a role, a flag or an organization, with how much they filed. Administrators and Access Managers.',
  query: z.object({ days: z.coerce.number().int().min(1).max(365).optional() }),
  response: z.object({ days: z.number().int(), people: z.array(RosterPerson) }),
});

// ── organization logos ──────────────────────────────────────────────────

/** The largest logo accepted, before it is re-encoded. */
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * The request body is the image itself (PNG, JPEG or WebP), not JSON. It is
 * decoded and re-encoded before it is kept, so nothing but the picture
 * survives. Its managers, or an administrator.
 */
export const uploadOrganizationLogo = defineRoute({
  method: 'PUT',
  path: '/api/orgs/:id/logo',
  summary: 'Replace the organization’s logo with the image in the body.',
  params: OrgParams,
  response: z.object({ ok: z.literal(true), logo: z.string() }),
});

export const removeOrganizationLogo = defineRoute({
  method: 'DELETE',
  path: '/api/orgs/:id/logo',
  summary: 'Remove the organization’s logo.',
  params: OrgParams,
  response: Ok,
});

// ── stopping a digest from the email ────────────────────────────────────

/**
 * What a stop link says. `gone` is an unknown link and an expired one alike:
 * the page cannot tell somebody which addresses have subscriptions.
 */
export const DigestStop = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('subscribed'),
    /** The address, partly hidden, so somebody with several can tell which. */
    address: z.string(),
    frequency: z.enum(['hourly', 'weekly']),
  }),
  z.object({ state: z.literal('stopped'), address: z.string() }),
  z.object({ state: z.literal('gone') }),
]);
export type DigestStop = z.infer<typeof DigestStop>;

const StopParams = z.object({ token: z.string().max(128) });

export const describeDigestStop = defineRoute({
  method: 'GET',
  path: '/api/notifications/stop/:token',
  summary:
    'What a stop link in a digest email would stop. Changes nothing: mail scanners open links.',
  params: StopParams,
  response: DigestStop,
});

export const stopDigest = defineRoute({
  method: 'POST',
  path: '/api/notifications/stop/:token',
  summary: 'Stop the digest emails this link was sent with. No sign-in needed.',
  params: StopParams,
  response: DigestStop,
});
