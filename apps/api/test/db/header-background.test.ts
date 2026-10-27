/**
 * The header background and the other look options (U1): the owner alone
 * saves them, the picture is re-encoded and served from this site only, a
 * replaced or removed picture stops being served at once, a look pack's
 * header kit is served by the hash of what it holds, and the lock screen
 * and the doors are told none of it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LOOK_OPTIONS } from '@reportlog/contracts';
import type { LookOptions } from '@reportlog/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installPack } from '../../src/looks/packs.ts';
import { lookInFront } from '../../src/site/lockScreen.ts';
import { zip } from '../zip.ts';
import { filesHarness, jpegWithGps, toolsMissing } from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { address, seat, signIn } from './identity-helpers.ts';

let h: FilesHarness;
let owner = '';
let admin = '';

beforeAll(async () => {
  h = await filesHarness();
  // address() makes a new one each call: keep them.
  const ownerEmail = address('hb-owner');
  const adminEmail = address('hb-admin');
  await seat(h.db, ownerEmail, 'owner');
  await seat(h.db, adminEmail, 'admin');
  owner = await signIn(h, ownerEmail);
  admin = await signIn(h, adminEmail);
  await reset();
});

afterAll(async () => {
  await reset();
  await h.close();
});

async function reset() {
  await h.db.updateTable('site_settings').set({ look_options: null }).execute();
  await h.db.deleteFrom('look_packs').execute();
}

const as = (token: string) => ({ session_token: token });
const putOptions = (token: string, body: unknown) =>
  h.app.inject({
    method: 'PUT',
    url: '/api/admin/site/look-options',
    payload: body as never,
    cookies: as(token),
  });
const site = async () =>
  (await h.app.inject({ method: 'GET', url: '/api/site', cookies: as(owner) })).json<{
    look: { options: LookOptions; kits?: string[] };
  }>();
const upload = (token: string, body: Buffer, type = 'image/jpeg') =>
  h.app.inject({
    method: 'PUT',
    url: '/api/admin/site/header-image',
    headers: { 'content-type': type },
    payload: body,
    cookies: as(token),
  });
const objects = () => {
  try {
    return readdirSync(join(h.files.dir, 'renditions', 'headers')).filter(
      (f) => !f.includes('.part-'),
    );
  } catch {
    return [];
  }
};

describe('the options', () => {
  it('a site that never chose has the defaults', async () => {
    expect((await site()).look.options).toEqual(DEFAULT_LOOK_OPTIONS);
  });

  it('only the owner saves them', async () => {
    const body = { ...DEFAULT_LOOK_OPTIONS, motion: 'off' };
    expect((await putOptions(admin, body)).statusCode).toBe(403);
    expect((await site()).look.options.motion).toBe('on');
    const res = await putOptions(owner, body);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ look_options: LookOptions }>().look_options.motion).toBe('off');
    expect((await site()).look.options.motion).toBe('off');
  });

  it('refuses a value outside its range in a schema error, and saves nothing', async () => {
    const bad = { ...DEFAULT_LOOK_OPTIONS, header: { ...DEFAULT_LOOK_OPTIONS.header, pattern: 9 } };
    expect((await putOptions(owner, bad)).statusCode).toBe(400);
    expect((await site()).look.options.header.pattern).toBe(0.14);
  });

  it('refuses a picture that was never uploaded, in a sentence', async () => {
    const image = {
      file: 'b'.repeat(32) + '.jpg',
      place: 'behind',
      shape: null,
      mode: 'under',
      tone: 'mono',
      strength: 0.4,
      focus: 60,
    };
    const res = await putOptions(owner, {
      ...DEFAULT_LOOK_OPTIONS,
      header: { ...DEFAULT_LOOK_OPTIONS.header, image },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toBe(
      'Add the image first, then choose how it is used.',
    );
  });

  it('the lock screen and the doors are told none of it', async () => {
    const front = await lookInFront(h.db);
    expect(front).not.toHaveProperty('options');
    expect(front).not.toHaveProperty('kits');
  });
});

describe.skipIf(toolsMissing)('the picture', () => {
  let first = '';
  let second = '';

  it('is re-encoded: only the picture survives, and it is served from this site', async () => {
    const jpeg = jpegWithGps(h.files.dir);
    expect(jpeg.includes(Buffer.from('TestCam'))).toBe(true);
    expect((await upload(admin, jpeg)).statusCode).toBe(403);
    const res = await upload(owner, jpeg);
    expect(res.statusCode, res.body).toBe(200);
    first = res.json<{ look_options: LookOptions }>().look_options.header.image?.file ?? '';
    expect(first).toMatch(/^[a-f0-9]{32}\.jpg$/);
    const stored = readFileSync(join(h.files.dir, 'renditions', 'headers', first));
    expect(stored.includes(Buffer.from('TestCam'))).toBe(false);
    const served = await h.app.inject({
      method: 'GET',
      url: `/api/site/header-image/${first}`,
      cookies: as(owner),
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });

  it('a first picture starts where the mock-up’s does, and the choices about it save', async () => {
    const options = (await site()).look.options;
    expect(options.header.image).toMatchObject({ place: 'behind', mode: 'under', tone: 'mono' });
    const next = {
      ...options,
      header: { ...options.header, image: { ...options.header.image, tone: 'dark', focus: 20 } },
    };
    expect((await putOptions(owner, next)).statusCode).toBe(200);
    expect((await site()).look.options.header.image).toMatchObject({ tone: 'dark', focus: 20 });
  });

  it('refuses what is not an image, and a picture that cannot be read', async () => {
    const text = await upload(owner, Buffer.from('not a picture at all'), 'image/jpeg');
    expect(text.statusCode).toBe(400);
    expect(text.json<{ error: { message: string } }>().error.message).toBe(
      'A header image must be a JPEG, PNG or WebP.',
    );
    expect((await upload(owner, Buffer.alloc(0))).statusCode).toBe(400);
  });

  it('a replacement keeps the choices about the picture, and the old file stops being served', async () => {
    const res = await upload(owner, jpegWithGps(h.files.dir));
    expect(res.statusCode, res.body).toBe(200);
    const image = res.json<{ look_options: LookOptions }>().look_options.header.image;
    second = image?.file ?? '';
    expect(second).not.toBe(first);
    expect(image).toMatchObject({ tone: 'dark', focus: 20 });
    const old = await h.app.inject({
      method: 'GET',
      url: `/api/site/header-image/${first}`,
      cookies: as(owner),
    });
    expect(old.statusCode).toBe(404);
    expect(objects()).toEqual([second]);
  });

  it('a name that is not a stored one is a 404, and so is a path', async () => {
    for (const name of ['c'.repeat(32) + '.jpg', '..%2F..%2Fetc%2Fpasswd', 'x.jpg']) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/site/header-image/${name}`,
        cookies: as(owner),
      });
      expect(res.statusCode, name).toBe(404);
    }
  });

  it('saving with the picture switched off removes it from the bucket', async () => {
    const options = (await site()).look.options;
    const res = await putOptions(owner, { ...options, header: { ...options.header, image: null } });
    expect(res.statusCode, res.body).toBe(200);
    expect(objects()).toEqual([]);
    const gone = await h.app.inject({
      method: 'GET',
      url: `/api/site/header-image/${second}`,
      cookies: as(owner),
    });
    expect(gone.statusCode).toBe(404);
  });

  it('Remove image clears it too', async () => {
    await upload(owner, jpegWithGps(h.files.dir));
    expect(objects()).toHaveLength(1);
    const res = await h.app.inject({
      method: 'DELETE',
      url: '/api/admin/site/header-image',
      cookies: as(owner),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ look_options: LookOptions }>().look_options.header.image).toBeNull();
    expect(objects()).toEqual([]);
  });
});

describe('a look pack’s header kit', () => {
  const pack = (version: string, extra: Record<string, unknown> = {}) =>
    zip([
      {
        name: 'look.json',
        data: JSON.stringify({
          format: 2,
          id: 'kit-pack',
          label: 'Kit pack',
          version,
          credit: 'Drawn for the tests.',
          shapes: { square: { v: '0 0 100 100', d: 'M10 10 L90 10 L90 90 L10 90 Z' } },
          elements: [
            { id: 'kit-stars', label: 'Stars', kind: 'stars' },
            { id: 'kit-square', label: 'Square', kind: 'shape', shape: 'square', h: 0.5 },
          ],
          ...extra,
        }),
      },
    ]);
  it('is installed, named by the hash of what it holds, and served', async () => {
    const done = await installPack(h.db, pack('1.0.0'), 'tests');
    expect(done, JSON.stringify(done)).toMatchObject({ ok: true });
    const { look } = await site();
    expect(look.kits).toHaveLength(1);
    const path = look.kits?.[0] ?? '';
    expect(path).toMatch(/^\/api\/looks\/kit-pack\/[0-9a-f]{64}\.json$/);
    const got = await h.app.inject({ method: 'GET', url: path });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({
      pack: 'kit-pack',
      credit: 'Drawn for the tests.',
      elements: [{ id: 'kit-stars' }, { id: 'kit-square', shape: 'square' }],
      shapes: { square: { v: '0 0 100 100' } },
    });
    const wrong = await h.app.inject({
      method: 'GET',
      url: `/api/looks/kit-pack/${'0'.repeat(64)}.json`,
    });
    expect(wrong.statusCode).toBe(404);
  });

  it('a replacement has a new address, and the old one is gone', async () => {
    const before = (await site()).look.kits?.[0] ?? '';
    const done = await installPack(
      h.db,
      pack('1.1.0', { credit: 'Drawn again, for the tests.' }),
      'tests',
    );
    expect(done).toMatchObject({ ok: true });
    const after = (await site()).look.kits?.[0] ?? '';
    expect(after).not.toBe(before);
    expect((await h.app.inject({ method: 'GET', url: before })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: after })).statusCode).toBe(200);
  });

  it('a shape that is not path data is refused in a sentence, and nothing is installed', async () => {
    await h.db.deleteFrom('look_packs').execute();
    const done = await installPack(
      h.db,
      pack('1.0.0', { shapes: { square: { v: '0 0 100 100', d: 'M0 0 <svg onload=x>' } } }),
      'tests',
    );
    expect(done).toMatchObject({ ok: false });
    expect(done.ok ? [] : done.problems).toContain(
      'The shape "square": "d" must be path data, with only path letters, numbers and separators.',
    );
    expect(await h.db.selectFrom('look_packs').select('id').execute()).toEqual([]);
  });

  it('an element another pack already provides is refused', async () => {
    await installPack(h.db, pack('1.0.0'), 'tests');
    const clash = zip([
      {
        name: 'look.json',
        data: JSON.stringify({
          format: 2,
          id: 'other-pack',
          label: 'Other',
          version: '1.0.0',
          elements: [{ id: 'kit-stars', label: 'More stars', kind: 'stars' }],
        }),
      },
    ]);
    const done = await installPack(h.db, clash, 'tests');
    expect(done.ok).toBe(false);
    expect(done.ok ? [] : done.problems).toContain(
      'A header element called "kit-stars" is already installed or listed twice.',
    );
  });
});
