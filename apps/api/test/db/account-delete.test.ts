/**
 * Deleting your own account (identity/account.ts): a tombstone, so the rows
 * that must never change still point at something, and nothing personal is
 * left hanging off it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tombstoneEmail } from '../../src/identity/account.ts';
import { sha256Hex } from '../../src/identity/secrets.ts';
import {
  address,
  as,
  harness,
  liftCurtain,
  seat,
  signIn,
  signInByEmailOnly,
} from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
beforeAll(async () => {
  h = await harness();
  await liftCurtain(h.db);
});
afterAll(async () => {
  await h.close();
});

const del = (session: string, email: string) =>
  as(h, session)({ method: 'POST', url: '/api/auth/account/delete', payload: { email } });

const userRow = (id: number) =>
  h.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();

async function organization(name: string): Promise<number> {
  const row = await h.db
    .insertInto('organizations')
    .values({ name, verified_by: 'fixture@example.org' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function staleStepUp(session: string): Promise<void> {
  await h.db
    .updateTable('sessions')
    .set({ step_up_at: new Date(Date.now() - 60 * 60 * 1000) })
    .where('token_hash', '=', sha256Hex(session))
    .execute();
}

describe('deleting your own account', () => {
  it('a plain account: the address, sessions and email updates go, rows that point at it stay', async () => {
    const email = address('plain');
    const session = await signIn(h, email);
    const id = (
      await h.db
        .selectFrom('users')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow()
    ).id;
    await h.db
      .insertInto('digest_subscriptions')
      .values({ user_id: id, frequency: 'weekly' })
      .execute();
    // Feedback is append-only and points at the account: it must survive.
    const feedback = await h.db
      .insertInto('feedback')
      .values({
        submitter_id: id,
        type: 'bug',
        severity: 'minor',
        title: 'A thing',
        body: 'Something did not work as expected.',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const wrong = await del(session, 'somebody-else@example.org');
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toMatchObject({ error: { code: 'email_mismatch' } });
    expect((await userRow(id))?.email).toBe(email);

    const res = await del(session, email.toUpperCase());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.cookies.find((c) => c.name === 'session_token')?.value).toBe('');

    const row = await userRow(id);
    expect(row).toMatchObject({ email: tombstoneEmail(id), roles: [], is_tester: false });
    expect(
      await h.db.selectFrom('sessions').select('user_id').where('user_id', '=', id).execute(),
    ).toEqual([]);
    expect(
      await h.db
        .selectFrom('digest_subscriptions')
        .select('user_id')
        .where('user_id', '=', id)
        .execute(),
    ).toEqual([]);
    expect(
      await h.db
        .selectFrom('feedback')
        .select('submitter_id')
        .where('id', '=', feedback.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ submitter_id: id });
    // A plain account leaves no audit row: one would keep the address.
    expect(
      await h.db.selectFrom('role_audit').select('id').where('subject_email', '=', email).execute(),
    ).toEqual([]);
    // The old session no longer works.
    const me = await as(h, session)({ method: 'GET', url: '/api/auth/me' });
    expect(me.json()).toEqual({ signedIn: false });
  });

  it('signing in again with the same address makes a fresh, empty account', async () => {
    const email = address('again');
    const first = await signIn(h, email);
    const oldId = (
      await h.db
        .selectFrom('users')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow()
    ).id;
    expect((await del(first, email)).statusCode).toBe(200);
    const second = await signIn(h, email);
    const fresh = await h.db
      .selectFrom('users')
      .select(['id', 'roles'])
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    expect(fresh.id).not.toBe(oldId);
    expect(fresh.roles).toEqual([]);
    const me = await as(h, second)({ method: 'GET', url: '/api/auth/me' });
    expect(me.json()).toMatchObject({ signedIn: true, email });
  });

  it('THE OWNER IS REFUSED, and told to hand the seat on first', async () => {
    const email = address('owner');
    const id = await seat(h.db, email, 'owner');
    const session = await signIn(h, email);
    const res = await del(session, email);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'owner_cannot_delete' } });
    expect(res.body).toMatch(/Hand the deployment on/);
    expect(await userRow(id)).toMatchObject({ email, roles: ['owner'] });
  });

  it('A ROLE HOLDER needs a step-up, read from the database, then loses the role on the record', async () => {
    const email = address('mod');
    const id = await seat(h.db, email, 'moderator');
    const session = await signIn(h, email);
    await staleStepUp(session);
    const refused = await del(session, email);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: { code: 'step_up_required' } });

    // A session that never proved a factor acts with no role. It must not
    // be a way round the step-up.
    const pending = await signInByEmailOnly(h, email);
    const sneaky = await del(pending, email);
    expect(sneaky.statusCode).toBe(403);
    expect(sneaky.json()).toMatchObject({ error: { code: 'step_up_required' } });
    expect((await userRow(id))?.email).toBe(email);

    const fresh = await signIn(h, email);
    expect((await del(fresh, email)).statusCode).toBe(200);
    expect(await userRow(id)).toMatchObject({ email: tombstoneEmail(id), roles: [] });
    const trail = await h.db
      .selectFrom('role_audit')
      .select(['axis', 'action', 'detail', 'actor_email'])
      .where('subject_email', '=', email)
      .execute();
    expect(trail).toContainEqual({
      axis: 'system',
      action: 'revoke',
      detail: 'moderator (account deleted)',
      actor_email: email,
    });
  });

  it('memberships and waiting invitations go; THE LAST MANAGER of an organization is refused', async () => {
    const orgId = await organization(`Org ${address('o')}`);
    const manager = address('manager');
    const coordinator = address('coordinator');
    const managerId = await seat(h.db, manager, 'user');
    const coordinatorId = await seat(h.db, coordinator, 'user');
    await h.db
      .insertInto('organization_memberships')
      .values([
        { organization_id: orgId, user_id: managerId, role: 'manager' },
        { organization_id: orgId, user_id: coordinatorId, role: 'coordinator' },
      ])
      .execute();
    await h.db
      .insertInto('organization_invites')
      .values({
        organization_id: orgId,
        email: coordinator,
        role: 'manager',
        status: 'joins_on_sign_in',
        invited_by: manager,
      })
      .execute();

    const managerSession = await signIn(h, manager);
    const last = await del(managerSession, manager);
    expect(last.statusCode).toBe(409);
    expect(last.json()).toMatchObject({ error: { code: 'last_manager' } });

    const coordinatorSession = await signIn(h, coordinator);
    expect((await del(coordinatorSession, coordinator)).statusCode).toBe(200);
    expect(
      await h.db
        .selectFrom('organization_memberships')
        .select('id')
        .where('user_id', '=', coordinatorId)
        .execute(),
    ).toEqual([]);
    expect(
      await h.db
        .selectFrom('organization_invites')
        .select('id')
        .where('email', '=', coordinator)
        .execute(),
    ).toEqual([]);
    expect(await userRow(coordinatorId)).toMatchObject({ email: tombstoneEmail(coordinatorId) });
    // The manager is untouched.
    expect(await userRow(managerId)).toMatchObject({ email: manager });
  });
});
