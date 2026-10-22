/**
 * The Updates screen: what the last check found, and the button that
 * updates the site with nobody at a terminal.
 *
 * THE APPLICATION NEVER RUNS GIT AND NEVER DEPLOYS ANYTHING ITSELF. It
 * writes one small request file, as the service user, into a directory that
 * is the service user's (STATE_DIR/update-request); a root systemd path unit
 * sees it and runs `reportlog request` (deploy/lib.sh, run_update_request).
 * Root treats the file as untrusted: it can ask for a check, or for the
 * commit the configured DEPLOY_REF points at after a fresh fetch, and
 * nothing else. So the worst a forged request can do is deploy what the
 * operator already configured, which the daily check would have offered.
 *
 * Administrators (the owner included), like every other Operations panel.
 */
import { open, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getUpdates, requestUpdate } from '@reportlog/contracts';
import type { UpdateRequestState, UpdatesView } from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { roleGuard } from '../identity/guards.ts';
import { fetchFailureReason, readUpdateFacts, stateOf } from '../jobs/updates.ts';

export const REQUEST_DIR = 'update-request';
export const STATUS_DIR = 'update-status';

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

async function waiting(stateDir: string): Promise<boolean> {
  return (await readText(join(stateDir, REQUEST_DIR, 'request'))) !== null;
}

export async function updatesView(stateDir: string): Promise<UpdatesView> {
  const facts = await readUpdateFacts(stateDir);
  const s = facts ? stateOf(facts) : null;
  return {
    checked_at: facts ? facts.checkedAt.toISOString() : null,
    ref: facts?.ref ?? '',
    current: facts?.current ?? null,
    tip: facts?.tip ?? null,
    current_version: facts?.currentVersion ?? null,
    available_version: facts?.availableVersion ?? null,
    behind: facts?.behind ?? null,
    commits: facts?.commits ?? [],
    releases: s?.releases ?? [],
    fetch_failed: facts?.fetchFailed ? fetchFailureReason(facts.fetchFailed) : null,
    waiting: await waiting(stateDir),
    last: await lastRequest(stateDir),
  };
}

/**
 * Write the request whole: a temporary name, then a rename, so the path
 * unit never starts on half a file. Refused while one is waiting or running.
 */
export async function writeRequest(
  stateDir: string,
  body: { action: 'check' } | { action: 'apply'; sha: string },
): Promise<void> {
  const view = await updatesView(stateDir);
  if (view.waiting || view.last?.state === 'running')
    throw new HttpError(409, 'busy', 'An update or a check is already under way. Wait for it.');
  if (body.action === 'apply' && body.sha !== view.tip)
    throw new HttpError(
      409,
      'stale',
      'What is on offer has changed since this page was loaded. Reload it and try again.',
    );
  const dir = join(stateDir, REQUEST_DIR);
  const text = body.action === 'apply' ? `action=apply\nsha=${body.sha}\n` : 'action=check\n';
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
      await writeRequest(
        deps.stateDir,
        request.body as { action: 'check' } | { action: 'apply'; sha: string },
      );
      return updatesView(deps.stateDir);
    });
    done();
  });
}
