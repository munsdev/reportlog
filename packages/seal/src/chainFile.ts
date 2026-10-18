/**
 * ONE LOGBOOK'S CHAIN, AS A FILE ANYBODY CAN CHECK — the file and nothing
 * else. No database, no network, so this runs in a reader's browser or on a
 * laptop with nothing but the downloaded file.
 *
 *   complete   every version of every report, published or not, in chain
 *              order. Every link can be checked from genesis to head.
 *              Administrators only.
 *   published  only what the public board shows. Each report's fingerprint
 *              and link can be checked; the run between them has gaps.
 */
import { canonicalJson, chainGenesis, sha256Hex } from './hash.ts';
import type { FormDefinition } from './form.ts';
import type { SealedReport } from './report.ts';

export const CHAIN_FILE_FORMAT = 1;

export interface ChainFileReport {
  public_ref: string;
  hashed_fields: SealedReport;
  content_hash: string;
  prev_chain_hash: string;
  chain_hash: string;
}

export interface ChainFileAnchor {
  date: string;
  head: string;
  reports: number;
  root_chain_hash?: string;
  public_log_ref?: string | null;
}

export interface ChainFile {
  chain_file_format: number;
  kind: 'complete' | 'published';
  logbook: string;
  title?: string;
  genesis: string;
  chain_length: number;
  exported_at?: string;
  forms?: { hash: string; definition: string }[];
  how_to_check?: string;
  anchors?: ChainFileAnchor[];
  reports?: ChainFileReport[];
}

export interface ChainFileCheck {
  ok: boolean;
  kind?: ChainFile['kind'];
  checked?: number;
  head?: string | null;
  problems: string[];
  anchors?: (ChainFileAnchor & { checked: boolean; ok?: boolean })[];
}

export const HOW_TO_CHECK =
  'For each report: serialize hashed_fields with RFC 8785 and take its ' +
  'SHA-256, which must equal content_hash; then SHA-256 of content_hash followed by ' +
  'prev_chain_hash (both as hex text) must equal chain_hash. On a complete file each ' +
  'prev_chain_hash is the chain_hash before it, and the first is genesis: SHA-256 of ' +
  '"reportlog-chain:" followed by the logbook\'s slug. A report with a logbook_form names ' +
  "the questions it was answered against: the SHA-256 of that entry's definition in forms, " +
  'text exactly as written, must equal it, and every answer must be to a question it asks.';

/** Check a chain file. `problems` is empty when everything checkable holds. */
export function checkChainFile(file: ChainFile | null | undefined): ChainFileCheck {
  const problems: string[] = [];
  if (file?.chain_file_format !== CHAIN_FILE_FORMAT) {
    return { ok: false, problems: ['This is not a chain file this checker understands.'] };
  }
  const genesis = chainGenesis(file.logbook);
  if (file.genesis !== genesis) {
    problems.push("The starting value in the file is not the one its logbook's name gives.");
  }
  const complete = file.kind === 'complete';

  // The questions, by hash. An entry counts only when its own text hashes to
  // the name it is filed under, and it is this logbook's.
  const forms = new Map<string, FormDefinition>();
  for (const f of file.forms ?? []) {
    if (typeof f.definition !== 'string' || sha256Hex(f.definition) !== f.hash) {
      problems.push('A form in the file does not match its own fingerprint: its text has changed.');
      continue;
    }
    let parsed: FormDefinition | null = null;
    try {
      parsed = JSON.parse(f.definition) as FormDefinition;
    } catch {
      /* reported below */
    }
    if (parsed?.logbook !== file.logbook || !Array.isArray(parsed.questions)) {
      problems.push("A form in the file is not this logbook's.");
      continue;
    }
    forms.set(f.hash, parsed);
  }

  const reports = file.reports ?? [];
  const byChainHash = new Map<string, number>();
  let prev = genesis;
  for (const [i, r] of reports.entries()) {
    const n = `Report ${i + 1} (${r.public_ref})`;
    if (r.hashed_fields.logbook !== file.logbook) {
      problems.push(`${n} is sealed as belonging to another logbook.`);
    }
    if (sha256Hex(canonicalJson(r.hashed_fields)) !== r.content_hash) {
      problems.push(`${n} does not match its own fingerprint: its contents have changed.`);
    }
    if (sha256Hex(r.content_hash + r.prev_chain_hash) !== r.chain_hash) {
      problems.push(`${n}'s link does not add up.`);
    }
    const formHash = r.hashed_fields.logbook_form;
    if (formHash !== undefined) {
      const form = forms.get(formHash);
      if (!form) {
        problems.push(
          `${n} names the questions it was answered against, and the file does not carry them.`,
        );
      } else {
        const asked = new Map(form.questions.map((q) => [q.key, q]));
        const answers = r.hashed_fields.answers ?? {};
        for (const key of Object.keys(answers)) {
          if (!asked.has(key))
            problems.push(`${n} answers "${key}", which those questions do not ask.`);
        }
        for (const q of form.questions) {
          if (q.required && !(q.key in answers)) {
            problems.push(`${n} leaves out "${q.key}", which those questions require.`);
          }
        }
      }
    }
    if (complete && r.prev_chain_hash !== prev) {
      problems.push(
        `${n} does not follow the report before it: something is missing or out of place just before it.`,
      );
    }
    prev = r.chain_hash;
    byChainHash.set(r.chain_hash, i + 1);
  }

  if (complete && reports.length !== file.chain_length) {
    problems.push(
      `The file says the chain holds ${file.chain_length} reports and carries ${reports.length}.`,
    );
  }

  // Each anchor names the head this logbook had that day and how long it was.
  const anchors = (file.anchors ?? []).map((a) => {
    if (!complete) return { ...a, checked: false };
    const at = a.reports === 0 ? (a.head === genesis ? 0 : -1) : byChainHash.get(a.head);
    const ok = at === a.reports;
    if (!ok) {
      problems.push(
        `The anchor of ${a.date} names a head with ${a.reports} report(s) that this chain does not have at that position.`,
      );
    }
    return { ...a, checked: true, ok };
  });

  return {
    ok: problems.length === 0,
    kind: file.kind,
    checked: reports.length,
    head: complete ? prev : null,
    problems,
    anchors,
  };
}
