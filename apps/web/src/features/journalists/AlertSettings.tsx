/**
 * Changing your journalist alerts (owner decision 47): which states, and on
 * or off. Two places use the same form:
 *
 * - /journalists/settings/:token, the "Change your alerts" link in every
 *   alert. A door: no sign-in, no site password. Opening it changes
 *   nothing; only the buttons do. It also offers removing yourself from the
 *   list entirely, kept apart from the form and worded so nobody does it
 *   by mistake, because that also ends desk access.
 * - The desk, for a signed-in journalist's own subscription, so they need
 *   no email to change it.
 *
 * Turning alerts off keeps a person on the list, with any desk access.
 */
import {
  changeAlertSettings,
  changeDeskAlerts,
  deskAlertSettings,
  describeAlertSettings,
  leaveAlertList,
} from '@reportlog/contracts';
import type { AlertSettings, AlertSettingsBody } from '@reportlog/contracts';
import { placeOptions } from '@reportlog/fields';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { CheckOption } from '@/components/ui/choice.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';
import { call } from '../../lib/api.ts';
import { ErrorText } from '../identity/ui.tsx';

const STATES = placeOptions({ scope: 'us' }).subdivisions;

type Open = Extract<AlertSettings, { state: 'open' }>;

function SettingsForm({
  initial,
  saving,
  error,
  onSave,
}: {
  initial: Open;
  saving: boolean;
  error: unknown;
  onSave: (body: AlertSettingsBody) => Promise<unknown>;
}) {
  const idBase = useId();
  const [alerts, setAlerts] = useState<'on' | 'off'>(initial.alerts);
  const [states, setStates] = useState<string[]>(initial.states);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        // A failure is shown by the caller's error; nothing to do here.
        onSave({ alerts, states }).then(
          () => {
            setSaved(true);
          },
          () => undefined,
        );
      }}
    >
      <Field>
        <Label>Alerts</Label>
        <RadioGroup
          value={alerts}
          onValueChange={(v) => {
            setAlerts(v === 'off' ? 'off' : 'on');
            setSaved(false);
          }}
        >
          <RadioOption value="on" label="Send me alerts" />
          <RadioOption value="off" label="Turn alerts off for now (you stay on the list)" />
        </RadioGroup>
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold">States you cover</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {STATES.map((s) => (
            <CheckOption
              key={s.code}
              label={s.name}
              id={`${idBase}-${s.code}`}
              checked={states.includes(s.code)}
              onCheckedChange={(on) => {
                setSaved(false);
                setStates(on === true ? [...states, s.code] : states.filter((x) => x !== s.code));
              }}
            />
          ))}
        </div>
      </fieldset>
      <ErrorText error={error} />
      {saved ? <p role="status">Your alert settings are saved.</p> : null}
      <div>
        <Button type="submit" disabled={saving || states.length === 0}>
          Save my alert settings
        </Button>
      </div>
    </form>
  );
}

const linkQuery = (token: string) =>
  queryOptions({
    queryKey: ['alert-settings', token],
    queryFn: ({ signal }) => call(describeAlertSettings, { params: { token }, signal }),
    retry: false,
  });

/** The page behind "Change your alerts" in an alert email. */
export function AlertSettingsPage({ token }: { token: string }) {
  const client = useQueryClient();
  const state = useQuery(linkQuery(token));
  const keep = (data: AlertSettings) => {
    client.setQueryData(linkQuery(token).queryKey, data);
  };
  const save = useMutation({
    mutationFn: (body: AlertSettingsBody) => call(changeAlertSettings, { params: { token }, body }),
    onSuccess: keep,
  });
  const remove = useMutation({
    mutationFn: () => call(leaveAlertList, { params: { token } }),
    onSuccess: keep,
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
          It may have expired or not been copied whole. Every alert carries its own link. If you
          removed yourself from the list, there is nothing more to do.
        </p>
      </Page>
    );
  }
  if (s.state === 'removed') {
    return (
      <Page title="You are off the alert list" width="prose">
        <p role="status">
          No more alerts will be emailed, your details are deleted, and any journalist desk access
          has ended.
        </p>
      </Page>
    );
  }
  return (
    <Page title="Change your alerts" width="prose">
      <p>
        Alerts for <strong>{s.address}</strong>. Nothing changes until you press a button.
      </p>
      <SettingsForm
        initial={s}
        saving={save.isPending}
        error={save.error}
        onSave={(body) => save.mutateAsync(body)}
      />
      <section
        aria-labelledby="remove-me"
        className="mt-8 flex flex-col gap-3 border-t border-border pt-6"
      >
        <h2 id="remove-me" className="font-display text-xl font-bold">
          Remove me from the list entirely
        </h2>
        <p>
          This deletes your name, outlet and address from the journalist alert list. If you have
          access to the journalist desk, it ends that too, and getting it back means joining the
          list and asking again.
        </p>
        <p>
          To stop alerts but keep your place and any desk access, turn alerts off above instead.
        </p>
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate();
            }}
          >
            Remove me from the list entirely
          </Button>
        </div>
        <ErrorText error={remove.error} />
      </section>
    </Page>
  );
}

const deskQuery = queryOptions({
  queryKey: ['desk', 'alerts'],
  queryFn: ({ signal }) => call(deskAlertSettings, { signal }),
});

/** The desk's own section: the signed-in journalist's alerts, no email needed. */
export function DeskAlerts() {
  const client = useQueryClient();
  const state = useQuery(deskQuery);
  const save = useMutation({
    mutationFn: (body: AlertSettingsBody) => call(changeDeskAlerts, { body }),
    onSuccess: (data) => {
      client.setQueryData(deskQuery.queryKey, data);
    },
  });
  return (
    <section aria-labelledby="desk-alerts" className="flex flex-col gap-4">
      <h2 id="desk-alerts" className="font-display text-xl font-bold">
        Your alerts
      </h2>
      {state.isPending ? <p role="status">Loading your alert settings…</p> : null}
      {state.isError ? <ErrorText error={state.error} /> : null}
      {state.data?.state === 'open' ? (
        <SettingsForm
          initial={state.data}
          saving={save.isPending}
          error={save.error}
          onSave={(body) => save.mutateAsync(body)}
        />
      ) : null}
    </section>
  );
}
