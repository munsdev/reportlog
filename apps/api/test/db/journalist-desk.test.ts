/**
 * Vetted journalist access (plan D, J7a to J13, M5, K7): asking from the
 * alert list, the owner's queue, the agreement, the desk and what it never
 * shows, the access log, and revoking.
 */
import { DESK_PAGE_SIZE } from '@reportlog/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createDatabase } from '../../src/db/database.ts';
import { migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import type { Throwaway } from '../../src/db/throwaway.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { emailDigest, keyringFrom } from '../../src/filing/contactKeys.ts';
import { checkGroup, commentGroup } from '../../src/links/checks.ts';
import type { LinkKeys } from '../../src/links/keys.ts';
import { matchKey } from '../../src/links/keys.ts';
import { issueLink } from '../../src/journalists/list.ts';
import { fileEntry } from '../../src/lists/entries.ts';
import { createFromTemplate } from '../../src/lists/manage.ts';
import { DEFAULT_LIST_SETTINGS } from '../../src/lists/retention.ts';
import type { LoadedList } from '../../src/lists/rows.ts';
import { addLink, writeNote } from '../../src/moderation/notes.ts';
import { setPermission } from '../../src/permissions/log.ts';
import { checkText, redactText } from '../../src/moderation/texts/items.ts';
import { fileReport, launchedLogbook, uniqueSlug } from './helpers.ts';
import { HELD_QUESTIONS, fileHeld, textRef } from './written-helpers.ts';
import { address, as, roleOf, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';
import { LINK_CONTACT_KEY, linkKeys } from './links-helpers.ts';

// ITS OWN DATABASE. The journalist agreement this file publishes is global
// and append-only; in the shared database it could never be taken back.
let throwaway: Throwaway;
let h: Harness;
let keys: LinkKeys;
let tips: LoadedList;
const ring = keyringFrom(LINK_CONTACT_KEY);
const run = `${String(process.pid)}${String(Date.now() % 1e6)}`;
const url = (stem: string) => `https://${stem}-${run}.example.org/post/1`;

const CHECKED = url('checked');
const WITHHELD = url('withheld');
const ILLEGAL = url('illegal');
const UNCHECKED = url('unchecked');
const TIPSTER = address('tipster');
const TIP_COMMENT = 'SECRET-TIP-COMMENT-words';
const MOD = address('desk-mod');
const COMMENT = 'Verified against the original upload.';
const NOTE = 'A note from the archive about this report, long enough to be one.';
const SOURCE = `https://sources-${run}.example.net/story`;
const HIDDEN_SOURCE = `https://unpublished-${run}.example.net/story`;

const owner = { email: address('desk-owner'), call: null as unknown as ReturnType<typeof as> };
const admin = { email: address('desk-admin'), call: null as unknown as ReturnType<typeof as> };
const journalist = address('journalist');
let reference = '';

// Each sign-up from an address of its own (TEST-NET-3), so the limiter that
// bounds sign-ups per client (journalists/routes.ts) does not decide a test.
let client = 0;
const fromNewClient = () => `203.0.113.${String((client++ % 250) + 1)}`;

const tokenIn = (kind: string, text: string) =>
  new RegExp(`/journalists/${kind}/([a-f0-9]{64})`).exec(text)?.[1] ?? '';

async function subscribe(email: string) {
  const s = await h.app.inject({
    method: 'POST',
    url: '/api/journalists/signup',
    remoteAddress: fromNewClient(),
    payload: { name: 'Pat Reporter', outlet: 'The Daily Example', email, states: ['US-AZ'] },
  });
  expect(s.statusCode, s.body).toBe(200);
  const token = tokenIn('confirm', h.mailer.lastTo(email)?.text ?? '');
  await h.app.inject({ method: 'POST', url: `/api/journalists/confirm/${token}` });
}

async function askLink(email: string): Promise<string> {
  const r = await h.app.inject({
    method: 'POST',
    url: '/api/journalists/access',
    remoteAddress: fromNewClient(),
    payload: { email },
  });
  expect(r.statusCode).toBe(200);
  return tokenIn('access', h.mailer.lastTo(email)?.text ?? '');
}

const REQUEST = {
  outlet: 'OUTLET-IN-THE-CLEAR',
  role: 'Reporter',
  about: 'Pat, local politics at Desk Daily. https://daily.example.org/by/pat',
  press_card_number: 'PC-12345',
  press_card_issuer: 'Press Union',
};

const groupOf = async (u: string) =>
  (
    await h.db
      .selectFrom('link_groups')
      .select('id')
      .where('match_key', '=', matchKey(keys, u))
      .executeTakeFirstOrThrow()
  ).id;

const tip = (links: string, email?: string) =>
  fileEntry(
    h.db,
    tips.slug,
    {
      answers: { links, state: 'Not sure', category: 'Not sure', description: TIP_COMMENT },
      // The tips template asks for an email; every tip gives one.
      email: email ?? address('tip'),
    },
    { settings: DEFAULT_LIST_SETTINGS, keys },
  );

const requestId = async (email: string) =>
  (
    await h.db
      .selectFrom('journalist_access_requests as q')
      .innerJoin('journalist_subscribers as s', 's.id', 'q.subscriber_id')
      .select('q.id')
      .where('s.email_hmac', '=', emailDigest(ring, email))
      .executeTakeFirstOrThrow()
  ).id;

beforeAll(async () => {
  throwaway = await createThrowawayDatabase(inject('serverUrl'), 'desk');
  await migrate(throwaway.url);
  const db = createDatabase(throwaway.url, 10);
  const mailer = capturingMailer();
  const app = await buildApp({
    config: {
      LOG_LEVEL: 'silent',
      SITE_ORIGIN: 'https://reports.example.test',
      CONTACT_KEY: LINK_CONTACT_KEY,
    },
    db,
    mailer,
  });
  h = {
    db,
    app,
    mailer,
    close: async () => {
      await app.close();
      await db.destroy();
    },
  };
  keys = await linkKeys(db);
  tips = await createFromTemplate(db, 'tips', { slug: uniqueSlug('tips') });

  await seat(db, owner.email, 'owner');
  owner.call = as(h, await signIn(h, owner.email));
  await seat(db, admin.email, 'admin');
  admin.call = as(h, await signIn(h, admin.email));

  // Two tips carry the checked link; one of them also sends an email.
  await tip(CHECKED, TIPSTER);
  await tip(CHECKED);
  // And a third, from the election tips list (decision 45): a county and a
  // day, which the desk shows by name and in words, never as codes.
  const election = await createFromTemplate(db, 'election-tips', {
    slug: uniqueSlug('etips'),
  });
  await fileEntry(
    db,
    election.slug,
    {
      answers: {
        links: CHECKED,
        where: 'US-AZ-04013',
        day: '2026-11-03',
        category: 'Long lines or wait times',
        description: TIP_COMMENT,
      },
      email: address('etip'),
    },
    { settings: DEFAULT_LIST_SETTINGS, keys },
  );
  for (const u of [WITHHELD, ILLEGAL, UNCHECKED]) await tip(u);
  await checkGroup(db, keys, await groupOf(CHECKED), { outcome: 'checked', actor: MOD });
  await commentGroup(db, await groupOf(CHECKED), { body: COMMENT, actor: MOD });
  await checkGroup(db, keys, await groupOf(WITHHELD), { outcome: 'withheld', actor: MOD });
  await commentGroup(db, await groupOf(WITHHELD), { body: 'WITHHELD-COMMENT', actor: MOD });
  await checkGroup(db, keys, await groupOf(ILLEGAL), {
    outcome: 'illegal',
    actor: MOD,
    reason: 'other-illegal',
  });

  // A published report with a note and a Sources link, and an unpublished one.
  const lb = await launchedLogbook(db);
  for (const published of [true, false]) {
    const { row } = await fileReport(db, lb, { what: 'Something happened at the polls.' });
    await db
      .insertInto('report_heads')
      .values({
        thread_id: row.thread_id,
        current_report_id: row.id,
        moderation_status: published ? 'valid' : 'pending',
      })
      .execute();
    await writeNote(db, { threadId: row.thread_id, body: NOTE, authorEmail: MOD });
    await addLink(db, {
      threadId: row.thread_id,
      title: 'Coverage',
      publisher: 'Example News',
      url: published ? SOURCE : HIDDEN_SOURCE,
      addedBy: MOD,
    });
    if (published) reference = row.public_ref;
  }
});
afterAll(async () => {
  await h.close();
  await throwaway.drop();
});

describe('J7a · an access request, from the alert subscription', () => {
  it('emails a link only to an address on the list, and says the same either way', async () => {
    const stranger = address('not-listed');
    expect(await askLink(stranger)).toBe('');
    await subscribe(journalist);
    expect(await askLink(journalist)).not.toBe('');
  });

  it('opening the link changes nothing; the form takes text only, links optional', async () => {
    const token = await askLink(journalist);
    const seen = await h.app.inject({ method: 'GET', url: `/api/journalists/access/${token}` });
    expect(seen.json()).toMatchObject({ state: 'open' });
    expect(await h.db.selectFrom('journalist_access_requests').selectAll().execute()).toEqual([]);

    const bad = await h.app.inject({
      method: 'POST',
      url: `/api/journalists/access/${token}`,
      payload: { ...REQUEST, about: '   ' },
    });
    // Saying nothing about who they are is refused; a link is not required.
    expect(bad.statusCode).toBe(400);
    const sent = await h.app.inject({
      method: 'POST',
      url: `/api/journalists/access/${token}`,
      payload: REQUEST,
    });
    expect(sent.json()).toMatchObject({ state: 'pending' });
  });

  it('keeps the request encrypted, and grants nothing yet', async () => {
    const rows = await h.db.selectFrom('journalist_access_requests').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');
    expect(JSON.stringify(rows)).not.toMatch(/OUTLET-IN-THE-CLEAR|PC-12345/);
    expect(Buffer.from(rows[0]?.details_enc ?? []).toString('utf8')).not.toContain('OUTLET');
    expect(await roleOf(h.db, journalist)).toBeUndefined();
  });
});

describe('K7 · an unvetted journalist reads nothing', () => {
  it('a subscriber who signs in, with no role, is refused the desk', async () => {
    const call = as(h, await signIn(h, journalist));
    for (const u of ['/api/desk/links', '/api/desk/sources']) {
      const r = await call({ method: 'GET', url: u });
      expect(r.statusCode).toBe(403);
      expect(r.body).not.toContain(CHECKED);
    }
    expect(await roleOf(h.db, journalist)).toBe('user');
  });
});

describe('J7b and J7 · only the owner approves, and the approval is recorded', () => {
  it('nobody but the owner sees the queue or decides', async () => {
    const id = await requestId(journalist);
    for (const role of ['admin', 'access_manager', 'moderator', 'user'] as const) {
      const email = address(`desk-${role}`);
      await seat(h.db, email, role);
      const call = as(h, await signIn(h, email));
      expect((await call({ method: 'GET', url: '/api/owner/journalists' })).statusCode).toBe(403);
      const r = await call({ method: 'POST', url: `/api/owner/journalists/${String(id)}/approve` });
      expect(r.statusCode, role).toBe(403);
    }
    const list = await owner.call({ method: 'GET', url: '/api/owner/journalists' });
    expect(list.json()).toMatchObject({
      requests: [
        { outlet: 'OUTLET-IN-THE-CLEAR', press_card_number: 'PC-12345', status: 'pending' },
      ],
    });
  });

  it('the roles page cannot make a journalist, even for the owner', async () => {
    for (const who of [owner, admin]) {
      const r = await who.call({
        method: 'POST',
        url: '/api/access/system-role',
        payload: { email: address('sidestep'), role: 'journalist', action: 'grant' },
      });
      expect(r.statusCode, r.body).toBe(403);
    }
  });

  it('approving makes the account a journalist, with who and when, and emails the desk link', async () => {
    const id = await requestId(journalist);
    const r = await owner.call({
      method: 'POST',
      url: `/api/owner/journalists/${String(id)}/approve`,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(await roleOf(h.db, journalist)).toBe('journalist');
    const row = await h.db
      .selectFrom('journalist_access_requests')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'approved', decided_by: owner.email });
    expect(row.decided_at).toBeInstanceOf(Date);
    const audit = await h.db
      .selectFrom('role_audit')
      .selectAll()
      .where('subject_email', '=', journalist)
      .execute();
    expect(audit).toContainEqual(
      expect.objectContaining({ action: 'grant', detail: 'journalist', actor_email: owner.email }),
    );
    expect(h.mailer.lastTo(journalist)?.text).toContain(
      'https://reports.example.test/access/sign-in?next=%2Fdesk',
    );
    // Twice is refused, not repeated.
    const again = await owner.call({
      method: 'POST',
      url: `/api/owner/journalists/${String(id)}/approve`,
    });
    expect(again.statusCode).toBe(409);
  });

  it('rejecting deletes what was sent, and the person stays subscribed', async () => {
    const other = address('rejected');
    await subscribe(other);
    const token = await askLink(other);
    await h.app.inject({
      method: 'POST',
      url: `/api/journalists/access/${token}`,
      payload: REQUEST,
    });
    const id = await requestId(other);
    const r = await owner.call({
      method: 'POST',
      url: `/api/owner/journalists/${String(id)}/reject`,
    });
    expect(r.statusCode).toBe(200);
    expect(
      await h.db
        .selectFrom('journalist_access_requests')
        .select('id')
        .where('id', '=', id)
        .execute(),
    ).toEqual([]);
    const sub = await h.db
      .selectFrom('journalist_subscribers')
      .select('status')
      .where('email_hmac', '=', emailDigest(ring, other))
      .executeTakeFirst();
    expect(sub?.status).toBe('active');
    expect(await roleOf(h.db, other)).toBeUndefined();
  });
});

describe('J8 · the agreement comes before anything is shown', () => {
  let call: ReturnType<typeof as>;
  const accept = async () => {
    const state = await call({ method: 'GET', url: '/api/agreement/journalist' });
    const digest = state.json<{ current: { digest: string } }>().current.digest;
    const r = await call({
      method: 'POST',
      url: '/api/agreement/journalist/accept',
      payload: { digest },
    });
    expect(r.statusCode, r.body).toBe(200);
  };
  const publish = async (body: string) => {
    const r = await admin.call({
      method: 'POST',
      url: '/api/admin/agreement/journalist',
      payload: { body },
    });
    expect(r.statusCode, r.body).toBe(200);
  };

  it('with no agreement published, the desk is closed', async () => {
    call = as(h, await signIn(h, journalist));
    const r = await call({ method: 'GET', url: '/api/desk/links' });
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: { code: string } }>().error.code).toBe('desk_closed');
  });

  it('a published agreement must be accepted; a new version blocks until accepted again', async () => {
    await publish('Version one of the journalist agreement.');
    const before = await call({ method: 'GET', url: '/api/desk/links' });
    expect(before.json<{ error: { code: string } }>().error.code).toBe('agreement_required');
    await accept();
    expect((await call({ method: 'GET', url: '/api/desk/links' })).statusCode).toBe(200);
    await publish('Version two of the journalist agreement.');
    expect((await call({ method: 'GET', url: '/api/desk/sources' })).statusCode).toBe(403);
    await accept();
    expect((await call({ method: 'GET', url: '/api/desk/sources' })).statusCode).toBe(200);
  });
});

describe('J9 to J12 · the desk', () => {
  let call: ReturnType<typeof as>;
  beforeAll(async () => {
    call = as(h, await signIn(h, journalist));
  });

  it('J9 · one entry per checked link, its tip count, the comment and the tips’ answers', async () => {
    const r = await call({ method: 'GET', url: '/api/desk/links' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({
      page: 1,
      pages: 1,
      links: [
        {
          url: CHECKED,
          tips: 3,
          reports: 0,
          comment: COMMENT,
          checked_at: expect.any(String) as string,
          context: [
            {
              question: 'Where',
              answers: [
                { answer: 'Not sure', tips: 2 },
                { answer: 'Maricopa County, Arizona', tips: 1 },
              ],
            },
            {
              question: 'What kind of thing is it',
              answers: [
                { answer: 'Not sure', tips: 2 },
                { answer: 'Long lines or wait times', tips: 1 },
              ],
            },
            { question: 'What day was it?', answers: [{ answer: 'November 3, 2026', tips: 1 }] },
          ],
        },
      ],
    });
    expect(r.body).not.toContain('US-AZ-04013');
  });

  it('J9 · Sources links and notes on published reports only', async () => {
    const r = await call({ method: 'GET', url: '/api/desk/sources' });
    expect(r.json()).toEqual({
      page: 1,
      pages: 1,
      reports: [
        {
          reference,
          note: NOTE,
          sources: [
            { title: 'Coverage', publisher: 'Example News', published_on: null, url: SOURCE },
          ],
        },
      ],
    });
  });

  it('J10 · (D7 amends it, see W5) never an email, an unchecked tip comment, an unchecked, withheld or illegal link, or a moderator', async () => {
    const both = [
      (await call({ method: 'GET', url: '/api/desk/links' })).body,
      (await call({ method: 'GET', url: '/api/desk/sources' })).body,
    ].join('\n');
    for (const never of [
      TIPSTER,
      TIP_COMMENT,
      UNCHECKED,
      WITHHELD,
      ILLEGAL,
      'WITHHELD-COMMENT',
      MOD,
      HIDDEN_SOURCE,
      'entry',
      'email',
    ]) {
      expect(both, never).not.toContain(never);
    }
  });

  it('J11 · a fixed page size, nothing beyond the pages, and no other route', async () => {
    const big = await call({ method: 'GET', url: '/api/desk/links?limit=100000&page=2' });
    expect(big.json()).toMatchObject({ page: 2, links: [] });
    expect(DESK_PAGE_SIZE).toBeLessThanOrEqual(25);
    for (const u of ['/api/desk/export', '/api/desk/links.csv', '/api/desk/all', '/api/desk']) {
      expect((await call({ method: 'GET', url: u })).statusCode, u).toBe(404);
    }
  });

  it('decision 72 · q finds words in the link or the moderator comment, and nothing else', async () => {
    const find = async (path: string, q: string) =>
      (await call({ method: 'GET', url: `${path}?q=${encodeURIComponent(q)}` })).json<{
        links?: unknown[];
        reports?: unknown[];
      }>();
    // The address (sealed in the database) and the comment, in any case.
    expect((await find('/api/desk/links', `CHECKED-${run}`)).links).toHaveLength(1);
    expect((await find('/api/desk/links', 'verified against')).links).toHaveLength(1);
    expect((await find('/api/desk/links', 'nothing-like-this')).links).toEqual([]);
    // Words from a tip's own comment are never on the desk, so never found.
    expect((await find('/api/desk/links', TIP_COMMENT)).links).toEqual([]);
    // A withheld link's comment is not searchable.
    expect((await find('/api/desk/links', 'WITHHELD-COMMENT')).links).toEqual([]);
    // Sources: the title, the address, the note.
    expect((await find('/api/desk/sources', 'coverage')).reports).toHaveLength(1);
    expect((await find('/api/desk/sources', `sources-${run}`)).reports).toHaveLength(1);
    expect((await find('/api/desk/sources', 'archive about this')).reports).toHaveLength(1);
    expect((await find('/api/desk/sources', `unpublished-${run}`)).reports).toEqual([]);
    // % and _ mean themselves.
    expect((await find('/api/desk/sources', '%')).reports).toEqual([]);
  });

  it('decision 72 · a search that finds nothing logs nothing, and what it finds is logged', async () => {
    const count = async () =>
      (
        await h.db
          .selectFrom('contact_access_log')
          .select('id')
          .where('staff_email', '=', journalist)
          .execute()
      ).length;
    const before = await count();
    await call({ method: 'GET', url: '/api/desk/links?q=nothing-like-this' });
    expect(await count()).toBe(before);
    await call({ method: 'GET', url: `/api/desk/links?q=checked-${run}` });
    expect(await count()).toBe(before + 1);
  });

  it('decision 72 · mine keeps what falls in the journalist’s own alert states', async () => {
    const links = async (qs = '') =>
      (await call({ method: 'GET', url: `/api/desk/links?mine=true${qs}` })).json<{
        links: unknown[];
      }>().links;
    // They chose Arizona, and one of the link's tips is in a county there.
    expect(await links()).toHaveLength(1);
    expect(await links(`&q=checked-${run}`)).toHaveLength(1);
    // The published report's logbook has no location question: no state, so left out.
    const sources = await call({ method: 'GET', url: '/api/desk/sources?mine=true' });
    expect(sources.json()).toMatchObject({ reports: [] });
    // Other states: nothing is left.
    const states = await h.db
      .selectFrom('journalist_subscribers')
      .select(['id', 'states'])
      .execute();
    await h.db
      .updateTable('journalist_subscribers')
      .set({ states: ['US-NY'] })
      .execute();
    try {
      expect(await links()).toEqual([]);
    } finally {
      for (const row of states) {
        await h.db
          .updateTable('journalist_subscribers')
          .set({ states: row.states })
          .where('id', '=', row.id)
          .execute();
      }
    }
    // mine=false is the whole list.
    const all = await call({ method: 'GET', url: '/api/desk/links?mine=false' });
    expect(all.json<{ links: unknown[] }>().links).toHaveLength(1);
  });

  it('J12 · every link and every report shown is in the access log, under the journalist', async () => {
    const before = await h.db
      .selectFrom('contact_access_log')
      .select(['kind', 'link_group_id', 'thread_id'])
      .where('staff_email', '=', journalist)
      .execute();
    await call({ method: 'GET', url: '/api/desk/links' });
    await call({ method: 'GET', url: '/api/desk/sources' });
    const after = await h.db
      .selectFrom('contact_access_log')
      .select(['kind', 'link_group_id', 'thread_id'])
      .where('staff_email', '=', journalist)
      .execute();
    const added = after.slice(before.length);
    expect(added).toEqual([
      { kind: 'desk_link', link_group_id: await groupOf(CHECKED), thread_id: null },
      { kind: 'desk_report', link_group_id: null, thread_id: expect.any(String) as string },
    ]);
  });
});

describe("W5 · the desk reads a moderator's note and report links, while the reporter allows it (N3)", () => {
  // Words and addresses that must, or must never, come out of the desk.
  const CLEARED_TEXT = `Cleared-as-written account ${run}: the doors opened late.`;
  const CLEARED_NOTE = `Note ${run}: a reporter says doors opened late.`;
  const REVOKED_NOTE = `REVOKED-NOTE ${run}`;
  const CORRECTED_NOTE = `CORRECTED-OLD-NOTE ${run}`;
  const TIP_NOTE = `Tip note ${run}`;
  const LEGACY_TEXT = `LEGACY-CHECKED-TEXT ${run}`;
  const ORIGINAL = `ORIGINAL-WITH-NAME ${run}: a poll worker named Mary told us to leave.`;
  const COPY = `Redacted copy ${run}: a poll worker [name removed] told us to leave.`;
  const WITHHELD_TEXT = `WITHHELD-TEXT ${run}`;
  const WAITING_TEXT = `WAITING-TEXT ${run}`;
  const UNSHARED_TEXT = `UNSHARED-TEXT ${run}`;
  const REVOKED_TEXT = `REVOKED-TEXT ${run}`;
  const CORRECTED_TEXT = `CORRECTED-OLD-TEXT ${run}`;
  const TIP_TEXT = `Tip description cleared ${run}`;
  const REPORT_LINK = url('report-checked');
  const UNSHARED_LINK = url('report-unshared');
  const UNCHECKED_REPORT_LINK = url('report-unchecked');
  const SHARED_ALSO_TIP = url('shared-also-tip');

  let call: ReturnType<typeof as>;
  let lb: { id: number; slug: string };
  let revoked: Awaited<ReturnType<typeof fileHeld>>;
  let withdrawn: Awaited<ReturnType<typeof fileHeld>>;
  let corrected: Awaited<ReturnType<typeof fileHeld>>;
  let cleared: Awaited<ReturnType<typeof fileHeld>>;

  const ok = async (outcome: 'withheld', ref: string) =>
    checkText(h.db, keys, ref, {
      outcome,
      reason: undefined,
      why: 'Checked for the record.',
      actor: MOD,
    });
  // The only way words reach the desk: a note the moderator wrote.
  const note = async (ref: string, body: string) =>
    redactText(h.db, keys, ref, { body, why: 'Written for the record.', actor: MOD });
  const desk = async (path: string) => {
    const r = await call({ method: 'GET', url: path });
    expect(r.statusCode, r.body).toBe(200);
    return r;
  };
  const texts = async () =>
    (await desk('/api/desk/texts')).json<{
      texts: { text: string; reference: string | null; outcome: string; source: string }[];
    }>().texts;

  beforeAll(async () => {
    call = as(h, await signIn(h, journalist));
    lb = await launchedLogbook(h.db, HELD_QUESTIONS);
    // Shared and checked as written, with a checked link of its own.
    cleared = await fileHeld(
      h.db,
      keys,
      lb,
      { text: { what: CLEARED_TEXT }, links: { links: [REPORT_LINK, UNCHECKED_REPORT_LINK] } },
      { share: true },
    );
    await note(await textRef(h.db, cleared.reportId), CLEARED_NOTE);
    await checkGroup(h.db, keys, await groupOf(REPORT_LINK), { outcome: 'checked', actor: MOD });
    // Shared, checked with redaction: the desk shows only the copy.
    const redacted = await fileHeld(h.db, keys, lb, { text: { what: ORIGINAL } }, { share: true });
    await redactText(h.db, keys, await textRef(h.db, redacted.reportId), {
      body: COPY,
      why: 'Names a private person.',
      actor: MOD,
    });
    // Withheld, waiting, and a report that did not share.
    const w = await fileHeld(h.db, keys, lb, { text: { what: WITHHELD_TEXT } }, { share: true });
    await ok('withheld', await textRef(h.db, w.reportId));
    await fileHeld(h.db, keys, lb, { text: { what: WAITING_TEXT } }, { share: true });
    const unshared = await fileHeld(
      h.db,
      keys,
      lb,
      { text: { what: UNSHARED_TEXT }, links: { links: [UNSHARED_LINK] } },
      { share: false },
    );
    await ok('withheld', await textRef(h.db, unshared.reportId));
    // Checked for safety, though no journalist may ever see it.
    await checkGroup(h.db, keys, await groupOf(UNSHARED_LINK), { outcome: 'checked', actor: MOD });
    // The same address from a tip and from a report that did not share it.
    await tip(SHARED_ALSO_TIP);
    await fileHeld(h.db, keys, lb, { links: { links: [SHARED_ALSO_TIP] } }, { share: false });
    await checkGroup(h.db, keys, await groupOf(SHARED_ALSO_TIP), {
      outcome: 'checked',
      actor: MOD,
    });
    // Checked, then the reporter takes it back / withdraws / corrects.
    revoked = await fileHeld(h.db, keys, lb, { text: { what: REVOKED_TEXT } }, { share: true });
    await note(await textRef(h.db, revoked.reportId), REVOKED_NOTE);
    withdrawn = await fileHeld(
      h.db,
      keys,
      lb,
      { text: { what: `WITHDRAWN ${run}` } },
      { share: true },
    );
    await note(await textRef(h.db, withdrawn.reportId), `WITHDRAWN-NOTE ${run}`);
    corrected = await fileHeld(h.db, keys, lb, { text: { what: CORRECTED_TEXT } }, { share: true });
    await note(await textRef(h.db, corrected.reportId), CORRECTED_NOTE);
    // A tip's description, checked; another not.
    await tip(url('tip-text'));
    await h.db
      .updateTable('list_entries')
      .set({ erasable_answers: { description: TIP_TEXT } })
      .where('id', '=', await tipEntryId())
      .execute();
    await note(`tip-${String(await tipEntryId())}-description`, TIP_NOTE);
    // The retired "checked as written" outcome, as an old row might still hold it.
    const legacy = await fileHeld(h.db, keys, lb, { text: { what: LEGACY_TEXT } }, { share: true });
    const fp = await h.db
      .selectFrom('report_values')
      .select('fingerprint')
      .where('report_id', '=', legacy.reportId)
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('text_items')
      .values({
        source: 'report',
        fingerprint: fp.fingerprint,
        outcome: 'checked',
        checked_at: new Date(),
        checked_by: MOD,
      })
      .execute();
  });

  async function tipEntryId(): Promise<number> {
    // The newest entry of the tips list is the one just filed.
    return (
      await h.db
        .selectFrom('list_entries')
        .select('id')
        .where('list_id', '=', tips.id)
        .orderBy('id', 'desc')
        .executeTakeFirstOrThrow()
    ).id;
  }

  it('shows only notes a moderator wrote, labelled as such, and a tip note', async () => {
    const got = await texts();
    const words = got.map((t) => t.text);
    expect(words).toContain(CLEARED_NOTE);
    expect(words).toContain(COPY);
    expect(words).toContain(TIP_NOTE);
    expect(got.find((t) => t.text === CLEARED_NOTE)).toMatchObject({
      reference: cleared.publicRef,
      outcome: 'redacted',
      source: 'report',
    });
    expect(got.find((t) => t.text === TIP_NOTE)).toMatchObject({ reference: null, source: 'tip' });
    // The reporter's own words never come through, nor an old "checked as written" row.
    for (const never of [CLEARED_TEXT, ORIGINAL, TIP_TEXT, LEGACY_TEXT]) {
      expect(words.join('\n')).not.toContain(never);
    }
  });

  it('J10 · never an original, withheld or unchecked text, an old checked-as-written row, or an unshared report', async () => {
    const body = [
      (await desk('/api/desk/texts')).body,
      (await desk('/api/desk/links')).body,
      (await desk('/api/desk/sources')).body,
    ].join('\n');
    for (const never of [
      ORIGINAL,
      CLEARED_TEXT,
      TIP_TEXT,
      LEGACY_TEXT,
      'Mary',
      WITHHELD_TEXT,
      WAITING_TEXT,
      UNSHARED_TEXT,
      UNSHARED_LINK,
      UNCHECKED_REPORT_LINK,
      TIP_COMMENT,
      TIPSTER,
      MOD,
      'Names a private person',
      'email',
      'thread_id',
      'entry_id',
    ]) {
      expect(body, never).not.toContain(never);
    }
  });

  it('shows a report link that its reporter shared and a moderator checked, counted apart from tips', async () => {
    const links = (await desk('/api/desk/links')).json<{
      links: { url: string; tips: number; reports: number }[];
    }>().links;
    expect(links.find((l) => l.url === REPORT_LINK)).toMatchObject({ tips: 0, reports: 1 });
    // A tip also sent this address; the unshared report's copy is not counted.
    expect(links.find((l) => l.url === SHARED_ALSO_TIP)).toMatchObject({ tips: 1, reports: 0 });
    // A link only an unshared report carries, checked for safety, is not on the desk at all.
    expect(links.find((l) => l.url === UNSHARED_LINK)).toBeUndefined();
  });

  it('logs every text shown before it is read, under the journalist, with no words in the log', async () => {
    const before = await h.db
      .selectFrom('contact_access_log')
      .select('id')
      .where('staff_email', '=', journalist)
      .execute();
    await texts();
    const after = await h.db
      .selectFrom('contact_access_log')
      .select(['kind', 'text_item_id', 'thread_id', 'report_id'])
      .where('staff_email', '=', journalist)
      .orderBy('id')
      .execute();
    const added = after.slice(before.length);
    expect(added.length).toBeGreaterThanOrEqual(3);
    expect(added.every((a) => a.kind === 'desk_text' || a.kind === 'desk_tip_text')).toBe(true);
    expect(added.every((a) => a.text_item_id !== null)).toBe(true);
    expect(JSON.stringify(added)).not.toContain('doors opened');
  });

  it('revoking the permission takes the text and the link off at once', async () => {
    expect((await texts()).map((t) => t.text)).toContain(REVOKED_NOTE);
    await setPermission(h.db, {
      threadId: revoked.threadId,
      permission: 'journalist_sharing',
      granted: false,
    });
    expect((await texts()).map((t) => t.text)).not.toContain(REVOKED_NOTE);
    // And granting it again brings it back: the check was never lost.
    await setPermission(h.db, {
      threadId: revoked.threadId,
      permission: 'journalist_sharing',
      granted: true,
    });
    expect((await texts()).map((t) => t.text)).toContain(REVOKED_NOTE);
    await setPermission(h.db, {
      threadId: cleared.threadId,
      permission: 'journalist_sharing',
      granted: false,
    });
    const links = (await desk('/api/desk/links')).json<{ links: { url: string }[] }>().links;
    expect(links.map((l) => l.url)).not.toContain(REPORT_LINK);
    await setPermission(h.db, {
      threadId: cleared.threadId,
      permission: 'journalist_sharing',
      granted: true,
    });
  });

  it('a withdrawal takes the report’s text off the desk (D2)', async () => {
    expect((await texts()).map((t) => t.text).some((t) => t.startsWith('WITHDRAWN-NOTE'))).toBe(
      true,
    );
    await h.db
      .updateTable('report_heads')
      .set({ withdrawn: true })
      .where('thread_id', '=', withdrawn.threadId)
      .execute();
    expect((await texts()).map((t) => t.text).some((t) => t.startsWith('WITHDRAWN-NOTE'))).toBe(
      false,
    );
  });

  it('a correction that changes the words drops the old clearance until a new note is written (D2)', async () => {
    expect((await texts()).map((t) => t.text)).toContain(CORRECTED_NOTE);
    const next = await fileHeld(
      h.db,
      keys,
      lb,
      { text: { what: `CORRECTED-NEW-TEXT ${run}` } },
      { threadId: corrected.threadId, correctsId: corrected.reportId },
    );
    const after = (await texts()).map((t) => t.text);
    expect(after).not.toContain(CORRECTED_NOTE);
    expect(after).not.toContain(CORRECTED_TEXT);
    await note(await textRef(h.db, next.reportId), `CORRECTED-NEW-NOTE ${run}`);
    expect((await texts()).map((t) => t.text)).toContain(`CORRECTED-NEW-NOTE ${run}`);
  });

  it('erasing the words (illegal) removes them from the desk, and no other route lists them', async () => {
    const victim = await fileHeld(
      h.db,
      keys,
      lb,
      { text: { what: `ILLEGAL-TEXT ${run}` } },
      { share: true },
    );
    const ref = await textRef(h.db, victim.reportId);
    await note(ref, `ILLEGAL-NOTE ${run}`);
    expect((await texts()).some((t) => t.text.startsWith('ILLEGAL-NOTE'))).toBe(true);
    await checkText(h.db, keys, ref, {
      outcome: 'illegal',
      reason: 'other-illegal',
      why: 'Checked for the record.',
      actor: MOD,
    });
    expect((await texts()).some((t) => t.text.startsWith('ILLEGAL-NOTE'))).toBe(false);
    for (const u of ['/api/desk/texts.csv', '/api/desk/texts/all']) {
      expect((await call({ method: 'GET', url: u })).statusCode, u).toBe(404);
    }
  });

  it('a signed-out visitor and a moderator are refused the text route', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/desk/texts' })).statusCode).toBe(401);
    expect((await admin.call({ method: 'GET', url: '/api/desk/texts' })).statusCode).toBe(403);
  });
});

describe('J13 · the owner revokes, effective on the next request', () => {
  it('the same session is refused straight after', async () => {
    const call = as(h, await signIn(h, journalist));
    expect((await call({ method: 'GET', url: '/api/desk/links' })).statusCode).toBe(200);
    const id = await requestId(journalist);
    const r = await owner.call({
      method: 'POST',
      url: `/api/owner/journalists/${String(id)}/revoke`,
    });
    expect(r.statusCode, r.body).toBe(200);
    const next = await call({ method: 'GET', url: '/api/desk/links' });
    expect(next.statusCode).toBe(403);
    expect(next.body).not.toContain(CHECKED);
    expect(await roleOf(h.db, journalist)).toBe('user');
    const audit = await h.db
      .selectFrom('role_audit')
      .select(['action', 'detail'])
      .where('subject_email', '=', journalist)
      .execute();
    expect(audit).toContainEqual({ action: 'revoke', detail: 'journalist' });
  });
});

/** Subscribe, ask, approve, sign in and accept: a journalist reading the desk. */
async function deskJournalist(email: string) {
  await subscribe(email);
  const sent = await h.app.inject({
    method: 'POST',
    url: `/api/journalists/access/${await askLink(email)}`,
    payload: REQUEST,
  });
  expect(sent.json()).toMatchObject({ state: 'pending' });
  const approve = await owner.call({
    method: 'POST',
    url: `/api/owner/journalists/${String(await requestId(email))}/approve`,
  });
  expect(approve.statusCode, approve.body).toBe(200);
  const call = as(h, await signIn(h, email));
  const state = await call({ method: 'GET', url: '/api/agreement/journalist' });
  const digest = state.json<{ current: { digest: string } }>().current.digest;
  await call({ method: 'POST', url: '/api/agreement/journalist/accept', payload: { digest } });
  expect((await call({ method: 'GET', url: '/api/desk/links' })).statusCode).toBe(200);
  return call;
}

/** The token an alert email carries, for this subscriber. */
async function alertToken(email: string) {
  const sub = await h.db
    .selectFrom('journalist_subscribers')
    .select('id')
    .where('email_hmac', '=', emailDigest(ring, email))
    .executeTakeFirstOrThrow();
  return issueLink(h.db, sub.id, 'stop');
}

const subscriberOf = (email: string) =>
  h.db
    .selectFrom('journalist_subscribers')
    .select(['status', 'states', 'alerts_paused_at'])
    .where('email_hmac', '=', emailDigest(ring, email))
    .executeTakeFirst();

const auditOf = (email: string) =>
  h.db
    .selectFrom('role_audit')
    .select(['action', 'detail', 'actor_email'])
    .where('subject_email', '=', email)
    .orderBy('id')
    .execute();

describe('decision 47 · alerts are a setting; turning them off keeps the desk', () => {
  const pauser = address('pauser');
  let call: Awaited<ReturnType<typeof deskJournalist>>;
  let token = '';
  beforeAll(async () => {
    call = await deskJournalist(pauser);
    token = await alertToken(pauser);
  });

  it('the stop link pauses alerts: the role, the request and the desk all stay', async () => {
    const audit = await auditOf(pauser);
    const stop = await h.app.inject({ method: 'POST', url: `/api/journalists/stop/${token}` });
    expect(stop.json()).toMatchObject({ state: 'paused' });
    expect(await subscriberOf(pauser)).toMatchObject({ status: 'active' });
    expect((await subscriberOf(pauser))?.alerts_paused_at).toBeInstanceOf(Date);
    expect(await roleOf(h.db, pauser)).toBe('journalist');
    expect(await auditOf(pauser)).toEqual(audit);
    expect((await call({ method: 'GET', url: '/api/desk/links' })).statusCode).toBe(200);
    expect((await call({ method: 'GET', url: '/api/desk/sources' })).statusCode).toBe(200);
    // The J7a access link still finds the approved request while paused.
    const access = await h.app.inject({
      method: 'GET',
      url: `/api/journalists/access/${await askLink(pauser)}`,
    });
    expect(access.json()).toMatchObject({ state: 'approved' });
  });

  it('the desk shows their own settings, and GET changes nothing', async () => {
    const before = await subscriberOf(pauser);
    for (let i = 0; i < 2; i++) {
      const r = await call({ method: 'GET', url: '/api/desk/alerts' });
      expect(r.json()).toMatchObject({ state: 'open', states: ['US-AZ'], alerts: 'off' });
    }
    expect(await subscriberOf(pauser)).toEqual(before);
  });

  it('from the desk: resume and change states, checked as on signup; no email needed', async () => {
    const mails = h.mailer.messages.length;
    const bad = await call({
      method: 'POST',
      url: '/api/desk/alerts',
      payload: { states: ['US-ZZ'], alerts: 'on' },
    });
    expect(bad.statusCode).toBe(400);
    expect((await subscriberOf(pauser))?.alerts_paused_at).toBeInstanceOf(Date);
    const r = await call({
      method: 'POST',
      url: '/api/desk/alerts',
      payload: { states: ['US-NV', 'US-AZ'], alerts: 'on' },
    });
    expect(r.json()).toMatchObject({ state: 'open', states: ['US-AZ', 'US-NV'], alerts: 'on' });
    expect(await subscriberOf(pauser)).toMatchObject({
      states: ['US-AZ', 'US-NV'],
      alerts_paused_at: null,
    });
    const off = await call({
      method: 'POST',
      url: '/api/desk/alerts',
      payload: { states: ['US-AZ'], alerts: 'off' },
    });
    expect(off.json()).toMatchObject({ alerts: 'off' });
    expect(await roleOf(h.db, pauser)).toBe('journalist');
    expect(h.mailer.messages.length).toBe(mails);
  });

  it('no other role reaches the desk’s alert settings', async () => {
    for (const role of ['moderator', 'admin', 'access_manager'] as const) {
      const who = address(`desk-alerts-${role}`);
      await seat(h.db, who, role);
      const other = as(h, await signIn(h, who));
      for (const method of ['GET', 'POST'] as const) {
        const r = await other({
          method,
          url: '/api/desk/alerts',
          ...(method === 'POST' ? { payload: { states: ['US-AZ'], alerts: 'on' } } : {}),
        });
        expect(r.statusCode, `${role} ${method}`).toBe(403);
      }
    }
    expect((await h.app.inject({ method: 'GET', url: '/api/desk/alerts' })).statusCode).toBe(401);
  });

  it('opening the change link changes nothing; "remove me entirely" ends the desk (decision 46)', async () => {
    const before = await subscriberOf(pauser);
    const look = await h.app.inject({ method: 'GET', url: `/api/journalists/settings/${token}` });
    expect(look.json()).toMatchObject({ state: 'open', alerts: 'off' });
    expect(await subscriberOf(pauser)).toEqual(before);
    expect(await roleOf(h.db, pauser)).toBe('journalist');

    const gone = await h.app.inject({
      method: 'POST',
      url: `/api/journalists/settings/${token}/remove`,
    });
    expect(gone.json()).toEqual({ state: 'removed' });
    expect(await subscriberOf(pauser)).toBeUndefined();
    const next = await call({ method: 'GET', url: '/api/desk/links' });
    expect(next.statusCode).toBe(403);
    expect(next.body).not.toContain(CHECKED);
    expect((await call({ method: 'GET', url: '/api/desk/alerts' })).statusCode).toBe(403);
    expect(await roleOf(h.db, pauser)).toBe('user');
    expect((await auditOf(pauser)).at(-1)).toEqual({
      action: 'revoke',
      detail: 'journalist',
      actor_email: pauser,
    });
  });
});

describe('decision 46 · removing yourself from the alert list closes the desk', () => {
  it('a journalist role with no approved request behind it is refused by the guard', async () => {
    // A role left behind by a path that forgot: the second line still holds.
    const stray = address('stray-journalist');
    await seat(h.db, stray, 'journalist');
    const call = as(h, await signIn(h, stray));
    const r = await call({ method: 'GET', url: '/api/desk/links' });
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: { code: string } }>().error.code).toBe('desk_access_ended');
  });
});

describe('decision 69 · one sign-up for alerts, desk access, or both', () => {
  const DESK_ONLY = {
    role: 'SIGNUP-ROLE',
    about: 'Pat, covering the courts. https://x.example/pat',
  };
  const fromSettings = address('asks-from-settings');
  const signUp = (payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'POST',
      url: '/api/journalists/signup',
      remoteAddress: fromNewClient(),
      payload,
    });
  const queue = async () =>
    (await owner.call({ method: 'GET', url: '/api/owner/journalists' })).json<{
      requests: { id: number; role: string; outlet: string; status: string }[];
    }>().requests;

  it('refuses a sign-up asking for nothing, a request with no outlet, and alerts with no states', async () => {
    const email = address('asks-nothing');
    const cases = [
      { name: 'Pat', email, alerts: 'off', states: [] },
      { name: 'Pat', email, alerts: 'off', states: [], access: DESK_ONLY },
      { name: 'Pat', email, alerts: 'on', states: [] },
    ];
    const codes = [];
    for (const payload of cases) {
      const r = await signUp(payload);
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
      codes.push(r.json<{ error: { code: string } }>().error.code);
    }
    expect(codes).toEqual(['nothing_asked', 'no_outlet', 'bad_states']);
    expect(await subscriberOf(email)).toBeUndefined();
  });

  it('desk only: no alerts, no states, and the request waits for the address to be confirmed', async () => {
    const email = address('desk-only');
    const r = await signUp({
      name: 'Pat',
      email,
      outlet: 'Courts Weekly',
      alerts: 'off',
      states: [],
      access: DESK_ONLY,
    });
    expect(r.statusCode, r.body).toBe(200);
    const row = await subscriberOf(email);
    expect(row).toMatchObject({ status: 'pending', states: [] });
    expect(row?.alerts_paused_at).toBeInstanceOf(Date);
    const mail = h.mailer.lastTo(email)?.text ?? '';
    expect(mail).toContain('request for access to the journalist desk');

    // Unconfirmed, it may not even be theirs: not in the queue, and not decidable.
    expect((await queue()).map((q) => q.role)).not.toContain('SIGNUP-ROLE');
    const id = await requestId(email);
    const early = await owner.call({
      method: 'POST',
      url: `/api/owner/journalists/${String(id)}/approve`,
    });
    expect(early.statusCode).toBe(404);

    const token = tokenIn('confirm', mail);
    const look = await h.app.inject({ method: 'GET', url: `/api/journalists/confirm/${token}` });
    expect(look.json()).toMatchObject({ state: 'pending', alerts: 'off', desk: 'pending' });
    const done = await h.app.inject({ method: 'POST', url: `/api/journalists/confirm/${token}` });
    expect(done.json()).toMatchObject({ state: 'confirmed', desk: 'pending' });
    // Confirming keeps alerts off, and puts the request in front of the owner.
    expect((await subscriberOf(email))?.alerts_paused_at).toBeInstanceOf(Date);
    expect(await queue()).toContainEqual(
      expect.objectContaining({
        id,
        role: 'SIGNUP-ROLE',
        outlet: 'Courts Weekly',
        status: 'pending',
      }),
    );
    expect(await roleOf(h.db, email)).toBeUndefined();
  });

  it('an address already listed that ticks the box is emailed the request link; the answer is the same', async () => {
    const email = address('listed-then-asks');
    await subscribe(email);
    const r = await signUp({
      name: 'Pat',
      email,
      outlet: 'Courts Weekly',
      states: ['US-AZ'],
      access: DESK_ONLY,
    });
    expect(r.json()).toEqual({ ok: true });
    const token = tokenIn('access', h.mailer.lastTo(email)?.text ?? '');
    const look = await h.app.inject({ method: 'GET', url: `/api/journalists/access/${token}` });
    expect(look.json()).toMatchObject({ state: 'open' });
  });

  it('the change page behind every alert asks for desk access, once, and says where it stands', async () => {
    const email = fromSettings;
    await subscribe(email);
    const token = await alertToken(email);
    const at = `/api/journalists/settings/${token}`;
    expect((await h.app.inject({ method: 'GET', url: at })).json()).toMatchObject({
      state: 'open',
      desk: 'none',
    });
    const sent = await h.app.inject({
      method: 'POST',
      url: `${at}/access`,
      payload: { ...REQUEST, role: 'FROM-SETTINGS' },
    });
    expect(sent.json()).toMatchObject({ state: 'open', desk: 'pending' });
    // A second one does not replace the first.
    await h.app.inject({
      method: 'POST',
      url: `${at}/access`,
      payload: { ...REQUEST, role: 'SECOND-TRY' },
    });
    const roles = (await queue()).map((q) => q.role);
    expect(roles).toContain('FROM-SETTINGS');
    expect(roles).not.toContain('SECOND-TRY');
    const bad = await h.app.inject({
      method: 'POST',
      url: `/api/journalists/settings/${'0'.repeat(64)}/access`,
      payload: REQUEST,
    });
    expect(bad.json()).toEqual({ state: 'gone' });

    // Alerts off may cover no states; alerts on still needs one.
    const off = await h.app.inject({
      method: 'POST',
      url: at,
      payload: { alerts: 'off', states: [] },
    });
    expect(off.json()).toMatchObject({ state: 'open', alerts: 'off', states: [], desk: 'pending' });
    const on = await h.app.inject({
      method: 'POST',
      url: at,
      payload: { alerts: 'on', states: [] },
    });
    expect(on.statusCode).toBe(400);
  });

  it('the database refuses alerts that are on with no states', async () => {
    const email = fromSettings;
    await expect(
      h.db
        .updateTable('journalist_subscribers')
        .set({ alerts_paused_at: null })
        .where('email_hmac', '=', emailDigest(ring, email))
        .execute(),
    ).rejects.toThrow(/journalist_subscribers_alerts_need_states/);
  });
});
