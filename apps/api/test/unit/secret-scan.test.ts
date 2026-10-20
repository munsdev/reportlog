/**
 * CI'S SECRET SCAN FAILS ON A COMMITTED KEY (docs/decisions.md, "Keys and
 * secrets").
 *
 * The scan is gitleaks with this repository's .gitleaks.toml, the same
 * binary and the same command CI runs on the whole history. Here it runs
 * against small repositories made for the test, with keys planted in them:
 * made at run time, so no key, fake or not, is ever committed here.
 *
 * Needs a `gitleaks` binary (GITLEAKS_BIN, or on PATH). Skipped without one
 * on a development machine; fails without one in CI, which installs it.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO } from './deploy-sandbox.ts';

const GITLEAKS = process.env.GITLEAKS_BIN ?? 'gitleaks';
const hasGitleaks = spawnSync(GITLEAKS, ['version'], { stdio: 'ignore' }).status === 0;
if (!hasGitleaks && process.env.CI)
  throw new Error(`secret-scan: no gitleaks at "${GITLEAKS}"; CI installs one.`);

interface Finding {
  RuleID: string;
  File: string;
  Commit: string;
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: dir,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.org',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.org',
    },
  });

/** A repository holding `files`, committed, with this repository's scan settings. */
function repository(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rl-scan-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  copyFileSync(join(REPO, '.gitleaks.toml'), join(dir, '.gitleaks.toml'));
  commit(dir, files, 'files');
  return dir;
}

function commit(dir: string, files: Record<string, string | null>, message: string) {
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    if (text === null) rmSync(path);
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
  }
  git(dir, 'add', '-A');
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message);
}

/** CI's command (.github/workflows/ci.yml), against `dir`. */
function scan(dir: string): { status: number; findings: Finding[]; out: string } {
  const report = join(dir, '..', `${dir.split('/').pop() ?? 'x'}.json`);
  dirs.push(report);
  const r = spawnSync(
    GITLEAKS,
    [
      'git',
      '--no-banner',
      '--redact',
      '--config',
      join(dir, '.gitleaks.toml'),
      '--report-format',
      'json',
      '--report-path',
      report,
      dir,
    ],
    { encoding: 'utf8' },
  );
  const findings = JSON.parse(readFileSync(report, 'utf8')) as Finding[];
  return { status: r.status ?? -1, findings, out: r.stdout + r.stderr };
}

const AWS_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const awsKeyId = () => `AKIA${Array.from(randomBytes(16), (b) => AWS_ALPHABET[b % 32]).join('')}`;
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const githubToken = () => `ghp_${Array.from(randomBytes(36), (b) => ALNUM[b % 62]).join('')}`;

describe.skipIf(!hasGitleaks)('the secret scan', () => {
  it('fails on each kind of key a commit could carry, naming the file', () => {
    const planted = {
      // ReportLog's own settings, the way a server's settings file holds them.
      'server.env': `CONTACT_KEY=${randomBytes(32).toString('base64')}\nFILES_KEY=${randomBytes(32).toString('base64')}\n`,
      'scripts/setup.sh': `export SCALEWAY_SECRET_KEY=${randomUUID()}\n`,
      'config.json': `{ "BACKUP_S3_SECRET_ACCESS_KEY": "${randomBytes(30).toString('base64url')}" }\n`,
      'notes.txt': `ERROR_TRACKING_DSN=https://${randomBytes(16).toString('hex')}@bugsink.reports.example.org/1\n`,
      // And the kinds gitleaks knows: a private key, a cloud key, a token.
      'deploy/key.pem': generateKeyPairSync('ed25519')
        .privateKey.export({ type: 'pkcs8', format: 'pem' })
        .toString(),
      'src/aws.ts': `export const id = '${awsKeyId()}';\n`,
      'src/github.ts': `export const token = '${githubToken()}';\n`,
    };
    const dir = repository(planted);
    const { status, findings, out } = scan(dir);
    expect(status, out).toBe(1);
    const found = new Set(findings.map((f) => `${f.File} ${f.RuleID}`));
    for (const expected of [
      'server.env reportlog-setting',
      'scripts/setup.sh reportlog-setting',
      'config.json reportlog-setting',
      'notes.txt reportlog-error-tracking-dsn',
      'deploy/key.pem private-key',
      'src/aws.ts aws-access-token',
      'src/github.ts github-pat',
    ]) {
      expect([...found], expected).toContain(expected);
    }
    // Both keys in the settings file, not only the first.
    expect(findings.filter((f) => f.File === 'server.env')).toHaveLength(2);
  });

  it('still fails once the key is deleted: the history keeps it', () => {
    const dir = repository({ 'server.env': `CONTACT_KEY=${randomBytes(32).toString('base64')}\n` });
    const first = git(dir, 'rev-parse', 'HEAD').trim();
    commit(dir, { 'server.env': null }, 'remove the key');
    const { status, findings } = scan(dir);
    expect(status).toBe(1);
    expect(findings.map((f) => f.Commit)).toEqual([first]);
  });

  it("passes this repository's own templates, with every secret blank", () => {
    const files: Record<string, string> = {};
    for (const f of [
      '.env.example',
      'deploy/deploy.env.example',
      'deploy/install.sh',
      'deploy/install-bugsink.sh',
      'deploy/lib.sh',
      'deploy/versions.conf',
      'deploy/bugsink/bugsink_conf.py',
      'apps/web/playwright.config.ts',
    ]) {
      files[f] = readFileSync(join(REPO, f), 'utf8');
    }
    const { status, findings, out } = scan(repository(files));
    expect(findings, out).toEqual([]);
    expect(status).toBe(0);
  });

  it('is what CI runs: this config, every commit, a pinned and checked gitleaks', () => {
    const ci = readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(
      /gitleaks" git --no-banner --redact --config \.gitleaks\.toml --exit-code 1 \.$/m,
    );
    expect(ci).toMatch(/fetch-depth: 0/);
    expect(ci).toMatch(
      /gitleaks\/releases\/download\/v\d+\.\d+\.\d+\/gitleaks_\d+\.\d+\.\d+_linux_x64\.tar\.gz/,
    );
    expect(ci).toMatch(/echo "[0-9a-f]{64} {2}\$RUNNER_TEMP\/gitleaks\.tgz" \| sha256sum -c -/);
  });
});
