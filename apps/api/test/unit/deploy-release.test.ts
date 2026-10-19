/**
 * What deploy/deploy.sh, deploy/rollback.sh and `reportlog` actually do.
 *
 * Each test runs the real scripts, through `reportlog` as an operator would,
 * against a pretend server in a temporary directory (deploy-sandbox.ts says
 * how). Releases, symlinks, unit files, the rendered Caddyfile and the
 * mirror are real files written by the scripts; systemd, Caddy, the build,
 * the migrations and the health check are stand-ins that record what they
 * were asked and fail when a test says so.
 *
 * The promise under test is the order in deploy.sh's header: everything that
 * can fail happens before the running release is touched.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Server } from './deploy-sandbox.ts';

// Each test runs a few whole deploys: well under a second each, but many processes.
vi.setConfig({ testTimeout: 30_000 });

const made: Server[] = [];
afterEach(() => {
  for (const s of made.splice(0)) s.remove();
});
function server(): Server {
  const s = new Server();
  made.push(s);
  return s;
}

const CURRENT = '/srv/reportlog/current';
const PREVIOUS = '/srv/reportlog/previous';

/** A server running v1, and v2 committed upstream but not deployed. */
function runningV1() {
  const s = server();
  const v1 = s.commit('v1');
  expect(s.reportlog('deploy').status).toBe(0);
  writeFileSync(join(s.upstream, 'CHANGELOG.md'), '## v0.2.0\n');
  const v2 = s.commit('v2');
  s.clearCalls();
  return { s, v1, v2, r1: s.releaseOf(v1) ?? '' };
}

/** Nothing that switches or restarts was called. */
function nothingSwitched(s: Server) {
  expect(
    s.calls().filter((c) => /^systemctl (restart|reload|daemon-reload|enable)/.test(c)),
  ).toEqual([]);
  expect(s.calls().filter((c) => c.startsWith('caddy '))).toEqual([]);
}

describe('a first deploy', () => {
  it('builds as the service user, migrates, then switches, in that order', () => {
    const s = server();
    const sha = s.commit('v1');
    const r = s.reportlog('deploy');
    expect(r.status, r.out).toBe(0);

    const id = s.releaseOf(sha);
    expect(id).toMatch(new RegExp(`^\\d{8}T\\d{6}Z-${sha.slice(0, 12)}$`));
    expect(s.release(CURRENT)).toBe(id);
    expect(s.release(PREVIOUS)).toBeNull();
    expect(s.read(`/srv/reportlog/releases/${String(id)}/REVISION`)).toBe(`${sha}\n`);

    const order = [
      /^pnpm install --frozen-lockfile --reporter/,
      /^pnpm --filter @reportlog\/web build/,
      /^pnpm install .*--prod/,
      /^chown -R root:root /,
      /^node .*migrate-cli\.ts$/,
      /^node .*cli\.ts contact-key$/,
      /^caddy validate/,
      /^systemctl reload caddy$/,
      /^install .*\/etc\/systemd\/system\/reportlog-api\.service$/,
      /^systemctl daemon-reload$/,
      /^systemctl restart reportlog-api\.service$/,
      /^curl .*\/api\/health$/,
      /^install .*\/usr\/local\/bin\/reportlog$/,
      /^node .*cli\.ts doctor$/,
    ];
    let at = -1;
    for (const step of order) {
      const next = s.index(step, at + 1);
      expect(
        next,
        `${String(step)} after call ${String(at)}:\n${s.calls().join('\n')}`,
      ).toBeGreaterThan(at);
      at = next;
    }
  });

  it('never runs a package script or the application as root', () => {
    const s = server();
    s.commit('v1');
    s.reportlog('deploy');
    const calls = s.calls();
    for (const [i, c] of calls.entries()) {
      if (/^(pnpm|node) /.test(c)) {
        // Every pnpm and node call sits under a runuser to the service user, with a clean environment.
        const owner =
          calls
            .slice(0, i)
            .reverse()
            .find((x) => /^runuser |^sh /.test(x)) ?? '';
        expect(owner, c).toMatch(
          /^runuser -u reportlog -- env -i HOME=\S*\/var\/cache\/reportlog-build /,
        );
      }
    }
    // The application reads its settings from the env file, never from root's environment.
    for (const c of calls.filter((x) => x.startsWith('node '))) {
      expect(c).toContain(`--env-file=${s.at('/etc/reportlog/reportlog.env')}`);
    }
  });

  it('ships without the build tools and hands the release to root, read-only to the app', () => {
    const s = server();
    const sha = s.commit('v1');
    s.reportlog('deploy');
    const dir = `/srv/reportlog/releases/${String(s.releaseOf(sha))}`;
    expect(s.exists(`${dir}/node_modules/.production`)).toBe(true);
    expect(s.exists(`${dir}/node_modules/vite`)).toBe(false);
    expect(s.exists(`${dir}/apps/web/dist/index.html`)).toBe(true);
    expect(s.calls()).toContain(`chown -R root:root ${s.at(dir)}`);
    for (const p of [dir, `${dir}/REVISION`, `${dir}/deploy/lib.sh`]) {
      expect(statSync(s.at(p)).mode & 0o022, p).toBe(0);
    }
  });

  it("installs the release's units and timers, and its Caddyfile with this server's domain", () => {
    const s = server();
    s.commit('v1');
    s.reportlog('deploy');
    const shipped = s.ls(`${CURRENT}/deploy/systemd`).filter((f) => /\.(service|timer)$/.test(f));
    expect(shipped.length).toBeGreaterThan(5);
    for (const f of shipped) {
      expect(s.read(`/etc/systemd/system/${f}`), f).toBe(s.read(`${CURRENT}/deploy/systemd/${f}`));
    }
    expect(s.read('/etc/systemd/system/reportlog-job@backup.service.d/backup.conf')).toBe(
      s.read(`${CURRENT}/deploy/systemd/reportlog-job@backup.service.d/backup.conf`),
    );
    for (const t of shipped.filter((f) => f.endsWith('.timer'))) {
      expect(s.calls()).toContain(`systemctl enable --now ${t}`);
    }

    const caddy = s.read('/etc/caddy/Caddyfile');
    expect(caddy).toMatch(/^reports\.example\.org \{$/m);
    expect(caddy).toMatch(/^\temail ops@example\.org$/m);
    expect(caddy).not.toContain('@SITE_DOMAIN@');
    expect(caddy).not.toContain('@ACME_EMAIL_LINE@');
  });

  it('gives the certificate authority no email when ACME_EMAIL is empty', () => {
    const s = server();
    writeFileSync(
      s.at('/etc/reportlog/deploy.env'),
      `REPO_URL=${s.upstream}\nDEPLOY_REF=main\nACME_EMAIL=\n`,
    );
    s.commit('v1');
    expect(s.reportlog('deploy').status).toBe(0);
    expect(s.read('/etc/caddy/Caddyfile')).not.toMatch(/^\s*email\b/m);
  });

  it('checks health on the PORT the settings name', () => {
    const s = server();
    s.commit('v1');
    s.reportlog('deploy');
    expect(s.calls()).toContain('curl -fsS --max-time 2 http://127.0.0.1:3123/api/health');
  });

  it('refreshes the scripts root runs from the release it just activated', () => {
    const s = server();
    s.commit('v1');
    s.reportlog('deploy');
    for (const f of ['deploy.sh', 'rollback.sh', 'install.sh', 'lib.sh', 'versions.conf']) {
      expect(s.read(`/usr/local/lib/reportlog/${f}`), f).toBe(s.read(`${CURRENT}/deploy/${f}`));
    }
    expect(s.read('/usr/local/bin/reportlog')).toBe(s.read(`${CURRENT}/deploy/bin/reportlog`));
  });
});

describe('a deploy onto a running release', () => {
  it('switches current, keeps the old one as previous, and says how to go back', () => {
    const { s, v2, r1 } = runningV1();
    const r = s.reportlog('deploy');
    expect(r.status, r.out).toBe(0);
    expect(s.release(CURRENT)).toBe(s.releaseOf(v2));
    expect(s.release(PREVIOUS)).toBe(r1);
    expect(r.out).toContain(`To go back: sudo reportlog rollback   (to ${r1})`);
  });

  it('does nothing when the commit is already running', () => {
    const { s, v1 } = runningV1();
    const r = s.reportlog('deploy', v1);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('Nothing to deploy');
    expect(s.ls('/srv/reportlog/releases')).toHaveLength(1);
    nothingSwitched(s);
  });

  it('removes the units of a timer the new release no longer has', () => {
    const { s } = runningV1();
    rmSync(join(s.upstream, 'deploy/systemd/reportlog-files.timer'));
    s.commit('v3: no files timer');
    expect(s.reportlog('deploy').status).toBe(0);
    expect(s.exists('/etc/systemd/system/reportlog-files.timer')).toBe(false);
    expect(s.calls()).toContain('systemctl disable --now reportlog-files.timer');
    expect(s.exists('/etc/systemd/system/reportlog-sweep.timer')).toBe(true);
  });

  it('leaves an unchanged Caddyfile alone, and reloads Caddy only for a changed one', () => {
    const { s } = runningV1();
    expect(s.reportlog('deploy').out).toContain('Caddyfile unchanged');
    expect(s.calls().filter((c) => c.startsWith('systemctl reload caddy'))).toEqual([]);
  });

  it('keeps the newest five releases, and never the ones current and previous point at', () => {
    const { s, v2, r1 } = runningV1();
    // Nine releases from long ago; the oldest is made the running one, so
    // after this deploy it is `previous`: old, and still kept.
    const old = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
      (i) => `2020010${String(i)}T000000Z-00000000000${String(i)}`,
    );
    for (const d of old) {
      mkdirSync(s.at(`/srv/reportlog/releases/${d}`));
      writeFileSync(s.at(`/srv/reportlog/releases/${d}/REVISION`), 'x\n');
    }
    s.run('ln', ['-sfn', s.at(`/srv/reportlog/releases/${String(old[0])}`), s.at(CURRENT)]);
    expect(s.reportlog('deploy').status).toBe(0);
    const r2 = s.releaseOf(v2) ?? '';
    expect(s.release(PREVIOUS)).toBe(old[0]);
    expect(s.ls('/srv/reportlog/releases')).toEqual(
      [old[0], old[6], old[7], old[8], r1, r2].sort(),
    );
  });
});

describe('a deploy that fails leaves the running release running', () => {
  it('a failed build: kept as .failed, no migration, nothing switched', () => {
    const { s, v2, r1 } = runningV1();
    s.set('build-fails');
    const r = s.reportlog('deploy');
    expect(r.status).toBe(1);
    expect(r.out).toContain(`the build failed. Still running: release ${r1}`);
    expect(s.release(CURRENT)).toBe(r1);
    expect(
      s.ls('/srv/reportlog/releases').filter((d) => d.endsWith(`${v2.slice(0, 12)}.failed`)),
    ).toHaveLength(1);
    expect(s.index(/migrate-cli/)).toBe(-1);
    nothingSwitched(s);
  });

  it('a failed migration: kept as .failed, units untouched, nothing switched', () => {
    const { s, r1 } = runningV1();
    rmSync(join(s.upstream, 'deploy/systemd/reportlog-files.timer'));
    s.commit('v3');
    s.set('migrate-fails');
    const r = s.reportlog('deploy');
    expect(r.status).toBe(1);
    expect(r.out).toContain('migrations failed. The release was NOT switched');
    expect(r.out).toContain('20261019000000_new.sql failed: boom');
    expect(s.release(CURRENT)).toBe(r1);
    expect(s.ls('/srv/reportlog/releases').some((d) => d.endsWith('.failed'))).toBe(true);
    expect(s.exists('/etc/systemd/system/reportlog-files.timer')).toBe(true);
    expect(s.index(/contact-key/)).toBe(-1);
    nothingSwitched(s);
  });

  it('a different CONTACT_KEY: stops before switching', () => {
    const { s, r1 } = runningV1();
    s.set('contact-key-differs');
    const r = s.reportlog('deploy');
    expect(r.status).toBe(1);
    expect(r.out).toContain('CONTACT_KEY differs from the key this archive started with');
    expect(s.release(CURRENT)).toBe(r1);
    nothingSwitched(s);
  });

  it('a Caddyfile that does not validate: nothing switched, and no unit of the new release installed', () => {
    const { s, r1 } = runningV1();
    // A change to the units, so installing them would show.
    rmSync(join(s.upstream, 'deploy/systemd/reportlog-files.timer'));
    // And to the Caddyfile, so it is validated at all.
    writeFileSync(
      join(s.upstream, 'deploy/caddy/Caddyfile'),
      `${s.read(`${CURRENT}/deploy/caddy/Caddyfile`)}\n# changed\n`,
    );
    s.commit('v3');
    s.set('caddy-invalid');
    const r = s.reportlog('deploy');
    expect(r.status).toBe(1);
    expect(r.out).toContain('does not validate. Nothing was switched.');
    expect(s.release(CURRENT)).toBe(r1);
    expect(s.exists('/etc/systemd/system/reportlog-files.timer')).toBe(true);
    expect(s.calls().filter((c) => /^systemctl (daemon-reload|disable|restart)/.test(c))).toEqual(
      [],
    );
  });

  it('a release that does not answer: switched back, its old previous restored, kept as .failed', () => {
    const { s, v2, r1 } = runningV1();
    // A previous before v1, so restoring it is visible.
    const before = '20200101T000000Z-aaaaaaaaaaaa';
    mkdirSync(s.at(`/srv/reportlog/releases/${before}`));
    writeFileSync(s.at(`/srv/reportlog/releases/${before}/REVISION`), 'a\n');
    s.run('ln', ['-sfn', s.at(`/srv/reportlog/releases/${before}`), s.at(PREVIOUS)]);

    s.set(`unhealthy-${v2}`);
    const r = s.reportlog('deploy');
    expect(r.status).toBe(1);
    expect(r.out).toContain(`The new release did not answer. Switching back to ${r1}`);
    expect(r.out).toContain(`${r1} is running again`);
    expect(s.release(CURRENT)).toBe(r1);
    expect(s.release(PREVIOUS)).toBe(before);
    expect(
      s.ls('/srv/reportlog/releases').some((d) => d.endsWith(`${v2.slice(0, 12)}.failed`)),
    ).toBe(true);
    // Restarted on the new one, then on the old one.
    expect(s.calls().filter((c) => c === 'systemctl restart reportlog-api.service')).toHaveLength(
      2,
    );
    expect(s.calls().some((c) => c.startsWith('journalctl -u reportlog-api.service'))).toBe(true);
    // The scripts root runs are still the running release's.
    expect(s.read('/usr/local/lib/reportlog/deploy.sh')).toBe(
      s.read(`${CURRENT}/deploy/deploy.sh`),
    );
  });

  it('a first release that does not answer says so, with nothing to switch back to', () => {
    const s = server();
    s.commit('v1');
    s.set('unhealthy-all');
    const r = s.reportlog('deploy');
    expect(r.status).toBe(1);
    expect(r.out).toContain('the first release did not answer on /api/health');
  });

  it('a ref that does not exist: no release directory is made', () => {
    const { s, r1 } = runningV1();
    const r = s.reportlog('deploy', 'no-such-branch');
    expect(r.status).toBe(1);
    expect(r.out).toContain('no-such-branch is not a branch, tag or commit');
    expect(s.ls('/srv/reportlog/releases')).toEqual([r1]);
  });

  it('a repository that cannot be fetched: stops with nothing changed', () => {
    const { s, r1 } = runningV1();
    writeFileSync(
      s.at('/etc/reportlog/deploy.env'),
      `REPO_URL=${s.dir}/gone.git\nDEPLOY_REF=main\n`,
    );
    const r = s.reportlog('deploy');
    expect(r.status).toBe(1);
    expect(r.out).toContain('could not fetch main');
    expect(s.ls('/srv/reportlog/releases')).toEqual([r1]);
  });
});

describe('a deploy refuses to start', () => {
  it('without root', () => {
    const s = server();
    s.commit('v1');
    s.set('not-root');
    const r = s.reportlog('deploy');
    expect(r.status).toBe(1);
    expect(r.out).toContain('run it with sudo');
    expect(s.calls().every((c) => c.startsWith('id '))).toBe(true);
    // deploy.sh asks again itself, for whoever runs it without the command.
    const direct = s.run(s.at('/usr/local/lib/reportlog/deploy.sh'));
    expect(direct.status).toBe(1);
    expect(direct.out).toContain('run this as root (with sudo)');
  });

  it('without its settings', () => {
    const s = server();
    s.commit('v1');
    rmSync(s.at('/etc/reportlog/deploy.env'));
    const r = s.reportlog('deploy');
    expect(r.status).toBe(1);
    expect(r.out).toContain('deploy.env is missing. Run install.sh first.');
    expect(s.exists('/srv/reportlog/repo.git')).toBe(false);
  });

  it('while another deploy or rollback holds the lock', async () => {
    const s = server();
    s.commit('v1');
    // Another deploy: a process holding the lock until told to stop.
    const holder = spawn('flock', [s.at('/run/reportlog-deploy.lock'), 'sleep', '30']);
    await new Promise((r) => setTimeout(r, 300));
    try {
      const r = s.reportlog('deploy');
      expect(r.status).toBe(1);
      expect(r.out).toContain('another deploy or rollback is running');
      expect(s.exists('/srv/reportlog/repo.git')).toBe(false);
      const u = s.reportlog('updates');
      expect(u.status).toBe(0);
      expect(u.out).toContain('A deploy is running; the update check will run next time.');
    } finally {
      holder.kill();
    }
  });
});

describe('rollback', () => {
  function twoReleases() {
    const { s, v1, v2, r1 } = runningV1();
    expect(s.reportlog('deploy').status).toBe(0);
    s.clearCalls();
    return { s, v1, v2, r1, r2: s.releaseOf(v2) ?? '' };
  }

  it('goes to previous, never touches the database, and twice is where it started', () => {
    const { s, r1, r2 } = twoReleases();
    const r = s.reportlog('rollback');
    expect(r.status, r.out).toBe(0);
    expect(s.release(CURRENT)).toBe(r1);
    expect(s.release(PREVIOUS)).toBe(r2);
    // No node at all: no migration, no doctor, nothing of the application's.
    expect(s.calls().filter((c) => /^(node|runuser) /.test(c))).toEqual([]);
    expect(s.calls()).toContain('systemctl restart reportlog-api.service');
    expect(r.out).toContain('The database keeps the newer release');

    expect(s.reportlog('rollback').status).toBe(0);
    expect(s.release(CURRENT)).toBe(r2);
    expect(s.release(PREVIOUS)).toBe(r1);
  });

  it("installs the target's units and tooling", () => {
    const { s, r1 } = twoReleases();
    rmSync(join(s.upstream, 'deploy/systemd/reportlog-files.timer'));
    s.commit('v3');
    s.reportlog('deploy');
    expect(s.exists('/etc/systemd/system/reportlog-files.timer')).toBe(false);
    expect(s.reportlog('rollback', r1).status).toBe(0);
    expect(s.exists('/etc/systemd/system/reportlog-files.timer')).toBe(true);
    expect(s.read('/usr/local/lib/reportlog/lib.sh')).toBe(
      s.read(`/srv/reportlog/releases/${r1}/deploy/lib.sh`),
    );
  });

  it('refuses what is not a release, a failed one, the running one, and no previous', () => {
    const { s, r2 } = twoReleases();
    const refuse = (args: string[], says: string) => {
      const r = s.reportlog('rollback', ...args);
      expect(r.status, args.join(' ')).toBe(1);
      expect(r.out).toContain(says);
      expect(s.release(CURRENT)).toBe(r2);
    };
    refuse(['20200101T000000Z-nothere'], 'is not a release');
    refuse(['../../../etc'], 'is not a release');
    refuse([r2], 'is already running');
    mkdirSync(s.at('/srv/reportlog/releases/20300101T000000Z-ffffffffffff.failed'));
    writeFileSync(
      s.at('/srv/reportlog/releases/20300101T000000Z-ffffffffffff.failed/REVISION'),
      'f\n',
    );
    refuse(['20300101T000000Z-ffffffffffff.failed'], 'a release that failed to deploy');
    rmSync(s.at(PREVIOUS));
    refuse([], 'there is no previous release to go back to');
    nothingSwitched(s);
  });

  it('says how to return when the target does not answer', () => {
    const { s, v1, r2 } = twoReleases();
    s.set(`unhealthy-${v1}`);
    const r = s.reportlog('rollback');
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      `to return to the release you came from: sudo reportlog rollback ${r2}`,
    );
  });
});

describe('the reportlog command', () => {
  it('lists releases, marking the running one and the previous one', () => {
    const { s, r1 } = runningV1();
    s.reportlog('deploy');
    const r2 = s.release(CURRENT) ?? '';
    const out = s.reportlog('releases').out;
    expect(out).toContain(`* ${r2}`);
    expect(out).toContain(`< ${r1}`);
    expect(out.indexOf(r2)).toBeLessThan(out.indexOf(r1));
  });

  it("runs the application's commands as the service user, in the running release", () => {
    const { s } = runningV1();
    const cases: [string[], string][] = [
      [['doctor'], 'cli.ts doctor'],
      [['backup', '--check'], 'cli.ts run backup --check'],
      [['job', 'sweep'], 'cli.ts run sweep'],
      [['jobs'], 'cli.ts jobs'],
      [['mail-test', 'you@example.org'], 'cli.ts mail-test you@example.org'],
    ];
    for (const [args, expected] of cases) {
      s.clearCalls();
      const r = s.reportlog(...args);
      expect(r.status, r.out).toBe(0);
      const calls = s.calls();
      const i = calls.findIndex((c) => c.startsWith('node '));
      expect(calls[i], args.join(' ')).toBe(
        `node --env-file=${s.at('/etc/reportlog/reportlog.env')} apps/api/src/jobs/cli.ts ${expected.replace('cli.ts ', '')}`,
      );
      expect(calls[i + 1]).toContain(
        `(in ${s.at(`/srv/reportlog/releases/${String(s.release(CURRENT))}`)},`,
      );
      expect(calls[i - 1]).toMatch(/^runuser -u reportlog -- env -i /);
    }
  });

  it('says what to do when nothing is deployed, the command is unknown, or sudo is missing', () => {
    const s = server();
    expect(s.reportlog('doctor').out).toContain(
      'nothing is deployed yet. Run: sudo reportlog deploy',
    );
    const unknown = s.reportlog('frobnicate');
    expect(unknown.status).toBe(1);
    expect(unknown.out).toContain('unknown command: frobnicate');
    s.set('not-root');
    expect(s.reportlog('releases').out).toContain('run it with sudo: sudo reportlog releases');
    s.unset('not-root');
    const help = s.reportlog('help');
    expect(help.status).toBe(0);
    for (const c of [
      'deploy [ref]',
      'rollback [id]',
      'releases',
      'doctor',
      'backup',
      'mail-test',
      'jobs',
      'job <name>',
      'updates',
    ]) {
      expect(help.out).toContain(`reportlog ${c}`);
    }
  });
});
