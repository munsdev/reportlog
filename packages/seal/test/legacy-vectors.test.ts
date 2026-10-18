/**
 * The new sealing code against fingerprints the old code actually produced.
 *
 * Every vector must match byte for byte, except the cases in FIXED: old
 * behaviour this rewrite corrects on purpose, each named with what the old
 * code did so nobody "fixes" the test back to the bug.
 */
import { describe, expect, it } from 'vitest';
import vectors from './fixtures/legacy-vectors.json' with { type: 'json' };
import {
  buildSealedObject,
  canonicalJson,
  cardFor,
  chainGenesis,
  chainHash,
  checkChainFile,
  contentHash,
  formText,
  headsDigest,
  normalizeReportFields,
  ReportFieldsError,
} from '../src/index.ts';
import type { AttachmentEntry, ChainFile, ReportSubmission } from '../src/index.ts';

/** Vector name → why the new code refuses what the old code sealed. */
const FIXED: Record<string, RegExp> = {
  // The old code dropped an incomplete third-party block and sealed a
  // coordinator's filing as if the reporter had filed it themselves.
  'third-party-incomplete-dropped': /intake method/,
};

interface SealVector {
  name: string;
  input: {
    publicRef: string;
    receivedAt: string;
    threadId: string;
    correctsId: string | number | null;
    logbook_form?: string;
    attachments?: AttachmentEntry[];
    report: ReportSubmission;
  };
  canonical: string;
  content_hash: string;
}

describe('sealed objects match the legacy implementation byte for byte', () => {
  for (const v of vectors.seal as SealVector[]) {
    it(v.name, () => {
      const seal = () => {
        const fields = normalizeReportFields(v.input.report);
        if (v.input.logbook_form) fields.logbook_form = v.input.logbook_form;
        return buildSealedObject({
          publicRef: v.input.publicRef,
          receivedAt: v.input.receivedAt,
          threadId: v.input.threadId,
          correctsId: v.input.correctsId,
          fields,
          attachments: v.input.attachments,
        });
      };
      const fixed = FIXED[v.name];
      if (fixed) {
        expect(seal).toThrow(ReportFieldsError);
        expect(seal).toThrow(fixed);
        return;
      }
      const sealed = seal();
      expect(canonicalJson(sealed)).toBe(v.canonical);
      expect(contentHash(sealed)).toBe(v.content_hash);
    });
  }
});

describe('chain values match the legacy implementation', () => {
  it.each(vectors.genesis)('genesis of $slug', ({ slug, genesis }) => {
    expect(chainGenesis(slug)).toBe(genesis);
  });
  it.each(vectors.chain)('link', ({ content, prev, chain }) => {
    expect(chainHash(content, prev)).toBe(chain);
  });
  it('heads digest', () => {
    expect(headsDigest(vectors.heads.date, vectors.heads.heads)).toBe(vectors.heads.digest);
  });
});

describe('form definitions hash as the legacy implementation did', () => {
  for (const f of vectors.forms) {
    it(f.slug, () => {
      const got = formText(f.slug, f.fields);
      expect(got.definition).toBe(f.definition);
      expect(got.hash).toBe(f.hash);
    });
  }
});

describe('the publication card digests as the legacy implementation did', () => {
  it.each(vectors.consent)('$variant', ({ variant, digest }) => {
    expect(cardFor(variant).digest).toBe(digest);
  });
});

describe('the chain file checker agrees with the legacy one', () => {
  for (const c of vectors.chainFiles) {
    it(c.name, () => {
      // JSON imports widen `kind` to string; a downloaded file is untyped anyway.
      const file: unknown = c.file;
      const got = checkChainFile(file as ChainFile);
      expect(got.ok).toBe(c.result.ok);
      expect(got.problems).toEqual(c.result.problems);
      expect(got.head).toBe(c.result.head);
    });
  }
});
