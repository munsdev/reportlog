/**
 * Asking a reporter for evidence, against a real database.
 *
 * THE THREE GATES ARE THE WHOLE POINT, and none of them can be tested
 * without rows: a request needs a report that DECLARED something and a
 * reporter who GRANTED the permission, and the link has to stop working
 * when it is spent, when it expires, when it is withdrawn — and, the one
 * that matters most, WHEN THE REPORTER TAKES THE PERMISSION BACK.
 *
 * A door that outlived the permission that opened it would make "switch
 * this off and they stop asking" a lie, and that promise is on the
 * reporter's own page.
 *
 *   DATABASE_URL="postgres://…/scratch" node scripts/evidence-request-selftest.mjs
 */
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to a scratch database with the migrations applied.');
  process.exit(2);
}
process.env.TIER_B_ENCRYPTION_KEY ||= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.CONTACT_HMAC_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SITE_ORIGIN ||= 'http://localhost:3000';
const { pool } = await import('../src/db.js');
const ER = await import('../src/evidenceRequests.js');
const P = await import('../src/reportPermissions.js');
const { insertReportVersion, normalizeReportFields } = await import('../src/reportCore.js');
const L = await import('../src/logbooks.js');
const crypto = await import('node:crypto');
const DIGEST = 'd'.repeat(64);
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (x ? ' — ' + x : ''))); };

// A logbook that asks the declaration and a follow-up conditional on it.
const made = await L.createLogbook({ title: 'Evidence test', slug: 'ev-test', blurb: '' });
const LB = made.ok ? made.logbook : await L.logbookBySlug('ev-test');
const lbId = LB.id;
if (!(await L.fieldsFor(lbId)).length) {
  await L.addField(lbId, { key: 'account', kind: 'long_text', label: 'What happened?', required: true });
  await L.addField(lbId, {
    key: 'has_evidence', kind: 'evidence_declaration',
    label: 'Do you have photos or video?', required: false,
  });
  await L.addField(lbId, {
    key: 'evidence_of', kind: 'short_text', label: 'What is it of?', required: false,
    shown_when: { field: 'has_evidence', in: ['yes'] },
  });
  await L.launch(lbId);
}

const file = async (answers) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const threadId = crypto.randomUUID();
    const report = await insertReportVersion(client, {
      threadId,
      correctsId: null,
      fields: normalizeReportFields({
        logbook: 'ev-test', answers, may_publish: true, may_publish_digest: DIGEST,
      }),
      logbookId: lbId,
    });
    await client.query(
      'INSERT INTO report_heads (thread_id, current_report_id) VALUES ($1, $2)',
      [threadId, report.id],
    );
    await client.query('COMMIT');
    return { threadId, report };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
};

const grant = (threadId, granted) => P.setPermission({
  threadId, permission: P.EVIDENCE_REQUEST, granted, actorEmail: null, reason: null,
});

console.log('\nwho may be asked');
const declared = await file({ account: 'A long queue outside.', has_evidence: true, evidence_of: '30s of the queue' });
const silent = await file({ account: 'A long queue outside.' });

let state = await ER.askableState(declared.threadId);
ok('a report that declared but has not granted cannot be asked',
  state.ok === false && state.reason === 'not-permitted', state.reason);
ok('and the moderator is told WHICH half is missing',
  state.declared === true && state.permitted === false);

await grant(silent.threadId, true);
state = await ER.askableState(silent.threadId);
ok('a report that granted but declared nothing cannot be asked either',
  state.ok === false && state.reason === 'nothing-declared',
  'the permission is consent to be asked for what somebody mentioned, not an open channel');

await grant(declared.threadId, true);
state = await ER.askableState(declared.threadId);
ok('BOTH HALVES TRUE, and now it can be asked', state.ok === true);

console.log('\nasking');
let out = await ER.createRequest(declared.threadId, { message: 'x', byEmail: 'mod@example.org' });
ok('a request with no words is refused', out.ok === false && out.reason === 'message-short',
  'a mail with no words reads like a phishing attempt');

out = await ER.createRequest(declared.threadId, {
  message: 'Could you send the thirty seconds of the queue you mentioned?',
  byEmail: 'mod@example.org',
});
ok('a real request is created', out.ok === true && typeof out.token === 'string');
const TOKEN = out.token;
ok('and hands back the token exactly once', TOKEN.length === 48);

const { rows: stored } = await pool.query(
  'SELECT token_hash, asked_by FROM evidence_requests WHERE id = $1', [out.request.id]);
ok('THE TOKEN IS NOT STORED IN THE CLEAR', stored[0].token_hash !== TOKEN
  && stored[0].token_hash.length === 64,
  'a reader of this table would otherwise hold working links');
ok('and who asked is on the record', stored[0].asked_by === 'mod@example.org');

const second = await ER.createRequest(declared.threadId, {
  message: 'And anything else you have, if you can.', byEmail: 'mod@example.org',
});
ok('ONE LIVE REQUEST PER THREAD', second.ok === false && second.reason === 'already-open',
  'two open links is two ways to spend one ask, and the reporter cannot tell which mail is current');

console.log('\nthe door');
let r = await ER.redeem(TOKEN);
ok('the link opens', r.ok === true);
ok('and carries what was asked, in the moderator\'s words',
  /thirty seconds/.test(r.request.message));
ok('and which report it is about', r.request.threadId === declared.threadId);

ok('a token of the wrong shape is refused without a query',
  (await ER.redeem('nope')).reason === 'bad-token');
ok('and an unknown one is simply not found',
  (await ER.redeem('a'.repeat(48))).reason === 'not-found');

console.log('\nthe permission is the ceiling, read at use');
await grant(declared.threadId, false);
r = await ER.redeem(TOKEN);
ok('TAKING THE PERMISSION BACK CLOSES A LINK ALREADY SENT',
  r.ok === false && r.reason === 'permission-withdrawn',
  'a door that outlived the permission would make the reporter\'s own switch a lie');
await grant(declared.threadId, true);
ok('and giving it again reopens the same link', (await ER.redeem(TOKEN)).ok === true);

console.log('\nspending it');
const client = await pool.connect();
await client.query('BEGIN');
const firstUse = await ER.markUsed(client, {
  requestId: out.request.id, reportId: declared.report.id,
});
const secondUse = await ER.markUsed(client, {
  requestId: out.request.id, reportId: declared.report.id,
});
await client.query('COMMIT');
client.release();
ok('the first use wins', firstUse === true);
ok('AND THE SECOND LOSES, so two clicks cannot both create a version',
  secondUse === false);
r = await ER.redeem(TOKEN);
ok('a spent link does not open again', r.ok === false && r.reason === 'used');

console.log('\nwithdrawing an ask');
const again = await ER.createRequest(declared.threadId, {
  message: 'Sorry, one more thing if you can manage it.', byEmail: 'mod@example.org',
});
ok('a new request can be made once the last is spent', again.ok === true);
let cancelled = await ER.cancelRequest(declared.threadId, { byEmail: 'mod@example.org' });
ok('it can be withdrawn', cancelled.cancelled === 1);
ok('and the link stops working', (await ER.redeem(again.token)).reason === 'cancelled');
cancelled = await ER.cancelRequest(declared.threadId, { byEmail: null });
ok('an anonymous withdrawal is refused', cancelled.ok === false);

const history = await ER.requestHistory(declared.threadId);
ok('EVERY ASK IS STILL ON THE RECORD, spent and withdrawn alike',
  history.length === 2 && history.some((h) => h.used_at) && history.some((h) => h.cancelled_at),
  'withdrawing stops the link; the record of having asked is what should survive it');
ok('and none of them leaks a token', history.every((h) => !('token_hash' in h)));

console.log('\nexpiry');
const old = await ER.createRequest(declared.threadId, {
  message: 'This one will be aged out by the test.', byEmail: 'mod@example.org',
});
await pool.query("UPDATE evidence_requests SET expires_at = now() - interval '1 day' WHERE id = $1",
  [old.request.id]);
ok('an expired link does not open', (await ER.redeem(old.token)).reason === 'expired');

console.log('\na withdrawn report');
// Start clean: the ask above is still live, and a thread may hold only one.
await ER.cancelRequest(declared.threadId, { byEmail: 'mod@example.org' });
const forWithdrawn = await ER.createRequest(declared.threadId, {
  message: 'Asked just before the reporter withdrew the whole report.',
  byEmail: 'mod@example.org',
});
ok('a request can be made while the report stands', forWithdrawn.ok === true);
await pool.query('UPDATE report_heads SET withdrawn = true WHERE thread_id = $1', [declared.threadId]);
const onWithdrawn = await ER.redeem(forWithdrawn.token);
ok('A LINK TO A WITHDRAWN REPORT DOES NOT OPEN',
  onWithdrawn.ok === false && onWithdrawn.reason === 'report-withdrawn',
  'the reporter may have withdrawn it since being asked, and in that order the ask is overtaken');
await pool.query('UPDATE report_heads SET withdrawn = false WHERE thread_id = $1', [declared.threadId]);
ok('and works again if they restore it', (await ER.redeem(forWithdrawn.token)).ok === true);
await ER.cancelRequest(declared.threadId, { byEmail: 'mod@example.org' });

console.log('\nan expired ask does not lock the report');
// THE BUG 043 FIXED, pinned so it cannot come back: the one-live-request
// index could not test expires_at against now(), so the first request to
// age out blocked every later one and the moderator was told to withdraw
// something that had already stopped working.
const stale = await ER.createRequest(declared.threadId, {
  message: 'This one is about to be aged out by the test.', byEmail: 'mod@example.org',
});
await pool.query("UPDATE evidence_requests SET expires_at = now() - interval '1 day' WHERE id = $1",
  [stale.request.id]);
ok('an open-but-expired request is not reported as open',
  (await ER.openRequestFor(declared.threadId)) === null);
const afterStale = await ER.createRequest(declared.threadId, {
  message: 'And this is the next ask, which must be allowed.', byEmail: 'mod@example.org',
});
ok('AND THE NEXT ASK IS ALLOWED', afterStale.ok === true, afterStale.reason);
const { rows: stamped } = await pool.query(
  'SELECT expired_at FROM evidence_requests WHERE id = $1', [stale.request.id]);
ok('the stale one is stamped as expired rather than withdrawn by somebody',
  stamped[0].expired_at !== null);
await ER.cancelRequest(declared.threadId, { byEmail: 'mod@example.org' });

console.log('\nwhat the reporter sends becomes a version of the report');
/* THE INVARIANT WORTH THE MOST ON THIS PATH: the answers are carried
   forward untouched. The reporter was asked for files, not invited to
   revise their account, and nothing here may change a word of it.

   Slots are inserted directly rather than uploaded, because a real upload
   needs a bucket and the media worker; what is under test is the version
   this produces, not the storage. */
{
  const target = await file({
    account: 'They turned the queue away at six.',
    has_evidence: true,
    evidence_of: 'Thirty seconds of the queue',
  });
  await grant(target.threadId, true);
  const asked = await ER.createRequest(target.threadId, {
    message: 'Could you send the thirty seconds you mentioned?', byEmail: 'mod@example.org',
  });

  const draft = crypto.createHash('sha256')
    .update(`${asked.token}:evidence-upload`, 'utf8').digest('hex').slice(0, 48);
  const slotToken = crypto.randomBytes(24).toString('hex');
  await pool.query(
    `INSERT INTO upload_slots (slot_token, draft_token, declared_name, declared_type,
                               declared_size, staging_key, expires_at, logbook_id,
                               evidence_request_id, status, media_type, byte_size, sha256,
                               storage_key)
     VALUES ($1,$2,'clip.mp4','video/mp4',1024,'staging/x',now() + interval '1 day',$3,$4,
             'clean','video/mp4',1024,$5,'final/x')`,
    [slotToken, draft, lbId, asked.request.id, 'e'.repeat(64)],
  );

  const before = await pool.query('SELECT answers, content_hash FROM reports WHERE id = $1',
    [target.report.id]);
  const slots = await (await import('../src/attachments.js')).clearedSlotsFor(draft);
  ok('the staged file is seen as ready to commit', slots.length === 1, String(slots.length));

  const c2 = await pool.connect();
  await c2.query('BEGIN');
  await ER.markUsed(c2, { requestId: asked.request.id, reportId: target.report.id });
  const done = await ER.attachEvidence(c2, { threadId: target.threadId, slots });
  if (done.ok) await ER.markLanded(c2, { requestId: asked.request.id, reportId: done.report.id });
  await c2.query('COMMIT');
  c2.release();

  ok('a new version of the report is created', done.ok === true, done.reason);
  ok('and it CORRECTS the version before it rather than replacing it',
    String(done.report.corrects_id) === String(target.report.id));

  // The whole point. Not re-validated, not rebuilt — the same object.
  ok('THE ANSWERS ARE CARRIED FORWARD BYTE FOR BYTE',
    JSON.stringify(done.report.answers) === JSON.stringify(before.rows[0].answers),
    JSON.stringify(done.report.answers));
  ok('so the new version hashes differently only because its files changed',
    done.report.content_hash !== before.rows[0].content_hash,
    'the manifest is in the hashed object, so adding a file must change it');

  const { rows: headNow } = await pool.query(
    'SELECT current_report_id FROM report_heads WHERE thread_id = $1', [target.threadId]);
  ok('and the head moves to it', String(headNow[0].current_report_id) === String(done.report.id));

  const links = await pool.query(
    'SELECT count(*)::int n FROM report_attachments WHERE report_id = $1', [done.report.id]);
  ok('the file is linked to the new version', links.rows[0].n === 1, String(links.rows[0].n));

  const { rows: spent } = await pool.query(
    'SELECT used_at, used_report_id FROM evidence_requests WHERE id = $1', [asked.request.id]);
  ok('the request is spent', spent[0].used_at !== null);
  ok('and points at the version the files LANDED on, not the one asked about',
    String(spent[0].used_report_id) === String(done.report.id),
    'markUsed can only know the old one; markLanded corrects it');

  const { rows: log } = await pool.query(
    "SELECT action, actor_email FROM self_service_log WHERE thread_id = $1 AND action = 'evidence'",
    [target.threadId]);
  ok('it is on the self-service log as the reporter\'s own act', log.length === 1);
  ok('WITH NO ADDRESS AGAINST IT', log[0].actor_email === null,
    'self_service_log is append-only, so an address here would outlive an erasure');

  ok('the link will not open again', (await ER.redeem(asked.token)).reason === 'used');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end(); process.exit(fail ? 1 : 0);
