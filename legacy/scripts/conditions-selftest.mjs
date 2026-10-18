/**
 * Questions that are only asked sometimes, against a real database.
 *
 * The unit suite covers the pure half — what a condition means, what
 * `normalizeCondition` refuses, and that the two copies of `conditionMet`
 * agree. What needs Postgres is the part where a condition travels: stored
 * on a field, sealed into the form definition, carried through a logbook
 * file, and honoured by a report that actually gets filed and verified.
 *
 * THE CHECK THAT MATTERS MOST IS THE LAST ONE. `shown_when` goes into the
 * hashed form definition, so a logbook with no conditions must hash exactly
 * as it did before conditions existed — otherwise the `logbook_form` sealed
 * into every report ever filed stops matching and `immutableFieldsFor`
 * throws rather than rebuilding a different object. The unit suite asserts
 * it over a hand-built field; this asserts it over rows that came out of the
 * database, which is where a default value or a JSON round-trip would turn
 * a null into something that is not one.
 *
 * Run by `npm run test:db` against a throwaway database.
 */
import 'dotenv/config';
import crypto from 'node:crypto';

const { pool } = await import('../src/db.js');
const L = await import('../src/logbooks.js');
const { buildAnswers } = await import('../src/answers.js');
const { formText } = await import('../src/formText.js');
const { insertReportVersion, normalizeReportFields } = await import('../src/reportCore.js');
const { verifyReport } = await import('../src/verify.js');
const { toFile, createFromFile } = await import('../src/logbookFile.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

const DIGEST = 'e'.repeat(64);

// ---------------------------------------------------------------------
// Authoring: what the module stores, and what it refuses.
// ---------------------------------------------------------------------
const made = await L.createLogbook({ title: 'Conditions', slug: 'cond-test' });
const id = made.logbook.id;

const gate = await L.addField(id, {
  kind: 'yes_no', label: 'Do you have photos, video, audio or documents?', key: 'has_files', required: true,
});
ok('the controlling question is added', gate.ok, JSON.stringify(gate));

// A forward reference, before the question it names exists.
const early = await L.addField(id, {
  kind: 'short_text', label: 'Too early', key: 'too_early',
  shown_when: { field: 'not_yet', in: ['yes'] },
});
ok('a condition naming a question that does not exist yet is refused',
  !early.ok && early.reason === 'shown-when-unknown-field', JSON.stringify(early));

const dependent = await L.addField(id, {
  kind: 'short_text', label: 'What is it of?', key: 'clip_of',
  shown_when: { field: 'has_files', in: ['yes'] },
});
ok('a condition on an earlier question is stored', dependent.ok
  && dependent.field.shown_when
  && dependent.field.shown_when.field === 'has_files', JSON.stringify(dependent));

const prose = await L.addField(id, { kind: 'long_text', label: 'Account', key: 'account' });
const onProse = await L.addField(id, {
  kind: 'short_text', label: 'No', key: 'nope', shown_when: { field: 'account', in: ['police'] },
});
ok('a condition on free prose is refused', !onProse.ok && onProse.reason === 'shown-when-kind',
  JSON.stringify(onProse));
ok('and the field it would have created does not exist', prose.ok
  && !(await L.fieldsFor(id)).some((f) => f.key === 'nope'));

const badValue = await L.addField(id, {
  kind: 'short_text', label: 'No', key: 'nope2', shown_when: { field: 'has_files', in: ['maybe'] },
});
ok('a condition on an answer that question cannot give is refused',
  !badValue.ok && badValue.reason === 'shown-when-unknown-value', JSON.stringify(badValue));

// An upload question cannot CARRY one, which is different from not being
// askable about. Its card is not built from the questions, so a condition
// would be sealed into the form definition and applied to nobody.
const condFile = await L.addField(id, {
  kind: 'file', label: 'Photos', key: 'files',
  shown_when: { field: 'has_files', in: ['yes'] },
});
ok('an upload question cannot carry a condition',
  !condFile.ok && condFile.reason === 'shown-when-unsupported-kind', JSON.stringify(condFile));
const plainFile = await L.addField(id, { kind: 'file', label: 'Photos', key: 'files' });
ok('but it is fine without one', plainFile.ok, JSON.stringify(plainFile));

// A question cannot depend on its own answer.
const selfRef = await L.updateField(id, dependent.field.id, {
  shown_when: { field: 'clip_of', in: ['yes'] },
});
ok('a question cannot be made to depend on itself',
  !selfRef.ok && selfRef.reason === 'shown-when-unknown-field', JSON.stringify(selfRef));

// ---------------------------------------------------------------------
// The logbook file carries it, both ways.
// ---------------------------------------------------------------------
{
  const file = await toFile(id);
  const q = file.questions.find((x) => x.key === 'clip_of');
  ok('a downloaded logbook carries the condition', q && q.shown_when
    && q.shown_when.field === 'has_files', JSON.stringify(q));
  const plain = file.questions.find((x) => x.key === 'has_files');
  ok('and a question with no condition carries no key for one',
    plain && !('shown_when' in plain),
    'a file from a plain logbook must look exactly as it did before 034');

  const back = await createFromFile({ ...file, slug: 'cond-test-copy', title: 'Copy' });
  ok('and uploading it again reproduces the condition', back.ok
    && (await L.fieldsFor(back.logbook.id)).some((f) => f.key === 'clip_of' && f.shown_when
      && f.shown_when.field === 'has_files'), JSON.stringify(back.errors || back.reason));
}

// ---------------------------------------------------------------------
// Answers: a question nobody was asked seals nothing.
// ---------------------------------------------------------------------
await L.launch(id);
const fields = await L.fieldsFor(id);

{
  const said = buildAnswers(fields, { has_files: 'yes', clip_of: 'thirty seconds of the line', account: 'x' });
  ok('answering yes asks the dependent question', said.answers.clip_of === 'thirty seconds of the line');

  const not = buildAnswers(fields, { has_files: 'no', clip_of: 'stale' });
  ok('answering no does not seal an answer to it', !('clip_of' in (not.answers || {})),
    JSON.stringify(not.answers));
  ok('and does not complain that it is missing', not.errors.length === 0, JSON.stringify(not.errors));
}

// ---------------------------------------------------------------------
// A report filed against it verifies, and the two reporters were asked
// different questions against the SAME sealed form.
// ---------------------------------------------------------------------
async function file(answers) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const threadId = crypto.randomUUID();
    const built = buildAnswers(fields, answers);
    if (built.errors.length) throw new Error(built.errors.join('; '));
    const report = await insertReportVersion(client, {
      threadId,
      correctsId: null,
      logbookId: id,
      fields: normalizeReportFields({
        logbook: 'cond-test', answers: built.answers, may_publish: true, may_publish_digest: DIGEST,
      }),
    });
    await client.query(
      "INSERT INTO report_heads (thread_id, current_report_id, moderation_status) VALUES ($1, $2, 'valid')",
      [threadId, report.id],
    );
    await client.query('COMMIT');
    return report;
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

const withFiles = await file({ has_files: 'yes', clip_of: 'the queue outside', account: 'Long wait.' });
const without = await file({ has_files: 'no', account: 'Long wait.' });

{
  const a = await verifyReport(withFiles.public_ref);
  const b = await verifyReport(without.public_ref);
  ok('a report that was asked the extra question verifies',
    a.content.ok && a.link.ok && a.position.ok);
  ok('and so does one that was not', b.content.ok && b.link.ok && b.position.ok);
  ok('the one that was asked it has the answer', a.hashed_fields.answers.clip_of === 'the queue outside');
  ok('the one that was not has NO KEY for it, rather than a null',
    !('clip_of' in b.hashed_fields.answers),
    'an absent key and a null one hash differently — this is the whole rule');
  ok('and both sealed the same form version',
    a.hashed_fields.logbook_form === b.hashed_fields.logbook_form,
    'they answered one questionnaire; who was asked what is not a second form');
}

// ---------------------------------------------------------------------
// THE REGRESSION THAT WOULD BE WORST. A logbook with no conditions must
// hash exactly as it would have before conditions existed.
// ---------------------------------------------------------------------
{
  const plainMade = await L.createLogbook({ title: 'Plain', slug: 'cond-plain' });
  await L.addField(plainMade.logbook.id, { kind: 'short_text', label: 'What happened?', key: 'what' });
  const plainFields = await L.fieldsFor(plainMade.logbook.id);

  ok('a field with no condition reads back as null, not as an object',
    plainFields[0].shown_when === null, JSON.stringify(plainFields[0].shown_when));

  // The definition, hashed from the real rows, against one built as the code
  // would have built it before `shown_when` existed at all.
  const actual = formText('cond-plain', plainFields);
  const asBefore = formText('cond-plain', plainFields.map((f) => {
    const { shown_when: _drop, ...rest } = f;
    return rest;
  }));
  ok('AND THE FORM HASHES EXACTLY AS IT DID BEFORE CONDITIONS EXISTED',
    actual.hash === asBefore.hash,
    'every report ever filed seals a form hash; this moving breaks all of them');
  ok('and the definition carries no shown_when key at all',
    !actual.definition.includes('shown_when'), actual.definition.slice(0, 200));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
