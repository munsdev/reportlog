/**
 * Review, in bulk: what is waiting on each list, and a page of one list's
 * entries to approve or reject together.
 *
 * NOTHING IS COUNTED PUBLICLY UNTIL A MODERATOR APPROVES IT. The difference
 * from a logbook is the unit of review, so the page shows what makes skimming
 * safe: the site of every link, with unfamiliar ones marked, how each link
 * was checked, and the busiest minutes. No network address is kept, so there
 * is no "one address sending many" (owner ruling 40).
 *
 * A LINK IS TEXT, NEVER AN ANCHOR (K6): nothing on this page opens or fetches
 * it. A moderator copies it out deliberately.
 *
 * THE ENTRIES TICKED ON SCREEN are what is approved, never "everything
 * waiting": an entry that arrives between reading the page and pressing the
 * button is not approved unseen. Rejecting deletes nothing.
 */
import { reviewListEntries, triageListEntries } from '@reportlog/contracts';
import type { ReviewBatch, ReviewState, TriageState } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { Select } from '../../components/ui/select.tsx';
import { call } from '../../lib/api.ts';
import { reviewBatchQuery, reviewQueuesQuery } from './queries.ts';
import { LINK_OUTCOME, REVIEW, TRIAGE, said } from './words.ts';

export function ReviewQueues() {
  const query = useQuery(reviewQueuesQuery());
  return (
    <Page
      title="List entries to review"
      lede="Nothing on a list is counted publicly until it is approved here. Entries are read a page at a time and approved together."
      actions={
        <Button asChild variant="secondary">
          <Link to="/lists/links">Check links</Link>
        </Button>
      }
    >
      {query.isPending ? <p role="status">Reading the lists…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        query.data.queues.length === 0 ? (
          <p>There are no lists.</p>
        ) : (
          <ul className="space-y-2" aria-label="Lists to review">
            {query.data.queues.map((q) => (
              <li key={q.id}>
                <Link
                  to="/lists/review/$id"
                  params={{ id: q.id }}
                  className="block rounded-card border border-line bg-surface p-4 hover:bg-paper-alt"
                >
                  <span className="font-semibold">{q.title}</span>{' '}
                  <span className="text-ink-alt">
                    · {String(q.waiting)} waiting
                    {q.oldest ? `, the oldest from ${new Date(q.oldest).toLocaleString()}` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Page>
  );
}

export function ReviewPage({ id }: { id: number }) {
  const [state, setState] = useState<ReviewState>('received');
  const query = useQuery(reviewBatchQuery(id, state));
  return (
    <Page
      title={query.data ? `Review: ${query.data.list.title}` : 'Review'}
      actions={
        <Button asChild variant="secondary">
          <Link to="/lists/review">All lists</Link>
        </Button>
      }
    >
      <div className="max-w-xs">
        <Label htmlFor="review-state">Showing</Label>
        <Select
          id="review-state"
          value={state}
          onChange={(e) => {
            setState(e.target.value as ReviewState);
          }}
        >
          {(Object.keys(REVIEW) as ReviewState[]).map((s) => (
            <option key={s} value={s}>
              {REVIEW[s]}
            </option>
          ))}
        </Select>
      </div>
      {query.isPending ? <p role="status">Reading the entries…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? <Batch key={`${String(id)}-${state}`} batch={query.data} /> : null}
    </Page>
  );
}

function Batch({ batch }: { batch: ReviewBatch }) {
  const qc = useQueryClient();
  const [ticked, setTicked] = useState<number[]>([]);
  const [triage, setTriage] = useState<TriageState>('triaged');
  const refresh = async () => {
    setTicked([]);
    await qc.invalidateQueries({ queryKey: ['list-review'] });
  };
  const review = useMutation({
    mutationFn: (to: 'approved' | 'rejected') =>
      call(reviewListEntries, {
        params: { id: batch.list.id },
        body: { state: to, ids: ticked },
      }),
    onSuccess: refresh,
  });
  const mark = useMutation({
    mutationFn: () =>
      call(triageListEntries, {
        params: { id: batch.list.id },
        body: { state: triage, ids: ticked },
      }),
    onSuccess: refresh,
  });
  const labels = new Map(batch.fields.map((f) => [f.key, f.label]));
  const all = batch.entries.map((e) => e.id);

  if (!batch.entries.length) return <p>Nothing here.</p>;
  return (
    <div className="space-y-4">
      {batch.clusters.busiest_minutes[0] && batch.clusters.busiest_minutes[0].count > 1 ? (
        <Alert title="At a glance">
          <p>
            Busiest minute: {String(batch.clusters.busiest_minutes[0].count)} entries at{' '}
            {new Date(`${batch.clusters.busiest_minutes[0].minute}:00Z`).toLocaleString()}.
          </p>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="tick-all"
            checked={ticked.length === all.length}
            onCheckedChange={(on) => {
              setTicked(on === true ? all : []);
            }}
          />
          <Label htmlFor="tick-all">Tick every entry on this page</Label>
        </div>
        <span className="text-sm text-ink-alt">{String(ticked.length)} ticked</span>
      </div>

      <ul className="space-y-3" aria-label="Entries">
        {batch.entries.map((e) => {
          const box = `entry-${String(e.id)}`;
          return (
            <li key={e.id}>
              <Card>
                <CardContent className="space-y-2 pt-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={box}
                      checked={ticked.includes(e.id)}
                      onCheckedChange={(on) => {
                        setTicked((t) =>
                          on === true ? [...t, e.id] : t.filter((x) => x !== e.id),
                        );
                      }}
                    />
                    <Label htmlFor={box} className="font-normal">
                      Entry {String(e.id)}, {new Date(e.created_at).toLocaleString()} ·{' '}
                      {REVIEW[e.review_state]} · {TRIAGE[e.triage_state]}
                    </Label>
                  </div>
                  {e.links.length ? (
                    // Checked one address at a time, for every tip that sent it.
                    <ul className="space-y-1" aria-label="Links">
                      {e.links.map((l) => (
                        <li key={`${l.field_key}-${l.url}`} className="text-sm">
                          <span className={l.known_host ? '' : 'font-semibold'}>
                            {l.host}
                            {l.known_host ? '' : ' (unfamiliar site)'}
                          </span>{' '}
                          <span className="text-ink-alt">
                            · {LINK_OUTCOME[l.outcome ?? 'unchecked']}
                          </span>
                          <span className="block break-all font-mono text-ink-alt">{l.url}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    {Object.entries({ ...e.answers, ...(e.erasable_answers ?? {}) })
                      .filter(([k]) => !e.links.some((l) => l.field_key === k))
                      .map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="font-semibold">{labels.get(k) ?? k}</dt>
                          <dd className="whitespace-pre-wrap">{said(v)}</dd>
                        </div>
                      ))}
                  </dl>
                  {e.erased ? (
                    <p className="text-sm text-ink-alt">
                      Its personal half and its links have been deleted. The choices stay.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      {review.isError ? <Alert tone="serious">{review.error.message}</Alert> : null}
      {mark.isError ? <Alert tone="serious">{mark.error.message}</Alert> : null}
      <div className="flex flex-wrap items-end gap-3">
        {batch.state === 'received' ? (
          <>
            <Button
              type="button"
              disabled={!ticked.length || review.isPending}
              onClick={() => {
                review.mutate('approved');
              }}
            >
              Approve the ticked entries
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!ticked.length || review.isPending}
              onClick={() => {
                review.mutate('rejected');
              }}
            >
              Reject the ticked entries
            </Button>
          </>
        ) : null}
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor="triage">Mark the ticked entries as</Label>
            <Select
              id="triage"
              value={triage}
              onChange={(e) => {
                setTriage(e.target.value as TriageState);
              }}
            >
              {(Object.keys(TRIAGE) as TriageState[]).map((t) => (
                <option key={t} value={t}>
                  {TRIAGE[t]}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={!ticked.length || mark.isPending}
            onClick={() => {
              mark.mutate();
            }}
          >
            Mark them
          </Button>
        </div>
      </div>
    </div>
  );
}
