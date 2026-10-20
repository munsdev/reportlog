/**
 * Decision 38 (replacing decision 17): while a logbook's uploads are frozen,
 * or switched off, a filing that carries a file is REFUSED at Send, in plain
 * words naming the files, rather than filed with the files dropped.
 *
 * Through the real routes, as the form calls them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setSiteLimits } from '../../src/files/limits.ts';
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
  it('Send REFUSES a filing that carries a file, names it, and sends nothing (decision 38)', async () => {
    const { lb, email, send } = await staged('frozen-refused');
    await L.setFilesFrozen(h.db, lb.id, true);

    const sent = await send();
    expect(sent.statusCode).toBe(409);
    const err = sent.json<{ error: { code: string; message: string } }>().error;
    expect(err.code).toBe('files_off');
    expect(err.message).toContain('queue.jpg');
    expect(err.message).toContain('notes.pdf');
    // Neither filed nor kept for a link: no email, no submission.
    expect(tokenFor(h.mailer, email)).toBeFalsy();
    const subs = await h.db
      .selectFrom('report_submissions')
      .select('id')
      .where('logbook_id', '=', lb.id)
      .execute();
    expect(subs).toEqual([]);
    // The files were not tied to anything or released to the worker.
    const slots = await slotsOf(lb.id);
    expect(slots.every((s) => s.submission_id === null && s.released_at === null)).toBe(true);
  });

  it('uploads switched off site-wide refuse the same filing', async () => {
    const { lb, email, send } = await staged('site-off');
    await setSiteLimits(h.db, { enabled: false });
    try {
      const sent = await send();
      expect(sent.statusCode).toBe(409);
      expect(sent.json<{ error: { code: string } }>().error.code).toBe('files_off');
      expect(tokenFor(h.mailer, email)).toBeFalsy();
      expect((await slotsOf(lb.id)).every((s) => s.released_at === null)).toBe(true);
    } finally {
      await setSiteLimits(h.db, { enabled: null });
    }
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
