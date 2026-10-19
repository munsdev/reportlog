/**
 * First-run setup: who owns this deployment, then the site password.
 *
 * The owner proves their address with a code, which also proves mail works
 * here. Then a decision about the curtain password that cannot be skipped:
 * the password the installer chose would otherwise stay live in a deployment
 * that is no longer theirs. Choosing an option highlights it and moves
 * nothing; the button does.
 */
import { decideCurtain } from '@reportlog/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';
import { call } from '../../lib/api.ts';
import { meQuery } from './session.ts';
import { SignInForm } from './SignInForm.tsx';
import { ErrorText, TextField } from './ui.tsx';

export function SetupWizard({
  status,
  onFinished,
}: {
  status: { hasOwner: boolean; minPassword: number };
  onFinished: () => Promise<void>;
}) {
  const me = useQuery(meQuery);
  const [seated, setSeated] = useState(false);
  const isOwner = seated || (me.data?.signedIn === true && me.data.role === 'owner');

  return (
    <main id="main" className="mx-auto w-full max-w-xl space-y-8 px-4 py-12">
      <header className="space-y-2">
        <p className="text-sm font-semibold text-muted">Setting up · step {isOwner ? 2 : 1} of 2</p>
        <h1 className="font-display text-3xl font-bold">
          {isOwner ? 'The site password' : 'Who will own this deployment?'}
        </h1>
      </header>
      {isOwner ? (
        <CurtainDecision minPassword={status.minPassword} onFinished={onFinished} />
      ) : status.hasOwner ? (
        <section className="space-y-4">
          <p>
            This deployment already has an owner, who has not finished setting it up. Sign in as the
            owner to finish.
          </p>
          <SignInForm
            onSignedIn={async () => {
              await me.refetch();
            }}
          />
        </section>
      ) : (
        <SignInForm
          purpose="setup"
          intro="The owner is the one person who appoints administrators and can hand the deployment on. We will email a code to prove the address is yours, and that email works here."
          onSignedIn={async () => {
            setSeated(true);
            await me.refetch();
          }}
        />
      )}
    </main>
  );
}

function CurtainDecision({
  minPassword,
  onFinished,
}: {
  minPassword: number;
  onFinished: () => Promise<void>;
}) {
  const name = useId();
  const [decision, setDecision] = useState<'keep' | 'change' | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const finish = useMutation({
    mutationFn: () =>
      call(decideCurtain, {
        body:
          decision === 'change'
            ? { decision, password, passwordConfirm: confirm }
            : { decision: decision ?? '' },
      }),
    onSuccess: onFinished,
  });

  const choice = (value: 'keep' | 'change', title: string, detail: string) => (
    <label
      className={cn(
        'grid cursor-pointer grid-cols-[auto_1fr] gap-x-3 rounded-card border bg-surface p-4',
        decision === value ? 'border-ink' : 'border-line',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={decision === value}
        onChange={() => {
          setDecision(value);
        }}
        className="mt-1"
      />
      <span className="font-semibold">{title}</span>
      <span className="col-start-2 text-sm text-ink-alt">{detail}</span>
    </label>
  );

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        finish.mutate();
      }}
    >
      <p>
        Whoever installed this deployment chose its site password. Decide whether to keep it. There
        is no default: keeping somebody else’s password should be a choice, not an accident.
      </p>
      <fieldset className="space-y-3">
        <legend className="sr-only">Keep or change the site password</legend>
        {choice('change', 'Change it', 'Choose a new password. The old one stops working at once.')}
        {choice('keep', 'Keep it', 'Everybody who has it now keeps getting in.')}
      </fieldset>
      {decision === 'change' && (
        <div className="space-y-4">
          <TextField
            label="New site password"
            hint={`At least ${String(minPassword)} characters.`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
          <TextField
            label="The same password again"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
            }}
          />
        </div>
      )}
      <ErrorText error={finish.error} />
      <Button type="submit" disabled={finish.isPending || decision === null}>
        Finish setting up
      </Button>
    </form>
  );
}
