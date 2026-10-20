/**
 * For the browser test of the journalist desk.
 *
 *   node src/dev/desk-state.ts links <checked-url> <unchecked-url> <comment>
 *       Make a tips list, send one tip carrying each address, and mark the
 *       first "checked" with a comment for journalists, as a moderator would.
 *
 * Checking here stands in for a moderator, which is why this refuses to run
 * in production.
 */
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { checkGroup, commentGroup } from '../links/checks.ts';
import { loadLinkKeys, matchKey } from '../links/keys.ts';
import { fileEntry } from '../lists/entries.ts';
import { createFromTemplate } from '../lists/manage.ts';
import { DEFAULT_LIST_SETTINGS } from '../lists/retention.ts';

if (process.env.NODE_ENV === 'production') {
  throw new Error('desk-state does not run in production: it checks links.');
}

const [mode, checked, unchecked, comment] = process.argv.slice(2);
const config = loadConfig();
if (mode !== 'links' || !checked || !unchecked || !comment || !config.CONTACT_KEY) {
  throw new Error(
    'Usage: desk-state.ts links <checked-url> <unchecked-url> <comment> (and CONTACT_KEY set)',
  );
}
const db = createDatabase(config.DATABASE_URL, 2);
try {
  const keys = await loadLinkKeys(db, config.CONTACT_KEY);
  const tips = await createFromTemplate(db, 'tips', {
    slug: `desk-tips-${randomBytes(4).toString('hex')}`,
  });
  for (const links of [checked, unchecked]) {
    await fileEntry(
      db,
      tips.slug,
      {
        answers: { links, state: 'Not sure', category: 'Not sure' },
        email: `tipster-${randomBytes(4).toString('hex')}@example.org`,
      },
      { settings: DEFAULT_LIST_SETTINGS, keys },
    );
  }
  const group = await db
    .selectFrom('link_groups')
    .select('id')
    .where('match_key', '=', matchKey(keys, checked))
    .executeTakeFirstOrThrow();
  await checkGroup(db, keys, group.id, { outcome: 'checked', actor: 'e2e-moderator@example.org' });
  await commentGroup(db, group.id, { body: comment, actor: 'e2e-moderator@example.org' });
} finally {
  await db.destroy();
}
