import { cardFor } from '@reportlog/seal';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { fileReport, launchedLogbook, testDatabase } from './helpers.ts';

const db = testDatabase();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ config: { LOG_LEVEL: 'silent' }, db });
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('the HTTP API', () => {
  it('reports health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, database: 'up' });
  });

  it('serves the publication card with the digest the database holds', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/publication-card?variant=coordinator',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(cardFor('coordinator'));
  });

  it('verifies a report by reference', async () => {
    const lb = await launchedLogbook(db);
    const r = await fileReport(db, lb, { what: 'Over HTTP' });
    const res = await app.inject({ method: 'GET', url: `/api/reports/${r.row.public_ref}/verify` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      content: { ok: boolean };
      link: { ok: boolean };
      position: { ok: boolean };
    }>();
    expect([body.content.ok, body.link.ok, body.position.ok]).toEqual([true, true, true]);
  });

  it('answers errors in one shape, with a sentence', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/reports/RL-NOPE/verify' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: { code: 'not_found', message: 'There is no report RL-NOPE.' },
    });

    const bad = await app.inject({ method: 'GET', url: '/api/publication-card?variant=nonsense' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ error: { code: string } }>().error.code).toBe('invalid_request');

    const nowhere = await app.inject({ method: 'GET', url: '/api/nothing-here' });
    expect(nowhere.statusCode).toBe(404);
  });

  it('sends a strict content security policy and no referrer', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('request logging', () => {
  it('records the route pattern and never the address or the full URL', async () => {
    const lines: string[] = [];
    const logged = await buildApp({
      config: { LOG_LEVEL: 'info' },
      db,
      logStream: { write: (line) => void lines.push(line) },
    });
    await logged.inject({
      method: 'GET',
      url: '/api/reports/RL-SECRET-TOKEN/verify',
      remoteAddress: '203.0.113.9',
    });
    await logged.close();
    const all = lines.join('');
    expect(all).toContain('/api/reports/:ref/verify');
    expect(all).not.toContain('RL-SECRET-TOKEN');
    expect(all).not.toContain('203.0.113.9');
  });
});
