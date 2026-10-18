/**
 * Logbooks over HTTP.
 *
 * TWO AUDIENCES, DELIBERATELY SPLIT. Everything that shapes a logbook is
 * staff-only, under /api/admin/. What a reporter needs is public, because the
 * form has to render before anybody has signed in. A DRAFT IS NEVER PUBLIC:
 * the public routes serve only launched logbooks, so a questionnaire still
 * being written cannot be found by guessing its address.
 *
 * Every refusal is a LogbookRefusal, which is already an HttpError with a
 * sentence, so these handlers translate nothing.
 */
import {
  addQuestion,
  clearHomeButtons as clearHomeButtonsContract,
  createLogbook as createLogbookContract,
  createLogbookFromFile,
  deleteLogbook,
  downloadLogbookFile,
  getHomeButtons,
  getHomeButtonsAdmin,
  getLogbook,
  getPublicLogbook,
  launchLogbook,
  listLogbooks as listLogbooksContract,
  listPublicLogbooks,
  listStartingPoints,
  removeQuestion,
  reorderQuestions,
  setHomeButtons as setHomeButtonsContract,
  setLogbookClosed,
  setLogbookSchedule,
  updateLogbook,
  updateQuestion,
} from '@reportlog/contracts';
import type { FormQuestion, Question } from '@reportlog/contracts';
import { FILE_TYPE, LOCATION_TYPE, canFilter, placeOptions } from '@reportlog/fields';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/database.ts';
import { notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import {
  availableButtons,
  clearHomeButtons,
  homeButtons,
  setHomeButtons,
  storedOrder,
} from './homeButtons.ts';
import type { ButtonSources } from './homeButtons.ts';
import { createFromFile, toFile } from './logbookFile.ts';
import {
  addField,
  createLogbook,
  deleteDraft,
  fieldsFor,
  launch,
  launchedLogbooks,
  logbookBySlug,
  logbookDetail,
  listLogbooks,
  openLogbooks,
  removeField,
  reorderFields,
  setClosed,
  setSchedule,
  updateDetails,
  updateField,
} from './logbooks.ts';
import { createFromStartingPoint, startingPoints } from './templates.ts';

export interface LogbookRouteDeps {
  /** Where list buttons come from. The lists workstream supplies this. */
  buttons?: ButtonSources;
}

/**
 * A question as the reporter's form needs it. `id`, `position` and
 * `filterable` are the builder's business. `help` and `shown_when` are
 * absent, not null, when there is none, as in the form definition.
 */
function forForm(q: Question): FormQuestion {
  return {
    key: q.key,
    kind: q.kind,
    label: q.label,
    ...(q.help ? { help: q.help } : {}),
    required: q.required,
    ...(q.shown_when ? { shown_when: q.shown_when } : {}),
    settings: q.settings,
    // THE PLACES A LOCATION QUESTION OFFERS travel with the question, so a
    // reporter outside the site password never needs a second endpoint.
    ...(q.kind === LOCATION_TYPE ? { places: placeOptions(q.settings) } : {}),
  };
}

export function logbookRoutes(
  app: FastifyInstance,
  db: Database,
  deps: LogbookRouteDeps = {},
): void {
  // ── public ────────────────────────────────────────────────────────────

  route(app, listPublicLogbooks, async ({ query }) => {
    // The form asks for what is taking reports now; the board asks with
    // include=closed, because a closed logbook's reports are still the record.
    const list = query.include === 'closed' ? await launchedLogbooks(db) : await openLogbooks(db);
    return {
      logbooks: list.map((l) => ({
        slug: l.slug,
        title: l.title,
        blurb: l.blurb,
        state: l.state,
        questions: l.question_count,
      })),
    };
  });

  route(app, getPublicLogbook, async ({ params }) => {
    const lb = await logbookBySlug(db, params.slug);
    // A draft is not merely closed to filing: it does not exist publicly.
    if (!lb || lb.state === 'draft') throw notFound('There is no logbook at that address.');
    const fields = await fieldsFor(db, lb.id);
    return {
      slug: lb.slug,
      title: lb.title,
      blurb: lb.blurb,
      state: lb.state,
      opens_at: lb.opens_at,
      closes_at: lb.closes_at,
      accepting: lb.state === 'open',
      // Whether it ASKS for files. Whether the site can store one right now,
      // and whether somebody froze this logbook's uploads, are the files
      // workstream's to add beside this, resolved on the server.
      asks_for_files: fields.some((f) => f.kind === FILE_TYPE),
      fields: fields.map(forForm),
      filters: fields.filter((f) => f.filterable && canFilter(f.kind)).map(forForm),
    };
  });

  route(app, getHomeButtons, async () => ({ buttons: await homeButtons(db, deps.buttons) }));

  // ── staff: the builder ────────────────────────────────────────────────
  //
  // TODO(workstream A): every route in this scope needs requireRole('admin')
  // (which the owner satisfies). One hook here covers all of them, e.g.
  //   staff.addHook('preHandler', requireRole('admin'));
  // Until then these routes are open to anybody who can reach the API.
  void app.register((staff, _opts, done) => {
    // TODO(workstream A): requireRole('admin') — listing every logbook, drafts included.
    route(staff, listLogbooksContract, async () => ({ logbooks: await listLogbooks(db) }));

    // TODO(workstream A): requireRole('admin')
    route(staff, listStartingPoints, () => ({ starting_points: startingPoints() }));

    // ONE ROUTE for making a logbook, because it is one act: an operator is
    // making a logbook and has either chosen a question set to begin from or
    // not.
    // TODO(workstream A): requireRole('admin')
    route(staff, createLogbookContract, async ({ request }) => {
      const body = request.body as {
        title: string;
        slug?: string;
        blurb?: string;
        starting_point?: string;
      };
      if (body.starting_point && body.starting_point !== 'none') {
        return createFromStartingPoint(db, { ...body, starting_point: body.starting_point });
      }
      const lb = await createLogbook(db, body);
      return logbookDetail(db, lb.id);
    });

    // Always makes a NEW DRAFT, never launches, never touches an existing
    // logbook, so a file can be as wrong as it likes.
    // TODO(workstream A): requireRole('admin')
    route(staff, createLogbookFromFile, ({ request }) =>
      createFromFile(db, (request.body as { file: unknown }).file),
    );

    // TODO(workstream A): requireRole('admin')
    route(staff, getLogbook, ({ params }) => logbookDetail(db, Number(params.id)));

    // TODO(workstream A): requireRole('admin')
    route(staff, updateLogbook, async ({ params, request }) => {
      const id = Number(params.id);
      await updateDetails(db, id, request.body as { title?: string; blurb?: string | null });
      return logbookDetail(db, id);
    });

    // TODO(workstream A): requireRole('admin')
    route(staff, deleteLogbook, async ({ params }) => ({
      deleted: await deleteDraft(db, Number(params.id)),
    }));

    // TODO(workstream A): requireRole('admin')
    route(staff, addQuestion, ({ params, request }) =>
      addField(db, Number(params.id), request.body as Parameters<typeof addField>[2]),
    );

    // TODO(workstream A): requireRole('admin')
    route(staff, updateQuestion, ({ params, request }) =>
      updateField(
        db,
        Number(params.id),
        Number(params.fieldId),
        request.body as Parameters<typeof updateField>[3],
      ),
    );

    // TODO(workstream A): requireRole('admin')
    route(staff, removeQuestion, async ({ params }) => {
      await removeField(db, Number(params.id), Number(params.fieldId));
      return { ok: true as const };
    });

    // TODO(workstream A): requireRole('admin')
    route(staff, reorderQuestions, async ({ params, request }) => {
      await reorderFields(db, Number(params.id), (request.body as { ids: number[] }).ids);
      return { ok: true as const };
    });

    // LAUNCH: the one-way door.
    // TODO(workstream A): requireRole('admin')
    route(staff, launchLogbook, async ({ params }) => {
      const id = Number(params.id);
      await launch(db, id);
      return logbookDetail(db, id);
    });

    // Closing and reopening touch nothing sealed and are always reversible.
    // TODO(workstream A): requireRole('admin')
    route(staff, setLogbookClosed, async ({ params, request }) => {
      const id = Number(params.id);
      await setClosed(db, id, (request.body as { closed: boolean }).closed);
      return logbookDetail(db, id);
    });

    // TODO(workstream A): requireRole('admin')
    route(staff, setLogbookSchedule, async ({ params, request }) => {
      const id = Number(params.id);
      const body = request.body as { opens_at: string | null; closes_at: string | null };
      await setSchedule(db, id, { opensAt: body.opens_at, closesAt: body.closes_at });
      return logbookDetail(db, id);
    });

    // TODO(workstream A): requireRole('admin')
    route(staff, downloadLogbookFile, async ({ params, reply }) => {
      const file = await toFile(db, Number(params.id));
      if (!file) throw notFound('There is no such logbook.');
      void reply.header(
        'content-disposition',
        `attachment; filename="logbook-${file.slug ?? 'logbook'}.json"`,
      );
      return file;
    });

    // ── staff: the front page's order ───────────────────────────────────
    const adminView = async () => ({
      buttons: await homeButtons(db, deps.buttons),
      stored: await storedOrder(db),
      available: await availableButtons(db, deps.buttons),
    });

    // TODO(workstream A): requireRole('admin')
    route(staff, getHomeButtonsAdmin, adminView);

    // TODO(workstream A): requireRole('admin')
    route(staff, setHomeButtonsContract, async ({ request }) => {
      await setHomeButtons(db, (request.body as { order: unknown }).order, deps.buttons);
      return adminView();
    });

    // TODO(workstream A): requireRole('admin')
    route(staff, clearHomeButtonsContract, async () => {
      await clearHomeButtons(db);
      return adminView();
    });

    done();
  });
}
