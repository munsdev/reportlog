/**
 * The admin panel's Updates screen: what the last update check found, and a
 * button that updates the site without anybody needing a shell.
 *
 * The button writes a request file; a root systemd unit carries it out
 * (deploy/lib.sh, `run_update_request`). The request can ask for a check, for
 * the commit a branch points at (the followed one, or one of UPDATE_BRANCHES), or
 * to go back to a release the server keeps. Root checks every word of it.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

const Sha = z.string().regex(/^[0-9a-f]{40}$/);

/**
 * The only branches the Updates screen may name, decided by the owner: main
 * is live, beta and alpha are for testing. Root has the same list
 * (OFFERED_BRANCHES in deploy/lib.sh) and refuses any other word. A server
 * may follow another branch through DEPLOY_REF; it is shown, never asked for.
 */
export const UPDATE_BRANCHES = ['main', 'beta', 'alpha'] as const;
export const UpdateBranch = z.enum(UPDATE_BRANCHES);
export type UpdateBranch = z.infer<typeof UpdateBranch>;

/** A release directory's name: its UTC time, then the commit (deploy.sh). */
export const ReleaseId = z.string().regex(/^\d{8}T\d{6}Z-[0-9a-f]{12}$/);

/** One release the server keeps under /srv/reportlog/releases. */
export const ReleasePoint = z.object({
  id: ReleaseId,
  /** When it was installed, read off its name. */
  installed_at: z.string(),
  commit: z.string(),
  /** The branch it was installed from; null for a release made before that was recorded. */
  branch: z.string().nullable(),
  version: z.string().nullable(),
});
export type ReleasePoint = z.infer<typeof ReleasePoint>;

export const UpdateRequestState = z.object({
  state: z.enum(['running', 'done', 'failed', 'refused']),
  action: z.string(),
  at: z.string(),
  /** The last lines of what the check or the deploy printed. */
  log: z.string(),
});
export type UpdateRequestState = z.infer<typeof UpdateRequestState>;

export const UpdatesView = z.object({
  /** When the last check ran, or null if one never has. */
  checked_at: z.string().nullable(),
  /** What the last check compared against: the followed ref, or a branch somebody chose. */
  ref: z.string(),
  /** The ref this server checks every day and installs from by default. */
  following: z.string(),
  /** The running release, as root recorded it; null before the first deploy that records it. */
  installed: ReleasePoint.nullable(),
  current: z.string().nullable(),
  tip: z.string().nullable(),
  current_version: z.string().nullable(),
  available_version: z.string().nullable(),
  /** Commits the running release does not have; null when that is unknowable. */
  behind: z.number().int().nullable(),
  /** Commits the running release has that `ref` does not. */
  ahead: z.number().int(),
  commits: z.array(z.string()),
  releases: z.array(z.object({ version: z.string(), date: z.string(), notes: z.string() })),
  /** The check could not reach the repository: why, in words. */
  fetch_failed: z.string().nullable(),
  /**
   * Where the ordinary Roll back button goes: the previous release, while it
   * is older than the running one. Null once it has been used.
   */
  roll_back_to: ReleasePoint.nullable(),
  /** Every other release the server keeps, newest first. */
  release_points: z.array(ReleasePoint),
  /** A request is written and waiting for the server to pick it up. */
  waiting: z.boolean(),
  /** What the last request did, if one has run. */
  last: UpdateRequestState.nullable(),
});
export type UpdatesView = z.infer<typeof UpdatesView>;

export const getUpdates = defineRoute({
  method: 'GET',
  path: '/api/admin/updates',
  summary: 'What the last update check found, and what the last update request did.',
  response: UpdatesView,
});

export const UpdateRequestBody = z.discriminatedUnion('action', [
  /** Against the followed ref, or against one of UPDATE_BRANCHES. */
  z.object({ action: z.literal('check'), branch: UpdateBranch.optional() }),
  /**
   * The commit the page offered: refused if what is on offer has changed.
   * With a branch, the server follows that branch from then on.
   */
  z.object({ action: z.literal('apply'), sha: Sha, branch: UpdateBranch.optional() }),
  /**
   * Without a release: back to the one that ran before, while it is older.
   * With one: to that release, which must be one the server keeps.
   */
  z.object({ action: z.literal('rollback'), release: ReleaseId.optional() }),
]);
export type UpdateRequestBody = z.infer<typeof UpdateRequestBody>;

export const requestUpdate = defineRoute({
  method: 'POST',
  path: '/api/admin/updates',
  summary:
    'Ask the server to check for an update now, to install the one on offer, or to go back to a release it keeps. Carried out by the server itself, as root, within seconds.',
  body: UpdateRequestBody,
  response: UpdatesView,
});
