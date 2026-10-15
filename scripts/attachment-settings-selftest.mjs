/**
 * The attachment settings, against a real database.
 *
 * These cannot live in the main suite: enabledKinds and attachmentsEnabled
 * are pure and are tested there, but the tri-state — NULL meaning "defer to
 * the environment", an empty array meaning "none", and a stored false
 * beating an environment true — only exists once a row round-trips through
 * Postgres, where NULL and '{}' are genuinely different values.
 *
 *   DATABASE_URL="postgres://…/scratch" node scripts/attachment-settings-selftest.mjs
 */
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to a scratch database with the migrations applied.');
  process.exit(2);
}
process.env.TIER_B_ENCRYPTION_KEY ||= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.CONTACT_HMAC_KEY ||= '0123456789abcdef0123456789abcdef';
const { pool } = await import('../src/db.js');
const A = await import('../src/attachments.js');
let pass=0, fail=0;
const ok=(n,c,x)=>{ c?(pass++,console.log('  ok   '+n)):(fail++,console.log('  FAIL '+n+(x?' — '+x:''))); };

await pool.query('INSERT INTO site_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING');

console.log('\nthe stored setting');
await pool.query('UPDATE site_settings SET attachments_enabled=NULL, attachment_kinds=NULL WHERE id=true');
A.clearAttachmentSettingsCache();
let s = await A.attachmentSettings();
ok('an untouched install defers to the environment', s.attachments_enabled === null);
ok('and offers every family the code supports', A.enabledKinds(s).join(',') === A.ALL_KINDS.join(','));

await pool.query("UPDATE site_settings SET attachment_kinds='{photo,audio}' WHERE id=true");
A.clearAttachmentSettingsCache();
s = await A.attachmentSettings();
ok('a narrowed list is honoured', A.enabledKinds(s).join(',') === 'photo,audio');
ok('and a type outside it is not currently allowed',
   !A.allowedTypesFor(s).includes('application/pdf'));
ok('while a type inside it is', A.allowedTypesFor(s).includes('image/jpeg'));
ok('narrowing never changes what the CODE supports — only what is taken now',
   A.ALLOWED_TYPES.includes('application/pdf'));

await pool.query("UPDATE site_settings SET attachment_kinds='{}' WHERE id=true");
A.clearAttachmentSettingsCache();
s = await A.attachmentSettings();
ok('an empty list means none, not all', A.enabledKinds(s).length === 0);

await pool.query('UPDATE site_settings SET attachments_enabled=false WHERE id=true');
A.clearAttachmentSettingsCache();
s = await A.attachmentSettings();
process.env.ATTACHMENTS_ENABLED='true';
ok('an admin switching off beats the environment switching on',
   A.attachmentsEnabled(s) === false);

console.log('\n'+pass+' passed, '+fail+' failed');
await pool.end(); process.exit(fail?1:0);
