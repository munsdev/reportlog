/**
 * A local stand-in for DFN's timestamp authority: real OpenSSL behind a
 * loopback HTTP server, with its own throwaway key and certificate.
 *
 * Real OpenSSL rather than replies built by hand, so a request this archive
 * writes wrongly is refused by an independent implementation, and a token
 * this archive misreads is one OpenSSL actually produced. The tests never
 * ask the real authority.
 *
 * `mode` makes it misbehave in the ways a real one might.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type Mode = 'ok' | 'refuse' | 'http-error' | 'other-digest' | 'replay';

export interface StandInTsa {
  url: string;
  /** The authority's certificate, for `openssl ts -verify -CAfile`. */
  certFile: string;
  dir: string;
  mode: Mode;
  requests: number;
  close: () => Promise<void>;
}

export async function standInTsa(): Promise<StandInTsa> {
  const dir = mkdtempSync(join(tmpdir(), 'stand-in-tsa-'));
  await run(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      join(dir, 'tsa.key'),
      '-out',
      join(dir, 'tsa.crt'),
      '-days',
      '30',
      '-subj',
      '/CN=Stand-in timestamp authority',
      '-addext',
      'extendedKeyUsage=critical,timeStamping',
      '-addext',
      'keyUsage=critical,digitalSignature',
    ],
    { cwd: dir },
  );
  writeFileSync(join(dir, 'serial'), '01\n');
  writeFileSync(
    join(dir, 'tsa.cnf'),
    [
      '[ tsa ]',
      'default_tsa = tsa_config',
      '[ tsa_config ]',
      `serial = ${join(dir, 'serial')}`,
      'crypto_device = builtin',
      `signer_cert = ${join(dir, 'tsa.crt')}`,
      `signer_key = ${join(dir, 'tsa.key')}`,
      'signer_digest = sha256',
      'default_policy = 1.2.3.4.1',
      'other_policies = 1.2.3.4.2',
      'digests = sha256',
      'accuracy = secs:1',
      'ordering = no',
      'tsa_name = no',
      `certs = ${join(dir, 'tsa.crt')}`,
      'ess_cert_id_chain = no',
      'ess_cert_id_alg = sha256',
      '',
    ].join('\n'),
  );

  let n = 0;
  let lastReply: Buffer | null = null;
  const reply = async (query: Buffer): Promise<Buffer> => {
    n += 1;
    const q = join(dir, `q${String(n)}.tsq`);
    const r = join(dir, `r${String(n)}.tsr`);
    writeFileSync(q, query);
    await run('openssl', [
      'ts',
      '-reply',
      '-config',
      join(dir, 'tsa.cnf'),
      '-queryfile',
      q,
      '-out',
      r,
    ]);
    return readFileSync(r);
  };
  const otherQuery = async (): Promise<Buffer> => {
    const q = join(dir, 'other.tsq');
    await run('openssl', [
      'ts',
      '-query',
      '-digest',
      'ab'.repeat(32),
      '-sha256',
      '-cert',
      '-out',
      q,
    ]);
    return readFileSync(q);
  };

  const state: StandInTsa = {
    url: '',
    certFile: join(dir, 'tsa.crt'),
    dir,
    mode: 'ok',
    requests: 0,
    close: () => Promise.resolve(),
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        state.requests += 1;
        const body = Buffer.concat(chunks);
        if (
          req.method !== 'POST' ||
          req.headers['content-type'] !== 'application/timestamp-query'
        ) {
          res.writeHead(415).end();
          return;
        }
        try {
          let out: Buffer;
          switch (state.mode) {
            case 'http-error':
              res
                .writeHead(503, { 'Content-Type': 'text/html' })
                .end('<h1>Down for maintenance</h1>');
              return;
            case 'refuse':
              // TimeStampResp { PKIStatusInfo { status rejection(2) } }
              out = Buffer.from('300530030201' + '02', 'hex');
              break;
            case 'other-digest':
              out = await reply(await otherQuery());
              break;
            case 'replay':
              out = lastReply ?? (await reply(body));
              break;
            default:
              out = await reply(body);
          }
          lastReply = out;
          res.writeHead(200, { 'Content-Type': 'application/timestamp-reply' }).end(out);
        } catch {
          // OpenSSL could not read the request: that is a malformed request.
          res.writeHead(400).end('bad request');
        }
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/`;
  state.close = async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    rmSync(dir, { recursive: true, force: true });
  };
  return state;
}
