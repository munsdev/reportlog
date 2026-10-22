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
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { CheckOption } from '../../components/ui/choice.tsx';
import { Field } from '../../components/ui/field.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
import { call } from '../../lib/api.ts';
import { useMe } from '../identity/session.ts';
import { SignInPrompt } from '../identity/SignInPrompt.tsx';

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
    <Page
      title="Email updates"
      width="prose"
      lede="Hear about reports when a moderator publishes them. Only what anybody can read on the board is ever emailed."
    >
      {me.isPending || (me.data?.signedIn && query.isPending) ? (
        <p role="status">Loading…</p>
      ) : null}
      {me.data && !me.data.signedIn ? <SignInPrompt next="/notifications" /> : null}
      {query.isError ? (
        <Alert tone="serious" title="Your choice could not be loaded.">
          {query.error.message}
        </Alert>
      ) : null}
      {query.data ? <NotificationsForm current={query.data} /> : null}
    </Page>
  );
}

export function NotificationsForm({ current }: { current: Notifications }) {
  const client = useQueryClient();
  const allId = useId();
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
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!nothingPicked) save.mutate();
      }}
    >
      <Field>
        <Label>How often</Label>
        <RadioGroup
          value={frequency}
          onValueChange={(v) => {
            setFrequency(v as DigestFrequency);
          }}
        >
          {DIGEST_FREQUENCIES.map((f) => (
            <RadioOption
              key={f}
              value={f}
              label={FREQUENCY_WORDS[f].label}
              hint={FREQUENCY_WORDS[f].hint}
            />
          ))}
        </RadioGroup>
      </Field>

      {frequency !== 'none' ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">From which logbooks</legend>
          <CheckOption
            id={allId}
            checked={all}
            onCheckedChange={(on) => {
              setAll(on === true);
            }}
            label="Every logbook, including ones launched later"
          />
          {!all ? (
            <div className="flex flex-col gap-3 pl-9" data-testid="logbook-choices">
              {current.choices.length === 0 ? <p>No logbook has been launched yet.</p> : null}
              {current.choices.map((c, i) => (
                <CheckOption
                  key={c.slug}
                  id={`${allId}-${String(i)}`}
                  label={c.title}
                  checked={picked.includes(c.slug)}
                  onCheckedChange={(on) => {
                    setPicked(
                      on === true ? [...picked, c.slug] : picked.filter((s) => s !== c.slug),
                    );
                  }}
                />
              ))}
              {nothingPicked ? (
                <p role="alert" className="text-sm">
                  Choose at least one logbook, or tick “Every logbook”.
                </p>
              ) : null}
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {save.isError ? (
        <Alert tone="serious" title="That was not saved.">
          {save.error.message}
        </Alert>
      ) : null}
      {save.isSuccess ? (
        <Alert
          tone="done"
          title={
            save.data.frequency === 'none'
              ? 'Saved. You will not be emailed.'
              : `Saved. You will be emailed ${save.data.frequency === 'hourly' ? 'at most once an hour' : 'once a week'}.`
          }
        />
      ) : null}
      <div>
        <Button type="submit" disabled={save.isPending || nothingPicked}>
          Save
        </Button>
      </div>
    </form>
  );
}
