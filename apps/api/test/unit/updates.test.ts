/**
 * Updates and the update check (legacy updates.js, updateCheck.js).
 *
 * The first half ports legacy's `updates` and "why a fetch failed" groups
 * from scripts/selftest.js. Legacy's request, expiry and worker-status tests
 * are not ported: there is no in-app apply here (apps/api/src/jobs/updates.ts
 * says why), so nothing writes or reads a request.
 *
 * The second half runs the shell half (`write_update_facts` and
 * `classify_fetch_failure` in deploy/lib.sh) against a real throwaway git
 * repository, then reads what it wrote the way the doctor and the email do.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessUpdates,
  compareVersions,
  fetchFailureReason,
  parseChangelog,
  parseVersion,
  readUpdateFacts,
  renderUpdates,
  updateEmail,
  updateState,
  versionsBetween,
} from '../../src/jobs/updates.ts';

const LIB = new URL('../../../../deploy/lib.sh', import.meta.url).pathname;

/** Run a deploy/lib.sh function in bash, with lib.sh sourced. */
function lib(script: string, input?: string): string {
  return execFileSync('bash', ['-c', `set -euo pipefail; . "${LIB}"; ${script}`], {
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  });
}

describe('versions and the changelog (legacy selftest "updates")', () => {
  it('compares numerically, so v0.0.10 is above v0.0.9', () => {
    expect(compareVersions('v0.0.10', 'v0.0.9')).toBe(1);
    expect(compareVersions('v0.0.9', 'v0.0.10')).toBe(-1);
    expect(compareVersions('v0.1.0', 'v0.0.99')).toBe(1);
    expect(compareVersions('v0.0.3', 'v0.0.3')).toBe(0);
    // Unparseable is 0 rather than a throw: this reads a file people edit.
    expect(compareVersions('nonsense', 'v0.0.3')).toBe(0);
    expect(parseVersion('v0.0.02')).toBeNull();
  });

  it('parses the changelog into entries, newest first, date optional', () => {
    const entries = parseChangelog(
      [
        '# Changes',
        '',
        '## v0.2.0 — 19 October 2026',
        'Error tracking.',
        '',
        '## v0.1.0 - 1 October 2026',
        'The rebuild.',
        '## v0.0.9',
        'Old.',
      ].join('\n'),
    );
    expect(entries).toEqual([
      { version: 'v0.2.0', date: '19 October 2026', notes: 'Error tracking.' },
      { version: 'v0.1.0', date: '1 October 2026', notes: 'The rebuild.' },
      { version: 'v0.0.9', date: '', notes: 'Old.' },
    ]);
  });

  it('shows a deployment several releases behind every one of them', () => {
    const entries = [
      { version: 'v0.3.0', date: '', notes: 'three' },
      { version: 'v0.2.0', date: '', notes: 'two' },
      { version: 'v0.1.0', date: '', notes: 'one' },
    ];
    expect(versionsBetween(entries, 'v0.1.0', 'v0.3.0').map((e) => e.version)).toEqual([
      'v0.3.0',
      'v0.2.0',
    ]);
    expect(versionsBetween(entries, 'v0.1.0', 'v0.2.0').map((e) => e.version)).toEqual(['v0.2.0']);
  });

  it('counts commits ahead within the same version as an update', () => {
    const same = updateState({ currentVersion: 'v0.0.3', availableVersion: 'v0.0.3', behind: 4 });
    expect(same.hasUpdate).toBe(true);
    expect(same.releases).toEqual([]);
    expect(
      updateState({ currentVersion: 'v0.0.3', availableVersion: 'v0.0.3', behind: 0 }).hasUpdate,
    ).toBe(false);
  });

  it('reports a release with no changelog entry rather than hiding it', () => {
    const state = updateState({
      currentVersion: 'v0.0.3',
      availableVersion: 'v0.1.0',
      behind: 9,
      entries: [],
    });
    expect(state.hasUpdate).toBe(true);
    expect(state.undocumented).toBe(true);
  });

  it('has no power: reads files, and nothing else', () => {
    const src = readFileSync(new URL('../../src/jobs/updates.ts', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['node:fs/promises', 'node:path']);
    for (const forbidden of ['child_process', 'fetch(', 'createHash', 'db/', 'writeFile']) {
      expect(src).not.toContain(forbidden);
    }
  });
});

describe('why a fetch failed (legacy selftest, the classification now in shell)', () => {
  const classify = (stderr: string) => lib('classify_fetch_failure', stderr).trim();

  it('calls a private repository with no credential an AUTH failure, not a network one', () => {
    for (const text of [
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      'remote: Repository not found.',
      "fatal: Authentication failed for 'https://github.com/x/y.git/'",
      'git@github.com: Permission denied (publickey).',
    ]) {
      expect(classify(text), text).toBe('auth');
    }
  });

  it('tells the other causes apart, because the fixes differ', () => {
    expect(classify('ssh: Could not resolve hostname github.com')).toBe('dns');
    expect(classify("fatal: unable to access 'https://github.com/': Connection refused")).toBe(
      'network',
    );
    expect(classify('something nobody predicted')).toBe('unknown');
    expect(classify('')).toBe('unknown');
  });

  it('has a sentence for every cause, and one for a cause it does not know', () => {
    for (const cause of ['auth', 'dns', 'network', 'timeout', 'unknown']) {
      expect(fetchFailureReason(cause).length).toBeGreaterThan(20);
    }
    expect(fetchFailureReason('from-the-future')).toBe(fetchFailureReason('unknown'));
    expect(fetchFailureReason('auth')).toMatch(/private repository/);
    expect(fetchFailureReason('auth')).toMatch(/credential for root/);
  });

  it("never keeps git's own words, which can carry the repository's address and a token", () => {
    const shell = readFileSync(LIB, 'utf8');
    const check = shell.slice(shell.indexOf('update_check() {'));
    // The error text goes to the classifier and nowhere else.
    expect(check.match(/\$err/g)).toEqual(['$err']);
    expect(check).toContain('GIT_TERMINAL_PROMPT=0');
  });
});

/** A repository with two releases and a changelog, a mirror of it, and a release dir. */
function world() {
  const root = mkdtempSync(join(tmpdir(), 'rl-updates-'));
  const repo = join(root, 'repo');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.org',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.org',
      },
    }).trim();
  mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  const commit = (version: string, changelog: string, subject: string) => {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ version }));
    writeFileSync(join(repo, 'CHANGELOG.md'), changelog);
    git('add', '.');
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', subject);
    return git('rev-parse', 'HEAD');
  };
  const v1 = commit('0.1.0', '## v0.1.0 — 1 October 2026\nThe rebuild.\n', 'The rebuild');
  commit('0.1.0', '## v0.1.0 — 1 October 2026\nThe rebuild.\n', 'Fix a typo');
  const v2 = commit(
    '0.2.0',
    '## v0.2.0 — 19 October 2026\nError tracking.\n\n## v0.1.0 — 1 October 2026\nThe rebuild.\n',
    'Error tracking',
  );
  const mirror = join(root, 'mirror.git');
  execFileSync('git', ['clone', '-q', '--mirror', repo, mirror]);
  const release = join(root, 'release');
  mkdirSync(release);
  writeFileSync(join(release, 'REVISION'), `${v1}\n`);
  const state = join(root, 'state');
  mkdirSync(state);
  return { root, mirror, release, state, v1, v2 };
}

describe('the check, end to end: root writes facts, the service user reads them', () => {
  it('finds two commits and one release between the running version and main', async () => {
    const w = world();
    lib(`write_update_facts "${w.mirror}" main "${w.release}" "${w.state}/updates"`);
    const facts = await readUpdateFacts(w.state);
    expect(facts).toMatchObject({
      ref: 'main',
      current: w.v1,
      tip: w.v2,
      behind: 2,
      ahead: 0,
      currentVersion: 'v0.1.0',
      availableVersion: 'v0.2.0',
      fetchFailed: null,
    });
    expect(facts?.commits.map((c) => c.slice(8))).toEqual(['Error tracking', 'Fix a typo']);

    const now = new Date();
    expect(assessUpdates(facts, now)).toEqual({
      status: 'warn',
      check: 'updates',
      detail:
        'main is 2 commits ahead of the running release, v0.1.0 → v0.2.0. See: sudo reportlog updates',
    });
    const text = renderUpdates(facts, now);
    expect(text).toContain('## v0.2.0 — 19 October 2026\nError tracking.');
    expect(text).not.toContain('## v0.1.0');
    expect(text).toContain(`sudo reportlog deploy ${w.v2}`);

    const email = updateEmail(facts, null, 'reports.example.org');
    expect(email?.subject).toBe('reports.example.org: an update is available');
    expect(email?.text).toContain('v0.2.0 (19 October 2026)');
    expect(email?.text).toContain('Nothing is installed until somebody runs the deploy.');
    // Once per new tip.
    expect(updateEmail(facts, w.v2, 'reports.example.org')).toBeNull();
  });

  it('says up to date when the running release is the tip', async () => {
    const w = world();
    writeFileSync(join(w.release, 'REVISION'), `${w.v2}\n`);
    lib(`write_update_facts "${w.mirror}" main "${w.release}" "${w.state}/updates"`);
    const facts = await readUpdateFacts(w.state);
    expect(facts?.behind).toBe(0);
    expect(assessUpdates(facts, new Date()).status).toBe('ok');
    expect(updateEmail(facts, null, 'x')).toBeNull();
  });

  it('keeps the last facts and names the cause when the fetch failed, and emails nothing', async () => {
    const w = world();
    lib(`write_update_facts "${w.mirror}" main "${w.release}" "${w.state}/updates" auth`);
    const facts = await readUpdateFacts(w.state);
    expect(facts?.fetchFailed).toBe('auth');
    expect(facts?.behind).toBe(2);
    expect(assessUpdates(facts, new Date()).detail).toContain('could not authenticate');
    expect(updateEmail(facts, null, 'x')).toBeNull();
  });

  it('says so when a release was deployed from outside the branch, or nothing is deployed', async () => {
    const w = world();
    writeFileSync(join(w.release, 'REVISION'), `${'d'.repeat(40)}\n`);
    lib(`write_update_facts "${w.mirror}" main "${w.release}" "${w.state}/updates"`);
    const facts = await readUpdateFacts(w.state);
    expect(facts?.behind).toBeNull();
    expect(assessUpdates(facts, new Date()).detail).toContain('cannot be counted');

    lib(`write_update_facts "${w.mirror}" main "" "${w.state}/updates"`);
    const none = await readUpdateFacts(w.state);
    expect(none?.current).toBeNull();
    expect(renderUpdates(none, new Date())).toContain('Running:   nothing deployed');
  });

  it('warns when the check has never run, or has stopped running', async () => {
    const w = world();
    expect(await readUpdateFacts(w.state)).toBeNull();
    expect(assessUpdates(null, new Date()).detail).toBe(
      'never checked. Run: sudo reportlog updates',
    );
    lib(`write_update_facts "${w.mirror}" main "${w.release}" "${w.state}/updates"`);
    const facts = await readUpdateFacts(w.state);
    const later = new Date(Date.now() + 5 * 86_400_000);
    expect(assessUpdates(facts, later).detail).toContain('the daily check has stopped');
  });

  it('runs whole: fetches the mirror, then writes; a repository that cannot be reached is named', async () => {
    const w = world();
    const current = join(w.root, 'current');
    execFileSync('ln', ['-s', w.release, current]);
    const settings = (repo: string) => {
      writeFileSync(join(w.root, 'deploy.env'), `REPO_URL=${repo}\nDEPLOY_REF=main\n`);
      return [
        `DEPLOY_ENV="${join(w.root, 'deploy.env')}"`,
        `MIRROR="${join(w.root, 'fresh.git')}"`,
        `STATE_DIR="${w.state}"`,
        `CURRENT="${current}"`,
        'update_check',
      ].join('; ');
    };
    lib(settings(w.mirror));
    expect(await readUpdateFacts(w.state)).toMatchObject({
      tip: w.v2,
      behind: 2,
      fetchFailed: null,
    });

    lib(settings(join(w.root, 'gone.git')));
    const failed = await readUpdateFacts(w.state);
    // The mirror from the first run is still there, so the facts are its.
    expect(failed).toMatchObject({ tip: w.v2, behind: 2, fetchFailed: 'unknown' });
    expect(readFileSync(join(w.state, 'updates', 'fetch_failed'), 'utf8')).toBe('unknown\n');
  });
});
