/**
 * The invitee's side of an invitation.
 *
 * Separate from /api/orgs because that router requires an authenticated
 * user with a membership, and the whole point of this is that the person
 * following the link has neither yet. Looking at an invitation needs no
 * account at all; accepting one needs the account the invitation names.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { describeInvitation, acceptInvitation } from '../invitations.js';
import { requireAuth } from '../authMiddleware.js';
import { asyncRoute } from '../asyncRoute.js';

const router = express.Router();

// The link is a credential, so looking one up is a guessing surface. The
// token is 32 random bytes, which is not guessable, but a limit costs
// nothing and a log of the attempts is worth having.
const lookLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, keyGenerator: (req) => req.ip });

/**
 * LOOKING IS NOT ACCEPTING.
 *
 * This reads the invitation without consuming it, so the accept screen can
 * say which organization, which role, who invited them and what that role
 * can see BEFORE they press anything. Nobody should discover, after
 * clicking a link in an email, that they can now read restricted material.
 *
 * A mail client prefetching the link therefore does nothing at all, which
 * is the other reason accepting is a separate POST.
 */
router.get('/:token', lookLimiter, asyncRoute(async (req, res) => {
  const invitation = await describeInvitation(req.params.token);
  if (!invitation) {
    // One answer for expired, revoked, already used and never existed. The
    // person reading it can do nothing different in any of those cases, and
    // distinguishing them tells a stranger which tokens were once real.
    return res.status(404).json({
      error: 'This invitation is not valid any more. It may have been used, '
        + 'withdrawn, or simply expired — ask whoever invited you to send another.',
    });
  }
  res.json(invitation);
}));

router.post('/:token/accept', requireAuth, asyncRoute(async (req, res) => {
  const out = await acceptInvitation({
    token: req.params.token, userId: req.user.id, email: req.user.email,
  });
  if (out.ok) return res.json(out);

  if (out.reason === 'wrong-account') {
    // Worth saying precisely, because it is the one failure the person can
    // actually fix, and the alternative is somebody signing in and out
    // guessing at which address was invited.
    return res.status(403).json({
      error: `This invitation was sent to ${out.invitedEmail}. You are signed in as `
        + `${req.user.email}. Sign in as the invited address to accept it.`,
    });
  }
  res.status(404).json({
    error: 'This invitation is not valid any more. It may have been used, '
      + 'withdrawn, or simply expired — ask whoever invited you to send another.',
  });
}));

export default router;
