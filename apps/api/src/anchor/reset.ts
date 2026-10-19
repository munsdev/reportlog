/**
 * PUBLISHING THAT PUBLISHED PROOFS NO LONGER RECONCILE.
 *
 * An import with --new-chain builds chains the log never timestamped: every
 * anchor already published names a head that no longer exists. From outside
 * that is exactly what tampering looks like, and "it was fine, we rebuilt it"
 * said afterwards is worth nothing. So the fact is published beside the
 * anchors, as `resets/<date>.json`: which anchors stop reconciling, the old
 * heads and the new, how many reports were carried, and why.
 *
 * NOTHING IN THE LOG IS CHANGED TO MATCH. The old anchors stay exactly where
 * they are. A log tidied to agree with the present is not a log.
 *
 * Run straight after the import, before the new archive takes a report.
 */
import type { ChainHead } from '@reportlog/seal';
import { currentHeads } from '../chain/heads.ts';
import type { Database } from '../db/database.ts';
import type { Archive } from './archive.ts';
import { prettyFile } from './records.ts';
import { TransparencyLog } from './translog.ts';
import type { LogSettings } from './translog.ts';

export interface ResetRecord {
  reset_format: number;
  date: string;
  kind: 'chain_reset';
  reason: string;
  previous_chains: ChainHead[];
  new_chains: ChainHead[];
  reports_carried: number;
  /** Every published anchor whose heads no longer exist, named one by one: this list IS the disclosure. */
  anchors_no_longer_reconciling: {
    date: string;
    root_chain_hash: string;
    public_log_ref: string | null;
  }[];
}

export async function resetRecord(
  db: Database,
  archive: Archive,
  { reason, date }: { reason: string; date: string },
): Promise<ResetRecord> {
  if (reason.trim().length < 20) {
    throw new Error('A reset needs its reason in a sentence or two: it is published for good.');
  }
  return {
    reset_format: 1,
    date,
    kind: 'chain_reset',
    reason: reason.trim(),
    previous_chains: archive.previous_chain_list,
    new_chains: await currentHeads(db),
    reports_carried: archive.reports.length,
    // From the export file, not the database: the new database never had them.
    anchors_no_longer_reconciling: archive.previous_chain_anchors.map((a) => ({
      date: String(a.anchor.anchor_date),
      root_chain_hash: String(a.anchor.root_chain_hash),
      public_log_ref: (a.anchor.public_log_ref as string | null | undefined) ?? null,
    })),
  };
}

export async function publishReset(
  record: ResetRecord,
  settings: LogSettings,
): Promise<{ file: string; reached: string[]; failed: { label: string; why: string }[] }> {
  const log = new TransparencyLog(settings);
  await log.ready();
  await log.catchUp();
  const file = `resets/${record.date}.json`;
  if (!(await log.writeOnce(file, prettyFile(record)))) {
    throw new Error(`The log already holds ${file}. A published notice is never replaced.`);
  }
  await log.commit(
    [file],
    `Chain reset ${record.date}\n\n${String(record.anchors_no_longer_reconciling.length)} published anchor(s) no longer reconcile. ${record.reason}`,
  );
  return { file, ...(await log.pushAll()) };
}
