/**
 * Updates: what is installed, is there a newer version, what is in it, and
 * one button that checks and then installs it. Nobody needs a shell: the
 * button asks the server, and a root unit on the server carries it out
 * (apps/api/src/site/updateRoutes.ts).
 *
 * Eight presses on the installed version add a branch selector (main, beta,
 * alpha) beside that button, and a choice of every release the server keeps
 * to go back to. A server that does not follow main always shows the branch
 * selector, so nobody is left on a testing branch without knowing it.
 * Everything that installs or goes back asks first, naming what.
 *
 * While a request runs the page asks again every few seconds. The API
 * restarts part-way through an update, so a failed read then is expected
 * and the page simply keeps asking.
 */
import { getUpdates, requestUpdate, UPDATE_BRANCHES } from '@reportlog/contracts';
import type {
  ReleasePoint,
  UpdateBranch,
  UpdateRequestBody,
  UpdatesView,
} from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '@/lib/api.ts';
import { Btn } from '@/mockup/Btn.tsx';
import { Dl } from '../../mockup/Dl.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Modal } from '../../mockup/Modal.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Panel } from '@/mockup/Panel.tsx';

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
  rollback: 'roll back',
};

const LAST_WORDS: Record<string, string> = {
  running: 'Under way',
  done: 'Finished',
  failed: 'Did not finish. The site is still running the version it had before.',
  refused: 'Not started',
};

/** How many presses of the installed version show the branch and release choices. */
const TAPS_TO_CHOOSE = 8;

const isOffered = (b: string): b is UpdateBranch =>
  (UPDATE_BRANCHES as readonly string[]).includes(b);

/** A release, named the way a person would recognise it. */
function releaseName(r: ReleasePoint): string {
  return `${r.version ?? 'an unnumbered version'} (${r.commit.slice(0, 12)})${
    r.branch ? ` from ${r.branch}` : ''
  }, installed ${when(r.installed_at)}`;
}

type Confirming =
  | { kind: 'install'; sha: string; branch: UpdateBranch | undefined; ref: string; name: string }
  | { kind: 'rollback'; release: string | undefined; name: string };

export function UpdatesPage() {
  const qc = useQueryClient();
  const q = useQuery(updatesQuery);
  // Page state on purpose: a refresh hides the choices again.
  const [taps, setTaps] = useState(0);
  const [branch, setBranch] = useState<UpdateBranch | '' | null>(null);
  const [release, setRelease] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const ask = useMutation({
    mutationFn: (body: UpdateRequestBody) => call(requestUpdate, { body }),
    onSuccess: (d) => {
      qc.setQueryData(updatesQuery.queryKey, d);
    },
  });
  const d = q.data;
  const unlocked = taps >= TAPS_TO_CHOOSE;
  const following = d?.following ?? '';
  const choosing = unlocked || following !== 'main';
  // '' is the followed ref when it is not one of the offered branches (a
  // server following `test`, say): it can be checked and updated, never named.
  const chosen = branch ?? (isOffered(following) ? following : '');
  const ref = choosing && chosen ? chosen : following;
  const asBranch = choosing && chosen ? { branch: chosen } : {};
  const checkedHere = d?.ref === ref;
  const offer = d && checkedHere && d.tip && d.behind !== 0 && d.tip !== d.current ? d.tip : null;
  const points = d?.release_points ?? [];
  const point = points.find((r) => r.id === release) ?? points[0] ?? null;
  const off = busy(d) || ask.isPending;
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
                  'Version',
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
                    {d.installed?.version ?? d.current_version ?? 'an unnumbered version'}
                  </button>,
                ],
                [
                  'Commit',
                  <code key="c">
                    {(d.installed?.commit ?? d.current ?? '').slice(0, 12) || 'not known'}
                  </code>,
                ],
                ['Installed', d.installed ? when(d.installed.installed_at) : 'not recorded'],
                ['From branch', d.installed?.branch ?? 'not recorded'],
                ['Follows', <code key="f">{following || 'no branch set'}</code>],
                ['Last checked', when(d.checked_at)],
              ]}
            />
          </Panel>

          <Panel title={offer ? 'An update is available' : 'Updates'}>
            {d.fetch_failed && checkedHere ? <p className="error">{d.fetch_failed}</p> : null}
            {!d.checked_at ? (
              <p>No check has run on this server yet.</p>
            ) : !checkedHere ? (
              <p>Press Check for update to see what {ref} offers.</p>
            ) : offer ? (
              <>
                <p>
                  {d.available_version ?? 'A newer version'} on {ref}
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
              </>
            ) : d.ahead > 0 && d.behind === 0 ? (
              <p>This site is ahead of {ref}: there is nothing newer there to install.</p>
            ) : (
              <p>This site is running the newest version on {ref}.</p>
            )}
            <div className="acts">
              {choosing ? (
                <label className="select">
                  Branch{' '}
                  <select
                    value={chosen}
                    disabled={off}
                    onChange={(e) => {
                      setBranch(e.target.value as UpdateBranch | '');
                    }}
                  >
                    {!isOffered(following) && following ? (
                      <option value="">{following} (followed now)</option>
                    ) : null}
                    {UPDATE_BRANCHES.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <Btn
                sm
                flat
                look={offer ? 'ink' : undefined}
                disabled={off}
                onClick={() => {
                  if (offer) {
                    setConfirming({
                      kind: 'install',
                      sha: offer,
                      branch: asBranch.branch,
                      ref,
                      name: `${d.available_version ?? 'the newest version'} (${offer.slice(0, 12)})`,
                    });
                  } else {
                    ask.mutate({ action: 'check', ...asBranch });
                  }
                }}
              >
                {offer ? 'Install update' : 'Check for update'}
              </Btn>
            </div>
          </Panel>

          {unlocked || d.roll_back_to ? (
            <Panel title="Going back">
              {unlocked ? (
                points.length && point ? (
                  <>
                    <p>
                      The releases this server keeps, newest first. Going back changes the code,
                      never the database.
                    </p>
                    <div className="acts">
                      <label className="select">
                        Release{' '}
                        <select
                          value={point.id}
                          disabled={off}
                          onChange={(e) => {
                            setRelease(e.target.value);
                          }}
                        >
                          {points.map((r) => (
                            <option key={r.id} value={r.id}>
                              {releaseName(r)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Btn
                        sm
                        flat
                        disabled={off}
                        onClick={() => {
                          setConfirming({
                            kind: 'rollback',
                            release: point.id,
                            name: releaseName(point),
                          });
                        }}
                      >
                        Roll back
                      </Btn>
                    </div>
                  </>
                ) : (
                  <p>This server keeps no other release to go back to.</p>
                )
              ) : d.roll_back_to ? (
                <>
                  <p>The version this site ran before the last update is still on the server.</p>
                  <div className="acts">
                    <Btn
                      sm
                      flat
                      disabled={off}
                      onClick={() => {
                        if (d.roll_back_to)
                          setConfirming({
                            kind: 'rollback',
                            release: undefined,
                            name: releaseName(d.roll_back_to),
                          });
                      }}
                    >
                      Roll back to {d.roll_back_to.version ?? 'the previous version'}
                    </Btn>
                  </div>
                </>
              ) : null}
            </Panel>
          ) : null}

          <Modal
            open={confirming !== null}
            onClose={() => {
              setConfirming(null);
            }}
            title={
              confirming?.kind === 'rollback'
                ? 'Go back to an older version?'
                : `Install an update from ${confirming?.ref ?? ''}?`
            }
            text={confirming ? confirmText(confirming, following) : ''}
            buttons={
              <>
                <Btn
                  sm
                  flat
                  look="ghost"
                  onClick={() => {
                    setConfirming(null);
                  }}
                >
                  Cancel
                </Btn>
                <Btn
                  sm
                  flat
                  look="ink"
                  disabled={off}
                  onClick={() => {
                    const what = confirming;
                    setConfirming(null);
                    if (what?.kind === 'install')
                      ask.mutate({
                        action: 'apply',
                        sha: what.sha,
                        ...(what.branch ? { branch: what.branch } : {}),
                      });
                    if (what?.kind === 'rollback')
                      ask.mutate({
                        action: 'rollback',
                        ...(what.release ? { release: what.release } : {}),
                      });
                  }}
                >
                  {confirming?.kind === 'rollback' ? 'Roll back' : 'Install'}
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

/** What the confirmation says: what will be installed or gone back to, and what follows. */
function confirmText(c: Confirming, following: string): string {
  if (c.kind === 'rollback') {
    return (
      `The site goes back to ${c.name}. The database keeps what newer versions added, which the older one ignores.` +
      (c.release ? '' : ' This can be done once: to move forward again, install an update.')
    );
  }
  return (
    `The site installs ${c.name} from ${c.ref}.` +
    (c.ref !== following
      ? ` From then on it follows ${c.ref}: every check, the daily one too, looks there.`
      : '') +
    (c.ref !== 'main'
      ? ` ${c.ref} is for testing: it may break things. Only install it on a test server.`
      : '')
  );
}
