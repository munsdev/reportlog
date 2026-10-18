/**
 * Roles and organizations against a real database: the ceiling held inside a
 * transaction, the trail written with the change, and the rules that keep an
 * organization contained.
 *
 * Ported from legacy/scripts/orgs-selftest.mjs. Its last third (a report
 * filed by a coordinator verifying in the chain, with the organization inside
 * the seal and the coordinator outside it) needs third-party filing, which is
 * the filing workstream's; it is not ported here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrganization,
  membersOf,
  removeMember,
} from '../../src/identity/organizations.ts';
import { setSystemRole } from '../../src/identity/roles.ts';
import { address, as, harness, roleOf, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
const adminEmail = address('admin');
const amEmail = address('am');
const modEmail = address('mod');
const mgrEmail = address('mgr');
const coordEmail = address('coord');
const admin = { email: adminEmail, role: 'admin' as const };
const am = { email: amEmail, role: 'access_manager' as const };
const mgr = { email: mgrEmail, role: 'user' as const };

beforeAll(async () => {
  h = await harness();
  await seat(h.db, adminEmail, 'admin');
  for (const e of [amEmail, modEmail, mgrEmail, coordEmail]) await seat(h.db, e, 'user');
});
afterAll(async () => {
  await h.db.updateTable('users').set({ role: 'user' }).where('email', '=', adminEmail).execute();
  await h.close();
});

describe('roles', () => {
  it('lets an admin appoint an Access Manager, who can appoint a Moderator', async () => {
    expect(
      (await setSystemRole(h.db, { actor: admin, email: amEmail, role: 'access_manager' })).ok,
    ).toBe(true);
    expect((await setSystemRole(h.db, { actor: am, email: modEmail, role: 'moderator' })).ok).toBe(
      true,
    );
    expect(await roleOf(h.db, modEmail)).toBe('moderator');
  });

  it('stops an Access Manager appointing another Access Manager', async () => {
    expect(
      await setSystemRole(h.db, { actor: am, email: address('someone'), role: 'access_manager' }),
    ).toEqual({
      ok: false,
      reason: 'not-permitted',
    });
  });

  it('stops an Access Manager demoting an admin', async () => {
    expect((await setSystemRole(h.db, { actor: am, email: adminEmail, role: 'user' })).ok).toBe(
      false,
    );
    expect(await roleOf(h.db, adminEmail)).toBe('admin');
  });

  it('stops anybody changing their own role', async () => {
    expect(await setSystemRole(h.db, { actor: am, email: amEmail, role: 'user' })).toEqual({
      ok: false,
      reason: 'self',
    });
  });

  it('appoints an address that has never signed in, which keeps the role when it does', async () => {
    const fresh = address('fresh');
    expect((await setSystemRole(h.db, { actor: am, email: fresh, role: 'moderator' })).ok).toBe(
      true,
    );
    const token = await signIn(h, fresh);
    expect((await as(h, token)({ method: 'GET', url: '/api/auth/me' })).json()).toMatchObject({
      role: 'moderator',
    });
  });

  it('writes both halves of a change into the trail, in the same transaction', async () => {
    const subject = address('both');
    await setSystemRole(h.db, { actor: admin, email: subject, role: 'moderator' });
    await setSystemRole(h.db, { actor: admin, email: subject, role: 'access_manager' });
    const trail = await h.db
      .selectFrom('role_audit')
      .select(['actor_email', 'action', 'detail', 'axis'])
      .where('subject_email', '=', subject)
      .orderBy('id')
      .execute();
    expect(trail).toEqual([
      { actor_email: adminEmail, axis: 'system', action: 'grant', detail: 'moderator' },
      { actor_email: adminEmail, axis: 'system', action: 'revoke', detail: 'moderator' },
      { actor_email: adminEmail, axis: 'system', action: 'grant', detail: 'access_manager' },
    ]);
  });

  it('writes no trail for a refusal, and no change without a trail', async () => {
    const subject = address('refused');
    await setSystemRole(h.db, { actor: am, email: subject, role: 'admin' });
    expect(await roleOf(h.db, subject)).toBeUndefined();
    const trail = await h.db
      .selectFrom('role_audit')
      .select('id')
      .where('subject_email', '=', subject)
      .execute();
    expect(trail).toEqual([]);
  });

  it('refuses the role route to somebody who grants nothing, and says why to an Access Manager', async () => {
    const plain = await signIn(h, address('plain'));
    let res = await as(
      h,
      plain,
    )({
      method: 'POST',
      url: '/api/access/system-role',
      payload: { email: modEmail, role: 'user' },
    });
    expect(res.statusCode).toBe(403);
    const amToken = await signIn(h, amEmail);
    res = await as(
      h,
      amToken,
    )({
      method: 'POST',
      url: '/api/access/system-role',
      payload: { email: address('x'), role: 'access_manager' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/spread on its own/);
  });

  it('shows the roster and the trail to those who grant access, and nobody else', async () => {
    const amToken = await signIn(h, amEmail);
    const people = await as(h, amToken)({ method: 'GET', url: '/api/access/people' });
    expect(people.statusCode).toBe(200);
    expect(
      people.json<{ people: { email: string }[] }>().people.some((p) => p.email === modEmail),
    ).toBe(true);
    const audit = await as(h, amToken)({ method: 'GET', url: '/api/access/audit' });
    expect(audit.statusCode).toBe(200);
    const plain = await signIn(h, address('nosy'));
    expect((await as(h, plain)({ method: 'GET', url: '/api/access/audit' })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'GET', url: '/api/access/people' })).statusCode).toBe(401);
  });
});

describe('organizations', () => {
  let orgId = 0;
  const orgName = `Org ${address('n')}`;

  it('can be made by an Access Manager, and never without a manager', async () => {
    const o = await createOrganization(h.db, {
      actor: am,
      name: orgName,
      details: 'Test',
      managerEmails: [mgrEmail],
    });
    expect(o.ok).toBe(true);
    if (o.ok) orgId = o.organization.id;
    expect(
      await createOrganization(h.db, { actor: am, name: 'No managers', managerEmails: [] }),
    ).toEqual({
      ok: false,
      reason: 'manager-required',
    });
    expect(
      await createOrganization(h.db, { actor: am, name: orgName, managerEmails: [mgrEmail] }),
    ).toEqual({
      ok: false,
      reason: 'name-taken',
    });
  });

  it('lets a manager add a coordinator but not promote a manager', async () => {
    expect(
      (
        await addMember(h.db, {
          actor: mgr,
          actorIsManager: true,
          organizationId: orgId,
          email: coordEmail,
          role: 'coordinator',
        })
      ).ok,
    ).toBe(true);
    expect(
      await addMember(h.db, {
        actor: mgr,
        actorIsManager: true,
        organizationId: orgId,
        email: address('o'),
        role: 'manager',
      }),
    ).toEqual({ ok: false, reason: 'manager-cannot-promote' });
  });

  it('leaves a waiting membership for an address with no account, which attaches at sign-in', async () => {
    const nobody = address('nobody');
    const a = await addMember(h.db, {
      actor: am,
      actorIsManager: false,
      organizationId: orgId,
      email: nobody,
      role: 'coordinator',
    });
    expect(a).toEqual({ ok: true, pending: true });
    expect((await membersOf(h.db, orgId)).find((m) => m.email === nobody)?.pending).toBe(true);

    const token = await signIn(h, nobody);
    const me = (await as(h, token)({ method: 'GET', url: '/api/auth/me' })).json<{
      memberships: { organization_id: number; role: string }[];
    }>();
    expect(me.memberships).toEqual([
      { organization_id: orgId, name: orgName, role: 'coordinator' },
    ]);
    expect((await membersOf(h.db, orgId)).find((m) => m.email === nobody)?.pending).toBe(false);
  });

  it('never lets a manager remove a manager, nor anybody remove the last one', async () => {
    expect(
      (
        await removeMember(h.db, {
          actor: mgr,
          actorIsManager: true,
          organizationId: orgId,
          email: mgrEmail,
        })
      ).ok,
    ).toBe(false);
    expect(
      await removeMember(h.db, {
        actor: am,
        actorIsManager: false,
        organizationId: orgId,
        email: mgrEmail,
      }),
    ).toEqual({
      ok: false,
      reason: 'last-manager',
    });
  });

  it('lets a manager remove a coordinator, on the record', async () => {
    expect(
      await removeMember(h.db, {
        actor: mgr,
        actorIsManager: true,
        organizationId: orgId,
        email: coordEmail,
      }),
    ).toEqual({
      ok: true,
      submissionsKept: true,
    });
    const last = await h.db
      .selectFrom('role_audit')
      .select(['action', 'detail', 'organization_id'])
      .where('subject_email', '=', coordEmail)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(last).toEqual({
      action: 'revoke',
      detail: `coordinator of ${orgName}`,
      organization_id: orgId,
    });
  });

  it('shows an organization to its managers and to granters, and to nobody else', async () => {
    const mgrToken = await signIn(h, mgrEmail);
    const res = await as(h, mgrToken)({ method: 'GET', url: `/api/orgs/${String(orgId)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      organization: { name: orgName, manager_count: 1 },
      youManageIt: true,
    });
    const stranger = await signIn(h, address('stranger'));
    expect(
      (await as(h, stranger)({ method: 'GET', url: `/api/orgs/${String(orgId)}` })).statusCode,
    ).toBe(403);
    // An id in a URL is a claim, not a permission.
    const mine = await as(h, stranger)({ method: 'GET', url: '/api/orgs' });
    expect(mine.json()).toEqual({ organizations: [] });
  });

  it('lets only granters add somebody directly over HTTP', async () => {
    const mgrToken = await signIn(h, mgrEmail);
    let res = await as(
      h,
      mgrToken,
    )({
      method: 'POST',
      url: `/api/orgs/${String(orgId)}/members`,
      payload: { email: address('sneak'), role: 'coordinator' },
    });
    expect(res.statusCode).toBe(403);
    const adminToken = await signIn(h, adminEmail);
    res = await as(
      h,
      adminToken,
    )({
      method: 'POST',
      url: `/api/orgs/${String(orgId)}/members`,
      payload: { email: address('boot'), role: 'manager' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('records an administrator rewriting an organization’s details, and not its manager doing so', async () => {
    const adminToken = await signIn(h, adminEmail);
    await as(
      h,
      adminToken,
    )({
      method: 'POST',
      url: `/api/orgs/${String(orgId)}/details`,
      payload: { details: 'Replaced' },
    });
    const mgrToken = await signIn(h, mgrEmail);
    await as(
      h,
      mgrToken,
    )({ method: 'POST', url: `/api/orgs/${String(orgId)}/details`, payload: { details: 'Ours' } });
    const rows = await h.db
      .selectFrom('role_audit')
      .select(['actor_email'])
      .where('organization_id', '=', orgId)
      .where('action', '=', 'change')
      .execute();
    expect(rows).toEqual([{ actor_email: adminEmail }]);
  });
});
