import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { recordCardTexts } from './consent/cards.ts';
import { createDatabase } from './db/database.ts';
import { filesFrom } from './files/context.ts';
import { workOnce } from './files/worker.ts';
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

// The media worker inside this process, for development and the browser
// tests only. A deployment runs `files:worker` on its own (workstream H): the
// decoders are child processes either way, but a worker of its own can be
// given less than the server has (no CONTACT_KEY, no network but storage).
const files = filesFrom(db, config);
let inline: NodeJS.Timeout | undefined;
if (config.FILES_INLINE_WORKER === 'true' && typeof files !== 'string') {
  app.log.warn(
    'FILES_INLINE_WORKER is on: the media worker runs inside the server. Not for a deployment.',
  );
  let busy = false;
  inline = setInterval(() => {
    if (busy) return;
    busy = true;
    workOnce(files, {
      log: {
        info: (m) => {
          app.log.info(m);
        },
        warn: (m) => {
          app.log.warn(m);
        },
      },
    })
      .catch((e: unknown) => {
        app.log.warn({ err: e }, 'a media worker pass failed');
      })
      .finally(() => (busy = false));
  }, 1000);
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  clearInterval(inline);
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
