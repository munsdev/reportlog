/**
 * For the browser test of a report with held text and links (W1).
 *
 *   node src/dev/held-state.ts logbook <slug>
 *       Make and launch a logbook that asks a choice, a piece of text and up
 *       to three links, the last two held outside the report.
 *   node src/dev/held-state.ts erase-first-link <public_ref>
 *       Erase the first link that report holds, as a moderator would (a
 *       tombstone and all), and print how many copies went.
 *
 * No route erases a held value yet (the moderation work comes after), so
 * this stands in for one. Refuses to run in production.
 */
import { loadConfig } from '../config.ts';
import { recordCardTexts } from '../consent/cards.ts';
import { createDatabase } from '../db/database.ts';
import { loadLinkKeys } from '../links/keys.ts';
import { eraseHeldValue } from '../reportValues/erase.ts';
import { readForModerator } from '../reportValues/reads.ts';

if (process.env.NODE_ENV === 'production') {
  throw new Error('held-state does not run in production: it erases report values.');
}

const [mode, arg] = process.argv.slice(2);
const config = loadConfig();
if (!arg || !config.CONTACT_KEY || (mode !== 'logbook' && mode !== 'erase-first-link')) {
  throw new Error(
    'Usage: held-state.ts logbook <slug> | erase-first-link <ref> (and CONTACT_KEY set)',
  );
}
const db = createDatabase(config.DATABASE_URL, 2);
try {
  if (mode === 'logbook') {
    await recordCardTexts(db);
    const lb = await db
      .insertInto('logbooks')
      // Held values are taken only by a logbook that accepts notes (filing.ts).
      .values({
        slug: arg,
        title: 'Held values',
        blurb: 'Made by a browser test.',
        accepts_notes: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const questions = [
      {
        key: 'outcome',
        kind: 'choice_one',
        label: 'How did it go?',
        settings: { options: ['ok', 'bad'] },
      },
      { key: 'what', kind: 'private_text', label: 'What happened', settings: {} },
      { key: 'links', kind: 'private_link', label: 'Links', settings: { maxValues: 3 } },
    ];
    for (const [position, q] of questions.entries()) {
      await db
        .insertInto('logbook_fields')
        .values({
          logbook_id: lb.id,
          key: q.key,
          kind: q.kind,
          label: q.label,
          settings: JSON.stringify(q.settings),
          position,
        })
        .execute();
    }
    await db
      .updateTable('logbooks')
      .set({ launched_at: new Date() })
      .where('id', '=', lb.id)
      .execute();
    console.log(arg);
  } else {
    const keys = await loadLinkKeys(db, config.CONTACT_KEY);
    const report = await db
      .selectFrom('reports')
      .select('id')
      .where('public_ref', '=', arg)
      .executeTakeFirstOrThrow();
    const first = (await readForModerator(db, keys, [report.id])).find(
      (r) => r.kind === 'private_link',
    );
    if (!first) throw new Error(`${arg} holds no link`);
    const n = await db
      .transaction()
      .execute((trx) =>
        eraseHeldValue(trx, first.id, { reason: 'personal-data', actor: 'system' }),
      );
    console.log(String(n));
  }
} finally {
  await db.destroy();
}
