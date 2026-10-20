/**
 * The link check, for the owner, administrators and moderators (K7).
 *
 * GUARDED PER SCOPE, so a route added here later cannot forget to ask.
 * Journalists do not exist yet; their desk (Plan D session 5) reads
 * `checkedLinks` in reads.ts and nothing else.
 *
 * Without CONTACT_KEY there are no links to read and none can be stored, so
 * every route here answers 503 with a sentence saying why.
 */
import {
  addToBlocklist,
  checkLinkGroup,
  commentLinkGroup,
  getBlocklist,
  getLinkGroupHistory,
  listLinkGroups,
  removeFromBlocklist,
} from '@reportlog/contracts';
import type { BodyOf } from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { requireUser, roleGuard } from '../identity/guards.ts';
import {
  addBlock,
  blocklist,
  isReasonCategory,
  isUnblockReason,
  removeBlock,
  targetFromText,
} from './blocklist.ts';
import { checkGroup, commentGroup } from './checks.ts';
import type { LinkKeys } from './keys.ts';
import { groupHistory, groupsForCheck } from './reads.ts';
import { LinkRefusal } from './refusals.ts';
import { isOutcome } from './rows.ts';

export interface LinkRouteDeps {
  db: Kysely<DB>;
  keys: (() => Promise<LinkKeys>) | null;
}

const actor = (request: FastifyRequest) => requireUser(request).email;

export function linkRoutes(app: FastifyInstance, { db, keys }: LinkRouteDeps): void {
  const need = async () => {
    if (!keys) {
      throw new HttpError(
        503,
        'no_contact_key',
        'This site has no CONTACT_KEY yet, so it keeps no links. Tell whoever runs the server.',
      );
    }
    return keys();
  };

  void app.register((mods, _opts, done) => {
    mods.addHook('preHandler', roleGuard(['moderator', 'admin']));

    route(mods, listLinkGroups, async ({ query }) => {
      const filter = query.filter ?? 'unchecked';
      return {
        filter,
        groups: await groupsForCheck(db, await need(), {
          filter,
          limit: Number(query.limit ?? 100),
        }),
      };
    });

    route(mods, checkLinkGroup, async ({ params, request }) => {
      const b = request.body as BodyOf<typeof checkLinkGroup>;
      if (!isOutcome(b.outcome)) throw new LinkRefusal('not-an-outcome');
      if (b.reason !== undefined && !isReasonCategory(b.reason)) {
        throw new LinkRefusal('reason-needed');
      }
      return checkGroup(db, await need(), Number(params.id), {
        outcome: b.outcome,
        actor: actor(request),
        reason: b.reason,
        block: b.block,
      });
    });

    route(mods, commentLinkGroup, async ({ params, request }) => {
      const b = request.body as BodyOf<typeof commentLinkGroup>;
      return commentGroup(db, Number(params.id), { body: b.body, actor: actor(request) });
    });

    route(mods, getLinkGroupHistory, async ({ params }) => ({
      items: await groupHistory(db, Number(params.id)),
    }));

    route(mods, getBlocklist, async () => ({ entries: await blocklist(db) }));

    route(mods, addToBlocklist, async ({ request }) => {
      const b = request.body as BodyOf<typeof addToBlocklist>;
      if (!isReasonCategory(b.reason)) throw new LinkRefusal('reason-needed');
      const target = targetFromText(await need(), b.kind, b.text);
      return addBlock(db, target, { reason: b.reason, actor: actor(request) });
    });

    route(mods, removeFromBlocklist, async ({ params, request }) => {
      const b = request.body as BodyOf<typeof removeFromBlocklist>;
      if (!isUnblockReason(b.reason)) throw new LinkRefusal('unblock-reason');
      const removed = await removeBlock(db, Number(params.id), {
        reason: b.reason,
        actor: actor(request),
      });
      if (!removed) throw new LinkRefusal('no-block');
      return { removed };
    });
    done();
  });
}
