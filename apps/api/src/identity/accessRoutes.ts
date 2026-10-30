/**
 * The role ladder, the owner's seat and the site password, over HTTP.
 *
 * Every refusal the modules return becomes a sentence here. The ceiling is
 * checked twice on purpose: once by the guard at the route, once by
 * @reportlog/access inside the module that makes the change.
 */
import { toRoleSet } from '@reportlog/access';
import * as C from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { setOutsideAccess } from './doors.ts';
import {
  grantsAccess,
  notAllowed,
  requireGranter,
  requireRole,
  requireUser,
  roleGuard,
} from './guards.ts';
import { stepUpGuard } from './stepUp.ts';
import { addressFrom, bodyOf, iso, refused } from './http.ts';
import { limiter } from './limiter.ts';
import { CODE_TTL_MS, createCode, subjects, verifyCode } from './otp.ts';
import {
  acceptTransfer,
  cancelTransfer,
  currentOwner,
  pendingTransfer,
  proposeTransfer,
} from './ownership.ts';
import { changeSystemRole, recordRoleChange } from './roles.ts';
import { normalizeEmail } from './secrets.ts';
import {
  keepCurrentToken,
  MIN_CURTAIN_PASSWORD,
  siteAccessSettings,
  validateCurtainPassword,
  writeSiteAccess,
} from './siteAccess.ts';

const ROLE_REFUSALS = {
  self: 'You cannot change your own roles.',
  'cannot-combine':
    'A journalist cannot also be staff. A journalist reads the desk of checked links and has no staff role, so the two are never held by one person.',
  'unknown-role': 'There is no such role.',
  'bad-email': 'Enter a valid email address.',
  'protected-subject':
    'That account cannot be changed here. Only the owner can change an administrator, and nobody can change the owner.',
} as const;

function notPermittedMessage(role: string): string {
  if (role === 'access_manager') {
    return 'Only an administrator can appoint an Access Manager. This is deliberate: if Access Managers could appoint each other, the role would spread on its own.';
  }
  if (role === 'admin') return 'Only the owner can appoint an administrator.';
  if (role === 'journalist') {
    return 'A journalist is made only by approving their request for desk access. Open Journalists under Access and approve it there.';
  }
  if (role === 'owner') {
    return 'The owner’s seat is not granted. It is handed over, and the person receiving it has to accept.';
  }
  return 'You cannot grant that role.';
}

export const handoverCodeEmail = (to: string, code: string) => ({
  subject: 'Code to hand this deployment over',
  text:
    `Somebody signed in as the owner of this deployment is handing it over to ${to}. ` +
    `The code to do it is ${code}, and it works for ${String(CODE_TTL_MS / 60_000)} minutes.\n\n` +
    'This code works for that address and no other. Handing it to anybody else needs a new code, ' +
    'so this message is the record of where the seat was sent.\n\n' +
    'If that was not you, do not enter this code anywhere, and change how you sign in. ' +
    'Once the other person accepts, the handover cannot be undone: only they can appoint ' +
    'administrators afterwards, and only they can hand the seat on again.',
});

export function accessRoutes(
  app: FastifyInstance,
  { db, mailer }: { db: Kysely<DB>; mailer: Mailer },
): void {
  const handoverCodes = limiter({ max: 5, windowMs: 60 * 60 * 1000 });

  // Granting or removing a role asks for the second factor again (plan E,
  // E3): a scope of its own, so a route added to it cannot forget.
  void app.register((granting, _opts, done) => {
    granting.addHook('preHandler', roleGuard(['admin', 'access_manager']));
    granting.addHook('preHandler', stepUpGuard());
    route(granting, C.setSystemRole, async ({ request }) => {
      const actor = requireGranter(request);
      const { email, role, action } = bodyOf(C.setSystemRole, request);
      // A journalist is made only by approving an access request (journalists/vetting.ts),
      // so every one has a request, an agreement and a recorded approval behind it.
      if (role === 'journalist' && action === 'grant') {
        throw notAllowed(notPermittedMessage(role));
      }
      const out = await changeSystemRole(db, { actor, email, role, action });
      if (out.ok) return { ok: true as const, unchanged: out.unchanged, roles: out.roles };
      if (out.reason === 'not-permitted') throw notAllowed(notPermittedMessage(role));
      throw refused(
        out.reason === 'unknown-role' || out.reason === 'bad-email' ? 400 : 403,
        out.reason,
        ROLE_REFUSALS[out.reason],
      );
    });
    done();
  });

  route(app, C.listPeople, async ({ request }) => {
    requireGranter(request);
    const users = await db
      .selectFrom('users')
      .select(['id', 'email', 'roles'])
      .where((eb) =>
        eb.or([
          eb('roles', '<>', sql<string[]>`'{}'::text[]`),
          eb.exists(
            eb
              .selectFrom('organization_memberships as m')
              .select('m.id')
              .whereRef('m.user_id', '=', 'users.id'),
          ),
        ]),
      )
      .orderBy('email')
      .execute();
    const memberships = await db
      .selectFrom('organization_memberships as m')
      .innerJoin('organizations as o', 'o.id', 'm.organization_id')
      .select(['m.user_id', 'o.name', 'm.role'])
      .orderBy('o.name')
      .execute();
    return {
      people: users.map((u) => ({
        email: u.email,
        roles: toRoleSet(u.roles),
        organizations: memberships
          .filter((m) => m.user_id === u.id)
          .map((m) => ({
            name: m.name,
            role: m.role === 'manager' ? ('manager' as const) : ('coordinator' as const),
          })),
      })),
    };
  });

  route(app, C.listAudit, async ({ request }) => {
    requireGranter(request);
    const rows = await db
      .selectFrom('role_audit as a')
      .leftJoin('organizations as o', 'o.id', 'a.organization_id')
      .select([
        'a.actor_email',
        'a.subject_email',
        'a.axis',
        'a.action',
        'a.detail',
        'a.created_at',
        'o.name as organization',
      ])
      .orderBy('a.id', 'desc')
      .limit(500)
      .execute();
    return { entries: rows.map((r) => ({ ...r, created_at: iso(r.created_at) })) };
  });

  /**
   * TWO ANSWERS. Those who grant access see the whole picture: a handover in
   * flight is exactly what they should not discover afterwards. Anybody else
   * learns only whether one waits for THEM, since the seat can be offered to
   * somebody with no role at all; who runs the deployment is not theirs to see.
   */
  route(app, C.getOwner, async ({ request }) => {
    const user = requireUser(request);
    const pending = await pendingTransfer(db);
    const awaitingMyAcceptance = pending?.to_email === normalizeEmail(user.email);
    if (!grantsAccess(user)) return { awaitingMyAcceptance };
    return {
      awaitingMyAcceptance,
      owner: await currentOwner(db),
      iAmOwner: user.roles.includes('owner'),
      pending: pending
        ? { from: pending.from_email, to: pending.to_email, expiresAt: iso(pending.expires_at) }
        : null,
    };
  });

  // Handing the owner's seat on is granting a role: the second factor
  // again, as above.
  void app.register((handing, _opts, done) => {
    handing.addHook('preHandler', (request) => {
      if (!requireUser(request).roles.includes('owner')) {
        throw notAllowed('Only the owner can hand the deployment on.');
      }
      return Promise.resolve();
    });
    handing.addHook('preHandler', stepUpGuard());
    /**
     * A code to the OWNER'S OWN address before they may offer the seat. The
     * session proves somebody signed in as the owner within the last day, on a
     * laptop that may now be unattended; the code proves somebody holding the
     * owner's mailbox is at the keyboard now. The recipient proves themselves
     * by accepting.
     */
    route(handing, C.requestHandoverCode, async ({ request }) => {
      const user = requireUser(request);
      if (!user.roles.includes('owner'))
        throw notAllowed('Only the owner can hand the deployment on.');
      // Checked before a code is minted: a code for an address that can never
      // receive the seat would fail at the last step for a reason nobody gave.
      const to = addressFrom(bodyOf(C.requestHandoverCode, request).email);
      if (to === user.email) throw refused(400, 'self', 'You already hold it.');
      handoverCodes.take(user.email);
      const code = await createCode(db, subjects.handover(user.email, to));
      await mailer.send({ to: user.email, ...handoverCodeEmail(to, code) });
      return { ok: true as const, sentTo: user.email };
    });

    route(handing, C.offerHandover, async ({ request }) => {
      const user = requireUser(request);
      // The role first, then the code, so nobody else can burn codes here.
      if (!user.roles.includes('owner'))
        throw notAllowed('Only the owner can hand the deployment on.');
      const { email, code } = bodyOf(C.offerHandover, request);
      const to = addressFrom(email);
      // Against THIS recipient, so the address in the owner's mailbox and the
      // address the seat goes to cannot differ.
      if (!(await verifyCode(db, subjects.handover(user.email, to), code))) {
        throw refused(
          401,
          'bad_code',
          'That code is wrong, has expired, or was sent for a different address. Ask for another for this one.',
        );
      }
      const out = await proposeTransfer(db, { actor: user, email: to });
      if (!out.ok) {
        throw refused(
          out.reason === 'not-owner' ? 403 : 400,
          out.reason,
          out.reason === 'self' ? 'You already hold it.' : 'Enter a valid email address.',
        );
      }
      return { ok: true as const, to: out.to, expiresAt: iso(out.expiresAt) };
    });
    done();
  });

  route(app, C.cancelHandover, async ({ request }) => {
    const out = await cancelTransfer(db, { actor: requireUser(request) });
    if (!out.ok) throw notAllowed('Only the owner can withdraw a handover.');
    return { ok: true as const };
  });

  route(app, C.acceptHandover, async ({ request }) => {
    const out = await acceptTransfer(db, { actor: requireUser(request) });
    if (out.ok) return out;
    const messages = {
      'none-pending': 'There is no handover waiting.',
      expired: 'That handover has expired. Ask the owner to offer it again.',
      'not-yours': 'That handover was offered to a different address.',
    } as const;
    throw notAllowed(messages[out.reason]);
  });

  route(app, C.getSiteAccessSettings, async ({ request }) => {
    requireRole(request, ['admin']);
    const s = await siteAccessSettings(db);
    return {
      enabled: s.enabled,
      hasPassword: s.password_hash !== null,
      minPassword: MIN_CURTAIN_PASSWORD,
    };
  });

  /**
   * The same password the setup wizard sets, under the same rule. Two doors
   * onto one secret that disagreed about what a password is would make the
   * weaker one the real rule. A blank password means "leave it as it is".
   */
  route(app, C.updateSiteAccess, async ({ request }) => {
    const user = requireRole(request, ['admin']);
    const body = bodyOf(C.updateSiteAccess, request);
    let password: string | undefined;
    if (body.password) {
      const check = validateCurtainPassword(body.password, body.passwordConfirm);
      if (!check.ok) throw refused(400, 'bad_password', check.message);
      password = check.password;
    }
    await db.transaction().execute(async (trx) => {
      await writeSiteAccess(trx, {
        ...(password !== undefined ? { password } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...keepCurrentToken(request),
      });
      await recordRoleChange(trx, {
        actorEmail: user.email,
        subjectEmail: user.email,
        axis: 'site',
        action: 'change',
        detail:
          [
            password !== undefined ? 'set a new site password' : null,
            body.enabled === true ? 'turned the site password on' : null,
            body.enabled === false ? 'turned the site password off' : null,
          ]
            .filter(Boolean)
            .join(', ') || 'saved the site password settings unchanged',
      });
    });
    return { ok: true as const };
  });

  route(app, C.setLogbookOutsideAccess, async ({ params, request }) => {
    const user = requireRole(request, ['admin']);
    const { outside_access } = bodyOf(C.setLogbookOutsideAccess, request);
    const done = await db.transaction().execute(async (trx) => {
      if (!(await setOutsideAccess(trx, params.slug, outside_access))) return false;
      await recordRoleChange(trx, {
        actorEmail: user.email,
        subjectEmail: user.email,
        axis: 'site',
        action: 'change',
        detail: `set logbook ${params.slug} to ${outside_access} without the site password`,
      });
      return true;
    });
    if (!done) throw notFound(`There is no logbook ${params.slug}.`);
    return { ok: true as const };
  });
}
