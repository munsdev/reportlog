/**
 * The Updates screen: what the last check found, and the button that
 * updates the site with nobody at a terminal.
 *
 * THE APPLICATION NEVER RUNS GIT AND NEVER DEPLOYS ANYTHING ITSELF. It
 * writes one small request file, as the service user, into a directory that
 * is the service user's (STATE_DIR/update-request); a root systemd path unit
 * sees it and runs `reportlog request` (deploy/lib.sh, run_update_request).
 * Root treats the file as untrusted: it can ask for a check, for the commit
 * the followed ref points at after a fresh fetch, for the newest commit of
 * one of the branches the owner decided on (UPDATE_BRANCHES: main, beta,
 * alpha; installing from one makes the server follow it), or to go back to a
 * release the server keeps, and nothing else. Root compares every word with
 * its own list and its own release directories, and refuses anything older
 * than the database. So the worst a forged request can do is install the
 * newest commit of a branch the owner named, or go back to a release this
 * server already ran.
 *
 * Administrators (the owner included), like every other Operations panel.
 */
import { open, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getUpdates, requestUpdate } from '@reportlog/contracts';
import type {
  ReleasePoint,
  UpdateRequestBody,
  UpdateRequestState,
  UpdatesView,
} from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { roleGuard } from '../identity/guards.ts';
import { fetchFailureReason, parseVersion, readUpdateFacts, stateOf } from '../jobs/updates.ts';

export const REQUEST_DIR = 'update-request';
export const STATUS_DIR = 'update-status';
/** Where root says what is installed (deploy/lib.sh, write_release_facts). */
export const INSTALLED_DIR = 'installed';

/** How much of the log the page is shown: the end is where the answer is. */
const LOG_TAIL = 6000;

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function lastRequest(stateDir: string): Promise<UpdateRequestState | null> {
  const raw = await readText(join(stateDir, STATUS_DIR, 'status'));
  if (!raw) return null;
  const kv = new Map(
    raw
      .split('\n')
      .map((l) => /^([a-z]+)=(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1] ?? '', m[2] ?? '']),
  );
  const state = kv.get('state');
  if (state !== 'running' && state !== 'done' && state !== 'failed' && state !== 'refused')
    return null;
  const log = (await readText(join(stateDir, STATUS_DIR, 'log'))) ?? '';
  return {
    state,
    action: kv.get('action') ?? '',
    at: kv.get('at') ?? '',
    log: log.length > LOG_TAIL ? log.slice(-LOG_TAIL) : log,
  };
}

const RELEASE_ID = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
/** A branch name as deploy.sh records one. Root wrote it, but it is shown, so it is checked. */
const BRANCH_NAME = /^[A-Za-z0-9._/-]{1,100}$/;

/** One line of root's `releases` file: `<id> <commit> <branch or -> <version or ->`. */
export function releasePoint(line: string): ReleasePoint | null {
  const [id = '', commit = '', branch = '', version = ''] = line.trim().split(' ');
  const t = RELEASE_ID.exec(id);
  if (!t || !SHA.test(commit)) return null;
  return {
    id,
    installed_at: `${t[1] ?? ''}-${t[2] ?? ''}-${t[3] ?? ''}T${t[4] ?? ''}:${t[5] ?? ''}:${t[6] ?? ''}Z`,
    commit,
    branch: branch !== '-' && BRANCH_NAME.test(branch) ? branch : null,
    version: parseVersion(version) ? `v${version.replace(/^v/, '')}` : null,
  };
}

interface Installed {
  following: string | null;
  current: string | null;
  previous: string | null;
  releases: ReleasePoint[];
}

async function readInstalled(stateDir: string): Promise<Installed> {
  const dir = join(stateDir, INSTALLED_DIR);
  const line = async (name: string) => ((await readText(join(dir, name))) ?? '').trim();
  const following = await line('following');
  const current = await line('current');
  const previous = await line('previous');
  return {
    following: BRANCH_NAME.test(following) ? following : null,
    current: RELEASE_ID.test(current) ? current : null,
    previous: RELEASE_ID.test(previous) ? previous : null,
    releases: (await line('releases'))
      .split('\n')
      .map(releasePoint)
      .filter((r): r is ReleasePoint => r !== null),
  };
}

async function waiting(stateDir: string): Promise<boolean> {
  return (await readText(join(stateDir, REQUEST_DIR, 'request'))) !== null;
}

export async function updatesView(stateDir: string): Promise<UpdatesView> {
  const facts = await readUpdateFacts(stateDir);
  const s = facts ? stateOf(facts) : null;
  const inst = await readInstalled(stateDir);
  const installed = inst.releases.find((r) => r.id === inst.current) ?? null;
  // The ordinary Roll back goes one step, and only to something OLDER (ids
  // start with their UTC time): root's own rule, shown here so the button
  // appears only when root would do it.
  const back =
    inst.current && inst.previous && inst.previous < inst.current
      ? (inst.releases.find((r) => r.id === inst.previous) ?? null)
      : null;
  return {
    checked_at: facts ? facts.checkedAt.toISOString() : null,
    ref: facts?.ref ?? '',
    following: inst.following ?? facts?.ref ?? '',
    installed,
    current: facts?.current ?? null,
    tip: facts?.tip ?? null,
    current_version: facts?.currentVersion ?? null,
    available_version: facts?.availableVersion ?? null,
    behind: facts?.behind ?? null,
    ahead: facts?.ahead ?? 0,
    commits: facts?.commits ?? [],
    releases: s?.releases ?? [],
    fetch_failed: facts?.fetchFailed ? fetchFailureReason(facts.fetchFailed) : null,
    roll_back_to: back,
    release_points: inst.releases.filter((r) => r.id !== inst.current),
    waiting: await waiting(stateDir),
    last: await lastRequest(stateDir),
  };
}

/**
 * Write the request whole: a temporary name, then a rename, so the path
 * unit never starts on half a file. Refused while one is waiting or running.
 */
export async function writeRequest(stateDir: string, body: UpdateRequestBody): Promise<void> {
  const view = await updatesView(stateDir);
  if (view.waiting || view.last?.state === 'running')
    throw new HttpError(409, 'busy', 'An update or a check is already under way. Wait for it.');
  // What is installed must be what the page showed: the commit, from the
  // branch the last check looked at.
  if (
    body.action === 'apply' &&
    (body.sha !== view.tip || (body.branch ?? view.following) !== view.ref)
  )
    throw new HttpError(
      409,
      'stale',
      'What is on offer has changed since this page was loaded. Reload it and try again.',
    );
  if (
    body.action === 'rollback' &&
    body.release !== undefined &&
    !view.release_points.some((r) => r.id === body.release)
  )
    throw new HttpError(
      409,
      'stale',
      'That release is not one this server keeps any more. Reload the page and choose again.',
    );
  const dir = join(stateDir, REQUEST_DIR);
  // One `key=value` per line, every value of a shape the contract already
  // checked. Root checks each again (deploy/lib.sh, request_field).
  const lines = [`action=${body.action}`];
  if (body.action === 'apply') lines.push(`sha=${body.sha}`);
  if (body.action !== 'rollback' && body.branch) lines.push(`branch=${body.branch}`);
  if (body.action === 'rollback' && body.release) lines.push(`release=${body.release}`);
  const text = `${lines.join('\n')}\n`;
  const tmp = join(dir, `.request.${String(process.pid)}`);
  try {
    await writeFile(tmp, text, { mode: 0o640 });
    // Flushed before the rename, so root reads what was written.
    const fh = await open(tmp, 'r');
    await fh.sync();
    await fh.close();
    await rename(tmp, join(dir, 'request'));
  } catch {
    throw new HttpError(
      503,
      'not_installed',
      'This server cannot take update requests yet. Run one deploy of this version from a terminal (sudo reportlog deploy) and the button works from then on.',
    );
  }
}

export function updateRoutes(app: FastifyInstance, deps: { stateDir: string }): void {
  void app.register((admin, _opts, done) => {
    admin.addHook('preHandler', roleGuard(['admin']));
    route(admin, getUpdates, () => updatesView(deps.stateDir));
    route(admin, requestUpdate, async ({ request }) => {
      await writeRequest(deps.stateDir, request.body as UpdateRequestBody);
      return updatesView(deps.stateDir);
    });
    done();
  });
}
