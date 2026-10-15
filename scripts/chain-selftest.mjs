/**
 * One chain per logbook, against a real database.
 *
 * The unit suite checks the rules that are pure — where a chain starts, what
 * the checker catches in a file. What needs Postgres is the part where rows
 * from two logbooks are interleaved in one table and each still links only
 * to its own: the insert's lock and its "newest row IN THIS LOGBOOK", the
 * verifier's position check, the daily list of heads, and the chain file an
 * administrator downloads.
 *
 * Run by `npm run test:db` against a throwaway database. Never point it at a
 * database with real reports in it: it writes, and reports cannot be deleted.
 */
import 'dotenv/config';
import crypto from 'node:crypto';

const { pool } = await import('../src/db.js');
const L = await import('../src/logbooks.js');
const { insertReportVersion, normalizeReportFields } = await import('../src/reportCore.js');
const { verifyReport } = await import('../src/verify.js');
const { chainGenesis } = await import('../src/crypto.js');
const { currentHeads, headsDigest, contradictions } = await import('../src/chainHeads.js');
const { buildChainFile, checkChainFile } = await import('../src/chainFile.js');
const { createFromFile, toFile } = await import('../src/logbookFile.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

const DIGEST = 'c'.repeat(64);

async function launched(slug) {
  const made = await L.createLogbook({ title: `Chain ${slug}`, slug });
  await L.addField(made.logbook.id, { kind: 'short_text', label: 'What' });
  await L.launch(made.logbook.id);
  return L.logbookById(made.logbook.id);
}

async function file(lb, what, may = true) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const threadId = crypto.randomUUID();
    const report = await insertReportVersion(client, {
      threadId, correctsId: null, logbookId: lb.id,
      fields: normalizeReportFields({
        logbook: lb.slug, answers: { what }, may_publish: may, may_publish_digest: DIGEST,
      }),
    });
    await client.query('INSERT INTO report_heads (thread_id, current_report_id, moderation_status) VALUES ($1, $2, $3)',
      [threadId, report.id, 'valid']);
    await client.query('COMMIT');
    return report;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

console.log('\ntwo logbooks, interleaved in one table');
const a = await launched('chain-a');
const b = await launched('chain-b');
const empty = await launched('chain-empty');
const a1 = await file(a, 'first in a');
const b1 = await file(b, 'first in b');
const a2 = await file(a, 'second in a', false);
const b2 = await file(b, 'second in b');
const a3 = await file(a, 'third in a');

ok('the first report of each logbook links to that logbook\'s own start',
  a1.prev_chain_hash === chainGenesis('chain-a') && b1.prev_chain_hash === chainGenesis('chain-b'));
ok('and each later one links to the one before it IN ITS OWN LOGBOOK',
  a2.prev_chain_hash === a1.chain_hash && a3.prev_chain_hash === a2.chain_hash
  && b2.prev_chain_hash === b1.chain_hash,
  JSON.stringify({ a2: a2.prev_chain_hash === a1.chain_hash, b2: b2.prev_chain_hash === b1.chain_hash }));
ok('never to the row just before it in the table',
  a2.prev_chain_hash !== b1.chain_hash && b2.prev_chain_hash !== a2.chain_hash);

for (const r of [a1, b1, a2, b2, a3]) {
  const v = await verifyReport(r.public_ref);
  ok(`${r.public_ref} verifies — content, link and position`,
    v.content.ok && v.link.ok && v.position.ok,
    JSON.stringify({ c: v.content.ok, l: v.link.ok, p: v.position.ok }));
}
{
  const v = await verifyReport(a1.public_ref);
  ok('the verify result names the chain and where it starts',
    v.chain.logbook === 'chain-a' && v.chain.genesis === chainGenesis('chain-a') && v.position.is_first);
}

console.log('\na report is always in a logbook');
{
  const client = await pool.connect();
  let threw = null;
  try {
    await insertReportVersion(client, {
      threadId: crypto.randomUUID(), correctsId: null,
      fields: { logbook: 'chain-a', may_publish: true, may_publish_digest: DIGEST },
    });
  } catch (e) { threw = e; } finally { client.release(); }
  ok('an insert with no logbook is refused before it touches the table', !!threw);
}

console.log('\nthe daily list of heads');
const heads = await currentHeads();
const by = Object.fromEntries(heads.map((h) => [h.logbook, h]));
ok('every launched logbook is on the list', by['chain-a'] && by['chain-b'] && by['chain-empty']);
ok('with its latest link and how many reports it holds',
  by['chain-a'].head === a3.chain_hash && by['chain-a'].reports === 3
  && by['chain-b'].head === b2.chain_hash && by['chain-b'].reports === 2);
ok('a launched logbook with no reports yet is listed at its start, with 0',
  by['chain-empty'].head === chainGenesis('chain-empty') && by['chain-empty'].reports === 0);
{
  const draft = await L.createLogbook({ title: 'Not launched', slug: 'chain-draft' });
  const again = await currentHeads();
  ok('a draft is not on it — it has never been public', !again.some((h) => h.logbook === 'chain-draft'));
  await pool.query('DELETE FROM logbooks WHERE id = $1', [draft.logbook.id]);
}

console.log('\nonce listed, always listed, and never shorter');
{
  const digest = headsDigest('2026-11-04', heads);
  const { rows: [anchor] } = await pool.query(
    `INSERT INTO chain_anchors (anchor_date, root_chain_hash, public_log_ref)
     VALUES ('2026-11-04', $1, 'anchors/2026-11-04.json') RETURNING id`, [digest]);
  for (const h of heads) {
    await pool.query(
      'INSERT INTO chain_anchor_heads (anchor_id, logbook_slug, head_chain_hash, report_count) VALUES ($1,$2,$3,$4)',
      [anchor.id, h.logbook, h.head, h.reports]);
  }
  let c = await contradictions(await currentHeads());
  ok('today\'s list agrees with the last published one', !c.dropped.length && !c.shrunk.length, JSON.stringify(c));

  // What deleting reports would look like, simulated on the list rather than
  // on the table (which refuses deletion): a logbook gone, a chain shorter.
  const fewer = (await currentHeads())
    .filter((h) => h.logbook !== 'chain-b')
    .map((h) => (h.logbook === 'chain-a' ? { ...h, reports: 1 } : h));
  c = await contradictions(fewer);
  ok('a logbook missing from the list is named', c.dropped.includes('chain-b'), JSON.stringify(c));
  ok('a chain with fewer reports than was published is named',
    c.shrunk.some((s) => s.logbook === 'chain-a' && s.was === 3 && s.now === 1), JSON.stringify(c));

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM chain_anchor_heads WHERE anchor_id = $1', [anchor.id]);
  let threw = null;
  try { await pool.query('DELETE FROM chain_anchor_heads WHERE anchor_id = $1', [anchor.id]); }
  catch (e) { threw = e; }
  ok('and the published list itself cannot be edited away', !!threw && rows[0].n === heads.length);

  const v = await verifyReport(a2.public_ref);
  ok('a report covered by an anchor says so, with its logbook\'s head that day',
    v.anchor.anchored && v.anchor.logbook_head === a3.chain_hash, JSON.stringify(v.anchor));
}

console.log('\na logbook\'s chain as a file anybody can check');
{
  const complete = await buildChainFile(a.id);
  ok('the complete file carries every report in chain order', complete.kind === 'complete'
    && complete.reports.map((r) => r.public_ref).join() === [a1, a2, a3].map((r) => r.public_ref).join());
  const out = checkChainFile(JSON.parse(JSON.stringify(complete)));
  ok('and checks out end to end, including against its anchor', out.ok && out.head === a3.chain_hash
    && out.anchors.every((x) => x.ok), JSON.stringify(out.problems));

  const published = await buildChainFile(a.id, { publishedOnly: true });
  ok('the published file leaves out the report whose reporter said no',
    published.kind === 'published' && published.reports.length === 2
    && !published.reports.some((r) => r.public_ref === a2.public_ref));
  ok('and each report in it still checks on its own', checkChainFile(published).ok,
    JSON.stringify(checkChainFile(published).problems));
  ok('it says how long the whole chain is, so the gap is visible', published.chain_length === 3);
  ok('a draft has no chain to download', (await buildChainFile((await L.createLogbook({ title: 'd', slug: 'chain-d2' })).logbook.id)) === null);
  await pool.query("DELETE FROM logbooks WHERE slug = 'chain-d2'");
}

console.log('\na logbook as a file');
{
  const f = await toFile(a.id);
  ok('downloading gives the title and the questions', f.title === 'Chain chain-a'
    && f.questions.length === 1 && f.questions[0].key === 'what');
  const made = await createFromFile(f);
  ok('uploading it makes a NEW DRAFT, never joining the existing chain',
    made.ok && made.logbook.state === 'draft' && made.logbook.slug === 'chain-a-2',
    JSON.stringify(made.errors || made.logbook));
  const bad = await createFromFile({ reportlog_logbook: 1, title: 'x', questions: [] });
  ok('a file that is wrong is refused whole, with the reason', !bad.ok && bad.errors.length > 0);
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM logbooks WHERE title = 'x'");
  ok('and nothing of it is left behind', rows[0].n === 0);
}

console.log('\nthe questions, in the chain file');
{
  const lb = await launched('chain-forms');
  const f1 = await file(lb, 'under the first form');
  await L.addField(lb.id, { kind: 'short_text', label: 'Anything else', required: false });
  const f2 = await file(lb, 'under the second form');
  const f3 = await file(lb, 'and the same again');

  const hashes = [f1, f2, f3].map((r) => r.form_id);
  ok('each report row points at a form version', hashes.every(Boolean));
  ok('a question added after launch makes a new version, and only then',
    hashes[0] !== hashes[1] && hashes[1] === hashes[2], JSON.stringify(hashes));

  const built = await buildChainFile(lb.id);
  ok('the chain file carries every version', built.forms.length === 2, String(built.forms.length));
  const checked = checkChainFile(JSON.parse(JSON.stringify(built)));
  ok('and the whole file checks with no database', checked.ok && checked.checked === 3,
    JSON.stringify(checked.problems));
  const pub = await buildChainFile(lb.id, { publishedOnly: true });
  ok('the published file carries them too, and checks', pub.forms.length === 2
    && checkChainFile(JSON.parse(JSON.stringify(pub))).problems.length === 0);

  const tampered = JSON.parse(JSON.stringify(built));
  tampered.forms[0].definition = tampered.forms[0].definition.replace('What', 'Who');
  ok('a question reworded after the fact is caught', !checkChainFile(tampered).ok);

  console.log('\na report filed before forms were sealed');
  const client = await pool.connect();
  let legacy;
  try {
    await client.query('BEGIN');
    const threadId = crypto.randomUUID();
    legacy = await insertReportVersion(client, {
      threadId, correctsId: null, logbookId: lb.id, formId: null,
      fields: normalizeReportFields({
        logbook: lb.slug, answers: { what: 'before forms' }, may_publish: true, may_publish_digest: DIGEST,
      }),
    });
    await client.query('INSERT INTO report_heads (thread_id, current_report_id, moderation_status) VALUES ($1, $2, $3)',
      [threadId, legacy.id, 'valid']);
    await client.query('COMMIT');
  } finally { client.release(); }
  const v = await verifyReport(legacy.public_ref);
  ok('has no form key, and still verifies', !('logbook_form' in v.hashed_fields)
    && v.content.ok && v.link.ok && v.position.ok && legacy.form_id === null);
  ok('and the chain it sits in still checks',
    checkChainFile(JSON.parse(JSON.stringify(await buildChainFile(lb.id)))).ok);

  let foreign = null;
  const c2 = await pool.connect();
  try {
    await c2.query('BEGIN');
    await insertReportVersion(c2, {
      threadId: crypto.randomUUID(), correctsId: null, logbookId: lb.id, formId: (await pool.query(
        "SELECT id FROM logbook_forms WHERE logbook_id <> $1 LIMIT 1", [lb.id])).rows[0]?.id,
      fields: normalizeReportFields({
        logbook: lb.slug, answers: { what: 'x' }, may_publish: true, may_publish_digest: DIGEST }),
    });
  } catch (e) { foreign = e; } finally { await c2.query('ROLLBACK'); c2.release(); }
  ok('another logbook\'s form version cannot be sealed into this one', !!foreign);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
