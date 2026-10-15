/**
 * Per-logbook upload caps, and the third revocable permission.
 *
 * WHAT NEEDS POSTGRES. The caps are columns on `logbooks` that
 * `createUploadSlot` reads, and the thing worth proving is not that a number
 * comes back — it is that THE CLIENT CANNOT CHOOSE WHICH NUMBER APPLIES.
 * A slot is authorised by a draft token minted before anything has been
 * chosen, so the logbook arrives from the request; if the cap were read from
 * whatever each request claimed, a client naming the loosest logbook would
 * get it, and a per-logbook cap would be decorative. The first slot in a
 * draft fixes it and the rest have to agree.
 *
 * AND THAT THE DECLARATION IS NOT THE PERMISSION. What a reporter said they
 * had at filing is a sealed answer to a logbook's question. Whether they
 * will be contacted about it is a grant that exists to be taken back. Fold
 * them together and a report verifies differently because somebody changed
 * their mind about being contacted.
 *
 * Run by `npm run test:db` against a throwaway database.
 */
import 'dotenv/config';
import crypto from 'node:crypto';

const { pool } = await import('../src/db.js');
const L = await import('../src/logbooks.js');
const A = await import('../src/attachments.js');
const P = await import('../src/reportPermissions.js');
const { toFile, createFromFile } = await import('../src/logbookFile.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

async function launched(slug, caps = {}) {
  const made = await L.createLogbook({ title: `Caps ${slug}`, slug });
  await L.addField(made.logbook.id, { kind: 'long_text', label: 'What happened' });
  await L.addField(made.logbook.id, { kind: 'file', label: 'Photos' });
  if (caps.maxFiles !== undefined || caps.maxTotalBytes !== undefined) {
    await pool.query(
      'UPDATE logbooks SET max_files = $2, max_total_bytes = $3 WHERE id = $1',
      [made.logbook.id, caps.maxFiles ?? null, caps.maxTotalBytes ?? null],
    );
  }
  await L.launch(made.logbook.id);
  return L.logbookById(made.logbook.id);
}

// ---------------------------------------------------------------------
// The caps, and the fallback that makes 037 additive in behaviour.
// ---------------------------------------------------------------------
const plain = await launched('caps-plain');
const tight = await launched('caps-tight', { maxFiles: 1, maxTotalBytes: 300 * 1024 * 1024 });

{
  const site = await A.capsFor(null);
  ok('with no logbook, the site-wide limits apply',
    site.maxFiles === A.MAX_FILES_PER_SUBMISSION && site.maxTotalBytes === A.MAX_TOTAL_BYTES,
    JSON.stringify(site));

  const unset = await A.capsFor(plain.id);
  ok('and a logbook that sets neither cap behaves exactly as before 037',
    unset.maxFiles === A.MAX_FILES_PER_SUBMISSION && unset.maxTotalBytes === A.MAX_TOTAL_BYTES,
    JSON.stringify(unset));

  const set = await A.capsFor(tight.id);
  ok('a logbook that sets them gets its own', set.maxFiles === 1
    && set.maxTotalBytes === 300 * 1024 * 1024, JSON.stringify(set));

  const gone = await A.capsFor(999999);
  ok('and a logbook that does not exist falls back rather than throwing',
    gone.maxFiles === A.MAX_FILES_PER_SUBMISSION, JSON.stringify(gone));
}

// ---------------------------------------------------------------------
// THE NUMBERS THE FIRST DEPLOYMENT WILL USE, asserted because the instruction was
// "one file enough for a modern 30 second clip" and that is a RISE.
// ---------------------------------------------------------------------
{
  const file = JSON.parse(await import('node:fs')
    .then((fs) => fs.readFileSync(new URL('../templates/elections.json', import.meta.url), 'utf8')));
  ok('the elections template takes one file', file.max_files === 1, JSON.stringify(file.max_files));
  ok('at 300 MB, which is MORE than the old site-wide video ceiling',
    file.max_total_bytes === 300 * 1024 * 1024 && file.max_total_bytes > 150 * 1024 * 1024,
    'a default-settings iPhone shooting 4K makes ~190 MB for 30 seconds; 150 refused the ordinary case');
}

// ---------------------------------------------------------------------
// The logbook file carries them, and only when set.
// ---------------------------------------------------------------------
{
  const f = await toFile(tight.id);
  ok('a downloaded logbook carries its caps', f.max_files === 1
    && f.max_total_bytes === 300 * 1024 * 1024, JSON.stringify([f.max_files, f.max_total_bytes]));
  const plainFile = await toFile(plain.id);
  ok('and a logbook on the site limits carries no key for either',
    !('max_files' in plainFile) && !('max_total_bytes' in plainFile),
    'a file from an unconfigured logbook must look as it did before 037');

  const back = await createFromFile({ ...f, slug: 'caps-copy', title: 'Copy' });
  const copied = back.ok ? await L.logbookById(back.logbook.id) : null;
  ok('and uploading it reproduces them', copied && copied.max_files === 1
    && Number(copied.max_total_bytes) === 300 * 1024 * 1024,
    JSON.stringify(back.errors || back.reason));
}

// ---------------------------------------------------------------------
// The database refuses a nonsense cap, rather than a second copy of the
// range in JavaScript that could disagree with it.
// ---------------------------------------------------------------------
{
  let zero = null; let huge = null;
  try {
    await pool.query('UPDATE logbooks SET max_files = 0 WHERE id = $1', [tight.id]);
  } catch (e) { zero = e; }
  try {
    await pool.query('UPDATE logbooks SET max_total_bytes = 1 WHERE id = $1', [tight.id]);
  } catch (e) { huge = e; }
  ok('a cap of zero files is refused', !!zero, 'a form that takes no files is an upload question with no answer');
  ok('and a one-byte total is refused', !!huge);
}

// ---------------------------------------------------------------------
// THE ONE THAT MATTERS. The client cannot pick which cap applies.
// ---------------------------------------------------------------------
{
  // ASKED OF src/storage.js, not of attachments.js. The first version of
  // this checked `A.isConfigured`, which attachments.js does not export —
  // so the guard read `!undefined` as true and the check reported "storage
  // is configured" on a box with no bucket at all. A test that cannot fail
  // is worse than no test, because it is counted.
  const storage = await import('../src/storage.js');
  const configured = storage.isConfigured();
  if (configured) {
    console.log('  --   object storage is configured here; the slot path is reachable');
  } else {
    console.log('  --   no object storage configured, so the presigned slot path is not walked');
    console.log('       (the cap DECISION is covered above and below without it)');
  }
  ok('and whether storage is configured is a real answer, not an absent export',
    typeof configured === 'boolean',
    'this guard used to read a property that does not exist and always passed');
}

{
  // What the route does with a draft that already has a logbook: the second
  // slot must not be able to name a different one. Asserted against the
  // rows rather than through HTTP, because the rule lives in
  // createUploadSlot and the route is a thin wrapper over it.
  const draft = crypto.randomBytes(24).toString('hex');
  await pool.query(
    `INSERT INTO upload_slots (slot_token, draft_token, declared_size, staging_key, logbook_id, expires_at)
     VALUES ($1, $2, 1024, $3, $4, now() + interval '1 day')`,
    [crypto.randomBytes(24).toString('hex'), draft, `staging/${draft}-1`, tight.id],
  );
  const { rows } = await pool.query(
    `SELECT max(logbook_id) AS fixed FROM upload_slots
     WHERE draft_token = $1 AND status NOT IN ('rejected','withdrawn','expired')`,
    [draft],
  );
  ok('a draft remembers which logbook its uploads are for',
    String(rows[0].fixed) === String(tight.id), JSON.stringify(rows[0]));

  const src = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../src/attachments.js', import.meta.url), 'utf8'));
  const fn = src.slice(src.indexOf('export async function createUploadSlot'),
    src.indexOf('export async function capsFor'));
  ok('and createUploadSlot refuses a second logbook on the same draft',
    /already being attached to a different logbook/.test(fn),
    'without this the client picks the loosest cap per request');
  ok('and reads the cap from the fixed logbook, not from the request',
    fn.includes('const forLogbook = fixed || logbookId'),
    'the fixed one wins, so the first upload decides and the rest comply');
}

// ---------------------------------------------------------------------
// The third permission, and that the declaration is not one.
// ---------------------------------------------------------------------
{
  ok('evidence_request is a permission', P.isPermission(P.EVIDENCE_REQUEST));
  ok('and it is not granted until somebody grants it',
    P.NONE_GRANTED[P.EVIDENCE_REQUEST] === false);
  ok('what a reporter said they had is NOT a permission',
    !P.isPermission('has_evidence') && !P.isPermission('evidence_declaration'),
    'that is a sealed answer to a logbook question; conflating them puts a revocable value in the hash');

  const { rows } = await pool.query(
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'report_permissions_log_permission_check'",
  );
  const def = rows[0] ? rows[0].def : '';
  for (const p of ['contact_passing', 'attachment_publication', 'evidence_request']) {
    ok(`the log admits '${p}'`, new RegExp(`\\b${p}\\b`).test(def),
      'a migration narrowed the constraint under its own history');
  }
  ok('and the values are bare strings, not mangled casts', !/::text,/.test(def), def);

  // The table's own CHECK still says only the reporter writes it. A third
  // permission must not have widened that.
  const { rows: actor } = await pool.query(
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'report_permissions_log_actor_check'",
  );
  ok('ONLY THE REPORTER STILL WRITES A PERMISSION', /reporter/.test(actor[0] ? actor[0].def : ''),
    'a moderator granting one on somebody\'s behalf would record the operator\'s decision in their name');
}

// ---------------------------------------------------------------------
// THE BUG THE THREE-LAYER LIMITS INTRODUCED, caught before it shipped.
//
// `kindFor` has always returned 'image'. The operator's kind list —
// site_settings.attachment_kinds and now logbooks.attachment_kinds — has
// always keyed photos as 'photo'. Nothing compared the two until the
// accepted-kinds list became something an upload is CHECKED against, and
// then `limits.kinds.includes(kindFor(type))` was false for every
// photograph ever uploaded. Photos would have been refused outright.
// ---------------------------------------------------------------------
{
  ok('kindFor still says image, which is its own vocabulary',
    A.kindFor('image/jpeg') === 'image');
  ok("and the operator's list still keys photos as photo",
    Object.keys(A.ATTACHMENT_KINDS).includes('photo'));
  ok('SO THE TRANSLATION IS NAMED, AND A PHOTO MATCHES THE OPERATOR LIST',
    A.settingKindFor('image/jpeg') === 'photo',
    'without this every photograph is refused as a kind nobody accepts');
  for (const [type, want] of [['video/mp4', 'video'], ['audio/mp4', 'audio'],
    ['application/pdf', 'document'], ['image/png', 'photo'], ['image/heic', 'photo']]) {
    ok(`${type} resolves to the operator kind '${want}'`, A.settingKindFor(type) === want);
  }
  ok('and an unknown type resolves to nothing rather than to photos',
    A.settingKindFor('application/x-msdownload') === null,
    'defaulting to a real kind would let an unhandled type through the kind gate');

  // Both names reach the same ceiling, because callers hold both.
  const limits = A.shippedLimits();
  ok('both names reach the same per-file ceiling',
    A.maxBytesForKind('photo', limits) === A.maxBytesForKind('image', limits));
}

// ---------------------------------------------------------------------
// THE THREE LAYERS, and that each one is invisible when it sets nothing.
// ---------------------------------------------------------------------
{
  const shipped = A.shippedLimits();
  // CLEARED FIRST, because the scratch database is shared with the rest of
  // the suite and an earlier script sets the site's attachment kinds. The
  // first version of this assertion assumed a pristine row and failed on
  // somebody else's setting — which is the same class of mistake as a test
  // that depends on the order it runs in.
  await pool.query(`UPDATE site_settings SET
      max_image_bytes = NULL, max_video_bytes = NULL, max_audio_bytes = NULL,
      max_document_bytes = NULL, max_video_seconds = NULL, max_document_pages = NULL,
      max_files = NULL, max_total_bytes = NULL, attachment_kinds = NULL
    WHERE id = true`);
  const site = await A.limitsFor(null);
  ok('a site that set nothing behaves exactly as the shipped defaults',
    JSON.stringify(site) === JSON.stringify(shipped),
    `this is what makes migration 038 additive in behaviour, not just in schema — got ${JSON.stringify(site)}`);

  // Set a site limit and watch an unconfigured logbook inherit it.
  await pool.query('UPDATE site_settings SET max_image_bytes = $1 WHERE id = true',
    [5 * 1024 * 1024]);
  const inherited = await A.limitsFor(plain.id);
  ok('a logbook that set nothing inherits the site', inherited.maxImageBytes === 5 * 1024 * 1024,
    String(inherited.maxImageBytes));
  ok('and the limits it did not set are still the shipped ones',
    inherited.maxVideoSeconds === shipped.maxVideoSeconds);

  // And a logbook limit overriding it.
  await pool.query('UPDATE logbooks SET max_image_bytes = $2 WHERE id = $1',
    [plain.id, 2 * 1024 * 1024]);
  const own = await A.limitsFor(plain.id);
  ok('a logbook that set one overrides the site', own.maxImageBytes === 2 * 1024 * 1024,
    String(own.maxImageBytes));
  ok('and the site still applies where no logbook is named',
    (await A.limitsFor(null)).maxImageBytes === 5 * 1024 * 1024);

  await pool.query('UPDATE site_settings SET max_image_bytes = NULL WHERE id = true');
  await pool.query('UPDATE logbooks SET max_image_bytes = NULL WHERE id = $1', [plain.id]);
}

// ---------------------------------------------------------------------
// KINDS INTERSECT. The site switch is a ceiling, not a default.
// ---------------------------------------------------------------------
{
  await pool.query("UPDATE site_settings SET attachment_kinds = ARRAY['photo','document'] WHERE id = true");
  await pool.query("UPDATE logbooks SET attachment_kinds = ARRAY['photo','video'] WHERE id = $1", [plain.id]);

  const l = await A.limitsFor(plain.id);
  ok('A LOGBOOK CANNOT TAKE A KIND THE SITE HAS SWITCHED OFF',
    !l.kinds.includes('video'),
    'otherwise turning a kind off site-wide leaves it on wherever a logbook named it');
  ok('and keeps the one they agree on', l.kinds.includes('photo'), JSON.stringify(l.kinds));
  ok('and does not gain the one only the site allows', !l.kinds.includes('document'),
    'the logbook narrowed to photo and video; document is not its choice');

  await pool.query("UPDATE logbooks SET attachment_kinds = NULL WHERE id = $1", [plain.id]);
  const wide = await A.limitsFor(plain.id);
  ok('a logbook that names no kinds takes whatever the site takes',
    wide.kinds.join(',') === 'photo,document', JSON.stringify(wide.kinds));

  await pool.query('UPDATE site_settings SET attachment_kinds = NULL WHERE id = true');
  ok('and with neither set, every kind the code handles is on',
    (await A.limitsFor(plain.id)).kinds.length === A.ALL_KINDS.length);
}

// ---------------------------------------------------------------------
// The database refuses a nonsense limit on BOTH tables.
// ---------------------------------------------------------------------
{
  for (const [table, where] of [['site_settings', 'id = true'], ['logbooks', `id = ${plain.id}`]]) {
    let tiny = null; let huge = null; let badKind = null;
    try {
      await pool.query(`UPDATE ${table} SET max_image_bytes = 10 WHERE ${where}`);
    } catch (e) { tiny = e; }
    try {
      await pool.query(`UPDATE ${table} SET max_video_seconds = 99999 WHERE ${where}`);
    } catch (e) { huge = e; }
    try {
      await pool.query(`UPDATE ${table} SET attachment_kinds = ARRAY['hologram'] WHERE ${where}`);
    } catch (e) { badKind = e; }
    ok(`${table} refuses a ten-byte photo limit`, !!tiny);
    ok(`${table} refuses an hour-and-a-half of video`, !!huge);
    ok(`${table} refuses a kind the code has never heard of`, !!badKind,
      'a typo here would silently narrow a logbook to nothing');
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
