/**
 * THE PUBLIC STAYS SHUT (plan 2026-10-27, W7, written before the work it
 * guards).
 *
 * Everything a reporter, tipster or volunteer typed, and every address and
 * link they gave, is seeded into the database with a marker no honest page
 * would contain (test/support/seed-world.ts). Then EVERY public route is
 * asked for, as a stranger, and so are the public chain file, the CSV, the
 * counts, the maps, `/api/v1` and the three documents a daily anchor
 * publishes. None may contain a marker, in any of the forms a page writes a
 * string: as typed, URL-encoded, JSON-escaped, HTML-escaped, base64.
 *
 * It passes on the code as it is today. After that it is the guard on every
 * merge: when the free-text work keeps a private text, a link, an email or a
 * redacted copy, it must not reach a page nobody signed in to see.
 *
 * TO COVER A NEW KIND OF THING, add it to MARKERS in test/support/seed-world.ts
 * and have seedWorld write it. Nothing in this file lists kinds. A TABLE OR
 * COLUMN the migrations add is covered without anyone listing it: what it
 * holds is searched for too (test/support/new-schema-values.ts).
 *
 * This is not the staff sweep (invariants.test.ts) and not public-leak-sweep
 * (unapproved reports and moderator sources); it asks the other question.
 */
import type * as FastifyModule from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { buildSnapshot } from '../../src/anchor/records.ts';
import { buildApp } from '../../src/app.ts';
import { snapshotDocument } from '../../src/lists/aggregates.ts';
import { currentHeads } from '../../src/chain/heads.ts';
import { verifyReport } from '../../src/chain/verify.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { BASELINE_SCHEMA } from '../support/baseline-schema.ts';
import { valuesInNewSchema } from '../support/new-schema-values.ts';
import { ask, concreteUrls, isPublicUrl, parameterValues } from '../support/probes.ts';
import { MARKERS, seedWorld } from '../support/seed-world.ts';
import type { Marker, World } from '../support/seed-world.ts';
import { CONTACT_KEY, filingHarness } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { uniqueSlug } from './helpers.ts';
import { resetModerationSettings } from './moderation-helpers.ts';

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

let h: FilingHarness;
let world: World;
/** What each public thing said: the URL or the name of the document, and its text. */
const pages = new Map<string, string>();

beforeAll(async () => {
  h = await filingHarness();
  world = await seedWorld(h, { stem: uniqueSlug('sweep') });
  // The chain file and the archive download are off until the owner turns
  // them on; sweep them in the state where they answer.
  await h.db
    .updateTable('moderation_settings')
    .set({ public_archive_enabled: true, distribution_enabled: true })
    .where('id', '=', true)
    .execute();

  // A fresh app after the seeding, so nothing cached before it is asked for.
  registered.length = 0;
  const app = await buildApp({
    config: { LOG_LEVEL: 'silent', SITE_ORIGIN: 'https://reports.example.test', CONTACT_KEY },
    db: h.db,
    mailer: capturingMailer(),
    statsTtlMs: 0,
    mapCacheMs: 0,
  });
  await app.ready();
  const values = await parameterValues(h.db, world);
  const urls = [
    ...new Set(
      registered
        .filter((r) => r.method === 'GET' && isPublicUrl(r.url))
        .flatMap((r) => concreteUrls(r.url, values)),
    ),
  ].sort();
  for (const url of urls) pages.set(url, (await ask(app, url)).text);
  await app.close();

  // What a daily anchor publishes (anchor/records.ts): the heads, the
  // snapshot of fingerprints and the counts.
  const heads = await currentHeads(h.db);
  pages.set('anchor: heads', JSON.stringify(heads));
  pages.set('anchor: snapshot', JSON.stringify(await buildSnapshot(h.db, '2026-11-04', heads)));
  pages.set('anchor: counts', JSON.stringify(await snapshotDocument(h.db)));
}, 120_000);
afterAll(async () => {
  await resetModerationSettings(h.db);
  await h.close();
});

/** Every way a page might carry a string it was given. */
function forms(value: string): string[] {
  const html = value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  return [
    value,
    value.toLowerCase(),
    value.replaceAll('/', '\\/'),
    encodeURIComponent(value),
    value.replaceAll(' ', '+'),
    JSON.stringify(value).slice(1, -1),
    html,
    Buffer.from(value).toString('base64'),
    Buffer.from(value).toString('hex'),
  ];
}

function leaks(): string[] {
  const out: string[] = [];
  for (const [where, text] of pages) {
    const lower = text.toLowerCase();
    for (const m of Object.values(MARKERS) as Marker[]) {
      if (m.publicToday) continue;
      if (forms(m.value).some((f) => text.includes(f)))
        out.push(`${where} shows ${m.kind} (${m.value})`);
    }
    // Any marker at all, even one cut about or re-spelt, other than the named exceptions.
    const stripped = Object.values(MARKERS as Record<string, Marker>)
      .filter((m) => m.publicToday)
      .reduce((t, m) => t.split(m.value.toLowerCase()).join(''), lower);
    if (stripped.includes('zqmark') && !out.some((o) => o.startsWith(`${where} shows`)))
      out.push(`${where} contains the marker text zqmark`);
  }
  return out;
}

describe('the sweep sees what it should', () => {
  it('asks every public route, from Fastify itself, and the anchor documents', () => {
    const urls = [...pages.keys()];
    // A floor, so a broken hook cannot make the sweep pass on nothing.
    expect(urls.filter((u) => u.startsWith('/')).length).toBeGreaterThan(60);
    for (const must of ['/api/board/stats', '/api/v1/stats', '/api/board/reports.csv']) {
      expect(urls, must).toContain(must);
    }
    expect(urls.some((u) => u.startsWith('/api/chain/'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/verify'))).toBe(true);
    expect(urls.some((u) => u.startsWith('/api/maps'))).toBe(true);
    expect(urls).toEqual(
      expect.arrayContaining(['anchor: heads', 'anchor: snapshot', 'anchor: counts']),
    );
  });

  it('gets real answers from the routes it is meant to be testing', () => {
    const body = (u: string) => pages.get(u) ?? '';
    expect(body(`/api/chain/${world.slugs.voting}`)).toContain(world.refs.votingPublished);
    expect(body(`/api/chain/${world.slugs.listed}`)).toContain(world.refs.listedPublished);
    // The logbook set to counts only is counted, and listed nowhere.
    expect(body(`/api/chain/${world.slugs.general}`)).not.toContain(world.refs.published);
    expect(body('anchor: snapshot')).toContain(world.refs.listedPublished);
  });

  it('and the markers are really in the database to be found', async () => {
    // Sealed into a report: the check on it returns the answers it was filed with.
    const v = await verifyReport(h.db, world.refs.published);
    expect(JSON.stringify(v?.hashed_fields)).toContain(MARKERS.answerLong.value);
    expect(JSON.stringify(v?.hashed_fields)).toContain(MARKERS.answerEmail.value);
    const corrected = await verifyReport(h.db, world.refs.corrected);
    expect(JSON.stringify(corrected?.hashed_fields)).toContain(MARKERS.correctedLong.value);
    // Kept in a list entry, and the address and links encrypted.
    const entries = await h.db
      .selectFrom('list_entries')
      .select(['answers', 'erasable_answers'])
      .execute();
    const stored = JSON.stringify(entries);
    expect(stored).toContain(MARKERS.volunteerNote.value);
    expect(stored).toContain(MARKERS.tipDescription.value);
    const addresses = await h.db
      .selectFrom('list_entries')
      .select('email_enc')
      .where('email_enc', 'is not', null)
      .execute();
    expect(addresses.length).toBeGreaterThanOrEqual(3);
    // And a waiting report holds its sender's address, which no page may show.
    expect(world.waiting.email).toBe(MARKERS.waitingContact.value);
  });

  it('would notice a marker: the finder, run against a page that shows one', () => {
    pages.set(
      'planted',
      `<p>${MARKERS.tipLink.value.replaceAll('/', '\\/')}</p> and ${encodeURIComponent(MARKERS.volunteerNote.value)}`,
    );
    const found = leaks();
    pages.delete('planted');
    expect(found.some((l) => l.startsWith('planted shows a tip link'))).toBe(true);
    expect(found.some((l) => l.startsWith('planted shows a volunteer note'))).toBe(true);
  });
});

describe('what is public today by an old rule, named so it cannot grow', () => {
  it('is still public, or its flag should come off', () => {
    for (const m of Object.values(MARKERS as Record<string, Marker>)) {
      if (!m.publicToday) continue;
      const where = [...pages].filter(([, text]) => forms(m.value).some((f) => text.includes(f)));
      expect(
        where.map(([u]) => u),
        `${m.kind} is no longer public: remove publicToday`,
      ).not.toEqual([]);
      // Only where a listed logbook's report is shown: never a list, a count or an export of counts.
      for (const [u] of where)
        expect(u, m.kind).toMatch(/\/api\/(board\/reports|reports)|\/api\/chain\//);
    }
  });
});

describe('no public page repeats what a person typed', () => {
  it('none contains a marker', () => {
    expect(leaks()).toEqual([]);
  });

  it('none contains a value held in a table or column the migrations added', async () => {
    const found = await valuesInNewSchema(inject('databaseUrl'));
    const shown: string[] = [];
    for (const { where, value } of found) {
      for (const [page, text] of pages)
        if (text.includes(value)) shown.push(`${page} shows a value from ${where}`);
    }
    expect(shown).toEqual([]);
  });

  it('the finder of new values works: pointed at a table that exists, it finds what is in it', async () => {
    const without = Object.fromEntries(
      Object.entries(BASELINE_SCHEMA).filter(([t]) => t !== 'list_entries'),
    );
    const found = await valuesInNewSchema(inject('databaseUrl'), without);
    const all = found.map((f) => f.value).join('\n');
    expect(all).toContain(MARKERS.volunteerNote.value);
    expect(found.every((f) => f.where.startsWith('list_entries.'))).toBe(true);
    // The encrypted address is found too, in the two ways bytes are written.
    expect(found.some((f) => f.where === 'list_entries.email_enc')).toBe(true);
  });
});
