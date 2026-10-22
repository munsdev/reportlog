/**
 * Join the journalist alert list: /journalists/alerts.
 *
 * Four questions and nothing else: a name, an outlet, an address and the
 * states covered. The answer is the same whether or not the address was
 * already known. Joining grants no access to anything; the page says so, and
 * links the legal notice and privacy policy before anything is sent.
 */
import { signUpForAlerts } from '@reportlog/contracts';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { CardError } from '../form/CardFrame.tsx';
import { PublicPage } from '../site-pages/PublicPage.tsx';
import { call } from '../../lib/api.ts';
import { StatesPicker } from './StatesPicker.tsx';

export function SignupPage() {
  const [name, setName] = useState('');
  const [outlet, setOutlet] = useState('');
  const [email, setEmail] = useState('');
  const [states, setStates] = useState<string[]>([]);
  const [noStates, setNoStates] = useState(false);
  const signUp = useMutation({
    mutationFn: () => call(signUpForAlerts, { body: { name, outlet, email, states } }),
  });

  if (signUp.isSuccess) {
    return (
      <PublicPage title="Check your email" width="prose">
        <p role="status">
          If that address is not on the list yet, we have sent it a link. Open the link and press
          the button on its page to join. Nothing is added until you do.
        </p>
      </PublicPage>
    );
  }
  return (
    <PublicPage
      title="Journalist alerts"
      width="prose"
      lede="An email when new approved reports appear in the states you cover. It says how many, and nothing more."
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!states.length) {
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
          <Label>Your outlet</Label>
          <Input
            autoComplete="organization"
            required
            maxLength={160}
            value={outlet}
            onChange={(e) => {
              setOutlet(e.target.value);
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
        <div className="flex flex-col gap-2">
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
        <Card variant="quiet">
          <p className="font-semibold">Joining gives you no access to anything.</p>
          <p className="text-ink-alt">
            We keep only these four answers, encrypted. We email a link to confirm; you are on the
            list only after you press its button. Every alert carries a link to leave. Read the{' '}
            <Link to="/legal" className="underline underline-offset-2">
              imprint and privacy policy
            </Link>
            .
          </p>
        </Card>
        {signUp.isError ? (
          <Alert tone="serious" title="You were not added">
            {signUp.error.message}
          </Alert>
        ) : null}
        <div className="flex flex-col sm:items-start">
          <Button
            type="submit"
            size="lg"
            block
            className="sm:w-auto"
            busy={signUp.isPending}
            busyLabel="Sending…"
          >
            Join the list
          </Button>
        </div>
      </form>
    </PublicPage>
  );
}
