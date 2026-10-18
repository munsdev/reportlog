/**
 * Writing the request the root worker picks up, and reading its status back.
 *
 * This is the application's entire part in applying an update: leave a file
 * naming a commit somebody approved. It cannot pull, merge, install or
 * restart, and `contrib/update-apply.sh` re-decides everything anyway —
 * fetching from a URL in the systemd unit rather than from this checkout —
 * so a lie written here changes nothing about what gets installed.
 *
 * THE FILES LIVE UNDER var/ IN THE CHECKOUT, which is the one place both
 * sides can reach: `reportlog.service` has ReadWritePaths=/srv/reportlog,
 * and the root worker is not confined at all. Nothing in var/ is served —
 * nginx serves `public/` — and the directory is created on demand because a
 * fresh clone does not carry empty directories.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUEST_FILE, STATUS_FILE, buildRequest, validateRequest, normalizeStatus, isBusy,
} from './updates.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestPath = () => path.join(REPO, REQUEST_FILE);
const statusPath = () => path.join(REPO, STATUS_FILE);

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** What the worker last said. Absent is a normal state, not an error. */
export async function readStatus() {
  return normalizeStatus(await readJson(statusPath()));
}

/** The request still waiting to be picked up, if there is one. */
export async function readRequest() {
  return readJson(requestPath());
}

/**
 * Is something already in flight?
 *
 * Two of these at once would have one `npm ci` running while the other
 * restarts the service, so the route refuses rather than queues.
 */
export async function updateInProgress({ now = new Date() } = {}) {
  if (isBusy(await readStatus())) return true;
  const pending = await readRequest();
  // A request nobody collected and which has now expired is not in flight —
  // the worker will drop it, and refusing on it would wedge the button.
  return Boolean(pending && validateRequest(pending, { now }).ok);
}

/**
 * Ask for an update.
 *
 * Written to a temporary name and renamed, so the worker can never read a
 * half-written file: it runs once a minute and would otherwise eventually
 * catch one mid-write.
 */
export async function writeRequest({ targetCommit, requestedBy, requestId, now = new Date() }) {
  const body = buildRequest({ targetCommit, requestedBy, requestId, now });
  const dir = path.dirname(requestPath());
  await fs.mkdir(dir, { recursive: true });

  const tmp = path.join(dir, `.update-request.${process.pid}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o644 });
  await fs.rename(tmp, requestPath());
  return body;
}

/** Drop a request that has not been collected. Used when an admin cancels. */
export async function clearRequest() {
  try {
    await fs.unlink(requestPath());
    return true;
  } catch {
    return false;
  }
}
