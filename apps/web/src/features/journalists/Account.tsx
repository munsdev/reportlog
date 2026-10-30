/**
 * A signed-in account on the journalist pages (owner decision 80): its alert
 * settings with no name or address to retype, and one card for the journalist
 * desk that says where the request stands.
 *
 * Used by /journalists, /journalists/alerts and /desk (for an account without
 * the role). Signing in already proved the address, so there is no
 * confirmation link; applying is one step that includes accepting the
 * agreement, on the words that are on screen (their digest goes with it).
 * Nothing changes under the person: the form opens as the card first
 * rendered it and a status changes only when they, or a refetch after their
 * own action, say so.
 *
 * These are NOT door calls: the emailed-link pages (confirm, stop, settings,
 * access) never render this.
 */
import { applyForDesk, changeMyAlerts, getMyJournalist } from '@reportlog/contracts';
import type { AlertSettingsBody, MyJournalist } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Btn } from '@/mockup/Btn.tsx';
import { CheckOption, Choices } from '@/mockup/Choice.tsx';
import { Field } from '@/mockup/Qcard.tsx';
import { ErrorNote, Note, Waiting } from '@/mockup/Note.tsx';
import { call } from '../../lib/api.ts';
import { agreementQuery } from '../platform/Agreement.tsx';
import { AccessFields, accessBody, EMPTY_ACCESS } from './AccessFields.tsx';
import { SettingsForm } from './AlertSettings.tsx';

export const myJournalistQuery = queryOptions({
  queryKey: ['journalists', 'me'],
  queryFn: ({ signal }) => call(getMyJournalist, { signal }),
});

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });

/** The signed-in account's alert settings, saved at once and confirmed by an email. */
export function AccountAlerts() {
  const client = useQueryClient();
  const state = useQuery(myJournalistQuery);
  const save = useMutation({
    mutationFn: (body: AlertSettingsBody) => call(changeMyAlerts, { body }),
    onSuccess: (data) => {
      client.setQueryData(myJournalistQuery.queryKey, data);
    },
  });
  if (state.isPending) return <Waiting>Loading your alert settings…</Waiting>;
  if (state.isError) return <ErrorNote error={state.error} />;
  const s = state.data;
  return (
    <>
      <SettingsForm
        title="Your alerts"
        initial={{
          state: 'open',
          address: '',
          states: s.states,
          // Not on the list yet: alerts start ticked, as on the sign-up form.
          alerts: s.listed ? s.alerts : 'on',
          desk: 'none',
        }}
        saving={save.isPending}
        error={save.error}
        onSave={(body) => save.mutateAsync(body)}
      />
      <p className="muted">
        {s.listed
          ? 'Changes apply at once. We email you what changed, with a link to change it again or turn alerts off.'
          : 'You are not on the alert list yet. Saving adds this account’s address, with no link to confirm. We email you what changed.'}
      </p>
    </>
  );
}

/** The journalist desk: where this account's request stands, or the one form to make it. */
export function DeskCard() {
  const client = useQueryClient();
  const state = useQuery(myJournalistQuery);
  const status = state.data?.desk;
  // Approved while this page was open: the role is read again, so the desk opens.
  useEffect(() => {
    if (status === 'approved') void client.invalidateQueries({ queryKey: ['identity'] });
  }, [status, client]);
  if (state.isPending) return <Waiting>Loading…</Waiting>;
  if (state.isError) return <ErrorNote error={state.error} />;
  const s = state.data;
  return (
    <section className="panel" aria-labelledby="desk-card">
      <h2 id="desk-card">Journalist desk</h2>
      <DeskBody s={s} />
    </section>
  );
}

function DeskBody({ s }: { s: MyJournalist }) {
  switch (s.desk) {
    case 'staff':
      return (
        <p role="status">
          Desk access is not available to staff accounts. A journalist cannot also hold a staff
          role.
        </p>
      );
    case 'pending':
      return (
        <p role="status">
          Your request is pending
          {s.requested_at ? ` since ${when(s.requested_at)}` : ''}. The people who run this site
          read every request, and we email you when it is decided. Nothing is approved
          automatically.
        </p>
      );
    case 'approved':
      return (
        <>
          <p role="status">You have access to the journalist desk.</p>
          <div className="btn-row">
            <Link className="btn go" to="/desk">
              Open the desk
            </Link>
          </div>
        </>
      );
    case 'none':
    case 'not_approved':
    case 'ended':
      return (
        <>
          {s.desk === 'not_approved' ? (
            <Note>
              Your last request was not approved. What you wrote in it has been deleted. You can
              apply again.
            </Note>
          ) : null}
          {s.desk === 'ended' ? (
            <Note>Your access to the desk has ended. You can apply again.</Note>
          ) : null}
          {s.agreement ? (
            <ApplyForm />
          ) : (
            <p>Applications open once the journalist agreement is published.</p>
          )}
        </>
      );
  }
}

/** One form, one button: who you are, the agreement, and your acceptance of it. */
function ApplyForm() {
  const client = useQueryClient();
  const agreement = useQuery(agreementQuery('journalist'));
  const [name, setName] = useState('');
  const [draft, setDraft] = useState(EMPTY_ACCESS);
  const [accepted, setAccepted] = useState(false);
  const [unticked, setUnticked] = useState(false);
  const digest = agreement.data?.current?.digest;
  const apply = useMutation({
    mutationFn: () => {
      if (!digest) throw new Error('The agreement is not loaded.');
      return call(applyForDesk, { body: { ...accessBody(draft), name, agreement_digest: digest } });
    },
    onSuccess: async (data) => {
      client.setQueryData(myJournalistQuery.queryKey, data);
      await client.invalidateQueries({ queryKey: ['agreement', 'journalist'] });
    },
    onError: async () => {
      // The words may have changed: show the new ones, to be read again.
      setAccepted(false);
      await client.invalidateQueries({ queryKey: ['agreement', 'journalist'] });
    },
  });
  if (agreement.isPending) return <Waiting>Loading the agreement…</Waiting>;
  if (agreement.isError) return <ErrorNote error={agreement.error} />;
  const current = agreement.data.current;
  if (!current) return <p>Applications open once the journalist agreement is published.</p>;
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!accepted) {
          setUnticked(true);
          return;
        }
        apply.mutate();
      }}
    >
      <p>
        Text and links only. Nothing is approved automatically, and nothing is sent until you press
        the button.
      </p>
      <Field label="Your name" htmlFor="apply-name">
        <input
          className="input"
          id="apply-name"
          autoComplete="name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <AccessFields value={draft} onChange={setDraft} />
      <div>
        <h3 id="apply-agreement">The journalist agreement</h3>
        <p className="muted">Version {String(current.version)}.</p>
        <div className="paper">
          <p className="whitespace-pre-wrap" data-agreement-text>
            {current.body}
          </p>
        </div>
      </div>
      <Choices role="group" aria-label="The agreement">
        <CheckOption
          label="I have read the journalist agreement and I accept it."
          checked={accepted}
          onCheckedChange={(on) => {
            setUnticked(false);
            setAccepted(on === true);
          }}
        />
      </Choices>
      {unticked ? <Note tone="serious">Tick the box to accept the agreement.</Note> : null}
      <ErrorNote error={apply.error} />
      <div className="btn-row">
        <Btn look="go" type="submit" busy={apply.isPending} busyLabel="Sending…">
          Apply for desk access
        </Btn>
      </div>
    </form>
  );
}
