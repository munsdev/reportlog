/**
 * Backups and archive exports, for the owner (decision 10).
 *
 * The page starts a backup or an export on the server and offers the
 * finished file. Nothing here goes through anybody else: the link is this
 * site's own address, and the file comes from this server's disk. Each
 * download is written to the audit trail ("Who changed what") before the
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
import type { ReactNode } from 'react';
import { useId } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Page } from '../../components/ui/page.tsx';
import { call } from '../../lib/api.ts';
import { StepUpDownload } from '../identity/StepUp.tsx';

const copiesQuery = queryOptions({
  queryKey: ['copies'],
  queryFn: ({ signal }) => call(getCopies, { signal }),
  // Asked again every few seconds while something is being made, so the
  // finished file appears without a reload. Otherwise not at all.
  refetchInterval: (q) => (q.state.data?.running ? 2000 : false),
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
    >
      <h2 id={id} className="font-display text-xl font-bold">
        {title}
      </h2>
      {children}
    </section>
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
    <ul className="flex flex-col gap-2">
      {files.map((f) => (
        <li key={f.name} className="flex flex-wrap items-baseline justify-between gap-2">
          <span>
            <span className="font-mono break-all">{f.name}</span>{' '}
            <span className="text-sm text-ink-alt">
              {size(f.bytes)}, {when(f.made_at)}
            </span>
          </span>
          {/* A step-up first (plan E, E3): the server refuses the file without one. */}
          <StepUpDownload className="underline" href={copyDownloadPath(kind, f.name)}>
            Download <span className="sr-only">{f.name}</span>
          </StepUpDownload>
        </li>
      ))}
    </ul>
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
  return (
    <Alert
      tone={state.last.ok ? 'done' : 'serious'}
      title={
        state.last.ok
          ? state.last.kind === 'backup'
            ? 'The backup is ready'
            : 'The export is ready'
          : state.last.kind === 'backup'
            ? 'The backup did not finish'
            : 'The export did not finish'
      }
    >
      {state.last.summary}
    </Alert>
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
    <Page
      title="Backups and exports"
      width="prose"
      lede="A copy of the whole archive, made on this server and downloaded straight from it. Only the owner can see this page."
    >
      {query.isPending ? <p role="status">Loading…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        <>
          {query.data.unavailable ? <Alert tone="serious">{query.data.unavailable}</Alert> : null}
          <Alert tone="note" title="Every download is recorded">
            Each file holds every report, every account, and people’s contact details. Downloading
            one is written to “Who changed what”, where the people who grant access can read it, and
            it cannot be removed from there. Keep a downloaded copy as carefully as the server.
          </Alert>
          <Running state={query.data} />
          {go.error ? <Alert tone="serious">{go.error.message}</Alert> : null}
          <Section title="Backups">
            <p>
              A backup is the database exactly as it is, for putting this site back after something
              goes wrong. The server also takes one every night by itself.
            </p>
            <p>
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
              <Alert tone="serious" title="The last backup failed">
                At {query.data.failure.step}: {query.data.failure.why}
              </Alert>
            ) : null}
            <Button
              className="self-start"
              disabled={
                Boolean(query.data.running) || Boolean(query.data.unavailable) || go.isPending
              }
              onClick={() => {
                go.mutate('backup');
              }}
            >
              Take a backup now
            </Button>
            <Files kind="backup" files={query.data.backups} none="No backups yet." />
            {query.data.restore_command ? (
              <details>
                <summary className="cursor-pointer">Putting a backup back</summary>
                <p className="mt-2">
                  Restoring replaces everything in the database, so it is done on the server itself,
                  never from this page. Whoever runs the server types this, with the file’s name in
                  place of &lt;file&gt;:
                </p>
                <pre className="mt-2 overflow-x-auto rounded-card bg-paper-alt p-3 text-sm">
                  {query.data.restore_command}
                </pre>
              </details>
            ) : null}
          </Section>
          <Section title="Archive exports">
            <p>
              An export is the archive in a form another server can take in: every report is
              replayed there and checked against the fingerprint it has here. Use it to move the
              archive. Lists are not in it, because their entries are erased on a timer.
            </p>
            <Button
              className="self-start"
              variant="secondary"
              disabled={
                Boolean(query.data.running) || Boolean(query.data.unavailable) || go.isPending
              }
              onClick={() => {
                go.mutate('export');
              }}
            >
              Make an export
            </Button>
            <Files
              kind="export"
              files={query.data.exports}
              none="No exports yet. The newest three are kept."
            />
          </Section>
        </>
      ) : null}
    </Page>
  );
}
