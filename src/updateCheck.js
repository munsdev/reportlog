/**
 * Asking git what version this deployment is on, and what is on offer.
 *
 * THE ONLY PLACE THE APPLICATION TOUCHES GIT, and it touches it read-only.
 * `src/updates.js` holds the logic and deliberately has no powers at all;
 * this is the thin shell that fetches facts for it. Nothing here changes the
 * checkout except `git fetch`, which downloads objects and moves no branch.
 *
 * WHY THIS IS SAFE TO HAVE IN THE WEB PROCESS. Everything it reports is for
 * display. The decision that matters — what actually gets installed — is
 * re-made from scratch by `contrib/update-apply.sh`, as root, fetching from
 * a URL baked into the systemd unit. So even if a compromised application
 * lied about every value on this page, it could not change what the root
 * worker installs.
 *
 * ARGUMENTS ARE NEVER BUILT FROM A REQUEST. Every git call below passes a
 * fixed array to execFile with no shell, and the only variable is a branch
 * name validated against a pattern. There is no string concatenation into a
 * command anywhere in this file, and `scripts/selftest.js` asserts it.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseChangelog, updateState } from './updates.js';

const run = promisify(execFile);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Branch names this will accept. Anything else is not asked about. */
const BRANCH_OK = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/;

/** The branch a deployment follows, matching what the guides clone. */
export const BRANCH = process.env.REPORTLOG_BRANCH || 'stable';

/**
 * A fetch is a network call. Bounded, so a hung remote cannot hold a
 * request open, and cached, so opening the pane twice is not two fetches.
 */
const FETCH_TIMEOUT_MS = 20_000;
const READ_TIMEOUT_MS = 5_000;
export const CACHE_MS = 10 * 60 * 1000;

let cache = { at: 0, value: null };

/** Throw away the cache. For tests, and for an explicit "check now". */
export function forgetCache() {
  cache = { at: 0, value: null };
}

async function git(args, { timeout = READ_TIMEOUT_MS } = {}) {
  const { stdout } = await run('git', ['-C', REPO, ...args], {
    timeout,
    maxBuffer: 1024 * 1024,
    // No shell, so nothing here can be a command even if it contained one.
    shell: false,
    windowsHide: true,
    // NEVER PROMPT. Without this, a private remote with no stored
    // credential leaves git trying to read a username from a terminal that
    // does not exist — which in a service means waiting out the timeout on
    // every load of the pane instead of failing in a few milliseconds. It
    // also makes the error text predictable enough to classify.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.trim();
}

/**
 * WHY A FETCH FAILED, which is not the same question as whether it failed.
 *
 * The pane used to say "the remote was unreachable just now" for every
 * failure, because the error was thrown away. That sentence is a guess, and
 * it was wrong in the case that actually happened: this repository is
 * private, so a deployment whose service user has no credential gets an
 * AUTHENTICATION failure and was told it had a network problem. Those have
 * completely different fixes, and the wrong one sends somebody to look at
 * their firewall.
 *
 * Same shape as the SASL error in src/db.js that reads like a permissions
 * problem and is not — this one is a permissions problem that read like a
 * network one.
 *
 * GITHUB SAYS "REPOSITORY NOT FOUND" FOR A PRIVATE REPOSITORY IT WILL NOT
 * SHOW YOU, which is deliberate on their part and indistinguishable from a
 * genuinely missing one. It is classified as a credential problem because
 * that is overwhelmingly what it means on a deployment that cloned
 * successfully once.
 */
export function classifyFetchFailure(err) {
  const text = `${err?.stderr || ''} ${err?.message || ''}`.toLowerCase();
  if (err?.killed || err?.signal === 'SIGTERM') return 'timeout';
  if (/could not read username|could not read password|terminal prompts disabled/.test(text)
    || /authentication failed|permission denied|invalid username or password/.test(text)
    || /repository not found|403/.test(text)) return 'auth';
  if (/could not resolve host|name or service not known|temporary failure in name resolution/
    .test(text)) return 'dns';
  if (/connection refused|connection timed out|network is unreachable|unable to access/
    .test(text)) return 'network';
  if (/not a git repository/.test(text)) return 'not-a-checkout';
  return 'unknown';
}

/**
 * What to tell somebody, per cause.
 *
 * FIXED STRINGS, and that is a security property rather than a style
 * choice: git's own error text can contain the remote URL, and a URL can
 * carry an embedded token. Returning a classification and a sentence
 * written here means nothing from git's output can ever reach the browser,
 * a log line or a bug report.
 */
const FETCH_REASONS = {
  auth: 'this deployment cannot authenticate to the remote, so it is showing the last '
    + 'fetch. The repository is private: the service user needs a credential of its own. '
    + 'See the private-clone note in the install guide — and if the token was pasted into '
    + 'the remote URL, that is also what stops updates applying.',
  timeout: 'the remote did not answer in time, so this is the last fetch.',
  dns: 'the remote\'s hostname could not be resolved, so this is the last fetch. That is '
    + 'DNS on this box rather than anything about the repository.',
  network: 'the remote could not be reached, so this is the last fetch.',
  'not-a-checkout': 'this is not a git checkout, so there is nothing to compare against.',
  unknown: 'the last fetch failed for a reason this cannot name, so this is the previous '
    + 'one. `sudo -u reportlog git -C /srv/reportlog fetch origin` prints what git says.',
};

export function fetchFailureReason(cause) {
  return FETCH_REASONS[cause] || FETCH_REASONS.unknown;
}

/** Is this even a checkout? A tarball install is not an error, just not updatable. */
export async function isGitCheckout() {
  try {
    await git(['rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

async function versionAt(ref) {
  try {
    const pkg = await git(['show', `${ref}:package.json`]);
    const v = JSON.parse(pkg).version;
    return v ? `v${v}` : null;
  } catch {
    return null;
  }
}

async function changelogAt(ref) {
  try {
    return parseChangelog(await git(['show', `${ref}:CHANGELOG.md`]));
  } catch {
    return [];
  }
}

/**
 * Everything the Updates pane needs.
 *
 * Returns a shape even when git is unavailable or the remote is
 * unreachable, because a deployment that cannot check for updates is a
 * normal state and the pane has to say so rather than break.
 */
export async function checkForUpdate({ force = false, now = Date.now() } = {}) {
  if (!force && cache.value && now - cache.at < CACHE_MS) return cache.value;

  const branch = BRANCH_OK.test(BRANCH) ? BRANCH : 'stable';
  const base = {
    available: false,
    reason: null,
    branch,
    checkedAt: new Date(now).toISOString(),
  };

  if (!(await isGitCheckout())) {
    const value = { ...base, reason: 'this deployment is not a git checkout, so it cannot self-update' };
    cache = { at: now, value };
    return value;
  }

  let head;
  try {
    head = await git(['rev-parse', 'HEAD']);
  } catch {
    const value = { ...base, reason: 'could not read the current commit' };
    cache = { at: now, value };
    return value;
  }

  const currentVersion = await versionAt('HEAD');

  // Objects only. This moves no branch and changes no file in the working
  // tree; the merge that would is the root worker's job, not this process's.
  let fetched = true;
  let fetchCause = null;
  try {
    await git(['fetch', '--quiet', 'origin', branch], { timeout: FETCH_TIMEOUT_MS });
  } catch (e) {
    fetched = false;
    // Classified here and the error itself dropped. What reaches the caller
    // is one of a fixed set of words, never git's output.
    fetchCause = classifyFetchFailure(e);
  }

  let tip = null;
  try {
    tip = await git(['rev-parse', fetched ? 'FETCH_HEAD' : `origin/${branch}`]);
  } catch {
    tip = null;
  }

  if (!tip) {
    const value = {
      ...base,
      currentVersion,
      currentCommit: head,
      fetchCause,
      reason: fetched
        ? 'could not read what is on the remote, though the fetch itself succeeded'
        : fetchFailureReason(fetchCause),
      state: updateState({ currentVersion, availableVersion: currentVersion }),
    };
    cache = { at: now, value };
    return value;
  }

  let behind = 0;
  let commits = [];
  if (tip !== head) {
    try {
      behind = Number(await git(['rev-list', '--count', `${head}..${tip}`])) || 0;
      const log = await git(['log', '--no-merges', '--format=%h\u0001%s', `${head}..${tip}`]);
      commits = log ? log.split('\n').slice(0, 100).map((l) => {
        const [sha, subject] = l.split('\u0001');
        return { sha, subject: subject || '' };
      }) : [];
    } catch {
      behind = 0;
    }
  }

  // The notes are read from the TIP, not from this checkout: a deployment
  // three releases behind has a CHANGELOG.md that has never heard of the
  // releases it is being offered.
  const entries = await changelogAt(tip);
  const availableVersion = (await versionAt(tip)) || currentVersion;

  const value = {
    ...base,
    available: true,
    fetched,
    currentCommit: head,
    availableCommit: tip,
    currentVersion,
    availableVersion,
    fetchCause,
    reason: fetched ? null : fetchFailureReason(fetchCause),
    state: updateState({ currentVersion, availableVersion, behind, entries, commits }),
  };
  cache = { at: now, value };
  return value;
}
