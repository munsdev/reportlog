/**
 * Lists over HTTP, against a real app. Ported from
 * legacy/scripts/lists-routes-selftest.mjs, with the site password's doors
 * (legacy's doors-selftest list half) and the list-mail link added.
 *
 * test/db/lists.test.ts covers the engine. This covers what only exists once a
 * route sits in front of it: visibility answering 404 rather than 403, the
 * role checks, refusals in words, the password deciding per list, and the
 * pages an email links to: A GET ON THEM CHANGES NOTHING.
 */
import type { ListAdminDetail, ListDetail } from '@reportlog/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doors } from '../../src/identity/doors.ts';
import { hashPassword } from '../../src/identity/secrets.ts';
import { mintErasureToken } from '../../src/lists/erasure.ts';
import { uniqueSlug } from './helpers.ts';
import { LINK_CONTACT_KEY, linkKeys } from './links-helpers.ts';
import { emailDigest } from '../../src/links/keys.ts';
import { SITE, address, as, harness, liftCurtain, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
let ADMIN = '';
let MOD = '';
let USER = '';
const SLUG = uniqueSlug('tips');

type Call = ReturnType<typeof as>;
let admin: Call;
let mod: Call;
let user: Call;
let anybody: Call;

// The type is the caller's statement of what the contract says comes back.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const json = <T = unknown>(r: LightMyRequestResponse): T => r.json();
const say = (r: LightMyRequestResponse) => `${String(r.statusCode)} ${r.body.slice(0, 300)}`;
const code = (r: LightMyRequestResponse) => json<{ error?: { code?: string } }>(r).error?.code;
const message = (r: LightMyRequestResponse) =>
  json<{ error?: { message?: string } }>(r).error?.message ?? '';

beforeAll(async () => {
  h = await harness({ CONTACT_KEY: LINK_CONTACT_KEY });
  const adminEmail = address('lists-admin');
  const modEmail = address('lists-mod');
  const userEmail = address('lists-user');
  await seat(h.db, adminEmail, 'admin');
  await seat(h.db, modEmail, 'moderator');
  await seat(h.db, userEmail, 'user');
  ADMIN = await signIn(h, adminEmail);
  MOD = await signIn(h, modEmail);
  USER = await signIn(h, userEmail);
  admin = as(h, ADMIN);
  mod = as(h, MOD);
  user = as(h, USER);
  anybody = as(h);
});
afterAll(async () => {
  await liftCurtain(h.db);
  await h.close();
});

let list: ListDetail;
const send = (body: Record<string, unknown>, call: Call = anybody, slug = SLUG) =>
  call({
    method: 'POST',
    url: `/api/lists/${slug}/entries`,
    payload: { elapsed_ms: 9000, ...body },
  });
const entries = async () =>
  (await h.db.selectFrom('list_entries').select('id').where('list_id', '=', list.id).execute())
    .length;
const putFields = (fields: unknown[]) =>
  admin({ method: 'PUT', url: `/api/admin/lists/${String(list.id)}/fields`, payload: { fields } });
const patch = (payload: Record<string, unknown>, id = list.id, call: Call = admin) =>
  call({ method: 'PATCH', url: `/api/admin/lists/${String(id)}`, payload });

describe('who may build a list', () => {
  it('nobody signed in is refused, and so is a moderator', async () => {
    expect((await anybody({ method: 'GET', url: '/api/admin/lists' })).statusCode).toBe(401);
    expect((await mod({ method: 'GET', url: '/api/admin/lists' })).statusCode).toBe(403);
  });

  it('an administrator sees the three starting points, and no upload or evidence question', async () => {
    const r = await admin({ method: 'GET', url: '/api/admin/lists' });
    const b = json<{ templates: { slug: string }[]; kinds: { id: string }[] }>(r);
    expect(r.statusCode, say(r)).toBe(200);
    expect(b.templates.map((t) => t.slug)).toEqual(['tips', 'check-ins', 'contact']);
    expect(b.kinds.map((k) => k.id)).not.toContain('file');
    expect(b.kinds.map((k) => k.id)).not.toContain('evidence_declaration');
  });

  it('a list is made from the Tip List, hidden, and its address requirement is derived', async () => {
    const r = await admin({
      method: 'POST',
      url: '/api/admin/lists',
      payload: { template: 'tips', slug: SLUG },
    });
    expect(r.statusCode, say(r)).toBe(200);
    list = json<ListDetail>(r);
    expect(list.slug).toBe(SLUG);
    expect(list.visibility).toBe('hidden');
    expect(list.requires_email).toBe(true);
  });

  it('the same address twice is refused', async () => {
    const r = await admin({
      method: 'POST',
      url: '/api/admin/lists',
      payload: { template: 'tips', slug: SLUG },
    });
    expect(r.statusCode).toBe(409);
    expect(code(r)).toBe('slug-taken');
  });
});

describe('visibility is enforced', () => {
  it('a hidden list is 404 to a visitor and to somebody signed in, never 403', async () => {
    expect((await anybody({ method: 'GET', url: `/api/lists/${SLUG}` })).statusCode).toBe(404);
    expect((await user({ method: 'GET', url: `/api/lists/${SLUG}` })).statusCode).toBe(404);
  });

  it('an administrator can preview it', async () => {
    expect((await admin({ method: 'GET', url: `/api/lists/${SLUG}` })).statusCode).toBe(200);
  });

  it('and nothing can be filed into it from outside', async () => {
    expect((await send({ answers: {} })).statusCode).toBe(404);
  });
});

describe('what the builder refuses', () => {
  const fields = () => list.fields.map((f) => ({ ...f }));

  it('ticking "countable" on free text', async () => {
    const r = await putFields(
      fields().map((f) => (f.key === 'description' ? { ...f, aggregatable: true } : f)),
    );
    expect(r.statusCode).toBe(400);
    expect(message(r)).toMatch(/cannot be counted/);
  });

  it('an upload question', async () => {
    const r = await putFields([
      ...fields(),
      { key: 'photo', kind: 'file', label: 'A photo', retention: 'transient' },
    ]);
    expect(r.statusCode).toBe(400);
    expect(message(r)).toMatch(/belong to a logbook/);
  });

  it('a kind of question that does not exist, by name', async () => {
    const r = await putFields([
      ...fields(),
      { key: 'odd', kind: 'telepathy', label: 'Odd', retention: 'transient' },
    ]);
    expect(r.statusCode).toBe(400);
    expect(message(r)).toMatch(/telepathy/);
  });

  it('a choice left with nothing to choose from', async () => {
    const r = await putFields(
      fields().map((f) => (f.key === 'category' ? { ...f, settings: { options: [] } } : f)),
    );
    expect(r.statusCode).toBe(400);
    expect(message(r)).toMatch(/no options/);
  });

  it('keeps an existing question’s key whatever is sent', async () => {
    const r = await putFields(
      fields().map((f) => (f.key === 'state' ? { ...f, key: 'renamed' } : f)),
    );
    expect(r.statusCode, say(r)).toBe(200);
    const keys = json<ListDetail>(r).fields.map((f) => f.key);
    expect(keys).toContain('state');
    expect(keys).not.toContain('renamed');
  });

  it('changes options after the list exists, without losing a question', async () => {
    const before = list.fields.find((f) => f.key === 'description');
    const r = await putFields(
      fields().map((f) =>
        f.key === 'state' ? { ...f, settings: { options: ['Ohio', 'Texas', 'Not sure'] } } : f,
      ),
    );
    expect(r.statusCode, say(r)).toBe(200);
    list = json<ListDetail>(r);
    expect(list.fields.find((f) => f.key === 'state')?.settings).toEqual({
      options: ['Ohio', 'Texas', 'Not sure'],
    });
    expect(list.fields.find((f) => f.key === 'description')?.id).toBe(before?.id);
  });

  it('removing the only free-text question makes the address unnecessary', async () => {
    const all = fields();
    const r = await putFields(all.filter((f) => f.key !== 'description'));
    expect(r.statusCode, say(r)).toBe(200);
    expect(json<ListDetail>(r).requires_email).toBe(false);
    // A removed question cannot be saved back under its old row.
    const back = await putFields(all);
    expect(back.statusCode).toBe(400);
    expect(code(back)).toBe('no-field');
    // As a new question under the same key, it can, and the address is back.
    const again = await putFields(
      all.map((f) => (f.key === 'description' ? { ...f, id: null } : f)),
    );
    expect(again.statusCode, say(again)).toBe(200);
    list = json<ListDetail>(again);
    expect(list.requires_email).toBe(true);
  });

  it('the list can be made listed', async () => {
    const r = await patch({ visibility: 'listed' });
    expect(r.statusCode, say(r)).toBe(200);
    expect(json<ListDetail>(r).visibility).toBe('listed');
  });
});

describe('what a visitor can send', () => {
  it('a listed list is readable by anybody past the gate, with none of the operator’s settings', async () => {
    const r = await anybody({ method: 'GET', url: `/api/lists/${SLUG}` });
    expect(r.statusCode, say(r)).toBe(200);
    const form = json<{ asks_email: boolean; fields: Record<string, unknown>[] }>(r);
    expect(form.asks_email).toBe(true);
    expect(form.fields[0]).not.toHaveProperty('aggregatable');
    expect(form.fields[0]).not.toHaveProperty('id');
    expect(form.fields[0]).not.toHaveProperty('retention');
  });

  it('the front page offers it, among its buttons', async () => {
    const lists = json<{ lists: { slug: string }[] }>(
      await anybody({ method: 'GET', url: '/api/lists' }),
    );
    expect(lists.lists.map((l) => l.slug)).toContain(SLUG);
    const buttons = json<{ buttons: { kind: string; ref: string; href: string }[] }>(
      await anybody({ method: 'GET', url: '/api/home-buttons' }),
    );
    expect(buttons.buttons).toContainEqual(
      expect.objectContaining({ kind: 'list', ref: SLUG, href: `/list/${SLUG}` }),
    );
  });

  it('a link and two choices go through with no address', async () => {
    const r = await send({
      answers: {
        links: ['https://example.org/a?utm_source=x'],
        state: 'Ohio',
        category: 'Not sure',
      },
    });
    expect(r.statusCode, say(r)).toBe(200);
    expect(json<{ erasable: boolean }>(r).erasable).toBe(false);
  });

  it('writing something with no address is refused, in words', async () => {
    const r = await send({
      answers: {
        links: ['https://example.org/b'],
        state: 'Ohio',
        category: 'Not sure',
        description: 'I saw it happen',
      },
    });
    expect(r.statusCode).toBe(400);
    expect(code(r)).toBe('email-required-for-personal-data');
    expect(message(r)).toMatch(/deleted/);
  });

  it('with an address it goes through, is erasable, and the erasure link is emailed', async () => {
    const r = await send({
      answers: {
        links: ['https://example.org/b'],
        state: 'Texas',
        category: 'Not sure',
        description: 'SECRET-WORDS-123',
      },
      email: 'someone@example.org',
    });
    expect(r.statusCode, say(r)).toBe(200);
    expect(json(r)).toEqual({ ok: true, erasure_mailed: true, erasable: true });
    const mail = h.mailer.lastTo('someone@example.org');
    expect(mail?.text).toMatch(new RegExp(`${SITE}/api/forget/[A-Za-z0-9_-]{40,}`));
    expect(mail?.text).toMatch(/after 90 days/);
  });

  it('a shortened link is refused with a reason a person can act on, naming the question', async () => {
    const r = await send({
      answers: { links: ['https://bit.ly/x'], state: 'Ohio', category: 'Not sure' },
    });
    expect(r.statusCode).toBe(400);
    expect(code(r)).toBe('shortener');
    expect(message(r)).toMatch(/“Link”: .*full address/);
  });

  it('an answer that is not one of the options is refused', async () => {
    const r = await send({
      answers: { links: ['https://example.org/c'], state: 'Mars', category: 'Not sure' },
    });
    expect(code(r)).toBe('not-an-option');
  });

  it('the hidden box and a form filled faster than it can be read answer like success, and write nothing', async () => {
    const n = await entries();
    const a = await send({
      answers: { links: ['https://example.org/d'], state: 'Ohio', category: 'Not sure' },
      website: 'http://spam',
    });
    const b = await send({
      answers: { links: ['https://example.org/e'], state: 'Ohio', category: 'Not sure' },
      elapsed_ms: 100,
    });
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(await entries()).toBe(n);
  });
});

describe('when, and why, an address is asked', () => {
  it('the Tip List asks only somebody who writes something, and says so', async () => {
    const form = json<{ email_when: string; email_reason: string }>(
      await anybody({ method: 'GET', url: `/api/lists/${SLUG}` }),
    );
    expect(form).toMatchObject({ email_when: 'if-written', email_reason: 'erase' });
  });

  it('a contact form made from its template always asks, so the site can reply', async () => {
    const slug = uniqueSlug('reach');
    const made = json<ListDetail>(
      await admin({
        method: 'POST',
        url: '/api/admin/lists',
        payload: { template: 'contact', slug },
      }),
    );
    expect(made.email_mode).toBe('required');
    await patch({ visibility: 'listed' }, made.id);
    const form = json<{ email_when: string; email_reason: string }>(
      await anybody({ method: 'GET', url: `/api/lists/${slug}` }),
    );
    expect(form).toMatchObject({ email_when: 'always', email_reason: 'reply' });
    expect(
      (await admin({ method: 'DELETE', url: `/api/admin/lists/${String(made.id)}` })).statusCode,
    ).toBe(200);
  });

  it('an administrator can make a form always ask; then a link alone is refused, in words', async () => {
    expect(json<ListDetail>(await patch({ email_mode: 'required' })).email_mode).toBe('required');
    const n = await entries();
    const r = await send({
      answers: { links: ['https://example.org/always'], state: 'Ohio', category: 'Not sure' },
    });
    expect(code(r)).toBe('email-required');
    expect(message(r)).toMatch(/needs your email address/);
    expect(await entries()).toBe(n);
    const ok = await send({
      answers: { links: ['https://example.org/always'], state: 'Ohio', category: 'Not sure' },
      email: 'reach@example.org',
    });
    expect(ok.statusCode, say(ok)).toBe(200);
  });

  it('"never" is not a setting: the gate still applies on a form people write on', async () => {
    const r = await patch({ email_mode: 'never' });
    expect(r.statusCode).toBe(400);
    expect(code(r)).toBe('email-mode');
    await patch({ email_mode: 'auto' });
  });
});

describe('published counts', () => {
  it('are not published by default', async () => {
    expect((await anybody({ method: 'GET', url: `/api/lists/${SLUG}/counts` })).statusCode).toBe(
      404,
    );
  });

  it('once published: received and approved, only the ticked questions, and nothing anybody wrote', async () => {
    await patch({ aggregates_published: true });
    const r = await anybody({ method: 'GET', url: `/api/lists/${SLUG}/counts` });
    expect(r.statusCode, say(r)).toBe(200);
    const b = json<{ totals: { received: number; approved: number }; fields: { key: string }[] }>(
      r,
    );
    expect(b.totals).toMatchObject({ received: 3, approved: 0 });
    // P3: the line beside every number, as the one constant.
    expect(json<{ not_a_sample: string }>(r).not_a_sample).toBe(
      'These are reports people chose to file. They are not a sample and cannot be read as a rate.',
    );
    // The tips template ticks no question as countable (owner ruling 42): an
    // operator who wants counts ticks them. Totals only, until then.
    expect(b.fields).toEqual([]);
    expect(r.body).not.toMatch(/SECRET-WORDS-123|someone@example\.org/);
  });
});

describe('review, in bulk', () => {
  let ids: number[] = [];

  it('somebody with no role cannot reach the queue; an administrator and a moderator can', async () => {
    expect((await user({ method: 'GET', url: '/api/list-review' })).statusCode).toBe(403);
    expect((await admin({ method: 'GET', url: '/api/list-review' })).statusCode).toBe(200);
    const q = json<{ queues: { slug: string; waiting: number }[] }>(
      await mod({ method: 'GET', url: '/api/list-review' }),
    );
    expect(q.queues.find((x) => x.slug === SLUG)?.waiting).toBe(3);
  });

  it('shows the page of entries, with the host of every link', async () => {
    const r = await mod({ method: 'GET', url: `/api/list-review/${String(list.id)}` });
    expect(r.statusCode, say(r)).toBe(200);
    const b = json<{ entries: { id: number; links: { host: string }[] }[] }>(r);
    expect(b.entries).toHaveLength(3);
    expect(b.entries[0]?.links[0]?.host).toBe('example.org');
    ids = b.entries.map((e) => e.id);
  });

  it('approving names the rows looked at, and an entry cannot be un-reviewed', async () => {
    const url = `/api/list-review/${String(list.id)}/review`;
    const ok = await mod({ method: 'POST', url, payload: { state: 'approved', ids: [ids[0]] } });
    expect(json(ok)).toEqual({ changed: 1 });
    const back = await mod({ method: 'POST', url, payload: { state: 'received', ids } });
    expect(back.statusCode).toBe(400);
    const counts = json<{ totals: { approved: number } }>(
      await anybody({ method: 'GET', url: `/api/lists/${SLUG}/counts` }),
    );
    expect(counts.totals.approved).toBe(1);
  });

  it('triage is its own question', async () => {
    const r = await mod({
      method: 'POST',
      url: `/api/list-review/${String(list.id)}/triage`,
      payload: { state: 'actioned', ids },
    });
    expect(json(r)).toEqual({ changed: 3 });
    const bad = await mod({
      method: 'POST',
      url: `/api/list-review/${String(list.id)}/triage`,
      payload: { state: 'done-ish', ids },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('the erasure link', () => {
  let token = '';
  let held = 0;

  it('opening it shows a button and ERASES NOTHING, because mail scanners follow every link', async () => {
    const mail = h.mailer.lastTo('someone@example.org');
    token = /\/api\/forget\/([A-Za-z0-9_-]+)/.exec(mail?.text ?? '')?.[1] ?? '';
    expect(token).not.toBe('');
    const r = await anybody({ method: 'GET', url: `/api/forget/${token}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(r.body).toMatch(/<form method="post" action="\/api\/forget\//);
    const row = await h.db
      .selectFrom('list_entries')
      .select(['id', 'erasable_answers'])
      .where('list_id', '=', list.id)
      .where('erasable_answers', 'is not', null)
      .executeTakeFirstOrThrow();
    held = row.id;
    expect(row.erasable_answers).toMatchObject({ description: 'SECRET-WORDS-123' });
  });

  it('pressing the button erases the words and the address, and leaves the links and choices', async () => {
    const r = await anybody({
      method: 'POST',
      url: `/api/forget/${token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(r.statusCode, say(r)).toBe(200);
    expect(r.body).toMatch(/gone/);
    const row = await h.db
      .selectFrom('list_entries')
      .selectAll()
      .where('id', '=', held)
      .executeTakeFirstOrThrow();
    expect(row.erasable_answers).toBe(null);
    expect(row.email_enc).toBe(null);
    expect(row.erased_at).not.toBe(null);
    expect(row.answers).not.toHaveProperty('links');
    expect(row.answers).toMatchObject({ state: 'Texas' });
    // Its links went with it (Plan D T3).
    expect(
      await h.db.selectFrom('links').select('id').where('entry_id', '=', held).execute(),
    ).toEqual([]);
  });

  it('works once, and a mangled link says so rather than erroring', async () => {
    expect((await anybody({ method: 'POST', url: `/api/forget/${token}` })).statusCode).toBe(404);
    const bad = await anybody({ method: 'GET', url: '/api/forget/not-a-token' });
    expect(bad.statusCode).toBe(404);
    expect(bad.body).toMatch(/does not work/);
  });

  it('a link minted the way the email mints one works the same way', async () => {
    const other = await send({
      answers: {
        links: ['https://example.org/z'],
        state: 'Ohio',
        category: 'Not sure',
        description: 'more',
      },
      email: 'other@example.org',
    });
    expect(other.statusCode).toBe(200);
    const row = await h.db
      .selectFrom('list_entries')
      .select(['id', 'personal_expires_at'])
      .where('email_hmac', '=', emailDigest(await linkKeys(h.db), 'other@example.org'))
      .executeTakeFirstOrThrow();
    const t = await mintErasureToken(h.db, {
      entryId: row.id,
      personalExpiresAt: row.personal_expires_at,
    });
    expect((await anybody({ method: 'POST', url: `/api/forget/${t}` })).statusCode).toBe(200);
  });
});

describe('who hears of new entries', () => {
  const named = address('notify');

  it('naming an address other than the admin one sends it a link and changes nothing yet', async () => {
    const r = await patch({ notify: true, notify_email: named });
    expect(r.statusCode, say(r)).toBe(200);
    const d = json<ListAdminDetail>(r);
    expect(d.notify_email).toBe(null);
    expect(d.notify_pending_email).toBe(named);
    expect(d.confirm_sent).toBe(true);
    expect(h.mailer.lastTo(named)?.text).toMatch(new RegExp(`${SITE}/api/list-mail/`));
  });

  it('while pending, it receives nothing', async () => {
    const before = h.mailer.messages.filter((m) => m.to === named).length;
    await send({
      answers: { links: ['https://example.org/p'], state: 'Ohio', category: 'Not sure' },
    });
    expect(h.mailer.messages.filter((m) => m.to === named).length).toBe(before);
  });

  it('opening the link agrees to nothing; pressing the button does', async () => {
    const token = /\/api\/list-mail\/([A-Za-z0-9_-]+)/.exec(
      h.mailer.lastTo(named)?.text ?? '',
    )?.[1];
    const look = await anybody({ method: 'GET', url: `/api/list-mail/${token ?? ''}` });
    expect(look.statusCode).toBe(200);
    expect(look.body).toMatch(/<form method="post"/);
    const still = json<ListAdminDetail>(
      await admin({ method: 'GET', url: `/api/admin/lists/${String(list.id)}` }),
    );
    expect(still.notify_email).toBe(null);

    const yes = await anybody({ method: 'POST', url: `/api/list-mail/${token ?? ''}` });
    expect(yes.statusCode, say(yes)).toBe(200);
    const now = json<ListAdminDetail>(
      await admin({ method: 'GET', url: `/api/admin/lists/${String(list.id)}` }),
    );
    expect(now.notify_email).toBe(named);
    expect(now.notify_pending_email).toBe(null);
    expect(
      (await anybody({ method: 'POST', url: `/api/list-mail/${token ?? ''}` })).statusCode,
    ).toBe(404);
  });

  it('then each new entry is emailed there, labelled, in plain text', async () => {
    await send({
      answers: {
        links: ['https://example.org/q'],
        state: 'Ohio',
        category: 'Not sure',
        description: '<b>hi</b>',
      },
      email: 'writer@example.org',
    });
    const m = h.mailer.lastTo(named);
    expect(m?.subject).toMatch(/New on/);
    expect(m?.text).toMatch(/Anything we should know about the link\n<b>hi<\/b>/);
    expect(m?.text).toMatch(/writer@example\.org/);
    expect(m?.text).toMatch(/deletion timer cannot reach it/);
  });

  it('naming another address makes the earlier link worthless', async () => {
    const second = address('notify-2');
    await patch({ notify_email: second });
    const t1 = /\/api\/list-mail\/([A-Za-z0-9_-]+)/.exec(h.mailer.lastTo(second)?.text ?? '')?.[1];
    const third = address('notify-3');
    await patch({ notify_email: third });
    expect((await anybody({ method: 'POST', url: `/api/list-mail/${t1 ?? ''}` })).statusCode).toBe(
      404,
    );
  });
});

describe('the site password, decided per list', () => {
  let doorSlug = '';
  let doorId = 0;
  // The administrator, past the password the way a person gets there.
  let inside: Call = admin;
  const door = (payload: Record<string, unknown>) => patch(payload, doorId, inside);

  beforeAll(async () => {
    const made = json<ListDetail>(
      await admin({
        method: 'POST',
        url: '/api/admin/lists',
        payload: { template: 'check-ins', slug: uniqueSlug('door') },
      }),
    );
    doorSlug = made.slug;
    doorId = made.id;
    await h.db
      .updateTable('site_access')
      .set({ enabled: true, password_hash: await hashPassword('lists-test-password') })
      .where('id', '=', true)
      .execute();
    const unlocked = await anybody({
      method: 'POST',
      url: '/api/site-access/unlock',
      payload: { password: 'lists-test-password' },
    });
    inside = as(h, ADMIN, unlocked.cookies.find((c) => c.name === 'site_access')?.value);
  });
  afterAll(async () => {
    await liftCurtain(h.db);
  });

  it('a list behind the password answers exactly what the gate would', async () => {
    for (const url of [
      `/api/lists/${SLUG}`,
      `/api/lists/${SLUG}/counts`,
      '/api/lists/no-such-list',
    ]) {
      const r = await anybody({ method: 'GET', url });
      expect(r.statusCode, url).toBe(401);
      expect(code(r)).toBe('locked');
    }
    expect(code(await send({ answers: {} }))).toBe('locked');
    // The list of lists is behind it too: it is not a list deciding for itself.
    expect(code(await anybody({ method: 'GET', url: '/api/lists' }))).toBe('locked');
  });

  it('only a listed list can be opened outside, and hiding it closes the door with it', async () => {
    const refused = await door({ outside_access: 'door' });
    expect(code(refused)).toBe('outside-needs-listed');
    const open = await door({ visibility: 'listed', outside_access: 'door' });
    expect(json<ListDetail>(open).outside_access).toBe('door');
  });

  it('a door list is reachable without the password, takes an entry, and is offered on the password page', async () => {
    expect((await anybody({ method: 'GET', url: `/api/lists/${doorSlug}` })).statusCode).toBe(200);
    const r = await send(
      { answers: { verdict: 'It went fine', state: 'Not sure' } },
      anybody,
      doorSlug,
    );
    expect(r.statusCode, say(r)).toBe(200);
    const offered = await doors(h.db);
    expect(offered).toContainEqual({
      kind: 'list',
      slug: doorSlug,
      title: 'How did it go?',
      href: `/list/${doorSlug}`,
    });
    const page = json<{ doors: { href: string }[] }>(
      await anybody({ method: 'GET', url: '/api/doors' }),
    );
    expect(page.doors.map((d) => d.href)).toContain(`/list/${doorSlug}`);
  });

  it('a link list works but is not offered; a closed list stops being a door', async () => {
    await door({ outside_access: 'link' });
    expect((await anybody({ method: 'GET', url: `/api/lists/${doorSlug}` })).statusCode).toBe(200);
    expect((await doors(h.db)).map((d) => d.slug)).not.toContain(doorSlug);
    await door({ outside_access: 'door', closed: true });
    expect((await doors(h.db)).map((d) => d.slug)).not.toContain(doorSlug);
    await door({ closed: false });
  });

  it('making it team-only closes the outside door with it', async () => {
    const hidden = json<ListDetail>(await door({ visibility: 'password' }));
    expect(hidden.outside_access).toBe('closed');
    expect(code(await anybody({ method: 'GET', url: `/api/lists/${doorSlug}` }))).toBe('locked');
  });

  it('the erasure page stands in front of the password: a right is not behind one', async () => {
    const r = await anybody({
      method: 'GET',
      url: '/api/forget/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/Delete what you wrote/);
  });
});

describe('closing and deleting', () => {
  it('a closed list takes nothing, and the front page stops offering it', async () => {
    const closed = json<ListDetail>(await patch({ closed: true }));
    expect(closed.closed_at).not.toBe(null);
    // Saving it closed again does not move the moment it closed.
    expect(json<ListDetail>(await patch({ closed: true, title: closed.title })).closed_at).toBe(
      closed.closed_at,
    );
    const r = await send({
      answers: { links: ['https://example.org/f'], state: 'Ohio', category: 'Not sure' },
    });
    expect(code(r)).toBe('closed');
    const lists = json<{ lists: { slug: string }[] }>(
      await anybody({ method: 'GET', url: '/api/lists' }),
    );
    expect(lists.lists.map((l) => l.slug)).not.toContain(SLUG);
  });

  it('a list with entries cannot be deleted', async () => {
    const r = await admin({ method: 'DELETE', url: `/api/admin/lists/${String(list.id)}` });
    expect(r.statusCode).toBe(409);
    expect(code(r)).toBe('has-entries');
  });

  it('a team-only list is 404 to a visitor and readable to somebody signed in; an unused one can be deleted', async () => {
    const slug = uniqueSlug('team');
    const made = json<ListDetail>(
      await admin({
        method: 'POST',
        url: '/api/admin/lists',
        payload: { template: 'contact', slug },
      }),
    );
    expect(made.requires_email).toBe(true);
    await patch({ visibility: 'password' }, made.id);
    expect((await anybody({ method: 'GET', url: `/api/lists/${slug}` })).statusCode).toBe(404);
    expect((await user({ method: 'GET', url: `/api/lists/${slug}` })).statusCode).toBe(200);
    expect(
      (await admin({ method: 'DELETE', url: `/api/admin/lists/${String(made.id)}` })).statusCode,
    ).toBe(200);
  });
});
