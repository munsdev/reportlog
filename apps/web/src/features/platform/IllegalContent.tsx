/**
 * Reporting illegal content (D1): the form anybody can use, and the page the
 * emailed link opens to show where a notice stands.
 *
 * The form takes no account and no address; an address only buys a receipt
 * and the decision by email. The status page is a door (it is reached from an
 * email and may be opened by somebody who never had the password) and calls
 * only the one status call.
 */
import { getContentNoticeStatus, submitContentNotice } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { CheckOption } from '@/components/ui/choice.tsx';
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { useGateMode } from '@/features/identity/gate.tsx';
import { ApiRequestError, call } from '@/lib/api.ts';

export function IllegalContentPage() {
  const [where, setWhere] = useState('');
  const [why, setWhy] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [good, setGood] = useState(false);
  const send = useMutation({
    mutationFn: () =>
      call(submitContentNotice, {
        body: {
          where_found: where,
          explanation: why,
          good_faith: good,
          ...(name.trim() ? { name } : {}),
          ...(email.trim() ? { email } : {}),
        },
      }),
  });

  if (send.isSuccess) {
    return (
      <Page title="We have your notice" width="prose">
        <Alert tone="done" title={`Your reference is ${send.data.receipt}`}>
          {send.data.emailed
            ? 'We emailed you a receipt with a link to see where it stands. A person will look at it and tell you what was decided and why.'
            : 'Keep this reference. You gave no email address, so we cannot tell you the decision; the people who run this site still read the notice.'}
        </Alert>
      </Page>
    );
  }
  return (
    <Page
      title="Report illegal content"
      width="prose"
      lede="If something on this site is illegal, tell us here. You do not need an account."
    >
      <p>
        What we do with a notice, and how a decision can be challenged, is in the{' '}
        <Link to="/terms" className="underline">
          terms of use
        </Link>
        .
      </p>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <Field>
          <Label>Where is it?</Label>
          <FieldDescription>
            An address on this site, or the reference of a report (it looks like RL-1234).
          </FieldDescription>
          <Input
            value={where}
            maxLength={2000}
            onChange={(e) => {
              setWhere(e.target.value);
            }}
          />
        </Field>
        <Field>
          <Label>Why do you think it is illegal?</Label>
          <Textarea
            rows={6}
            value={why}
            maxLength={5000}
            onChange={(e) => {
              setWhy(e.target.value);
            }}
          />
        </Field>
        <Field>
          <Label>Your name (optional)</Label>
          <Input
            value={name}
            maxLength={200}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
        <Field>
          <Label>Your email address (optional)</Label>
          <FieldDescription>
            Only to send you a receipt and the decision. It is deleted once the decision has been
            sent.
          </FieldDescription>
          <Input
            type="email"
            value={email}
            maxLength={320}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </Field>
        <CheckOption
          id="good-faith"
          checked={good}
          onCheckedChange={(on) => {
            setGood(on === true);
          }}
          label="I believe that what I am telling you is accurate and complete."
        />
        {send.isError ? (
          <Alert tone="serious" title="Your notice was not sent">
            {send.error.message}
          </Alert>
        ) : null}
        <div>
          <Button type="submit" disabled={send.isPending}>
            {send.isPending ? 'Sending…' : 'Send the notice'}
          </Button>
        </div>
      </form>
    </Page>
  );
}

const statusQuery = (token: string) =>
  queryOptions({
    queryKey: ['content-notice', token],
    queryFn: ({ signal }) => call(getContentNoticeStatus, { params: { token }, signal }),
    retry: false,
  });

const DECISION_WORDS = {
  removed: 'We removed the content.',
  restricted: 'We restricted access to the content.',
  no_action: 'We did not remove the content.',
} as const;

export function NoticeStatusPage({ token }: { token: string }) {
  const state = useQuery(statusQuery(token));
  const onDoor = useGateMode() === 'door';
  if (state.isPending) return <p role="status">Checking this link…</p>;
  if (state.isError) {
    const missing = state.error instanceof ApiRequestError && state.error.status === 404;
    return (
      <Page title="This link does not match a notice" width="prose">
        <p>{missing ? 'Check that the whole link was copied.' : state.error.message}</p>
      </Page>
    );
  }
  const n = state.data;
  return (
    <Page title={`Notice ${n.receipt}`} width="prose">
      <p>Received {new Date(n.received_at).toLocaleString()}.</p>
      {n.status === 'open' || !n.decision ? (
        <Alert title="Not decided yet">
          A person will look at it and tell you what was decided and why. This page shows the
          decision when it is made.
        </Alert>
      ) : (
        <Alert tone="done" title={DECISION_WORDS[n.decision]}>
          <span className="whitespace-pre-wrap">{n.decision_reason}</span>
        </Alert>
      )}
      {onDoor ? null : (
        <p>
          How to ask us to look again is in the{' '}
          <Link to="/terms" className="underline">
            terms of use
          </Link>
          .
        </p>
      )}
    </Page>
  );
}
