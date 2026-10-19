/**
 * The file switch, kinds and limits, against a real database.
 *
 * Ports legacy `attachment-settings-selftest`, `upload-limits-selftest` and
 * the limits half of `evidence-caps-selftest`. What needs Postgres: NULL and
 * '{}' are different answers only once a row round-trips, a layer that set
 * nothing has to be invisible rather than zero, and the module's ranges have
 * to agree with the table's CHECKs.
 */
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/database.ts';
import { KINDS, kindFor } from '../../src/files/kinds.ts';
import {
  LIMIT_KEYS,
  LIMIT_RANGES,
  SHIPPED,
  attachmentsEnabled,
  capsFor,
  limitLayers,
  limitsFor,
  setLogbookLimits,
  setSiteLimits,
  siteLayer,
  validateLimits,
} from '../../src/files/limits.ts';
import type { LimitValues } from '../../src/files/limits.ts';
import { createFromFile, toFile } from '../../src/logbooks/logbookFile.ts';
import elections from '../../src/logbooks/templates/elections.json' with { type: 'json' };
import { launchedLogbook, testDatabase } from './helpers.ts';

let db: Database;
let lb: { id: number; slug: string };

const values = (input: Parameters<typeof validateLimits>[0]): LimitValues => {
  const v = validateLimits(input);
  if (!v.ok) throw new Error(v.message);
  return v.values;
};

const CLEAR = Object.fromEntries([
  ...LIMIT_KEYS.map((k) => [k, null]),
  ['kinds', null],
]) as LimitValues;

beforeAll(async () => {
  db = testDatabase();
  lb = await launchedLogbook(db, [
    { key: 'what', kind: 'long_text', label: 'What happened', required: true },
    { key: 'photos', kind: 'file', label: 'Photos' },
  ]);
});
afterEach(async () => {
  // Left clean for whatever runs next: the site row is shared by every file.
  await setSiteLimits(db, { ...CLEAR, enabled: null });
  await db.deleteFrom('logbook_file_limits').where('logbook_id', '=', lb.id).execute();
});
afterAll(async () => {
  await db.destroy();
});

describe('the stored switch (attachment-settings)', () => {
  it('an untouched install defers to the environment and offers every kind', async () => {
    const s = await siteLayer(db);
    expect(s.enabled).toBeNull();
    expect((await limitsFor(db, null)).kinds).toEqual([...KINDS]);
    expect(attachmentsEnabled(s.enabled, { configured: true, envDefault: true })).toBe(true);
    expect(attachmentsEnabled(s.enabled, { configured: true, envDefault: false })).toBe(false);
  });

  it('a narrowed list is honoured, and narrowing never changes what the code handles', async () => {
    await setSiteLimits(db, values({ kinds: ['photo', 'audio'] }));
    const l = await limitsFor(db, null);
    expect(l.kinds).toEqual(['photo', 'audio']);
    expect(l.kinds.includes(kindFor('application/pdf') ?? 'photo')).toBe(false);
    expect(l.kinds.includes(kindFor('image/jpeg') ?? 'video')).toBe(true);
    expect(kindFor('application/pdf')).toBe('document');
  });

  it('an empty list means none, not all', async () => {
    await setSiteLimits(db, values({ kinds: [] }));
    expect((await limitsFor(db, null)).kinds).toEqual([]);
    const row = await db
      .selectFrom('file_settings')
      .select('attachment_kinds')
      .executeTakeFirstOrThrow();
    expect(row.attachment_kinds).toEqual([]);
  });

  it('an administrator switching off beats the environment switching on', async () => {
    await setSiteLimits(db, { enabled: false });
    const s = await siteLayer(db);
    expect(attachmentsEnabled(s.enabled, { configured: true, envDefault: true })).toBe(false);
  });

  it('and nothing turns it on without somewhere to put the files', () => {
    expect(attachmentsEnabled(true, { configured: false, envDefault: true })).toBe(false);
  });
});

describe('the three layers (upload-limits)', () => {
  it('a logbook nobody configured behaves exactly as the shipped default', async () => {
    expect(await limitsFor(db, lb.id)).toEqual({ ...SHIPPED, kinds: [...SHIPPED.kinds] });
  });

  it("the site's number applies where the logbook sets nothing, the logbook's wins, clearing hands back", async () => {
    await setSiteLimits(db, values({ maxFiles: 4, maxImageBytes: 1048576 }));
    let l = await limitsFor(db, lb.id);
    expect(l.maxFiles).toBe(4);
    expect(l.maxVideoSeconds).toBe(SHIPPED.maxVideoSeconds);

    await setLogbookLimits(db, lb.id, values({ maxFiles: 2 }));
    l = await limitsFor(db, lb.id);
    expect(l.maxFiles).toBe(2);
    expect(l.maxImageBytes).toBe(1048576);

    await setLogbookLimits(db, lb.id, values({ maxFiles: null }));
    expect((await limitsFor(db, lb.id)).maxFiles).toBe(4);
    await setSiteLimits(db, values({ maxFiles: null }));
    expect((await limitsFor(db, lb.id)).maxFiles).toBe(SHIPPED.maxFiles);
  });

  it('only what was sent is written: a second save LEAVES A KEY IT DID NOT SEND ALONE', async () => {
    await setSiteLimits(db, values({ maxFiles: 7, maxVideoSeconds: 20 }));
    await setSiteLimits(db, values({ maxFiles: 8 }));
    const row = await db
      .selectFrom('file_settings')
      .select(['max_files', 'max_video_seconds', 'max_image_bytes'])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ max_files: 8, max_video_seconds: 20, max_image_bytes: null });
  });

  it.each(LIMIT_KEYS)('%s: the module range is what both tables enforce', async (key) => {
    const r = LIMIT_RANGES[key];
    for (const table of ['file_settings', 'logbook_file_limits'] as const) {
      if (table === 'logbook_file_limits') {
        await db
          .insertInto('logbook_file_limits')
          .values({ logbook_id: lb.id })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
      const where = table === 'file_settings' ? sql`id = true` : sql`logbook_id = ${lb.id}`;
      const set = (v: number | null) =>
        sql`UPDATE ${sql.table(table)} SET ${sql.ref(r.column)} = ${v} WHERE ${where}`.execute(db);
      await set(r.min);
      await set(r.max);
      await expect(set(r.min - 1)).rejects.toThrow(/check constraint/);
      await expect(set(r.max + 1)).rejects.toThrow(/check constraint/);
      await set(null);
    }
  });

  it('what the module refuses before the database sees it', () => {
    expect(validateLimits({ maxFiles: 0 }).ok).toBe(false);
    expect(validateLimits({ maxFiles: 1.5 }).ok).toBe(false);
    expect(validateLimits({ maxFiles: 'lots' }).ok).toBe(false);
    expect(values({ maxFiles: null }).maxFiles).toBeNull();
    expect(values({ maxFiles: '' }).maxFiles).toBeNull();
    expect('maxFiles' in values({ maxVideoSeconds: 30 })).toBe(false);
    const under = validateLimits({ maxTotalBytes: 2097152, maxVideoBytes: 104857600 });
    expect(!under.ok && under.reason).toBe('total-under-one-file');
  });

  it("kinds intersect: a logbook cannot take a kind the site switched off, and naming none takes the site's", async () => {
    await setSiteLimits(db, values({ kinds: ['photo', 'audio'] }));
    await setLogbookLimits(db, lb.id, values({ kinds: ['photo', 'video'] }));
    expect((await limitsFor(db, lb.id)).kinds).toEqual(['photo']);
    await setLogbookLimits(db, lb.id, values({ kinds: null }));
    expect((await limitsFor(db, lb.id)).kinds).toEqual(['photo', 'audio']);
    expect(validateLimits({ kinds: ['photo', 'hologram'] }).ok).toBe(false);
    expect(validateLimits({ kinds: [] }).ok).toBe(true);
  });

  it('each layer is reported separately, with where the value in force came from', async () => {
    await setSiteLimits(db, values({ maxFiles: 6 }));
    await setLogbookLimits(db, lb.id, values({ maxVideoSeconds: 15 }));
    const layers = await limitLayers(db, lb.id);
    expect(layers.maxFiles).toMatchObject({ site: 6, logbook: null, source: 'site', effective: 6 });
    expect(layers.maxVideoSeconds).toMatchObject({ logbook: 15, source: 'logbook' });
    expect(layers.maxDocumentPages).toMatchObject({
      source: 'shipped',
      effective: SHIPPED.maxDocumentPages,
    });
    const siteOnly = await limitLayers(db, null);
    expect(Object.values(siteOnly).every((v) => v.logbook === null)).toBe(true);
  });

  it("A LAUNCHED LOGBOOK'S LIMITS CAN STILL BE SET", async () => {
    await setLogbookLimits(db, lb.id, values({ maxFiles: 3 }));
    expect((await limitsFor(db, lb.id)).maxFiles).toBe(3);
  });
});

describe('per-logbook caps (evidence-caps, the limits half)', () => {
  it('with no logbook, or one that sets nothing or does not exist, the site limits apply', async () => {
    const site = await capsFor(db, null);
    expect(site).toEqual({ maxFiles: SHIPPED.maxFiles, maxTotalBytes: SHIPPED.maxTotalBytes });
    expect(await capsFor(db, lb.id)).toEqual(site);
    expect(await capsFor(db, 99_999_999)).toEqual(site);
  });

  it('a logbook that sets them gets its own', async () => {
    await setLogbookLimits(db, lb.id, values({ maxFiles: 1, maxTotalBytes: 300 * 1024 * 1024 }));
    expect(await capsFor(db, lb.id)).toEqual({ maxFiles: 1, maxTotalBytes: 300 * 1024 * 1024 });
  });

  it('the database refuses a nonsense limit or kind on both tables', async () => {
    await db.insertInto('logbook_file_limits').values({ logbook_id: lb.id }).execute();
    for (const [table, where] of [
      ['file_settings', sql`id = true`],
      ['logbook_file_limits', sql`logbook_id = ${lb.id}`],
    ] as const) {
      const run = (set: ReturnType<typeof sql>) =>
        sql`UPDATE ${sql.table(table)} SET ${set} WHERE ${where}`.execute(db);
      await expect(run(sql`max_files = 0`)).rejects.toThrow();
      await expect(run(sql`max_total_bytes = 1`)).rejects.toThrow();
      await expect(run(sql`max_image_bytes = 10`)).rejects.toThrow();
      await expect(run(sql`max_video_seconds = 99999`)).rejects.toThrow();
      await expect(run(sql`attachment_kinds = ARRAY['hologram']`)).rejects.toThrow();
    }
  });

  it('a photo matches the operator list: one name for the kind (the bug legacy found)', () => {
    for (const [type, want] of [
      ['image/jpeg', 'photo'],
      ['image/heic', 'photo'],
      ['image/png', 'photo'],
      ['video/mp4', 'video'],
      ['audio/mp4', 'audio'],
      ['application/pdf', 'document'],
    ] as const) {
      expect(kindFor(type)).toBe(want);
    }
    expect(kindFor('application/x-msdownload')).toBeNull();
  });
});

describe('the logbook file carries its caps, and only when set (evidence-caps)', () => {
  it('the elections starting point takes one file, of 300 MB: MORE than the old video ceiling', () => {
    expect(elections.max_files).toBe(1);
    expect(elections.max_total_bytes).toBe(300 * 1024 * 1024);
  });

  it('a downloaded logbook carries its caps; one on the site limits carries no key for either', async () => {
    await setLogbookLimits(db, lb.id, values({ maxFiles: 1, maxTotalBytes: 300 * 1024 * 1024 }));
    const f = await toFile(db, lb.id);
    expect(f).toMatchObject({ max_files: 1, max_total_bytes: 300 * 1024 * 1024 });
    const other = await launchedLogbook(db, [
      { key: 'what', kind: 'long_text', label: 'What', required: true },
    ]);
    const plain = await toFile(db, other.id);
    expect(plain && 'max_files' in plain).toBe(false);
    expect(plain && 'max_total_bytes' in plain).toBe(false);

    const back = await createFromFile(db, { ...f, slug: undefined, title: 'Caps copy' });
    expect(await capsFor(db, back.id)).toEqual({ maxFiles: 1, maxTotalBytes: 300 * 1024 * 1024 });
  });

  it('a file naming a cap the database would refuse is refused with a sentence', async () => {
    const f = await toFile(db, lb.id);
    await expect(
      createFromFile(db, { ...f, slug: undefined, title: 'Zero', max_files: 0 }),
    ).rejects.toThrow(/between 1 and 50/);
  });
});
