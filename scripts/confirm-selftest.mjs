/**
 * Submitting a report, and then CONFIRMING it, against a real app.
 *
 * WHY THIS EXISTS, stated first because the gap it fills was three days
 * long: every suite stopped at the POST. The browser suite checks that the
 * form shows its "check your email" receipt; the database suite checks the
 * hashing and the chain by calling insertReportVersion directly. Nothing
 * walked the confirmation link, so when `createReportFromToken` started
 * throwing a ReferenceError on every single confirm, all three suites
 * stayed green while the deployment could not accept a report at all.
 *
 * The lesson is narrow and worth writing down: a path that runs only when a
 * human clicks a link in an email is exactly the path no test reaches by
 * accident. It has to be aimed at.
 *
 * Run it through the database suite, which provides the app and the schema:
 *
 *   npm run test:db
 *
 * It writes reports. Never point it at a deployment.
 */
import 'dotenv/config';
import pg from 'pg';
import { randomBytes } from 'node:crypto';

const BASE = process.env.BASE || 'http://localhost:3000';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { verifyReport } = await import('../src/verify.js');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};
const verifies = (v) => v?.content?.ok === true && v?.link?.ok === true;

const post = (path, body) => fetch(`${BASE}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

/** The token the confirmation email would have carried. */
async function tokenFor(email) {
  const { rows } = await pool.query(
    'SELECT token FROM report_submission_tokens WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
    [email],
  );
  return rows[0]?.token;
}
const confirm = (token) => fetch(`${BASE}/api/reports/confirm/${token}`)
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const digest = await fetch(`${BASE}/api/reports/consent-text`)
  .then((r) => r.json()).then((d) => d.digest);
const spine = (extra) => ({
  consent: true,
  may_publish: true,
  may_publish_digest: digest,
  ...extra,
});

/* ---- there is no form without a logbook ------------------------------- */
console.log('\na report must name a logbook');
{
  const email = `confirm-nolog-${Date.now()}@example.org`;
  const sent = await post('/api/reports', spine({ email, narrative: 'An account with nowhere to go.' }));
  ok('a submission that names no logbook is refused', sent.status === 400
    && /logbook/i.test((sent.body.errors || []).join(' ')), JSON.stringify(sent.body));
  ok('and no confirmation is staged for it', !(await tokenFor(email)));
}

/* ---- a report filed through a logbook --------------------------------- */
console.log('\na report filed through a logbook');

{
  const slug = `intake-${Date.now().toString(36)}`;
  const { rows: made } = await pool.query(
    `INSERT INTO logbooks (slug, title, launched_at) VALUES ($1, $2, now()) RETURNING id`,
    [slug, 'A logbook for the confirm test'],
  );
  const logbookId = made[0].id;
  await pool.query(
    `INSERT INTO logbook_fields (logbook_id, key, kind, label, required, position)
     VALUES ($1,'what_happened','short_text','What happened?',true,1),
            ($1,'when_was_it','date','When was it?',false,2)`,
    [logbookId],
  );

  const email = `confirm-logbook-${Date.now()}@example.org`;
  const sent = await post('/api/reports', spine({
    email,
    logbook: slug,
    answers: { what_happened: 'The door was locked', when_was_it: '2026-09-11' },
  }));
  ok('a logbook submission is accepted', sent.status === 202, JSON.stringify(sent.body));

  const token = await tokenFor(email);
  const done = await confirm(token);
  ok('and confirming it creates the report', done.body.status === 'created',
    JSON.stringify(done.body));

  const { rows } = await pool.query(
    `SELECT logbook_id, answers FROM reports WHERE public_ref = $1`, [done.body.publicRef]);
  const row = rows[0] || {};

  // THE BUG THIS WHOLE BRANCH WAS HELD BACK FOR. The answers used to
  // validate, send their confirmation email, and then vanish.
  ok('THE ANSWERS ARE WRITTEN INTO THE ROW',
    row?.answers?.what_happened === 'The door was locked', JSON.stringify(row?.answers));
  ok('and so is which logbook asked', String(row?.logbook_id) === String(logbookId),
    `${row?.logbook_id} vs ${logbookId}`);

  const v = done.body.publicRef ? await verifyReport(done.body.publicRef) : null;
  const sealed = v?.hashed_fields || {};
  ok('it verifies', verifies(v), JSON.stringify(v?.content));
  ok('and the seal names the logbook by its slug, not its id',
    sealed.logbook === slug, JSON.stringify(sealed.logbook));
  ok('and carries the answers', Boolean(sealed.answers), JSON.stringify(sealed.answers));
  ok('and nothing else: no built-in question is sealed, only the version of the form',
    Object.keys(sealed).sort().join() === ['answers', 'corrects_id', 'logbook', 'logbook_form',
      'may_publish', 'may_publish_digest', 'public_ref', 'received_at', 'thread_id'].join(),
    Object.keys(sealed).join(','));

  // A second click on the same link — a mail client prefetching the URL,
  // then the reader clicking it — must not produce a second report.
  {
    const twice = `confirm-twice-${Date.now()}@example.org`;
    await post('/api/reports', spine({ email: twice, logbook: slug, answers: { what_happened: 'Once' } }));
    const t = await tokenFor(twice);
    const first = await confirm(t);
    const second = await confirm(t);
    ok('a second click does not file the report again',
      first.body.status === 'created' && second.body.status !== 'created',
      `${first.body.status} then ${second.body.status}`);
  }

  // A required question left out is refused before anything is staged.
  {
    const missing = `confirm-missing-${Date.now()}@example.org`;
    const r = await post('/api/reports', spine({ email: missing, logbook: slug, answers: { when_was_it: '2026-09-11' } }));
    ok('a report missing a required answer is refused', r.status === 400, JSON.stringify(r.body));
    ok('and nothing is staged for it', !(await tokenFor(missing)));
  }

  // Closed rather than deleted: a report points at it, and the foreign key
  // refuses the delete for exactly the right reason.
  await pool.query('UPDATE logbooks SET closed_at = now() WHERE id = $1', [logbookId]);
  {
    const late = `confirm-late-${Date.now()}@example.org`;
    const r = await post('/api/reports', spine({ email: late, logbook: slug, answers: { what_happened: 'Too late' } }));
    ok('a closed logbook refuses a new report, and says why', r.status === 503
      && /closed/.test((r.body.errors || []).join(' ')), JSON.stringify(r.body));
  }
}

/* ---- the form a reporter was asked ------------------------------------ */
console.log('\nthe questions a report was answered against');

/* A report seals the hash of the form it was ANSWERED against. That is the
   form at the moment of submitting, not at the moment the email link is
   clicked: a question added in between is one this reporter never saw. */
{
  const slug = `form-${Date.now().toString(36)}`;
  const { rows: made } = await pool.query(
    `INSERT INTO logbooks (slug, title, launched_at) VALUES ($1, $2, now()) RETURNING id`,
    [slug, 'A logbook for the form test'],
  );
  const logbookId = made[0].id;
  await pool.query(
    `INSERT INTO logbook_fields (logbook_id, key, kind, label, required, position)
     VALUES ($1,'what_happened','short_text','What happened?',true,1)`,
    [logbookId],
  );
  const formOf = async (ref) => {
    const v = await verifyReport(ref);
    const { rows } = await pool.query(
      'SELECT form_hash, definition FROM logbook_forms WHERE logbook_id = $1 AND form_hash = $2',
      [logbookId, v.hashed_fields.logbook_form]);
    return { v, form: rows[0] };
  };
  const { createHash } = await import('node:crypto');

  const a = `confirm-forma-${Date.now()}@example.org`;
  await post('/api/reports', spine({ email: a, logbook: slug, answers: { what_happened: 'First' } }));

  // An optional question is added AFTER a reporter submitted and BEFORE they
  // clicked the link — the one thing a launched logbook may still do.
  await pool.query(
    `INSERT INTO logbook_fields (logbook_id, key, kind, label, required, position)
     VALUES ($1,'anything_else','short_text','Anything else?',false,2)`,
    [logbookId],
  );
  const first = await confirm(await tokenFor(a));
  const one = await formOf(first.body.publicRef);
  ok('it verifies', verifies(one.v), JSON.stringify(one.v?.content));
  ok('and carries the hash of a form version stored beside the report', Boolean(one.form));
  ok('which is the SHA-256 of the stored text, exactly',
    one.form && createHash('sha256').update(one.form.definition, 'utf8').digest('hex') === one.form.form_hash);
  ok('THE FORM SEALED IS THE ONE THE REPORTER WAS ASKED, not the one at the click',
    one.form && !JSON.parse(one.form.definition).questions.some((q) => q.key === 'anything_else'),
    one.form?.definition);

  const b = `confirm-formb-${Date.now()}@example.org`;
  await post('/api/reports', spine({
    email: b, logbook: slug, answers: { what_happened: 'Second', anything_else: 'Yes' },
  }));
  const second = await confirm(await tokenFor(b));
  const two = await formOf(second.body.publicRef);
  ok('a report filed after the new question seals the newer form',
    two.form && JSON.parse(two.form.definition).questions.some((q) => q.key === 'anything_else')
      && two.form.form_hash !== one.form.form_hash);
  ok('and the earlier report still verifies, untouched', verifies((await formOf(first.body.publicRef)).v));

  const c = `confirm-formc-${Date.now()}@example.org`;
  await post('/api/reports', spine({ email: c, logbook: slug, answers: { what_happened: 'Third' } }));
  const third = await confirm(await tokenFor(c));
  ok('two reports under the same questions share one form version',
    (await formOf(third.body.publicRef)).form?.form_hash === two.form.form_hash);
  const { rows: versions } = await pool.query(
    'SELECT count(*)::int AS n FROM logbook_forms WHERE logbook_id = $1', [logbookId]);
  ok('so the logbook holds exactly two versions', versions[0].n === 2, String(versions[0].n));

  let refused = false;
  try { await pool.query('UPDATE logbook_forms SET definition = definition WHERE logbook_id = $1', [logbookId]); }
  catch { refused = true; }
  ok('a stored form cannot be edited', refused);
  refused = false;
  try {
    await pool.query(
      "INSERT INTO logbook_forms (logbook_id, form_hash, definition) VALUES ($1, $2, 'not what it says')",
      [logbookId, 'f'.repeat(64)]);
  } catch { refused = true; }
  ok('and the database refuses a hash that is not its text\'s', refused);
}

/* ---- the board's generated filters ------------------------------------ */
console.log('\nfiltering the board by what a logbook asked');

/* NO DATE OR LOCATION FILTER IS BUILT IN. A logbook has the filters its
   operator marked and nothing else, which is why these are all `a.<key>`
   rather than named columns. */
{
  const slug = `filter-${Date.now().toString(36)}`;
  const { rows: made } = await pool.query(
    `INSERT INTO logbooks (slug, title, launched_at) VALUES ($1, $2, now()) RETURNING id`,
    [slug, 'A logbook for the filter test'],
  );
  const logbookId = made[0].id;
  await pool.query(
    `INSERT INTO logbook_fields (logbook_id, key, kind, label, filterable, settings, position)
     VALUES ($1,'station','short_text','Which station?',true,'{}',1),
            ($1,'anyone_hurt','yes_no','Was anyone hurt?',true,'{}',2),
            ($1,'who_was_there','choice_many','Who was there?',true,
              '{"options":["Staff","Police","Observers"]}',3)`,
    [logbookId],
  );

  const file = async (answers) => {
    const email = `filter-${Math.random().toString(36).slice(2)}@example.org`;
    await post('/api/reports', spine({ email, logbook: slug, answers }));
    const done = await confirm(await tokenFor(email));
    // The board shows what a moderator approved and the reporter allowed.
    // Approving here is the moderator's half; may_publish was answered true
    // by `spine`.
    await pool.query(
      `UPDATE report_heads SET moderation_status = 'valid'
        WHERE current_report_id = (SELECT id FROM reports WHERE public_ref = $1)`,
      [done.body.publicRef],
    );
    return done.body.publicRef;
  };

  const twelve = await file({ station: 'Station 12', anyone_hurt: true,
    who_was_there: ['Police', 'Staff'] });
  const nine = await file({ station: 'Station 9', anyone_hurt: false,
    who_was_there: ['Observers'] });

  // THE BOARD CALLS IT `id`, not public_ref: TIER_A_COLUMNS aliases
  // `r.public_ref AS id`, so a board row's id IS the public reference.
  const board = async (qs) => fetch(`${BASE}/api/reports?${qs}`)
    .then((x) => x.json()).then((l) => (Array.isArray(l) ? l.map((x) => x.id) : []));

  const mine = await board(`logbook=${slug}`);
  ok('both reports show under their logbook',
    mine.includes(twelve) && mine.includes(nine), JSON.stringify(mine));

  const byStation = await board(`logbook=${slug}&a.station=Station+12`);
  ok('a text answer filters to the one that has it',
    byStation.includes(twelve) && !byStation.includes(nine), JSON.stringify(byStation));

  // A boolean is not a string, so containment against "true" would miss it.
  const hurt = await board(`logbook=${slug}&a.anyone_hurt=true`);
  ok('a yes/no answer filters too, though it is not a string',
    hurt.includes(twelve) && !hurt.includes(nine), JSON.stringify(hurt));

  // One value INSIDE a multiple choice, which is the containment half.
  const police = await board(`logbook=${slug}&a.who_was_there=Police`);
  ok('a multiple choice matches on any one of its values',
    police.includes(twelve) && !police.includes(nine), JSON.stringify(police));

  const none = await board(`logbook=${slug}&a.station=Station+99`);
  ok('and an answer nobody gave matches nothing', none.length === 0, JSON.stringify(none));

  // Nothing a field key could not be reaches the query.
  const junk = await board(`logbook=${slug}&a.DROP TABLE=x`);
  ok('a key that could never be a field key is ignored, not run',
    junk.length === mine.length, `${junk.length} vs ${mine.length}`);

  const carried = await fetch(`${BASE}/api/reports?logbook=${slug}`).then((x) => x.json());
  ok('and the board carries the logbook and the answers for a card to show',
    carried[0]?.logbook_slug === slug && !!carried[0]?.answers,
    JSON.stringify(carried[0]?.logbook_slug));

  /* THE EXPORT HAS TO CARRY WHAT THE BOARD FILTERED BY. A CSV is the form
     this data most often gets re-published in, so handing somebody a file
     missing the very answers they narrowed to is the worst shape of it. */
  const csv = async (qs) => fetch(`${BASE}/api/reports/export.csv?${qs}`).then((x) => x.text());

  const narrowed = await csv(`logbook=${slug}`);
  const header = narrowed.split('\n')[0];
  ok('narrowed to one logbook, each question is its own column',
    header.includes('answer.station') && header.includes('answer.who_was_there'), header);
  ok('and the column is the field KEY, which is what the seal carries',
    !header.includes('Which station?'), header);
  ok('the answers are in the rows, not only the header',
    /Station 12/.test(narrowed), narrowed.split('\n')[1]?.slice(0, 200));
  ok('a multiple choice is readable rather than raw JSON',
    /Staff; Police|Police; Staff/.test(narrowed), narrowed.slice(0, 400));
  ok('and which logbook asked is a column too',
    header.includes('logbook') && narrowed.includes(slug), header);

  /* ACROSS SEVERAL LOGBOOKS there is no single field set to name, and two
     logbooks' questions that share a key are different questions. One
     column meaning different things per row is worse than one that says
     exactly what it holds. */
  const all = await csv('');
  const allHeader = all.split('\n')[0];
  ok('unnarrowed, the answers travel as one honest column',
    allHeader.includes('answers') && !allHeader.includes('answer.station'), allHeader);

  // CLOSING IS NOT HIDING. A logbook is closed when its work is done, and
  // that is exactly when its reports are the ones somebody wants to read —
  // so the board still has to be able to ask for them.
  await pool.query('UPDATE logbooks SET closed_at = now() WHERE id = $1', [logbookId]);

  const stillThere = await board(`logbook=${slug}`);
  ok('a closed logbook\u2019s reports are still on the board',
    stillThere.includes(twelve) && stillThere.includes(nine), JSON.stringify(stillThere));

  const offered = async (qs) => fetch(`${BASE}/api/logbooks${qs}`)
    .then((x) => x.json()).then((l) => l.map((x) => x.slug));
  ok('and it is still offered as a filter',
    (await offered('?include=closed')).includes(slug));
  // Offering a closed logbook on the form is offering a questionnaire that
  // will refuse the reporter at the end of it.
  ok('but never offered to a reporter as somewhere to file',
    !(await offered('')).includes(slug));
}

/* ---- My Reports: correcting, withdrawing, erasing ---------------------- */
console.log('\nMy Reports, on a logbook report');
{
  const { hmacEmail } = await import('../src/crypto.js');
  const slug = `mine-${Date.now().toString(36)}`;
  const { rows: made } = await pool.query(
    `INSERT INTO logbooks (slug, title, launched_at) VALUES ($1, $2, now()) RETURNING id`,
    [slug, 'A logbook for My Reports']);
  await pool.query(
    `INSERT INTO logbook_fields (logbook_id, key, kind, label, required, position)
     VALUES ($1,'what','short_text','What happened?',true,1)`, [made[0].id]);

  const email = `mine-${Date.now()}@example.org`;
  await post('/api/reports', spine({ email, logbook: slug, answers: { what: 'The first telling' } }));
  const done = await confirm(await tokenFor(email));
  const { rows: [head] } = await pool.query(
    `SELECT h.thread_id FROM report_heads h JOIN reports r ON r.id = h.current_report_id
      WHERE r.public_ref = $1`, [done.body.publicRef]);

  // Signed in the way the OTP flow ends: a user row and a session.
  await pool.query(`INSERT INTO users (email, email_hmac) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
    [email, hmacEmail(email)]);
  const tok = 'mine' + Math.random().toString(16).slice(2).padEnd(44, '0');
  await pool.query(`INSERT INTO self_sessions (token, email_hmac, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
    [tok, hmacEmail(email)]);
  const me = (path, body) => fetch(`${BASE}/api/me${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: `session_token=${tok}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  let list = await me('/reports');
  const mine = (list.body || []).find((r) => r.thread_id === head.thread_id);
  ok('the report is under My Reports, with its logbook and answers',
    mine && mine.logbook_slug === slug && mine.answers?.what === 'The first telling', JSON.stringify(mine));

  let r = await me(`/reports/${head.thread_id}/correct`, { answers: { what: 'Told again' }, comment: 'I got a detail wrong' });
  ok('a correction re-answers the logbook\'s questions', r.status === 200, JSON.stringify(r.body));
  const corrected = r.body.id;
  const vc = await verifyReport(corrected);
  ok('and is a new version in the SAME logbook\'s chain, which verifies',
    verifies(vc) && vc.chain.logbook === slug && vc.hashed_fields.answers.what === 'Told again'
    && vc.hashed_fields.corrects_id !== null, JSON.stringify(vc.hashed_fields));
  ok('and seals the form it was checked against',
    /^[0-9a-f]{64}$/.test(vc.hashed_fields.logbook_form), JSON.stringify(vc.hashed_fields.logbook_form));

  r = await me(`/reports/${head.thread_id}/correct`, { answers: {}, comment: 'x' });
  ok('a correction missing a required answer is refused', r.status === 400, JSON.stringify(r.body));

  r = await me(`/reports/${head.thread_id}/correct`, { answers: { what: 'Private now' }, comment: 'keep it out', may_publish: false });
  ok('a correction can take back permission to publish', r.status === 200
    && (await verifyReport(r.body.id)).hashed_fields.may_publish === false);
  r = await me(`/reports/${head.thread_id}/correct`, { answers: { what: 'Public again?' }, comment: 'x', may_publish: true });
  ok('but cannot give it back', r.status === 400, JSON.stringify(r.body));

  r = await me(`/reports/${head.thread_id}/erase`, { confirm: true });
  ok('erasing the contact details works on a logbook report', r.status === 200, JSON.stringify(r.body));
  list = await me('/reports');
  ok('and it is no longer under My Reports', !(list.body || []).some((x) => x.thread_id === head.thread_id));
  ok('while the report itself still verifies', verifies(await verifyReport(done.body.publicRef)));
}

/* ---- a confirmation that arrives before the files are ready ------------ */
console.log('\na confirmation whose files are still being prepared');

/* THE BRANCH NOTHING ELSE REACHES, and the reason this file exists.
 *
 * The form used to refuse to send until every file said Ready, so a
 * confirmation could never arrive mid-transcode. Nothing is processed during
 * filing any more — the worker waits for Send (migration 045) — so a
 * reporter who clicks their link quickly now CAN arrive first, and what
 * happens then decides whether their photograph is in the sealed report or
 * silently missing from it.
 *
 * `clearedSlotsFor` takes finished files only, so confirming at that moment
 * would seal a report without the file. The route answers 'preparing' and
 * spends nothing instead. That is one `if` in a route reached only by a
 * click in an email, which is exactly the shape of the bug this script was
 * written for.
 */
{
  const slug = `confirm-files-${Date.now().toString(36)}`;
  const { rows: made } = await pool.query(
    'INSERT INTO logbooks (slug, title, launched_at) VALUES ($1, $2, now()) RETURNING id',
    [slug, 'A logbook that takes photographs'],
  );
  const logbookId = made[0].id;
  // `accepts_files` is derived from having an upload question, so the
  // question is what makes this logbook one that takes files.
  await pool.query(
    `INSERT INTO logbook_fields (logbook_id, key, kind, label, required, position)
     VALUES ($1,'what_happened','short_text','What happened?',true,1),
            ($1,'photos','file','Photographs',false,2)`,
    [logbookId],
  );

  const draft = randomBytes(24).toString('hex');
  // Staged before Send, which is where a real reporter's file is: the bytes
  // are in the bucket and nothing has been done with them.
  await pool.query(
    `INSERT INTO upload_slots (slot_token, draft_token, declared_name, declared_type,
                               declared_size, staging_key, status, expires_at, logbook_id)
     VALUES ($1,$2,'evidence.jpg','image/jpeg',2048,$3,'uploaded', now() + interval '1 day', $4)`,
    [randomBytes(24).toString('hex'), draft, `staging/${draft}`, logbookId],
  );

  const email = `confirm-preparing-${Date.now()}@example.org`;
  const sent = await post('/api/reports', spine({
    email,
    logbook: slug,
    draft_token: draft,
    answers: { what_happened: 'There were photographs' },
  }));
  ok('a submission carrying files is accepted', sent.status === 202, JSON.stringify(sent.body));

  // Send is what releases the work. Checked here rather than only in
  // intake-hardening-selftest, because there it is called directly and here
  // it is the route doing it — and a route that forgot would leave every
  // file on every deployment unprocessed for ever.
  const { rows: rel } = await pool.query(
    'SELECT released_at FROM upload_slots WHERE draft_token = $1', [draft]);
  ok('and pressing Send is what released the file to the worker',
    rel[0]?.released_at !== null, JSON.stringify(rel[0]));

  const token = await tokenFor(email);
  const early = await confirm(token);
  ok('CONFIRMING EARLY DOES NOT SEAL A REPORT WITHOUT THE FILE',
    early.body.status === 'preparing', JSON.stringify(early.body));
  ok('and it says which file it is waiting for',
    (early.body.files || []).includes('evidence.jpg'), JSON.stringify(early.body.files));

  // Nothing was written and the link is unspent, so coming back works.
  const { rows: unspent } = await pool.query(
    'SELECT confirmed_at, thread_id FROM report_submission_tokens WHERE token = $1', [token]);
  ok('the link is not spent, so the reporter can come back to it',
    unspent[0]?.confirmed_at === null && unspent[0]?.thread_id === null,
    JSON.stringify(unspent[0]));

  // The worker finishes — here, by refusing the file, which is the outcome
  // that has to be REPORTED rather than hidden. A clean one would need real
  // bytes in a real bucket; what this branch decides is whether the
  // confirmation goes ahead at all once nothing is in flight.
  await pool.query(
    `UPDATE upload_slots SET status = 'unreadable', status_detail = 'not a readable image'
     WHERE draft_token = $1`, [draft]);

  const done = await confirm(token);
  ok('once nothing is in flight the report is created', done.body.status === 'created',
    JSON.stringify(done.body));
  ok('and the file that did not make it is named, with its reason',
    (done.body.attachments?.excluded || []).some((x) => x.name === 'evidence.jpg'
      && /readable/.test(x.reason || '')), JSON.stringify(done.body.attachments));
  ok('and the report it sealed still verifies', verifies(await verifyReport(done.body.publicRef)));
}

/* ---- the transparency log ---------------------------------------------- */
console.log('\nthe daily snapshot says what the archive actually said');

/* THE FILE WHERE DRIFT IS WORST, and it had drifted. The snapshot is what
   proves what the archive SAID — the anchor alone only proves it has not
   changed — so a snapshot publishing the wrong hashed_fields is the one
   failure the whole mechanism exists to prevent.

   Nothing covered buildSnapshot at all, which is how a hand-kept column
   list missing `may_publish` published every report as failing its own hash
   from 11 September onward. */
{
  const { buildSnapshot } = await import('../src/snapshot.js');
  const snap = await buildSnapshot('2026-09-17', pool);

  ok('the snapshot has the published reports in it', snap.report_count > 0,
    String(snap.report_count));

  // THE CHECK THAT WAS MISSING. Every entry is rebuilt from its row and
  // rehashed; a single disagreement is published as
  // reports_not_matching_their_own_hash, and there must be none.
  ok('AND EVERY ONE OF THEM MATCHES ITS OWN HASH',
    !snap.reports_not_matching_their_own_hash,
    `${snap.reports_not_matching_their_own_hash} of ${snap.report_count} do not`);

  // The publication answer is sealed into every report this query can
  // return, because the query only returns reports that may be published.
  // If it is missing from hashed_fields, the SELECT has drifted again.
  const everyEntryHasIt = snap.reports.every(
    (r) => 'may_publish' in r.hashed_fields && 'may_publish_digest' in r.hashed_fields,
  );
  ok('the publication answer is in the published field set, not dropped',
    everyEntryHasIt, JSON.stringify(Object.keys(snap.reports[0]?.hashed_fields || {})));

  // Every report is in a logbook, and the snapshot is grouped by chain.
  ok('every report publishes which logbook asked',
    snap.reports.every((r) => r.hashed_fields.logbook && r.logbook === r.hashed_fields.logbook));
  // The questions travel with the answers: every form a published report
  // names is in the file, and is the text that hash is the SHA-256 of.
  {
    const { createHash } = await import('node:crypto');
    const named = [...new Set(snap.reports.map((r) => r.hashed_fields.logbook_form).filter(Boolean))];
    const carried = new Map((snap.forms || []).map((f) => [f.hash, f.definition]));
    ok('every form a published report names is in the snapshot, as hashed',
      named.length > 0 && named.every((h) => carried.has(h)
        && createHash('sha256').update(carried.get(h), 'utf8').digest('hex') === h),
      `${named.length} named, ${carried.size} carried`);
  }
  ok('and the snapshot lists every chain with its latest link',
    Array.isArray(snap.chains) && snap.chains.length > 0
    && snap.chains.every((c) => /^[0-9a-f]{64}$/.test(c.head)), JSON.stringify(snap.chains).slice(0, 200));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
