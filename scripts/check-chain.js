// Check one logbook's chain file, with no database and no network.
//
//   node scripts/check-chain.js <chain-file.json> [anchors-folder]
//
// A chain file is what "Download this logbook's chain" gives an
// administrator (every report, so every link is checked) or what the public
// board gives anybody (published reports only, each checked on its own).
// With an anchors folder — the `anchors/` directory of the transparency log
// — it also checks that each anchor the file lists says the same thing as
// the one published there. See src/chainCheck.js.
import fs from 'node:fs';
import path from 'node:path';
import { checkChainFile } from '../src/chainCheck.js';

const [file, anchorDir] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node scripts/check-chain.js <chain-file.json> [anchors-folder]');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const out = checkChainFile(data);

if (anchorDir) {
  for (const a of data.anchors || []) {
    const p = path.join(anchorDir, `${a.date}.json`);
    if (!fs.existsSync(p)) {
      out.problems.push(`The anchor of ${a.date} is not in ${anchorDir}.`);
      continue;
    }
    const published = JSON.parse(fs.readFileSync(p, 'utf8'));
    const line = (published.chains || []).find((c) => c.logbook === data.logbook);
    if (!line) out.problems.push(`The published anchor of ${a.date} does not list this logbook.`);
    else if (line.head !== a.head || line.reports !== a.reports) {
      out.problems.push(`The published anchor of ${a.date} disagrees with the file about this logbook's head.`);
    }
  }
}

console.log(`${data.title || data.logbook} (${data.logbook}) — a ${out.kind} chain file`);
console.log(`  reports checked  ${out.checked}`);
if (out.head) console.log(`  head             ${out.head}`);
if (out.kind === 'published') {
  console.log('  This file holds published reports only. Each was checked on its own;');
  console.log('  the run from start to head needs the complete file.');
}
if (out.problems.length) {
  console.log('\nProblems:');
  for (const p of out.problems) console.log(`  - ${p}`);
  process.exit(2);
}
console.log('\nEverything that can be checked in this file holds.');
