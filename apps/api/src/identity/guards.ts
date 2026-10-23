/**
 * Guarding a route by who is asking.
 *
 * Rank comes from @reportlog/access (`roleSatisfies`), so a route asking for
 * `admin` admits the owner without every guard having to name the owner, and
 * admin still does not imply moderator. A person may hold several roles; a
 * guard admits them when ANY one satisfies any one of the roles it lists.
 */
import { roleSatisfies } from '@reportlog/access';
import type { SystemRole } from '@reportlog/access';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { HttpError } from '../http/errors.ts';
import type { SignedIn } from './sessions.ts';

export const notSignedIn = () =>
  new HttpError(401, 'not_signed_in', 'Sign in first. This page is for people with an account.');

export const notAllowed = (message = 'Your account is not allowed to do that.') =>
  new HttpError(403, 'forbidden', message);

export function requireUser(request: FastifyRequest): SignedIn {
  if (!request.user) throw notSignedIn();
  return request.user;
}

export function requireRole(request: FastifyRequest, roles: readonly SystemRole[]): SignedIn {
  const user = requireUser(request);
  if (!roles.some((r) => roleSatisfies(user.roles, r))) throw notAllowed();
  return user;
}

/** Administrators and Access Managers: the people who grant access. */
export function grantsAccess(user: SignedIn): boolean {
  return roleSatisfies(user.roles, 'admin') || user.roles.includes('access_manager');
}

export function requireGranter(request: FastifyRequest): SignedIn {
  return requireRole(request, ['admin', 'access_manager']);
}

/**
 * The same check as a Fastify hook, for a whole scope of routes at once. A
 * scope guarded once cannot have a route added to it that forgets to ask.
 */
export function roleGuard(roles: readonly SystemRole[]): preHandlerAsyncHookHandler {
  return (request) => {
    requireRole(request, roles);
    return Promise.resolve();
  };
}
