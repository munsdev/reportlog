/**
 * The alert list's routes. Signing up is behind the site password like the
 * rest of the site; the two links that arrive by email (confirm, stop) are in
 * front of it (identity/gate.ts, IN_FRONT), because a link in an email must
 * not depend on a password the person may not have. Opening either changes
 * nothing; only the POST does.
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
import { limiter } from '../identity/limiter.ts';
import { applyConfirm, applyStop, describeConfirm, describeStop, signUp } from './list.ts';

export interface JournalistRouteDeps {
  db: Kysely<DB>;
  mailer: Mailer;
  siteOrigin: string;
  contactKey: string | undefined;
  previousContactKey?: string | undefined;
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
    await signUp(
      { db: deps.db, mailer: deps.mailer, siteOrigin: deps.siteOrigin, ring: needRing() },
      body,
    );
    return { ok: true as const };
  });

  route(app, C.describeAlertConfirm, ({ params }) =>
    describeConfirm(deps.db, needRing(), params.token),
  );
  route(app, C.confirmAlerts, ({ params }) => applyConfirm(deps.db, needRing(), params.token));
  route(app, C.describeAlertStop, ({ params }) => describeStop(deps.db, needRing(), params.token));
  route(app, C.stopAlerts, ({ params }) => applyStop(deps.db, params.token));
}
