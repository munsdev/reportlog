/**
 * Asking a running application what it says: the public routes, the chain,
 * and the check on each report. Shared by the upgrade test (before and after
 * the migrations must agree) and the public sweep (nothing typed may appear).
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { currentHeads } from '../../src/chain/heads.ts';
import { verifyReport } from '../../src/chain/verify.ts';
import type { Database } from '../../src/db/database.ts';
import type { World } from './seed-world.ts';

/**
 * Routes behind a session or a link meant for one person. Swept by the staff
 * sweep (invariants.test.ts), the reporter's own tests, or their own file.
 * Anything not listed here is asked for with no sign-in at all.
 */
export const NOT_PUBLIC = [
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

/** Routes that hand out a fresh random token each time they are asked: the door's. */
export const isStableUrl = (url: string): boolean => !url.startsWith('/api/door/');

export const isPublicUrl = (url: string): boolean => !NOT_PUBLIC.some((p) => url.startsWith(p));

/** What each `:parameter` of a route is tried with. */
export async function parameterValues(
  db: Database,
  world: World,
): Promise<Record<string, string[]>> {
  const threads = await db.selectFrom('reports').select('thread_id').distinct().execute();
  return {
    ref: Object.values(world.refs),
    slug: Object.values(world.slugs),
    thread: threads.map((t) => t.thread_id),
    token: [world.waiting.token],
  };
}

/** Every concrete URL a route pattern stands for, under the values above. */
export function concreteUrls(pattern: string, values: Record<string, string[]>): string[] {
  const names = [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1] ?? '');
  let urls = [pattern];
  for (const name of new Set(names)) {
    const key = /ref/i.test(name)
      ? 'ref'
      : /slug/i.test(name)
        ? 'slug'
        : /thread/i.test(name)
          ? 'thread'
          : /token/i.test(name)
            ? 'token'
            : '';
    const options = key ? (values[key] ?? ['1']) : ['1'];
    urls = urls.flatMap((u) => options.map((o) => u.replaceAll(`:${name}`, encodeURIComponent(o))));
  }
  return urls;
}

export interface Response {
  status: number;
  length: number;
  sha256: string;
  /** Kept when short, so a failure shows what changed. */
  body?: string;
}

export const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

export async function ask(app: FastifyInstance, url: string): Promise<Response & { text: string }> {
  const res = await app.inject({ method: 'GET', url });
  // A reading of the clock is not a fact about the data: counts say when they
  // were taken. Blanked, so two asks a second apart agree.
  const text = res.body.replace(/"(as_of|generated_at|built_at)":"[^"]*"/g, '"$1":"<time>"');
  return {
    status: res.statusCode,
    length: text.length,
    sha256: sha(text),
    ...(text.length <= 2000 ? { body: text } : {}),
    text,
  };
}

export interface Facts {
  reports: {
    public_ref: string;
    thread_id: string;
    content_hash: string;
    prev_chain_hash: string;
    chain_hash: string;
  }[];
  heads: { logbook: string; head: string; reports: number }[];
  /** The check on each report, whole, as the verify route's own function answers. */
  verification: Record<
    string,
    { sha256: string; content: boolean; link: boolean; position: boolean }
  >;
  responses: Record<string, Response>;
}

/** Everything the upgrade must leave as it was. `urls` is held in the golden file. */
export async function collectFacts(
  app: FastifyInstance,
  db: Database,
  urls: readonly string[],
): Promise<Facts> {
  const rows = await db
    .selectFrom('reports')
    .select(['public_ref', 'thread_id', 'content_hash', 'prev_chain_hash', 'chain_hash'])
    .orderBy('id')
    .execute();
  const verification: Facts['verification'] = {};
  for (const r of rows) {
    const v = await verifyReport(db, r.public_ref);
    if (!v) throw new Error(`${r.public_ref} cannot be checked`);
    verification[r.public_ref] = {
      sha256: sha(JSON.stringify(v)),
      content: v.content.ok,
      link: v.link.ok,
      position: v.position.ok,
    };
  }
  const responses: Facts['responses'] = {};
  for (const url of urls) {
    const { text: _text, ...kept } = await ask(app, url);
    responses[url] = kept;
  }
  return {
    reports: rows.map((r) => ({ ...r })),
    heads: (await currentHeads(db)).map((h) => ({ ...h })),
    verification,
    responses,
  };
}
