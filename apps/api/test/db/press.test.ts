/**
 * The press pack (port of legacy routes/press.js).
 *
 * Legacy shipped an empty list of files in its code. Here the list is the
 * deployment's own manifest, beside the files. What it holds: ReportLog
 * ships nothing, so with no pack the page says so; only a file the manifest
 * names is ever served, and the request never makes a path; a listed file
 * that is missing is shown as missing; a browser-runnable type is refused;
 * and the pack is behind the site password like everything else.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { downloadName } from '../../src/board/press.ts';
import type { Database } from '../../src/db/database.ts';
import { writeSiteAccess } from '../../src/identity/siteAccess.ts';
import { testDatabase } from './helpers.ts';
import { SITE, liftCurtain } from './identity-helpers.ts';

let db: Database;
let dir: string;
let withPack: FastifyInstance;
let without: FastifyInstance;

const manifest = (value: unknown) => {
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(value));
};
const pack = async (app = withPack) =>
  (await app.inject({ method: 'GET', url: '/api/press' })).json<{
    state: string;
    version: string | null;
    files: { key: string; label: string; bytes: number | null; version: string | null }[];
  }>();

beforeAll(async () => {
  db = testDatabase();
  dir = mkdtempSync(join(tmpdir(), 'rl-press-'));
  withPack = await buildApp({
    config: { LOG_LEVEL: 'silent', SITE_ORIGIN: SITE, PRESS_DIR: dir },
    db,
  });
  without = await buildApp({ config: { LOG_LEVEL: 'silent', SITE_ORIGIN: SITE }, db });
});
afterAll(async () => {
  await withPack.close();
  await without.close();
  await db.destroy();
  rmSync(dir, { recursive: true, force: true });
});

describe('the press pack', () => {
  it('ReportLog ships nothing: with no pack configured, or none built, the page says so', async () => {
    expect(await pack(without)).toEqual({
      state: 'none',
      version: null,
      commit: null,
      built_at: null,
      files: [],
    });
    expect((await pack()).state).toBe('none');
    expect(
      (await without.inject({ method: 'GET', url: '/api/press/anything.pdf' })).statusCode,
    ).toBe(404);
  });

  it('lists what the manifest names, and a missing file as missing rather than hidden', async () => {
    writeFileSync(join(dir, 'kit.pdf'), '%PDF-1.4 a press kit');
    manifest({
      version: '1.4.0',
      commit: '3f2a9c1',
      built_at: '2026-10-19T09:00:00Z',
      files: [
        {
          file: 'kit.pdf',
          name: 'Press kit.pdf',
          label: 'Press kit',
          blurb: 'What the archive is.',
          type: 'application/pdf',
        },
        {
          file: 'style.pdf',
          name: 'Style sheet.pdf',
          label: 'Style sheet',
          type: 'application/pdf',
          version: '2025-1',
          note: 'Built separately.',
        },
      ],
    });
    const p = await pack();
    expect(p.state).toBe('ready');
    expect(p.version).toBe('1.4.0');
    expect(p.files).toEqual([
      expect.objectContaining({ key: 'kit.pdf', label: 'Press kit', bytes: 20, version: null }),
      expect.objectContaining({ key: 'style.pdf', bytes: null, version: '2025-1' }),
    ]);
  });

  it('serves a listed file as a download stamped with its version, sandboxed', async () => {
    const res = await withPack.inject({ method: 'GET', url: '/api/press/kit.pdf' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('%PDF-1.4 a press kit');
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="Press kit-1.4.0.pdf"');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    const missing = await withPack.inject({ method: 'GET', url: '/api/press/style.pdf' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ error: { message: string } }>().error.message).toBe(
      'That file has not been built yet.',
    );
  });

  it('NEVER MAKES A PATH FROM THE REQUEST: only names the manifest lists', async () => {
    writeFileSync(join(dir, 'secret.txt'), 'not in the pack');
    for (const url of [
      '/api/press/secret.txt',
      '/api/press/manifest.json',
      '/api/press/..%2F..%2Fetc%2Fpasswd',
      '/api/press/%2E%2E',
    ]) {
      expect({ url, status: (await withPack.inject({ method: 'GET', url })).statusCode }).toEqual({
        url,
        status: 404,
      });
    }
  });

  it('refuses a manifest naming a path or a type a browser would run', async () => {
    for (const bad of [
      { files: [{ file: '../x.pdf', name: 'x.pdf', label: 'X', type: 'application/pdf' }] },
      { files: [{ file: 'sub/x.pdf', name: 'x.pdf', label: 'X', type: 'application/pdf' }] },
      { files: [{ file: 'x.svg', name: 'x.svg', label: 'X', type: 'image/svg+xml' }] },
      { files: [{ file: 'x.html', name: 'x.html', label: 'X', type: 'text/html' }] },
    ]) {
      manifest(bad);
      expect((await pack()).state).toBe('unreadable');
    }
    writeFileSync(join(dir, 'manifest.json'), '{ not json');
    expect((await pack()).state).toBe('unreadable');
  });

  it('a downloaded name carries the version and nothing that could break the header', () => {
    expect(downloadName('Press kit.pdf', '1.4.0')).toBe('Press kit-1.4.0.pdf');
    expect(downloadName('Kit.pdf', undefined)).toBe('Kit.pdf');
    expect(downloadName('Kit"\r\n.pdf', 'v 2/b')).toBe('Kit--v-2-b.pdf');
  });

  it('is behind the site password, like everything else under /api', async () => {
    manifest({ files: [] });
    await writeSiteAccess(db, { password: 'press-test-password', enabled: true });
    try {
      for (const url of ['/api/press', '/api/press/kit.pdf']) {
        const res = await withPack.inject({ method: 'GET', url });
        expect({ url, status: res.statusCode }).toEqual({ url, status: 401 });
      }
    } finally {
      await liftCurtain(db);
    }
  });
});
