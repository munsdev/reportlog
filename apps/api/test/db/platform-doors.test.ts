/**
 * Door rules for the two links Plan D emails (item 14): the erase link in the
 * confirmation email and the status link for a notice of illegal content.
 * With the site password ON, each passes on its own token and nothing else
 * does: the public form itself, the terms API, a wrong token.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/identity/secrets.ts';
import { send, spine, tokenFor, filingHarness } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address, liftCurtain } from './identity-helpers.ts';

let h: FilingHarness;
let slug: string;

const locked = (r: { statusCode: number; body: string }) =>
  r.statusCode === 401 && r.body.includes('"locked"');

beforeAll(async () => {
  h = await filingHarness();
  const lb = await launchedLogbook(h.db, [
    { key: 'what', kind: 'short_text', label: 'What?', required: true },
  ]);
  slug = lb.slug;
  await h.db
    .updateTable('logbooks')
    .set({ outside_access: 'link' })
    .where('id', '=', lb.id)
    .execute();
  await h.db
    .updateTable('site_access')
    .set({ enabled: true, password_hash: await hashPassword('platform-doors-password') })
    .where('id', '=', true)
    .execute();
});
afterAll(async () => {
  await liftCurtain(h.db);
  await h.close();
});

describe('the emailed links, with the site password on', () => {
  it('the erase link looks and presses on its token alone; a wrong token is locked', async () => {
    const email = address('door-erase');
    await send(h, { ...spine(email), logbook: slug, answers: { what: 'Outside' } });
    const text = h.mailer.lastTo(email)?.text ?? '';
    const token = /\/file\/erase\/([0-9a-f]{64})/.exec(text)?.[1] ?? '';
    expect(token).toBe(tokenFor(h.mailer, email));
    expect((await h.app.inject({ method: 'GET', url: `/api/erase/${token}` })).statusCode).toBe(
      200,
    );
    expect(locked(await h.app.inject({ method: 'GET', url: `/api/erase/${'0'.repeat(64)}` }))).toBe(
      true,
    );
    expect(
      locked(
        await h.app.inject({
          method: 'POST',
          url: `/api/erase/${'0'.repeat(64)}`,
          payload: { confirm: true },
        }),
      ),
    ).toBe(true);
  });

  it('the notice status link passes on its token; the form that makes one is behind the password', async () => {
    // The form is for the open site: behind the password it is locked, like the rest of the public side.
    const form = await h.app.inject({
      method: 'POST',
      url: '/api/illegal-content',
      payload: { where_found: 'x', explanation: 'y', good_faith: true },
    });
    expect(locked(form)).toBe(true);
    // A notice made while the site was open: its status link works on the token.
    const token = 'a1'.repeat(32);
    const { createHash } = await import('node:crypto');
    await h.db
      .insertInto('content_notices')
      .values({
        receipt: 'IC-DOORTEST',
        token_hash: createHash('sha256').update(token).digest('hex'),
        where_found: 'x',
        explanation: 'y',
        good_faith: true,
      })
      .execute();
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/illegal-content/status/${token}` }))
        .statusCode,
    ).toBe(200);
    expect(
      locked(
        await h.app.inject({ method: 'GET', url: `/api/illegal-content/status/${'0'.repeat(64)}` }),
      ),
    ).toBe(true);
  });

  it('the agreement and the staff notice calls stay behind the password', async () => {
    for (const [method, url] of [
      ['GET', '/api/agreement/moderator'],
      ['GET', '/api/moderation/illegal-content'],
    ] as const) {
      expect(locked(await h.app.inject({ method, url })), url).toBe(true);
    }
  });
});
