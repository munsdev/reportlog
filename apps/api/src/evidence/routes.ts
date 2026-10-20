/**
 * Evidence requests: the moderator's routes, and the reporter's door.
 *
 * THE DOOR IS UNAUTHENTICATED ON PURPOSE, AND NARROW BECAUSE OF IT. Somebody
 * asked months after filing may no longer be signed in, and a request they
 * cannot answer is not worth making. So the emailed token stands on its own,
 * which is exactly why what it may do is so small: say what was asked and
 * which report it is about (by the reference the reporter already has), take
 * files for that one report, and add them as a new version. It cannot read
 * the report's text, change an answer, withdraw anything, or see who asked.
 *
 * Every gate is checked on every request, the reporter's own permission
 * included (requests.ts says why).
 *
 * The door is IN FRONT OF THE SITE PASSWORD, like the confirmation link
 * (decisions.md §4): its token is what guards it. The gate lets these routes
 * past on a token that names a request (identity/doors.ts); everything else
 * is still decided here.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Readable } from 'node:stream';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { keyringFrom, openContact } from '../filing/contactKeys.ts';
import type { Files } from '../files/context.ts';
import { filesOn } from '../files/context.ts';
import { uploadConfig } from '../files/routes.ts';
import {
  createUploadSlot,
  discardSlot,
  dropFrozenSlots,
  inFlightSlots,
  receiveUpload,
  slotStatuses,
} from '../files/slots.ts';
import { drainDeletions } from '../files/worker.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { requireUser } from '../identity/guards.ts';
import { moderatorGuard } from '../moderation/agreement.ts';
import { limiter } from '../identity/limiter.ts';
import { recordContactUsed } from '../moderation/accessLog.ts';
import {
  askableState,
  attachEvidence,
  cancelRequest,
  createRequest,
  expireStale,
  markLanded,
  markUsed,
  openRequestFor,
  redeem,
  requestHistory,
} from './requests.ts';
import type { Redeemed, Refusal } from './requests.ts';

export interface EvidenceRouteDeps {
  db: Kysely<DB>;
  files: Files | string;
  mailer: Mailer;
  siteOrigin: string;
  contactKey?: string | undefined;
  publicRefPrefix?: string | undefined;
}

/** Decision 19: the reporter is told which files were not kept, by name. */
const filesFrozen = (names: string[]) =>
  new HttpError(
    409,
    'files_frozen',
    `This logbook stopped taking files before you sent ${names.length === 1 ? 'this one' : 'these'}, so ${names.length === 1 ? 'it was' : 'they were'} not kept: ${names.join(', ')}. Nothing was added to your report.`,
  );

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the contract's body type
const bodyOf = <B>(_contract: { body?: unknown }, request: FastifyRequest) => request.body as B;

/**
 * WHAT A STRANGER IS TOLD. Several refusals collapse into one sentence on
 * purpose: telling "expired" from "already used" from "withdrawn" would let
 * anybody with a guessed token learn that a report exists. The one said
 * plainly is the reporter's own switch, which they can turn back on.
 */
const CLOSED =
  'This link is no longer open. If you still have something to send, the people reviewing your report can send you a new one.';
const DOOR: Partial<Record<Refusal, string>> = {
  'permission-withdrawn':
    'You have switched off being asked for evidence, so this link no longer works. You can switch it back on from “My reports”, and then be sent a new link.',
};
const closed = (reason: Refusal) => new HttpError(410, 'closed', DOOR[reason] ?? CLOSED);

/** For a moderator, the reason in a sentence. */
const WHY: Partial<Record<Refusal, string>> = {
  'no-report': 'There is no such report.',
  'not-permitted': 'The reporter has not given permission to be asked for evidence.',
  'nothing-declared':
    'The reporter did not say they had anything to send, so there is nothing to ask for.',
  'report-withdrawn': 'The reporter withdrew this report.',
  'message-short':
    'Write a few words saying what you are asking for: an email with none reads like a scam.',
  'message-long': 'That message is too long. Keep it under 2,000 characters.',
  'already-open':
    'This reporter already has an open request. Withdraw it first if you want to ask again.',
  'no-actor': 'Sign in first.',
};

export const evidenceEmail = (ref: string, logbook: string, message: string, link: string) => ({
  subject: `A question about your report ${ref}`,
  text:
    `Somebody reviewing your report ${ref} to “${logbook}” has asked whether you could send what you mentioned having:\n\n` +
    `${message}\n\n` +
    `If you can, open this link and add the files there:\n\n${link}\n\n` +
    'They are added to your report as a new version; nothing you wrote is changed. The link works for two weeks, once.\n\n' +
    'You are getting this because you said you could be asked. You can switch that off in “My reports”, and this link will stop working.',
});

export async function evidenceRoutes(app: FastifyInstance, deps: EvidenceRouteDeps): Promise<void> {
  const { db } = deps;
  const files = typeof deps.files === 'string' ? null : deps.files;
  const ring = deps.contactKey ? keyringFrom(deps.contactKey) : null;
  const prefix = deps.publicRefPrefix ?? 'RL-';
  const asks = (r: Awaited<ReturnType<typeof requestHistory>>[number]) => ({
    id: r.id,
    asked_by: r.asked_by,
    asked_at: r.asked_at.toISOString(),
    message: r.message,
    expires_at: r.expires_at.toISOString(),
    used_at: r.used_at?.toISOString() ?? null,
    cancelled_at: r.cancelled_at?.toISOString() ?? null,
    expired_at: r.expired_at?.toISOString() ?? null,
  });

  // ── moderators ────────────────────────────────────────────────────────
  // Administrators too, as on the moderation routes these sit beside and as
  // in legacy (routes/moderators.js): the moderation page shows them.
  await app.register((scope) => {
    scope.addHook('preHandler', moderatorGuard(db));

    route(scope, C.getEvidenceState, async ({ params }) => {
      const state = await askableState(db, params.threadId);
      if (!state.ok && state.reason === 'no-report') throw notFound('There is no such report.');
      await expireStale(db, params.threadId);
      const open = await openRequestFor(db, params.threadId);
      const history = await requestHistory(db, params.threadId);
      return {
        askable: state.ok && !open,
        why_not: state.ok
          ? open
            ? (WHY['already-open'] ?? null)
            : null
          : (WHY[state.reason] ?? null),
        declared: state.declared,
        permitted: state.permitted,
        open: open ? (history.map(asks).find((h) => h.id === open.id) ?? null) : null,
        history: history.map(asks),
      };
    });

    route(scope, C.askForEvidence, async ({ params, request }) => {
      const by = requireUser(request).email;
      if (!ring)
        throw new HttpError(
          503,
          'not_configured',
          'Reporters cannot be emailed: CONTACT_KEY is not set.',
        );
      if (!(await filesOn(files))) {
        throw new HttpError(
          409,
          'files_off',
          'This site is not taking files, so there is nothing a reporter could send.',
        );
      }
      // Checked before anything is created: an ask nobody can receive is not an ask.
      // Opening the address is recorded first, for the reporter to see (D3).
      await recordContactUsed(db, { threadId: params.threadId, staffEmail: by });
      const contact = await openContact(db, ring, params.threadId);
      if (contact?.filed_by !== 'reporter' || !contact.email) {
        throw new HttpError(
          409,
          'no_address',
          'There is no address to ask: the reporter’s contact details were erased.',
        );
      }
      const b = bodyOf<C.BodyOf<typeof C.askForEvidence>>(C.askForEvidence, request);
      const out = await createRequest(db, params.threadId, { message: b.message, by });
      if (!out.ok)
        throw new HttpError(
          out.reason === 'already-open' ? 409 : 400,
          out.reason,
          WHY[out.reason] ?? CLOSED,
        );
      const r = await redeem(db, out.token);
      if (!r.ok) throw new HttpError(409, r.reason, WHY[r.reason] ?? CLOSED);
      await deps.mailer.send({
        to: contact.email,
        ...evidenceEmail(
          r.request.publicRef,
          r.request.logbookTitle,
          r.request.message,
          `${deps.siteOrigin}/evidence/${out.token}`,
        ),
      });
      return { ok: true as const, expires_at: out.request.expires_at.toISOString() };
    });

    route(scope, C.cancelEvidenceAsk, async ({ params, request }) => {
      const out = await cancelRequest(db, params.threadId, { by: requireUser(request).email });
      if (!out.ok) throw new HttpError(400, out.reason, WHY[out.reason] ?? CLOSED);
      return { cancelled: out.cancelled };
    });
    return Promise.resolve();
  });

  // ── the reporter's door ───────────────────────────────────────────────
  // Tighter than filing: the only real traffic is one person answering one email.
  const opens = limiter({ max: 60, windowMs: 15 * 60 * 1000 });
  const sends = limiter({ max: 40, windowMs: 15 * 60 * 1000 });
  const open = async (request: FastifyRequest, limit = opens): Promise<Redeemed> => {
    limit.take(request.ip);
    const r = await redeem(db, (request.params as { token: string }).token);
    if (!r.ok) throw closed(r.reason);
    return r.request;
  };
  const filesNow = async (): Promise<Files> => {
    if (!files || !(await filesOn(files))) {
      throw new HttpError(409, 'files_off', 'This site is not taking files at the moment.');
    }
    return files;
  };

  route(app, C.getEvidenceRequest, async ({ request }) => {
    const r = await open(request);
    return {
      message: r.message,
      asked_at: r.askedAt.toISOString(),
      expires_at: r.expiresAt.toISOString(),
      public_ref: r.publicRef,
      logbook_title: r.logbookTitle,
      // The logbook's own limits: decided here from the report, never named
      // by the client.
      uploads: await uploadConfig(files, r.logbookId, true),
    };
  });

  route(app, C.createEvidenceUpload, async ({ request }) => {
    const r = await open(request, sends);
    const f = await filesNow();
    const b = bodyOf<C.BodyOf<typeof C.createEvidenceUpload>>(C.createEvidenceUpload, request);
    return createUploadSlot(
      f,
      { evidenceRequestId: r.id },
      {
        name: b.name ?? '',
        type: b.type ?? '',
        size: typeof b.size === 'number' ? b.size : NaN,
        logbookId: r.logbookId,
      },
    );
  });

  route(app, C.getEvidenceUploads, async ({ request }) => {
    const r = await open(request);
    return {
      files: (await slotStatuses(db, { evidenceRequestId: r.id })).map((s) => ({
        slot_token: s.slot_token,
        name: s.declared_name,
        size: s.declared_size,
        status: s.status,
        detail: s.status_detail,
      })),
    };
  });

  route(app, C.removeEvidenceUpload, async ({ params, request }) => {
    const r = await open(request, sends);
    if (!(await discardSlot(db, { evidenceRequestId: r.id }, params.slot))) {
      throw notFound('There is no such file on this request.');
    }
    if (files) await drainDeletions(files).catch(() => undefined);
    return { ok: true as const };
  });

  await app.register((scope) => {
    scope.addContentTypeParser('*', (_req, payload, done) => {
      done(null, payload);
    });
    scope.route({
      method: 'PUT',
      url: '/api/evidence/:token/files/:slot',
      handler: async (request) => {
        const r = await open(request, sends);
        const f = await filesNow();
        return receiveUpload(
          f,
          { evidenceRequestId: r.id },
          (request.params as { slot: string }).slot,
          request.body as Readable,
        );
      },
    });
    return Promise.resolve();
  });

  route(app, C.sendEvidence, async ({ request }) => {
    const r = await open(request, sends);
    await filesNow();
    const waiting = await inFlightSlots(db, { evidenceRequestId: r.id });
    if (waiting.length) {
      throw new HttpError(
        409,
        'preparing',
        'Your files are still being prepared. Wait until each one says it is ready, then send.',
      );
    }
    // A logbook frozen since these were staged drops them (decision 19). Its
    // own statement, before the link is spent, so the drop stands and the
    // link is not used up by an answer that added nothing. sealFiles checks
    // again inside the transaction, for a freeze that lands in between.
    const frozen = await dropFrozenSlots(db, { evidenceRequestId: r.id });
    if (frozen.length) throw filesFrozen(frozen);
    const done = await db.transaction().execute(async (trx) => {
      // Spent FIRST: two presses at once create one version.
      if (!(await markUsed(trx, { requestId: r.id, reportId: r.currentReportId }))) return null;
      const out = await attachEvidence(trx, {
        threadId: r.threadId,
        requestId: r.id,
        publicRefPrefix: prefix,
      });
      if (!out.ok) {
        if (out.reason === 'files-frozen') throw filesFrozen(out.dropped);
        throw out.reason === 'nothing-sent'
          ? new HttpError(
              400,
              'nothing_sent',
              'Nothing has finished uploading yet, so there is nothing to send.',
            )
          : closed(out.reason === 'no-report' ? 'not-found' : out.reason);
      }
      await markLanded(trx, { requestId: r.id, reportId: out.report.id });
      return { public_ref: out.report.public_ref, attached: out.attached };
    });
    if (!done) throw closed('used');
    return done;
  });
}
