/**
 * The alert list's routes. Signing up is behind the site password like the
 * rest of the site; the links that arrive by email (confirm, stop, settings) are in
 * front of it (identity/gate.ts, IN_FRONT), because a link in an email must
 * not depend on a password the person may not have. Opening either changes
 * nothing; only the POST does. The access request link is another such link.
 *
 * Two signed-in scopes, each guarded once, so a route added to one later
 * cannot forget to ask: the owner's queue (`roleGuard(['owner'])`) and the
 * desk (`deskGuard`: the journalist role and the accepted agreement).
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { keyringFrom } from '../filing/contactKeys.ts';
import { HttpError } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { bodyOf } from '../identity/http.ts';
import { requireUser, roleGuard } from '../identity/guards.ts';
import { stepUpGuard } from '../identity/stepUp.ts';
import { limiter } from '../identity/limiter.ts';
import type { LinkKeys } from '../links/keys.ts';
import { deskGuard, deskLinkPage, deskSourcePage } from './desk.ts';
import {
  applyConfirm,
  applyStop,
  changeDeskSettings,
  changeSettings,
  describeConfirm,
  describeSettings,
  describeStop,
  deskSettings,
  removeByLink,
  requestFromSettings,
  signUp,
} from './list.ts';
import {
  approve,
  askForLink,
  describeAccess,
  reject,
  requestsForOwner,
  revoke,
  submitRequest,
} from './vetting.ts';

export interface JournalistRouteDeps {
  db: Kysely<DB>;
  mailer: Mailer;
  siteOrigin: string;
  contactKey: string | undefined;
  previousContactKey?: string | undefined;
  /** The link keys, for the desk; null without CONTACT_KEY. */
  linkKeys: (() => Promise<LinkKeys>) | null;
}

export function journalistRoutes(app: FastifyInstance, deps: JournalistRouteDeps): void {
  const ring = deps.contactKey ? keyringFrom(deps.contactKey, deps.previousContactKey) : null;
  if (!ring) {
    app.log.warn('CONTACT_KEY is not set: the journalist alert list is closed until it is.');
  }
  const needRing = () => {
    if (!ring) {
      throw new HttpError(
        503,
        'not_configured',
        'The alert list is not open on this site yet. The operator has not finished setting it up.',
      );
    }
    return ring;
  };
  // An email is sent per signup, so it is the thing to bound: per client and per address.
  const perClient = limiter({ max: 10, windowMs: 15 * 60 * 1000 });
  const perAddress = limiter({ max: 3, windowMs: 60 * 60 * 1000 });

  route(app, C.signUpForAlerts, async ({ request }) => {
    const body = bodyOf(C.signUpForAlerts, request);
    perClient.take(request.ip);
    perAddress.take(body.email.trim().toLowerCase());
    const listDeps = {
      db: deps.db,
      mailer: deps.mailer,
      siteOrigin: deps.siteOrigin,
      ring: needRing(),
    };
    // Already on the list and asking for desk access: the request link,
    // emailed as /journalists/access would. The answer is the same either way.
    if ((await signUp(listDeps, body)) === 'listed' && body.access) {
      await askForLink(listDeps, body.email);
    }
    return { ok: true as const };
  });

  route(app, C.describeAlertConfirm, ({ params }) =>
    describeConfirm(deps.db, needRing(), params.token),
  );
  route(app, C.confirmAlerts, ({ params }) => applyConfirm(deps.db, needRing(), params.token));
  route(app, C.describeAlertStop, ({ params }) => describeStop(deps.db, needRing(), params.token));
  route(app, C.stopAlerts, ({ params }) => applyStop(deps.db, needRing(), params.token));
  route(app, C.describeAlertSettings, ({ params }) =>
    describeSettings(deps.db, needRing(), params.token),
  );
  route(app, C.changeAlertSettings, ({ params, request }) =>
    changeSettings(deps.db, needRing(), params.token, bodyOf(C.changeAlertSettings, request)),
  );
  route(app, C.requestAccessFromSettings, ({ params, request }) =>
    requestFromSettings(
      deps.db,
      needRing(),
      params.token,
      bodyOf(C.requestAccessFromSettings, request),
    ),
  );
  route(app, C.leaveAlertList, ({ params }) => removeByLink(deps.db, params.token));

  const listDeps = () => ({
    db: deps.db,
    mailer: deps.mailer,
    siteOrigin: deps.siteOrigin,
    ring: needRing(),
  });

  // ── J7a: asking for access ──────────────────────────────────────────────
  route(app, C.askForAccessLink, async ({ request }) => {
    const body = bodyOf(C.askForAccessLink, request);
    perClient.take(request.ip);
    perAddress.take(body.email.trim().toLowerCase());
    await askForLink(listDeps(), body.email);
    return { ok: true as const };
  });
  route(app, C.describeAccessLink, ({ params }) => describeAccess(listDeps(), params.token));
  route(app, C.requestAccess, ({ params, request }) =>
    submitRequest(listDeps(), params.token, bodyOf(C.requestAccess, request)),
  );

  // ── J7b, J7, J13: the owner's queue ─────────────────────────────────────
  void app.register((owner, _opts, done) => {
    owner.addHook('preHandler', roleGuard(['owner']));
    route(owner, C.listAccessRequests, async () => ({
      requests: await requestsForOwner(listDeps()),
    }));
    // Approving, rejecting or removing a journalist asks for the second
    // factor again (plan E, E3): a scope of their own, so none can forget.
    void owner.register((decide, _o, decided) => {
      decide.addHook('preHandler', stepUpGuard());
      route(decide, C.approveAccessRequest, async ({ params, request }) => {
        await approve(listDeps(), Number(params.id), requireUser(request).email);
        return { ok: true as const };
      });
      route(decide, C.rejectAccessRequest, async ({ params }) => {
        await reject(listDeps(), Number(params.id));
        return { ok: true as const };
      });
      route(decide, C.revokeJournalist, async ({ params, request }) => {
        await revoke(listDeps(), Number(params.id), {
          email: requireUser(request).email,
          role: 'owner',
        });
        return { ok: true as const };
      });
      decided();
    });
    done();
  });

  // ── J9 to J12: the desk ─────────────────────────────────────────────────
  const needKeys = async () => {
    if (!deps.linkKeys) {
      throw new HttpError(
        503,
        'no_contact_key',
        'This site has no CONTACT_KEY yet, so it keeps no links. Tell whoever runs the server.',
      );
    }
    return deps.linkKeys();
  };
  void app.register((desk, _opts, done) => {
    desk.addHook('preHandler', deskGuard(deps.db));
    route(desk, C.deskLinks, async ({ query, request }) =>
      deskLinkPage(
        deps.db,
        await needKeys(),
        requireUser(request).email,
        query.page === undefined ? undefined : Number(query.page),
      ),
    );
    route(desk, C.deskSources, ({ query, request }) =>
      deskSourcePage(
        deps.db,
        requireUser(request).email,
        query.page === undefined ? undefined : Number(query.page),
      ),
    );
    // Their own alerts only: found by the signed-in account's address.
    route(desk, C.deskAlertSettings, ({ request }) =>
      deskSettings(deps.db, needRing(), requireUser(request).email),
    );
    route(desk, C.changeDeskAlerts, ({ request }) =>
      changeDeskSettings(
        deps.db,
        needRing(),
        requireUser(request).email,
        bodyOf(C.changeDeskAlerts, request),
      ),
    );
    done();
  });
}
