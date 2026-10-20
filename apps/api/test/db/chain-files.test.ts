/**
 * Chain file downloads, end to end: over HTTP with the site password on,
 * then checked by the command-line checker with nothing but the file and a
 * copy of the transparency log's anchors folder.
 *
 * The chain-file half of legacy `chain-selftest` (the complete file checks
 * out end to end and against its anchor; the published one leaves out what
 * is not public and still checks report by report; a draft has no chain).
 *
 * Its own database, because it anchors, and anchors are for good.
 */
import { checkChainFile } from '@reportlog/seal';
import type { ChainFile } from '@reportlog/seal';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { runAnchor } from '../../src/anchor/anchor.ts';
import { checkFiles } from '../../src/anchor/check-chain.ts';
import { buildApp } from '../../src/app.ts';
import { createDatabase } from '../../src/db/database.ts';
import type { Database } from '../../src/db/database.ts';
import { migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import type { Throwaway } from '../../src/db/throwaway.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import type { CapturingMailer } from '../../src/email/mailer.ts';
import { hashPassword } from '../../src/identity/secrets.ts';
import { fileReport, launchedLogbook } from './helpers.ts';
import { address, codeFor, cookieFrom, seat } from './identity-helpers.ts';
import { standInTsa } from './stand-in-tsa.ts';
import type { StandInTsa } from './stand-in-tsa.ts';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../../src/anchor/check-chain.ts', import.meta.url));

let throwaway: Throwaway;
let db: Database;
let app: FastifyInstance;
let mailer: CapturingMailer;
let tsa: StandInTsa;
let tmp: string;
let admin: string;
let moderator: string;
let pass: string;
let lb: { id: number; slug: string };
const refs: string[] = [];

async function sessionFor(email: string): Promise<string> {
  const cookies = { site_access: pass };
  await app.inject({ method: 'POST', url: '/api/auth/code', payload: { email }, cookies });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in',
    payload: { email, code: codeFor(mailer, email) },
    cookies,
  });
  const token = cookieFrom(res, 'session_token');
  if (!token) throw new Error(`sign-in failed: ${res.body}`);
  return token;
}

const get = (url: string, cookies: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, cookies });

beforeAll(async () => {
  throwaway = await createThrowawayDatabase(inject('serverUrl'), 'chainfiles');
  await migrate(throwaway.url);
  db = createDatabase(throwaway.url, 5);
  mailer = capturingMailer();
  app = await buildApp({ config: { LOG_LEVEL: 'silent' }, db, mailer });
  tsa = await standInTsa();
  tmp = mkdtempSync(join(tmpdir(), 'chain-files-'));

  // The published chain file is a bulk download, so it needs the
  // distribution switch on (decision 11); publication-switch.test.ts tests
  // the switch itself.
  await db
    .updateTable('moderation_settings')
    .set({ distribution_enabled: true })
    .where('id', '=', true)
    .execute();
  lb = await launchedLogbook(db);
  for (const [what, status, may] of [
    ['approved and public', 'valid', true],
    ['waiting for a moderator', 'pending', true],
    ['approved, the reporter said no', 'valid', false],
  ] as const) {
    const r = await fileReport(db, lb, { what }, { submission: { may_publish: may } });
    await db
      .insertInto('report_heads')
      .values({
        thread_id: r.row.thread_id,
        current_report_id: r.row.id,
        moderation_status: status,
      })
      .execute();
    refs.push(r.row.public_ref);
  }
  const out = await runAnchor({
    db,
    tsaUrl: tsa.url,
    say: () => undefined,
    now: () => new Date('2026-11-04T04:00:00Z'),
    log: {
      dir: join(tmp, 'log'),
      remotes: [],
      branch: 'main',
      author: { name: 't', email: 't@t.invalid' },
    },
  });
  // Kept here (no remote in a test), and that is all this file needs.
  expect(out.outcome).toBe('not_published');

  await db
    .updateTable('site_access')
    .set({ enabled: true, password_hash: await hashPassword('chain-files-password') })
    .where('id', '=', true)
    .execute();
  const unlocked = await app.inject({
    method: 'POST',
    url: '/api/site-access/unlock',
    payload: { password: 'chain-files-password' },
  });
  pass = cookieFrom(unlocked, 'site_access') ?? '';
  expect(pass).not.toBe('');

  const a = address('chain-admin');
  await seat(db, a, 'admin');
  admin = await sessionFor(a);
  const m = address('chain-moderator');
  await seat(db, m, 'moderator');
  moderator = await sessionFor(m);
});

afterAll(async () => {
  await app.close();
  await db.destroy();
  await tsa.close();
  await throwaway.drop();
  rmSync(tmp, { recursive: true, force: true });
});

describe('the published chain file', () => {
  it('is behind the site password like the rest of the board', async () => {
    const res = await get(`/api/chain/${lb.slug}`);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('locked');
  });

  it('carries only what the public board shows, and each report checks on its own', async () => {
    const res = await get(`/api/chain/${lb.slug}`, { site_access: pass });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".*-chain-published-/);
    const file = res.json<ChainFile>();
    expect(file.kind).toBe('published');
    expect(file.reports?.map((r) => r.public_ref)).toEqual([refs[0]]);
    // The gap is visible: the whole chain is longer than what is shown.
    expect(file.chain_length).toBe(3);
    expect(checkChainFile(file).ok).toBe(true);
  });

  it('a draft, or a logbook that does not exist, has no chain to download', async () => {
    const draft = await db
      .insertInto('logbooks')
      .values({ slug: 'chain-files-draft', title: 'A draft' })
      .returning('slug')
      .executeTakeFirstOrThrow();
    for (const slug of [draft.slug, 'no-such-logbook']) {
      expect((await get(`/api/chain/${slug}`, { site_access: pass })).statusCode).toBe(404);
      expect(
        (await get(`/api/admin/chain/${slug}`, { site_access: pass, session_token: admin }))
          .statusCode,
      ).toBe(404);
    }
  });
});

describe('the complete chain file', () => {
  it('is for administrators only', async () => {
    expect((await get(`/api/admin/chain/${lb.slug}`, { site_access: pass })).statusCode).toBe(401);
    expect(
      (await get(`/api/admin/chain/${lb.slug}`, { site_access: pass, session_token: moderator }))
        .statusCode,
    ).toBe(403);
  });

  it('carries every version in chain order and checks end to end, including against its anchor', async () => {
    const res = await get(`/api/admin/chain/${lb.slug}`, {
      site_access: pass,
      session_token: admin,
    });
    expect(res.statusCode).toBe(200);
    const file = res.json<ChainFile>();
    expect(file.kind).toBe('complete');
    expect(file.reports?.map((r) => r.public_ref)).toEqual(refs);
    const out = checkChainFile(file);
    expect(out.problems).toEqual([]);
    expect(out.anchors?.every((x) => x.ok)).toBe(true);

    // Against the transparency log's own copy of the anchor.
    const checked = checkFiles(file, join(tmp, 'log', 'anchors'));
    expect(checked.problems).toEqual([]);
  });
});

describe('the command-line checker, with nothing but the file', () => {
  let complete: ChainFile;
  beforeAll(async () => {
    complete = (
      await get(`/api/admin/chain/${lb.slug}`, { site_access: pass, session_token: admin })
    ).json<ChainFile>();
  });

  const runCli = async (file: unknown, ...args: string[]) => {
    const p = join(tmp, `chain-${String(Math.random()).slice(2)}.json`);
    writeFileSync(p, JSON.stringify(file));
    try {
      const { stdout } = await exec(process.execPath, [CLI, p, ...args]);
      return { code: 0, stdout };
    } catch (e) {
      const err = e as { code: number; stdout: string };
      return { code: err.code, stdout: err.stdout };
    }
  };

  it('says everything holds, and exits 0', async () => {
    const out = await runCli(complete, join(tmp, 'log', 'anchors'));
    expect(out.stdout).toMatch(/Everything that can be checked in this file holds/);
    expect(out.code).toBe(0);
  });

  it('names an edited report and exits 2', async () => {
    const edited = structuredClone(complete);
    const first = edited.reports?.[0];
    if (!first) throw new Error('no report');
    (first.hashed_fields.answers as Record<string, unknown>).what = 'something else entirely';
    const out = await runCli(edited);
    expect(out.code).toBe(2);
    expect(out.stdout).toMatch(/does not match its own fingerprint/);
  });

  it('names a report taken out of the middle', async () => {
    const cut = structuredClone(complete);
    cut.reports?.splice(1, 1);
    const out = await runCli(cut);
    expect(out.code).toBe(2);
    expect(out.stdout).toMatch(/does not follow the report before it/);
  });

  it('notices a published anchor that disagrees with the file, or whose list was edited', async () => {
    const dir = join(tmp, 'forged-anchors');
    const real = JSON.parse(
      readFileSync(join(tmp, 'log', 'anchors', '2026-11-04.json'), 'utf8'),
    ) as { chains: { logbook: string; reports: number }[] };
    const forged = structuredClone(real);
    const line = forged.chains.find((c) => c.logbook === lb.slug);
    if (line) line.reports = 2;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2026-11-04.json'), JSON.stringify(forged));
    const out = await runCli(complete, dir);
    expect(out.code).toBe(2);
    expect(out.stdout).toMatch(/disagrees with the file/);
    expect(out.stdout).toMatch(/does not match its own digest/);
  });

  it('a file that is not a chain file is said to be one, not crashed on', async () => {
    const out = await runCli({ hello: 'world' });
    expect(out.code).toBe(2);
    expect(out.stdout).toMatch(/not a chain file this checker understands/);
  });
});
