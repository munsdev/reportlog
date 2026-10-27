/**
 * The file freeze (workstream B2), against a real database and the real
 * application with files turned on. Port of the freeze half of legacy
 * migration 032 and `setFilesFrozen`, which legacy never tested on its own.
 *
 * What must hold:
 *   - only an administrator pulls the handle;
 *   - it works before and after launch, both ways, and the one-way door is
 *     not touched (the trigger on logbook_fields never fires);
 *   - a frozen logbook takes no new upload slot, refused with a sentence by
 *     slots.ts and, under it, by a trigger on upload_slots;
 *   - a frozen logbook still takes a report without files;
 *   - nothing sealed changes: a report filed before the freeze verifies
 *     byte for byte the same after it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import { uploadConfig } from '../../src/files/routes.ts';
import { createUploadSlot, draftHash, newDraftToken } from '../../src/files/slots.ts';
import { HttpError } from '../../src/http/errors.ts';
import * as L from '../../src/logbooks/logbooks.ts';
import { filesHarness } from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { spine, tokenFor } from './filing-helpers.ts';
import { launchedLogbook, uniqueSlug } from './helpers.ts';
import { addStoredQuestion } from '../support/stored-questions.ts';
import { address, seat, signIn } from './identity-helpers.ts';
import { doorPass } from '../door-pass.ts';

const WHAT = { key: 'what', kind: 'long_text', label: 'What happened', required: true };
const QS = [WHAT, { key: 'photos', kind: 'file', label: 'Photos' }];

let h: FilesHarness;
let admin: string;
let lb: { id: number; slug: string };

beforeAll(async () => {
  h = await filesHarness();
  const email = address('freeze-admin');
  await seat(h.db, email, 'admin');
  admin = await signIn(h, email);
  lb = await launchedLogbook(h.db, QS);
});
afterAll(async () => {
  await h.close();
});

interface Detail {
  id: number;
  files_frozen_at: string | null;
  asks_for_files: boolean;
  fields: unknown[];
}

const freeze = (id: number, frozen: boolean, as: string | null = admin) =>
  h.app.inject({
    method: 'POST',
    url: `/api/admin/logbooks/${String(id)}/files/freeze`,
    payload: { frozen },
    ...(as ? { cookies: { session_token: as } } : {}),
  });

const slot = (logbookId: number) =>
  createUploadSlot(
    h.files,
    { draft: draftHash(newDraftToken()) },
    { name: 'a.jpg', type: 'image/jpeg', size: 1024, logbookId, email: 'someone@example.org' },
  );

async function refusal(p: Promise<unknown>): Promise<HttpError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('who can pull the handle', () => {
  it('refuses somebody signed out, and a moderator', async () => {
    const moderator = address('freeze-moderator');
    await seat(h.db, moderator, 'moderator');
    expect((await freeze(lb.id, true, null)).statusCode).toBe(401);
    expect((await freeze(lb.id, true, await signIn(h, moderator))).statusCode).toBe(403);
    expect((await L.logbookById(h.db, lb.id))?.files_frozen_at).toBeNull();
  });

  it('says so for a logbook that does not exist', async () => {
    const res = await freeze(999_999_999, true);
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { message: string } }>().error.message).toBe(
      'There is no such logbook.',
    );
  });
});

describe('the freeze on a launched logbook', () => {
  it('stamps the time, keeps the first time when pressed again, and clears both ways', async () => {
    const own = await launchedLogbook(h.db, QS);
    const first = await freeze(own.id, true);
    expect(first.statusCode).toBe(200);
    const at = first.json<Detail>().files_frozen_at;
    expect(at).not.toBeNull();
    // The questions are untouched: still asking for files, same count.
    expect(first.json<Detail>()).toMatchObject({ asks_for_files: true });
    expect(first.json<Detail>().fields).toHaveLength(2);

    const again = await freeze(own.id, true);
    expect(again.json<Detail>().files_frozen_at).toBe(at);

    const off = await freeze(own.id, false);
    expect(off.statusCode).toBe(200);
    expect(off.json<Detail>().files_frozen_at).toBeNull();
  });

  it('takes no new upload slot, and says why in a sentence', async () => {
    const own = await launchedLogbook(h.db, QS);
    await L.setFilesFrozen(h.db, own.id, true);
    const e = await refusal(slot(own.id));
    expect(e.status).toBe(409);
    expect(e.code).toBe('files_frozen');
    expect(e.message).toMatch(/not taking files at the moment.*without them/);

    // Over HTTP too, through the route a reporter's browser calls.
    const draft = (await h.app.inject({ method: 'POST', url: '/api/uploads/draft' })).json<{
      draft_token: string;
    }>().draft_token;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/uploads',
      payload: {
        draft_token: draft,
        logbook: own.slug,
        email: 'someone@example.org',
        name: 'a.jpg',
        type: 'image/jpeg',
        size: 10,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('files_frozen');

    // Unfrozen, the same request is taken.
    await L.setFilesFrozen(h.db, own.id, false);
    await expect(slot(own.id)).resolves.toHaveProperty('slot_token');
  });

  it('offers no upload card while frozen, so the form skips the files step', async () => {
    const own = await launchedLogbook(h.db, QS);
    expect((await uploadConfig(h.files, own.id, true)).enabled).toBe(true);
    await L.setFilesFrozen(h.db, own.id, true);
    expect((await uploadConfig(h.files, own.id, true)).enabled).toBe(false);
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/uploads/config?logbook=${own.slug}`,
    });
    expect(res.json()).toMatchObject({ enabled: false });
  });

  it('is refused by the database too, if a path forgets to ask', async () => {
    const own = await launchedLogbook(h.db, QS);
    await L.setFilesFrozen(h.db, own.id, true);
    await expect(
      h.db
        .insertInto('upload_slots')
        .values({
          slot_token: 'a'.repeat(48),
          draft_hash: 'b'.repeat(64),
          logbook_id: own.id,
          declared_type: 'image/jpeg',
          declared_size: 10,
          staging_key: `freeze-test-${uniqueSlug()}`,
          dek_wrapped: Buffer.alloc(40),
          expires_at: new Date(Date.now() + 60_000),
        })
        .execute(),
    ).rejects.toThrow(/uploads to this logbook are frozen/);
  });

  it('still takes a report without files', async () => {
    const own = await launchedLogbook(h.db, QS);
    await L.setFilesFrozen(h.db, own.id, true);
    const email = address('frozen-reporter');
    const sent = await h.app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        ...(await doorPass(h.app)),
        ...spine(email),
        logbook: own.slug,
        answers: { what: 'The queue was turned away' },
      },
    });
    expect(sent.statusCode).toBe(200);
    const token = tokenFor(h.mailer, email) ?? '';
    const done = await h.app.inject({ method: 'POST', url: `/api/reports/confirm/${token}` });
    const ref = done.json<{ confirmation: { public_ref?: string } }>().confirmation.public_ref;
    expect(ref).toMatch(/^RL-/);
  });

  it('changes nothing sealed: a report filed before verifies the same after', async () => {
    const own = await launchedLogbook(h.db, QS);
    const email = address('before-freeze');
    await h.app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        ...(await doorPass(h.app)),
        ...spine(email),
        logbook: own.slug,
        answers: { what: 'Filed before the freeze' },
      },
    });
    const done = await h.app.inject({
      method: 'POST',
      url: `/api/reports/confirm/${tokenFor(h.mailer, email) ?? ''}`,
    });
    const ref = done.json<{ confirmation: { public_ref: string } }>().confirmation.public_ref;
    const before = await verifyReport(h.db, ref);
    expect(before?.content.ok && before.link.ok && before.position.ok).toBe(true);

    await L.setFilesFrozen(h.db, own.id, true);
    const after = await verifyReport(h.db, ref);
    expect(after?.canonical_json).toBe(before?.canonical_json);
    expect(after?.content.ok && after.link.ok && after.position.ok).toBe(true);
    expect(Object.keys(after?.hashed_fields ?? {}).some((k) => /frozen|freeze/i.test(k))).toBe(
      false,
    );
  });
});

describe('the freeze and the one-way door', () => {
  it('works on a draft, and launching a frozen draft keeps it frozen', async () => {
    const draft = await L.createLogbook(h.db, { title: 'Frozen draft', slug: uniqueSlug('fz') });
    await addStoredQuestion(h.db, draft.id, { kind: 'long_text', label: 'What happened', required: true });
    await addStoredQuestion(h.db, draft.id, { kind: 'file', label: 'Photos' });
    const frozen = await freeze(draft.id, true);
    expect(frozen.statusCode).toBe(200);
    await L.launch(h.db, draft.id);
    const launched = await L.logbookById(h.db, draft.id);
    expect(launched?.state).toBe('open');
    expect(launched?.files_frozen_at).not.toBeNull();
  });

  it('leaves the questions of a launched logbook exactly as they were', async () => {
    const own = await launchedLogbook(h.db, QS);
    const before = await L.fieldsFor(h.db, own.id);
    await L.setFilesFrozen(h.db, own.id, true);
    await L.setFilesFrozen(h.db, own.id, false);
    expect(await L.fieldsFor(h.db, own.id)).toEqual(before);
    // And the door itself still holds: a question cannot be removed after launch.
    const [first] = before;
    await expect(
      h.db
        .deleteFrom('logbook_fields')
        .where('id', '=', first?.id ?? 0)
        .execute(),
    ).rejects.toThrow(/never removed/);
  });
});
