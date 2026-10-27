/**
 * Where two links in the alert list's emails land:
 * /journalists/confirm/:token and /journalists/stop/:token.
 *
 * The stop link turns alerts off and keeps the person on the list, with any
 * desk access (owner decision 47). Its page points to the change page, which
 * is also where somebody removes themselves from the list entirely.
 *
 * OPENING A LINK CHANGES NOTHING. Mail scanners and link previews open every
 * link in a message, so looking is a GET and joining or leaving is the
 * button. Both pages work without signing in and without the site password
 * (they are doors), and on a door each calls only its own two calls.
 */
import {
  confirmAlerts,
  describeAlertConfirm,
  describeAlertStop,
  stopAlerts,
} from '@reportlog/contracts';
import type { AlertLink } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { call } from '../../lib/api.ts';
import { Narrow, TokenPage } from '../../mockup/Narrow.tsx';
import { ErrorNote, Waiting } from '../../mockup/Panel.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';

type Kind = 'confirm' | 'stop';

const linkQuery = (kind: Kind, token: string) =>
  queryOptions({
    queryKey: ['alert-link', kind, token],
    queryFn: ({ signal }) =>
      call(kind === 'confirm' ? describeAlertConfirm : describeAlertStop, {
        params: { token },
        signal,
      }),
    retry: false,
  });

/** Mock-up t-j-confirm.html (kind confirm) and t-stop.html's journalist twin (kind stop). */
export function AlertLinkPage({ kind, token }: { kind: Kind; token: string }) {
  useBodyClass('light', 'form');
  const client = useQueryClient();
  const state = useQuery(linkQuery(kind, token));
  const press = useMutation({
    mutationFn: () => call(kind === 'confirm' ? confirmAlerts : stopAlerts, { params: { token } }),
    onSuccess: (data: AlertLink) => {
      client.setQueryData(linkQuery(kind, token).queryKey, data);
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
          It may have expired, been used already, or not been copied whole.{' '}
          {kind === 'confirm'
            ? 'To join the alert list, ask for a new confirmation email on the signup page.'
            : 'If you removed yourself from the list, there is nothing more to do. Every alert carries its own link.'}
        </p>
      </TokenPage>
    );
  }
  if (s.state === 'confirmed') {
    return (
      <TokenPage title="You are on the alert list">
        <p role="status">
          {s.address} will get an email when there are new approved reports in your states. Every
          email has a link to change or stop them.
        </p>
        {s.desk === 'pending' ? (
          <p>
            Your request for access to the journalist desk is with the owner. You will get an email
            when they decide.
          </p>
        ) : s.desk === 'approved' ? null : (
          <p>
            A journalist can also{' '}
            <Link to="/journalists/access">ask for access to the journalist desk</Link>, where
            vetted journalists read links moderators have checked.
          </p>
        )}
      </TokenPage>
    );
  }
  if (s.state === 'stopped') {
    return (
      <TokenPage title="You are off the alert list">
        <p role="status">No more alerts will be emailed, and your details are deleted.</p>
      </TokenPage>
    );
  }
  if (s.state === 'paused') {
    return (
      <TokenPage title="Alerts are off">
        <p role="status">
          No more alerts will be emailed to {s.address}. You are still on the list, and any
          journalist desk access you have is unchanged.
        </p>
        <p>
          <Link to="/journalists/settings/$token" params={{ token }}>
            Change your alerts
          </Link>{' '}
          to turn them back on, choose different states, or remove yourself from the list entirely.
        </p>
      </TokenPage>
    );
  }
  const joining = s.state === 'pending';
  // Signed up with alerts off, to ask only for the desk (decision 69).
  const quiet = joining && s.alerts === 'off';
  return (
    <TokenPage title={joining ? 'Join the alert list?' : 'Stop these alerts?'}>
      {quiet ? (
        <p>
          {s.address} would be on the list with alerts off. You can turn them on later from any
          email we send.
        </p>
      ) : (
        <p>
          {s.address} {joining ? 'would get' : 'gets'} an email when there are new approved reports
          in: {s.states.join(', ')}.
        </p>
      )}
      {joining && s.desk === 'pending' ? (
        <p>
          Joining also sends your request for access to the journalist desk to the owner, who reads
          every request.
        </p>
      ) : null}
      <p>
        Nothing has changed yet.{' '}
        {joining
          ? 'You join only when you press the button.'
          : 'Alerts stop only when you press the button. You stay on the list, and keep any journalist desk access.'}
      </p>
      <div>
        <button
          className={joining ? 'btn sm flat go' : 'btn sm flat ink'}
          type="button"
          disabled={press.isPending}
          onClick={() => {
            press.mutate();
          }}
        >
          {press.isPending
            ? joining
              ? 'Joining…'
              : 'Stopping…'
            : joining
              ? 'Join the alert list'
              : 'Stop alerts'}
        </button>
      </div>
      <ErrorNote error={press.error} />
      {joining ? null : (
        <p>
          Or{' '}
          <Link to="/journalists/settings/$token" params={{ token }}>
            change your alerts
          </Link>{' '}
          instead: choose different states, or remove yourself from the list entirely.
        </p>
      )}
    </TokenPage>
  );
}
