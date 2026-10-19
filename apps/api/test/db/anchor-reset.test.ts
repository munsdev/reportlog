/**
 * THE RESET MARKER: publishing that published proofs no longer reconcile.
 *
 * An import with --new-chain builds chains the log never timestamped. The
 * archive's answer is `anchor reset-marker`, which publishes the fact beside
 * the anchors as `resets/<date>.json` and changes nothing that was already in
 * the log. Before this file nothing ran `api/anchor/reset.ts` at all.
 *
 * The whole path, as an operator would take it: a deployment anchors to a
 * log, is exported, is imported somewhere new under a changed sealing rule
 * (so --new-chain), and publishes the reset from a fresh checkout. The log is
 * a bare git repository standing in for the real mirror.
 *
 * The command itself (`anchor reset-marker`) is not run here: its config
 * accepts only https://, ssh:// or git@ remotes, and these are local paths.
 * It is a thin wrapper over the two functions tested below.
 */
import { headsDigest } from '@reportlog/seal';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { runAnchor } from '../../src/anchor/anchor.ts';
import { exportArchive, importArchive } from '../../src/anchor/archive.ts';
import type { Archive } from '../../src/anchor/archive.ts';
import type { AnchorRecord } from '../../src/anchor/records.ts';
import { prettyFile } from '../../src/anchor/records.ts';
import { publishReset, resetRecord } from '../../src/anchor/reset.ts';
import type { ResetRecord } from '../../src/anchor/reset.ts';
import type { LogSettings } from '../../src/anchor/translog.ts';
import { currentHeads } from '../../src/chain/heads.ts';
import { createDatabase } from '../../src/db/database.ts';
import type { Database } from '../../src/db/database.ts';
import { migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import type { Throwaway } from '../../src/db/throwaway.ts';
import { fileReport, launchedLogbook } from './helpers.ts';
import { standInTsa } from './stand-in-tsa.ts';

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) =>
  (
    await exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd })
  ).stdout.trim();

const ANCHOR_DAY = '2026-11-04';
const RESET_DAY = '2026-11-09';
const REASON =
  'The sealing code changed how a date answer is written, so every chain was rebuilt from the export.';

let source: Throwaway;
let target: Throwaway;
let src: Database;
let dst: Database;
let tmp: string;
let remote: string;
let archive: Archive;
let anchorFile: string;

/** A file as the remote's main branch holds it, or null. */
async function atRemote(file: string): Promise<string | null> {
  try {
    return (await exec('git', ['--git-dir', remote, 'show', `main:${file}`])).stdout;
  } catch {
    return null;
  }
}

const head = () => git(tmp, '--git-dir', remote, 'rev-parse', 'main');

function settings(dir: string): LogSettings {
  return {
    dir: join(tmp, dir),
    remotes: [remote],
    branch: 'main',
    author: { name: 'ReportLog anchor', email: 'anchor@reportlog.invalid' },
  };
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'anchor-reset-'));
  // The log as the real one starts: a main branch with a README.
  remote = join(tmp, 'log.git');
  await git(tmp, 'init', '--quiet', '--bare', '--initial-branch', 'main', remote);
  const seed = join(tmp, 'seed');
  await git(tmp, 'clone', '--quiet', remote, seed);
  writeFileSync(join(seed, 'README.md'), '# transparency log\n');
  await git(seed, 'add', 'README.md');
  await git(seed, 'commit', '--quiet', '-m', 'README');
  await git(seed, 'push', '--quiet', 'origin', 'HEAD:main');

  source = await createThrowawayDatabase(inject('serverUrl'), 'reset_src');
  target = await createThrowawayDatabase(inject('serverUrl'), 'reset_dst');
  await migrate(source.url);
  await migrate(target.url);
  src = createDatabase(source.url, 3);
  dst = createDatabase(target.url, 3);

  const a = await launchedLogbook(src);
  const b = await launchedLogbook(src);
  const a1 = await fileReport(src, a, { what: 'first in a' });
  await fileReport(src, a, { what: 'second in a' });
  await fileReport(src, b, { what: 'first in b' });
  await src
    .insertInto('report_heads')
    .values({
      thread_id: a1.row.thread_id,
      current_report_id: a1.row.id,
      moderation_status: 'valid',
    })
    .execute();

  // The day's anchor, published to the log: the proof the reset must name.
  const tsa = await standInTsa();
  try {
    const out = await runAnchor({
      db: src,
      tsaUrl: tsa.url,
      say: () => undefined,
      now: () => new Date(`${ANCHOR_DAY}T04:00:00Z`),
      log: settings('anchor-checkout'),
    });
    expect(out.outcome).toBe('published');
  } finally {
    await tsa.close();
  }
  anchorFile = (await atRemote(`anchors/${ANCHOR_DAY}.json`)) ?? '';
  expect(anchorFile).not.toBe('');

  // Exported, then imported under a sealing rule that writes one answer
  // differently: the case --new-chain exists for. The answer is changed in
  // the export, row and sealed object alike, so the replay seals something
  // else and every chain after it gets new heads.
  archive = structuredClone(await exportArchive(src));
  const first = archive.reports[0];
  if (!first) throw new Error('no reports');
  const rewritten = { what: 'first in a, as the new rule writes it' };
  first.sealed = { ...first.sealed, answers: rewritten };
  first.row = { ...first.row, answers: rewritten };
  const imported = await importArchive(dst, archive, { newChain: true });
  expect(imported.identical).toBe(false);
});

afterAll(async () => {
  await src.destroy();
  await dst.destroy();
  await source.drop();
  await target.drop();
  rmSync(tmp, { recursive: true, force: true });
});

describe('the reset record', () => {
  it('refuses a reason too short to be worth publishing for good', async () => {
    await expect(
      resetRecord(dst, archive, { reason: '  rebuilt  ', date: RESET_DAY }),
    ).rejects.toThrow(/reason/);
  });

  it('names every anchor that stops reconciling, with the heads before and after', async () => {
    const record = await resetRecord(dst, archive, { reason: `  ${REASON}  `, date: RESET_DAY });
    const published = JSON.parse(anchorFile) as AnchorRecord;

    expect(record).toMatchObject({
      reset_format: 1,
      date: RESET_DAY,
      kind: 'chain_reset',
      reason: REASON,
      reports_carried: archive.reports.length,
    });
    // The old heads are the ones the published anchor timestamped, so a reader
    // can match the notice to the proof it voids.
    expect(record.previous_chains).toEqual(archive.previous_chain_list);
    expect(headsDigest(ANCHOR_DAY, record.previous_chains)).toBe(published.root_chain_hash);
    expect(record.anchors_no_longer_reconciling).toEqual([
      {
        date: ANCHOR_DAY,
        root_chain_hash: published.root_chain_hash,
        public_log_ref: `anchors/${ANCHOR_DAY}.json`,
      },
    ]);
    // The new heads are this database's, and they are not the old ones.
    expect(record.new_chains).toEqual(await currentHeads(dst));
    expect(record.new_chains.map((c) => c.head)).not.toEqual(
      record.previous_chains.map((c) => c.head),
    );
  });
});

describe('publishing it', () => {
  let record: ResetRecord;
  let before: string;

  beforeAll(async () => {
    record = await resetRecord(dst, archive, { reason: REASON, date: RESET_DAY });
    before = await head();
  });

  it('writes resets/<date>.json beside the anchors, from a fresh checkout, and says why in the commit', async () => {
    const out = await publishReset(record, settings('reset-checkout'));
    expect(out).toEqual({
      file: `resets/${RESET_DAY}.json`,
      reached: [expect.any(String)],
      failed: [],
    });
    expect(await atRemote(`resets/${RESET_DAY}.json`)).toBe(prettyFile(record));
    const message = await git(tmp, '--git-dir', remote, 'log', '-1', '--format=%B', 'main');
    expect(message).toContain(`Chain reset ${RESET_DAY}`);
    expect(message).toContain('1 published anchor(s) no longer reconcile.');
    expect(message).toContain(REASON);
  });

  it('CHANGES NOTHING ALREADY IN THE LOG: the anchor is byte for byte as published, and the history continues', async () => {
    expect(await atRemote(`anchors/${ANCHOR_DAY}.json`)).toBe(anchorFile);
    // Not force-pushed: what the log held before is still in its history.
    await expect(
      git(tmp, '--git-dir', remote, 'merge-base', '--is-ancestor', before, 'main'),
    ).resolves.toBe('');
    // One commit, adding one file.
    const changed = await git(tmp, '--git-dir', remote, 'diff', '--name-status', before, 'main');
    expect(changed).toBe(`A\tresets/${RESET_DAY}.json`);
  });

  it('A PUBLISHED NOTICE IS NEVER REPLACED, even from a checkout that has not seen it', async () => {
    const published = await atRemote(`resets/${RESET_DAY}.json`);
    const tip = await head();
    const other = { ...record, reason: `${REASON} Said differently the second time.` };
    for (const dir of ['reset-checkout', 'another-checkout']) {
      await expect(publishReset(other, settings(dir))).rejects.toThrow(/never replaced/);
    }
    expect(await atRemote(`resets/${RESET_DAY}.json`)).toBe(published);
    expect(await head()).toBe(tip);
  });
});
