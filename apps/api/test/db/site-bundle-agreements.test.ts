/**
 * A site bundle's agreements: an import publishes one as a new version only
 * when its words differ from the newest, so nobody is asked to accept the
 * same agreement twice, and an export carries the newest of each.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { newestText } from '../../src/moderation/agreement.ts';
import { exportBundle, importBundle } from '../../src/sitebundle/bundle.ts';
import { testDatabase } from './helpers.ts';

const db = testDatabase();
afterAll(() => db.destroy());

const site = (moderator: string) => ({
  format: 1 as const,
  exported_at: new Date().toISOString(),
  site: { agreements: { moderator } },
});

describe('the agreements in a site bundle', () => {
  it('publishes changed words once, and skips the same words', async () => {
    const before = (await newestText(db, 'moderator'))?.version ?? 0;
    const words = `Moderator agreement, test ${String(Date.now())}`;
    const first = await importBundle(db, null, site(words), 'bundle-test@example.org');
    expect(first.written).toContain('The moderator agreement');
    expect((await newestText(db, 'moderator'))?.version).toBe(before + 1);

    const again = await importBundle(db, null, site(words), 'bundle-test@example.org');
    expect(again.skipped).toContain('The moderator agreement, already the same');
    expect((await newestText(db, 'moderator'))?.version).toBe(before + 1);

    const out = await exportBundle(db, null, { packs: false, shipped: false });
    expect(out.site.agreements?.moderator).toBe(words);
  });
});
