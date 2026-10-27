/**
 * Upgrading a database that has things in it (plan 2026-10-27, section 4,
 * layer 2).
 *
 * THE DATABASE IS THE LIVE ONE, IN MINIATURE: logbooks made from the
 * how-voting-went starting point and from a general form with every kind of
 * typed question; the tips, election tips and volunteer lists; reports that
 * are published, corrected, withdrawn, declined, unreviewed and confirmed
 * through the routes; one report still waiting for its link; tips with links
 * and a moderator's check on one; a moderator and a journalist.
 *
 * It is built on the schema of 27 October 2026 (test/support/
 * baseline-migrations.ts), loaded from test/upgrade/rows.json. Then EVERY
 * migration that arrived since is applied, and:
 *
 *   1. no row of any table that existed has changed, appeared or gone;
 *   2. every fingerprint, chain head, check on a report, and public response
 *      is byte for byte what test/upgrade/golden.json recorded;
 *   3. the report waiting for its link still confirms, and verifies.
 *
 * Today there are no newer migrations, so this proves the loader and the
 * golden file are sound. It earns its keep the day a migration lands.
 *
 * A failure here is a finding. The fix is the migration, never the golden
 * file (see upgrade-fixture.test.ts for how it is written, and when not to).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { currentHeads } from '../../src/chain/heads.ts';
import { verifyReport } from '../../src/chain/verify.ts';
import { createDatabase } from '../../src/db/database.ts';
import type { Database } from '../../src/db/database.ts';
import { MIGRATIONS_DIR, migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import type { Throwaway } from '../../src/db/throwaway.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { BASELINE_MIGRATIONS } from '../support/baseline-migrations.ts';
import { ask, collectFacts } from '../support/probes.ts';
import type { Facts } from '../support/probes.ts';
import type { World } from '../support/seed-world.ts';
import {
  UPGRADE_DATA_DIR,
  changesTo,
  dumpRows,
  loadRows,
  migrateToBaseline,
} from '../support/upgrade.ts';
import type { RowSet } from '../support/upgrade.ts';
import { CONTACT_KEY } from './filing-helpers.ts';

const dir = fileURLToPath(UPGRADE_DATA_DIR);
const fixtureRows = JSON.parse(readFileSync(`${dir}rows.json`, 'utf8')) as RowSet;
const golden = JSON.parse(readFileSync(`${dir}golden.json`, 'utf8')) as {
  world: World;
  urls: string[];
  facts: Facts;
};

let throwaway: Throwaway;
let db: Database;
let before: RowSet;
let after: RowSet;
let app: Awaited<ReturnType<typeof buildApp>>;
let applied: string[] = [];

beforeAll(async () => {
  throwaway = await createThrowawayDatabase(inject('serverUrl'), 'upgrade');
  await migrateToBaseline(throwaway.url);
  await loadRows(throwaway.url, fixtureRows);
  before = await dumpRows(throwaway.url);
  applied = (await migrate(throwaway.url)).applied;
  after = await dumpRows(throwaway.url);
  db = createDatabase(throwaway.url, 5);
  app = await buildApp({
    config: { LOG_LEVEL: 'silent', SITE_ORIGIN: 'https://reports.example.test', CONTACT_KEY },
    db,
    mailer: capturingMailer(),
    statsTtlMs: 0,
    mapCacheMs: 0,
  });
  await app.ready();
}, 120_000);
afterAll(async () => {
  await app.close();
  await db.destroy();
  await throwaway.drop();
});

describe('the database before the upgrade', () => {
  it('holds exactly the rows the fixture was written from', () => {
    expect(changesTo(fixtureRows, before)).toEqual([]);
    expect(changesTo(before, fixtureRows)).toEqual([]);
  });

  it('has the world in it', () => {
    expect((before.reports ?? []).length).toBeGreaterThanOrEqual(10);
    expect((before.logbooks ?? []).length).toBeGreaterThanOrEqual(2);
    expect((before.lists ?? []).length).toBeGreaterThanOrEqual(3);
    expect((before.list_entries ?? []).length).toBeGreaterThanOrEqual(4);
    expect(before.report_submissions?.some((s) => s.confirmed_at === null)).toBe(true);
    expect((before.users ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('was built from the baseline migrations and no others', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    const newer = files.filter((f) => !(f in BASELINE_MIGRATIONS));
    expect(applied.sort()).toEqual(newer.sort());
  });
});

/**
 * Routes whose golden answer is only a hash (the body was over 2000 characters),
 * so a new key cannot be told from a changed value. Each may grow and may not
 * shrink; its status must still match. Do not add to this to make a red test
 * green: re-record the golden in a worktree of the baseline commit instead
 * (see upgrade-fixture.test.ts) so the body is kept.
 */
const HASH_ONLY_MAY_GROW: Readonly<Record<string, string>> = {
  '/api/site': 'gained social placements and look fields (U1, U2) after the golden was recorded',
};

/**
 * Everything in `was` that is not in `is`, unchanged. Keys `is` has and `was`
 * lacks are fine (a later feature added them); a key that went, a value that
 * changed, or an array that changed length is reported.
 */
function missingFrom(was: unknown, is: unknown, path: string): string[] {
  const here = path || '(body)';
  if (Array.isArray(was)) {
    if (!Array.isArray(is) || is.length !== was.length) return [`${here} changed length or type`];
    return was.flatMap((v, i) => missingFrom(v, is[i], `${path}[${i}]`));
  }
  if (was && typeof was === 'object') {
    if (!is || typeof is !== 'object' || Array.isArray(is))
      return [`${here} is no longer an object`];
    const now = is as Record<string, unknown>;
    return Object.entries(was).flatMap(([k, v]) =>
      k in now ? missingFrom(v, now[k], `${path}.${k}`) : [`${path}.${k} is gone`],
    );
  }
  return was === is ? [] : [`${here} was ${JSON.stringify(was)}, is ${JSON.stringify(is)}`];
}

describe('after every newer migration', () => {
  it('no row that was there has changed, gone, or been joined by another', () => {
    expect(changesTo(before, after)).toEqual([]);
    // A table the migrations did not make keeps its row count: nothing was inserted.
    for (const [table, rows] of Object.entries(before)) {
      expect(after[table]?.length, table).toBe(rows.length);
    }
  });

  it('every fingerprint, chain head and report check is what it was', async () => {
    const now = await collectFacts(app, db, []);
    expect(now.reports).toEqual(golden.facts.reports);
    expect(now.heads).toEqual(golden.facts.heads);
    expect(now.verification).toEqual(golden.facts.verification);
    expect(await currentHeads(db)).toEqual(golden.facts.heads);
  });

  it('every public route answers as it did', async () => {
    const now = await collectFacts(app, db, golden.urls);
    const differences: string[] = [];
    for (const u of golden.urls) {
      const was = golden.facts.responses[u];
      const is = now.responses[u];
      if (JSON.stringify(is) === JSON.stringify(was)) continue;
      if (!was || !is) {
        differences.push(`${u}: missing`);
        continue;
      }
      if (is.status !== was.status) {
        differences.push(`${u}: ${was.status} became ${is.status}`);
        continue;
      }
      // Later work may ADD a key to a response; nothing the old code said may
      // go or change. Compared on the whole body, parsed.
      const text = (await ask(app, u)).text;
      if (was.body === undefined) {
        // The golden kept only a hash (the body was long), so nothing can be
        // compared key by key. Allowed only for a route listed here, and then
        // it may not shrink.
        if (!(u in HASH_ONLY_MAY_GROW) || text.length < was.length) {
          differences.push(`${u}: changed, and the golden has no body to compare`);
        }
        continue;
      }
      const gone = missingFrom(JSON.parse(was.body) as unknown, JSON.parse(text) as unknown, '');
      if (gone.length) differences.push(`${u}: ${gone.join('; ')}`);
    }
    expect(differences).toEqual([]);
  });

  it('the report that was waiting for its link still confirms, and verifies', async () => {
    const look = await app.inject({
      method: 'GET',
      url: `/api/reports/confirm/${golden.world.waiting.token}`,
    });
    expect(look.statusCode, look.body).toBe(200);
    const done = await app.inject({
      method: 'POST',
      url: `/api/reports/confirm/${golden.world.waiting.token}`,
    });
    expect(done.statusCode, done.body).toBe(200);
    const ref = done.json<{ confirmation: { state: string; public_ref?: string } }>().confirmation;
    expect(ref.public_ref).toBeTruthy();
    const v = await verifyReport(db, ref.public_ref ?? '');
    expect(v?.content.ok && v.link.ok && v.position.ok).toBe(true);
    // It joined the end of its logbook's chain: one more report there, others untouched.
    const heads = await currentHeads(db);
    const was = golden.facts.heads.find((h) => h.logbook === golden.world.slugs.general);
    expect(heads.find((h) => h.logbook === golden.world.slugs.general)?.reports).toBe(
      (was?.reports ?? 0) + 1,
    );
  });
});
