/**
 * The directory of organizations, against a real database. Ported check for
 * check from legacy/scripts/alliance-selftest.mjs, plus the routes and the
 * "The Alliance ..." groups of legacy/scripts/selftest.js.
 *
 * The counting and the ordering are the whole feature, and neither exists
 * until rows are really in Postgres: a member is a row in
 * organization_memberships, a pending invitation is a row in another table,
 * and the difference is the difference between a headcount that certifies
 * something and one that does not.
 */
import { DIRECTORY_DISCLAIMER, DIRECTORY_NAME, DIRECTORY_WHAT_APPEARS } from '@reportlog/contracts';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { directory, setListed } from '../../src/site/directory.ts';
import { address, as, harness, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
const STEM = `Directory Test ${String(process.pid)}`;
const ids: Record<'big' | 'small' | 'empty' | 'shy', number> = {
  big: 0,
  small: 0,
  empty: 0,
  shy: 0,
};

async function org(name: string, details: string): Promise<number> {
  const row = await h.db
    .insertInto('organizations')
    .values({ name: `${STEM} ${name}`, details, verified_by: 'test@example.org' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function member(orgId: number, email: string, role = 'coordinator') {
  const userId = await seat(h.db, email, 'user');
  await h.db
    .insertInto('organization_memberships')
    .values({ organization_id: orgId, user_id: userId, role })
    .execute();
}

/** The directory's rows for this file's organizations, as [name, count]. */
async function names(): Promise<[string, number][]> {
  return (await directory(h.db))
    .filter((o) => o.name.startsWith(STEM))
    .map((o) => [o.name.slice(STEM.length + 1), o.member_count]);
}

beforeAll(async () => {
  h = await harness();
  ids.big = await org('Big', 'Statewide.');
  ids.small = await org('Small', 'Two people and a clipboard.');
  ids.empty = await org('Empty', 'Just signed up.');
  ids.shy = await org('Shy', 'Does not want listing.');
  for (const stem of ['a', 'b', 'c']) await member(ids.big, address(`dir-${stem}`));
  await member(ids.small, address('dir-d'));
  await member(ids.shy, address('dir-e'));
});
afterAll(async () => {
  await h.db
    .updateTable('organizations')
    .set({ listed: false })
    .where('name', 'like', `${STEM}%`)
    .execute();
  await h.close();
});

describe('opting in', () => {
  it('an organization that has not decided is not listed', async () => {
    expect(await names()).toEqual([]);
  });

  it('opting in puts them in the directory, and one that did not stays out', async () => {
    for (const id of [ids.big, ids.small, ids.empty]) await setListed(h.db, id, true);
    const listed = await names();
    expect(listed).toHaveLength(3);
    expect(listed.some(([n]) => n === 'Shy')).toBe(false);
  });
});

describe('ranking, by member count and nothing else', () => {
  it('the largest is first, the counts descend, and they are exact rather than banded', async () => {
    const listed = await names();
    expect(listed).toEqual([
      ['Big', 3],
      ['Small', 1],
      ['Empty', 0],
    ]);
  });

  it('publishes no report count anywhere', async () => {
    // A report-count ranking would be a public incentive to file more
    // reports, which is an argument for manufacturing them.
    const keys = new Set((await directory(h.db)).flatMap((r) => Object.keys(r)));
    expect([...keys].filter((k) => /report/i.test(k))).toEqual([]);
  });

  it('shows an organization with nobody in it as an honest zero', async () => {
    expect(await names()).toContainEqual(['Empty', 0]);
  });
});

describe('what counts as a member', () => {
  it('an invitation nobody accepted does not count', async () => {
    await h.db
      .insertInto('organization_invites')
      .values({
        organization_id: ids.small,
        email: address('never-accepted'),
        role: 'coordinator',
        invited_by: 'test@example.org',
        status: 'pending',
        token_hash: 'a'.repeat(64),
        expires_at: new Date(Date.now() + 86_400_000),
      })
      .execute();
    expect((await names()).find(([n]) => n === 'Small')?.[1]).toBe(1);
  });
});

describe('opting out', () => {
  it('removes them, keeps the date they joined, and re-listing does not make them look new', async () => {
    const before = await h.db
      .selectFrom('organizations')
      .select('listed_at')
      .where('id', '=', ids.big)
      .executeTakeFirstOrThrow();
    expect(before.listed_at).not.toBeNull();

    await setListed(h.db, ids.big, false);
    expect((await names()).some(([n]) => n === 'Big')).toBe(false);
    const after = await h.db
      .selectFrom('organizations')
      .select(['listed', 'listed_at'])
      .where('id', '=', ids.big)
      .executeTakeFirstOrThrow();
    expect(after.listed).toBe(false);
    expect(after.listed_at?.toISOString()).toBe(before.listed_at?.toISOString());

    const back = await setListed(h.db, ids.big, true);
    expect(back.listed_at?.toISOString()).toBe(before.listed_at?.toISOString());
  });
});

describe('the sentences that have to be there', () => {
  it('the disclaimer says listing is not verification, that no standard exists, and that it is not an endorsement', () => {
    expect(DIRECTORY_DISCLAIMER).toMatch(/not verification/i);
    expect(DIRECTORY_DISCLAIMER).toMatch(/no standard/i);
    expect(DIRECTORY_DISCLAIMER).toMatch(/not (an|as an) endorsement/i);
  });

  it('the directory keeps its chosen name', () => {
    expect(DIRECTORY_NAME).toBe('Participating organizations');
  });

  it('the listing toggle names all three things that appear, and says the count is exact', () => {
    const all = DIRECTORY_WHAT_APPEARS.join(' ');
    expect(all).toMatch(/name/i);
    expect(all).toMatch(/date/i);
    expect(all).toMatch(/accepted an invitation/i);
    expect(all).toMatch(/exact number, not a range/i);
  });
});

describe('not chained', () => {
  it('an organization is not listed until it says so (the column defaults to false)', () => {
    const sql = readFileSync(
      new URL('../../migrations/20261019180450_site_feedback_digests.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toMatch(/ADD COLUMN listed boolean NOT NULL DEFAULT false/);
  });

  it('nothing that builds or checks a sealed object names the listing', () => {
    // The boundary check stops the seal and chain code importing this
    // folder; this stops them reading the column directly.
    const dirs = ['../../src/chain/', '../../../../packages/seal/src/'];
    for (const dir of dirs) {
      const url = new URL(dir, import.meta.url);
      for (const f of readdirSync(url).filter((n) => n.endsWith('.ts'))) {
        const src = readFileSync(new URL(f, url), 'utf8');
        expect(src, `${dir}${f} reads the listing`).not.toMatch(
          /\blisted_at\b|\borganizations\.listed\b|\bo\.listed\b/,
        );
      }
    }
  });
});

describe('the routes', () => {
  let managerSession: string;
  let coordinatorSession: string;
  let adminSession: string;

  beforeAll(async () => {
    const mgr = address('dir-mgr');
    const coord = address('dir-coord');
    const admin = address('dir-admin');
    await member(ids.shy, mgr, 'manager');
    await member(ids.shy, coord, 'coordinator');
    await seat(h.db, admin, 'admin');
    managerSession = await signIn(h, mgr);
    coordinatorSession = await signIn(h, coord);
    adminSession = await signIn(h, admin);
  });

  it('serves the disclaimer with the rows', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/directory' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: DIRECTORY_NAME, disclaimer: DIRECTORY_DISCLAIMER });
  });

  it('lets a manager see what listing publishes and list their organization', async () => {
    const asMgr = as(h, managerSession);
    const before = await asMgr({ method: 'GET', url: `/api/directory/listing/${String(ids.shy)}` });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({
      listed: false,
      joined: null,
      member_count: 3,
      what_appears: [...DIRECTORY_WHAT_APPEARS],
    });
    expect(before.json<{ leaving: string }>().leaving).toMatch(/does not remove/);

    const res = await asMgr({
      method: 'PUT',
      url: `/api/directory/listing/${String(ids.shy)}`,
      payload: { listed: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ listed: true });
    expect((await names()).some(([n]) => n === 'Shy')).toBe(true);
  });

  it('refuses a coordinator, a manager of another organization, and nobody signed in', async () => {
    const url = `/api/directory/listing/${String(ids.shy)}`;
    const coord = await as(
      h,
      coordinatorSession,
    )({ method: 'PUT', url, payload: { listed: false } });
    expect(coord.statusCode).toBe(403);
    const other = await as(
      h,
      managerSession,
    )({
      method: 'PUT',
      url: `/api/directory/listing/${String(ids.big)}`,
      payload: { listed: false },
    });
    expect(other.statusCode).toBe(403);
    const anon = await h.app.inject({ method: 'PUT', url, payload: { listed: false } });
    expect(anon.statusCode).toBe(401);
  });

  it('lets an administrator change it too', async () => {
    const res = await as(
      h,
      adminSession,
    )({
      method: 'PUT',
      url: `/api/directory/listing/${String(ids.shy)}`,
      payload: { listed: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ listed: false });
  });
});
