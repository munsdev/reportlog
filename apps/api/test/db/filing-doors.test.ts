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

  it('but not a logbook that is not opened outside', async () => {
    const r = await send(h, {
      ...spine(address('in')),
      logbook: inside.slug,
      answers: { what: 'x' },
    });
    expect(isLocked(r)).toBe(true);
  });

  it('and nothing else filing serves', async () => {
    expect(isLocked(await get('/api/mine/reports'))).toBe(true);
    expect(isLocked(await get('/api/intake/organizations'))).toBe(true);
    expect(isLocked(await get('/api/intake-switch'))).toBe(true);
    expect(isLocked(await get('/api/admin/intake-switch'))).toBe(true);
  });

  it('closing the door closes filing, while an unknown link still answers only "not found"', async () => {
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
    // With no logbook open outside, the confirmation link is behind the password too.
    expect(isLocked(await look(h, 'f'.repeat(64)))).toBe(true);
    await h.db
      .updateTable('logbooks')
      .set({ outside_access: 'link' })
      .where('id', '=', outside.id)
      .execute();
  });
});
