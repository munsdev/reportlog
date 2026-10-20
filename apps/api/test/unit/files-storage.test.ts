/**
 * The file store and the per-file encryption, without a database.
 *
 * The S3 driver is run against a small S3 stand-in in this process that
 * checks every request's signature the way a provider would, so streaming
 * bodies, ranges, 404s and deletes are exercised over real HTTP. The signing
 * itself is checked against Amazon's published examples in sigv4.test.ts.
 * Against the real provider, once chosen: `pnpm --filter @reportlog/api
 * files:storage-check`.
 */
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OVERHEAD,
  decryptBuffer,
  decryptStream,
  encryptBuffer,
  encryptStream,
  filesKeyring,
  newDek,
} from '../../src/files/envelope.ts';
import { signHeaders } from '../../src/files/sigv4.ts';
import { storageFrom } from '../../src/files/context.ts';
import { diskStorage, randomKey, readAll, s3Storage } from '../../src/files/storage.ts';
import type { Storage } from '../../src/files/storage.ts';

const KEY = Buffer.alloc(32, 3).toString('base64');

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

describe('one key per file', () => {
  const ring = filesKeyring(KEY);

  it('wraps a key so only this deployment can unwrap it', () => {
    const dek = newDek();
    const wrapped = ring.wrap(dek);
    expect(wrapped.equals(dek)).toBe(false);
    expect(ring.unwrap(wrapped).equals(dek)).toBe(true);
    expect(() => filesKeyring(Buffer.alloc(32, 4).toString('base64')).unwrap(wrapped)).toThrow();
  });

  it('encrypts a stream to exactly input + overhead bytes, and back', async () => {
    const dek = newDek();
    const plain = Buffer.from('x'.repeat(100_000));
    const parts = [plain.subarray(0, 7), plain.subarray(7, 50_000), plain.subarray(50_000)];
    const enc = await collect(Readable.from(parts).pipe(encryptStream(dek)));
    expect(enc.length).toBe(plain.length + OVERHEAD);
    // Fed back in awkward pieces, including ones smaller than the tag.
    const pieces = [
      enc.subarray(0, 3),
      enc.subarray(3, 20),
      enc.subarray(20, enc.length - 5),
      enc.subarray(enc.length - 5),
    ];
    const dec = await collect(Readable.from(pieces).pipe(decryptStream(dek)));
    expect(dec.equals(plain)).toBe(true);
  });

  it('an empty file is still an object of the stated size', async () => {
    const dek = newDek();
    const enc = await collect(Readable.from([]).pipe(encryptStream(dek)));
    expect(enc.length).toBe(OVERHEAD);
    expect((await collect(Readable.from([enc]).pipe(decryptStream(dek)))).length).toBe(0);
  });

  it('an altered or cut-short object fails instead of ending quietly', async () => {
    const dek = newDek();
    const enc = encryptBuffer(dek, Buffer.from('the original'));
    const altered = Buffer.from(enc);
    altered[20] = (altered[20] ?? 0) ^ 1;
    await expect(
      pipeline(Readable.from([altered]), decryptStream(dek), async function* (s) {
        for await (const _ of s) yield _;
      }),
    ).rejects.toThrow(/does not match/);
    await expect(
      collect(Readable.from([enc.subarray(0, enc.length - 3)]).pipe(decryptStream(dek))),
    ).rejects.toThrow();
    expect(() => decryptBuffer(newDek(), enc)).toThrow();
    expect(decryptBuffer(dek, enc).toString()).toBe('the original');
  });

  it('the quota digest is one bucket per person however they type it, and not the address', () => {
    expect(ring.quotaDigest('  Reporter@Example.ORG ')).toBe(
      ring.quotaDigest('reporter@example.org'),
    );
    expect(ring.quotaDigest('a@example.org')).not.toContain('@');
  });
});

/** The same checks for both drivers. */
function contract(name: string, make: () => Storage) {
  describe(`${name} storage`, () => {
    it('puts, gets, ranges, heads and deletes', async () => {
      const s = make();
      const key = randomKey('t');
      const body = Buffer.from('0123456789abcdef');
      await s.put(
        'evidence',
        key,
        Readable.from([body.subarray(0, 5), body.subarray(5)]),
        body.length,
      );
      expect(await s.head('evidence', key)).toEqual({ size: 16 });
      const whole = await s.get('evidence', key);
      expect(whole && (await readAll(whole)).toString()).toBe('0123456789abcdef');
      const part = await s.get('evidence', key, { start: 2, end: 5 });
      expect(part?.total).toBe(16);
      expect(part?.range).toEqual({ start: 2, end: 5 });
      expect(part && (await readAll(part)).toString()).toBe('2345');
      // Buckets are separate places.
      expect(await s.get('renditions', key)).toBeNull();
      await s.delete('evidence', key);
      expect(await s.head('evidence', key)).toBeNull();
      await s.delete('evidence', key);
    });

    it('a body that fails half way leaves no object', async () => {
      const s = make();
      const key = randomKey('t');
      const failing = new Readable({
        read() {
          this.push(Buffer.from('partial'));
          this.destroy(new Error('the reporter lost their signal'));
        },
      });
      await expect(s.put('staging', key, failing, 100)).rejects.toThrow();
      expect(await s.head('staging', key)).toBeNull();
    });

    it('refuses a key this code did not make', async () => {
      const s = make();
      await expect(s.put('staging', '../../etc/passwd', Buffer.from('x'), 1)).rejects.toThrow(
        /not a storage key/,
      );
      await expect(s.get('staging', 'photos/IMG_0001.jpg')).rejects.toThrow(/not a storage key/);
    });
  });
}

let dir: string;
let server: ReturnType<typeof createServer>;
let endpoint: string;
const CREDS = { accessKey: 'TESTKEY', secretKey: 'test-secret', region: 'eu-central-1' };
const objects = new Map<string, Buffer>();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rl-files-'));
  // An S3 stand-in that refuses any request whose signature does not check.
  server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const auth = req.headers.authorization ?? '';
      const signedNames = /SignedHeaders=([^,]+)/.exec(auth)?.[1]?.split(';') ?? [];
      const extra: Record<string, string> = {};
      for (const n of signedNames) {
        if (!['host', 'x-amz-date', 'x-amz-content-sha256'].includes(n)) {
          extra[n] = String(req.headers[n] ?? '');
        }
      }
      const stamp = String(req.headers['x-amz-date']);
      const now = new Date(
        `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`,
      );
      const expected = signHeaders(CREDS, {
        method: req.method ?? '',
        path: req.url ?? '',
        host: req.headers.host ?? '',
        headers: extra,
        payloadHash: String(req.headers['x-amz-content-sha256']),
        now,
      }).authorization;
      if (expected !== auth) {
        res.writeHead(403).end('<Code>SignatureDoesNotMatch</Code>');
        return;
      }
      // Host and path together: with virtual-hosted addressing the bucket is
      // in the host, and the path is the key alone.
      const id = `${req.headers.host ?? ''}${req.url ?? ''}`;
      if (req.method === 'PUT') {
        const body = Buffer.concat(chunks);
        if (body.length !== Number(req.headers['content-length'])) return res.writeHead(400).end();
        objects.set(id, body);
        return res.writeHead(200).end();
      }
      const obj = objects.get(id);
      if (req.method === 'DELETE') {
        objects.delete(id);
        return res.writeHead(204).end();
      }
      if (!obj) return res.writeHead(404).end('<Code>NoSuchKey</Code>');
      if (req.method === 'HEAD') return res.writeHead(200, { 'content-length': obj.length }).end();
      const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '');
      if (range) {
        const [s, e] = [Number(range[1]), Number(range[2])];
        const part = obj.subarray(s, e + 1);
        return res
          .writeHead(206, {
            'content-length': part.length,
            'content-range': `bytes ${String(s)}-${String(e)}/${String(obj.length)}`,
          })
          .end(part);
      }
      res.writeHead(200, { 'content-length': obj.length }).end(obj);
    })().catch(() => {
      // A client that gave up half way (the body that fails, above).
      res.destroy();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

contract('disk', () => diskStorage(dir));
contract('S3', () =>
  s3Storage({
    ...CREDS,
    endpoint,
    addressing: 'path',
    buckets: { staging: 'rl-staging', evidence: 'rl-evidence', renditions: 'rl-renditions' },
  }),
);

/**
 * Virtual-hosted names (`rl-evidence.s3.test`) need DNS for every bucket.
 * Instead, this fetch dials the stand-in on loopback and sends the host the
 * driver asked for, so the stand-in checks the signature over that host.
 */
const viaLoopback: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const port = Number(new URL(endpoint).port);
  return new Promise((resolveRes, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: init?.method ?? 'GET',
        path: `${url.pathname}${url.search}`,
        headers: { ...(init?.headers as Record<string, string>), host: url.host },
      },
      (res) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers))
          if (typeof v === 'string') headers.set(k, v);
        const status = res.statusCode ?? 500;
        const empty = status === 204 || init?.method === 'HEAD';
        if (empty) res.resume();
        resolveRes(
          new Response(empty ? null : (Readable.toWeb(res) as ReadableStream), { status, headers }),
        );
      },
    );
    req.on('error', reject);
    const body = init?.body;
    if (body === undefined || body === null) req.end();
    else if (Buffer.isBuffer(body)) req.end(body);
    // A body that fails half way aborts the request, as fetch would.
    else pipeline(Readable.fromWeb(body as never), req).catch(reject);
  });
};

contract('S3, virtual-hosted', () =>
  s3Storage(
    {
      ...CREDS,
      endpoint: `http://s3.test:${new URL(endpoint).port}`,
      addressing: 'virtual',
      buckets: { staging: 'rl-staging', evidence: 'rl-evidence', renditions: 'rl-renditions' },
    },
    viaLoopback,
  ),
);

describe('virtual-hosted addressing', () => {
  it('puts the bucket in the host and the key alone in the path', async () => {
    const s = s3Storage(
      {
        ...CREDS,
        endpoint: `http://s3.test:${new URL(endpoint).port}`,
        addressing: 'virtual',
        buckets: { staging: 'rl-staging', evidence: 'rl-evidence', renditions: 'rl-renditions' },
      },
      viaLoopback,
    );
    const key = randomKey('t');
    await s.put('evidence', key, Buffer.from('v'), 1);
    expect([...objects.keys()]).toContain(`rl-evidence.s3.test:${new URL(endpoint).port}/${key}`);
    expect(s.unsignedUrl?.('evidence', key)).toBe(
      `http://rl-evidence.s3.test:${new URL(endpoint).port}/${key}`,
    );
    await s.delete('evidence', key);
  });

  it('refuses a bucket name that is not one DNS label, and says why', () => {
    const base = {
      ...CREDS,
      endpoint: 'https://s3.example.org',
      addressing: 'virtual' as const,
      buckets: { staging: 'rl-staging', evidence: 'rl-evidence', renditions: 'rl-renditions' },
    };
    for (const bad of ['rl.evidence', 'RL-Evidence', 'rl_evidence', 'rl-evidence-', 'rl', ''])
      expect(
        () => s3Storage({ ...base, buckets: { ...base.buckets, evidence: bad } }),
        bad,
      ).toThrow(/cannot be used with virtual-hosted addressing/);
    // Path style puts the name in the path, where a dot is harmless.
    expect(() =>
      s3Storage({
        ...base,
        addressing: 'path',
        buckets: { ...base.buckets, evidence: 'rl.evidence' },
      }),
    ).not.toThrow();
    // At start, the configuration says so instead of the server starting.
    expect(
      storageFrom({
        FILES_STORAGE: 's3',
        S3_ENDPOINT: 'https://s3.example.org',
        S3_ACCESS_KEY: 'k',
        S3_SECRET_KEY: 's',
        S3_BUCKET_STAGING: 'rl-staging',
        S3_BUCKET_EVIDENCE: 'rl.evidence',
        S3_BUCKET_RENDITIONS: 'rl-renditions',
        S3_ADDRESSING: 'virtual',
      }),
    ).toMatch(/^the bucket name "rl\.evidence" cannot be used with virtual-hosted addressing/);
  });
});

describe('S3 credentials', () => {
  it('a wrong secret is refused by the provider, and said so', async () => {
    const s = s3Storage({
      ...CREDS,
      secretKey: 'wrong',
      endpoint,
      addressing: 'path',
      buckets: { staging: 'a', evidence: 'b', renditions: 'c' },
    });
    await expect(s.put('staging', randomKey('t'), Buffer.from('x'), 1)).rejects.toThrow(/403/);
  });
});
