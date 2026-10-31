/**
 * The alert list's routes. Signing up is behind the site password like the
 * rest of the site; the links that arrive by email (confirm, stop, settings) are in
 * front of it (identity/gate.ts, IN_FRONT), because a link in an email must
 * not depend on a password the person may not have. Opening either changes
 * nothing; only the POST does. The access request link is another such link.
 *
 * Three signed-in scopes, each guarded once, so a route added to one later
 * cannot forget to ask: any signed-in account's own alerts and request
 * (`requireUser`, decision 80), the queue of those who decide
 * (`roleGuard(['admin', 'access_manager'])`, which the owner satisfies) and
 * the desk (`deskGuard`: the journalist role and the accepted agreement).
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
import { applyMine, changeMine, mine } from './account.ts';
import { boardQuery } from '../board/routes.ts';
import { boardPage } from '../board/board.ts';
import { json } from '../moderation/json.ts';
import { deskExtras, deskGuard, deskLinkPage, deskSourcePage, deskTextPage } from './desk.ts';
import {
  applyConfirm,
  deskStates,
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

  // ── Decision 80: a signed-in account, for its own address only ──────────
  // Not a door call and needs no role. Emails go out here, so bound them.
  const perAccount = limiter({ max: 20, windowMs: 60 * 60 * 1000 });
  void app.register((account, _opts, done) => {
    account.addHook('preHandler', (request) => {
      requireUser(request);
      return Promise.resolve();
    });
    route(account, C.getMyJournalist, ({ request }) => mine(listDeps(), requireUser(request)));
    route(account, C.changeMyAlerts, ({ request }) => {
      const user = requireUser(request);
      perAccount.take(user.email);
      return changeMine(listDeps(), user, bodyOf(C.changeMyAlerts, request));
    });
    route(account, C.applyForDesk, ({ request }) => {
      const user = requireUser(request);
      perAccount.take(user.email);
      return applyMine(listDeps(), user, bodyOf(C.applyForDesk, request));
    });
    done();
  });

  // ── J7b, J7, J13: the queue, for the owner, administrators and Access Managers ──
  void app.register((owner, _opts, done) => {
    owner.addHook('preHandler', roleGuard(['admin', 'access_manager']));
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
      route(decide, C.rejectAccessRequest, async ({ params, request }) => {
        await reject(listDeps(), Number(params.id), requireUser(request).email);
        return { ok: true as const };
      });
      route(decide, C.revokeJournalist, async ({ params, request }) => {
        await revoke(listDeps(), Number(params.id), {
          email: requireUser(request).email,
          roles: requireUser(request).roles,
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
    // "My states" is read from the signed-in account, never from the request.
    const filterOf = async (
      query: { q?: string | undefined; mine?: string | undefined },
      email: string,
    ) => ({
      q: query.q,
      states: query.mine === 'true' ? await deskStates(deps.db, needRing(), email) : undefined,
    });
    route(desk, C.deskLinks, async ({ query, request }) => {
      const email = requireUser(request).email;
      return deskLinkPage(
        deps.db,
        await needKeys(),
        email,
        query.page === undefined ? undefined : Number(query.page),
        await filterOf(query, email),
      );
    });
    route(desk, C.deskTexts, async ({ query, request }) => {
      const email = requireUser(request).email;
      return deskTextPage(
        deps.db,
        await needKeys(),
        email,
        query.page === undefined ? undefined : Number(query.page),
        await filterOf(query, email),
      );
    });
    route(desk, C.deskSources, async ({ query, request }) => {
      const email = requireUser(request).email;
      return deskSourcePage(
        deps.db,
        email,
        query.page === undefined ? undefined : Number(query.page),
        await filterOf(query, email),
      );
    });
    // The journalists' reports list (decision 81): the board's own list, with
    // "My states" from the account and each report's Sources and note.
    route(desk, C.deskReports, async ({ query, request }) => {
      const user = requireUser(request);
      const states =
        query.mine === 'true' ? await deskStates(deps.db, needRing(), user.email) : undefined;
      const page = await boardPage(deps.db, {
        ...boardQuery(query),
        ...(states ? { states } : {}),
      });
      if (!page.published || 'withheld' in page) return json(page);
      const extras = await deskExtras(
        deps.db,
        user.email,
        page.reports.map((r) => r.public_ref),
      );
      return json({ ...page, extras });
    });
    route(desk, C.deskReportExtras, async ({ params, request }) => ({
      extras:
        (await deskExtras(deps.db, requireUser(request).email, [params.ref]))[params.ref] ?? null,
    }));
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
