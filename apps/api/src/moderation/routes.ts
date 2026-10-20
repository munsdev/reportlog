/**
 * Moderation's routes, registered in one call from app.ts.
 *
 * Three scopes, each guarded once so a route added later cannot forget:
 *
 *   - the queue: moderators and administrators (as legacy; admin does not
 *     imply moderator, so both are named);
 *   - the chief editor's and the operator's calls: administrators only;
 *   - a reporter reading their own access log: anybody signed in, for a
 *     report that address owns.
 *
 * NO ROUTE HERE WRITES A REPORTER'S PERMISSION. Only the reporter changes
 * those (filing/routes.ts); a test walks the source to keep it so.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import {
  distributionAvailable,
  publicArchiveAvailable,
  setDistribution,
  setPublicArchive,
  storedDistribution,
  storedPublicArchive,
} from '../board/publication.ts';
import type { DB } from '../db/schema.gen.ts';
import { keyringFrom } from '../filing/contactKeys.ts';
import { Mine } from '../filing/mine.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { requireUser, roleGuard } from '../identity/guards.ts';
import { launchedLogbooks, logbookBySlug } from '../logbooks/logbooks.ts';
import {
  accessesForThreads,
  openContactLogged,
  recentAccesses,
  recordAuditRead,
} from './accessLog.ts';
import { assessmentOf, corroborationSummary, linkIncident, setSeverity } from './assessment.ts';
import { openFlagCount } from './flags.ts';
import { json } from './json.ts';
import {
  DEFAULT_REVIEW_KEYWORDS,
  normalizeKeywords,
  reviewKeywords,
  setReviewKeywords,
  storedKeywords,
} from './keywords.ts';
import {
  addLink,
  linksFor,
  noteFor,
  notesEnabled,
  removeLink,
  setNoteState,
  setNotesEnabled,
  versionsFor,
  writeNote,
} from './notes.ts';
import { decide, historyFor, listQueue, markRead, restore, withdraw } from './queue.ts';

export interface ModerationRouteDeps {
  db: Kysely<DB>;
  /** The deployment's CONTACT_KEY: without it, contact details cannot be opened. */
  contactKey?: string | undefined;
  publicRefPrefix?: string | undefined;
}

/** The request body, already validated against the contract by Fastify. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the contract's body type
const bodyOf = <B>(_contract: { body?: unknown }, request: FastifyRequest) => request.body as B;
const refuse = (status: number, code: string, message: string) =>
  new HttpError(status, code, message);

export async function moderationRoutes(
  app: FastifyInstance,
  deps: ModerationRouteDeps,
): Promise<void> {
  const { db } = deps;
  const ring = deps.contactKey ? keyringFrom(deps.contactKey) : null;
  const me = (r: FastifyRequest) => requireUser(r).email;

  async function queueItem(threadId: string) {
    const archive = await publicArchiveAvailable(db);
    const rows = await listQueue(db, { status: 'all', threadId });
    const row = rows[0];
    if (!row) throw notFound('There is no report with that reference.');
    return present(row, archive);
  }

  async function assessment(
    threadId: string,
  ): Promise<C.ResponseOf<typeof C.getQueueItem>['assessment']> {
    const a = await assessmentOf(db, threadId);
    return {
      ...a,
      linked: a.linked.map((l) => ({
        ...l,
        moderation_status: C.ModerationStatus.parse(l.moderation_status),
      })),
    };
  }

  function present(
    row: Awaited<ReturnType<typeof listQueue>>[number],
    archive: boolean,
  ): C.QueueItem {
    return {
      thread_id: row.thread_id,
      public_ref: row.public_ref,
      received_at: row.received_at.toISOString(),
      logbook_slug: row.logbook_slug,
      logbook_title: row.logbook_title,
      answers: (row.answers ?? {}) as Record<string, unknown>,
      may_publish: row.may_publish,
      moderation_status: row.moderation_status as C.ModerationStatus,
      withdrawn: row.withdrawn,
      reporter_withdrew: row.reporter_withdrew,
      versions: row.versions,
      filed_via: row.filed_via,
      intake_method: row.intake_method,
      needs_review: row.needs_review,
      review_terms: row.needs_review ? (row.flag_terms ?? []) : [],
      notes_enabled: row.notes_enabled,
      has_note: row.has_note,
      has_contact: row.has_contact,
      file_count: row.file_count,
      published_files: row.published_files,
      files_permitted: row.files_permitted,
      public: archive && !row.withdrawn && row.moderation_status === 'valid' && row.may_publish,
      severity: row.severity,
      corroboration: row.corroboration,
      incident_size: row.incident_size,
    };
  }

  // ── the queue: moderators and administrators ──────────────────────────
  await app.register((scope) => {
    scope.addHook('preHandler', roleGuard(['moderator', 'admin']));

    route(scope, C.listQueue, async ({ query }) => {
      const archive = await publicArchiveAvailable(db);
      const rows = await listQueue(db, {
        status: query.status,
        q: query.q,
        flagged: query.flagged === 'true',
        logbook: query.logbook,
        severity: query.severity,
        sort: query.sort,
      });
      return {
        reports: rows.map((r) => present(r, archive)),
        open_flags: await openFlagCount(db),
        archive_published: archive,
      };
    });

    route(scope, C.getQueueItem, async ({ params }) => ({
      report: await queueItem(params.threadId),
      history: json(await historyFor(db, params.threadId)),
      assessment: await assessment(params.threadId),
    }));

    // ── severity and incidents: a moderator's judgement, never sealed ──
    route(scope, C.setReportSeverity, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.setReportSeverity>>(C.setReportSeverity, request);
      // Clearing is a choice somebody states ("none"); a request that forgot
      // the field is refused rather than read as one.
      if (b.severity === undefined) {
        throw refuse(400, 'invalid_severity', 'Choose a severity, or none to clear it.');
      }
      const chosen = b.severity === 'none' ? null : b.severity;
      const severity = await setSeverity(db, params.threadId, chosen, b.comment, me(request));
      return { ok: true as const, severity };
    });

    route(scope, C.linkReportIncident, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.linkReportIncident>>(C.linkReportIncident, request);
      const incident = await linkIncident(db, params.threadId, b.link_to, b.comment, me(request));
      return { ok: true as const, incident_id: incident };
    });

    route(scope, C.getCorroboration, () => corroborationSummary(db));

    route(scope, C.decideReport, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.decideReport>>(C.decideReport, request);
      await decide(db, params.threadId, b.status, b.comment, me(request));
      return { ok: true as const };
    });

    route(scope, C.withdrawReport, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.withdrawReport>>(C.withdrawReport, request);
      await withdraw(db, params.threadId, b.comment, me(request));
      return { ok: true as const };
    });

    route(scope, C.restoreReport, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.restoreReport>>(C.restoreReport, request);
      await restore(db, params.threadId, b.status, b.comment, me(request));
      return { ok: true as const };
    });

    route(scope, C.markReportRead, async ({ params, request }) => ({
      ok: true as const,
      cleared: await markRead(db, params.threadId, me(request)),
    }));

    route(scope, C.openReportContact, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.openReportContact>>(C.openReportContact, request);
      if (!ring) {
        throw refuse(
          503,
          'not_configured',
          'This site has no contact key set, so contact details cannot be opened.',
        );
      }
      const out = await openContactLogged(db, ring, {
        threadId: params.threadId,
        staffEmail: me(request),
        reason: b.reason,
      });
      if (!out.ok && out.reason === 'reason') throw refuse(400, 'reason_required', out.message);
      if (!out.ok) throw notFound('There are no contact details on that report.');
      return { contact: out.contact };
    });

    // ── editorial notes ──
    /**
     * Whether this report's logbook uses notes. Checked at the route for every
     * write: a note that can be POSTed to a logbook whose operator turned the
     * feature off is a feature that is not really off.
     */
    async function notesGate(threadId: string) {
      const row = await db
        .selectFrom('report_heads as h')
        .innerJoin('reports as r', 'r.id', 'h.current_report_id')
        .select(['r.logbook_id', 'h.current_report_id'])
        .where('h.thread_id', '=', threadId)
        .executeTakeFirst();
      if (!row) throw notFound('There is no report with that reference.');
      if (!(await notesEnabled(db, row.logbook_id))) {
        throw refuse(
          409,
          'notes_off',
          'This logbook does not use editorial notes. An administrator turns them on per logbook.',
        );
      }
      return row;
    }

    route(scope, C.getReportNote, async ({ params }) => {
      const head = await db
        .selectFrom('report_heads as h')
        .innerJoin('reports as r', 'r.id', 'h.current_report_id')
        .select('r.logbook_id')
        .where('h.thread_id', '=', params.threadId)
        .executeTakeFirst();
      if (!head) throw notFound('There is no report with that reference.');
      const note = await noteFor(db, params.threadId);
      return {
        enabled: await notesEnabled(db, head.logbook_id),
        note: note
          ? {
              state: note.state,
              body: note.body,
              author_email: note.author_email,
              written_at: note.written_at.toISOString(),
              versions: note.versions,
            }
          : null,
        versions: json(await versionsFor(db, params.threadId)),
        links: (await linksFor(db, params.threadId)).map((l) => ({
          id: l.id,
          title: l.title,
          publisher: l.publisher,
          published_on: l.published_on,
          url: l.url,
          added_by: l.added_by,
        })),
      };
    });

    /**
     * A REVISION NEEDS A REASON AND A FIRST VERSION DOES NOT. The second time,
     * somebody is changing the archive's own published statement, and a
     * change nobody had to explain is one nobody can audit.
     */
    route(scope, C.writeReportNote, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.writeReportNote>>(C.writeReportNote, request);
      const head = await notesGate(params.threadId);
      const reason = b.revision_reason?.trim() ?? '';
      const existing = await noteFor(db, params.threadId);
      if (existing && !reason) {
        throw refuse(
          400,
          'reason_required',
          'A revision needs a reason. This note is already published, and every version stays on the record.',
        );
      }
      const out = await writeNote(db, {
        threadId: params.threadId,
        body: b.body,
        authorEmail: me(request),
        revisionReason: reason || null,
      });
      if (!out.ok) throw refuse(400, 'invalid_note', out.message);
      await db
        .insertInto('moderation_log')
        .values({
          thread_id: params.threadId,
          report_id: head.current_report_id,
          action: existing ? 'note_revised' : 'note',
          new_status: `v${String(out.versions)}`,
          actor_email: me(request),
          comment: reason || 'first version',
        })
        .execute();
      return { ok: true as const, versions: out.versions };
    });

    route(scope, C.addNoteLink, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.addNoteLink>>(C.addNoteLink, request);
      const head = await notesGate(params.threadId);
      const out = await addLink(db, {
        threadId: params.threadId,
        title: b.title,
        publisher: b.publisher,
        publishedOn: b.published_on,
        url: b.url,
        addedBy: me(request),
      });
      if (!out.ok) {
        const why = {
          title: 'A citation needs a title, under 300 characters.',
          url: 'A citation needs an http or https address.',
          'no-note': 'Write the note first: a citation sits beside a note, not on its own.',
        }[out.reason];
        throw refuse(out.reason === 'no-note' ? 409 : 400, 'invalid_link', why);
      }
      await db
        .insertInto('moderation_log')
        .values({
          thread_id: params.threadId,
          report_id: head.current_report_id,
          action: 'note_link',
          new_status: 'added',
          actor_email: me(request),
          comment: (b.title ?? '').trim().slice(0, 200),
        })
        .execute();
      return { ok: true as const, id: out.linkId };
    });

    route(scope, C.removeNoteLink, async ({ params, request }) => {
      const head = await notesGate(params.threadId);
      if (!(await removeLink(db, params.threadId, Number(params.id)))) {
        throw notFound('There is no such citation on that note.');
      }
      await db
        .insertInto('moderation_log')
        .values({
          thread_id: params.threadId,
          report_id: head.current_report_id,
          action: 'note_link',
          new_status: 'removed',
          actor_email: me(request),
          comment: `citation ${String(params.id)}`,
        })
        .execute();
      return { ok: true as const };
    });
    return Promise.resolve();
  });

  // ── administrators ────────────────────────────────────────────────────
  await app.register((scope) => {
    scope.addHook('preHandler', roleGuard(['admin']));

    /**
     * The chief editor's seat until there is a desk for one. A note is NOT
     * taken down automatically when its report is withdrawn; taking it down
     * is a decision somebody records.
     */
    route(scope, C.setNoteState, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.setNoteState>>(C.setNoteState, request);
      const comment = b.comment?.trim() ?? '';
      if (!comment) throw refuse(400, 'reason_required', 'Give a reason. It stays on the record.');
      const out = await setNoteState(db, params.threadId, b.state);
      if (!out.ok) {
        if (out.reason === 'no-note') throw notFound('There is no note on that report.');
        throw refuse(400, 'invalid_state', 'A note is published, under review, or withdrawn.');
      }
      const head = await db
        .selectFrom('report_heads')
        .select('current_report_id')
        .where('thread_id', '=', params.threadId)
        .executeTakeFirstOrThrow();
      await db
        .insertInto('moderation_log')
        .values({
          thread_id: params.threadId,
          report_id: head.current_report_id,
          action: 'note_state',
          new_status: out.state,
          actor_email: me(request),
          comment,
        })
        .execute();
      return { ok: true as const, state: out.state };
    });

    /**
     * Reading the log is itself an access, and recorded: otherwise the most
     * sensitive summary in the system is the one place a person can look
     * without leaving a mark.
     */
    route(scope, C.getAccessLog, async ({ query, request }) => {
      const months = Number(query.months ?? 12);
      const entries = await recentAccesses(db, { months, threadId: query.thread ?? null });
      await recordAuditRead(db, me(request));
      return { months, entries: json(entries) };
    });

    async function keywordsState(): Promise<C.ResponseOf<typeof C.getReviewKeywords>> {
      const stored = await storedKeywords(db);
      return {
        using_default: stored.chosen === null,
        terms: await reviewKeywords(db),
        default_count: DEFAULT_REVIEW_KEYWORDS.length,
        set_by: stored.set_by,
        set_at: stored.set_at ? stored.set_at.toISOString() : null,
      };
    }
    route(scope, C.getReviewKeywords, keywordsState);
    route(scope, C.setReviewKeywords, async ({ request }) => {
      const b = bodyOf<C.BodyOf<typeof C.setReviewKeywords>>(C.setReviewKeywords, request);
      // "Back to the shipped list" is its own action, so a reset gets what this
      // release ships rather than whatever the page happened to show.
      if (b.reset === true) {
        await setReviewKeywords(db, null, me(request));
        return keywordsState();
      }
      // One term per line: commas would make "turned away, sent home" ambiguous.
      const list = Array.isArray(b.terms)
        ? b.terms
        : typeof b.terms === 'string'
          ? b.terms.split(/\r?\n/)
          : null;
      if (list === null) throw refuse(400, 'incomplete', 'Send the terms, one per line.');
      const out = await setReviewKeywords(db, normalizeKeywords(list) ?? [], me(request));
      if (!out.ok)
        throw refuse(400, 'too_many', 'That is more than 2000 terms. Keep the list shorter.');
      return keywordsState();
    });

    const archiveState = async () => {
      const stored = await storedPublicArchive(db);
      const distribution_stored = await storedDistribution(db);
      return {
        published: stored !== false,
        stored,
        distribution: await distributionAvailable(db),
        distribution_stored,
      };
    };
    route(scope, C.getArchiveSwitch, archiveState);
    route(scope, C.setArchiveSwitch, async ({ request }) => {
      const b = bodyOf<C.BodyOf<typeof C.setArchiveSwitch>>(C.setArchiveSwitch, request);
      // Each switch only when named: turning one must never reset the other.
      if (b.published !== undefined) await setPublicArchive(db, b.published, me(request));
      if (b.distribution !== undefined) await setDistribution(db, b.distribution, me(request));
      return archiveState();
    });

    route(scope, C.listNotesSwitches, async () => {
      const out = [];
      for (const lb of await launchedLogbooks(db)) {
        out.push({ slug: lb.slug, title: lb.title, notes_enabled: await notesEnabled(db, lb.id) });
      }
      return { logbooks: out };
    });
    route(scope, C.setNotesSwitch, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.setNotesSwitch>>(C.setNotesSwitch, request);
      const lb = await logbookBySlug(db, params.slug);
      if (!lb?.launched_at) throw notFound('There is no launched logbook with that name.');
      await setNotesEnabled(db, lb.id, b.enabled, me(request));
      return { slug: lb.slug, notes_enabled: b.enabled };
    });
    return Promise.resolve();
  });

  // ── a reporter's own access log ───────────────────────────────────────
  await app.register((scope) => {
    scope.addHook('preHandler', (request) => {
      requireUser(request);
      return Promise.resolve();
    });
    const mine = new Mine(db, ring, deps.publicRefPrefix ?? 'RL-');
    route(scope, C.getMyReportAccesses, async ({ params, request }) => {
      // Ownership exactly as "My reports" decides it: a 404 that does not say
      // whether the report exists.
      await mine.owned(me(request), params.threadId);
      const rows = await accessesForThreads(db, [params.threadId]);
      return {
        accesses: rows.map((r) => ({
          what: r.kind,
          reason: r.reason,
          accessed_at: r.accessed_at.toISOString(),
        })),
      };
    });
    return Promise.resolve();
  });
}
