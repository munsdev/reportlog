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
 */
import { getAnchorStatus, getCompleteChainFile, listLogbooks } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Page } from '../../components/ui/page.tsx';
import { call } from '../../lib/api.ts';

const anchorQuery = queryOptions({
  queryKey: ['anchor', 'status'],
  queryFn: ({ signal }) => call(getAnchorStatus, { signal }),
});

const logbooksQuery = queryOptions({
  queryKey: ['anchor', 'logbooks'],
  queryFn: ({ signal }) => call(listLogbooks, { signal }),
});

const HEALTH = {
  ok: { tone: 'confirmed', title: 'The anchor is running' },
  warn: { tone: 'note', title: 'The anchor needs a look' },
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

const day = (iso: string) => new Date(iso).toLocaleString();

export function TransparencyLogPage() {
  const query = useQuery(anchorQuery);
  return (
    <Page
      title="Transparency log"
      lede="Once a day the newest report of every logbook is timestamped by an outside authority and published to a public repository. Anybody can then check that nothing filed before that day was changed."
      width="prose"
    >
      {query.isPending ? <p role="status">Reading the anchor…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        <>
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
              <ul className="flex flex-col gap-2 text-sm" aria-label="Anchors">
                {query.data.anchors.map((a) => (
                  <li key={a.date}>
                    <span className="font-semibold">{a.date}</span>: {String(a.logbooks)} logbook
                    {a.logbooks === 1 ? '' : 's'}, digest{' '}
                    <span className="font-mono break-all">{a.root_chain_hash}</span>
                    {a.public_log_ref ? (
                      <>
                        {' '}
                        · in the log as <span className="font-mono">{a.public_log_ref}</span>
                      </>
                    ) : (
                      ' · not in the log yet'
                    )}
                  </li>
                ))}
              </ul>
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
    </Page>
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
            <a
              className="underline"
              href={getCompleteChainFile.path.replace(':slug', encodeURIComponent(l.slug))}
              download
            >
              {l.title}
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}
