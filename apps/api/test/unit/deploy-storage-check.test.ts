/**
 * `files:storage-check` (legacy storage-smoke and storage-doctor), run whole
 * against an S3 implementation this repository did not write: moto's server,
 * on a loopback port. files-storage.test.ts checks the driver against its own
 * stand-in; this checks the command an owner runs, against somebody else's
 * idea of S3.
 *
 * No provider is chosen yet, so the run against the real one is the owner's:
 * deploy/README.md, "Checking file storage".
 *
 * Needs `moto_server` (MOTO_SERVER, or on PATH). Skipped without it on a
 * development machine, and fails without it in CI, which installs it.
 * Virtual-hosted addressing (bucket.host) needs DNS for a name per bucket,
 * so it is tested in files-storage.test.ts, against the stand-in.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MOTO = process.env.MOTO_SERVER ?? 'moto_server';
const hasMoto = (() => {
  try {
    execFileSync(MOTO, ['--help'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!hasMoto && process.env.CI)
  throw new Error(`deploy-storage-check: no moto_server at "${MOTO}"; CI installs it.`);

const CLI = new URL('../../src/files/storage-check-cli.ts', import.meta.url).pathname;

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) =>
    s.close(() => {
      r();
    }),
  );
  return port;
}

/** The check, as the owner runs it: its own process, configured only by its environment. */
function check(env: Record<string, string>) {
  const r = spawnSync(process.execPath, [CLI], {
    env: {
      PATH: process.env.PATH ?? '',
      DATABASE_URL: 'postgres://unused@localhost/unused',
      ...env,
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

describe.skipIf(!hasMoto)('the storage check, against moto', () => {
  let moto: ChildProcess;
  let endpoint: string;
  const settings = () => ({
    FILES_STORAGE: 's3',
    S3_ENDPOINT: endpoint,
    S3_REGION: 'eu-central-1',
    S3_ACCESS_KEY: 'check-key',
    S3_SECRET_KEY: 'check-secret',
    S3_BUCKET_STAGING: 'rl-staging',
    S3_BUCKET_EVIDENCE: 'rl-evidence',
    S3_BUCKET_RENDITIONS: 'rl-renditions',
  });

  /** What is in a bucket, by moto's own listing. */
  async function keys(bucket: string): Promise<string[]> {
    const xml = await (await fetch(`${endpoint}/${bucket}?list-type=2`)).text();
    return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1] ?? '');
  }

  beforeAll(async () => {
    const port = await freePort();
    endpoint = `http://127.0.0.1:${String(port)}`;
    moto = spawn(MOTO, ['-H', '127.0.0.1', '-p', String(port)], { stdio: 'ignore' });
    for (let i = 0; i < 150; i++) {
      try {
        await fetch(endpoint);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    for (const b of ['rl-staging', 'rl-evidence', 'rl-renditions']) {
      const res = await fetch(`${endpoint}/${b}`, { method: 'PUT' });
      expect(res.status, b).toBe(200);
    }
  }, 30_000);

  afterAll(() => {
    moto.kill();
  });

  it('writes, reads, reads a range and deletes in each of the three buckets, and leaves nothing', async () => {
    const r = check(settings());
    expect(r.out).toBe(
      [
        'ok    staging: write, read, range, delete, refuses an unsigned read',
        'ok    evidence: write, read, range, delete, refuses an unsigned read',
        'ok    renditions: write, read, range, delete, refuses an unsigned read',
        '',
      ].join('\n'),
    );
    expect(r.status).toBe(0);
    for (const b of ['rl-staging', 'rl-evidence', 'rl-renditions'])
      expect(await keys(b), b).toEqual([]);
  });

  it('names the bucket that is missing, still checks the others, and fails', () => {
    const r = check({ ...settings(), S3_BUCKET_RENDITIONS: 'rl-not-made' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('ok    staging');
    expect(r.out).toContain('ok    evidence');
    expect(r.out).toMatch(/FAIL {2}renditions: storage PUT renditions failed: 404 .*NoSuchBucket/s);
  });

  it('fails a bucket that answers a read with no signature, and leaves nothing in it', async () => {
    const res = await fetch(`${endpoint}/rl-public`, {
      method: 'PUT',
      headers: { 'x-amz-acl': 'public-read' },
    });
    expect(res.status).toBe(200);
    // Objects in moto inherit nothing from the bucket's ACL; make the policy
    // say what a careless provider console does: anyone may read.
    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: 'arn:aws:s3:::rl-public/*',
        },
      ],
    });
    const set = await fetch(`${endpoint}/rl-public?policy`, { method: 'PUT', body: policy });
    expect(set.status).toBeLessThan(300);
    const r = check({ ...settings(), S3_BUCKET_STAGING: 'rl-public' });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(
      /FAIL {2}staging: the bucket answers a read with no signature \(200\); it must not be public/,
    );
    expect(r.out).toContain('ok    evidence');
    expect(await keys('rl-public')).toEqual([]);
  });

  it('names a setting wrapped in quotes or spaces, without printing it, before trying anything', () => {
    const r = check({
      ...settings(),
      S3_ENDPOINT: `"${endpoint}"`,
      S3_SECRET_KEY: 'check-secret ',
      S3_BUCKET_EVIDENCE: "'rl-evidence'",
    });
    expect(r.status).toBe(1);
    expect(r.out).toBe(
      [
        'FAIL  S3_ENDPOINT is wrapped in quotes (.env needs it bare)',
        'FAIL  S3_SECRET_KEY has a space or line break at its start or end',
        'FAIL  S3_BUCKET_EVIDENCE is wrapped in quotes (.env needs it bare)',
        '',
      ].join('\n'),
    );
    expect(r.out).not.toContain('check-secret');
  });

  it('says why when the endpoint cannot be reached, not only that it failed', async () => {
    const r = check({ ...settings(), S3_ENDPOINT: `http://127.0.0.1:${String(await freePort())}` });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/FAIL {2}staging: .*ECONNREFUSED/);
  });

  it('says what is missing when storage is not configured', () => {
    const none = check({});
    expect(none.status).toBe(1);
    expect(none.out).toContain('Storage is not configured');
    const half = check({ FILES_STORAGE: 's3', S3_ENDPOINT: endpoint });
    expect(half.status).toBe(1);
    expect(half.out).toMatch(/Storage is not configured: .*S3_ACCESS_KEY/);
  });
});
