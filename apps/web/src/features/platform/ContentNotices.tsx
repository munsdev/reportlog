/**
 * Notices of illegal content, for moderators (D1): who sent what, open ones
 * first, and the decision with the reason the sender is emailed. The
 * sender's address is never on this screen; the server sends from it.
 */
import { CONTENT_DECISIONS, decideContentNotice, listContentNotices } from '@reportlog/contracts';
import type { ContentNoticeRow } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Btn } from '../../mockup/Btn.tsx';
import { Chip } from '../../mockup/Chip.tsx';
import { Choice, Choices } from '@/mockup/Choice.tsx';
import { Field, FieldDescription, Label, Textarea } from '@/mockup/Field.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { Err, Problem } from '../../mockup/Notice.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';

const noticesQuery = queryOptions({
  queryKey: ['moderation', 'content-notices'],
  queryFn: ({ signal }) => call(listContentNotices, { signal }),
});

const DECISION_LABEL = {
  removed: 'Remove the content',
  restricted: 'Restrict access to it',
  no_action: 'Take no action',
} as const;

export function ContentNoticesPage() {
  const query = useQuery(noticesQuery);
  // Newest first, whatever order they arrive in.
  const notices = [...(query.data?.notices ?? [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  return (
    <StaffPage
      title="Illegal content notices"
      lede="Sent through the public form. Deciding one emails the sender the decision and your reason, if they gave an address; the sender can also follow the notice at their status link, with its receipt number."
    >
      {query.isPending ? <p role="status">Reading the notices…</p> : null}
      {query.isError ? <Problem>{query.error.message}</Problem> : null}
      {query.data?.notices.length === 0 ? (
        <Empty title="No notice">Notices sent through the public form appear here.</Empty>
      ) : null}
      {notices.map((n) => (
        <Notice key={n.id} n={n} />
      ))}
    </StaffPage>
  );
}

function Notice({ n }: { n: ContentNoticeRow }) {
  const client = useQueryClient();
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState('');
  const decide = useMutation({
    mutationFn: () =>
      call(decideContentNotice, { params: { id: n.id }, body: { decision, reason } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['moderation', 'content-notices'] }),
  });
  const decided = n.status === 'decided' && n.decision;
  return (
    <article className="panel" aria-labelledby={`notice-${String(n.id)}`}>
      <div className="closed-head">
        <h2 id={`notice-${String(n.id)}`} className="mono">
          {n.receipt}
        </h2>
        {decided ? <Chip kind="off">Answered</Chip> : <Chip kind="wait">Waiting</Chip>}
      </div>
      <p className="m">
        {new Date(n.created_at).toLocaleString()}
        {n.sender_name ? ` · ${n.sender_name}` : ''}
        {n.has_email ? ' · will be emailed the decision' : ' · gave no address'}
      </p>
      <p>
        <b>Where:</b> {n.where_found}
      </p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{n.explanation}</p>
      {decided ? (
        <div className="note">
          <span>
            <b>{DECISION_LABEL[decided]}</b>
            <span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{n.decision_reason}</span>
          </span>
        </div>
      ) : (
        <form
          className="col"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!decision) {
              setProblem('Choose a decision.');
              return;
            }
            decide.mutate();
          }}
        >
          <div role="radiogroup" aria-labelledby={`notice-${String(n.id)}-decision`}>
            <span className="lbl" id={`notice-${String(n.id)}-decision`}>
              Decision
            </span>
            <Choices>
              {CONTENT_DECISIONS.map((d) => (
                <Choice
                  key={d}
                  name={`notice-${String(n.id)}`}
                  value={d}
                  checked={decision === d}
                  onChange={() => {
                    setDecision(d);
                    setProblem('');
                  }}
                >
                  {DECISION_LABEL[d]}
                </Choice>
              ))}
            </Choices>
            <Err>{problem}</Err>
          </div>
          <Field>
            <Label>Reason, as the sender will read it</Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
            <FieldDescription>
              At least a sentence. It is emailed, and it stays on the record.
            </FieldDescription>
          </Field>
          {decide.isError ? <Problem>{decide.error.message}</Problem> : null}
          <div className="acts">
            <Btn sm flat look="ink" type="submit" disabled={decide.isPending}>
              {decide.isPending ? 'Recording…' : 'Record the decision'}
            </Btn>
          </div>
        </form>
      )}
    </article>
  );
}
