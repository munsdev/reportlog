/**
 * A database that exists for one run and is dropped afterwards.
 *
 * Created BESIDE the database the given URL names, on the same server, so the
 * database you point the tests at is never written to.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';

export interface Throwaway {
  url: string;
  drop: () => Promise<void>;
}

export async function createThrowawayDatabase(baseUrl: string, label = 'test'): Promise<Throwaway> {
  const name = `reportlog_${label}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(baseUrl, name);
  return {
    url,
    drop: async () => {
      const c = new pg.Client({ connectionString: baseUrl });
      await c.connect();
      try {
        await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await c.end();
      }
    },
  };
}

/**
 * The same server and credentials, another database. Done on the string
 * rather than with `URL`, because a socket URL (`postgres://u@/db?host=/run`)
 * has an empty host that `URL` rejects.
 */
export function withDatabase(url: string, database: string): string {
  const m = /^(postgres(?:ql)?:\/\/[^/?]*)(?:\/[^?]*)?(\?.*)?$/.exec(url);
  if (!m) throw new Error('withDatabase: not a postgres:// URL');
  return `${m[1] ?? ''}/${database}${m[2] ?? ''}`;
}
