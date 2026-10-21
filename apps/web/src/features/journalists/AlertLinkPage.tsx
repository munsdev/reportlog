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
import { Button } from '@/components/ui/button.tsx';
import { Page } from '@/components/ui/page.tsx';
import { call } from '../../lib/api.ts';
import { ErrorText } from '../identity/ui.tsx';

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

export function AlertLinkPage({ kind, token }: { kind: Kind; token: string }) {
  const client = useQueryClient();
  const state = useQuery(linkQuery(kind, token));
  const press = useMutation({
    mutationFn: () => call(kind === 'confirm' ? confirmAlerts : stopAlerts, { params: { token } }),
    onSuccess: (data: AlertLink) => {
      client.setQueryData(linkQuery(kind, token).queryKey, data);
    },
  });

  if (state.isPending) return <p role="status">Checking this link…</p>;
  if (state.isError) {
    return (
      <Page title="This link could not be checked" width="prose">
        <ErrorText error={state.error} />
      </Page>
    );
  }
  const s = state.data;
  if (s.state === 'gone') {
    return (
      <Page title="This link does not work any more" width="prose">
        <p>
          It may have expired, been used already, or not been copied whole.{' '}
          {kind === 'confirm'
            ? 'To join the alert list, ask for a new confirmation email on the signup page.'
            : 'If you removed yourself from the list, there is nothing more to do. Every alert carries its own link.'}
        </p>
      </Page>
    );
  }
  if (s.state === 'confirmed') {
    return (
      <Page title="You are on the alert list" width="prose">
        <p role="status">
          <strong>{s.address}</strong> will get an email when there are new approved reports in your
          states. Every email has a link to change or stop them.
        </p>
        <p>
          A journalist can also{' '}
          <Link to="/journalists/access" className="underline">
            ask for access to the journalist desk
          </Link>
          , where vetted journalists read links moderators have checked.
        </p>
      </Page>
    );
  }
  if (s.state === 'stopped') {
    return (
      <Page title="You are off the alert list" width="prose">
        <p role="status">No more alerts will be emailed, and your details are deleted.</p>
      </Page>
    );
  }
  if (s.state === 'paused') {
    return (
      <Page title="Alerts are off" width="prose">
        <p role="status">
          No more alerts will be emailed to <strong>{s.address}</strong>. You are still on the list,
          and any journalist desk access you have is unchanged.
        </p>
        <p>
          <Link to="/journalists/settings/$token" params={{ token }} className="underline">
            Change your alerts
          </Link>{' '}
          to turn them back on, choose different states, or remove yourself from the list entirely.
        </p>
      </Page>
    );
  }
  const joining = s.state === 'pending';
  return (
    <Page title={joining ? 'Join the alert list?' : 'Stop these alerts?'} width="prose">
      <p>
        <strong>{s.address}</strong> {joining ? 'would get' : 'gets'} an email when there are new
        approved reports in: {s.states.join(', ')}.
      </p>
      <p>
        Nothing has changed yet.{' '}
        {joining
          ? 'You join only when you press the button.'
          : 'Alerts stop only when you press the button. You stay on the list, and keep any journalist desk access.'}
      </p>
      <div>
        <Button
          type="button"
          disabled={press.isPending}
          onClick={() => {
            press.mutate();
          }}
        >
          {joining ? 'Join the alert list' : 'Stop alerts'}
        </Button>
      </div>
      <ErrorText error={press.error} />
      {joining ? null : (
        <p>
          Or{' '}
          <Link to="/journalists/settings/$token" params={{ token }} className="underline">
            change your alerts
          </Link>{' '}
          instead: choose different states, or remove yourself from the list entirely.
        </p>
      )}
    </Page>
  );
}
