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
 * And the distribution switch (decision 11, legacy 009's second half): the
 * bulk downloads, the spreadsheet and the published chain file, need it as
 * well, and it is OFF until an administrator says yes.
 */
import * as C from '@reportlog/contracts';
import type { FieldDefinition } from '@reportlog/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DISTRIBUTION_OFF,
  distributionAvailable,
  publicArchiveAvailable,
  setDistribution,
} from '../../src/board/publication.ts';
import { setOutsideAccess } from '../../src/identity/doors.ts';
import { createMap, deleteMap } from '../../src/maps/manage.ts';
import { writeSiteAccess } from '../../src/identity/siteAccess.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { runDigest } from '../../src/site/digest.ts';
import { launchedLogbook } from './helpers.ts';
import { SITE, liftCurtain } from './identity-helpers.ts';
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

/**
 * Public reads that are deliberately NOT the archive, each with its reason.
 * They answer the same with the switch off, and a test below says so.
 */
const NOT_THE_ARCHIVE: Record<string, string> = {
  // The site's own sentences, by digest: a reporter checking their own
  // report's seal needs them whatever the site publishes this week.
  '/api/v1/consent-texts': 'the wordings of the publication question (board/consentTexts.ts)',
  // When the flood switches were used: a statement about the site, not the
  // archive, and the one a flood's victims most need while it is off.
  '/api/board/switches': 'the public log of the flood switches (moderation/switches.ts)',
};

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
  // The archive switch is the subject until "the distribution switch" below,
  // so the downloads are allowed and only the archive switch decides.
  await setDistribution(h.db, true, 'admin@example.org');
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
    `/api/files/report/${ref}`,
    '/api/board/reports.csv',
    '/api/board/stats',
    '/api/board/figures',
    '/api/v1/stats',
    // Plan E (PE3): counts by origin, place and time; declined by reason.
    '/api/board/counts',
    '/api/board/declined',
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

describe('what is not the archive', () => {
  it('answers the same with the archive switched off', async () => {
    await set(false);
    for (const door of Object.keys(NOT_THE_ARCHIVE)) {
      const r = await get(door);
      expect({ door, status: r.status }).toEqual({ door, status: 200 });
      expect(r.text).not.toContain(NOTICE);
      expect(r.text).not.toContain(ref);
    }
    await set(null);
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
    expect(off.json()).toMatchObject({ published: false, stored: false });
    const reset = await admin.call({
      method: 'PUT',
      url: '/api/admin/moderation/archive',
      payload: { published: null },
    });
    expect(reset.json()).toMatchObject({ published: true, stored: null });
  });
});

describe('the published chain file obeys the same switch, and the same rule as the board', () => {
  it('is withheld while the archive is off', async () => {
    await set(false);
    const off = await get(`/api/chain/${slug}`);
    expect(off.status).toBe(404);
    expect(off.text).toContain(NOTICE);
    await set(null);
    expect((await get(`/api/chain/${slug}`)).status).toBe(200);
  });

  it('carries exactly the reports the board shows', async () => {
    const lb = await h.db
      .selectFrom('logbooks')
      .select('id')
      .where('slug', '=', slug)
      .executeTakeFirstOrThrow();
    const pending = await fileThread(h.db, { id: lb.id, slug }, Q, {
      what: 'Not approved, so not public.',
    });
    const file = JSON.parse((await get(`/api/chain/${slug}`)).text) as {
      reports: { public_ref: string }[];
    };
    const board = JSON.parse((await get(`/api/board/reports?logbook=${slug}`)).text) as {
      reports: { public_ref: string }[];
    };
    const refsOf = (x: { public_ref: string }[]) => x.map((r) => r.public_ref).sort();
    expect(refsOf(file.reports)).toEqual(refsOf(board.reports));
    expect(refsOf(file.reports)).not.toContain(pending.publicRef);
  });
});

describe('the distribution switch (decision 11)', () => {
  /** The bulk downloads. Each needs the archive on AND the downloads on. */
  const downloads = () => [
    '/api/board/reports.csv',
    `/api/board/reports.csv?logbook=${slug}`,
    `/api/chain/${slug}`,
  ];
  const setStored = async (value: boolean | null) => {
    await h.db
      .updateTable('moderation_settings')
      .set({ distribution_enabled: value })
      .where('id', '=', true)
      .execute();
  };

  it('a fresh site stores NULL, and NULL distributes nothing', async () => {
    await resetModerationSettings(h.db);
    const row = await h.db
      .selectFrom('moderation_settings')
      .select('distribution_enabled')
      .executeTakeFirstOrThrow();
    expect(row.distribution_enabled).toBeNull();
    expect(await distributionAvailable(h.db)).toBe(false);
    for (const door of downloads()) {
      const r = await get(door);
      expect({ door, status: r.status }).toEqual({ door, status: 404 });
      expect(r.text).toContain(DISTRIBUTION_OFF);
      expect(r.text).not.toContain(ref);
    }
    // The board itself is still read, and does not offer the spreadsheet.
    const board = JSON.parse((await get('/api/board')).text) as { downloads: boolean };
    expect(board.downloads).toBe(false);
    expect((await get('/api/board/reports')).text).toContain(ref);
  });

  it('each download opens only once an administrator says yes', async () => {
    await setStored(true);
    for (const door of downloads()) {
      const r = await get(door);
      expect({ door, status: r.status }).toEqual({ door, status: 200 });
      expect(r.text).toContain(ref);
    }
    expect((JSON.parse((await get('/api/board')).text) as { downloads: boolean }).downloads).toBe(
      true,
    );
    await setStored(false);
    for (const door of downloads()) expect((await get(door)).status).toBe(404);
  });

  it('with the archive off, nothing is distributed whatever this says, and the archive says why', async () => {
    await setStored(true);
    await set(false);
    expect(await distributionAvailable(h.db)).toBe(false);
    for (const door of downloads()) {
      const r = await get(door);
      expect({ door, status: r.status }).toEqual({ door, status: 404 });
      expect(r.text).toContain(NOTICE);
      expect(r.text).not.toContain(ref);
    }
    await set(null);
  });

  it('is never in a seal: a report verifies byte for byte the same either way', async () => {
    const verify = async () => {
      const r = await get(`/api/reports/${ref}/verify`);
      expect(r.status).toBe(200);
      const v = JSON.parse(r.text) as { canonical_json: string; content: unknown; link: unknown };
      return JSON.stringify([v.canonical_json, v.content, v.link]);
    };
    await setStored(null);
    const before = await verify();
    await setStored(true);
    expect(await verify()).toBe(before);
    await setStored(false);
    expect(await verify()).toBe(before);
    expect(before).not.toMatch(/distribution/);
  });

  it('only an administrator turns it, and turning one switch leaves the other alone', async () => {
    await resetModerationSettings(h.db);
    const mod = await staff(h, 'mod-dist', 'moderator');
    const admin = await staff(h, 'admin-dist', 'admin');
    const refused = await mod.call({
      method: 'PUT',
      url: '/api/admin/moderation/archive',
      payload: { distribution: true },
    });
    expect(refused.statusCode).toBe(403);
    expect(await distributionAvailable(h.db)).toBe(false);
    const on = await admin.call({
      method: 'PUT',
      url: '/api/admin/moderation/archive',
      payload: { distribution: true },
    });
    expect(on.json()).toEqual({
      published: true,
      stored: null,
      distribution: true,
      distribution_stored: true,
    });
    const archiveOff = await admin.call({
      method: 'PUT',
      url: '/api/admin/moderation/archive',
      payload: { published: false },
    });
    expect(archiveOff.json()).toEqual({
      published: false,
      stored: false,
      distribution: false,
      distribution_stored: true,
    });
    const reset = await admin.call({
      method: 'PUT',
      url: '/api/admin/moderation/archive',
      payload: { published: null, distribution: null },
    });
    expect(reset.json()).toEqual({
      published: true,
      stored: null,
      distribution: false,
      distribution_stored: null,
    });
    const row = await h.db
      .selectFrom('moderation_settings')
      .select('distribution_set_by')
      .executeTakeFirstOrThrow();
    expect(row.distribution_set_by).toMatch(/admin-dist/);
    await setDistribution(h.db, true, 'admin@example.org');
  });
});

describe('the email digest obeys the same switch', () => {
  it('sends nothing while the archive is off', async () => {
    await set(false);
    const lines: string[] = [];
    const out = await runDigest({
      db: h.db,
      mailer: h.mailer,
      siteOrigin: SITE,
      log: (l) => lines.push(l),
      frequency: 'weekly',
    });
    expect(out.summary).toMatch(/switched off, so nothing was sent/);
    await set(null);
  });
});

describe('the maps obey the same switch', () => {
  it('no map is placed or served while the archive is off, and both come back with it', async () => {
    const made = await createMap(h.db, {
      slug: `switch-${String(Date.now())}`,
      title: 'Switch map',
      enabled: true,
    });
    const list = async () => (await get('/api/maps')).text;
    await set(null);
    expect(await list()).toContain(made.slug);
    await set(false);
    expect(await list()).not.toContain(made.slug);
    const one = await get(`/api/maps/${made.slug}`);
    expect(one.status).toBe(404);
    expect(one.text).toContain(NOTICE);
    await set(null);
    expect(await list()).toContain(made.slug);
    await deleteMap(h.db, made.id);
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
    expect(paths.length).toBeGreaterThanOrEqual(7);
    for (const p of paths) {
      expect(h.app.hasRoute({ method: 'GET', url: p })).toBe(true);
      const covered =
        doors.some((d) => d.split('?')[0] === p.replace(':ref', ref)) ||
        Object.hasOwn(NOT_THE_ARCHIVE, p);
      expect({ p, covered }).toEqual({ p, covered: true });
    }
  });
});
