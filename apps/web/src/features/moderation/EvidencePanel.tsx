/**
 * Asking a reporter for the evidence they said they have, through workstream
 * F's API (evidence requests). Three gates, and the page says which is shut
 * rather than "no": the report must have DECLARED something, the reporter
 * must have PERMITTED being asked, and there must not already be an open ask.
 *
 * The message goes to the reporter word for word, under the archive's name.
 * The moderator never sees their address: the server addresses the email.
 */
import { askForEvidence, cancelEvidenceAsk, getEvidenceState } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Field, FieldDescription } from '../../components/ui/field.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { call } from '../../lib/api.ts';

export function EvidencePanel({ threadId }: { threadId: string }) {
  const qc = useQueryClient();
  const id = useId();
  const key = ['moderation', 'evidence', threadId];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => call(getEvidenceState, { params: { threadId }, signal }),
  });
  const [message, setMessage] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const ask = useMutation({
    mutationFn: () => call(askForEvidence, { params: { threadId }, body: { message } }),
    onSuccess: async () => {
      setMessage('');
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: () => call(cancelEvidenceAsk, { params: { threadId } }),
    onSuccess: refresh,
  });
  if (!query.data) return null;
  const e = query.data;
  // Nothing declared and nothing ever asked: nothing to show.
  if (!e.declared && !e.history.length) return null;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
    >
      <h2 id={id} className="font-display text-xl font-bold">
        Evidence the reporter said they have
      </h2>
      {e.open ? (
        <>
          <p>
            Asked {new Date(e.open.asked_at).toLocaleString()}; the link works until{' '}
            {new Date(e.open.expires_at).toLocaleString()}.
          </p>
          <p className="whitespace-pre-wrap text-sm text-ink-alt">{e.open.message}</p>
          {cancel.error ? <Alert tone="serious">{cancel.error.message}</Alert> : null}
          <Button
            variant="secondary"
            className="self-start"
            disabled={cancel.isPending}
            onClick={() => {
              cancel.mutate();
            }}
          >
            Withdraw the request
          </Button>
        </>
      ) : e.askable ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            ask.mutate();
          }}
        >
          <Field>
            <Label>What you are asking them for</Label>
            <Textarea
              rows={3}
              value={message}
              onChange={(ev) => {
                setMessage(ev.target.value);
              }}
            />
            <FieldDescription>
              This goes to them word for word, in an email that names no moderator. Say what you
              need and why it would help.
            </FieldDescription>
          </Field>
          {ask.error ? <Alert tone="serious">{ask.error.message}</Alert> : null}
          <Button type="submit" variant="secondary" className="self-start" disabled={ask.isPending}>
            Ask for it
          </Button>
        </form>
      ) : (
        <p>{e.why_not ?? 'They cannot be asked now.'}</p>
      )}
      {e.history.length ? (
        <p className="text-sm text-ink-alt">
          Asked {String(e.history.length)} time{e.history.length === 1 ? '' : 's'} so far.
        </p>
      ) : null}
    </section>
  );
}
