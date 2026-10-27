/**
 * The credential sweep: DELETES whole rows that expired, from tables named
 * below and nowhere else.
 *
 * THERE ARE TWO SWEEPS AND THEY DO DIFFERENT THINGS. This one deletes
 * expired credentials: sign-in codes, sessions, confirmation links, site
 * password tokens. Every one of them is checked against its own `expires_at`
 * when it is used, so an expired row has never been accepted, and this is
 * not a security fix. It stops the tables growing forever with dead
 * credentials, which is a thing to hand anybody who gets a copy of the
 * database, and a thing to explain to anybody asking what is kept and for
 * how long.
 *
 * The other sweep (`lists-sweep`, workstream E, `apps/api/src/lists/`)
 * ERASES the personal half of expired list entries and leaves the row
 * standing, because a list entry's links are the half that stays. A list
 * table must never appear here: this would delete the row. The test suite
 * refuses one.
 *
 * NAMED, NEVER DISCOVERED. A list is reviewable; a scan for an `expires_at`
 * column is a rule nobody reads that quietly picks up whatever matches it
 * next. The database test makes the opposite mistake impossible too: a new
 * table WITH an `expires_at` column fails the suite until somebody decides,
 * in this file, whether it is swept.
 *
 * None of these tables is created by this workstream. Their owners create
 * them; until they exist, the sweep says so and moves on.
 */
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { forgetOldMessages } from '../evidence/requests.ts';
import type { JobContext, JobOutcome } from './context.ts';

/**
 * Expired credentials: deleted whole, each table under its own condition.
 * The conditions are fixed SQL written here, never built from input.
 */
export interface SweptTable {
  table: string;
  what: string;
  owner: string;
  /** Which rows are expired. Mirrors what the owning module already treats as dead. */
  expired: string;
}

export const SWEPT: readonly SweptTable[] = [
  { table: 'otp_codes', what: 'one-time codes', owner: 'A', expired: 'expires_at < now()' },
  { table: 'sessions', what: 'sessions', owner: 'A', expired: 'expires_at < now()' },
  {
    table: 'site_access_tokens',
    what: 'site password tokens',
    owner: 'A',
    expired: 'expires_at < now()',
  },
  {
    // At most one row; an expired proposal is refused when used and deleted
    // when replaced (identity/ownership.ts). This deletes it sooner.
    table: 'ownership_transfers',
    what: 'expired owner handovers',
    owner: 'A',
    expired: 'expires_at < now()',
  },
  {
    // A link that was never used, past its time. identity/invitations.ts
    // deletes exactly these before counting outstanding invitations; this
    // does it on a schedule. An accepted or held invitation has no link and
    // no expiry, and is never touched.
    table: 'organization_invites',
    what: 'expired invitation links',
    owner: 'A',
    expired: "status = 'pending' AND expires_at < now()",
  },
  {
    // Kept only to count invitations to an address per day; the module
    // itself drops rows older than 14 days (SEND_LOG_TTL_MS).
    table: 'organization_invite_sends',
    what: 'invitation send records older than 14 days',
    owner: 'A',
    expired: "sent_at < now() - interval '14 days'",
  },
  {
    // The stop link in a digest email (identity/digestStop.ts). Past its
    // time it answers as if it never existed, so the row is only a hash.
    table: 'digest_stop_links',
    what: 'expired digest stop links',
    owner: 'A',
    expired: 'expires_at < now()',
  },
  {
    // The confirm and stop links of the journalist alert list
    // (journalists/list.ts). Past its time a link answers as if it never
    // existed; the alert job deletes them too, this is the net.
    table: 'journalist_links',
    what: 'expired journalist alert links',
    owner: 'J',
    expired: 'expires_at < now()',
  },
  {
    // A passkey challenge never answered (identity/passkeys.ts). Spent when
    // answered; an expired one is refused. Sessions cascade to these too.
    table: 'two_factor_challenges',
    what: 'unanswered passkey challenges',
    owner: 'A',
    expired: 'expires_at < now()',
  },
  {
    // UNCONFIRMED only. Until confirmation the row holds the reporter's
    // address in the clear (docs/status/C-filing.md), so an unconfirmed one
    // past its link's expiry is exactly what should not be kept. A confirmed
    // row has no address and links a thread; erasure deletes it, not this.
    table: 'report_submissions',
    what: 'unconfirmed reports whose confirmation link expired',
    owner: 'C',
    expired: 'confirmed_at IS NULL AND expires_at < now()',
  },
  {
    // D5's count of reports per address per day. A digest under a key of ITS
    // day, so yesterday's rows match nothing and are only weight. The
    // current day's rows are never touched.
    table: 'filing_address_days',
    what: 'per-address daily counts of earlier days',
    owner: 'E1',
    expired: "day < (now() AT TIME ZONE 'UTC')::date",
  },
  {
    // Spent puzzle solutions (door/puzzle.ts): the hash of a challenge we
    // issued, kept only until that challenge would have expired anyway. The
    // door deletes them as it goes; this is the net for a quiet site.
    table: 'door_spent_puzzles',
    what: 'spent puzzle solutions past their expiry',
    owner: 'PE2',
    expired: 'expires_at < now()',
  },
];

/**
 * Tables that have an `expires_at` column and are deliberately NOT swept
 * here, each with the reason. The database test fails on a table with that
 * column that is in neither list. contact_keys and report_contacts have no
 * such column and are never touched by any sweep: deleting a contact key is
 * a reporter's erasure, and report_contacts is append-only.
 */
export const NOT_SWEPT: readonly { table: string; why: string }[] = [
  {
    table: 'list_erasures',
    why: 'a list table: the lists sweep (workstream E) removes spent and expired erasure links',
  },
  {
    table: 'list_notify_confirmations',
    why: 'a list table: the lists sweep (workstream E) removes spent and expired links',
  },
  {
    table: 'upload_slots',
    why: 'the files job (workstream F) expires these itself: it deletes the staged and stored objects, destroys the key and wipes the address digest. A deleted row would leave objects in storage nothing points at',
  },
  {
    table: 'evidence_requests',
    why: 'the record that a reporter was asked, kept after the link expires (workstream F stamps expired_at); the token is stored only as a hash. Its words are forgotten after a year, below (forgetOldMessages), and the row stays',
  },
];

export type SweepResult = Record<string, number | 'absent' | { error: string }>;

/**
 * One statement per table, each on its own. One locked or broken table must
 * not stop the others being tidied, and there is nothing to keep consistent
 * between them.
 */
export async function sweepExpired(
  db: Database,
  tables: readonly Pick<SweptTable, 'table' | 'expired'>[] = SWEPT,
): Promise<SweepResult> {
  const result: SweepResult = {};
  for (const { table, expired } of tables) {
    try {
      const exists = await sql<{
        r: string | null;
      }>`SELECT to_regclass(${`public.${table}`})::text AS r`
        .execute(db)
        .then((q) => q.rows[0]?.r != null);
      if (!exists) {
        result[table] = 'absent';
        continue;
      }
      // A staged file keeps a foreign key to its submission, and the files
      // job expires the file but leaves the row. Without this, one expired
      // report with a file would make the whole table undeletable. The file
      // is the files job's: it is expired by its own `expires_at`, which is
      // the link's, so only the pointer is cleared here.
      if (table === 'report_submissions') {
        await sql`UPDATE upload_slots SET submission_id = NULL
          WHERE submission_id IN (SELECT id FROM report_submissions WHERE ${sql.raw(expired)})`.execute(
          db,
        );
      }
      const deleted = await sql`DELETE FROM ${sql.table(table)} WHERE ${sql.raw(expired)}`.execute(
        db,
      );
      result[table] = Number(deleted.numAffectedRows ?? 0);
    } catch (err) {
      result[table] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return result;
}

export async function runSweep(ctx: JobContext): Promise<JobOutcome> {
  const result = await sweepExpired(ctx.db);
  let total = 0;
  let failed = 0;
  // NOT A DELETE, so not in SWEPT: an evidence request's row stays and only
  // its words go, a year after they were sent (evidence/requests.ts).
  let forgotten = 0;
  try {
    forgotten = await forgetOldMessages(ctx.db);
    ctx.log(
      `${String(forgotten).padStart(7)}  evidence request words older than a year, forgotten`,
    );
  } catch (err) {
    failed += 1;
    ctx.log(`FAILED   evidence request words: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const { table, what, owner } of SWEPT) {
    const r = result[table];
    if (typeof r === 'number') {
      total += r;
      ctx.log(`${String(r).padStart(7)}  ${what} (${table})`);
    } else if (r === 'absent') {
      ctx.log(`      -  ${what}: table ${table} does not exist yet (workstream ${owner})`);
    } else if (r) {
      failed += 1;
      ctx.log(`FAILED   ${what} (${table}): ${r.error}`);
    }
  }
  const alsoForgotten = forgotten
    ? ` ${String(forgotten)} evidence request(s) a year old had their words forgotten.`
    : '';
  return failed
    ? {
        ok: false,
        summary: `${String(failed)} table(s) could not be swept; ${String(total)} row(s) deleted from the rest.${alsoForgotten}`,
      }
    : {
        ok: true,
        summary:
          (total ? `${String(total)} expired row(s) deleted.` : 'Nothing had expired.') +
          alsoForgotten,
      };
}
