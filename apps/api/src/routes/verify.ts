import { verifyReport as verifyContract } from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import { verifyReport } from '../chain/verify.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';

export function verifyRoutes(app: FastifyInstance, db: Database): void {
  route(app, verifyContract, async ({ params }) => {
    const result = await verifyReport(db, params.ref);
    if (!result) throw notFound(`There is no report ${params.ref}.`);
    return result;
  });
}
