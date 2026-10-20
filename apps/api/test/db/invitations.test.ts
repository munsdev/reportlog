/**
 * Organization invitations, against a real database and the real app.
 *
 * A permission system and a new door into role granting, so most of this is
 * about what must NOT be possible: a manager minting a system role or another
 * manager alone, looking at a link accepting it, the wrong account using it,
 * a link working twice, and the limits not biting.
 *
 * Ported from legacy/scripts/invitations-selftest.mjs, check for check.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORG_ROLES } from '@reportlog/access';
import {
  INVITE_TTL_MS,
  MAX_OUTSTANDING_PER_ORG,
  MAX_PER_DAY_PER_EMAIL,
  ROLE_DESCRIPTIONS,
} from '../../src/identity/invitations.ts';
import { sha256Hex } from '../../src/identity/secrets.ts';
import { SITE, address, as, harness, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
let orgId = 0;
const ORG = `Invitations ${address('org')}`;
const adminEmail = address('inv-admin');
const mgrEmail = address('inv-mgr');
const inviteeEmail = address('inv-invitee');
const otherEmail = address('inv-other');
let asAdmin: ReturnType<typeof as>;
let asMgr: ReturnType<typeof as>;
let asInvitee: ReturnType<typeof as>;
let asOther: ReturnType<typeof as>;
const anon = () => as(h);

const invite = (caller: ReturnType<typeof as>, email: string, role: string) =>
  caller({
    method: 'POST',
    url: `/api/orgs/${String(orgId)}/invitations`,
    payload: { email, role },
  });

/** The link in the newest invitation email to this address. */
function linkFor(email: string): string | null {
  const text = h.mailer.lastTo(email)?.text ?? '';
  return /\/access\/invitation\/([a-f0-9]{64})/.exec(text)?.[1] ?? null;
}
async function storedHash(email: string): Promise<string | null> {
  const row = await h.db
    .selectFrom('organization_invites')
    .select('token_hash')
    .where('organization_id', '=', orgId)
    .where('email', '=', email)
    .executeTakeFirst();
  return row?.token_hash ?? null;
}

beforeAll(async () => {
  h = await harness();
  await seat(h.db, adminEmail, 'admin');
  const org = await h.db
    .insertInto('organizations')
    .values({ name: ORG, verified_by: adminEmail })
    .returning('id')
    .executeTakeFirstOrThrow();
  orgId = org.id;
  const mgrId = await seat(h.db, mgrEmail, 'user');
  await h.db
    .insertInto('organization_memberships')
    .values({ organization_id: orgId, user_id: mgrId, role: 'manager' })
    .execute();
  asAdmin = as(h, await signIn(h, adminEmail));
  asMgr = as(h, await signIn(h, mgrEmail));
  asInvitee = as(h, await signIn(h, inviteeEmail));
  asOther = as(h, await signIn(h, otherEmail));
});
afterAll(async () => {
  await h.db.updateTable('users').set({ role: 'user' }).where('email', '=', adminEmail).execute();
  await h.close();
});

describe('the role ceiling, at the new door', () => {
  it.each(['moderator', 'access_manager', 'admin', 'owner', 'nonsense'])(
    'stops a manager inviting a %s',
    async (role) => {
      const res = await invite(asMgr, address(`inv-${role}`), role);
      expect(res.statusCode).toBe(400);
    },
  );

  it('wrote no row for any of those attempts', async () => {
    const rows = await h.db
      .selectFrom('organization_invites')
      .select('role')
      .where('organization_id', '=', orgId)
      .where('role', 'not in', ['manager', 'coordinator'])
      .execute();
    expect(rows).toEqual([]);
  });
});

describe('what a manager may and may not do alone', () => {
  it('invites a coordinator without asking anybody, emailing a link at once', async () => {
    const res = await invite(asMgr, inviteeEmail, 'coordinator');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, awaitingApproval: false });
    const mail = h.mailer.lastTo(inviteeEmail);
    expect(mail?.subject).toBe(`You have been invited to ${ORG}`);
    expect(mail?.text).toContain(mgrEmail);
    expect(mail?.text).toContain(`${SITE}/access/invitation/`);
    const link = linkFor(inviteeEmail);
    expect(link).toMatch(/^[a-f0-9]{64}$/);
    // Stored as a hash: the link is a credential.
    expect(await storedHash(inviteeEmail)).toBe(sha256Hex(link ?? ''));
  });

  it('holds a manager invitation for an administrator, with no link and no email', async () => {
    const sentBefore = h.mailer.messages.filter((m) => m.to === otherEmail).length;
    const res = await invite(asMgr, otherEmail, 'manager');
    expect(res.json()).toMatchObject({ ok: true, awaitingApproval: true });
    expect(await storedHash(otherEmail)).toBeNull();
    expect(h.mailer.messages.filter((m) => m.to === otherEmail).length).toBe(sentBefore);
  });

  it('does not let a manager approve their own leadership grant', async () => {
    const res = await asMgr({
      method: 'POST',
      url: `/api/orgs/${String(orgId)}/invitations/${otherEmail}/approve`,
    });
    expect(res.statusCode).toBe(403);
    expect(await storedHash(otherEmail)).toBeNull();
  });

  it('lets an administrator approve it, and only then is there a link', async () => {
    const res = await asAdmin({
      method: 'POST',
      url: `/api/orgs/${String(orgId)}/invitations/${otherEmail}/approve`,
    });
    expect(res.statusCode).toBe(200);
    expect(await storedHash(otherEmail)).toMatch(/^[a-f0-9]{64}$/);
    expect(linkFor(otherEmail)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('the door invitations replaced', () => {
  it('no longer lets a manager add somebody without their agreeing', async () => {
    const res = await asMgr({
      method: 'POST',
      url: `/api/orgs/${String(orgId)}/members`,
      payload: { email: address('sneak'), role: 'coordinator' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('still lets an administrator, to seat a first manager', async () => {
    const res = await asAdmin({
      method: 'POST',
      url: `/api/orgs/${String(orgId)}/members`,
      payload: { email: address('boot'), role: 'manager' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('looking is not accepting', () => {
  it('shows anybody with the link what it offers, who sent it and what the role can do', async () => {
    const link = linkFor(inviteeEmail) ?? '';
    const res = await anon()({ method: 'GET', url: `/api/invitations/${link}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      organization: string;
      role: string;
      invitedBy: string;
      permissions: { can: string[]; cannot: string[] };
    }>();
    expect(body).toMatchObject({ organization: ORG, role: 'coordinator', invitedBy: mgrEmail });
    expect(body.permissions.can.length).toBeGreaterThan(0);
    expect(body.permissions.cannot.length).toBeGreaterThan(0);
  });

  it('changes nothing by being looked at twice', async () => {
    const link = linkFor(inviteeEmail) ?? '';
    expect((await anon()({ method: 'GET', url: `/api/invitations/${link}` })).statusCode).toBe(200);
    const members = await h.db
      .selectFrom('organization_memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select('m.id')
      .where('m.organization_id', '=', orgId)
      .where('u.email', '=', inviteeEmail)
      .execute();
    expect(members).toEqual([]);
  });
});

describe('an invitation says what it grants', () => {
  // The invitee decides from these words alone, so a role that can be
  // granted and has none would be accepted blind.
  it.each(ORG_ROLES)('describes the %s role: a name, what it can do and what it cannot', (role) => {
    const said = ROLE_DESCRIPTIONS[role];
    expect(said.label.trim()).not.toBe('');
    expect(said.can.length).toBeGreaterThan(0);
    expect(said.cannot.length).toBeGreaterThan(0);
    for (const line of [...said.can, ...said.cannot]) expect(line.trim()).not.toBe('');
  });

  it("tells a manager their reach stops at the organization's edge", () => {
    expect(ROLE_DESCRIPTIONS.manager.cannot.join(' ')).toContain('outside this organization');
  });

  it('shows the manager wording to whoever opens a manager invitation', async () => {
    const email = address('inv-mgr-words');
    const res = await invite(asAdmin, email, 'manager');
    expect(res.json()).toMatchObject({ ok: true, awaitingApproval: false });
    const shown = await anon()({ method: 'GET', url: `/api/invitations/${linkFor(email) ?? ''}` });
    expect(shown.statusCode).toBe(200);
    expect(shown.json()).toMatchObject({ role: 'manager', permissions: ROLE_DESCRIPTIONS.manager });
    expect(shown.body).toContain('outside this organization');
  });
});

describe('an invitation lasts seven days', () => {
  const email = address('inv-ttl');

  it('is seven days: long enough for somebody who reads email at the weekend', () => {
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('expires seven days after it is sent, by the database row', async () => {
    const sentAt = Date.now();
    expect((await invite(asMgr, email, 'coordinator')).statusCode).toBe(200);
    const row = await h.db
      .selectFrom('organization_invites')
      .select('expires_at')
      .where('organization_id', '=', orgId)
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    const ends = row.expires_at?.getTime() ?? 0;
    expect(ends).toBeGreaterThanOrEqual(sentAt + INVITE_TTL_MS);
    expect(ends).toBeLessThanOrEqual(Date.now() + INVITE_TTL_MS);
  });

  it('is shown and can be accepted until then, and neither a moment after', async () => {
    const link = linkFor(email) ?? '';
    const setEnd = (at: number) =>
      h.db
        .updateTable('organization_invites')
        .set({ expires_at: new Date(at) })
        .where('organization_id', '=', orgId)
        .where('email', '=', email)
        .execute();
    // A minute before the end: still open.
    await setEnd(Date.now() + 60_000);
    expect((await anon()({ method: 'GET', url: `/api/invitations/${link}` })).statusCode).toBe(200);
    // A second after: the same answer as a link that never existed.
    await setEnd(Date.now() - 1_000);
    expect((await anon()({ method: 'GET', url: `/api/invitations/${link}` })).statusCode).toBe(404);
    const asTtl = as(h, await signIn(h, email));
    const res = await asTtl({ method: 'POST', url: `/api/invitations/${link}/accept` });
    expect(res.statusCode).toBe(404);
    const joined = await h.db
      .selectFrom('organization_memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select('m.id')
      .where('m.organization_id', '=', orgId)
      .where('u.email', '=', email)
      .execute();
    expect(joined).toEqual([]);
  });
});

describe('whose link it is', () => {
  it('cannot be accepted signed out', async () => {
    const res = await anon()({
      method: 'POST',
      url: `/api/invitations/${linkFor(inviteeEmail) ?? ''}/accept`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('cannot be accepted by somebody else, who is told which address it was for', async () => {
    const link = linkFor(inviteeEmail) ?? '';
    const res = await asOther({ method: 'POST', url: `/api/invitations/${link}/accept` });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { message: string } }>().error.message).toContain(inviteeEmail);
    // And the invitation survives being refused.
    expect(await storedHash(inviteeEmail)).toBe(sha256Hex(link));
  });
});

describe('accepting', () => {
  it('joins the invited person, works once, and is two audit rows', async () => {
    const link = linkFor(inviteeEmail) ?? '';
    let res = await asInvitee({ method: 'POST', url: `/api/invitations/${link}/accept` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, role: 'coordinator', organization: ORG });

    const me = await asInvitee({ method: 'GET', url: '/api/auth/me' });
    expect(me.json()).toMatchObject({
      memberships: [{ organization_id: orgId, role: 'coordinator' }],
    });

    res = await asInvitee({ method: 'POST', url: `/api/invitations/${link}/accept` });
    expect(res.statusCode).toBe(404);

    const details = (
      await h.db
        .selectFrom('role_audit')
        .select('detail')
        .where('subject_email', '=', inviteeEmail)
        .where('organization_id', '=', orgId)
        .orderBy('id')
        .execute()
    ).map((r) => r.detail);
    expect(details.some((d) => d.startsWith('invited as coordinator'))).toBe(true);
    expect(details.some((d) => d.startsWith('accepted the invitation'))).toBe(true);
  });
});

describe('what the manager can see and do', () => {
  it('sees what is still waiting, never a link', async () => {
    const res = await asMgr({ method: 'GET', url: `/api/orgs/${String(orgId)}/invitations` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ invitations: Record<string, unknown>[] }>();
    expect(body.invitations.some((i) => i.email === inviteeEmail)).toBe(false);
    expect(body.invitations.some((i) => 'token' in i || 'token_hash' in i)).toBe(false);
    expect(res.body).not.toContain(linkFor(otherEmail) ?? 'x');
  });

  it('resends with a new link, and the old one is dead', async () => {
    const before = linkFor(otherEmail) ?? '';
    const res = await asMgr({
      method: 'POST',
      url: `/api/orgs/${String(orgId)}/invitations/${otherEmail}/resend`,
    });
    expect(res.statusCode).toBe(200);
    const after = linkFor(otherEmail) ?? '';
    expect(after).not.toBe(before);
    expect((await anon()({ method: 'GET', url: `/api/invitations/${before}` })).statusCode).toBe(
      404,
    );
    expect((await anon()({ method: 'GET', url: `/api/invitations/${after}` })).statusCode).toBe(
      200,
    );
  });
});

describe('the limits that stop this being a mail cannon', () => {
  it(`sends no more than ${String(MAX_PER_DAY_PER_EMAIL)} a day to one address`, async () => {
    // other@ has had the approval send and the resend: the cap.
    const res = await asMgr({
      method: 'POST',
      url: `/api/orgs/${String(orgId)}/invitations/${otherEmail}/resend`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('withdraws an invitation', async () => {
    const res = await asMgr({
      method: 'DELETE',
      url: `/api/orgs/${String(orgId)}/invitations/${otherEmail}`,
    });
    expect(res.json()).toEqual({ ok: true, withdrawn: 1 });
    expect(await storedHash(otherEmail)).toBeNull();
  });

  it(`caps an organization at ${String(MAX_OUTSTANDING_PER_ORG)} waiting, not counting expired ones`, async () => {
    expect(MAX_OUTSTANDING_PER_ORG).toBe(50);
    await h.db.deleteFrom('organization_invites').where('organization_id', '=', orgId).execute();
    const rows = Array.from({ length: MAX_OUTSTANDING_PER_ORG }, (_, i) => ({
      organization_id: orgId,
      email: `inv-bulk-${String(i)}-${String(orgId)}@example.org`,
      role: 'coordinator',
      status: 'pending',
      invited_by: mgrEmail,
      token_hash: sha256Hex(`bulk-${String(orgId)}-${String(i)}`),
      expires_at: new Date(Date.now() + 86_400_000),
    }));
    await h.db.insertInto('organization_invites').values(rows).execute();
    let res = await invite(asMgr, address('one-too-many'), 'coordinator');
    expect(res.statusCode).toBe(400);

    await h.db
      .updateTable('organization_invites')
      .set({ expires_at: new Date(Date.now() - 86_400_000) })
      .where('organization_id', '=', orgId)
      .execute();
    res = await invite(asMgr, address('after-expiry'), 'coordinator');
    expect(res.statusCode).toBe(200);
  });
});
