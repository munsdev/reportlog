/**
 * Bugsink on the archive's own server (decision 13): deploy/install-bugsink.sh,
 * the files it installs, and its place in the Caddyfile every deploy renders.
 *
 * Run against the pretend server (deploy-sandbox.ts) the other deploy tests
 * use: apt, systemd, pip and Bugsink's own commands are stand-ins that record
 * what they were asked; the files the script writes are real and are what
 * these tests read. Answers to the script's questions are typed on standard
 * input, as a person would. The Caddyfile with Bugsink's site in it is also
 * validated and served by a real Caddy (CADDY_BIN), as deploy-caddy.test.ts
 * does for the archive's.
 *
 * What was run for real, once, outside these tests: Bugsink 2.6.1 installed
 * from deploy/bugsink/requirements.txt (Python 3.11 and 3.12), migrated, an
 * administrator and the project made with the script's own Python, and an
 * error relayed by the archive's API through the DSN this script writes
 * (docs/status/Q3-quality-ops.md).
 */
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO, Server } from './deploy-sandbox.ts';

const made: Server[] = [];
afterEach(() => {
  for (const s of made.splice(0)) s.remove();
});

const ENV = '/etc/reportlog/reportlog.env';
const VERSION =
  /^BUGSINK_VERSION=(.*)$/m.exec(readFileSync(join(REPO, 'deploy/versions.conf'), 'utf8'))?.[1] ??
  '';
const repoFile = (f: string) => readFileSync(join(REPO, f), 'utf8');

/** A server as install.sh leaves it. */
function server(): Server {
  const s = new Server();
  made.push(s);
  s.set('user-reportlog');
  return s;
}

const installBugsink = (s: Server, answers: string[] = []) =>
  s.run(join(s.checkout, 'deploy/install-bugsink.sh'), [], {
    input: answers.map((a) => `${a}\n`).join(''),
  });

/** The answers a first run needs: the domain, the administrator, the password twice. */
const FIRST = [
  'bugsink.reports.example.org',
  'ops@example.org',
  'a long enough password',
  'a long enough password',
];

describe('install-bugsink.sh on a server', () => {
  it('installs Bugsink in order, as its own user, from the hash-pinned requirements', () => {
    const s = server();
    const r = installBugsink(s, FIRST);
    expect(r.status, r.out).toBe(0);
    const order = [
      /^apt-get install .* python3-venv$/,
      /^useradd --system --user-group --home-dir \S+\/var\/lib\/bugsink --no-create-home --shell \/usr\/sbin\/nologin bugsink$/,
      new RegExp(`^python3 -m venv \\S+/opt/bugsink-${VERSION.replace(/\./g, '\\.')}$`),
      /^pip install --quiet --disable-pip-version-check --require-hashes --only-binary :all: --no-deps -r \S+\/deploy\/bugsink\/requirements\.txt$/,
      /^runuser -u bugsink -- env -i .*bugsink-manage migrate --no-input -v0$/,
      /^runuser -u bugsink -- env -i .*bugsink-manage migrate snappea --database=snappea --no-input -v0$/,
      /^runuser -u bugsink -- env -i .*bugsink-manage createsuperuser --no-input --username ops@example\.org --email ops@example\.org$/,
      /^systemctl enable bugsink\.service bugsink-snappea\.service$/,
      /^systemctl restart bugsink\.service bugsink-snappea\.service$/,
      /^curl .*127\.0\.0\.1:8000\/accounts\/login\/$/,
      /^systemctl try-restart reportlog-api\.service$/,
    ];
    let at = -1;
    for (const step of order) {
      const next = s.index(step, at + 1);
      expect(next, `${String(step)} after ${String(at)}:\n${s.calls().join('\n')}`).toBeGreaterThan(
        at,
      );
      at = next;
    }
    // Every Bugsink command ran with its own keys and in its own directory.
    const notes = s.calls().filter((c) => c.startsWith('  (SECRET_KEY'));
    expect(notes.length).toBeGreaterThanOrEqual(4);
    for (const n of notes) {
      expect(n).toContain('SECRET_KEY set, BUGSINK_BASE_URL=https://bugsink.reports.example.org');
      expect(n).toMatch(/in \S+\/var\/lib\/bugsink\)$/);
    }
    expect(execFileSync('readlink', [s.at('/opt/bugsink')], { encoding: 'utf8' }).trim()).toBe(
      s.at(`/opt/bugsink-${VERSION}`),
    );
  });

  it('writes its settings and its own key, readable by Bugsink and nobody else', () => {
    const s = server();
    const r = installBugsink(s, FIRST);
    expect(r.status, r.out).toBe(0);
    expect(s.read('/etc/bugsink/bugsink_conf.py')).toBe(repoFile('deploy/bugsink/bugsink_conf.py'));
    expect(s.read('/etc/bugsink/bugsink.caddy')).toBe(repoFile('deploy/bugsink/bugsink.caddy'));
    const env = s.read('/etc/bugsink/bugsink.env');
    const key = /^SECRET_KEY=([A-Za-z0-9]+)$/m.exec(env)?.[1] ?? '';
    expect(key).toHaveLength(64);
    expect(env).toMatch(/^BUGSINK_BASE_URL=https:\/\/bugsink\.reports\.example\.org$/m);
    expect(statSync(s.at('/etc/bugsink/bugsink.env')).mode & 0o777).toBe(0o640);
    expect(r.out).not.toContain(key);
    // The domain is kept for every later deploy's Caddyfile.
    expect(s.read('/etc/reportlog/deploy.env')).toMatch(
      /^BUGSINK_DOMAIN=bugsink\.reports\.example\.org$/m,
    );
  });

  it('makes the administrator with the password through the environment, never the command line', () => {
    const s = server();
    const r = installBugsink(s, FIRST);
    expect(r.status, r.out).toBe(0);
    expect(readFileSync(join(s.control, 'bugsink-admin'), 'utf8')).toBe('a long enough password');
    expect(s.calls().join('\n')).not.toContain('a long enough password');
    expect(r.out).not.toContain('a long enough password');
  });

  it('points the archive at it through the local port, and restarts the API to read it', () => {
    const s = server();
    const mode = statSync(s.at(ENV)).mode;
    const r = installBugsink(s, FIRST);
    expect(r.status, r.out).toBe(0);
    expect(s.read(ENV)).toMatch(
      /^ERROR_TRACKING_DSN=http:\/\/0123456789abcdef0123456789abcdef@127\.0\.0\.1:8000\/3$/m,
    );
    // Rewritten in place: the settings file keeps its owner and mode.
    expect(statSync(s.at(ENV)).mode).toBe(mode);
  });

  it('installs both services byte for byte', () => {
    const s = server();
    expect(installBugsink(s, FIRST).status).toBe(0);
    for (const unit of ['bugsink.service', 'bugsink-snappea.service']) {
      expect(s.read(`/etc/systemd/system/${unit}`), unit).toBe(repoFile(`deploy/bugsink/${unit}`));
    }
  });

  it("suggests bugsink.<the site's domain>, taken on Enter", () => {
    const s = server();
    const r = installBugsink(s, ['', ...FIRST.slice(1)]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('Enter for bugsink.reports.example.org');
    expect(s.read('/etc/reportlog/deploy.env')).toMatch(
      /^BUGSINK_DOMAIN=bugsink\.reports\.example\.org$/m,
    );
  });
});

describe('install-bugsink.sh run again', () => {
  it('asks nothing and changes nothing it made: key, administrator, DSN, the installed Bugsink', () => {
    const s = server();
    expect(installBugsink(s, FIRST).status).toBe(0);
    const env = s.read('/etc/bugsink/bugsink.env');
    const settings = s.read(ENV);
    s.clearCalls();
    const r = installBugsink(s);
    expect(r.status, r.out).toBe(0);
    expect(s.read('/etc/bugsink/bugsink.env')).toBe(env);
    expect(s.read(ENV)).toBe(settings);
    expect(r.out).toContain('an administrator exists');
    expect(r.out).toContain('ERROR_TRACKING_DSN is already set; left as it is.');
    expect(s.calls().filter((c) => /^(pip|python3|useradd) /.test(c))).toEqual([]);
    expect(s.calls().filter((c) => c.includes('createsuperuser'))).toEqual([]);
  });

  it('leaves a DSN somebody set by hand alone', () => {
    const s = server();
    writeFileSync(
      s.at(ENV),
      `${s.read(ENV)}ERROR_TRACKING_DSN=https://kept@bugsink.elsewhere.example/9\n`,
    );
    expect(installBugsink(s, FIRST).status).toBe(0);
    expect(s.read(ENV)).toMatch(
      /^ERROR_TRACKING_DSN=https:\/\/kept@bugsink\.elsewhere\.example\/9$/m,
    );
  });

  it('makes no administrator when nobody answers, and says how to make one later', () => {
    const s = server();
    const r = installBugsink(s, ['bugsink.reports.example.org']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('No administrator yet. Run this script again to make one.');
    expect(s.calls().filter((c) => c.includes('createsuperuser'))).toEqual([]);
  });
});

describe('install-bugsink.sh refuses', () => {
  it('to run before install.sh', () => {
    const s = server();
    rmSync(s.at(ENV));
    const r = installBugsink(s, FIRST);
    expect(r.status).toBe(1);
    expect(r.out).toContain('run install.sh first');
    expect(s.calls().filter((c) => c.startsWith('apt-get'))).toEqual([]);
  });

  it('something that is not a domain, before installing anything', () => {
    const s = server();
    const r = installBugsink(s, ['not a domain; rm -rf /']);
    expect(r.status).toBe(1);
    expect(r.out).toContain('is not a domain name. Nothing was installed.');
    expect(s.calls().filter((c) => /^(apt-get|useradd|python3) /.test(c))).toEqual([]);
    expect(s.read('/etc/reportlog/deploy.env')).not.toContain('BUGSINK_DOMAIN=not');
  });

  it('a download whose hash does not match, and leaves nothing half-installed', () => {
    const s = server();
    s.set('pip-fails');
    const r = installBugsink(s, FIRST);
    expect(r.status).toBe(1);
    expect(r.out).toContain('Bugsink could not be installed');
    expect(s.exists(`/opt/bugsink-${VERSION}`)).toBe(false);
    expect(s.exists('/opt/bugsink')).toBe(false);
    expect(s.exists('/etc/systemd/system/bugsink.service')).toBe(false);
    expect(s.read(ENV)).not.toContain('ERROR_TRACKING_DSN=');
  });

  it('two passwords that differ, and makes no administrator', () => {
    const s = server();
    const r = installBugsink(s, [
      FIRST[0] ?? '',
      'ops@example.org',
      'a long enough password',
      'another',
    ]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('the two passwords differ');
    expect(s.calls().filter((c) => c.includes('createsuperuser'))).toEqual([]);
  });

  it('a Bugsink that does not answer once started, naming the journal', () => {
    const s = server();
    s.set('bugsink-down');
    const r = installBugsink(s, FIRST);
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      'Bugsink does not answer on 127.0.0.1:8000. See: journalctl -u bugsink',
    );
  });
});

describe('Bugsink in the Caddyfile', () => {
  /** A deployed server: the one Caddyfile Caddy reads, rendered by lib.sh. */
  function deployed(): Server {
    const s = server();
    s.commit('first');
    const r = s.reportlog('deploy');
    expect(r.status, r.out).toBe(0);
    return s;
  }

  it('is added by the installer on a deployed server, and kept by every later deploy', () => {
    const s = deployed();
    const before = s.read('/etc/caddy/Caddyfile');
    expect(before).not.toContain('bugsink');
    expect(installBugsink(s, FIRST).status).toBe(0);
    const withBugsink = s.read('/etc/caddy/Caddyfile');
    expect(withBugsink.startsWith(before)).toBe(true);
    expect(withBugsink).toContain('\nbugsink.reports.example.org {\n');
    expect(withBugsink).toContain('reverse_proxy 127.0.0.1:8000');

    writeFileSync(join(s.upstream, 'CHANGED'), 'x');
    s.commit('second');
    const r = s.reportlog('deploy');
    expect(r.status, r.out).toBe(0);
    expect(s.read('/etc/caddy/Caddyfile')).toBe(withBugsink);
  });

  it('is not there on a server without BUGSINK_DOMAIN', () => {
    const s = deployed();
    expect(s.read('/etc/caddy/Caddyfile')).not.toMatch(/bugsink|8000/);
  });

  it('is waited for on a server not deployed yet: the first deploy adds it', () => {
    const s = server();
    const r = installBugsink(s, FIRST);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('the first deploy adds bugsink.reports.example.org to Caddy');
    s.commit('first');
    expect(s.reportlog('deploy').status).toBe(0);
    expect(s.read('/etc/caddy/Caddyfile')).toContain('bugsink.reports.example.org {');
  });
});

describe('what ships for Bugsink', () => {
  const conf = repoFile('deploy/bugsink/bugsink_conf.py');
  const requirements = repoFile('deploy/bugsink/requirements.txt');

  it('pins the version in versions.conf, every package by hash', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(requirements).toContain(`\nbugsink==${VERSION} \\\n`);
    expect(repoFile('deploy/bugsink/requirements.in')).toMatch(
      new RegExp(`^bugsink==${VERSION.replace(/\./g, '\\.')}$`, 'm'),
    );
    const packages = requirements.split('\n').filter((l) => /^[a-z0-9]/i.test(l));
    expect(packages.length).toBeGreaterThan(10);
    for (const p of packages) {
      expect(p, p).toMatch(/^[a-z0-9._-]+==[^\s;]+( ;[^\\]+)? \\$/i);
    }
    // Every package is followed by at least one hash.
    const blocks = requirements.split(/\n(?=[a-z0-9])/i).filter((b) => /^[a-z0-9]/i.test(b));
    for (const b of blocks) expect(b, b.split('\n')[0]).toMatch(/--hash=sha256:[0-9a-f]{64}/);
  });

  it('holds no secret, and turns off what would talk to anybody else', () => {
    expect(conf).toMatch(/^SECRET_KEY = os\.environ\["SECRET_KEY"\]$/m);
    expect(conf).not.toMatch(/SECRET_KEY = ["']/);
    expect(conf).toMatch(/"PHONEHOME": False,/);
    expect(conf).toMatch(/^SENTRY_DSN = None$/m);
    expect(conf).toMatch(/"ALERTS_WEBHOOK_OUTBOUND_MODE": "allowlist_only",/);
    // No visitor's or operator's address is taken from a header.
    expect(conf).toMatch(/^USE_X_REAL_IP = False$/m);
    expect(conf).not.toMatch(/^USE_X_FORWARDED_FOR\s*=\s*True/m);
    // Its own database, under its own directory.
    expect(conf).toMatch(/DATABASES\["default"\]\["NAME"\] = "\/var\/lib\/bugsink\/db\.sqlite3"/);
  });

  it('runs without an access log, and never near the archive’s settings', () => {
    for (const unit of ['bugsink.service', 'bugsink-snappea.service']) {
      const text = repoFile(`deploy/bugsink/${unit}`);
      expect(text, unit).toMatch(/^User=bugsink$/m);
      expect(text, unit).toMatch(/^EnvironmentFile=\/etc\/bugsink\/bugsink\.env$/m);
      expect(
        text
          .split('\n')
          .filter((l) => !l.startsWith('#'))
          .join('\n'),
        unit,
      ).not.toContain('/etc/reportlog');
      expect(text, unit).not.toMatch(/access-log/);
      expect(text, unit).toMatch(/^ProtectSystem=strict$/m);
    }
    expect(repoFile('deploy/bugsink/bugsink.service')).toMatch(
      /^ExecStart=\S+gunicorn --bind=127\.0\.0\.1:8000 /m,
    );
    expect(repoFile('deploy/bugsink/bugsink.caddy')).not.toMatch(/^\s*log\b/m);
  });
});

// --- in a real Caddy ---------------------------------------------------------

const CADDY = process.env.CADDY_BIN ?? 'caddy';
const hasCaddy = (() => {
  try {
    execFileSync(CADDY, ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!hasCaddy && process.env.CI)
  throw new Error(`deploy-bugsink: no caddy at "${CADDY}"; CI installs one.`);

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) =>
    s.close(() => {
      r();
    }),
  );
  return port;
}

describe.skipIf(!hasCaddy)('Bugsink’s site, in Caddy', () => {
  it('validates with the archive’s, as a deploy renders them together', () => {
    const s = server();
    s.commit('first');
    expect(s.reportlog('deploy').status).toBe(0);
    expect(installBugsink(s, FIRST).status).toBe(0);
    execFileSync(
      CADDY,
      ['validate', '--adapter', 'caddyfile', '--config', s.at('/etc/caddy/Caddyfile')],
      {
        stdio: 'pipe',
        env: { ...process.env, HOME: s.dir, XDG_DATA_HOME: s.dir, XDG_CONFIG_HOME: s.dir },
      },
    );
  });

  it('passes requests to Bugsink with their host, and sends the security headers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-bugsink-caddy-'));
    const seen: IncomingHttpHeaders[] = [];
    const bugsink: HttpServer = createServer((req, res) => {
      seen.push(req.headers);
      res.setHeader('Server', 'gunicorn');
      res.end('bugsink');
    });
    await new Promise<void>((r) => bugsink.listen(0, '127.0.0.1', r));
    const stand = (bugsink.address() as AddressInfo).port;
    const [site, admin] = [await freePort(), await freePort()];
    const file = join(dir, 'Caddyfile');
    const block = repoFile('deploy/bugsink/bugsink.caddy')
      .replace('@BUGSINK_DOMAIN@ {', `http://127.0.0.1:${String(site)} {`)
      .replace('reverse_proxy 127.0.0.1:8000', `reverse_proxy 127.0.0.1:${String(stand)}`);
    writeFileSync(file, `{\n\tadmin 127.0.0.1:${String(admin)}\n}\n\n${block}`);
    let caddy: ChildProcess | undefined;
    try {
      caddy = spawn(CADDY, ['run', '--adapter', 'caddyfile', '--config', file], {
        stdio: 'ignore',
        env: { ...process.env, HOME: dir, XDG_DATA_HOME: dir, XDG_CONFIG_HOME: dir },
      });
      let res: Response | undefined;
      for (let i = 0; i < 50 && !res; i++) {
        res = await fetch(`http://127.0.0.1:${String(site)}/accounts/login/`, {
          headers: { 'X-Forwarded-For': '203.0.113.7' },
        }).catch(() => undefined);
        if (!res) await new Promise((r) => setTimeout(r, 100));
      }
      expect(res?.status).toBe(200);
      expect(await res?.text()).toBe('bugsink');
      expect(res?.headers.get('strict-transport-security')).toBe(
        'max-age=31536000; includeSubDomains',
      );
      expect(res?.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res?.headers.get('x-frame-options')).toBe('DENY');
      expect(res?.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res?.headers.get('server')).toBeNull();
      expect(seen[0]?.host).toBe(`127.0.0.1:${String(site)}`);
      expect(seen[0]?.['x-forwarded-proto']).toBe('http');
      // The visitor's claim is not passed on as if it were true.
      expect(seen[0]?.['x-forwarded-for']).not.toContain('203.0.113.7');
    } finally {
      caddy?.kill();
      await new Promise<void>((r) =>
        bugsink.close(() => {
          r();
        }),
      );
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
