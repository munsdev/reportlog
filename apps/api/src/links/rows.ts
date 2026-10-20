import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export type Db = Kysely<DB> | Transaction<DB>;

/** The three outcomes of a link check (M3). Unchecked is the absence of one. */
export const OUTCOMES = ['checked', 'withheld', 'illegal'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const isOutcome = (v: unknown): v is Outcome =>
  typeof v === 'string' && (OUTCOMES as readonly string[]).includes(v);

/** M4: capped, for journalists. */
export const MAX_COMMENT = 500;

export const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
