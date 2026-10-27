/**
 * Backups and archive exports, for the owner (decision 10).
 *
 * The page starts a backup or an export on the server and offers the
 * finished file. Nothing here goes through anybody else: the link is this
 * site's own address, and the file comes from this server's disk. Each
 * download is written to the audit trail ("Who granted what") before the
 * file leaves, which the page says beside every link.
 *
 * NOTHING HERE RESTORES. Restoring rebuilds the database this site answers
 * from, which it cannot do to itself; the page gives the command instead.
 *
 * The owner only, on the server (the scope's guard) and here (StaffOnly in
 * the route file). An administrator who types the address sees a refusal.
 */
import { copyDownloadPath, getCopies, startCopy } from '@reportlog/contracts';
import type { CopiesState, CopyFile } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { Btn } from '@/mockup/Btn.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import { StepUpDownload } from '../identity/StepUp.tsx';

const copiesQuery = queryOptions({
  queryKey: ['copies'],
  queryFn: ({ signal }) => call(getCopies, { signal }),
  // Asked again every few seconds while something is being made, so the
  // finished file appears without a reload. Otherwise not at all.
  refetchInterval: (q) => (q.state.data?.running ? 2000 : false),
});

/** The restore command, to copy and type on the server. Nothing on this page runs it. */
function RestoreCommand({ command }: { command: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <>
      <div className="code">{command}</div>
      <Btn sm flat
        look="ghost"
        onClick={() => {
          navigator.clipboard.writeText(command).then(
            () => {
              setSaid('Copied.');
            },
            () => {
              setSaid('This browser would not copy it. Select the command instead.');
            },
          );
        }}
      >
        Copy the command
      </Btn>
      <span role="status" className="m">
        {said}
      </span>
    </>
  );
}

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const when = (iso: string) => new Date(iso).toUTCString();

function Files({
  kind,
  files,
  none,
}: {
  kind: 'backup' | 'export';
  files: CopyFile[];
  none: string;
}) {
  if (!files.length) return <p>{none}</p>;
  return (
    <Tbl
      cols={['File', 'Size', '']}
      widths="1.5fr 1fr auto"
      rows={files.map((f) => ({
        key: f.name,
        cells: [
          <>
            {f.name} <span className="m">{when(f.made_at)}</span>
          </>,
          size(f.bytes),
          // A step-up first (plan E, E3): the server refuses the file without one.
          <StepUpDownload className="btn sm flat" href={copyDownloadPath(kind, f.name)}>
            Download <span className="sr-only">{f.name}</span>
          </StepUpDownload>,
        ],
      }))}
    />
  );
}

function Running({ state }: { state: CopiesState }) {
  if (state.running) {
    return (
      <p role="status">
        {state.running.kind === 'backup' ? 'Taking a backup…' : 'Making an export…'} This page shows
        the file when it is ready.
      </p>
    );
  }
  if (!state.last) return null;
  const what = state.last.kind === 'backup' ? 'backup' : 'export';
  return (
    <Note warn={!state.last.ok}>
      <b>{state.last.ok ? `The ${what} is ready` : `The ${what} did not finish`}</b>{' '}
      {state.last.summary}
    </Note>
  );
}

export function BackupsPage() {
  const qc = useQueryClient();
  const query = useQuery(copiesQuery);
  const go = useMutation({
    mutationFn: (kind: 'backup' | 'export') => call(startCopy, { body: { kind } }),
    onSuccess: (d) => {
      qc.setQueryData(copiesQuery.queryKey, d);
    },
  });
  return (
    <StaffPage
      title="Backups and exports"
      width="prose"
      lede="Copies of everything, for the owner only."
    >
      {query.isPending ? <p role="status">Loading…</p> : null}
      <ErrorLine error={query.error} />
      {query.data ? (
        <>
          {query.data.unavailable ? <Note warn>{query.data.unavailable}</Note> : null}
          <Note>
            <b>Every download is recorded.</b> Each file holds every report, every account, and
            people’s contact details. Downloading one is written to “Who granted what”, where the
            people who grant access can read it, and it cannot be removed from there. Keep a
            downloaded copy as carefully as the server.
          </Note>
          <Running state={query.data} />
          <ErrorLine error={go.error} />
          <Panel title="Backups">
            <p className="m">
              A backup is the database exactly as it is, for putting this site back after something
              goes wrong. The server also takes one every night by itself.{' '}
              {query.data.backup_health.state === 'none'
                ? 'There is no backup on this server yet.'
                : query.data.backup_health.state === 'stale'
                  ? `The newest backup is older than ${String(query.data.backup_health.max_age_hours)} hours. Take one now, and ask whoever runs the server why the nightly one has stopped.`
                  : 'The newest backup is recent.'}
              {query.data.offsite
                ? ` The last encrypted copy sent off the server went on ${when(query.data.offsite.at)}.`
                : ''}
            </p>
            {query.data.failure ? (
              <Note warn>
                <b>The last backup failed</b> At {query.data.failure.step}: {query.data.failure.why}
              </Note>
            ) : null}
            <Btn sm flat
              look="ink"
              disabled={
                Boolean(query.data.running) || Boolean(query.data.unavailable) || go.isPending
              }
              onClick={() => {
                go.mutate('backup');
              }}
            >
              Take a backup now
            </Btn>
            <Files kind="backup" files={query.data.backups} none="No backups yet." />
            {query.data.restore_command ? (
              <>
                <p className="muted">
                  Nothing here restores. Restoring replaces everything in the database, so it is
                  done on the server itself, never from this page. Whoever runs the server types
                  this, with the file’s name in place of &lt;file&gt;:
                </p>
                <RestoreCommand command={query.data.restore_command} />
              </>
            ) : null}
          </Panel>
          <Panel title="Archive exports">
            <Btn sm flat
              disabled={
                Boolean(query.data.running) || Boolean(query.data.unavailable) || go.isPending
              }
              onClick={() => {
                go.mutate('export');
              }}
            >
              Make an export
            </Btn>
            <p className="muted">
              An export is the archive in a form another server can take in: every report is
              replayed there and checked against the fingerprint it has here. Use it to move the
              archive. Lists are not in it, because their entries are erased on a timer. The newest
              three are kept.
            </p>
            <Files kind="export" files={query.data.exports} none="No exports yet." />
          </Panel>
        </>
      ) : null}
    </StaffPage>
  );
}
