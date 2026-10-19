/**
 * A stand-in for Bugsink: a loopback HTTP server that takes Sentry envelopes
 * the way Bugsink does (`POST /api/<project>/envelope/`) and keeps every
 * request it was sent, whole, so a test can look at exactly what left.
 *
 * Imported by the API's tests. The browser suite runs it as its own process
 * (`node test/stand-in-bugsink.ts <port> <file>`), writing each request as a
 * line of JSON to <file>, because the website's tests may not import the
 * server's code.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

export interface Received {
  path: string;
  /** Header names, lower case, with their values. */
  headers: Record<string, string>;
  /** The envelope as sent. */
  body: string;
  /** Each item's payload, parsed: the header line, then item header and payload pairs. */
  items: unknown[];
}

export interface StandInBugsink {
  /** A DSN that points here, for project 1. */
  dsn: string;
  received: Received[];
  close: () => Promise<void>;
}

function parse(body: string): unknown[] {
  return body
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return line;
      }
    });
}

function serve(onRequest: (r: Received) => void): Server {
  return createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200).end('ok');
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          Array.isArray(v) ? v.join(', ') : (v ?? ''),
        ]),
      );
      onRequest({ path: req.url ?? '', headers, body, items: parse(body) });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"x"}');
    });
  });
}

export async function standInBugsink(): Promise<StandInBugsink> {
  const received: Received[] = [];
  const server = serve((r) => received.push(r));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    dsn: `http://publickey@127.0.0.1:${String(port)}/1`,
    received,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

// As its own process, for the browser suite.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [port = '3999', file = 'bugsink-received.jsonl'] = process.argv.slice(2);
  writeFileSync(file, '');
  serve((r) => {
    appendFileSync(file, `${JSON.stringify(r)}\n`);
  }).listen(Number(port), '127.0.0.1');
}
