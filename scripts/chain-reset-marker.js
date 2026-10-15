/**
 * Announce a chain reset in the public transparency log.
 *
 * Run this straight after import-archive.js has rebuilt the archive, and
 * before the site takes any new report.
 *
 *   node scripts/chain-reset-marker.js <the export file that was imported>
 *
 * Why this has to exist at all:
 *
 * The daily anchors already published name a chain head that, after a
 * reset, no longer exists anywhere. Anyone checking the archive against
 * its own published proofs will find they do not reconcile. That is
 * exactly what tampering looks like from the outside, and "it was fine,
 * we rebuilt it" said afterwards is worth nothing — the whole value of
 * the log is that it was written before anyone needed it to say
 * something.
 *
 * So the reset is published: both chains' boundary values, the reports
 * carried across, and the reason. The old anchors stay exactly where they
 * are. Nothing in the log is rewritten to match the new chain, because a
 * log that gets tidied to agree with the present is not a log.
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pool } from '../src/db.js';
import { currentHeads } from '../src/chainHeads.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/chain-reset-marker.js <archive.json>');
  process.exit(1);
}

const REPO_DIR = process.env.TRANSPARENCY_LOG_DIR
  || path.join(os.homedir(), 'reportlog-transparency-log');
if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
  console.error(`No transparency log checkout at ${REPO_DIR}.`);
  console.error('Set TRANSPARENCY_LOG_DIR, or clone it there first.');
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(file, 'utf8'));

// The chains being retired, one head per logbook. An export made before
// every logbook had its own chain carries a single head for the whole
// archive, and it is named as that rather than left out.
const previousHeads = payload.previous_chain_heads
  || (payload.previous_chain_head ? { '(the single chain before logbooks)': payload.previous_chain_head } : {});
const newChains = await currentHeads();
const { rows: countRows } = await pool.query('SELECT count(*)::int AS n FROM reports');

// Every anchor published against the chain being retired, named
// individually. A reader should not have to work out for themselves which
// published proofs stop reconciling — that list IS the disclosure.
//
// Read from the export file, NOT from the database: by the time this runs
// the wipe has emptied chain_anchors, and reading the live table would
// have this cheerfully report that no published anchor was affected.
const anchorRows = payload.previous_chain_anchors || [];
if (!anchorRows.length) {
  console.warn(
    'WARNING: the export names no anchors for the retired chain. That is '
    + 'correct only if the archive was never anchored. If it was, this '
    + 'marker understates what the reset invalidates — check the export '
    + 'came from a version that records them.',
  );
}

const date = new Date().toISOString().slice(0, 10);
const record = {
  date,
  kind: 'chain_reset',
  reason: process.env.CHAIN_RESET_REASON
    || 'Testing phase. The hashed object carried fields that existed only so '
     + 'that earlier reports would still verify. The archive was rebuilt on '
     + 'the corrected shape rather than carrying them permanently.',
  previous_chains: {
    final_chain_hashes: previousHeads,
    report_count: payload.previous_report_count,
    exported_at: payload.exported_at,
    // Named so that anyone holding these can see exactly which of them
    // describe a chain that no longer exists. They are NOT withdrawn.
    anchors_published_against_it: anchorRows.map((a) => ({
      date: String(a.anchor_date).slice(0, 10),
      root_chain_hash: a.root_chain_hash,
      public_log_ref: a.public_log_ref,
    })),
  },
  // Every logbook is its own chain, starting from SHA256("reportlog-chain:"
  // + its slug). These are their heads straight after the reimport.
  new_chains: newChains,
  reports_carried_over: payload.threads.reduce((n, t) => n + t.versions.length, 0),
  note: 'No report was edited and none was deleted. The previous chains were '
      + 'closed and every report in them was written again into a new chain, '
      + 'keeping its reference, its answers and the date it was filed. Every '
      + 'content and chain fingerprint was recomputed, so no fingerprint '
      + 'published before this date describes a report in the archive now.',
};

fs.mkdirSync(path.join(REPO_DIR, 'resets'), { recursive: true });
fs.writeFileSync(
  path.join(REPO_DIR, 'resets', `${date}.json`),
  `${JSON.stringify(record, null, 2)}\n`,
);

// A plain-language version at the top level too. The JSON is the record;
// this is what someone finds when they open the repository and want to
// know why the numbers stop lining up.
const headTable = (heads) => Object.entries(heads)
  .map(([k, v]) => `| ${k} | \`${v}\` |`).join('\n') || '| (none) | |';
const readable = `# Chain reset — ${date}

The archive's hash chains were restarted on ${date}.

**Nothing was edited and nothing was deleted.** The previous chains were
closed, and every report in them was written again into a new chain,
keeping its reference, its answers, and the date it was filed.

Every fingerprint was recomputed. That means **no fingerprint published in
this log before ${date} describes a report in the archive today**, and the
anchors listed in \`resets/${date}.json\` name chain heads that no longer
exist. Those anchors have not been withdrawn or rewritten. They remain
true statements about what the archive said on the day they were made.

Every logbook is its own chain.

Before (${payload.previous_report_count} reports):

| chain | final head |
|---|---|
${headTable(previousHeads)}

After (${countRows[0].n} reports):

| logbook | head |
|---|---|
${headTable(Object.fromEntries(newChains.map((c) => [c.logbook, c.head])))}

## Why

${record.reason}

## Why it is being said out loud

An archive that quietly stops matching its own published proofs is
indistinguishable from one that has been tampered with. Publishing the
reset — with both chains' boundary values and the anchors it invalidates —
is the only thing that keeps the rest of the log worth reading.

This was possible because every report in the archive at this point is a
test report filed during the testing phase. Once real reports are being
filed it is not available: a sealed report stays sealed, which is the
entire purpose of the design.
`;
fs.writeFileSync(path.join(REPO_DIR, `RESET-${date}.md`), readable);

execFileSync('git', ['add', `resets/${date}.json`, `RESET-${date}.md`], { cwd: REPO_DIR });
try {
  execFileSync('git', ['commit', '-m',
    `Chain reset ${date}: ${Object.keys(previousHeads).length} chain(s) closed, ${newChains.length} started`],
  { cwd: REPO_DIR });
} catch (e) {
  if (!String(e.stdout || e.message).includes('nothing to commit')) throw e;
  console.log('Reset marker for today is already committed.');
}

// Same rule as the daily anchor: each remote independently, one failure
// loud but not fatal, all of them failing is an error — a reset that
// exists only on the server it is about is not a disclosure.
const REMOTES = (process.env.TRANSPARENCY_LOG_REMOTES || 'origin')
  .split(',').map((r) => r.trim()).filter(Boolean);
const failed = [];
for (const remote of REMOTES) {
  try {
    execFileSync('git', ['push', remote, 'HEAD'], { cwd: REPO_DIR });
    console.log(`  pushed to ${remote}`);
  } catch (e) {
    failed.push(remote);
    console.error(`  !! push to ${remote} FAILED: ${String(e.stderr || e.message).trim()}`);
  }
}

for (const [k, v] of Object.entries(previousHeads)) console.log(`old  ${k}  ${v}`);
for (const c of newChains) console.log(`new  ${c.logbook}  ${c.head}`);
console.log(`reports         ${countRows[0].n}`);
console.log(`anchors named   ${anchorRows.length}`);

await pool.end();

if (REMOTES.length && failed.length === REMOTES.length) {
  console.error(
    `\nThe reset marker reached NO remote (${REMOTES.join(', ')}). It exists `
    + 'only on this server, which is the one place a disclosure about this '
    + 'server is worthless. Fix the push before letting the site take a report.',
  );
  process.exit(1);
}
