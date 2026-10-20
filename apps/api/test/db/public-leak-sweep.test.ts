/**
 * A5 and decision 37, swept: every registered public GET route is asked for
 * its answer with unapproved reports, a withdrawn one, and a moderator's
 * source link in the database, and none of it may appear. The routes come
 * from Fastify's `onRoute`, so a route added later is covered without
 * anybody remembering it. Same technique as the staff sweep in
 * `invariants.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import type * as FastifyModule from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { Database } from '../../src/db/database.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import * as N from '../../src/moderation/notes.ts';
import { QUESTIONS, launchedLogbook, testDatabase } from './helpers.ts';
import { approve, fileThread } from './moderation-helpers.ts';

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

// Routes that are staff's, a reporter's own, or a tester's: they sit behind a
// session or a token and are swept by the staff sweep or by their own tests.
const NOT_PUBLIC = [
  '/api/admin/',
  '/api/moderate/',
  '/api/moderation/',
  '/api/access/',
  '/api/intake/',
  '/api/list-review',
  '/api/mine/',
  '/api/auth/',
  '/api/orgs',
  '/api/invitations/',
  '/api/setup/',
  '/api/forget/',
  '/api/uploads',
  '/api/evidence/',
];

const SOURCE_URL = 'https://sources-leak-marker.example/story';
const SOURCE_TITLE = 'Sources leak marker title';

let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
const hidden: string[] = [];
let published: { publicRef: string; threadId: string };
let lb: { id: number; slug: string };

beforeAll(async () => {
  db = testDatabase();
  lb = await launchedLogbook(db, QUESTIONS);
  const body = (n: string) => ({ what: `leak sweep ${n} ${randomUUID()}` });
  const fresh = (n: string) => fileThread(db, lb, QUESTIONS, body(n));
  const pub = await fresh('published');
  await approve(db, pub.threadId);
  published = { publicRef: pub.publicRef, threadId: pub.threadId };
  for (const [name, status] of [
    ['declined', 'invalid'],
    ['unclear', 'unknown'],
    ['pending', 'pending'],
  ] as const) {
    const t = await fresh(name);
    await db
      .updateTable('report_heads')
      .set({ moderation_status: status })
      .where('thread_id', '=', t.threadId)
      .execute();
    hidden.push(t.publicRef);
  }
  const wd = await fresh('withdrawn');
  await approve(db, wd.threadId);
  await db
    .updateTable('report_heads')
    .set({ withdrawn: true })
    .where('thread_id', '=', wd.threadId)
    .execute();
  hidden.push(wd.publicRef);

  await N.setNotesEnabled(db, lb.id, true, 'editor@example.org');
  await N.writeNote(db, {
    threadId: pub.threadId,
    body: 'The county office confirmed the machine was replaced at 10:40. We have not established why.',
    authorEmail: 'editor@example.org',
  });
  const link = await N.addLink(db, {
    threadId: pub.threadId,
    title: SOURCE_TITLE,
    url: SOURCE_URL,
    addedBy: 'editor@example.org',
  });
  if (!link.ok) throw new Error('fixture link refused');

  registered.length = 0;
  app = await buildApp({
    config: { LOG_LEVEL: 'silent', SITE_ORIGIN: 'https://x.test' },
    db,
    mailer: capturingMailer(),
    statsTtlMs: 0,
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const concrete = (url: string) =>
  url.replace(/:(\w+)/g, (_m, name: string) => {
    if (/ref/i.test(name)) return published.publicRef;
    if (/slug/i.test(name)) return lb.slug;
    if (/thread/i.test(name)) return published.threadId;
    return '1';
  });

describe('every public GET route, with unapproved reports and a source link on file', () => {
  it('sees the public routes from Fastify itself', () => {
    const gets = registered.filter((r) => r.method === 'GET');
    // A floor, so a broken hook cannot make the sweep pass on nothing.
    expect(gets.filter((r) => !NOT_PUBLIC.some((p) => r.url.startsWith(p))).length).toBeGreaterThan(
      30,
    );
    expect(gets.map((r) => r.url)).toContain('/api/board/stats');
  });

  it('none shows an unapproved report, a count of them, or a moderator source', async () => {
    const leaks: string[] = [];
    const routes = registered.filter(
      (r) => r.method === 'GET' && !NOT_PUBLIC.some((p) => r.url.startsWith(p)),
    );
    for (const r of routes) {
      const res = await app.inject({ method: 'GET', url: concrete(r.url) });
      const text = res.body;
      for (const ref of hidden) if (text.includes(ref)) leaks.push(`${r.url} shows ${ref}`);
      if (text.includes('sources-leak-marker') || text.includes(SOURCE_TITLE))
        leaks.push(`${r.url} shows the source link`);
      // As a KEY, the way a count would be: a note's state is a value that may say under_review.
      if (
        /"(by_disposition|confirmed_reports|under_review|declined|unclear|not_permitted)"\s*:/.test(
          text,
        )
      )
        leaks.push(`${r.url} counts unapproved reports`);
    }
    expect(leaks).toEqual([]);
  });
});
