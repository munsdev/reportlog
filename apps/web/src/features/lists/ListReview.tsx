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
import { revealListAddress, reviewListEntries, triageListEntries } from '@reportlog/contracts';
import type { ReviewBatch, ReviewState, TriageState } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Chip } from '../../components/ui/chip.tsx';
import { Count } from '../../components/ui/count.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Select } from '../../components/ui/select.tsx';
import { Meta } from '../../components/ui/type.tsx';
import { call } from '../../lib/api.ts';
import { StaffHead } from '../moderation/parts.tsx';
import { reviewBatchQuery, reviewQueuesQuery } from './queries.ts';
import { LINK_OUTCOME, REVIEW, TRIAGE, said } from './words.ts';

export function ReviewQueues() {
  const query = useQuery(reviewQueuesQuery());
  const waiting = query.data?.queues.some((q) => q.waiting > 0);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <StaffHead
          title="List entries to review"
          lede="Entries, not reports: nothing on a list is sealed, and nothing is counted publicly until it is approved here. Entries are read a page at a time and approved together."
        />
        <Button asChild variant="secondary" className="self-start sm:self-end">
          <Link to="/lists/links">Check links</Link>
        </Button>
      </div>
      {query.isPending ? <p role="status">Reading the lists…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data && !waiting ? (
        <Empty title="No list has entries waiting">
          New entries appear here as they arrive. This page does not refresh by itself.
        </Empty>
      ) : null}
      {query.data?.queues.length ? (
        <ul className="flex flex-col gap-3" aria-label="Lists to review">
          {query.data.queues.map((q) => (
            <li key={q.id}>
              <Card className="flex-row flex-wrap items-center gap-3 p-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {q.title}
                    <Count
                      value={q.waiting}
                      label={`${String(q.waiting)} ${q.waiting === 1 ? 'entry' : 'entries'} waiting`}
                    />
                  </p>
                  {q.oldest ? (
                    <Meta>{`The oldest from ${new Date(q.oldest).toLocaleString()}`}</Meta>
                  ) : null}
                </div>
                <Button asChild variant="secondary">
                  <Link to="/lists/review/$id" params={{ id: q.id }} aria-label={`Open ${q.title}`}>
                    Open
                  </Link>
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ReviewPage({ id }: { id: number }) {
  const [state, setState] = useState<ReviewState>('received');
  const query = useQuery(reviewBatchQuery(id, state));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <StaffHead title={query.data ? `Review: ${query.data.list.title}` : 'Review'} />
        <Button asChild variant="secondary" className="self-start sm:self-end">
          <Link to="/lists/review">All lists</Link>
        </Button>
      </div>
      {/* Wraps on a phone rather than scrolling sideways: see the queue's StatusButtons. */}
      <div className="pt-1 pb-2">
        <div role="group" aria-label="Show entries that are" className="flex flex-wrap gap-2">
          {(Object.keys(REVIEW) as ReviewState[]).map((s) => (
            <Button
              key={s}
              type="button"
              variant="secondary"
              aria-pressed={state === s}
              className="shrink-0 aria-pressed:border-[3px] aria-pressed:bg-paper-alt"
              onClick={() => {
                setState(s);
              }}
            >
              {REVIEW[s]}
            </Button>
          ))}
        </div>
      </div>
      {query.isPending ? <p role="status">Reading the entries…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? <Batch key={`${String(id)}-${state}`} batch={query.data} /> : null}
    </div>
  );
}

/**
 * "Show address", on a list that writes back. One entry at a time, and only
 * when asked: the address is not in the page until then, and each opening is
 * recorded on the server before it is read. It is plain text, never a link
 * that opens a mail program by itself.
 */
export function ShowAddress({ listId, entryId }: { listId: number; entryId: number }) {
  const [address, setAddress] = useState<string | null>(null);
  const open = useMutation({
    mutationFn: () => call(revealListAddress, { params: { id: listId, entryId } }),
    onSuccess: (out) => {
      setAddress(out.address);
    },
  });
  return (
    <div className="flex flex-col gap-1 text-sm">
      {address === null ? (
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          disabled={open.isPending}
          aria-label={`Show address for entry ${String(entryId)}`}
          onClick={() => {
            open.mutate();
          }}
        >
          Show address
        </Button>
      ) : (
        <p>
          <span className="font-semibold">Address: </span>
          <span className="break-all font-mono">{address}</span>{' '}
          <Button
            type="button"
            variant="secondary"
            aria-label={`Hide address for entry ${String(entryId)}`}
            onClick={() => {
              setAddress(null);
            }}
          >
            Hide
          </Button>
        </p>
      )}
      {address === null ? <span className="text-ink-alt">Opening it is recorded.</span> : null}
      {open.isError ? <Alert tone="serious">{open.error.message}</Alert> : null}
    </div>
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
    onSuccess: async (_out, to) => {
      setTold(
        `${String(ticked.length)} ${ticked.length === 1 ? 'entry' : 'entries'} ${to === 'approved' ? 'approved' : 'rejected'}.`,
      );
      await refresh();
    },
  });
  const mark = useMutation({
    mutationFn: () =>
      call(triageListEntries, {
        params: { id: batch.list.id },
        body: { state: triage, ids: ticked },
      }),
    onSuccess: async () => {
      setTold(
        `${String(ticked.length)} ${ticked.length === 1 ? 'entry' : 'entries'} marked as ${TRIAGE[triage].toLowerCase()}.`,
      );
      await refresh();
    },
  });
  const labels = new Map(batch.fields.map((f) => [f.key, f.label]));
  const all = batch.entries.map((e) => e.id);
  const [told, setTold] = useState('');
  const hosts = new Set(batch.entries.flatMap((e) => e.links.map((l) => l.host)));
  const unfamiliar = new Set(
    batch.entries.flatMap((e) => e.links.filter((l) => !l.known_host).map((l) => l.host)),
  );
  const busiest = batch.clusters.busiest_minutes[0];

  if (!batch.entries.length) {
    return (
      <Empty title="Nothing here">
        {batch.state === 'received'
          ? 'No entry on this list is waiting.'
          : 'No entry on this list has been given this answer.'}
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {hosts.size || (busiest && busiest.count > 1) ? (
        <Card variant="quiet" heading="At a glance">
          <ul className="flex flex-col gap-1">
            {hosts.size ? (
              <li>
                {`${String(hosts.size)} site${hosts.size === 1 ? '' : 's'} linked`}
                {unfamiliar.size ? `, ${String(unfamiliar.size)} of them unfamiliar` : ''}.
              </li>
            ) : null}
            {busiest && busiest.count > 1 ? (
              <li>
                Busiest minute: {String(busiest.count)} entries at{' '}
                {new Date(`${busiest.minute}:00Z`).toLocaleString()}.
              </li>
            ) : null}
          </ul>
        </Card>
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
      </div>
      <p role="status" className="text-sm">
        {told}
      </p>

      <ul className="space-y-3" aria-label="Entries">
        {batch.entries.map((e) => {
          const box = `entry-${String(e.id)}`;
          return (
            <li key={e.id}>
              <Card>
                <CardContent className="space-y-2">
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
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <Label htmlFor={box} className="font-normal">
                        Entry {String(e.id)}, {new Date(e.created_at).toLocaleString()}
                      </Label>
                      <div className="flex flex-wrap gap-1.5">
                        <Chip tone={e.review_state === 'received' ? 'open' : 'tag'}>
                          {REVIEW[e.review_state]}
                        </Chip>
                        <Chip tone="tag">{TRIAGE[e.triage_state]}</Chip>
                      </div>
                    </div>
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
                  {batch.list.write_back && e.has_email && !e.erased ? (
                    <ShowAddress listId={batch.list.id} entryId={e.id} />
                  ) : null}
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
      {/* Like the queue's bar: on the deep surface, held at the foot of a phone's screen. */}
      <div className="sticky bottom-0 z-30">
        <Card variant="deep" className="flex-row flex-wrap items-end gap-3 px-4 py-3">
          <p className="label-face text-sm self-center">{`${String(ticked.length)} ticked`}</p>
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
              <Label htmlFor="triage" className="text-on-deep">
                Mark the ticked entries as
              </Label>
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
        </Card>
      </div>
    </div>
  );
}
