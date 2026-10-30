/**
 * The picture a shared link shows: a real PNG of the size social sites ask for.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { testDatabase } from './helpers.ts';

const db = testDatabase();
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ config: { LOG_LEVEL: 'silent' }, db, mailer: capturingMailer() });
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('GET /api/site/share.png', () => {
  it('is a 1200 by 630 PNG that caches for an hour', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/site/share.png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    const png = res.rawPayload;
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR: width at bytes 16 to 19, height at 20 to 23.
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});
