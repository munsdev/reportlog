/**
 * Signing in by a one-time code to the address, and out again.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { route } from '../http/route.ts';
import { addressFrom, bodyOf, refused, toMe } from './http.ts';
import { limiter } from './limiter.ts';
import { claimWaitingMemberships } from './organizations.ts';
import { CODE_TTL_MS, createCode, subjects, verifyCode } from './otp.ts';
import { ensureUser } from './roles.ts';
import { PENDING_SESSION_MS, needsSecondFactor } from './secondFactor.ts';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  destroySession,
  membershipsFor,
  setSessionCookie,
  userForSession,
} from './sessions.ts';

export const signInCodeEmail = (code: string) => ({
  subject: 'Your sign-in code',
  text:
    `Your one-time code is ${code}. It works for ${String(CODE_TTL_MS / 60_000)} minutes.\n\n` +
    'If you did not ask for it, ignore this email. Nothing happens without the code.',
});

export function authRoutes(
  app: FastifyInstance,
  { db, mailer }: { db: Kysely<DB>; mailer: Mailer },
): void {
  // Per address AND client, so a stranger asking for codes to somebody else's
  // address uses up their own allowance and not the owner's. The looser cap
  // per address alone still stops one inbox being flooded from many places.
  const perAddressAndClient = limiter({ max: 5, windowMs: 60 * 60 * 1000 });
  const perAddress = limiter({ max: 20, windowMs: 60 * 60 * 1000 });
  const perClient = limiter({ max: 60, windowMs: 60 * 60 * 1000 });
  const guessesPerClient = limiter({ max: 60, windowMs: 60 * 60 * 1000 });

  route(app, C.requestSignInCode, async ({ request }) => {
    const email = addressFrom(bodyOf(C.requestSignInCode, request).email);
    perClient.take(request.ip);
    perAddressAndClient.take(`${email} ${request.ip}`);
    perAddress.take(email);
    const code = await createCode(db, subjects.signIn(email));
    // Sent whether or not the address has an account, so neither the answer
    // nor its timing says who has one.
    await mailer.send({ to: email, ...signInCodeEmail(code) });
    return { ok: true as const };
  });

  route(app, C.signIn, async ({ request, reply }) => {
    const { email: typed, code } = bodyOf(C.signIn, request);
    const email = addressFrom(typed);
    guessesPerClient.take(request.ip);
    if (!(await verifyCode(db, subjects.signIn(email), code))) {
      throw refused(401, 'bad_code', 'That code is wrong or has expired. Ask for a new one.');
    }
    // SIGNING IN NEVER CHANGES A ROLE. The old application once promoted an
    // address from the environment on every sign-in, which silently reversed
    // any later demotion and wrote no audit row. A role is granted, on the
    // record, or not at all.
    const user = await db.transaction().execute(async (trx) => {
      const user = await ensureUser(trx, email);
      // An administrator who added this address to an organization before it
      // had an account: the membership attaches now.
      await claimWaitingMemberships(trx, user.id, email);
      return user;
    });
    // A role holder's session is short until it proves a second factor
    // (secondFactor.ts); until then it acts with no role at all.
    const ttl = needsSecondFactor(user.role, await membershipsFor(db, user.id))
      ? PENDING_SESSION_MS
      : SESSION_TTL_MS;
    const token = await createSession(db, user.id, ttl);
    setSessionCookie(reply, token, ttl);
    return toMe(await userForSession(db, token));
  });

  route(app, C.signOut, async ({ request, reply }) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await destroySession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true as const };
  });

  route(app, C.getMe, ({ request }) => toMe(request.user));
}
