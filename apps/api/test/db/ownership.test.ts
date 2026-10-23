/**
 * The owner's seat: what only a real database can prove. That a second owner
 * is impossible, that the handover is atomic and two-sided, that the seat is
 * never granted, and that the trail cannot be separated from the change.
 *
 * Ported from legacy/scripts/ownership-selftest.mjs. Its last block (how
 * NULL locations and dates behave in Postgres filters) is about the board,
 * not the seat, and is left for that workstream.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCode, subjects, verifyCode } from '../../src/identity/otp.ts';
import {
  acceptTransfer,
  cancelTransfer,
  pendingTransfer,
  proposeTransfer,
} from '../../src/identity/ownership.ts';
import { sql } from 'kysely';
import { changeSystemRole } from '../../src/identity/roles.ts';
import {
  address,
  as,
  codeFor,
  harness,
  roleOf,
  seat,
  signIn,
  clearStaffSeats,
} from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
const own = address('own');
const heir = address('heir');
const adm = address('adm');
const other = address('other');
const ghost = address('ghost');
const owner = { email: own, roles: ['owner' as const] };
const admin = { email: adm, roles: ['admin' as const] };
interface Actor {
  email: string;
  roles: readonly ('owner' | 'admin')[];
}
const grant = (actor: Actor, email: string, role: string) =>
  changeSystemRole(h.db, { actor, email, role, action: 'grant' });
const revoke = (actor: Actor, email: string, role: string) =>
  changeSystemRole(h.db, { actor, email, role, action: 'revoke' });

const owners = async () =>
  (
    await h.db
      .selectFrom('users')
      .select('email')
      .where(sql<boolean>`roles @> ARRAY['owner']::text[]`)
      .execute()
  ).map((r) => r.email);

beforeAll(async () => {
  h = await harness();
});
afterAll(async () => {
  // Leave no owner behind: the setup test needs a deployment that looks new.
  await h.db.deleteFrom('ownership_transfers').execute();
  await clearStaffSeats(h.db);
  await h.close();
});
beforeEach(async () => {
  await h.db.deleteFrom('ownership_transfers').execute();
  for (const e of [heir, other, ghost]) await seat(h.db, e, 'user');
  await seat(h.db, adm, 'admin');
  await seat(h.db, own, 'owner');
});

describe('the seat is singular', () => {
  it('is refused a second owner by the database', async () => {
    await expect(
      h.db
        .insertInto('users')
        .values({ email: address('second'), roles: ['owner'] })
        .execute(),
    ).rejects.toThrow(/users_single_owner_idx/);
    expect(await owners()).toEqual([own]);
  });
});

describe('the seat cannot be granted', () => {
  it('not even by the owner, through the role path', async () => {
    expect(await grant(owner, heir, 'owner')).toEqual({
      ok: false,
      reason: 'not-permitted',
    });
    expect(await roleOf(h.db, heir)).toBe('user');
  });

  it('and the route says why in a sentence', async () => {
    const token = await signIn(h, own);
    const res = await as(
      h,
      token,
    )({
      method: 'POST',
      url: '/api/access/system-role',
      payload: { email: heir, role: 'owner', action: 'grant' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/handed over/);
  });
});

describe('only the owner makes an administrator', () => {
  it('lets the owner appoint and demote one, to wherever they choose', async () => {
    const r = await grant(owner, other, 'admin');
    expect(r.ok).toBe(true);
    expect(await roleOf(h.db, other)).toBe('admin');
    // One role at a time: moving somebody down is a revoke and a grant.
    expect((await grant(owner, other, 'moderator')).ok).toBe(true);
    expect((await revoke(owner, other, 'admin')).ok).toBe(true);
    expect(await roleOf(h.db, other)).toBe('moderator');
  });

  it('refuses an admin appointing another admin', async () => {
    expect(await grant(admin, other, 'admin')).toEqual({
      ok: false,
      reason: 'not-permitted',
    });
  });
});

describe('the owner is untouchable through the role path', () => {
  it('cannot be demoted by an admin', async () => {
    expect(await revoke(admin, own, 'owner')).toEqual({
      ok: false,
      reason: 'not-permitted',
    });
    expect(await roleOf(h.db, own)).toBe('owner');
  });

  it('cannot revoke their own seat (the ownerless state), nor take another role themselves', async () => {
    expect((await revoke(owner, own, 'owner')).ok).toBe(false);
    expect((await grant(owner, own, 'moderator')).ok).toBe(false);
    expect(await owners()).toEqual([own]);
  });
});

describe('the handover needs both parties', () => {
  it('refuses an admin offering it, and the owner offering it to themselves', async () => {
    expect(await proposeTransfer(h.db, { actor: admin, email: heir })).toEqual({
      ok: false,
      reason: 'not-owner',
    });
    expect(await proposeTransfer(h.db, { actor: owner, email: own })).toEqual({
      ok: false,
      reason: 'self',
    });
  });

  it('moves nothing until the person offered it accepts, and nobody else can', async () => {
    expect((await proposeTransfer(h.db, { actor: owner, email: heir })).ok).toBe(true);
    expect([await roleOf(h.db, own), await roleOf(h.db, heir)]).toEqual(['owner', 'user']);

    expect(await acceptTransfer(h.db, { actor: { email: other } })).toEqual({
      ok: false,
      reason: 'not-yours',
    });
    expect(await pendingTransfer(h.db)).not.toBeNull();

    expect(await acceptTransfer(h.db, { actor: { email: heir } })).toEqual({
      ok: true,
      from: own,
      to: heir,
    });
    expect(await roleOf(h.db, heir)).toBe('owner');
    // The outgoing owner is an administrator, not stranded as a user.
    expect(await roleOf(h.db, own)).toBe('admin');
    expect(await owners()).toEqual([heir]);
    expect(await pendingTransfer(h.db)).toBeNull();
  });

  it('writes both halves into the trail', async () => {
    const last = await h.db
      .selectFrom('role_audit')
      .select((eb) => eb.fn.coalesce(eb.fn.max('id'), eb.lit(0)).as('id'))
      .executeTakeFirstOrThrow();
    await proposeTransfer(h.db, { actor: owner, email: heir });
    await acceptTransfer(h.db, { actor: { email: heir } });
    const trail = await h.db
      .selectFrom('role_audit')
      .select(['subject_email', 'action', 'detail'])
      .where('axis', '=', 'owner')
      .where('id', '>', last.id)
      .where('subject_email', 'in', [own, heir])
      .orderBy('id')
      .execute();
    expect(trail).toEqual([
      { subject_email: own, action: 'revoke', detail: 'owner -> admin' },
      { subject_email: heir, action: 'grant', detail: 'owner' },
    ]);
  });
});

describe('an expired offer is not a live claim', () => {
  it('does not read as pending and cannot be accepted; the seat stays put', async () => {
    await proposeTransfer(h.db, { actor: owner, email: ghost });
    await h.db
      .updateTable('ownership_transfers')
      .set({ expires_at: new Date(Date.now() - 86_400_000) })
      .execute();
    expect(await pendingTransfer(h.db)).toBeNull();
    expect(await acceptTransfer(h.db, { actor: { email: ghost } })).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect([await roleOf(h.db, own), await roleOf(h.db, ghost)]).toEqual(['owner', 'user']);
    expect(await owners()).toEqual([own]);
  });
});

describe('withdrawing an offer', () => {
  it('is the owner’s alone, and leaves the seat alone', async () => {
    await proposeTransfer(h.db, { actor: owner, email: ghost });
    expect(await cancelTransfer(h.db, { actor: admin })).toEqual({
      ok: false,
      reason: 'not-owner',
    });
    expect(await cancelTransfer(h.db, { actor: owner })).toEqual({ ok: true });
    expect(await pendingTransfer(h.db)).toBeNull();
    expect(await owners()).toEqual([own]);
  });
});

describe('the handover code is bound to the address it was asked for', () => {
  it('does not verify for another recipient or another owner, and is spent once', async () => {
    const code = await createCode(h.db, subjects.handover(own, heir));
    // The wrong pairs first: verifying SPENDS a code on success.
    expect(await verifyCode(h.db, subjects.handover(own, other), code)).toBe(false);
    expect(await verifyCode(h.db, subjects.handover(other, heir), code)).toBe(false);
    expect(await verifyCode(h.db, subjects.handover(own, heir), code)).toBe(true);
    expect(await verifyCode(h.db, subjects.handover(own, heir), code)).toBe(false);
  });

  it('treats capitals and spaces as the same pair', async () => {
    const code = await createCode(h.db, subjects.handover(own, heir));
    expect(
      await verifyCode(h.db, subjects.handover(` ${own.toUpperCase()} `, heir.toUpperCase()), code),
    ).toBe(true);
  });
});

describe('the handover over HTTP', () => {
  it('emails the OWNER a code naming the recipient, and the code offers it to that address only', async () => {
    const token = await signIn(h, own);
    const call = as(h, token);
    let res = await call({
      method: 'POST',
      url: '/api/access/owner/handover-code',
      payload: { email: heir },
    });
    expect(res.json()).toEqual({ ok: true, sentTo: own });
    const mail = h.mailer.lastTo(own);
    expect(mail?.text).toContain(heir);
    const code = codeFor(h.mailer, own);

    res = await call({
      method: 'POST',
      url: '/api/access/owner/handover',
      payload: { email: other, code },
    });
    expect(res.statusCode).toBe(401);
    // A wrong pair is a wrong guess and counts as one; the right pair still works.
    res = await call({
      method: 'POST',
      url: '/api/access/owner/handover',
      payload: { email: heir, code },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, to: heir });

    const heirToken = await signIn(h, heir);
    const seen = await as(h, heirToken)({ method: 'GET', url: '/api/access/owner' });
    // Somebody who grants nothing learns only that something waits for them.
    expect(seen.json()).toEqual({ awaitingMyAcceptance: true });

    const accepted = await as(h, heirToken)({ method: 'POST', url: '/api/access/owner/accept' });
    expect(accepted.json()).toEqual({ ok: true, from: own, to: heir });
    expect(await owners()).toEqual([heir]);
  });

  it('refuses anybody but the owner asking for a code', async () => {
    const token = await signIn(h, adm);
    const res = await as(
      h,
      token,
    )({ method: 'POST', url: '/api/access/owner/handover-code', payload: { email: heir } });
    expect(res.statusCode).toBe(403);
  });

  it('shows those who grant access the whole picture', async () => {
    await proposeTransfer(h.db, { actor: owner, email: heir });
    const token = await signIn(h, adm);
    const res = await as(h, token)({ method: 'GET', url: '/api/access/owner' });
    expect(res.json()).toMatchObject({
      owner: own,
      iAmOwner: false,
      pending: { from: own, to: heir },
    });
  });
});

describe('the trail cannot be edited', () => {
  it('refuses UPDATE and DELETE on role_audit', async () => {
    await expect(
      h.db.updateTable('role_audit').set({ detail: 'rewritten' }).execute(),
    ).rejects.toThrow(/append-only/);
    await expect(h.db.deleteFrom('role_audit').execute()).rejects.toThrow(/append-only/);
  });
});
