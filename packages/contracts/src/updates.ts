/**
 * The admin panel's Updates screen: what the last update check found, and a
 * button that updates the site without anybody needing a shell.
 *
 * The button writes a request file; a root systemd unit carries it out
 * (deploy/lib.sh, `run_update_request`). The request can only ask for a
 * check, or for the commit the configured branch points at, so this page
 * never chooses what is deployed.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

const Sha = z.string().regex(/^[0-9a-f]{40}$/);

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
  ref: z.string(),
  current: z.string().nullable(),
  tip: z.string().nullable(),
  current_version: z.string().nullable(),
  available_version: z.string().nullable(),
  /** Commits the running release does not have; null when that is unknowable. */
  behind: z.number().int().nullable(),
  commits: z.array(z.string()),
  releases: z.array(z.object({ version: z.string(), date: z.string(), notes: z.string() })),
  /** The check could not reach the repository: why, in words. */
  fetch_failed: z.string().nullable(),
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

export const requestUpdate = defineRoute({
  method: 'POST',
  path: '/api/admin/updates',
  summary:
    'Ask the server to check for an update now, or to install the one on offer. Carried out by the server itself, as root, within seconds.',
  body: z.discriminatedUnion('action', [
    z.object({ action: z.literal('check') }),
    /** The commit the page offered: refused if what is on offer has changed. */
    z.object({ action: z.literal('apply'), sha: Sha }),
    /**
     * The test build: the newest commit of the branch called `test`, whatever
     * DEPLOY_REF says. No commit is named: the server works out which one after
     * a fresh fetch, and no other branch can be asked for.
     */
    z.object({ action: z.literal('apply_test') }),
  ]),
  response: UpdatesView,
});
