/**
 * The coordinator intake flow, end to end against a running app.
 *
 * Run it through the database suite, which brings up its own app against a
 * throwaway database:
 *
 *   npm run test:db
 *
 * Or by hand, against an app you started yourself:
 *
 *   BASE=http://localhost:3000 DATABASE_URL=postgres://…/scratch \
 *     node scripts/intake-selftest.mjs
 *
 * It signs in by minting a session row directly rather than going through
 * the emailed code, which is what the OTP flow ends up doing anyway. It
 * expects a coordinator account to exist — run scripts/orgs-selftest.mjs
 * against the same database first.
 *
 * Never point it at production: it files reports.
 */
import pg from 'pg';

const BASE = process.env.BASE || 'http://localhost:3000';
const DB = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString: DB });

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};

// Sign in the way the app does, but skip the emailed code: mint a session
// row directly, which is what the OTP flow ends up doing anyway.
const { rows } = await pool.query("SELECT id, email, email_hmac FROM users WHERE email = 'coord@example.org'");
const user = rows[0];
if (!user) {
  console.error('No coord@example.org. Run scripts/orgs-selftest.mjs against this database first.');
  await pool.end();
  process.exit(2);
}
const token = 'tok' + Math.random().toString(16).slice(2).padEnd(45, '0');
await pool.query(
  "INSERT INTO self_sessions (token, email_hmac, expires_at) VALUES ($1,$2, now() + interval '1 hour')",
  [token, user.email_hmac],
).catch(() => {});

// Assert WHY it refused, not just that it did. With the site gate on, this
// route answers 401 before intake's own auth ever runs, and a check that
// only reads the status passes without exercising the thing it names.
const anon = await fetch(BASE + '/api/intake/organizations');
const anonBody = await anon.json().catch(() => ({}));
ok('intake refuses an anonymous caller', anon.status === 401 && !anonBody.locked,
  'status ' + anon.status + ' ' + JSON.stringify(anonBody)
  + (anonBody.locked ? ' — that is the site gate, not intake' : ''));

const asCoord = async (path, opts) => {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Cookie: `session_token=${token}`, ...(opts?.headers || {}) },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

let out = await asCoord('/api/intake/organizations');
ok('the coordinator sees an organization', out.status === 200 && out.body?.length > 0,
  out.status + ' ' + JSON.stringify(out.body));
const orgId = out.body?.[0]?.organization_id;

out = await asCoord('/api/intake/batches', { method: 'POST', body: JSON.stringify({ organizationId: orgId }) });
const batch = out.body;
ok('a batch can be opened', out.status < 300 && !!batch?.id, out.status + ' ' + JSON.stringify(out.body));

// An entry is a logbook's answers, like any other report, plus how it was
// collected and what the person said about publication — on the wording
// coordinators are shown. orgs-selftest launched the logbook.
const card = await (await fetch(BASE + '/api/reports/consent-text?variant=coordinator')).json();
for (const entry of [
  { logbook: 'orgs-selftest', answers: { what_happened: 'Told me she was turned away over a student ID at about nine.' }, intake_method: 'paper', collected_on: '2026-11-03', source_ref: 'clipboard 3, entry 7', may_publish: true, may_publish_digest: card.digest },
  { logbook: 'orgs-selftest', answers: { what_happened: 'A second account off the same clipboard, about the queue.' }, intake_method: 'paper', may_publish: false, may_publish_digest: card.digest },
  // No logbook, no method, no publication answer: stays staged.
  { answers: { what_happened: 'incomplete' } },
]) {
  const d = await asCoord(`/api/intake/batches/${batch.id}/drafts`, { method: 'POST', body: JSON.stringify({}) });
  await asCoord(`/api/intake/drafts/${d.body.id}`, { method: 'PUT', body: JSON.stringify(entry) });
}

out = await asCoord(`/api/intake/batches/${batch.id}/review`);
ok('review counts two ready and one blocked', out.body?.ready === 2 && out.body?.blocked === 1,
  JSON.stringify(out.body));

// The attestation is the coordinator's statement that these came from real
// people. Filing without it must not be possible, because the batch is the
// one path into the archive where nobody signing is the person it happened
// to.
out = await asCoord(`/api/intake/batches/${batch.id}/submit`, { method: 'POST', body: JSON.stringify({}) });
ok('filing without the attestation is refused', out.status >= 400, out.status + ' ' + JSON.stringify(out.body));

out = await asCoord(`/api/intake/batches/${batch.id}/submit`, { method: 'POST', body: JSON.stringify({ attested: true }) });
ok('filing with the attestation files the two that were ready',
  out.status < 300 && out.body?.filed?.length === 2,
  out.status + ' ' + JSON.stringify(out.body));
ok('and leaves the incomplete one staged', out.body?.stillStaged === 1, JSON.stringify(out.body?.stillStaged));
ok('every filed report got a public reference',
  (out.body?.filed || []).every((f) => typeof f.publicRef === 'string' && f.publicRef.length > 0),
  JSON.stringify(out.body?.filed));
{
  const refs = (out.body?.filed || []).map((f) => f.publicRef);
  const { rows: filed } = await pool.query(
    `SELECT r.public_ref, r.third_party, r.filed_via, r.may_publish, l.slug
       FROM reports r JOIN logbooks l ON l.id = r.logbook_id WHERE r.public_ref = ANY($1)`, [refs]);
  ok('each is in the logbook it named, sealed with its provenance',
    filed.length === 2 && filed.every((r) => r.slug === 'orgs-selftest' && r.third_party && r.filed_via),
    JSON.stringify(filed));
  ok('and with the publication answer the person gave, yes or no',
    filed.some((r) => r.may_publish === true) && filed.some((r) => r.may_publish === false));
  // The coordinator door seals the questions too, one version for the batch.
  const { verifyReport } = await import('../src/verify.js');
  const seen = [];
  for (const ref of refs) seen.push(await verifyReport(ref));
  ok('each carries the form it was answered against, and verifies',
    seen.every((v) => /^[0-9a-f]{64}$/.test(v.hashed_fields.logbook_form) && v.content.ok && v.link.ok),
    JSON.stringify(seen.map((v) => v.hashed_fields.logbook_form)));
  ok('the same one, because it is the same questions',
    new Set(seen.map((v) => v.hashed_fields.logbook_form)).size === 1);
}

// The incomplete one must still be there, not discarded. A batch that threw
// away what it could not file would lose a report nobody knew was lost.
out = await asCoord(`/api/intake/batches/${batch.id}/review`);
ok('after filing, nothing is ready and the incomplete one survives',
  out.body?.ready === 0 && out.body?.blocked === 1, JSON.stringify(out.body));

await pool.end();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
