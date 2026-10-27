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
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { CheckOption } from '@/components/ui/choice.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { FollowBand } from '../follow/FollowBand.tsx';
import { CardError } from '../form/CardFrame.tsx';
import { PublicPage } from '../site-pages/PublicPage.tsx';
import { call } from '../../lib/api.ts';
import { AccessFields, accessBody, EMPTY_ACCESS } from './AccessFields.tsx';
import { StatesPicker } from './StatesPicker.tsx';

export function SignupPage({ askForAccess = false }: { askForAccess?: boolean }) {
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
      <form
        className="flex flex-col gap-6"
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
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">What you are signing up for</legend>
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
          {nothing ? <CardError>Choose alerts, desk access, or both.</CardError> : null}
        </fieldset>
        {alerts ? (
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
        ) : null}
        {asking ? (
          <section aria-labelledby="signup-desk" className="flex flex-col gap-6">
            <h2 id="signup-desk" className="font-display text-xl font-bold">
              Your request for desk access
            </h2>
            <AccessFields value={draft} onChange={setDraft} />
          </section>
        ) : null}
        <Card variant="quiet">
          <p className="font-semibold">Joining gives you no access to anything.</p>
          <p className="text-ink-alt">
            Desk access starts only if the owner approves your request. We keep only these answers,
            encrypted. We email a link to confirm; you are on the list only after you press its
            button. Every alert carries a link to leave. Read the{' '}
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
