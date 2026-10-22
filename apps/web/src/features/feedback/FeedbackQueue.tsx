/**
 * The administrator's side of the tracker: every issue, filtered by status,
 * and moving one. Moving always needs a note, because the note is the reply:
 * the tester is emailed it and reads it on the issue.
 */
import { FEEDBACK_STATUSES, FEEDBACK_STATUS_LABELS, setFeedbackStatus } from '@reportlog/contracts';
import type { ResponseOf, getFeedbackQueue } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Count } from '../../components/ui/count.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { CountLine } from '../../components/ui/type.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { Field, FieldDescription } from '../../components/ui/field.tsx';
import { Label } from '../../components/ui/label.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { Select } from '../../components/ui/select.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { call } from '../../lib/api.ts';
import { adminIssueQuery, queueQuery } from './queries.ts';
import { IssueLine, when } from './words.tsx';

type QueueData = ResponseOf<typeof getFeedbackQueue>;

export function FeedbackQueue() {
  const [filter, setFilter] = useState('open');
  const queue = useQuery(queueQuery(filter));
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <StaffPage
      title="Feedback"
      lede="Every issue testers have filed. Anything still open is in the weekly email until somebody moves it."
    >
      {/* Pressed buttons with counts, as the moderation queue filters. */}
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {(['open', 'all', ...FEEDBACK_STATUSES] as const).map((f) => {
          const label =
            f === 'open'
              ? 'Everything open'
              : f === 'all'
                ? 'Everything'
                : FEEDBACK_STATUS_LABELS[f];
          const n =
            f === 'open' ? queue.data?.open : f === 'all' ? undefined : queue.data?.counts[f];
          return (
            <Button
              key={f}
              variant="secondary"
              aria-pressed={filter === f}
              className={filter === f ? 'border-2 bg-paper-alt' : undefined}
              onClick={() => {
                setFilter(f);
              }}
            >
              {label}
              {n === undefined ? null : <Count value={n} label={`${String(n)} issues`} />}
            </Button>
          );
        })}
      </div>
      {queue.data ? (
        <CountLine
          parts={[`${String(queue.data.issues.length)} shown`, `${String(queue.data.open)} open`]}
        />
      ) : null}
      {queue.isPending ? <p role="status">Loading…</p> : null}
      {queue.isError ? (
        <Alert tone="serious" title="The feedback could not be loaded.">
          {queue.error.message}
        </Alert>
      ) : null}
      {queue.data?.issues.length === 0 ? (
        <Empty title="Nothing here">Nothing filed has this status.</Empty>
      ) : null}
      <ul className="flex flex-col gap-3">
        {queue.data?.issues.map((issue) => (
          <li key={issue.id}>
            <Card>
              <CardContent className="flex flex-col gap-2">
                <h2 className="font-display text-lg font-bold">{issue.title}</h2>
                <IssueLine issue={issue} author={issue.submitter_email} />
                <div>
                  <Button
                    variant="quiet"

                    aria-expanded={openId === issue.id}
                    onClick={() => {
                      setOpenId(openId === issue.id ? null : issue.id);
                    }}
                  >
                    {openId === issue.id ? 'Close' : 'Open'}
                  </Button>
                </div>
                {openId === issue.id ? <AdminIssue id={issue.id} /> : null}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
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
  if (detail.isError) return <p role="alert">{detail.error.message}</p>;
  const d = detail.data;
  const context = [d.context.page, d.context.viewport, d.context.browser].filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      <p className="whitespace-pre-wrap">{d.body}</p>
      {d.related_ref ? <p className="text-sm">About report {d.related_ref}.</p> : null}
      {context.length ? (
        <p className="font-mono text-xs text-ink-alt">{context.join(' · ')}</p>
      ) : null}
      {d.changes.length || d.comments.length ? (
        <ol className="flex flex-col gap-2">
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
              <li key={`${e.at}-${String(i)}`} className="border-l-4 border-line pl-3">
                <p className="text-sm text-ink-alt">
                  {when(e.at)}: {e.head}
                </p>
                <p className="whitespace-pre-wrap">{e.text}</p>
              </li>
            ))}
        </ol>
      ) : null}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          move.mutate();
        }}
      >
        <Field className="max-w-xs">
          <Label>Move it to</Label>
          <Select
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
          </Select>
        </Field>
        <Field>
          <Label>A note for {d.mine ? 'yourself' : d.submitter_email}</Label>
          <FieldDescription>
            Required. They are emailed it and see it on the issue, so write it to them.
          </FieldDescription>
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </Field>
        {move.isError ? (
          <Alert tone="serious" title="It was not moved.">
            {move.error.message}
          </Alert>
        ) : null}
        <div>
          <Button type="submit" variant="secondary" disabled={!status || move.isPending}>
            Move it and send the note
          </Button>
        </div>
      </form>
    </div>
  );
}
