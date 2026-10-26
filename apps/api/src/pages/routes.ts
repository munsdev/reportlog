/**
 * The fixed pages' blocks (decision 79). The read is public (what a visitor
 * sees: shown, complete blocks only); everything that changes a page is in
 * one scope guarded for administrators, so a route added later cannot forget
 * to ask.
 */
import {
  getPageBlocks,
  getPageEditor,
  publicBlocks,
  setPageBlocks,
  undoPageBlocks,
} from '@reportlog/contracts';
import type { Block } from '@reportlog/contracts';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { Database } from '../db/database.ts';
import { route } from '../http/route.ts';
import { editorState, pageBlocks, savePage, undoPage } from './store.ts';

export function pageRoutes(app: FastifyInstance, db: Database): void {
  route(app, getPageBlocks, async ({ params, reply }) => {
    void reply.header('cache-control', 'no-cache');
    const { blocks, customised } = await pageBlocks(db, params.page);
    return { page: params.page, blocks: publicBlocks(blocks), customised };
  });
}

export async function pageAdminRoutes(
  app: FastifyInstance,
  db: Database,
  { requireAdmin }: { requireAdmin: preHandlerAsyncHookHandler },
): Promise<void> {
  await app.register((scoped, _opts, done) => {
    scoped.addHook('preHandler', requireAdmin);

    route(scoped, getPageEditor, ({ params }) => editorState(db, params.page));

    route(scoped, setPageBlocks, async ({ params, request }) => {
      // Fastify has already checked the body against the contract's schema.
      const { blocks } = request.body as { blocks: Block[] };
      await savePage(db, params.page, blocks, request.user?.id ?? null);
      return editorState(db, params.page);
    });

    route(scoped, undoPageBlocks, async ({ params }) => {
      await undoPage(db, params.page);
      return editorState(db, params.page);
    });

    done();
  });
}
