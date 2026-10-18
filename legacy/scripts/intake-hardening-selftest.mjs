/**
 * Intake hardening: whose staging it is, and when the worker may touch it.
 *
 * WHAT NEEDS POSTGRES. All three pieces are about rows, and two of them are
 * about rows BELONGING TO SOMEBODY ELSE'S DRAFT — which is exactly what a
 * unit test cannot see:
 *
 *   - The staging quota is a sum across every draft one address has open.
 *     Its predecessor summed one draft, and a draft token is free, so the
 *     old cap bounded a draft and not a caller. Proving the new one works
 *     means staging into two drafts and watching the second be refused.
 *   - `released_at` is what the media worker's claim query filters on. The
 *     only honest way to show an unreleased slot is never worked on is to
 *     run that query against real rows.
 *   - Confirming while a file is still being prepared must not seal a
 *     report that silently does not hold it. `inFlightSlotsFor` is what
 *     stands where the form's Ready gate used to.
 *
 * Run by `npm run test:db` against a throwaway database.
 */
import 'dotenv/config';
import crypto from 'node:crypto';

/* STORAGE THAT IS CONFIGURED AND UNREACHABLE, on purpose.
 *
 * `createUploadSlot` ends by presigning a PUT, and presigning refuses
 * outright when storage is not configured — so a script that exercises slot
 * creation needs credentials even though it never uploads a byte. These are
 * nonsense pointed at a hostname that cannot resolve: the URL is built and
 * signed locally and nothing in this file ever fetches it, so a run that
 * somehow tried to would fail loudly rather than reach a real bucket.
 *
 * Set rather than overridden, so a deployment's own values are left alone if
 * somebody runs this with a real .env — it still never uploads anything.
 */
for (const [k, v] of Object.entries({
  S3_ENDPOINT: 'https://storage.invalid',
  S3_ACCESS_KEY: 'selftest',
  S3_SECRET_KEY: 'selftest',
  S3_BUCKET_EVIDENCE: 'evidence',
  S3_BUCKET_RENDITIONS: 'renditions',
  S3_BUCKET_STAGING: 'staging',
})) if (!process.env[k]) process.env[k] = v;

const { pool } = await import('../src/db.js');
const L = await import('../src/logbooks.js');
const A = await import('../src/attachments.js');
const { hmacEmail } = await import('../src/crypto.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

const draft = () => crypto.randomBytes(24).toString('hex');

async function launched(slug, caps = {}) {
  const made = await L.createLogbook({ title: `Hardening ${slug}`, slug });
  // Said plainly rather than as "cannot read properties of undefined", which
  // is what this looked like the first time it was run twice against the same
  // database. The suite gives every run a throwaway one; a hand-run does not.
  if (!made.ok) {
    console.error(`could not create the logbook "${slug}": ${made.reason}.`
      + ' This script expects a database of its own — npm run test:db makes one.');
    await pool.end();
    process.exit(2);
  }
  await L.addField(made.logbook.id, { kind: 'long_text', label: 'What happened' });
  await L.addField(made.logbook.id, { kind: 'file', label: 'Photos' });
  if (caps.maxTotalBytes !== undefined || caps.maxFiles !== undefined) {
    await pool.query(
      'UPDATE logbooks SET max_files = $2, max_total_bytes = $3 WHERE id = $1',
      [made.logbook.id, caps.maxFiles ?? null, caps.maxTotalBytes ?? null],
    );
  }
  await L.launch(made.logbook.id);
  return L.logbookById(made.logbook.id);
}

// A small total so the quota can be tripped without staging gigabytes: three
// reports' worth of 2 MB is 6 MB, and `maxFiles` is left wide so it is
// always the BYTE ceiling that refuses, never the file count standing in for
// it and reading as a pass.
const lb = await launched('hardening', { maxFiles: 50, maxTotalBytes: 2 * 1024 * 1024 });
const JPEG = 'image/jpeg';

// ---------------------------------------------------------------------
// An address is required while filing, because the quota is keyed on it.
// ---------------------------------------------------------------------
{
  let noneAtAll = null; let nonsense = null;
  try {
    await A.createUploadSlot(draft(), { name: 'a.jpg', type: JPEG, size: 1024, logbookId: lb.id });
  } catch (e) { noneAtAll = e; }
  try {
    await A.createUploadSlot(draft(), {
      name: 'a.jpg', type: JPEG, size: 1024, logbookId: lb.id, contactEmail: 'not-an-address',
    });
  } catch (e) { nonsense = e; }

  ok('a filing slot with no address at all is refused', noneAtAll?.status === 400,
    'without this the quota is decorative: a caller simply stops sending the field');
  ok('and so is one with something that is not an address', nonsense?.status === 400,
    String(nonsense?.message));
}

// ---------------------------------------------------------------------
// THE QUOTA IS ACROSS DRAFTS, which is the whole point of it.
// ---------------------------------------------------------------------
{
  const mine = 'Reporter@Example.ORG';
  const one = draft(); const two = draft();
  const MB = 1024 * 1024;

  // Fill one draft to its own per-report ceiling, then open a fresh draft
  // and keep going. Before this change the second draft started from zero.
  const first = await A.createUploadSlot(one, {
    name: '1.jpg', type: JPEG, size: 2 * MB, logbookId: lb.id, contactEmail: mine,
  });
  ok('the first file is accepted', Boolean(first.slotToken));

  const second = await A.createUploadSlot(two, {
    name: '2.jpg', type: JPEG, size: 2 * MB, logbookId: lb.id, contactEmail: mine,
  });
  ok('and a second draft is still allowed — three reports’ worth is generous on purpose',
    Boolean(second.slotToken),
    'refusing a reporter’s second real report is worse than some wasted staging');

  const third = await A.createUploadSlot(draft(), {
    name: '3.jpg', type: JPEG, size: 2 * MB, logbookId: lb.id, contactEmail: mine,
  });
  ok('and a third', Boolean(third.slotToken));

  let over = null;
  try {
    await A.createUploadSlot(draft(), {
      name: '4.jpg', type: JPEG, size: 2 * MB, logbookId: lb.id, contactEmail: mine,
    });
  } catch (e) { over = e; }
  ok('the fourth draft is refused, because the ceiling is per ADDRESS not per draft',
    over?.status === 429, String(over?.message));

  // The same person, typed differently. `hmacEmail` lowercases and trims, so
  // this must be the same bucket — otherwise the quota is walked around by
  // holding down shift.
  let shifted = null;
  try {
    await A.createUploadSlot(draft(), {
      name: '5.jpg', type: JPEG, size: 2 * MB, logbookId: lb.id,
      contactEmail: '  reporter@example.org ',
    });
  } catch (e) { shifted = e; }
  ok('and the same address in different case and spacing is the same bucket',
    shifted?.status === 429,
    'otherwise the ceiling is defeated by the shift key');

  // Somebody else is unaffected. A shared ceiling would be an outage one
  // person could cause for everybody.
  const other = await A.createUploadSlot(draft(), {
    name: '6.jpg', type: JPEG, size: 2 * MB, logbookId: lb.id,
    contactEmail: 'somebody-else@example.org',
  });
  ok('another address is not held back by it', Boolean(other.slotToken));

  // What is stored is a digest and never a reachable address.
  const { rows: stored } = await pool.query(
    'SELECT contact_hmac FROM upload_slots WHERE slot_token = $1', [first.slotToken],
  );
  ok('the row holds the keyed digest, not the address',
    stored[0].contact_hmac === hmacEmail(mine)
      && !/@/.test(String(stored[0].contact_hmac)),
    String(stored[0].contact_hmac));

  // And a slot that already reached a report stops counting: that is storage
  // the archive means to hold, not staging somebody is sitting on.
  await pool.query('UPDATE upload_slots SET promoted_at = now() WHERE contact_hmac = $1',
    [hmacEmail(mine)]);
  const after = await A.createUploadSlot(draft(), {
    name: '7.jpg', type: JPEG, size: 2 * MB, logbookId: lb.id, contactEmail: mine,
  });
  ok('a file that became part of a report no longer counts against the quota',
    Boolean(after.slotToken),
    'otherwise filing three reports locks a reporter out of ever filing again');
  await pool.query('DELETE FROM upload_slots WHERE contact_hmac = $1', [hmacEmail(mine)]);
}

// ---------------------------------------------------------------------
// NOTHING IS WORKED ON BEFORE SEND. The worker's own claim query.
// ---------------------------------------------------------------------
{
  const d = draft();
  const slot = await A.createUploadSlot(d, {
    name: 'v.jpg', type: JPEG, size: 1024, logbookId: lb.id,
    contactEmail: 'release@example.org',
  });
  await A.markSlotUploaded(slot.slotToken);

  // The worker's WHERE, copied. Asserted against rows rather than against
  // the file's text, because what matters is which rows come back.
  const claim = async () => (await pool.query(
    `SELECT slot_token FROM upload_slots
     WHERE status = 'uploaded' AND released_at IS NOT NULL AND expires_at > now()
       AND draft_token = $1`,
    [d],
  )).rows;

  ok('a staged file nobody has sent is not work the worker will claim',
    (await claim()).length === 0,
    'this is what let the Ready gate go: no transcoding happens during filing');

  const released = await A.releaseDraft(d);
  ok('pressing Send releases it', released === 1);
  ok('and then the worker claims it',
    (await claim()).some((r) => r.slot_token === slot.slotToken));

  // Releasing twice must not restamp: released_at says when the reporter
  // pressed Send, and a second stamp would be a different claim.
  const { rows: before } = await pool.query(
    'SELECT released_at FROM upload_slots WHERE slot_token = $1', [slot.slotToken],
  );
  ok('releasing again changes nothing', await A.releaseDraft(d) === 0);
  const { rows: afterRows } = await pool.query(
    'SELECT released_at FROM upload_slots WHERE slot_token = $1', [slot.slotToken],
  );
  ok('and the stamp still says when Send was pressed',
    String(before[0].released_at) === String(afterRows[0].released_at));
}

// ---------------------------------------------------------------------
// An evidence-request slot is released at creation, so THAT path is
// untouched. It came through a scoped one-time link and hands its files
// over in the same request, so there is no later moment to release in.
// ---------------------------------------------------------------------
{
  // A bare row to hang a slot on. The request flow itself is
  // evidence-request-selftest's business; all this needs is an id.
  const { rows: asked } = await pool.query(
    `INSERT INTO evidence_requests (thread_id, asked_by, message, token_hash, expires_at)
     VALUES ($1, 'moderator@example.org', 'Please send the photographs you mentioned.',
             $2, now() + interval '1 day')
     RETURNING id`,
    [crypto.randomUUID(), crypto.randomBytes(32).toString('hex')],
  );

  const d = draft();
  const slot = await A.createUploadSlot(d, {
    name: 'e.jpg', type: JPEG, size: 1024, logbookId: lb.id,
    evidenceRequestId: asked[0].id,
  });
  const { rows } = await pool.query(
    'SELECT released_at, contact_hmac FROM upload_slots WHERE slot_token = $1',
    [slot.slotToken],
  );
  ok('an evidence-request slot needs no address — the link authorised it',
    rows[0].contact_hmac === null);
  ok('and it is released at creation, so that path works exactly as before',
    rows[0].released_at !== null,
    'otherwise its submit step finds nothing finished and refuses forever');
}

// ---------------------------------------------------------------------
// CONFIRMING MUST NOT SEAL A REPORT WITHOUT A FILE THAT IS STILL COMING.
// This is what stands where the form's Ready gate used to.
// ---------------------------------------------------------------------
{
  const d = draft();
  const slot = await A.createUploadSlot(d, {
    name: 'w.jpg', type: JPEG, size: 1024, logbookId: lb.id,
    contactEmail: 'inflight@example.org',
  });

  ok('a slot whose PUT never finished is NOT in flight',
    (await A.inFlightSlotsFor(d)).length === 0,
    'including it would block a confirmation on bytes that are never arriving');

  await A.markSlotUploaded(slot.slotToken);
  await A.releaseDraft(d);
  ok('a released file waiting for the worker IS in flight',
    (await A.inFlightSlotsFor(d)).length === 1);

  await pool.query("UPDATE upload_slots SET status = 'processing' WHERE slot_token = $1",
    [slot.slotToken]);
  ok('and so is one being worked on right now',
    (await A.inFlightSlotsFor(d)).length === 1);

  await pool.query("UPDATE upload_slots SET status = 'clean' WHERE slot_token = $1",
    [slot.slotToken]);
  ok('a finished file is not in flight, so the confirmation goes ahead',
    (await A.inFlightSlotsFor(d)).length === 0);
  ok('and it is what clearedSlotsFor hands the manifest',
    (await A.clearedSlotsFor(d)).length === 1,
    'the two must agree, or a confirmation waits for a file it will not seal');

  // A refused file is not in flight either: nothing more is going to happen
  // to it, and waiting would hold a report for a file it will never carry.
  const d2 = draft();
  const bad = await A.createUploadSlot(d2, {
    name: 'x.jpg', type: JPEG, size: 1024, logbookId: lb.id,
    contactEmail: 'inflight@example.org',
  });
  await pool.query("UPDATE upload_slots SET status = 'unreadable' WHERE slot_token = $1",
    [bad.slotToken]);
  ok('a file that was refused is not in flight',
    (await A.inFlightSlotsFor(d2)).length === 0,
    'the reporter is told at confirmation; they are not made to wait for it');
}

// ---------------------------------------------------------------------
// The wait has to outlast the worker's own retry, or it gives up exactly
// as the retry begins.
// ---------------------------------------------------------------------
{
  const stale = Number(process.env.MEDIA_WORKER_STALE_MINUTES || 15) * 60 * 1000;
  ok('the confirmation waits longer than an interrupted attempt takes to requeue',
    A.CONFIRM_WAIT_MS > stale,
    `${A.CONFIRM_WAIT_MS}ms vs ${stale}ms`);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
