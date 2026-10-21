/**
 * The logbook routes, through the real application. The module is tested on
 * its own beside this; what is checked here is what only the HTTP layer can
 * get wrong: a refusal arriving as a sentence in the one error shape, the
 * right status for the one-way door, and a draft never being public.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { questionsFor } from '../../src/chain/questions.ts';
import * as L from '../../src/logbooks/logbooks.ts';
import { uniqueSlug } from './helpers.ts';
import { address, harness, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
let db: Harness['db'];
/** The administrator every staff call in this file is made as. */
let session: string;
beforeAll(async () => {
  h = await harness();
  db = h.db;
  const email = address('builder-admin');
  await seat(db, email, 'admin');
  session = await signIn(h, email);
});
afterAll(async () => {
  await h.close();
});

// One helper for every call; the type is the caller's statement of what it expects.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
  as: string | null = session,
) {
  const res = await h.app.inject({
    method,
    url,
    ...(payload ? { payload } : {}),
    ...(as ? { cookies: { session_token: as } } : {}),
  });
  return { status: res.statusCode, body: res.json<T>() };
}

describe('the builder is for administrators', () => {
  it('refuses somebody signed out, and a moderator, on every kind of staff call', async () => {
    const moderator = address('builder-moderator');
    await seat(db, moderator, 'moderator');
    const modSession = await signIn(h, moderator);
    for (const [method, url, payload] of [
      ['GET', '/api/admin/logbooks', undefined],
      ['POST', '/api/admin/logbooks', { title: 'Sneaked in', slug: uniqueSlug('sneak') }],
      ['GET', '/api/admin/home-buttons', undefined],
    ] as const) {
      expect((await api(method, url, payload, null)).status, `${method} ${url} signed out`).toBe(
        401,
      );
      expect(
        (await api(method, url, payload, modSession)).status,
        `${method} ${url} moderator`,
      ).toBe(403);
    }
  });
});

interface Detail {
  id: number;
  slug: string;
  state: string;
  fields: { id: number; key: string; required: boolean }[];
}
interface ErrorBody {
  error: { code: string; message: string };
}

describe('building and launching over HTTP', () => {
  let lb: Detail;

  it('makes a draft, adds questions, and keeps a draft out of public view', async () => {
    const made = await api<Detail>('POST', '/api/admin/logbooks', {
      title: 'Over HTTP',
      slug: uniqueSlug('http'),
    });
    expect(made.status).toBe(200);
    lb = made.body;
    expect(lb.state).toBe('draft');

    const q1 = await api('POST', `/api/admin/logbooks/${String(lb.id)}/fields`, {
      kind: 'yes_no',
      label: 'Were you hurt?',
      key: 'hurt',
      required: true,
    });
    expect(q1.status).toBe(200);
    await api('POST', `/api/admin/logbooks/${String(lb.id)}/fields`, {
      kind: 'short_text',
      label: 'How?',
      key: 'how',
      shown_when: { field: 'hurt', in: ['yes'] },
    });
    await api('POST', `/api/admin/logbooks/${String(lb.id)}/fields`, {
      kind: 'location',
      label: 'Where?',
      key: 'where',
      settings: { scope: 'world' },
      filterable: true,
    });

    expect((await api('GET', `/api/logbooks/${lb.slug}`)).status).toBe(404);
    const open = await api<{ logbooks: { slug: string }[] }>('GET', '/api/logbooks');
    expect(open.body.logbooks.map((l) => l.slug)).not.toContain(lb.slug);
  });

  it('refuses a bad question with a sentence, in the one error shape', async () => {
    const bad = await api<ErrorBody>('POST', `/api/admin/logbooks/${String(lb.id)}/fields`, {
      kind: 'short_text',
      label: 'Never asked',
      shown_when: { field: 'hurt', in: ['maybe'] },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('shown-when-unknown-value');
    expect(bad.body.error.message).toMatch(/could never be asked/);

    const setting = await api<ErrorBody>('POST', `/api/admin/logbooks/${String(lb.id)}/fields`, {
      kind: 'date',
      label: 'When',
      settings: { colour: 'red' },
    });
    // An unknown setting is refused by the contract before the module sees it.
    expect(setting.status).toBe(400);
  });

  it('launches, after which the public form is served and a rewording is a 409 with a reason', async () => {
    const launched = await api<Detail>('POST', `/api/admin/logbooks/${String(lb.id)}/launch`);
    expect(launched.status).toBe(200);
    expect(launched.body.state).toBe('open');

    const form = await api<{
      accepting: boolean;
      fields: {
        key: string;
        shown_when?: unknown;
        help?: unknown;
        places?: { countries: unknown[] };
      }[];
      filters: { key: string }[];
    }>('GET', `/api/logbooks/${lb.slug}`);
    expect(form.status).toBe(200);
    expect(form.body.accepting).toBe(true);
    const [hurt, how, where] = form.body.fields;
    expect(hurt && 'shown_when' in hurt).toBe(false);
    expect(hurt && 'help' in hurt).toBe(false);
    expect(how?.shown_when).toEqual({ field: 'hurt', in: ['yes'] });
    expect(where?.places?.countries.length).toBeGreaterThan(100);
    expect(form.body.filters.map((f) => f.key)).toEqual(['where']);

    const first = launched.body.fields[0];
    if (!first) throw new Error('no fields');
    // Rewording is allowed after launch (ruling 48); what a question asks is not.
    const reword = await api<ErrorBody>(
      'PATCH',
      `/api/admin/logbooks/${String(lb.id)}/fields/${String(first.id)}`,
      { label: 'Reworded' },
    );
    expect(reword.status).toBe(200);
    const promote = await api<ErrorBody>(
      'PATCH',
      `/api/admin/logbooks/${String(lb.id)}/fields/${String(first.id)}`,
      { required: true },
    );
    expect(promote.status).toBe(409);
    expect(promote.body.error.code).toBe('launched');
    expect(promote.body.error.message).toMatch(/questions are fixed/);

    const del = await api<ErrorBody>('DELETE', `/api/admin/logbooks/${String(lb.id)}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('launched-not-deletable');

    const optional = await api('POST', `/api/admin/logbooks/${String(lb.id)}/fields`, {
      kind: 'long_text',
      label: 'Anything else?',
    });
    expect(optional.status).toBe(200);
  });

  it('serves the same questions the chain reads, so a form and a seal agree', async () => {
    const viaModule = L.toDefinitions(await L.fieldsFor(db, lb.id));
    expect(viaModule).toEqual(await questionsFor(db, lb.id));
  });

  it('closes and reopens', async () => {
    const closed = await api<Detail>('POST', `/api/admin/logbooks/${String(lb.id)}/closed`, {
      closed: true,
    });
    expect(closed.body.state).toBe('closed');
    const board = await api<{ logbooks: { slug: string }[] }>(
      'GET',
      '/api/logbooks?include=closed',
    );
    expect(board.body.logbooks.map((l) => l.slug)).toContain(lb.slug);
    const reopened = await api<Detail>('POST', `/api/admin/logbooks/${String(lb.id)}/closed`, {
      closed: false,
    });
    expect(reopened.body.state).toBe('open');
  });

  it('downloads as a file that uploads again as a new draft', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/admin/logbooks/${String(lb.id)}/file`,
      cookies: { session_token: session },
    });
    expect(res.headers['content-disposition']).toContain(`logbook-${lb.slug}.json`);
    const file = res.json<{ questions: { key?: string; scope?: string }[] }>();
    expect(file.questions.find((q) => q.key === 'where')?.scope).toBe('world');

    const copy = await api<Detail>('POST', '/api/admin/logbooks/from-file', { file });
    expect(copy.status).toBe(200);
    expect(copy.body.state).toBe('draft');
    expect(copy.body.slug).not.toBe(lb.slug);
    expect(copy.body.fields.map((f) => f.key)).toEqual(['hurt', 'how', 'where', 'anything_else']);
  });

  it('says everything wrong with a bad file, in sentences', async () => {
    const bad = await api<ErrorBody>('POST', '/api/admin/logbooks/from-file', {
      file: { reportlog_logbook: 99, title: '', questions: [{ kind: 'nonsense', label: 'x' }] },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('bad-file');
    expect(bad.body.error.message).toMatch(/version 1.*title.*unknown kind/s);
  });
});

describe('drafts', () => {
  it('reorders, removes and deletes', async () => {
    const made = await api<Detail>('POST', '/api/admin/logbooks', {
      title: 'Draft ops',
      slug: uniqueSlug('ops'),
    });
    const id = String(made.body.id);
    for (const label of ['One', 'Two', 'Three']) {
      await api('POST', `/api/admin/logbooks/${id}/fields`, { kind: 'short_text', label });
    }
    const before = (await api<Detail>('GET', `/api/admin/logbooks/${id}`)).body.fields;
    const reversed = before.map((f) => f.id).reverse();
    expect(
      (await api('PUT', `/api/admin/logbooks/${id}/fields/order`, { ids: reversed })).status,
    ).toBe(200);
    const after = (await api<Detail>('GET', `/api/admin/logbooks/${id}`)).body.fields;
    expect(after.map((f) => f.key)).toEqual(['three', 'two', 'one']);

    const partial = await api<ErrorBody>('PUT', `/api/admin/logbooks/${id}/fields/order`, {
      ids: reversed.slice(1),
    });
    expect(partial.body.error.code).toBe('order');

    const [gone] = after;
    if (!gone) throw new Error('no fields');
    expect(
      (await api('DELETE', `/api/admin/logbooks/${id}/fields/${String(gone.id)}`)).status,
    ).toBe(200);
    expect((await api('DELETE', `/api/admin/logbooks/${id}`)).body).toEqual({
      deleted: made.body.slug,
    });
    expect((await api<ErrorBody>('GET', `/api/admin/logbooks/${id}`)).status).toBe(404);
  });

  it('starts one from a starting point', async () => {
    const points = await api<{ starting_points: { id: string; questions: number }[] }>(
      'GET',
      '/api/admin/logbooks/starting-points',
    );
    const [point] = points.body.starting_points;
    if (!point) throw new Error('no starting points');
    const made = await api<Detail>('POST', '/api/admin/logbooks', {
      title: '',
      starting_point: point.id,
    });
    expect(made.status).toBe(200);
    expect(made.body.fields).toHaveLength(point.questions);
  });
});

describe('the front page', () => {
  it('serves its buttons publicly, and its arrangement to staff', async () => {
    const pub = await api<{ buttons: { accent: boolean }[] }>('GET', '/api/home-buttons');
    expect(pub.status).toBe(200);
    expect(pub.body.buttons[0]?.accent).toBe(true);

    const set = await api<{ stored: unknown }>('PUT', '/api/admin/home-buttons', {
      order: [{ kind: 'builtin', ref: 'board' }],
    });
    expect(set.body.stored).toEqual([{ kind: 'builtin', ref: 'board' }]);
    const refused = await api<ErrorBody>('PUT', '/api/admin/home-buttons', {
      order: [{ kind: 'builtin', ref: 'board', label: 'Ours' }],
    });
    expect(refused.body.error.code).toBe('builtin-label');
    const cleared = await api<{ stored: unknown }>('DELETE', '/api/admin/home-buttons');
    expect(cleared.body.stored).toBeNull();
  });
});
