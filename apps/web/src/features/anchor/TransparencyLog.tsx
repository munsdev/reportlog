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
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { Chip } from '../../mockup/Chip.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import { StepUpDownload } from '../identity/StepUp.tsx';

const anchorQuery = queryOptions({
  queryKey: ['anchor', 'status'],
  queryFn: ({ signal }) => call(getAnchorStatus, { signal }),
});

const logbooksQuery = queryOptions({
  queryKey: ['anchor', 'logbooks'],
  queryFn: ({ signal }) => call(listLogbooks, { signal }),
});

const HEALTH = {
  ok: { warn: false, title: 'The anchor is running' },
  warn: { warn: true, title: 'The anchor needs a look' },
  fail: { warn: true, title: 'The anchor is not working' },
} as const;

const OUTCOME: Record<string, string> = {
  published: 'Published to every mirror',
  partly_published: 'Published to some mirrors, not all',
  not_published: 'Reached no mirror',
  refused: 'Refused: today’s list contradicts the last one published',
  failed: 'Failed',
};

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
      lede="The daily values that let anyone check nothing was quietly changed."
      width="prose"
    >
      {query.isPending ? <p role="status">Reading the anchor…</p> : null}
      <ErrorLine error={query.error} />
      {query.data ? (
        <>
          <Panel kind="deep" title={HEALTH[query.data.health.status].title}>
            <p>{lastClaim(query.data.anchors)}</p>
            <p>{query.data.health.detail}</p>
          </Panel>
          <Panel title="The last anchors">
            {query.data.anchors.length === 0 ? (
              <p>Nothing has been anchored yet.</p>
            ) : (
              <Tbl
                cols={['Date', 'Chain heads', 'Digest', 'In the log']}
                rows={query.data.anchors.map((a) => ({
                  key: a.date,
                  cells: [
                    a.date,
                    String(a.logbooks),
                    <span className="mono">{a.root_chain_hash}</span>,
                    a.public_log_ref ? (
                      <>
                        <Chip kind="ok">Published</Chip>{' '}
                        <span className="mono">{a.public_log_ref}</span>
                      </>
                    ) : (
                      <Chip kind="off">Not in the log yet</Chip>
                    ),
                  ],
                }))}
              />
            )}
          </Panel>
          <Panel title="What happened at each run">
            <p className="m">
              Every run is recorded, including the ones that published nothing: a timer that fires
              is not a timer that works.
            </p>
            {query.data.runs.length === 0 ? (
              <p>The anchor has not run yet.</p>
            ) : (
              <Tbl
                cols={['Finished', 'For', 'What happened']}
                rows={query.data.runs.map((r, i) => ({
                  key: `${r.finished_at}-${String(i)}`,
                  cells: [
                    day(r.finished_at),
                    r.anchor_date ?? '',
                    `${OUTCOME[r.outcome] ?? r.outcome}${r.detail ? `. ${r.detail}` : ''}`,
                  ],
                }))}
              />
            )}
          </Panel>
        </>
      ) : null}
      <ChainFiles />
      <Panel kind="quiet" title="This log is never rewritten">
        <p>
          Not even to correct it. A fact that invalidates published proofs is published beside them,
          by a command on the server, not by a button here.
        </p>
      </Panel>
      <Panel title="Where it is published, and how to change that">
        <p>
          The mirrors, the timestamp authority and the key the log is pushed with are the server’s
          configuration (<span className="mono">TRANSPARENCY_LOG_REMOTES</span>,{' '}
          <span className="mono">TSA_URL</span>,{' '}
          <span className="mono">TRANSPARENCY_LOG_SSH_KEY</span>), not settings on this page, so a
          copy of the database can never publish in this site’s name. Several mirrors under
          different operators is the point: a record one company holds is a record one company can
          be made to remove.
        </p>
      </Panel>
    </StaffPage>
  );
}

/** Every version of every report, published or not: what an administrator checks the anchors against. */
function ChainFiles() {
  const query = useQuery(logbooksQuery);
  const launched = (query.data?.logbooks ?? []).filter((l) => l.launched_at !== null);
  return (
    <Panel title="Complete chain files">
      <p className="m">
        Every version of every report in a logbook, published or not, in chain order. It holds
        reports nobody has approved, so keep it as carefully as the database. The board offers the
        published file to everybody.
      </p>
      <ErrorLine error={query.error} />
      {query.data && launched.length === 0 ? <p>No logbook has been launched yet.</p> : null}
      {launched.length > 0 ? (
        <Tbl
          cols={['Logbook', '']}
          widths="1fr auto"
          rows={launched.map((l) => ({
            key: l.slug,
            cells: [
              l.title,
              // A step-up first (plan E, E3): the server refuses the file without one.
              <StepUpDownload
                className="btn sm flat"
                href={getCompleteChainFile.path.replace(':slug', encodeURIComponent(l.slug))}
              >
                Download the chain
                <span className="sr-only"> for {l.title}</span>
              </StepUpDownload>,
            ],
          }))}
        />
      ) : null}
    </Panel>
  );
}
