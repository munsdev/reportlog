/**
 * Words and phrases that raise a review flag.
 *
 * A match means somebody more senior should look at the report. That is all
 * it means — not a severity, not a finding, not a conclusion about anybody.
 * A false positive costs a moderator a minute; a false negative puts
 * something serious through the fast lane, so the list leans inclusive.
 *
 * ADMIN-EDITABLE, PER DEPLOYMENT. `site_settings.review_keywords` is the
 * operator's list and NULL means "use the set below". An operator can add,
 * cut, or replace the lot without a deploy, which is the only way a keyword
 * list ever becomes any good: this one has never met real traffic.
 *
 * MATCHING is case-insensitive and on word boundaries, so 'gun' does not
 * fire on 'begun'. A multi-word entry matches as a phrase, which is what
 * makes a noisy word usable: 'police' fires on every report that mentions an
 * officer standing peacefully outside, so it is not here, while 'police
 * removed' and 'arrested' are.
 */

/**
 * The set that ships. A starting point for an election deployment, and the
 * default until an operator changes it.
 */
export const DEFAULT_REVIEW_KEYWORDS = [
  'a child was', 'afraid for my family', 'afraid to go home',
  'against the rules', 'aggressive toward', 'already marked',
  'already voted', 'alzheimer', 'ar-15', 'armed', 'arrest', 'arrested',
  'asked for id', 'asked me to stop taking notes', 'asleep', 'assault',
  'assaulted', 'assisted living', 'attacked', 'badge refused',
  'bag of ballots', 'ballot harvesting', 'ballots in a', 'baton',
  'because i am', 'because i was', 'because of my race',
  'birth certificate', 'blind', 'blocked my way', 'blocked the door',
  'blocked the entrance', 'body armor', 'body armour', 'border patrol',
  'bought votes', 'box was open', 'broke the rules', 'called me a',
  'called the police', 'campaign hat', 'campaign shirt', 'campaigning',
  'care home', 'carrying a weapon', 'chain of custody',
  'changed my ballot', 'chief judge', 'citation', 'cited me',
  'closed the count', 'closed the door', 'closed while', 'coerced',
  'coercion', 'collected our ballots', 'concealed carry',
  'confiscated my notes', 'cornered', 'could not reach the',
  'could not see the count', 'could not vote', 'could see my ballot',
  'couldn\'t vote', 'count was not observable', 'counted in private',
  'credentials refused', 'creole', 'curbside', 'date of birth', 'deaf',
  'death threat', 'demanded id', 'demanded my id', 'dementia',
  'denied a ballot', 'denied access', 'denied help', 'denied my ballot',
  'deputies arrived', 'detained', 'did not follow', 'did not get to vote',
  'disability', 'disabled voter', 'discriminated', 'discrimination',
  'drunk', 'duplicate ballot', 'elderly', 'election judge',
  'electioneering', 'end my life', 'escorted me out', 'escorted out',
  'expelled', 'expired id', 'family member filled', 'filled in for me',
  'firearm', 'firearms', 'flyer said', 'followed me', 'followed to my car',
  'followed us', 'forced me', 'fraud', 'fraudulent', 'gave me the wrong',
  'gave up and left', 'gift card', 'grabbed', 'group home', 'guardian',
  'gun', 'guns', 'handcuffed', 'handgun', 'handing out', 'harassed',
  'harassing', 'harassment', 'hard of hearing', 'harm', 'head covering',
  'help me', 'her address', 'hijab', 'his address', 'hit me', 'holster',
  'holstered', 'hurt myself', 'i am afraid', 'i am scared', 'i filmed',
  'i recorded', 'i took a photo of', 'i\'m scared', 'ice agents',
  'id was not valid', 'ignored the rules', 'immigration agents',
  'in danger', 'in full view', 'in handcuffs', 'in the garbage',
  'incapacitated', 'inside the polling', 'intimidated', 'intimidating',
  'intimidation', 'kept my ballot', 'kept too far', 'kicked out', 'kids',
  'kill', 'kill myself', 'killed', 'knife', 'knives', 'leafleting',
  'left unattended', 'left without voting', 'licence plate',
  'license plate', 'lied', 'lives at', 'locked the door',
  'looked over my shoulder', 'lying', 'mace', 'made me leave', 'made up',
  'made us vote', 'mandarin', 'marked my ballot', 'menacing', 'militia',
  'minor', 'moved me back', 'my boss', 'my child', 'my daughter',
  'my employer', 'my father', 'my husband made', 'my kid', 'my landlord',
  'my mother', 'my neighbor', 'my neighbour', 'my pastor', 'my son',
  'my wife made', 'name is', 'navajo', 'no accessible', 'no ballot for',
  'no booth', 'no id required', 'no interpreter', 'no language assistance',
  'no privacy', 'no ramp', 'no reason to live', 'no translator',
  'not accessible', 'not allowed to observe', 'not allowed to vote',
  'not on the list', 'not on the roll', 'not safe', 'nursing home',
  'offered cash', 'offered me money', 'officer removed',
  'officers removed', 'on their phone the whole', 'on video', 'only asked',
  'open carry', 'open table', 'out of ballots', 'paid for votes',
  'paid me', 'paid to vote', 'paramilitary', 'passport', 'patient',
  'patrol car outside', 'pepper spray', 'phone number', 'pistol',
  'plate number', 'police removed', 'police tape', 'police were called',
  'political button', 'poll manager', 'poll worker said',
  'poll worker told me', 'power of attorney', 'pre filled', 'pre-filled',
  'precinct captain', 'prefilled', 'pressured me', 'profiled',
  'proof of address', 'proof of citizenship', 'purged', 'pushed me',
  'questioned by police', 'racial', 'racial slur', 'racist',
  'ran out of ballots', 'refused a ballot', 'refused access',
  'refused assistance', 'refused curbside', 'refused my helper',
  'refused my id', 'refused to', 'refused to call', 'refused to check',
  'refused to let', 'refused to translate', 'rejected my id', 'religious',
  'removed from the line', 'removed from the roll',
  'removed me as an observer', 'required id', 'resident was', 'rifle',
  'rigged', 'ripped up', 'robocall', 'said i had voted', 'said immigrants',
  'said it was rigged', 'said my id was', 'said the election',
  'said you cannot', 'said you need', 'screaming at', 'screenshot',
  'seal was broken', 'searched my', 'seized', 'self harm', 'sent away',
  'sent home', 'service animal', 'shoot', 'shot at', 'shotgun',
  'shouted at voters', 'shouting at', 'shoved', 'shredded',
  'shut the door', 'sign said', 'singled out', 'slurs', 'social security',
  'social security number', 'someone filled it in', 'spanish', 'spat',
  'spat at', 'spit on', 'squad car', 'ssn', 'stack of ballots', 'stalked',
  'stolen', 'stopped me from watching', 'struck from the roll',
  'student id', 'suicidal', 'suicide', 'surrounded', 'tactical gear',
  'tampered', 'tampering', 'targeted voters', 'taser', 'teenager',
  'telling people that', 'terrified', 'text message said', 'the clerk',
  'the judge', 'the man in', 'the registrar', 'the supervisor',
  'the warden', 'the woman in', 'their address', 'their name is',
  'they know where i live', 'threat', 'threatened', 'threatening',
  'threats', 'threw away my ballot', 'threw it in the trash',
  'told me i could not', 'told me the wrong', 'told me to go back',
  'told me to leave', 'told us to leave', 'told us to vote',
  'told voters that', 'too close to the', 'took my absentee',
  'took my ballot', 'took my phone', 'tore up', 'trespassed',
  'trespassing warning', 'tribal id', 'turban', 'turned away',
  'turned me away', 'turned us away', 'unable to vote',
  'unattended ballots', 'underage', 'unlocked box', 'unsealed',
  'utility bill', 'vote buying', 'wanted photo id', 'watched me vote',
  'weapon', 'weapons', 'wearing a', 'wheelchair', 'within the',
  'would not accept my id', 'would not call', 'would not give me a new',
  'would not help me', 'would not let me in', 'would not let me past',
  'would not let me vote', 'wouldn\'t let me vote', 'wrong date',
  'wrong information', 'wrong location', 'wrong polling place', 'yarmulke',
  'yelled at voters',
];

/**
 * Normalize a list an operator typed.
 *
 * Lowercased, trimmed, deduplicated, blanks dropped. Sorted so two
 * operators who typed the same terms in a different order store the same
 * list and a diff between two deployments means something.
 */
export function normalizeKeywords(list) {
  if (!Array.isArray(list)) return null;
  const out = [...new Set(list
    .map((t) => String(t == null ? '' : t).trim().toLowerCase())
    .filter(Boolean)
    .map((t) => t.slice(0, 120)))];
  out.sort();
  return out;
}

/**
 * One regular expression for the whole list.
 *
 * Built once per list rather than per report: the flag runs on every
 * submission, and four hundred separate `includes` calls over a long
 * account is work for nothing.
 *
 * Every term is escaped — an operator's list is text they typed, and a
 * stray `(` in it must not become a syntax error that stops the flag
 * running at all. `\b` on both ends is the word boundary; a term that
 * starts or ends with a non-word character gets a looser edge, which is
 * correct rather than a compromise ('ar-15' has to match 'an AR-15').
 */
export function keywordMatcher(terms) {
  const list = (terms || []).filter(Boolean);
  if (!list.length) return null;
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const part = (t) => {
    const body2 = esc(t);
    const left = /^\w/.test(t) ? '\\b' : '';
    const right = /\w$/.test(t) ? '\\b' : '';
    return left + body2 + right;
  };
  return new RegExp('(' + list.map(part).join('|') + ')', 'gi');
}

/**
 * The list this deployment actually uses.
 *
 * The operator's, or the shipped set when they have not chosen. An EMPTY
 * array is a choice and is honoured — an operator running a logbook of
 * equipment faults may well want no keyword matching at all, and a design
 * that could not express that would make turning it off impossible without
 * turning the flag off.
 */
export async function reviewKeywords(client) {
  const { pool } = await import('./db.js');
  const db = client || pool;
  try {
    const { rows } = await db.query(
      'SELECT review_keywords FROM site_settings WHERE id = true',
    );
    const chosen = rows[0] ? rows[0].review_keywords : null;
    // null means not chosen; [] means chosen and empty.
    return chosen === null || chosen === undefined
      ? DEFAULT_REVIEW_KEYWORDS.slice() : chosen;
  } catch {
    // A database that cannot answer must not silently stop flagging. The
    // shipped set is the safe direction: it flags more, not less.
    return DEFAULT_REVIEW_KEYWORDS.slice();
  }
}

/**
 * Store an operator's list. Null clears it back to the shipped set.
 */
export async function setReviewKeywords(list, { byEmail = null } = {}, client) {
  const { pool } = await import('./db.js');
  const db = client || pool;
  const terms = list === null ? null : normalizeKeywords(list);
  if (terms && terms.length > 2000) return { ok: false, reason: 'too-many' };
  await db.query(
    `UPDATE site_settings
        SET review_keywords = $1, review_keywords_set_by = $2,
            review_keywords_set_at = now(), updated_at = now()
      WHERE id = true`,
    [terms, byEmail],
  );
  return { ok: true, terms: terms === null ? DEFAULT_REVIEW_KEYWORDS.slice() : terms, usingDefault: terms === null };
}

/**
 * Which terms a piece of text matched.
 *
 * Returns the terms themselves, not a boolean, because the flag records WHY
 * it fired — a reviewer who cannot see what tripped it has to repeat the
 * triage.
 */
export function matchedKeywords(text, terms) {
  const re = keywordMatcher(terms);
  if (!re || !text) return [];
  const found = new Set();
  for (const m of String(text).matchAll(re)) found.add(m[0].toLowerCase());
  return [...found].sort();
}
