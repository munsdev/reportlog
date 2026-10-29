/**
 * What root does with the Updates screen's request file (deploy/lib.sh,
 * run_update_request), run for real through `reportlog request` against a
 * pretend server (deploy-sandbox.ts).
 *
 * THE PROMISES UNDER TEST:
 *   - the file is untrusted: a branch outside main, beta and alpha, a
 *     release id that is not the exact name of a kept release, a field the
 *     action does not take, or a value said twice refuses the whole request;
 *   - installing from a branch makes the server follow it, and every later
 *     check (the daily one too) looks there;
 *   - the branch a release came from is recorded beside it at deploy time;
 *   - nothing older than the database is installed, by the button or at a
 *     terminal; going back is only ever a rollback;
 *   - the ordinary rollback goes one step and only once; a named one goes to
 *     any release the server keeps.
 */
import { mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Server } from './deploy-sandbox.ts';

vi.setConfig({ testTimeout: 30_000 });

const made: Server[] = [];
afterEach(() => {
  for (const s of made.splice(0)) s.remove();
});

const CURRENT = '/srv/reportlog/current';
const PREVIOUS = '/srv/reportlog/previous';
const RELEASES = '/srv/reportlog/releases';
const MIGRATION = '20261019000000_new.sql';

/**
 * A server running main's v1, with a beta branch one commit ahead of it and
 * main one commit ahead too. Every commit carries the migration MIGRATION.
 */
function server() {
  const s = new Server();
  made.push(s);
  mkdirSync(join(s.upstream, 'apps/api/migrations'), { recursive: true });
  writeFileSync(join(s.upstream, 'apps/api/migrations', MIGRATION), '-- one\n');
  const v1 = s.commit('v1');
  const r = s.reportlog('deploy');
  expect(r.status, r.out).toBe(0);
  s.git('checkout', '-q', '-b', 'beta');
  writeFileSync(join(s.upstream, 'package.json'), '{"version":"0.3.0"}\n');
  const beta = s.commit('beta work');
  s.git('checkout', '-q', 'main');
  writeFileSync(join(s.upstream, 'package.json'), '{"version":"0.2.0"}\n');
  const main2 = s.commit('v2');
  s.clearCalls();
  return { s, v1, beta, main2 };
}

/** Write a request as the service user would, and run what the path unit runs. */
function request(s: Server, text: string) {
  writeFileSync(s.at('/var/lib/reportlog/update-request/request'), text);
  const r = s.reportlog('request');
  expect(r.status, r.out).toBe(0);
  expect(s.exists('/var/lib/reportlog/update-request/request')).toBe(false);
  return { status: kv(s.read('/var/lib/reportlog/update-status/status')), log: log(s) };
}

const log = (s: Server) => s.read('/var/lib/reportlog/update-status/log');

function kv(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

const releases = (s: Server) => s.ls(RELEASES).filter((d) => !d.endsWith('.failed'));

/**
 * Give every release a distinct time, in the order given (oldest first),
 * keeping current and previous pointing at the same releases. Deploys in a
 * test land in the same second, and ids then order by commit, not by age.
 */
function age(s: Server, oldestFirst: string[]): string[] {
  const cur = s.release(CURRENT);
  const prev = s.release(PREVIOUS);
  const renamed = oldestFirst.map((id, i) => {
    const to = `2026010${String(i + 1)}T000000Z-${id.split('-')[1] ?? ''}`;
    renameSync(s.at(`${RELEASES}/${id}`), s.at(`${RELEASES}/${to}`));
    return to;
  });
  const relink = (link: string, id: string | null) => {
    rmSync(s.at(link), { force: true });
    const i = oldestFirst.indexOf(id ?? '');
    if (i >= 0) symlinkSync(s.at(`${RELEASES}/${renamed[i] ?? ''}`), s.at(link));
  };
  relink(CURRENT, cur);
  relink(PREVIOUS, prev);
  return renamed;
}

describe('the request file is untrusted', () => {
  it.each([
    ['a branch outside the list', 'action=check\nbranch=test\n'],
    ['a branch with more after it', 'action=check\nbranch=main;rm -rf /\n'],
    ['a branch in another case', 'action=apply\nsha=' + 'a'.repeat(40) + '\nbranch=Main\n'],
    ['an empty branch', 'action=check\nbranch=\n'],
    ['a branch said twice', 'action=check\nbranch=beta\nbranch=main\n'],
    ['a commit on a check', `action=check\nsha=${'a'.repeat(40)}\n`],
    ['a branch on a rollback', 'action=rollback\nbranch=main\n'],
    [
      'a release on an apply',
      `action=apply\nsha=${'a'.repeat(40)}\nrelease=20260101T000000Z-aaaaaaaaaaaa\n`,
    ],
    ['a release that is a path', 'action=rollback\nrelease=../../../etc\n'],
    [
      'a release of another shape',
      'action=rollback\nrelease=20260101T000000Z-aaaaaaaaaaaa.failed\n',
    ],
    ['an apply with no commit', 'action=apply\nbranch=beta\n'],
  ])('refuses %s, and nothing runs', (_what, text) => {
    const { s, v1 } = server();
    const r = request(s, text);
    expect(r.status.state).toBe('refused');
    expect(r.log).toContain('The request was not one this server accepts');
    expect(s.read(`${CURRENT}/REVISION`).trim()).toBe(v1);
    expect(s.calls().filter((c) => c.startsWith('git '))).toEqual([]);
    expect(s.exists('/srv/reportlog/follow')).toBe(false);
  });

  it('refuses an action it does not know, the old test build among them', () => {
    const { s } = server();
    for (const text of ['action=apply_test\n', 'action=deploy\n', '', 'branch=main\n']) {
      expect(request(s, text).status).toMatchObject({ state: 'refused', action: 'unknown' });
    }
  });

  it('never reads through a link put where the request goes', () => {
    const { s, v1 } = server();
    writeFileSync(s.at('/etc/reportlog/secret'), 'action=rollback\n');
    symlinkSync(s.at('/etc/reportlog/secret'), s.at('/var/lib/reportlog/update-request/request'));
    expect(s.reportlog('request').status).toBe(0);
    expect(kv(s.read('/var/lib/reportlog/update-status/status')).state).toBe('refused');
    expect(s.read(`${CURRENT}/REVISION`).trim()).toBe(v1);
    expect(s.exists('/etc/reportlog/secret')).toBe(true);
  });
});

describe('checking and installing from a branch', () => {
  it('a check of a branch shows what it offers, and follows nothing', () => {
    const { s, beta } = server();
    const r = request(s, 'action=check\nbranch=beta\n');
    expect(r.status.state, r.log).toBe('done');
    expect(s.read('/var/lib/reportlog/updates/ref').trim()).toBe('beta');
    expect(s.read('/var/lib/reportlog/updates/tip').trim()).toBe(beta);
    expect(s.exists('/srv/reportlog/follow')).toBe(false);
    expect(s.read('/var/lib/reportlog/installed/following').trim()).toBe('main');
  });

  it('installing from a branch records it beside the release and follows it from then on', () => {
    const { s, beta } = server();
    request(s, 'action=check\nbranch=beta\n');
    const r = request(s, `action=apply\nsha=${beta}\nbranch=beta\n`);
    expect(r.status.state, r.log).toBe('done');
    expect(r.log).toContain('From now on this server follows beta');
    const id = s.releaseOf(beta) ?? '';
    expect(s.release(CURRENT)).toBe(id);
    expect(s.read(`${RELEASES}/${id}/BRANCH`)).toBe('beta\n');
    expect(s.read('/srv/reportlog/follow')).toBe('beta\n');

    // The daily check (`reportlog updates`) and a plain check now look at beta.
    expect(s.reportlog('updates').status).toBe(0);
    expect(s.read('/var/lib/reportlog/updates/ref').trim()).toBe('beta');
    request(s, 'action=check\n');
    expect(s.read('/var/lib/reportlog/updates/ref').trim()).toBe('beta');

    // What the screen reads: following, and each release with its branch and version.
    expect(s.read('/var/lib/reportlog/installed/following')).toBe('beta\n');
    expect(s.read('/var/lib/reportlog/installed/current')).toBe(`${id}\n`);
    expect(s.read('/var/lib/reportlog/installed/releases')).toContain(`${id} ${beta} beta 0.3.0\n`);
  });

  it('a commit that is not the tip of the branch named is refused', () => {
    const { s, main2 } = server();
    const r = request(s, `action=apply\nsha=${main2}\nbranch=beta\n`);
    expect(r.status.state).toBe('refused');
    expect(r.log).toContain('What is on offer changed');
    expect(s.releaseOf(main2)).toBeUndefined();
  });

  it('a branch in the list that the repository does not have says so', () => {
    const { s } = server();
    const r = request(s, `action=apply\nsha=${'a'.repeat(40)}\nbranch=alpha\n`);
    expect(r.status.state).toBe('refused');
    expect(r.log).toContain('There is no branch called alpha on the repository');
  });

  it('a server following a branch outside the list still checks and updates on it', () => {
    const { s } = server();
    s.git('checkout', '-q', '-b', 'test');
    const t = s.commit('test build');
    s.git('checkout', '-q', 'main');
    writeFileSync(
      s.at('/etc/reportlog/deploy.env'),
      s.read('/etc/reportlog/deploy.env').replace('DEPLOY_REF=main', 'DEPLOY_REF=test'),
    );
    request(s, 'action=check\n');
    expect(s.read('/var/lib/reportlog/updates/ref').trim()).toBe('test');
    const r = request(s, `action=apply\nsha=${t}\n`);
    expect(r.status.state, r.log).toBe('done');
    // Recorded as test (the followed ref points at it), and nothing new is followed.
    expect(s.read(`${RELEASES}/${s.releaseOf(t) ?? ''}/BRANCH`)).toBe('test\n');
    expect(s.exists('/srv/reportlog/follow')).toBe(false);
    expect(s.read('/var/lib/reportlog/installed/following')).toBe('test\n');
  });

  it('a terminal deploy records the branch it was given, and the followed one by default', () => {
    const { s, v1, main2 } = server();
    expect(s.reportlog('deploy', 'beta').status).toBe(0);
    expect(s.read(`${CURRENT}/BRANCH`)).toBe('beta\n');
    expect(s.reportlog('deploy').status).toBe(0);
    expect(s.read(`${RELEASES}/${s.releaseOf(main2) ?? ''}/BRANCH`)).toBe('main\n');
    // A bare commit that is no branch's tip records no branch.
    expect(s.reportlog('rollback', s.releaseOf(v1) ?? '').status).toBe(0);
    s.set('applied-migrations', `${MIGRATION}\n`);
    const old = s.commit('v3');
    s.git('reset', '-q', '--hard', 'HEAD~1');
    s.git('tag', 'v3', old);
    expect(s.reportlog('deploy', old).status).toBe(0);
    expect(s.exists(`${RELEASES}/${s.releaseOf(old) ?? ''}/BRANCH`)).toBe(false);
  });
});

describe('never anything older than the database', () => {
  it('the button refuses a commit lacking a migration the database has, in a plain sentence', () => {
    const { s, beta } = server();
    s.set('applied-migrations', `${MIGRATION}\n20261101000000_newer.sql\n`);
    request(s, 'action=check\nbranch=beta\n');
    const before = releases(s);
    const r = request(s, `action=apply\nsha=${beta}\nbranch=beta\n`);
    expect(r.status.state).toBe('refused');
    expect(r.log).toContain(
      `Not installed: ${beta.slice(0, 12)} is older than this site's database`,
    );
    expect(r.log).toContain('20261101000000_newer.sql, which that version does not');
    expect(r.log).toContain('roll back to a release this server keeps');
    expect(releases(s)).toEqual(before);
    expect(s.exists('/srv/reportlog/follow')).toBe(false);
    // Asked of the database, as the service user, through the running release.
    const i = s.index(/^node .*cli\.ts applied-migrations$/);
    expect(i).toBeGreaterThan(0);
    expect(s.calls()[i - 1]).toMatch(/^runuser -u reportlog -- env -i /);
  });

  it('so does a deploy at a terminal, before anything is unpacked', () => {
    const { s, main2 } = server();
    s.set('applied-migrations', `${MIGRATION}\n20261101000000_newer.sql\n`);
    const before = s.ls(RELEASES);
    const r = s.reportlog('deploy');
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      `Not installed: ${main2.slice(0, 12)} is older than this site's database`,
    );
    expect(s.ls(RELEASES)).toEqual(before);
  });

  it('installs a commit that carries every migration the database has', () => {
    const { s, main2 } = server();
    s.set('applied-migrations', `${MIGRATION}\n`);
    request(s, 'action=check\n');
    expect(request(s, `action=apply\nsha=${main2}\n`).status.state).toBe('done');
    expect(s.read(`${CURRENT}/REVISION`).trim()).toBe(main2);
  });

  it('a running release too old to ask falls back to its own migrations', () => {
    const { s } = server();
    // It cannot answer, and it carries a migration main lacks.
    s.set('applied-migrations-unknown');
    writeFileSync(s.at(`${CURRENT}/apps/api/migrations/20261102000000_only_here.sql`), '');
    const r = s.reportlog('deploy');
    expect(r.status).toBe(1);
    expect(r.out).toContain('20261102000000_only_here.sql, which that version does not');
  });
});

describe('rollback from the screen', () => {
  /** Three releases, aged so that the order is v1, then beta, then main2 (running). */
  function three() {
    const { s, v1, beta, main2 } = server();
    expect(s.reportlog('deploy', 'beta').status).toBe(0);
    expect(s.reportlog('deploy', 'main').status).toBe(0);
    const ids = age(s, [s.releaseOf(v1) ?? '', s.releaseOf(beta) ?? '', s.releaseOf(main2) ?? '']);
    s.clearCalls();
    return { s, ids, v1, beta, main2 };
  }

  it('the ordinary one goes one step back, once', () => {
    const { s, ids } = three();
    expect(request(s, 'action=rollback\n').status.state).toBe('done');
    expect(s.release(CURRENT)).toBe(ids[1]);
    const again = request(s, 'action=rollback\n');
    expect(again.status.state).toBe('refused');
    expect(again.log).toContain('There is nothing older to go back to');
    expect(s.release(CURRENT)).toBe(ids[1]);
  });

  it('a named one goes to any release the server keeps, two steps back too', () => {
    const { s, ids } = three();
    const r = request(s, `action=rollback\nrelease=${ids[0] ?? ''}\n`);
    expect(r.status, r.log).toMatchObject({ state: 'done', release: ids[0] });
    expect(s.release(CURRENT)).toBe(ids[0]);
    // And forward again to a kept release: no rule about age for a named one.
    expect(request(s, `action=rollback\nrelease=${ids[2] ?? ''}\n`).status.state).toBe('done');
    expect(s.release(CURRENT)).toBe(ids[2]);
    // What the screen lists afterwards, newest first.
    expect(
      s
        .read('/var/lib/reportlog/installed/releases')
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split(' ')[0]),
    ).toEqual([...ids].reverse());
  });

  it('refuses a release it does not keep, a failed one, and the running one', () => {
    const { s, ids } = three();
    let r = request(s, 'action=rollback\nrelease=20200101T000000Z-aaaaaaaaaaaa\n');
    expect(r.status.state).toBe('refused');
    expect(r.log).toContain('This server keeps no release called 20200101T000000Z-aaaaaaaaaaaa');
    // A failed release has another name, which no request can spell.
    mkdirSync(s.at(`${RELEASES}/20300101T000000Z-bbbbbbbbbbbb.failed`));
    writeFileSync(s.at(`${RELEASES}/20300101T000000Z-bbbbbbbbbbbb.failed/REVISION`), 'b\n');
    r = request(s, 'action=rollback\nrelease=20300101T000000Z-bbbbbbbbbbbb\n');
    expect(r.status.state).toBe('refused');
    r = request(s, `action=rollback\nrelease=${ids[2] ?? ''}\n`);
    expect(r.status.state).toBe('refused');
    expect(r.log).toContain('is the one running already');
    expect(s.release(CURRENT)).toBe(ids[2]);
    expect(s.calls().filter((c) => c.startsWith('systemctl restart'))).toEqual([]);
  });

  it('keeps the lock: a request while a deploy holds it is refused', () => {
    const { s, ids } = three();
    const lock = s.at('/run/reportlog-deploy.lock');
    writeFileSync(lock, '');
    const holder = `exec 9>${JSON.stringify(lock)}; flock -n 9; ${JSON.stringify(s.at('/usr/local/bin/reportlog'))} request`;
    writeFileSync(s.at('/var/lib/reportlog/update-request/request'), 'action=rollback\n');
    const r = s.run('bash', ['-c', holder]);
    expect(r.status, r.out).toBe(0);
    expect(log(s)).toContain('A deploy is already running');
    expect(kv(s.read('/var/lib/reportlog/update-status/status')).state).toBe('refused');
    expect(s.release(CURRENT)).toBe(ids[2]);
  });
});
