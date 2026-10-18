// The few fixed vocabularies the software itself still has.
//
// There is no built-in questionnaire. What a report is about, where and
// when it happened, who saw it — those are questions a logbook asks, with
// its own choices. What is left here belongs to the people handling a
// report, not to the form: a moderator's judgement of how serious it is,
// and how a coordinator came by an account. A judgement of whether a report
// is TRUE used to be here too; it has been withdrawn — see below.

// How serious a moderator judges a report to be. A mutable judgement kept in
// report_heads, never inside a report's seal.
export const SEVERITIES = ['note', 'irregularity', 'serious', 'systemic'];

// ---------------------------------------------------------------------
// VERACITY IS WITHDRAWN. Nothing sets it and nothing displays it.
//
// WHY. A one-word verdict about a named third party is the archive
// publishing its own factual assertion, and it is the hardest kind of
// assertion to defend. "Likely true" on a report that names a polling
// official by role, place and time is this archive asserting something
// about that person that no court, no regulator and no editor has stood
// behind. An editorial note replaces it: a written statement somebody can
// defend, attached by the moderator who made the publication decision.
//
// The exposure does not disappear when the verdict does. It moves, from a
// verdict nobody can defend to a considered statement somebody can.
//
// WHAT IS LEFT BELOW, AND WHY IT IS NOT THE VERDICT. `/api/v1/stats`
// published a `by_veracity` breakdown, and `public/api.html` promises that
// an existing field is not renamed, retyped or removed without a
// `/api/v2`. So the field stays, frozen, and reads entirely `pending` —
// which is not a fiction but the literal truth, because nothing assesses
// veracity any more. api.html says exactly that, in those words.
//
// NOTHING ELSE MAY READ THIS LIST. It is not a vocabulary for anything to
// use; it is the shape of one field kept alive to honour one promise until
// there is a v2 to drop it in. `report_heads.veracity` is likewise left in
// place and written by nothing — migrations are additive, and a column
// nothing reads costs nothing.
export const VERACITY_FROZEN_KEYS = [
  'pending', 'proven_false', 'likely_false', 'undetermined', 'likely_true', 'proven_true',
];

// ---------------------------------------------------------------------
// How a coordinator came by an account they are entering on someone else's
// behalf. A fixed list rather than free text: what a moderator needs is
// whether this came off a paper form, down a phone line, or from a
// conversation, and a text box would collect all three in a hundred
// spellings. Sealed, as part of a coordinator report's provenance.
export const INTAKE_METHODS = ['paper', 'phone', 'in_person', 'email', 'other'];

export const INTAKE_METHOD_LABELS = {
  paper: 'A paper form',
  phone: 'A phone call',
  in_person: 'In person',
  email: 'An email or message',
  other: 'Somewhere else',
};
