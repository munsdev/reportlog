/**
 * The look pack commands, apart from the process that runs them so a test
 * can call them on its own database (cli.ts is the process).
 *
 *   look:add <pack.zip>   check, then install or replace
 *   look:list             what is installed, and whether each may be removed
 *   look:remove <id>      remove one the site is not wearing
 *
 * The same installer as the upload screen (packs.ts), so the same check and
 * the same sentences. Recorded in role_audit with the server as the one who
 * did it: whoever can run this already holds the server.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Database } from '../db/database.ts';
import { installPack, listPacks, removePack } from './packs.ts';

export const COMMAND_ACTOR = 'the server (look command)';

const USAGE =
  'Usage: pnpm --filter @reportlog/api look:add <pack.zip> | look:list | look:remove <id>\n';

function count(n: number, one: string): string {
  return `${String(n)} ${one}${n === 1 ? '' : 's'}`;
}

/**
 * Runs one command and says what happened. Returns the exit code.
 *
 * @param cwd where a relative path is read from. pnpm runs a package's
 *   script inside the package, so the caller passes where the person was
 *   (INIT_CWD), or "path/to/pack.zip" would be looked for in apps/api.
 */
export async function lookCommand(
  db: Database,
  args: readonly string[],
  cwd: string,
  say: (line: string) => void,
): Promise<number> {
  const [verb, arg] = args;
  if (verb === 'add' && arg) {
    let zip: Uint8Array;
    try {
      zip = new Uint8Array(await readFile(resolve(cwd, arg)));
    } catch {
      say(`Could not read ${arg}.`);
      return 66;
    }
    const done = await installPack(db, zip, COMMAND_ACTOR);
    if (!done.ok) {
      say('Nothing was installed:');
      for (const p of done.problems) say(`  - ${p}`);
      return 1;
    }
    const p = done.pack;
    say(
      `${done.replaced === null ? 'Installed' : `Replaced ${done.replaced} with`} ${p.label} ${p.version}: ` +
        `${count(p.palettes.length, 'palette')}, ${count(p.themes.length, 'theme')}, ${count(p.looks.length, 'look')}.`,
    );
    return 0;
  }
  if (verb === 'list' && !arg) {
    const packs = await listPacks(db);
    say('ReportLog, built in');
    for (const p of packs) {
      say(
        `${p.id} ${p.version}  ${p.label}  · ${count(p.palettes.length, 'palette')} · ` +
          `${count(p.themes.length, 'theme')} · ${count(p.looks.length, 'look')}` +
          `  · installed ${p.installed_at.slice(0, 10)} by ${p.installed_by}`,
      );
      if (p.in_use) say(`    in use: ${p.in_use}`);
    }
    if (!packs.length) say('No look packs are installed.');
    return 0;
  }
  if (verb === 'remove' && arg) {
    const done = await removePack(db, arg, COMMAND_ACTOR);
    if (!done.ok) {
      say(done.message);
      return 1;
    }
    say(`Removed ${arg}.`);
    return 0;
  }
  say(USAGE.trimEnd());
  return 64;
}
