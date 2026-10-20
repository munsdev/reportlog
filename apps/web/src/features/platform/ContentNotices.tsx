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
import { Field, FieldDescription } from '../../components/ui/field.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { Select } from '../../components/ui/select.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
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
  return (
    <Page
      title="Illegal content notices"
      lede="Sent through the public form. Deciding one emails the sender the decision and your reason, if they gave an address."
    >
      {query.isPending ? <p role="status">Reading the notices…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data?.notices.length === 0 ? <p>Nothing here.</p> : null}
      <ul className="flex flex-col gap-4" aria-label="Notices">
        {query.data?.notices.map((n) => (
          <li key={n.id}>
            <Notice n={n} />
          </li>
        ))}
      </ul>
    </Page>
  );
}

function Notice({ n }: { n: ContentNoticeRow }) {
  const client = useQueryClient();
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: () =>
      call(decideContentNotice, { params: { id: n.id }, body: { decision, reason } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['moderation', 'content-notices'] }),
  });
  return (
    <article className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <h2 className="font-mono text-lg font-semibold">{n.receipt}</h2>
      <p className="text-sm text-ink-alt">
        {new Date(n.created_at).toLocaleString()}
        {n.sender_name ? ` · ${n.sender_name}` : ''}
        {n.has_email ? ' · will be emailed the decision' : ' · gave no address'}
      </p>
      <p>
        <strong>Where:</strong> <span className="break-all">{n.where_found}</span>
      </p>
      <p className="whitespace-pre-wrap">{n.explanation}</p>
      {n.status === 'decided' && n.decision ? (
        <Alert tone="confirmed" title={DECISION_LABEL[n.decision]}>
          {n.decision_reason}
        </Alert>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            decide.mutate();
          }}
        >
          <Field>
            <Label>Decision</Label>
            <Select
              value={decision}
              onChange={(e) => {
                setDecision(e.target.value);
              }}
            >
              <option value="">Choose…</option>
              {CONTENT_DECISIONS.map((d) => (
                <option key={d} value={d}>
                  {DECISION_LABEL[d]}
                </option>
              ))}
            </Select>
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
          <Button type="submit" className="self-start" disabled={decide.isPending}>
            Record the decision
          </Button>
        </form>
      )}
    </article>
  );
}
