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
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Alert } from '@/components/ui/alert.tsx';
import { Card } from '@/components/ui/card.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Label } from '@/components/ui/label.tsx';
import { PublicPage } from '../site-pages/PublicPage.tsx';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';
import { call } from '../../lib/api.ts';
import { CardError } from '../form/CardFrame.tsx';
import { ErrorText } from '../identity/ui.tsx';
import { StatesPicker } from './StatesPicker.tsx';

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
  const [alerts, setAlerts] = useState<'on' | 'off'>(initial.alerts);
  const [states, setStates] = useState<string[]>(initial.states);
  const [saved, setSaved] = useState(false);
  const [noStates, setNoStates] = useState(false);
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        if (!states.length) {
          setNoStates(true);
          return;
        }
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
      <div className="flex flex-col gap-2">
        <StatesPicker
          value={states}
          invalid={noStates}
          onChange={(next) => {
            setSaved(false);
            setNoStates(false);
            setStates(next);
          }}
        />
        {noStates ? <CardError>Choose at least one state.</CardError> : null}
      </div>
      <ErrorText error={error} />
      {saved ? (
        <Alert tone="done">
          Your alert settings are saved.
          {alerts === 'on' && initial.alerts === 'off'
            ? ' Alerts start again from now. Nothing you missed is sent.'
            : ''}
        </Alert>
      ) : null}
      <div>
        <Button type="submit" busy={saving} busyLabel="Saving…">
          Save
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
          It may have expired or not been copied whole. Every alert carries its own link. If you
          removed yourself from the list, there is nothing more to do.
        </p>
      </PublicPage>
    );
  }
  if (s.state === 'removed') {
    return (
      <PublicPage title="You are off the alert list" width="prose">
        <p role="status">
          No more alerts will be emailed, your details are deleted, and any journalist desk access
          has ended.
        </p>
      </PublicPage>
    );
  }
  return (
    <PublicPage title="Change your alerts" width="prose">
      <p>
        Alerts for <strong>{s.address}</strong>. Nothing changes until you press a button.
      </p>
      <SettingsForm
        initial={s}
        saving={save.isPending}
        error={save.error}
        onSave={(body) => save.mutateAsync(body)}
      />
      <Card variant="plain" heading="Remove me from the list entirely" className="mt-6">
        <p>
          This deletes your name, outlet and address from the journalist alert list. If you have
          access to the journalist desk, it ends that too, and getting it back means joining the
          list and asking again.
        </p>
        <p>
          To stop alerts but keep your place and any desk access, turn alerts off above instead.
        </p>
        <ConfirmRemove
          pending={remove.isPending}
          onConfirm={() => {
            remove.mutate();
          }}
        />
        <ErrorText error={remove.error} />
      </Card>
    </PublicPage>
  );
}

/**
 * Leaving asks again first (decision 46): it deletes the person's details and
 * ends any desk access, and cannot be undone from here. Secondary, never the
 * action colour: a destructive act is not the thing anybody came to do.
 */
function ConfirmRemove({ pending, onConfirm }: { pending: boolean; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div>
        <DialogTrigger asChild>
          <Button type="button" variant="secondary">
            Remove me from the list entirely
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove yourself from the list?</DialogTitle>
          <DialogDescription>
            Your name, outlet and address are deleted, and any journalist desk access ends.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="quiet">
              Keep me on the list
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="secondary"
            busy={pending}
            busyLabel="Removing…"
            onClick={onConfirm}
          >
            Remove me
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
