/**
 * The Update button's half of the bargain: it writes one small file root
 * reads (deploy/lib.sh, run_update_request), naming only what was on offer.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { updatesView, writeRequest } from '../../src/site/updateRoutes.ts';

const TIP = 'a'.repeat(40);

async function stateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rl-updates-'));
  await mkdir(join(dir, 'updates'));
  await mkdir(join(dir, 'update-request'));
  await writeFile(join(dir, 'updates', 'checked_at'), '2026-10-22T10:00:00Z\n');
  await writeFile(join(dir, 'updates', 'ref'), 'stable\n');
  await writeFile(join(dir, 'updates', 'current'), `${'b'.repeat(40)}\n`);
  await writeFile(join(dir, 'updates', 'tip'), `${TIP}\n`);
  await writeFile(join(dir, 'updates', 'behind'), '3\n');
  return dir;
}

describe('the Update button', () => {
  it('asks for exactly the commit on offer, and nothing while one is waiting', async () => {
    const dir = await stateDir();
    await writeRequest(dir, { action: 'apply', sha: TIP });
    expect(await readFile(join(dir, 'update-request', 'request'), 'utf8')).toBe(
      `action=apply\nsha=${TIP}\n`,
    );
    expect((await updatesView(dir)).waiting).toBe(true);
    await expect(writeRequest(dir, { action: 'check' })).rejects.toMatchObject({ code: 'busy' });
  });

  it('can ask for the test build, naming no commit and no branch', async () => {
    const dir = await stateDir();
    await writeRequest(dir, { action: 'apply_test' });
    expect(await readFile(join(dir, 'update-request', 'request'), 'utf8')).toBe(
      'action=apply_test\n',
    );
    await expect(writeRequest(dir, { action: 'check' })).rejects.toMatchObject({ code: 'busy' });
  });

  it('can ask to go back one release, naming no release', async () => {
    const dir = await stateDir();
    await writeRequest(dir, { action: 'rollback' });
    expect(await readFile(join(dir, 'update-request', 'request'), 'utf8')).toBe(
      'action=rollback\n',
    );
  });

  it('refuses a commit that is not the one on offer', async () => {
    const dir = await stateDir();
    await expect(writeRequest(dir, { action: 'apply', sha: 'c'.repeat(40) })).rejects.toMatchObject(
      { code: 'stale' },
    );
  });

  it('reads back what root reported', async () => {
    const dir = await stateDir();
    await mkdir(join(dir, 'update-status'));
    await writeFile(
      join(dir, 'update-status', 'status'),
      `state=done\naction=apply\nsha=${TIP}\nat=2026-10-22T10:05:00Z\n`,
    );
    await writeFile(join(dir, 'update-status', 'log'), 'Deployed.\n');
    expect((await updatesView(dir)).last).toMatchObject({ state: 'done', log: 'Deployed.\n' });
  });
});
