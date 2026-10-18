/**
 * Checking the server's answer again, in the reader's own browser.
 *
 * The verification page shows what was hashed and the exact bytes it was
 * hashed as. These two checks need nothing from the server but those bytes:
 * the same @reportlog/seal code that sealed the report runs here, so a reader
 * does not have to take the server's word for its own result.
 */
import { canonicalJson, sha256Hex } from '@reportlog/seal';
import type { Verification } from '@reportlog/contracts';

export interface BrowserRecheck {
  /** The shown fields serialize to exactly the shown bytes. */
  bytesMatchFields: boolean;
  /** SHA-256 of those bytes is the fingerprint recorded at filing. */
  hashMatchesRecord: boolean;
}

export function recheckInBrowser(v: Verification): BrowserRecheck {
  return {
    bytesMatchFields: canonicalJson(v.hashed_fields) === v.canonical_json,
    hashMatchesRecord: sha256Hex(v.canonical_json) === v.content.recorded,
  };
}
