/**
 * Check a downloaded chain file with nothing but the file.
 *
 *   pnpm --filter @reportlog/api check-chain <chain-file.json> [anchors-folder]
 *
 * No database, no network, no configuration: the same `checkChainFile` the
 * reader's browser runs. With the `anchors/` folder of a copy of the
 * transparency log, it also checks that each anchor the file names says the
 * same thing as the one published there, that the published list's digest
 * is its own, and that the timestamp token covers that digest.
 *
 * Exits 0 when everything checkable holds, 2 when something does not, 1 when
 * the file could not be read at all.
 */
import { checkChainFile, headsDigest } from '@reportlog/seal';
import type { ChainFile, ChainHead } from '@reportlog/seal';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readToken } from './tsp.ts';

export interface CheckReport {
  lines: string[];
  problems: string[];
}

/** Everything the command prints, as data, so it is tested without a process. */
export function checkFiles(data: ChainFile, anchorDir?: string): CheckReport {
  const out = checkChainFile(data);
  const problems = [...out.problems];

  if (anchorDir) {
    for (const a of data.anchors ?? []) {
      const p = join(anchorDir, `${a.date}.json`);
      if (!existsSync(p)) {
        problems.push(`The anchor of ${a.date} is not in ${anchorDir}.`);
        continue;
      }
      let published: {
        date?: string;
        chains?: ChainHead[];
        root_chain_hash?: string;
        rfc3161_token_base64?: string;
      };
      try {
        published = JSON.parse(readFileSync(p, 'utf8')) as typeof published;
      } catch {
        problems.push(`The published anchor of ${a.date} is not readable JSON.`);
        continue;
      }
      const chains = published.chains ?? [];
      const line = chains.find((c) => c.logbook === data.logbook);
      if (!line) problems.push(`The published anchor of ${a.date} does not list this logbook.`);
      else if (line.head !== a.head || line.reports !== a.reports) {
        problems.push(
          `The published anchor of ${a.date} disagrees with the file about this logbook's head.`,
        );
      }
      if (headsDigest(published.date ?? a.date, chains) !== published.root_chain_hash) {
        problems.push(
          `The published anchor of ${a.date} does not match its own digest: its list has changed.`,
        );
      }
      try {
        const info = readToken(Buffer.from(published.rfc3161_token_base64 ?? '', 'base64'));
        if (info.imprint !== published.root_chain_hash) {
          problems.push(
            `The timestamp in the anchor of ${a.date} covers a different digest from the list's.`,
          );
        }
      } catch {
        problems.push(`The anchor of ${a.date} carries no readable timestamp token.`);
      }
    }
  }

  const lines = [
    `${data.title ?? data.logbook} (${data.logbook}): a ${out.kind ?? 'unknown'} chain file`,
    `  reports checked  ${String(out.checked ?? 0)}`,
    ...(out.head ? [`  head             ${out.head}`] : []),
    ...(out.kind === 'published'
      ? [
          '  This file holds published reports only. Each was checked on its own;',
          '  the run from start to head needs the complete file.',
        ]
      : []),
    ...(anchorDir ? [`  anchors checked against ${anchorDir}`] : []),
  ];
  return { lines, problems };
}

function main(argv: readonly string[]): number {
  const [file, anchorDir] = argv;
  if (!file) {
    process.stderr.write('Usage: check-chain <chain-file.json> [anchors-folder]\n');
    return 1;
  }
  let data: ChainFile;
  try {
    data = JSON.parse(readFileSync(file, 'utf8')) as ChainFile;
  } catch (e) {
    process.stderr.write(`Could not read ${file}: ${(e as Error).message}\n`);
    return 1;
  }
  const { lines, problems } = checkFiles(data, anchorDir);
  process.stdout.write(`${lines.join('\n')}\n`);
  if (problems.length) {
    process.stdout.write(`\nProblems:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    return 2;
  }
  process.stdout.write('\nEverything that can be checked in this file holds.\n');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
