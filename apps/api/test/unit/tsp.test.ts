/**
 * RFC 3161 against real OpenSSL acting as the authority. Never the real one.
 */
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TimestampError,
  readResponse,
  readToken,
  requestTimestamp,
  timestampRequest,
} from '../../src/anchor/tsp.ts';
import { standInTsa } from '../db/stand-in-tsa.ts';
import type { StandInTsa } from '../db/stand-in-tsa.ts';

const run = promisify(execFile);
const DIGEST = 'd2'.repeat(32);

let tsa: StandInTsa;
beforeAll(async () => {
  tsa = await standInTsa();
});
afterAll(() => tsa.close());

describe('the request', () => {
  it('is one OpenSSL reads as a SHA-256 query with a nonce, asking for the certificate', async () => {
    const file = join(tsa.dir, 'ours.tsq');
    writeFileSync(file, timestampRequest(DIGEST, Buffer.from('8001020304050607', 'hex')));
    const { stdout } = await run('openssl', ['ts', '-query', '-in', file, '-text']);
    expect(stdout).toMatch(/Hash Algorithm: sha256/);
    expect(stdout.replace(/\s+/g, ' ')).toContain('d2 d2 d2 d2');
    // A nonce with its top bit set is still a positive number.
    expect(stdout).toMatch(/Nonce: 0x8001020304050607/i);
    expect(stdout).toMatch(/Certificate required: yes/);
  });

  it('refuses something that is not a SHA-256 digest', () => {
    expect(() => timestampRequest('nope', new Uint8Array(8))).toThrow(TimestampError);
  });
});

describe('the reply', () => {
  it('gives a token over exactly our digest, which OpenSSL verifies against the authority', async () => {
    tsa.mode = 'ok';
    const ts = await requestTimestamp(tsa.url, DIGEST);
    expect(ts.info.imprint).toBe(DIGEST);
    expect(ts.info.genTime).toMatch(/^\d{14}Z$/);
    expect(readToken(ts.token)).toEqual(ts.info);

    const tok = join(tsa.dir, 'token.der');
    writeFileSync(tok, ts.token);
    const { stdout } = await run('openssl', [
      'ts',
      '-verify',
      '-digest',
      DIGEST,
      '-token_in',
      '-in',
      tok,
      '-CAfile',
      tsa.certFile,
    ]);
    expect(stdout).toMatch(/Verification: OK/);
  });

  it('a refusal is refused, with the status', async () => {
    tsa.mode = 'refuse';
    await expect(requestTimestamp(tsa.url, DIGEST)).rejects.toThrow(
      /refused the request \(status 2\)/,
    );
  });

  it('an error page is not a token', async () => {
    tsa.mode = 'http-error';
    await expect(requestTimestamp(tsa.url, DIGEST)).rejects.toThrow(/HTTP 503/);
  });

  it("a token over somebody else's digest is refused", async () => {
    tsa.mode = 'other-digest';
    await expect(requestTimestamp(tsa.url, DIGEST)).rejects.toThrow(/different digest/);
  });

  it('a replayed token is refused: the nonce does not match', async () => {
    tsa.mode = 'ok';
    await requestTimestamp(tsa.url, DIGEST);
    tsa.mode = 'replay';
    await expect(requestTimestamp(tsa.url, DIGEST)).rejects.toThrow(/nonce/);
  });

  it('an unreachable authority says so without naming the address', async () => {
    const err = await requestTimestamp('http://127.0.0.1:9/secret-path', DIGEST, {
      timeoutMs: 2000,
    }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(TimestampError);
    expect((err as Error).message).not.toContain('secret-path');
  });

  it('garbage is refused rather than half-read', () => {
    expect(() => readResponse(Buffer.from('3082ffff', 'hex'))).toThrow(TimestampError);
    expect(() => readToken(Buffer.from('300100', 'hex'))).toThrow(TimestampError);
  });
});
