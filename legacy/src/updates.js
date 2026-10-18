/**
 * Deciding whether an update exists, and asking for one.
 *
 * THE WHOLE POINT OF THIS MODULE IS THAT IT HAS NO POWER. It parses, it
 * compares, it validates. It does not fetch, it does not pull, it does not
 * restart anything, and nothing it returns can become a command. The code
 * that actually changes the deployment is `contrib/update-apply.sh`, which
 * runs as root from a timer and is not reachable from a web request at all.
 *
 * WHY IT IS SPLIT THAT WAY. An in-app update button is, by construction, a
 * path from "somebody sent an HTTP request" to "code runs on the server".
 * On an archive holding people's identities that is the single most
 * valuable thing an attacker could find. So the application is given no
 * privilege it did not already have:
 *
 *   the app   writes a REQUEST naming a commit it saw on the remote
 *   the root  side verifies that request against the remote ITSELF, backs
 *   worker    up, and only then applies it
 *
 * The worst an attacker with full control of the application can do through
 * this path is cause the deployment to install genuine upstream code a
 * little earlier than its operator intended. They cannot choose what runs.
 *
 * THE HOLE THAT HAS TO STAY CLOSED. `reportlog.service` sets
 * `ReadWritePaths=/srv/reportlog`, so the application can write its own
 * checkout — including `.git/config`. A worker that trusted the repository's
 * own `origin` would therefore be trusting a file the attacker controls, and
 * the privilege split would buy nothing. `update-apply.sh` fetches from a URL
 * baked into the systemd unit and compares; `scripts/selftest.js` asserts it
 * still does.
 */

/** A full commit id, which is the only shape a request may name. */
const SHA = /^[0-9a-f]{40}$/;

/**
 * How long a request stays actionable.
 *
 * Not a tidiness rule. The request names a commit the application saw on the
 * remote at the time somebody clicked; applying it days later would install
 * something nobody has looked at since. An expired request is dropped and
 * the admin clicks again against whatever is current.
 */
export const REQUEST_MAX_AGE_MS = 30 * 60 * 1000;

/** Where the two sides leave messages for each other, under the checkout. */
export const REQUEST_FILE = 'var/update-request.json';
export const STATUS_FILE = 'var/update-status.json';

/** Every state the worker may report. Anything else is treated as unknown. */
export const STATES = ['idle', 'queued', 'running', 'done', 'failed'];

/**
 * Split a semantic version into numbers.
 *
 * Returns null rather than throwing, because this reads a file an operator
 * edits and a bad heading should degrade to "no release notes" rather than
 * take the page down.
 */
export function parseVersion(v) {
  // NO LEADING ZEROS. `v0.0.02` is not a version this project has ever
  // released under — it was a formatting bug in appVersion.js that printed
  // a padded patch, and a tag by that name has never existed. Accepting it
  // here would quietly turn a typo'd changelog heading into a real-looking
  // release, on the screen where somebody decides what to run.
  const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(v || '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1, 0 or 1, comparing numerically so v0.0.10 is above v0.0.9. */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Read CHANGELOG.md into entries, newest first.
 *
 * Deliberately forgiving about everything except the heading: the notes are
 * prose an operator reads, and imposing a structure on them would mean
 * somebody writing to satisfy a parser.
 */
export function parseChangelog(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  let current = null;

  for (const line of lines) {
    // `## v0.0.3 — 5 October 2026`, em dash or hyphen, date optional.
    const head = /^##\s+(v\d+\.\d+\.\d+)\s*(?:[—-]\s*(.+?))?\s*$/.exec(line);
    if (head) {
      if (current) out.push(current);
      current = { version: head[1], date: (head[2] || '').trim(), notes: '' };
      continue;
    }
    if (current) current.notes += `${line}\n`;
  }
  if (current) out.push(current);

  return out.map((e) => ({ ...e, notes: e.notes.trim() }));
}

/**
 * The releases an operator would be moving THROUGH, newest first.
 *
 * Everything above the version they are on, up to and including the one on
 * offer. A deployment three releases behind gets all three, because the
 * question "what am I about to change" is not answered by the newest entry
 * alone — that is the whole reason this is a list.
 */
export function versionsBetween(entries, current, available) {
  if (!parseVersion(current) || !parseVersion(available)) return [];
  return entries.filter((e) => compareVersions(e.version, current) > 0
    && compareVersions(e.version, available) <= 0);
}

/**
 * What the admin pane shows.
 *
 * `behind` counts commits, `releases` counts entries in the changelog, and
 * they are different numbers on purpose: a deployment can be twenty commits
 * behind within one release.
 */
export function updateState({ currentVersion, availableVersion, behind = 0,
  entries = [], commits = [], status = null } = {}) {
  const newer = compareVersions(availableVersion, currentVersion) > 0;
  // Commits can be ahead within the same version, which is still an update
  // worth offering — most releases are several commits.
  const hasUpdate = Boolean(availableVersion) && (newer || behind > 0);
  const releases = newer ? versionsBetween(entries, currentVersion, availableVersion) : [];

  return {
    currentVersion: currentVersion || null,
    availableVersion: availableVersion || null,
    hasUpdate,
    behind,
    releases,
    // A release with no entry is reported rather than hidden: this is the
    // screen where somebody decides to run new code on an archive.
    undocumented: newer && releases.length === 0,
    commits,
    status: normalizeStatus(status),
  };
}

/** The request the application writes. It names a commit and nothing else. */
export function buildRequest({ targetCommit, requestedBy, requestId, now = new Date() }) {
  if (!SHA.test(String(targetCommit || ''))) {
    throw new Error('an update request must name a full 40-character commit id');
  }
  return {
    targetCommit: String(targetCommit),
    requestedBy: requestedBy == null ? null : String(requestedBy),
    requestId: String(requestId || ''),
    requestedAt: now.toISOString(),
  };
}

/**
 * Would the root worker act on this?
 *
 * Mirrored by the checks in `contrib/update-apply.sh`, which does NOT trust
 * this one — it runs as root and re-does them in shell. This copy exists so
 * the application can say "that request has expired" in the interface
 * instead of leaving somebody watching a spinner.
 */
export function validateRequest(req, { now = new Date(), maxAgeMs = REQUEST_MAX_AGE_MS } = {}) {
  if (!req || typeof req !== 'object') return { ok: false, reason: 'not a request' };
  if (!SHA.test(String(req.targetCommit || ''))) {
    return { ok: false, reason: 'the target is not a full commit id' };
  }
  const at = Date.parse(req.requestedAt);
  if (Number.isNaN(at)) return { ok: false, reason: 'no readable timestamp' };
  const age = now.getTime() - at;
  // A timestamp in the future is a clock problem or a forged file; either
  // way it is not something to act on.
  if (age < -60 * 1000) return { ok: false, reason: 'the request is dated in the future' };
  if (age > maxAgeMs) return { ok: false, reason: 'the request has expired' };
  return { ok: true, reason: null };
}

/** Whatever the worker wrote, reduced to something the page can render. */
export function normalizeStatus(raw) {
  if (!raw || typeof raw !== 'object') return { state: 'idle', detail: '', at: null, commit: null };
  const state = STATES.includes(raw.state) ? raw.state : 'idle';
  return {
    state,
    detail: typeof raw.detail === 'string' ? raw.detail : '',
    at: typeof raw.at === 'string' ? raw.at : null,
    commit: SHA.test(String(raw.commit || '')) ? String(raw.commit) : null,
  };
}

/**
 * Is an update in flight?
 *
 * The button is disabled on this, and so is a second request — two applies
 * at once would have one `npm ci` running while the other restarts.
 */
export function isBusy(status) {
  const s = normalizeStatus(status);
  return s.state === 'queued' || s.state === 'running';
}
