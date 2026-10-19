/**
 * The daily anchor and the transparency log, against a real database, real
 * git, and real OpenSSL standing in for the timestamp authority.
 *
 * The equivalent of legacy `translog-selftest` (where the push goes, that it
 * reaches every mirror on its own, that no address reaches a log line) and
 * the anchor half of `chain-selftest` (once listed, always listed, and never
 * shorter). Legacy's deploy-key and settings-panel checks have no equivalent:
 * the rebuild takes the log's address and key from configuration.
 *
 * ITS OWN DATABASE. The anchor tables are append-only, and a run that refuses
 * keeps refusing; that is the point. So these tests plant contradictions in a
 * database of their own, never in the one the rest of the suite shares.
 */
import { contentHash, canonicalJson, headsDigest, sha256Hex } from '@reportlog/seal';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { runAnchor } from '../../src/anchor/anchor.ts';
import type { AnchorDeps } from '../../src/anchor/anchor.ts';
import { checkAnchor } from '../../src/anchor/health.ts';
import { countsDigestMatches } from '../../src/anchor/records.ts';
import type { AnchorRecord, CountsRecord, Snapshot } from '../../src/anchor/records.ts';
import { readToken } from '../../src/anchor/tsp.ts';
import { createDatabase } from '../../src/db/database.ts';
import type { Database } from '../../src/db/database.ts';
import { migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import type { Throwaway } from '../../src/db/throwaway.ts';
import { createFromTemplate } from '../../src/lists/manage.ts';
import { fileReport, launchedLogbook, uniqueSlug } from './helpers.ts';
import { standInTsa } from './stand-in-tsa.ts';
import type { StandInTsa } from './stand-in-tsa.ts';

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) =>
  (
    await exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd })
  ).stdout.trim();

let throwaway: Throwaway;
let db: Database;
let tsa: StandInTsa;
let tmp: string;
let remote1: string;
let remote2: string;
let lines: string[];

const day = (d: string) => () => new Date(`${d}T04:00:00Z`);

function deps(over: Partial<AnchorDeps> & { remotes?: string[]; dir?: string } = {}): AnchorDeps {
  lines = [];
  return {
    db,
    tsaUrl: tsa.url,
    say: (l) => lines.push(l),
    now: day('2026-11-04'),
    ...over,
    log: {
      dir: over.dir ?? join(tmp, 'checkout'),
      remotes: over.remotes ?? [remote1, remote2],
      branch: 'main',
      author: { name: 'ReportLog anchor', email: 'anchor@reportlog.invalid' },
    },
  };
}

/** A file as a remote's main branch holds it, or null. */
async function atRemote(remote: string, file: string): Promise<string | null> {
  try {
    return (
      await exec('git', ['--git-dir', remote, 'show', `main:${file}`], { maxBuffer: 64 << 20 })
    ).stdout;
  } catch {
    return null;
  }
}

const commits = async (remote: string) =>
  Number(await git(tmp, '--git-dir', remote, 'rev-list', '--count', 'main'));

async function publish(threadId: string, reportId: number, status = 'valid') {
  await db
    .insertInto('report_heads')
    .values({ thread_id: threadId, current_report_id: reportId, moderation_status: status })
    .execute();
}

async function bareRemote(name: string): Promise<string> {
  // Like the real log: a main branch that already has a README.
  const bare = join(tmp, `${name}.git`);
  await git(tmp, 'init', '--quiet', '--bare', '--initial-branch', 'main', bare);
  const seed = join(tmp, `${name}-seed`);
  await git(tmp, 'clone', '--quiet', bare, seed);
  writeFileSync(join(seed, 'README.md'), '# transparency log\n');
  await git(seed, 'add', 'README.md');
  await git(seed, 'commit', '--quiet', '-m', 'README');
  await git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
  return bare;
}

let a: { id: number; slug: string };
let b: { id: number; slug: string };
let empty: { id: number; slug: string };
const refs: Record<string, string> = {};

beforeAll(async () => {
  throwaway = await createThrowawayDatabase(inject('serverUrl'), 'anchor');
  await migrate(throwaway.url);
  db = createDatabase(throwaway.url, 5);
  tsa = await standInTsa();
  tmp = mkdtempSync(join(tmpdir(), 'anchor-test-'));
  remote1 = await bareRemote('one');
  // A mirror holds the same history. (Two seeded separately share none, and
  // the log rightly refuses to push over a history it does not continue.)
  remote2 = join(tmp, 'two.git');
  await git(tmp, 'clone', '--quiet', '--bare', remote1, remote2);

  a = await launchedLogbook(db);
  b = await launchedLogbook(db);
  empty = await launchedLogbook(db);
  const a1 = await fileReport(db, a, { what: 'first in a' });
  const b1 = await fileReport(db, b, { what: 'first in b' });
  const a2 = await fileReport(db, a, { what: 'second in a, never approved' });
  const a3 = await fileReport(
    db,
    a,
    { what: 'third in a, the reporter said no' },
    {
      submission: { may_publish: false },
    },
  );
  await publish(a1.row.thread_id, a1.row.id);
  await publish(b1.row.thread_id, b1.row.id);
  await publish(a2.row.thread_id, a2.row.id, 'pending');
  await publish(a3.row.thread_id, a3.row.id);
  Object.assign(refs, {
    a1: a1.row.public_ref,
    b1: b1.row.public_ref,
    a2: a2.row.public_ref,
    a3: a3.row.public_ref,
  });

  // A list whose counts an administrator published, and one they did not.
  const counted = await createFromTemplate(db, 'check-ins', { slug: uniqueSlug('counted') });
  await db
    .updateTable('lists')
    .set({ visibility: 'listed', aggregates_published: true })
    .where('id', '=', counted.id)
    .execute();
  await createFromTemplate(db, 'tips', { slug: uniqueSlug('hidden') });
});

afterAll(async () => {
  await db.destroy();
  await tsa.close();
  await throwaway.drop();
  rmSync(tmp, { recursive: true, force: true });
});

describe('the first anchor', () => {
  let record: AnchorRecord;

  it('timestamps every launched logbook and reaches every mirror', async () => {
    const out = await runAnchor(deps());
    expect(out, lines.join('\n')).toMatchObject({
      outcome: 'published',
      exitCode: 0,
      date: '2026-11-04',
    });
    const file = await atRemote(remote1, 'anchors/2026-11-04.json');
    expect(file).not.toBeNull();
    expect(await atRemote(remote2, 'anchors/2026-11-04.json')).toBe(file);
    record = JSON.parse(file ?? '{}') as AnchorRecord;
    const by = Object.fromEntries(record.chains.map((c) => [c.logbook, c]));
    expect(by[a.slug]?.reports).toBe(3);
    expect(by[b.slug]?.reports).toBe(1);
    expect(by[empty.slug]?.reports).toBe(0);
  });

  it("the file's digest is the list's, and the token covers exactly that digest", async () => {
    expect(record.root_chain_hash).toBe(headsDigest(record.date, record.chains));
    const token = Buffer.from(record.rfc3161_token_base64, 'base64');
    expect(readToken(token).imprint).toBe(record.root_chain_hash);
    // And the authority's signature holds, checked by OpenSSL with its certificate.
    const tok = join(tmp, 'token.der');
    writeFileSync(tok, token);
    const { stdout } = await exec('openssl', [
      'ts',
      '-verify',
      '-digest',
      record.root_chain_hash,
      '-token_in',
      '-in',
      tok,
      '-CAfile',
      tsa.certFile,
    ]);
    expect(stdout).toMatch(/Verification: OK/);
  });

  it('the database holds the same list, the token and where it was published', async () => {
    const row = await db.selectFrom('chain_anchors').selectAll().executeTakeFirstOrThrow();
    expect(row.root_chain_hash).toBe(record.root_chain_hash);
    expect(row.public_log_ref).toBe('anchors/2026-11-04.json');
    expect(Buffer.from(row.rfc3161_token ?? []).toString('base64')).toBe(
      record.rfc3161_token_base64,
    );
    const heads = await db
      .selectFrom('chain_anchor_heads')
      .selectAll()
      .where('anchor_id', '=', row.id)
      .execute();
    expect(heads).toHaveLength(record.chains.length);
  });

  it('the snapshot beside it holds the published reports only, each checkable on its own', async () => {
    const snap = JSON.parse(
      (await atRemote(remote1, 'snapshots/2026-11-04.json')) ?? '{}',
    ) as Snapshot;
    const shown = snap.reports.map((r) => r.public_ref).sort();
    expect(shown).toEqual([refs.a1, refs.b1].sort());
    // Not approved, and approved but the reporter said no: neither is public.
    expect(shown).not.toContain(refs.a2);
    expect(shown).not.toContain(refs.a3);
    for (const r of snap.reports) {
      expect(contentHash(r.hashed_fields)).toBe(r.content_hash);
      expect(sha256Hex(r.content_hash + r.prev_chain_hash)).toBe(r.chain_hash);
    }
    expect(snap.chains).toEqual(record.chains);
    expect(snap.reports_not_matching_their_own_hash).toBeUndefined();
    // The questions each report was answered against travel with it.
    expect(snap.forms?.map((f) => f.hash).sort()).toEqual(
      [...new Set(snap.reports.map((r) => r.hashed_fields.logbook_form))].sort(),
    );
  });

  it("the published lists' counts go beside it, with a digest and a timestamp of their own", async () => {
    const counts = JSON.parse(
      (await atRemote(remote1, 'counts/2026-11-04.json')) ?? '{}',
    ) as CountsRecord & {
      rfc3161_token_base64: string;
    };
    expect(counts.lists).toHaveLength(1);
    expect(counts.lists[0]?.slug).toMatch(/^counted-/);
    expect(countsDigestMatches(counts)).toBe(true);
    expect(counts.digest).toBe(
      sha256Hex(
        canonicalJson({
          counts_format: counts.counts_format,
          date: counts.date,
          lists: counts.lists,
        }),
      ),
    );
    expect(readToken(Buffer.from(counts.rfc3161_token_base64, 'base64')).imprint).toBe(
      counts.digest,
    );
    expect(counts.digest).not.toBe(record.root_chain_hash);
  });

  it('the doctor is content', async () => {
    const f = await checkAnchor(db, { now: new Date('2026-11-04T09:00:00Z'), remotes: 2 });
    expect(f.status, f.detail).toBe('ok');
  });
});

describe('a second run on the same day', () => {
  it('timestamps nothing new, rewrites nothing, and pushes again', async () => {
    const asked = tsa.requests;
    const before = await commits(remote1);
    const out = await runAnchor(deps());
    expect(out.outcome, lines.join('\n')).toBe('published');
    expect(out.detail).toMatch(/^Already anchored 2026-11-04/);
    expect(tsa.requests).toBe(asked);
    expect(await commits(remote1)).toBe(before);
    expect(await db.selectFrom('chain_anchors').select('id').execute()).toHaveLength(1);
  });

  it('the database will not hold two anchors for one day even if something forgets to check', async () => {
    await expect(
      db
        .insertInto('chain_anchors')
        .values({ anchor_date: '2026-11-04', root_chain_hash: 'a'.repeat(64) })
        .execute(),
    ).rejects.toThrow();
  });
});

describe('mirrors, each on its own', () => {
  it('one unreachable mirror is loud and not fatal, and catches up on the next run', async () => {
    await fileReport(db, b, { what: 'second in b' });
    const gone = join(tmp, 'unreachable.git');
    const out = await runAnchor(deps({ now: day('2026-11-05'), remotes: [remote1, gone] }));
    expect(out, lines.join('\n')).toMatchObject({ outcome: 'partly_published', exitCode: 0 });
    expect(out.detail).toMatch(/Reached 1 of 2 remote\(s\); not remote 2/);
    expect(await atRemote(remote1, 'anchors/2026-11-05.json')).not.toBeNull();
    expect(await atRemote(remote2, 'anchors/2026-11-05.json')).toBeNull();
    expect(
      (await checkAnchor(db, { now: new Date('2026-11-05T09:00:00Z'), remotes: 2 })).status,
    ).toBe('warn');

    const again = await runAnchor(deps({ now: day('2026-11-05') }));
    expect(again.outcome, lines.join('\n')).toBe('published');
    expect(await atRemote(remote2, 'anchors/2026-11-05.json')).toBe(
      await atRemote(remote1, 'anchors/2026-11-05.json'),
    );
  });

  it('reaching none of them fails the job, and the day is still kept here', async () => {
    const out = await runAnchor(
      deps({ now: day('2026-11-06'), remotes: [join(tmp, 'nope1.git'), join(tmp, 'nope2.git')] }),
    );
    expect(out).toMatchObject({ outcome: 'not_published', exitCode: 1 });
    expect(out.detail).toMatch(/reached none of the 2/);
    expect(
      (await checkAnchor(db, { now: new Date('2026-11-06T09:00:00Z'), remotes: 2 })).status,
    ).toBe('fail');
    // Tomorrow's run is not needed to fix it: the same day's next run pushes.
    const again = await runAnchor(deps({ now: day('2026-11-06') }));
    expect(again.outcome, lines.join('\n')).toBe('published');
    expect(await atRemote(remote2, 'anchors/2026-11-06.json')).not.toBeNull();
  });

  it('a mirror whose history has gone elsewhere is refused and reported, never forced', async () => {
    const stranger = await bareRemote('stranger');
    const before = await git(tmp, '--git-dir', stranger, 'rev-parse', 'main');
    const out = await runAnchor(deps({ now: day('2026-11-06'), remotes: [remote1, stranger] }));
    expect(out.outcome).toBe('partly_published');
    expect(lines.join('\n')).toMatch(/push to remote 2 .* failed/);
    expect(await git(tmp, '--git-dir', stranger, 'rev-parse', 'main')).toBe(before);
  });

  it('a fresh checkout is cloned from whichever mirror answers', async () => {
    const out = await runAnchor(
      deps({
        now: day('2026-11-06'),
        dir: join(tmp, 'checkout-fresh'),
        remotes: [join(tmp, 'down.git'), remote1],
      }),
    );
    expect(out.outcome, lines.join('\n')).toBe('partly_published');
    expect(out.detail).toMatch(/^Already anchored 2026-11-06/);
  });

  it('no address and no credential ever reaches a log line or the run record', async () => {
    const secret = 'https://anchor:s3cr3t-token@127.0.0.1:9/owner/log.git';
    const out = await runAnchor(deps({ now: day('2026-11-06'), remotes: [remote1, secret] }));
    const said = [...lines, out.detail].join('\n');
    expect(said).toMatch(/remote 2 \(127\.0\.0\.1\)/);
    expect(said).not.toContain('s3cr3t-token');
    expect(said).not.toContain(remote1);
    const runs = await db.selectFrom('anchor_runs').select('detail').execute();
    expect(runs.map((r) => r.detail).join('\n')).not.toContain('s3cr3t-token');
  });
});

describe('once listed, always listed, and never shorter', () => {
  it('a logbook missing from the list is refused, nothing is timestamped and nothing published', async () => {
    // What deleting a whole logbook would look like, planted in the last
    // published list (the reports table itself refuses deletion).
    const planted = await db
      .insertInto('chain_anchors')
      .values({
        anchor_date: '2026-11-07',
        root_chain_hash: 'b'.repeat(64),
        public_log_ref: 'anchors/2026-11-07.json',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('chain_anchor_heads')
      .values([
        {
          anchor_id: planted.id,
          logbook_slug: 'vanished',
          head_chain_hash: 'c'.repeat(64),
          report_count: 4,
        },
        {
          anchor_id: planted.id,
          logbook_slug: a.slug,
          head_chain_hash: 'd'.repeat(64),
          report_count: 99,
        },
      ])
      .execute();
    const asked = tsa.requests;
    const pushed = await commits(remote1);

    const out = await runAnchor(deps({ now: day('2026-11-08') }));
    expect(out).toMatchObject({ outcome: 'refused', exitCode: 2 });
    expect(out.detail).toMatch(
      /Logbook "vanished" was in the last anchor this database recorded and is gone/,
    );
    expect(out.detail).toMatch(new RegExp(`Logbook "${a.slug}" had 99 report\\(s\\).*now has 3`));
    expect(lines.join('\n')).toMatch(/This is what deleting reports looks like/);
    expect(tsa.requests).toBe(asked);
    expect(await commits(remote1)).toBe(pushed);
    expect(
      await db
        .selectFrom('chain_anchors')
        .select('id')
        .where('anchor_date', '=', '2026-11-08')
        .execute(),
    ).toHaveLength(0);

    const f = await checkAnchor(db, { now: new Date('2026-11-08T09:00:00Z'), remotes: 2 });
    expect(f.status).toBe('fail');
    expect(f.detail).toMatch(/REFUSED/);
  });

  it('and it keeps refusing the next day: nothing in the software makes it go away', async () => {
    const out = await runAnchor(deps({ now: day('2026-11-09') }));
    expect(out.outcome).toBe('refused');
  });

  it('the log remembers what a replaced database forgot', async () => {
    // A fresh database (say, restored from the wrong backup) with none of
    // the logbooks the log has published.
    const other = await createThrowawayDatabase(inject('serverUrl'), 'anchor2');
    try {
      await migrate(other.url);
      const db2 = createDatabase(other.url, 2);
      try {
        const out = await runAnchor({
          ...deps({ now: day('2026-11-10'), dir: join(tmp, 'checkout2') }),
          db: db2,
        });
        expect(out.outcome, lines.join('\n')).toBe('refused');
        expect(out.detail).toMatch(
          new RegExp(`Logbook "${b.slug}" was in the last anchor in the log`),
        );
        expect(await db2.selectFrom('chain_anchors').select('id').execute()).toHaveLength(0);
      } finally {
        await db2.destroy();
      }
    } finally {
      await other.drop();
    }
  });

  it('a day the log already holds and this database never wrote is refused, not overwritten', async () => {
    const other = await createThrowawayDatabase(inject('serverUrl'), 'anchor3');
    try {
      await migrate(other.url);
      const db2 = createDatabase(other.url, 2);
      try {
        const out = await runAnchor({
          ...deps({ now: day('2026-11-06'), dir: join(tmp, 'checkout3') }),
          db: db2,
        });
        expect(out.outcome).toBe('refused');
        expect(out.detail).toMatch(/already holds an anchor for 2026-11-06/);
      } finally {
        await db2.destroy();
      }
    } finally {
      await other.drop();
    }
  });
});

describe('when the authority misbehaves', () => {
  it('nothing is anchored, the job fails, and it says why', async () => {
    const other = await createThrowawayDatabase(inject('serverUrl'), 'anchor4');
    try {
      await migrate(other.url);
      const db2 = createDatabase(other.url, 2);
      try {
        const lb = await launchedLogbook(db2);
        await fileReport(db2, lb, { what: 'x' });
        for (const [mode, why] of [
          ['refuse', /refused the request/],
          ['other-digest', /different digest/],
          ['http-error', /HTTP 503/],
        ] as const) {
          tsa.mode = mode;
          const out = await runAnchor({
            ...deps({ now: day('2026-12-01'), dir: join(tmp, 'checkout4'), remotes: [] }),
            db: db2,
          });
          expect(out).toMatchObject({ outcome: 'failed', exitCode: 1 });
          expect(out.detail).toMatch(why);
        }
        expect(await db2.selectFrom('chain_anchors').select('id').execute()).toHaveLength(0);
        tsa.mode = 'ok';
        // No remote configured: anchored and kept here, and the job still fails loudly.
        const out = await runAnchor({
          ...deps({ now: day('2026-12-01'), dir: join(tmp, 'checkout4'), remotes: [] }),
          db: db2,
        });
        expect(out).toMatchObject({ outcome: 'not_published', exitCode: 1 });
        expect(out.detail).toMatch(/TRANSPARENCY_LOG_REMOTES is not set/);
      } finally {
        await db2.destroy();
      }
    } finally {
      tsa.mode = 'ok';
      await other.drop();
    }
  });
});
