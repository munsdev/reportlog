/**
 * What identity left undone (workstream A2), against a real database: the
 * team-member flag and desks, the roster, organization logos, and stopping a
 * digest from its email.
 *
 * Legacy had no self-test for any of these. setTeamMemberFlag, the roster
 * and desks were tested only by their UI; the checks here are what
 * legacy/src/roles.js, desks.js and routes/orgs.js promised, plus what the
 * rebuild promises on top (a logo is re-encoded, a stop link's GET changes
 * nothing).
 */
import { DESK_IDS } from '@reportlog/contracts';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capturingMailer } from '../../src/email/mailer.ts';
import { hashPassword } from '../../src/identity/secrets.ts';
import { normalizeDesks } from '../../src/identity/flags.ts';
import { partlyHidden } from '../../src/identity/digestStop.ts';
import { SETTLE_MS, runDigest } from '../../src/site/digest.ts';
import { filesHarness, jpegWithGps, SECRET, toolsMissing } from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { fileReport, launchedLogbook } from './helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';

let h: FilesHarness;
const adminEmail = address('a2-admin');
const amEmail = address('a2-am');
const modEmail = address('a2-mod');
let admin = '';
let am = '';
let mod = '';

beforeAll(async () => {
  h = await filesHarness();
  await seat(h.db, adminEmail, 'admin');
  await seat(h.db, amEmail, 'access_manager');
  await seat(h.db, modEmail, 'moderator');
  admin = await signIn(h, adminEmail);
  am = await signIn(h, amEmail);
  mod = await signIn(h, modEmail);
});
afterAll(async () => {
  await h.close();
});

const auditFor = (email: string) =>
  h.db
    .selectFrom('role_audit')
    .select(['actor_email', 'axis', 'action', 'detail', 'organization_id'])
    .where('subject_email', '=', email)
    .orderBy('id')
    .execute();

// ── the team-member flag and desks ──────────────────────────────────────

describe('the team-member flag', () => {
  const setTeam = (session: string, payload: object) =>
    as(h, session)({ method: 'POST', url: '/api/access/team-member', payload });

  it('an Access Manager puts somebody on the team, with desks, before they have signed in', async () => {
    const email = address('a2-team');
    const res = await setTeam(am, { email, teamMember: true, desks: ['outreach', 'moderating'] });
    expect(res.statusCode).toBe(200);
    // Kept in the list's own order, not the order they were ticked.
    expect(res.json()).toEqual({ ok: true, unchanged: false, desks: ['moderating', 'outreach'] });
    const row = await h.db
      .selectFrom('users')
      .select(['role', 'is_team_member', 'desks'])
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ role: 'user', is_team_member: true, desks: ['moderating', 'outreach'] });
    // What was granted is in the trail, desks and all.
    expect(await auditFor(email)).toEqual([
      {
        actor_email: amEmail,
        axis: 'flag',
        action: 'grant',
        detail: 'team member: moderating, outreach',
        organization_id: null,
      },
    ]);
  });

  it('their account says so, and it gives them no role', async () => {
    const email = address('a2-team-me');
    await setTeam(admin, { email, teamMember: true, desks: ['testing'] });
    const session = await signIn(h, email);
    const me = (await as(h, session)({ method: 'GET', url: '/api/auth/me' })).json<unknown>();
    expect(me).toMatchObject({
      signedIn: true,
      role: 'user',
      teamMember: true,
      desks: ['testing'],
      grantsAccess: false,
    });
    // Being on the team opens no staff route.
    expect((await as(h, session)({ method: 'GET', url: '/api/access/people' })).statusCode).toBe(
      403,
    );
  });

  it('changing only the desks is a change, and saving the same thing writes nothing', async () => {
    const email = address('a2-team-desks');
    await setTeam(am, { email, teamMember: true, desks: ['dev'] });
    const again = await setTeam(am, { email, teamMember: true, desks: ['dev'] });
    expect(again.json()).toMatchObject({ unchanged: true });
    await setTeam(am, { email, teamMember: true, desks: ['dev', 'design'] });
    expect((await auditFor(email)).map((a) => [a.action, a.detail])).toEqual([
      ['grant', 'team member: dev'],
      ['change', 'team member: dev, design'],
    ]);
  });

  it('taking somebody off the team takes their desks with it', async () => {
    const email = address('a2-team-off');
    await setTeam(am, { email, teamMember: true, desks: ['policy'] });
    const off = await setTeam(am, { email, teamMember: false, desks: ['policy'] });
    expect(off.json()).toMatchObject({ desks: [] });
    const row = await h.db
      .selectFrom('users')
      .select(['is_team_member', 'desks'])
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ is_team_member: false, desks: [] });
    expect((await auditFor(email)).at(-1)).toMatchObject({ action: 'revoke' });
  });

  it('the database refuses desks on somebody who is not on the team', async () => {
    const email = address('a2-team-db');
    await seat(h.db, email, 'user');
    await expect(
      h.db
        .updateTable('users')
        .set({ desks: ['dev'] })
        .where('email', '=', email)
        .execute(),
    ).rejects.toThrow(/users_desks_need_team/);
  });

  it('a desk that does not exist is dropped, never stored', () => {
    expect(normalizeDesks(['dev', 'nonsense', 'dev', ' outreach ', null])).toEqual([
      'dev',
      'outreach',
    ]);
    expect(normalizeDesks(undefined)).toEqual([]);
    // The ids are the old application's, so a desk stored there keeps its meaning.
    expect(DESK_IDS).toEqual([
      'lead_dev',
      'dev',
      'accessibility',
      'moderating',
      'testing',
      'group',
      'policy',
      'translation',
      'design',
      'outreach',
    ]);
  });

  it('a moderator cannot set it, nor can somebody signed out, nor anybody for themselves without the role', async () => {
    const email = address('a2-team-refused');
    expect((await setTeam(mod, { email, teamMember: true, desks: [] })).statusCode).toBe(403);
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/access/team-member',
          payload: { email, teamMember: true, desks: [] },
        })
      ).statusCode,
    ).toBe(401);
    expect(await auditFor(email)).toEqual([]);
  });

  it('a bad address is refused with a sentence', async () => {
    const res = await setTeam(am, { email: 'not an address', teamMember: true, desks: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toBe(
      'Enter a valid email address.',
    );
  });
});

describe('the tester flag goes through the same ceiling', () => {
  it('an Access Manager may give it; a moderator may not', async () => {
    const email = address('a2-tester');
    const give = (session: string) =>
      as(
        h,
        session,
      )({ method: 'POST', url: '/api/admin/testers', payload: { email, tester: true } });
    expect((await give(mod)).statusCode).toBe(403);
    expect((await give(am)).statusCode).toBe(200);
    expect(await auditFor(email)).toEqual([
      {
        actor_email: amEmail,
        axis: 'flag',
        action: 'grant',
        detail: 'tester',
        organization_id: null,
      },
    ]);
  });
});

// ── the roster ──────────────────────────────────────────────────────────

describe('the roster', () => {
  let orgId = 0;
  const coordEmail = address('a2-coord');
  const otherCoordEmail = address('a2-coord-other');
  const managerEmail = address('a2-manager');
  const nobodyEmail = address('a2-nobody');

  async function filedThroughIntake(coordinatorId: number) {
    const lb = await launchedLogbook(h.db);
    const { row } = await fileReport(h.db, lb, { what: 'Typed up from a paper form.', has: 'no' });
    const batch = await h.db
      .insertInto('intake_batches')
      .values({
        organization_id: orgId,
        coordinator_id: coordinatorId,
        status: 'submitted',
        submitted_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('intake_drafts')
      .values({ batch_id: batch.id, ordinal: 1, report_id: row.id })
      .execute();
    return row.id;
  }

  beforeAll(async () => {
    const org = await h.db
      .insertInto('organizations')
      .values({ name: `Roster Org ${String(process.pid)}`, verified_by: adminEmail })
      .returning('id')
      .executeTakeFirstOrThrow();
    orgId = org.id;
    const coord = await seat(h.db, coordEmail, 'user');
    const other = await seat(h.db, otherCoordEmail, 'user');
    const manager = await seat(h.db, managerEmail, 'user');
    await seat(h.db, nobodyEmail, 'user');
    for (const [userId, role] of [
      [coord, 'coordinator'],
      [other, 'coordinator'],
      [manager, 'manager'],
    ] as const) {
      await h.db
        .insertInto('organization_memberships')
        .values({ organization_id: orgId, user_id: userId, role })
        .execute();
    }
    await filedThroughIntake(coord);
    await filedThroughIntake(coord);
    await filedThroughIntake(other);
  });

  const get = (session: string, query = '') =>
    as(h, session)({ method: 'GET', url: `/api/access/roster${query}` });

  it('counts what each person typed up, and what their organizations filed through anybody', async () => {
    const res = await get(am);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ days: number; people: { email: string }[] }>();
    expect(body.days).toBe(30);
    const byEmail = new Map(body.people.map((p) => [p.email, p] as const));
    expect(byEmail.get(coordEmail)).toMatchObject({
      role: 'user',
      filedByThem: 2,
      filedForTheirOrganizations: 3,
      organizations: [{ name: `Roster Org ${String(process.pid)}`, role: 'coordinator' }],
    });
    expect(byEmail.get(otherCoordEmail)).toMatchObject({
      filedByThem: 1,
      filedForTheirOrganizations: 3,
    });
    // A manager typed nothing up, and still sees the organization's total.
    expect(byEmail.get(managerEmail)).toMatchObject({
      filedByThem: 0,
      filedForTheirOrganizations: 3,
    });
  });

  it('lists only people with a role, a flag or an organization', async () => {
    const people = (await get(am)).json<{ people: { email: string }[] }>().people;
    expect(people.some((p) => p.email === nobodyEmail)).toBe(false);
    expect(people.some((p) => p.email === modEmail)).toBe(true);
  });

  it('says when somebody last acted as staff', async () => {
    const people = (await get(admin)).json<{
      people: { email: string; lastStaffAction: string | null }[];
    }>().people;
    // The Access Manager gave flags above, which is on the role audit.
    const amRow = people.find((p) => p.email === amEmail);
    expect(amRow?.lastStaffAction).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(people.find((p) => p.email === coordEmail)?.lastStaffAction).toBeNull();
  });

  it('takes a period in days, from one to a year', async () => {
    expect((await get(am, '?days=7')).json<{ days: number }>().days).toBe(7);
    expect((await get(am, '?days=0')).statusCode).toBe(400);
    expect((await get(am, '?days=366')).statusCode).toBe(400);
  });

  it('is for those who grant access', async () => {
    expect((await get(mod)).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'GET', url: '/api/access/roster' })).statusCode).toBe(401);
  });
});

// ── organization logos ──────────────────────────────────────────────────

describe.skipIf(toolsMissing)('organization logos', () => {
  let orgId = 0;
  const managerEmail = address('a2-logo-manager');
  const coordEmail = address('a2-logo-coord');
  let manager = '';
  let coord = '';
  let jpeg: Buffer;

  const upload = (session: string | undefined, body: Buffer, type = 'image/jpeg') =>
    h.app.inject({
      method: 'PUT',
      url: `/api/orgs/${String(orgId)}/logo`,
      headers: { 'content-type': type },
      payload: body,
      cookies: session ? { session_token: session } : {},
    });

  const logoObjects = () => {
    try {
      return readdirSync(join(h.files.dir, 'renditions', 'logos')).filter(
        (f) => !f.includes('.part-'),
      );
    } catch {
      return [];
    }
  };

  beforeAll(async () => {
    const org = await h.db
      .insertInto('organizations')
      .values({ name: `Logo Org ${String(process.pid)}`, verified_by: adminEmail })
      .returning('id')
      .executeTakeFirstOrThrow();
    orgId = org.id;
    for (const [email, role] of [
      [managerEmail, 'manager'],
      [coordEmail, 'coordinator'],
    ] as const) {
      const userId = await seat(h.db, email, 'user');
      await h.db
        .insertInto('organization_memberships')
        .values({ organization_id: orgId, user_id: userId, role })
        .execute();
    }
    manager = await signIn(h, managerEmail);
    coord = await signIn(h, coordEmail);
    jpeg = jpegWithGps(h.files.dir);
  });

  it('a manager uploads one, and only the picture is kept', async () => {
    expect(jpeg.includes(Buffer.from('TestCam'))).toBe(true);
    const res = await upload(manager, jpeg);
    expect(res.statusCode).toBe(200);
    const { logo } = res.json<{ logo: string }>();
    expect(logo).toMatch(/^\/api\/directory\/logos\/[a-f0-9]{32}\.jpg$/);
    const [stored] = logoObjects();
    expect(stored).toBeDefined();
    const bytes = readFileSync(join(h.files.dir, 'renditions', 'logos', stored ?? ''));
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(bytes.includes(Buffer.from('TestCam'))).toBe(false);
    expect(bytes.includes(Buffer.from('Exif'))).toBe(false);
  });

  it('while the organization is not listed, only those who could change it see it', async () => {
    const org = (await as(h, manager)({ method: 'GET', url: `/api/orgs/${String(orgId)}` })).json<{
      organization: { logo: string };
    }>();
    const url = org.organization.logo;
    expect(url).toMatch(/^\/api\/directory\/logos\//);
    expect((await h.app.inject({ method: 'GET', url })).statusCode).toBe(404);
    expect((await as(h, coord)({ method: 'GET', url })).statusCode).toBe(404);
    const seen = await as(h, manager)({ method: 'GET', url });
    expect(seen.statusCode).toBe(200);
    expect(seen.headers['content-type']).toBe('image/jpeg');
    expect((await as(h, admin)({ method: 'GET', url })).statusCode).toBe(200);
  });

  it('once listed, the directory shows it to anybody', async () => {
    await h.db
      .updateTable('organizations')
      .set({ listed: true, listed_at: new Date() })
      .where('id', '=', orgId)
      .execute();
    const dir = (await h.app.inject({ method: 'GET', url: '/api/directory' })).json<{
      organizations: { name: string; logo: string | null }[];
    }>();
    const entry = dir.organizations.find((o) => o.name === `Logo Org ${String(process.pid)}`);
    expect(entry?.logo).toMatch(/^\/api\/directory\/logos\//);
    expect((await h.app.inject({ method: 'GET', url: entry?.logo ?? '' })).statusCode).toBe(200);
    await h.db
      .updateTable('organizations')
      .set({ listed: false })
      .where('id', '=', orgId)
      .execute();
  });

  it('replacing it deletes the old object', async () => {
    const before = logoObjects();
    expect(before).toHaveLength(1);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const res = await upload(manager, png, 'image/png');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ logo: string }>().logo).toMatch(/\.png$/);
    const after = logoObjects();
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before[0]);
    expect(
      await h.db
        .selectFrom('storage_deletions')
        .select('key')
        .where('key', 'like', 'logos/%')
        .execute(),
    ).toEqual([]);
  });

  it('refuses what is not an image, whatever it says it is', async () => {
    const res = await upload(manager, Buffer.from(`<svg>${SECRET}</svg>`), 'image/png');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toBe(
      'A logo must be a PNG, JPEG or WebP image.',
    );
  });

  it('refuses one that is too large', async () => {
    const big = Buffer.concat([jpeg, Buffer.alloc(1024 * 1024)]);
    const res = await upload(manager, big);
    expect(res.statusCode).toBe(413);
  });

  it('a coordinator cannot change it, nor can a stranger', async () => {
    expect((await upload(coord, jpeg)).statusCode).toBe(403);
    expect((await upload(undefined, jpeg)).statusCode).toBe(401);
  });

  it('an administrator replacing it is on the record; a manager doing so is not', async () => {
    const res = await upload(admin, jpeg);
    expect(res.statusCode).toBe(200);
    const trail = await h.db
      .selectFrom('role_audit')
      .select(['actor_email', 'detail'])
      .where('organization_id', '=', orgId)
      .execute();
    expect(trail).toEqual([
      { actor_email: adminEmail, detail: 'an administrator replaced the organization’s logo' },
    ]);
  });

  it('a manager removes it, and its object goes', async () => {
    const res = await as(h, manager)({ method: 'DELETE', url: `/api/orgs/${String(orgId)}/logo` });
    expect(res.statusCode).toBe(200);
    expect(logoObjects()).toEqual([]);
    const row = await h.db
      .selectFrom('organizations')
      .select('logo_key')
      .where('id', '=', orgId)
      .executeTakeFirstOrThrow();
    expect(row.logo_key).toBeNull();
  });

  it('the database takes only keys this code makes', async () => {
    await expect(
      h.db
        .updateTable('organizations')
        .set({ logo_key: '../evidence/abc' })
        .where('id', '=', orgId)
        .execute(),
    ).rejects.toThrow(/logo_key/);
  });
});

describe('a logo with no file storage', () => {
  it('is refused with a sentence, not a crash', async () => {
    const { buildApp } = await import('../../src/app.ts');
    const app = await buildApp({
      config: { LOG_LEVEL: 'silent' },
      db: h.db,
      mailer: capturingMailer(),
    });
    const org = await h.db
      .insertInto('organizations')
      .values({ name: `No Storage Org ${String(process.pid)}`, verified_by: adminEmail })
      .returning('id')
      .executeTakeFirstOrThrow();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/orgs/${String(org.id)}/logo`,
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      cookies: { session_token: admin },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(
      /nowhere to keep files/,
    );
    await app.close();
  });
});

// ── stopping a digest from its email ────────────────────────────────────

describe('stopping the digest from its email', () => {
  const readerEmail = address('a2-reader');
  let readerId = 0;
  let link = '';
  let token = '';
  let clock = Date.now();

  const subscription = () =>
    h.db
      .selectFrom('digest_subscriptions')
      .select('frequency')
      .where('user_id', '=', readerId)
      .executeTakeFirst();

  beforeAll(async () => {
    readerId = await seat(h.db, readerEmail, 'user');
    await h.db
      .insertInto('digest_subscriptions')
      .values({ user_id: readerId, frequency: 'hourly', logbooks: null })
      .execute();
    const lb = await launchedLogbook(h.db);
    const { row } = await fileReport(h.db, lb, { what: 'A published account.', has: 'no' });
    await h.db
      .insertInto('report_heads')
      .values({
        thread_id: row.thread_id,
        current_report_id: row.id,
        moderation_status: 'valid',
        updated_at: new Date((clock += 1000)),
      })
      .execute();
    const mailer = capturingMailer();
    await runDigest({
      db: h.db,
      mailer,
      siteOrigin: 'https://reports.example.test',
      log: () => undefined,
      frequency: 'hourly',
      now: () => new Date((clock += 2 * SETTLE_MS)),
    });
    const text = mailer.lastTo(readerEmail)?.text ?? '';
    link =
      /https:\/\/reports\.example\.test\/notifications\/stop\/[a-f0-9]{64}/.exec(text)?.[0] ?? '';
    token = link.split('/').at(-1) ?? '';
  });

  const api = (method: 'GET' | 'POST', t = token, cookies: Record<string, string> = {}) =>
    h.app.inject({ method, url: `/api/notifications/stop/${t}`, cookies });

  it('every digest email carries its own link, and still says where to choose more narrowly', () => {
    expect(link).not.toBe('');
  });

  it('opening the link changes nothing, however often', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await api('GET');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        state: 'subscribed',
        address: partlyHidden(readerEmail),
        frequency: 'hourly',
      });
    }
    expect(await subscription()).toEqual({ frequency: 'hourly' });
  });

  it('the address is shown only in part', () => {
    expect(partlyHidden('casey@example.org')).toBe('c•••@example.org');
    expect(partlyHidden(readerEmail)).not.toContain(readerEmail.split('@')[0]);
  });

  it('works in front of the site password, while the rest of the site stays behind it', async () => {
    await h.db
      .updateTable('site_access')
      .set({ enabled: true, password_hash: await hashPassword('a2-stop-password') })
      .where('id', '=', true)
      .execute();
    try {
      expect((await api('GET')).statusCode).toBe(200);
      expect((await h.app.inject({ method: 'GET', url: '/api/directory' })).statusCode).toBe(401);
      // The POST below is the person pressing the button, password or not.
      const stopped = await api('POST');
      expect(stopped.statusCode).toBe(200);
      expect(stopped.json()).toEqual({ state: 'stopped', address: partlyHidden(readerEmail) });
    } finally {
      await h.db
        .updateTable('site_access')
        .set({ enabled: false, password_hash: null })
        .where('id', '=', true)
        .execute();
    }
    expect(await subscription()).toBeUndefined();
  });

  it('using it again is harmless and says it is already stopped', async () => {
    expect((await api('POST')).json()).toEqual({
      state: 'stopped',
      address: partlyHidden(readerEmail),
    });
    expect((await api('GET')).json()).toMatchObject({ state: 'stopped' });
  });

  it('an unknown link and an expired one get the same answer', async () => {
    expect((await api('GET', 'f'.repeat(64))).json()).toEqual({ state: 'gone' });
    expect((await api('POST', 'not-a-token')).json()).toEqual({ state: 'gone' });
    await h.db
      .updateTable('digest_stop_links')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('user_id', '=', readerId)
      .execute();
    expect((await api('GET')).json()).toEqual({ state: 'gone' });
  });

  it('keeps only the hash of the link', async () => {
    const rows = await h.db
      .selectFrom('digest_stop_links')
      .select('token_hash')
      .where('user_id', '=', readerId)
      .execute();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
  });
});
