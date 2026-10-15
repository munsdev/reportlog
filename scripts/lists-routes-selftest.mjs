/**
 * Lists over HTTP, against a real app: who may reach what, what the builder
 * refuses, what a visitor's form accepts, the bulk review, the published
 * counts, and THE ERASURE PAGE — a path that only runs when somebody clicks
 * a link in an email, aimed at deliberately for the reason
 * scripts/confirm-selftest.mjs exists.
 *
 * scripts/lists-selftest.mjs covers the engine directly. This covers what
 * only exists once a route sits in front of it: visibility answering 404
 * rather than 403, the role checks, refusals turned into words, and a GET on
 * the erasure link erasing nothing.
 *
 * Run through the database suite, which starts the app:  npm run test:db
 * It writes lists and entries. Never point it at a deployment.
 */
import 'dotenv/config';
import pg from 'pg';

const BASE = process.env.BASE || 'http://localhost:3000';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { mintErasureToken } = await import('../src/lists/erasure.js');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};

/* Sign in the way the app does, minus the emailed code. */
async function sessionFor(email, role) {
  const hmac = 'h_' + email;
  await pool.query(
    `INSERT INTO users (email, email_hmac, role) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role`,
    [email, hmac, role],
  );
  const token = 'tok' + Math.random().toString(16).slice(2).padEnd(45, '0');
  await pool.query(
    "INSERT INTO self_sessions (token, email_hmac, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
    [token, hmac],
  );
  return token;
}
const ADMIN = await sessionFor('lists-admin@example.org', 'admin');
const MOD = await sessionFor('lists-mod@example.org', 'moderator');
const USER = await sessionFor('lists-user@example.org', 'user');

async function call(path, { method = 'GET', body, as = null } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as ? { Cookie: `session_token=${as}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, body: json, text };
}
const say = (r) => `${r.status} ${r.text.slice(0, 200)}`;

const SLUG = `tips-${Date.now().toString(36)}`;

/* ---- who may build ----------------------------------------------------- */
console.log('\nwho may build a list');
ok('nobody signed in is refused', (await call('/api/admin/lists')).status === 401);
ok('a moderator is refused the builder', (await call('/api/admin/lists', { as: MOD })).status === 403);

let r = await call('/api/admin/lists', { as: ADMIN });
ok('an administrator sees the three starting points',
  r.status === 200 && ['tips', 'check-ins', 'contact'].every((s) => r.body.templates.some((t) => t.slug === s)), say(r));
ok('and no upload or evidence question is offered on a list',
  r.status === 200 && !r.body.kinds.some((k) => k.id === 'file' || k.id === 'evidence_declaration'), say(r));

r = await call('/api/admin/lists', { method: 'POST', as: ADMIN, body: { template: 'tips', slug: SLUG } });
ok('a list is made from the Tip List', r.status === 201 && r.body.slug === SLUG, say(r));
const list = r.body;
ok('and it starts hidden', list.visibility === 'hidden', list.visibility);
ok('and the address requirement is derived from its questions', list.requiresEmail === true);

r = await call('/api/admin/lists', { method: 'POST', as: ADMIN, body: { template: 'tips', slug: SLUG } });
ok('the same address twice is refused', r.status === 400 && r.body.reason === 'slug-taken', say(r));

/* ---- hidden means 404 -------------------------------------------------- */
console.log('\nvisibility is enforced');
ok('a hidden list is 404 to a visitor, not 403', (await call(`/api/lists/${SLUG}`)).status === 404);
ok('and to somebody signed in', (await call(`/api/lists/${SLUG}`, { as: USER })).status === 404);
ok('an administrator can preview it', (await call(`/api/lists/${SLUG}`, { as: ADMIN })).status === 200);
r = await call(`/api/lists/${SLUG}/entries`, { method: 'POST', body: { answers: {} } });
ok('and nothing can be filed into it from outside', r.status === 404, say(r));

/* ---- the builder's rules ------------------------------------------------ */
console.log('\nwhat the builder refuses');
const fields = list.fields.map((f) => ({ ...f }));
const desc = fields.find((f) => f.key === 'description');
r = await call(`/api/admin/lists/${list.id}/fields`, {
  method: 'PUT', as: ADMIN,
  body: { fields: fields.map((f) => (f.key === 'description' ? { ...f, aggregatable: true } : f)) },
});
ok('ticking "countable" on free text is refused', r.status === 400 && /cannot be counted/.test(r.body.error), say(r));

r = await call(`/api/admin/lists/${list.id}/fields`, {
  method: 'PUT', as: ADMIN,
  body: { fields: [...fields, { key: 'photo', kind: 'file', label: 'A photo', retention: 'transient' }] },
});
ok('an upload question is refused', r.status === 400 && /belong to a logbook/.test(r.body.error), say(r));

r = await call(`/api/admin/lists/${list.id}/fields`, {
  method: 'PUT', as: ADMIN,
  body: { fields: [...fields, { key: 'odd', kind: 'telepathy', label: 'Odd', retention: 'transient' }] },
});
ok('a question type that does not exist is refused, by name', r.status === 400 && /telepathy/.test(r.body.error), say(r));

r = await call(`/api/admin/lists/${list.id}/fields`, {
  method: 'PUT', as: ADMIN,
  body: { fields: fields.map((f) => (f.key === 'category' ? { ...f, options: { options: [], allowOther: false } } : f)) },
});
ok('a choice left with nothing to choose from is refused', r.status === 400 && /no options/.test(r.body.error), say(r));

r = await call(`/api/admin/lists/${list.id}/fields`, {
  method: 'PUT', as: ADMIN,
  body: { fields: fields.map((f) => (f.key === 'state' ? { ...f, key: 'renamed' } : f)) },
});
ok('an existing question keeps its key whatever is sent',
  r.status === 200 && r.body.fields.some((f) => f.key === 'state') && !r.body.fields.some((f) => f.key === 'renamed'), say(r));

const withOptions = r.body.fields.map((f) => (f.key === 'state'
  ? { ...f, options: { options: ['Ohio', 'Texas', 'Not sure'], allowOther: false } }
  : f));
r = await call(`/api/admin/lists/${list.id}/fields`, { method: 'PUT', as: ADMIN, body: { fields: withOptions } });
ok('options can be changed after the list exists', r.status === 200
  && r.body.fields.find((f) => f.key === 'state').options.options.includes('Texas'), say(r));
ok('and editing them did not lose the description question',
  r.status === 200 && r.body.fields.some((f) => f.key === 'description' && f.id === desc.id));

r = await call(`/api/admin/lists/${list.id}/fields`, {
  method: 'PUT', as: ADMIN, body: { fields: withOptions.filter((f) => f.key !== 'description') },
});
ok('removing the only free-text question makes the address unnecessary',
  r.status === 200 && r.body.requiresEmail === false, say(r));
r = await call(`/api/admin/lists/${list.id}/fields`, { method: 'PUT', as: ADMIN, body: { fields: withOptions } });
ok('a removed question cannot be saved back under its old row', r.status === 400 && r.body.reason === 'no-field', say(r));
// Removing a question deletes its row, so putting it back is a NEW question
// under the same key — its earlier answers are still filed under that key.
r = await call(`/api/admin/lists/${list.id}/fields`, {
  method: 'PUT', as: ADMIN,
  body: { fields: withOptions.map((f) => (f.key === 'description' ? { ...f, id: null } : f)) },
});
ok('and adding it back as new makes the address required again', r.status === 200 && r.body.requiresEmail === true, say(r));

r = await call(`/api/admin/lists/${list.id}`, { method: 'PATCH', as: ADMIN, body: { visibility: 'listed' } });
ok('the list can be made listed', r.status === 200 && r.body.visibility === 'listed', say(r));

/* ---- the form ---------------------------------------------------------- */
console.log('\nwhat a visitor can send');
r = await call(`/api/lists/${SLUG}`);
ok('a listed list is readable by anybody past the gate', r.status === 200 && r.body.asksEmail === true, say(r));
ok('and its form carries no operator settings', r.status === 200 && !('aggregatable' in r.body.fields[0]) && !('id' in r.body.fields[0]));
r = await call('/api/lists');
ok('and the front page offers it', r.status === 200 && r.body.some((l) => l.slug === SLUG), say(r));

const send = (b) => call(`/api/lists/${SLUG}/entries`, { method: 'POST', body: { elapsed_ms: 9000, ...b } });
const count = async () => Number((await pool.query(
  'SELECT count(*) AS n FROM list_entries WHERE list_id = $1', [list.id])).rows[0].n);

r = await send({ answers: { links: ['https://example.org/a?utm_source=x'], state: 'Ohio', category: 'Not sure' } });
ok('a link and two choices go through with no address', r.status === 201 && r.body.erasable === false, say(r));

r = await send({ answers: { links: ['https://example.org/b'], state: 'Ohio', category: 'Not sure', description: 'I saw it happen' } });
ok('writing something with no address is refused, in words',
  r.status === 400 && r.body.reason === 'email-required-for-personal-data' && /delete/.test(r.body.error), say(r));

r = await send({ answers: { links: ['https://example.org/b'], state: 'Texas', category: 'Not sure', description: 'SECRET-WORDS-123' }, email: 'someone@example.org' });
ok('with an address it goes through, and is erasable', r.status === 201 && r.body.erasable === true, say(r));

r = await send({ answers: { links: ['https://bit.ly/x'], state: 'Ohio', category: 'Not sure' } });
ok('a shortened link is refused with a reason a person can act on',
  r.status === 400 && r.body.reason === 'shortener' && /full address/.test(r.body.error), say(r));

r = await send({ answers: { links: ['https://example.org/c'], state: 'Mars', category: 'Not sure' } });
ok('an answer that is not one of the options is refused', r.status === 400 && r.body.reason === 'not-an-option', say(r));

const before = await count();
r = await send({ answers: { links: ['https://example.org/d'], state: 'Ohio', category: 'Not sure' }, website: 'http://spam' });
ok('the hidden box answers like success', r.status === 201, say(r));
r = await call(`/api/lists/${SLUG}/entries`, { method: 'POST', body: { elapsed_ms: 100, answers: { links: ['https://example.org/e'], state: 'Ohio', category: 'Not sure' } } });
ok('so does a form filled faster than it can be read', r.status === 201, say(r));
ok('and neither wrote anything', (await count()) === before, `${before} -> ${await count()}`);

/* ---- why an address is asked ------------------------------------------- */
console.log('\nwhen, and why, an address is asked');
r = await call(`/api/lists/${SLUG}`);
ok('the Tip List asks only somebody who writes something, and says so',
  r.status === 200 && r.body.emailWhen === 'if-written' && r.body.emailReason === 'erase', say(r));
// The volunteer list itself is made by migration 047, and lists-selftest
// empties every list table before this runs, so the same rule is checked on a
// form made from the contact template, which carries "ask_email": "always".
r = await call('/api/admin/lists', { method: 'POST', as: ADMIN, body: { template: 'contact', slug: `${SLUG}-reach` } });
const reach = r.body;
ok('a contact form made from its template always asks', r.status === 201 && reach.emailMode === 'required', say(r));
await call(`/api/admin/lists/${reach.id}`, { method: 'PATCH', as: ADMIN, body: { visibility: 'listed' } });
r = await call(`/api/lists/${SLUG}-reach`);
ok('and tells the visitor the address is so the site can reply',
  r.status === 200 && r.body.emailWhen === 'always' && r.body.emailReason === 'reply', say(r));
await call(`/api/admin/lists/${reach.id}`, { method: 'DELETE', as: ADMIN });
r = await call(`/api/admin/lists/${list.id}`, { method: 'PATCH', as: ADMIN, body: { emailMode: 'required' } });
ok('an administrator can make a form always ask', r.status === 200 && r.body.emailMode === 'required', say(r));
const beforeAlways = await count();
r = await send({ answers: { links: ['https://example.org/always'], state: 'Ohio', category: 'Not sure' } });
ok('and then a link and two choices with no address are refused, in words',
  r.status === 400 && r.body.reason === 'email-required' && /needs your email address/.test(r.body.error), say(r));
ok('having written nothing', (await count()) === beforeAlways);
r = await send({ answers: { links: ['https://example.org/always'], state: 'Ohio', category: 'Not sure' }, email: 'reach@example.org' });
ok('with an address it goes through', r.status === 201, say(r));
r = await call(`/api/admin/lists/${list.id}`, { method: 'PATCH', as: ADMIN, body: { emailMode: 'never' } });
ok('"never" is not a setting — the gate still applies on a form people write on', r.status === 400, say(r));
await call(`/api/admin/lists/${list.id}`, { method: 'PATCH', as: ADMIN, body: { emailMode: 'auto' } });

/* ---- counts ------------------------------------------------------------ */
console.log('\npublished counts');
ok('counts are not published by default', (await call(`/api/lists/${SLUG}/counts`)).status === 404);
await call(`/api/admin/lists/${list.id}`, { method: 'PATCH', as: ADMIN, body: { aggregatesPublished: true } });
r = await call(`/api/lists/${SLUG}/counts`);
ok('once published, received and approved are both there',
  r.status === 200 && r.body.totals.received === 3 && r.body.totals.approved === 0, say(r));
ok('and only the ticked fields are broken down',
  r.status === 200 && r.body.fields.map((f) => f.key).sort().join() === 'category,state', say(r));
ok('and nothing anybody wrote is in it', !r.text.includes('SECRET-WORDS-123') && !r.text.includes('someone@example.org'));

/* ---- review ------------------------------------------------------------ */
console.log('\nreview, in bulk');
ok('somebody with no role cannot reach the queue', (await call('/api/list-review', { as: USER })).status === 403);
r = await call('/api/list-review', { as: MOD });
ok('a moderator sees what is waiting', r.status === 200 && r.body.find((q) => q.slug === SLUG)?.waiting === 3, say(r));
r = await call(`/api/list-review/${list.id}`, { as: MOD });
ok('and the page of entries, with the host of every link',
  r.status === 200 && r.body.entries.length === 3 && r.body.entries[0].links[0].host === 'example.org', say(r));
const ids = (r.body?.entries || []).map((e) => e.id);
r = await call(`/api/list-review/${list.id}/review`, { method: 'POST', as: MOD, body: { state: 'approved', ids: [ids[0]] } });
ok('approving names the rows looked at', r.status === 200 && r.body.changed === 1, say(r));
r = await call(`/api/list-review/${list.id}/review`, { method: 'POST', as: MOD, body: { state: 'received', ids } });
ok('and an entry cannot be un-reviewed', r.status === 400, say(r));
r = await call(`/api/lists/${SLUG}/counts`);
ok('the published approved count moved with it', r.status === 200 && r.body.totals.approved === 1, say(r));

/* ---- the erasure link -------------------------------------------------- */
console.log('\nthe erasure link');
const { rows: [held] } = await pool.query(
  'SELECT id, personal_expires_at FROM list_entries WHERE list_id = $1 AND erasable_answers IS NOT NULL', [list.id]);
// The plaintext only ever exists in the email, so mint one the same way.
const token = await mintErasureToken({ entryId: held.id, personalExpiresAt: held.personal_expires_at });

r = await call(`/api/forget/${token}`);
ok('opening the link shows a button', r.status === 200 && /<form method="post"/.test(r.text), say(r));
const still = (await pool.query('SELECT erasable_answers FROM list_entries WHERE id = $1', [held.id])).rows[0];
ok('and OPENING IT ERASES NOTHING — a mail scanner follows every link', still.erasable_answers !== null);

r = await call(`/api/forget/${token}`, { method: 'POST' });
ok('pressing the button erases', r.status === 200 && /gone/.test(r.text), say(r));
const after = (await pool.query(
  'SELECT erasable_answers, email, erased_at, answers FROM list_entries WHERE id = $1', [held.id])).rows[0];
ok('the words and the address are gone', after.erasable_answers === null && after.email === null && after.erased_at !== null);
ok('and the links and choices stay', after.answers.state === 'Texas' && Array.isArray(after.answers.links));
r = await call(`/api/forget/${token}`, { method: 'POST' });
ok('the link works once', r.status === 404, say(r));
r = await call('/api/forget/not-a-token');
ok('a mangled link says so rather than erroring', r.status === 404 && /does not work/.test(r.text), say(r));

/* ---- closing and deleting ---------------------------------------------- */
console.log('\nclosing and deleting');
await call(`/api/admin/lists/${list.id}`, { method: 'PATCH', as: ADMIN, body: { closed: true } });
r = await send({ answers: { links: ['https://example.org/f'], state: 'Ohio', category: 'Not sure' } });
ok('a closed list takes nothing', r.status === 400 && r.body.reason === 'closed', say(r));
r = await call('/api/lists');
ok('and the front page stops offering it', r.status === 200 && !r.body.some((l) => l.slug === SLUG), say(r));

r = await call(`/api/admin/lists/${list.id}`, { method: 'DELETE', as: ADMIN });
ok('a list with entries cannot be deleted', r.status === 400 && r.body.reason === 'has-entries', say(r));
r = await call('/api/admin/lists', { method: 'POST', as: ADMIN, body: { template: 'contact', slug: `${SLUG}-c` } });
const unused = r.body;
ok('a contact form needs an address by arithmetic', unused?.requiresEmail === true, say(r));
r = await call(`/api/admin/lists/${unused.id}`, { method: 'PATCH', as: ADMIN, body: { visibility: 'password' } });
ok('a team-only list is 404 to a visitor', (await call(`/api/lists/${SLUG}-c`)).status === 404);
ok('and readable to somebody signed in', (await call(`/api/lists/${SLUG}-c`, { as: USER })).status === 200);
r = await call(`/api/admin/lists/${unused.id}`, { method: 'DELETE', as: ADMIN });
ok('an unused list can be deleted', r.status === 200, say(r));

await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
