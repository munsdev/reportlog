/**
 * Deleting your own account (owner decision, 23 October 2026; the privacy
 * policy promises it).
 *
 * A TOMBSTONE, NOT A DELETE. Append-only tables point at `users.id`
 * (coordinator_actions, organization_intake_link_uses, feedback events and
 * comments, intake batches), and the database rightly refuses to let those
 * rows be rewritten. So the row stays and stops being anybody: its address
 * becomes one that can never receive mail, its role and flags go, and
 * everything personal hanging off it is deleted, in ONE TRANSACTION.
 *
 * WHAT STAYS, on purpose. Reports already filed are sealed (a reporter's
 * contact details are erased per report, in "My reports"). Staff actions
 * keep the address they were done under, in the audit tables, because that
 * is how staff are held to account; the privacy policy says so.
 *
 * WHO MAY. Anybody signed in, typing their address back. Never the owner: an
 * ownerless deployment must be unreachable, and the seat moves only by a
 * handover. A role holder or organization member also proves a step-up,
 * read from the DATABASE rather than the session, because a role holder
 * whose session has not proved a factor acts as a plain user and must not be
 * able to slip out of the step-up that way. Never the last manager of an
 * organization, which would leave it with nobody to run it.
 *
 * Signing in again with the same address afterwards makes a new, empty
 * account: the old row no longer holds it.
 */
import { toRoleSet } from '@reportlog/access';
import * as C from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { route } from '../http/route.ts';
import { requireUser } from './guards.ts';
import { bodyOf, refused } from './http.ts';
import { recordRoleChange } from './roles.ts';
import { needsSecondFactor } from './secondFactor.ts';
import { normalizeEmail } from './secrets.ts';
import { SESSION_COOKIE } from './sessions.ts';
import { requireStepUp } from './stepUp.ts';

/**
 * The address a deleted account is left holding. Unique by its id, passes the
 * column's check, and `.invalid` is reserved (RFC 2606): no mail can reach it,
 * so nobody can ever sign in as it.
 */
export const tombstoneEmail = (id: number) => `deleted-${String(id)}@deleted.invalid`;

export type DeleteAccountResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'owner' }
  | { ok: false; reason: 'last-manager'; organization: string };

/** Whether this account must prove a step-up to be deleted, from what the database holds. */
export async function deletionNeedsStepUp(db: Kysely<DB>, userId: number): Promise<boolean> {
  const user = await db
    .selectFrom('users')
    .select('roles')
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user) return false;
  const memberships = await db
    .selectFrom('organization_memberships')
    .select('id')
    .where('user_id', '=', userId)
    .execute();
  return needsSecondFactor(user.roles, memberships);
}

export async function deleteAccount(db: Kysely<DB>, userId: number): Promise<DeleteAccountResult> {
  return db.transaction().execute(async (trx): Promise<DeleteAccountResult> => {
    const user = await trx
      .selectFrom('users')
      .select(['id', 'email', 'roles', 'is_tester', 'is_team_member'])
      .where('id', '=', userId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (user.roles.includes('owner')) return { ok: false, reason: 'owner' };
    const email = user.email;

    const memberships = await trx
      .selectFrom('organization_memberships as m')
      .innerJoin('organizations as o', 'o.id', 'm.organization_id')
      .select(['m.id', 'm.role', 'm.organization_id', 'o.name'])
      .where('m.user_id', '=', userId)
      .execute();
    for (const m of memberships.filter((x) => x.role === 'manager')) {
      // Every manager row of the organization locked before counting, as
      // removing a member does (organizations.ts), so two managers leaving
      // at once cannot each see the other still there.
      await trx
        .selectFrom('organization_memberships')
        .select('id')
        .where('organization_id', '=', m.organization_id)
        .where('role', '=', 'manager')
        .forUpdate()
        .execute();
      const others = await trx
        .selectFrom('organization_memberships')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('organization_id', '=', m.organization_id)
        .where('role', '=', 'manager')
        .where('id', '<>', m.id)
        .executeTakeFirstOrThrow();
      if (others.n === 0) {
        return { ok: false, reason: 'last-manager', organization: m.name };
      }
    }

    // The trail, for what was a position of trust. A plain account leaves no
    // row: an audit entry would keep the very address being deleted.
    // One row per role held: each is revoked on its own (decision 70).
    for (const held of toRoleSet(user.roles)) {
      await recordRoleChange(trx, {
        actorEmail: email,
        subjectEmail: email,
        axis: 'system',
        action: 'revoke',
        detail: `${held} (account deleted)`,
      });
    }
    for (const m of memberships) {
      await recordRoleChange(trx, {
        actorEmail: email,
        subjectEmail: email,
        axis: 'organization',
        action: 'revoke',
        detail: `${m.role} of ${m.name} (account deleted)`,
        organizationId: m.organization_id,
      });
    }
    if (user.is_tester || user.is_team_member) {
      await recordRoleChange(trx, {
        actorEmail: email,
        subjectEmail: email,
        axis: 'flag',
        action: 'revoke',
        detail: [user.is_tester && 'tester', user.is_team_member && 'team member']
          .filter(Boolean)
          .join(' and ')
          .concat(' (account deleted)'),
      });
    }

    // Signed out everywhere. Passkey challenges go with the sessions.
    await trx.deleteFrom('sessions').where('user_id', '=', userId).execute();
    await trx.deleteFrom('two_factor_totp').where('user_id', '=', userId).execute();
    await trx.deleteFrom('two_factor_passkeys').where('user_id', '=', userId).execute();
    await trx.deleteFrom('two_factor_recovery_codes').where('user_id', '=', userId).execute();
    await trx.deleteFrom('two_factor_attempts').where('user_id', '=', userId).execute();
    await trx.deleteFrom('organization_memberships').where('user_id', '=', userId).execute();
    // Invitations still waiting for this address would attach a membership
    // to the next account that signs in with it.
    await trx.deleteFrom('organization_invites').where('email', '=', email).execute();
    await trx.deleteFrom('digest_stop_links').where('user_id', '=', userId).execute();
    await trx.deleteFrom('digest_subscriptions').where('user_id', '=', userId).execute();
    // A handover offered TO this address. (One offered BY it is the owner's,
    // refused above.)
    await trx.deleteFrom('ownership_transfers').where('to_email', '=', email).execute();
    // Journalist access is tied to the account by an approved request; the
    // alert-list entry behind it goes too, as leaving the list does
    // (journalists/list.ts), and the request with it (ON DELETE CASCADE).
    await trx
      .deleteFrom('journalist_subscribers')
      .where('id', 'in', (q) =>
        q
          .selectFrom('journalist_access_requests')
          .select('subscriber_id')
          .where('user_id', '=', userId),
      )
      .execute();

    await trx
      .updateTable('users')
      .set({
        email: tombstoneEmail(userId),
        roles: [],
        is_tester: false,
        is_team_member: false,
        desks: [],
        updated_at: new Date(),
      })
      .where('id', '=', userId)
      .execute();
    return { ok: true, email };
  });
}

/**
 * A step-up for those who hold anything, read from the database. In a scope
 * of its own, after which the route cannot forget to ask (stepUp.ts).
 */
function stepUpForHolders(db: Kysely<DB>) {
  return async (request: FastifyRequest) => {
    const user = requireUser(request);
    if (await deletionNeedsStepUp(db, user.id)) requireStepUp(request);
  };
}

export function accountRoutes(app: FastifyInstance, { db }: { db: Kysely<DB> }): void {
  void app.register((deleting, _opts, done) => {
    deleting.addHook('preHandler', stepUpForHolders(db));
    route(deleting, C.deleteAccount, async ({ request, reply }) => {
      const user = requireUser(request);
      if (normalizeEmail(bodyOf(C.deleteAccount, request).email) !== user.email) {
        throw refused(
          400,
          'email_mismatch',
          'Type the address you are signed in with, exactly, to confirm.',
        );
      }
      const out = await deleteAccount(db, user.id);
      if (!out.ok) {
        throw out.reason === 'owner'
          ? refused(
              409,
              'owner_cannot_delete',
              'You hold the owner’s seat, so your account cannot be deleted. Hand the deployment on to somebody else first, then delete your account.',
            )
          : refused(
              409,
              'last_manager',
              `You are the last manager of ${out.organization}. Make somebody else a manager first, so it is not left with nobody to run it.`,
            );
      }
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true as const };
    });
    done();
  });
}
