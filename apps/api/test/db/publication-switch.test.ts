/**
 * The public-archive switch over every board read. Port of the subject of
 * legacy scripts/publication-selftest.mjs (workstream C ported its card
 * half in publication.test.ts and left this one to D).
 *
 * Every public read is LISTED here rather than spot-checked, because the
 * failure this guards against is a door somebody forgot: one route left
 * ungated publishes the record on a site that said not to, and it would be
 * the quietest possible bug. A second test fails if a board route exists that
 * this list does not name.
 *
 * Legacy's distribution switch is not ported: it belongs with the exports
 * (workstream D2).
 */
import * as C from '@reportlog/contracts';
import type { FieldDefinition } from '@reportlog/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publicArchiveAvailable } from '../../src/board/publication.ts';
import { setOutsideAccess } from '../../src/identity/doors.ts';
import { writeSiteAccess } from '../../src/identity/siteAccess.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { liftCurtain } from './identity-helpers.ts';
import {
  approve,
  fileThread,
  moderationHarness,
  resetModerationSettings,
  staff,
} from './moderation-helpers.ts';

const Q: FieldDefinition[] = [
  { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
];
const NOTICE = 'does not publish a public archive';

let h: FilingHarness;
let ref = '';
let doors: string[] = [];
let slug = '';

const get = async (url: string) => {
  const res = await h.app.inject({ method: 'GET', url });
  return { status: res.statusCode, text: res.body };
};

async function set(value: boolean | null) {
  await h.db
    .updateTable('moderation_settings')
    .set({ public_archive_enabled: value })
    .where('id', '=', true)
    .execute();
}

beforeAll(async () => {
  h = await moderationHarness();
  await resetModerationSettings(h.db);
  const lb = await launchedLogbook(h.db, Q);
  const t = await fileThread(h.db, lb, Q, { what: 'A published account, visible on the board.' });
  await approve(h.db, t.threadId);
  ref = t.publicRef;
  slug = lb.slug;
  doors = [
    '/api/board',
    '/api/board/reports',
    `/api/board/reports?logbook=${lb.slug}`,
    `/api/board/reports/${ref}`,
    `/api/board/reports/${ref}/files`,
    '/api/board/reports.csv',
    '/api/board/stats',
    '/api/board/figures',
    '/api/v1/stats',
  ];
});
afterAll(async () => {
  await resetModerationSettings(h.db);
  await h.close();
});

describe('an untouched site', () => {
  it('stores NULL as NULL, not as false, and publishes', async () => {
    await set(null);
    const row = await h.db
      .selectFrom('moderation_settings')
      .select('public_archive_enabled')
      .executeTakeFirstOrThrow();
    expect(row.public_archive_enabled).toBeNull();
    expect(await publicArchiveAvailable(h.db)).toBe(true);
  });

  it('every door answers normally', async () => {
    for (const door of doors) {
      const r = await get(door);
      expect({ door, status: r.status }).toEqual({ door, status: 200 });
      expect(r.text).not.toContain(NOTICE);
    }
    expect((await get('/api/board/reports')).text).toContain(ref);
  });
});

describe('with the archive switched off', () => {
  it('every door withholds, the same way, and says why', async () => {
    await set(false);
    for (const door of doors) {
      const r = await get(door);
      expect({ door, says: r.text.includes(NOTICE) }).toEqual({ door, says: true });
      expect(r.text).not.toContain(ref);
    }
  });

  it('a JSON read answers 200 with published: false, the CSV a 404 with the same sentence', async () => {
    const list = await get('/api/board/reports');
    expect(list.status).toBe(200);
    expect(JSON.parse(list.text)).toMatchObject({ published: false });
    const csv = await get('/api/board/reports.csv');
    expect(csv.status).toBe(404);
  });
});

describe('and switched back on', () => {
  it('every door publishes again, at once (no cache to wait out)', async () => {
    await set(true);
    for (const door of doors) expect((await get(door)).text).not.toContain(NOTICE);
  });
});

describe('the switch is the administrators’', () => {
  it('only an administrator turns it, and null puts it back to "nobody chose"', async () => {
    const mod = await staff(h, 'mod', 'moderator');
    const admin = await staff(h, 'admin', 'admin');
    const refused = await mod.call({
      method: 'PUT',
      url: '/api/admin/moderation/archive',
      payload: { published: false },
    });
    expect(refused.statusCode).toBe(403);
    const off = await admin.call({
      method: 'PUT',
      url: '/api/admin/moderation/archive',
      payload: { published: false },
    });
    expect(off.json()).toEqual({ published: false, stored: false });
    const reset = await admin.call({
      method: 'PUT',
      url: '/api/admin/moderation/archive',
      payload: { published: null },
    });
    expect(reset.json()).toEqual({ published: true, stored: null });
  });
});

describe('the board is behind the site password, and is never a door', () => {
  it('every board read is locked while the password is on, even with a logbook open outside', async () => {
    await writeSiteAccess(h.db, { password: 'board-test-password', enabled: true });
    await setOutsideAccess(h.db, slug, 'door');
    try {
      for (const door of doors) {
        const res = await h.app.inject({ method: 'GET', url: door });
        expect({
          door,
          status: res.statusCode,
          code: res.json<{ error?: { code?: string } }>().error?.code,
        }).toEqual({
          door,
          status: 401,
          code: 'locked',
        });
      }
    } finally {
      await setOutsideAccess(h.db, slug, 'closed');
      await liftCurtain(h.db);
    }
  });
});

describe('no door is forgotten', () => {
  it('every GET contract under /api/board and /api/v1 is in the list above', () => {
    // Read from the contracts, which is what registered the routes, so a new
    // board read cannot be added without this test asking about it.
    const paths: string[] = [C.BOARD_CSV_PATH];
    const contracts: unknown[] = Object.values(C);
    for (const v of contracts) {
      if (typeof v !== 'object' || v === null || !('method' in v) || !('path' in v)) continue;
      const { method, path } = v;
      if (method === 'GET' && typeof path === 'string' && /^\/api\/(board|v1\/)/.test(path)) {
        paths.push(path);
      }
    }
    expect(paths.length).toBeGreaterThanOrEqual(8);
    for (const p of paths) {
      expect(h.app.hasRoute({ method: 'GET', url: p })).toBe(true);
      const covered = doors.some((d) => d.split('?')[0] === p.replace(':ref', ref));
      expect({ p, covered }).toEqual({ p, covered: true });
    }
  });
});
