import { z } from 'zod';
import { defineRoute } from './route.ts';

const Hex64 = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * Four checks rather than one verdict, because they fail for different
 * reasons and a reader deserves to know which:
 *
 *   content   the report still hashes to what was recorded (not edited)
 *   link      its chain link adds up
 *   position  the report before it is the one it was filed after
 *   anchor    an outside timestamp covers it yet (not a failure if not)
 */
export const Verification = z.object({
  public_ref: z.string(),
  recipe: z.number().int(),
  received_at: z.string(),
  chain: z.object({ logbook: z.string(), logbook_title: z.string(), genesis: Hex64 }),
  /** What was hashed, and the exact bytes it was hashed as. */
  hashed_fields: z.record(z.string(), z.unknown()),
  canonical_json: z.string(),
  content: z.object({ recorded: Hex64, computed: Hex64, ok: z.boolean() }),
  link: z.object({ recorded: Hex64, computed: Hex64, prev_chain_hash: Hex64, ok: z.boolean() }),
  position: z.object({
    expected_prev: Hex64,
    recorded_prev: Hex64,
    ok: z.boolean(),
    is_first: z.boolean(),
  }),
  anchor: z.discriminatedUnion('anchored', [
    z.object({
      anchored: z.literal(true),
      date: z.string(),
      root_chain_hash: Hex64,
      logbook_head: Hex64,
      public_log_ref: z.string().nullable(),
    }),
    z.object({ anchored: z.literal(false) }),
  ]),
});
export type Verification = z.infer<typeof Verification>;

export const verifyReport = defineRoute({
  method: 'GET',
  path: '/api/reports/:ref/verify',
  summary: "Re-derive a report's fingerprint and chain link and say whether they still hold.",
  params: z.object({ ref: z.string().min(1).max(64) }),
  response: Verification,
});
