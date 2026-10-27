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
import { useState } from 'react';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '@/lib/api.ts';
import { Btn } from '@/mockup/Btn.tsx';
import { Dl } from '../../mockup/Dl.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Modal } from '../../mockup/Modal.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Panel } from '../../mockup/Panel.tsx';

const busy = (d: UpdatesView | undefined) => d?.waiting === true || d?.last?.state === 'running';

const updatesQuery = queryOptions({
  queryKey: ['admin', 'updates'],
  queryFn: ({ signal }) => call(getUpdates, { signal }),
  refetchInterval: (q) => (busy(q.state.data) || q.state.status === 'error' ? 3000 : false),
  retry: true,
});

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

const LAST_NAMES: Record<string, string> = {
  apply: 'update',
  apply_test: 'test build',
  rollback: 'roll back',
};

const LAST_WORDS: Record<string, string> = {
  running: 'Under way',
  done: 'Finished',
  failed: 'Did not finish. The site is still running the version it had before.',
  refused: 'Not started',
};

/** How many presses of the version line show the test build button. */
const TAPS_FOR_TEST_BUILD = 8;

export function UpdatesPage() {
  const qc = useQueryClient();
  const q = useQuery(updatesQuery);
  // Page state on purpose: a refresh hides the test build button again.
  const [taps, setTaps] = useState(0);
  const [confirming, setConfirming] = useState<'test' | 'rollback' | null>(null);
  const showTestBuild = taps >= TAPS_FOR_TEST_BUILD;
  const ask = useMutation({
    mutationFn: (
      body:
        | { action: 'check' }
        | { action: 'apply'; sha: string }
        | { action: 'apply_test' }
        | { action: 'rollback' },
    ) => call(requestUpdate, { body }),
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
      lede="The software this site runs, and new versions of it."
    >
      {q.isPending ? <p role="status">Loading…</p> : null}
      {q.isError && !d ? <ErrorLine error={q.error} /> : null}
      {d ? (
        <>
          <Panel title="This site">
            <Dl
              items={[
                [
                  'Running',
                  // A real button, drawn as plain text, so the eight presses are
                  // reachable without a mouse and the linter has nothing to object to.
                  <button
                    type="button"
                    style={{
                      appearance: 'none',
                      background: 'transparent',
                      border: 0,
                      padding: 0,
                      font: 'inherit',
                      color: 'inherit',
                      textAlign: 'left',
                      cursor: 'default',
                    }}
                    onClick={() => {
                      setTaps((n) => n + 1);
                    }}
                  >
                    {d.current_version ?? 'an unnumbered version'}
                    {d.current ? ` (${d.current.slice(0, 12)})` : ''}, following{' '}
                    <code>{d.ref || 'no branch set'}</code>
                  </button>,
                ],
                ['Last checked', when(d.checked_at)],
              ]}
            />
            {d.fetch_failed ? <p className="error">{d.fetch_failed}</p> : null}
            <Btn sm flat
              disabled={busy(d) || ask.isPending}
              onClick={() => {
                ask.mutate({ action: 'check' });
              }}
            >
              Check now
            </Btn>
          </Panel>

          <Panel title={offer ? 'An update is available' : 'Up to date'}>
            {offer ? (
              <>
                <p>
                  {d.available_version ?? 'A newer version'}
                  {d.behind ? `, ${String(d.behind)} changes newer than this site` : ''}.
                </p>
                {d.releases.map((r) => (
                  <div key={r.version}>
                    <p>
                      <b>{r.version}</b> <span className="m">{r.date}</span>
                    </p>
                    <p className="m" style={{ whiteSpace: 'pre-wrap' }}>
                      {r.notes}
                    </p>
                  </div>
                ))}
                {!d.releases.length && d.commits.length ? (
                  <ul>
                    {d.commits.slice(0, 20).map((c) => (
                      <li key={c}>{c.replace(/^\S+\s/, '')}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="m">
                  Installing takes a few minutes. The site stays up on the current version until the
                  new one is ready, and goes back to it by itself if the new one does not start.
                </p>
                <div className="acts">
                  <Btn sm flat
                    look="ink"
                    disabled={busy(d) || ask.isPending}
                    onClick={() => {
                      ask.mutate({ action: 'apply', sha: offer });
                    }}
                  >
                    Install the update
                  </Btn>
                  {showTestBuild ? (
                    <TestBuildButtons disabled={busy(d) || ask.isPending} onAsk={setConfirming} />
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <p>This site is running the newest version on its branch.</p>
                {showTestBuild ? (
                  <div className="acts">
                    <TestBuildButtons disabled={busy(d) || ask.isPending} onAsk={setConfirming} />
                  </div>
                ) : null}
              </>
            )}
          </Panel>
          <Modal
            open={confirming !== null}
            onClose={() => {
              setConfirming(null);
            }}
            title={
              confirming === 'rollback'
                ? 'Go back to the previous version?'
                : 'This is a TEST BUILD'
            }
            text={
              confirming === 'rollback'
                ? 'The site goes back to the version it ran before the last update. The database keeps what the newer version added, which the older one ignores. This can be done once: to move forward again, install an update.'
                : 'A test build is unfinished work. It may break things, and it may change the database in ways that the normal version cannot go back from. The Roll back button beside this one returns to the previous version. Only do this on a test server.'
            }
            buttons={
              <>
                <Btn sm flat
                  look="ghost"
                  onClick={() => {
                    setConfirming(null);
                  }}
                >
                  Cancel
                </Btn>
                <Btn sm flat
                  look="ink"
                  disabled={busy(d) || ask.isPending}
                  onClick={() => {
                    const what = confirming;
                    setConfirming(null);
                    if (what === 'rollback') ask.mutate({ action: 'rollback' });
                    if (what === 'test') ask.mutate({ action: 'apply_test' });
                  }}
                >
                  {confirming === 'rollback' ? 'Roll back' : 'Install the test build'}
                </Btn>
              </>
            }
          />

          <ErrorLine error={ask.error} />
          {d.waiting ? <Note>Asked. The server picks it up within a few seconds.</Note> : null}
          {d.last ? (
            <Panel title={`Last ${LAST_NAMES[d.last.action] ?? 'check'}`}>
              <p role="status">
                {LAST_WORDS[d.last.state] ?? d.last.state} · {when(d.last.at)}
              </p>
              {d.last.log ? <div className="code">{d.last.log}</div> : null}
            </Panel>
          ) : null}
        </>
      ) : null}
    </StaffPage>
  );
}

function TestBuildButtons({
  disabled,
  onAsk,
}: {
  disabled: boolean;
  onAsk: (what: 'test' | 'rollback') => void;
}) {
  return (
    <>
      <Btn sm flat
        disabled={disabled}
        onClick={() => {
          onAsk('test');
        }}
      >
        Update to test build
      </Btn>
      <Btn sm flat
        disabled={disabled}
        onClick={() => {
          onAsk('rollback');
        }}
      >
        Roll back
      </Btn>
    </>
  );
}
