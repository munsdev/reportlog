import { contentHash, chainHash, genPublicRef, chainGenesis } from './crypto.js';
import { INTAKE_METHODS } from './taxonomy.js';

/**
 * The hashing recipe new reports are written under.
 *
 * The recipe is the promise the archive makes: take these fields,
 * canonicalize them with RFC 8785, SHA-256 the result. Anyone can check
 * any report against it. Changing which fields go in changes that promise,
 * so the version rides *inside* the hashed object rather than being
 * implied by a date. Recipe 1 writes no `recipe` key at all, so the
 * absence of the key is what identifies it.
 *
 * WHAT A REPORT IS. A logbook asked some questions and somebody answered
 * them. The hashed object is that and the few things every report carries
 * however it was filed:
 *
 *   public_ref, received_at, thread_id, corrects_id    always
 *   logbook                                            always — the slug
 *   logbook_form                                       when the report has a form version
 *   may_publish, may_publish_digest                    always
 *   answers                                            when anything was answered
 *   third_party, filed_via, intake_method,
 *     attested_at, collected_on                        when a coordinator filed it
 *   attachments                                        when files were sealed
 *
 * There is no built-in questionnaire. Where, when, what kind — those are
 * questions a logbook asks or does not.
 *
 * THE RULE THAT MAKES THIS EXTENSIBLE: a key is written into the hashed
 * object ONLY when it applies. An absent key and a null one serialize
 * differently under RFC 8785, so a key that was made unconditional would
 * change the fingerprint of every report ever filed. It is what lets a
 * launched logbook gain a new optional question: reports filed before it
 * simply have no answer under that key. Do not "tidy" any of the
 * conditional keys below into being always present.
 */
export const RECIPE = 1;

/**
 * The one written form of a time of day: HH:MM:SS, zero-padded.
 *
 * `<input type="time">` hands back "09:30" with no seconds, while
 * PostgreSQL renders a `time` back as "09:30:00". Whichever string is
 * hashed has to be the one that comes back out, so there is exactly one
 * written form and both sides call this.
 *
 * An absent time stays absent. "No time given" is a real answer, and
 * turning it into midnight would be inventing one.
 */
export function toTimeString(v) {
  if (v === null || v === undefined || v === '') return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v));
  if (!m) return String(v);
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
}

/**
 * Assemble the object that gets canonicalized and hashed.
 *
 * `attachments` is present ONLY when the version actually commits to
 * files, and `recipe` only above 1. See the rule above.
 */
export function buildImmutableFields({
  publicRef, receivedAt, threadId, correctsId, fields, attachmentManifest, recipe = RECIPE,
}) {
  const immutableFields = {
    public_ref: publicRef,
    received_at: receivedAt,
    thread_id: threadId,
    // pg hands bigints back as strings. A correction that hashed "1" where
    // verify.js rebuilds 1 never verifies again, so the number form is
    // settled here rather than left to each caller to remember.
    corrects_id: correctsId === null || correctsId === undefined
      ? null : Number(correctsId),
    ...fields,
  };
  if (recipe > 1) {
    immutableFields.recipe = recipe;
  }
  if (attachmentManifest && attachmentManifest.length) {
    immutableFields.attachments = attachmentManifest;
  }
  return immutableFields;
}

/**
 * Append one version of a report to its logbook's chain.
 *
 * Shared by a new submission, a correction and a coordinator's batch — all
 * of them "append a version", differing only in whether thread_id is new
 * and whether corrects_id points at a prior version. Must be called inside
 * an open transaction on `client`: the lock below lasts as long as it does.
 *
 * ONE CHAIN PER LOGBOOK. The previous link is the newest row IN THIS
 * LOGBOOK, and the first report of a logbook links to chainGenesis(slug).
 * So a fault in one logbook breaks that logbook's chain and nothing else,
 * and each logbook can be downloaded and checked on its own. The lock is
 * per logbook too: two logbooks never wait on each other.
 *
 * `publicRef` and `receivedAt` are overridable for exactly one caller,
 * scripts/import-archive.js, replaying an archive into a new chain, and go
 * through this same function so a replayed report is hashed and chained by
 * the code that hashes and chains every other one.
 */
export async function insertReportVersion(client, {
  threadId, correctsId, fields, attachmentManifest = null,
  publicRef: publicRefOverride = null, receivedAt: receivedAtOverride = null,
  // Bookkeeping that is deliberately NOT hashed: which organization row
  // this was filed under (the sealed claim is its name, in fields.filed_via),
  // and the coordinator's own private reference back to their paper file.
  // Passed here rather than written afterwards because `reports` is
  // append-only — an UPDATE on it is refused by a database trigger.
  organizationId = null, sourceRef = null,
  // Which logbook. The SLUG is what the seal carries (fields.logbook); this
  // id is the join, and the chain the row is appended to.
  logbookId,
  // Which version of the logbook's form the answers were checked against
  // (logbook_forms.id), sealed as `logbook_form`. Callers that read the
  // questions themselves pass the id of THAT reading. Left out, the current
  // questions are used, so no path can file a report without its form.
  // Explicit null means none, and exists for one caller: the archive
  // replay, restoring a report that never had one.
  formId,
}) {
  if (!logbookId) throw new Error('insertReportVersion: every report is in a logbook');
  if (!fields || !fields.logbook) throw new Error('insertReportVersion: fields.logbook is required');

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`reports_chain:${logbookId}`]);

  // The form is resolved inside the transaction and folded into `fields`
  // here, the one place both the hash and the row are written from. It is
  // imported late because logbooks.js needs the database and this module is
  // also loaded by suites that have none.
  let formHash = null;
  let resolvedFormId = null;
  if (formId === undefined) {
    const { logbookById, fieldsFor } = await import('./logbooks.js');
    const { ensureFormVersion } = await import('./logbookForms.js');
    const lb = await logbookById(logbookId, client);
    const v = await ensureFormVersion(lb, await fieldsFor(logbookId, client), client);
    formHash = v.hash; resolvedFormId = v.id;
  } else if (formId !== null) {
    const { rows } = await client.query(
      'SELECT id, form_hash FROM logbook_forms WHERE id = $1 AND logbook_id = $2',
      [formId, logbookId],
    );
    if (!rows.length) throw new Error('insertReportVersion: that form version is not this logbook\'s');
    formHash = rows[0].form_hash; resolvedFormId = rows[0].id;
  }
  if (formHash) fields = { ...fields, logbook_form: formHash };

  const { rows: latest } = await client.query(
    'SELECT chain_hash FROM reports WHERE logbook_id = $1 ORDER BY id DESC LIMIT 1',
    [logbookId],
  );
  const prevChainHash = latest[0]?.chain_hash || chainGenesis(fields.logbook);

  const publicRef = publicRefOverride || genPublicRef();
  const receivedAt = receivedAtOverride || new Date().toISOString();

  const immutableFields = buildImmutableFields({
    publicRef, receivedAt, threadId, correctsId, fields, attachmentManifest,
  });

  const cHash = contentHash(immutableFields);
  const chHash = chainHash(cHash, prevChainHash);

  const { rows } = await client.query(
    `INSERT INTO reports (
       public_ref, received_at, thread_id, corrects_id,
       content_hash, prev_chain_hash, chain_hash, recipe,
       third_party, filed_via, intake_method, attested_at, collected_on,
       organization_id, source_ref,
       may_publish, may_publish_digest,
       logbook_id, answers, form_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [
      publicRef, receivedAt, threadId, correctsId,
      cHash, prevChainHash, chHash, RECIPE,
      // Null on a direct report, which keeps the row and the hashed object
      // saying the same thing: no provenance in one, none in the other.
      fields.third_party === true ? true : null,
      fields.filed_via || null, fields.intake_method || null,
      fields.attested_at || null, fields.collected_on || null,
      organizationId, sourceRef,
      fields.may_publish, fields.may_publish_digest,
      logbookId,
      // The SAME object that was hashed, stored again as a column so the
      // board can index and filter it. Written from `fields`, never from
      // the request, so the column cannot drift from the seal. Absent is
      // NULL, never `{}`: under RFC 8785 those are different values.
      fields.answers ?? null,
      resolvedFormId,
    ],
  );
  return rows[0];
}

/**
 * The field set, in the shape the hash and the insert both take.
 *
 * `answers` must already have been checked against the logbook's own
 * questions by buildAnswers in src/answers.js, which applies the absent-key
 * rule inside the map: an unanswered question has no key. An empty map is
 * dropped here, so "nothing answered" is an absent key rather than `{}`.
 *
 * The publication answer is required, true or false. Every report was
 * asked, and a report sealed without its answer would be a statement that
 * nobody asked — which is never true now.
 */
export function normalizeReportFields(b) {
  const logbook = String(b.logbook || '').trim();
  if (!logbook) throw new Error('normalizeReportFields: logbook is required');

  const mayPublish = (b.may_publish === true || b.may_publish === 'true') ? true
    : (b.may_publish === false || b.may_publish === 'false') ? false
      : undefined;
  const mayPublishDigest = typeof b.may_publish_digest === 'string'
    && /^[a-f0-9]{64}$/.test(b.may_publish_digest) ? b.may_publish_digest : undefined;
  if (mayPublish === undefined || mayPublishDigest === undefined) {
    throw new Error('normalizeReportFields: the publication answer and its digest are required');
  }

  // Third-party provenance, written ONLY when a coordinator filed this on
  // somebody else's behalf. It is a reported fact about the account, so it
  // is sealed. `filed_via` is the organization's NAME as it was at filing,
  // so a later rename cannot change what a sealed report says.
  //
  // The coordinator's own identity is deliberately NOT here. It is Tier B,
  // like any reporter's, so the public record shows which organization an
  // account came through without naming who typed it in.
  const thirdParty = b.third_party === true || b.third_party === 'true';
  const filedVia = thirdParty ? String(b.filed_via || '').trim() : '';
  const intakeMethod = (thirdParty && INTAKE_METHODS.includes(b.intake_method))
    ? b.intake_method : null;
  const provenance = (thirdParty && filedVia && intakeMethod && b.attested_at)
    ? {
      third_party: true,
      filed_via: filedVia,
      intake_method: intakeMethod,
      attested_at: b.attested_at,
      // The date the account was collected, which is not the date it was
      // typed up. Only when the coordinator knew it.
      ...(b.collected_on ? { collected_on: b.collected_on } : {}),
    }
    : {};

  return {
    logbook,
    ...(b.answers && typeof b.answers === 'object' && Object.keys(b.answers).length
      ? { answers: b.answers } : {}),
    ...provenance,
    may_publish: mayPublish,
    may_publish_digest: mayPublishDigest,
  };
}
