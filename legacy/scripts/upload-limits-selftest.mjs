/**
 * Every upload limit as something an operator sets, against a real
 * database.
 *
 * THE THREE LAYERS ONLY EXIST ONCE A ROW ROUND-TRIPS. `limitsFor` resolves
 * the logbook, then the site, then the shipped default, and a NULL at a
 * layer has to be invisible rather than read as zero — which is a
 * distinction JavaScript will happily lose and Postgres will not.
 *
 * AND THE RANGES HAVE TO AGREE WITH THE DATABASE. `LIMIT_RANGES` in
 * src/attachments.js and the CHECK constraints in migration 038 are two
 * statements of the same bounds, and nothing stops them drifting. A drift
 * shows an operator a number the form accepted and the UPDATE threw on,
 * which reads as "something went wrong" and tells them nothing. This asks
 * the database to accept each bound and refuse one past it, which pins them
 * together without parsing a constraint definition back — parsing those is
 * how 036 came to allow the string `correct'::text`.
 *
 *   DATABASE_URL="postgres://…/scratch" node scripts/upload-limits-selftest.mjs
 */
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to a scratch database with the migrations applied.');
  process.exit(2);
}
process.env.TIER_B_ENCRYPTION_KEY ||= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.CONTACT_HMAC_KEY ||= '0123456789abcdef0123456789abcdef';
const { pool } = await import('../src/db.js');
const A = await import('../src/attachments.js');
const L = await import('../src/logbooks.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (x ? ' — ' + x : ''))); };

await pool.query('INSERT INTO site_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING');

// Cleared first: an earlier script in the shared scratch database may have
// set these, and a test that assumes a pristine row fails for a reason that
// has nothing to do with what it is checking.
const CLEAR_SITE = `UPDATE site_settings SET ${Object.values(A.LIMIT_RANGES)
  .map((r) => `${r.column} = NULL`).join(', ')}, attachment_kinds = NULL WHERE id = true`;
await pool.query(CLEAR_SITE);

// A logbook of its own, so this never depends on what another script left.
const { rows: [book] } = await pool.query(
  `INSERT INTO logbooks (slug, title, blurb) VALUES ('limits-test', 'Limits', '')
     ON CONFLICT (slug) DO UPDATE SET title = 'Limits'
   RETURNING id`,
);
const LB = book.id;
const CLEAR_BOOK = `UPDATE logbooks SET ${Object.values(A.LIMIT_RANGES)
  .map((r) => `${r.column} = NULL`).join(', ')}, attachment_kinds = NULL WHERE id = $1`;
await pool.query(CLEAR_BOOK, [LB]);

console.log('\nthe three layers');
let lim = await A.limitsFor(LB);
const shipped = A.shippedLimits();
ok('a logbook nobody configured behaves exactly as the shipped default does',
  lim.maxFiles === shipped.maxFiles && lim.maxImageBytes === shipped.maxImageBytes,
  JSON.stringify({ got: lim.maxFiles, want: shipped.maxFiles }));

await A.setSiteLimits(A.validateLimits({ maxFiles: 4, maxImageBytes: 1048576 }).values);
lim = await A.limitsFor(LB);
ok('the site\'s number applies where the logbook sets nothing', lim.maxFiles === 4);
ok('and the shipped one still applies to the keys the site left alone',
  lim.maxVideoSeconds === shipped.maxVideoSeconds);

await L.setLogbookLimits(LB, A.validateLimits({ maxFiles: 2 }).values);
lim = await A.limitsFor(LB);
ok('the logbook\'s own number wins over the site\'s', lim.maxFiles === 2);
ok('and does not disturb the key the site set', lim.maxImageBytes === 1048576);

await L.setLogbookLimits(LB, A.validateLimits({ maxFiles: null }).values);
lim = await A.limitsFor(LB);
ok('clearing the logbook\'s hands it back to the site', lim.maxFiles === 4);
await A.setSiteLimits(A.validateLimits({ maxFiles: null }).values);
lim = await A.limitsFor(LB);
ok('and clearing the site\'s hands it back to the shipped default',
  lim.maxFiles === shipped.maxFiles);

console.log('\nonly what was sent is written');
// From a clean row, so "never set" means never set in this section rather
// than "not set since the last thing that happened to touch it".
await pool.query(CLEAR_SITE);
await A.setSiteLimits(A.validateLimits({ maxFiles: 7, maxVideoSeconds: 20 }).values);
// THE BUG THIS CATCHES: writing every column on every save would set the
// seven nobody sent to whatever the caller happened to be holding, which
// freezes the layer against every later change underneath it.
await A.setSiteLimits(A.validateLimits({ maxFiles: 8 }).values);
const { rows: [after] } = await pool.query(
  'SELECT max_files, max_video_seconds, max_image_bytes FROM site_settings WHERE id = true');
ok('a second save changes the key it sent', Number(after.max_files) === 8);
ok('and LEAVES A KEY IT DID NOT SEND ALONE', Number(after.max_video_seconds) === 20);
ok('and does not invent a value for one never set', after.max_image_bytes === null);

console.log('\nthe ranges agree with the database');
for (const [key, range] of Object.entries(A.LIMIT_RANGES)) {
  const set = async (v) => {
    await pool.query(`UPDATE site_settings SET ${range.column} = $1 WHERE id = true`, [v]);
  };
  const refused = async (v) => {
    try { await set(v); return false; } catch { return true; }
  };
  let good = true, why = '';
  try { await set(range.min); await set(range.max); } catch (e) { good = false; why = 'the database refused a bound the module allows: ' + e.message; }
  if (good && !(await refused(range.min - 1))) { good = false; why = `the database ACCEPTED ${range.min - 1}, below the module's minimum`; }
  if (good && !(await refused(range.max + 1))) { good = false; why = `the database ACCEPTED ${range.max + 1}, above the module's maximum`; }
  ok(`${key}: ${range.min}–${range.max} is what the column enforces too`, good, why);
  await set(null);
}

console.log('\nwhat the module refuses before the database sees it');
ok('a limit of zero is refused — a form that can never be satisfied',
  A.validateLimits({ maxFiles: 0 }).ok === false);
ok('and so is a fraction', A.validateLimits({ maxFiles: 1.5 }).ok === false);
ok('and a word', A.validateLimits({ maxFiles: 'lots' }).ok === false);
ok('null clears, and is not an error', A.validateLimits({ maxFiles: null }).values.maxFiles === null);
ok("an emptied box arrives as '' and clears too",
  A.validateLimits({ maxFiles: '' }).values.maxFiles === null);
ok('a key nobody sent is absent rather than null',
  !('maxFiles' in A.validateLimits({ maxVideoSeconds: 30 }).values));

// Each CHECK passes on its own here, so nothing but this would catch it.
const under = A.validateLimits({ maxTotalBytes: 2097152, maxVideoBytes: 104857600 });
ok('A TOTAL SMALLER THAN ONE FILE OF THAT KIND IS REFUSED', under.ok === false
  && under.reason === 'total-under-one-file',
  'the form would accept the file and then refuse the report carrying it');

console.log('\nkinds intersect rather than override');
await pool.query("UPDATE site_settings SET attachment_kinds = '{photo,audio}' WHERE id = true");
await pool.query("UPDATE logbooks SET attachment_kinds = '{photo,video}' WHERE id = $1", [LB]);
A.clearAttachmentSettingsCache();
lim = await A.limitsFor(LB);
ok('a logbook cannot accept a kind the deployment has switched off',
  lim.kinds.join(',') === 'photo',
  'got ' + lim.kinds.join(',') + ' — the site list is a ceiling, not a default');

await pool.query('UPDATE logbooks SET attachment_kinds = NULL WHERE id = $1', [LB]);
A.clearAttachmentSettingsCache();
lim = await A.limitsFor(LB);
ok('and a logbook naming none takes whatever the site takes',
  lim.kinds.join(',') === 'photo,audio');

ok('a kind name the code does not know is refused',
  A.validateLimits({ kinds: ['photo', 'hologram'] }).ok === false,
  'a typo here would silently narrow a logbook to nothing');
ok('and an empty list is allowed, because taking none is a real answer',
  A.validateLimits({ kinds: [] }).ok === true);

console.log('\nwhat each layer stores, reported separately');
await A.setSiteLimits(A.validateLimits({ maxFiles: 6 }).values);
await L.setLogbookLimits(LB, A.validateLimits({ maxVideoSeconds: 15 }).values);
const layers = await A.limitLayers(LB);
ok('a key the site set is reported as the site\'s',
  layers.maxFiles.site === 6 && layers.maxFiles.logbook === null
  && layers.maxFiles.source === 'site');
ok('a key the logbook set is reported as the logbook\'s',
  layers.maxVideoSeconds.logbook === 15 && layers.maxVideoSeconds.source === 'logbook');
ok('a key nobody set is reported as shipped, with the shipped number',
  layers.maxDocumentPages.source === 'shipped'
  && layers.maxDocumentPages.effective === shipped.maxDocumentPages);
ok('and every key carries all three layers, so a panel can show provenance',
  Object.values(layers).every((v) => 'logbook' in v && 'site' in v && 'shipped' in v
    && 'effective' in v && 'source' in v));

// A limits panel asked about the site alone must not report a logbook's.
const siteOnly = await A.limitLayers(null);
ok('asked without a logbook, nothing is attributed to one',
  Object.values(siteOnly).every((v) => v.logbook === null));

console.log('\nafter launch, which is the point');
await pool.query('UPDATE logbooks SET launched_at = now() WHERE id = $1', [LB]);
const out = await L.setLogbookLimits(LB, A.validateLimits({ maxFiles: 3 }).values);
ok('A LAUNCHED LOGBOOK\'S LIMITS CAN STILL BE SET', out.ok === true,
  'a limit is not a question — it changes no answer anybody gave, and a cap '
  + 'that could only be set before launch could never be corrected');
lim = await A.limitsFor(LB);
ok('and the new number is the one in force', lim.maxFiles === 3);

// Left clean for whatever runs next.
await pool.query(CLEAR_SITE);
await pool.query(CLEAR_BOOK, [LB]);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end(); process.exit(fail ? 1 : 0);
