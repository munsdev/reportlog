/**
 * What a report said it had, and whether anybody may ask for it.
 *
 * THE TWO ARE SEPARATE AND MUST STAY SEPARATE. 037 settled it and this
 * module is where the split is enforced in code:
 *
 *   THE DECLARATION is a sealed answer about what existed at the moment of
 *   filing. "I have thirty seconds of video of the line outside." It is an
 *   ordinary field of its own kind, hashed with every other answer, and it
 *   can never change — because what somebody said they had then is a fact
 *   about the filing, not a standing statement about today.
 *
 *   THE PERMISSION is an ongoing grant to be contacted about it, and it
 *   exists to be taken back. It lives in the append-only permission log.
 *
 * So `declared` and `mayBeAsked` are two different questions with two
 * different sources, and a moderator needs BOTH to be true before there is
 * anything to do. One checkbox meaning both would have put a revocable
 * value inside the fingerprint, and a report would verify differently
 * because somebody changed their mind about being contacted.
 *
 * NOT IMPORTED BY ANYTHING THAT HASHES. It reads the permission log.
 */
import { EVIDENCE_DECLARATION_TYPE } from './fieldTypes.js';
import { EVIDENCE_REQUEST, permissionsFor } from './reportPermissions.js';

/**
 * Which of a logbook's questions are evidence declarations.
 *
 * Usually one. Not assumed to be one: nothing stops an operator asking
 * separately about photographs and about documents, and a flow that
 * silently read only the first would lose the second.
 */
export function declarationKeys(fields) {
  return (fields || [])
    .filter((f) => f.kind === EVIDENCE_DECLARATION_TYPE)
    .map((f) => f.key);
}

/**
 * Did this report say it had something?
 *
 * TRUE ONLY ON A SEALED `true`. An absent answer is not a no — it is a
 * report that was never asked, or asked and left blank — but for deciding
 * whether there is anything to request, "not yes" is the only safe reading.
 * The absent-key rule means an unanswered declaration has no key at all.
 */
export function declaredEvidence(answers, fields) {
  if (!answers || typeof answers !== 'object') return false;
  return declarationKeys(fields).some((k) => answers[k] === true);
}

/**
 * What the reporter said it was, where the logbook asked.
 *
 * A convention rather than a schema: the follow-up is an ordinary short
 * text question with a condition on the declaration, so the only thing
 * tying them together is that the operator put one after the other. Found
 * by reading the condition rather than by a naming rule, because a naming
 * rule would be a second, invisible schema.
 */
export function describedEvidence(answers, fields) {
  if (!answers || typeof answers !== 'object') return [];
  const keys = new Set(declarationKeys(fields));
  if (!keys.size) return [];
  const out = [];
  for (const f of fields || []) {
    const when = f.shown_when;
    if (!when || !keys.has(when.field)) continue;
    const value = answers[f.key];
    if (typeof value === 'string' && value.trim()) out.push({ label: f.label, value });
  }
  return out;
}

/**
 * Everything a moderator needs before asking: what was declared, what it
 * was said to be, and whether asking is permitted at all.
 *
 * THE PERMISSION IS READ NOW, never trusted from earlier. Same reasoning as
 * src/renditions.js reading the publication permission at the moment of
 * publishing: a grant that was true when the report arrived says nothing
 * about whether it is true today, and this one exists to be taken back.
 */
export async function evidenceStateFor(threadId, { answers, fields }, client) {
  const perms = await permissionsFor(threadId, client);
  return {
    declared: declaredEvidence(answers, fields),
    described: describedEvidence(answers, fields),
    mayBeAsked: perms[EVIDENCE_REQUEST] === true,
  };
}
