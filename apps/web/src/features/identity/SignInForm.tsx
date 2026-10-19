/**
 * Signing in: an address, then the code emailed to it. Two steps, one
 * question each, and nothing moves until the person presses the button.
 *
 * Used by the sign-in page and by the setup wizard's resume step, with the
 * routes to call passed in, because the wizard's first code seats the owner
 * and an ordinary one never changes anybody's role.
 */
import { claimOwnership, requestSetupCode, requestSignInCode, signIn } from '@reportlog/contracts';
import type { Me } from '@reportlog/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { call } from '../../lib/api.ts';
import { ErrorText, TextField } from './ui.tsx';

export function SignInForm({
  purpose = 'sign-in',
  intro,
  onSignedIn,
}: {
  purpose?: 'sign-in' | 'setup';
  intro?: string;
  onSignedIn: (me: Me) => void | Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  const ask = useMutation({
    mutationFn: () =>
      call(purpose === 'setup' ? requestSetupCode : requestSignInCode, { body: { email } }),
    onSuccess: () => {
      setSentTo(email.trim());
      setCode('');
    },
  });
  const verify = useMutation({
    mutationFn: () =>
      call(purpose === 'setup' ? claimOwnership : signIn, {
        body: { email: sentTo ?? email, code },
      }),
    onSuccess: onSignedIn,
  });

  if (!sentTo) {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          ask.mutate();
        }}
      >
        {intro && <p className="text-ink-alt">{intro}</p>}
        <TextField
          label="Your email address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <ErrorText error={ask.error} />
        <Button type="submit" disabled={ask.isPending}>
          Send me a code
        </Button>
      </form>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        verify.mutate();
      }}
    >
      <p>
        We sent a six-digit code to <strong>{sentTo}</strong>. It works for ten minutes.
      </p>
      <TextField
        label="The code from the email"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={code}
        onChange={(e) => {
          setCode(e.target.value.replace(/\D/g, ''));
        }}
      />
      <ErrorText error={verify.error} />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={verify.isPending}>
          {purpose === 'setup' ? 'Become the owner' : 'Sign in'}
        </Button>
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            setSentTo(null);
            verify.reset();
          }}
        >
          Use a different address
        </Button>
      </div>
    </form>
  );
}
