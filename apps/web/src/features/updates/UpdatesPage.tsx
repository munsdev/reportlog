/**
 * Updates: is there a newer version, what is in it, and a button that
 * installs it. Nobody needs a shell: the button asks the server, and a root
 * unit on the server carries it out (apps/api/src/site/updateRoutes.ts).
 *
 * While a request runs the page asks again every few seconds. The API
 * restarts part-way through an update, so a failed read then is expected
 * and the page simply keeps asking.
 */
import { getUpdates, requestUpdate } from '@reportlog/contracts';
import type { UpdatesView } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '@/lib/api.ts';

const busy = (d: UpdatesView | undefined) => d?.waiting === true || d?.last?.state === 'running';

const updatesQuery = queryOptions({
  queryKey: ['admin', 'updates'],
  queryFn: ({ signal }) => call(getUpdates, { signal }),
  refetchInterval: (q) => (busy(q.state.data) || q.state.status === 'error' ? 3000 : false),
  retry: true,
});

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

const LAST_WORDS: Record<string, string> = {
  running: 'Under way',
  done: 'Finished',
  failed: 'Did not finish. The site is still running the version it had before.',
  refused: 'Not started',
};

export function UpdatesPage() {
  const qc = useQueryClient();
  const q = useQuery(updatesQuery);
  const ask = useMutation({
    mutationFn: (body: { action: 'check' } | { action: 'apply'; sha: string }) =>
      call(requestUpdate, { body }),
    onSuccess: (d) => {
      qc.setQueryData(updatesQuery.queryKey, d);
    },
  });
  const d = q.data;
  const offer = d?.tip && d.behind !== 0 && d.tip !== d.current ? d.tip : null;
  return (
    <StaffPage
      title="Updates"
      width="prose"
      lede="Whether a newer version of ReportLog is available, and a button to install it. The server does the work itself; nobody needs to log in to it."
    >
      {q.isPending ? <p role="status">Loading…</p> : null}
      {q.isError && !d ? <Alert tone="serious">{q.error.message}</Alert> : null}
      {d ? (
        <>
          <Card heading="This site">
            <p>
              Running {d.current_version ?? 'an unnumbered version'}
              {d.current ? ` (${d.current.slice(0, 12)})` : ''}, following{' '}
              <code>{d.ref || 'no branch set'}</code>.
            </p>
            <p className="text-sm text-muted">Last checked: {when(d.checked_at)}</p>
            {d.fetch_failed ? <Alert tone="serious">{d.fetch_failed}</Alert> : null}
            <div>
              <Button
                variant="secondary"
                disabled={busy(d) || ask.isPending}
                onClick={() => {
                  ask.mutate({ action: 'check' });
                }}
              >
                Check now
              </Button>
            </div>
          </Card>

          <Card heading={offer ? 'An update is available' : 'Up to date'}>
            {offer ? (
              <>
                <p>
                  {d.available_version ?? 'A newer version'}
                  {d.behind ? `, ${String(d.behind)} changes newer than this site` : ''}.
                </p>
                {d.releases.map((r) => (
                  <div key={r.version} className="flex flex-col gap-1">
                    <p className="font-semibold">
                      {r.version} <span className="text-muted">{r.date}</span>
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{r.notes}</p>
                  </div>
                ))}
                {!d.releases.length && d.commits.length ? (
                  <ul className="list-disc pl-5 text-sm">
                    {d.commits.slice(0, 20).map((c) => (
                      <li key={c}>{c.replace(/^\S+\s/, '')}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-sm text-muted">
                  Installing takes a few minutes. The site stays up on the current version until the
                  new one is ready, and goes back to it by itself if the new one does not start.
                </p>
                <div>
                  <Button
                    disabled={busy(d) || ask.isPending}
                    onClick={() => {
                      ask.mutate({ action: 'apply', sha: offer });
                    }}
                  >
                    Install the update
                  </Button>
                </div>
              </>
            ) : (
              <p>This site is running the newest version on its branch.</p>
            )}
          </Card>

          {ask.isError ? <Alert tone="serious">{ask.error.message}</Alert> : null}
          {d.waiting ? (
            <Alert tone="note">Asked. The server picks it up within a few seconds.</Alert>
          ) : null}
          {d.last ? (
            <Card heading={`Last ${d.last.action === 'apply' ? 'update' : 'check'}`}>
              <p role="status">
                {LAST_WORDS[d.last.state] ?? d.last.state} · {when(d.last.at)}
              </p>
              {d.last.log ? (
                <pre className="max-h-80 overflow-auto rounded-control bg-deep p-3 text-xs whitespace-pre-wrap text-on-deep">
                  {d.last.log}
                </pre>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </StaffPage>
  );
}
