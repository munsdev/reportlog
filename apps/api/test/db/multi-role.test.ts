/**
 * A person may hold several roles (decision 70): staff roles combine, a
 * journalist holds none, each role is granted and revoked on its own with its
 * own audit row, and the database refuses what the application forgets.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeSystemRole } from '../../src/identity/roles.ts';
import { address, as, clearRoles, harness, roleOf, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
const adminEmail = address('multi-admin');
const person = address('multi-person');
const reader = address('multi-reader');
const owner = { email: address('multi-owner'), roles: ['owner' as const] };

beforeAll(async () => {
  h = await harness();
  await seat(h.db, adminEmail, 'admin');
});
afterAll(async () => {
  await clearRoles(h.db, adminEmail);
  await h.close();
});

const post = async (email: string, role: string, action: 'grant' | 'revoke') =>
  as(
    h,
    await signIn(h, adminEmail),
  )({ method: 'POST', url: '/api/access/system-role', payload: { email, role, action } });

describe('several staff roles at once', () => {
  it('grants one role at a time through the route and reports every role held', async () => {
    expect((await post(person, 'moderator', 'grant')).json()).toEqual({
      ok: true,
      unchanged: false,
      roles: ['moderator'],
    });
    expect((await post(person, 'access_manager', 'grant')).json()).toEqual({
      ok: true,
      unchanged: false,
      roles: ['moderator', 'access_manager'],
    });
    expect((await post(person, 'access_manager', 'grant')).json()).toMatchObject({
      unchanged: true,
    });
  });

  it('lets the person act with both, and shows both on their account', async () => {
    const me = await as(h, await signIn(h, person))({ method: 'GET', url: '/api/auth/me' });
    expect(me.json()).toMatchObject({
      roles: ['moderator', 'access_manager'],
      heldRoles: ['moderator', 'access_manager'],
      grantsAccess: true,
    });
  });

  it('revokes one and keeps the other, each in the trail on its own', async () => {
    expect((await post(person, 'moderator', 'revoke')).json()).toMatchObject({
      roles: ['access_manager'],
    });
    const trail = await h.db
      .selectFrom('role_audit')
      .select(['action', 'detail'])
      .where('subject_email', '=', person)
      .orderBy('id')
      .execute();
    expect(trail).toEqual([
      { action: 'grant', detail: 'moderator' },
      { action: 'grant', detail: 'access_manager' },
      { action: 'revoke', detail: 'moderator' },
    ]);
  });

  it('keeps the ceiling per role: an admin still cannot make an administrator', async () => {
    expect((await post(person, 'admin', 'grant')).statusCode).toBe(403);
    expect(await roleOf(h.db, person)).toBe('access_manager');
  });
});

describe('the journalist holds no staff role', () => {
  it('is refused with a sentence when the owner would combine them', async () => {
    await seat(h.db, reader, 'journalist');
    const out = await changeSystemRole(h.db, {
      actor: owner,
      email: reader,
      role: 'moderator',
      action: 'grant',
    });
    expect(out).toEqual({ ok: false, reason: 'cannot-combine' });
    expect(await roleOf(h.db, reader)).toBe('journalist');
  });

  it('is refused by the database even if a path forgets to ask', async () => {
    await expect(
      h.db
        .updateTable('users')
        .set({ roles: ['journalist', 'moderator'] })
        .where('email', '=', reader)
        .execute(),
    ).rejects.toThrow(/users_roles_journalist_alone/);
    await expect(
      h.db
        .updateTable('users')
        .set({ roles: ['wizard'] })
        .where('email', '=', reader)
        .execute(),
    ).rejects.toThrow(/users_roles_known/);
  });
});
