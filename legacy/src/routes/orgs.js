/**
 * The organization axis, over HTTP.
 *
 * Two audiences share this router and they are not the same people:
 * Admins and Access Managers, who create organizations and appoint their
 * Managers; and Organization Managers, who run one from the inside and can
 * do nothing outside it.
 *
 * Every handler that a Manager can reach establishes membership FIRST,
 * from the session, and never trusts an organization id in the request to
 * mean the caller is entitled to it. That is the whole security model
 * here: an id in a URL is a claim, not a permission.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../authMiddleware.js';
import {
  listOrganizations, createOrganization, addMember, removeMember,
  membersOf, setOrganizationDetails,
} from '../organizations.js';
import { setListed, WHAT_APPEARS, DIRECTORY_NAME, DISCLAIMER } from '../alliance.js';
import {
  createInvitation, approveInvitation, resendInvitation, listInvitations,
  describeInvitation, acceptInvitation, ROLE_DESCRIPTIONS,
  MAX_OUTSTANDING_PER_ORG, MAX_PER_DAY_PER_EMAIL,
} from '../invitations.js';
import { sendEmail } from '../email.js';
import { SITE_ORIGIN } from '../siteOrigin.js';
import {
  setSystemRole, setTesterFlag, setTeamMemberFlag, SYSTEM_ROLES, ORG_ROLES,
} from '../roles.js';
import { DESKS } from '../desks.js';
import { asyncRoute } from '../asyncRoute.js';
import { hasAdminAuthority } from '../roleRank.js';
import {
  currentOwner, pendingTransfer, proposeTransfer, cancelTransfer, acceptTransfer,
  handoverCodeSubject,
} from '../ownership.js';
import { looksLikeEmail, normalizeEmail } from '../crypto.js';
import { createCode, verifyCode } from '../otp.js';

const router = express.Router();
router.use(requireAuth);

const isAdminish = (u) => hasAdminAuthority(u.role) || u.role === 'access_manager';

function membershipRole(user, organizationId) {
  const id = Number(organizationId);
  const found = (user.memberships || []).find((m) => Number(m.organization_id) === id);
  return found ? found.role : null;
}

/** What the signed-in person may see and do — drives the whole UI. */
router.get('/me', asyncRoute(async (req, res) => {
  res.json({
    role: req.user.role,
    isTester: Boolean(req.user.is_tester),
    isTeamMember: Boolean(req.user.is_team_member),
    desks: Array.isArray(req.user.desks) ? req.user.desks : [],
    canAdminister: isAdminish(req.user),
    memberships: req.user.memberships || [],
  });
}));

/* ---------------- system axis: who moderates, who leads --------------- */

// Access Manager's own remit: promote and demote Moderators, create
// organizations, appoint Organization Managers. Not system configuration,
// not moderation, and — the load-bearing one — not another Access Manager.
router.post('/system-role', requireRole(['admin', 'access_manager']), asyncRoute(async (req, res) => {
  const { email, role } = req.body || {};
  if (!SYSTEM_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });

  const out = await setSystemRole({ actor: req.user, email, role });
  if (out.ok) return res.json(out);

  const messages = {
    'not-permitted': role === 'access_manager'
      ? 'Only an admin can appoint an Access Manager. This is deliberate: if Access Managers could appoint each other the role would spread on its own.'
      : role === 'admin'
        ? 'Only the owner can appoint an administrator.'
        : role === 'owner'
          ? 'The owner\u2019s seat is not granted. It is handed over, and the person receiving it has to accept.'
          : 'You cannot grant that role.',
    'protected-subject': 'That account cannot be changed here. Only the owner can change an administrator, and nobody can change the owner.',
    self: 'You cannot change your own role.',
    'unknown-role': 'Unknown role.',
  };
  return res.status(403).json({ error: messages[out.reason] || 'Refused' });
}));

router.post('/tester', requireRole(['admin', 'access_manager']), asyncRoute(async (req, res) => {
  const { email, isTester } = req.body || {};
  await setTesterFlag({ actor: req.user, email, isTester: Boolean(isTester) });
  res.json({ ok: true });
}));

// Same two granters as the tester flag, and for the same reason: an Access
// Manager's remit is granting and revoking access, which is exactly what
// this is. requireRole here is the SECOND check — the ceiling is asserted
// in roles.js as well — and that duplication is deliberate.
router.post('/team-member', requireRole(['admin', 'access_manager']), asyncRoute(async (req, res) => {
  const { email, isTeamMember, desks } = req.body || {};
  const out = await setTeamMemberFlag({
    actor: req.user, email, isTeamMember: Boolean(isTeamMember), desks,
  });
  res.json(out);
}));

// The desks somebody can be given. Served rather than hardcoded in the page
// so the two cannot disagree, the same way the look catalogue is.
router.get('/desks', requireRole(['admin', 'access_manager']), asyncRoute(async (req, res) => {
  res.json({ desks: DESKS });
}));

/* ---------------- organizations ---------------- */

router.get('/', asyncRoute(async (req, res) => {
  // An admin sees every organization; everyone else sees the ones they
  // actually belong to and no others.
  if (isAdminish(req.user)) return res.json(await listOrganizations());
  return res.json(req.user.memberships || []);
}));

router.post('/', requireRole(['admin', 'access_manager']), asyncRoute(async (req, res) => {
  const { name, details, managerEmails } = req.body || {};
  const out = await createOrganization({
    actor: req.user, name, details, managerEmails: managerEmails || [],
  });
  if (out.ok) return res.status(201).json(out);
  const messages = {
    'name-required': 'Give the organization a name.',
    'manager-required': 'An organization needs at least one manager to run it.',
    'name-taken': 'An organization with that name already exists.',
  };
  return res.status(400).json({ error: messages[out.reason] || 'Refused' });
}));

router.get('/:id/members', asyncRoute(async (req, res) => {
  const mine = membershipRole(req.user, req.params.id);
  if (!isAdminish(req.user) && mine !== 'manager') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  res.json(await membersOf(Number(req.params.id)));
}));

/**
 * Adding somebody directly, without their agreeing to it.
 *
 * ADMIN AND ACCESS MANAGER ONLY, since invitations exist. A manager who
 * could still do this would be a manager who never has to ask, and the
 * invitation flow — a link, an accept screen, a membership only once
 * somebody has read what it means — would be a formality anybody could
 * route around.
 *
 * It stays for the two cases that genuinely need it: bootstrapping an
 * organization's first manager, who has nobody to invite them, and an admin
 * repairing something. Both are already audited.
 */
router.post('/:id/members', requireRole(['admin', 'access_manager']), asyncRoute(async (req, res) => {
  const mine = membershipRole(req.user, req.params.id);
  const actorIsManager = !isAdminish(req.user) && mine === 'manager';
  const { email, role } = req.body || {};
  const out = await addMember({
    actor: req.user, actorIsManager, organizationId: Number(req.params.id), email, role,
  });
  if (out.ok) return res.status(201).json(out);
  const messages = {
    'manager-cannot-promote': 'A manager cannot appoint another manager. Ask an admin or an Access Manager.',
    'email-required': 'Enter an email address.',
    'unknown-role': 'Unknown role.',
    'no-such-organization': 'No such organization.',
  };
  return res.status(403).json({ error: messages[out.reason] || 'Refused' });
}));

router.delete('/:id/members/:email', asyncRoute(async (req, res) => {
  const mine = membershipRole(req.user, req.params.id);
  const actorIsManager = !isAdminish(req.user) && mine === 'manager';
  if (!isAdminish(req.user) && mine !== 'manager') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const out = await removeMember({
    actor: req.user,
    actorIsManager,
    organizationId: Number(req.params.id),
    email: req.params.email,
  });
  if (out.ok) return res.json(out);
  const messages = {
    'last-manager': 'An organization must always have at least one manager. Appoint another before removing this one.',
    'manager-cannot-remove-manager': 'A manager cannot remove another manager. Ask an admin or an Access Manager.',
    'not-a-member': 'That address is not in this organization.',
  };
  return res.status(403).json({ error: messages[out.reason] || 'Refused' });
}));

router.post('/:id/details', asyncRoute(async (req, res) => {
  const mine = membershipRole(req.user, req.params.id);
  if (!isAdminish(req.user) && mine !== 'manager') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { details, logoKey } = req.body || {};
  await setOrganizationDetails({
    actor: req.user,
    organizationId: Number(req.params.id),
    details,
    logoKey,
    // An admin replacing an organization's presentation is a moderation
    // action against that organization, and it stays replaced.
    isAdminOverride: isAdminish(req.user) && mine !== 'manager',
  });
  res.json({ ok: true });
}));

/**
 * The Alliance listing, switched by the organization's own manager.
 *
 * An admin can also set it, the same way they can replace an
 * organization's presentation — but this is the organization's own claim
 * about itself, so the manager is the normal path and the one the copy is
 * written for.
 *
 * GET returns what listing publishes ALONGSIDE the current state, because
 * the toggle must say plainly what appears when it is on. "List us
 * publicly" is not an adequate question: the member count is an aggregate
 * about them that did not exist before they were asked, and agreeing to be
 * listed is not the same as agreeing to publish a headcount.
 */
router.get('/:id/listing', asyncRoute(async (req, res) => {
  const mine = membershipRole(req.user, req.params.id);
  if (!isAdminish(req.user) && mine !== 'manager') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { rows } = await pool.query(
    `SELECT o.listed, o.listed_at,
            (SELECT count(*) FROM organization_memberships m
              WHERE m.organization_id = o.id)::int AS member_count
       FROM organizations o WHERE o.id = $1`,
    [Number(req.params.id)],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json({
    listed: rows[0].listed,
    joined: rows[0].listed_at,
    memberCount: rows[0].member_count,
    directoryName: DIRECTORY_NAME,
    whatAppears: WHAT_APPEARS,
    disclaimer: DISCLAIMER,
    // Said here so the person deciding reads it at the moment they decide,
    // rather than finding out later that opting out did less than they
    // expected. It does less on purpose.
    whatOptingOutDoesNotDo: 'Leaving the directory does not remove this '
      + 'organization from the reports it has already filed. That provenance '
      + 'is part of each report and cannot be changed.',
  });
}));

router.post('/:id/listing', asyncRoute(async (req, res) => {
  const mine = membershipRole(req.user, req.params.id);
  if (!isAdminish(req.user) && mine !== 'manager') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { listed } = req.body || {};
  if (typeof listed !== 'boolean') {
    return res.status(400).json({ error: 'Say whether to list or not' });
  }
  const row = await setListed(Number(req.params.id), listed);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, listed: row.listed, joined: row.listed_at });
}));

/* ---------------- invitations ---------------- */

const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const INVITE_REFUSALS = {
  'unknown-role': 'That is not a role this organization can hand out.',
  'email-required': 'Enter a valid email address.',
  'no-such-organization': 'No such organization.',
  'already-a-member': 'That address is already in this organization.',
  'too-many-outstanding': `This organization already has ${MAX_OUTSTANDING_PER_ORG} invitations waiting. Revoke some before sending more.`,
  'too-many-to-this-address': `That address has already been invited ${MAX_PER_DAY_PER_EMAIL} times today. Try again tomorrow.`,
  'no-such-invitation': 'There is no invitation waiting for that address.',
  'nothing-awaiting-approval': 'There is no invitation waiting for approval for that address.',
};

/**
 * Send the link.
 *
 * Kept in one place so the manager path, the approval path and the resend
 * path cannot drift into describing the same invitation three ways. The
 * email says who invited them and what they are being invited to, because
 * the first question anybody asks an unexpected invitation is "from whom".
 */
async function mailInvitation({ email, token, role, organizationName, invitedBy }) {
  const url = `${SITE_ORIGIN}/invitation/${token}`;
  const what = ROLE_DESCRIPTIONS[role];
  return sendEmail({
    to: [{ email }],
    subject: `You have been invited to file reports for ${organizationName}`,
    html: `<p><b>${esc(invitedBy)}</b> has invited you to join
             <b>${esc(organizationName)}</b> on ReportLog as a
             ${esc(what ? what.label.toLowerCase() : role)}.</p>
           <p><a href="${esc(url)}">Open the invitation</a> to see exactly what that
              means and decide. Nothing happens until you do.</p>
           <p>The link works once and expires in seven days.</p>
           <p style="color:#666;font-size:13px">If you were not expecting this, ignore it.
              Nothing is created for you and nobody is told either way.</p>`,
  });
}

// Pending and accepted, so a manager can see what silence means. Silence is
// the only signal an invitee gives — there is deliberately no decline
// button — so a typo has to be recoverable from this screen alone.
router.get('/:id/invitations', asyncRoute(async (req, res) => {
  const mine = membershipRole(req.user, req.params.id);
  if (!isAdminish(req.user) && mine !== 'manager') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  res.json({
    invitations: await listInvitations(Number(req.params.id)),
    roles: ROLE_DESCRIPTIONS,
    maxOutstanding: MAX_OUTSTANDING_PER_ORG,
    maxPerDay: MAX_PER_DAY_PER_EMAIL,
    // Said rather than implied: a manager choosing "manager" should know
    // before pressing send that nobody is emailed yet.
    managerInvitesNeedApproval: true,
  });
}));

router.post('/:id/invitations', asyncRoute(async (req, res) => {
  const mine = membershipRole(req.user, req.params.id);
  const adminish = isAdminish(req.user);
  if (!adminish && mine !== 'manager') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { email, role } = req.body || {};

  // The ceiling, checked at the route as well as in the module. Two checks
  // for one rule is the discipline src/roles.js already follows, and this
  // is a new door into role granting.
  if (!ORG_ROLES.includes(role)) {
    return res.status(400).json({ error: INVITE_REFUSALS['unknown-role'] });
  }

  const out = await createInvitation({
    actor: req.user,
    actorIsManager: !adminish && mine === 'manager',
    organizationId: Number(req.params.id),
    email,
    role,
  });
  if (!out.ok) {
    return res.status(out.reason === 'no-such-organization' ? 404 : 400)
      .json({ error: INVITE_REFUSALS[out.reason] || 'Refused' });
  }

  if (out.requiresApproval) {
    return res.json({
      ok: true,
      awaitingApproval: true,
      message: 'Inviting another manager needs an administrator to approve it. '
        + 'Nothing has been emailed yet.',
    });
  }

  const sent = await mailInvitation({
    email: out.email, token: out.token, role,
    organizationName: out.organizationName, invitedBy: req.user.email,
  });
  if (!sent.sent && sent.reason === 'no-api-key') {
    console.log(`[invitations] link for ${out.email}: ${SITE_ORIGIN}/invitation/${out.token}`);
  }
  res.json({ ok: true, emailed: !!sent.sent });
}));

// Revoke. Deliberately the same statement removeMember already uses for a
// pending invite, so there is one way an invitation stops existing.
router.delete('/:id/invitations/:email', asyncRoute(async (req, res) => {
  const mine = membershipRole(req.user, req.params.id);
  if (!isAdminish(req.user) && mine !== 'manager') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { rowCount } = await pool.query(
    'DELETE FROM organization_invites WHERE organization_id = $1 AND email = $2',
    [Number(req.params.id), String(req.params.email).trim().toLowerCase()],
  );
  res.json({ ok: true, revoked: rowCount });
}));

router.post('/:id/invitations/:email/resend', asyncRoute(async (req, res) => {
  const mine = membershipRole(req.user, req.params.id);
  if (!isAdminish(req.user) && mine !== 'manager') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const out = await resendInvitation({
    organizationId: Number(req.params.id), email: req.params.email,
  });
  if (!out.ok) return res.status(400).json({ error: INVITE_REFUSALS[out.reason] || 'Refused' });

  const { rows } = await pool.query('SELECT name FROM organizations WHERE id = $1', [Number(req.params.id)]);
  const sent = await mailInvitation({
    email: out.email, token: out.token, role: out.role,
    organizationName: rows[0]?.name || '', invitedBy: req.user.email,
  });
  if (!sent.sent && sent.reason === 'no-api-key') {
    console.log(`[invitations] link for ${out.email}: ${SITE_ORIGIN}/invitation/${out.token}`);
  }
  res.json({ ok: true, emailed: !!sent.sent });
}));

// Approving a manager invitation is an ADMIN action, not a manager one.
// This is the leadership grant the whole approval step exists for.
router.post('/:id/invitations/:email/approve', requireRole(['admin', 'access_manager']),
  asyncRoute(async (req, res) => {
    const out = await approveInvitation({
      actor: req.user, organizationId: Number(req.params.id), email: req.params.email,
    });
    if (!out.ok) return res.status(400).json({ error: INVITE_REFUSALS[out.reason] || 'Refused' });

    const { rows } = await pool.query('SELECT name FROM organizations WHERE id = $1', [Number(req.params.id)]);
    const sent = await mailInvitation({
      email: out.email, token: out.token, role: out.role,
      organizationName: rows[0]?.name || '', invitedBy: req.user.email,
    });
    if (!sent.sent && sent.reason === 'no-api-key') {
      console.log(`[invitations] link for ${out.email}: ${SITE_ORIGIN}/invitation/${out.token}`);
    }
    res.json({ ok: true, emailed: !!sent.sent });
  }));

/* ---------------- oversight ---------------- */

// Deliberately no automated flagging on submission volume: high volume is
// the entire point of the coordinator role, and flagging it would fight
// the design. Oversight is a person reading this instead.
router.get('/roster', requireRole(['admin', 'access_manager']), asyncRoute(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const { rows } = await pool.query(
    `SELECT u.email, u.role, u.is_tester, u.is_team_member, u.desks,
       coalesce(string_agg(DISTINCT o.name || ' (' || m.role || ')', ', '), '') AS organizations,
       (SELECT count(*) FROM reports r
          WHERE r.organization_id = ANY (
            SELECT organization_id FROM organization_memberships WHERE user_id = u.id)
            AND r.received_at > now() - ($1 || ' days')::interval) AS org_reports,
       (SELECT max(a.accessed_at) FROM access_log a WHERE a.staff_email = u.email) AS last_staff_action
     FROM users u
     LEFT JOIN organization_memberships m ON m.user_id = u.id
     LEFT JOIN organizations o ON o.id = m.organization_id
     WHERE u.role <> 'user' OR m.id IS NOT NULL
     GROUP BY u.id
     ORDER BY u.role, u.email`,
    [String(days)],
  );
  res.json({ days, people: rows });
}));

router.get('/audit', requireRole(['admin', 'access_manager']), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.actor_email, a.subject_email, a.axis, a.action, a.detail, a.created_at, o.name AS organization
     FROM role_audit a LEFT JOIN organizations o ON o.id = a.organization_id
     ORDER BY a.created_at DESC LIMIT 500`,
  );
  res.json(rows);
}));

export default router;

/* ---------------- the owner's seat, and handing it on ----------------- */

/**
 * Who holds the seat, and whether a handover is in flight.
 *
 * TWO ANSWERS, because two very different people need this route.
 *
 * Staff — an administrator or an Access Manager — get the whole picture. A
 * pending handover is exactly the kind of thing they should not discover
 * after the fact.
 *
 * EVERYBODY ELSE GETS ONLY WHETHER IT CONCERNS THEM. The seat can be
 * offered to somebody holding no role at all, so an ordinary signed-in
 * person has to be able to learn there is a button waiting for them. That
 * is not a reason to tell every reporter with an account who runs the
 * deployment and what their email address is. Staff addresses are not
 * public here and this route is not the place they start being.
 */
router.get('/owner', asyncRoute(async (req, res) => {
  const pending = await pendingTransfer();
  const me = normalizeEmail(req.user.email);
  const awaitingMyAcceptance = !!pending && normalizeEmail(pending.to_email) === me;

  if (!isAdminish(req.user)) return res.json({ awaitingMyAcceptance });

  const owner = await currentOwner();
  res.json({
    owner,
    iAmOwner: req.user.role === 'owner',
    pending: pending
      ? { from: pending.from_email, to: pending.to_email, expiresAt: pending.expires_at }
      : null,
    awaitingMyAcceptance,
  });
}));

/**
 * A one-time code to the OWNER'S OWN ADDRESS, before they may offer the seat.
 *
 * WHY A CODE AT ALL, when this route already requires the owner's session.
 * Every other setting on the admin page can be undone by whoever holds the
 * seat. This one cannot: once the recipient accepts, only they can appoint
 * administrators and only they can hand it on again. So the session cookie is
 * not enough on its own — it proves somebody signed in as the owner at some
 * point in the last day, on a laptop that may now be unattended, shared or
 * stolen. A code proves somebody holding the owner's mailbox is at the
 * keyboard right now, which is the one thing a borrowed session cannot
 * supply. The interface asks twice before it even gets here; those two are
 * doors a person can click through, and this one is not.
 *
 * IT GOES TO THE GIVER, NOT THE RECIPIENT. This is proof of who is giving the
 * deployment away. The recipient proves themselves by accepting, which is the
 * other half of the two-party handover and is unchanged.
 *
 * Rate-limited like every other code route, and for the same reason.
 */
const handoverCodeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5, keyGenerator: (req) => req.ip,
});

/* The code is bound to BOTH addresses — see handoverCodeSubject in
   src/ownership.js, which says why and is shared with the suite. */

/* The recipient's address goes into an HTML email. looksLikeEmail has already
   refused anything with a bracket in it, so this is the second layer rather
   than the only one — but an address is somebody's input and it is not this
   route's job to know that the validator upstream can never change. */
const escapeForEmail = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

router.post('/owner/transfer/code', handoverCodeLimiter, asyncRoute(async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can hand the deployment on.' });
  }
  const email = normalizeEmail(req.user.email);
  // CHECKED BEFORE A CODE IS MINTED. A code bound to an address that could
  // never receive the seat is a code that fails at the last step for a reason
  // the operator was not told about two screens earlier.
  const to = normalizeEmail((req.body || {}).email);
  if (!looksLikeEmail(to)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (to === email) return res.status(400).json({ error: 'You already hold it.' });

  const code = await createCode(handoverCodeSubject(email, to));
  const result = await sendEmail({
    to: [{ email }],
    subject: 'Code to hand this deployment over',
    html: `<p>Somebody signed in as the owner of this deployment is handing it over to`
      + ` <b>${escapeForEmail(to)}</b>, and the code to do it is <b>${code}</b>. It expires in`
      + ` 10 minutes.</p>`
      + `<p>This code works for that address and no other. Handing it to somebody else`
      + ` needs a new code, so this message is the record of where the seat was sent.</p>`
      + `<p><b>If that was not you, do not enter this code anywhere and change how you`
      + ` sign in.</b> Handing the deployment over cannot be undone once the other person`
      + ` accepts: only they can appoint administrators afterwards, and only they can hand`
      + ` the seat on again.</p>`,
  });
  // The same fallback the sign-in code takes, and it matters more here: a
  // deployment with no email provider configured yet still has to be able to
  // hand itself over, and the operator is the person reading the log.
  if (!result.sent && result.reason === 'no-api-key') {
    console.log(`[owner] handover code for ${email}: ${code}`
      + ' (would have emailed — no email provider key configured yet)');
  }
  res.json({ ok: true, sentTo: email });
}));

router.post('/owner/transfer', asyncRoute(async (req, res) => {
  // THE ROLE CHECK FIRST, then the code. proposeTransfer refuses a
  // non-owner anyway, but checking the code before the role would let anybody
  // signed in burn a code against their own address and learn nothing, and
  // would make the two refusals arrive in a confusing order.
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can hand the deployment on.' });
  }
  // BEFORE proposeTransfer, so a correct address with a wrong code writes
  // nothing at all. verifyCode marks the code used, so a code cannot be
  // replayed to offer the seat twice.
  const code = (req.body || {}).code;
  if (!code) return res.status(400).json({ error: 'Enter the code sent to your address.' });
  // VERIFIED AGAINST THIS RECIPIENT, so the address in the owner's mailbox and
  // the address the seat actually goes to cannot differ.
  const to = normalizeEmail((req.body || {}).email);
  if (!await verifyCode(handoverCodeSubject(req.user.email, to), code)) {
    return res.status(401).json({
      error: 'That code is wrong, has expired, or was sent for a different address.'
        + ' Request another for this one.',
    });
  }

  const out = await proposeTransfer({ actor: req.user, email: (req.body || {}).email });
  if (out.ok) return res.json(out);
  const messages = {
    'not-owner': 'Only the owner can hand the deployment on.',
    self: 'You already hold it.',
    'bad-email': 'Enter a valid email address.',
  };
  return res.status(403).json({ error: messages[out.reason] || 'Refused' });
}));

router.delete('/owner/transfer', asyncRoute(async (req, res) => {
  const out = await cancelTransfer({ actor: req.user });
  if (out.ok) return res.json(out);
  return res.status(403).json({ error: 'Only the owner can cancel a handover.' });
}));

router.post('/owner/accept', asyncRoute(async (req, res) => {
  const out = await acceptTransfer({ actor: req.user });
  if (out.ok) return res.json(out);
  const messages = {
    'none-pending': 'There is no handover waiting.',
    expired: 'That handover has expired. Ask the owner to offer it again.',
    'not-yours': 'That handover was offered to a different address.',
  };
  return res.status(403).json({ error: messages[out.reason] || 'Refused' });
}));
