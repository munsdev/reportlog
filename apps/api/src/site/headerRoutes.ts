/**
 * The header background and the other look options, over HTTP. Registered
 * after the files context exists (app.ts), because the image goes through
 * the files workstream's storage.
 *
 * OWNER ONLY, guarded once for the whole scope: this is the page every
 * visitor sees first, and one person is answerable for it. The image upload's
 * body is the picture itself, not JSON, read whole: the page scales it to
 * 1600 px before sending, so buffering it is cheaper than streaming it twice.
 */
import {
  HEADER_IMAGE_MAX_BYTES,
  HEADER_IMAGE_ROUTE,
  LookOptions,
  removeHeaderImage as removeHeaderImageRoute,
  setLookOptions,
  uploadHeaderImage,
} from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Files } from '../files/context.ts';
import { sendObject } from '../files/routes.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { roleGuard } from '../identity/guards.ts';
import {
  NO_STORAGE,
  headerKey,
  removeHeaderImage,
  saveHeaderImage,
  saveLookOptions,
  storedHeaderFile,
} from './headerImage.ts';
import { editorState } from './site.ts';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'];

export async function headerRoutes(
  app: FastifyInstance,
  { db, files }: { db: Kysely<DB>; files: Files | string },
): Promise<void> {
  const store = typeof files === 'string' ? null : files;
  const need = (): Files => {
    if (!store) throw new HttpError(503, 'no_storage', NO_STORAGE);
    return store;
  };

  await app.register((scope, _opts, done) => {
    scope.addHook('preHandler', roleGuard(['owner']));
    // Only in this scope: everywhere else a body is JSON. The type here is
    // never trusted; the bytes are sniffed (headerImage.ts).
    scope.addContentTypeParser(
      IMAGE_TYPES,
      { parseAs: 'buffer', bodyLimit: HEADER_IMAGE_MAX_BYTES + 1 },
      (_req, body, next) => {
        next(null, body);
      },
    );
    scope.setErrorHandler((err) => {
      if ((err as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        throw new HttpError(
          413,
          'too_large',
          `That image is too large. It can be at most ${String(HEADER_IMAGE_MAX_BYTES / 1024 / 1024)} MB.`,
        );
      }
      throw err;
    });

    route(scope, setLookOptions, async ({ request }) => {
      await saveLookOptions(db, store, LookOptions.parse(request.body));
      return editorState(db);
    });

    scope.route({
      method: uploadHeaderImage.method,
      url: uploadHeaderImage.path,
      bodyLimit: HEADER_IMAGE_MAX_BYTES + 1,
      handler: async (request) => {
        const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        await saveHeaderImage(need(), body);
        return uploadHeaderImage.response.parse(await editorState(db));
      },
    });

    route(scope, removeHeaderImageRoute, async () => {
      await removeHeaderImage(db, store);
      return editorState(db);
    });
    done();
  });

  // Behind the site password, like the pages it appears on. Only the file
  // currently stored is served: a replaced or removed image stops here at
  // once, even if its object has not been deleted yet.
  app.get(HEADER_IMAGE_ROUTE, async (request, reply) => {
    const { file } = request.params as { file: string };
    const key = headerKey(file);
    if (!key || !store || (await storedHeaderFile(db)) !== file)
      throw notFound('There is no such image.');
    return sendObject(request, reply, {
      files: store,
      bucket: 'renditions',
      key,
      type: file.endsWith('.png') ? 'image/png' : 'image/jpeg',
    });
  });
}
