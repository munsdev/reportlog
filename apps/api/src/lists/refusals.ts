/**
 * Every refusal the lists module gives, with the sentence that goes with it.
 *
 * Two audiences. A visitor's refusals say what to change on the form, in words
 * somebody who has never seen this software can act on. An administrator's
 * say what to do instead. The refusal IS the HTTP error, so no route has
 * anything to translate and no path through the module can refuse without
 * the sentence.
 */
import { HttpError } from '../http/errors.ts';

const SENTENCES = {
  // ── a visitor sending an entry ──
  closed: 'This form is not taking anything at the moment.',
  'missing-required': 'Some questions need an answer.',
  'too-many-values': 'That is more answers than this question takes.',
  'too-long': 'That answer is too long. Shorten it and send it again.',
  'not-text': 'That answer needs to be written as text.',
  'not-an-option': 'Pick one of the options shown.',
  'field-has-no-options':
    'This question has no options to choose from yet, so nobody can answer it. Tell whoever runs this site.',
  'not-a-yes-or-no': 'Answer yes or no.',
  'not-a-number': 'That needs to be a number.',
  'out-of-range': 'That number is outside what this question takes.',
  'not-a-date': 'That needs to be a date.',
  'outside-dates': 'That is outside the dates or times this question takes.',
  'not-a-time': 'That needs to be a time of day.',
  'not-a-datetime': 'That needs to be a date and time.',
  'not-a-place': 'Pick a place from the list.',
  'not-an-email': 'That does not look like an email address.',
  'no-contact-key':
    'This form cannot take an email address or a link yet, because the site is not fully set up. Tell whoever runs this site.',
  'not-an-answer': 'That answer could not be read.',
  'not-asked': 'This form does not ask that. Reload the page and send it again.',
  'not-a-link-row':
    'Each row is a link and what kind of link it is. Reload the page and send it again.',
  'type-without-link':
    'A row says what kind of link it is but has no link. Add the link, or clear the row.',
  'link-without-type': 'Say what kind of link each one is.',
  'unknown-field-kind': 'This form asks a question this software cannot read.',
  'kind-not-available-on-a-list': 'This form asks for something a list cannot take.',
  empty: 'A link is needed here.',
  unparseable: 'That does not look like a web address. Copy the whole link, starting with https://',
  'not-http': 'Only web links work here: they start with http:// or https://',
  'credentials-in-url': 'That link has a password in it. Send the public link instead.',
  'bare-address-host':
    'That link points at a bare server address. Send the link to the post or article itself.',
  shortener: 'That is a shortened link. Open it and send the full address it leads to.',
  'no-host': 'That link has no site in it.',
  'email-required-for-personal-data':
    'What you wrote needs an email address with it, so you can ask for it to be deleted. Add one, or remove the writing.',
  'email-required': 'This form needs your email address.',
  'no-such-list': 'There is no form at this address.',

  // ── an administrator ──
  'no-list': 'There is no such list.',
  'no-template': 'That is not a starting point this software ships.',
  'bad-file': 'That file is not a list file this software can read.',
  slug: 'A web address may use lowercase letters, numbers and hyphens, and must start with a letter or number.',
  'slug-taken': 'Another list already uses that web address. Choose a different one.',
  title: 'Give it a title of 1 to 120 characters.',
  blurb: 'The description can be up to 1,000 characters.',
  visibility: 'Who can see it is one of: only administrators, anybody signed in, or listed.',
  outside:
    'Without the site password is one of: behind it, anybody with the link, or offered on the password page.',
  'outside-needs-listed':
    'Only a listed list can be open without the site password. Set it to Listed first.',
  'email-mode':
    'Asking for an email address is either "only when somebody writes something" or "always". ' +
    'There is no "never": a form people can write on must be able to erase what they wrote.',
  when: 'That is not a date and time this software can read.',
  'schedule-order': 'A list has to open before it closes. Move one of the two times.',
  'no-field': 'One of those questions no longer exists. Reload the page and try again.',
  'no-fields': 'A list needs at least one question.',
  'key-taken': 'Two questions share a key. Each needs its own.',
  kind: 'That is not a kind of question this software can ask.',
  label: 'Give every question some words, up to 200 characters.',
  options: 'A list of choices needs at least one choice. Add one.',
  'field-rule': 'That set of questions cannot be collected honestly.',
  'has-entries':
    'This list has taken entries, so it cannot be deleted: that would destroy the links it exists ' +
    'to keep, and break every erasure link already emailed. Close it instead.',
  'review-state': 'Approve or reject.',
  'un-review': 'An entry that has been reviewed cannot be put back to waiting.',
  'review-ids': 'Send the entries you looked at, up to 500.',
  'triage-state': 'That is not a triage state.',
  'search-empty': 'Type a name, an email address or some words to look for.',
  'search-too-long': 'That is too long to look for. Use up to 200 characters.',
} as const;

export type ListRefusalCode = keyof typeof SENTENCES;

const STATUS: Partial<Record<ListRefusalCode, number>> = {
  'no-list': 404,
  'no-such-list': 404,
  'slug-taken': 409,
  'has-entries': 409,
  'no-contact-key': 503,
};

export class ListRefusal extends HttpError {
  override name = 'ListRefusal';
  declare readonly code: ListRefusalCode;
  /** Which question a visitor's refusal is about, when it is about one. */
  readonly key: string | null;
  constructor(code: ListRefusalCode, detail?: string, key: string | null = null) {
    super(STATUS[code] ?? 400, code, detail ?? SENTENCES[code]);
    this.key = key;
  }
}

export function isRefusalCode(code: string): code is ListRefusalCode {
  return Object.hasOwn(SENTENCES, code);
}

/** Declared as a function, not an arrow, so TypeScript narrows after a call. */
export function refuse(code: ListRefusalCode, detail?: string, key?: string | null): never {
  throw new ListRefusal(code, detail, key ?? null);
}

export function sentenceFor(code: string): string {
  return isRefusalCode(code) ? SENTENCES[code] : 'That could not be taken.';
}
