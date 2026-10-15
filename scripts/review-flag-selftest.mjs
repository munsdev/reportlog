/**
 * The review flag, against a real database.
 *
 * WHAT IS ONLY TRUE ONCE A REPORT EXISTS: that a flag is raised in the same
 * transaction as the report, that a correction gets its own look, that
 * clearing records who and does not delete, and — the one that decides
 * whether the feature is usable at all — that a reporter's PROSE is read
 * and their CHOICES are not.
 *
 * The matching itself is pure and lives in scripts/selftest.js.
 *
 *   DATABASE_URL="postgres://…/scratch" node scripts/review-flag-selftest.mjs
 */
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to a scratch database with the migrations applied.');
  process.exit(2);
}
process.env.TIER_B_ENCRYPTION_KEY ||= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.CONTACT_HMAC_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SITE_ORIGIN ||= 'http://localhost:3000';
const { pool } = await import('../src/db.js');
const F = await import('../src/reviewFlags.js');
const K = await import('../src/reviewKeywords.js');
const { insertReportVersion, normalizeReportFields } = await import('../src/reportCore.js');
const L = await import('../src/logbooks.js');
const crypto = await import('node:crypto');
// The hash of the consent wording the reporter was actually shown. Any
// 64-hex value will do here: this suite is about the flag, not the seal.
const DIGEST = 'c'.repeat(64);
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (x ? ' — ' + x : ''))); };

await pool.query('INSERT INTO site_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING');
// The shipped set, not whatever an earlier script left behind.
await pool.query('UPDATE site_settings SET review_keywords = NULL WHERE id = true');

// A logbook with a prose question AND a choice whose option is itself a
// keyword — the trap this feature has to avoid.
const lbOut = await L.createLogbook({ title: 'Flag test', slug: 'flag-test', blurb: '' });
const LB = lbOut.ok ? lbOut.logbook : await L.logbookBySlug('flag-test');
const lbId = LB.id;
for (const f of [
  { key: 'account', kind: 'long_text', label: 'What happened?', required: true },
  { key: 'outcome', kind: 'choice_one', label: 'What was the outcome?', required: false,
    settings: { options: ['Turned away', 'Allowed to vote'] } },
]) {
  await L.addField(lbId, f);
}
await L.launch(lbId);

const fileReport = async (answers) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const threadId = crypto.randomUUID();
    const report = await insertReportVersion(client, {
      threadId,
      correctsId: null,
      fields: normalizeReportFields({ logbook: 'flag-test', answers, may_publish: true, may_publish_digest: DIGEST }),
      logbookId: lbId,
    });
    await client.query(
      'INSERT INTO report_heads (thread_id, current_report_id) VALUES ($1, $2)',
      [threadId, report.id],
    );
    const flag = await F.flagReport(client, {
      reportId: report.id, threadId, logbookId: lbId, answers: report.answers,
    });
    await client.query('COMMIT');
    return { threadId, report, flag };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
};

console.log('\nwhat gets read');
const a = await fileReport({ account: 'The judge turned me away and the police were called.' });
ok('prose that matches raises a flag', a.flag.flagged === true);
ok('and the flag records which terms fired, not just that one did',
  a.flag.terms.includes('turned me away') && a.flag.terms.includes('the judge'),
  a.flag.terms.join(', '));

const b = await fileReport({ account: 'The queue moved quickly and everyone was polite.' });
ok('prose that matches nothing raises none', b.flag.flagged === false);

// THE TRAP. An operator wrote a choice called "Turned away"; every report
// ticking it would be flagged, which is a term firing on half of what
// arrives — exactly the failure that makes an operator switch the flag off.
const c = await fileReport({
  account: 'Nothing unusual happened and I voted without trouble.',
  outcome: 'Turned away',
});
ok('A CHOICE THE OPERATOR WROTE IS NOT MATCHED', c.flag.flagged === false,
  'matching the form\'s own wording flags every report that ticked it');

console.log('\nthe projection the board reads');
let { rows } = await pool.query('SELECT needs_review FROM report_heads WHERE thread_id = $1', [a.threadId]);
ok('a flagged report is marked on its head', rows[0].needs_review === true);
({ rows } = await pool.query('SELECT needs_review FROM report_heads WHERE thread_id = $1', [b.threadId]));
ok('and an unflagged one is not', rows[0].needs_review === false);

const standing = await F.flagForThread(a.threadId);
ok('the flag can be read back for the thread', standing && standing.terms.length > 0);
ok('and is open until somebody clears it', standing.cleared_at === null);

console.log('\na correction gets its own look');
// Text that was unremarkable in the original and alarming in the
// correction must not pass because the thread had already been seen.
const d = await fileReport({ account: 'Nothing much to report, it was quiet.' });
ok('the original is unflagged', d.flag.flagged === false);
{
  const client = await pool.connect();
  await client.query('BEGIN');
  const corrected = await insertReportVersion(client, {
    threadId: d.threadId,
    correctsId: d.report.id,
    fields: normalizeReportFields({
      logbook: 'flag-test',
      answers: { account: 'On reflection I was threatened and I am scared.' },
      may_publish: true,
      may_publish_digest: DIGEST,
    }),
    logbookId: lbId,
  });
  await client.query('UPDATE report_heads SET current_report_id = $1 WHERE thread_id = $2',
    [corrected.id, d.threadId]);
  const flag = await F.flagReport(client, {
    reportId: corrected.id, threadId: d.threadId, logbookId: lbId, answers: corrected.answers,
  });
  await client.query('COMMIT');
  client.release();
  ok('THE CORRECTION IS FLAGGED THOUGH THE ORIGINAL WAS NOT', flag.flagged === true,
    'a thread already seen would otherwise carry new text past review');
  const now = await F.flagForThread(d.threadId);
  ok('and the flag read back is the correction\'s, not the original\'s',
    now && now.terms.includes('threatened'), now ? now.terms.join(', ') : 'none');
}

console.log('\nclearing it');
let out = await F.clearFlag(a.threadId, { byEmail: 'mod@example.org' });
ok('a moderator can say they have read it', out.ok === true && out.cleared === 1);
({ rows } = await pool.query('SELECT needs_review FROM report_heads WHERE thread_id = $1', [a.threadId]));
ok('the marker comes off the head', rows[0].needs_review === false);

const cleared = await F.flagForThread(a.threadId);
ok('BUT THE FLAG IS STILL THERE, cleared rather than deleted', cleared !== null,
  'the question an operator will ask is how many were worth raising');
ok('with who cleared it', cleared.cleared_by === 'mod@example.org');
ok('and when', cleared.cleared_at !== null);

out = await F.clearFlag(a.threadId, { byEmail: null });
ok('an anonymous clear is refused', out.ok === false);

out = await F.clearFlag(a.threadId, { byEmail: 'other@example.org' });
ok('clearing twice clears nothing more, and does not rewrite who read it',
  out.cleared === 0);
const twice = await F.flagForThread(a.threadId);
ok('so the first reader keeps their name on it', twice.cleared_by === 'mod@example.org');

console.log('\nthe operator\'s list is what is used');
await K.setReviewKeywords(['turned me away'], { byEmail: 'moderator@example.org' });
const e = await fileReport({ account: 'He had a gun and I was terrified.' });
ok('a term the operator CUT does not fire', e.flag.flagged === false,
  'the shipped list is still being consulted');
const f2 = await fileReport({ account: 'They turned me away at the door.' });
ok('and one they kept does', f2.flag.flagged === true);

// An operator choosing no keyword matching at all must get none, rather
// than silently falling back to the shipped set.
await K.setReviewKeywords([], { byEmail: 'moderator@example.org' });
const g = await fileReport({ account: 'The judge turned me away and I was threatened.' });
ok('AN EMPTY LIST FLAGS NOTHING, which is a real choice', g.flag.flagged === false);

console.log('\nwhat it never does');
ok('a flag writes nothing into the report row',
  !('needs_review' in a.report) && !('review_terms' in a.report),
  'a queue marker in the hashed row would make a report verify differently');
const open = await F.openFlagCount();
ok('the open queue can be counted', typeof open === 'number' && open >= 1, String(open));

await K.setReviewKeywords(null, { byEmail: null });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end(); process.exit(fail ? 1 : 0);
