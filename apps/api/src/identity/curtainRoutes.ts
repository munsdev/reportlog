/**
 * The site password's own routes (in front of it), the doors through it, and
 * the first-run setup wizard (behind it, like everything else).
 *
 * The wizard is reachable only from behind the curtain, and only while the
 * deployment is unfinished. The installer sets the first curtain password, so
 * a stranger who finds a fresh install cannot reach the wizard; the wizard
 * then makes the new owner decide whether to keep that password.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { HttpError } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { doors } from './doors.ts';
import { notSignedIn } from './guards.ts';
import { addressFrom, bodyOf, refused, toMe } from './http.ts';
import { limiter } from './limiter.ts';
import { CODE_TTL_MS, createCode, subjects, verifyCode } from './otp.ts';
import { recordRoleChange } from './roles.ts';
import { createSession, setSessionCookie, userForSession } from './sessions.ts';
import { setupState } from './setup.ts';
import {
  MIN_CURTAIN_PASSWORD,
  SITE_ACCESS_COOKIE,
  SITE_ACCESS_TTL_MS,
  gateApplies,
  siteAccessSettings,
  tokenIsLive,
  unlock,
  validateCurtainPassword,
  writeSiteAccess,
} from './siteAccess.ts';
import { cookieOptions } from './sessions.ts';

const alreadySetUp = () =>
  new HttpError(409, 'already_set_up', 'This deployment has already been set up.');

export const setupCodeEmail = (code: string) => ({
  subject: 'Set up your ReportLog deployment',
  text:
    `Your one-time code is ${code}. It works for ${String(CODE_TTL_MS / 60_000)} minutes.\n\n` +
    'Entering it makes this address the owner of this deployment. If you were not expecting this, ' +
    'ignore it: nothing happens without the code.',
});

export function curtainRoutes(
  app: FastifyInstance,
  { db, mailer }: { db: Kysely<DB>; mailer: Mailer },
): void {
  const unlockTries = limiter({ max: 20, windowMs: 15 * 60 * 1000 });
  const setupCodes = limiter({ max: 10, windowMs: 60 * 60 * 1000 });

  // THE SAME RULE THE GATE USES (gateApplies). If this said "locked" while
  // the gate let requests through, the lock screen would sit over a working
  // site with nothing to explain it.
  route(app, C.getSiteAccessStatus, async ({ request }) => {
    const settings = await siteAccessSettings(db);
    if (!gateApplies(settings)) return { locked: false };
    return { locked: !(await tokenIsLive(db, request.cookies[SITE_ACCESS_COOKIE])) };
  });

  route(app, C.unlockSite, async ({ request, reply }) => {
    if (!gateApplies(await siteAccessSettings(db))) return { ok: true as const };
    unlockTries.take(request.ip);
    const token = await unlock(db, bodyOf(C.unlockSite, request).password);
    if (!token) throw refused(401, 'wrong_password', 'That is not the password.');
    reply.setCookie(SITE_ACCESS_COOKIE, token, cookieOptions(SITE_ACCESS_TTL_MS));
    return { ok: true as const };
  });

  route(app, C.listDoors, async () => ({ doors: await doors(db) }));

  /* ---- setup -------------------------------------------------------- */

  // Two booleans and the password floor: whether it is handed over, and
  // whether it got as far as an owner, so a reloaded tab resumes where it was.
  route(app, C.getSetupStatus, async () => ({
    ...(await setupState(db)),
    minPassword: MIN_CURTAIN_PASSWORD,
  }));

  // Every writing step asks again. Two people running the wizard at once, a
  // tab left open for a week, a replayed request: the server refuses each,
  // not the page that sent it.
  async function onlyWhileOwnerless() {
    const state = await setupState(db);
    if (!state.needed || state.hasOwner) throw alreadySetUp();
  }

  route(app, C.requestSetupCode, async ({ request }) => {
    await onlyWhileOwnerless();
    const email = addressFrom(bodyOf(C.requestSetupCode, request).email);
    setupCodes.take(request.ip);
    const code = await createCode(db, subjects.setup(email));
    await mailer.send({ to: email, ...setupCodeEmail(code) });
    return { ok: true as const };
  });

  route(app, C.claimOwnership, async ({ request, reply }) => {
    await onlyWhileOwnerless();
    const { email: typed, code } = bodyOf(C.claimOwnership, request);
    const email = addressFrom(typed);
    if (!(await verifyCode(db, subjects.setup(email), code))) {
      throw refused(401, 'bad_code', 'That code is wrong or has expired. Ask for a new one.');
    }
    // Checked again inside a lock: two wizards racing would otherwise both
    // pass the check above and both seat an owner.
    const userId = await db.transaction().execute(async (trx) => {
      await sql`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`.execute(trx);
      const existing = await trx
        .selectFrom('users')
        .select('id')
        .where('role', 'in', ['owner', 'admin'])
        .executeTakeFirst();
      if (existing) throw alreadySetUp();
      // The OWNER, not an administrator: the seat cannot be granted, so a
      // wizard that made an admin would leave a deployment that could never
      // have an owner, nor a second administrator.
      const user = await trx
        .insertInto('users')
        .values({ email, role: 'owner' })
        .onConflict((oc) =>
          oc.column('email').doUpdateSet({ role: 'owner', updated_at: new Date() }),
        )
        .returning('id')
        .executeTakeFirstOrThrow();
      await recordRoleChange(trx, {
        actorEmail: email,
        subjectEmail: email,
        axis: 'owner',
        action: 'grant',
        detail: 'owner, by first-run setup',
      });
      return user.id;
    });
    const token = await createSession(db, userId);
    setSessionCookie(reply, token);
    return toMe(await userForSession(db, token));
  });

  /**
   * The curtain password, and the end of setup. A decision is required:
   * `keep` and `change` are both explicit, and there is no default.
   */
  route(app, C.decideCurtain, async ({ request }) => {
    const state = await setupState(db);
    if (!state.needed) throw alreadySetUp();
    if (!request.user) throw notSignedIn();
    // Only the person who just proved they own this deployment may finish it.
    if (request.user.role !== 'owner')
      throw refused(403, 'forbidden', 'Only the new owner can finish setting this up.');
    const body = bodyOf(C.decideCurtain, request);
    if (body.decision !== 'keep' && body.decision !== 'change') {
      throw refused(400, 'decide', 'Choose whether to keep the site password or change it.');
    }
    let password: string | undefined;
    if (body.decision === 'change') {
      const check = validateCurtainPassword(body.password, body.passwordConfirm);
      if (!check.ok) throw refused(400, 'bad_password', check.message);
      password = check.password;
    }
    const owner = request.user;
    await db.transaction().execute(async (trx) => {
      await writeSiteAccess(trx, {
        ...(password !== undefined ? { password } : {}),
        completeSetup: true,
      });
      await recordRoleChange(trx, {
        actorEmail: owner.email,
        subjectEmail: owner.email,
        axis: 'site',
        action: 'change',
        detail:
          password !== undefined
            ? 'finished setup with a new site password'
            : 'finished setup, keeping the site password',
      });
    });
    return { ok: true as const, changed: password !== undefined };
  });
}
