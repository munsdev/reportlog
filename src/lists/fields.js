/**
 * What a list may ask, what counting a field costs, and what collecting one
 * obliges the form to do.
 *
 * TWO FLAGS THAT LOOK LIKE ONE, and keeping them apart is the whole point
 * of this file:
 *
 *   1. IS THIS FIELD PERSONAL? Derived from the kind, never an operator's
 *      choice, and unknown kinds count as personal.
 *   2. MAY ITS VALUES BE COUNTED? An operator's deliberate tick, off by
 *      default.
 *
 * They come apart in both directions. An internal triage category is
 * impersonal and still nobody's business. A state chosen from a list is
 * identifying at row level and perfectly fine as a count. So the second
 * cannot be derived from the first, and a single flag would silently get
 * one of the two wrong.
 *
 * THE GATE, in one sentence: a form that collects free text or anything
 * else about a person must require an address, and must therefore be able
 * to erase on request. A form that collects a link and two dropdowns must
 * not ask for one — there is nobody in the row to erase, and the address
 * would be the only personal thing on the form, collected in order to
 * protect itself.
 *
 * It is DERIVED FROM THE FIELDS rather than ticked
 * beside them, and that is why it holds: a box an operator ticks is a box
 * an operator can forget, and the failure is silent. Adding a long-text
 * question makes the address required by arithmetic. The guard lives here
 * rather than in a route, so every path goes through it — the same
 * discipline as `assertDraft` in src/logbooks.js.
 */
import { CLASSES } from './retention.js';

/**
 * Field kinds that carry something about a person.
 *
 * Free text is personal WHATEVER it is labelled, because a box a stranger
 * can type into collects whatever they type — including, on these forms
 * especially, an account of what somebody else did. `place` is here because
 * a place somebody reports from narrows down who they are; a coarse state
 * chosen from a closed list does not, and that is a `choice_one`.
 */
export const PERSONAL_KINDS = new Set([
  'short_text',
  'long_text',
  'email',
  'place',
]);

/**
 * Kinds that carry nothing about a person. A link points at public
 * material; a choice from an operator's list is the operator's vocabulary
 * rather than the submitter's words.
 */
export const IMPERSONAL_KINDS = new Set([
  'choice_one',
  'choice_many',
  'yes_no',
  'number',
  'date',
  'time',
  'datetime',
  'url',
  /* `location` IS HERE AND `place` IS NOT, which is the distinction the
     comment above already draws: "a place somebody reports from narrows
     down who they are; a coarse state chosen from a closed list does
     not". A location answer is literally that — one code from a closed
     vocabulary the operator's own map outlines produced, so the finest
     thing it can say is the finest thing the map can draw. `place` stays
     personal because it is prose and prose names streets.

     IT ARRIVED HERE BY FAILING, not by reasoning after the fact. Until
     migration 051 `location` was forbidden on a list, so it fell through
     `isPersonalKind`'s unknown-kind default — which is personal, by
     design, and the first thing that happened when lists could ask the
     question was a map whose place codes went into `erasable_answers`
     and would have been blanked by the retention sweep. The default did
     its job: the failure was a form demanding an email and a count that
     would quietly shrink, rather than a record nobody could erase.

     WHAT PROTECTS A THIN AREA IS THE THRESHOLD, not erasure. A map sends
     an area under its threshold with no count at all, and the floor is 2
     in the database. Erasing the code would not have protected anybody it
     protects; it would only have made the count fall away months later
     with nothing saying why. */
  'location',
]);

/**
 * Not available on a list at all.
 *
 * No uploads: a file is the thing a logbook takes, and a list exists for
 * material that is already published elsewhere. An evidence declaration is
 * a promise about a report, and there is no report here.
 *
 * `location` USED TO BE ON THIS LIST AND IS NOT ANY MORE — migration 051,
 * 11 October. The reason written here for forbidding it said a list had
 * "no moderation status, no reporter permission and no threshold", and
 * the first of those was simply untrue: `list_entries.review_state` has
 * existed since migration 046 and that column's own comment calls it "may
 * this be counted". The threshold was never the entry's to carry — it
 * belongs to the MAP, per map, and applies to whatever feeds it. So the
 * stated obstacle was one real difference and one mistake, and the real
 * one pointed the other way: a list is approved in bulk, which is a
 * weaker claim per row than a logbook's one-by-one review, and a map
 * publishes only counts above a threshold, which is the weakest use the
 * data has.
 *
 * What stays true is that AN ENTRY IS NOT A REPORT. A list still seals
 * nothing and chains nothing; `src/mapData.js` counts its entries in a
 * separate query with its own gate and never calls them reports. And a
 * map counts the DURABLE half of an entry only — a place code lives in
 * `answers`, never in `erasable_answers` — so a count cannot be built out
 * of something the sweep is going to blank.
 *
 * A kind that IS forbidden is here rather than left to fall through
 * `normalizeValue`'s default, because falling through is what makes a
 * broken form: the builder offers the type, every answer to it is refused
 * at submission, and nothing between the two says so.
 */
export const FORBIDDEN_KINDS = new Set([
  'file',
  'evidence_declaration',
]);

/**
 * ONLY A CLOSED VOCABULARY CAN BE COUNTED.
 *
 * You cannot aggregate free text, and letting somebody tick the box beside
 * a long-text question would publish what people wrote one count at a
 * time — a cell of one IS the sentence somebody typed.
 *
 * MUST STAY IN STEP WITH `list_fields_aggregatable_check` in migration 046,
 * and `npm test` asserts that the two state the same list. This side is
 * deliberately STRICTER: `assertFieldDefinition` also requires a real
 * closed option set, which a CHECK constraint cannot see.
 */
export const AGGREGATABLE_KINDS = new Set([
  'choice_one',
  'choice_many',
  'yes_no',
  'number',
  'date',
  'time',
  'datetime',
  'place',
]);

/** Kinds whose answers also become rows in list_entry_links. */
export const LINK_KINDS = new Set(['url']);

/**
 * UNKNOWN KINDS COUNT AS PERSONAL, and that is the important line here.
 *
 * A field type added to src/fieldTypes.js next year is one nobody
 * remembered to classify. Defaulting it to impersonal would let it escape
 * the gate silently; defaulting it to personal makes a form carrying it
 * require an address until somebody comes back and says otherwise. The
 * failure mode is an unnecessary email, not an unerasable record.
 */
export function isPersonalKind(kind) {
  if (FORBIDDEN_KINDS.has(kind)) return true;
  if (IMPERSONAL_KINDS.has(kind)) return false;
  return true;
}

/**
 * The lifetime a field's answer gets when the form does not say.
 *
 * Personal fields default to transient — collected, then erased. Impersonal
 * ones default to durable, because there is nothing in them to erase and
 * sweeping a state or a verdict would destroy the count for no gain.
 */
export function defaultRetention(kind) {
  return isPersonalKind(kind) ? CLASSES.TRANSIENT : CLASSES.DURABLE;
}

/** A field is collected unless it is switched off or classed absent. */
export function isCollected(field) {
  if (!field || typeof field !== 'object') return false;
  if (field.enabled === false) return false;
  if (field.retention === CLASSES.ABSENT) return false;
  return true;
}

/**
 * Whether a closed option set actually exists, which is what makes a field
 * countable in practice rather than merely by kind.
 *
 * `allow_other` is what disqualifies a `place`: a place field with a free
 * text escape hatch is a free text field most of the time, and counting it
 * would publish whatever people typed into the escape hatch.
 */
export function hasClosedVocabulary(field) {
  const kind = field?.kind;
  // These are closed by their nature — a yes_no has two values, a date has
  // one shape, a number is a number.
  if (['yes_no', 'number', 'date', 'time', 'datetime'].includes(kind)) return true;
  const opts = Array.isArray(field?.options?.options) ? field.options.options
    : Array.isArray(field?.options) ? field.options : [];
  const allowOther = field?.options?.allowOther === true
    || field?.options?.allow_other === true;
  return opts.length > 0 && !allowOther;
}

/**
 * What a set of fields obliges the form to do.
 *
 * `fields` is what a list template declares, or what `list_fields` holds:
 * objects carrying at least `{ key, kind }`, optionally `label`,
 * `retention`, `aggregatable` and `enabled`.
 */
export function collectionRequirements(fields = []) {
  const personal = [];
  const forbidden = [];
  const aggregatable = [];
  let anyDurablePersonal = false;

  for (const f of fields) {
    if (!isCollected(f)) continue;
    if (FORBIDDEN_KINDS.has(f.kind)) {
      forbidden.push(f.key ?? f.kind);
      continue;
    }
    if (f.aggregatable) aggregatable.push(f.key ?? f.kind);
    if (isPersonalKind(f.kind)) {
      personal.push(f.key ?? f.kind);
      if ((f.retention ?? defaultRetention(f.kind)) === CLASSES.DURABLE) {
        anyDurablePersonal = true;
      }
    }
  }

  return {
    personalKeys: personal,
    forbiddenKeys: forbidden,
    aggregatableKeys: aggregatable,
    collectsPersonal: personal.length > 0,
    // THE FORM MUST ASK FOR AN ADDRESS — not every submission must carry
    // one. A form that may collect personal data has to render the address
    // field and explain the erasure route; whether a given submission
    // actually needs it depends on what arrived, and `fileEntry` decides
    // that from the answers rather than from the form.
    //
    // Both halves travel together deliberately. An address with no erasure
    // route is a contact detail collected for nothing; an erasure route
    // with no address is a promise with no way to keep it.
    requiresEmail: personal.length > 0,
    requiresErasureRoute: personal.length > 0,
    keepsPersonalIndefinitely: anyDurablePersonal,
  };
}

/**
 * Refuse one field an operator should not be able to save.
 *
 * Throws rather than returning a verdict, because every caller is a write
 * path and the only correct handling of an invalid definition is not to
 * save it.
 */
export function assertFieldDefinition(field) {
  if (!field || typeof field !== 'object') throw new Error('a field must be an object');
  if (!field.key || !/^[a-z0-9][a-z0-9_]{0,62}$/.test(field.key)) {
    throw new Error(`a field needs a key like this_one, not ${JSON.stringify(field.key)}`);
  }
  // Each one needs a title. It is what an aggregate is
  // labelled with when a tool asks, so a blank one is not a cosmetic fault.
  if (!field.label || !String(field.label).trim()) {
    throw new Error(`field ${field.key} has no label, and a label is what an aggregate is named by`);
  }
  if (FORBIDDEN_KINDS.has(field.kind)) {
    throw new Error(
      `a list cannot ask for ${field.kind}: ${[...FORBIDDEN_KINDS].join(' and ')} belong to a logbook`,
    );
  }
  const retention = field.retention ?? defaultRetention(field.kind);
  if (![CLASSES.ABSENT, CLASSES.TRANSIENT, CLASSES.DURABLE].includes(retention)) {
    throw new Error(`field ${field.key} has an unknown retention class: ${retention}`);
  }
  if (field.aggregatable) {
    if (retention === CLASSES.ABSENT) {
      throw new Error(`field ${field.key} is not collected, so it cannot be counted`);
    }
    if (!AGGREGATABLE_KINDS.has(field.kind)) {
      throw new Error(
        `field ${field.key} is a ${field.kind} and cannot be counted: `
        + 'only a closed vocabulary can be, because a count over free text '
        + 'publishes what somebody wrote one cell at a time',
      );
    }
    if (!hasClosedVocabulary(field)) {
      throw new Error(
        `field ${field.key} has no closed set of options, so counting it would `
        + 'publish whatever people typed into the escape hatch',
      );
    }
    if (isPersonalKind(field.kind) && retention === CLASSES.TRANSIENT) {
      // Not forbidden in principle, but it is a trap: the count would
      // change every time the sweep ran, and nobody would connect the two.
      throw new Error(
        `field ${field.key} is counted but erased on a timer, so its count would `
        + 'shrink on its own — mark it durable or stop counting it',
      );
    }
  }
  return { ...field, retention };
}

/**
 * Refuse a whole form that cannot be collected honestly.
 */
export function assertCollectable(fields = [], { hasRequiredEmail = false } = {}) {
  const checked = fields.map(assertFieldDefinition);
  const seen = new Set();
  for (const f of checked) {
    if (seen.has(f.key)) throw new Error(`two fields share the key ${f.key}`);
    seen.add(f.key);
  }
  const req = collectionRequirements(checked);

  if (req.forbiddenKeys.length) {
    throw new Error(`a list cannot collect ${req.forbiddenKeys.join(', ')}`);
  }
  if (req.requiresEmail && !hasRequiredEmail) {
    throw new Error(
      `a form collecting ${req.personalKeys.join(', ')} must require an address, `
      + 'because there is no other way to reach the person whose data it holds '
      + 'or to let them take it back',
    );
  }
  return { ...req, fields: checked };
}
