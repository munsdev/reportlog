/**
 * Step-up: the second factor again, good for five minutes, before the few
 * actions plan-e.md lists (decision E3). Ordinary moderation never asks.
 *
 * Guarded per scope, as the role guards are: each listed action's routes
 * sit in a scope of their own with `scope.addHook('preHandler',
 * stepUpGuard())`, so a route added to that scope later cannot forget to
 * ask. Register it AFTER the scope's role guard, so a person without the
 * role is told that, not asked for a code they cannot usefully give.
 *
 * The refusal is a 403 with the code `step_up_required`. The website's API
 * client (apps/web/src/lib/api.ts) answers it by asking for the factor and
 * trying the call once more.
 *
 * THE LIST, and where each is guarded (stepUp.test.ts walks it):
 *   - opening a reporter's email          moderation/routes.ts
 *   - a tipster's email                   (no route opens one: decision 40)
 *   - approving, rejecting or removing a journalist   journalists/routes.ts
 *   - granting or removing a role         identity/accessRoutes.ts, orgRoutes.ts
 *   - resetting a second factor           identity/secondFactorRoutes.ts
 *   - pausing intake                      filing/routes.ts, moderation/floodRoutes.ts
 *   - the puzzle switch, bulk decline     moderation/floodRoutes.ts
 *   - exports and backups                 anchor/copies.ts, anchor/routes.ts
 *   - publishing an agreement             moderation/platformRoutes.ts
 */
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { HttpError } from '../http/errors.ts';
import { requireUser } from './guards.ts';
import { stepUpFresh } from './secondFactor.ts';

export const stepUpRequired = () =>
  new HttpError(
    403,
    'step_up_required',
    'Confirm it is you first: enter a code from your authenticator app, or use a passkey.',
  );

export function requireStepUp(request: FastifyRequest): void {
  const user = requireUser(request);
  if (!stepUpFresh(user.stepUpAt)) throw stepUpRequired();
}

export function stepUpGuard(): preHandlerAsyncHookHandler {
  return (request) => {
    requireStepUp(request);
    return Promise.resolve();
  };
}
