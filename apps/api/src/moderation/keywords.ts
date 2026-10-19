/**
 * Words and phrases that raise a review flag.
 *
 * A match means somebody more senior should look at the report. That is all
 * it means: not a severity, not a finding, not a conclusion about anybody. A
 * false positive costs a moderator a minute; a false negative puts something
 * serious through the fast lane, so the shipped list leans inclusive.
 *
 * EDITABLE PER DEPLOYMENT. `moderation_settings.review_keywords` is the
 * operator's list, and it has three states that only the database can keep
 * apart: NULL is "use the shipped list", an array is "this is our list", and
 * an EMPTY array is "we chose no keyword matching at all".
 *
 * MATCHING is case-insensitive and on word boundaries, so 'gun' does not fire
 * on 'begun'. A multi-word entry matches as a phrase, which is what makes a
 * noisy word usable: 'police' alone fires on every officer standing outside,
 * so it is not here, while 'police removed' is.
 *
 * NOTHING HERE IS SEALED. The list changes; a report must not verify
 * differently because somebody added a word months later.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

/** The shipped list: a starting point for an election deployment. Kept normalized. */
// Packed rather than one per line: four hundred phrases are read as a block.
// prettier-ignore
export const DEFAULT_REVIEW_KEYWORDS: readonly string[] = [
  'a child was', 'afraid for my family', 'afraid to go home', 'against the rules',
  'aggressive toward', 'already marked', 'already voted', 'alzheimer', 'ar-15', 'armed', 'arrest',
  'arrested', 'asked for id', 'asked me to stop taking notes', 'asleep', 'assault', 'assaulted',
  'assisted living', 'attacked', 'badge refused', 'bag of ballots', 'ballot harvesting',
  'ballots in a', 'baton', 'because i am', 'because i was', 'because of my race',
  'birth certificate', 'blind', 'blocked my way', 'blocked the door', 'blocked the entrance',
  'body armor', 'body armour', 'border patrol', 'bought votes', 'box was open', 'broke the rules',
  'called me a', 'called the police', 'campaign hat', 'campaign shirt', 'campaigning', 'care home',
  'carrying a weapon', 'chain of custody', 'changed my ballot', 'chief judge', 'citation',
  'cited me', 'closed the count', 'closed the door', 'closed while', 'coerced', 'coercion',
  'collected our ballots', 'concealed carry', 'confiscated my notes', 'cornered',
  'could not reach the', 'could not see the count', 'could not vote', 'could see my ballot',
  "couldn't vote", 'count was not observable', 'counted in private', 'credentials refused',
  'creole', 'curbside', 'date of birth', 'deaf', 'death threat', 'demanded id', 'demanded my id',
  'dementia', 'denied a ballot', 'denied access', 'denied help', 'denied my ballot',
  'deputies arrived', 'detained', 'did not follow', 'did not get to vote', 'disability',
  'disabled voter', 'discriminated', 'discrimination', 'drunk', 'duplicate ballot', 'elderly',
  'election judge', 'electioneering', 'end my life', 'escorted me out', 'escorted out', 'expelled',
  'expired id', 'family member filled', 'filled in for me', 'firearm', 'firearms', 'flyer said',
  'followed me', 'followed to my car', 'followed us', 'forced me', 'fraud', 'fraudulent',
  'gave me the wrong', 'gave up and left', 'gift card', 'grabbed', 'group home', 'guardian', 'gun',
  'guns', 'handcuffed', 'handgun', 'handing out', 'harassed', 'harassing', 'harassment',
  'hard of hearing', 'harm', 'head covering', 'help me', 'her address', 'hijab', 'his address',
  'hit me', 'holster', 'holstered', 'hurt myself', 'i am afraid', 'i am scared', 'i filmed',
  'i recorded', 'i took a photo of', "i'm scared", 'ice agents', 'id was not valid',
  'ignored the rules', 'immigration agents', 'in danger', 'in full view', 'in handcuffs',
  'in the garbage', 'incapacitated', 'inside the polling', 'intimidated', 'intimidating',
  'intimidation', 'kept my ballot', 'kept too far', 'kicked out', 'kids', 'kill', 'kill myself',
  'killed', 'knife', 'knives', 'leafleting', 'left unattended', 'left without voting',
  'licence plate', 'license plate', 'lied', 'lives at', 'locked the door',
  'looked over my shoulder', 'lying', 'mace', 'made me leave', 'made up', 'made us vote',
  'mandarin', 'marked my ballot', 'menacing', 'militia', 'minor', 'moved me back', 'my boss',
  'my child', 'my daughter', 'my employer', 'my father', 'my husband made', 'my kid',
  'my landlord', 'my mother', 'my neighbor', 'my neighbour', 'my pastor', 'my son', 'my wife made',
  'name is', 'navajo', 'no accessible', 'no ballot for', 'no booth', 'no id required',
  'no interpreter', 'no language assistance', 'no privacy', 'no ramp', 'no reason to live',
  'no translator', 'not accessible', 'not allowed to observe', 'not allowed to vote',
  'not on the list', 'not on the roll', 'not safe', 'nursing home', 'offered cash',
  'offered me money', 'officer removed', 'officers removed', 'on their phone the whole',
  'on video', 'only asked', 'open carry', 'open table', 'out of ballots', 'paid for votes',
  'paid me', 'paid to vote', 'paramilitary', 'passport', 'patient', 'patrol car outside',
  'pepper spray', 'phone number', 'pistol', 'plate number', 'police removed', 'police tape',
  'police were called', 'political button', 'poll manager', 'poll worker said',
  'poll worker told me', 'power of attorney', 'pre filled', 'pre-filled', 'precinct captain',
  'prefilled', 'pressured me', 'profiled', 'proof of address', 'proof of citizenship', 'purged',
  'pushed me', 'questioned by police', 'racial', 'racial slur', 'racist', 'ran out of ballots',
  'refused a ballot', 'refused access', 'refused assistance', 'refused curbside',
  'refused my helper', 'refused my id', 'refused to', 'refused to call', 'refused to check',
  'refused to let', 'refused to translate', 'rejected my id', 'religious', 'removed from the line',
  'removed from the roll', 'removed me as an observer', 'required id', 'resident was', 'rifle',
  'rigged', 'ripped up', 'robocall', 'said i had voted', 'said immigrants', 'said it was rigged',
  'said my id was', 'said the election', 'said you cannot', 'said you need', 'screaming at',
  'screenshot', 'seal was broken', 'searched my', 'seized', 'self harm', 'sent away', 'sent home',
  'service animal', 'shoot', 'shot at', 'shotgun', 'shouted at voters', 'shouting at', 'shoved',
  'shredded', 'shut the door', 'sign said', 'singled out', 'slurs', 'social security',
  'social security number', 'someone filled it in', 'spanish', 'spat', 'spat at', 'spit on',
  'squad car', 'ssn', 'stack of ballots', 'stalked', 'stolen', 'stopped me from watching',
  'struck from the roll', 'student id', 'suicidal', 'suicide', 'surrounded', 'tactical gear',
  'tampered', 'tampering', 'targeted voters', 'taser', 'teenager', 'telling people that',
  'terrified', 'text message said', 'the clerk', 'the judge', 'the man in', 'the registrar',
  'the supervisor', 'the warden', 'the woman in', 'their address', 'their name is',
  'they know where i live', 'threat', 'threatened', 'threatening', 'threats',
  'threw away my ballot', 'threw it in the trash', 'told me i could not', 'told me the wrong',
  'told me to go back', 'told me to leave', 'told us to leave', 'told us to vote',
  'told voters that', 'too close to the', 'took my absentee', 'took my ballot', 'took my phone',
  'tore up', 'trespassed', 'trespassing warning', 'tribal id', 'turban', 'turned away',
  'turned me away', 'turned us away', 'unable to vote', 'unattended ballots', 'underage',
  'unlocked box', 'unsealed', 'utility bill', 'vote buying', 'wanted photo id', 'watched me vote',
  'weapon', 'weapons', 'wearing a', 'wheelchair', 'within the', 'would not accept my id',
  'would not call', 'would not give me a new', 'would not help me', 'would not let me in',
  'would not let me past', 'would not let me vote', "wouldn't let me vote", 'wrong date',
  'wrong information', 'wrong location', 'wrong polling place', 'yarmulke', 'yelled at voters',
];

/** The ceiling the database also enforces: every term goes into one expression. */
export const MAX_KEYWORDS = 2000;
const MAX_TERM = 120;

/**
 * Normalize a list an operator typed: lowercased, trimmed, deduplicated,
 * blanks dropped, sorted. Sorted so two operators who typed the same terms in
 * a different order store the same list.
 */
export function normalizeKeywords(list: unknown): string[] | null {
  if (!Array.isArray(list)) return null;
  const out = [
    ...new Set(
      list
        .map((t) => (typeof t === 'string' ? t : t == null ? '' : String(t as number)))
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .map((t) => t.slice(0, MAX_TERM)),
    ),
  ];
  out.sort();
  return out;
}

/**
 * One regular expression for the whole list. Every term is escaped: a stray
 * `(` an operator typed must not become a syntax error that stops the flag
 * running for every report. A term whose edge is not a word character gets a
 * looser edge there, or `\b` would demand one and never fire.
 */
export function keywordMatcher(terms: readonly string[]): RegExp | null {
  const list = terms.filter(Boolean);
  if (!list.length) return null;
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const part = (t: string) => (/^\w/.test(t) ? '\\b' : '') + esc(t) + (/\w$/.test(t) ? '\\b' : '');
  return new RegExp(`(${list.map(part).join('|')})`, 'gi');
}

/**
 * Which terms a piece of text matched: the terms themselves, because the flag
 * records WHY it fired.
 */
export function matchedKeywords(text: string, terms: readonly string[]): string[] {
  const re = keywordMatcher(terms);
  if (!re || !text) return [];
  const found = new Set<string>();
  for (const m of text.matchAll(re)) found.add(m[0].toLowerCase());
  return [...found].sort();
}

/** What is stored, with who stored it. */
export async function storedKeywords(db: Kysely<DB>) {
  const row = await db
    .selectFrom('moderation_settings')
    .select(['review_keywords', 'review_keywords_set_by', 'review_keywords_set_at'])
    .where('id', '=', true)
    .executeTakeFirst();
  return {
    chosen: row?.review_keywords ?? null,
    set_by: row?.review_keywords_set_by ?? null,
    set_at: row?.review_keywords_set_at ?? null,
  };
}

/**
 * The list this deployment uses: the operator's, or the shipped one when they
 * have not chosen. An empty list is a choice and is honoured. A database that
 * cannot answer falls back to the shipped list, which flags more, not less.
 */
export async function reviewKeywords(db: Kysely<DB>): Promise<string[]> {
  try {
    const { chosen } = await storedKeywords(db);
    return chosen ?? [...DEFAULT_REVIEW_KEYWORDS];
  } catch {
    return [...DEFAULT_REVIEW_KEYWORDS];
  }
}

export type SetKeywordsResult =
  { ok: true; terms: string[]; using_default: boolean } | { ok: false; reason: 'too-many' };

/** Store an operator's list. Null puts the shipped list back. */
export async function setReviewKeywords(
  db: Kysely<DB>,
  list: readonly string[] | null,
  byEmail: string,
): Promise<SetKeywordsResult> {
  const terms = list === null ? null : (normalizeKeywords(list) ?? []);
  if (terms && terms.length > MAX_KEYWORDS) return { ok: false, reason: 'too-many' };
  await db
    .updateTable('moderation_settings')
    .set({
      review_keywords: terms,
      review_keywords_set_by: byEmail,
      review_keywords_set_at: new Date(),
      updated_at: new Date(),
    })
    .where('id', '=', true)
    .execute();
  return {
    ok: true,
    terms: terms ?? [...DEFAULT_REVIEW_KEYWORDS],
    using_default: terms === null,
  };
}
