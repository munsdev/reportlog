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

const SIZE = async (url: string) => {
  const res = await app.inject({ method: 'GET', url });
  expect(res.statusCode, url).toBe(200);
  expect(res.headers['content-type'], url).toBe('image/png');
  const png = res.rawPayload;
  return [png.readUInt32BE(16), png.readUInt32BE(20), png.length] as const;
};

describe('GET /api/site/share.png', () => {
  it('draws a card for a page, the front page, and any address, all 1200 by 630', async () => {
    const seen = new Set<number>();
    for (const url of [
      '/api/site/share.png?path=%2Fterms',
      '/api/site/share.png?path=%2F',
      '/api/site/share.png?path=%2Fno-such-thing-at-all',
      '/api/site/share.png?path=not-a-path',
    ]) {
      const [w, h, bytes] = await SIZE(url);
      expect([w, h], url).toEqual([1200, 630]);
      seen.add(bytes);
    }
    // A page's card and the plain one are different pictures.
    expect(seen.size).toBeGreaterThan(1);
  });

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
