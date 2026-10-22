/**
 * Join the journalist alert list: /journalists/alerts.
 *
 * Four questions and nothing else: a name, an outlet, an address and the
 * states covered. The answer is the same whether or not the address was
 * already known. Joining grants no access to anything; the page says so, and
 * links the legal notice and privacy policy before anything is sent.
 */
import { signUpForAlerts } from '@reportlog/contracts';
import { placeOptions } from '@reportlog/fields';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { CheckOption } from '@/components/ui/choice.tsx';
import { Page } from '@/components/ui/page.tsx';
import { call } from '../../lib/api.ts';
import { ErrorText, TextField } from '../identity/ui.tsx';

const STATES = placeOptions({ scope: 'us' }).subdivisions;

export function SignupPage() {
  const idBase = useId();
  const [name, setName] = useState('');
  const [outlet, setOutlet] = useState('');
  const [email, setEmail] = useState('');
  const [states, setStates] = useState<string[]>([]);
  const signUp = useMutation({
    mutationFn: () => call(signUpForAlerts, { body: { name, outlet, email, states } }),
  });

  if (signUp.isSuccess) {
    return (
      <Page title="Check your email" width="prose">
        <p role="status">
          If that address is not on the list yet, we have sent it a link. Open the link and press
          the button on its page to join. Nothing is added until you do.
        </p>
      </Page>
    );
  }
  return (
    <Page
      title="Journalist alerts"
      width="prose"
      lede="An email when new approved reports appear in the states you cover. It says how many, and nothing more."
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (states.length) signUp.mutate();
        }}
      >
        <TextField
          label="Your name"
          autoComplete="name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <TextField
          label="Your outlet"
          autoComplete="organization"
          required
          maxLength={160}
          value={outlet}
          onChange={(e) => {
            setOutlet(e.target.value);
          }}
        />
        <TextField
          label="Your email address"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
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
                  setStates(on === true ? [...states, s.code] : states.filter((x) => x !== s.code));
                }}
              />
            ))}
          </div>
        </fieldset>
        <ErrorText error={signUp.error} />
        <div>
          <Button type="submit" disabled={signUp.isPending || states.length === 0}>
            Send me a confirmation email
          </Button>
        </div>
        <p className="text-sm text-muted">
          We keep only these four answers, encrypted. We email a link to confirm; you are on the
          list only after you press its button. Every alert carries a link to leave. Being on the
          list gives no access to anything that is not public. Read the{' '}
          <Link to="/legal" className="underline">
            legal notice and privacy policy
          </Link>
          .
        </p>
      </form>
    </Page>
  );
}
