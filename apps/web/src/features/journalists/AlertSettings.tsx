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
 * Turning alerts off keeps a person on the list, with any desk access, and
 * then no states need be chosen (owner decision 69).
 *
 * The change page also carries the way to ask for desk access, or says
 * where a request stands (decision 69): everybody on the list has this page
 * in every alert, so nobody has to find a separate one.
 */
import {
  changeAlertSettings,
  changeDeskAlerts,
  deskAlertSettings,
  describeAlertSettings,
  leaveAlertList,
  requestAccessFromSettings,
} from '@reportlog/contracts';
import type { AccessRequestBody, AlertSettings, AlertSettingsBody } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { call } from '../../lib/api.ts';
import { Narrow, TokenPage } from '../../mockup/Narrow.tsx';
import { ErrorNote, Note, Waiting } from '@/mockup/Note.tsx';
import { Choice, QError } from '../../mockup/Qcard.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { AccessFields, accessBody, EMPTY_ACCESS } from './AccessFields.tsx';
import { StatesPicker } from './StatesPicker.tsx';

type Open = Extract<AlertSettings, { state: 'open' }>;

function SettingsForm({
  initial,
  saving,
  error,
  onSave,
  title = 'Alerts',
}: {
  initial: Open;
  saving: boolean;
  error: unknown;
  onSave: (body: AlertSettingsBody) => Promise<unknown>;
  title?: string;
}) {
  const [alerts, setAlerts] = useState<'on' | 'off'>(initial.alerts);
  const [states, setStates] = useState<string[]>(initial.states);
  const [saved, setSaved] = useState(false);
  const [noStates, setNoStates] = useState(false);
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        if (alerts === 'on' && !states.length) {
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
      <h2>{title}</h2>
      <div className="choices" role="radiogroup" aria-label={title}>
        <Choice
          name="ja"
          checked={alerts === 'on'}
          onChange={() => {
            setAlerts('on');
            setSaved(false);
          }}
        >
          Send me alerts
        </Choice>
        <Choice
          name="ja"
          checked={alerts === 'off'}
          onChange={() => {
            setAlerts('off');
            setSaved(false);
          }}
        >
          Turn alerts off for now (you stay on the list)
        </Choice>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <StatesPicker
          value={states}
          invalid={noStates}
          onChange={(next) => {
            setSaved(false);
            setNoStates(false);
            setStates(next);
          }}
        />
        {noStates ? <QError>Choose at least one state.</QError> : null}
      </div>
      <ErrorNote error={error} />
      {saved ? (
        <Note>
          Your alert settings are saved.
          {alerts === 'on' && initial.alerts === 'off'
            ? ' Alerts start again from now. Nothing you missed is sent.'
            : ''}
        </Note>
      ) : null}
      <div>
        <button className="btn sm flat ink" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
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

/** The page behind "Change your alerts" in an alert email (mock-up t-j-settings.html). */
export function AlertSettingsPage({ token }: { token: string }) {
  useBodyClass('light', 'form');
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
  const ask = useMutation({
    mutationFn: (body: AccessRequestBody) =>
      call(requestAccessFromSettings, { params: { token }, body }),
    onSuccess: keep,
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
          It may have expired or not been copied whole. Every alert carries its own link. If you
          removed yourself from the list, there is nothing more to do.
        </p>
      </TokenPage>
    );
  }
  if (s.state === 'removed') {
    return (
      <TokenPage title="You are off the alert list">
        <p role="status">
          No more alerts will be emailed, your details are deleted, and any journalist desk access
          has ended.
        </p>
      </TokenPage>
    );
  }
  return (
    <TokenPage title="Change your alerts">
      <p>Alerts for {s.address}. Nothing changes until you press a button.</p>
      <SettingsForm
        initial={s}
        saving={save.isPending}
        error={save.error}
        onSave={(body) => save.mutateAsync(body)}
      />
      <DeskSection
        desk={s.desk}
        sending={ask.isPending}
        error={ask.error}
        onSend={(body) => {
          ask.mutate(body);
        }}
      />
      <section className="panel danger">
        <h2>Remove me from the list entirely</h2>
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
        <ErrorNote error={remove.error} />
      </section>
    </TokenPage>
  );
}

/**
 * Desk access, from the change page (decision 69). The form opens only when
 * the person asks for it, so the page they came to change alerts on stays
 * about alerts until then.
 */
function DeskSection({
  desk,
  sending,
  error,
  onSend,
}: {
  desk: Open['desk'];
  sending: boolean;
  error: unknown;
  onSend: (body: AccessRequestBody) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_ACCESS);
  return (
    <section className="panel">
      <h2>The journalist desk</h2>
      {desk === 'approved' ? (
        <p role="status">
          You have access to the journalist desk.{' '}
          <Link to="/access/sign-in" search={{ next: '/desk' }}>
            Sign in with this address
          </Link>{' '}
          (we email you a code, then you accept the agreement and the desk opens). Turning alerts
          off does not change that.
        </p>
      ) : desk === 'pending' ? (
        <p role="status">
          Your request for access is with the owner. You will get an email when they decide.
        </p>
      ) : open ? (
        <form
          style={{ display: 'grid', gap: 18 }}
          onSubmit={(e) => {
            e.preventDefault();
            onSend(accessBody(draft));
          }}
        >
          <p>
            Text and links only. The owner reads every request; nothing is approved automatically,
            and nothing is sent until you press the button.
          </p>
          <AccessFields value={draft} onChange={setDraft} />
          <ErrorNote error={error} />
          <div>
            <button className="btn sm flat go" type="submit" disabled={sending}>
              {sending ? 'Sending…' : 'Send my request to the owner'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>
            Vetted journalists can read links that moderators have checked. You can have desk access
            with alerts on or off.
          </p>
          <div>
            <button
              className="btn sm flat ink"
              type="button"
              onClick={() => {
                setOpen(true);
              }}
            >
              Ask for access to the journalist desk
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Leaving asks again first (decision 46): it deletes the person's details and
 * ends any desk access, and cannot be undone from here. Never the action
 * colour: a destructive act is not the thing anybody came to do.
 */
function ConfirmRemove({ pending, onConfirm }: { pending: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <div>
        <button
          className="btn sm flat"
          type="button"
          onClick={() => {
            setAsking(true);
          }}
        >
          Remove me
        </button>
      </div>
    );
  }
  return (
    <div role="alertdialog" aria-label="Remove yourself from the list?" className="note warn">
      <span>
        <b>Remove yourself from the list?</b> Your name, outlet and address are deleted, and any
        journalist desk access ends.
        <span className="btn-row" style={{ paddingTop: 10 }}>
          <button
            className="btn sm flat ghost"
            type="button"
            onClick={() => {
              setAsking(false);
            }}
          >
            Keep me on the list
          </button>
          <button className="btn sm flat bad" type="button" disabled={pending} onClick={onConfirm}>
            {pending ? 'Removing…' : 'Remove me'}
          </button>
        </span>
      </span>
    </div>
  );
}

export const deskQuery = queryOptions({
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
    <>
      {state.isPending ? <Waiting>Loading your alert settings…</Waiting> : null}
      {state.isError ? <ErrorNote error={state.error} /> : null}
      {state.data?.state === 'open' ? (
        <SettingsForm
          title="Your alerts"
          initial={state.data}
          saving={save.isPending}
          error={save.error}
          onSave={(body) => save.mutateAsync(body)}
        />
      ) : null}
    </>
  );
}
