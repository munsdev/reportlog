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
import type { Readable } from 'node:stream';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import type { Files } from '../files/context.ts';
import { filesOn } from '../files/context.ts';
import { afterCommit, takeDownForReporter } from '../files/publication.ts';
import { notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { notAllowed, requireUser, roleGuard } from '../identity/guards.ts';
import { stepUpGuard } from '../identity/stepUp.ts';
import { limiter } from '../identity/limiter.ts';
import { normalizeEmail } from '../identity/secrets.ts';
import { isPermission, permissionsFor, setPermission } from '../permissions/log.ts';
import { keyringFrom } from './contactKeys.ts';
import { confirmSubmission, confirmationState, refused, stageSubmission } from './filing.ts';
import type { FilingDeps } from './filing.ts';
import { Intake, coordinatorOrgs } from './intake.ts';
import { IntakeCorrection } from './intakeCorrection.ts';
import { IntakeFiles } from './intakeFiles.ts';
import { intakeIsOpen, setIntakeSwitch, storedIntakeSwitch } from './intakeSwitch.ts';
import { Mine } from './mine.ts';
import type { Door } from '../door/index.ts';
import { refuseWhilePaused } from '../moderation/switches.ts';

export interface FilingRouteDeps {
  db: Kysely<DB>;
  mailer: Mailer;
  siteOrigin: string;
  /** The deployment's CONTACT_KEY. Without it, nothing is filed and the refusal says why. */
  contactKey?: string | undefined;
  /** Only while CONTACT_KEY is being rotated: the key being rotated from (contactKeys.ts). */
  previousContactKey?: string | undefined;
  publicRefPrefix?: string | undefined;
  /** FILING_SENDS_PER_CLIENT: reports one client may send in 15 minutes. */
  sendsPerClient?: number | undefined;
  /** FILING_CONFIRMS_PER_CLIENT: confirmation links one client may open or use in 15 minutes. */
  confirmsPerClient?: number | undefined;
  /** The files workstream's context, for taking published files down. */
  files?: Files | null;
  /** The checks every report passes before it is read (door/). */
  door: Door;
}

/** The request body, already validated against the contract by Fastify. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the contract's body type
const bodyOf = <B>(_contract: { body?: unknown }, request: FastifyRequest) => request.body as B;

export async function filingRoutes(app: FastifyInstance, deps: FilingRouteDeps): Promise<void> {
  const ring = deps.contactKey ? keyringFrom(deps.contactKey, deps.previousContactKey) : null;
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
    filesOn: () => filesOn(deps.files ?? null),
  };
  const mine = new Mine(deps.db, ring, prefix);
  const intake = new Intake(deps.db, ring, prefix, deps.files ?? null);
  const intakeFiles = new IntakeFiles(deps.db, intake, deps.files ?? null);
  const intakeCorrection = new IntakeCorrection(deps.db, prefix);

  // Anyone can make this site email any address they type, as with sign-in
  // codes, and the same kind of limit answers it. In memory, never logged,
  // and keyed by the door's daily hash of the address, never the address
  // itself (owner decision E2).
  const sendsPerClient = limiter({ max: deps.sendsPerClient ?? 20, windowMs: 15 * 60 * 1000 });
  const sendsPerAddress = limiter({ max: 10, windowMs: 60 * 60 * 1000 });
  const confirmsPerClient = limiter({
    max: deps.confirmsPerClient ?? 60,
    windowMs: 15 * 60 * 1000,
  });

  // ── public: the filing calls ──────────────────────────────────────────
  route(app, C.submitReport, async ({ request }) => {
    // Plan E: a moderator's pause stops new reports (moderation/switches.ts).
    await refuseWhilePaused(deps.db);
    const b = bodyOf<C.BodyOf<typeof C.submitReport>>(C.submitReport, request);
    // THE DOOR FIRST: a refusal there is one plain sentence and the report is
    // not read at all, so nothing of it is stored.
    await deps.door.pass(request, b);
    sendsPerClient.take(deps.door.client(request));
    const email = normalizeEmail(b.email);
    if (email) sendsPerAddress.take(email);
    const out = await stageSubmission(filing, b);
    if (out.filed) return { filed: true as const, public_ref: out.publicRef };
    return {
      pending: true as const,
      ...(out.filesDropped.length ? { files_dropped: out.filesDropped } : {}),
    };
  });

  route(app, C.getConfirmation, async ({ params, request }) => {
    confirmsPerClient.take(deps.door.client(request));
    return { confirmation: await confirmationState(deps.db, params.token) };
  });

  route(app, C.confirmReport, async ({ params, request }) => {
    confirmsPerClient.take(deps.door.client(request));
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
    // Pausing intake asks for the second factor again (plan E, E3).
    void scope.register((pause) => {
      pause.addHook('preHandler', stepUpGuard());
      route(pause, C.setIntakeSwitch, async ({ request }) => {
        const b = bodyOf<C.BodyOf<typeof C.setIntakeSwitch>>(C.setIntakeSwitch, request);
        await setIntakeSwitch(deps.db, b.open, requireUser(request).email);
        return state();
      });
      return Promise.resolve();
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
      const permission = b.permission;
      const granted = b.granted;
      await deps.db.transaction().execute(async (trx) => {
        await setPermission(trx, {
          threadId: owned.thread_id,
          permission,
          granted,
          reason: b.reason ?? null,
        });
        // TAKING BACK THE FILES PERMISSION TAKES PUBLISHED FILES DOWN, in the
        // same transaction, through the files workstream's one path down (the
        // moderator's withholding uses it too). The database refuses the
        // revocation if any file of the thread is still published at commit.
        if (permission === 'attachment_publication' && !granted) {
          await takeDownForReporter(trx, owned.thread_id);
        }
      });
      await afterCommit(deps.files ?? null);
      return { permissions: await permissionsFor(deps.db, owned.thread_id) };
    });
    return Promise.resolve();
  });

  // ── coordinator intake ────────────────────────────────────────────────
  await app.register(async (scope) => {
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
    // An account's files: the same slots, limits and worker as a reporter's
    // (intakeFiles.ts says what differs, and why).
    route(scope, C.listIntakeDraftFiles, async ({ params, request }) => ({
      files: await intakeFiles.list(who(request), Number(params.id)),
    }));
    route(scope, C.addIntakeDraftFile, ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.addIntakeDraftFile>>(C.addIntakeDraftFile, request);
      return intakeFiles.add(who(request), Number(params.id), {
        logbook: b.logbook,
        name: b.name ?? '',
        type: b.type ?? '',
        size: typeof b.size === 'number' ? b.size : NaN,
      });
    });
    route(scope, C.removeIntakeDraftFile, async ({ params, request }) => {
      await intakeFiles.remove(who(request), Number(params.id), params.slot);
      return { ok: true as const };
    });
    // The bytes, in a scope whose parser hands the body over unread.
    await scope.register((bytes) => {
      bytes.addContentTypeParser('*', (_req, payload, done) => {
        done(null, payload);
      });
      bytes.route({
        method: 'PUT',
        url: '/api/intake/drafts/:id/files/:slot',
        handler: async (request) => {
          const p = request.params as { id: string; slot: string };
          const id = Number(p.id);
          if (!Number.isSafeInteger(id) || id < 1) throw notFound('There is no such account.');
          return intakeFiles.receive(who(request), id, p.slot, request.body as Readable);
        },
      });
      return Promise.resolve();
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
