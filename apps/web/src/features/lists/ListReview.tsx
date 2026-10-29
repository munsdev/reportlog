/**
 * List entries, one of the two moderation queues (docs/design/moderation-unified.md):
 * what is waiting on each list, and a page of one list's entries to approve
 * or reject together. That page is the hub for entries: each entry's links
 * are judged and its written account decided on it, where the Links and
 * Written accounts pages used to do it.
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
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Btn } from '../../mockup/Btn.tsx';
import { Chip } from '../../mockup/Chip.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { Problem } from '../../mockup/Notice.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Seg } from '../../mockup/Seg.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { LinkVerdict } from '../moderation/LinkVerdict.tsx';
import { WrittenPanel } from '../moderation/Written.tsx';
import { reviewBatchQuery, reviewQueuesQuery } from './queries.ts';
import type { ReviewSearch } from './queries.ts';
import { REVIEW, TRIAGE, said } from './words.ts';

/**
 * The review page's filters: what used to be the Links and Written accounts
 * pages (owner, 29 October 2026). Filters on a staff work queue, not on public
 * data, so they are not the operator's to choose as the board's are. A tip
 * always allows journalists and entries have no second read, so those two of
 * the reports queue's filters are not here.
 */
const ENTRY_WORK = [
  { key: 'links', label: 'Has links to check' },
  { key: 'written', label: 'Has a written account' },
] as const;

const entries = (n: number) => `${String(n)} ${n === 1 ? 'entry' : 'entries'}`;

export function ReviewQueues() {
  const query = useQuery(reviewQueuesQuery());
  const waiting = query.data?.queues.some((q) => q.waiting > 0);
  return (
    <StaffPage
      title="List entries"
      lede="Entries sent to lists. Nothing here is published, and nothing on a list is counted publicly until it is approved. Open a list to read its entries a page at a time, judge their links and decide their written accounts."
    >
      {query.isPending ? <p role="status">Reading the lists…</p> : null}
      {query.isError ? <Problem>{query.error.message}</Problem> : null}
      {query.data && !waiting ? (
        <Empty title="No list has entries waiting">
          New entries appear here as they arrive. This page does not refresh by itself.
        </Empty>
      ) : null}
      {query.data?.queues.map((q) => (
        <article className="panel" key={q.id}>
          <h2>
            {q.title}{' '}
            <span className="n">
              <span aria-hidden="true">{q.waiting}</span>
              <span className="sr-only">{`${entries(q.waiting)} waiting`}</span>
            </span>
          </h2>
          {q.oldest ? (
            <p className="m">{`The oldest from ${new Date(q.oldest).toLocaleString()}`}</p>
          ) : null}
          <div className="acts">
            <Link
              className="btn sm flat"
              to="/lists/review/$id"
              params={{ id: q.id }}
              aria-label={`Open ${q.title}`}
            >
              Open
            </Link>
            {q.with_links ? (
              <Link
                className="btn sm flat ghost"
                to="/lists/review/$id"
                params={{ id: q.id }}
                search={{ links: true }}
              >
                {`${entries(q.with_links)} with links to check`}
              </Link>
            ) : null}
            {q.with_written ? (
              <Link
                className="btn sm flat ghost"
                to="/lists/review/$id"
                params={{ id: q.id }}
                search={{ written: true }}
              >
                {`${entries(q.with_written)} with a written account`}
              </Link>
            ) : null}
          </div>
        </article>
      ))}
    </StaffPage>
  );
}

export function ReviewPage({ id, search = {} }: { id: number; search?: ReviewSearch }) {
  const navigate = useNavigate();
  const state = search.state ?? 'received';
  const query = useQuery(reviewBatchQuery(id, search));
  const go = (patch: Partial<ReviewSearch>) => {
    const next = { ...search, ...patch };
    void navigate({
      to: '/lists/review/$id',
      params: { id },
      search: Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)),
    });
  };
  return (
    <StaffPage
      title={query.data ? `Review: ${query.data.list.title}` : 'Review'}
      actions={
        <Link className="btn sm flat" to="/lists/review">
          All lists
        </Link>
      }
    >
      <Seg
        label="Show entries that are"
        options={(Object.keys(REVIEW) as ReviewState[]).map((s) => ({
          key: s,
          label: REVIEW[s],
          pressed: state === s,
          onClick: () => {
            go({ state: s === 'received' ? undefined : s });
          },
        }))}
      />
      <Seg
        label="Only entries that"
        options={ENTRY_WORK.map((w) => ({
          key: w.key,
          label: w.label,
          pressed: Boolean(search[w.key]),
          onClick: () => {
            go({ [w.key]: search[w.key] ? undefined : true });
          },
        }))}
      />
      {query.isPending ? <p role="status">Reading the entries…</p> : null}
      {query.isError ? <Problem>{query.error.message}</Problem> : null}
      {query.data ? (
        <Batch
          key={JSON.stringify([id, search])}
          batch={query.data}
          filtered={ENTRY_WORK.some((w) => Boolean(search[w.key]))}
        />
      ) : null}
    </StaffPage>
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
    <>
      {address === null ? (
        <div className="acts">
          <Btn
            sm
            flat
            disabled={open.isPending}
            aria-label={`Show address for entry ${String(entryId)}`}
            onClick={() => {
              open.mutate();
            }}
          >
            Show address
          </Btn>
        </div>
      ) : (
        <p>
          <b>Address: </b>
          <span className="mono">{address}</span>{' '}
          <Btn
            sm
            flat
            aria-label={`Hide address for entry ${String(entryId)}`}
            onClick={() => {
              setAddress(null);
            }}
          >
            Hide
          </Btn>
        </p>
      )}
      {address === null ? <p className="m">Opening it is recorded.</p> : null}
      {open.isError ? <Problem>{open.error.message}</Problem> : null}
    </>
  );
}

function Batch({ batch, filtered }: { batch: ReviewBatch; filtered: boolean }) {
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
        {filtered
          ? 'No entry here matches these filters. Turn one off to see more.'
          : batch.state === 'received'
            ? 'No entry on this list is waiting.'
            : 'No entry on this list has been given this answer.'}
      </Empty>
    );
  }
  return (
    <>
      {hosts.size || (busiest && busiest.count > 1) ? (
        <Panel kind="quiet" title="At a glance">
          <p>
            {hosts.size
              ? `${String(hosts.size)} site${hosts.size === 1 ? '' : 's'} linked${unfamiliar.size ? `, ${String(unfamiliar.size)} of them unfamiliar` : ''}`
              : ''}
            {hosts.size && busiest && busiest.count > 1 ? ' · ' : ''}
            {busiest && busiest.count > 1
              ? `Busiest minute: ${new Date(`${busiest.minute}:00Z`).toLocaleString()} (${String(busiest.count)} entries)`
              : ''}
          </p>
        </Panel>
      ) : null}
      <p role="status" className="m">
        {told}
      </p>

      <div className="qlist2" role="list" aria-label="Entries">
        {batch.entries.map((e) => (
          <article className="qrow" role="listitem" key={e.id}>
            <label className="qsel">
              <input
                type="checkbox"
                aria-label={`Select entry ${String(e.id)}`}
                checked={ticked.includes(e.id)}
                onChange={(ev) => {
                  setTicked((t) =>
                    ev.target.checked ? [...t, e.id] : t.filter((x) => x !== e.id),
                  );
                }}
              />
            </label>
            <div className="qbody">
              <div className="chips">
                <Chip kind={e.review_state === 'received' ? 'wait' : 'off'}>
                  {REVIEW[e.review_state]}
                </Chip>
                <Chip kind="off">{TRIAGE[e.triage_state]}</Chip>
              </div>
              <p className="qsum">
                Entry {String(e.id)}, {new Date(e.created_at).toLocaleString()}
              </p>
              {e.links.length ? (
                // Judged one address at a time, for every tip and report that
                // sent it: a verdict here is the same verdict everywhere.
                <ul className="qlist" aria-label="Links">
                  {e.links.map((l) => (
                    <li key={`${l.field_key}-${l.url}`} className="col">
                      <span>
                        <b>
                          {l.host}
                          {l.known_host ? '' : ' (unfamiliar site)'}
                        </b>
                        {l.kind ? <span className="m"> · {l.kind}</span> : null}
                      </span>
                      <span className="m mono block break-all">{l.url}</span>
                      <LinkVerdict link={l} />
                    </li>
                  ))}
                </ul>
              ) : null}
              <dl className="answers">
                {Object.entries({ ...e.answers, ...(e.erasable_answers ?? {}) })
                  .filter(([k]) => !e.links.some((l) => l.field_key === k))
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>{labels.get(k) ?? k}</dt>
                      <dd className="whitespace-pre-wrap">{said(v)}</dd>
                    </div>
                  ))}
              </dl>
              {e.texts.map((t) => (
                <WrittenPanel
                  key={t.ref}
                  textRef={t.ref}
                  shared
                  outcome={t.outcome}
                  on="entry"
                  reveal={false}
                  title={`Written account · ${labels.get(t.field_key) ?? t.field_key} · not published`}
                />
              ))}
              {batch.list.write_back && e.has_email && !e.erased ? (
                <ShowAddress listId={batch.list.id} entryId={e.id} />
              ) : null}
              {e.erased ? (
                <p className="m">
                  Its personal half and its links have been deleted. The choices stay.
                </p>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {review.isError ? <Problem>{review.error.message}</Problem> : null}
      {mark.isError ? <Problem>{mark.error.message}</Problem> : null}
      <div className="bulkbar" role="region" aria-label="Selected entries">
        <span>{`${String(ticked.length)} selected`}</span>
        <div className="acts">
          {ticked.length < all.length ? (
            <Btn
              sm
              flat
              onClick={() => {
                setTicked(all);
              }}
            >
              {`Select all ${String(all.length)}`}
            </Btn>
          ) : null}
          {ticked.length ? (
            <Btn
              sm
              flat
              className="ghost"
              onClick={() => {
                setTicked([]);
              }}
            >
              Select none
            </Btn>
          ) : null}
          {batch.state === 'received' ? (
            <>
              <Btn
                sm
                flat
                look="ink"
                disabled={!ticked.length || review.isPending}
                onClick={() => {
                  review.mutate('approved');
                }}
              >
                Approve selected
              </Btn>
              <Btn
                sm
                flat
                disabled={!ticked.length || review.isPending}
                onClick={() => {
                  review.mutate('rejected');
                }}
              >
                Reject selected
              </Btn>
            </>
          ) : null}
          <label className="select">
            <span className="vh">Mark the selected entries as</span>
            <select
              value={triage}
              onChange={(e) => {
                setTriage(e.target.value as TriageState);
              }}
            >
              {(Object.keys(TRIAGE) as TriageState[]).map((t) => (
                <option key={t} value={t}>
                  {`Mark as: ${TRIAGE[t]}`}
                </option>
              ))}
            </select>
          </label>
          <Btn
            sm
            flat
            disabled={!ticked.length || mark.isPending}
            onClick={() => {
              mark.mutate();
            }}
          >
            Mark them
          </Btn>
        </div>
      </div>
    </>
  );
}
