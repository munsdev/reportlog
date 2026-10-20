/**
 * Checking the server's answer again, in the reader's own browser.
 *
 * The verification page shows what was hashed and the exact bytes it was
 * hashed as. These checks need nothing from the server but those bytes:
 * the same @reportlog/seal code that sealed the report runs here, so a reader
 * does not have to take the server's word for its own result.
 *
 * A report that is not public comes without its bytes (decisions.md §1).
 * What is left to check here is the link: the recorded fingerprint and the
 * one before it still combine into the recorded link.
 */
import { canonicalJson, chainHash, sha256Hex } from '@reportlog/seal';
import type { Verification } from '@reportlog/contracts';

export type BrowserRecheck =
  | {
      kind: 'text';
      /** The shown fields serialize to exactly the shown bytes. */
      bytesMatchFields: boolean;
      /** SHA-256 of those bytes is the fingerprint recorded at filing. */
      hashMatchesRecord: boolean;
      linkMatchesRecord: boolean;
    }
  | { kind: 'fingerprints'; linkMatchesRecord: boolean };

export function recheckInBrowser(v: Verification): BrowserRecheck {
  const linkMatchesRecord =
    chainHash(v.content.recorded, v.link.prev_chain_hash) === v.link.recorded;
  if (v.canonical_json === undefined || v.hashed_fields === undefined) {
    return { kind: 'fingerprints', linkMatchesRecord };
  }
  return {
    kind: 'text',
    bytesMatchFields: canonicalJson(v.hashed_fields) === v.canonical_json,
    hashMatchesRecord: sha256Hex(v.canonical_json) === v.content.recorded,
    linkMatchesRecord,
  };
}

export const recheckPassed = (r: BrowserRecheck) =>
  r.kind === 'text'
    ? r.bytesMatchFields && r.hashMatchesRecord && r.linkMatchesRecord
    : r.linkMatchesRecord;
