/**
 * The media worker, as a command. Workstream H runs it.
 *
 *   pnpm --filter @reportlog/api files:worker          keeps running, a pass every few seconds
 *   pnpm --filter @reportlog/api files:worker --once   one pass, for a timer
 *
 * Needs DATABASE_URL, FILES_KEY and the same storage settings as the server,
 * and on the machine: ImageMagick (with libheif for HEIC), ffmpeg (ffprobe
 * included) and poppler-utils. ClamAV is optional (CLAMAV_ENABLED=true and a
 * running clamd). A missing tool holds back only the files that need it, and
 * says which package to install.
 *
 * It needs no CONTACT_KEY, and should not be given one: it parses hostile
 * files, and has no business holding the key to reporters' addresses.
 */
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { filesFrom } from './context.ts';
import { workOnce } from './worker.ts';

const config = loadConfig();
const db = createDatabase(config.DATABASE_URL);
const files = filesFrom(db, config);
if (typeof files === 'string') {
  console.error(`[files:worker] files are not configured: ${files}. Nothing to do.`);
  await db.destroy();
  process.exit(1);
}

const log = {
  info: (m: string) => {
    console.log(`[files:worker] ${m}`);
  },
  warn: (m: string) => {
    console.warn(`[files:worker] ${m}`);
  },
};
const once = process.argv.includes('--once');
const stop = { asked: false };
process.once('SIGTERM', () => (stop.asked = true));
process.once('SIGINT', () => (stop.asked = true));

do {
  try {
    await workOnce(files, { log });
  } catch (e) {
    // The database or storage being away is not a reason to stop: try again.
    log.warn(`a pass failed: ${(e as Error).message}`);
  }
  if (!once) await new Promise((r) => setTimeout(r, 3000));
} while (!once && !stop.asked);

await db.destroy();
