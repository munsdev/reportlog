/**
 * The menu's waiting totals (`GET /api/menu/waiting`, stage 3 navigation):
 * who gets which number, that each number is the one its own screen shows,
 * and that it carries nothing but numbers.
 *
 * ITS OWN DATABASE, like platform.test.ts: one case publishes a moderator
 * agreement, which is global and append-only and would shut every moderator
 * route in the database the other files share. Its own database also lets
 * the totals be checked exactly.
 */
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { createDatabase } from '../../src/db/database.ts';
import { migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import type { Throwaway } from '../../src/db/throwaway.ts';
import { QUESTIONS, launchedLogbook } from './helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';
import { approve, fileThread, moderationHarness, staff } from './moderation-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';

let throwaway: Throwaway;
let h: FilingHarness;
let lb: { id: number; slug: string };
type Caller = Awaited<ReturnType<typeof staff>>;
let mod: Caller;
let admin: Caller;
let owner: Caller;
let am: Caller;
let journalist: Caller;
let plain: Caller;
let tester: Caller;

const waiting = async (who: Caller) => {
  const res = await who.call({ method: 'GET', url: '/api/menu/waiting' });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Record<string, number>>();
};

/** What the moderation queue itself lists by default (Waiting for a moderator). */
const queueWaiting = async (who: Caller) => {
  const res = await who.call({ method: 'GET', url: '/api/moderation/reports?status=pending' });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ reports: unknown[] }>().reports.length;
};

beforeAll(async () => {
  throwaway = await createThrowawayDatabase(inject('serverUrl'), 'menu');
  await migrate(throwaway.url);
  h = await moderationHarness(createDatabase(throwaway.url, 10));
  lb = await launchedLogbook(h.db, QUESTIONS);
  mod = await staff(h, 'menu-mod', 'moderator');
  admin = await staff(h, 'menu-admin', 'admin');
  owner = await staff(h, 'menu-owner', 'owner');
  am = await staff(h, 'menu-am', 'access_manager');
  journalist = await staff(h, 'menu-journalist', 'journalist');
  plain = await staff(h, 'menu-plain', 'user');
  tester = await staff(h, 'menu-tester', 'user');
  await h.db
    .updateTable('users')
    .set({ is_tester: true })
    .where('email', '=', tester.email)
    .execute();

  // Three reports waiting, one approved, one declined, one waiting but withdrawn.
  for (const n of [1, 2, 3]) await fileThread(h.db, lb, QUESTIONS, { what: `waiting ${n}` });
  await approve(h.db, (await fileThread(h.db, lb, QUESTIONS, { what: 'approved' })).threadId);
  const declined = await fileThread(h.db, lb, QUESTIONS, { what: 'declined' });
  await h.db
    .updateTable('report_heads')
    .set({ moderation_status: 'invalid' })
    .where('thread_id', '=', declined.threadId)
    .execute();
  const withdrawn = await fileThread(h.db, lb, QUESTIONS, { what: 'withdrawn' });
  await h.db
    .updateTable('report_heads')
    .set({ withdrawn: true })
    .where('thread_id', '=', withdrawn.threadId)
    .execute();

  // Two list entries waiting for review and one reviewed.
  const reviewer = await seat(h.db, address('menu-reviewer'), 'moderator');
  const list = await h.db
    .insertInto('lists')
    .values({ slug: `menu-list-${String(Date.now())}`, title: 'Menu test list' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await h.db
    .insertInto('list_entries')
    .values([
      { list_id: list.id },
      { list_id: list.id },
      {
        list_id: list.id,
        review_state: 'approved',
        reviewed_at: new Date(),
        reviewed_by: reviewer,
      },
    ])
    .execute();

  // Four tip links unchecked, one checked.
  await h.db
    .insertInto('link_groups')
    .values([
      {},
      {},
      {},
      {},
      { outcome: 'checked', checked_at: new Date(), checked_by: 'someone@example.org' },
    ])
    .execute();

  // Feedback: two open, one fixed.
  const submitter = await seat(h.db, address('menu-fb'), 'user');
  const issue = {
    type: 'bug',
    severity: 'minor',
    title: 'A thing',
    body: 'It broke when I pressed it.',
  };
  await h.db
    .insertInto('feedback')
    .values([
      { ...issue, submitter_id: submitter },
      { ...issue, submitter_id: submitter, status: 'need_info' },
      { ...issue, submitter_id: submitter, status: 'fixed' },
    ])
    .execute();
});
afterAll(async () => {
  await h.close();
  await throwaway.drop();
});

describe('GET /api/menu/waiting', () => {
  it('refuses a stranger', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/menu/waiting' });
    expect(res.statusCode).toBe(401);
  });

  it('gives somebody with no role and no flag nothing at all, not zeros', async () => {
    expect(await waiting(plain)).toEqual({});
    expect(await waiting(journalist)).toEqual({});
  });

  it('gives a moderator the queue, list review and tip links, and not feedback', async () => {
    expect(await waiting(mod)).toEqual({ reports: 3, list_entries: 2, tip_links: 4 });
  });

  it('the report count is the queue’s own count of reports waiting for a moderator', async () => {
    const shown = await waiting(mod);
    expect(shown.reports).toBe(await queueWaiting(mod));
    // And it follows a decision.
    const one = await fileThread(h.db, lb, QUESTIONS, { what: 'one more' });
    expect((await waiting(mod)).reports).toBe(4);
    await approve(h.db, one.threadId);
    expect((await waiting(mod)).reports).toBe(3);
    expect(await queueWaiting(mod)).toBe(3);
  });

  it('gives an administrator and the owner everything; admin does not need the moderator role here', async () => {
    const all = { reports: 3, list_entries: 2, tip_links: 4, feedback: 2 };
    expect(await waiting(admin)).toEqual(all);
    expect(await waiting(owner)).toEqual(all);
  });

  it('gives an Access Manager and a tester only the open feedback', async () => {
    expect(await waiting(am)).toEqual({ feedback: 2 });
    expect(await waiting(tester)).toEqual({ feedback: 2 });
  });

  it('holds nothing but numbers', async () => {
    const res = await admin.call({ method: 'GET', url: '/api/menu/waiting' });
    for (const v of Object.values(res.json<Record<string, unknown>>()))
      expect(typeof v).toBe('number');
    expect(res.body).not.toMatch(/RL-|@|http/);
  });

  it('a role holder who has not proved a second factor acts with no role, so gets nothing', async () => {
    const email = address('menu-mod-2fa');
    await seat(h.db, email, 'moderator');
    // signIn marks the factor proved; this session is then made unproved again.
    const session = await signIn(h, email);
    await h.db
      .updateTable('sessions')
      .set({ second_factor_at: null })
      .where(
        'user_id',
        '=',
        (
          await h.db
            .selectFrom('users')
            .select('id')
            .where('email', '=', email)
            .executeTakeFirstOrThrow()
        ).id,
      )
      .execute();
    const res = await as(h, session)({ method: 'GET', url: '/api/menu/waiting' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it('a moderator who has not accepted a published agreement is told no queue or list totals', async () => {
    const pub = await admin.call({
      method: 'POST',
      url: '/api/admin/agreement/moderator',
      payload: { body: 'I will not read contact details without need.' },
    });
    expect(pub.statusCode, pub.body).toBe(200);
    // The queue refuses them, and so does the menu's total.
    expect((await mod.call({ method: 'GET', url: '/api/moderation/reports' })).statusCode).toBe(
      403,
    );
    expect(await waiting(mod)).toEqual({ tip_links: 4 });
    const state = (await mod.call({ method: 'GET', url: '/api/agreement/moderator' })).json<{
      current: { digest: string };
    }>();
    const accepted = await mod.call({
      method: 'POST',
      url: '/api/agreement/moderator/accept',
      payload: { digest: state.current.digest },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(await waiting(mod)).toEqual({ reports: 3, list_entries: 2, tip_links: 4 });
  });
});
