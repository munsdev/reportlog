/**
 * Identity and access, registered on the app in one call.
 *
 * Registered BEFORE every other route, because two of the hooks here must
 * see them all: the gate's check that no route outside the list prefixes
 * claims to decide the password for itself, and the session lookup that
 * gives every route `request.user`.
 */
import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { accessRoutes } from './accessRoutes.ts';
import { authRoutes } from './authRoutes.ts';
import { curtainRoutes } from './curtainRoutes.ts';
import { installGate } from './gate.ts';
import { orgRoutes } from './orgRoutes.ts';
import { installSessions } from './sessions.ts';
import { secondFactorRoutes } from './secondFactorRoutes.ts';
import { teamRoutes } from './teamRoutes.ts';
import type { TwoFactorKey } from './twoFactorKey.ts';

export interface IdentityDeps {
  db: Kysely<DB>;
  mailer: Mailer;
  /** Where the website is, for links in emails, and the passkeys' relying party. */
  siteOrigin: string;
  /** Authenticator-app secrets are encrypted under it. Null: apps cannot be set up. */
  twoFactorKey: TwoFactorKey | null;
}

export async function identity(app: FastifyInstance, deps: IdentityDeps): Promise<void> {
  await app.register(cookie);
  installSessions(app, deps.db);
  installGate(app, deps.db);
  authRoutes(app, deps);
  secondFactorRoutes(app, deps);
  accessRoutes(app, deps);
  orgRoutes(app, deps);
  curtainRoutes(app, deps);
  teamRoutes(app, deps);
}
