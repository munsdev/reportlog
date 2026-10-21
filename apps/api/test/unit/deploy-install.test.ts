/**
 * What deploy/install.sh does to a fresh server, and what it refuses.
 *
 * Run against a pretend machine (deploy-sandbox.ts): apt, gpg, systemd,
 * PostgreSQL's tools and the downloads are stand-ins; the files it writes
 * (settings, apt configuration, keyrings, Node under /opt, the tooling) are
 * real and are what these tests read. The Node tarball is a real .tar.xz
 * made here, checked by the script's own sha256sum against a pin.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO, Sandbox } from './deploy-sandbox.ts';

const pin = (key: string) =>
  new RegExp(`^${key}=(.*)$`, 'm').exec(
    readFileSync(join(REPO, 'deploy/versions.conf'), 'utf8'),
  )?.[1] ?? '';
const NODE_VERSION = pin('NODE_VERSION');
const PGDG = pin('PGDG_KEY_FINGERPRINT');
const CADDY = pin('CADDY_KEY_FINGERPRINT');

const made: Sandbox[] = [];
afterEach(() => {
  for (const s of made.splice(0)) s.remove();
});

/** A fresh machine: what the OS and its packages would have put there, nothing of ReportLog's. */
function machine(
  os = { id: 'debian', codename: 'bookworm', pretty: 'Debian GNU/Linux 12 (bookworm)' },
) {
  const s = new Sandbox();
  made.push(s);
  for (const d of [
    '/etc/apt/apt.conf.d',
    '/etc/apt/preferences.d',
    '/etc/apt/sources.list.d',
    '/usr/share/keyrings',
    '/etc/postgresql/16/main/conf.d',
    '/usr/local/bin',
    '/opt',
  ]) {
    mkdirSync(s.at(d), { recursive: true });
  }
  writeFileSync(
    s.at('/etc/os-release'),
    `PRETTY_NAME="${os.pretty}"\nID=${os.id}\nVERSION_CODENAME=${os.codename}\n`,
  );
  // The signing keys as served: a stand-in key is its own fingerprint.
  s.set('downloads/ACCC4CF8.asc', PGDG);
  s.set('downloads/gpg.key', CADDY);
  for (const arch of ['x64', 'arm64']) nodeTarball(s, arch);
  return s;
}

/** A real Node tarball (a stand-in node inside), and its SHA-256 pinned in the checkout's versions.conf. */
function nodeTarball(s: Sandbox, arch: string) {
  const name = `node-v${NODE_VERSION}-linux-${arch}`;
  const dir = join(s.dir, 'tarball', name, 'bin');
  mkdirSync(dir, { recursive: true });
  for (const b of ['node', 'npm', 'npx', 'corepack']) {
    writeFileSync(join(dir, b), `#!/bin/sh\necho v${NODE_VERSION}\n`);
    chmodSync(join(dir, b), 0o755);
  }
  const file = join(s.control, 'downloads', `${name}.tar.xz`);
  mkdirSync(join(s.control, 'downloads'), { recursive: true });
  execFileSync('tar', ['-cJf', file, '-C', join(s.dir, 'tarball'), name]);
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
  const conf = join(s.checkout, 'deploy/versions.conf');
  const key = arch === 'x64' ? 'NODE_SHA256_X64' : 'NODE_SHA256_ARM64';
  writeFileSync(
    conf,
    readFileSync(conf, 'utf8').replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${sha}`),
  );
}

const install = (s: Sandbox) => s.run(join(s.checkout, 'deploy/install.sh'));
const ENV = '/etc/reportlog/reportlog.env';

describe('install.sh on a fresh Debian 12', () => {
  it('sets the machine up in order: updates, PostgreSQL, Node, Caddy, user and database, settings, command', () => {
    const s = machine();
    const r = install(s);
    expect(r.status, r.out).toBe(0);
    const order = [
      /^apt-get update/,
      /^apt-get install .* unattended-upgrades/,
      /^install .*20auto-upgrades /,
      /^systemctl enable --now unattended-upgrades\.service$/,
      /^curl .*ACCC4CF8\.asc/,
      /^apt-get install .*postgresql-16 postgresql-client-16$/,
      /^install .*postgres\/reportlog\.conf .*\/etc\/postgresql\/16\/main\/conf\.d\/reportlog\.conf$/,
      /^systemctl restart postgresql@16-main$/,
      /^curl .*nodejs\.org\/dist\/v[\d.]+\/node-v[\d.]+-linux-x64\.tar\.xz/,
      /^corepack enable/,
      /^curl .*caddy\/stable\/gpg\.key/,
      /^apt-get install .* caddy$/,
      /^useradd --system --user-group --home-dir \S+\/var\/lib\/reportlog --no-create-home --shell \/usr\/sbin\/nologin reportlog$/,
      /^createuser reportlog$/,
      /^createdb -O reportlog reportlog$/,
      /^chown root:reportlog \S+\/etc\/reportlog\/reportlog\.env$/,
      /^install .*\/usr\/local\/bin\/reportlog$/,
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

  it('turns on unattended upgrades and pins PostgreSQL to its own repository', () => {
    const s = machine();
    install(s);
    for (const f of ['20auto-upgrades', '52reportlog-unattended-upgrades']) {
      expect(s.read(`/etc/apt/apt.conf.d/${f}`)).toBe(
        readFileSync(join(REPO, 'deploy/apt', f), 'utf8'),
      );
    }
    expect(s.read('/etc/apt/preferences.d/reportlog-pgdg.pref')).toBe(
      readFileSync(join(REPO, 'deploy/apt/reportlog-pgdg.pref'), 'utf8'),
    );
    expect(s.read('/etc/apt/sources.list.d/pgdg.list')).toMatch(
      /^deb \[signed-by=\S+\/usr\/share\/keyrings\/pgdg\.gpg\] https:\/\/apt\.postgresql\.org\/pub\/repos\/apt bookworm-pgdg main$/m,
    );
    expect(s.read('/usr/share/keyrings/pgdg.gpg')).toBe(PGDG);
    expect(s.read('/usr/share/keyrings/caddy-stable-archive-keyring.gpg')).toBe(CADDY);
    expect(s.read('/etc/postgresql/16/main/conf.d/reportlog.conf')).toMatch(
      /^listen_addresses = ''$/m,
    );
  });

  it('installs Node from the checked tarball and links it into /usr/local/bin', () => {
    const s = machine();
    const r = install(s);
    const dir = `/opt/node-v${NODE_VERSION}-linux-x64`;
    for (const b of ['node', 'npm', 'npx', 'corepack']) {
      expect(lstatSync(s.at(`/usr/local/bin/${b}`)).isSymbolicLink(), b).toBe(true);
      expect(readlinkSync(s.at(`/usr/local/bin/${b}`))).toBe(s.at(`${dir}/bin/${b}`));
    }
    expect(r.out).toContain(`node v${NODE_VERSION} from ${s.at(dir)}`);
  });

  it('writes the settings from .env.example: the socket, one proxy, a contact key, 0640', () => {
    const s = machine();
    const r = install(s);
    const env = s.read(ENV);
    expect(env).toMatch(
      /^DATABASE_URL=postgresql:\/\/reportlog@\/reportlog\?host=\/var\/run\/postgresql$/m,
    );
    expect(env).toMatch(/^TRUST_PROXY=1$/m);
    expect(env).toMatch(/^# TEST_DATABASE_URL=/m);
    expect(env).not.toMatch(/^TEST_DATABASE_URL=/m);
    const key = /^CONTACT_KEY=(.*)$/m.exec(env)?.[1] ?? '';
    expect(Buffer.from(key, 'base64')).toHaveLength(32);
    expect(env.match(/^CONTACT_KEY=/gm)).toHaveLength(1);
    expect(env).toMatch(/^CONTACT_KEY_PREVIOUS=$/m);
    // Files on disk go where the service may write, never into a release.
    expect(env).toMatch(new RegExp(`^FILES_DIR=${s.at('/var/lib/reportlog/files')}$`, 'm'));
    expect(statSync(s.at(ENV)).mode & 0o777).toBe(0o640);
    // Everything else in the template is carried over, comments and all.
    const template = readFileSync(join(REPO, '.env.example'), 'utf8').split('\n');
    expect(env.split('\n')).toHaveLength(template.length);

    expect(s.read('/etc/reportlog/deploy.env')).toBe(
      readFileSync(join(REPO, 'deploy/deploy.env.example'), 'utf8'),
    );
    expect(r.out).toContain('COPY THE CONTACT KEY OFF THIS SERVER NOW');
    // The key itself is never printed; the operator is told how to read it.
    expect(r.out).not.toContain(key);
    expect(r.out).toContain(`sudo grep ^CONTACT_KEY= ${s.at(ENV)}`);
  });

  it('installs the command and the copy of the scripts root runs', () => {
    const s = machine();
    install(s);
    for (const f of ['deploy.sh', 'rollback.sh', 'install.sh', 'lib.sh', 'versions.conf']) {
      expect(s.read(`/usr/local/lib/reportlog/${f}`), f).toBe(
        readFileSync(join(s.checkout, 'deploy', f), 'utf8'),
      );
    }
    expect(statSync(s.at('/usr/local/bin/reportlog')).mode & 0o777).toBe(0o755);
    expect(statSync(s.at('/usr/local/lib/reportlog/lib.sh')).mode & 0o777).toBe(0o644);
  });
});

describe('install.sh run again', () => {
  it('changes nothing it made the first time: settings, key, user, database, Node', () => {
    const s = machine();
    expect(install(s).status).toBe(0);
    const before = s.read(ENV);
    s.clearCalls();
    const r = install(s);
    expect(r.status, r.out).toBe(0);
    expect(s.read(ENV)).toBe(before);
    expect(r.out).toContain('exists; left as it is');
    expect(r.out).not.toContain('COPY THE CONTACT KEY');
    expect(s.calls().filter((c) => /^(useradd|createuser|createdb) /.test(c))).toEqual([]);
    expect(s.calls().filter((c) => c.includes('nodejs.org'))).toEqual([]);
  });

  it('never makes a new contact key on a server that recorded one', () => {
    // A restored server: the settings came back without the key, and a
    // deploy has recorded the original's fingerprint. A new key would make
    // every stored address unreadable; the original must be put back.
    const s = machine();
    mkdirSync(s.at('/var/lib/reportlog'), { recursive: true });
    writeFileSync(s.at('/var/lib/reportlog/contact-key.sha256'), `${'a'.repeat(64)}\n`);
    const r = install(s);
    expect(r.status, r.out).toBe(0);
    expect(s.read(ENV)).toMatch(/^CONTACT_KEY=$/m);
    expect(r.out).not.toContain('COPY THE CONTACT KEY');
  });

  it('adds a key line to a settings file that has none', () => {
    const s = machine();
    mkdirSync(s.at('/etc/reportlog'), { recursive: true });
    writeFileSync(s.at(ENV), 'SITE_ORIGIN=https://reports.example.org\n');
    expect(install(s).status).toBe(0);
    const env = s.read(ENV);
    // (and the two-factor key and the transparency log's deploy key, which
    // install.sh also makes; no FILES_KEY, since nobody answered that this
    // server never took a file)
    expect(env).toMatch(
      /^SITE_ORIGIN=https:\/\/reports\.example\.org\nCONTACT_KEY=\S{44}\nTWO_FACTOR_KEY=\S{44}\nTRANSPARENCY_LOG_SSH_KEY=\S+\/var\/lib\/reportlog\/transparency-log-key\n$/,
    );
  });
});

describe('install.sh refuses', () => {
  it('an operating system it does not support, before changing anything', () => {
    const s = machine({ id: 'fedora', codename: '', pretty: 'Fedora Linux 40' });
    const r = install(s);
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      'supports Debian 12 (bookworm) and Ubuntu 24.04 (noble); this is Fedora Linux 40',
    );
    expect(s.calls().filter((c) => !c.startsWith('id '))).toEqual([]);
  });

  it('an architecture it does not support', () => {
    const s = machine();
    s.set('arch', 'riscv64');
    const r = install(s);
    expect(r.status).toBe(1);
    expect(r.out).toContain('unsupported architecture riscv64');
    expect(s.calls().filter((c) => c.startsWith('apt-get'))).toEqual([]);
  });

  it('to run without root', () => {
    const s = machine();
    s.set('not-root');
    const r = install(s);
    expect(r.status).toBe(1);
    expect(r.out).toContain('run this as root');
  });

  it('a Node tarball whose SHA-256 is not the pinned one, and installs nothing of it', () => {
    const s = machine();
    // A different tarball under the same name.
    writeFileSync(
      join(s.control, 'downloads', `node-v${NODE_VERSION}-linux-x64.tar.xz`),
      'tampered',
    );
    const r = install(s);
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      'does not match the SHA-256 pinned in versions.conf. Nothing was installed.',
    );
    expect(s.ls('/opt')).toEqual([]);
    expect(s.exists('/usr/local/bin/node')).toBe(false);
  });

  it('a signing key whose fingerprint is not the pinned one, and trusts nothing from it', () => {
    const s = machine();
    s.set('downloads/ACCC4CF8.asc', 'B97B0AFCAA1A47F044F244A07FCC7D46DEADBEEF');
    const r = install(s);
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "has fingerprint 'B97B0AFCAA1A47F044F244A07FCC7D46DEADBEEF', not the pinned",
    );
    expect(s.exists('/usr/share/keyrings/pgdg.gpg')).toBe(false);
    expect(s.exists('/etc/apt/sources.list.d/pgdg.list')).toBe(false);
    expect(s.calls().filter((c) => c.includes('postgresql-16'))).toEqual([]);
  });

  it("Caddy's key, likewise", () => {
    const s = machine();
    s.set('downloads/gpg.key', '0000000000000000000000000000000000000000');
    const r = install(s);
    expect(r.status).toBe(1);
    expect(s.exists('/usr/share/keyrings/caddy-stable-archive-keyring.gpg')).toBe(false);
    expect(s.exists('/etc/apt/sources.list.d/caddy-stable.list')).toBe(false);
  });
});

describe('install.sh on Ubuntu 24.04 on Arm', () => {
  it('uses the noble repository and the arm64 tarball with its own pin', () => {
    const s = machine({ id: 'ubuntu', codename: 'noble', pretty: 'Ubuntu 24.04.1 LTS' });
    s.set('arch', 'aarch64');
    const r = install(s);
    expect(r.status, r.out).toBe(0);
    expect(s.read('/etc/apt/sources.list.d/pgdg.list')).toContain(' noble-pgdg main');
    expect(s.index(/^curl .*node-v[\d.]+-linux-arm64\.tar\.xz/)).toBeGreaterThan(-1);
    expect(s.index(/linux-x64/)).toBe(-1);
    expect(readlinkSync(s.at('/usr/local/bin/node'))).toContain('-linux-arm64/bin/node');
  });
});

describe('install.sh asks for what only a person knows (Q3)', () => {
  const ask = (s: Sandbox, answers: string[]) =>
    s.run(join(s.checkout, 'deploy/install.sh'), [], {
      input: answers.map((a) => `${a}\n`).join(''),
    });
  const AGE = `age1${'q'.repeat(58)}`;
  const SCALEWAY = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
  const PROJECT = '11111111-2222-3333-4444-555555555555';
  const BACKUP_SECRET = 'backup-secret-access-key-for-the-test';
  const BACKUP_ID = 'BACKUPACCESSKEYID';
  // In the order install.sh asks; Enter skips files storage and the log.
  const ANSWERS = [
    'https://reports.example.org',
    'reports@example.org',
    PROJECT,
    SCALEWAY,
    'ops@example.org',
    'office@example.org',
    AGE,
    'https://fsn1.your-objectstorage.com',
    'example-backups',
    BACKUP_ID,
    BACKUP_SECRET,
    '',
    '',
  ];

  it('writes each answer into the settings file, and turns mail on once it can send', () => {
    const s = machine();
    const r = ask(s, ANSWERS);
    expect(r.status, r.out).toBe(0);
    const env = s.read(ENV);
    for (const line of [
      'SITE_ORIGIN=https://reports.example.org',
      'EMAIL_FROM_ADDRESS=reports@example.org',
      `SCALEWAY_PROJECT_ID=${PROJECT}`,
      `SCALEWAY_SECRET_KEY=${SCALEWAY}`,
      'EMAIL_TRANSPORT=scaleway',
      'OPS_ALERT_EMAIL=ops@example.org',
      'ADMIN_EMAIL=office@example.org',
      `BACKUP_AGE_RECIPIENTS=${AGE}`,
      'BACKUP_S3_ENDPOINT=https://fsn1.your-objectstorage.com',
      'BACKUP_S3_REGION=fsn1',
      'BACKUP_S3_BUCKET=example-backups',
      `BACKUP_S3_ACCESS_KEY_ID=${BACKUP_ID}`,
      `BACKUP_S3_SECRET_ACCESS_KEY=${BACKUP_SECRET}`,
    ]) {
      expect(env.split('\n'), line).toContain(line);
    }
    // Skipped, so still blank; and nothing was added: each answer took its
    // placeholder's line.
    expect(env).toMatch(/^S3_SECRET_KEY=$/m);
    expect(env).toMatch(/^FILES_STORAGE=disk$/m);
    const template = readFileSync(join(REPO, '.env.example'), 'utf8').split('\n');
    expect(env.split('\n')).toHaveLength(template.length);
    expect(statSync(s.at(ENV)).mode & 0o777).toBe(0o640);
    expect(r.out).not.toContain('Still empty');
  });

  it('never shows a key it was given or made', () => {
    const s = machine();
    const r = ask(s, ANSWERS);
    const env = s.read(ENV);
    for (const key of ['CONTACT_KEY', 'FILES_KEY', 'TWO_FACTOR_KEY', 'DOOR_KEY']) {
      const v = new RegExp(`^${key}=(.+)$`, 'm').exec(env)?.[1] ?? '';
      expect(Buffer.from(v, 'base64'), key).toHaveLength(32);
      expect(r.out, key).not.toContain(v);
    }
    expect(r.out).not.toContain(SCALEWAY);
    expect(r.out).not.toContain(BACKUP_SECRET);
    expect(s.calls().join('\n')).not.toContain(BACKUP_SECRET);
  });

  it('makes the transparency log a deploy key, and shows only its public half', () => {
    const s = machine();
    const r = ask(s, ANSWERS);
    expect(s.read(ENV)).toMatch(
      /^TRANSPARENCY_LOG_SSH_KEY=\S+\/var\/lib\/reportlog\/transparency-log-key$/m,
    );
    expect(statSync(s.at('/var/lib/reportlog/transparency-log-key')).mode & 0o777).toBe(0o600);
    expect(r.out).toContain('ssh-ed25519 AAAAC3NzaStandIn reportlog anchor');
    expect(r.out).not.toContain('stand-in private key');
  });

  it('asks again when an answer has the wrong shape, and Enter leaves it for later', () => {
    const s = machine();
    const r = ask(s, [
      'http://reports.example.org',
      'https://reports.example.org',
      'not an address',
      '',
    ]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('That does not look like https:// and a domain. Try again');
    expect(s.read(ENV)).toMatch(/^SITE_ORIGIN=https:\/\/reports\.example\.org$/m);
    expect(s.read(ENV)).not.toMatch(/^EMAIL_FROM_ADDRESS=\S/m);
    expect(s.read(ENV)).toMatch(/^EMAIL_TRANSPORT=off$/m);
  });

  it('unattended, asks nothing it can wait for and says by name what is still empty', () => {
    const s = machine();
    const r = install(s);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(
      'Still empty: SITE_ORIGIN EMAIL_FROM_ADDRESS SCALEWAY_PROJECT_ID SCALEWAY_SECRET_KEY OPS_ALERT_EMAIL BACKUP_AGE_RECIPIENTS BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY.',
    );
    // The backup bucket's details are asked only once there is a bucket.
    expect(r.out).not.toContain('Its region (fsn1)');
  });

  it('reads the region off the endpoint, and asks only when the address does not say', () => {
    // Endpoint, then the bucket and keys: no region question in between.
    const named = machine();
    const r = ask(named, [
      'https://reports.example.org',
      '',
      '',
      '',
      '',
      '',
      AGE,
      'https://s3.nl-ams.scw.cloud',
      'example-backups',
      BACKUP_ID,
      BACKUP_SECRET,
    ]);
    expect(r.status, r.out).toBe(0);
    expect(named.read(ENV)).toMatch(/^BACKUP_S3_REGION=nl-ams$/m);
    expect(r.out).toContain('BACKUP_S3_REGION set to nl-ams, read off the endpoint.');
    expect(r.out).not.toContain('Its region (fsn1)');

    // An address of your own names no region: it is asked, as before.
    const own = machine();
    const asked = ask(own, [
      'https://reports.example.org',
      '',
      '',
      '',
      '',
      '',
      AGE,
      'https://storage.example.org',
      'eu-west-9',
    ]);
    expect(asked.out).toContain('Its region (fsn1)');
    expect(own.read(ENV)).toMatch(/^BACKUP_S3_REGION=eu-west-9$/m);
  });

  it('run again, asks only what is still empty', () => {
    const s = machine();
    expect(ask(s, ANSWERS).status).toBe(0);
    const r = ask(s, ['', '']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toContain('The address people will reach the site at');
    expect(r.out).not.toContain('secret key');
    expect(r.out).toContain('The files storage endpoint');
  });

  it('makes TWO_FACTOR_KEY whenever the file has none, and never replaces one', () => {
    const s = machine();
    mkdirSync(s.at('/etc/reportlog'), { recursive: true });
    const kept = Buffer.alloc(32, 5).toString('base64');
    writeFileSync(s.at(ENV), `SITE_ORIGIN=https://reports.example.org\nTWO_FACTOR_KEY=${kept}\n`);
    expect(install(s).status).toBe(0);
    expect(s.read(ENV)).toContain(`\nTWO_FACTOR_KEY=${kept}\n`);
    writeFileSync(s.at(ENV), 'SITE_ORIGIN=https://reports.example.org\nTWO_FACTOR_KEY=\n');
    const r = install(s);
    expect(r.status).toBe(0);
    const made = /^TWO_FACTOR_KEY=(.+)$/m.exec(s.read(ENV))?.[1] ?? '';
    expect(Buffer.from(made, 'base64')).toHaveLength(32);
    expect(r.out).not.toContain(made);
  });

  it('makes FILES_KEY on an existing file only when told this server never took a file', () => {
    const s = machine();
    mkdirSync(s.at('/etc/reportlog'), { recursive: true });
    writeFileSync(s.at(ENV), 'SITE_ORIGIN=https://reports.example.org\nFILES_KEY=\n');
    const r = ask(s, ['no']);
    expect(r.out).toContain(
      'If this server has ever taken files, put the original key back instead.',
    );
    expect(s.read(ENV)).toMatch(/^FILES_KEY=$/m);
    const again = ask(s, ['yes']);
    expect(again.status, again.out).toBe(0);
    expect(Buffer.from(/^FILES_KEY=(.+)$/m.exec(s.read(ENV))?.[1] ?? '', 'base64')).toHaveLength(
      32,
    );
  });
});
