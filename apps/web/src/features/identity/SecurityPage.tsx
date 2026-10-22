/**
 * /access/security: your own second factor (plan E, E3). The authenticator
 * app, your passkeys and your recovery codes: add, replace, remove.
 *
 * Every change here asks for the factor again first (the server says so and
 * the step-up dialog asks), and the last way to sign in cannot be removed.
 */
import { newRecoveryCodes, removePasskey, removeTotp } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { call } from '../../lib/api.ts';
import {
  AddAuthenticatorApp,
  AddPasskey,
  RecoveryCodes,
  SecondFactorGate,
  secondFactorQuery,
} from './secondFactor.tsx';
import { useMe } from './session.ts';
import { SignInPrompt } from './SignInPrompt.tsx';
import { Done, ErrorText, Panel } from './ui.tsx';

export function SecurityPage() {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next="/access/security" />;
  if (me.data.secondFactor === 'not-needed') {
    return (
      <section className="max-w-xl space-y-3">
        <h1 className="font-display text-title font-bold">Signing in</h1>
        <p>
          Your account has no role on this site, so it signs in with the emailed code alone. A
          second factor is asked of everybody with a role.
        </p>
      </section>
    );
  }
  return (
    <SecondFactorGate>
      <Factors />
    </SecondFactorGate>
  );
}

function Factors() {
  const client = useQueryClient();
  const status = useQuery(secondFactorQuery);
  const [adding, setAdding] = useState<'app' | 'passkey' | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: secondFactorQuery.queryKey });

  const dropApp = useMutation({
    mutationFn: () => call(removeTotp),
    onSuccess: async () => {
      setSaid('Your authenticator app is no longer used for this site.');
      await refresh();
    },
  });
  const dropPasskey = useMutation({
    mutationFn: (id: number) => call(removePasskey, { params: { id } }),
    onSuccess: async () => {
      setSaid('That passkey is removed.');
      await refresh();
    },
  });
  const remake = useMutation({
    mutationFn: () => call(newRecoveryCodes),
    onSuccess: async (out) => {
      setCodes(out.recoveryCodes);
      await refresh();
    },
  });

  if (codes) {
    return (
      <RecoveryCodes
        codes={codes}
        onKept={() => {
          setCodes(null);
        }}
      />
    );
  }
  if (!status.data) return <p role="status">Loading…</p>;
  const s = status.data;
  const ways = (s.totp ? 1 : 0) + s.passkeys.length;
  const added = async () => {
    setAdding(null);
    setSaid('Added.');
    await refresh();
  };

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="font-display text-title font-bold">Signing in</h1>
      <p>
        After the emailed code, your account asks for a second factor: a code from your
        authenticator app or one of your passkeys. Either works wherever one is asked for.
      </p>
      {said && <Done>{said}</Done>}

      <Panel title="Authenticator app">
        <p>{s.totp ? 'Set up.' : 'Not set up.'}</p>
        {adding === 'app' ? (
          <AddAuthenticatorApp onAdded={added} />
        ) : (
          <div className="flex flex-wrap gap-3">
            {s.totpAvailable && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSaid(null);
                  setAdding('app');
                }}
              >
                {s.totp ? 'Move it to another app' : 'Set up an authenticator app'}
              </Button>
            )}
            {s.totp && ways > 1 && (
              <Button
                type="button"
                variant="quiet"
                disabled={dropApp.isPending}
                onClick={() => {
                  dropApp.mutate();
                }}
              >
                Stop using it
              </Button>
            )}
          </div>
        )}
        <ErrorText error={dropApp.error} />
      </Panel>

      <Panel title="Passkeys">
        {s.passkeys.length === 0 ? (
          <p>None yet.</p>
        ) : (
          <ul className="space-y-2">
            {s.passkeys.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  <strong>{p.name}</strong>
                  <span className="text-muted">
                    {' '}
                    · added {new Date(p.created_at).toLocaleDateString()}
                    {p.last_used_at
                      ? `, last used ${new Date(p.last_used_at).toLocaleDateString()}`
                      : ''}
                  </span>
                </span>
                {ways > 1 && (
                  <Button
                    type="button"
                    variant="quiet"
                   
                    disabled={dropPasskey.isPending}
                    onClick={() => {
                      dropPasskey.mutate(p.id);
                    }}
                  >
                    Remove {p.name}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <ErrorText error={dropPasskey.error} />
        {adding === 'passkey' ? (
          <AddPasskey onAdded={added} />
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSaid(null);
              setAdding('passkey');
            }}
          >
            Add a passkey
          </Button>
        )}
      </Panel>

      <Panel title="Recovery codes">
        <p>
          {s.recoveryLeft === 1
            ? 'One recovery code left.'
            : `${String(s.recoveryLeft)} recovery codes left.`}{' '}
          Making new ones stops the old ones working.
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={remake.isPending}
          onClick={() => {
            remake.mutate();
          }}
        >
          Make new recovery codes
        </Button>
        <ErrorText error={remake.error} />
      </Panel>
    </div>
  );
}
