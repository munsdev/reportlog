/**
 * Checking a chain file: the file, and nothing else.
 *
 * No database, no network, no import of anything that has either, so this
 * runs anywhere somebody has a copy of the file and Node. The file format is
 * described in src/chainFile.js, which builds it.
 */
import canonicalize from 'canonicalize';
import crypto from 'node:crypto';

export const CHAIN_FILE_FORMAT = 1;

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** Where a logbook's chain starts. The same rule as chainGenesis in src/crypto.js. */
export const genesisOf = (slug) => sha(`reportlog-chain:${slug}`);

/**
 * Check a chain file. Pure — the file and nothing else.
 *
 * Returns { ok, kind, checked, problems: [sentences], head, anchors: [...] }.
 * `problems` is empty when everything that CAN be checked in a file of that
 * kind holds.
 */
export function checkChainFile(file) {
  const problems = [];
  if (!file || file.chain_file_format !== CHAIN_FILE_FORMAT) {
    return { ok: false, problems: ['This is not a chain file this checker understands.'] };
  }
  const genesis = genesisOf(file.logbook);
  if (file.genesis !== genesis) problems.push('The starting value in the file is not the one its logbook\'s name gives.');
  const complete = file.kind === 'complete';
  let prev = genesis;
  const byChainHash = new Map();
  // The questions, by hash. An entry only counts when its own text hashes to
  // the name it is filed under, and it has to be this logbook's.
  const forms = new Map();
  for (const f of file.forms || []) {
    if (typeof f.definition !== 'string' || sha(f.definition) !== f.hash) {
      problems.push('A form in the file does not match its own fingerprint: its text has changed.');
      continue;
    }
    let parsed = null;
    try { parsed = JSON.parse(f.definition); } catch { /* reported below */ }
    if (!parsed || parsed.logbook !== file.logbook || !Array.isArray(parsed.questions)) {
      problems.push('A form in the file is not this logbook\'s.');
      continue;
    }
    forms.set(f.hash, parsed);
  }
  for (const [i, r] of (file.reports || []).entries()) {
    const n = `Report ${i + 1} (${r.public_ref})`;
    if (r.hashed_fields?.logbook !== file.logbook) problems.push(`${n} is sealed as belonging to another logbook.`);
    if (sha(canonicalize(r.hashed_fields)) !== r.content_hash) problems.push(`${n} does not match its own fingerprint: its contents have changed.`);
    if (sha(r.content_hash + r.prev_chain_hash) !== r.chain_hash) problems.push(`${n}'s link does not add up.`);
    if (r.hashed_fields?.logbook_form !== undefined) {
      const form = forms.get(r.hashed_fields.logbook_form);
      if (!form) {
        problems.push(`${n} names the questions it was answered against, and the file does not carry them.`);
      } else {
        const asked = new Map(form.questions.map((q) => [q.key, q]));
        const answers = r.hashed_fields.answers || {};
        for (const key of Object.keys(answers)) {
          if (!asked.has(key)) problems.push(`${n} answers "${key}", which those questions do not ask.`);
        }
        for (const q of form.questions) {
          if (q.required && !(q.key in answers)) problems.push(`${n} leaves out "${q.key}", which those questions require.`);
        }
      }
    }
    if (complete && r.prev_chain_hash !== prev) problems.push(`${n} does not follow the report before it: something is missing or out of place just before it.`);
    prev = r.chain_hash;
    byChainHash.set(r.chain_hash, i + 1);
  }
  const reports = file.reports || [];
  const head = complete ? prev : null;
  if (complete && reports.length !== file.chain_length) {
    problems.push(`The file says the chain holds ${file.chain_length} reports and carries ${reports.length}.`);
  }
  // Each anchor names the head this logbook had that day and how long it
  // was. On a complete file both can be matched exactly.
  const anchors = (file.anchors || []).map((a) => {
    if (!complete) return { ...a, checked: false };
    const at = a.reports === 0 ? (a.head === genesis ? 0 : -1) : byChainHash.get(a.head);
    const ok = at === a.reports;
    if (!ok) problems.push(`The anchor of ${a.date} names a head with ${a.reports} report(s) that this chain does not have at that position.`);
    return { ...a, checked: true, ok };
  });
  return { ok: problems.length === 0, kind: file.kind, checked: reports.length, head, problems, anchors };
}
