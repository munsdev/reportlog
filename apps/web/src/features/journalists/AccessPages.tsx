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
import { Button } from '@/components/ui/button.tsx';
import { PublicPage } from '../site-pages/PublicPage.tsx';
import { call } from '../../lib/api.ts';
import { ErrorText, TextField } from '../identity/ui.tsx';
import { AccessFields, accessBody, EMPTY_ACCESS } from './AccessFields.tsx';

export function AskAccessPage() {
  const [email, setEmail] = useState('');
  const ask = useMutation({ mutationFn: () => call(askForAccessLink, { body: { email } }) });
  if (ask.isSuccess) {
    return (
      <PublicPage title="Check your email" width="prose">
        <p role="status">
          If that address is on the journalist alert list, we have sent it a link to the request
          form.
        </p>
      </PublicPage>
    );
  }
  return (
    <PublicPage
      title="Ask for access to the journalist desk"
      width="prose"
      lede="Vetted journalists can read links that moderators have checked. The owner of this site reads every request; nothing is approved automatically."
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          ask.mutate();
        }}
      >
        <TextField
          label="The address you joined the alert list with"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <ErrorText error={ask.error} />
        <div>
          <Button type="submit" busy={ask.isPending} busyLabel="Sending…">
            Email me the request form
          </Button>
        </div>
        <p className="text-sm text-muted">
          Not on the list yet?{' '}
          <Link to="/journalists/alerts" className="underline">
            Join the alert list
          </Link>{' '}
          first.
        </p>
      </form>
    </PublicPage>
  );
}

const linkQuery = (token: string) =>
  queryOptions({
    queryKey: ['access-link', token],
    queryFn: ({ signal }) => call(describeAccessLink, { params: { token }, signal }),
    retry: false,
  });

export function AccessLinkPage({ token }: { token: string }) {
  const client = useQueryClient();
  const state = useQuery(linkQuery(token));
  const [draft, setDraft] = useState(EMPTY_ACCESS);
  const send = useMutation({
    mutationFn: () => call(requestAccess, { params: { token }, body: accessBody(draft) }),
    onSuccess: (data: AccessLink) => {
      client.setQueryData(linkQuery(token).queryKey, data);
    },
  });

  if (state.isPending) return <p role="status">Checking this link…</p>;
  if (state.isError) {
    return (
      <PublicPage title="This link could not be checked" width="prose">
        <ErrorText error={state.error} />
      </PublicPage>
    );
  }
  const s = state.data;
  if (s.state === 'gone') {
    return (
      <PublicPage title="This link does not work any more" width="prose">
        <p>
          It may have expired, been used already, or not been copied whole. Ask for a new one on the
          access request page.
        </p>
      </PublicPage>
    );
  }
  if (s.state === 'pending') {
    return (
      <PublicPage title="Your request is with the owner" width="prose">
        <p role="status">
          The request for <strong>{s.address}</strong> is waiting. You will get an email when the
          owner decides.
        </p>
      </PublicPage>
    );
  }
  if (s.state === 'approved') {
    return (
      <PublicPage title="You already have access" width="prose">
        <p>
          <strong>{s.address}</strong> is approved. Sign in with it to open the desk.
        </p>
      </PublicPage>
    );
  }
  return (
    <PublicPage
      title="Ask for access to the journalist desk"
      width="prose"
      lede={`For ${s.address}. Text and links only. Nothing is sent until you press the button.`}
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <AccessFields value={draft} onChange={setDraft} />
        <ErrorText error={send.error} />
        <div>
          <Button type="submit" busy={send.isPending} busyLabel="Sending…">
            Send my request to the owner
          </Button>
        </div>
        <p className="text-sm text-muted">
          What you send is kept encrypted and read only by the owner. If the request is not
          approved, it is deleted and you stay on the alert list.
        </p>
      </form>
    </PublicPage>
  );
}
