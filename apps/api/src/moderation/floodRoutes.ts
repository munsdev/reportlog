/**
 * Plan E's routes for the record and the moderator screen (session PE3),
 * registered in one call from app.ts.
 *
 * Four audiences, each guarded once per scope so a route added later cannot
 * forget to ask:
 *
 *   - anybody: the counts (by origin, place and arrival time), declined
 *     reports by reason, whether intake is paused, and every switch use with
 *     its time. Counts and times only. `/api/intake-pause` is also in front
 *     of the password (identity/doors.ts), because the report and tip forms
 *     ask it on a door;
 *   - moderators and administrators who accepted the agreement: the flood
 *     screen, bulk decline, tip links by time window, the two switches and
 *     the organization lane;
 *   - administrators: "publish as counts only", per logbook, and its
 *     small-area threshold (PE4);
 *   - anybody signed in: an organization's intake links (its managers, and
 *     those who grant access), and joining by one.
 *
 * Bulk decline (reports and tip links), pause intake and the puzzle switch
 * each ask for the second factor again within 5 minutes (docs/plan-e.md,
 * Step-up), through `stepUpGuard` on a scope of their own.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { declinedCounts, publicCounts } from '../board/counts.ts';
import { PUBLICATION_OFF } from '../board/publication.ts';
import type { DB } from '../db/schema.gen.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { grantsAccess, notAllowed, requireUser, roleGuard } from '../identity/guards.ts';
import { stepUpGuard } from '../identity/stepUp.ts';
import type { LinkKeys } from '../links/keys.ts';
import { launchedLogbooks, logbookBySlug } from '../logbooks/logbooks.ts';
import {
  createIntakeLink,
  describeIntakeLink,
  disableIntakeLink,
  joinByIntakeLink,
  listIntakeLinks,
} from '../orglane/intakeLinks.ts';
import { moderatorGuard } from './agreement.ts';
import {
  bulkDecline,
  bulkDeclineLinks,
  floodScreen,
  organizationLane,
  staffTotals,
} from './flood.ts';
import {
  countsOnlyLogbooks,
  intakePause,
  puzzleLevel,
  setCountsOnly,
  setIntakePaused,
  setPuzzleLevel,
  setSmallArea,
  smallAreaSettings,
  switchUses,
} from './switches.ts';

export interface FloodRouteDeps {
  db: Kysely<DB>;
  siteOrigin: string;
  /** The link keys, or null without CONTACT_KEY (then there are no tip links). */
  linkKeys: (() => Promise<LinkKeys>) | null;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the contract's body type
const bodyOf = <B>(_contract: { body?: unknown }, request: FastifyRequest) => request.body as B;

function when(raw: string, what: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new HttpError(
      400,
      'invalid_time',
      `The ${what} is not a date and time this site can read.`,
    );
  }
  return d;
}

export async function floodRoutes(app: FastifyInstance, deps: FloodRouteDeps): Promise<void> {
  const { db } = deps;
  const me = (r: FastifyRequest) => requireUser(r).email;

  // ── anybody ────────────────────────────────────────────────────────────
  route(app, C.getPublicCounts, async () => (await publicCounts(db)) ?? { ...PUBLICATION_OFF });
  route(app, C.getDeclinedCounts, async () => (await declinedCounts(db)) ?? { ...PUBLICATION_OFF });
  route(app, C.getIntakePause, () => intakePause(db));
  // Who used a switch is staff's; the public is told what and when.
  route(app, C.getSwitchLog, async () => ({
    pause: await intakePause(db),
    puzzle: await puzzleLevel(db),
    uses: (await switchUses(db)).map((u) => ({
      switch: u.switch,
      value: u.value,
      subject: u.subject,
      at: u.at,
    })),
  }));

  // ── moderators and administrators, having accepted the agreement ──────
  const switchState = async () => ({
    pause: await intakePause(db),
    puzzle: await puzzleLevel(db),
    uses: await switchUses(db),
  });
  await app.register((scope) => {
    scope.addHook('preHandler', moderatorGuard(db));

    route(scope, C.getFloodScreen, async () => ({
      ...(await floodScreen(db)),
      pause: await intakePause(db),
      puzzle: await puzzleLevel(db),
      totals: await staffTotals(db),
    }));

    route(scope, C.getSwitches, switchState);
    // Bulk declines and both switches ask for the second factor again
    // (plan E, E3), in a scope of their own so whatever joins it asks too.
    void scope.register((guarded) => {
      guarded.addHook('preHandler', stepUpGuard());
      route(guarded, C.bulkDeclineReports, async ({ request }) => {
        const b = bodyOf<C.BodyOf<typeof C.bulkDeclineReports>>(C.bulkDeclineReports, request);
        return bulkDecline(db, {
          threadIds: b.thread_ids,
          reasonCode: b.reason_code,
          comment: b.comment,
          filter: b.filter,
          actor: me(request),
        });
      });

      route(guarded, C.bulkDeclineLinks, async ({ request }) => {
        const b = bodyOf<C.BodyOf<typeof C.bulkDeclineLinks>>(C.bulkDeclineLinks, request);
        if (!deps.linkKeys) {
          throw new HttpError(
            503,
            'no_contact_key',
            'This site has no CONTACT_KEY yet, so it keeps no links. Tell whoever runs the server.',
          );
        }
        return bulkDeclineLinks(db, await deps.linkKeys(), {
          from: when(b.from, 'start'),
          to: when(b.to, 'end'),
          actor: me(request),
        });
      });

      route(guarded, C.setIntakePause, async ({ request }) => {
        const b = bodyOf<C.BodyOf<typeof C.setIntakePause>>(C.setIntakePause, request);
        await setIntakePaused(db, b.paused, me(request));
        return switchState();
      });
      route(guarded, C.setPuzzleLevel, async ({ request }) => {
        const b = bodyOf<C.BodyOf<typeof C.setPuzzleLevel>>(C.setPuzzleLevel, request);
        await setPuzzleLevel(db, b.level, me(request));
        return switchState();
      });
      return Promise.resolve();
    });

    route(scope, C.listOrganizationLane, async () => ({
      organizations: await organizationLane(db),
    }));
    return Promise.resolve();
  });

  // ── administrators ─────────────────────────────────────────────────────
  await app.register((scope) => {
    scope.addHook('preHandler', roleGuard(['admin']));
    route(scope, C.listCountsOnly, async () => {
      const only = await countsOnlyLogbooks(db);
      const small = await smallAreaSettings(db);
      return {
        logbooks: (await launchedLogbooks(db)).map((lb) => ({
          slug: lb.slug,
          title: lb.title,
          counts_only: only.has(lb.id),
          small_area: small.get(lb.id) ?? C.SMALL_AREA_DEFAULT,
        })),
      };
    });
    route(scope, C.setSmallArea, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.setSmallArea>>(C.setSmallArea, request);
      const lb = await logbookBySlug(db, params.slug);
      if (!lb?.launched_at) throw notFound('There is no launched logbook with that name.');
      const n = await setSmallArea(db, { id: lb.id, slug: lb.slug }, b.small_area, me(request));
      return { slug: lb.slug, small_area: n };
    });
    route(scope, C.setCountsOnly, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.setCountsOnly>>(C.setCountsOnly, request);
      const lb = await logbookBySlug(db, params.slug);
      if (!lb?.launched_at) throw notFound('There is no launched logbook with that name.');
      await setCountsOnly(db, { id: lb.id, slug: lb.slug }, b.counts_only, me(request));
      return { slug: lb.slug, counts_only: b.counts_only };
    });
    return Promise.resolve();
  });

  // ── signed in: intake links ────────────────────────────────────────────
  await app.register((scope) => {
    scope.addHook('preHandler', (request) => {
      requireUser(request);
      return Promise.resolve();
    });

    /** A granter, or a manager of THIS organization. An id in a URL is a claim. */
    const authority = (request: FastifyRequest, organizationId: number) => {
      const user = requireUser(request);
      const manager = user.memberships.some(
        (m) => m.organization_id === organizationId && m.role === 'manager',
      );
      if (!grantsAccess(user) && !manager) throw notAllowed();
      return user;
    };

    route(scope, C.listIntakeLinks, async ({ params, request }) => {
      const org = Number(params.id);
      authority(request, org);
      return { links: await listIntakeLinks(db, org) };
    });
    route(scope, C.createIntakeLink, async ({ params, request }) => {
      const org = Number(params.id);
      const user = authority(request, org);
      const b = bodyOf<C.BodyOf<typeof C.createIntakeLink>>(C.createIntakeLink, request);
      const out = await createIntakeLink(db, {
        organizationId: org,
        label: b.label,
        maxUses: b.max_uses,
        actor: user.email,
      });
      return { link: out.link, url: `${deps.siteOrigin}/organizations/join/${out.token}` };
    });
    route(scope, C.disableIntakeLink, async ({ params, request }) => {
      const org = Number(params.id);
      const user = authority(request, org);
      return {
        link: await disableIntakeLink(db, {
          organizationId: org,
          linkId: Number(params.linkId),
          actor: user.email,
        }),
      };
    });
    route(scope, C.describeIntakeLink, ({ params }) => describeIntakeLink(db, params.token));
    route(scope, C.joinByIntakeLink, ({ params, request }) => {
      const user = requireUser(request);
      return joinByIntakeLink(db, { token: params.token, userId: user.id, email: user.email });
    });
    return Promise.resolve();
  });
}
