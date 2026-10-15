/**
 * The pure half of `npm run doctor`.
 *
 * WHAT THE DOCTOR IS FOR. Somebody installing this on their own server
 * already has a server; what they do not have is a list of what is missing
 * and the command that fixes it. A README cannot give them that, because a
 * README does not know their distribution — and the package names differ in
 * ways that matter (`libheif-examples` on Debian, `libheif-tools` on
 * Fedora, `libheif` on Arch and macOS).
 *
 * WHAT THE DOCTOR MUST NOT DO. Install anything. It is somebody else's
 * server; a script that apt-installs packages and creates database roles
 * without being asked is exactly what a developer should distrust from
 * security software, and being right about the package names does not make
 * it less rude. It detects, it explains, and it prints a command the
 * operator can read before they run it.
 */

/**
 * Which package provides each binary, per family.
 *
 * Written out rather than guessed from the binary name, because four of the
 * six do not match: ffprobe comes from ffmpeg, both PDF tools come from
 * poppler, and heif-convert comes from a package named differently on every
 * distribution there is.
 */
export const TOOL_PACKAGES = {
  ffmpeg: { apt: 'ffmpeg', dnf: 'ffmpeg', pacman: 'ffmpeg', apk: 'ffmpeg', brew: 'ffmpeg' },
  ffprobe: { apt: 'ffmpeg', dnf: 'ffmpeg', pacman: 'ffmpeg', apk: 'ffmpeg', brew: 'ffmpeg' },
  'heif-convert': {
    apt: 'libheif-examples', dnf: 'libheif-tools', pacman: 'libheif',
    apk: 'libheif-tools', brew: 'libheif',
  },
  pdftoppm: {
    apt: 'poppler-utils', dnf: 'poppler-utils', pacman: 'poppler',
    apk: 'poppler-utils', brew: 'poppler',
  },
  pdfinfo: {
    apt: 'poppler-utils', dnf: 'poppler-utils', pacman: 'poppler',
    apk: 'poppler-utils', brew: 'poppler',
  },
  clamdscan: {
    apt: 'clamav-daemon', dnf: 'clamav-server', pacman: 'clamav',
    apk: 'clamav-daemon', brew: 'clamav',
  },
};

const FAMILIES = {
  apt: { label: 'Debian/Ubuntu', install: (p) => `sudo apt update && sudo apt install -y ${p}` },
  dnf: { label: 'Fedora/RHEL', install: (p) => `sudo dnf install -y ${p}` },
  pacman: { label: 'Arch', install: (p) => `sudo pacman -S --needed ${p}` },
  apk: { label: 'Alpine', install: (p) => `sudo apk add ${p}` },
  brew: { label: 'macOS (Homebrew)', install: (p) => `brew install ${p}` },
};

/**
 * Which family this machine is, from /etc/os-release and what is on PATH.
 *
 * os-release first because it is the declared answer, then the package
 * manager actually present — a container can carry an ID this does not know
 * and still obviously be apt-based.
 */
export function detectFamily({ osRelease = '', platform = process.platform, have = () => false } = {}) {
  if (platform === 'darwin') return 'brew';

  const field = (name) => {
    const m = osRelease.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].replace(/^"|"$/g, '').toLowerCase() : '';
  };
  const ids = `${field('ID')} ${field('ID_LIKE')}`;

  if (/\b(debian|ubuntu|raspbian|linuxmint|pop)\b/.test(ids)) return 'apt';
  if (/\b(fedora|rhel|centos|rocky|almalinux)\b/.test(ids)) return 'dnf';
  if (/\b(arch|manjaro|endeavouros)\b/.test(ids)) return 'pacman';
  if (/\balpine\b/.test(ids)) return 'apk';

  // Nothing recognised: ask the machine what it can actually do.
  for (const [bin, family] of [['apt-get', 'apt'], ['dnf', 'dnf'], ['yum', 'dnf'],
    ['pacman', 'pacman'], ['apk', 'apk'], ['brew', 'brew']]) {
    if (have(bin)) return family;
  }
  return null;
}

export const familyLabel = (family) => FAMILIES[family]?.label || 'unknown';

/**
 * The command that installs the missing binaries, deduplicated.
 *
 * Returns null when the family is unknown rather than guessing — a wrong
 * install command is worse than none, because somebody will run it.
 */
export function installCommand(missingBinaries, family) {
  if (!family || !FAMILIES[family]) return null;
  const packages = [...new Set(
    missingBinaries.map((bin) => TOOL_PACKAGES[bin]?.[family]).filter(Boolean),
  )].sort();
  if (!packages.length) return null;
  return FAMILIES[family].install(packages.join(' '));
}

/**
 * Caveats that belong beside the command rather than in a wiki.
 *
 * These are the two that actually stop an install: Fedora ships no ffmpeg
 * in its own repositories, and Alpine's heif tools live in a repository that
 * is off by default.
 */
export function installNotes(missingBinaries, family) {
  const notes = [];
  const needs = (bin) => missingBinaries.includes(bin);
  if (family === 'dnf' && (needs('ffmpeg') || needs('ffprobe'))) {
    notes.push('Fedora and RHEL do not ship ffmpeg in their own repositories. '
      + 'Enable RPM Fusion first, or the install will simply not find it.');
  }
  if (family === 'apk' && needs('heif-convert')) {
    notes.push('Alpine keeps libheif-tools in the community repository, which is '
      + 'commented out in /etc/apk/repositories on some images.');
  }
  return notes;
}

/**
 * Paste-ready commands for creating the database, given a connection string.
 *
 * Offered rather than run. Creating a role and a database on somebody's
 * cluster is the other thing this must not do unasked, and the auth method
 * their cluster uses is a decision only they can make.
 */
export function databaseSetupCommands(databaseUrl) {
  // Parsed by hand: the socket form is a valid connection string and an
  // invalid URL, which is the same reason installConfig avoids `new URL`.
  const beforeQuery = String(databaseUrl || '').split('?')[0];
  const db = beforeQuery.slice(beforeQuery.lastIndexOf('/') + 1) || 'reportlog';
  const userMatch = beforeQuery.match(/\/\/([^:/@]+)/);
  const user = userMatch ? userMatch[1] : 'reportlog';
  return [
    `sudo -u postgres createuser ${user} --pwprompt`,
    `sudo -u postgres createdb ${db} -O ${user}`,
  ];
}

/** Does the running Node satisfy what package.json asks for? */
export function nodeVersionOk(actual, required) {
  const min = Number(String(required).replace(/[^\d.]/g, '').split('.')[0] || 0);
  const have = Number(String(actual).replace(/^v/, '').split('.')[0] || 0);
  return { ok: have >= min, have, min };
}

/**
 * THE PATHS NGINX HAS TO HAND TO THE APP, and how to tell whether it did.
 *
 * nginx serves public/ off disk and everything the app answers has to be
 * proxied. Miss a location block and nginx answers first — which is the one
 * install mistake that does not look like a mistake.
 *
 * TWO WAYS IT GOES WRONG, and only the second is why this exists.
 *
 * A path that exists ONLY in the app (/api/...) 404s, or falls through to the
 * single-page app. Annoying, and obvious the first time somebody clicks it.
 *
 * A path that exists BOTH as a file in public/ AND as a route — and
 * /manifest.webmanifest is exactly that — does not 404. nginx serves the file,
 * successfully, with a 200. Nothing looks broken; the deployment simply goes
 * on answering with a stale copy of something the app was supposed to build
 * per deployment, and every home-screen icon is labelled with the software's
 * name instead of the operator's. It went three days undetected once.
 *
 * SO THE CHECK CANNOT BE "did it answer". It has to be "who answered", and
 * that needs a marker only the app's answer carries. The markers below are
 * each a deliberate property of the route rather than an accident of the
 * server, because an accident is the thing that drifts:
 *
 *   /api/health             the app answers JSON; nothing on disk does.
 *   /manifest.webmanifest   the route sets Cache-Control: no-cache so that a
 *                           rename is never served from a cache. The static
 *                           handler sets it for sw.js and for nothing else, so
 *                           its presence here means the app answered.
 *   /docs /styleguide /app  these send a specific file. When the block is
 *                           missing, nginx's try_files falls back to
 *                           index.html — so the tell is the SPA's own markup
 *                           arriving instead. A NEGATIVE marker on purpose:
 *                           guessing a positive string inside three separate
 *                           pages is three more things to drift.
 *
 * Deliberately not checked here: that the proxy sets X-Forwarded-Proto. Get
 * that wrong and every secure cookie is dropped, which is worth knowing — but
 * it cannot be seen from outside, only from what the app makes of it.
 */
export const SPA_MARKER = 'id="pane-home"';

export const PROXIED_PATHS = [
  {
    path: '/api/health',
    marker: 'json-ok',
    what: 'every route the app answers',
  },
  {
    path: '/manifest.webmanifest',
    marker: 'no-cache',
    what: "the home-screen icon, which carries this deployment's name",
  },
  { path: '/docs', marker: 'not-spa', what: 'the install guide' },
  { path: '/styleguide', marker: 'not-spa', what: 'the design reference' },
  { path: '/app', marker: 'not-spa', what: 'the install-instructions page' },
];

/**
 * Who answered, from one response. Pure, so the markers are testable without
 * a server: `res` is `{ status, headers, body }` with headers lowercased.
 *
 * Returns 'app', 'nginx' or 'unknown'. **'unknown' is not a pass.** A marker
 * that cannot be read says nothing either way, and reporting that honestly
 * beats a green tick somebody would rely on.
 */
export function whoAnswered(marker, res) {
  if (!res || typeof res.status !== 'number') return 'unknown';
  const headers = res.headers || {};
  const body = typeof res.body === 'string' ? res.body : '';

  if (marker === 'json-ok') {
    if (res.status !== 200) return 'nginx';
    try {
      return JSON.parse(body).ok === true ? 'app' : 'nginx';
    } catch { return 'nginx'; }
  }

  if (marker === 'no-cache') {
    if (res.status !== 200) return 'nginx';
    const cc = String(headers['cache-control'] || '');
    if (/no-cache/i.test(cc)) return 'app';
    // A 200 with no such header is the silent failure this whole function
    // exists for: the file off disk, served happily.
    return 'nginx';
  }

  if (marker === 'not-spa') {
    if (res.status !== 200) return 'nginx';
    if (!body) return 'unknown';
    return body.includes(SPA_MARKER) ? 'nginx' : 'app';
  }

  return 'unknown';
}

/**
 * THE UNITS A DEPLOYMENT NEEDS RUNNING, and which of them are optional.
 *
 * This is here because of a specific failure rather than for completeness:
 * the anchor timer was missing from an instructions list, so a deployment
 * that followed those instructions exactly **never anchored**, and nothing
 * in the software noticed. The daily timestamp is the whole claim this
 * archive makes; a deployment that is not anchoring is not doing the one
 * thing it exists to do, and it looks entirely healthy while not doing it.
 *
 * `needed` is a function of the deployment rather than a constant: the media
 * worker matters only where attachments are on, and reporting it as a fault
 * on a text-only archive is noise an operator learns to ignore.
 *
 * THE SAME FAILURE HAPPENED TWICE MORE, which is why this list has grown.
 * `scripts/hourly-notify.js` and `scripts/weekly-notify.js` both said "run
 * via cron" and contrib installed a timer for neither, so on every
 * deployment that followed the install guide the digest settings pane
 * existed, people subscribed through it, and nothing was ever sent. And the
 * anchor timer being enabled was the only thing checked about anchoring, so
 * an anchor that fired and failed every night looked identical to one that
 * worked — see src/anchorHealth.js.
 */
export const EXPECTED_UNITS = [
  {
    unit: 'reportlog.service',
    kind: 'service',
    what: 'the app',
    needed: () => true,
    missing: 'The app is not running as a service, so it stops when the terminal closes.',
  },
  {
    unit: 'reportlog-anchor.timer',
    kind: 'timer',
    what: 'the daily chain anchor',
    needed: () => true,
    missing: 'NOTHING IS BEING ANCHORED. The chain is never timestamped by an outside '
      + 'authority, so the archive cannot be shown to be unaltered — which is the one '
      + 'promise it makes. A deployment in this state looks completely healthy.',
  },
  {
    unit: 'reportlog-media-worker.timer',
    kind: 'timer',
    what: 'upload processing',
    needed: ({ attachments }) => attachments,
    missing: 'Attachments are on and nothing processes them, so every upload sits at '
      + '"checking" forever. It is accepted and then waits, rather than failing.',
  },
  {
    unit: 'reportlog-backup.timer',
    kind: 'timer',
    what: 'the daily backup',
    needed: () => true,
    missing: 'NOTHING IS BEING BACKED UP. This archive cannot delete a row by design, '
      + 'which protects it from being edited and not at all from the disk dying. There '
      + 'is no second copy of a single report.',
  },
  {
    unit: 'reportlog-anchor-watch.timer',
    kind: 'timer',
    what: 'the check that the anchor is still running',
    // Always needed, on exactly the same ground as the anchor itself. A
    // deployment with no watch is one where the anchor can stop for six days
    // without anybody being told, which is what happened.
    needed: () => true,
    missing: 'NOTHING NOTICES IF THE ANCHOR STOPS. The anchor timer being enabled is '
      + 'not the same as the anchor running: it can fire and fail every night — the '
      + 'timestamp authority unreachable, a push refused — and look completely healthy.',
  },
  {
    unit: 'reportlog-notify-hourly.timer',
    kind: 'timer',
    what: 'the hourly digest',
    // Needed once somebody has actually asked for one. Before that it is a
    // feature nobody uses, and faulting it would be noise; after that it is
    // a promise made in the settings pane and not kept.
    needed: ({ subscribers }) => Boolean(subscribers),
    missing: 'People have subscribed to the hourly digest and nothing sends it. They '
      + 'chose it in their own settings and will conclude the archive is empty.',
  },
  {
    unit: 'reportlog-notify-weekly.timer',
    kind: 'timer',
    what: 'the weekly digest',
    needed: ({ subscribers }) => Boolean(subscribers),
    missing: 'People have subscribed to the weekly digest and nothing sends it. They '
      + 'chose it in their own settings and will conclude the archive is empty.',
  },
  {
    unit: 'reportlog-update.timer',
    kind: 'timer',
    what: 'applying an update an admin asked for',
    /* Not required. A deployment that would rather be updated over SSH is
       making a reasonable choice.
       THIS COMMENT USED TO CLAIM "the admin pane says so rather than
       offering a button that silently does nothing", AND IT DID NOT. The
       pane had no way to know: nothing in the update path ever asked
       whether this unit was enabled, so the button was offered on every
       deployment and a box without the timer wrote a request into var/ that
       nothing read, under the words "it starts within a minute". The claim
       is true now — `src/updateWorker.js` is what makes it true, the pane
       hides the button, and the route refuses the request — and it is
       written here rather than left implied, because a comment asserting
       somebody else's behaviour is a thing that rots silently. */
    needed: () => false,
    missing: 'The Updates pane can show that a new version exists but its button will '
      + 'never do anything, because nothing is watching for the request. Either install '
      + 'this timer or update over SSH with contrib/deploy.sh.',
  },
  {
    unit: 'reportlog-sweep.timer',
    kind: 'timer',
    what: 'expired-credential cleanup and list retention',
    // OPTIONAL UNTIL A LIST HOLDS SOMETHING, and then required. The
    // credential half of the sweep is tidiness; the list half is a promise
    // being kept, so once there are entries with an expiry this timer is
    // the only thing erasing people's words on schedule. Same shape as the
    // digest timers, which are needed once somebody has subscribed.
    needed: ({ listRows }) => Boolean(listRows),
    missing: 'Expired sign-in codes and sessions are never deleted — nothing breaks there. '
      + 'But THE PERSONAL HALF OF LIST ENTRIES IS NEVER ERASED either, so a deployment '
      + 'that states a retention period is not keeping it, and the daily '
      + 'address-hashing secrets are never destroyed, which leaves every hash taken '
      + 'under them correlatable.',
  },
];

/**
 * Which units systemd reports as enabled, from `systemctl list-unit-files`.
 *
 * Parsed rather than queried one at a time so the whole answer comes from one
 * call, and written as a pure function so the parsing is testable without
 * systemd — which is also the case on a developer's macOS laptop, where there
 * is no systemd to ask.
 *
 * Reads the first two columns and keeps anything whose state is `enabled` or
 * `enabled-runtime`. A unit that is `static`, `masked`, `disabled` or
 * `generated` is not going to start on boot, which is the question.
 */
export function parseEnabledUnits(output) {
  const enabled = new Set();
  for (const raw of String(output || '').split('\n')) {
    const line = raw.trim();
    if (!line || /^UNIT\s+FILE/i.test(line)) continue;
    const [unit, state] = line.split(/\s+/);
    if (!unit || !state) continue;
    if (state === 'enabled' || state === 'enabled-runtime') enabled.add(unit);
  }
  return enabled;
}

/**
 * The units that should be enabled on this deployment and are not.
 *
 * `required` is the subset whose absence breaks a promise, so the caller can
 * decide the exit code without restating which is which.
 */
/**
 * Where root's copy of the updater lives. Outside the checkout, root-owned,
 * installed by contrib/install-units.sh. Stated once; the unit, the
 * installer and the doctor all name this path.
 */
export const UPDATER_PATH = '/usr/local/libexec/reportlog/update-apply.sh';

/**
 * Is the file root runs to apply updates one the application cannot write?
 *
 * WHY THE DOCTOR ASKS. Until 10 October the update unit ran
 * contrib/update-apply.sh straight out of the checkout, as root, every
 * minute — and the application owns and can write the checkout. So a
 * code-execution bug in the web app was root within a minute. New installs
 * get a root-owned copy outside the checkout; a box installed before that
 * keeps the old unit until somebody re-runs install-units.sh, and this is
 * how that box finds out.
 *
 * Pure, so the suite can check it without systemd: the caller reads the
 * unit, stats the file and passes the facts in. Returns a list of
 * `{ problem, fix }`, empty when there is nothing wrong — including when no
 * update unit is installed at all, because the updater is optional.
 */
export function updaterProblems({ unitText = null, repoDir, installed = null, checkoutText = null } = {}) {
  if (!unitText) return [];
  const exec = (unitText.match(/^ExecStart=(\S+)/m) || [])[1] || '';
  const fix = 'sudo ./contrib/install-units.sh';
  const repo = String(repoDir || '').replace(/\/+$/, '');

  if (repo && (exec === repo || exec.startsWith(`${repo}/`))) {
    return [{
      problem: `ROOT RUNS THE UPDATER OUT OF THE CHECKOUT (${exec}), which the application `
        + 'owns and can write — so a code-execution bug in the web app becomes root within '
        + 'a minute. This box has the update unit from before 10 October.',
      fix,
    }];
  }
  if (!installed || !installed.exists) {
    return [{
      problem: `the update unit runs ${exec || '(no ExecStart)'}, which does not exist, so the `
        + 'Updates button can never apply anything',
      fix,
    }];
  }
  if (installed.uid !== 0) {
    return [{ problem: `root's updater (${exec}) is not owned by root`, fix }];
  }
  if ((installed.mode & 0o022) !== 0) {
    return [{ problem: `root's updater (${exec}) is writable by somebody other than root`, fix }];
  }
  if (checkoutText != null && installed.text != null && installed.text !== checkoutText) {
    // NOT A FAULT ANY MORE. This used to say every update would be refused
    // until somebody reinstalled it, which stopped being true when the
    // updater learned to renew its own copy from the release it fetches. It
    // is still worth saying, because it means somebody deployed by hand.
    return [{
      problem: "root's copy of the updater differs from the checkout's — usually a release "
        + 'changed it and this box was deployed by hand. Nothing is broken: the next update '
        + 'from the admin page replaces it from the release it fetches',
      fix,
      required: false,
    }];
  }
  return [];
}

export function missingUnits(
  enabled, { attachments = false, subscribers = 0, listRows = 0 } = {},
) {
  const have = enabled instanceof Set ? enabled : new Set(enabled || []);
  const out = EXPECTED_UNITS
    .filter((u) => !have.has(u.unit))
    .map((u) => ({ ...u, required: u.needed({ attachments, subscribers, listRows }) }));
  return { all: out, required: out.filter((u) => u.required) };
}
