/**
 * WRITES THE DATA the upgrade test replays. It does nothing in a normal run;
 * it is here, and is a "test", so that it can use the same helpers and the
 * same seed as everything else.
 *
 *   BUILD_UPGRADE_FIXTURE=1 pnpm --filter @reportlog/api exec vitest run \
 *     --project db test/db/upgrade-fixture.test.ts
 *
 * It makes a database with ONLY the baseline migrations (test/support/
 * baseline-migrations.ts), fills it with `seedWorld`, and writes
 *
 *   test/upgrade/rows.json     every table's rows
 *   test/upgrade/golden.json   the people and references seeded, the public URLs
 *                              asked, and what the application said (the
 *                              fingerprints, chain heads, a check per report
 *                              and every response)
 *
 * WHEN TO RUN IT AGAIN. When you add a case to `seedWorld`, or a route is
 * added to the public set and you want it in the comparison. Run it on a
 * commit whose code still works on the BASELINE schema: today's code does
 * (d34ba03). Later code may not, once it writes to tables the baseline lacks;
 * then make a worktree of d34ba03, copy the changed test/support/seed-world.ts
 * and test/support/probes.ts into it, run this there, and commit the two
 * JSON files here. Do not edit the JSON by hand, and do not regenerate it to
 * make a red upgrade test green: a difference is the finding.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type * as FastifyModule from 'fastify';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createDatabase } from '../../src/db/database.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import { CONTACT_KEY } from './filing-helpers.ts';
import {
  collectFacts,
  concreteUrls,
  isPublicUrl,
  isStableUrl,
  parameterValues,
} from '../support/probes.ts';
import { seedWorld } from '../support/seed-world.ts';
import { UPGRADE_DATA_DIR, dumpRows, migrateToBaseline } from '../support/upgrade.ts';

const registered = vi.hoisted(() => [] as { method: string; url: string }[]);
vi.mock('fastify', async (importOriginal) => {
  const real = await importOriginal<typeof FastifyModule>();
  const make = (opts: FastifyModule.FastifyServerOptions) => {
    const app = real.default(opts);
    app.addHook('onRoute', (o) => {
      for (const method of [o.method].flat()) registered.push({ method, url: o.url });
    });
    return app;
  };
  return { ...real, default: make };
});

const dataDir = fileURLToPath(UPGRADE_DATA_DIR);

describe.skipIf(!process.env.BUILD_UPGRADE_FIXTURE)('writing the upgrade fixture', () => {
  const drops: (() => Promise<void>)[] = [];
  afterAll(async () => {
    for (const d of drops) await d();
  });

  it('seeds the baseline schema and writes what it holds', async () => {
    const t = await createThrowawayDatabase(inject('serverUrl'), 'fixture');
    await migrateToBaseline(t.url);
    const db = createDatabase(t.url, 5);
    drops.push(() => db.destroy());
    drops.push(t.drop);
    const mailer = capturingMailer();
    const app = await buildApp({
      config: { LOG_LEVEL: 'silent', SITE_ORIGIN: 'https://reports.example.test', CONTACT_KEY },
      db,
      mailer,
      statsTtlMs: 0,
      mapCacheMs: 0,
    });
    await app.ready();
    const world = await seedWorld({ db, app, mailer }, { stem: 'demo' });

    // A link followed a year from now is still a link followed: nothing in
    // this fixture may depend on the day the test is run.
    await db
      .updateTable('report_submissions')
      .set({ expires_at: new Date('2099-01-01T00:00:00Z') })
      .where('confirmed_at', 'is', null)
      .execute();

    const values = await parameterValues(db, world);
    const urls = [
      ...new Set(
        registered
          .filter((r) => r.method === 'GET' && isPublicUrl(r.url) && isStableUrl(r.url))
          .flatMap((r) => concreteUrls(r.url, values)),
      ),
    ].sort();

    const facts = await collectFacts(app, db, urls);
    // The same question twice must give the same answer, or the comparison
    // after the upgrade would be comparing the clock.
    const again = await collectFacts(app, db, urls);
    const moving = urls.filter(
      (u) => JSON.stringify(again.responses[u]) !== JSON.stringify(facts.responses[u]),
    );
    expect(moving, 'these answer differently on a second ask').toEqual([]);
    expect(Object.keys(facts.verification).length).toBeGreaterThan(8);
    expect(Object.values(facts.verification).every((v) => v.content && v.link && v.position)).toBe(
      true,
    );

    const rows = await dumpRows(t.url);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(`${dataDir}rows.json`, `${JSON.stringify(rows)}\n`);
    writeFileSync(`${dataDir}golden.json`, `${JSON.stringify({ world, urls, facts }, null, 1)}\n`);
    await app.close();
  }, 120_000);
});
