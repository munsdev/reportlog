import { health } from '@reportlog/contracts';
import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/database.ts';
import { route } from '../http/route.ts';

export function healthRoutes(app: FastifyInstance, db: Database): void {
  route(app, health, async ({ reply }) => {
    const up = await sql`SELECT 1`.execute(db).then(
      () => true,
      () => false,
    );
    if (!up) void reply.status(503);
    return { ok: up, database: up ? ('up' as const) : ('down' as const) };
  });
}
