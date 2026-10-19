/**
 * Put the files corner of the database in a known state, for the browser tests.
 *
 *   node src/files/dev-state.ts logbook <slug> <title>
 *       A launched logbook asking one required question and for files, made
 *       once (an existing one with that address is left alone).
 *
 * Refuses to run in production: it makes logbooks.
 */
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';

if (process.env.NODE_ENV === 'production') {
  throw new Error('dev-state does not run in production.');
}

const [mode, slug, title] = process.argv.slice(2);
const db = createDatabase(loadConfig().DATABASE_URL, 2);
try {
  if (mode === 'logbook' && slug && title) {
    const found = await db
      .selectFrom('logbooks')
      .select('id')
      .where('slug', '=', slug)
      .executeTakeFirst();
    if (!found) {
      const lb = await db
        .insertInto('logbooks')
        .values({ slug, title })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('logbook_fields')
        .values([
          {
            logbook_id: lb.id,
            key: 'what',
            kind: 'long_text',
            label: 'What happened?',
            required: true,
            position: 0,
          },
          {
            logbook_id: lb.id,
            key: 'photos',
            kind: 'file',
            label: 'Photos or video',
            required: false,
            position: 1,
          },
        ])
        .execute();
      await db
        .updateTable('logbooks')
        .set({ launched_at: new Date() })
        .where('id', '=', lb.id)
        .execute();
    }
  } else {
    throw new Error('Usage: dev-state.ts logbook <slug> <title>');
  }
} finally {
  await db.destroy();
}
