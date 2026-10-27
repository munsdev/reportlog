/**
 * The administrator's side of the tracker: every issue, filtered by status,
 * and moving one. Moving always needs a note, because the note is the reply:
 * the tester is emailed it and reads it on the issue.
 */
import { FEEDBACK_STATUSES, FEEDBACK_STATUS_LABELS, setFeedbackStatus } from '@reportlog/contracts';
import type { ResponseOf, getFeedbackQueue } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { Empty } from '../../mockup/Empty.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { AreaField } from '../../mockup/Fields.tsx';
import { Filters } from '../../mockup/Filters.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { adminIssueQuery, queueQuery } from './queries.ts';
import { IssueLine, StatusChip, when } from './words.tsx';

type QueueData = ResponseOf<typeof getFeedbackQueue>;

export function FeedbackQueue() {
  const [filter, setFilter] = useState('open');
  const queue = useQuery(queueQuery(filter));
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <StaffPage
      title="Feedback queue"
      lede="Everything testers and staff have filed. Anything still open is in the weekly email until somebody moves it."
    >
      <Filters
        value={filter}
        onChange={setFilter}
        options={(['open', 'all', ...FEEDBACK_STATUSES] as const).map((f) => ({
          value: f,
          label:
            f === 'open'
              ? 'Everything open'
              : f === 'all'
                ? 'Everything'
                : FEEDBACK_STATUS_LABELS[f],
          n: f === 'open' ? queue.data?.open : f === 'all' ? undefined : queue.data?.counts[f],
        }))}
      />
      {queue.data ? (
        <p className="m">
          {String(queue.data.issues.length)} shown · {String(queue.data.open)} open
        </p>
      ) : null}
      {queue.isPending ? <p role="status">Loading…</p> : null}
      <ErrorLine error={queue.error} />
      {queue.data?.issues.length === 0 ? (
        <Empty title="Nothing here">Nothing filed has this status.</Empty>
      ) : null}
      {queue.data?.issues.map((issue) => (
        <Panel
          as="article"
          key={issue.id}
          title={`#${String(issue.id)} ${issue.title}`}
          head={<StatusChip status={issue.status} />}
        >
          <IssueLine issue={issue} author={issue.submitter_email} />
          <div className="acts">
            <Btn sm flat
              aria-expanded={openId === issue.id}
              onClick={() => {
                setOpenId(openId === issue.id ? null : issue.id);
              }}
            >
              {openId === issue.id ? 'Close' : 'Open'}
            </Btn>
          </div>
          {openId === issue.id ? <AdminIssue id={issue.id} /> : null}
        </Panel>
      ))}
    </StaffPage>
  );
}

function AdminIssue({ id }: { id: number }) {
  const client = useQueryClient();
  const detail = useQuery(adminIssueQuery(id));
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const move = useMutation({
    mutationFn: () => call(setFeedbackStatus, { params: { id }, body: { status, note } }),
    onSuccess: (data) => {
      setNote('');
      client.setQueryData(adminIssueQuery(id).queryKey, data);
      // Not refetched: under "Everything open", an issue just marked fixed
      // would vanish from under the person who moved it. It stays where it
      // is, showing its new status, until the list is filtered again.
      client.setQueriesData<QueueData>({ queryKey: ['feedback', 'queue'] }, (old) =>
        old
          ? {
              ...old,
              issues: old.issues.map((i) =>
                i.id === id
                  ? { ...i, status: data.status, status_changed_at: data.status_changed_at }
                  : i,
              ),
            }
          : old,
      );
      void client.invalidateQueries({ queryKey: ['feedback', 'queue'], refetchType: 'none' });
    },
  });
  if (detail.isPending) return <p role="status">Loading…</p>;
  if (detail.isError) return <ErrorLine error={detail.error} />;
  const d = detail.data;
  const context = [d.context.page, d.context.viewport, d.context.browser].filter(Boolean);
  return (
    <>
      <p style={{ whiteSpace: 'pre-wrap' }}>{d.body}</p>
      {d.related_ref ? <p className="m">About report {d.related_ref}.</p> : null}
      {context.length ? <p className="m mono">{context.join(' · ')}</p> : null}
      {[
        ...d.changes.map((c) => ({
          at: c.created_at,
          head: `${c.by} moved it to ${FEEDBACK_STATUS_LABELS[c.status]}`,
          text: c.note,
        })),
        ...d.comments.map((c) => ({
          at: c.created_at,
          head: `${c.author_email} commented`,
          text: c.body,
        })),
      ]
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((e, i) => (
          <div key={`${e.at}-${String(i)}`}>
            <p className="m">
              {when(e.at)}: {e.head}
            </p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{e.text}</p>
          </div>
        ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          move.mutate();
        }}
      >
        <div className="acts">
          <div className="field">
            <label htmlFor={`move-${String(id)}`}>Move it to</label>
            <select
              id={`move-${String(id)}`}
              className="sel"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
              }}
            >
              <option value="">Choose…</option>
              {FEEDBACK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {FEEDBACK_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <AreaField
          label={`A note for ${d.mine ? 'yourself' : d.submitter_email}`}
          help="Required. They are emailed it and see it on the issue, so write it to them."
          rows={3}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
        <ErrorLine error={move.error} />
        <Btn sm flat look="ink" type="submit" disabled={!status || move.isPending}>
          Move it and send the note
        </Btn>
      </form>
    </>
  );
}
