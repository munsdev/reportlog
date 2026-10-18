/**
 * Is anything actually listening for an update request?
 *
 * THE BUTTON'S WHOLE PROBLEM, and the reason this file exists. The
 * application's entire part in an update is leaving a file naming a commit
 * (`src/updateRequest.js`); a root systemd timer is what fetches, backs up,
 * installs and restarts. Nothing asked whether that timer was there — so on
 * a deployment without it the pane offered the button, answered "Asked for.
 * It starts within a minute", and the request sat in `var/` forever. No
 * error, nothing in a log, nothing to grep for.
 *
 * `src/doctor.js` even carried a comment claiming "the admin pane says so
 * rather than offering a button that silently does nothing". It did not say
 * so; it could not, because nothing in the update path had ever looked.
 *
 * HOW A DEPLOYMENT GETS INTO THAT STATE WITHOUT ANYBODY DOING ANYTHING
 * WRONG: `contrib/install-units.sh` enumerates every unit in
 * `contrib/systemd/` and enables all of them, so a fresh install is fine.
 * But `contrib/deploy.sh` only pulls, migrates and restarts — it does not
 * install units. So a release that ADDS a timer, which is exactly what the
 * release adding this feature did, gives a running box the button and not
 * the worker. deploy.sh now says when units changed; this says when the
 * worker is missing anyway, because a notice printed during a deploy
 * somebody else ran is a notice nobody reads.
 *
 * A TRI-STATE, AND THE THIRD VALUE MATTERS. `true` means the timer is
 * enabled. `false` means it is installed and not enabled, or not installed
 * at all. `null` means this box has no systemctl to ask — a container or a
 * laptop, where the question is not meaningful. All three are reported
 * distinctly because "we checked and nothing is listening" and "we could
 * not check" lead somewhere different, and collapsing them is how the
 * original bug read as working.
 *
 * READ-ONLY, AND NEVER FROM A REQUEST. One fixed argument list to execFile,
 * no shell, nothing interpolated, bounded. The same discipline
 * `src/updateCheck.js` is held to, for the same reason: this runs in the web
 * process.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The unit that does the work. Named once; the route and the pane read this. */
export const WORKER_UNIT = 'reportlog-update.timer';

/* Short, because the pane polls every five seconds while an update is
   running and a subprocess per poll is waste. Long enough that somebody who
   has just run install-units.sh does not conclude it failed. */
const TTL_MS = 30 * 1000;
const PROBE_TIMEOUT_MS = 3000;

let cache = { at: 0, value: null };

/** For tests, and for a caller that has just changed what systemd has. */
export function forgetWorkerCache() {
  cache = { at: 0, value: null };
}

/**
 * What `systemctl is-enabled` said, as a tri-state.
 *
 * `is-enabled` EXITS NON-ZERO FOR A DISABLED UNIT and prints the state on
 * stdout, so the answer is in the error rather than beside it. Reading only
 * the success path would classify every disabled timer as "could not
 * check", which is the wrong half of the tri-state and would put the button
 * back.
 */
export function classifyIsEnabled({ ok, stdout, code, message }) {
  const word = String(stdout || '').trim().split('\n')[0].trim();
  if (ok || word === 'enabled' || word === 'enabled-runtime' || word === 'static'
    || word === 'indirect' || word === 'alias') {
    return true;
  }
  // No systemd to ask. ENOENT is systemctl missing; 'not been booted' is
  // what it says inside a container that has the binary and no init.
  if (code === 'ENOENT' || /not been booted|failed to connect to bus/i.test(String(message || ''))) {
    return null;
  }
  // 'disabled', 'masked', 'not-found', or an empty answer: it is not going
  // to run. Treated the same because the remedy is the same.
  return false;
}

/**
 * Whether the update worker will pick a request up.
 *
 * Returns `{ listening, unit, reason }`. `reason` is a fixed sentence
 * written here, never systemd's output — the same care updateCheck.js takes,
 * because output from a tool can carry things that should not reach a
 * browser.
 */
export async function workerState({ force = false, now = Date.now() } = {}) {
  if (!force && cache.value && now - cache.at < TTL_MS) return cache.value;

  let listening;
  try {
    const { stdout } = await run('systemctl', ['is-enabled', WORKER_UNIT], {
      timeout: PROBE_TIMEOUT_MS,
      shell: false,
      windowsHide: true,
    });
    listening = classifyIsEnabled({ ok: true, stdout });
  } catch (e) {
    listening = classifyIsEnabled({
      ok: false, stdout: e?.stdout, code: e?.code, message: e?.message,
    });
  }

  const value = {
    listening,
    unit: WORKER_UNIT,
    reason: reasonFor(listening),
    fix: fixFor(listening),
  };
  cache = { at: now, value };
  return value;
}

/**
 * What to tell an operator, per state.
 *
 * WORDED AS AN UNFINISHED SETUP, not as a limitation of the software.
 * Updating from the admin page is meant to work; the only way it does not
 * is a box whose units were never installed, and that is one idempotent
 * command away. `contrib/deploy.sh` installs units now, so a deployment
 * cannot drift back into this state — it can only still be in it.
 */
const REASONS = {
  // Nothing to say when it works.
  true: null,
  false: 'The timer that applies an update was never installed on this box, so there '
    + 'is nothing to hand the request to. Installing it is one command and it is safe '
    + 'to run at any time — it installs and enables every unit this deployment should '
    + 'have, and changes nothing that is already right.',
  null: 'This box has no systemd, so there is nothing that can apply an update on its '
    + 'own. Update over SSH with `contrib/deploy.sh`.',
};

/** The one command that fixes it, or null where no command would. */
const FIXES = {
  true: null,
  false: 'sudo /srv/reportlog/contrib/install-units.sh',
  // Nothing to run: a box without systemd has nowhere to put a timer.
  null: null,
};

export function reasonFor(listening) {
  /* `Object.hasOwn` AND NOT `??`. The working state's reason is deliberately
     `null` — there is nothing to say when the button works — and `??` treats
     null as nullish, so `REASONS[key] ?? REASONS.false` handed a working
     deployment the "nothing is listening" sentence. Caught by the guard
     that asserts a working deployment is told nothing. */
  const key = String(listening);
  return Object.hasOwn(REASONS, key) ? REASONS[key] : REASONS.false;
}

/**
 * The command that makes it work, shown so nobody has to go and find it.
 *
 * A PATH AND NOT A RELATIVE ONE, because somebody reading this is in a
 * browser and will paste it into a terminal that is not in the checkout.
 * `/srv/reportlog` is what every guide installs to; a deployment somewhere
 * else has the same script at the same place inside its own checkout.
 */
export function fixFor(listening) {
  const key = String(listening);
  return Object.hasOwn(FIXES, key) ? FIXES[key] : FIXES.false;
}

/** Can an update be asked for at all? Both not-listening states say no. */
export function canApply(worker) {
  return Boolean(worker && worker.listening === true);
}
