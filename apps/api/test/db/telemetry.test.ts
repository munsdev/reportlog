/**
 * Error tracking through the whole application: which errors are reported,
 * the website's relay, and both in front of the site password.
 *
 * Bugsink is a stand-in on loopback (test/stand-in-bugsink.ts), so what
 * reaches it is exactly what would have left the server.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { hashPassword } from '../../src/identity/secrets.ts';
import { RELAY_BODY_LIMIT, RELAY_PER_MINUTE } from '../../src/telemetry/routes.ts';
import { createErrorTracker } from '../../src/telemetry/tracker.ts';
import type { ErrorTracker } from '../../src/telemetry/tracker.ts';
import { standInBugsink } from '../stand-in-bugsink.ts';
import type { StandInBugsink } from '../stand-in-bugsink.ts';
import { testDatabase } from './helpers.ts';
import { liftCurtain } from './identity-helpers.ts';

const TOKEN = 'k3Jd9QwPz7XvB2nM8rT5yL1aF4hS6uE0';
const db = testDatabase();
let bugsink: StandInBugsink;
let tracker: ErrorTracker;
let app: FastifyInstance;
let off: FastifyInstance;

function envelope(value: string) {
  return [
    JSON.stringify({ event_id: 'e'.repeat(32) }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify({
      event_id: 'e'.repeat(32),
      platform: 'javascript',
      exception: { values: [{ type: 'Error', value }] },
      request: { url: `http://127.0.0.1:4173/file/x?token=${TOKEN}` },
      user: { ip_address: '{{auto}}' },
    }),
  ].join('\n');
}

const relay = (a: FastifyInstance, body: string, contentType = 'text/plain;charset=UTF-8') =>
  a.inject({
    method: 'POST',
    url: '/api/telemetry/errors',
    headers: { 'content-type': contentType, 'x-forwarded-for': '203.0.113.9' },
    payload: body,
  });

/** Events received since `from`, parsed. */
const eventsSince = (from: number) =>
  bugsink.received.slice(from).map((r) => r.items[2] as Record<string, unknown>);

beforeAll(async () => {
  bugsink = await standInBugsink();
  tracker = createErrorTracker({
    config: { ERROR_TRACKING_DSN: bugsink.dsn, ERROR_TRACKING_ENVIRONMENT: 'test' },
  });
  app = await buildApp({ config: { LOG_LEVEL: 'silent' }, db, errors: tracker });
  // A route that fails the way a bug does, with a token in its address and
  // a body that must never travel.
  app.post('/api/telemetry-test/:token', () => {
    throw new Error('the database said no');
  });
  app.get('/api/telemetry-test-refusal', () => {
    throw new (class extends Error {
      statusCode = 400;
    })('the caller sent nonsense');
  });
  app.post(
    '/api/telemetry-test-validation',
    { schema: { body: z.object({ n: z.number() }) } },
    () => ({}),
  );
  off = await buildApp({ config: { LOG_LEVEL: 'silent' }, db });
});

afterAll(async () => {
  await liftCurtain(db);
  await app.close();
  await off.close();
  await bugsink.close();
  await db.destroy();
});

describe("the server's own errors", () => {
  it('reports an unexpected one by route pattern, without the address or the body', async () => {
    const from = bugsink.received.length;
    const res = await app.inject({
      method: 'POST',
      url: `/api/telemetry-test/${TOKEN}?again=${TOKEN}`,
      headers: { 'x-forwarded-for': '203.0.113.9', cookie: 'rl_session=secret' },
      payload: { what: 'what the reporter typed' },
    });
    expect(res.statusCode).toBe(500);
    await tracker.flush(5000);
    const [event] = eventsSince(from);
    expect(event).toMatchObject({
      platform: 'node',
      tags: { side: 'api', method: 'POST', route: '/api/telemetry-test/:token' },
      exception: { values: [{ type: 'Error', value: 'the database said no' }] },
    });
    const sent = JSON.stringify(bugsink.received.slice(from));
    for (const never of [TOKEN, '203.0.113.9', 'what the reporter typed', 'rl_session']) {
      expect(sent).not.toContain(never);
    }
  });

  it('does not report a refusal: a 404 sentence, a validation error, a 4xx', async () => {
    const from = bugsink.received.length;
    expect(
      (await app.inject({ method: 'GET', url: '/api/reports/RL-NOPE/verify' })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/telemetry-test-refusal' })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/telemetry-test-validation',
          payload: { n: 'x' },
        })
      ).statusCode,
    ).toBe(400);
    await tracker.flush(2000);
    expect(bugsink.received.slice(from)).toEqual([]);
  });
});

describe("the website's relay", () => {
  it('says whether error tracking is on', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/telemetry' })).json()).toEqual({
      errors: true,
    });
    expect((await off.inject({ method: 'GET', url: '/api/telemetry' })).json()).toEqual({
      errors: false,
    });
  });

  it('is closed when error tracking is off', async () => {
    const res = await relay(off, envelope('boom'));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'not_found', message: 'Error tracking is off on this site.' },
    });
  });

  it('passes one cleaned error on, whichever way the SDK names the body', async () => {
    const from = bugsink.received.length;
    for (const type of ['text/plain;charset=UTF-8', 'application/x-sentry-envelope']) {
      const res = await relay(app, envelope(`failed at https://x.example/?token=${TOKEN}`), type);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ relayed: true });
    }
    await tracker.flush(5000);
    const events = eventsSince(from);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      platform: 'javascript',
      tags: { side: 'website' },
      exception: { values: [{ value: 'failed at [address]' }] },
    });
    const sent = JSON.stringify(bugsink.received.slice(from));
    expect(sent).not.toContain(TOKEN);
    expect(sent).not.toContain('203.0.113.9');
    expect(sent).not.toContain('{{auto}}');
    for (const r of bugsink.received.slice(from)) {
      expect(Object.keys(r.headers)).not.toContain('x-forwarded-for');
    }
  });

  it('accepts what is not an error without passing it on', async () => {
    const from = bugsink.received.length;
    const res = await relay(app, 'garbage');
    expect(res.json()).toEqual({ relayed: false });
    await tracker.flush(1000);
    expect(bugsink.received.slice(from)).toEqual([]);
  });

  it('refuses a body larger than one error', async () => {
    const res = await relay(app, envelope('x'.repeat(RELAY_BODY_LIMIT)));
    expect(res.statusCode).toBe(413);
  });

  it('works in front of the site password, and opens nothing behind it', async () => {
    await db
      .updateTable('site_access')
      .set({ enabled: true, password_hash: await hashPassword('telemetry-test') })
      .where('id', '=', true)
      .execute();
    try {
      expect((await app.inject({ method: 'GET', url: '/api/telemetry' })).statusCode).toBe(200);
      expect((await relay(app, envelope('on the lock screen'))).statusCode).toBe(200);
      const behind = await app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(behind.statusCode).toBe(401);
    } finally {
      await liftCurtain(db);
    }
  });

  it('passes on at most so many a minute, then asks the browser to hold back', async () => {
    // A fresh app: the window is per process.
    const fresh = await buildApp({ config: { LOG_LEVEL: 'silent' }, db, errors: tracker });
    try {
      for (let i = 0; i < RELAY_PER_MINUTE; i += 1) {
        expect((await relay(fresh, envelope(`n${String(i)}`))).statusCode).toBe(200);
      }
      const over = await relay(fresh, envelope('one too many'));
      expect(over.statusCode).toBe(429);
      expect(over.headers['retry-after']).toBe('60');
    } finally {
      await fresh.close();
    }
  });
});
