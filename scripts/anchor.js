// Run once a day via cron. Takes the list of every logbook's chain and its
// latest link, gets an RFC 3161 timestamp token over that list's digest from
// a EU public timestamp authority (independent of this server), and
// publishes the list and the token to the public transparency log — so the
// archive's integrity can be verified even if this server is seized or
// destroyed. One timestamp covers every chain; see src/chainHeads.js.
//
// The log is mirrored across several git hosts under different operators
// (see TRANSPARENCY_LOG_REMOTES). That is not redundancy for its own sake:
// a record that only one company holds is a record that one company can be
// compelled to remove, and the whole claim this file exists to support is
// that nobody — us included — can quietly alter or suppress the archive.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pool } from '../src/db.js';
import { currentHeads, headsDigest, contradictions, ANCHOR_FORMAT } from '../src/chainHeads.js';
import { buildSnapshot, serializeSnapshot } from '../src/snapshot.js';
import { snapshotDocument } from '../src/lists/aggregates.js';
import { countsRecord } from '../src/countsFile.js';
import {
  settings as logSettings, sshCommandFor, keyPath, recordPush, pushTargets, scrubbed,
} from '../src/transparencyLog.js';

/* THE DESTINATION IS THE OPERATOR'S, AND IT IS NO LONGER ONLY .env.
   Migration 052 put it in the database so the admin panel can set it.
   The environment still wins where it is set, because a box configured
   over SSH before the panel existed must not change behaviour under its
   operator the day it upgrades. Panel first for a box that has never had
   the variables; environment first for one that has. */
const CFG = await logSettings();

const TSA_URL = process.env.TSA_URL || CFG.tsa_url;
// The local checkout of the public transparency log. Overridable because
// the home directory of whichever account runs the cron job is not
// something this script should be asserting.
const REPO_DIR = process.env.TRANSPARENCY_LOG_DIR || CFG.repo_dir;

const date = new Date().toISOString().slice(0, 10);
const heads = await currentHeads();

// ONCE LISTED, ALWAYS LISTED, AND NEVER SHORTER. If a logbook named in the
// last anchor is gone, or a chain holds fewer reports than it did, reports
// have been deleted — nothing in the software can do either. Publishing a
// list that quietly agreed with the damage would be the log lying for it,
// so this stops, loudly, and publishes nothing until somebody has looked.
const bad = await contradictions(heads);
if (bad.dropped.length || bad.shrunk.length) {
  for (const s of bad.dropped) console.error(`!! logbook "${s}" was in the last anchor and is gone.`);
  for (const s of bad.shrunk) console.error(`!! logbook "${s.logbook}" had ${s.was} report(s) and now has ${s.now}.`);
  console.error('!! This is what deleting reports looks like. Nothing was anchored. Investigate.');
  process.exit(2);
}

const rootHash = headsDigest(date, heads);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reportlog-anchor-'));
const reqPath = path.join(tmp, 'request.tsq');
const resPath = path.join(tmp, 'response.tsr');

execFileSync('openssl', ['ts', '-query', '-digest', rootHash, '-sha256', '-cert', '-out', reqPath]);

const reqBytes = fs.readFileSync(reqPath);
const tsaRes = await fetch(TSA_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/timestamp-query' },
  body: reqBytes,
});
if (!tsaRes.ok) {
  throw new Error(`TSA request failed: ${tsaRes.status} ${await tsaRes.text().catch(() => '')}`);
}
const resBytes = Buffer.from(await tsaRes.arrayBuffer());
fs.writeFileSync(resPath, resBytes);

// Sanity-check the token parses as a well-formed RFC 3161 reply before we
// commit to trusting it (doesn't verify the signature chain, just structure).
execFileSync('openssl', ['ts', '-reply', '-in', resPath, '-text']);

// The anchor and its list, together or not at all.
const db = await pool.connect();
try {
  await db.query('BEGIN');
  const { rows: [anchor] } = await db.query(
    `INSERT INTO chain_anchors (anchor_date, root_chain_hash, rfc3161_token, public_log_ref)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [date, rootHash, resBytes, `anchors/${date}.json`],
  );
  for (const h of heads) {
    await db.query(
      `INSERT INTO chain_anchor_heads (anchor_id, logbook_slug, head_chain_hash, report_count)
       VALUES ($1, $2, $3, $4)`,
      [anchor.id, h.logbook, h.head, h.reports],
    );
  }
  await db.query('COMMIT');
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  throw e;
} finally {
  db.release();
}

fs.mkdirSync(path.join(REPO_DIR, 'anchors'), { recursive: true });
const record = {
  anchor_format: ANCHOR_FORMAT,
  date,
  // Every logbook's chain: its latest link and how many reports it holds.
  chains: heads,
  // SHA-256 of {anchor_format, date, chains} serialized with RFC 8785 —
  // the value the timestamp authority signed.
  root_chain_hash: rootHash,
  rfc3161_token_base64: resBytes.toString('base64'),
  tsa: TSA_URL,
};
fs.writeFileSync(
  path.join(REPO_DIR, 'anchors', `${date}.json`),
  `${JSON.stringify(record, null, 2)}\n`,
);

// The day's published reports, in full, alongside the anchor.
//
// The anchor proves the archive was not altered; it cannot show what the
// archive said, because a hash is only checkable against content you
// already hold. Publishing both in the SAME commit is what makes the pair
// useful: there is never a snapshot without the timestamp that covers it,
// or an anchor with no way to see what it covered.
//
// Built after the anchor row is written, so the chain head recorded in the
// snapshot is the one that was just timestamped.
fs.mkdirSync(path.join(REPO_DIR, 'snapshots'), { recursive: true });
const snapshot = await buildSnapshot(date, pool, heads);
fs.writeFileSync(
  path.join(REPO_DIR, 'snapshots', `${date}.json`),
  serializeSnapshot(snapshot),
);
if (snapshot.reports_not_matching_their_own_hash) {
  // Published anyway, with the disagreement visible in the file — but this
  // is the alarm the whole system exists to raise, so it does not scroll
  // past in a cron log as an ordinary line.
  console.error(`\n!! ${snapshot.reports_not_matching_their_own_hash} report(s) do not match their own recorded hash.`);
  console.error('!! This is what tampering looks like. Investigate before trusting today\'s output.\n');
}

// THE COUNTS of every list an operator published, beside the anchor and in
// the same commit, with a timestamp of their own over their own digest —
// src/countsFile.js says why it is not folded into the anchor.
//
// AFTER the reports are anchored and AFTER their files are written, and
// never able to stop them: a list's counts failing to timestamp is a
// problem for tomorrow's file, and a day's reports going unanchored because
// of it would be the wrong way round.
const toAdd = [`anchors/${date}.json`, `snapshots/${date}.json`];
let countsLine = '';
try {
  const doc = await snapshotDocument({});
  if (doc.lists.length) {
    const rec = countsRecord(date, doc);
    const cReq = path.join(tmp, 'counts.tsq');
    const cRes = path.join(tmp, 'counts.tsr');
    execFileSync('openssl', ['ts', '-query', '-digest', rec.digest, '-sha256', '-cert', '-out', cReq]);
    const r = await fetch(TSA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      body: fs.readFileSync(cReq),
    });
    if (!r.ok) throw new Error(`TSA request for the counts failed: ${r.status}`);
    const tok = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(cRes, tok);
    execFileSync('openssl', ['ts', '-reply', '-in', cRes, '-text']);
    fs.mkdirSync(path.join(REPO_DIR, 'counts'), { recursive: true });
    fs.writeFileSync(
      path.join(REPO_DIR, 'counts', `${date}.json`),
      `${JSON.stringify({ ...rec, rfc3161_token_base64: tok.toString('base64'), tsa: TSA_URL }, null, 2)}\n`,
    );
    toAdd.push(`counts/${date}.json`);
    countsLine = `\nCounts: ${rec.lists.length} published list(s).`;
  }
} catch (e) {
  console.error(`!! The list counts were not published today: ${e.message}`);
  console.error('!! The reports anchor is unaffected. Tomorrow\'s run tries again.');
}

execFileSync('git', ['add', ...toAdd], { cwd: REPO_DIR });

// Commit and push are deliberately separate steps.
//
// They used to be one try block, which had two problems. A push that
// failed after a successful commit was indistinguishable from a broken
// run, and — worse — a day whose commit landed but whose push did not
// would never be retried, because the next day's run would see "nothing
// to commit" and skip pushing entirely. The archive would then be a day
// or more behind in public with nothing saying so.
//
// So: commit if there is anything to commit, and then push regardless.
// An empty commit is not an error, it just means today's work is already
// in the history and what matters now is whether the remotes have it.
let committed = true;
try {
  execFileSync('git', ['commit', '-m',
    `Anchor ${date}: ${rootHash}\n\nSnapshot: ${snapshot.report_count} published report(s).${countsLine}`],
  { cwd: REPO_DIR });
} catch (e) {
  if (!String(e.stdout || e.message).includes('nothing to commit')) throw e;
  committed = false;
  console.log(`Anchor for ${date} unchanged since last run (${rootHash}), nothing new to commit.`);
}

// The log is mirrored across several hosts under different operators, in
// different jurisdictions, precisely so that no single one of them can
// suppress or rewrite the record. That is only true if a host being down
// does not stop the others being written to — so each remote is pushed
// independently and one failure is not allowed to abort the rest.
//
// Failing to reach SOME remotes is loud but not fatal: the record is
// public on the others, and the laggard catches up on the next run since
// git pushes whatever it is missing. Failing to reach ALL of them exits
// non-zero, so cron mails somebody: at that point the day's anchor exists
// only on this box, which is the one place it was never meant to be.
//
// WHERE: the panel's list, by URL — so what its Test button proves is what
// happens here. pushTargets() in src/transparencyLog.js says why, and which
// two older arrangements still push by name.
const TARGETS = pushTargets(process.env, CFG);
const REMOTES = TARGETS.map((t) => t.name);

/* THE DEPLOY KEY, WHERE THERE IS ONE. Generated by the panel, kept as a
   file mode 0600 outside the database, and handed to git for this push
   only — nothing here reads it, prints it, or puts it anywhere a log
   line could pick it up. Where no key has been made this is null and git
   behaves exactly as it did before, with whatever credential the service
   user already had. */
const SSH_COMMAND = sshCommandFor(keyPath());
const pushEnv = SSH_COMMAND
  ? { ...process.env, GIT_SSH_COMMAND: SSH_COMMAND, GIT_TERMINAL_PROMPT: '0' }
  : process.env;

const failed = [];
for (const t of TARGETS) {
  try {
    execFileSync('git', ['push', t.target, `HEAD:${CFG.branch}`],
      { cwd: REPO_DIR, env: pushEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`  pushed to ${t.name}`);
  } catch (e) {
    failed.push(t.name);
    console.error(`  !! push to ${t.name} FAILED: ${scrubbed(e.stderr || e.message, t)}`);
  }
}

/* WRITTEN DOWN SO THE PANEL CAN SAY RATHER THAN GUESS. An anchor that
   reached nothing is the one state an operator must not have to read a
   cron mail to discover — the day's proof then exists only on the box it
   was meant to outlive. */
try {
  await recordPush({
    ok: failed.length < REMOTES.length,
    detail: failed.length
      ? `Reached ${REMOTES.length - failed.length} of ${REMOTES.length}. Unreachable: ${failed.join(', ')}.`
      : `Reached all ${REMOTES.length}.`,
  });
} catch (e) {
  // Never fail the anchor over its own bookkeeping. The anchor is the
  // thing that matters; this row is a convenience for a screen.
  console.error(`  (could not record the push result: ${e.message})`);
}

const reached = REMOTES.length - failed.length;
if (failed.length === REMOTES.length) {
  throw new Error(
    `Anchor ${date} committed locally but reached NO remote (${REMOTES.join(', ')}). `
    + 'The day\'s anchor exists only on this box.',
  );
}
if (failed.length) {
  console.error(`\n!! Published to ${reached}/${REMOTES.length} remotes. Unreachable: ${failed.join(', ')}.`);
  console.error('!! Not fatal — the record is public elsewhere and these catch up next run — but fix it.\n');
}

if (committed) {
  console.log(`Anchored and published ${date}: ${rootHash}`);
  console.log(`Snapshot: ${snapshot.report_count} published report(s).`);
} else {
  console.log(`Anchor for ${date} re-pushed to ${reached}/${REMOTES.length} remotes.`);
}

await pool.end();
