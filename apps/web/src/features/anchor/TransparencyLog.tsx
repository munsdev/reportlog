/**
 * The daily anchor and the transparency log, for administrators.
 *
 * READ ONLY, ON PURPOSE. Legacy's screen (admin-translog.js) was a settings
 * panel: the log's mirrors, its branch, the timestamp authority and a deploy
 * key, stored in the database. Here those are the server's configuration
 * (apps/api/src/config.ts), so a copy of the database can never publish to
 * the log. What is left is what that screen existed to answer: is the
 * archive's claim that it has not been quietly altered actually being made,
 * every day, somewhere this server does not control?
 *
 * Nothing here can rewrite the log. The log is never rewritten, not even to
 * correct it; something that invalidates published proofs is published beside
 * them (`anchor reset-marker`, a command, not a button).
 *
 * The page answers its one question first, in a sentence on a deep panel
 * (settings-and-admin.md §13), then shows the anchors as a table.
 */
import { getAnchorStatus, getCompleteChainFile, listLogbooks } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Card } from '../../components/ui/card.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { StepUpDownload } from '../identity/StepUp.tsx';
import { ScrollX } from '@/components/ui/scroll-x.tsx';

const anchorQuery = queryOptions({
  queryKey: ['anchor', 'status'],
  queryFn: ({ signal }) => call(getAnchorStatus, { signal }),
});

const logbooksQuery = queryOptions({
  queryKey: ['anchor', 'logbooks'],
  queryFn: ({ signal }) => call(listLogbooks, { signal }),
});

const HEALTH = {
  ok: { tone: 'done', title: 'The anchor is running' },
  warn: { tone: 'warning', title: 'The anchor needs a look' },
  fail: { tone: 'serious', title: 'The anchor is not working' },
} as const;

const OUTCOME: Record<string, string> = {
  published: 'Published to every mirror',
  partly_published: 'Published to some mirrors, not all',
  not_published: 'Reached no mirror',
  refused: 'Refused: today’s list contradicts the last one published',
  failed: 'Failed',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <Card heading={title}>{children}</Card>;
}

interface Anchor {
  date: string;
  public_log_ref: string | null;
}

/** The page's one question, answered in a sentence. */
export function lastClaim(anchors: readonly Anchor[]): string {
  const published = anchors.find((a) => a.public_log_ref !== null);
  if (!published) return 'The archive’s daily claim has not reached the transparency log yet.';
  return `The archive’s daily claim was last published for ${published.date}, to the transparency log this server does not control.`;
}

const day = (iso: string) => new Date(iso).toLocaleString();

export function TransparencyLogPage() {
  const query = useQuery(anchorQuery);
  return (
    <StaffPage
      title="Transparency log"
      lede="Once a day the newest report of every logbook is timestamped by an outside authority and published to a public repository. Anybody can then check that nothing filed before that day was changed."
      width="prose"
    >
      {query.isPending ? <p role="status">Reading the anchor…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        <>
          <Card variant="deep">
            <p className="text-lede">{lastClaim(query.data.anchors)}</p>
          </Card>
          <Alert
            tone={HEALTH[query.data.health.status].tone}
            title={HEALTH[query.data.health.status].title}
          >
            {query.data.health.detail}
          </Alert>
          <Section title="The last anchors">
            {query.data.anchors.length === 0 ? (
              <p>Nothing has been anchored yet.</p>
            ) : (
              <ScrollX label="Anchors, newest first">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Anchors, newest first</caption>
                  <thead>
                    <tr className="border-b border-ink-alt">
                      <th scope="col" className="py-2 pr-4">
                        Date
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Chain heads
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Digest
                      </th>
                      <th scope="col" className="py-2">
                        In the log
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.anchors.map((a) => (
                      <tr key={a.date} className="border-b border-line align-top last:border-0">
                        <td className="py-2 pr-4 font-mono whitespace-nowrap">{a.date}</td>
                        <td className="py-2 pr-4 font-mono">{String(a.logbooks)}</td>
                        <td className="py-2 pr-4 font-mono break-all">{a.root_chain_hash}</td>
                        <td className="py-2 font-mono break-all">
                          {a.public_log_ref ?? (
                            <span className="font-sans text-ink-alt">Not in the log yet</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollX>
            )}
          </Section>
          <Section title="What happened at each run">
            <p className="text-sm text-ink-alt">
              Every run is recorded, including the ones that published nothing: a timer that fires
              is not a timer that works.
            </p>
            {query.data.runs.length === 0 ? (
              <p>The anchor has not run yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm" aria-label="Runs">
                {query.data.runs.map((r, i) => (
                  <li key={`${r.finished_at}-${String(i)}`}>
                    <span className="font-semibold">{day(r.finished_at)}</span>
                    {r.anchor_date ? ` (for ${r.anchor_date})` : ''}:{' '}
                    {OUTCOME[r.outcome] ?? r.outcome}
                    {r.detail ? `. ${r.detail}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      ) : null}
      <ChainFiles />
      <Card variant="quiet">
        <p>
          This log is never rewritten, not even to correct it. A fact that invalidates published
          proofs is published beside them, by a command on the server, not by a button here.
        </p>
      </Card>
      <Section title="Where it is published, and how to change that">
        <p className="text-sm">
          The mirrors, the timestamp authority and the key the log is pushed with are the server’s
          configuration (<span className="font-mono">TRANSPARENCY_LOG_REMOTES</span>,{' '}
          <span className="font-mono">TSA_URL</span>,{' '}
          <span className="font-mono">TRANSPARENCY_LOG_SSH_KEY</span>), not settings on this page,
          so a copy of the database can never publish in this site’s name. Several mirrors under
          different operators is the point: a record one company holds is a record one company can
          be made to remove.
        </p>
      </Section>
    </StaffPage>
  );
}

/** Every version of every report, published or not: what an administrator checks the anchors against. */
function ChainFiles() {
  const query = useQuery(logbooksQuery);
  const launched = (query.data?.logbooks ?? []).filter((l) => l.launched_at !== null);
  return (
    <Section title="Complete chain files">
      <p className="text-sm text-ink-alt">
        Every version of every report in a logbook, published or not, in chain order. It holds
        reports nobody has approved, so keep it as carefully as the database. The board offers the
        published file to everybody.
      </p>
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data && launched.length === 0 ? <p>No logbook has been launched yet.</p> : null}
      <ul className="flex flex-col gap-1 text-sm">
        {launched.map((l) => (
          <li key={l.slug}>
            {/* A step-up first (plan E, E3): the server refuses the file without one. */}
            <StepUpDownload
              className="underline"
              href={getCompleteChainFile.path.replace(':slug', encodeURIComponent(l.slug))}
            >
              {l.title}
            </StepUpDownload>
          </li>
        ))}
      </ul>
    </Section>
  );
}
