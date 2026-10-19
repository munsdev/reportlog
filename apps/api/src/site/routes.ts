/**
 * The site's routes. Two registrations, because the two halves need
 * different things:
 *
 *   siteRoutes       what every page reads. Public for now; behind the
 *                    site password once workstream A builds the gate
 *                    (only the manifest stays outside it).
 *   siteAdminRoutes  the settings screens' writes. It cannot be registered
 *                    without a guard: `requireAdmin` is a required argument,
 *                    so there is no way to mount these routes open by
 *                    leaving something out. Until sign-in exists there is
 *                    no guard to pass, and app.ts does not register them.
 */
import {
  getLegal,
  getSite,
  getSiteEditor,
  getWebManifest,
  setCopy,
  setLegalText,
  setLook,
  setSiteName,
} from '@reportlog/contracts';
import type { RouteContract } from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { z } from 'zod';
import type { Database } from '../db/database.ts';
import { HttpError } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { validateCopy } from './copy.ts';
import { validateSiteName } from './identity.ts';
import { validateLegalText } from './legal.ts';
import { validateLook } from './look.ts';
import { buildManifest } from './manifest.ts';
import { readSettings, writeCopy, writeSettings } from './settings.ts';
import { editorState, legalFrom, publicSite } from './site.ts';
import type { Checked } from './result.ts';

export function siteRoutes(app: FastifyInstance, db: Database): void {
  route(app, getSite, ({ reply }) => {
    void reply.header('cache-control', 'no-cache');
    return publicSite(db);
  });
  route(app, getLegal, async ({ reply }) => {
    // Short: an operator who just corrected their policy should not find the
    // old one served an hour later.
    void reply.header('cache-control', 'no-cache');
    return legalFrom(await readSettings(db));
  });
  route(app, getWebManifest, async ({ reply }) => {
    void reply.type('application/manifest+json');
    const site = await publicSite(db);
    return buildManifest(site.plain_name, site.look);
  });
}

/**
 * The route wrapper hands a handler its params and query but not its body,
 * so the body is read through the contract's own schema. Fastify has already
 * validated it with the same schema; this is the typed read, not a second
 * check.
 */
function bodyOf<B extends z.ZodType>(
  contract: RouteContract<z.ZodType, z.ZodType, B>,
  request: FastifyRequest,
): z.infer<B> {
  if (!contract.body) throw new Error(`${contract.path} has no body schema`);
  return contract.body.parse(request.body);
}

function accept<T>(checked: Checked<T>): T {
  if (!checked.ok) throw new HttpError(400, 'refused', checked.error);
  return checked.value;
}

export interface SiteAdminDeps {
  /** Refuses anybody who is not an administrator. Required: there is no unguarded form. */
  requireAdmin: preHandlerAsyncHookHandler;
}

export async function siteAdminRoutes(
  app: FastifyInstance,
  db: Database,
  { requireAdmin }: SiteAdminDeps,
): Promise<void> {
  await app.register((scoped, _opts, done) => {
    scoped.addHook('preHandler', requireAdmin);

    route(scoped, getSiteEditor, () => editorState(db));

    route(scoped, setLook, async ({ request }) => {
      const look = accept(validateLook(bodyOf(setLook, request)));
      await writeSettings(db, look);
      return editorState(db);
    });

    route(scoped, setSiteName, async ({ request }) => {
      const name = accept(validateSiteName(bodyOf(setSiteName, request).name));
      await writeSettings(db, { site_name: name });
      return editorState(db);
    });

    route(scoped, setCopy, async ({ params, request }) => {
      const { key, body } = accept(validateCopy(params.key, bodyOf(setCopy, request).body));
      await writeCopy(db, key, body);
      return editorState(db);
    });

    route(scoped, setLegalText, async ({ params, request }) => {
      const text = accept(validateLegalText(bodyOf(setLegalText, request).text));
      await writeSettings(
        db,
        params.kind === 'impressum' ? { impressum_text: text } : { privacy_text: text },
      );
      return editorState(db);
    });

    done();
  });
}
