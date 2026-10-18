/**
 * Export the whole archive, replay it into an empty one, and check that
 * every report comes out with the fingerprint it went in with.
 *
 * WHY THIS HAD TO EXIST. `scripts/export-archive.js` and
 * `scripts/import-archive.js` are the archive's claim to be portable — the
 * answer to "what if this operator disappears" — and nothing has ever
 * exercised the pair. They are also the worst possible place for a silent
 * fault: a replay that rebuilds a report's hashed object even slightly
 * differently produces a different content hash, which means every proof
 * over that report is void, and nothing in either script would say so. The
 * failure surfaces years later, in the one situation the whole design exists
 * for.
 *
 * It became urgent with migration 033. A version's files are now named by
 * `report_attachments` rather than by `attachments.report_id`, so the
 * importer has to rebuild each version's manifest from what that version
 * CARRIED, inherited files included. Building it from the files that arrived
 * with the version — which is what the exporter used to record, and all it
 * used to record — replays a corrected report with a shorter manifest than
 * the original had, and a content hash that no longer matches.
 *
 * WHAT IT DOES. Creates a second scratch database beside this one, migrates
 * it, exports, imports, and compares the two archives report by report:
 * every content hash, every chain hash, every manifest, and then re-verifies
 * each replayed report with the ordinary verifier so the comparison is not
 * just one query agreeing with itself.
 *
 * Run by `npm run test:db`, late, once the rest of the suite has filed
 * reports with files and corrections among them.
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

const url = process.env.DATABASE_URL;

// Same cluster, different database. Copied from db-selftest.js rather than
// imported because that file is a runner with top-level side effects.
function withDatabase(conn, name) {
  const q = conn.indexOf('?');
  const base = q === -1 ? conn : conn.slice(0, q);
  const query = q === -1 ? '' : conn.slice(q);
  return base.replace(/\/[^/]*$/, '/' + name) + query;
}

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => resolve({ code: code ?? 1, out }));
    p.on('error', (e) => resolve({ code: 1, out: String(e.message) }));
  });
}

const replicaName = `reportlog_replay_${process.pid}`;
const replica = withDatabase(url, replicaName);
const adminPool = new pg.Pool({ connectionString: withDatabase(url, 'postgres') });
const source = new pg.Pool({ connectionString: url });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reportlog-roundtrip-'));
const dump = path.join(tmp, 'archive.json');

let replicaPool = null;
let created = false;

async function cleanup() {
  if (replicaPool) await replicaPool.end().catch(() => {});
  if (created) {
    await adminPool.query(`DROP DATABASE IF EXISTS "${replicaName}" WITH (FORCE)`).catch(() => {});
  }
  await adminPool.end().catch(() => {});
  await source.end().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}

try {
  // Only worth running where there is something to replay. An empty archive
  // round-trips trivially and would report a green that means nothing.
  const { rows: [{ n: sourceCount }] } = await source.query('SELECT count(*)::int AS n FROM reports');
  if (!sourceCount) {
    console.log('  --   no reports in this database, so nothing to round-trip');
    console.log('\n0 passed, 0 failed');
    await cleanup();
    process.exit(0);
  }

  await adminPool.query(`CREATE DATABASE "${replicaName}"`);
  created = true;

  const childEnv = { ...process.env, DATABASE_URL: replica };
  const migrated = await run(process.execPath, ['scripts/migrate.js'], childEnv);
  ok('a second database migrates from nothing', migrated.code === 0, migrated.out.slice(-300));

  const exported = await run(process.execPath, ['scripts/export-archive.js', dump], process.env);
  ok('the archive exports', exported.code === 0, exported.out.slice(-300));
  ok('and the export names its file links', /file links\s+\d+/.test(exported.out),
    'migration 033 added them; an export without them replays corrections with no files');

  const imported = await run(process.execPath, ['scripts/import-archive.js', dump], childEnv);
  ok('and replays into the empty one', imported.code === 0, imported.out.slice(-400));

  if (imported.code !== 0) throw new Error('import failed, so there is nothing to compare');

  replicaPool = new pg.Pool({ connectionString: replica });

  // ------------------------------------------------------------------
  // THE COMPARISON. Keyed on public_ref, which is carried across by the
  // replay — ids are reassigned by the sequence and must not be compared.
  // ------------------------------------------------------------------
  const shape = `SELECT public_ref, content_hash, chain_hash, prev_chain_hash,
                        corrects_id IS NOT NULL AS is_correction
                 FROM reports ORDER BY public_ref`;
  const before = (await source.query(shape)).rows;
  const after = (await replicaPool.query(shape)).rows;

  ok('every report came across', before.length === after.length,
    `${before.length} in, ${after.length} out`);

  const byRef = new Map(after.map((r) => [r.public_ref, r]));
  let hashMismatch = 0; let chainMismatch = 0; let missing = 0;
  for (const b of before) {
    const a = byRef.get(b.public_ref);
    if (!a) { missing += 1; continue; }
    if (a.content_hash !== b.content_hash) hashMismatch += 1;
    if (a.chain_hash !== b.chain_hash) chainMismatch += 1;
  }
  ok('no report went missing', missing === 0, `${missing} missing`);
  ok('EVERY CONTENT HASH IS IDENTICAL', hashMismatch === 0,
    `${hashMismatch} of ${before.length} reports hash differently after a replay`);
  ok('and every chain hash with it', chainMismatch === 0, `${chainMismatch} differ`);

  // The corrections are the interesting ones, and the reason this file
  // exists. Asserted separately so a replay that only got the simple
  // reports right cannot read as a pass.
  const corrections = before.filter((r) => r.is_correction);
  ok('there were corrections in the archive to test', corrections.length > 0,
    'without one this check proves nothing about migration 033');
  const correctionMismatch = corrections
    .filter((b) => byRef.get(b.public_ref)?.content_hash !== b.content_hash).length;
  ok('every correction replays to the same hash', correctionMismatch === 0,
    `${correctionMismatch} of ${corrections.length} corrections differ`);

  // ------------------------------------------------------------------
  // The manifests, read through the link table on both sides.
  // ------------------------------------------------------------------
  const manifests = `SELECT r.public_ref, a.ordinal, a.sha256, a.byte_size::text, a.media_type
                     FROM reports r
                     JOIN report_attachments ra ON ra.report_id = r.id
                     JOIN attachments a ON a.id = ra.attachment_id
                     ORDER BY r.public_ref, a.ordinal`;
  const mBefore = (await source.query(manifests)).rows;
  const mAfter = (await replicaPool.query(manifests)).rows;
  ok('there were files in the archive to test', mBefore.length > 0,
    'without one the manifest comparison proves nothing');
  ok('every version carries the same files afterwards',
    JSON.stringify(mBefore) === JSON.stringify(mAfter),
    `${mBefore.length} links in, ${mAfter.length} out`);

  // ------------------------------------------------------------------
  // And the verifier's own opinion, not just two queries agreeing.
  // ------------------------------------------------------------------
  const verifying = await run(process.execPath, ['-e', `
    const { pool } = await import('./src/db.js');
    const { verifyReport } = await import('./src/verify.js');
    const { rows } = await pool.query('SELECT public_ref FROM reports ORDER BY id');
    let bad = 0;
    for (const r of rows) {
      const v = await verifyReport(r.public_ref);
      if (!(v.content.ok && v.link.ok && v.position.ok)) bad += 1;
    }
    console.log('BAD=' + bad + ' OF=' + rows.length);
    await pool.end();
  `], childEnv);
  const m = /BAD=(\d+) OF=(\d+)/.exec(verifying.out);
  ok('the replayed archive verifies end to end', m && m[1] === '0' && Number(m[2]) > 0,
    m ? `${m[1]} of ${m[2]} failed` : verifying.out.slice(-300));
} catch (e) {
  fail += 1;
  console.log('  FAIL the round-trip threw — ' + String(e.message));
} finally {
  await cleanup();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
