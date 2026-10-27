/**
 * Every refusal the logbook module can give, and the sentence that goes with
 * it.
 *
 * Each sentence says what to do instead. These are reached by pressing an
 * ordinary button in the builder, and a refusal an operator cannot act on is
 * a dead end: one who cannot tell which of five things they got wrong will
 * turn the condition off rather than fix it.
 *
 * The refusal IS the HTTP error, so a route has nothing to translate and no
 * path through the module can refuse without the sentence.
 */
import { HttpError } from '../http/errors.ts';

const SENTENCES = {
  'no-logbook': 'There is no such logbook.',
  'no-field': 'There is no such question in this logbook.',
  title: 'Give it a title of 1 to 120 characters.',
  slug: 'A web address may use lowercase letters, numbers and hyphens, and must start with a letter or number.',
  'slug-taken': 'Another logbook or list already uses that web address. Choose a different one.',
  'slug-reserved': 'That web address belongs to a page of the site. Choose a different one.',
  'free-text':
    'Free text on a logbook is an attached note that is never published. Use an attached note or link.',
  kind: 'That is not a kind of question this software can ask.',
  'setting-kind': 'That setting does not apply to this kind of question, so it is not kept.',
  label: 'Give the question some words, up to 160 characters.',
  help: 'The help text under a question can be up to 1,000 characters.',
  key: 'A question key may use lowercase letters, numbers and underscores, up to 39 characters.',
  'key-taken': 'Another question in this logbook already uses that key. Choose a different one.',
  'location-scope':
    'A location question asks for a US state, a country, or either. Choose one of those three.',
  'location-depth': 'A location question can ask for the county only when it asks for a US state.',
  'choice-options':
    'A list of choices needs at least one choice, each with some words in it, and no choice twice.',
  'option-codes':
    'A choice with a code needs a code of lowercase letters, numbers and underscores and a label ' +
    'of up to 200 characters, no code twice in one list, and either every choice in a list with ' +
    'a code or none of them.',
  'option-sets':
    'Choices that depend on an earlier answer need between one and twenty lists, each with the ' +
    'answers that bring it up and its own choices, and then the question has no list of its own.',
  'help-when':
    'Help that depends on an earlier answer needs the answers that bring it up and up to 1,000 characters of help.',
  'card-question': 'A card’s own question needs 1 to 160 characters.',
  'card-shape':
    'Questions that share a card follow the question whose card they share, an upload question ' +
    'has a card to itself, only the first question on a card says what the card asks, and no ' +
    'question on a card may depend on another question on the same card: nothing on a card ' +
    'changes underneath somebody.',
  'date-limits':
    'An earliest or latest answer has to be a date (2026-11-03) for a date question, a time (07:00) for a time question, or a date and time with its offset (2026-11-03T07:00-05:00), and the earliest cannot be after the latest.',
  'number-picker':
    'An hour picker asks for a whole number from 0 to 23, so it needs whole numbers, a smallest of 0 and a largest of 23.',
  'checkbox-kind': 'Only a yes or no question can be asked as a tick box.',
  'location-code':
    'A location can be written as a postal code only for a US state, and as a county code only ' +
    'for a US county inside an earlier question asking for the state by postal code.',
  'max-length': 'The longest answer allowed must be a whole number from 1 to 100,000.',
  'max-values': 'A link question can take from 1 to 3 links.',
  'number-range':
    'The smallest and largest numbers must be numbers, and the smallest must not be larger than the largest.',
  'file-exists':
    'This logbook already asks for files, and one place to put them is all it can have. ' +
    'Two upload questions would be two places for the same files, and nothing in what gets ' +
    'sealed says which one a file came from. Move or reword the one it has instead.',
  'file-required':
    'An upload question cannot be compulsory. It seals no answer of its own, so nothing ' +
    'could tell whether it had been satisfied, and the form would refuse every report.',
  launched:
    'This logbook has launched, so its questions are fixed. That is what makes a sealed ' +
    'answer worth anything: a question whose answers could be changed afterwards would leave ' +
    'every answer to it meaning something nobody can check. You can still reword a question ' +
    'or a choice that has a code, and add a new optional question.',
  'launched-codes':
    'This logbook has launched, so only the wording of its questions may change: labels, help, ' +
    'and the labels of choices that have a code. A key, a kind, the order, whether it is ' +
    'required, when it is asked, and every code stay as they were, because sealed answers hold them. ' +
    'A choice written as plain text is its own code, so it cannot be reworded.',
  'launched-required':
    'A question added after launch has to be optional. Reports already filed never answered ' +
    'it, and marking it required would have the form claim an answer the archive does not hold.',
  'launched-not-deletable':
    'This logbook has launched, so it cannot be deleted. It is its own chain of reports and ' +
    'it is named on every daily anchor since. Close it instead: a closed logbook takes no more ' +
    'reports and keeps the ones it has.',
  'has-reports': 'This logbook holds reports, so it cannot be deleted. Reports are never removed.',
  'already-launched': 'This logbook has already launched.',
  'no-fields':
    'Add at least one question before launching. A report is a logbook’s answers, so a ' +
    'logbook that asks nothing would file reports that say nothing.',
  'not-launched':
    'Only a launched logbook has opening times or can be closed. Launch it first, or leave it as a draft.',
  'schedule-time': 'That is not a date and time this software can read.',
  'schedule-order': 'A logbook has to open before it closes. Move one of the two times.',
  order: 'Send every question in this logbook, each once, in the order you want them.',
  'order-breaks-condition':
    'That order puts a question in front of the one it depends on. A condition can only look ' +
    'back at a question already answered, so move it below that one, or remove its condition first.',
  'depended-on':
    'Another question is only asked depending on the answer to this one. Remove or change that condition first.',
  'breaks-condition':
    'Another question is only asked when this one is answered a certain way, and that answer ' +
    'would no longer be possible. Change that condition first.',
  'shown-when-shape': 'A condition needs a question and the answers that should bring this one up.',
  'shown-when-no-field': 'Choose which question decides whether this one is asked.',
  'shown-when-unknown-field':
    'That question is not in this logbook, or it comes after this one. A condition can only ' +
    'look back at a question already answered, which is also what stops two questions waiting ' +
    'on each other forever. Move this question below the one it depends on.',
  'shown-when-kind':
    'A condition can only be asked about a yes or no question or a list of choices. Matching ' +
    'on what somebody typed would make the question appear and disappear as they wrote.',
  'shown-when-unsupported-kind':
    'An upload question cannot be conditional. Whether a logbook takes files is whether it ' +
    'asks for them at all, so a condition here would be sealed into the record and never applied.',
  'shown-when-no-values': 'Say which answers should bring this question up.',
  'shown-when-unknown-value':
    'One of those answers is not on the other question’s list, so this question could never be asked.',
  'no-starting-point': 'That is not a starting point this software ships.',
  'bad-file': 'That logbook file has something wrong with it.',
  'not-a-list': 'An arrangement is a list of buttons.',
  'too-many': 'That is more buttons than a front page can carry. Fifty at most.',
  'bad-entry': 'One of those buttons is not a button.',
  'unknown-button':
    'One of those buttons names something this site does not have, or that is not open.',
  duplicate: 'That button is in the list twice.',
  'bad-label': 'A button label is text.',
  'label-too-long': 'That label is longer than a button can carry. Eighty characters at most.',
  'bad-sub': 'A button’s second line is text.',
  'sub-too-long': 'That second line is longer than a button can carry. 160 characters at most.',
} as const;

export type RefusalCode = keyof typeof SENTENCES;

const STATUS: Partial<Record<RefusalCode, number>> = {
  'no-logbook': 404,
  'no-field': 404,
  // The one-way door is a conflict with the logbook's state, not a bad request.
  launched: 409,
  'launched-codes': 409,
  'launched-required': 409,
  'launched-not-deletable': 409,
  'already-launched': 409,
  'has-reports': 409,
  'slug-taken': 409,
  'slug-reserved': 409,
  'key-taken': 409,
};

export class LogbookRefusal extends HttpError {
  override name = 'LogbookRefusal';
  declare readonly code: RefusalCode;
  constructor(code: RefusalCode, detail?: string) {
    super(STATUS[code] ?? 400, code, detail ? `${SENTENCES[code]} ${detail}` : SENTENCES[code]);
  }
}

/** Declared as a function, not an arrow, so TypeScript narrows after a call. */
export function refuse(code: RefusalCode, detail?: string): never {
  throw new LogbookRefusal(code, detail);
}
