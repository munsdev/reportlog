/**
 * contrib/update-apply.sh, run the way a real box runs it: as root, against
 * a checkout somebody else owns.
 *
 * WHY THIS EXISTS. The script was dry-run and read line by line in a
 * container, and every refusal path was exercised there — as root, on a
 * checkout root owned. The first real box refused its first update with
 * "origin is , expected https://github.com/munsdev/reportlog.git". Since git
 * 2.35.2 git will not read a repository owned by a different user, root is a
 * different user from `reportlog`, and the script read the remote as root
 * with stderr thrown away. The empty string was git declining to look.
 *
 * Nothing that ran as the owner of its own checkout could have seen that,
 * so this makes a checkout owned by `nobody` and drives the real script at
 * it. It needs root and runuser, which is what the real thing needs; without
 * them it says so loudly and reports nothing passed, so the total drops —
 * a total that dropped is the tell this suite's runner is built around.
 *
 *   node scripts/update-apply-selftest.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'contrib', 'update-apply.sh');
const OWNER = 'nobody';

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  c ? (pass++, console.log('  ok   ' + n))
    : (fail++, console.log('  FAIL ' + n + (x ? ' — ' + x : '')));
};

const canRun = process.getuid?.() === 0
  && spawnSync('runuser', ['--version']).status === 0
  && spawnSync('getent', ['passwd', OWNER]).status === 0;
if (!canRun) {
  console.log('\n  SKIPPED — needs root, runuser and a `nobody` user, which is what the');
  console.log('  real updater needs. Nothing was checked; the total is lower because of it.');
  console.log('\n0 passed, 0 failed');
  process.exit(0);
}

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'update-apply-'));
fs.chmodSync(tmp, 0o755);
const remote = path.join(tmp, 'remote.git');
const seed = path.join(tmp, 'seed');
const repo = path.join(tmp, 'checkout');

// A remote with a `stable` branch, and a checkout of it owned by somebody
// who is not root — the shape of /srv/reportlog.
sh('git', ['init', '-q', '--bare', '-b', 'stable', remote]);
sh('git', ['init', '-q', '-b', 'stable', seed]);
const ident = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
fs.writeFileSync(path.join(seed, 'a.txt'), 'one\n');
fs.mkdirSync(path.join(seed, 'contrib'));
fs.copyFileSync(SCRIPT, path.join(seed, 'contrib', 'update-apply.sh'));
sh('git', ['-C', seed, 'add', '.']);
sh('git', ['-C', seed, ...ident, 'commit', '-q', '-m', 'one']);
sh('git', ['-C', seed, 'push', '-q', remote, 'stable'], { stdio: ['ignore', 'pipe', 'ignore'] });
sh('git', ['clone', '-q', '--branch', 'stable', remote, repo]);
fs.mkdirSync(path.join(repo, 'var'));
sh('chown', ['-R', `${OWNER}:`, repo]);

// Something newer to update to.
fs.writeFileSync(path.join(seed, 'a.txt'), 'two\n');
sh('git', ['-C', seed, ...ident, 'commit', '-q', '-am', 'two']);
sh('git', ['-C', seed, 'push', '-q', remote, 'stable'], { stdio: ['ignore', 'pipe', 'ignore'] });
const tip = sh('git', ['-C', remote, 'rev-parse', 'stable']);
// git applies the same ownership refusal to a LOCAL remote, so a scratch
// remote root owns would fail the fetch for a reason the real GitHub remote
// never could. Handed to the owner after the last push, so the harness is
// testing the script and not itself.
sh('chown', ['-R', `${OWNER}:`, remote]);
const before = sh('runuser', ['-u', OWNER, '--', 'git', '-C', repo, 'rev-parse', 'HEAD']);

const installed = path.join(tmp, 'libexec', 'update-apply.sh');
fs.mkdirSync(path.dirname(installed));
fs.copyFileSync(SCRIPT, installed);
fs.chmodSync(installed, 0o755);

function request() {
  const f = path.join(repo, 'var', 'update-request.json');
  fs.writeFileSync(f, JSON.stringify({ targetCommit: tip, requestedAt: new Date().toISOString() }));
  sh('chown', [`${OWNER}:`, f]);
}
function run(args = [], extra = {}, script = installed) {
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      REPORTLOG_DIR: repo,
      REPORTLOG_USER: OWNER,
      REPORTLOG_BRANCH: 'stable',
      REPORTLOG_REMOTE: remote,
      REPORTLOG_SERVICE: 'reportlog-does-not-exist',
      ...extra,
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

console.log('\nthe trap, stated so it cannot be forgotten');

ok('root reading a checkout another user owns gets NOTHING back from git',
  spawnSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], { encoding: 'utf8' })
    .stdout.trim() === '',
  'if this ever passes, git stopped refusing and this test needs rethinking');
ok('the owner reading it gets the remote',
  sh('runuser', ['-u', OWNER, '--', 'git', '-C', repo, 'remote', 'get-url', 'origin']) === remote);

console.log('\na dry run, as root, against that checkout');

request();
const dry = run(['--dry-run']);
ok('it gets past the remote check — the line that refused the first real update',
  !/origin is , expected/.test(dry.out), dry.out.split('\n').filter((l) => /REFUSED/.test(l)).join(' '));
ok('and says what it would do', /would fetch/.test(dry.out), dry.out.trim().split('\n').pop());
ok('and exits cleanly', dry.code === 0, `exit ${dry.code}`);
ok('a dry run leaves the request where it was',
  fs.existsSync(path.join(repo, 'var', 'update-request.json')));

console.log('\na real run, which must read the checkout four times before it changes anything');

request();
const real = run();
// It cannot take a backup here — there is no app in a scratch checkout — so
// it refuses at the backup, which is AFTER the fetch, the tip, HEAD and the
// fast-forward check. Reaching that refusal is the proof all four reads
// worked as the owner.
ok('it reaches the backup step, so the fetch, the tip, HEAD and the ancestry check all ran',
  /pre-update backup failed/.test(real.out),
  real.out.split('\n').filter((l) => /REFUSED/.test(l)).join(' ') || real.out.trim().split('\n').pop());
ok('and it refused rather than half-applying', real.code !== 0);
ok('NOTHING CHANGED — the checkout is still on the commit it started on',
  sh('runuser', ['-u', OWNER, '--', 'git', '-C', repo, 'rev-parse', 'HEAD']) === before);
ok('and it never wrote anything into the checkout as root',
  sh('find', [repo, '-user', 'root', '-not', '-path', '*/var/*']) === '',
  sh('find', [repo, '-user', 'root', '-not', '-path', '*/var/*']));

console.log('\nthe remote check still bites, now that it can see');

sh('runuser', ['-u', OWNER, '--', 'git', '-C', repo, 'remote', 'set-url', 'origin',
  'https://example.invalid/somebody-else.git']);
request();
const moved = run(['--dry-run']);
ok('a rewritten origin is refused, and the refusal NAMES what it found',
  /origin is https:\/\/example\.invalid\/somebody-else\.git, expected/.test(moved.out),
  moved.out.split('\n').filter((l) => /REFUSED/.test(l)).join(' '));
ok('which is the difference from before: an empty name meant git had not looked',
  !/origin is , expected/.test(moved.out));

console.log('\nroot runs only a copy the application cannot write');

sh('runuser', ['-u', OWNER, '--', 'git', '-C', repo, 'remote', 'set-url', 'origin', remote]);

// The arrangement shipped until 10 October: the unit ran the copy INSIDE the
// checkout, which the application owns. The copy itself has to say so.
const inside = path.join(repo, 'contrib', 'update-apply.sh');
request();
const fromCheckout = run(['--dry-run'], {}, inside);
ok('a copy inside the checkout refuses to run, and says why',
  /running from inside .*which the application can write/.test(fromCheckout.out),
  fromCheckout.out.split('\n').filter((l) => /REFUSED/.test(l)).join(' '));
ok('and names the fix', /install-units\.sh/.test(fromCheckout.out));

const loose = path.join(tmp, 'libexec', 'loose.sh');
fs.copyFileSync(SCRIPT, loose);
fs.chmodSync(loose, 0o775);
request();
ok('a copy somebody other than root can write refuses to run',
  /writable by somebody other than root/.test(run(['--dry-run'], {}, loose).out));

const foreign = path.join(tmp, 'libexec', 'foreign.sh');
fs.copyFileSync(SCRIPT, foreign);
fs.chmodSync(foreign, 0o755);
sh('chown', [`${OWNER}:`, foreign]);
request();
ok('a copy not owned by root refuses to run',
  /is not owned by root/.test(run(['--dry-run'], {}, foreign).out));

console.log('\na release that changes the updater renews root\'s copy and re-runs it');

/* THIS USED TO ASSERT THE OPPOSITE — that the updater refused such a release
   and sent the operator to a shell. That was the last case where the admin
   panel's button could not do the job, and "it must always work" ended it.
   So the assertion now is the renewal, plus the two properties that kept the
   privilege split true while the behaviour changed: the content comes out of
   the commit root itself verified, and the file root then runs is still
   root-owned and writable by nobody else. */

// A new release whose updater differs from the one root has installed.
fs.appendFileSync(path.join(seed, 'contrib', 'update-apply.sh'), '\n# a later release\n');
sh('chown', ['-R', 'root:', remote]);
sh('git', ['-C', seed, ...ident, 'commit', '-q', '-am', 'three']);
sh('git', ['-C', seed, 'push', '-q', remote, 'stable'], { stdio: ['ignore', 'pipe', 'ignore'] });
const tip3 = sh('git', ['-C', remote, 'rev-parse', 'stable']);
sh('chown', ['-R', `${OWNER}:`, remote]);
const newUpdater = sh('git', ['-C', seed, 'show', 'stable:contrib/update-apply.sh'],
  { maxBuffer: 1 << 24 });
const reqFor = (commit) => {
  const f = path.join(repo, 'var', 'update-request.json');
  fs.writeFileSync(f, JSON.stringify({ targetCommit: commit, requestedAt: new Date().toISOString() }));
  sh('chown', [`${OWNER}:`, f]);
};

const beforeRenew = fs.readFileSync(installed, 'utf8');
reqFor(tip3);
const wouldRenew = run(['--dry-run']);
/* A dry run stops BEFORE the fetch, so it has no tip to compare this file
   against and says nothing about renewing it. That is the contract — "say
   what you would do" does not write objects and FETCH_HEAD into somebody's
   checkout — and what is asserted here is that it still touches nothing. */
ok('a dry run stops at what it would apply, before any of this',
  /would fetch .* and apply /.test(wouldRenew.out) && wouldRenew.code === 0,
  wouldRenew.out.trim().split('\n').pop());
ok('and leaves the installed updater exactly as it was',
  fs.readFileSync(installed, 'utf8') === beforeRenew);

reqFor(tip3);
const changed = run();
ok('a real run renews root\'s own copy from the commit it verified, and says so',
  /renewed .*update-apply\.sh from /.test(changed.out),
  changed.out.split('\n').filter((l) => /REFUSED|renew/.test(l)).join(' ')
  || changed.out.trim().split('\n').pop());
ok('the installed copy is now byte-identical to the one in that commit',
  fs.readFileSync(installed, 'utf8').trim() === newUpdater.trim());
ok('and is STILL root-owned and writable by nobody else — the split is intact',
  sh('stat', ['-c', '%u %a', installed]) === '0 755',
  sh('stat', ['-c', '%U %a', installed]));
ok('no half-written temporary updater is left beside it',
  fs.readdirSync(path.dirname(installed)).filter((f) => f.startsWith('.update-apply.')).length === 0,
  fs.readdirSync(path.dirname(installed)).join(' '));
/* The re-exec'd copy carries on from the top and matches this time, so it
   runs past the renewal check and gets as far as the backup — which cannot
   work in a scratch checkout with no app. Reaching THAT refusal is the proof
   the second pass ran the rest of the script rather than stopping. */
ok('the renewed copy carried on, through the ancestry check to the backup',
  /pre-update backup failed/.test(changed.out),
  changed.out.split('\n').filter((l) => /REFUSED/.test(l)).join(' '));
ok('and the checkout is STILL on the commit it started on',
  sh('runuser', ['-u', OWNER, '--', 'git', '-C', repo, 'rev-parse', 'HEAD']) === before);

// ONCE, NEVER TWICE. A copy that still disagrees after a renewal must give
// up rather than install and re-exec forever.
const stale = path.join(tmp, 'libexec', 'stale.sh');
fs.writeFileSync(stale, beforeRenew);
sh('chown', ['root:root', stale]);
fs.chmodSync(stale, 0o755);
reqFor(tip3);
const twice = run([], { REPORTLOG_UPDATER_RENEWED: '1' }, stale);
ok('a copy that still disagrees AFTER a renewal gives up instead of looping',
  /still does not match the one running/.test(twice.out),
  twice.out.split('\n').filter((l) => /REFUSED/.test(l)).join(' '));
ok('and that refusal names the by-hand route, since something is rewriting it',
  /deploy\.sh/.test(twice.out) && /install-units\.sh/.test(twice.out));

console.log('\ninstall-units.sh, run as root against a checkout another user owns');

const units = path.join(path.dirname(SCRIPT), 'install-units.sh');
const unitsRepo = path.join(tmp, 'units-checkout');
sh('git', ['clone', '-q', path.join(path.dirname(SCRIPT), '..'), unitsRepo]);
sh('chown', ['-R', `${OWNER}:`, unitsRepo]);
const iu = (extra = []) => spawnSync('bash', [units, '--dry-run', '--dir', unitsRepo,
  '--user', OWNER, '--node', process.execPath, '--backup-dir', path.join(tmp, 'bk'), ...extra],
{ encoding: 'utf8' });
const clean = iu();
const cleanOut = `${clean.stdout}${clean.stderr}`;
ok('a dry run reads the committed updater through its owner and plans a root-owned copy',
  clean.status === 0
  && /install -m 755 -o root -g root .*\/usr\/local\/libexec\/reportlog\/update-apply\.sh/.test(cleanOut),
  cleanOut.split('\n').filter((l) => /!|libexec/.test(l)).join(' | ') || `exit ${clean.status}`);
ok('into a root-owned directory outside the checkout',
  /install -d -m 755 -o root -g root '\/usr\/local\/libexec\/reportlog'/.test(cleanOut));

fs.appendFileSync(path.join(unitsRepo, 'contrib', 'update-apply.sh'), '\n# edited on the box\n');
const dirty = iu();
const dirtyOut = `${dirty.stdout}${dirty.stderr}`;
ok('it refuses to install an updater somebody edited in the checkout',
  dirty.status !== 0 && /has local changes/.test(dirtyOut), dirtyOut.trim().split('\n').pop());

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
