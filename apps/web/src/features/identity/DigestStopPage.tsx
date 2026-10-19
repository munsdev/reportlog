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
import { Button } from '@/components/ui/button.tsx';
import { Page } from '@/components/ui/page.tsx';
import { call } from '../../lib/api.ts';
import { ErrorText } from './ui.tsx';

const stopQuery = (token: string) =>
  queryOptions({
    queryKey: ['digest-stop', token],
    queryFn: ({ signal }) => call(describeDigestStop, { params: { token }, signal }),
    retry: false,
  });

const HOW_OFTEN = { hourly: 'hourly', weekly: 'weekly' } as const;

export function DigestStopPage({ token }: { token: string }) {
  const client = useQueryClient();
  const state = useQuery(stopQuery(token));
  const stop = useMutation({
    mutationFn: () => call(stopDigest, { params: { token } }),
    onSuccess: (data: DigestStop) => {
      client.setQueryData(stopQuery(token).queryKey, data);
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
          It may have expired, or not been copied whole. To stop the emails, sign in and choose “No
          emails” under Email updates. Every new email also carries a fresh link.
        </p>
      </Page>
    );
  }
  if (s.state === 'stopped') {
    return (
      <Page title="These emails are stopped" width="prose">
        <p role="status">
          No more report updates will be emailed to <strong>{s.address}</strong>.
        </p>
        <p>To start them again, sign in and choose under Email updates.</p>
      </Page>
    );
  }
  return (
    <Page title="Stop these emails?" width="prose">
      <p>
        <strong>{s.address}</strong> gets an email {HOW_OFTEN[s.frequency]} about reports newly
        published here. Stopping them stops all of them, from every logbook.
      </p>
      <p>Nothing has changed yet. The emails stop only when you press the button.</p>
      <div>
        <Button
          type="button"
          disabled={stop.isPending}
          onClick={() => {
            stop.mutate();
          }}
        >
          Stop these emails
        </Button>
      </div>
      <ErrorText error={stop.error} />
    </Page>
  );
}
