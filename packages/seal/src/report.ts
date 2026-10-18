/**
 * WHAT A REPORT IS, as an object that gets canonicalized and hashed.
 *
 * A logbook asked some questions and somebody answered them. The sealed
 * object is that, plus the few things every report carries:
 *
 *   public_ref, received_at, thread_id, corrects_id    always
 *   logbook                                            always — the slug
 *   may_publish, may_publish_digest                    always
 *   logbook_form                                       when there is a form version
 *   answers                                            when anything was answered
 *   third_party, filed_via, intake_method,
 *     attested_at, collected_on                        when a coordinator filed it
 *   attachments                                        when files were sealed
 *   recipe                                             only above recipe 1
 *
 * ── THE RULE THAT BREAKS EVERYTHING IF YOU GET IT WRONG ──────────────────
 * A key is written ONLY WHEN IT APPLIES. An absent key and a null one
 * serialize differently under RFC 8785, so making an optional key
 * unconditional changes the fingerprint of every report ever filed. It is
 * also what lets a launched logbook gain a new optional question. The types
 * below say "optional", never "nullable", and `exactOptionalPropertyTypes`
 * stops anyone assigning `undefined` to one. Do not tidy the conditional
 * spreads in this file into unconditional keys.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * WRITE SIDE AND READ SIDE ARE BOTH HERE. `normalizeReportFields` turns a
 * submission into fields; `reportFieldsFromRecord` turns a stored record back
 * into the same fields. They live side by side so they cannot drift, and the
 * server's verifier rebuilds with the same `buildSealedObject` that sealed.
 */
import type { Answers } from '@reportlog/fields';
import { HEX64 } from './hash.ts';

/**
 * The recipe new reports are written under. Recipe 1 writes no `recipe` key
 * at all, so its absence identifies it.
 */
export const RECIPE = 1;

export const INTAKE_METHODS = ['paper', 'phone', 'in_person', 'email', 'other'] as const;
export type IntakeMethod = (typeof INTAKE_METHODS)[number];

export const INTAKE_METHOD_LABELS: Record<IntakeMethod, string> = {
  paper: 'A paper form',
  phone: 'A phone call',
  in_person: 'In person',
  email: 'An email or message',
  other: 'Somewhere else',
};

/** One sealed file, as the manifest commits to it. Ordered by `ordinal`. */
export interface AttachmentEntry {
  ordinal: number;
  sha256: string;
  byte_size: number;
  media_type: string;
}

/** Third-party provenance: all present together, or none of it. */
export interface Provenance {
  third_party: true;
  filed_via: string;
  intake_method: IntakeMethod;
  attested_at: string;
  collected_on?: string;
}

export interface ReportFields extends Partial<Provenance> {
  logbook: string;
  logbook_form?: string;
  answers?: Answers;
  may_publish: boolean;
  may_publish_digest: string;
}

export interface SealedReport extends ReportFields {
  public_ref: string;
  received_at: string;
  thread_id: string;
  corrects_id: number | null;
  recipe?: number;
  attachments?: AttachmentEntry[];
}

export interface SealInput {
  publicRef: string;
  receivedAt: string;
  threadId: string;
  /** Postgres hands bigints back as strings; the number form is settled here. */
  correctsId: number | string | bigint | null | undefined;
  fields: ReportFields;
  attachments?: readonly AttachmentEntry[] | null | undefined;
  recipe?: number | undefined;
}

/** Assemble the object that gets canonicalized and hashed. */
export function buildSealedObject(input: SealInput): SealedReport {
  const recipe = input.recipe ?? RECIPE;
  const sealed: SealedReport = {
    public_ref: input.publicRef,
    received_at: input.receivedAt,
    thread_id: input.threadId,
    corrects_id:
      input.correctsId === null || input.correctsId === undefined ? null : Number(input.correctsId),
    ...input.fields,
  };
  if (recipe > 1) sealed.recipe = recipe;
  if (input.attachments?.length) sealed.attachments = [...input.attachments];
  return sealed;
}

export class ReportFieldsError extends Error {
  override name = 'ReportFieldsError';
}

/** What a filing path hands over, before it is trusted. */
export interface ReportSubmission {
  logbook?: unknown;
  answers?: Answers | undefined;
  may_publish?: unknown;
  may_publish_digest?: unknown;
  third_party?: unknown;
  filed_via?: unknown;
  intake_method?: unknown;
  attested_at?: unknown;
  collected_on?: unknown;
}

/**
 * A submission into the field set the seal takes.
 *
 * `answers` must already have been built by `buildAnswers` against the
 * logbook's own questions. An empty map is dropped here, so "nothing
 * answered" is an absent key, never `{}`.
 *
 * The publication answer is REQUIRED, true or false, with the digest of the
 * card it answered. Every report was asked.
 */
export function normalizeReportFields(b: ReportSubmission): ReportFields {
  const logbook = typeof b.logbook === 'string' ? b.logbook.trim() : '';
  if (!logbook) throw new ReportFieldsError('logbook is required');

  const mayPublish =
    b.may_publish === true || b.may_publish === 'true'
      ? true
      : b.may_publish === false || b.may_publish === 'false'
        ? false
        : undefined;
  const digest =
    typeof b.may_publish_digest === 'string' && HEX64.test(b.may_publish_digest)
      ? b.may_publish_digest
      : undefined;
  if (mayPublish === undefined || digest === undefined) {
    throw new ReportFieldsError('the publication answer and its digest are required');
  }

  return {
    logbook,
    ...(b.answers && Object.keys(b.answers).length ? { answers: b.answers } : {}),
    ...provenanceOf(b),
    may_publish: mayPublish,
    may_publish_digest: digest,
  };
}

/**
 * Third-party provenance, written ONLY when a coordinator filed this on
 * somebody's behalf. `filed_via` is the organization's NAME as it was at
 * filing, so a rename cannot change what a sealed report says. The
 * coordinator's own identity is deliberately absent.
 *
 * ALL OR NOTHING, AND LOUD. The old implementation dropped the whole block
 * when any part was missing, which sealed a coordinator's filing as a
 * first-hand report. A claim about where an account came from is either
 * complete or refused.
 *
 * Times are sealed in one written form (UTC ISO with milliseconds), because
 * the verifier rebuilds them from a timestamp column and must get the same
 * string back.
 */
function provenanceOf(b: ReportSubmission): Partial<Provenance> {
  const thirdParty = b.third_party === true || b.third_party === 'true';
  if (!thirdParty) return {};
  const filedVia = typeof b.filed_via === 'string' ? b.filed_via.trim() : '';
  const intake = INTAKE_METHODS.find((m) => m === b.intake_method);
  const attestedAt = isoInstant(b.attested_at);
  if (!filedVia)
    throw new ReportFieldsError('a third-party report needs the organization it came through');
  if (!intake) throw new ReportFieldsError('a third-party report needs a known intake method');
  if (!attestedAt)
    throw new ReportFieldsError('a third-party report needs a valid attestation time');
  let collectedOn: string | null = null;
  if (b.collected_on !== undefined && b.collected_on !== null && b.collected_on !== '') {
    collectedOn = isoDay(b.collected_on);
    if (!collectedOn) throw new ReportFieldsError('collected_on is not a calendar day');
  }
  return {
    third_party: true,
    filed_via: filedVia,
    intake_method: intake,
    attested_at: attestedAt,
    // The day the account was collected, not typed up. Only when known.
    ...(collectedOn ? { collected_on: collectedOn } : {}),
  };
}

function isoInstant(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isoDay(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/**
 * A report as stored, already converted to plain strings by whoever read it
 * (timestamps as ISO strings, a `date` as YYYY-MM-DD). Nullable columns are
 * null; this function decides which of them become keys.
 */
export interface StoredReportRecord {
  public_ref: string;
  received_at: string;
  thread_id: string;
  corrects_id: number | string | null;
  recipe: number | null;
  logbook_slug: string;
  /** The form hash, from the join. Present exactly when `form_id` is. */
  form_id: number | string | null;
  logbook_form: string | null;
  answers: Answers | null;
  third_party: boolean | null;
  filed_via: string | null;
  intake_method: string | null;
  attested_at: string | null;
  collected_on: string | null;
  may_publish: boolean;
  may_publish_digest: string;
}

/**
 * The exact sealed object, rebuilt from storage. Mirrors
 * `normalizeReportFields` key for key: the conditional keys are the whole
 * subtlety, and rebuilding one unconditionally — even as null — reports an
 * intact report as broken.
 */
export function rebuildSealedObject(
  r: StoredReportRecord,
  attachments: readonly AttachmentEntry[] | null,
): SealedReport {
  if (r.form_id !== null && !r.logbook_form) {
    // A row with a form and no hash was read without the form join, which
    // would silently rebuild a different object. Refuse instead.
    throw new Error('rebuildSealedObject: the record has a form_id but no logbook_form');
  }
  const fields: ReportFields = {
    logbook: r.logbook_slug,
    ...(r.form_id !== null && r.logbook_form ? { logbook_form: r.logbook_form } : {}),
    ...(r.answers && Object.keys(r.answers).length ? { answers: r.answers } : {}),
    ...(r.third_party
      ? {
          third_party: true as const,
          filed_via: r.filed_via ?? '',
          intake_method: r.intake_method as IntakeMethod,
          attested_at: r.attested_at ?? '',
          ...(r.collected_on ? { collected_on: r.collected_on } : {}),
        }
      : {}),
    may_publish: r.may_publish,
    may_publish_digest: r.may_publish_digest,
  };
  return buildSealedObject({
    publicRef: r.public_ref,
    receivedAt: r.received_at,
    threadId: r.thread_id,
    correctsId: r.corrects_id,
    recipe: r.recipe ?? 1,
    fields,
    attachments,
  });
}
