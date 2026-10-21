/**
 * The second factor on screen (plan E, decision E3): proving it after the
 * emailed code, setting the first one up, and the recovery codes shown once.
 *
 * Everybody with a role meets this; nobody else does. A role holder whose
 * session has not proved a factor is held at no role by the server, so the
 * staff screens show `SecondFactorGate` in place of themselves until it is
 * done (courtesy: the server refuses them regardless).
 *
 * The QR code is drawn here, from the otpauth address the server sends, by
 * qrcode-generator: nothing is fetched from anywhere else.
 */
import {
  addPasskey,
  beginTotp,
  confirmTotp,
  getSecondFactor,
  passkeyChallenge,
  passkeyRegistration,
  verifyPasskey,
  verifySecondFactor,
} from '@reportlog/contracts';
import type { Me } from '@reportlog/contracts';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { call } from '../../lib/api.ts';
import { meQuery, useMe } from './session.ts';
import { ErrorText, TextField } from './ui.tsx';

export const secondFactorQuery = queryOptions({
  queryKey: ['identity', 'second-factor'],
  queryFn: ({ signal }) => call(getSecondFactor, { signal }),
});

/** Whether the signed-in person still has the second factor to do. */
export const pendingSecondFactor = (me: Me | undefined) =>
  me?.signedIn === true && (me.secondFactor === 'set-up' || me.secondFactor === 'verify');

// ── recovery codes, shown once ────────────────────────────────────────────
// Held outside any one screen: the moment the first factor is set up the
// server lets the person in, and the staff screen would replace the set-up
// screen, codes and all, before they were written down.
let shownCodes: string[] | null = null;
const listeners = new Set<() => void>();
function setShownCodes(codes: string[] | null) {
  shownCodes = codes;
  for (const l of listeners) l();
}
function useShownCodes(): string[] | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => shownCodes,
  );
}
export const showRecoveryCodes = setShownCodes;

export function RecoveryCodes({ codes, onKept }: { codes: string[]; onKept: () => void }) {
  return (
    <section className="max-w-xl space-y-4" aria-labelledby="recovery-heading">
      <h1 id="recovery-heading" className="font-display text-2xl font-bold">
        Your recovery codes
      </h1>
      <p>
        If you lose your phone or your passkey, each of these codes signs you in once, in place of
        it. Keep them somewhere safe that is not that phone, such as a password manager or on paper.
        <strong> They are not shown again.</strong>
      </p>
      <ol className="grid grid-cols-1 gap-2 font-mono text-lg sm:grid-cols-2">
        {codes.map((c) => (
          <li key={c} className="rounded-card border border-line bg-surface px-3 py-2">
            {c}
          </li>
        ))}
      </ol>
      <Button type="button" onClick={onKept}>
        I have kept them
      </Button>
    </section>
  );
}

// ── the QR code ──────────────────────────────────────────────────────────

export function QrCode({ text, label }: { text: string; label: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1)
      if (qr.isDark(r, c)) d += `M${String(c + 4)},${String(r + 4)}h1v1h-1z`;
  }
  // Dark on white whatever the site's look: a scanner needs the contrast,
  // and the four-module quiet zone around it.
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(n + 8)} ${String(n + 8)}`}
      className="h-56 w-56 rounded-card border border-line"
      shapeRendering="crispEdges"
    >
      <rect width="100%" height="100%" fill="white" />
      <path d={d} fill="black" />
    </svg>
  );
}

/** A secret in groups of four, as people type it into an app. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

// ── proving it ───────────────────────────────────────────────────────────

/**
 * A code from the app, a recovery code, or a passkey. The same for
 * finishing signing in and for a step-up: the server decides which by what
 * this session has already proved.
 */
export function ProveIt({
  intro,
  onProved,
}: {
  intro: ReactNode;
  onProved: (me: Me) => void | Promise<void>;
}) {
  const status = useQuery(secondFactorQuery);
  const client = useQueryClient();
  const [code, setCode] = useState('');
  const errorId = useId();
  const proved = async (me: Me) => {
    client.setQueryData(meQuery.queryKey, me);
    await client.invalidateQueries({ queryKey: secondFactorQuery.queryKey });
    await onProved(me);
  };
  const byCode = useMutation({
    mutationFn: () => call(verifySecondFactor, { body: { code } }),
    onSuccess: proved,
  });
  const byPasskey = useMutation({
    mutationFn: async () => {
      // WebAuthn's own JSON, passed on as the server made it (contracts/twoFactor.ts).
      const optionsJSON = (await call(passkeyChallenge)) as PublicKeyCredentialRequestOptionsJSON;
      const response = await startAuthentication({ optionsJSON });
      return call(verifyPasskey, { body: { response: { ...response } } });
    },
    onSuccess: proved,
  });
  const error = byCode.error ?? byPasskey.error;
  const hasPasskey = (status.data?.passkeys.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      {intro}
      {hasPasskey && (
        <div className="space-y-2">
          <Button
            type="button"
            disabled={byPasskey.isPending}
            onClick={() => {
              byCode.reset();
              byPasskey.mutate();
            }}
          >
            Use a passkey
          </Button>
        </div>
      )}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          byPasskey.reset();
          byCode.mutate();
        }}
      >
        <TextField
          label={
            hasPasskey
              ? 'Or a code from your authenticator app'
              : 'Code from your authenticator app'
          }
          hint="Six digits. If you have lost the app, type one of your recovery codes instead."
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={24}
          required
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
          }}
          {...(error ? { 'aria-invalid': true as const, 'aria-describedby': errorId } : {})}
        />
        <ErrorText error={error} id={errorId} />
        <Button type="submit" disabled={byCode.isPending}>
          Confirm
        </Button>
      </form>
    </div>
  );
}

// ── setting the first one up (and adding more, from the security page) ────

export function AddAuthenticatorApp({
  onAdded,
}: {
  onAdded: (codes: string[] | null) => void | Promise<void>;
}) {
  const [code, setCode] = useState('');
  const errorId = useId();
  const begin = useMutation({ mutationFn: () => call(beginTotp) });
  const confirm = useMutation({
    mutationFn: () => call(confirmTotp, { body: { code } }),
    onSuccess: (out) => onAdded(out.recoveryCodes),
  });
  // Asked for once, when this is opened: each ask makes a new secret.
  const { mutate } = begin;
  useEffect(() => {
    mutate();
  }, [mutate]);

  if (begin.error) return <ErrorText error={begin.error} />;
  if (!begin.data) return <p role="status">Making a key…</p>;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        confirm.mutate();
      }}
    >
      <ol className="list-decimal space-y-4 pl-6">
        <li className="space-y-3">
          <p>Open your authenticator app and scan this code.</p>
          <QrCode
            text={begin.data.uri}
            label="QR code to add this site to your authenticator app"
          />
          <p>
            Or type this key into the app:{' '}
            <code className="font-mono break-all" data-testid="totp-secret">
              {grouped(begin.data.secret)}
            </code>
          </p>
        </li>
        <li>
          <TextField
            label="The six-digit code the app shows now"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ''));
            }}
            {...(confirm.error
              ? { 'aria-invalid': true as const, 'aria-describedby': errorId }
              : {})}
          />
        </li>
      </ol>
      <ErrorText error={confirm.error} id={errorId} />
      <Button type="submit" disabled={confirm.isPending}>
        Use this app
      </Button>
    </form>
  );
}

export function AddPasskey({
  onAdded,
}: {
  onAdded: (codes: string[] | null) => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: async () => {
      const options = await call(passkeyRegistration);
      const response = await startRegistration({
        optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
      });
      return call(addPasskey, { body: { name, response: { ...response } } });
    },
    onSuccess: (out) => onAdded(out.recoveryCodes),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <TextField
        label="A name for this passkey"
        hint="So you can tell your passkeys apart later, like “Work laptop”."
        maxLength={60}
        required
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <ErrorText error={add.error} />
      <Button type="submit" disabled={add.isPending}>
        Make a passkey
      </Button>
    </form>
  );
}

function SetUpFirst() {
  const client = useQueryClient();
  const [way, setWay] = useState<'app' | 'passkey' | null>(null);
  const status = useQuery(secondFactorQuery);
  const added = async (codes: string[] | null) => {
    if (codes) setShownCodes(codes);
    await client.invalidateQueries({ queryKey: ['identity'] });
  };
  return (
    <section className="max-w-xl space-y-6" aria-labelledby="set-up-heading">
      <h1 id="set-up-heading" className="font-display text-2xl font-bold">
        Set up a second way to sign in
      </h1>
      <p>
        Your account has a role on this site, so signing in takes the emailed code and then a second
        step: a code from an authenticator app on your phone, or a passkey. Nothing behind your role
        opens until you set one up.
      </p>
      {way === null && (
        <div className="flex flex-wrap gap-3">
          {status.data?.totpAvailable !== false && (
            <Button
              type="button"
              onClick={() => {
                setWay('app');
              }}
            >
              Use an authenticator app
            </Button>
          )}
          <Button
            type="button"
            variant={status.data?.totpAvailable === false ? 'primary' : 'secondary'}
            onClick={() => {
              setWay('passkey');
            }}
          >
            Use a passkey
          </Button>
        </div>
      )}
      {way === 'app' && <AddAuthenticatorApp onAdded={added} />}
      {way === 'passkey' && <AddPasskey onAdded={added} />}
      {way !== null && (
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            setWay(null);
          }}
        >
          Choose another way
        </Button>
      )}
    </section>
  );
}

function VerifyAfterEmail() {
  const client = useQueryClient();
  return (
    <section className="max-w-xl space-y-4" aria-labelledby="verify-heading">
      <h1 id="verify-heading" className="font-display text-2xl font-bold">
        One more step
      </h1>
      <ProveIt
        intro={
          <p>Your account has a role on this site. Prove it is you with your second factor.</p>
        }
        onProved={async () => {
          await client.invalidateQueries({ queryKey: ['identity'] });
        }}
      />
    </section>
  );
}

/**
 * In front of anything behind a role: the recovery codes if there are some
 * to show, then setting a factor up or proving it, and only then `children`.
 */
export function SecondFactorGate({ children }: { children: ReactNode }) {
  const me = useMe();
  const codes = useShownCodes();
  if (codes) {
    return (
      <RecoveryCodes
        codes={codes}
        onKept={() => {
          setShownCodes(null);
        }}
      />
    );
  }
  if (me.data?.signedIn && me.data.secondFactor === 'set-up') return <SetUpFirst />;
  if (me.data?.signedIn && me.data.secondFactor === 'verify') return <VerifyAfterEmail />;
  return <>{children}</>;
}
