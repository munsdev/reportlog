/**
 * The files routes, registered with one call from app.ts.
 *
 *   /api/uploads/...           a reporter attaching files while filing. Part
 *                              of filing: FILING_CALLS lets these through a
 *                              logbook opened outside the site password
 *   /api/files/report/:ref     a public report's files, for the board
 *   /api/files/public/:key     a published copy, checked again at every read
 *   /api/moderate/files/...    moderators: see, publish, withhold, refuse
 *   /api/admin/files/...       administrators: the switch, kinds, limits, erasing
 *
 * Every byte goes through this origin; no browser is ever handed a storage
 * URL (storage.ts says why).
 *
 * With files not configured, every route here answers as if files were
 * switched off: the config says so, and nothing else does anything.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ExpressionBuilder, Kysely } from 'kysely';
import type { Readable } from 'node:stream';
import { PUBLICATION_OFF, publicArchiveAvailable } from '../board/publication.ts';
import type { DB } from '../db/schema.gen.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { requireUser, roleGuard } from '../identity/guards.ts';
import { limiter } from '../identity/limiter.ts';
import { logbookBySlug } from '../logbooks/logbooks.ts';
import { permissionsFor, permissionsForMany } from '../permissions/log.ts';
import { filesOn } from './context.ts';
import type { Files } from './context.ts';
import { decryptStream } from './envelope.ts';
import { TYPES_OF } from './kinds.ts';
import {
  attachmentsEnabled,
  limitLayers,
  limitsFor,
  maxBytesForKind,
  setLogbookLimits,
  setSiteLimits,
  siteLayer,
  validateLimits,
} from './limits.ts';
import type { LimitsInput } from './limits.ts';
import { erase, publicFilesOf, publish, servable, withhold } from './publication.ts';
import {
  createUploadSlot,
  discardSlot,
  draftFrom,
  newDraftToken,
  receiveUpload,
  slotStatuses,
} from './slots.ts';
import type { Owner } from './slots.ts';
import type { Bucket } from './storage.ts';

/** The files of one report version, as a moderator or administrator sees them. */
async function currentFiles(db: Kysely<DB>, reportId: number): Promise<C.ThreadFile[]> {
  const rows = await db
    .selectFrom('report_attachments as ra')
    .innerJoin('attachments as a', 'a.id', 'ra.attachment_id')
    .innerJoin('attachment_heads as fh', 'fh.attachment_id', 'a.id')
    .select([
      'a.id',
      'a.ordinal',
      'a.media_type',
      'a.byte_size',
      'a.sha256',
      'a.received_at',
      'fh.original_name',
      'fh.rendition_media_type',
      'fh.publication',
      'fh.alt_text',
      'fh.dek_destroyed_at',
      'fh.has_poster',
      'fh.page_count',
      'fh.duration_seconds',
    ])
    .where('ra.report_id', '=', reportId)
    .orderBy('a.ordinal')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    ordinal: r.ordinal,
    original_name: r.original_name,
    media_type: r.media_type,
    byte_size: r.byte_size,
    sha256: r.sha256,
    rendition_media_type: r.rendition_media_type,
    publication: r.publication as 'withheld' | 'published' | 'refused',
    alt_text: r.alt_text,
    erased: r.dek_destroyed_at !== null,
    has_poster: r.has_poster,
    pages: r.page_count ?? 1,
    duration_seconds: r.duration_seconds === null ? null : Number(r.duration_seconds),
    received_at: r.received_at.toISOString(),
  }));
}

/** The thread a reference names, whichever version of it the reference is. */
async function threadOfRef(db: Kysely<DB>, ref: string): Promise<string | null> {
  const row = await db
    .selectFrom('reports')
    .select('thread_id')
    .where('public_ref', '=', ref.trim().toUpperCase())
    .executeTakeFirst();
  return row?.thread_id ?? null;
}

/**
 * What a moderator decides on: the decisions a file can carry. A file with
 * none of these on its record is still sitting where it arrived (withheld by
 * default), which is what "waiting" means in the queue. A deliberate
 * withhold is a decision and leaves the queue.
 */
const DECISIONS = ['published', 'withheld', 'refused', 'taken_down', 'erased'];

export interface FileRouteDeps {
  db: Kysely<DB>;
  /** The files context, or why there is none. */
  files: Files | string;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the contract's body type
const bodyOf = <B>(_contract: { body?: unknown }, request: FastifyRequest) => request.body as B;

const off = () => new HttpError(404, 'files_off', 'This site is not taking files at the moment.');

/** What the page needs, for a logbook, or "not taking files". */
export async function uploadConfig(
  files: Files | null,
  logbookId: number | null,
  asksForFiles: boolean,
): Promise<C.UploadConfig> {
  const db = files?.db;
  const on = asksForFiles && (await filesOn(files));
  if (!on || !db) {
    return {
      enabled: false,
      kinds: [],
      accept: [],
      max_files: 0,
      max_total_bytes: 0,
      max_bytes: { photo: 0, video: 0, audio: 0, document: 0 },
      max_video_seconds: 0,
      max_document_pages: 0,
    };
  }
  const l = await limitsFor(db, logbookId);
  return {
    enabled: l.kinds.length > 0,
    kinds: l.kinds,
    accept: l.kinds.flatMap((k) => TYPES_OF[k]),
    max_files: l.maxFiles,
    max_total_bytes: l.maxTotalBytes,
    max_bytes: {
      photo: maxBytesForKind('photo', l),
      video: maxBytesForKind('video', l),
      audio: maxBytesForKind('audio', l),
      document: maxBytesForKind('document', l),
    },
    max_video_seconds: l.maxVideoSeconds,
    max_document_pages: l.maxDocumentPages,
  };
}

/** A logbook a reporter may attach files to right now: open, and asking for them. */
async function filingLogbook(db: Kysely<DB>, slug: unknown) {
  const lb = typeof slug === 'string' && slug ? await logbookBySlug(db, slug.trim()) : null;
  if (lb?.state !== 'open') {
    throw new HttpError(404, 'not_found', 'There is no open logbook at that address.');
  }
  if (!lb.asks_for_files)
    throw new HttpError(400, 'no_files_here', 'This logbook does not take files.');
  return lb;
}

/** Send stored bytes, decrypting on the way if a key is given. A range only from plain objects. */
export async function sendObject(
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    files: Files;
    bucket: Bucket;
    key: string;
    type: string;
    dek?: Buffer;
    download?: string;
  },
): Promise<FastifyReply> {
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
  const wanted =
    range && !input.dek
      ? { start: Number(range[1]), end: range[2] ? Number(range[2]) : Number.MAX_SAFE_INTEGER }
      : undefined;
  const o = await input.files.storage.get(input.bucket, input.key, wanted);
  if (!o) throw notFound('That file is not here.');
  if (o.range && o.range.end < o.range.start) {
    void reply.header('content-range', `bytes */${String(o.total)}`);
    return reply.code(416).send();
  }
  // Never cached anywhere but this browser, and checked again next time: a
  // file taken down must stop being served at once.
  void reply.header('cache-control', 'private, no-cache');
  void reply.header('x-content-type-options', 'nosniff');
  void reply.header(
    'content-security-policy',
    "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
  );
  if (input.download)
    void reply.header('content-disposition', `attachment; filename="${input.download}"`);
  void reply.type(input.type);
  let body: Readable = o.body;
  if (input.dek) {
    body = o.body.pipe(decryptStream(input.dek));
  } else {
    void reply.header('accept-ranges', 'bytes');
    void reply.header('content-length', String(o.size));
    if (o.range) {
      void reply.code(206);
      void reply.header(
        'content-range',
        `bytes ${String(o.range.start)}-${String(o.range.end)}/${String(o.total)}`,
      );
    }
  }
  return reply.send(body);
}

/** A raw-body route. Its bytes are a stream, never parsed or buffered. */
function rawPut(
  app: FastifyInstance,
  url: string,
  handler: (request: FastifyRequest, body: Readable) => Promise<{ status: string }>,
) {
  app.route({
    method: 'PUT',
    url,
    handler: async (request) => handler(request, request.body as Readable),
  });
}

export async function fileRoutes(app: FastifyInstance, deps: FileRouteDeps): Promise<void> {
  const { db } = deps;
  const files = typeof deps.files === 'string' ? null : deps.files;
  const whyNot = typeof deps.files === 'string' ? deps.files : null;
  if (whyNot) app.log.warn(`files are not taken: ${whyNot}`);
  const need = (): Files => {
    if (!files) throw off();
    return files;
  };
  const needOn = async (): Promise<Files> => {
    const f = need();
    if (!(await filesOn(f))) throw off();
    return f;
  };

  // Anybody can stage bytes with a free draft, so the limits here only blunt
  // the volume; the per-address quota in slots.ts is the real control.
  const draftsPerClient = limiter({ max: 30, windowMs: 15 * 60 * 1000 });
  const slotsPerClient = limiter({ max: 120, windowMs: 15 * 60 * 1000 });
  const draftOf = (r: FastifyRequest): Owner => ({ draft: draftFrom(r.headers[C.DRAFT_HEADER]) });

  // ── filing: attaching files ───────────────────────────────────────────
  route(app, C.getUploadConfig, async ({ query }) => {
    const lb = await logbookBySlug(db, query.logbook.trim());
    if (!lb || lb.state === 'draft') throw notFound('There is no logbook at that address.');
    return uploadConfig(files, lb.id, lb.state === 'open' && lb.asks_for_files);
  });

  route(app, C.newUploadDraft, async ({ request }) => {
    await needOn();
    draftsPerClient.take(request.ip);
    return { draft_token: newDraftToken() };
  });

  route(app, C.createUpload, async ({ request }) => {
    const f = await needOn();
    slotsPerClient.take(request.ip);
    const b = bodyOf<C.BodyOf<typeof C.createUpload>>(C.createUpload, request);
    const lb = await filingLogbook(db, b.logbook);
    return createUploadSlot(
      f,
      { draft: draftFrom(b.draft_token) },
      {
        name: b.name ?? '',
        type: b.type ?? '',
        size: typeof b.size === 'number' ? b.size : NaN,
        logbookId: lb.id,
        email: b.email ?? null,
      },
    );
  });

  route(app, C.getUploadStatus, async ({ request }) => ({
    files: (await slotStatuses(db, draftOf(request))).map((s) => ({
      slot_token: s.slot_token,
      name: s.declared_name,
      size: s.declared_size,
      status: s.status,
      detail: s.status_detail,
    })),
  }));

  route(app, C.removeUpload, async ({ params, request }) => {
    const f = need();
    slotsPerClient.take(request.ip);
    if (!(await discardSlot(db, draftOf(request), params.slot)))
      throw notFound('There is no such file on this report.');
    const { drainDeletions } = await import('./worker.ts');
    await drainDeletions(f).catch(() => undefined);
    return { ok: true as const };
  });

  // The bytes. In their own scope, whose parser hands the body over unread.
  await app.register((scope) => {
    scope.addContentTypeParser('*', (_req, payload, done) => {
      done(null, payload);
    });
    rawPut(scope, '/api/uploads/:slot', async (request, body) => {
      const f = await needOn();
      slotsPerClient.take(request.ip);
      return receiveUpload(f, draftOf(request), (request.params as { slot: string }).slot, body);
    });
    return Promise.resolve();
  });

  // ── public: a report's published files ────────────────────────────────
  route(app, C.getReportFiles, async ({ params }) => {
    // Said in the same words as every other public read when the archive is off.
    if (!(await publicArchiveAvailable(db))) throw notFound(PUBLICATION_OFF.reason);
    const out = await publicFilesOf(db, params.ref);
    if (!out) throw notFound('There is no public report with that reference.');
    return out;
  });

  const servePublic = async (
    request: FastifyRequest,
    reply: FastifyReply,
    suffix: (fh: { has_poster: boolean; page_count: number | null }) => string | null,
  ) => {
    const f = need();
    const key = (request.params as { key: string }).key;
    if (!/^[a-f0-9]{32}$/.test(key)) throw notFound('That file is not here.');
    const fh = await servable(db, `rendition/${key}`);
    if (!fh) throw notFound('That file is not here.');
    const s = suffix(fh);
    if (s === null) throw notFound('That file is not here.');
    const type = s ? 'image/jpeg' : fh.rendition_media_type;
    return sendObject(request, reply, {
      files: f,
      bucket: 'renditions',
      key: `rendition/${key}${s}`,
      type,
    });
  };
  app.get('/api/files/public/:key', (request, reply) => servePublic(request, reply, () => ''));
  app.get('/api/files/public/:key/poster', (request, reply) =>
    servePublic(request, reply, (fh) => (fh.has_poster ? '.poster' : null)),
  );
  app.get('/api/files/public/:key/page/:n', (request, reply) => {
    const n = Number((request.params as { n: string }).n);
    return servePublic(request, reply, (fh) =>
      Number.isInteger(n) && n >= 1 && n <= (fh.page_count ?? 1)
        ? n === 1
          ? ''
          : `.page${String(n)}`
        : null,
    );
  });

  // ── moderators ────────────────────────────────────────────────────────
  await app.register((scope) => {
    scope.addHook('preHandler', roleGuard(['moderator']));

    // The queue, or one report by its reference. The reference may be any
    // version's; what is shown is always the current version, because that is
    // the version whose files are decided on.
    route(scope, C.listFileReports, async ({ query }) => {
      const ref = query.ref?.trim() ?? '';
      const thread = ref ? await threadOfRef(db, ref) : null;
      if (ref && !thread) return { reports: [] };
      const count = (
        eb: ExpressionBuilder<DB & { r: DB['reports'] }, 'r'>,
        only: 'all' | 'published' | 'undecided',
      ) => {
        let q = eb
          .selectFrom('report_attachments as ra')
          .innerJoin('attachment_heads as fh', 'fh.attachment_id', 'ra.attachment_id')
          .whereRef('ra.report_id', '=', 'r.id');
        if (only === 'published') q = q.where('fh.publication', '=', 'published');
        if (only === 'undecided') {
          q = q
            .where('fh.publication', '=', 'withheld')
            .where('fh.dek_destroyed_at', 'is', null)
            .where((w) =>
              w.not(
                w.exists(
                  w
                    .selectFrom('attachment_events as e')
                    .select('e.id')
                    .whereRef('e.attachment_id', '=', 'ra.attachment_id')
                    .where('e.action', 'in', DECISIONS),
                ),
              ),
            );
        }
        return q.select((x) => x.fn.countAll<string>().as('n'));
      };
      let q = db
        .selectFrom('report_heads as h')
        .innerJoin('reports as r', 'r.id', 'h.current_report_id')
        .innerJoin('logbooks as l', 'l.id', 'r.logbook_id')
        .select((eb) => [
          'h.thread_id',
          'h.withdrawn',
          'r.public_ref',
          'r.received_at',
          'r.may_publish',
          'l.title',
          count(eb, 'all').as('files'),
          count(eb, 'published').as('published'),
          count(eb, 'undecided').as('undecided'),
        ]);
      q = thread
        ? q.where('h.thread_id', '=', thread)
        : q
            .where('h.withdrawn', '=', false)
            .where((eb) => eb(count(eb, 'undecided'), '>', '0'))
            .orderBy('r.received_at')
            .limit(200);
      const rows = await q.execute();
      const permits = await permissionsForMany(
        db,
        rows.map((r) => r.thread_id),
      );
      return {
        reports: rows.map((r) => ({
          thread_id: r.thread_id,
          public_ref: r.public_ref,
          logbook_title: r.title,
          received_at: r.received_at.toISOString(),
          files: Number(r.files),
          undecided: Number(r.undecided),
          published: Number(r.published),
          may_publish: r.may_publish,
          files_permitted: permits.get(r.thread_id)?.attachment_publication ?? false,
          withdrawn: r.withdrawn,
        })),
      };
    });

    route(scope, C.getThreadFiles, async ({ params }) => {
      const head = await db
        .selectFrom('report_heads as h')
        .innerJoin('reports as r', 'r.id', 'h.current_report_id')
        .select(['r.id', 'r.may_publish', 'h.withdrawn'])
        .where('h.thread_id', '=', params.threadId)
        .executeTakeFirst();
      if (!head) throw notFound('There is no such report.');
      const files = await currentFiles(db, head.id);
      const events = await db
        .selectFrom('attachment_events')
        .select(['attachment_id', 'action', 'actor', 'actor_email', 'reason', 'created_at'])
        .where('thread_id', '=', params.threadId)
        .orderBy('id', 'desc')
        .execute();
      return {
        may_publish: head.may_publish,
        withdrawn: head.withdrawn,
        files_permitted: (await permissionsFor(db, params.threadId)).attachment_publication,
        files,
        events: events.map((e) => ({ ...e, at: e.created_at.toISOString() })),
      };
    });

    route(scope, C.setFilePublication, async ({ params, request }) => {
      const f = need();
      const b = bodyOf<C.BodyOf<typeof C.setFilePublication>>(C.setFilePublication, request);
      const by = requireUser(request).email;
      if (b.publication === 'published') {
        await publish(f, {
          attachmentId: Number(params.id),
          altText: b.alt_text ?? '',
          reason: b.reason ?? '',
          by,
        });
      } else {
        await withhold(f, {
          attachmentId: Number(params.id),
          to: b.publication,
          reason: b.reason ?? '',
          by,
        });
      }
      return { ok: true as const };
    });

    // Seeing a file. The re-encoded copy is what a moderator decides on; the
    // original (with whatever location it carried) is evidence, opened only
    // with a reason, and every opening is on the file's record.
    const view = async (
      request: FastifyRequest,
      reply: FastifyReply,
      what: 'rendition' | 'poster' | 'original' | number,
    ) => {
      const f = need();
      const id = Number((request.params as { id: string }).id);
      const row = await db
        .selectFrom('attachment_heads as fh')
        .innerJoin('attachments as a', 'a.id', 'fh.attachment_id')
        .select([
          'a.storage_key',
          'a.media_type',
          'fh.rendition_media_type',
          'fh.dek_wrapped',
          'fh.thread_id',
          'fh.page_count',
          'fh.has_poster',
        ])
        .where('fh.attachment_id', '=', Number.isInteger(id) ? id : -1)
        .executeTakeFirst();
      if (!row) throw notFound('There is no such file.');
      if (!row.dek_wrapped) throw new HttpError(410, 'erased', 'This file has been erased.');
      let key = row.storage_key;
      let type = row.media_type;
      if (what === 'original') {
        const reason = (request.query as { reason?: string }).reason?.trim() ?? '';
        if (!reason)
          throw new HttpError(
            400,
            'no_reason',
            'Say why you are opening the original, for the record.',
          );
        await db
          .insertInto('attachment_events')
          .values({
            attachment_id: id,
            thread_id: row.thread_id,
            action: 'viewed_original',
            actor: 'moderator',
            actor_email: requireUser(request).email,
            reason: reason.slice(0, 2000),
          })
          .execute();
      } else if (what === 'rendition' || what === 1) {
        key = `${row.storage_key}.rendition`;
        type = row.rendition_media_type;
      } else if (what === 'poster') {
        if (!row.has_poster) throw notFound('This file has no still.');
        key = `${row.storage_key}.poster`;
        type = 'image/jpeg';
      } else {
        if (what < 1 || what > (row.page_count ?? 1)) throw notFound('There is no such page.');
        key = `${row.storage_key}.page${String(what)}`;
        type = 'image/jpeg';
      }
      return sendObject(request, reply, {
        files: f,
        bucket: 'evidence',
        key,
        type,
        dek: f.ring.unwrap(row.dek_wrapped),
        ...(what === 'original' ? { download: `original-${String(id)}` } : {}),
      });
    };
    scope.get('/api/moderate/files/file/:id/rendition', (q, r) => view(q, r, 'rendition'));
    scope.get('/api/moderate/files/file/:id/poster', (q, r) => view(q, r, 'poster'));
    scope.get('/api/moderate/files/file/:id/original', (q, r) => view(q, r, 'original'));
    scope.get('/api/moderate/files/file/:id/page/:n', (q, r) =>
      view(q, r, Number((q.params as { n: string }).n) || 0),
    );
    return Promise.resolve();
  });

  // ── administrators ────────────────────────────────────────────────────
  await app.register((scope) => {
    scope.addHook('preHandler', roleGuard(['admin']));

    const settings = async (): Promise<C.FileSettings> => {
      const site = await siteLayer(db);
      return {
        configured: Boolean(files),
        why_not: whyNot,
        enabled_stored: site.enabled,
        enabled: files
          ? attachmentsEnabled(site.enabled, { configured: true, envDefault: files.envDefault })
          : false,
        limits: await limitLayers(db, null),
      };
    };
    const parsed = (b: LimitsInput) => {
      const v = validateLimits(b);
      if (!v.ok) throw new HttpError(400, v.reason, v.message);
      return v.values;
    };

    route(scope, C.getFileSettings, settings);
    route(scope, C.setFileSettings, async ({ request }) => {
      const b = bodyOf<C.BodyOf<typeof C.setFileSettings>>(C.setFileSettings, request);
      const values = parsed(b);
      await setSiteLimits(
        db,
        { ...values, ...('enabled' in b ? { enabled: b.enabled ?? null } : {}) },
        requireUser(request).email,
      );
      return settings();
    });

    const logbook = async (id: number) => {
      const lb = await db
        .selectFrom('logbooks')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!lb) throw notFound('There is no such logbook.');
      return lb.id;
    };
    route(scope, C.getLogbookFileLimits, async ({ params }) =>
      limitLayers(db, await logbook(Number(params.id))),
    );
    route(scope, C.setLogbookFileLimits, async ({ params, request }) => {
      const id = await logbook(Number(params.id));
      await setLogbookLimits(db, id, parsed(bodyOf<LimitsInput>(C.setLogbookFileLimits, request)));
      return limitLayers(db, id);
    });

    // An administrator erasing a file has to see which one. Not the
    // moderator's view: no copy of the file is served here, only what
    // identifies it.
    route(scope, C.getReportFilesForErasing, async ({ params }) => {
      const thread = await threadOfRef(db, params.ref);
      const head = thread
        ? await db
            .selectFrom('report_heads as h')
            .innerJoin('reports as r', 'r.id', 'h.current_report_id')
            .select(['r.id', 'r.public_ref'])
            .where('h.thread_id', '=', thread)
            .executeTakeFirst()
        : undefined;
      if (!thread || !head) throw notFound('There is no report with that reference.');
      return {
        thread_id: thread,
        public_ref: head.public_ref,
        files: await currentFiles(db, head.id),
      };
    });

    route(scope, C.eraseFile, async ({ params, request }) => {
      const b = bodyOf<C.BodyOf<typeof C.eraseFile>>(C.eraseFile, request);
      await erase(need(), {
        attachmentId: Number(params.id),
        reason: b.reason ?? '',
        by: requireUser(request).email,
      });
      return { ok: true as const };
    });
    return Promise.resolve();
  });
}
