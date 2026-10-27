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
import { PublicPage } from '../site-pages/PublicPage.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { useGateMode } from '@/features/identity/gate.tsx';
import { ApiRequestError, call } from '@/lib/api.ts';
import { Narrow, TokenPage } from '@/mockup/Narrow.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { useBodyClass } from '@/mockup/useBodyClass.ts';

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
      <PublicPage title="We have your notice" width="prose">
        <Alert tone="done" title={`Your reference is ${send.data.receipt}`}>
          {send.data.emailed
            ? 'We emailed you a receipt with a link to see where it stands. A person will look at it and tell you what was decided and why.'
            : 'Keep this reference. You gave no email address, so we cannot tell you the decision; the people who run this site still read the notice.'}
        </Alert>
      </PublicPage>
    );
  }
  return (
    <PublicPage
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
            Only for a receipt and the decision. It is deleted once the decision has been sent.
          </FieldDescription>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
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
        <div className="flex flex-col sm:items-start">
          <Button
            type="submit"
            size="lg"
            block
            className="sm:w-auto"
            busy={send.isPending}
            busyLabel="Sending…"
          >
            Send the notice
          </Button>
        </div>
      </form>
    </PublicPage>
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

/** Mock-up t-notice.html. */
export function NoticeStatusPage({ token }: { token: string }) {
  useBodyClass('light', 'form');
  const state = useQuery(statusQuery(token));
  const onDoor = useGateMode() === 'door';
  if (state.isPending) {
    return (
      <Narrow>
        <p role="status" className="muted">
          Checking this link…
        </p>
      </Narrow>
    );
  }
  if (state.isError) {
    const missing = state.error instanceof ApiRequestError && state.error.status === 404;
    return (
      <TokenPage title="This link does not match a notice">
        <p>{missing ? 'Check that the whole link was copied.' : state.error.message}</p>
      </TokenPage>
    );
  }
  const n = state.data;
  return (
    <TokenPage title={`Notice ${n.receipt}`}>
      <p className="m">Received {new Date(n.received_at).toLocaleString()}.</p>
      {/* Quiet either way, never teal: teal is a moderator confirming a
          report, and this is a decision about a notice. */}
      {n.status === 'open' || !n.decision ? (
        <Panel kind="quiet" title="Not decided yet">
          <p>
            A person will look at it and tell you what was decided and why. This page shows the
            decision when it is made.
          </p>
        </Panel>
      ) : (
        <Panel kind="quiet" title="What we decided">
          <p>
            {DECISION_WORDS[n.decision]}
            {n.decision_reason ? ' ' : ''}
            <span className="whitespace-pre-wrap">{n.decision_reason}</span>
          </p>
          {onDoor ? null : (
            <p>
              <Link to="/terms">The terms this decision follows</Link>
            </p>
          )}
        </Panel>
      )}
      {onDoor || !(n.status === 'open' || !n.decision) ? null : (
        <p>
          How to ask us to look again is in the <Link to="/terms">terms of use</Link>.
        </p>
      )}
    </TokenPage>
  );
}
