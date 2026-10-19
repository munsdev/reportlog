/**
 * Moderation through its routes, on reports filed the way reporters file
 * them (through the real filing routes and the confirmation link).
 *
 * What it holds: nothing is public until a moderator approves it; a
 * correction goes back to pending; a reporter's own withdrawal is never
 * undone by staff; consent is the ceiling and moderation the floor for
 * files; every opening of contact details is logged before anything is read,
 * and the reporter sees it without being told who.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FilingHarness } from './filing-helpers.ts';
import { fileThroughRoutes, threadOf } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address, as, signIn } from './identity-helpers.ts';
import { moderationHarness, resetModerationSettings, staff } from './moderation-helpers.ts';

type Caller = Awaited<ReturnType<typeof staff>>['call'];

let h: FilingHarness;
let lb: { id: number; slug: string };
let mod: { email: string; call: Caller };
let admin: { email: string; call: Caller };

const board = async () =>
  (await h.app.inject({ method: 'GET', url: `/api/board/reports?logbook=${lb.slug}` })).json<{
    reports: { public_ref: string; files: number; editorial_note?: Record<string, unknown> }[];
  }>().reports;
const onBoard = async (ref: string) => (await board()).some((r) => r.public_ref === ref);

async function file(what: string, email = address('reporter')) {
  const ref = await fileThroughRoutes(h, lb.slug, { what }, email);
  return { ref, thread: await threadOf(h.db, ref), email };
}

const decide = (
  who: Caller,
  thread: string,
  status: string,
  comment = 'Checked against the photos.',
) =>
  who({
    method: 'POST',
    url: `/api/moderation/reports/${thread}/decision`,
    payload: { status, comment },
  });

beforeAll(async () => {
  h = await moderationHarness();
  await resetModerationSettings(h.db);
  lb = await launchedLogbook(h.db);
  mod = await staff(h, 'mod', 'moderator');
  admin = await staff(h, 'admin', 'admin');
});
afterAll(async () => {
  await resetModerationSettings(h.db);
  await h.close();
});

describe('who may moderate', () => {
  it('the queue is for moderators and administrators, and nobody else', async () => {
    const url = '/api/moderation/reports';
    expect((await h.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    for (const role of ['user', 'access_manager']) {
      const who = await staff(h, role, role);
      expect((await who.call({ method: 'GET', url })).statusCode).toBe(403);
    }
    expect((await mod.call({ method: 'GET', url })).statusCode).toBe(200);
    expect((await admin.call({ method: 'GET', url })).statusCode).toBe(200);
    const owner = await staff(h, 'owner', 'owner');
    expect((await owner.call({ method: 'GET', url })).statusCode).toBe(200);
  });

  it("the chief editor's and the operator's calls are administrators' only", async () => {
    for (const [method, url] of [
      ['GET', '/api/admin/moderation/access-log'],
      ['GET', '/api/admin/moderation/keywords'],
      ['GET', '/api/admin/moderation/archive'],
      ['GET', '/api/admin/moderation/logbooks'],
    ] as const) {
      expect((await mod.call({ method, url })).statusCode).toBe(403);
      expect((await admin.call({ method, url })).statusCode).toBe(200);
    }
  });
});

describe('NOTHING IS PUBLIC UNTIL A MODERATOR APPROVES IT', () => {
  it('a new report is pending in the queue and absent from the board', async () => {
    const r = await file('A new report, waiting for a moderator.');
    const q = (
      await mod.call({
        method: 'GET',
        url: `/api/moderation/reports?status=pending&logbook=${lb.slug}`,
      })
    ).json<{ reports: { public_ref: string; moderation_status: string; public: boolean }[] }>();
    expect(q.reports.find((x) => x.public_ref === r.ref)).toMatchObject({
      moderation_status: 'pending',
      public: false,
    });
    expect(await onBoard(r.ref)).toBe(false);
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/board/reports/${r.ref}` })).statusCode,
    ).toBe(404);
  });

  it('approval puts it on the board; declining or "unclear" takes it off', async () => {
    const r = await file('An account a moderator will approve.');
    expect((await decide(mod.call, r.thread, 'valid')).statusCode).toBe(200);
    expect(await onBoard(r.ref)).toBe(true);
    await decide(mod.call, r.thread, 'invalid');
    expect(await onBoard(r.ref)).toBe(false);
    await decide(mod.call, r.thread, 'unknown');
    expect(await onBoard(r.ref)).toBe(false);
  });

  it('a decision needs a reason and one of the three words, and is logged with who and which version', async () => {
    const r = await file('An account checked carefully.');
    expect((await decide(mod.call, r.thread, 'valid', '  ')).statusCode).toBe(400);
    expect((await decide(mod.call, r.thread, 'pending')).statusCode).toBe(400);
    expect((await decide(mod.call, r.thread, 'published')).statusCode).toBe(400);
    await decide(mod.call, r.thread, 'valid', 'Matches two other accounts.');
    const log = await h.db
      .selectFrom('moderation_log')
      .selectAll()
      .where('thread_id', '=', r.thread)
      .executeTakeFirstOrThrow();
    const head = await h.db
      .selectFrom('report_heads')
      .select('current_report_id')
      .where('thread_id', '=', r.thread)
      .executeTakeFirstOrThrow();
    expect(log).toMatchObject({
      action: 'review',
      new_status: 'valid',
      actor_email: mod.email,
      comment: 'Matches two other accounts.',
      report_id: head.current_report_id,
    });
    // And the log cannot be rewritten.
    await expect(
      h.db.updateTable('moderation_log').set({ comment: 'x' }).execute(),
    ).rejects.toThrow();
  });

  it('a report its reporter did not permit publishing is never on the board, approved or not', async () => {
    const email = address('no-publish');
    const ref = await fileThroughRoutes(
      h,
      lb.slug,
      { what: 'Please do not publish this one.' },
      email,
      {
        may_publish: false,
      },
    );
    const thread = await threadOf(h.db, ref);
    await decide(mod.call, thread, 'valid');
    expect(await onBoard(ref)).toBe(false);
  });

  it('A CORRECTION GOES BACK TO PENDING, and off the board until approved again', async () => {
    const r = await file('The first version, approved.');
    await decide(mod.call, r.thread, 'valid');
    expect(await onBoard(r.ref)).toBe(true);
    const reporter = as(h, await signIn(h, r.email));
    const fixed = await reporter({
      method: 'POST',
      url: `/api/mine/reports/${r.thread}/correct`,
      payload: {
        answers: { what: 'The corrected version, with the time fixed.' },
        comment: 'Wrong time.',
      },
    });
    expect(fixed.statusCode).toBe(200);
    const newRef = fixed.json<{ public_ref: string }>().public_ref;
    expect(await onBoard(r.ref)).toBe(false);
    expect(await onBoard(newRef)).toBe(false);
    const item = (
      await mod.call({ method: 'GET', url: `/api/moderation/reports/${r.thread}` })
    ).json<{
      report: { moderation_status: string; versions: number; public_ref: string };
      history: { action: string; by: string }[];
    }>();
    expect(item.report).toMatchObject({
      moderation_status: 'pending',
      versions: 2,
      public_ref: newRef,
    });
    expect(item.history.map((x) => `${x.by}:${x.action}`)).toEqual([
      'staff:review',
      'reporter:correct',
    ]);
    await decide(mod.call, r.thread, 'valid');
    expect(await onBoard(newRef)).toBe(true);
  });
});

describe('withdrawing and restoring', () => {
  it('a moderator takes a report off the board and can put it back, with reasons', async () => {
    const r = await file('An account that will be withdrawn and restored.');
    await decide(mod.call, r.thread, 'valid');
    const url = `/api/moderation/reports/${r.thread}`;
    expect(
      (await mod.call({ method: 'POST', url: `${url}/withdraw`, payload: {} })).statusCode,
    ).toBe(400);
    expect(
      (
        await mod.call({
          method: 'POST',
          url: `${url}/withdraw`,
          payload: { comment: 'Names a private person.' },
        })
      ).statusCode,
    ).toBe(200);
    expect(await onBoard(r.ref)).toBe(false);
    const back = await mod.call({
      method: 'POST',
      url: `${url}/restore`,
      payload: { status: 'pending', comment: 'Redacted on review; look again.' },
    });
    expect(back.statusCode).toBe(200);
    expect(await onBoard(r.ref)).toBe(false);
    await decide(mod.call, r.thread, 'valid');
    expect(await onBoard(r.ref)).toBe(true);
  });

  it("A REPORTER'S OWN WITHDRAWAL IS NEVER UNDONE BY STAFF", async () => {
    const r = await file('An account its reporter will withdraw.');
    await decide(mod.call, r.thread, 'valid');
    const reporter = as(h, await signIn(h, r.email));
    await reporter({
      method: 'POST',
      url: `/api/mine/reports/${r.thread}/withdraw`,
      payload: { comment: 'I changed my mind.' },
    });
    expect(await onBoard(r.ref)).toBe(false);
    const res = await admin.call({
      method: 'POST',
      url: `/api/moderation/reports/${r.thread}/restore`,
      payload: { status: 'valid', comment: 'It was a good report.' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('reporter_withdrew');
    expect(await onBoard(r.ref)).toBe(false);
  });
});

describe('the review flag in the queue', () => {
  it('a flagged report shows its terms, filters as flagged, and clears on "read" without deciding anything', async () => {
    const r = await file('The judge turned me away at the door.');
    const flagged = (
      await mod.call({
        method: 'GET',
        url: `/api/moderation/reports?status=all&flagged=true&logbook=${lb.slug}`,
      })
    ).json<{ reports: { thread_id: string; review_terms: string[]; needs_review: boolean }[] }>();
    const item = flagged.reports.find((x) => x.thread_id === r.thread);
    expect(item?.needs_review).toBe(true);
    expect(item?.review_terms).toEqual(expect.arrayContaining(['the judge', 'turned me away']));

    const read = await mod.call({
      method: 'POST',
      url: `/api/moderation/reports/${r.thread}/read`,
    });
    expect(read.json()).toEqual({ ok: true, cleared: 1 });
    const after = (
      await mod.call({ method: 'GET', url: `/api/moderation/reports/${r.thread}` })
    ).json<{
      report: { needs_review: boolean; moderation_status: string };
    }>();
    expect(after.report).toMatchObject({ needs_review: false, moderation_status: 'pending' });
  });

  it('the flag is never served by the board', async () => {
    const r = await file('They threatened me outside the hall.');
    await decide(mod.call, r.thread, 'valid');
    const res = await h.app.inject({ method: 'GET', url: `/api/board/reports/${r.ref}` });
    expect(res.body).not.toMatch(/review|flag|threatened"\]/);
  });
});

describe('CONSENT IS THE CEILING, MODERATION IS THE FLOOR: files', () => {
  async function withFile(what: string) {
    const r = await file(what);
    const head = await h.db
      .selectFrom('report_heads')
      .select('current_report_id')
      .where('thread_id', '=', r.thread)
      .executeTakeFirstOrThrow();
    // Written by hand, as the correction tests do: uploads are workstream F's.
    const a = await h.db
      .insertInto('attachments')
      .values({
        thread_id: r.thread,
        report_id: head.current_report_id,
        ordinal: 1,
        media_type: 'image/jpeg',
        byte_size: 1234,
        sha256: createHash('sha256').update(what).digest('hex'),
        storage_key: `evidence/${r.thread}`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('report_attachments')
      .values({ report_id: head.current_report_id, attachment_id: a.id })
      .execute();
    return { ...r, reportId: head.current_report_id };
  }
  const files = (who: Caller, thread: string, publish: boolean) =>
    who({ method: 'POST', url: `/api/moderation/reports/${thread}/files`, payload: { publish } });
  const filesOf = async (ref: string) => (await board()).find((x) => x.public_ref === ref)?.files;

  it('files are never published before the text', async () => {
    const r = await withFile('A report with a photograph, still pending.');
    const res = await files(mod.call, r.thread, true);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('text_first');
  });

  it('nor without the reporter’s permission, read at the moment of publishing', async () => {
    const r = await withFile('A report with a photograph, approved.');
    await decide(mod.call, r.thread, 'valid');
    const res = await files(mod.call, r.thread, true);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('not_permitted');
    expect(await filesOf(r.ref)).toBe(0);
  });

  it('the text may be public without the files; with both, the files show; taking it back takes them down', async () => {
    const r = await withFile('A report whose reporter permits the photographs.');
    await decide(mod.call, r.thread, 'valid');
    expect(await filesOf(r.ref)).toBe(0);
    const reporter = as(h, await signIn(h, r.email));
    const perm = (granted: boolean) =>
      reporter({
        method: 'POST',
        url: `/api/mine/reports/${r.thread}/permissions`,
        payload: { permission: 'attachment_publication', granted },
      });
    await perm(true);
    expect(await filesOf(r.ref)).toBe(0);
    expect((await files(mod.call, r.thread, true)).statusCode).toBe(200);
    expect(await filesOf(r.ref)).toBe(1);
    const listed = await h.app.inject({ method: 'GET', url: `/api/board/reports/${r.ref}/files` });
    expect(listed.json<{ files: unknown[] }>().files).toHaveLength(1);

    await perm(false);
    expect(await filesOf(r.ref)).toBe(0);
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/board/reports/${r.ref}/files` })).json<{
        files: unknown[];
      }>().files,
    ).toHaveLength(0);
  });

  it('the database holds the same ceiling if the module is bypassed', async () => {
    const r = await withFile('A report nobody permitted the files of.');
    await expect(
      h.db
        .insertInto('file_publication_log')
        .values({
          thread_id: r.thread,
          report_id: r.reportId,
          published: true,
          actor_email: 'x@example.org',
        })
        .execute(),
    ).rejects.toThrow(/before its text/);
    await decide(mod.call, r.thread, 'valid');
    await expect(
      h.db
        .insertInto('file_publication_log')
        .values({
          thread_id: r.thread,
          report_id: r.reportId,
          published: true,
          actor_email: 'x@example.org',
        })
        .execute(),
    ).rejects.toThrow(/not permitted/);
  });
});

describe("opening a reporter's contact details", () => {
  const open = (who: Caller, thread: string, reason?: string) =>
    who({
      method: 'POST',
      url: `/api/moderation/reports/${thread}/contact`,
      payload: reason === undefined ? {} : { reason },
    });
  const logged = (thread: string) =>
    h.db.selectFrom('contact_access_log').selectAll().where('thread_id', '=', thread).execute();

  it('needs a real reason, and a refused opening reads and logs nothing', async () => {
    const r = await file('An account whose reporter we need to reach.');
    expect((await open(mod.call, r.thread)).statusCode).toBe(400);
    expect((await open(mod.call, r.thread, 'because')).statusCode).toBe(400);
    expect(await logged(r.thread)).toHaveLength(0);
  });

  it('with a reason, is logged with who and why, and returns the details', async () => {
    const r = await file('An account whose reporter we need to reach.');
    const res = await open(mod.call, r.thread, 'To ask whether the photo can be published.');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ contact: { email: string; erased: boolean } }>().contact).toMatchObject({
      email: r.email,
      erased: false,
    });
    const rows = await logged(r.thread);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      staff_email: mod.email,
      kind: 'contact',
      reason: 'To ask whether the photo can be published.',
    });
    await expect(h.db.deleteFrom('contact_access_log').execute()).rejects.toThrow();
  });

  it('THE REPORTER SEES EVERY OPENING, WITH THE REASON AND WITHOUT WHO', async () => {
    const r = await file('An account whose reporter will check the log.');
    await open(mod.call, r.thread, 'To check the polling station they named.');
    const reporter = as(h, await signIn(h, r.email));
    const res = await reporter({ method: 'GET', url: `/api/mine/reports/${r.thread}/accesses` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ accesses: { reason: string }[] }>();
    expect(body.accesses).toHaveLength(1);
    expect(body.accesses[0]?.reason).toBe('To check the polling station they named.');
    expect(res.body).not.toContain(mod.email);
    expect(res.body).not.toContain('@');

    // Somebody else's report is "not yours", without saying whether it exists.
    const other = as(h, await signIn(h, address('stranger')));
    expect(
      (await other({ method: 'GET', url: `/api/mine/reports/${r.thread}/accesses` })).statusCode,
    ).toBe(404);
  });

  it('after an erasure, opening says so and is still logged', async () => {
    const r = await file('An account whose reporter will erase their details.');
    const reporter = as(h, await signIn(h, r.email));
    await reporter({
      method: 'POST',
      url: `/api/mine/reports/${r.thread}/erase`,
      payload: { confirm: true },
    });
    const res = await open(mod.call, r.thread, 'To see whether we can still reach them.');
    expect(res.json<{ contact: { erased: boolean; email: null } }>().contact).toMatchObject({
      erased: true,
      email: null,
    });
    expect(await logged(r.thread)).toHaveLength(1);
  });

  it("the administrators' log names staff, and reading it is itself recorded", async () => {
    const r = await file('An account opened for the audit test.');
    await open(mod.call, r.thread, 'To confirm the account with the reporter.');
    const res = await admin.call({
      method: 'GET',
      url: `/api/admin/moderation/access-log?thread=${r.thread}`,
    });
    expect(res.json<{ entries: { staff_email: string }[] }>().entries[0]?.staff_email).toBe(
      mod.email,
    );
    const audit = await h.db
      .selectFrom('contact_access_log')
      .select('kind')
      .where('staff_email', '=', admin.email)
      .execute();
    expect(audit.map((a) => a.kind)).toContain('audit_log');
  });
});

describe('editorial notes through the routes', () => {
  it('are refused on a logbook that does not use them', async () => {
    const r = await file('An account on a logbook without notes.');
    const res = await mod.call({
      method: 'POST',
      url: `/api/moderation/reports/${r.thread}/note`,
      payload: { body: 'A note long enough to count as one, but unwanted.' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('are written by moderators, revised with a reason, and their state is the administrators’', async () => {
    const enable = await admin.call({
      method: 'PUT',
      url: `/api/admin/moderation/logbooks/${lb.slug}/notes`,
      payload: { enabled: true },
    });
    expect(enable.json()).toEqual({ slug: lb.slug, notes_enabled: true });
    const r = await file('An account the archive will comment on.');
    await decide(mod.call, r.thread, 'valid');
    const url = `/api/moderation/reports/${r.thread}/note`;
    const body = 'The county office confirmed the machine was replaced at 10:40.';
    expect((await mod.call({ method: 'POST', url, payload: { body } })).json()).toEqual({
      ok: true,
      versions: 1,
    });
    expect(
      (await mod.call({ method: 'POST', url, payload: { body: `${body} Updated.` } })).statusCode,
    ).toBe(400);
    expect(
      (
        await mod.call({
          method: 'POST',
          url,
          payload: { body: `${body} Updated.`, revision_reason: 'New detail.' },
        })
      ).statusCode,
    ).toBe(200);

    const pub = (await h.app.inject({ method: 'GET', url: `/api/board/reports/${r.ref}` })).json<{
      report: { editorial_note: { state: string; body: string; revised: boolean } };
    }>();
    expect(pub.report.editorial_note).toMatchObject({ state: 'published', revised: true });
    expect(JSON.stringify(pub)).not.toContain(mod.email);

    const stateUrl = `/api/admin/moderation/reports/${r.thread}/note/state`;
    const payload = { state: 'under_review', comment: 'Its author left the desk.' };
    expect((await mod.call({ method: 'POST', url: stateUrl, payload })).statusCode).toBe(403);
    expect((await admin.call({ method: 'POST', url: stateUrl, payload })).statusCode).toBe(200);
    const marked = (
      await h.app.inject({ method: 'GET', url: `/api/board/reports/${r.ref}` })
    ).json<{
      report: { editorial_note: Record<string, unknown> };
    }>();
    expect(marked.report.editorial_note).toMatchObject({ state: 'under_review' });
    expect(marked.report.editorial_note).not.toHaveProperty('body');
  });
});

describe('only the reporter changes a reporter’s permission', () => {
  it('nothing in moderation/ or board/ writes the permissions log', () => {
    for (const dir of ['moderation', 'board']) {
      const root = new URL(`../../src/${dir}/`, import.meta.url);
      for (const f of readdirSync(root)) {
        const src = readFileSync(new URL(f, root), 'utf8');
        expect({
          f,
          writes: /setPermission|insertInto\('report_permissions_log'\)/.test(src),
        }).toEqual({
          f,
          writes: false,
        });
      }
    }
  });
});
