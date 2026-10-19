/**
 * THE DAILY ANCHOR.
 *
 * Once a day: every launched logbook's chain head → `headsDigest` → an
 * RFC 3161 timestamp from an outside authority (DFN's, in Germany) →
 * `chain_anchors` and `chain_anchor_heads` → the public transparency log,
 * with a snapshot of every published report and the lists' counts beside it.
 *
 * ONCE LISTED, ALWAYS LISTED, AND NEVER SHORTER. Before anything is
 * timestamped, today's list is compared with the last published one, twice:
 * as this database recorded it, and as the log itself holds it. A logbook
 * that has gone, or a chain holding fewer reports than it did, is what
 * deleting reports looks like, and nothing in the software can do either.
 * Publishing a list that agreed with the damage would be the log lying for
 * it, so the run REFUSES, publishes nothing, and keeps refusing every day
 * until somebody has looked. Do not weaken this: it is the only thing that
 * notices a whole logbook disappearing.
 *
 * Reading the log as well as the database is deliberate: a database restored
 * from an old backup, or replaced, has forgotten what it published, and the
 * log has not.
 *
 * ONE ANCHOR A DAY. A second run on the same day timestamps nothing new: it
 * writes whichever of the day's files are missing and pushes again, so a day
 * whose commit landed and whose push did not is retried, never skipped.
 */
import { contradictions, headsDigest, isClean } from '@reportlog/seal';
import type { ChainHead, Contradictions } from '@reportlog/seal';
import { sql } from 'kysely';
import { currentHeads, lastPublishedHeads } from '../chain/heads.ts';
import type { Database } from '../db/database.ts';
import { snapshotDocument } from '../lists/aggregates.ts';
import {
  anchorRecord,
  buildSnapshot,
  countsRecord,
  prettyFile,
  serializeSnapshot,
} from './records.ts';
import { TransparencyLog } from './translog.ts';
import type { LogSettings } from './translog.ts';
import { requestTimestamp } from './tsp.ts';

export type Outcome = 'published' | 'partly_published' | 'not_published' | 'refused' | 'failed';

export interface AnchorResult {
  outcome: Outcome;
  date: string;
  /** One line, for the journal and the run record. */
  detail: string;
  /** 0 fine, 1 broken, 2 refused: a refusal is not a bug to retry. */
  exitCode: 0 | 1 | 2;
}

export interface AnchorDeps {
  db: Database;
  tsaUrl: string;
  log: LogSettings;
  now?: () => Date;
  /** A line for the journal. Never an address or a token. */
  say?: (line: string) => void;
  fetchImpl?: typeof fetch;
}

const EXIT: Record<Outcome, 0 | 1 | 2> = {
  published: 0,
  partly_published: 0,
  not_published: 1,
  refused: 2,
  failed: 1,
};

/** The refusal, in sentences an operator reads at 4 in the morning. */
export function describeContradictions(c: Contradictions, where: string): string[] {
  return [
    ...c.dropped.map((s) => `Logbook "${s}" was in the last anchor ${where} and is gone.`),
    ...c.shrunk.map(
      (s) =>
        `Logbook "${s.logbook}" had ${String(s.was)} report(s) in the last anchor ${where} and now has ${String(s.now)}.`,
    ),
  ];
}

interface Anchored {
  kind: 'anchored';
  fresh: boolean;
  heads: ChainHead[];
  root: string;
  token: Buffer;
}

export async function runAnchor(deps: AnchorDeps): Promise<AnchorResult> {
  const now = deps.now ?? (() => new Date());
  const say = deps.say ?? ((line: string) => process.stdout.write(`${line}\n`));
  const started = now();
  const date = started.toISOString().slice(0, 10);
  const { db } = deps;

  const finish = async (outcome: Outcome, detail: string): Promise<AnchorResult> => {
    // The run is recorded even when the anchor failed: that row is how the
    // doctor knows a timer that fires is not a timer that works.
    try {
      await db
        .insertInto('anchor_runs')
        .values({ started_at: started, anchor_date: date, outcome, detail: detail.slice(0, 2000) })
        .execute();
    } catch (e) {
      say(`(could not record the run: ${(e as Error).message})`);
    }
    return { outcome, date, detail, exitCode: EXIT[outcome] };
  };

  const log = new TransparencyLog(deps.log);
  let anchored: Anchored | { kind: 'refused'; lines: string[] };
  try {
    await log.ready();
    const behind = await log.catchUp();
    if (behind) say(behind);

    // The last list the log itself published, from the log.
    const lastInLog = await log.newest('anchors', date);
    const logHeads = lastInLog
      ? ((JSON.parse(await log.read(lastInLog)) as { chains?: ChainHead[] }).chains ?? [])
      : [];
    const todayInLog = log.has(`anchors/${date}.json`);

    anchored = await db.transaction().execute(async (trx) => {
      // One run at a time. A second one waits, then finds today done.
      await sql`SELECT pg_advisory_xact_lock(hashtext('reportlog_anchor'))`.execute(trx);
      const existing = await trx
        .selectFrom('chain_anchors')
        .select(['id', 'root_chain_hash', 'rfc3161_token'])
        .where('anchor_date', '=', date)
        .executeTakeFirst();
      if (existing) {
        const heads = await trx
          .selectFrom('chain_anchor_heads')
          .select(['logbook_slug', 'head_chain_hash', 'report_count'])
          .where('anchor_id', '=', existing.id)
          .orderBy('logbook_slug')
          .execute();
        return {
          kind: 'anchored' as const,
          fresh: false,
          heads: heads.map((h) => ({
            logbook: h.logbook_slug,
            head: h.head_chain_hash,
            reports: h.report_count,
          })),
          root: existing.root_chain_hash,
          token: Buffer.from(existing.rfc3161_token ?? []),
        };
      }
      if (todayInLog) {
        return {
          kind: 'refused' as const,
          lines: [
            `The log already holds an anchor for ${date} that this database has no record of writing.`,
            'Either this database was restored or replaced, or somebody else is publishing to this log.',
          ],
        };
      }

      const heads = await currentHeads(trx);
      const fromDb = contradictions(await lastPublishedHeads(trx), heads);
      const fromLog = contradictions(logHeads, heads);
      if (!isClean(fromDb) || !isClean(fromLog)) {
        return {
          kind: 'refused' as const,
          lines: [
            ...describeContradictions(fromDb, 'this database recorded'),
            ...describeContradictions(fromLog, `in the log (${lastInLog ?? ''})`),
          ],
        };
      }

      const root = headsDigest(date, heads);
      const ts = await requestTimestamp(
        deps.tsaUrl,
        root,
        deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {},
      );
      const anchor = await trx
        .insertInto('chain_anchors')
        .values({
          anchor_date: date,
          root_chain_hash: root,
          rfc3161_token: ts.token,
          public_log_ref: `anchors/${date}.json`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (heads.length) {
        await trx
          .insertInto('chain_anchor_heads')
          .values(
            heads.map((h) => ({
              anchor_id: anchor.id,
              logbook_slug: h.logbook,
              head_chain_hash: h.head,
              report_count: h.reports,
            })),
          )
          .execute();
      }
      return { kind: 'anchored' as const, fresh: true, heads, root, token: ts.token };
    });
  } catch (e) {
    const why = (e as Error).message.split('\n')[0] ?? 'unknown';
    say(`!! Nothing was anchored for ${date}: ${why}`);
    return finish('failed', `Nothing was anchored for ${date}: ${why}`);
  }

  if (anchored.kind === 'refused') {
    for (const l of anchored.lines) say(`!! ${l}`);
    say(
      '!! This is what deleting reports looks like. Nothing was anchored or published. Investigate.',
    );
    return finish('refused', `${anchored.lines.join(' ')} Nothing was anchored.`);
  }

  // ── the day's files ────────────────────────────────────────────────────
  // Each written only if it is not there yet: what was published stays.
  const written: string[] = [];
  const notes: string[] = [];
  let snapshotCount: number | null = null;
  try {
    const anchorFile = `anchors/${date}.json`;
    if (
      await log.writeOnce(
        anchorFile,
        prettyFile(anchorRecord(date, anchored.heads, anchored.root, anchored.token, deps.tsaUrl)),
      )
    ) {
      written.push(anchorFile);
    }

    // The anchor proves the archive was not altered; it cannot show what the
    // archive said. The snapshot beside it, in the same commit, is that.
    const snapshotFile = `snapshots/${date}.json`;
    if (!log.has(snapshotFile)) {
      const snapshot = await buildSnapshot(db, date, anchored.heads);
      await log.writeOnce(snapshotFile, serializeSnapshot(snapshot));
      written.push(snapshotFile);
      snapshotCount = snapshot.report_count;
      if (snapshot.reports_not_matching_their_own_hash) {
        // Published anyway, with the disagreement in the file. This is the
        // alarm the whole system exists to raise.
        const n = String(snapshot.reports_not_matching_their_own_hash);
        say(
          `!! ${n} published report(s) do not match their own recorded hash. This is what tampering looks like.`,
        );
        notes.push(`${n} published report(s) do not match their own hash.`);
      }
    }
  } catch (e) {
    const why = (e as Error).message.split('\n')[0] ?? 'unknown';
    say(`!! ${date} is anchored in the database, and its files could not be written: ${why}`);
    return finish('not_published', `Anchored, and the day's files could not be written: ${why}`);
  }

  // THE COUNTS, after the reports and never able to stop them: a list's
  // counts failing to timestamp is a problem for tomorrow's file, and a day's
  // reports going unpublished because of it would be the wrong way round.
  const countsFile = `counts/${date}.json`;
  if (!log.has(countsFile)) {
    try {
      const doc = await snapshotDocument(db);
      if (doc.lists.length) {
        const rec = countsRecord(date, doc);
        const ts = await requestTimestamp(
          deps.tsaUrl,
          rec.digest,
          deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {},
        );
        await log.writeOnce(
          countsFile,
          prettyFile({
            ...rec,
            rfc3161_token_base64: ts.token.toString('base64'),
            tsa: deps.tsaUrl,
          }),
        );
        written.push(countsFile);
      }
    } catch (e) {
      const why = (e as Error).message.split('\n')[0] ?? 'unknown';
      say(`!! The list counts were not published today: ${why} The reports anchor is unaffected.`);
      notes.push(`Counts not published: ${why}`);
    }
  }

  // ── commit and push ────────────────────────────────────────────────────
  let reached: string[];
  let failed: { label: string; why: string }[];
  try {
    await log.commit(
      written,
      [
        `Anchor ${date}: ${anchored.root}`,
        '',
        ...(snapshotCount === null
          ? []
          : [`Snapshot: ${String(snapshotCount)} published report(s).`]),
        ...(written.includes(countsFile)
          ? ['Counts: the published lists, with their own timestamp.']
          : []),
      ].join('\n'),
    );
    ({ reached, failed } = await log.pushAll());
  } catch (e) {
    const why = (e as Error).message;
    say(`!! ${date} is anchored, and the log could not be committed: ${why}`);
    return finish('not_published', `Anchored, and the log could not be committed: ${why}`);
  }
  for (const r of reached) say(`  pushed to ${r}`);
  for (const f of failed) say(`  !! push to ${f.label} failed: ${f.why}`);

  const head = `${anchored.fresh ? 'Anchored' : 'Already anchored'} ${date} (${anchored.root}, ${String(anchored.heads.length)} logbook(s)).`;
  const extra = notes.length ? ` ${notes.join(' ')}` : '';
  const total = log.list.length;
  if (!total) {
    const detail = `${head} TRANSPARENCY_LOG_REMOTES is not set, so the day exists only on this server.${extra}`;
    say(`!! ${detail}`);
    return finish('not_published', detail);
  }
  if (!reached.length) {
    const detail = `${head} It reached none of the ${String(total)} remote(s): ${failed.map((f) => f.label).join(', ')}. The day exists only on this server.${extra}`;
    say(`!! ${detail}`);
    return finish('not_published', detail);
  }
  if (failed.length) {
    const detail = `${head} Reached ${String(reached.length)} of ${String(total)} remote(s); not ${failed.map((f) => f.label).join(', ')}. They catch up on the next run.${extra}`;
    say(`!! ${detail}`);
    return finish('partly_published', detail);
  }
  const detail = `${head} Reached all ${String(total)} remote(s).${extra}`;
  say(detail);
  return finish('published', detail);
}
