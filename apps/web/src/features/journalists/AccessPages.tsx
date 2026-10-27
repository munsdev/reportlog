/**
 * Asking for vetted access (J7a): /journalists/access and the emailed
 * /journalists/access/:token.
 *
 * The first page takes an address and, if it is on the alert list, emails a
 * link; the answer is the same either way. The link's page is a door (in
 * front of the site password, like the alert list's own links), calls only
 * its own two calls, and changes nothing until the form is sent. Text and
 * links only: nothing is uploaded, and the owner reads every request.
 */
import { askForAccessLink, describeAccessLink, requestAccess } from '@reportlog/contracts';
import type { AccessLink } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { call } from '../../lib/api.ts';
import { Narrow, TokenPage } from '../../mockup/Narrow.tsx';
import { ErrorNote, Note, Waiting } from '../../mockup/Panel.tsx';
import { Field } from '../../mockup/Qcard.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { AccessFields, accessBody, EMPTY_ACCESS } from './AccessFields.tsx';

/** Mock-up t-j-access.html. */
export function AskAccessPage() {
  useBodyClass('light', 'form');
  const [email, setEmail] = useState('');
  const ask = useMutation({ mutationFn: () => call(askForAccessLink, { body: { email } }) });
  if (ask.isSuccess) {
    return (
      <TokenPage title="Check your email">
        <Note>
          If that address is on the journalist alert list, we have sent it a link to the request
          form.
        </Note>
      </TokenPage>
    );
  }
  return (
    <TokenPage title="Ask for access to the journalist desk">
      <p>
        Vetted journalists can read links that moderators have checked. The owner of this site reads
        every request; nothing is approved automatically.
      </p>
      <form
        style={{ display: 'grid', gap: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          ask.mutate();
        }}
      >
        <Field label="The address you joined the alert list with" htmlFor="access-email">
          <input
            className="input"
            id="access-email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </Field>
        <ErrorNote error={ask.error} />
        <div>
          <button className="btn sm flat ink" type="submit" disabled={ask.isPending}>
            {ask.isPending ? 'Sending…' : 'Email me the request form'}
          </button>
        </div>
        <p>
          <Link to="/journalists/alerts">Not on the list yet? Join the alert list</Link>
        </p>
      </form>
    </TokenPage>
  );
}

const linkQuery = (token: string) =>
  queryOptions({
    queryKey: ['access-link', token],
    queryFn: ({ signal }) => call(describeAccessLink, { params: { token }, signal }),
    retry: false,
  });

/** Mock-up t-j-request.html. */
export function AccessLinkPage({ token }: { token: string }) {
  useBodyClass('light', 'form');
  const client = useQueryClient();
  const state = useQuery(linkQuery(token));
  const [draft, setDraft] = useState(EMPTY_ACCESS);
  const send = useMutation({
    mutationFn: () => call(requestAccess, { params: { token }, body: accessBody(draft) }),
    onSuccess: (data: AccessLink) => {
      client.setQueryData(linkQuery(token).queryKey, data);
    },
  });

  if (state.isPending) {
    return (
      <Narrow>
        <Waiting>Checking this link…</Waiting>
      </Narrow>
    );
  }
  if (state.isError) {
    return (
      <TokenPage title="This link could not be checked">
        <ErrorNote error={state.error} />
      </TokenPage>
    );
  }
  const s = state.data;
  if (s.state === 'gone') {
    return (
      <TokenPage title="This link does not work any more">
        <p>
          It may have expired, been used already, or not been copied whole. Ask for a new one on the
          access request page.
        </p>
      </TokenPage>
    );
  }
  if (s.state === 'pending') {
    return (
      <TokenPage title="Your request is with the owner">
        <p role="status">
          The request for {s.address} is waiting. You will get an email when the owner decides.
        </p>
      </TokenPage>
    );
  }
  if (s.state === 'approved') {
    return (
      <TokenPage title="You already have access">
        <p>{s.address} is approved.</p>
        <p>
          Sign in with that address and we email you a code. Type it, accept the journalist
          agreement when it is shown, and the desk opens.
        </p>
        <p>
          <Link to="/access/sign-in" search={{ next: '/desk' }}>
            Sign in to open the desk
          </Link>
        </p>
      </TokenPage>
    );
  }
  return (
    <TokenPage title="Ask for access to the journalist desk">
      <p>For {s.address}.</p>
      <form
        style={{ display: 'grid', gap: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <AccessFields value={draft} onChange={setDraft} />
        <ErrorNote error={send.error} />
        <div>
          <button className="btn sm flat go" type="submit" disabled={send.isPending}>
            {send.isPending ? 'Sending…' : 'Send my request to the owner'}
          </button>
        </div>
        <p className="m">
          Text and links only. Nothing is sent until you press the button. What you send is kept
          encrypted and read only by the owner. If the request is not approved, it is deleted and
          you stay on the alert list.
        </p>
      </form>
    </TokenPage>
  );
}
