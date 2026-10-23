/**
 * The feedback tracker's routes, in three scopes, each guarded once so a
 * route added to it later cannot forget to ask:
 *
 *   testers      file, read every issue, comment. The tester flag, or an
 *                administrator or Access Manager.
 *   staff        the queue and moving an issue. Administrators.
 *   granters     giving and taking the tester flag. Administrators and
 *                Access Managers.
 *
 * Mail is sent after the change is saved and never blocks it: a failed send
 * must not cost a tester their issue, and the weekly digest lists every
 * open issue regardless.
 */
import {
  commentOnFeedback,
  fileFeedback,
  getFeedback,
  getFeedbackAdmin,
  getFeedbackQueue,
  listFeedback,
  listTesters,
  setFeedbackStatus,
  setTester,
} from '@reportlog/contracts';
import { roleSatisfies } from '@reportlog/access';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../db/database.ts';
import type { EmailMessage, Mailer } from '../email/mailer.ts';
import { route } from '../http/route.ts';
import { notAllowed, requireUser, roleGuard } from '../identity/guards.ts';
import { bodyOf } from '../identity/http.ts';
import { limiter } from '../identity/limiter.ts';
import type { SignedIn } from '../identity/sessions.ts';
import {
  addComment,
  adminDetail,
  changeStatus,
  fileFeedback as file,
  issueDetail,
  listIssues,
  queue,
} from './feedback.ts';
import { newFeedbackEmail, statusEmail } from './emails.ts';
import { listTesters as testers, setTesterFlag } from './testers.ts';

export interface FeedbackDeps {
  db: Database;
  mailer: Mailer;
  siteOrigin: string;
  /** Where a new issue is announced. Without one, only the weekly digest says so. */
  adminEmail?: string | undefined;
}

/** May open the tracker: the flag, or the people who could give it. */
export function mayUseTracker(user: SignedIn): boolean {
  return user.tester || roleSatisfies(user.roles, 'admin') || user.roles.includes('access_manager');
}

function requireTester(request: FastifyRequest): SignedIn {
  const user = requireUser(request);
  if (!mayUseTracker(user)) throw notAllowed('The feedback tracker is open to testers.');
  return user;
}

export async function feedbackRoutes(app: FastifyInstance, deps: FeedbackDeps): Promise<void> {
  const { db, mailer, siteOrigin } = deps;
  // Bounded rather than strict: a stuck retry loop in a browser must not
  // be able to fill the queue.
  const writes = limiter({ max: 20, windowMs: 15 * 60 * 1000 });

  function sendQuietly(request: FastifyRequest, message: EmailMessage) {
    mailer.send(message).catch((err: unknown) => {
      // Never the address or the text: the log says only that it failed.
      request.log.error({ err }, 'a feedback email could not be sent');
    });
  }

  await app.register((scoped, _opts, done) => {
    scoped.addHook('preHandler', (request) => {
      requireTester(request);
      return Promise.resolve();
    });

    route(scoped, fileFeedback, async ({ request }) => {
      const user = requireTester(request);
      writes.take(`user:${String(user.id)}`);
      const { id, checked } = await file(db, user.id, bodyOf(fileFeedback, request));
      if (deps.adminEmail) {
        sendQuietly(request, {
          to: deps.adminEmail,
          ...newFeedbackEmail({ id, ...checked, submitter_email: user.email }, siteOrigin),
        });
      }
      return { id };
    });

    route(scoped, listFeedback, async ({ request }) => ({
      issues: await listIssues(db, requireTester(request).id),
    }));

    route(scoped, getFeedback, ({ params, request }) =>
      issueDetail(db, Number(params.id), requireTester(request).id),
    );

    route(scoped, commentOnFeedback, async ({ params, request }) => {
      const user = requireTester(request);
      writes.take(`user:${String(user.id)}`);
      await addComment(db, Number(params.id), user.id, bodyOf(commentOnFeedback, request).body);
      return issueDetail(db, Number(params.id), user.id);
    });

    done();
  });

  await app.register((scoped, _opts, done) => {
    scoped.addHook('preHandler', roleGuard(['admin']));

    route(scoped, getFeedbackQueue, ({ query, request }) =>
      queue(db, query.status, requireUser(request).id),
    );

    route(scoped, getFeedbackAdmin, ({ params, request }) =>
      adminDetail(db, Number(params.id), requireUser(request).id),
    );

    route(scoped, setFeedbackStatus, async ({ params, request }) => {
      const user = requireUser(request);
      const { status, note } = bodyOf(setFeedbackStatus, request);
      const changed = await changeStatus(db, Number(params.id), user.id, status, note);
      // Not to yourself: an administrator closing their own issue knows.
      if (changed.submitter_id !== user.id) {
        sendQuietly(request, { to: changed.submitter_email, ...statusEmail(changed, siteOrigin) });
      }
      return adminDetail(db, Number(params.id), user.id);
    });

    done();
  });

  await app.register((scoped, _opts, done) => {
    scoped.addHook('preHandler', roleGuard(['admin', 'access_manager']));

    route(scoped, listTesters, async () => ({ testers: await testers(db) }));

    route(scoped, setTester, async ({ request }) => {
      const user = requireUser(request);
      const { email, tester } = bodyOf(setTester, request);
      const { unchanged } = await setTesterFlag(db, { actor: user, email, tester });
      return { ok: true as const, unchanged };
    });

    done();
  });
}
