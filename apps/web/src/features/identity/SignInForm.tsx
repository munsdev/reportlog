/**
 * Signing in: an address, then the code emailed to it. Two steps, one
 * question each, and nothing moves until the person presses the button.
 *
 * Used by the sign-in page and by the setup wizard's resume step, with the
 * routes to call passed in, because the wizard's first code seats the owner
 * and an ordinary one never changes anybody's role.
 *
 * Somebody with a role then proves a second factor, or sets the first one
 * up (plan E, E3), before `onSignedIn` is called: the email code alone signs
 * a role holder in to nothing.
 *
 * Each step is one raised panel whose content is replaced by the next; the
 * page around it stays (account.md §02).
 */
import { claimOwnership, requestSetupCode, requestSignInCode, signIn } from '@reportlog/contracts';
import type { Me } from '@reportlog/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { call } from '../../lib/api.ts';
import { SecondFactorGate, pendingSecondFactor } from './secondFactor.tsx';
import { meQuery, useMe } from './session.ts';
import { Field } from '../../mockup/Qcard.tsx';
import { messageOf } from './ui.tsx';

export function SignInForm({
  purpose = 'sign-in',
  intro,
  onSignedIn,
  onStep,
}: {
  purpose?: 'sign-in' | 'setup';
  intro?: string;
  onSignedIn: (me: Me) => void | Promise<void>;
  /** Which of the two steps is showing, so the page can head it (mock-up sign-in.html). */
  onStep?: (step: 'email' | 'code') => void;
}) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const errorId = useId();
  // A refusal is announced as it appears (role="alert"), and the field it is
  // about is marked and points at it, so somebody who goes back to the field
  // hears why it was refused rather than only that something was.
  const refused = (error: unknown) =>
    error ? { 'aria-invalid': true as const, 'aria-describedby': errorId } : {};

  const ask = useMutation({
    mutationFn: () =>
      call(purpose === 'setup' ? requestSetupCode : requestSignInCode, { body: { email } }),
    onSuccess: () => {
      setSentTo(email.trim());
      setCode('');
      setSecondStep(false);
    },
  });
  const client = useQueryClient();
  const [secondStep, setSecondStep] = useState(false);
  const verify = useMutation({
    mutationFn: () =>
      call(purpose === 'setup' ? claimOwnership : signIn, {
        body: { email: sentTo ?? email, code },
      }),
    onSuccess: async (me) => {
      if (pendingSecondFactor(me)) {
        client.setQueryData(meQuery.queryKey, me);
        setSecondStep(true);
        return;
      }
      await onSignedIn(me);
    },
  });

  // "Not you? Start again" on the second step signs out: back to the start,
  // with the address kept in the box. Read from who is signed in rather than
  // copied into state, so the two cannot disagree.
  const me = useMe();
  const startedAgain = secondStep && me.data?.signedIn === false;

  const step = !sentTo || startedAgain ? 'email' : 'code';
  useEffect(() => {
    onStep?.(step);
  }, [step, onStep]);

  if (secondStep && !startedAgain) {
    return (
      <SecondFactorGate>
        <WhenSignedIn onSignedIn={onSignedIn} />
      </SecondFactorGate>
    );
  }

  if (!sentTo || startedAgain) {
    return (
      <form
        noValidate={false}
        onSubmit={(e) => {
          e.preventDefault();
          ask.mutate();
        }}
      >
        {intro && <p className="muted">{intro}</p>}
        <Field label="Email" htmlFor="si">
          <input
            className="input"
            id="si"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            {...refused(ask.error)}
          />
        </Field>
        {ask.error ? (
          <p id={errorId} role="alert" className="error">
            {messageOf(ask.error)}
          </p>
        ) : null}
        <div className="btn-row" style={{ paddingTop: 14 }}>
          <button className="btn go" type="submit" disabled={ask.isPending}>
            {ask.isPending ? 'Sending…' : 'Send code'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        verify.mutate();
      }}
    >
      <p>
        We sent a six-digit code to <strong>{sentTo}</strong>. It works for ten minutes.
      </p>
      <div className="field" style={{ paddingTop: 20 }}>
        <label htmlFor="si-code" className="lbl">
          The code from the email
        </label>
        <input
          className="input mono"
          id="si-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          style={{ letterSpacing: '.2em', fontSize: '1.3rem', maxWidth: 220 }}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ''));
          }}
          {...refused(verify.error)}
        />
      </div>
      {verify.error ? (
        <p id={errorId} role="alert" className="error">
          {messageOf(verify.error)}
        </p>
      ) : null}
      <div className="btn-row" style={{ paddingTop: 14 }}>
        <button className="btn go" type="submit" disabled={verify.isPending}>
          {verify.isPending ? 'Checking…' : purpose === 'setup' ? 'Become the owner' : 'Sign in'}
        </button>
        <button
          className="btn sm flat ghost"
          type="button"
          onClick={() => {
            // The address is kept in the box, to correct rather than retype.
            setSentTo(null);
            verify.reset();
          }}
        >
          Use a different address
        </button>
      </div>
    </form>
  );
}

/** Past the second factor: hands on who is now signed in, once. */
function WhenSignedIn({ onSignedIn }: { onSignedIn: (me: Me) => void | Promise<void> }) {
  const me = useMe();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !me.data?.signedIn || pendingSecondFactor(me.data)) return;
    done.current = true;
    void onSignedIn(me.data);
  }, [me.data, onSignedIn]);
  return (
    <p role="status" className="muted">
      Signed in.
    </p>
  );
}
