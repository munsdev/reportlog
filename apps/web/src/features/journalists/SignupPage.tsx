/**
 * Alerts and desk access: /journalists/alerts. `askForAccess` (from the
 * landing page's second card) starts with the desk-access box ticked.
 *
 * One sign-up for alerts, desk access, or both (owner decision 69). A name
 * and an address; then, each behind its own tick, the states to get alerts
 * about and the request for desk access. Somebody who wants only the desk
 * leaves alerts unticked. The sections open only when their box is ticked
 * by the person filling it in, so nothing changes underneath anybody.
 *
 * The answer is the same whether or not the address was already known.
 * Joining grants no access to anything; the page says so, and links the
 * legal notice and privacy policy before anything is sent.
 */
import { signUpForAlerts } from '@reportlog/contracts';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { CheckOption, Choices } from '@/mockup/Choice.tsx';
import { Field, Input, Label } from '@/mockup/Field.tsx';
import { FollowBand } from '../follow/FollowBand.tsx';
import { CardError } from '../form/CardFrame.tsx';
import { PublicPage } from '../site-pages/PublicPage.tsx';
import { call } from '../../lib/api.ts';
import { AccessFields, accessBody, EMPTY_ACCESS } from './AccessFields.tsx';
import { StatesPicker } from './StatesPicker.tsx';
import { useMe } from '../identity/session.ts';
import { AccountAlerts, DeskCard } from './Account.tsx';

/**
 * Signed in, the page is the account's own (decision 80): alert settings with
 * no name or address, and the desk card. Signed out, it is the sign-up form
 * below, with signing in offered as the easier way.
 */
export function SignupPage({ askForAccess = false }: { askForAccess?: boolean }) {
  const me = useMe();
  if (me.isPending) {
    return (
      <PublicPage title="Alerts and desk access" width="prose">
        <p role="status">Loading…</p>
      </PublicPage>
    );
  }
  if (me.data?.signedIn) {
    return (
      <PublicPage
        title="Alerts and desk access"
        width="prose"
        lede="You are signed in, so there is nothing to retype and no link to confirm. An email when new approved reports appear in the states you choose. It says how many, and nothing more."
      >
        <div className="form-stack">
          <AccountAlerts />
          <DeskCard />
        </div>
      </PublicPage>
    );
  }
  return <SignupForm askForAccess={askForAccess} />;
}

function SignupForm({ askForAccess }: { askForAccess: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [alerts, setAlerts] = useState(true);
  const [states, setStates] = useState<string[]>([]);
  const [noStates, setNoStates] = useState(false);
  const [asking, setAsking] = useState(askForAccess);
  const [draft, setDraft] = useState(EMPTY_ACCESS);
  const [nothing, setNothing] = useState(false);
  const signUp = useMutation({
    mutationFn: () => {
      const { outlet, ...access } = accessBody(draft);
      return call(signUpForAlerts, {
        body: {
          name,
          email,
          alerts: alerts ? 'on' : 'off',
          states: alerts ? states : [],
          ...(asking ? { outlet, access } : {}),
        },
      });
    },
  });

  if (signUp.isSuccess) {
    return (
      <PublicPage title="Check your email" width="prose">
        <p role="status">
          If that address is not on the list yet, we have sent it a link. Open the link and press
          the button on its page to join. Nothing is added until you do.
        </p>
        {asking ? (
          <p>
            Pressing it also sends your request for desk access to the owner. If the address is
            already on the list, we have sent it a link to the request form instead.
          </p>
        ) : null}
        <FollowBand placement="after_tip" />
      </PublicPage>
    );
  }
  return (
    <PublicPage
      title="Alerts and desk access"
      width="prose"
      lede="An email when new approved reports appear in the states you cover. It says how many, and nothing more. Journalists can ask for access to the journalist desk here too."
    >
      <Panel kind="quiet">
        <p>
          <b>Have an account? Sign in instead.</b>
        </p>
        <p className="muted">
          It is the easier way: you type no name or address, there is no link to confirm, and you
          can see where a request for the desk stands.{' '}
          <Link to="/access/sign-in" search={{ next: '/journalists/alerts' }}>
            Sign in
          </Link>
        </p>
      </Panel>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!alerts && !asking) {
            setNothing(true);
            return;
          }
          if (alerts && !states.length) {
            setNoStates(true);
            return;
          }
          signUp.mutate();
        }}
      >
        <Field>
          <Label>Your name</Label>
          <Input
            autoComplete="name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
        <Field>
          <Label>Your email address</Label>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </Field>
        <Choices role="group" aria-label="What you are signing up for">
          <CheckOption
            label="Send me alerts"
            hint="An email when new approved reports appear in the states you choose."
            checked={alerts}
            onCheckedChange={(on) => {
              setNothing(false);
              setNoStates(false);
              setAlerts(on === true);
            }}
          />
          <CheckOption
            label="I am a journalist and want access to the journalist desk"
            hint="Vetted journalists read links moderators have checked. The owner reads every request; nothing is approved automatically. You can have desk access without alerts."
            checked={asking}
            onCheckedChange={(on) => {
              setNothing(false);
              setAsking(on === true);
            }}
          />
        </Choices>
        {nothing ? <CardError>Choose alerts, desk access, or both.</CardError> : null}
        {alerts ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <StatesPicker
              value={states}
              invalid={noStates}
              onChange={(next) => {
                setNoStates(false);
                setStates(next);
              }}
            />
            {noStates ? <CardError>Choose at least one state.</CardError> : null}
          </div>
        ) : null}
        {asking ? (
          <section aria-labelledby="signup-desk" className="form-stack">
            <h2 id="signup-desk" className="h-page" style={{ fontSize: '1.4rem' }}>
              Your request for desk access
            </h2>
            <AccessFields value={draft} onChange={setDraft} />
          </section>
        ) : null}
        <Panel kind="quiet">
          <p>
            <b>Joining gives you no access to anything.</b>
          </p>
          <p className="muted">
            Desk access starts only if the owner approves your request. We keep only these answers,
            encrypted. We email a link to confirm; you are on the list only after you press its
            button. Every alert carries a link to leave. Read the{' '}
            <Link to="/legal">imprint and privacy policy</Link>.
          </p>
        </Panel>
        {signUp.isError ? (
          <Note tone="serious" title="You were not added">
            {signUp.error.message}
          </Note>
        ) : null}
        <div className="btn-row">
          <Btn type="submit" lg busy={signUp.isPending} busyLabel="Sending…">
            Join the list
          </Btn>
        </div>
      </form>
    </PublicPage>
  );
}
