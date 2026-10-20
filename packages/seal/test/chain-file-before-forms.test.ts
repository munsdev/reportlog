/**
 * A chain file from before forms were sealed. Its reports carry no
 * `logbook_form`, and the file may carry no `forms` at all. Such a file must
 * still check: reports filed then are as permanent as any, and the checker
 * asks a report about its questions only when the report names some.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSealedObject,
  chainGenesis,
  chainHash,
  CHAIN_FILE_FORMAT,
  checkChainFile,
  contentHash,
  formText,
  normalizeReportFields,
} from '../src/index.ts';
import type { ChainFile, ChainFileReport } from '../src/index.ts';

const DIGEST = 'a'.repeat(64);
const SLUG = 'old-logbook';

/** A run of reports, each linked to the one before, optionally with a form. */
function chain(n: number, form?: { at: number; hash: string }): ChainFileReport[] {
  const out: ChainFileReport[] = [];
  let prev = chainGenesis(SLUG);
  for (let i = 0; i < n; i += 1) {
    const fields = normalizeReportFields({
      logbook: SLUG,
      answers: { what: `report ${String(i)}` },
      may_publish: true,
      may_publish_digest: DIGEST,
    });
    if (form && i >= form.at) fields.logbook_form = form.hash;
    const sealed = buildSealedObject({
      publicRef: `RL-0-00000${String(i)}`,
      receivedAt: `2026-01-0${String(i + 1)}T09:00:00.000Z`,
      threadId: `00000000-0000-4000-8000-00000000000${String(i)}`,
      correctsId: null,
      fields,
    });
    const content = contentHash(sealed);
    const link = chainHash(content, prev);
    out.push({
      public_ref: sealed.public_ref,
      hashed_fields: sealed,
      content_hash: content,
      prev_chain_hash: prev,
      chain_hash: link,
    });
    prev = link;
  }
  return out;
}

const fileOf = (reports: ChainFileReport[], extra: Partial<ChainFile> = {}): ChainFile => ({
  chain_file_format: CHAIN_FILE_FORMAT,
  kind: 'complete',
  logbook: SLUG,
  genesis: chainGenesis(SLUG),
  chain_length: reports.length,
  anchors: [
    { date: '2026-01-05', head: reports.at(-1)?.chain_hash ?? '', reports: reports.length },
  ],
  reports,
  ...extra,
});

describe('a chain file from before forms', () => {
  it('checks out with no forms key at all', () => {
    const reports = chain(3);
    expect(reports.every((r) => !('logbook_form' in r.hashed_fields))).toBe(true);
    const out = checkChainFile(fileOf(reports));
    expect(out.problems).toEqual([]);
    expect(out.ok).toBe(true);
    expect(out.anchors?.every((a) => a.ok)).toBe(true);
  });

  it('checks out with an empty list of forms', () => {
    expect(checkChainFile(fileOf(chain(3), { forms: [] })).problems).toEqual([]);
  });

  it('checks out when its later reports were filed against a form and its early ones were not', () => {
    const form = formText(SLUG, [{ key: 'what', kind: 'long_text', label: 'What happened?' }]);
    const reports = chain(4, { at: 2, hash: form.hash });
    expect(reports.map((r) => 'logbook_form' in r.hashed_fields)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    const out = checkChainFile(fileOf(reports, { forms: [form] }));
    expect(out.problems).toEqual([]);
    // The later ones are still held to their form: without it, they are named.
    const missing = checkChainFile(fileOf(reports, { forms: [] }));
    expect(missing.problems).toHaveLength(2);
    expect(missing.problems.join('|')).toMatch(/does not carry them/);
  });
});
