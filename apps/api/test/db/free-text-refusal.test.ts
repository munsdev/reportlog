/**
 * Free text on a logbook is an attached note (FT-N1). `addField` and the admin
 * route refuse the plain typed kinds with one sentence; the attached kinds and a
 * closed-list place are accepted; a question stored before the rule still reads
 * and can be reworded. The stored one is written by SQL, because there is no
 * way to create it any more, which is the point.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as L from '../../src/logbooks/logbooks.ts';
import { LogbookRefusal } from '../../src/logbooks/refusals.ts';
import { uniqueSlug } from './helpers.ts';
import { address, harness, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';
import { addStoredQuestion } from '../support/stored-questions.ts';

const SENTENCE =
  'Free text on a logbook is an attached note that is never published. Use an attached note or link.';

const REFUSED = [
  { kind: 'short_text' },
  { kind: 'long_text' },
  { kind: 'url' },
  { kind: 'email' },
  { kind: 'place', settings: { options: ['Hall'], allowOther: true } },
  { kind: 'place', settings: { options: [] } },
] as const;

let h: Harness;
let session: string;
let lb: { id: number };
beforeAll(async () => {
  h = await harness();
  const email = address('free-text-admin');
  await seat(h.db, email, 'admin');
  session = await signIn(h, email);
  lb = await L.createLogbook(h.db, { title: 'Free text', slug: uniqueSlug('ft') });
});
afterAll(async () => {
  await h.close();
});

const post = (payload: object) =>
  h.app.inject({
    method: 'POST',
    url: `/api/admin/logbooks/${String(lb.id)}/fields`,
    payload,
    cookies: { session_token: session },
  });

describe('a logbook refuses published free text', () => {
  it.each(REFUSED)('refuses $kind through addField', async (spec) => {
    const err = await L.addField(h.db, lb.id, { ...spec, label: 'Typed' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LogbookRefusal);
    expect((err as LogbookRefusal).code).toBe('free-text');
    expect((err as Error).message).toBe(SENTENCE);
  });

  it.each(REFUSED)('refuses $kind through the admin route', async (spec) => {
    const res = await post({ ...spec, label: 'Typed' });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('free-text');
    expect(body.error.message).toBe(SENTENCE);
  });

  it('accepts an attached note, an attached link and a closed-list place', async () => {
    for (const spec of [
      { kind: 'private_text', label: 'Note' },
      { kind: 'private_link', label: 'Link' },
      {
        kind: 'place',
        label: 'Where',
        settings: { options: ['Hall', 'Depot'], allowOther: false },
      },
    ] as const) {
      const res = await post(spec);
      expect(res.statusCode, res.body).toBe(200);
    }
  });

  it('still reads a stored typed question, and lets it be reworded', async () => {
    const stored = await addStoredQuestion(h.db, lb.id, { kind: 'short_text', label: 'Old' });
    expect((await L.fieldsFor(h.db, lb.id)).some((f) => f.id === stored.id)).toBe(true);
    const changed = await L.updateField(h.db, lb.id, stored.id, { label: 'Reworded' });
    expect(changed.label).toBe('Reworded');
  });
});
