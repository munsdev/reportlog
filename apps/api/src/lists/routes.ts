/**
 * Lists over HTTP: the form a visitor fills in, the screens an administrator
 * edits, the queue a moderator approves in bulk, and the pages an emailed link
 * lands on.
 *
 * FOUR AUDIENCES, FOUR SCOPES, and the split is the security model:
 *
 *   /api/lists/…        a visitor. Each list decides the site password for
 *                       itself (`pastCurtain`), marked `decides-itself`, which
 *                       the gate allows under this prefix only.
 *   /api/admin/lists    administrators, guarded once for the whole scope.
 *   /api/list-review    moderators and administrators, likewise.
 *   /api/forget, /api/list-mail
 *                       pages an email links to: in front of the password,
 *                       plain HTML, and A GET NEVER CHANGES ANYTHING.
 *
 * NOTHING HERE PUBLISHES WHAT SOMEBODY WROTE. The only public read of entries
 * is a count, over questions an operator ticked, on a list that is listed and
 * whose counts an operator published.
 *
 * AN ENTRY IS NOT A REPORT, and nothing reachable from here seals, chains or
 * verifies anything (the boundary check).
 */
import { roleSatisfies } from '@reportlog/access';
import {
  createList,
  deleteList,
  getList,
  getListCounts,
  getListForm,
  getReviewBatch,
  listLists,
  listOpenLists,
  listReviewQueues,
  replaceListQuestions,
  reviewListEntries,
  searchListEntries,
  sendListEntry,
  triageListEntries,
  updateList,
  NOT_A_SAMPLE,
} from '@reportlog/contracts';
import type { BodyOf, ListForm } from '@reportlog/contracts';
import {
  LOCATION_TYPE,
  depthOf,
  isCodedOption,
  limitsOf,
  optionArray,
  optionLabel,
  placeOptions,
} from '@reportlog/fields';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Mailer } from '../email/mailer.ts';
import { notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { roleGuard } from '../identity/guards.ts';
import { moderatorGuard } from '../moderation/agreement.ts';
import { refuseWhilePaused } from '../moderation/switches.ts';
import { limiter } from '../identity/limiter.ts';
import { hasSiteAccess, locked } from '../identity/siteAccess.ts';
import { summaryFor } from './aggregates.ts';
import { fileEntry } from './entries.ts';
import { redeemErasureToken, TOKEN_PATTERN } from './erasure.ts';
import { collectionRequirements, optionsOf } from './fields.ts';
import { linkTypesOf } from './policy.ts';
import {
  allLists,
  createFromTemplate,
  deleteUnused,
  describe,
  listKinds,
  openListedLists,
  replaceFields,
  requireList,
  reviewQueues,
  templateChoices,
  updateSettings,
} from './manage.ts';
import {
  CONFIRM_DAYS,
  confirmRecipient,
  entryMail,
  nameRecipient,
  recipientFor,
} from './notify.ts';
import {
  brokenLink,
  eraseDone,
  eraseFinished,
  erasePrompt,
  mailDone,
  mailFinished,
  mailPrompt,
  sendPage,
} from './pages.ts';
import type { ReviewState } from './policy.ts';
import { NEVER } from './retention.ts';
import type { ListSettings } from './retention.ts';
import { reviewBatch, reviewEntries, setTriageState } from './review.ts';
import { searchEntries } from './search.ts';
import { iso, isAccepting, listBySlug } from './rows.ts';
import type { Db, LoadedList } from './rows.ts';
import type { LinkKeys } from '../links/keys.ts';
import type { Door } from '../door/index.ts';

export interface ListRouteDeps {
  db: Db;
  mailer: Mailer;
  /** Where the website is, for the links in emails. */
  siteOrigin: string;
  settings: ListSettings;
  /** The link keys (links/keys.ts); null without CONTACT_KEY. */
  keys?: (() => Promise<LinkKeys>) | null;
  /** The checks every entry passes before it is read (door/). */
  door: Door;
}

/** The mark that lets a list route decide the site password for itself. */
const DECIDES_ITSELF = { config: { curtain: 'decides-itself' as const } };

const days = (s: ListSettings) => (s.personalDays === NEVER ? null : s.personalDays);

/**
 * WHO MAY SEE A LIST AT ALL.
 *
 *   hidden    administrators only, as a preview of the form.
 *   password  anybody signed in ("team only").
 *   listed    anybody who can reach the site.
 *
 * A LIST SOMEBODY MAY NOT SEE ANSWERS 404, NEVER 403: a 403 confirms the thing
 * exists, and a hidden list's address is build state.
 */
export function maySee(list: Pick<LoadedList, 'visibility'>, request: FastifyRequest): boolean {
  if (list.visibility === 'listed') return true;
  if (list.visibility === 'password') return Boolean(request.user);
  return Boolean(request.user && roleSatisfies(request.user.role, 'admin'));
}

/**
 * THE SITE PASSWORD, decided per list. A list an administrator opened outside
 * (`link` or `door`, and listed, which the table insists on) can be used by
 * somebody without the password: the situation of everybody a contact form is
 * for. EVERY OTHER LIST ANSWERS EXACTLY WHAT THE GATE WOULD, locked, so a
 * closed list's address tells a stranger nothing the gate would not.
 */
async function pastCurtain(db: Db, request: FastifyRequest, list: LoadedList | null) {
  if (await hasSiteAccess(db, request)) return;
  if (list && list.outside_access !== 'closed' && list.visibility === 'listed') return;
  throw locked();
}

/** What a visitor's form needs, and nothing of the operator's. */
export function forForm(list: LoadedList, settings: ListSettings, now = new Date()): ListForm {
  const req = collectionRequirements(list.fields);
  const asked = list.fields.filter((f) => f.retention !== 'absent');
  const requiredPersonal = asked.some((f) => f.required && req.personalKeys.includes(f.key));
  return {
    slug: list.slug,
    title: list.title,
    blurb: list.blurb,
    accepting: isAccepting(list, now),
    opens_at: iso(list.opens_at),
    closes_at: iso(list.closes_at),
    // Derived, never stored: whether the form shows an address card at all.
    // Whether a given submission must fill it in is decided from what arrives.
    asks_email: req.requiresEmail || list.email_mode === 'required',
    // So the form says the TRUE reason, not one reason for every form.
    email_when:
      list.email_mode === 'required' || requiredPersonal
        ? 'always'
        : req.requiresEmail
          ? 'if-written'
          : 'never',
    email_reason: list.email_mode === 'required' ? 'reply' : 'erase',
    personal_keys: req.personalKeys,
    personal_days: days(settings),
    fields: asked.map((f) => {
      const places = f.kind === LOCATION_TYPE ? placeOptions(f.settings) : null;
      return {
        key: f.key,
        kind: f.kind,
        label: f.label,
        help: f.help,
        required: f.required,
        max_values: f.max_values,
        options: optionsOf(f),
        ...(optionArray(f.settings.options).some(isCodedOption)
          ? { option_labels: optionArray(f.settings.options).map(optionLabel) }
          : {}),
        ...(linkTypesOf(f).length
          ? {
              link_types: (f.settings.link_types ?? []).map((t) => ({
                code: t.code,
                label: t.label,
              })),
            }
          : {}),
        ...(f.settings.fixed_rows === true ? { fixed_rows: true } : {}),
        // The question's limits (E4), only when it has them.
        ...limitsOf(f.kind, f.settings),
        allow_other: f.settings.allowOther === true,
        ...(places ? { places: [...places.subdivisions, ...places.countries] } : {}),
        // The county picker's own list is bundled in the page (@reportlog/fields).
        ...(places && depthOf(f.settings) === 'county' ? { depth: 'county' as const } : {}),
        erased: f.retention === 'transient',
      };
    }),
  };
}

export function listRoutes(app: FastifyInstance, deps: ListRouteDeps): void {
  const { db, mailer, siteOrigin, settings, keys = null, door } = deps;
  const send = async (to: string, subject: string, text: string): Promise<boolean> => {
    try {
      await mailer.send({ to, subject, text });
      return true;
    } catch (err) {
      // Logged without the address or the message: those are somebody's.
      app.log.error({ err }, 'a list email was not sent');
      return false;
    }
  };

  // ── a visitor ────────────────────────────────────────────────────────
  //
  // Writing costs an email at most and a row at least. Generous enough for an
  // office behind one address, low enough that a script cannot bury the queue
  // before a moderator notices (and the review page's clusters show it anyway).
  const filing = limiter({ max: 40, windowMs: 60 * 60 * 1000 });

  // Behind the password like everything else: the front page reads it.
  route(app, listOpenLists, async () => ({
    lists: (await openListedLists(db)).map((l) => ({
      slug: l.slug,
      title: l.title,
      blurb: l.blurb,
    })),
  }));

  route(
    app,
    getListForm,
    async ({ params, request }) => {
      const list = await listBySlug(db, params.slug);
      await pastCurtain(db, request, list);
      if (!list || !maySee(list, request)) throw notFound('There is no form at this address.');
      return forForm(list, settings);
    },
    DECIDES_ITSELF,
  );

  // THE PUBLIC COUNTS. Every condition at the boundary: listed, published by
  // an administrator, and only the questions they ticked. Received and
  // approved, always both.
  route(
    app,
    getListCounts,
    async ({ params, request }) => {
      const list = await listBySlug(db, params.slug);
      await pastCurtain(db, request, list);
      if (list?.visibility !== 'listed' || !list.aggregates_published) {
        throw notFound('There are no published counts for that list.');
      }
      const s = await summaryFor(db, list);
      if (!s) throw notFound('There are no published counts for that list.');
      return {
        slug: s.slug,
        title: s.title,
        totals: {
          received: s.totals.received,
          approved: s.totals.approved,
          last_entry: s.totals.last_entry,
        },
        definition: s.definition,
        fields: s.fields,
        not_a_sample: NOT_A_SAMPLE,
      };
    },
    DECIDES_ITSELF,
  );

  route(
    app,
    sendListEntry,
    async ({ params, request }) => {
      const list = await listBySlug(db, params.slug);
      await pastCurtain(db, request, list);
      if (!list || !maySee(list, request)) throw notFound('There is no form at this address.');
      // Plan E: a moderator's pause stops new entries (moderation/switches.ts).
      await refuseWhilePaused(db);
      const b = request.body as BodyOf<typeof sendListEntry>;
      // THE DOOR FIRST (door/): the hidden box, the time on the form, the
      // puzzle and the per-address limits. A refusal is one plain sentence
      // that never names the check, and nothing of the entry is stored.
      await door.pass(request, b);
      filing.take(request.ip);

      const got = await fileEntry(
        db,
        list.slug,
        {
          answers: b.answers ?? {},
          email: b.email ?? null,
          emailConsent: b.email_consent === true,
        },
        { settings, keys: keys ? await keys() : null },
      );

      // THE ERASURE LINK, mailed now and only now: the token exists in
      // plaintext for the length of this request and nowhere else. A failed
      // send does not undo the entry; it is said, so the person knows.
      let mailed = false;
      if (got.erasureToken && got.email) {
        const kept = days(settings);
        mailed = await send(
          got.email,
          `What you sent to ${list.title}`,
          `Thank you. What you sent to "${list.title}" arrived.\n\n` +
            'If you want what you wrote and your email address deleted, open this link and press the button. ' +
            'What you wrote, any links you sent and your address all go.\n\n' +
            `${siteOrigin}/api/forget/${got.erasureToken}\n\n` +
            (kept === null
              ? 'Nothing is deleted on its own, so this link is the way to do it.\n\n'
              : `If you do nothing, they are deleted on their own after ${String(kept)} days.\n\n`) +
            'Nothing you send to this form is published. Keep this email if you might want to use the link.',
        );
      }

      // THE NEW-ENTRY EMAIL, where the list asks for one: to the confirmed
      // address or the admin address, never to one still pending.
      const to = recipientFor(list, settings.adminEmail);
      if (to) {
        const m = entryMail(list, {
          answers: got.answers,
          erasable: got.erasable,
          email: got.email,
          emailConsent: b.email_consent === true,
        });
        await send(to, m.subject, m.text);
      }

      return { ok: true as const, erasure_mailed: mailed, erasable: Boolean(got.erasureToken) };
    },
    DECIDES_ITSELF,
  );

  // ── administrators ───────────────────────────────────────────────────

  const adminDetail = async (list: LoadedList, confirmSent: boolean | null = null) => {
    const s = await summaryFor(db, list);
    return {
      ...describe(list),
      admin_email: settings.adminEmail,
      summary: {
        totals: s?.totals ?? { received: 0, approved: 0, rejected: 0, last_entry: null },
        definition: s?.definition ?? [],
        fields: s?.fields ?? [],
      },
      confirm_sent: confirmSent,
    };
  };

  void app.register((staff, _opts, done) => {
    staff.addHook('preHandler', roleGuard(['admin']));

    route(staff, listLists, async () => ({
      lists: await allLists(db),
      templates: templateChoices(),
      kinds: listKinds(),
      personal_days: days(settings),
    }));

    route(staff, createList, async ({ request }) => {
      const b = request.body as BodyOf<typeof createList>;
      return describe(await createFromTemplate(db, b.template, { slug: b.slug, title: b.title }));
    });

    route(staff, getList, async ({ params }) =>
      adminDetail(await requireList(db, Number(params.id))),
    );

    route(staff, updateList, async ({ params, request }) => {
      const b = request.body as BodyOf<typeof updateList>;
      let list = await updateSettings(db, Number(params.id), b);
      let confirmSent: boolean | null = null;
      // NAMING WHO GETS THE EMAILS. The admin address applies at once; any
      // other is sent a link and receives nothing until it is used.
      if (b.notify_email !== undefined) {
        const named = await nameRecipient(db, list.id, b.notify_email, {
          adminEmail: settings.adminEmail,
        });
        if (named.token && named.email) {
          confirmSent = await send(
            named.email,
            `Receive new entries from "${list.title}"?`,
            `An administrator of this site asked for each new entry on "${list.title}" to be emailed to this address.\n\n` +
              'Nothing is sent to you unless you agree. To agree, open this link and press the button:\n\n' +
              `${siteOrigin}/api/list-mail/${named.token}\n\n` +
              `If you were not expecting this, ignore it. The link stops working in ${String(CONFIRM_DAYS)} days.`,
          );
        }
        list = await requireList(db, list.id);
      }
      return adminDetail(list, confirmSent);
    });

    route(staff, replaceListQuestions, async ({ params, request }) => {
      const b = request.body as BodyOf<typeof replaceListQuestions>;
      return describe(await replaceFields(db, Number(params.id), b.fields));
    });

    route(staff, deleteList, async ({ params }) => deleteUnused(db, Number(params.id)));

    // A subject access request: every list, the personal half. Administrators
    // only, which this scope already insists on.
    route(staff, searchListEntries, async ({ request }) =>
      searchEntries(db, (request.body as BodyOf<typeof searchListEntries>).q, {
        keys: keys ? await keys() : null,
      }),
    );
    done();
  });

  // ── moderators: review, in bulk ──────────────────────────────────────

  void app.register((mods, _opts, done) => {
    mods.addHook('preHandler', moderatorGuard(db));

    route(mods, listReviewQueues, async () => ({ queues: await reviewQueues(db) }));

    // A page of one list's entries. Shown to a moderator, who has to read the
    // erasable half to do their job; still swept on schedule, never published.
    route(mods, getReviewBatch, async ({ params, query }) => {
      const list = await requireList(db, Number(params.id));
      const state: ReviewState = query.state ?? 'received';
      const batch = await reviewBatch(db, list.id, {
        state,
        limit: Number(query.limit ?? 100),
        knownHosts: settings.knownHosts,
        keys: keys ? await keys() : null,
      });
      return {
        list: { id: list.id, slug: list.slug, title: list.title },
        fields: list.fields.map((f) => ({
          key: f.key,
          label: f.label,
          kind: f.kind,
          retention: f.retention,
        })),
        state,
        ...batch,
      };
    });

    route(mods, reviewListEntries, async ({ params, request }) => {
      const list = await requireList(db, Number(params.id));
      const b = request.body as BodyOf<typeof reviewListEntries>;
      return reviewEntries(db, list.id, b.ids, { state: b.state, by: request.user?.id ?? null });
    });

    route(mods, triageListEntries, async ({ params, request }) => {
      const list = await requireList(db, Number(params.id));
      const b = request.body as BodyOf<typeof triageListEntries>;
      return setTriageState(db, list.id, b.ids, b.state);
    });
    done();
  });

  // ── the pages an email links to ──────────────────────────────────────

  void app.register((pages, _opts, done) => {
    // The button posts an empty HTML form. Accepted here and only here; the
    // token in the address is all a POST carries.
    pages.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req, _body, next) => {
        next(null, {});
      },
    );
    const tries = limiter({ max: 30, windowMs: 60 * 60 * 1000 });
    const token = (request: FastifyRequest) => (request.params as { token?: string }).token ?? '';

    // IN FRONT OF THE SITE PASSWORD. Asking for your own words to be deleted
    // is a right, and a password prompt in front of it is a refusal by another
    // name. A GET SHOWS A BUTTON AND ERASES NOTHING.
    pages.get('/api/forget/:token', DECIDES_ITSELF, (request, reply) => {
      tries.take(request.ip);
      const t = token(request);
      if (!TOKEN_PATTERN.test(t)) return sendPage(reply, 404, brokenLink());
      return sendPage(reply, 200, erasePrompt(t));
    });

    pages.post('/api/forget/:token', DECIDES_ITSELF, async (request, reply) => {
      tries.take(request.ip);
      const got = await redeemErasureToken(db, token(request));
      return got.ok ? sendPage(reply, 200, eraseDone()) : sendPage(reply, 404, eraseFinished());
    });

    // The address being named may belong to somebody who has never had the
    // site password. A GET CHANGES NOTHING: a scanner must not agree for them.
    pages.get('/api/list-mail/:token', DECIDES_ITSELF, (request, reply) => {
      tries.take(request.ip);
      const t = token(request);
      if (!TOKEN_PATTERN.test(t)) return sendPage(reply, 404, brokenLink());
      return sendPage(reply, 200, mailPrompt(t));
    });

    pages.post('/api/list-mail/:token', DECIDES_ITSELF, async (request, reply) => {
      tries.take(request.ip);
      const got = await confirmRecipient(db, token(request));
      return got.ok
        ? sendPage(reply, 200, mailDone(got.title, got.email))
        : sendPage(reply, 404, mailFinished());
    });
    done();
  });
}
