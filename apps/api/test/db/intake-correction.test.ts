/**
 * Correcting a report a coordinator filed, as the coordinator's own act.
 *
 * The design is in docs/status/C2-filing.md. What these hold it to: a new
 * version in the same thread and chain, back to pending, carrying the files;
 * the organization's name and a fresh attestation inside the seal; the
 * coordinator outside it, recorded in their own log and never in the
 * reporter's; never loosening the publication answer; only the coordinator
 * who filed it, and only while they still file for the organization.
 */
import { cardFor } from '@reportlog/seal';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manifestFor } from '../../src/chain/record.ts';
import { verifyReport } from '../../src/chain/verify.ts';
import { launchedLogbook } from './helpers.ts';
import { fileThroughRoutes, filingHarness, threadOf } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';

let h: FilingHarness;
let lb: { id: number; slug: string };
let orgId: number;
const ORG = `Field Notes Collective ${String(process.pid)}-${String(Date.now() % 1e6)}`;
const COORD = address('fixer');
const CARD = cardFor('coordinator').digest;
let coord: ReturnType<typeof as>;
let coordId: number;

type Who = ReturnType<typeof as>;
const call = async (
  who: Who,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  body?: Record<string, unknown>,
) => {
  const r = await who({ method, url, ...(body ? { payload: body } : {}) });
  return { status: r.statusCode, body: r.json<Record<string, unknown>>() };
};

/** Stage and file one account; returns its thread and first reference. */
async function fileOne(
  who: Who,
  entry: Record<string, unknown>,
): Promise<{ thread: string; ref: string }> {
  const made = await call(who, 'POST', '/api/intake/batches', { organization_id: orgId });
  const batch = String(made.body.id);
  await call(who, 'POST', `/api/intake/batches/${batch}/drafts`, {
    logbook: lb.slug,
    intake_method: 'paper',
    may_publish: true,
    may_publish_digest: CARD,
    ...entry,
  });
  const out = await call(who, 'POST', `/api/intake/batches/${batch}/submit`, { attested: true });
  const ref = (out.body.filed as { public_ref: string }[])[0]?.public_ref ?? '';
  if (!ref) throw new Error(`filing failed: ${JSON.stringify(out.body)}`);
  return { thread: await threadOf(h.db, ref), ref };
}

const verifies = (v: Awaited<ReturnType<typeof verifyReport>>) =>
  Boolean(v?.content.ok && v.link.ok && v.position.ok);

beforeAll(async () => {
  h = await filingHarness();
  lb = await launchedLogbook(h.db, [
    { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
  ]);
  coordId = await seat(h.db, COORD, 'user');
  const org = await h.db
    .insertInto('organizations')
    .values({ name: ORG, verified_by: 'admin@example.org' })
    .returning('id')
    .executeTakeFirstOrThrow();
  orgId = org.id;
  await h.db
    .insertInto('organization_memberships')
    .values({ organization_id: orgId, user_id: coordId, role: 'coordinator' })
    .execute();
  coord = as(h, await signIn(h, COORD));
});
afterAll(async () => {
  await h.db.updateTable('intake_settings').set({ intake_enabled: null }).execute();
  await h.close();
});

describe('a coordinator corrects an account they filed', () => {
  let thread: string;
  let firstRef: string;
  let firstId: number;
  let secondRef: string;

  beforeAll(async () => {
    ({ thread, ref: firstRef } = await fileOne(coord, {
      answers: { what: 'Turned away at nine.' },
      collected_on: '2026-11-03',
      source_ref: 'clipboard 4',
    }));
    firstId = (
      await h.db
        .selectFrom('reports')
        .select('id')
        .where('public_ref', '=', firstRef)
        .executeTakeFirstOrThrow()
    ).id;
    // A file on the first version, inserted the way the files workstream will.
    const a = await h.db
      .insertInto('attachments')
      .values({
        thread_id: thread,
        report_id: firstId,
        ordinal: 1,
        media_type: 'image/jpeg',
        byte_size: 999,
        sha256: createHash('sha256').update('sheet.jpg').digest('hex'),
        storage_key: 'evidence/sheet.jpg',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('report_attachments')
      .values({ report_id: firstId, attachment_id: a.id })
      .execute();
  });

  it('shows the coordinator what it says now and what a correction is asked', async () => {
    const r = await call(coord, 'GET', `/api/intake/reports/${thread}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      thread_id: thread,
      public_ref: firstRef,
      logbook_slug: lb.slug,
      filed_via: ORG,
      intake_method: 'paper',
      collected_on: '2026-11-03',
      may_publish: true,
      answers: { what: 'Turned away at nine.' },
      versions: 1,
    });
    expect((r.body.questions as { key: string }[]).map((q) => q.key)).toEqual(['what']);
    expect(r.body.history).toEqual([
      expect.objectContaining({ action: 'filed', public_ref: firstRef, by: COORD }),
    ]);
  });

  it('refuses without a reason, and without the attestation', async () => {
    const url = `/api/intake/reports/${thread}/correct`;
    const noReason = await call(coord, 'POST', url, {
      answers: { what: 'x' },
      attested: true,
    });
    expect(noReason.status).toBe(400);
    expect(JSON.stringify(noReason.body)).toMatch(/why/i);
    const noAttest = await call(coord, 'POST', url, { answers: { what: 'x' }, comment: 'typo' });
    expect(noAttest.status).toBe(400);
    expect((noAttest.body.error as { code: string }).code).toBe('not_attested');
  });

  it('refuses answers the logbook would refuse', async () => {
    const r = await call(coord, 'POST', `/api/intake/reports/${thread}/correct`, {
      answers: {},
      comment: 'emptied it',
      attested: true,
    });
    expect(r.status).toBe(400);
  });

  it('files a new version in the same thread and chain, back to pending', async () => {
    await h.db
      .updateTable('report_heads')
      .set({ moderation_status: 'valid' })
      .where('thread_id', '=', thread)
      .execute();
    const r = await call(coord, 'POST', `/api/intake/reports/${thread}/correct`, {
      answers: { what: 'Turned away at about nine fifteen.' },
      comment: 'I mistyped the time.',
      collected_on: '2026-11-04',
      attested: true,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    secondRef = String(r.body.public_ref);
    expect(secondRef).not.toBe(firstRef);

    const second = await h.db
      .selectFrom('reports')
      .select(['id', 'thread_id', 'corrects_id'])
      .where('public_ref', '=', secondRef)
      .executeTakeFirstOrThrow();
    expect(second.thread_id).toBe(thread);
    expect(Number(second.corrects_id)).toBe(firstId);
    const head = await h.db
      .selectFrom('report_heads')
      .select(['current_report_id', 'moderation_status'])
      .where('thread_id', '=', thread)
      .executeTakeFirstOrThrow();
    expect(head).toEqual({ current_report_id: second.id, moderation_status: 'pending' });
    // The new version verifies with the file sealed. (The first does not, only
    // because this test linked a file to it by hand after it was sealed.)
    expect(verifies(await verifyReport(h.db, secondRef))).toBe(true);
  });

  it('seals the organization and a fresh attestation; the coordinator is outside the seal', async () => {
    const v1 = await verifyReport(h.db, firstRef);
    const v2 = await verifyReport(h.db, secondRef);
    expect(v2?.hashed_fields).toMatchObject({
      third_party: true,
      filed_via: ORG,
      intake_method: 'paper',
      collected_on: '2026-11-04',
      may_publish: true,
      may_publish_digest: CARD,
      answers: { what: 'Turned away at about nine fifteen.' },
    });
    expect(v2?.hashed_fields.attested_at).not.toBe(v1?.hashed_fields.attested_at);
    expect(v2?.canonical_json).not.toContain(COORD);
    expect(v2?.canonical_json).not.toContain('clipboard 4');
    expect(v2?.canonical_json).not.toContain('mistyped');
  });

  it('carries the files of the version it corrects', async () => {
    const id2 = (
      await h.db
        .selectFrom('reports')
        .select('id')
        .where('public_ref', '=', secondRef)
        .executeTakeFirstOrThrow()
    ).id;
    expect(JSON.stringify(await manifestFor(h.db, id2))).toBe(
      JSON.stringify(await manifestFor(h.db, firstId)),
    );
    expect((await verifyReport(h.db, secondRef))?.hashed_fields).toHaveProperty('attachments');
  });

  it('is recorded as the coordinator’s act, never as the reporter’s', async () => {
    const theirs = await h.db
      .selectFrom('coordinator_actions')
      .selectAll()
      .where('thread_id', '=', thread)
      .execute();
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({
      action: 'correct',
      coordinator_id: coordId,
      organization_id: orgId,
      comment: 'I mistyped the time.',
    });
    const reporters = await h.db
      .selectFrom('reporter_actions')
      .select('id')
      .where('thread_id', '=', thread)
      .execute();
    expect(reporters).toEqual([]);
    const perms = await h.db
      .selectFrom('report_permissions_log')
      .select('id')
      .where('thread_id', '=', thread)
      .execute();
    expect(perms).toEqual([]);
    const detail = await call(coord, 'GET', `/api/intake/reports/${thread}`);
    expect(detail.body.history).toEqual([
      expect.objectContaining({
        action: 'correct',
        public_ref: secondRef,
        by: COORD,
        comment: 'I mistyped the time.',
      }),
      expect.objectContaining({ action: 'filed', public_ref: firstRef }),
    ]);
    // And the log cannot be rewritten.
    await expect(
      h.db
        .updateTable('coordinator_actions')
        .set({ comment: 'x' })
        .where('thread_id', '=', thread)
        .execute(),
    ).rejects.toThrow();
  });

  it('is still not in anybody’s "My reports"', async () => {
    expect((await call(coord, 'GET', '/api/mine/reports')).body.reports).toEqual([]);
    expect((await call(coord, 'GET', `/api/mine/reports/${thread}`)).status).toBe(404);
  });

  it('carries the collection day forward when not given, and can say it is not known', async () => {
    const keep = await call(coord, 'POST', `/api/intake/reports/${thread}/correct`, {
      answers: { what: 'Turned away at about nine fifteen, by the door.' },
      comment: 'Where',
      attested: true,
    });
    expect(keep.status).toBe(200);
    expect(
      (await verifyReport(h.db, String(keep.body.public_ref)))?.hashed_fields.collected_on,
    ).toBe('2026-11-04');
    const unknown = await call(coord, 'POST', `/api/intake/reports/${thread}/correct`, {
      answers: { what: 'Turned away at about nine fifteen, by the door.' },
      comment: 'The day was a guess',
      collected_on: '',
      attested: true,
    });
    expect(unknown.status).toBe(200);
    const v = await verifyReport(h.db, String(unknown.body.public_ref));
    expect(verifies(v)).toBe(true);
    // THE ABSENT-KEY RULE: not known is no key, never null.
    expect(v?.hashed_fields).not.toHaveProperty('collected_on');
  });

  it('refuses a collection day that is not a day, and a method that is not one', async () => {
    const url = `/api/intake/reports/${thread}/correct`;
    const base = { answers: { what: 'x y' }, comment: 'c', attested: true };
    expect((await call(coord, 'POST', url, { ...base, collected_on: 'Tuesday' })).status).toBe(400);
    expect((await call(coord, 'POST', url, { ...base, intake_method: 'telepathy' })).status).toBe(
      400,
    );
  });

  it('may take back permission to publish, never give it', async () => {
    const url = `/api/intake/reports/${thread}/correct`;
    const out = await call(coord, 'POST', url, {
      answers: { what: 'Turned away.' },
      comment: 'The source asked me to keep it out.',
      may_publish: false,
      attested: true,
    });
    expect(out.status).toBe(200);
    expect((await verifyReport(h.db, String(out.body.public_ref)))?.hashed_fields.may_publish).toBe(
      false,
    );
    const back = await call(coord, 'POST', url, {
      answers: { what: 'Turned away.' },
      comment: 'Changed my mind again',
      may_publish: true,
      attested: true,
    });
    expect(back.status).toBe(400);
    expect((back.body.error as { code: string }).code).toBe('cannot_loosen');
  });

  it('is not stopped by the intake switch, which closes only the doors to new reports', async () => {
    await h.db
      .insertInto('intake_settings')
      .values({ id: true, intake_enabled: false })
      .onConflict((oc) => oc.column('id').doUpdateSet({ intake_enabled: false }))
      .execute();
    const r = await call(coord, 'POST', `/api/intake/reports/${thread}/correct`, {
      answers: { what: 'Turned away. Still.' },
      comment: 'While closed',
      attested: true,
    });
    expect(r.status).toBe(200);
    await h.db.updateTable('intake_settings').set({ intake_enabled: null }).execute();
  });
});

describe('who may correct it', () => {
  let thread: string;

  beforeAll(async () => {
    ({ thread } = await fileOne(coord, { answers: { what: 'Somebody else’s turn.' } }));
  });

  const attempt = (who: Who) =>
    call(who, 'POST', `/api/intake/reports/${thread}/correct`, {
      answers: { what: 'Changed by somebody else.' },
      comment: 'mine now',
      attested: true,
    });

  it('not another coordinator of the same organization', async () => {
    const other = address('fixer2');
    const uid = await seat(h.db, other, 'user');
    await h.db
      .insertInto('organization_memberships')
      .values({ organization_id: orgId, user_id: uid, role: 'manager' })
      .execute();
    const them = as(h, await signIn(h, other));
    expect((await call(them, 'GET', `/api/intake/reports/${thread}`)).status).toBe(404);
    expect((await attempt(them)).status).toBe(404);
  });

  it('not a report a reporter filed themselves', async () => {
    const ref = await fileThroughRoutes(h, lb.slug, { what: 'First hand.' }, address('own'));
    const own = await threadOf(h.db, ref);
    expect((await call(coord, 'GET', `/api/intake/reports/${own}`)).status).toBe(404);
  });

  it('not the coordinator once they have left the organization', async () => {
    const leaver = address('fixer-leaves');
    const uid = await seat(h.db, leaver, 'user');
    await h.db
      .insertInto('organization_memberships')
      .values([{ organization_id: orgId, user_id: uid, role: 'coordinator' }])
      .execute();
    const them = as(h, await signIn(h, leaver));
    const filed = await fileOne(them, { answers: { what: 'Filed before leaving.' } });
    // Another organization keeps them a coordinator, so the scope still admits them.
    const other = await h.db
      .insertInto('organizations')
      .values({ name: `${ORG} elsewhere`, verified_by: 'admin@example.org' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('organization_memberships')
      .values({ organization_id: other.id, user_id: uid, role: 'coordinator' })
      .execute();
    await h.db
      .deleteFrom('organization_memberships')
      .where('organization_id', '=', orgId)
      .where('user_id', '=', uid)
      .execute();
    const r = await call(them, 'POST', `/api/intake/reports/${filed.thread}/correct`, {
      answers: { what: 'Changed after leaving.' },
      comment: 'c',
      attested: true,
    });
    expect(r.status).toBe(403);
  });

  it('nobody signed out', async () => {
    const r = await h.app.inject({ method: 'GET', url: `/api/intake/reports/${thread}` });
    expect(r.statusCode).toBe(401);
  });
});

describe('the organization’s name as it is now', () => {
  it('a correction after a rename seals the new name; the old version keeps the old', async () => {
    const { thread, ref } = await fileOne(coord, { answers: { what: 'Before the rename.' } });
    await h.db
      .updateTable('organizations')
      .set({ name: `${ORG} (renamed)` })
      .where('id', '=', orgId)
      .execute();
    try {
      const r = await call(coord, 'POST', `/api/intake/reports/${thread}/correct`, {
        answers: { what: 'After the rename.' },
        comment: 'c',
        attested: true,
      });
      expect(r.status).toBe(200);
      expect((await verifyReport(h.db, ref))?.hashed_fields.filed_via).toBe(ORG);
      expect((await verifyReport(h.db, String(r.body.public_ref)))?.hashed_fields.filed_via).toBe(
        `${ORG} (renamed)`,
      );
    } finally {
      await h.db.updateTable('organizations').set({ name: ORG }).where('id', '=', orgId).execute();
    }
  });
});
