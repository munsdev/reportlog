/**
 * The site's routes that depend on who is asking: email updates for anybody
 * signed in, and an organization's place in the directory for its managers.
 * Plus the directory itself, which is public (behind the site password, like
 * every page: an organization opting in before the site is open would be
 * published beside a site nobody can see yet, and that cannot be taken back).
 */
import {
  getDirectory,
  getListing,
  getNotifications,
  setListing,
  setNotifications,
} from '@reportlog/contracts';
import { DIRECTORY_DISCLAIMER, DIRECTORY_NAME } from '@reportlog/contracts';
import { hasAdminAuthority } from '@reportlog/access';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../db/database.ts';
import { route } from '../http/route.ts';
import { notAllowed, requireUser } from '../identity/guards.ts';
import { bodyOf } from '../identity/http.ts';
import { directory, listing, setListed } from './directory.ts';
import { notificationsFor, setNotifications as save } from './notifications.ts';

/**
 * An organization's listing is its own claim about itself, so its managers
 * decide. An administrator may too, as they may change its other details.
 */
function requireManagerOf(request: FastifyRequest, organizationId: number) {
  const user = requireUser(request);
  const manages = user.memberships.some(
    (m) => m.organization_id === organizationId && m.role === 'manager',
  );
  if (!manages && !hasAdminAuthority(user.role)) {
    throw notAllowed('Only a manager of this organization can change whether it is listed.');
  }
  return user;
}

export function sitePeopleRoutes(app: FastifyInstance, db: Database): void {
  route(app, getDirectory, async () => ({
    name: DIRECTORY_NAME,
    disclaimer: DIRECTORY_DISCLAIMER,
    organizations: await directory(db),
  }));

  route(app, getListing, ({ params, request }) => {
    requireManagerOf(request, Number(params.id));
    return listing(db, Number(params.id));
  });

  route(app, setListing, async ({ params, request }) => {
    requireManagerOf(request, Number(params.id));
    await setListed(db, Number(params.id), bodyOf(setListing, request).listed);
    return listing(db, Number(params.id));
  });

  route(app, getNotifications, ({ request }) => notificationsFor(db, requireUser(request).id));

  route(app, setNotifications, ({ request }) =>
    save(db, requireUser(request).id, bodyOf(setNotifications, request)),
  );
}
