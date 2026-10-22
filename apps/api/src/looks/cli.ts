/**
 * Look packs from the server's command line (command.ts says what each does).
 *
 *   pnpm --filter @reportlog/api look:add path/to/pack.zip
 *   pnpm --filter @reportlog/api look:list
 *   pnpm --filter @reportlog/api look:remove <id>
 */
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { lookCommand } from './command.ts';

const db = createDatabase(loadConfig().DATABASE_URL, 2);
try {
  process.exitCode = await lookCommand(
    db,
    process.argv.slice(2),
    process.env.INIT_CWD ?? process.cwd(),
    (line) => process.stdout.write(`${line}\n`),
  );
} finally {
  await db.destroy();
}
