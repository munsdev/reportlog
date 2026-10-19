/**
 * The board's routes and the public read API, registered in one call from
 * app.ts.
 *
 * ALL BEHIND THE SITE PASSWORD. The board is never a door, and nothing here
 * is in FILING_CALLS (identity/doors.ts) or marked to decide for itself.
 * Legacy served /api/v1 in front of the password, so that people with no
 * account could build on it; that would be a third way past the password,
 * which is not this workstream's to open. See docs/status/D1-board.md.
 *
 * EVERY READ ASKS THE ARCHIVE SWITCH FIRST (board.ts does, inside each
 * read), and a test lists every route here and switches it off.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { json } from '../moderation/json.ts';
import { boardCsv, boardLogbooks, boardPage, boardReport } from './board.ts';
import type { BoardQuery } from './board.ts';
import { allConsentTexts } from './consentTexts.ts';
import { catalogue } from './figures.ts';
import { PUBLICATION_OFF, publicArchiveAvailable } from './publication.ts';
import { cachedStats } from './stats.ts';

export interface BoardRouteDeps {
  db: Kysely<DB>;
  siteOrigin: string;
  /** How long the counts are reused. A minute in a deployment; tests use 0. */
  statsTtlMs?: number;
}

const noReport = () => notFound('There is no published report with that reference.');

/** The board's query, with `a.<key>` entries split out as answer filters. */
function boardQuery(raw: Record<string, unknown>): BoardQuery {
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('a.') && typeof v === 'string') answers[k.slice(2)] = v;
  }
  const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return {
    q: text(raw.q),
    logbook: text(raw.logbook),
    sort: raw.sort === 'oldest' ? 'oldest' : 'newest',
    page: raw.page === undefined ? undefined : Number(raw.page),
    answers,
  };
}

export function boardRoutes(app: FastifyInstance, deps: BoardRouteDeps): void {
  const { db } = deps;
  const stats = cachedStats(db, deps.statsTtlMs ?? 60_000);
  const off = () => ({ ...PUBLICATION_OFF });

  route(app, C.getBoard, async () => {
    if (!(await publicArchiveAvailable(db))) return off();
    return { published: true as const, logbooks: await boardLogbooks(db) };
  });

  route(app, C.listBoardReports, async ({ query }) => {
    const page = await boardPage(db, boardQuery(query));
    return page.published ? json(page) : page;
  });

  route(app, C.getBoardReport, async ({ params }) => {
    const out = await boardReport(db, params.ref);
    if (!out) throw noReport();
    if (!out.published) return out;
    return json({
      published: true as const,
      report: out.report,
      links: out.links.map((l) => ({
        ...l,
        published_on: l.published_on,
      })),
    });
  });

  // Not through `route()`: the response is CSV, and the contract serializer
  // would wrap it in JSON quotes. The query is checked the same way as the
  // board's, by the same zod schema.
  app.get(C.BOARD_CSV_PATH, async (request, reply) => {
    const parsed = C.BoardQuery.safeParse(request.query);
    const csv = await boardCsv(db, boardQuery(parsed.success ? parsed.data : {}));
    if (csv === null) return reply.status(404).send(off());
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="reports.csv"')
      .send(csv);
  });

  // A deployment that publishes no archive publishes no counts over it
  // either: "247 reports, 12 in Ohio" from a site that publishes none of
  // them is the archive leaking through the one door left open.
  route(app, C.getBoardStats, async () => {
    if (!(await publicArchiveAvailable(db))) return off();
    return { published: true as const, ...(await stats()) };
  });

  route(app, C.getFigures, async () => {
    if (!(await publicArchiveAvailable(db))) return off();
    return { published: true as const, figures: await catalogue(db) };
  });

  // ── the public API, version 1 ──────────────────────────────────────────
  //
  // The shape under /api/v1 is a promise: fields may be added; existing ones
  // are not renamed, retyped or removed without /api/v2.

  route(app, C.getPublicApi, ({ reply }) => {
    void reply.header('cache-control', 'public, max-age=3600');
    return {
      name: 'ReportLog public API',
      version: 1 as const,
      // SCOPED, AND THE SCOPE IS THE POINT. A report is its reporter's own
      // account: they permitted publication here, not relicensing by anybody
      // who fetches it. What the operator can offer is the counts it computed
      // and the wordings it wrote.
      licence: {
        covers: 'The aggregate counts and the consent wordings served under /api/v1.',
        terms: `CC BY 4.0, attributed to ${deps.siteOrigin}`,
        excludes:
          'The reports themselves. Each is its own author’s account, published here with their permission; that permission is not ours to pass on.',
      },
      endpoints: {
        '/api/v1/stats': 'Aggregate counts over the published record. Cached for 60 seconds.',
        '/api/v1/consent-texts':
          'Every wording of the publication question this site has shown, by digest. A published report seals the digest of the exact sentence its reporter answered; this is how that digest is read back. The digest is the SHA-256 of the body, so it can be checked.',
      },
      stability:
        'Fields may be added. Existing fields will not be renamed, retyped or removed without a new version at /api/v2.',
    };
  });

  route(app, C.getPublicStats, async ({ reply }) => {
    void reply.header('cache-control', 'public, max-age=60');
    if (!(await publicArchiveAvailable(db))) return { ...off(), api_version: 1 as const };
    return {
      published: true as const,
      ...(await stats()),
      api_version: 1 as const,
      licence: `CC BY 4.0 (these figures only; not the reports), ${deps.siteOrigin}`,
    };
  });

  // Not asked of the archive switch: see consentTexts.ts. An hour, because
  // these change about never and a row once listed never moves.
  route(app, C.getPublicConsentTexts, async ({ reply }) => {
    void reply.header('cache-control', 'public, max-age=3600');
    return {
      texts: await allConsentTexts(db),
      api_version: 1 as const,
      // The wordings are the site's own, so they are the operator's to
      // license, unlike the reports answered against them.
      licence: `CC BY 4.0 (these wordings only; not the reports), ${deps.siteOrigin}`,
    };
  });
}
