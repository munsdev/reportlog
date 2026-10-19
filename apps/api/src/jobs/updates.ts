/**
 * Is there an update, and what would it change? (legacy `updates.js` and
 * `updateCheck.js`.)
 *
 * HOW IT FITS THE SYSTEMD DEPLOYMENT. The old application updated itself:
 * an admin pressed a button, the app wrote a request file, and a root
 * worker on a one-minute timer fetched, merged and restarted. That was a
 * path from "somebody sent an HTTP request" to "root runs code", guarded
 * with great care. Here there is nothing to guard, because the path does not
 * exist:
 *
 *   - Applying an update is `sudo reportlog deploy`, run by a person at a
 *     terminal. It migrates the database and can stop half-way with a
 *     sentence that needs reading; somebody should be watching it.
 *   - Checking is `sudo reportlog updates`, and a daily root timer
 *     (`reportlog-update-check`) that runs the same. Root fetches the deploy
 *     mirror (`deploy/lib.sh`, `update_check`), which is what a deploy does
 *     anyway, with the credentials only root holds, and writes what it found
 *     as plain files under STATE_DIR/updates.
 *   - This module, run as the service user, reads those files and says what
 *     they mean: in the terminal, in the doctor, and once per new upstream
 *     commit in an email to OPS_ALERT_EMAIL.
 *
 * So the application never runs git, never sees the repository's address
 * (which can carry a token) and never asks for anything to be installed.
 * Nothing here decides what gets deployed.
 *
 * Reads files and nothing else: no database, no network, no processes.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// --- versions and the changelog (ported from legacy updates.js) ----------

/**
 * A semantic version as numbers, or null. NO LEADING ZEROS: `v0.0.02` was a
 * formatting bug in the old code, never a release, and accepting it would
 * turn a typo'd changelog heading into a real-looking release on the screen
 * where somebody decides what to run.
 */
export function parseVersion(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1, 0 or 1, numerically, so v0.0.10 is above v0.0.9. Unreadable is 0. */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  notes: string;
}

/**
 * CHANGELOG.md as entries, newest first. Forgiving about everything except
 * the heading (`## v0.0.3 — 5 October 2026`, em dash or hyphen, date
 * optional): the notes are prose for a person.
 */
export function parseChangelog(text: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  for (const line of text.split('\n')) {
    const head = /^##\s+(v\d+\.\d+\.\d+)\s*(?:[—-]\s*(.+?))?\s*$/.exec(line);
    if (head) {
      if (current) out.push(current);
      current = { version: head[1] ?? '', date: (head[2] ?? '').trim(), notes: '' };
      continue;
    }
    if (current) current.notes += `${line}\n`;
  }
  if (current) out.push(current);
  return out.map((e) => ({ ...e, notes: e.notes.trim() }));
}

/**
 * The releases a deployment would move THROUGH, newest first: everything
 * above the version it runs, up to and including the one on offer. Three
 * releases behind gets all three.
 */
export function versionsBetween(
  entries: readonly ChangelogEntry[],
  current: string | null,
  available: string | null,
): ChangelogEntry[] {
  if (!parseVersion(current) || !parseVersion(available)) return [];
  return entries.filter(
    (e) => compareVersions(e.version, current) > 0 && compareVersions(e.version, available) <= 0,
  );
}

export interface UpdateState {
  currentVersion: string | null;
  availableVersion: string | null;
  hasUpdate: boolean;
  /** Commits on the deploy branch that the running release does not have. */
  behind: number;
  releases: ChangelogEntry[];
  /** A newer version with no changelog entry: reported, never hidden. */
  undocumented: boolean;
}

/**
 * `behind` counts commits and `releases` counts changelog entries, on
 * purpose: most releases are several commits, so "same version, nothing to
 * do" would hide almost every update.
 */
export function updateState({
  currentVersion = null,
  availableVersion = null,
  behind = 0,
  entries = [],
}: {
  currentVersion?: string | null;
  availableVersion?: string | null;
  behind?: number;
  entries?: readonly ChangelogEntry[];
}): UpdateState {
  const newer = compareVersions(availableVersion, currentVersion) > 0;
  const releases = newer ? versionsBetween(entries, currentVersion, availableVersion) : [];
  return {
    currentVersion,
    availableVersion,
    hasUpdate: newer || behind > 0,
    behind,
    releases,
    undocumented: newer && releases.length === 0,
  };
}

// --- why a fetch failed (ported from legacy updateCheck.js) --------------

/**
 * The causes `classify_fetch_failure` in deploy/lib.sh can name. Each has a
 * sentence WRITTEN HERE: git's own words can contain the repository's
 * address, and an address can carry a token, so nothing git said is ever
 * stored, shown or emailed. The causes are different because the fixes are:
 * an authentication failure sent to look at the firewall is a day lost.
 */
const FETCH_REASONS: Record<string, string> = {
  auth:
    'the server could not authenticate to REPO_URL (in /etc/reportlog/deploy.env), so this is ' +
    'the last successful check. GitHub answers "not found" for a private repository it will ' +
    'not show you, so this is usually a missing or expired credential for root.',
  timeout: 'the repository did not answer in time, so this is the last successful check.',
  dns:
    "the repository's host name could not be resolved, so this is the last successful check. " +
    'That is DNS on this server, not the repository.',
  network: 'the repository could not be reached, so this is the last successful check.',
  unknown:
    'fetching the repository failed for a reason this cannot name, so this is the last ' +
    'successful check. `sudo reportlog deploy` prints what git says.',
};

export function fetchFailureReason(cause: string): string {
  return FETCH_REASONS[cause] ?? FETCH_REASONS.unknown ?? '';
}

// --- what the root check wrote -------------------------------------------

export interface UpdateFacts {
  checkedAt: Date;
  ref: string;
  /** The running release's commit, if one is deployed. */
  current: string | null;
  /** The commit `ref` names upstream, if it could be read. */
  tip: string | null;
  /** Null when the running commit is not in the mirror's history. */
  behind: number | null;
  /** Commits the running release has that `ref` does not (a branch deployed by hand). */
  ahead: number;
  /** `<short sha> <subject>`, newest first, at most 100. */
  commits: string[];
  currentVersion: string | null;
  availableVersion: string | null;
  changelog: string;
  /** Set when this check's fetch failed: the cause, never git's words. */
  fetchFailed: string | null;
}

/** Where `update_check` (deploy/lib.sh) writes, under STATE_DIR. */
export const FACTS_DIR = 'updates';

async function text(dir: string, name: string): Promise<string | null> {
  try {
    return (await readFile(join(dir, name), 'utf8')).trim();
  } catch {
    return null;
  }
}

const SHA = /^[0-9a-f]{40}$/;
const count = (s: string | null) => (s !== null && /^\d+$/.test(s) ? Number(s) : null);

function versionIn(json: string | null): string | null {
  if (!json) return null;
  try {
    const v = (JSON.parse(json) as { version?: unknown }).version;
    return typeof v === 'string' && parseVersion(v) ? `v${v.replace(/^v/, '')}` : null;
  } catch {
    return null;
  }
}

/** The last check's findings, or null if no check has ever run here. */
export async function readUpdateFacts(stateDir: string): Promise<UpdateFacts | null> {
  const dir = join(stateDir, FACTS_DIR);
  const checked = await text(dir, 'checked_at');
  const checkedAt = checked ? new Date(checked) : null;
  if (!checkedAt || Number.isNaN(checkedAt.getTime())) return null;
  const current = await text(dir, 'current');
  const tip = await text(dir, 'tip');
  const cause = await text(dir, 'fetch_failed');
  return {
    checkedAt,
    ref: (await text(dir, 'ref')) ?? '',
    current: current && SHA.test(current) ? current : null,
    tip: tip && SHA.test(tip) ? tip : null,
    behind: count(await text(dir, 'behind')),
    ahead: count(await text(dir, 'ahead')) ?? 0,
    commits: ((await text(dir, 'commits')) ?? '').split('\n').filter(Boolean).slice(0, 100),
    currentVersion: versionIn(await text(dir, 'package-current.json')),
    availableVersion: versionIn(await text(dir, 'package-tip.json')),
    changelog: (await text(dir, 'changelog-tip.md')) ?? '',
    // An empty file is no cause.
    fetchFailed: cause?.length ? cause : null,
  };
}

/**
 * The state the facts describe. The notes are read from the TIP's
 * changelog: a deployment three releases behind has a CHANGELOG.md that has
 * never heard of the releases it is being offered.
 */
export function stateOf(facts: UpdateFacts): UpdateState {
  return updateState({
    currentVersion: facts.currentVersion,
    availableVersion: facts.availableVersion ?? facts.currentVersion,
    behind: facts.behind ?? 0,
    entries: parseChangelog(facts.changelog),
  });
}

/** Days after which a daily check that has not run is itself worth a warning. */
export const CHECK_MAX_AGE_DAYS = 3;

export interface UpdateFinding {
  status: 'ok' | 'warn';
  check: 'updates';
  detail: string;
}

/**
 * For the doctor. Never a failure: being behind is a decision an operator
 * may have made, but it should never be a surprise.
 */
export function assessUpdates(facts: UpdateFacts | null, now: Date): UpdateFinding {
  const f = (status: UpdateFinding['status'], detail: string): UpdateFinding => ({
    status,
    check: 'updates',
    detail,
  });
  if (!facts) {
    return f('warn', 'never checked. Run: sudo reportlog updates');
  }
  const day = facts.checkedAt.toISOString().slice(0, 10);
  const ageDays = (now.getTime() - facts.checkedAt.getTime()) / 86_400_000;
  if (ageDays > CHECK_MAX_AGE_DAYS) {
    return f(
      'warn',
      `last checked ${day}: the daily check has stopped. Look at: systemctl status reportlog-update-check.timer`,
    );
  }
  if (facts.fetchFailed) return f('warn', `${day}: ${fetchFailureReason(facts.fetchFailed)}`);
  if (!facts.tip)
    return f('warn', `${day}: ${facts.ref} is not a branch or tag in the repository.`);
  if (facts.behind === null) {
    return f(
      'warn',
      `${day}: the running release is not in the history of ${facts.ref}, so how far behind it is cannot be counted. See: sudo reportlog updates`,
    );
  }
  const state = stateOf(facts);
  if (state.hasUpdate) {
    return f('warn', `${summary(facts, state)}. See: sudo reportlog updates`);
  }
  return f('ok', `up to date with ${facts.ref} (checked ${day})`);
}

function summary(facts: UpdateFacts, state: UpdateState): string {
  const n = state.behind;
  const commits = `${String(n)} commit${n === 1 ? '' : 's'}`;
  const versions =
    state.availableVersion && state.availableVersion !== state.currentVersion
      ? `, ${state.currentVersion ?? 'an unnumbered version'} → ${state.availableVersion}`
      : '';
  return `${facts.ref} is ${commits} ahead of the running release${versions}`;
}

/** What `reportlog updates` prints. */
export function renderUpdates(facts: UpdateFacts | null, now: Date): string {
  if (!facts) return 'No update check has run on this server yet. Run: sudo reportlog updates';
  const state = stateOf(facts);
  const lines: string[] = [];
  const finding = assessUpdates(facts, now);
  lines.push(`Checked ${facts.checkedAt.toISOString()} against ${facts.ref}.`);
  if (facts.fetchFailed)
    lines.push(`The repository could not be fetched: ${fetchFailureReason(facts.fetchFailed)}`);
  lines.push(
    `Running:   ${facts.current ? facts.current.slice(0, 12) : 'nothing deployed'}${state.currentVersion ? ` (${state.currentVersion})` : ''}`,
  );
  if (facts.tip) {
    lines.push(
      `Available: ${facts.tip.slice(0, 12)}${state.availableVersion ? ` (${state.availableVersion})` : ''}`,
    );
  }
  if (facts.ahead > 0) {
    lines.push(
      `The running release has ${String(facts.ahead)} commit(s) that ${facts.ref} does not: it was deployed from somewhere else.`,
    );
  }
  if (!state.hasUpdate) {
    lines.push('', finding.detail);
    return lines.join('\n');
  }
  lines.push('', `${summary(facts, state)}.`);
  if (state.undocumented) {
    lines.push(
      `${state.availableVersion ?? 'The new version'} has no entry in CHANGELOG.md. Read the commits before deploying it.`,
    );
  }
  for (const r of state.releases) {
    lines.push('', `## ${r.version}${r.date ? ` — ${r.date}` : ''}`, r.notes);
  }
  if (facts.commits.length) {
    lines.push('', 'Commits:', ...facts.commits.map((c) => `  ${c}`));
    if (state.behind > facts.commits.length)
      lines.push(`  … and ${String(state.behind - facts.commits.length)} more`);
  }
  lines.push(
    '',
    'To deploy it, at a terminal on this server:',
    `  sudo reportlog deploy ${facts.tip ?? facts.ref}`,
  );
  return lines.join('\n');
}

/** Where the last emailed tip is kept, so each new one is emailed once. */
export const NOTIFIED_FILE = 'update-notified';

/**
 * The email for a new upstream commit, or null when there is nothing new to
 * say: up to date, or this tip was already announced.
 */
export function updateEmail(
  facts: UpdateFacts | null,
  lastNotified: string | null,
  host: string,
): { subject: string; text: string } | null {
  if (!facts?.tip || facts.fetchFailed || facts.tip === lastNotified) return null;
  const state = stateOf(facts);
  if (!state.hasUpdate) return null;
  const releases = state.releases.map((r) => `  ${r.version}${r.date ? ` (${r.date})` : ''}`);
  return {
    subject: `${host}: an update is available`,
    text: [
      `${summary(facts, state)}.`,
      ...(releases.length ? ['', 'Releases:', ...releases] : []),
      ...(state.undocumented ? ['', 'The new version has no changelog entry.'] : []),
      '',
      'What it changes, and the command to deploy it:',
      '  sudo reportlog updates',
      '',
      'Nothing is installed until somebody runs the deploy.',
    ].join('\n'),
  };
}
