/**
 * What the confirmation says about files, and how long a staged file lives.
 *
 * THE PROMISES UNDER TEST:
 *   - the confirmation names every file that did not make it into the
 *     report, with its reason, EXCEPT one the reporter removed or one that
 *     expired: those were never going to be in it, and naming them would
 *     read as a fault;
 *   - a refused file is also noted for moderators against the report
 *     (decision 32, legacy's 'upload_rejected'), append-only and unsealed;
 *   - Send gives the draft's files the confirmation link's expiry, so a file
 *     staged early does not expire under a link sent late, and a file and
 *     the report it belongs to expire together.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LINK_TTL_MS } from '../../src/filing/filing.ts';
import { SLOT_TTL_MS } from '../../src/files/slots.ts';
import { workOnce } from '../../src/files/worker.ts';
import { attach, filesHarness, jpegWithGps, toolsMissing } from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { spine, tokenFor } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';
import { doorPass } from '../door-pass.ts';

let h: FilesHarness;
let lb: { id: number; slug: string };

const newDraft = async () =>
  (await h.app.inject({ method: 'POST', url: '/api/uploads/draft' })).json<{
    draft_token: string;
  }>().draft_token;
const send = async (email: string, draft: string) =>
  h.app.inject({
    method: 'POST',
    url: '/api/reports',
    payload: {
      ...(await doorPass(h.app)),
      ...spine(email),
      logbook: lb.slug,
      answers: { what: 'At the door' },
      draft_token: draft,
    },
  });
const slot = (token: string) =>
  h.db
    .selectFrom('upload_slots')
    .selectAll()
    .where('slot_token', '=', token)
    .executeTakeFirstOrThrow();
const submissionOf = (email: string) =>
  h.db
    .selectFrom('report_submissions')
    .select(['id', 'expires_at', 'created_at'])
    .where('email', '=', email)
    .orderBy('id', 'desc')
    .executeTakeFirstOrThrow();

beforeAll(async () => {
  h = await filesHarness();
  lb = await launchedLogbook(h.db, [
    { key: 'what', kind: 'long_text', label: 'What happened', required: true },
    { key: 'files', kind: 'file', label: 'Files' },
  ]);
});
afterAll(async () => {
  await h.close();
});

describe('a staged file and its confirmation link expire together', () => {
  it('the shipped lifetimes are the same', () => {
    expect(SLOT_TTL_MS).toBe(LINK_TTL_MS);
  });

  it('Send gives every file of the draft the link’s expiry, whenever it was staged', async () => {
    const email = address('expiry');
    const draft = await newDraft();
    const early = await attach(h, {
      draft,
      logbook: lb.slug,
      email,
      body: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      type: 'image/jpeg',
      name: 'early.jpg',
    });
    const late = await attach(h, {
      draft,
      logbook: lb.slug,
      email,
      body: Buffer.from([0xff, 0xd8, 0xff, 0x01]),
      type: 'image/jpeg',
      name: 'late.jpg',
    });
    // Staged in the evening, with an hour left on its own clock when the
    // reporter finally presses Send.
    await h.db
      .updateTable('upload_slots')
      .set({ expires_at: new Date(Date.now() + 60 * 60 * 1000) })
      .where('slot_token', '=', early)
      .execute();
    // And one in another draft, never sent: its own clock is left alone.
    const otherDraft = await newDraft();
    const unsent = await attach(h, {
      draft: otherDraft,
      logbook: lb.slug,
      email,
      body: Buffer.from([0xff, 0xd8, 0xff, 0x02]),
      type: 'image/jpeg',
      name: 'unsent.jpg',
    });
    const unsentBefore = (await slot(unsent)).expires_at;

    expect((await send(email, draft)).statusCode).toBe(200);
    const sub = await submissionOf(email);
    for (const token of [early, late]) {
      const s = await slot(token);
      expect(s.submission_id).toBe(sub.id);
      expect(s.expires_at.getTime()).toBe(sub.expires_at.getTime());
    }
    // The link's own lifetime, counted from when the report was sent.
    expect(sub.expires_at.getTime() - sub.created_at.getTime()).toBeGreaterThan(
      LINK_TTL_MS - 60_000,
    );
    expect((await slot(unsent)).expires_at.getTime()).toBe(unsentBefore.getTime());
  });

  it('so the worker does not sweep a sent file while its link still works', async () => {
    const email = address('notswept');
    const draft = await newDraft();
    const token = await attach(h, {
      draft,
      logbook: lb.slug,
      email,
      body: Buffer.from([0xff, 0xd8, 0xff, 0x03]),
      type: 'image/jpeg',
      name: 'kept.jpg',
    });
    // Staged so long ago that its own clock would have run out by now.
    await h.db
      .updateTable('upload_slots')
      .set({ expires_at: new Date(Date.now() + 1000) })
      .where('slot_token', '=', token)
      .execute();
    await send(email, draft);
    await new Promise((r) => setTimeout(r, 1100));
    await workOnce(h.files);
    expect((await slot(token)).status).not.toBe('expired');
  });
});

describe.skipIf(toolsMissing)('the confirmation names what did not make it', () => {
  it('a refused file is named; a removed or expired one is not', async () => {
    const email = address('outcomes');
    const draft = await newDraft();
    const photo = jpegWithGps(h.files.dir);
    const names = ['kept.jpg', 'fake.png', 'removed.jpg', 'expired.jpg'];
    const tokens: string[] = [];
    for (const name of names) {
      tokens.push(
        await attach(h, {
          draft,
          logbook: lb.slug,
          email,
          body: name === 'fake.png' ? Buffer.from('not a picture at all') : photo,
          type: name === 'fake.png' ? 'image/png' : 'image/jpeg',
          name,
        }),
      );
    }
    expect((await send(email, draft)).statusCode).toBe(200);
    const [, , removed = '', expired = ''] = tokens;
    // A slot that ends `withdrawn` after Send: no route does this today
    // (removing a file is refused once it is sent), so it is set here,
    // to pin that the answer would not name it if one ever did.
    await h.db
      .updateTable('upload_slots')
      .set({ status: 'withdrawn', status_detail: 'removed by the reporter' })
      .where('slot_token', '=', removed)
      .execute();
    // An expired one goes the real way: past its time, swept by the worker.
    await h.db
      .updateTable('upload_slots')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('slot_token', '=', expired)
      .execute();
    await workOnce(h.files);
    expect((await slot(expired)).status).toBe('expired');
    expect((await slot(tokens[1] ?? '')).status).toBe('rejected');

    const done = await h.app.inject({
      method: 'POST',
      url: `/api/reports/confirm/${tokenFor(h.mailer, email) ?? ''}`,
    });
    expect(done.statusCode).toBe(200);
    const { files, public_ref } = done.json<{
      confirmation: {
        public_ref: string;
        files?: { attached: number; not_attached: { name: string; reason: string }[] };
      };
    }>().confirmation;
    expect(files).toEqual({
      attached: 1,
      not_attached: [
        {
          name: 'fake.png',
          reason: 'this is not a photo, video, sound recording or PDF this site can take',
        },
      ],
    });
    // And the record holds exactly the one.
    const sealed = await h.db
      .selectFrom('report_attachments as ra')
      .innerJoin('reports as r', 'r.id', 'ra.report_id')
      .select('ra.attachment_id')
      .where('r.public_ref', '=', public_ref)
      .execute();
    expect(sealed).toHaveLength(1);

    // And the moderators see that it was sent and turned away (decision 32),
    // with the reason the reporter was given; the removed and expired ones
    // are no more news to them than to the reporter.
    const { thread_id } = await h.db
      .selectFrom('reports')
      .select('thread_id')
      .where('public_ref', '=', public_ref)
      .executeTakeFirstOrThrow();
    const modEmail = address('outcomes-mod');
    await seat(h.db, modEmail, 'moderator');
    const mod = as(h, await signIn(h, modEmail));
    const staff = await mod({ method: 'GET', url: `/api/moderate/files/${thread_id}` });
    expect(staff.statusCode).toBe(200);
    expect(staff.json<{ refused: { name: string; reason: string }[] }>().refused).toEqual([
      {
        name: 'fake.png',
        reason: 'this is not a photo, video, sound recording or PDF this site can take',
        at: expect.any(String) as string,
      },
    ]);
    await expect(
      h.db.updateTable('refused_uploads').set({ reason: 'rewritten' }).execute(),
    ).rejects.toThrow();
    await expect(h.db.deleteFrom('refused_uploads').execute()).rejects.toThrow();
  });
});
