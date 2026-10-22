/**
 * Filing from outside the site password, end to end, with the real routes.
 *
 * Workstream A's doors.test.ts proves the gate lets the agreed patterns
 * through. This proves the other half: that the real filing routes at those
 * patterns actually file a report and confirm it with the password ON, and
 * that nothing else filing serves (My reports, coordinator intake, the
 * switch) comes through with them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/identity/secrets.ts';
import { launchedLogbook } from './helpers.ts';
import { confirm, filingHarness, look, send, spine, tokenFor } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { address, liftCurtain } from './identity-helpers.ts';

let h: FilingHarness;
let outside: { id: number; slug: string };
let inside: { id: number; slug: string };

const isLocked = (r: { status: number; body: Record<string, unknown> }) =>
  r.status === 401 && (r.body.error as { code?: string } | undefined)?.code === 'locked';

beforeAll(async () => {
  h = await filingHarness();
  const qs = [{ key: 'what', kind: 'short_text', label: 'What?', required: true }];
  outside = await launchedLogbook(h.db, qs);
  inside = await launchedLogbook(h.db, qs);
  await h.db
    .updateTable('logbooks')
    .set({ outside_access: 'link' })
    .where('id', '=', outside.id)
    .execute();
  await h.db
    .updateTable('site_access')
    .set({ enabled: true, password_hash: await hashPassword('filing-doors-password') })
    .where('id', '=', true)
    .execute();
});
afterAll(async () => {
  await h.db
    .updateTable('logbooks')
    .set({ outside_access: 'closed' })
    .where('id', '=', outside.id)
    .execute();
  await liftCurtain(h.db);
  await h.close();
});

const get = async (url: string) => {
  const r = await h.app.inject({ method: 'GET', url });
  return { status: r.statusCode, body: r.json<Record<string, unknown>>() };
};

describe('a logbook opened outside the password', () => {
  it('serves its form and the card, files a report and confirms it, all without the password', async () => {
    expect((await get(`/api/logbooks/${outside.slug}`)).status).toBe(200);
    expect((await get('/api/publication-card')).status).toBe(200);

    const email = address('door');
    const sent = await send(h, {
      ...spine(email),
      logbook: outside.slug,
      answers: { what: 'Outside' },
    });
    expect(sent.status).toBe(200);
    const token = tokenFor(h.mailer, email) ?? '';
    expect((await look(h, token)).body.confirmation).toMatchObject({ state: 'unconfirmed' });
    const done = await confirm(h, token);
    expect(done.body.just_confirmed).toBe(true);
    expect(done.body.confirmation.public_ref).toMatch(/^RL-/);
  });

  it('carries the emergency notice with the form, since a door may not ask for the wording (decision 62)', async () => {
    const shipped = (await get(`/api/logbooks/${outside.slug}`)).body.help_now;
    expect(shipped).toBe(
      'This is a record, not an emergency line. If you or someone else is in danger, call your local emergency number.',
    );
    // The site's wording itself stays behind the password.
    expect(isLocked(await get('/api/site'))).toBe(true);
    await h.db
      .insertInto('site_copy')
      .values({ key: 'help_now', body: 'Call 911 first. This page is not watched.' })
      .execute();
    try {
      expect((await get(`/api/logbooks/${outside.slug}`)).body.help_now).toBe(
        'Call 911 first. This page is not watched.',
      );
    } finally {
      await h.db.deleteFrom('site_copy').where('key', '=', 'help_now').execute();
    }
  });

  it('but not a logbook that is not opened outside', async () => {
    const r = await send(h, {
      ...spine(address('in')),
      logbook: inside.slug,
      answers: { what: 'x' },
    });
    expect(isLocked(r)).toBe(true);
  });

  it('says whether the site is taking reports, so the form can say so on its first card', async () => {
    const r = await get('/api/intake-switch');
    expect(r.status).toBe(200);
  });

  it('and nothing else filing serves', async () => {
    expect(isLocked(await get('/api/mine/reports'))).toBe(true);
    expect(isLocked(await get('/api/intake/organizations'))).toBe(true);
    expect(isLocked(await get('/api/admin/intake-switch'))).toBe(true);
  });

  it('closing the door closes filing, but a reporter who sent while it was open can still confirm', async () => {
    const email = address('before-shut');
    const sent = await send(h, {
      ...spine(email),
      logbook: outside.slug,
      answers: { what: 'Sent while open' },
    });
    expect(sent.status).toBe(200);
    const token = tokenFor(h.mailer, email) ?? '';

    await h.db
      .updateTable('logbooks')
      .set({ outside_access: 'closed' })
      .where('id', '=', outside.id)
      .execute();
    const r = await send(h, {
      ...spine(address('shut')),
      logbook: outside.slug,
      answers: { what: 'x' },
    });
    expect(isLocked(r)).toBe(true);
    // The link that was emailed still works: the token is the reporter's proof.
    expect((await look(h, token)).body.confirmation).toMatchObject({ state: 'unconfirmed' });
    expect((await confirm(h, token)).body.just_confirmed).toBe(true);
    // A token that names no submission is refused like anything else behind the
    // password, so the gate gives nothing away about which tokens exist.
    expect(isLocked(await look(h, 'f'.repeat(64)))).toBe(true);
    expect(isLocked(await get('/api/intake-switch'))).toBe(true);
    await h.db
      .updateTable('logbooks')
      .set({ outside_access: 'link' })
      .where('id', '=', outside.id)
      .execute();
  });
});
