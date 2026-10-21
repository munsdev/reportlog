/**
 * Chain file downloads, and the anchor's state for administrators.
 *
 *   /api/chain/:slug         published reports only. Behind the site password
 *                            like every other board read (the gate covers it).
 *   /api/admin/chain/:slug   every version, published or not. Administrators.
 *   /api/admin/anchor        is the daily anchor running and reaching the log.
 *
 * Both files come from `buildChainFile` and are checked by `checkChainFile`,
 * here, in a reader's browser, or with `pnpm check-chain` on a laptop.
 */
import {
  AnchorRun,
  getAnchorStatus,
  getCompleteChainFile,
  getPublishedChainFile,
} from '@reportlog/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  DISTRIBUTION_OFF,
  PUBLICATION_OFF,
  distributionAvailable,
  publicArchiveAvailable,
} from '../board/publication.ts';
import { listedReportIds } from '../board/published.ts';
import { buildChainFile } from '../chain/chainFile.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { requireUser, roleGuard } from '../identity/guards.ts';
import { recordChainFileDownload } from '../moderation/accessLog.ts';
import { DEFAULT_MAX_AGE_HOURS, checkAnchor } from './health.ts';

export interface AnchorRouteDeps {
  db: Database;
  /** How many remotes the log is pushed to, from configuration. */
  remotes: number;
  maxAgeHours?: number;
}

async function chainFile(
  db: Database,
  slug: string,
  publishedOnly: boolean,
  record?: (logbookId: number) => Promise<void>,
) {
  // Launched logbooks only: a draft has no chain, and is 404 like a logbook
  // that does not exist, so the answer does not reveal which drafts exist.
  const lb = await db
    .selectFrom('logbooks')
    .select('id')
    .where('slug', '=', slug)
    .where('launched_at', 'is not', null)
    .executeTakeFirst();
  // The complete file is recorded before it is built (decision 34): if the
  // record cannot be written, nothing goes out.
  if (lb && record) await record(lb.id);
  const file = lb
    ? await buildChainFile(db, lb.id, publishedOnly ? { published: listedReportIds(db) } : {})
    : null;
  if (!file) throw notFound(`There is no logbook "${slug}" with a chain to download.`);
  // The sealed object goes out exactly as it is; the contract only says it is
  // an object, so that a key a later report carries is never stripped.
  return {
    ...file,
    reports: (file.reports ?? []).map((r) => ({
      ...r,
      hashed_fields: { ...r.hashed_fields },
    })),
  };
}

function asDownload(reply: FastifyReply, slug: string, kind: string) {
  const day = new Date().toISOString().slice(0, 10);
  void reply.header(
    'Content-Disposition',
    `attachment; filename="${slug}-chain-${kind}-${day}.json"`,
  );
  // A file somebody keeps as evidence should not be a cached copy of yesterday's.
  void reply.header('Cache-Control', 'no-store');
}

export function anchorRoutes(app: FastifyInstance, deps: AnchorRouteDeps): void {
  const { db } = deps;

  route(app, getPublishedChainFile, async ({ params, reply }) => {
    // A public read of the archive, so it asks the operator's switch first,
    // as the board and the maps do (board/publication.ts).
    if (!(await publicArchiveAvailable(db))) throw notFound(PUBLICATION_OFF.reason);
    // And, after it, the distribution switch: a whole chain is the archive
    // carried off in bulk (decision 11). Off until an administrator says yes.
    if (!(await distributionAvailable(db))) throw notFound(DISTRIBUTION_OFF);
    const file = await chainFile(db, params.slug, true);
    asDownload(reply, params.slug, 'published');
    return file;
  });

  // Administrators only, checked once for the whole scope.
  void app.register((staff, _opts, done) => {
    staff.addHook('preHandler', roleGuard(['admin']));

    route(staff, getCompleteChainFile, async ({ params, request, reply }) => {
      const file = await chainFile(db, params.slug, false, (id) =>
        recordChainFileDownload(db, requireUser(request).email, id),
      );
      asDownload(reply, params.slug, 'complete');
      return file;
    });

    route(staff, getAnchorStatus, async () => {
      const health = await checkAnchor(db, {
        remotes: deps.remotes,
        maxAgeHours: deps.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS,
      });
      const anchors = await db
        .selectFrom('chain_anchors as a')
        .select((eb) => [
          'a.anchor_date',
          'a.root_chain_hash',
          'a.public_log_ref',
          eb
            .selectFrom('chain_anchor_heads as h')
            .select((e) => e.fn.countAll<string>().as('n'))
            .whereRef('h.anchor_id', '=', 'a.id')
            .as('n'),
        ])
        .orderBy('a.id', 'desc')
        .limit(30)
        .execute();
      const runs = await db
        .selectFrom('anchor_runs')
        .select(['outcome', 'anchor_date', 'detail', 'finished_at'])
        .orderBy('id', 'desc')
        .limit(30)
        .execute();
      return {
        health: { status: health.status, detail: health.detail },
        anchors: anchors.map((a) => ({
          date: a.anchor_date,
          root_chain_hash: a.root_chain_hash,
          public_log_ref: a.public_log_ref,
          logbooks: Number(a.n ?? 0),
        })),
        runs: runs.map((r) => ({
          outcome: AnchorRun.shape.outcome.parse(r.outcome),
          anchor_date: r.anchor_date,
          detail: r.detail,
          finished_at: new Date(r.finished_at).toISOString(),
        })),
      };
    });
    done();
  });
}
