import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { recordCardTexts } from './consent/cards.ts';
import { createDatabase } from './db/database.ts';
import { createMailer } from './email/index.ts';
import { listSettingsFrom } from './lists/settings.ts';

const config = loadConfig();
const db = createDatabase(config.DATABASE_URL);

// The card's wording must be on record before any report can name its digest.
await recordCardTexts(db);

const app = await buildApp({
  config,
  db,
  mailer: createMailer(config),
  lists: listSettingsFrom(config),
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
