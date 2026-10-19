/**
 * The anchor's commands, for an operator at a shell.
 *
 *   anchor run                              anchor today, now, in the foreground
 *   anchor health                           what the doctor would say about the anchor
 *   anchor export <file>                    the whole archive, lists left out
 *   anchor import <file> [--new-chain]      replay an export into an empty database
 *   anchor reset-marker <file> --reason "…" publish that an import built new chains
 *
 * Configuration comes from the environment (DATABASE_URL and the
 * TRANSPARENCY_LOG_* settings), read once by loadConfig like the server's.
 *
 * Exit codes: 0 fine, 1 broken, 2 the anchor refused (a logbook vanished or a
 * chain got shorter: not something to retry, something to look at).
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { exportArchive, importArchive } from './archive.ts';
import type { Archive } from './archive.ts';
import { anchorDoctorCheck, anchorNow, logSettingsFrom } from './job.ts';
import { publishReset, resetRecord } from './reset.ts';

const say = (line: string) => process.stdout.write(`${line}\n`);
const complain = (line: string) => process.stderr.write(`${line}\n`);

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const args = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--reason');
  const config = loadConfig();
  const db = createDatabase(config.DATABASE_URL, 2);
  try {
    switch (command) {
      case 'run': {
        const out = await anchorNow({ config, db, log: say, now: () => new Date() });
        if (typeof out === 'string') {
          complain(out);
          return 1;
        }
        return out.exitCode;
      }
      case 'health': {
        const f = await anchorDoctorCheck({ config, db, now: () => new Date() });
        say(`${f.status.toUpperCase()}  ${f.detail}`);
        return f.status === 'fail' ? 1 : 0;
      }
      case 'export': {
        const file = args[0];
        if (!file) break;
        const archive = await exportArchive(db);
        writeFileSync(file, `${JSON.stringify(archive)}\n`, { mode: 0o600 });
        say(`  reports      ${String(archive.reports.length)}`);
        for (const [t, d] of Object.entries(archive.tables))
          say(`  ${t.padEnd(26)} ${String(d.rows.length)}`);
        say(
          `  anchors      ${String(archive.previous_chain_anchors.length)} (restored only if every fingerprint replays identically)`,
        );
        say(`  left out    ${Object.keys(archive.left_out).join(', ')}`);
        say(
          `\nwritten to ${file} (${String(Math.round(statSync(file).size / 1024))} KB). It holds the contact details`,
        );
        say('still under their keys, and every account: keep it like the database itself.');
        return 0;
      }
      case 'import': {
        const file = args[0];
        if (!file) break;
        const archive = JSON.parse(readFileSync(file, 'utf8')) as Archive;
        const out = await importArchive(db, archive, { newChain: flags.has('--new-chain') });
        say(`  reports      ${String(out.reports)}`);
        for (const [t, n] of Object.entries(out.tables)) say(`  ${t.padEnd(26)} ${String(n)}`);
        if (out.identical) {
          say(
            `\nEvery fingerprint is identical to the export's. ${String(out.anchorsRestored)} anchor(s) restored:`,
          );
          say('every proof already published still reconciles. No reset marker is needed.');
        } else {
          say(
            `\n${String(out.differing.length)} report(s) have new fingerprints, so these are NEW CHAINS.`,
          );
          say('No anchor was restored. Before this archive takes a report, publish the fact:');
          say(`  anchor reset-marker ${file} --reason "why the chains were rebuilt"`);
        }
        return 0;
      }
      case 'reset-marker': {
        const file = args[0];
        const at = rest.indexOf('--reason');
        const reason = at >= 0 ? (rest[at + 1] ?? '') : '';
        if (!file || !reason) break;
        const settings = logSettingsFrom(config);
        if (typeof settings === 'string') {
          complain(settings);
          return 1;
        }
        const archive = JSON.parse(readFileSync(file, 'utf8')) as Archive;
        const record = await resetRecord(db, archive, {
          reason,
          date: new Date().toISOString().slice(0, 10),
        });
        const out = await publishReset(record, settings);
        say(
          `Published ${out.file}: ${String(record.anchors_no_longer_reconciling.length)} anchor(s) no longer reconcile.`,
        );
        for (const r of out.reached) say(`  pushed to ${r}`);
        for (const f of out.failed) complain(`  !! push to ${f.label} failed: ${f.why}`);
        return out.reached.length ? 0 : 1;
      }
      default:
        break;
    }
    complain(
      'Usage: anchor run | health | export <file> | import <file> [--new-chain] | reset-marker <file> --reason "…"',
    );
    return 1;
  } catch (e) {
    complain((e as Error).message);
    return 1;
  } finally {
    await db.destroy();
  }
}

process.exitCode = await main(process.argv.slice(2));
