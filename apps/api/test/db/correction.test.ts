/**
 * "My reports": correcting, withdrawing and erasing, signed in as the person
 * who filed. And a correction keeping the files, with both versions still
 * verifying.
 *
 * Ported from the My Reports half of legacy/scripts/confirm-selftest.mjs and
 * from legacy/scripts/correction-selftest.mjs.
 *
 * THE BUG correction-selftest EXISTS FOR: a correction mints a new version,
 * and the old code joined files against the head only, so the new version's
 * manifest came back empty, its sealed object had no `attachments` key, and
 * it VERIFIED CLEANLY. A reporter fixing a typo lost their video. The
 * attachment rows here are written by hand, the way the files workstream
 * will write them, because what is under test is what a correction does to
 * files the archive already holds.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manifestFor } from '../../src/chain/record.ts';
import { verifyReport } from '../../src/chain/verify.ts';
import { openContact } from '../../src/filing/contactKeys.ts';
import { launchedLogbook } from './helpers.ts';
import { RING, fileThroughRoutes, filingHarness, send, spine, threadOf } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { address, as, signIn } from './identity-helpers.ts';

let h: FilingHarness;
let lb: { id: number; slug: string };
const QS = [{ key: 'what', kind: 'short_text', label: 'What happened?', required: true }];

beforeAll(async () => {
  h = await filingHarness();
  lb = await launchedLogbook(h.db, QS);
});
afterAll(async () => {
  await h.close();
});

const verifies = (v: Awaited<ReturnType<typeof verifyReport>>) =>
  v?.content.ok === true && v.link.ok && v.position.ok;

interface Caller {
  get: (path: string) => Promise<{ status: number; body: Record<string, unknown> }>;
  post: (
    path: string,
    body?: unknown,
  ) => Promise<{ status: number; body: Record<string, unknown> }>;
}
async function signedInAs(email: string): Promise<Caller> {
  const call = as(h, await signIn(h, email));
  return {
    get: async (url) => {
      const r = await call({ method: 'GET', url });
      return { status: r.statusCode, body: r.json() };
    },
    post: async (url, body = {}) => {
      const r = await call({ method: 'POST', url, payload: body as Record<string, unknown> });
      return { status: r.statusCode, body: r.json() };
    },
  };
}

describe('My reports, on a report filed through a logbook', () => {
  const email = address('mine');
  let ref: string;
  let thread: string;
  let me: Caller;

  beforeAll(async () => {
    ref = await fileThroughRoutes(h, lb.slug, { what: 'The first telling' }, email);
    thread = await threadOf(h.db, ref);
    me = await signedInAs(email);
  });

  it('needs somebody signed in', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/api/mine/reports' });
    expect(r.statusCode).toBe(401);
  });

  it('lists the report under the address it was filed from, with its logbook and answers', async () => {
    const list = await me.get('/api/mine/reports');
    const mine = (list.body.reports as Record<string, unknown>[]).find(
      (r) => r.thread_id === thread,
    );
    expect(mine).toMatchObject({
      logbook_slug: lb.slug,
      public_ref: ref,
      answers: { what: 'The first telling' },
      versions: 1,
      permissions: {
        contact_passing: false,
        attachment_publication: false,
        evidence_request: false,
      },
    });
  });

  it('finds it whatever case the address is signed in with', async () => {
    const shouty = await signedInAs(email.toUpperCase());
    const list = await shouty.get('/api/mine/reports');
    expect((list.body.reports as unknown[]).length).toBe(1);
  });

  it('is nobody else’s', async () => {
    const other = await signedInAs(address('other'));
    expect(((await other.get('/api/mine/reports')).body.reports as unknown[]).length).toBe(0);
    expect((await other.get(`/api/mine/reports/${thread}`)).status).toBe(404);
    const r = await other.post(`/api/mine/reports/${thread}/correct`, {
      answers: { what: 'Not mine' },
      comment: 'x',
    });
    expect(r.status).toBe(404);
  });

  it('a correction re-answers the logbook and is a new version in the SAME chain', async () => {
    const r = await me.post(`/api/mine/reports/${thread}/correct`, {
      answers: { what: 'Told again' },
      comment: 'I got a detail wrong',
    });
    expect(r.status).toBe(200);
    const v = await verifyReport(h.db, String(r.body.public_ref));
    expect(verifies(v)).toBe(true);
    expect(v?.chain.logbook).toBe(lb.slug);
    expect(v?.hashed_fields.answers).toEqual({ what: 'Told again' });
    expect(v?.hashed_fields.corrects_id).not.toBeNull();
    expect(v?.hashed_fields.thread_id).toBe(thread);
    expect(String(v?.hashed_fields.logbook_form)).toMatch(/^[a-f0-9]{64}$/);
    // The version it corrects is untouched and still verifies.
    expect(verifies(await verifyReport(h.db, ref))).toBe(true);
    const detail = await me.get(`/api/mine/reports/${thread}`);
    expect(detail.body).toMatchObject({ versions: 2, moderation_status: 'pending' });
    expect(detail.body.actions).toEqual([
      expect.objectContaining({ action: 'correct', comment: 'I got a detail wrong' }),
    ]);
  });

  it('sends a correction back for review, even after approval', async () => {
    await h.db
      .updateTable('report_heads')
      .set({ moderation_status: 'valid' })
      .where('thread_id', '=', thread)
      .execute();
    await me.post(`/api/mine/reports/${thread}/correct`, {
      answers: { what: 'Again' },
      comment: 'x',
    });
    const head = await h.db
      .selectFrom('report_heads')
      .select('moderation_status')
      .where('thread_id', '=', thread)
      .executeTakeFirstOrThrow();
    expect(head.moderation_status).toBe('pending');
  });

  it('refuses a correction missing a required answer, or a reason', async () => {
    expect(
      (await me.post(`/api/mine/reports/${thread}/correct`, { answers: {}, comment: 'x' })).status,
    ).toBe(400);
    expect(
      (await me.post(`/api/mine/reports/${thread}/correct`, { answers: { what: 'y' } })).status,
    ).toBe(400);
  });

  it('can take back permission to publish, but never give it back', async () => {
    const r = await me.post(`/api/mine/reports/${thread}/correct`, {
      answers: { what: 'Private now' },
      comment: 'keep it out',
      may_publish: false,
    });
    expect(r.status).toBe(200);
    expect((await verifyReport(h.db, String(r.body.public_ref)))?.hashed_fields.may_publish).toBe(
      false,
    );
    const back = await me.post(`/api/mine/reports/${thread}/correct`, {
      answers: { what: 'Public again?' },
      comment: 'x',
      may_publish: true,
    });
    expect(back.status).toBe(400);
    // Saying nothing carries the current answer forward.
    const quiet = await me.post(`/api/mine/reports/${thread}/correct`, {
      answers: { what: 'Quietly' },
      comment: 'x',
    });
    expect(
      (await verifyReport(h.db, String(quiet.body.public_ref)))?.hashed_fields.may_publish,
    ).toBe(false);
  });

  it('withdrawing needs a reason and takes it off the board', async () => {
    expect((await me.post(`/api/mine/reports/${thread}/withdraw`, {})).status).toBe(400);
    expect(
      (await me.post(`/api/mine/reports/${thread}/withdraw`, { comment: 'Changed my mind' }))
        .status,
    ).toBe(200);
    expect((await me.get(`/api/mine/reports/${thread}`)).body.withdrawn).toBe(true);
  });

  it('ERASING destroys the key: gone from My reports, details unreadable, report still verifying', async () => {
    expect((await me.post(`/api/mine/reports/${thread}/erase`, {})).status).toBe(400);
    expect((await me.post(`/api/mine/reports/${thread}/erase`, { confirm: true })).status).toBe(
      200,
    );
    const list = await me.get('/api/mine/reports');
    expect((list.body.reports as { thread_id: string }[]).some((r) => r.thread_id === thread)).toBe(
      false,
    );
    expect(await openContact(h.db, RING, thread)).toMatchObject({ erased: true, email: null });
    expect(verifies(await verifyReport(h.db, ref))).toBe(true);
    // The ciphertext was never touched: the table refuses to let anyone.
    await expect(
      h.db.deleteFrom('report_contacts').where('thread_id', '=', thread).execute(),
    ).rejects.toThrow(/append-only/);
    // And no confirmation-link row still points at the thread.
    const links = await h.db
      .selectFrom('report_submissions')
      .select('id')
      .where('thread_id', '=', thread)
      .execute();
    expect(links).toHaveLength(0);
    // What the reporter did is on record, with no address in it.
    const actions = await h.db
      .selectFrom('reporter_actions')
      .selectAll()
      .where('thread_id', '=', thread)
      .execute();
    expect(actions.map((a) => a.action)).toContain('erase');
    expect(JSON.stringify(actions)).not.toContain(email);
  });

  it('a contact key is never swapped, only destroyed', async () => {
    const other = await fileThroughRoutes(h, lb.slug, { what: 'Another' }, address('swap'));
    const t = await threadOf(h.db, other);
    await expect(
      h.db
        .updateTable('contact_keys')
        .set({ email_hmac: null })
        .where('thread_id', '=', t)
        .execute(),
    ).rejects.toThrow(/never changed/);
  });
});

describe('a correction keeps the files', () => {
  const email = address('files');
  let thread: string;
  let firstId: number;
  let me: Caller;

  /** One file, inserted the way the files workstream will, linked to the version. */
  async function attach(reportId: number, ordinal: number, name: string) {
    const a = await h.db
      .insertInto('attachments')
      .values({
        thread_id: thread,
        report_id: reportId,
        ordinal,
        media_type: 'image/jpeg',
        byte_size: 1234 + ordinal,
        sha256: createHash('sha256').update(name).digest('hex'),
        storage_key: `evidence/${name}`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('report_attachments')
      .values({ report_id: reportId, attachment_id: a.id })
      .execute();
    return a.id;
  }

  beforeAll(async () => {
    // Filed through the routes, then two files linked to that version. The
    // first version's own seal has no manifest (it was filed without one);
    // what matters is what the CORRECTION commits to.
    const ref = await fileThroughRoutes(
      h,
      lb.slug,
      { what: 'A queue nobody could stand in.' },
      email,
    );
    thread = await threadOf(h.db, ref);
    const row = await h.db
      .selectFrom('reports')
      .select('id')
      .where('public_ref', '=', ref)
      .executeTakeFirstOrThrow();
    firstId = row.id;
    await attach(firstId, 1, 'one.jpg');
    await attach(firstId, 2, 'two.jpg');
    me = await signedInAs(email);
  });

  it('THE CORRECTION HOLDS BOTH FILES, byte for byte, and verifies with them sealed', async () => {
    const r = await me.post(`/api/mine/reports/${thread}/correct`, {
      answers: { what: 'A queue nobody could stand in. It was two hours.' },
      comment: 'How long',
    });
    expect(r.status).toBe(200);
    const second = await h.db
      .selectFrom('reports')
      .select('id')
      .where('public_ref', '=', String(r.body.public_ref))
      .executeTakeFirstOrThrow();
    const m1 = await manifestFor(h.db, firstId);
    const m2 = await manifestFor(h.db, second.id);
    expect(m2).toHaveLength(2);
    expect(JSON.stringify(m2)).toBe(JSON.stringify(m1));
    const v = await verifyReport(h.db, String(r.body.public_ref));
    expect(verifies(v)).toBe(true);
    expect(v?.hashed_fields).toHaveProperty('attachments');
    // One file, linked from both versions: erasing it later reaches every version.
    const links = await h.db
      .selectFrom('report_attachments')
      .select('report_id')
      .where('report_id', 'in', [firstId, second.id])
      .execute();
    expect(links).toHaveLength(4);
  });

  it('a correction of a report with no files writes no attachments key at all', async () => {
    const bareEmail = address('bare');
    const ref = await fileThroughRoutes(h, lb.slug, { what: 'No files here.' }, bareEmail);
    const t = await threadOf(h.db, ref);
    const bare = await signedInAs(bareEmail);
    const r = await bare.post(`/api/mine/reports/${t}/correct`, {
      answers: { what: 'No files here either.' },
      comment: 'x',
    });
    const v = await verifyReport(h.db, String(r.body.public_ref));
    expect(verifies(v)).toBe(true);
    expect(v?.hashed_fields).not.toHaveProperty('attachments');
  });
});

describe('a correction is allowed while the site takes no new reports', () => {
  it('because it amends a record the archive already holds', async () => {
    const email = address('switch');
    const ref = await fileThroughRoutes(h, lb.slug, { what: 'Before closing' }, email);
    const t = await threadOf(h.db, ref);
    await h.db
      .insertInto('intake_settings')
      .values({ id: true, intake_enabled: false })
      .onConflict((oc) => oc.column('id').doUpdateSet({ intake_enabled: false }))
      .execute();
    try {
      const me = await signedInAs(email);
      const r = await me.post(`/api/mine/reports/${t}/correct`, {
        answers: { what: 'After' },
        comment: 'x',
      });
      expect(r.status).toBe(200);
      // While a new report is refused.
      const fresh = await send(h, {
        ...spine(address('fresh')),
        logbook: lb.slug,
        answers: { what: 'x' },
      });
      expect(fresh.status).toBe(503);
    } finally {
      await h.db.updateTable('intake_settings').set({ intake_enabled: null }).execute();
    }
  });
});
