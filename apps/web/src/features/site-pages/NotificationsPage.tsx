/**
 * Email updates: how often to hear about newly published reports, and from
 * which logbooks. For anybody signed in, staff or not.
 *
 * Only what the public board shows is ever emailed. "Every logbook" is a box
 * of its own, ticked by default, and the list of logbooks appears only when
 * it is unticked: somebody who wants everything never has to tick each one,
 * and a logbook launched later is included without asking.
 */
import { DIGEST_FREQUENCIES, getNotifications, setNotifications } from '@reportlog/contracts';
import type { DigestFrequency, Notifications } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../lib/api.ts';
import { SmBtn as Btn } from '../../mockup/SmBtn.tsx';
import { Choice, Choices } from '../../mockup/Choice.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Panel } from '../../mockup/Panel.tsx';
import { Saved } from '../../mockup/Saved.tsx';
import { useMe } from '../identity/session.ts';
import { SignInPrompt } from '../identity/SignInPrompt.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';

export const notificationsQuery = queryOptions({
  queryKey: ['notifications'],
  queryFn: ({ signal }) => call(getNotifications, { signal }),
});

const FREQUENCY_WORDS: Record<DigestFrequency, { label: string; hint: string }> = {
  none: { label: 'No emails', hint: 'You will not be emailed about published reports.' },
  hourly: {
    label: 'Every hour',
    hint: 'At most one email an hour, only when something new is published.',
  },
  weekly: {
    label: 'Once a week',
    hint: 'One email on Monday morning, only if something new was published.',
  },
};

export function NotificationsPage() {
  const me = useMe();
  const query = useQuery({ ...notificationsQuery, enabled: Boolean(me.data?.signedIn) });
  return (
    <StaffPage
      area="Account"
      title="Email updates"
      lede="What you hear about new published reports. Only what anybody can read on the board is ever emailed."
    >
      {me.isPending || (me.data?.signedIn && query.isPending) ? (
        <p role="status">Loading…</p>
      ) : null}
      {me.data && !me.data.signedIn ? <SignInPrompt next="/notifications" /> : null}
      <ErrorLine error={query.error} />
      {query.data ? <NotificationsForm current={query.data} /> : null}
    </StaffPage>
  );
}

export function NotificationsForm({ current }: { current: Notifications }) {
  const client = useQueryClient();
  const [frequency, setFrequency] = useState<DigestFrequency>(current.frequency);
  const [all, setAll] = useState(current.logbooks === null);
  const [picked, setPicked] = useState<string[]>(current.logbooks ?? []);
  const save = useMutation({
    mutationFn: () =>
      call(setNotifications, { body: { frequency, logbooks: all ? null : picked } }),
    onSuccess: (data) => {
      client.setQueryData(notificationsQuery.queryKey, data);
    },
  });
  const nothingPicked = frequency !== 'none' && !all && picked.length === 0;

  return (
    <form
      className="col"
      onSubmit={(e) => {
        e.preventDefault();
        if (!nothingPicked) save.mutate();
      }}
    >
      <Panel title="How often">
        <Choices>
          {DIGEST_FREQUENCIES.map((f) => (
            <Choice
              key={f}
              name="often"
              checked={frequency === f}
              onChange={() => {
                setFrequency(f);
              }}
            >
              {FREQUENCY_WORDS[f].label}
              <span className="m"> {FREQUENCY_WORDS[f].hint}</span>
            </Choice>
          ))}
        </Choices>
      </Panel>

      {frequency !== 'none' ? (
        <Panel title="From which logbooks">
          <Choices>
            <Choice
              multi
              name="lb"
              checked={all}
              onChange={(e) => {
                setAll(e.target.checked);
              }}
            >
              Every logbook, including new ones
            </Choice>
            {!all ? (
              <>
                {current.choices.length === 0 ? <p>No logbook has been launched yet.</p> : null}
                {current.choices.map((c) => (
                  <Choice
                    multi
                    key={c.slug}
                    name="lb"
                    checked={picked.includes(c.slug)}
                    onChange={(e) => {
                      setPicked(
                        e.target.checked ? [...picked, c.slug] : picked.filter((s) => s !== c.slug),
                      );
                    }}
                  >
                    {c.title}
                  </Choice>
                ))}
              </>
            ) : null}
          </Choices>
          {!all && nothingPicked ? (
            <p role="alert" className="error">
              Choose at least one logbook, or tick “Every logbook”.
            </p>
          ) : null}
        </Panel>
      ) : null}

      <ErrorLine error={save.error} />
      <div className="acts">
        <Btn kind="go" type="submit" disabled={save.isPending || nothingPicked}>
          Save
        </Btn>
      </div>
      {save.isSuccess ? (
        <Saved>
          {save.data.frequency === 'none'
            ? 'Saved. You will not be emailed.'
            : `Saved. You will be emailed ${save.data.frequency === 'hourly' ? 'at most once an hour' : 'once a week'}.`}
        </Saved>
      ) : null}
    </form>
  );
}
