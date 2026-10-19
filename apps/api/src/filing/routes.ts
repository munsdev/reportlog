/**
 * Filing's routes, registered in one call from app.ts.
 *
 * THE PUBLIC ONES ARE EXACTLY THE PATTERNS IN FILING_CALLS
 * (identity/doors.ts): POST /api/reports, and GET and POST
 * /api/reports/confirm/:token. A logbook opened outside the site password
 * lets those through and nothing else, so a filing page on a door works only
 * if these keep their patterns.
 *
 * Three scopes, each guarded once so a route added later cannot forget:
 * "My reports" needs somebody signed in; coordinator intake needs a
 * coordinator or manager of some organization; the intake switch needs an
 * administrator.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { route } from '../http/route.ts';
import { notAllowed, requireUser, roleGuard } from '../identity/guards.ts';
import { limiter } from '../identity/limiter.ts';
import { normalizeEmail } from '../identity/secrets.ts';
import { isPermission, permissionsFor, setPermission } from '../permissions/log.ts';
import { keyringFrom } from './contactKeys.ts';
import { confirmSubmission, confirmationState, refused, stageSubmission } from './filing.ts';
import type { FilingDeps } from './filing.ts';
import { Intake, coordinatorOrgs } from './intake.ts';
import { IntakeCorrection } from './intakeCorrection.ts';
import { intakeIsOpen, setIntakeSwitch, storedIntakeSwitch } from './intakeSwitch.ts';
import { Mine } from './mine.ts';

export interface FilingRouteDeps {
  db: Kysely<DB>;
  mailer: Mailer;
  siteOrigin: string;
  /** The deployment's CONTACT_KEY. Without it, nothing is filed and the refusal says why. */
  contactKey?: string | undefined;
  publicRefPrefix?: string | undefined;
}

/** The request body, already validated against the contract by Fastify. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the contract's body type
const bodyOf = <B>(_contract: { body?: unknown }, request: FastifyRequest) => request.body as B;

export async function filingRoutes(app: FastifyInstance, deps: FilingRouteDeps): Promise<void> {
  const ring = deps.contactKey ? keyringFrom(deps.contactKey) : null;
  if (!ring) {
    app.log.warn('CONTACT_KEY is not set: this site will refuse every report until it is.');
  }
  const prefix = deps.publicRefPrefix ?? 'RL-';
  const filing: FilingDeps = {
    db: deps.db,
    mailer: deps.mailer,
    siteOrigin: deps.siteOrigin,
    ring,
    publicRefPrefix: prefix,
  };
  const mine = new Mine(deps.db, ring, prefix);
  const intake = new Intake(deps.db, ring, prefix);
  const intakeCorrection = new IntakeCorrection(deps.db, prefix);

  // Anyone can make this site email any address they type, as with sign-in
  // codes, and the same kind of limit answers it. In memory, never logged.
  const sendsPerClient = limiter({ max: 20, windowMs: 15 * 60 * 1000 });
  const sendsPerAddress = limiter({ max: 10, windowMs: 60 * 60 * 1000 });
  const confirmsPerClient = limiter({ max: 60, windowMs: 15 * 60 * 1000 });

  // ── public: the filing calls ──────────────────────────────────────────
  route(app, C.submitReport, async ({ request }) => {
    const b = bodyOf<C.BodyOf<typeof C.submitReport>>(C.submitReport, request);
    sendsPerClient.take(request.ip);
    const email = normalizeEmail(b.email);
    if (email) sendsPerAddress.take(email);
    await stageSubmission(filing, b);
    return { pending: true as const };
  });

  route(app, C.getConfirmation, async ({ params, request }) => {
    confirmsPerClient.take(request.ip);
    return { confirmation: await confirmationState(deps.db, params.token) };
  });

  route(app, C.confirmReport, async ({ params, request }) => {
    confirmsPerClient.take(request.ip);
    return confirmSubmission(filing, params.token);
  });

  route(app, C.getIntakeSwitch, async () => ({ open: await intakeIsOpen(deps.db) }));

  // ── staff: the intake switch ──────────────────────────────────────────
  await app.register((scope) => {
    scope.addHook('preHandler', roleGuard(['admin']));
    const state = async () => {
      const stored = await storedIntakeSwitch(deps.db);
      return { open: stored !== false, stored };
    };
    route(scope, C.getIntakeSwitchAdmin, state);
    route(scope, C.setIntakeSwitch, async ({ request }) => {
      const b = bodyOf<C.BodyOf<typeof C.setIntakeSwitch>>(C.setIntakeSwitch, request);
      await setIntakeSwitch(deps.db, b.open, requireUser(request).email);
      return state();
    });
    return Promise.resolve();
  });

  // ── my reports ────────────────────────────────────────────────────────
  await app.register((scope) => {
    scope.addHook('preHandler', (request) => {
      requireUser(request);
      return Promise.resolve();
    });
    const me = (r: FastifyRequest) => requireUser(r).email;

    route(scope, C.listMyReports, async ({ request }) => ({
      reports: await mine.list(me(request)),
    }));
    route(scope, C.getMyReport, ({ params, request }) => mine.detail(me(request), params.threadId));
    route(scope, C.correctMyReport, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.correctMyReport>>(C.correctMyReport, request);
      return { public_ref: await mine.correct(me(request), params.threadId, b) };
    });
    route(scope, C.withdrawMyReport, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.withdrawMyReport>>(C.withdrawMyReport, request);
      await mine.withdraw(me(request), params.threadId, b.comment);
      return { ok: true as const };
    });
    route(scope, C.eraseMyContact, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.eraseMyContact>>(C.eraseMyContact, request);
      await mine.erase(me(request), params.threadId, b.confirm);
      return { ok: true as const };
    });
    /**
     * REPORTER-INITIATED, ALWAYS. This is the only route that writes the
     * permissions log, it is in the signed-in reporter's own scope, and it
     * acts only on a thread their address owns.
     */
    route(scope, C.setMyPermission, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.setMyPermission>>(C.setMyPermission, request);
      if (!isPermission(b.permission)) {
        throw refused(400, 'unknown_permission', 'That is not a permission you can give.');
      }
      if (typeof b.granted !== 'boolean') {
        throw refused(400, 'incomplete', 'Say whether you are giving it or taking it back.');
      }
      const owned = await mine.owned(me(request), params.threadId);
      await setPermission(deps.db, {
        threadId: owned.thread_id,
        permission: b.permission,
        granted: b.granted,
        reason: b.reason ?? null,
      });
      // Taking back the files permission must take published files down,
      // which is storage work for the files workstream (F), behind this.
      return { permissions: await permissionsFor(deps.db, owned.thread_id) };
    });
    return Promise.resolve();
  });

  // ── coordinator intake ────────────────────────────────────────────────
  await app.register((scope) => {
    scope.addHook('preHandler', (request) => {
      const user = requireUser(request);
      if (!coordinatorOrgs(user).length) {
        throw notAllowed('Filing for an organization needs a coordinator or manager in one.');
      }
      return Promise.resolve();
    });
    const who = (r: FastifyRequest) => requireUser(r);

    route(scope, C.listIntakeOrganizations, ({ request }) => ({
      organizations: coordinatorOrgs(who(request)).map((m) => ({
        organization_id: m.organization_id,
        name: m.name,
        role: m.role,
      })),
    }));
    route(scope, C.createIntakeBatch, ({ request }) => {
      const b = bodyOf<C.BodyOf<typeof C.createIntakeBatch>>(C.createIntakeBatch, request);
      return intake.createBatch(who(request), b.organization_id);
    });
    route(scope, C.listIntakeBatches, async ({ request }) => ({
      batches: await intake.listBatches(who(request)),
    }));
    route(scope, C.getIntakeBatch, async ({ params, request }) => {
      const batch = await intake.batch(who(request), Number(params.id));
      return { batch, drafts: await intake.drafts(batch.id) };
    });
    route(scope, C.addIntakeDraft, ({ params, request }) =>
      intake.addDraft(
        who(request),
        Number(params.id),
        bodyOf<C.DraftPayload>(C.addIntakeDraft, request),
      ),
    );
    route(scope, C.updateIntakeDraft, ({ params, request }) =>
      intake.updateDraft(
        who(request),
        Number(params.id),
        bodyOf<C.DraftPayload>(C.updateIntakeDraft, request),
      ),
    );
    route(scope, C.removeIntakeDraft, async ({ params, request }) => {
      await intake.removeDraft(who(request), Number(params.id));
      return { ok: true as const };
    });
    route(scope, C.reviewIntakeBatch, ({ params, request }) =>
      intake.review(who(request), Number(params.id)),
    );
    route(scope, C.submitIntakeBatch, ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.submitIntakeBatch>>(C.submitIntakeBatch, request);
      return intake.submit(who(request), Number(params.id), b.attested);
    });
    // The coordinator's own correction of an account they filed. Never the
    // reporter's "My reports": nothing here writes what a reporter owns.
    route(scope, C.getIntakeFiling, ({ params, request }) =>
      intakeCorrection.detail(who(request), params.threadId),
    );
    route(scope, C.correctIntakeFiling, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.correctIntakeFiling>>(C.correctIntakeFiling, request);
      return { public_ref: await intakeCorrection.correct(who(request), params.threadId, b) };
    });
    return Promise.resolve();
  });
}
