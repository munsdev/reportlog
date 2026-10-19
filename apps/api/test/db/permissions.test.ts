/**
 * The permissions a reporter gives and takes back, against a real database.
 *
 * Ported from legacy/scripts/permissions-selftest.mjs. The feature is a
 * PROJECTION over an append-only log (the newest row for a thread and a
 * permission wins), and that only exists once rows round-trip through
 * Postgres; the append-only rule is a trigger, which needs a database too.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import {
  PERMISSIONS,
  permissionHistory,
  permissionsFor,
  permissionsForMany,
  setPermission,
} from '../../src/permissions/log.ts';
import { launchedLogbook } from './helpers.ts';
import { fileThroughRoutes, filingHarness, threadOf } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { address, as, signIn } from './identity-helpers.ts';

let h: FilingHarness;
let lb: { id: number; slug: string };
/** Threads need a head to hang a permission on: these are real filed reports. */
const threads: string[] = [];
const refs: string[] = [];

beforeAll(async () => {
  h = await filingHarness();
  lb = await launchedLogbook(h.db, [
    { key: 'what', kind: 'short_text', label: 'What?', required: true },
  ]);
  for (const n of [1, 2, 3]) {
    const ref = await fileThroughRoutes(
      h,
      lb.slug,
      { what: `Report ${String(n)}` },
      address('perm'),
    );
    refs.push(ref);
    threads.push(await threadOf(h.db, ref));
  }
});
afterAll(async () => {
  await h.close();
});

const t = (i: number) => threads[i] ?? '';

describe('nothing granted until somebody grants it', () => {
  it('a thread with no rows has none, in the full shape every caller gets', async () => {
    const now = await permissionsFor(h.db, t(0));
    expect(now).toEqual({
      contact_passing: false,
      attachment_publication: false,
      evidence_request: false,
    });
    expect(Object.keys(now).sort()).toEqual([...PERMISSIONS].sort());
  });
});

describe('the projection: the newest row wins', () => {
  it('grants, revokes, grants again, and keeps every step', async () => {
    await setPermission(h.db, { threadId: t(0), permission: 'contact_passing', granted: true });
    expect((await permissionsFor(h.db, t(0))).contact_passing).toBe(true);
    await setPermission(h.db, {
      threadId: t(0),
      permission: 'contact_passing',
      granted: false,
      reason: 'changed my mind',
    });
    expect((await permissionsFor(h.db, t(0))).contact_passing).toBe(false);
    await setPermission(h.db, { threadId: t(0), permission: 'contact_passing', granted: true });
    expect((await permissionsFor(h.db, t(0))).contact_passing).toBe(true);
    const history = await permissionHistory(h.db, t(0));
    expect(history).toHaveLength(3);
    expect(history[0]?.granted).toBe(true);
    expect(history.some((r) => r.reason === 'changed my mind')).toBe(true);
  });
});

describe('the permissions are independent', () => {
  it('granting or revoking one leaves the others', async () => {
    await setPermission(h.db, {
      threadId: t(1),
      permission: 'attachment_publication',
      granted: true,
    });
    let now = await permissionsFor(h.db, t(1));
    expect(now).toMatchObject({ attachment_publication: true, contact_passing: false });
    await setPermission(h.db, { threadId: t(1), permission: 'contact_passing', granted: true });
    await setPermission(h.db, {
      threadId: t(1),
      permission: 'attachment_publication',
      granted: false,
    });
    now = await permissionsFor(h.db, t(1));
    expect(now).toMatchObject({ attachment_publication: false, contact_passing: true });
  });

  it('one thread cannot read or change another, and the batched read agrees', async () => {
    expect((await permissionsFor(h.db, t(2))).contact_passing).toBe(false);
    const many = await permissionsForMany(h.db, threads);
    expect(many.get(t(0))?.contact_passing).toBe(true);
    expect(many.get(t(1))?.attachment_publication).toBe(false);
    expect(many.get(t(2))).toEqual({
      contact_passing: false,
      attachment_publication: false,
      evidence_request: false,
    });
  });
});

describe('the log is append-only, and the database enforces it', () => {
  it('refuses UPDATE, DELETE and TRUNCATE', async () => {
    await expect(
      h.db.updateTable('report_permissions_log').set({ granted: false }).execute(),
    ).rejects.toThrow(/append-only/);
    await expect(h.db.deleteFrom('report_permissions_log').execute()).rejects.toThrow(
      /append-only/,
    );
    // Row triggers do not fire for TRUNCATE, so it is said separately.
    await expect(sql`TRUNCATE report_permissions_log`.execute(h.db)).rejects.toThrow(/append-only/);
  });
});

describe('what the table refuses to record at all', () => {
  it('an unknown permission, and any actor but the reporter', async () => {
    await expect(
      h.db
        .insertInto('report_permissions_log')
        .values({ thread_id: t(2), permission: 'publish_my_identity', granted: true })
        .execute(),
    ).rejects.toThrow(/check constraint/);
    await expect(
      h.db
        .insertInto('report_permissions_log')
        .values({
          thread_id: t(2),
          permission: 'contact_passing',
          granted: true,
          actor: 'moderator',
        })
        .execute(),
    ).rejects.toThrow(/check constraint/);
    // A permission for a thread that does not exist is not a permission.
    await expect(
      h.db
        .insertInto('report_permissions_log')
        .values({ thread_id: randomUUID(), permission: 'contact_passing', granted: true })
        .execute(),
    ).rejects.toThrow(/foreign key/);
  });

  it('the module refuses an unknown name before the database has to', async () => {
    await expect(
      setPermission(h.db, { threadId: t(2), permission: 'whatever' as never, granted: true }),
    ).rejects.toThrow(/unknown permission/);
  });
});

describe('through the route, as the reporter', () => {
  it('gives and takes back, on their own report only', async () => {
    const email = address('route');
    const ref = await fileThroughRoutes(h, lb.slug, { what: 'Mine' }, email);
    const thread = await threadOf(h.db, ref);
    const me = as(h, await signIn(h, email));
    const post = (body: Record<string, unknown>) =>
      me({ method: 'POST', url: `/api/mine/reports/${thread}/permissions`, payload: body });

    const given = await post({ permission: 'evidence_request', granted: true });
    expect(given.statusCode).toBe(200);
    expect(
      given.json<{ permissions: Record<string, boolean> }>().permissions.evidence_request,
    ).toBe(true);
    expect(
      (await post({ permission: 'evidence_request', granted: false })).json<{
        permissions: Record<string, boolean>;
      }>().permissions.evidence_request,
    ).toBe(false);
    expect((await post({ permission: 'whatever', granted: true })).statusCode).toBe(400);
    expect((await post({ permission: 'contact_passing' })).statusCode).toBe(400);

    const stranger = as(h, await signIn(h, address('stranger')));
    const r = await stranger({
      method: 'POST',
      url: `/api/mine/reports/${thread}/permissions`,
      payload: { permission: 'contact_passing', granted: true },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('ONLY THE REPORTER CHANGES A REPORTER’S PERMISSION', () => {
  it('setPermission is called from one place in the server: the reporter’s own scope', () => {
    const src = fileURLToPath(new URL('../../src/', import.meta.url));
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && /\bsetPermission\(/.test(readFileSync(p, 'utf8'))) {
          callers.push(p.slice(src.length));
        }
      }
    };
    walk(src);
    expect(callers.sort()).toEqual(['filing/routes.ts', 'permissions/log.ts']);
  });
});

describe('none of this is in the record', () => {
  it('a sealed report with permissions granted carries none of them, and still verifies', async () => {
    const v = await verifyReport(h.db, refs[0] ?? '');
    expect(v?.content.ok).toBe(true);
    expect(v?.canonical_json).not.toMatch(/permission|contact_passing|attachment_publication/);
  });
});
