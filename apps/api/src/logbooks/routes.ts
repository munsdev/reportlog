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
  setLogbookFilesFrozen,
  setLogbookSchedule,
  updateLogbook,
  updateQuestion,
} from '@reportlog/contracts';
import type { Cover, FormQuestion, Question } from '@reportlog/contracts';
import { FILE_TYPE, LOCATION_TYPE, canFilter, placeOptions } from '@reportlog/fields';
import { formText, termsFor } from '@reportlog/seal';
import { questionsFor } from '../chain/questions.ts';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/database.ts';
import { notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { requireUser, roleGuard } from '../identity/guards.ts';
import { resolveCopy } from '../site/copy.ts';
import { readCopy } from '../site/settings.ts';
import {
  availableButtons,
  buttonTargets,
  clearHomeButtons,
  editorRows,
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
  logbookByAddress,
  logbookDetail,
  listLogbooks,
  openLogbooks,
  removeField,
  reorderFields,
  setClosed,
  setFilesFrozen,
  setSchedule,
  updateDetails,
  updateField,
} from './logbooks.ts';
import { createFromStartingPoint, startingPoints } from './templates.ts';

/** The site's call to action as one object (decision 78); a door gets it too. */
function siteCta(copy: ReturnType<typeof resolveCopy>) {
  return {
    help_now: copy.help_now,
    site_cta: {
      heading: copy.cta_heading,
      body: copy.help_now,
      button_label: copy.cta_button_label,
      button_url: copy.cta_button_url,
    },
  };
}

export interface LogbookRouteDeps {
  /** Where list buttons come from. The lists workstream supplies this. */
  buttons?: ButtonSources;
}

/**
 * A question as the reporter's form needs it. `id`, `position` and
 * `filterable` are the builder's business. `help` and `shown_when` are
 * absent, not null, when there is none, as in the form definition.
 */
export function forForm(q: Question): FormQuestion {
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
    // The address may be the short one; the answer carries the real slug.
    const lb = await logbookByAddress(db, params.slug);
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
      asks_email: lb.asks_email,
      // Only where it applies, so a form that asks is told nothing new.
      ...(lb.publish_by_terms ? { publication_terms: termsFor() } : {}),
      fields: fields.map(forForm),
      filters: fields.filter((f) => f.filterable && canFilter(f.kind)).map(forForm),
      // The version these questions are, so a report sent from this page seals
      // the wording its reporter read even if a label is reworded meanwhile.
      form: formText(lb.slug, await questionsFor(db, lb.id)).hash,
      // Shown as written, never through the figures (site/copy.ts, help_now).
      ...siteCta(resolveCopy(await readCopy(db))),
      ...(lb.cover ? { cover: lb.cover } : {}),
    };
  });

  route(app, getHomeButtons, async () => ({ buttons: await homeButtons(db, deps.buttons) }));

  // ── staff: the builder ────────────────────────────────────────────────
  //
  // Administrators only (which includes the owner), checked once for the
  // whole scope, so a route added here later cannot forget to ask.
  void app.register((staff, _opts, done) => {
    staff.addHook('preHandler', roleGuard(['admin']));
    route(staff, listLogbooksContract, async () => ({ logbooks: await listLogbooks(db) }));
    route(staff, listStartingPoints, () => ({ starting_points: startingPoints() }));

    // ONE ROUTE for making a logbook, because it is one act: an operator is
    // making a logbook and has either chosen a question set to begin from or
    // not.
    route(staff, createLogbookContract, async ({ request }) => {
      const body = request.body as {
        title: string;
        slug?: string;
        blurb?: string;
        starting_point?: string;
      };
      if (body.starting_point && body.starting_point !== 'none') {
        return createFromStartingPoint(db, {
          ...body,
          starting_point: body.starting_point,
          by: requireUser(request).email,
        });
      }
      const lb = await createLogbook(db, body);
      return logbookDetail(db, lb.id);
    });

    // Always makes a NEW DRAFT, never launches, never touches an existing
    // logbook, so a file can be as wrong as it likes.
    route(staff, createLogbookFromFile, ({ request }) =>
      createFromFile(db, (request.body as { file: unknown }).file, {
        by: requireUser(request).email,
      }),
    );
    route(staff, getLogbook, ({ params }) => logbookDetail(db, Number(params.id)));
    route(staff, updateLogbook, async ({ params, request }) => {
      const id = Number(params.id);
      await updateDetails(
        db,
        id,
        request.body as {
          title?: string;
          blurb?: string | null;
          email_required?: boolean;
          publish_by_terms?: boolean;
          show_on_front?: boolean;
          short_slug?: string | null;
          cover?: Cover | null;
        },
      );
      return logbookDetail(db, id);
    });
    route(staff, deleteLogbook, async ({ params }) => ({
      deleted: await deleteDraft(db, Number(params.id)),
    }));
    route(staff, addQuestion, ({ params, request }) =>
      addField(db, Number(params.id), request.body as Parameters<typeof addField>[2]),
    );
    route(staff, updateQuestion, ({ params, request }) =>
      updateField(
        db,
        Number(params.id),
        Number(params.fieldId),
        request.body as Parameters<typeof updateField>[3],
      ),
    );
    route(staff, removeQuestion, async ({ params }) => {
      await removeField(db, Number(params.id), Number(params.fieldId));
      return { ok: true as const };
    });
    route(staff, reorderQuestions, async ({ params, request }) => {
      await reorderFields(db, Number(params.id), (request.body as { ids: number[] }).ids);
      return { ok: true as const };
    });

    // LAUNCH: the one-way door.
    route(staff, launchLogbook, async ({ params }) => {
      const id = Number(params.id);
      await launch(db, id);
      return logbookDetail(db, id);
    });

    // Closing and reopening touch nothing sealed and are always reversible.
    route(staff, setLogbookClosed, async ({ params, request }) => {
      const id = Number(params.id);
      await setClosed(db, id, (request.body as { closed: boolean }).closed);
      return logbookDetail(db, id);
    });
    route(staff, setLogbookSchedule, async ({ params, request }) => {
      const id = Number(params.id);
      const body = request.body as { opens_at: string | null; closes_at: string | null };
      await setSchedule(db, id, { opensAt: body.opens_at, closesAt: body.closes_at });
      return logbookDetail(db, id);
    });
    // THE FREEZE: a protective handle on uploads, either way, before or
    // after launch. Not a question, so not behind the one-way door.
    route(staff, setLogbookFilesFrozen, async ({ params, request }) => {
      const id = Number(params.id);
      await setFilesFrozen(db, id, (request.body as { frozen: boolean }).frozen);
      return logbookDetail(db, id);
    });
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
    const adminView = async () => {
      const [stored, targets] = await Promise.all([
        storedOrder(db),
        buttonTargets(db, deps.buttons),
      ]);
      return {
        buttons: await homeButtons(db, deps.buttons),
        stored,
        available: await availableButtons(db, deps.buttons),
        targets,
        rows: editorRows(targets, stored),
      };
    };
    route(staff, getHomeButtonsAdmin, adminView);
    route(staff, setHomeButtonsContract, async ({ request }) => {
      await setHomeButtons(db, (request.body as { order: unknown }).order, deps.buttons);
      return adminView();
    });
    route(staff, clearHomeButtonsContract, async () => {
      await clearHomeButtons(db);
      return adminView();
    });

    done();
  });
}
