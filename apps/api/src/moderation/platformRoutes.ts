/**
 * The routes of Plan D's moderation and EU items, registered in one call.
 *
 * Four audiences, each guarded once per scope so a route added later cannot
 * forget to ask:
 *
 *   - anybody, with no account: the public form to report illegal content and
 *     the page showing where a notice stands (D1). Rate-limited by client;
 *     the address lives only in memory for the window and is never logged;
 *   - anybody signed in: reading and accepting an agreement (M8). Not behind
 *     the agreement itself, or nobody could ever accept it;
 *   - moderators and administrators who have accepted the agreement: batch
 *     approval (M2), the rejection reasons (M1), notices (D1) and threat
 *     flags (D5);
 *   - administrators: publishing an agreement and seeing who accepted it.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { route } from '../http/route.ts';
import { requireUser, roleGuard } from '../identity/guards.ts';
import { stepUpGuard } from '../identity/stepUp.ts';
import { limiter } from '../identity/limiter.ts';
import {
  accept,
  acceptances,
  agreementState,
  moderatorGuard,
  newestText,
  publishAgreement,
} from './agreement.ts';
import { decideNotice, listNotices, statusByToken, submitNotice } from './contentNotices.ts';
import { decideBatch } from './queue.ts';
import { clearThreat, openThreats, raiseThreat } from './threats.ts';

export interface PlatformDeps {
  db: Kysely<DB>;
  mailer: Mailer;
  siteOrigin: string;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the contract's body type
const bodyOf = <B>(_contract: { body?: unknown }, request: FastifyRequest) => request.body as B;

export async function platformRoutes(app: FastifyInstance, deps: PlatformDeps): Promise<void> {
  const { db } = deps;
  const me = (r: FastifyRequest) => requireUser(r).email;

  // ── D1: public ─────────────────────────────────────────────────────────
  // A form anybody can send is a form somebody floods: a handful an hour from
  // one client, and a lookup limit for the status page.
  const sends = limiter({ max: 5, windowMs: 60 * 60 * 1000 });
  const looks = limiter({ max: 60, windowMs: 60 * 60 * 1000 });
  await app.register((open) => {
    // The journalist agreement, readable before applying (contracts: getJournalistStandard).
    route(open, C.getJournalistStandard, async () => {
      const text = await newestText(db, 'journalist');
      return {
        current: text
          ? { version: text.version, body: text.body, published_at: text.created_at.toISOString() }
          : null,
      };
    });
    // Version N is the Nth time this site wrote it; null while it ships as is.
    route(open, C.getModerationStandard, async () => {
      const written = await db
        .selectFrom('site_copy')
        .select('key')
        .where('key', '=', 'standards')
        .executeTakeFirst();
      if (!written) return { current: null };
      const v = await db
        .selectFrom('site_copy_versions')
        .select((eb) => [eb.fn.countAll<string>().as('n'), eb.fn.max('created_at').as('at')])
        .where('key', '=', 'standards')
        .executeTakeFirstOrThrow();
      return {
        // Written means at least one version: the migration kept every slot
        // already written, and the trigger records each change since.
        current: { version: Number(v.n), published_at: new Date(v.at).toISOString() },
      };
    });
    route(open, C.submitContentNotice, async ({ request }) => {
      sends.take(request.ip);
      const out = await submitNotice(
        deps,
        bodyOf<C.BodyOf<typeof C.submitContentNotice>>(C.submitContentNotice, request),
      );
      return { receipt: out.receipt, emailed: out.emailed };
    });
    route(open, C.getContentNoticeStatus, async ({ params, request }) => {
      looks.take(request.ip);
      return statusByToken(db, params.token);
    });
    return Promise.resolve();
  });

  // ── M8: signed in, not behind the agreement ────────────────────────────
  await app.register((scope) => {
    scope.addHook('preHandler', (request) => {
      requireUser(request);
      return Promise.resolve();
    });
    route(scope, C.getAgreement, ({ params, request }) =>
      agreementState(db, params.audience, me(request)),
    );
    route(scope, C.acceptAgreement, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.acceptAgreement>>(C.acceptAgreement, request);
      await accept(db, params.audience, me(request), b.digest);
      return { ok: true as const };
    });
    return Promise.resolve();
  });

  // ── M8: administrators ─────────────────────────────────────────────────
  await app.register((scope) => {
    scope.addHook('preHandler', roleGuard(['admin']));
    // Publishing an agreement asks for the second factor again (plan E, E3).
    void scope.register((publish) => {
      publish.addHook('preHandler', stepUpGuard());
      route(publish, C.publishAgreement, async ({ params, request }) => {
        const b = bodyOf<C.BodyOf<typeof C.publishAgreement>>(C.publishAgreement, request);
        return { version: await publishAgreement(db, params.audience, b.body, me(request)) };
      });
      return Promise.resolve();
    });
    route(scope, C.listAgreementAcceptances, async ({ params }) => ({
      acceptances: await acceptances(db, params.audience),
    }));
    return Promise.resolve();
  });

  // ── moderators and administrators, having accepted ─────────────────────
  await app.register((scope) => {
    scope.addHook('preHandler', moderatorGuard(db));

    route(scope, C.getRejectionReasons, () => ({
      reasons: C.REJECTION_REASONS.map((r) => ({ code: r.code, label: r.label })),
    }));

    route(scope, C.batchApproveReports, async ({ request }) => {
      const b = bodyOf<C.BodyOf<typeof C.batchApproveReports>>(C.batchApproveReports, request);
      return decideBatch(db, b.thread_ids, me(request));
    });

    route(scope, C.listContentNotices, async () => ({ notices: await listNotices(db) }));
    route(scope, C.decideContentNotice, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.decideContentNotice>>(C.decideContentNotice, request);
      const out = await decideNotice(deps, Number(params.id), {
        decision: b.decision,
        reason: b.reason,
        actor: me(request),
      });
      return { ok: true as const, emailed: out.emailed };
    });

    route(scope, C.raiseThreat, async ({ request }) => {
      const b = bodyOf<C.BodyOf<typeof C.raiseThreat>>(C.raiseThreat, request);
      const out = await raiseThreat(deps, {
        kind: b.subject_kind,
        ref: b.subject_ref,
        note: b.note,
        actor: me(request),
      });
      return { ok: true as const, owner_emailed: out.ownerEmailed };
    });
    route(scope, C.clearThreat, async ({ request }) => {
      const b = bodyOf<C.BodyOf<typeof C.clearThreat>>(C.clearThreat, request);
      await clearThreat(db, {
        kind: b.subject_kind,
        ref: b.subject_ref,
        note: b.note,
        actor: me(request),
      });
      return { ok: true as const };
    });
    route(scope, C.listThreats, async () => ({ threats: await openThreats(db) }));
    return Promise.resolve();
  });
}
