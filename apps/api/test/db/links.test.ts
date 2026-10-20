/**
 * Tip links (Plan D §5, §6 M3 to M6, §8): kept encrypted, grouped, checked,
 * blocked and erased, and read by nobody but the owner and moderators (K7).
 */
import { SYSTEM_ROLES } from '@reportlog/access';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addBlock, removeBlock, targetFromText } from '../../src/links/blocklist.ts';
import { checkGroup, commentGroup } from '../../src/links/checks.ts';
import { loadLinkKeys, matchKey, openValue } from '../../src/links/keys.ts';
import type { LinkKeys } from '../../src/links/keys.ts';
import { checkedLinks, groupHistory, groupsForCheck } from '../../src/links/reads.ts';
import { LinkRefusal } from '../../src/links/refusals.ts';
import { fileEntry } from '../../src/lists/entries.ts';
import { createFromTemplate } from '../../src/lists/manage.ts';
import { DEFAULT_LIST_SETTINGS } from '../../src/lists/retention.ts';
import type { LoadedList } from '../../src/lists/rows.ts';
import { uniqueSlug } from './helpers.ts';
import { address, as, harness, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';
import { LINK_CONTACT_KEY, linkKeys } from './links-helpers.ts';

let h: Harness;
let keys: LinkKeys;
let tips: LoadedList;
const run = `${String(process.pid)}${String(Date.now() % 1e6)}`;
const host = (stem: string) => `${stem}-${run}.example.org`;

const send = (links: string | string[]) =>
  fileEntry(
    h.db,
    tips.slug,
    { answers: { links, state: 'Not sure', category: 'Not sure' } },
    { settings: DEFAULT_LIST_SETTINGS, keys },
  );

/** The group of an address, by its keyed matching key. */
const groupOf = async (url: string) =>
  (await h.db
    .selectFrom('link_groups')
    .select(['id', 'outcome'])
    .where('match_key', '=', matchKey(keys, url))
    .executeTakeFirst()) ?? null;

const linksOf = (groupId: number) =>
  h.db.selectFrom('links').selectAll().where('group_id', '=', groupId).execute();

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof LinkRefusal) return e.code;
    throw e;
  }
  return 'accepted';
}

beforeAll(async () => {
  h = await harness({ CONTACT_KEY: LINK_CONTACT_KEY });
  keys = await linkKeys(h.db);
  tips = await createFromTemplate(h.db, 'tips', { slug: uniqueSlug('tips') });
});
afterAll(() => h.close());

describe('K9 and K11 · each link under its own key, grouped by a keyed matching key', () => {
  it('two copies of one address are one group, each with its own row and its own key', async () => {
    const url = `https://${host('clip')}/v/1`;
    await send(url);
    await send(`HTTPS://${host('clip').toUpperCase()}:443/v/1/?utm_source=x`);
    const g = await groupOf(url);
    if (!g) throw new Error('no group');
    const rows = await linksOf(g.id);
    expect(rows).toHaveLength(2);
    expect(
      Buffer.compare(rows[0]?.value_key ?? Buffer.alloc(0), rows[1]?.value_key ?? Buffer.alloc(0)),
    ).not.toBe(0);
    for (const r of rows) expect(openValue(keys, r.value_enc, r.value_key)).toBe(url);
    // Nothing in the store reads as the address.
    const dump = JSON.stringify(
      await sql`SELECT * FROM links l JOIN link_groups g ON g.id = l.group_id WHERE g.id = ${g.id}`.execute(
        h.db,
      ),
    );
    expect(dump).not.toContain(host('clip'));
  });

  it('the matching key is keyed: a bare sha256 of the address is not it', async () => {
    const url = `https://${host('clip')}/v/1`;
    const { createHash } = await import('node:crypto');
    const bare = createHash('sha256').update(url).digest('hex');
    expect(await groupOf(url)).not.toBe(null);
    const hit = await h.db
      .selectFrom('link_groups')
      .select('id')
      .where('match_key', '=', bare)
      .execute();
    expect(hit).toEqual([]);
  });

  it('the secret behind every key opens under the previous CONTACT_KEY, and is re-wrapped', async () => {
    const next = Buffer.alloc(32, 8).toString('base64');
    const rotated = await loadLinkKeys(h.db, next, LINK_CONTACT_KEY);
    expect(matchKey(rotated, 'https://x.example/')).toBe(matchKey(keys, 'https://x.example/'));
    // Now under the new key alone; and back, for the rest of the suite.
    const again = await loadLinkKeys(h.db, next);
    expect(matchKey(again, 'https://x.example/')).toBe(matchKey(keys, 'https://x.example/'));
    await loadLinkKeys(h.db, LINK_CONTACT_KEY, next);
    await expect(loadLinkKeys(h.db, Buffer.alloc(32, 1).toString('base64'))).rejects.toThrow(
      /CONTACT_KEY/,
    );
  });
});

describe('M3, M6 and K12 · the check covers its group, now and later', () => {
  it('"checked" and "withheld" carry over to a later copy', async () => {
    const url = `https://${host('carry')}/a`;
    await send(url);
    const g = await groupOf(url);
    if (!g) throw new Error('no group');
    await checkGroup(h.db, keys, g.id, { outcome: 'withheld', actor: 'mod@example.org' });
    await send(url);
    expect((await groupOf(url))?.outcome).toBe('withheld');
    expect(await linksOf(g.id)).toHaveLength(2);
    // A re-check at any time, recorded beside the first.
    await checkGroup(h.db, keys, g.id, { outcome: 'checked', actor: 'mod@example.org' });
    const history = await groupHistory(h.db, g.id);
    expect(history.filter((x) => x.kind === 'check').map((x) => x.outcome)).toEqual([
      'withheld',
      'checked',
    ]);
  });

  it('"illegal" needs a reason, erases every copy and its key, and logs the erasure (X2, X4)', async () => {
    const url = `https://${host('bad')}/x`;
    await send(url);
    await send(url);
    const g = await groupOf(url);
    if (!g) throw new Error('no group');
    expect(
      await code(checkGroup(h.db, keys, g.id, { outcome: 'illegal', actor: 'm@example.org' })),
    ).toBe('reason-needed');
    const out = await checkGroup(h.db, keys, g.id, {
      outcome: 'illegal',
      actor: 'm@example.org',
      reason: 'other-illegal',
    });
    expect(out).toEqual({ outcome: 'illegal', erased: 2 });
    expect(await linksOf(g.id)).toEqual([]);
    const row = await h.db
      .selectFrom('link_groups')
      .selectAll()
      .where('id', '=', g.id)
      .executeTakeFirstOrThrow();
    expect(row.match_key).toBe(null);
    const log = await h.db
      .selectFrom('link_erasures')
      .selectAll()
      .where('group_id', '=', g.id)
      .execute();
    expect(log).toMatchObject([
      { reason_category: 'other-illegal', erased_count: 2, actor_email: 'm@example.org' },
    ]);
    expect(
      await code(checkGroup(h.db, keys, g.id, { outcome: 'checked', actor: 'm@example.org' })),
    ).toBe('already-erased');
  });

  it('"illegal" does not carry over: a later copy is a new, unchecked group', async () => {
    const url = `https://${host('bad')}/x`;
    await send(url);
    const g = await groupOf(url);
    expect(g?.outcome).toBe(null);
  });
});

describe('K13 · the blocklist: keyed hashes, and a match is erased on arrival', () => {
  it('an exact address, added while marking a group illegal, stops every later copy', async () => {
    const url = `https://${host('exact')}/p`;
    await send(url);
    const g = await groupOf(url);
    if (!g) throw new Error('no group');
    await checkGroup(h.db, keys, g.id, {
      outcome: 'illegal',
      actor: 'm@example.org',
      reason: 'terrorist-content',
      block: 'address',
    });
    const got = await send([url, `https://${host('exact')}/other`]);
    expect(got.links.map((l) => l.url)).toEqual([`https://${host('exact')}/other`]);
    expect(await groupOf(url)).toBe(null);
  });

  it('a domain blocks its subdomains, and nothing it blocks is ever written', async () => {
    const before = await h.db
      .selectFrom('links')
      .select(sql<number>`count(*)::int`.as('n'))
      .executeTakeFirstOrThrow();
    const added = await addBlock(h.db, targetFromText(keys, 'domain', host('dom')), {
      reason: 'other-illegal',
      actor: 'm@example.org',
    });
    expect(added.added).toBe(true);
    const got = await send([`https://video.${host('dom')}/1`, `https://${host('dom')}/2`]);
    expect(got.links).toEqual([]);
    const after = await h.db
      .selectFrom('links')
      .select(sql<number>`count(*)::int`.as('n'))
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
    // A sibling domain is not covered.
    expect((await send(`https://not${host('dom')}/3`)).links).toHaveLength(1);
  });

  it('holds no address, and every change is logged with who and a category', async () => {
    const dump =
      JSON.stringify(await sql`SELECT * FROM link_blocklist`.execute(h.db)) +
      JSON.stringify(await sql`SELECT * FROM link_block_log`.execute(h.db));
    expect(dump).not.toContain(host('dom'));
    expect(dump).not.toContain(host('exact'));
    const entry = await h.db
      .selectFrom('link_blocklist')
      .selectAll()
      .where('kind', '=', 'domain')
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(
      await removeBlock(h.db, entry.id, { reason: 'too-broad', actor: 'm2@example.org' }),
    ).toBe(true);
    const log = await h.db
      .selectFrom('link_block_log')
      .selectAll()
      .where('entry_id', '=', entry.id)
      .orderBy('id')
      .execute();
    expect(log.map((l) => [l.action, l.reason_category, l.actor_email])).toEqual([
      ['add', 'other-illegal', 'm@example.org'],
      ['remove', 'too-broad', 'm2@example.org'],
    ]);
    expect((await send(`https://${host('dom')}/again`)).links).toHaveLength(1);
  });

  it('refuses what could never match', () => {
    expect(() => targetFromText(keys, 'address', 'https://bit.ly/x')).toThrow(LinkRefusal);
    expect(() => targetFromText(keys, 'domain', 'com')).toThrow(LinkRefusal);
  });
});

describe('M4 · one comment per group, for journalists, every edit recorded', () => {
  it('caps it, records each edit, and an empty one clears it', async () => {
    const url = `https://${host('note')}/n`;
    await send(url);
    const g = await groupOf(url);
    if (!g) throw new Error('no group');
    expect(
      await code(commentGroup(h.db, g.id, { body: 'x'.repeat(501), actor: 'm@example.org' })),
    ).toBe('comment-too-long');
    await commentGroup(h.db, g.id, {
      body: 'A local station’s own upload.',
      actor: 'm@example.org',
    });
    await commentGroup(h.db, g.id, { body: '', actor: 'm2@example.org' });
    const comments = (await groupHistory(h.db, g.id)).filter((x) => x.kind === 'comment');
    expect(comments.map((c) => [c.comment, c.by])).toEqual([
      ['A local station’s own upload.', 'm@example.org'],
      ['', 'm2@example.org'],
    ]);
    expect(
      (
        await h.db
          .selectFrom('link_groups')
          .select('comment')
          .where('id', '=', g.id)
          .executeTakeFirstOrThrow()
      ).comment,
    ).toBe(null);
  });
});

describe('M5 · the desk sees checked links and nothing else', () => {
  it('unchecked, withheld and illegal never come out of checkedLinks', async () => {
    const [ok, held, fresh] = ['ok', 'held', 'fresh'].map((s) => `https://${host('desk')}/${s}`);
    for (const u of [ok, held, fresh]) await send(u ?? '');
    const gOk = await groupOf(ok ?? '');
    const gHeld = await groupOf(held ?? '');
    if (!gOk || !gHeld) throw new Error('no group');
    await checkGroup(h.db, keys, gOk.id, { outcome: 'checked', actor: 'm@example.org' });
    await commentGroup(h.db, gOk.id, { body: 'Original upload.', actor: 'm@example.org' });
    await checkGroup(h.db, keys, gHeld.id, { outcome: 'withheld', actor: 'm@example.org' });
    const desk = (await checkedLinks(h.db, keys)).filter((l) => l.url.includes(host('desk')));
    expect(desk.map((l) => [l.url, l.comment, l.copies])).toEqual([[ok, 'Original upload.', 1]]);
    // Withheld after a check: gone from the desk at once.
    await checkGroup(h.db, keys, gOk.id, { outcome: 'withheld', actor: 'm@example.org' });
    expect((await checkedLinks(h.db, keys)).filter((l) => l.url.includes(host('desk')))).toEqual(
      [],
    );
  });

  it('the queue shows one entry per group, with how many copies', async () => {
    const groups = await groupsForCheck(h.db, keys, { filter: 'checked' });
    const clip = groups.find((g) => g.url === `https://${host('clip')}/v/1`);
    expect(clip).toBeUndefined();
    const unchecked = await groupsForCheck(h.db, keys, { filter: 'unchecked', limit: 500 });
    expect(unchecked.find((g) => g.url === `https://${host('clip')}/v/1`)?.copies).toBe(2);
  });
});

describe('K7 · who reads links: the owner, administrators and moderators', () => {
  // Bodies that pass the contract, so what answers is the guard and not the
  // schema (which runs first once the site password is lifted).
  const ROUTES = [
    { method: 'GET', url: '/api/link-checks' },
    { method: 'GET', url: '/api/link-checks/1/history' },
    { method: 'GET', url: '/api/link-checks/blocklist' },
    { method: 'POST', url: '/api/link-checks/1/check', payload: { outcome: 'checked' } },
    { method: 'POST', url: '/api/link-checks/1/comment', payload: { body: 'x' } },
    {
      method: 'POST',
      url: '/api/link-checks/blocklist',
      payload: { kind: 'domain', text: 'example.com', reason: 'other-illegal' },
    },
    {
      method: 'POST',
      url: '/api/link-checks/blocklist/1/remove',
      payload: { reason: 'too-broad' },
    },
  ] as const;
  const READERS = new Set(['owner', 'admin', 'moderator']);

  it('every role, signed in, reads the queue or is refused it', async () => {
    for (const role of SYSTEM_ROLES) {
      const email = address(`k7-${role}`);
      await seat(h.db, email, role);
      const who = as(h, await signIn(h, email));
      const r = await who({ method: 'GET', url: '/api/link-checks' });
      expect(r.statusCode, role).toBe(READERS.has(role) ? 200 : 403);
      if (READERS.has(role)) expect(r.body).toContain(host('clip'));
      else expect(r.body).not.toContain(host('clip'));
    }
  });

  it('every route refuses the signed-out (401) and a person with no role (403)', async () => {
    const email = address('k7-none');
    await seat(h.db, email, 'user');
    const nobody = as(h);
    const user = as(h, await signIn(h, email));
    for (const r of ROUTES) {
      const anon = await nobody(r);
      expect(anon.statusCode, `${r.url} ${anon.body}`).toBe(401);
      const got = await user(r);
      expect(got.statusCode, r.url).toBe(403);
      expect(got.body).not.toContain(host('clip'));
    }
  });

  it('a moderator checks a link through the route, and the reason is a category', async () => {
    const email = address('k7-mod');
    await seat(h.db, email, 'moderator');
    const mod = as(h, await signIn(h, email));
    const url = `https://${host('route')}/r`;
    await send(url);
    const g = await groupOf(url);
    if (!g) throw new Error('no group');
    const bad = await mod({
      method: 'POST',
      url: `/api/link-checks/${String(g.id)}/check`,
      payload: { outcome: 'illegal', reason: 'I just did not like it' },
    });
    expect(bad.statusCode).toBe(400);
    const good = await mod({
      method: 'POST',
      url: `/api/link-checks/${String(g.id)}/check`,
      payload: { outcome: 'checked' },
    });
    expect(good.statusCode, good.body).toBe(200);
    const history = await groupHistory(h.db, g.id);
    expect(history.at(-1)).toMatchObject({ kind: 'check', outcome: 'checked', by: email });
  });
});
