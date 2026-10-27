/**
 * Where the stop link in a digest email lands: /notifications/stop/:token.
 *
 * OPENING THE LINK STOPS NOTHING. Mail scanners and link previews open every
 * link in a message, so looking is a GET and stopping is the button. It
 * works without signing in and without the site password (a door), and on a
 * door this page calls only the two stop calls.
 */
import { describeDigestStop, stopDigest } from '@reportlog/contracts';
import type { DigestStop } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';
import { Narrow, TokenPage } from '../../mockup/Narrow.tsx';
import { ErrorNote, Waiting } from '../../mockup/Panel.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';

const stopQuery = (token: string) =>
  queryOptions({
    queryKey: ['digest-stop', token],
    queryFn: ({ signal }) => call(describeDigestStop, { params: { token }, signal }),
    retry: false,
  });

const HOW_OFTEN = { hourly: 'hourly', weekly: 'weekly' } as const;

/** Mock-up t-stop.html. */
export function DigestStopPage({ token }: { token: string }) {
  useBodyClass('light', 'form');
  const client = useQueryClient();
  const state = useQuery(stopQuery(token));
  const stop = useMutation({
    mutationFn: () => call(stopDigest, { params: { token } }),
    onSuccess: (data: DigestStop) => {
      client.setQueryData(stopQuery(token).queryKey, data);
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
          It may have expired, or not been copied whole. To stop the emails, sign in and choose “No
          emails” under Email updates. Every new email also carries a fresh link.
        </p>
      </TokenPage>
    );
  }
  if (s.state === 'stopped') {
    return (
      <TokenPage title="These emails are stopped">
        <p role="status">No more report updates will be emailed to {s.address}.</p>
        <p>To start them again, sign in and choose under Email updates.</p>
      </TokenPage>
    );
  }
  return (
    <TokenPage title="Stop these emails?">
      <p>
        {s.address} gets an email {HOW_OFTEN[s.frequency]} about reports newly published here.
        Stopping them stops all of them, from every logbook.
      </p>
      <p>Nothing has changed yet. The emails stop only when you press the button.</p>
      <div>
        <button
          className="btn sm flat ink"
          type="button"
          disabled={stop.isPending}
          onClick={() => {
            stop.mutate();
          }}
        >
          Stop these emails
        </button>
      </div>
      <ErrorNote error={stop.error} />
    </TokenPage>
  );
}
