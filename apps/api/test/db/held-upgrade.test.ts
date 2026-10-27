/**
 * THE UPGRADE PROOF FOR W1 (plan section 4, layer 2 as far as S1 can take
 * it): a database migrated to every migration BEFORE the held-values one is
 * filled with reports of every existing kind, every fingerprint, link, verify
 * result and chain head is recorded, the held-values migration is applied,
 * and all of it must come back identical. A report still waiting for its
 * confirmation link must still confirm afterwards.
 *
 * The "before" reports are filed by today's code on the older schema, which
 * is possible because appendReportVersion names the new columns only when a
 * report holds a value (chain/append.ts). Not covered here: reports with
 * files (their manifest needs the files worker), which P1's fuller upgrade
 * test is to cover.
 */
import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cardFor, normalizeReportFields } from '@reportlog/seal';
import type { FieldDefinition } from '@reportlog/fields';
import { buildAnswers } from '@reportlog/fields';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { appendReportVersion } from '../../src/chain/append.ts';
import { currentHeads } from '../../src/chain/heads.ts';
import { verifyReport } from '../../src/chain/verify.ts';
import { recordCardTexts } from '../../src/consent/cards.ts';
import { createDatabase } from '../../src/db/database.ts';
import type { Database } from '../../src/db/database.ts';
import { MIGRATIONS_DIR, migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import type { Throwaway } from '../../src/db/throwaway.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { doorPass } from '../door-pass.ts';
import { CONTACT_KEY, spine } from './filing-helpers.ts';
import { SITE, address } from './identity-helpers.ts';

const HELD_MIGRATION = '20261027014942_held_values.sql';

const EVERY_KIND: FieldDefinition[] = [
  { key: 'short', kind: 'short_text', label: 'Short' },
  { key: 'long', kind: 'long_text', label: 'Long' },
  { key: 'day', kind: 'date', label: 'Day' },
  { key: 'at', kind: 'time', label: 'At' },
  { key: 'moment', kind: 'datetime', label: 'Moment' },
  { key: 'place', kind: 'place', label: 'Place', settings: { options: [], allowOther: true } },
  { key: 'loc', kind: 'location', label: 'Location', settings: { scope: 'both' } },
  { key: 'one', kind: 'choice_one', label: 'One', settings: { options: ['a', 'b'] } },
  { key: 'many', kind: 'choice_many', label: 'Many', settings: { options: ['x', 'y', 'z'] } },
  { key: 'yn', kind: 'yes_no', label: 'Yes or no' },
  { key: 'tick', kind: 'yes_no', label: 'Tick', settings: { checkbox: true } },
  { key: 'has', kind: 'evidence_declaration', label: 'Evidence' },
  { key: 'count', kind: 'number', label: 'Count' },
  { key: 'mail', kind: 'email', label: 'Second address' },
  { key: 'link', kind: 'url', label: 'Sealed link' },
  { key: 'files', kind: 'file', label: 'Files' },
];

const ANSWERS: Record<string, unknown>[] = [
  {
    short: 'A line',
    long: 'Several\nlines',
    day: '2026-11-03',
    at: '07:30',
    moment: '2026-11-03T07:30:00-07:00',
    place: 'The town hall',
    loc: 'US-AZ',
    one: 'b',
    many: ['z', 'x'],
    yn: 'no',
    tick: true,
    has: 'yes',
    count: 12,
    mail: 'someone@example.org',
    link: 'https://example.org/sealed',
  },
  { one: 'a' },
  {},
];

let old: Throwaway;
let db: Database;

afterAll(async () => {
  await db.destroy();
  await old.drop();
});

async function snapshot(d: Database) {
  const reports = await d.selectFrom('reports').select(['public_ref']).orderBy('id').execute();
  const verified = [];
  for (const r of reports) verified.push(await verifyReport(d, r.public_ref));
  return { verified, heads: await currentHeads(d) };
}

describe('the held-values migration on a database that already has reports', () => {
  it('changes no fingerprint, no link, no verify result and no chain head', async () => {
    old = await createThrowawayDatabase(inject('serverUrl'), 'held_up');
    const dir = await mkdtemp(join(tmpdir(), 'rl-held-'));
    const all = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    expect(all).toContain(HELD_MIGRATION);
    for (const f of all.filter((f) => f < HELD_MIGRATION)) {
      await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    }
    await migrate(old.url, dir);
    db = createDatabase(old.url, 5);
    await recordCardTexts(db);

    // Two logbooks, so two chains.
    const books = [];
    for (const slug of ['up-one', 'up-two']) {
      const lb = await db
        .insertInto('logbooks')
        .values({ slug, title: slug })
        .returning(['id', 'slug'])
        .executeTakeFirstOrThrow();
      for (const [position, q] of EVERY_KIND.entries()) {
        await db
          .insertInto('logbook_fields')
          .values({
            logbook_id: lb.id,
            key: q.key,
            kind: q.kind,
            label: q.label,
            settings: JSON.stringify(q.settings ?? {}),
            position,
          })
          .execute();
      }
      await db
        .updateTable('logbooks')
        .set({ launched_at: new Date() })
        .where('id', '=', lb.id)
        .execute();
      books.push(lb);
    }

    const file = (
      lb: { id: number; slug: string },
      body: Record<string, unknown>,
      extra: { threadId?: string; correctsId?: number; third?: boolean; publish?: boolean } = {},
    ) => {
      const { answers, errors } = buildAnswers(EVERY_KIND, body);
      if (errors.length) throw new Error(errors.join('; '));
      return db.transaction().execute((trx) =>
        appendReportVersion(trx, {
          logbookId: lb.id,
          threadId: extra.threadId ?? randomUUID(),
          correctsId: extra.correctsId ?? null,
          fields: normalizeReportFields({
            logbook: lb.slug,
            answers,
            may_publish: extra.publish ?? true,
            may_publish_digest: cardFor(extra.third ? 'coordinator' : 'general').digest,
            ...(extra.third
              ? {
                  third_party: true,
                  filed_via: 'A neighbourhood group',
                  intake_method: 'paper',
                  attested_at: '2026-11-03T09:00:00.000Z',
                  collected_on: '2026-11-02',
                }
              : {}),
          }),
          publicRefPrefix: 'RL-',
        }),
      );
    };
    for (const lb of books) {
      for (const body of ANSWERS) await file(lb, body);
      const first = await file(lb, { one: 'a' }, { publish: false });
      await file(lb, { one: 'b' }, { threadId: first.row.thread_id, correctsId: first.row.id });
      await file(lb, { short: 'Through a group' }, { third: true });
    }

    // A report waiting for its link, sent through the routes on the old schema.
    const mailer = capturingMailer();
    const app = await buildApp({
      config: { LOG_LEVEL: 'silent', SITE_ORIGIN: SITE, CONTACT_KEY },
      db,
      mailer,
    });
    const email = address('held-upgrade');
    const book = books[0] ?? { slug: '' };
    const sent = await app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        ...(await doorPass(app)),
        ...spine(email),
        logbook: book.slug,
        answers: { short: 'Waiting' },
      },
    });
    expect(sent.statusCode, sent.body).toBe(200);
    const token = /\/file\/confirm\/([a-f0-9]{64})\b/.exec(mailer.lastTo(email)?.text ?? '')?.[1];
    expect(token).toBeDefined();

    const before = await snapshot(db);
    expect(before.verified.length).toBe(12);
    for (const v of before.verified) {
      expect(v?.content.ok && v.link.ok && v.position.ok, v?.public_ref).toBe(true);
    }

    const applied = await migrate(old.url);
    expect(applied.applied).toEqual([HELD_MIGRATION]);

    const after = await snapshot(db);
    expect(after).toEqual(before);

    // The waiting report still confirms, and files as recipe 1.
    const done = await app.inject({ method: 'POST', url: `/api/reports/confirm/${token ?? ''}` });
    expect(done.statusCode, done.body).toBe(200);
    const ref = done.json<{ confirmation: { public_ref: string } }>().confirmation.public_ref;
    const v = await verifyReport(db, ref);
    expect(v?.content.ok && v.link.ok && v.position.ok).toBe(true);
    expect(v?.recipe).toBe(1);
    expect(Object.keys(v?.hashed_fields ?? {})).not.toContain('text_fingerprints');
    await app.close();

    const columns = await db
      .selectFrom('reports')
      .select(['text_fingerprints', 'link_fingerprints', 'recipe'])
      .execute();
    expect(columns.every((c) => c.text_fingerprints === null && c.link_fingerprints === null)).toBe(
      true,
    );
    expect(columns.every((c) => c.recipe === 1)).toBe(true);
  });
});
