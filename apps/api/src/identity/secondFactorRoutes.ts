/**
 * The second factor's routes: proving it (to finish signing in, or as a
 * step-up), setting it up, and the owner's reset.
 *
 * Every route here acts on the ASKING SESSION'S OWN account, read from the
 * session and never from the body, except the owner's reset. Codes and
 * secrets are never logged: the request serializer (app.ts) logs only the
 * route pattern, and nothing here passes a body to the logger.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { notSignedIn, requireUser, roleGuard } from './guards.ts';
import { addressFrom, bodyOf, iso, isoOrNull, refused, toMe } from './http.ts';
import { limiter } from './limiter.ts';
import {
  authenticationOptions,
  finishAuthentication,
  finishRegistration,
  registrationOptions,
  relyingParty,
  removePasskey,
} from './passkeys.ts';
import { route } from '../http/route.ts';
import {
  STAFF_SESSION_MS,
  STEP_UP_MS,
  beginTotp,
  checkCode,
  confirmTotp,
  factorsOf,
  lockedOut,
  markStepUp,
  newRecoveryCodes,
  removeTotp,
  resetSecondFactor,
  stepUpFresh,
  upgradeSession,
} from './secondFactor.ts';
import { SESSION_COOKIE, setSessionCookie, userForSession } from './sessions.ts';
import type { SignedIn } from './sessions.ts';
import { requireStepUp, stepUpGuard } from './stepUp.ts';
import type { TwoFactorKey } from './twoFactorKey.ts';

export interface SecondFactorDeps {
  db: Kysely<DB>;
  siteOrigin: string;
  twoFactorKey: TwoFactorKey | null;
}

const notNeeded = () =>
  refused(
    400,
    'second_factor_not_needed',
    'Only people with a role on this site use a second factor. Yours does not need one.',
  );

/** Somebody who has a factor proves it before changing their factors. */
const verifyFirst = () =>
  refused(
    403,
    'second_factor_required',
    'Prove your second factor first: a code from your authenticator app, a passkey or a recovery code.',
  );

const lastFactor = () =>
  refused(
    409,
    'last_factor',
    'That is your only way to prove it is you. Add another (an authenticator app or a passkey) before removing it.',
  );

export function secondFactorRoutes(app: FastifyInstance, deps: SecondFactorDeps): void {
  const { db, twoFactorKey } = deps;
  const rp = relyingParty(deps.siteOrigin);
  const issuer = new URL(deps.siteOrigin).host;
  // Per client, on top of the per-person lock (secondFactor.ts), which is
  // the real limit: this only stops one client hammering many accounts.
  const guessesPerClient = limiter({ max: 60, windowMs: 60 * 60 * 1000 });

  /** Somebody this applies to: a role holder, signed in. */
  function holder(request: FastifyRequest): SignedIn {
    const user = requireUser(request);
    if (user.secondFactor === 'not-needed') throw notNeeded();
    return user;
  }

  /**
   * Somebody changing their own factors: either setting up their first (a
   * session that proved the email and has no factor yet), or, once they
   * have one, a session that proved it and a step-up within five minutes.
   */
  function changingFactors(request: FastifyRequest): SignedIn {
    const user = holder(request);
    if (user.secondFactor === 'set-up' || user.secondFactor === 'optional') return user;
    if (user.secondFactor === 'verify') throw verifyFirst();
    requireStepUp(request);
    return user;
  }

  /**
   * The session proved its factor: a step-up in a session that had already,
   * or else a new 12-hour staff session in place of this one (upgradeSession
   * says why it is a new one).
   */
  async function proved(user: SignedIn, request: FastifyRequest, reply: FastifyReply) {
    if (user.secondFactor === 'done') {
      await markStepUp(db, user.sessionHash);
      return toMe(await userForSession(db, request.cookies[SESSION_COOKIE]));
    }
    const token = await upgradeSession(db, user.sessionHash);
    if (!token) throw notSignedIn();
    setSessionCookie(reply, token, STAFF_SESSION_MS);
    return toMe(await userForSession(db, token));
  }

  /** The first factor set up also proves it, and gives the recovery codes. */
  async function firstFactorDone(user: SignedIn, request: FastifyRequest, reply: FastifyReply) {
    if (user.secondFactor !== 'set-up' && user.secondFactor !== 'optional') return null;
    const codes = await newRecoveryCodes(db, user.id);
    await proved(user, request, reply);
    return codes;
  }

  route(app, C.getSecondFactor, async ({ request }) => {
    const user = requireUser(request);
    const f = await factorsOf(db, user.id);
    const lock = await db
      .selectFrom('two_factor_attempts')
      .select('locked_until')
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    const locked = lock?.locked_until && lock.locked_until.getTime() > Date.now();
    return {
      state: user.secondFactor,
      totpAvailable: twoFactorKey !== null,
      totp: f.totp,
      passkeys: f.passkeys.map((p) => ({
        id: p.id,
        name: p.name,
        created_at: iso(p.created_at),
        last_used_at: isoOrNull(p.last_used_at),
      })),
      recoveryLeft: f.recoveryLeft,
      lockedUntil: locked && lock.locked_until ? iso(lock.locked_until) : null,
      stepUpUntil:
        user.stepUpAt && stepUpFresh(user.stepUpAt)
          ? iso(new Date(user.stepUpAt.getTime() + STEP_UP_MS))
          : null,
    };
  });

  // ── proving it ────────────────────────────────────────────────────────

  route(app, C.verifySecondFactor, async ({ request, reply }) => {
    const user = holder(request);
    if (user.secondFactor === 'set-up' || user.secondFactor === 'optional') {
      throw refused(
        409,
        'second_factor_not_set_up',
        'There is no second factor on this account yet. Set one up first.',
      );
    }
    guessesPerClient.take(request.ip);
    const out = await checkCode(
      db,
      twoFactorKey,
      user.id,
      bodyOf(C.verifySecondFactor, request).code,
    );
    if (!out.ok) {
      if (out.locked) throw lockedOut();
      throw refused(401, 'bad_code', 'That code is not right. Check it and try again.');
    }
    return proved(user, request, reply);
  });

  route(app, C.passkeyChallenge, async ({ request }) => {
    const user = holder(request);
    return { ...(await authenticationOptions(db, rp, user.id, user.sessionHash)) };
  });

  route(app, C.verifyPasskey, async ({ request, reply }) => {
    const user = holder(request);
    const { response } = bodyOf(C.verifyPasskey, request);
    if (!(await finishAuthentication(db, rp, user.id, user.sessionHash, response))) {
      throw refused(
        401,
        'passkey_refused',
        'That passkey was not accepted. Try again, or use another way to prove it is you.',
      );
    }
    return proved(user, request, reply);
  });

  // ── setting one up ────────────────────────────────────────────────────

  route(app, C.beginTotp, async ({ request }) => {
    const user = changingFactors(request);
    return beginTotp(db, twoFactorKey, user, issuer);
  });

  route(app, C.confirmTotp, async ({ request, reply }) => {
    const user = changingFactors(request);
    const ok = await confirmTotp(db, twoFactorKey, user.id, bodyOf(C.confirmTotp, request).code);
    if (!ok) {
      throw refused(
        401,
        'bad_code',
        'That code does not match. Check the app shows this site, and type the code it shows now.',
      );
    }
    return { recoveryCodes: await firstFactorDone(user, request, reply) };
  });

  route(app, C.removeTotp, async ({ request }) => {
    const user = changingFactors(request);
    const f = await factorsOf(db, user.id);
    if (f.totp && f.passkeys.length === 0) throw lastFactor();
    await removeTotp(db, user.id);
    return { ok: true as const };
  });

  route(app, C.passkeyRegistration, async ({ request }) => {
    const user = changingFactors(request);
    return { ...(await registrationOptions(db, rp, user, user.sessionHash)) };
  });

  route(app, C.addPasskey, async ({ request, reply }) => {
    const user = changingFactors(request);
    const { name, response } = bodyOf(C.addPasskey, request);
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) throw refused(400, 'name', 'Give the passkey a name, like “Work laptop”.');
    await finishRegistration(db, rp, user.id, user.sessionHash, response, clean);
    return { recoveryCodes: await firstFactorDone(user, request, reply) };
  });

  route(app, C.removePasskey, async ({ params, request }) => {
    const user = changingFactors(request);
    const f = await factorsOf(db, user.id);
    if (!f.totp && f.passkeys.length === 1 && f.passkeys[0]?.id === Number(params.id)) {
      throw lastFactor();
    }
    if (!(await removePasskey(db, user.id, Number(params.id)))) {
      throw refused(404, 'not_found', 'That passkey is not on your account.');
    }
    return { ok: true as const };
  });

  route(app, C.newRecoveryCodes, async ({ request }) => {
    const user = changingFactors(request);
    if (user.secondFactor !== 'done') throw verifyFirst();
    return { recoveryCodes: await newRecoveryCodes(db, user.id) };
  });

  // ── the owner's reset ─────────────────────────────────────────────────

  // The owner's scope, and a step-up on all of it.
  void app.register((owner, _opts, done) => {
    owner.addHook('preHandler', roleGuard(['owner']));
    owner.addHook('preHandler', stepUpGuard());
    route(owner, C.resetSecondFactor, async ({ request }) => {
      const actor = requireUser(request);
      const email = addressFrom(bodyOf(C.resetSecondFactor, request).email);
      if (email === actor.email) {
        throw refused(
          400,
          'own_second_factor',
          'Your own second factor is reset only on the server: sudo reportlog reset-2fa <your address>.',
        );
      }
      const subject = await db
        .selectFrom('users')
        .select(['id', 'email'])
        .where('email', '=', email)
        .executeTakeFirst();
      if (!subject) {
        throw refused(404, 'not_found', 'Nobody with that address has an account here.');
      }
      await resetSecondFactor(db, subject, actor.email, 'by the owner');
      return { ok: true as const };
    });
    done();
  });
}
