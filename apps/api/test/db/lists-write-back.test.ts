/**
 * "We'll write back": a list may let a reviewer open an entry's address.
 *
 * What this pins down: the address can be opened ONLY while the switch is on,
 * ONLY by a moderator or administrator, every opening is recorded before the
 * address is read, and the record never holds the address. With the switch off
 * nothing about an address changes, and the file keeps the key absent.
 */
import type { ListAdminDetail, ListDetail } from '@reportlog/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doorPass } from '../door-pass.ts';
import { uniqueSlug } from './helpers.ts';
import { address, as, harness, liftCurtain, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';
import { LINK_CONTACT_KEY } from './links-helpers.ts';

let h: Harness;
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

const ADDRESS = 'write.back.person@example.org';
const SLUG = uniqueSlug('reach-back');
let list: ListDetail;
let withAddress = 0;
const STAFF = { admin: '', mod: '' };
let withoutAddress = 0;

const make = async (template: string, slug: string) =>
  json<ListDetail>(
    await admin({ method: 'POST', url: '/api/admin/lists', payload: { template, slug } }),
  );
const patch = (payload: Record<string, unknown>, id = list.id) =>
  admin({ method: 'PATCH', url: `/api/admin/lists/${String(id)}`, payload });
const send = async (slug: string, body: Record<string, unknown>) =>
  anybody({
    method: 'POST',
    url: `/api/lists/${slug}/entries`,
    payload: { ...(await doorPass(h.app)), ...body },
  });
const reveal = (call: Call, id: number, entry: number) =>
  call({ method: 'POST', url: `/api/list-review/${String(id)}/entries/${String(entry)}/address` });
const reveals = (entry: number) =>
  h.db.selectFrom('list_address_reveals').selectAll().where('entry_id', '=', entry).execute();

beforeAll(async () => {
  h = await harness({ CONTACT_KEY: LINK_CONTACT_KEY });
  const [a, m, u] = [address('wb-admin'), address('wb-mod'), address('wb-user')];
  STAFF.admin = a;
  STAFF.mod = m;
  await seat(h.db, a, 'admin');
  await seat(h.db, m, 'moderator');
  await seat(h.db, u, 'user');
  admin = as(h, await signIn(h, a));
  mod = as(h, await signIn(h, m));
  user = as(h, await signIn(h, u));
  anybody = as(h);

  // The contact template ships with the switch on; it asks everybody for an address.
  list = await make('contact', SLUG);
  await patch({ visibility: 'listed' });
  const body = { answers: { subject: 'Hello', message: 'Please reply' } };
  expect((await send(SLUG, { ...body, email: ADDRESS })).statusCode).toBe(200);
  withAddress = (
    await h.db
      .selectFrom('list_entries')
      .select('id')
      .where('list_id', '=', list.id)
      .executeTakeFirstOrThrow()
  ).id;
  // An entry with no address: a list that only sometimes asks for one.
  await h.db
    .insertInto('list_entries')
    .values({ list_id: list.id, answers: JSON.stringify({}) })
    .execute();
  withoutAddress = (
    await h.db
      .selectFrom('list_entries')
      .select('id')
      .where('list_id', '=', list.id)
      .where('email_enc', 'is', null)
      .executeTakeFirstOrThrow()
  ).id;
});
afterAll(async () => {
  await liftCurtain(h.db);
  await h.close();
});

describe('the switch', () => {
  it('the contact template ships with it on; a Tip List does not', async () => {
    expect(list.write_back).toBe(true);
    const tips = await make('tips', uniqueSlug('plain'));
    expect(tips.write_back).toBe(false);
  });

  it('the list file carries the key only when it is on', async () => {
    const on = json<Record<string, unknown>>(
      await admin({ method: 'GET', url: `/api/admin/lists/${String(list.id)}/file` }),
    );
    expect(on.write_back).toBe(true);
    const tips = await make('tips', uniqueSlug('plain-file'));
    const off = json<Record<string, unknown>>(
      await admin({ method: 'GET', url: `/api/admin/lists/${String(tips.id)}/file` }),
    );
    expect('write_back' in off).toBe(false);
    // Uploading the file back keeps the switch.
    const again = await admin({
      method: 'POST',
      url: '/api/admin/lists/from-file',
      payload: { file: on, slug: uniqueSlug('again') },
    });
    expect(json<ListDetail>(again).write_back).toBe(true);
  });

  it('the visitor’s form says the list writes back, and a plain list does not', async () => {
    expect(
      json<{ write_back: boolean; email_reason: string }>(
        await anybody({ method: 'GET', url: `/api/lists/${SLUG}` }),
      ),
    ).toMatchObject({ write_back: true, email_reason: 'reply' });
    const tips = await make('tips', uniqueSlug('plain-form'));
    await patch({ visibility: 'listed' }, tips.id);
    expect(
      json<{ write_back: boolean; email_reason: string }>(
        await anybody({ method: 'GET', url: `/api/lists/${tips.slug}` }),
      ),
    ).toMatchObject({ write_back: false, email_reason: 'erase' });
  });

  it('only an administrator changes it', async () => {
    const url = `/api/admin/lists/${String(list.id)}`;
    expect((await mod({ method: 'PATCH', url, payload: { write_back: false } })).statusCode).toBe(
      403,
    );
    expect((await user({ method: 'PATCH', url, payload: { write_back: false } })).statusCode).toBe(
      403,
    );
    expect(json<ListAdminDetail>(await patch({ write_back: true })).write_back).toBe(true);
  });
});

describe('opening an address', () => {
  it('the review page says whether to offer it, and never carries the address itself', async () => {
    const r = await mod({ method: 'GET', url: `/api/list-review/${String(list.id)}` });
    expect(r.statusCode, say(r)).toBe(200);
    expect(json<{ list: { write_back: boolean } }>(r).list.write_back).toBe(true);
    expect(r.body).not.toContain(ADDRESS);
  });

  it('a moderator gets the address, and the opening is recorded without it', async () => {
    const r = await reveal(mod, list.id, withAddress);
    expect(r.statusCode, say(r)).toBe(200);
    expect(json<{ address: string }>(r).address).toBe(ADDRESS);
    const rows = await reveals(withAddress);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ staff_email: STAFF.mod, list_id: list.id });
    expect(JSON.stringify(rows)).not.toContain(ADDRESS);
  });

  it('an administrator may too, and each opening is a row of its own', async () => {
    expect((await reveal(admin, list.id, withAddress)).statusCode).toBe(200);
    expect((await reveals(withAddress)).map((r) => r.staff_email).sort()).toEqual(
      [STAFF.admin, STAFF.mod].sort(),
    );
  });

  it('somebody with no staff role, and a visitor, are refused and nothing is recorded', async () => {
    const before = (await reveals(withAddress)).length;
    expect((await reveal(user, list.id, withAddress)).statusCode).toBe(403);
    expect((await reveal(anybody, list.id, withAddress)).statusCode).toBeGreaterThanOrEqual(401);
    expect((await reveals(withAddress)).length).toBe(before);
  });

  it('an entry with no address says so in words, and records nothing', async () => {
    const r = await reveal(mod, list.id, withoutAddress);
    expect(r.statusCode).toBe(404);
    expect(code(r)).toBe('no-address');
    expect(await reveals(withoutAddress)).toHaveLength(0);
  });

  it('an entry of another list is not found through this one', async () => {
    const other = await make('tips', uniqueSlug('other'));
    await patch({ write_back: true }, other.id);
    const r = await reveal(mod, other.id, withAddress);
    expect(r.statusCode).toBe(404);
    expect(code(r)).toBe('no-entry');
  });

  it('with the switch off the address is refused, and the review page stops offering it', async () => {
    const quiet = await make('tips', uniqueSlug('quiet'));
    await patch({ visibility: 'listed' }, quiet.id);
    const entry = await h.db
      .insertInto('list_entries')
      .values({ list_id: quiet.id, answers: JSON.stringify({}) })
      .returning('id')
      .executeTakeFirstOrThrow();
    const r = await reveal(mod, quiet.id, entry.id);
    expect(r.statusCode).toBe(403);
    expect(code(r)).toBe('no-write-back');
    expect(await reveals(entry.id)).toHaveLength(0);
    const page = await mod({ method: 'GET', url: `/api/list-review/${String(quiet.id)}` });
    expect(json<{ list: { write_back: boolean } }>(page).list.write_back).toBe(false);

    // Turning it off on the list that has an address closes it at once.
    await patch({ write_back: false });
    const closed = await reveal(mod, list.id, withAddress);
    expect(closed.statusCode).toBe(403);
    await patch({ write_back: true });
  });

  it('an erased entry has nothing to open', async () => {
    const entry = await h.db
      .insertInto('list_entries')
      .values({ list_id: list.id, answers: JSON.stringify({}), erased_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect(code(await reveal(mod, list.id, entry.id))).toBe('no-address');
  });
});

describe('the record of openings', () => {
  it('cannot be changed or removed, by anybody', async () => {
    await expect(
      h.db.updateTable('list_address_reveals').set({ staff_email: 'x@example.org' }).execute(),
    ).rejects.toThrow();
    await expect(h.db.deleteFrom('list_address_reveals').execute()).rejects.toThrow();
  });
});
