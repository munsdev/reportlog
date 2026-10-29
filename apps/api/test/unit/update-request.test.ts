/**
 * The Update button's half of the bargain: it writes one small file root
 * reads (deploy/lib.sh, run_update_request), naming only what was on offer,
 * a branch from the fixed list, or a release the server keeps.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateRequestBody } from '@reportlog/contracts';
import { describe, expect, it } from 'vitest';
import { releasePoint, updatesView, writeRequest } from '../../src/site/updateRoutes.ts';

const TIP = 'a'.repeat(40);
const RUNNING = '20261022T100000Z-bbbbbbbbbbbb';
const BEFORE = '20261021T100000Z-cccccccccccc';
const OLDEST = '20261020T100000Z-dddddddddddd';

async function stateDir(ref = 'main'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rl-updates-'));
  await mkdir(join(dir, 'updates'));
  await mkdir(join(dir, 'update-request'));
  await writeFile(join(dir, 'updates', 'checked_at'), '2026-10-22T10:00:00Z\n');
  await writeFile(join(dir, 'updates', 'ref'), `${ref}\n`);
  await writeFile(join(dir, 'updates', 'current'), `${'b'.repeat(40)}\n`);
  await writeFile(join(dir, 'updates', 'tip'), `${TIP}\n`);
  await writeFile(join(dir, 'updates', 'behind'), '3\n');
  return dir;
}

/** What root writes after a deploy (write_release_facts). */
async function installed(dir: string, previous = BEFORE) {
  await mkdir(join(dir, 'installed'));
  await writeFile(join(dir, 'installed', 'following'), 'main\n');
  await writeFile(join(dir, 'installed', 'current'), `${RUNNING}\n`);
  await writeFile(join(dir, 'installed', 'previous'), `${previous}\n`);
  await writeFile(
    join(dir, 'installed', 'releases'),
    [
      `${RUNNING} ${'b'.repeat(40)} main 0.2.0`,
      `${BEFORE} ${'c'.repeat(40)} beta 0.1.1`,
      `${OLDEST} ${'d'.repeat(40)} - -`,
      'garbage that is no release',
      '',
    ].join('\n'),
  );
}

const sent = async (dir: string) => readFile(join(dir, 'update-request', 'request'), 'utf8');

describe('the Update button', () => {
  it('asks for exactly the commit on offer, and nothing while one is waiting', async () => {
    const dir = await stateDir();
    await writeRequest(dir, { action: 'apply', sha: TIP });
    expect(await sent(dir)).toBe(`action=apply\nsha=${TIP}\n`);
    expect((await updatesView(dir)).waiting).toBe(true);
    await expect(writeRequest(dir, { action: 'check' })).rejects.toMatchObject({ code: 'busy' });
  });

  it('checks a branch from the list by name', async () => {
    const dir = await stateDir();
    await writeRequest(dir, { action: 'check', branch: 'beta' });
    expect(await sent(dir)).toBe('action=check\nbranch=beta\n');
  });

  it('installs from the branch the last check looked at, naming it', async () => {
    const dir = await stateDir('beta');
    await installed(dir);
    await writeRequest(dir, { action: 'apply', sha: TIP, branch: 'beta' });
    expect(await sent(dir)).toBe(`action=apply\nsha=${TIP}\nbranch=beta\n`);
  });

  it('refuses a commit that is not the one on offer, or from another branch than was checked', async () => {
    const dir = await stateDir('beta');
    await installed(dir);
    await expect(writeRequest(dir, { action: 'apply', sha: 'c'.repeat(40) })).rejects.toMatchObject(
      { code: 'stale' },
    );
    // The check looked at beta: the same commit asked for from alpha, or
    // from the followed main, is not what the page showed.
    for (const branch of ['alpha', undefined] as const) {
      await expect(
        writeRequest(dir, { action: 'apply', sha: TIP, ...(branch ? { branch } : {}) }),
      ).rejects.toMatchObject({ code: 'stale' });
    }
  });

  it('goes back one step naming nothing, or to a kept release by its name', async () => {
    const dir = await stateDir();
    await installed(dir);
    await writeRequest(dir, { action: 'rollback' });
    expect(await sent(dir)).toBe('action=rollback\n');
    const other = await stateDir();
    await installed(other);
    await writeRequest(other, { action: 'rollback', release: OLDEST });
    expect(await sent(other)).toBe(`action=rollback\nrelease=${OLDEST}\n`);
  });

  it('refuses a release the server does not keep, and the running one', async () => {
    const dir = await stateDir();
    await installed(dir);
    for (const release of ['20200101T000000Z-eeeeeeeeeeee', RUNNING]) {
      await expect(writeRequest(dir, { action: 'rollback', release })).rejects.toMatchObject({
        code: 'stale',
      });
    }
  });

  it('the contract lets through only the fixed branches and release-shaped names', () => {
    const ok = (b: unknown) => UpdateRequestBody.safeParse(b).success;
    expect(ok({ action: 'check', branch: 'alpha' })).toBe(true);
    for (const branch of ['test', 'Main', 'main\nsha=x', '', 'refs/heads/main']) {
      expect(ok({ action: 'check', branch }), branch).toBe(false);
      expect(ok({ action: 'apply', sha: TIP, branch }), branch).toBe(false);
    }
    for (const release of ['../../etc', `${OLDEST}.failed`, `${OLDEST}\n`, 'current']) {
      expect(ok({ action: 'rollback', release }), release).toBe(false);
    }
    expect(ok({ action: 'apply_test' })).toBe(false);
  });

  it('reads back what root reported', async () => {
    const dir = await stateDir();
    await mkdir(join(dir, 'update-status'));
    await writeFile(
      join(dir, 'update-status', 'status'),
      `state=done\naction=apply\nsha=${TIP}\nbranch=\nrelease=\nat=2026-10-22T10:05:00Z\n`,
    );
    await writeFile(join(dir, 'update-status', 'log'), 'Deployed.\n');
    expect((await updatesView(dir)).last).toMatchObject({ state: 'done', log: 'Deployed.\n' });
  });
});

describe('what the screen is told is installed', () => {
  it('the running release with its date, commit and branch, and every other one newest first', async () => {
    const dir = await stateDir();
    await installed(dir);
    const v = await updatesView(dir);
    expect(v.following).toBe('main');
    expect(v.installed).toEqual({
      id: RUNNING,
      installed_at: '2026-10-22T10:00:00Z',
      commit: 'b'.repeat(40),
      branch: 'main',
      version: 'v0.2.0',
    });
    expect(v.release_points.map((r) => r.id)).toEqual([BEFORE, OLDEST]);
    expect(v.release_points[1]).toMatchObject({ branch: null, version: null });
    expect(v.roll_back_to?.id).toBe(BEFORE);
  });

  it('offers the ordinary roll back only while the previous release is older', async () => {
    const dir = await stateDir();
    // After one rollback `previous` is the newer release it left.
    await installed(dir, '20261023T100000Z-ffffffffffff');
    expect((await updatesView(dir)).roll_back_to).toBeNull();
  });

  it('before root has said anything, falls back to what the check found', async () => {
    const v = await updatesView(await stateDir('test'));
    expect(v).toMatchObject({ following: 'test', installed: null, roll_back_to: null });
    expect(v.release_points).toEqual([]);
  });

  it('reads a release line strictly', () => {
    expect(releasePoint(`${OLDEST} ${'d'.repeat(40)} beta 1.2.3`)).toMatchObject({
      branch: 'beta',
      version: 'v1.2.3',
    });
    expect(releasePoint(`${OLDEST} nothex beta 1.2.3`)).toBeNull();
    expect(releasePoint(`../x ${'d'.repeat(40)} beta 1.2.3`)).toBeNull();
    expect(releasePoint(`${OLDEST} ${'d'.repeat(40)} <b>; 01.2`)).toMatchObject({
      branch: null,
      version: null,
    });
  });
});
