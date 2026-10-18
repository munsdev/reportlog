/**
 * One throwaway database for the whole run, migrated from scratch, dropped at
 * the end. TEST_DATABASE_URL names the server (and a database to connect to
 * while creating it); that database itself is never written to.
 */
import { existsSync } from 'node:fs';
import type { TestProject } from 'vitest/node';
import { migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    serverUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const envFile = new URL('../../../../.env', import.meta.url);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const base = process.env.TEST_DATABASE_URL;
  if (!base) {
    throw new Error(
      'TEST_DATABASE_URL is not set. See .env.example: it names the Postgres server the tests may create databases on.',
    );
  }
  const db = await createThrowawayDatabase(base, 'test');
  await migrate(db.url);
  project.provide('databaseUrl', db.url);
  project.provide('serverUrl', base);
  return () => db.drop();
}
