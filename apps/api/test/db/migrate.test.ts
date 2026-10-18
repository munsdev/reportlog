import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import type { Throwaway } from '../../src/db/throwaway.ts';

const made: Throwaway[] = [];
afterAll(async () => {
  for (const t of made) await t.drop();
});

describe('the migration runner', () => {
  it('is a no-op on an up-to-date database', async () => {
    const result = await migrate(inject('databaseUrl'));
    expect(result.applied).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it('refuses an applied migration whose text has changed', async () => {
    const t = await createThrowawayDatabase(inject('serverUrl'), 'mig');
    made.push(t);
    const dir = await mkdtemp(join(tmpdir(), 'rl-mig-'));
    await writeFile(join(dir, '20260101000000_one.sql'), 'CREATE TABLE one (id int);');
    await migrate(t.url, dir);
    await writeFile(join(dir, '20260101000000_one.sql'), 'CREATE TABLE one (id bigint);');
    await expect(migrate(t.url, dir)).rejects.toThrow(/has changed since it was applied/);
  });

  it('refuses names that are not timestamped', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rl-mig-'));
    await writeFile(join(dir, '001_init.sql'), 'SELECT 1;');
    await expect(migrate(inject('databaseUrl'), dir)).rejects.toThrow(/must look like/);
  });
});
