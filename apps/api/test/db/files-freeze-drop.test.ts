/**
 * Decision 17: files staged before a logbook's uploads were frozen are
 * dropped when the report is sent, as legacy did (it dropped the draft token
 * at Send), and the reporter is told which, in plain words, twice: in the
 * answer to Send ("check your email") and on the confirmation page.
 *
 * Through the real routes, as the form calls them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FROZEN_DROP } from '../../src/files/slots.ts';
import * as L from '../../src/logbooks/logbooks.ts';
import { attach, filesHarness } from './files-helpers.ts';
import type { FilesHarness } from './files-helpers.ts';
import { spine, tokenFor } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address } from './identity-helpers.ts';

const WHAT = { key: 'what', kind: 'long_text', label: 'What happened', required: true };
const QS = [WHAT, { key: 'photos', kind: 'file', label: 'Photos' }];

let h: FilesHarness;

beforeAll(async () => {
  h = await filesHarness();
});
afterAll(async () => {
  await h.close();
});

const newDraft = async () =>
  (await h.app.inject({ method: 'POST', url: '/api/uploads/draft' })).json<{
    draft_token: string;
  }>().draft_token;

interface Sent {
  pending: true;
  files_dropped?: string[];
}
interface Confirmed {
  confirmation: {
    state: string;
    public_ref?: string;
    files?: { attached: number; not_attached: { name: string; reason: string }[] };
  };
}

/** A logbook, a draft with two files staged (one finished, one half-sent), and its reporter. */
async function staged(stem: string) {
  const lb = await launchedLogbook(h.db, QS);
  const email = address(stem);
  const draft = await newDraft();
  await attach(h, {
    draft,
    logbook: lb.slug,
    email,
    body: Buffer.from('not really a jpeg'),
    type: 'image/jpeg',
    name: 'queue.jpg',
  });
  // The second never finished arriving: a slot, no bytes.
  const half = await h.app.inject({
    method: 'POST',
    url: '/api/uploads',
    payload: {
      draft_token: draft,
      logbook: lb.slug,
      email,
      name: 'notes.pdf',
      type: 'application/pdf',
      size: 10,
    },
  });
  expect(half.statusCode).toBe(200);
  const send = () =>
    h.app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        ...spine(email),
        logbook: lb.slug,
        answers: { what: 'Turned away at the door.' },
        draft_token: draft,
      },
    });
  return { lb, email, send };
}

const slotsOf = (logbookId: number) =>
  h.db
    .selectFrom('upload_slots')
    .select([
      'declared_name',
      'status',
      'status_detail',
      'submission_id',
      'released_at',
      'staging_key',
      'dek_wrapped',
    ])
    .where('logbook_id', '=', logbookId)
    .orderBy('id')
    .execute();

describe('a logbook frozen while the report was written', () => {
  it('Send drops the staged files, names them, and still sends the report', async () => {
    const { lb, email, send } = await staged('frozen-drop');
    await L.setFilesFrozen(h.db, lb.id, true);

    const sent = await send();
    expect(sent.statusCode).toBe(200);
    expect(sent.json<Sent>()).toEqual({
      pending: true,
      files_dropped: ['queue.jpg', 'notes.pdf'],
    });
    // The confirmation email went out: the report itself was sent.
    expect(tokenFor(h.mailer, email)).toBeTruthy();

    const slots = await slotsOf(lb.id);
    expect(slots).toHaveLength(2);
    for (const s of slots) {
      // Tied to the submission so the confirmation page can name it, but never
      // released: the worker claims released slots only, so it is never worked on.
      expect(s.submission_id).not.toBeNull();
      expect(s.released_at).toBeNull();
      expect(s.status).toBe('rejected');
      expect(s.status_detail).toBe(FROZEN_DROP);
      expect(s.dek_wrapped).toBeNull();
    }
    // And the bytes that did arrive are queued for deletion now.
    const queued = await h.db
      .selectFrom('storage_deletions')
      .select('key')
      .where(
        'key',
        'in',
        slots.map((s) => s.staging_key),
      )
      .execute();
    expect(queued).toHaveLength(2);
  });

  it('the confirmation page files the report without them and says why, in words', async () => {
    const { lb, email, send } = await staged('frozen-confirm');
    await L.setFilesFrozen(h.db, lb.id, true);
    await send();
    const token = tokenFor(h.mailer, email) ?? '';
    const done = (
      await h.app.inject({ method: 'POST', url: `/api/reports/confirm/${token}` })
    ).json<Confirmed>();
    expect(done.confirmation.state).toBe('received');
    expect(done.confirmation.files).toEqual({
      attached: 0,
      not_attached: [
        { name: 'queue.jpg', reason: FROZEN_DROP },
        { name: 'notes.pdf', reason: FROZEN_DROP },
      ],
    });
    // Nothing of them was sealed.
    const linked = await h.db
      .selectFrom('report_attachments as ra')
      .innerJoin('reports as r', 'r.id', 'ra.report_id')
      .select('ra.report_id')
      .where('r.public_ref', '=', done.confirmation.public_ref ?? '')
      .execute();
    expect(linked).toEqual([]);
    // And it reads as a sentence a person says.
    expect(`queue.jpg: ${FROZEN_DROP}.`).toMatch(/^queue\.jpg: this logbook stopped taking files/);
  });

  it('a logbook that is not frozen sends its files as before, and says nothing of dropping', async () => {
    const { lb, send } = await staged('not-frozen');
    const sent = await send();
    expect(sent.json<Sent>()).toEqual({ pending: true });
    const slots = await slotsOf(lb.id);
    expect(slots.map((s) => s.status)).toEqual(['uploaded', 'pending']);
    expect(slots.every((s) => s.released_at !== null)).toBe(true);
  });

  it('freezing after Send leaves the files already sent alone, as legacy did', async () => {
    const { lb, send } = await staged('frozen-after');
    expect((await send()).json<Sent>().files_dropped).toBeUndefined();
    await L.setFilesFrozen(h.db, lb.id, true);
    const slots = await slotsOf(lb.id);
    expect(slots.map((s) => s.status)).toEqual(['uploaded', 'pending']);
  });
});
