/**
 * Applying a template, against a real database.
 *
 * The pure rules are in the main suite. What needs a database is the claim
 * the whole feature rests on:
 *
 *   APPLYING A TEMPLATE WRITES ORDINARY SETTINGS, ADDS ONE DRAFT LOGBOOK, AND
 *   THEN HAS NO FURTHER EFFECT — AND IT DOES NOT DISTURB A LOGBOOK OR A
 *   REPORT ALREADY THERE.
 *
 * So this files a report into a launched logbook, applies templates over the
 * top, and checks that the logbook and the report are exactly as they were.
 *
 *   npm run test:db
 */
import crypto from 'node:crypto';
import { pool } from '../src/db.js';
import { applyTemplate } from '../src/applyTemplate.js';
import { templateById, templateLogbook } from '../src/templates.js';
import { clearCopyCache, siteCopy } from '../src/siteCopy.js';
import { clearLookCache, currentLook } from '../src/look.js';
import { insertReportVersion, normalizeReportFields } from '../src/reportCore.js';
import { verifyReport } from '../src/verify.js';
import * as L from '../src/logbooks.js';

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};
const verifies = (v) => v?.content?.ok === true && v?.link?.ok === true && v?.position?.ok === true;
const clearAll = () => { clearCopyCache(); clearLookCache(); };

/* ---- a logbook and a report that were there first ---------------------- */
console.log('\na logbook and a report filed before any template');

const own = (await L.createLogbook({ title: 'Our own', slug: 'tpl-own' })).logbook;
await L.addField(own.id, { kind: 'long_text', label: 'What happened' });
await L.launch(own.id);
let filed;
{
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    filed = await insertReportVersion(client, {
      threadId: crypto.randomUUID(), correctsId: null, logbookId: own.id,
      fields: normalizeReportFields({
        logbook: 'tpl-own', answers: { what_happened: 'Filed before any template was applied.' },
        may_publish: true, may_publish_digest: 'f'.repeat(64),
      }),
    });
    await client.query('INSERT INTO report_heads (thread_id, current_report_id) VALUES ($1, $2)',
      [filed.thread_id, filed.id]);
    await client.query('COMMIT');
  } finally { client.release(); }
}
ok('the report verifies before anything is applied', verifies(await verifyReport(filed.public_ref)));
const ownBefore = JSON.stringify(await L.fieldsFor(own.id));

/* ---- applying one -------------------------------------------------------- */
console.log('\napplying the no-files-no-free-text template');
{
  const out = await applyTemplate('elections-choices');
  ok('it applies', out.ok === true, JSON.stringify(out));
  clearAll();
  const file = templateLogbook('elections-choices');
  const lb = await L.logbookBySlug(file.slug);
  ok('it makes the logbook its file describes', !!lb && out.logbook?.slug === file.slug,
    JSON.stringify(out.logbook));
  ok('AS A DRAFT — launching is never done on anybody\'s behalf', lb?.state === 'draft', lb?.state);
  const qs = await L.fieldsFor(lb.id);
  ok('with every question in the file, in its order',
    qs.map((q) => q.key).join() === file.questions.map((q) => q.key).join(),
    qs.map((q) => q.key).join());
  ok('and no files', lb.accepts_files === false);
  const { rows } = await pool.query(
    'SELECT public_archive_enabled, attachments_enabled, intake_enabled, template_applied FROM site_settings WHERE id = true');
  ok('the switches it names are set', rows[0].public_archive_enabled === true
    && rows[0].attachments_enabled === false && rows[0].intake_enabled === true, JSON.stringify(rows[0]));
  ok('and which template was applied is recorded', rows[0].template_applied === 'elections-choices');
}
{
  // Not a mode: the draft is an ordinary logbook, and gains a written
  // question like any other.
  const lb = await L.logbookBySlug(templateLogbook('elections-choices').slug);
  const r = await L.addField(lb.id, { kind: 'long_text', label: 'Anything else, in your own words?' });
  ok('its logbook takes a written question like any other', r.ok, JSON.stringify(r));
  // TAKING FILES IS A QUESTION NOW, not a switch. This template's logbook is
  // the no-files one, so it takes none until somebody asks for them — and
  // asking is adding the question, like any other.
  ok('and takes no files, because it asks for none',
    (await L.logbookBySlug(lb.slug)).accepts_files === false);
  const f = await L.addField(lb.id, { kind: 'file', label: 'Photos, video or documents' });
  ok('and takes files as soon as it asks for them', f.ok, JSON.stringify(f));
  ok('which the logbook itself then reports',
    (await L.logbookBySlug(lb.slug)).accepts_files === true);
  // AT MOST ONE. Two upload questions would be two places for the same files,
  // and the manifest they seal into says nothing about which one they came
  // from.
  const twice = await L.addField(lb.id, { kind: 'file', label: 'More files' });
  ok('a second upload question is refused',
    twice.ok === false && twice.reason === 'file-exists', JSON.stringify(twice));
  // NEVER REQUIRED: it seals no answer, so nothing could tell whether it was
  // satisfied, and buildAnswers skips it outright.
  const lb2 = await L.createLogbook({ title: 'Needs a photo', slug: 'needs-a-photo' });
  const req = await L.addField(lb2.logbook.id,
    { kind: 'file', label: 'A photo', required: true });
  ok('a required upload question is refused',
    req.ok === false && req.reason === 'file-required', JSON.stringify(req));

  // THE FREEZE, which is not the question. It works on a launched logbook,
  // both ways, because a question cannot be removed after launch and a running
  // logbook still has to be able to stop taking files.
  const fr = await L.setFilesFrozen(lb.id, true);
  ok('uploads can be frozen', fr.ok && fr.logbook.files_frozen_at !== null, JSON.stringify(fr));
  ok('and the logbook still ASKS for files while frozen — they are two facts',
    fr.logbook.accepts_files === true);
  ok('so it takes none while the freeze is on', L.takesFiles(fr.logbook) === false);
  const un = await L.setFilesFrozen(lb.id, false);
  ok('the freeze comes off', un.ok && un.logbook.files_frozen_at === null);
  ok('and it takes files again', L.takesFiles(un.logbook) === true);
}

console.log('\napplying it again');
{
  const out = await applyTemplate('elections-choices');
  ok('makes a SECOND draft rather than touching the first',
    out.ok && out.logbook.slug === `${templateLogbook('elections-choices').slug}-2`, JSON.stringify(out.logbook));
}

console.log('\nwhat a template must never touch');
{
  ok('a logbook that was already there is exactly as it was',
    JSON.stringify(await L.fieldsFor(own.id)) === ownBefore);
  ok('and still launched', (await L.logbookById(own.id)).state !== 'draft');
  ok('the report filed at the start STILL VERIFIES', verifies(await verifyReport(filed.public_ref)));
  const { rows } = await pool.query('SELECT impressum_text, privacy_text FROM site_settings WHERE id = true');
  ok('the imprint and the privacy policy are untouched',
    rows[0].impressum_text === null && rows[0].privacy_text === null, JSON.stringify(rows[0]));
}
{
  await applyTemplate('workplace');
  clearAll();
  const copy = await siteCopy();
  ok('the page copy a template carries is written',
    /inside this organisation/i.test(copy.home_intro), copy.home_intro?.slice(0, 80));
  // NO SHIPPED TEMPLATE TOUCHES THE LOOK, and this asserts it rather than
  // merely not testing it. A starting point answers what kind of archive this
  // is; it has no business also repainting the site, and picking "workplace"
  // used to turn the whole deployment grey-blue as a side effect of that
  // question. The look starts at the shipped flint/signal and moves only when
  // somebody moves it, under Style. TEMPLATE_KEYS still accepts `palette` and
  // `theme` so an operator's own template file is not refused whole — which is
  // exactly why this has to be checked and not assumed.
  const look = await currentLook();
  ok('and the look is left at the shipped one, because no template sets it',
    look.palette === 'flint' && look.theme === 'signal', JSON.stringify(look));
  // A key the template omits is left alone rather than reset.
  await pool.query("UPDATE site_settings SET site_name = 'Kept By Hand' WHERE id = true");
  await applyTemplate('workplace');
  const { rows } = await pool.query('SELECT site_name FROM site_settings WHERE id = true');
  ok('a setting the template does not mention is left alone', rows[0].site_name === 'Kept By Hand');
}

console.log('\nstarting from nothing');
{
  await pool.query("UPDATE site_settings SET site_name = 'Somebody Else Archive' WHERE id = true");
  clearAll();
  const { rows: before } = await pool.query('SELECT count(*)::int AS n FROM logbooks');
  const out = await applyTemplate('blank');
  ok('it applies', out.ok === true && !out.logbook, JSON.stringify(out));
  clearAll();
  // THE NAME IS LEFT ALONE, and that is deliberate rather than a gap. The setup
  // wizard asks for the name BEFORE the starting point and refuses a blank one,
  // so a template clearing it would wipe what somebody typed on the screen
  // before and hand them a deployment named after the software. Everything else
  // "start from nothing" names, it still clears.
  const { rows } = await pool.query('SELECT site_name FROM site_settings WHERE id = true');
  ok('the name somebody already chose survives it',
    rows[0].site_name === 'Somebody Else Archive', String(rows[0].site_name));
  const { rows: copy } = await pool.query('SELECT count(*)::int AS n FROM site_copy');
  ok('and every piece of page text with it', copy[0].n === 0);
  const { rows: after } = await pool.query('SELECT count(*)::int AS n FROM logbooks');
  ok('it makes no logbook and removes none', after[0].n === before[0].n);
  ok('the report filed at the start STILL VERIFIES', verifies(await verifyReport(filed.public_ref)));
}

{
  const out = await applyTemplate('no_such_template');
  ok('an unknown template is refused rather than partly applied', out.ok === false);
  ok('and every shipped one is real', templateById('workplace') !== null);
}

// Leave the instance as the rest of the suite expects.
await pool.query(
  `UPDATE site_settings SET site_name = NULL, theme = NULL, palette = NULL, layout = NULL, template_applied = NULL,
     template_applied_at = NULL, public_archive_enabled = NULL,
     attachments_enabled = NULL, intake_enabled = NULL WHERE id = true`,
);
await pool.query('DELETE FROM site_copy');
clearAll();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
