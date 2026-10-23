/**
 * Checking a report's fingerprint, for anybody holding its reference.
 *
 * THE FINGERPRINTS ARE FOR EVERYBODY; THE TEXT IS NOT (decisions.md §1). A
 * reference is printed on the reporter's declaration and may be handed to
 * anybody, but nothing is public until a moderator approves it. So the
 * sealed object (`hashed_fields`, `canonical_json`) is sent only while the
 * report is public and the archive is on, the same two gates the board
 * asks. Otherwise the answer carries the hashes, the link and the position:
 * enough to show the record has not changed, and nothing of what it says.
 *
 * Staff who may read the report anyway (moderators, administrators) get it
 * whole, as they would in the moderation screens.
 *
 * Decided here and not in chain/verify.ts: "public" reads the revocable
 * permission and the moderation state, which the chain code may never reach
 * (.dependency-cruiser.cjs).
 */
import { roleSatisfies } from '@reportlog/access';
import { verifyReport as verifyContract } from '@reportlog/contracts';
import type { Verification } from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { listedReportIds } from '../board/published.ts';
import { publicArchiveAvailable } from '../board/publication.ts';
import { verifyReport } from '../chain/verify.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';

const mayReadAnyReport = (request: FastifyRequest) =>
  roleSatisfies(request.user?.roles, 'moderator') || roleSatisfies(request.user?.roles, 'admin');

async function textIsPublic(db: Database, publicRef: string): Promise<boolean> {
  if (!(await publicArchiveAvailable(db))) return false;
  const row = await db
    .selectFrom('reports as r')
    .select('r.id')
    .where('r.public_ref', '=', publicRef)
    // Listed, not merely published: a counts-only logbook's text is on no
    // public page, this one included.
    .where('r.id', 'in', listedReportIds(db))
    .executeTakeFirst();
  return row !== undefined;
}

/** The same answer with the sealed object left out: absent, not null. */
function fingerprintsOnly(v: Verification): Verification {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- taken out on purpose
  const { hashed_fields, canonical_json, ...rest } = v;
  return rest;
}

export function verifyRoutes(app: FastifyInstance, db: Database): void {
  route(app, verifyContract, async ({ params, request }) => {
    const result = await verifyReport(db, params.ref);
    if (!result) throw notFound(`There is no report ${params.ref}.`);
    if (mayReadAnyReport(request) || (await textIsPublic(db, params.ref))) return result;
    return fingerprintsOnly(result);
  });
}
