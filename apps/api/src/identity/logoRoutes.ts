/**
 * Organization logos over HTTP. Registered after the files context exists
 * (app.ts), because the bytes go through the files workstream's storage.
 *
 * The upload's body is the image itself, not JSON, read whole: a logo is at
 * most LOGO_MAX_BYTES, so buffering it is cheaper than streaming it twice.
 */
import * as C from '@reportlog/contracts';
import { LOGO_MAX_BYTES } from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Files } from '../files/context.ts';
import { sendObject } from '../files/routes.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { grantsAccess, notAllowed, requireUser } from './guards.ts';
import { logoToServe, NO_STORAGE, removeLogo, saveLogo } from './logos.ts';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'];

/** Its managers, or somebody who grants access: as for its other details. */
function requireLogoAuthority(request: FastifyRequest, organizationId: number) {
  const user = requireUser(request);
  const manager = user.memberships.some(
    (m) => m.organization_id === organizationId && m.role === 'manager',
  );
  const granter = grantsAccess(user);
  if (!manager && !granter) {
    throw notAllowed('Only a manager of this organization can change its logo.');
  }
  return { user, isAdminOverride: !manager };
}

export async function logoRoutes(
  app: FastifyInstance,
  { db, files }: { db: Kysely<DB>; files: Files | string },
): Promise<void> {
  const store = typeof files === 'string' ? null : files;
  const need = (): Files => {
    if (!store) throw new HttpError(503, 'no_storage', NO_STORAGE);
    return store;
  };

  await app.register((scope, _opts, done) => {
    // Only in this scope: everywhere else a body is JSON. The type here is
    // never trusted; the bytes are sniffed (logos.ts).
    scope.addContentTypeParser(
      IMAGE_TYPES,
      { parseAs: 'buffer', bodyLimit: LOGO_MAX_BYTES + 1 },
      (_req, body, next) => {
        next(null, body);
      },
    );
    // Too large is the uploader's to fix, so it gets a sentence like any other
    // refusal; everything else goes on to the app's own handler.
    scope.setErrorHandler((err) => {
      if ((err as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        throw new HttpError(
          413,
          'too_large',
          `That image is too large. A logo can be at most ${String(LOGO_MAX_BYTES / 1024 / 1024)} MB.`,
        );
      }
      throw err;
    });
    scope.route({
      method: 'PUT',
      url: C.uploadOrganizationLogo.path,
      bodyLimit: LOGO_MAX_BYTES + 1,
      handler: async (request) => {
        const id = Number((request.params as { id: string }).id);
        if (!Number.isInteger(id) || id <= 0) throw notFound('There is no such organization.');
        const { user, isAdminOverride } = requireLogoAuthority(request, id);
        const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        const logo = await saveLogo(need(), {
          organizationId: id,
          actorEmail: user.email,
          isAdminOverride,
          body,
        });
        return C.uploadOrganizationLogo.response.parse({ ok: true, logo });
      },
    });
    done();
  });

  route(app, C.removeOrganizationLogo, async ({ params, request }) => {
    const id = Number(params.id);
    const { user, isAdminOverride } = requireLogoAuthority(request, id);
    await removeLogo(store, db, { organizationId: id, actorEmail: user.email, isAdminOverride });
    return { ok: true as const };
  });

  // Behind the site password, like the directory it belongs to.
  app.get('/api/directory/logos/:file', async (request, reply) => {
    const { file } = request.params as { file: string };
    const user = request.user;
    const key = await logoToServe(
      db,
      file,
      (orgId) =>
        !!user &&
        (grantsAccess(user) ||
          user.memberships.some((m) => m.organization_id === orgId && m.role === 'manager')),
    );
    if (!key || !store) throw notFound('There is no such logo.');
    return sendObject(request, reply, {
      files: store,
      bucket: 'renditions',
      key,
      type: key.endsWith('.png') ? 'image/png' : 'image/jpeg',
    });
  });
}
