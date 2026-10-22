/**
 * Notices of illegal content, for moderators (D1): who sent what, open ones
 * first, and the decision with the reason the sender is emailed. The
 * sender's address is never on this screen; the server sends from it.
 */
import { CONTENT_DECISIONS, decideContentNotice, listContentNotices } from '@reportlog/contracts';
import type { ContentNoticeRow } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Chip } from '../../components/ui/chip.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { Field, FieldDescription, FieldError } from '../../components/ui/field.tsx';
import { Label } from '../../components/ui/label.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { Meta } from '../../components/ui/type.tsx';
import { call } from '../../lib/api.ts';
import { StaffHead } from '../moderation/parts.tsx';

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
    <div className="flex flex-col gap-6">
      <StaffHead
        title="Illegal content notices"
        lede="Sent through the public form. Deciding one emails the sender the decision and your reason, if they gave an address; the sender can also follow the notice at their status link, with its receipt number."
      />
      {query.isPending ? <p role="status">Reading the notices…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data?.notices.length === 0 ? (
        <Empty title="No notice">Notices sent through the public form appear here.</Empty>
      ) : null}
      <ul className="flex flex-col gap-4" aria-label="Notices">
        {notices.map((n) => (
          <li key={n.id}>
            <Notice n={n} />
          </li>
        ))}
      </ul>
    </div>
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
    <Card className="gap-3" role="article" aria-labelledby={`notice-${String(n.id)}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id={`notice-${String(n.id)}`} className="font-mono text-lg font-semibold">
          {n.receipt}
        </h2>
        {decided ? <Chip tone="tag">Answered</Chip> : <Chip tone="open">Waiting</Chip>}
      </div>
      <Meta>
        {new Date(n.created_at).toLocaleString()}
        {n.sender_name ? ` · ${n.sender_name}` : ''}
        {n.has_email ? ' · will be emailed the decision' : ' · gave no address'}
      </Meta>
      <p>
        <strong>Where:</strong> <span className="break-all">{n.where_found}</span>
      </p>
      <p className="whitespace-pre-wrap">{n.explanation}</p>
      {decided ? (
        <Card variant="quiet" className="gap-1 p-4">
          <p className="font-semibold">{DECISION_LABEL[decided]}</p>
          <p className="whitespace-pre-wrap text-ink-alt">{n.decision_reason}</p>
        </Card>
      ) : (
        <form
          className="flex flex-col gap-3"
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
          <Field>
            <Label>Decision</Label>
            <RadioGroup
              value={decision}
              onValueChange={(v) => {
                setDecision(v);
                setProblem('');
              }}
            >
              {CONTENT_DECISIONS.map((d) => (
                <RadioOption
                  key={d}
                  id={`notice-${String(n.id)}-${d}`}
                  value={d}
                  label={DECISION_LABEL[d]}
                />
              ))}
            </RadioGroup>
            <FieldError>{problem}</FieldError>
          </Field>
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
          {decide.isError ? <Alert tone="serious">{decide.error.message}</Alert> : null}
          <Button
            type="submit"
            className="self-start"
            busy={decide.isPending}
            busyLabel="Recording…"
          >
            Record the decision
          </Button>
        </form>
      )}
    </Card>
  );
}
