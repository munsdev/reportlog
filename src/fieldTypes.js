/**
 * The kinds of question a logbook can ask.
 *
 * THIS IS THE ONLY LIST OF QUESTIONS THE SOFTWARE KNOWS, and it is a list
 * of TYPES, not of questions. There is no built-in "when did it happen" or
 * "where was it" — an operator who wants those adds a `date` field and a
 * `place` field, and an operator who wants two of each has two of each.
 * The software's opinion stops at what a date is and how to check one.
 *
 * Nothing here is required of a logbook. The spine — the account itself, an
 * address to reach the person, and permission to publish — lives on
 * `reports` as real columns because the software genuinely depends on it.
 * Everything below is optional and absent unless somebody made it.
 *
 * ADDING A TYPE is additive: a row here, a card in the builder, a control
 * in the form. Existing logbooks are untouched, and a sealed answer is
 * unaffected because the seal holds the ANSWER, not the type's definition.
 */

/**
 * `value` is what gets sealed. Each type normalizes to ONE shape, and that
 * shape is part of the archive's promise: a date is always 'YYYY-MM-DD'
 * whatever the browser sent, because a report that hashed '3 Nov 2026'
 * could never be checked against one that hashed '2026-11-03'.
 */
export const FIELD_TYPES = [
  {
    id: 'short_text',
    label: 'Short text',
    description: 'One line. A name, a reference, a job title.',
    settings: { maxLength: 200 },
  },
  {
    id: 'long_text',
    label: 'Long text',
    description: 'Several paragraphs. An account, a description, context.',
    settings: { maxLength: 5000 },
  },
  {
    id: 'date',
    label: 'Date',
    description: 'A calendar day. Add two if a thing has a start and an end.',
    settings: {},
  },
  {
    id: 'time',
    label: 'Time of day',
    description: 'A clock time, with no date attached.',
    settings: {},
  },
  {
    id: 'datetime',
    label: 'Date and time',
    description: 'A moment. Stored with its offset, so it survives being read elsewhere.',
    settings: {},
  },
  {
    id: 'place',
    label: 'Place',
    description: 'Somewhere. Free text, or a list the operator supplies.',
    settings: { options: [], allowOther: true },
  },
  /* THE TYPE THE HEAT MAPS READ, and the reason it is not the `place` type
     above.

     `place` seals whatever somebody typed. "Phoenix", "phoenix az",
     "Maricopa County" and "Phoenix, Arizona" are four answers about one
     place, and no amount of care downstream turns them into a count —
     which is why `src/mapData.js` could not have been built on it.

     This seals A CODE FROM A FIXED LIST: `US-AZ`, `DE`, `US`. The list is
     the map's own outline data (src/gazetteer.js), so every answer is a
     place a map can draw, and rolling a state up to its country is a
     prefix rather than a lookup.

     IT SEALS ONE STRING, exactly as `place` and `short_text` do, so it
     introduces no new shape into the hashed object. The absent-key rule
     applies to it like everything else: unanswered means no key.

     BOTH TYPES STAY. An operator asking "whereabouts, roughly, in your own
     words" wants prose and should not be forced into a dropdown of states;
     an operator who wants a map needs the code. They are different
     questions and the form should be able to ask either. */
  {
    id: 'location',
    label: 'Location on a map',
    description: 'A country, or a US state or territory, chosen from a list. '
      + 'This is the question a heat map counts — pick this one rather than Place '
      + 'if the answers need to add up. Only one per logbook can feed a map.',
    settings: { scope: 'us' },
  },
  {
    id: 'choice_one',
    label: 'Choose one',
    description: 'A list where exactly one answer applies.',
    settings: { options: [] },
  },
  {
    id: 'choice_many',
    label: 'Choose any',
    description: 'A list where more than one answer can apply.',
    settings: { options: [] },
  },
  {
    id: 'yes_no',
    label: 'Yes or no',
    description: 'A plain either-or.',
    settings: {},
  },
  /* THE EVIDENCE DECLARATION. "I have photos, video, audio or documents of
     this" — and nothing is uploaded.

     WHY IT IS ITS OWN TYPE and not a `yes_no` an operator words themselves.
     Three reasons, and the third is the one that decides it:

       It carries its own wording, so every deployment asks the same
       question the same way rather than nine operators each inventing one.

       It stays out of the filter list by default like anything else, but
       the request flow needs it findable.

       AND NOTHING COULD TELL WHICH QUESTION WAS THE DECLARATION. With a
       plain yes/no, a moderator's "ask this reporter for what they said
       they had" has no way to know which of four yes/no answers meant it,
       and the request flow is the whole point of asking.

     IT SEALS A BOOLEAN, exactly as `yes_no` does, so it introduces no new
     shape into the hashed object — a report that answers it hashes the same
     way one answering a yes/no does. 037 said "a field of an existing
     type" for that reason, and this keeps the promise while being findable.

     NOT THE PERMISSION. This is a sealed answer about what existed at the
     moment of filing, which can never change. Whether an editor may come
     back and ask is a revocable grant and lives in
     src/reportPermissions.js. Folding them together would put a revocable
     value in the fingerprint. */
  {
    id: 'evidence_declaration',
    label: 'Evidence they have but are not uploading',
    description: 'Asks whether they have photos, video, audio or documents '
      + 'of this, without asking for them. A moderator can ask later, if the '
      + 'reporter also gives permission to be asked. Add a short text '
      + 'question after it, shown only when the answer is yes, for what it '
      + 'is of.',
    settings: {},
  },
  {
    id: 'number',
    label: 'Number',
    description: 'A count or a measurement.',
    settings: { min: null, max: null },
  },
  {
    id: 'email',
    label: 'Email address',
    description: 'A second address, beside the one the spine already collects.',
    settings: {},
  },
  {
    id: 'url',
    label: 'Web address',
    description: 'A link. Sealed as typed, so a page that later disappears still has a record of what was pointed at.',
    settings: {},
  },
  {
    // THE ONE TYPE WHOSE ANSWER IS NOT IN `answers`, and the asymmetry is
    // deliberate. Read this before tidying it.
    //
    // A report's files are sealed in a top-level `attachments` key, computed
    // from the manifest of what was actually stored and present only when
    // there were any (src/reportCore.js). That was true before this type
    // existed and it is untouched by it. So this field says WHERE THE FORM
    // ASKS and nothing more: it contributes no key to `answers`,
    // normalizeAnswer returns null for it on purpose, and adding or removing
    // one changes no report's fingerprint.
    //
    // Folding a file answer into `answers` would seal the same fact twice, in
    // two shapes, and would change the fingerprint of every report ever
    // filed. Do not do it.
    //
    // WHY IT IS A QUESTION AT ALL. It replaces a per-logbook "does this
    // logbook take files" switch that sat beside the questions rather than
    // among them. There were two controls for one decision — the switch and
    // the site-wide one — and an operator building a form had to know that
    // asking for a photo was configured somewhere other than every other
    // thing they asked for. A logbook takes files if it asks for them.
    id: 'file',
    label: 'Photos, video or documents',
    description: 'A place to attach files. Put it where you want to ask for them — '
      + 'a logbook takes files if, and only if, it has one of these. Everything is '
      + 're-encoded, so camera metadata and location do not survive.',
    settings: {},
  },
];

/**
 * The upload type, named once so nothing has to spell it.
 *
 * A logbook may have AT MOST ONE. Two upload questions would be two places to
 * put the same files, and the manifest they seal into is one list per report
 * with nothing in it saying which question a file came from — so the second
 * one would be a question the archive cannot answer.
 */
export const FILE_TYPE = 'file';

/**
 * Types that never carry a sealed answer of their own.
 *
 * Only `file` today. Kept as a set rather than an `=== 'file'` so the reason
 * is stated in one place and a second such type cannot be added without
 * meeting it.
 */
export const UNSEALED_TYPES = new Set([FILE_TYPE]);

export const FIELD_TYPE_IDS = FIELD_TYPES.map((t) => t.id);

export function fieldType(id) {
  return FIELD_TYPES.find((t) => t.id === id) || null;
}

/** Types whose answers are a list rather than a single value. */
export const MULTI_TYPES = new Set(['choice_many']);

/**
 * Types that can sensibly carry a filter on the board.
 *
 * Not a permission and not a default — `filterable` is the operator's
 * choice, per field, in the builder. This only says which types the filter
 * UI knows how to draw a control for. Long text is excluded because a
 * filter over free prose is what the search box already is, and offering
 * both invites somebody to expect them to behave the same way.
 */
export const FILTERABLE_TYPES = new Set([
  'short_text', 'date', 'datetime', 'place', 'choice_one', 'choice_many', 'yes_no', 'number',
  // A fixed list of codes, so the filter control is a picker rather than a
  // text match — and it is what a map hands the board when somebody clicks
  // an area. Still only filterable where an operator says so.
  'location',
  // Still only filterable where an operator says so, like everything else.
  // "Which of these said they had footage" is a question worth being able
  // to ask, and it is the same control a yes/no draws.
  'evidence_declaration',
]);

/**
 * The declaration's own type id, named once.
 *
 * Imported rather than typed as a literal wherever the request flow asks
 * "did this report declare anything" — a string in six places is a typo
 * waiting to make the flow silently find nothing.
 */
export const EVIDENCE_DECLARATION_TYPE = 'evidence_declaration';

/**
 * The map-bearing type's id, named once for the same reason.
 *
 * `src/mapData.js`, the builder's map flags and the aggregate all have to
 * agree about which kind of question can carry a place code, and a literal
 * in four files is a typo waiting to make a map silently find nothing.
 */
export const LOCATION_TYPE = 'location';

export function canFilter(kind) {
  return FILTERABLE_TYPES.has(kind);
}
