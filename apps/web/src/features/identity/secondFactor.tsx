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
 *
 * The look is account.md §03: one raised panel a step, codes in mono and
 * letter-spaced, the two ways to set up as choice cards, and the recovery
 * codes with Copy, Download and Print, all done in the browser.
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
import { BrandName, useSite } from '@/components/ui/site.tsx';
import { Btn } from '../../mockup/Btn.tsx';
import { Choice, Choices } from '../../mockup/Choice.tsx';
import { call } from '../../lib/api.ts';
import { meQuery, useMe, useSignOut } from './session.ts';
import { Field } from '../../mockup/Field.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { ErrorText, messageOf } from './ui.tsx';

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

/** Put text on the clipboard; false where the browser will not (an insecure page, say). */
async function copied(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Hand the browser a text file it made itself: nothing is sent anywhere. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The codes, once. They stay on screen until "I have kept them", even when
 * the screen behind them has become available. Printing prints the codes
 * and the site's name and nothing else (`data-print-only`, styles.css).
 */
export function RecoveryCodes({ codes, onKept }: { codes: string[]; onKept: () => void }) {
  const site = useSite();
  const [said, setSaid] = useState<string | null>(null);
  const siteName = site.data?.plain_name ?? 'ReportLog';
  const asText = `Recovery codes for ${siteName}. Each signs you in once.\n\n${codes.join('\n')}\n`;
  return (
    <section className="form-stack" style={{ maxWidth: 640 }} aria-labelledby="recovery-heading">
      <div data-print-only style={{ display: 'grid', gap: 18 }}>
        <p className="eyebrow">
          {site.data ? <BrandName parts={site.data.name_parts} /> : siteName}
        </p>
        <h1 id="recovery-heading" className="h-page">
          Your recovery codes
        </h1>
        <p className="print:hidden">
          If you lose your phone or your passkey, each of these codes signs you in once, in place of
          it. Keep them somewhere safe that is not that phone, such as a password manager or on
          paper.
          <strong> They are not shown again.</strong>
        </p>
        <div className="panel">
          <ol
            className="mono"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: 10,
              listStyle: 'none',
              padding: 0,
              margin: 0,
              fontSize: '1.1rem',
              letterSpacing: '.12em',
            }}
          >
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        </div>
      </div>
      <div className="acts">
        <Btn
          sm
          flat
          onClick={() => {
            void copied(codes.join('\n')).then((ok) => {
              setSaid(
                ok
                  ? 'Copied. Paste them somewhere safe.'
                  : 'This browser would not copy them. Select the codes and copy them by hand.',
              );
            });
          }}
        >
          Copy them
        </Btn>
        <Btn
          sm
          flat
          onClick={() => {
            download('recovery-codes.txt', asText);
            setSaid('Saved as recovery-codes.txt, made in this browser.');
          }}
        >
          Download as a text file
        </Btn>
        <Btn
          sm
          flat
          onClick={() => {
            window.print();
          }}
        >
          Print them
        </Btn>
      </div>
      <p role="status" className="m">
        {said}
      </p>
      <div className="btn-row">
        <Btn look="ink" onClick={onKept}>
          I have kept them
        </Btn>
      </div>
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
      className="qr"
      style={{
        width: 224,
        height: 224,
        background: 'none',
        border: 0,
        outline: '1px solid var(--rl-border)',
      }}
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

/** The browser found no passkey it could use, or the person cancelled. */
class PasskeyUnavailable extends Error {
  constructor() {
    super(
      'This device could not use your passkey. A passkey usually works only on the device where you made it. Type a code from your authenticator app or one of your recovery codes below, or sign in on that device instead.',
    );
  }
}

/**
 * A code from the app, a recovery code, or a passkey. The same for
 * finishing signing in and for a step-up: the server decides which by what
 * this session has already proved.
 */
export function ProveIt({
  intro,
  onProved,
  submitLabel = 'Confirm',
}: {
  intro: ReactNode;
  onProved: (me: Me) => void | Promise<void>;
  /** "Continue" when signing in, "Confirm" in the step-up dialog. */
  submitLabel?: string;
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
      let response: Awaited<ReturnType<typeof startAuthentication>>;
      try {
        response = await startAuthentication({ optionsJSON });
      } catch {
        // The browser's own failure says nothing a person can act on, and
        // the commonest cause is a passkey made on another device (a laptop's
        // Windows Hello, say), which a phone cannot reach. Say what to do.
        throw new PasskeyUnavailable();
      }
      return call(verifyPasskey, { body: { response: { ...response } } });
    },
    onSuccess: proved,
  });
  const error = byCode.error ?? byPasskey.error;
  const hasPasskey = (status.data?.passkeys.length ?? 0) > 0;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {intro}
      {hasPasskey && (
        <div className="btn-row">
          <button
            className="btn sm flat ink"
            type="button"
            disabled={byPasskey.isPending}
            onClick={() => {
              byCode.reset();
              byPasskey.mutate();
            }}
          >
            {byPasskey.isPending ? 'Waiting for the passkey…' : 'Use a passkey'}
          </button>
        </div>
      )}
      <form
        style={{ display: 'grid', gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          byPasskey.reset();
          byCode.mutate();
        }}
      >
        <Field
          label={
            hasPasskey
              ? 'Or a code from your authenticator app'
              : 'Code from your authenticator app'
          }
          htmlFor={`${errorId}-code`}
          help="Six digits. If you have lost the app, type one of your recovery codes instead."
        >
          <input
            className="input mono"
            id={`${errorId}-code`}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={24}
            required
            style={{ letterSpacing: '.2em' }}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
            }}
            {...(error ? { 'aria-invalid': true as const, 'aria-describedby': errorId } : {})}
          />
        </Field>
        {error ? (
          <p id={errorId} role="alert" className="error">
            {error instanceof PasskeyUnavailable ? error.message : messageOf(error)}
          </p>
        ) : null}
        <div>
          <button
            className={hasPasskey ? 'btn sm flat ghost' : 'btn sm flat go'}
            type="submit"
            disabled={byCode.isPending}
          >
            {byCode.isPending ? 'Checking…' : submitLabel}
          </button>
        </div>
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
  const [keySaid, setKeySaid] = useState<string | null>(null);
  const errorId = useId();
  const codeId = useId();
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
  const secret = begin.data.secret;
  return (
    <form
      style={{ display: 'grid', gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        confirm.mutate();
      }}
    >
      <p className="muted">Open your authenticator app and scan this code.</p>
      <QrCode text={begin.data.uri} label="QR code to add this site to your authenticator app" />
      <div className="copybox">
        <div className="row">
          <code data-testid="totp-secret">{grouped(secret)}</code>
          <button
            className="btn sm flat"
            type="button"
            onClick={() => {
              void copied(secret).then((ok) => {
                setKeySaid(
                  ok ? 'Copied.' : 'This browser would not copy it. Select the key instead.',
                );
              });
            }}
          >
            Copy the key
          </button>
        </div>
      </div>
      <span role="status" className="m">
        {keySaid}
      </span>
      <div className="field">
        <label htmlFor={codeId}>The six-digit code the app shows now</label>
        <input
          id={codeId}
          className="input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ''));
          }}
          {...(confirm.error ? { 'aria-invalid': true as const, 'aria-describedby': errorId } : {})}
        />
      </div>
      <ErrorText error={confirm.error} id={errorId} />
      <div className="acts">
        <button className="btn sm flat ink" type="submit" disabled={confirm.isPending}>
          {confirm.isPending ? 'Checking…' : 'Turn it on'}
        </button>
      </div>
    </form>
  );
}

export function AddPasskey({
  onAdded,
}: {
  onAdded: (codes: string[] | null) => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const nameId = useId();
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
      style={{ display: 'grid', gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <div className="field">
        <label htmlFor={nameId}>A name for this passkey</label>
        <input
          id={nameId}
          className="input"
          maxLength={60}
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <span className="help">So you can tell your passkeys apart later, like “Work laptop”.</span>
      </div>
      <ErrorText error={add.error} />
      <div className="acts">
        <button className="btn sm flat ink" type="submit" disabled={add.isPending}>
          {add.isPending ? 'Waiting for the browser…' : 'Add the passkey'}
        </button>
      </div>
    </form>
  );
}

function SetUpFirst() {
  const client = useQueryClient();
  const [way, setWay] = useState<'app' | 'passkey' | null>(null);
  const status = useQuery(secondFactorQuery);
  const appOffered = status.data?.totpAvailable !== false;
  const [choice, setChoice] = useState<'app' | 'passkey' | null>(null);
  const added = async (codes: string[] | null) => {
    if (codes) setShownCodes(codes);
    await client.invalidateQueries({ queryKey: ['identity'] });
  };
  return (
    <section className="form-stack" style={{ maxWidth: 560 }} aria-labelledby="set-up-heading">
      <h1 id="set-up-heading" className="h-page">
        Set up a second way to sign in
      </h1>
      <p className="muted">
        Your account has a role on this site, so signing in takes the emailed code and then a second
        step: a code from an authenticator app on your phone, or a passkey. Nothing behind your role
        opens until you set one up.
      </p>
      <div className="panel">
        {way === null && (
          <form
            style={{ display: 'grid', gap: 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              const chosen = choice ?? (appOffered ? null : 'passkey');
              if (chosen) setWay(chosen);
            }}
          >
            {appOffered ? null : (
              <p>
                This server has no key for authenticator apps set up, so a passkey is the way to
                sign in here.
              </p>
            )}
            <Choices role="radiogroup" aria-label="Which second way">
              {appOffered ? (
                <Choice
                  name="second-way"
                  value="app"
                  checked={choice === 'app'}
                  onChange={() => {
                    setChoice('app');
                  }}
                >
                  An authenticator app
                  <br />
                  <span className="help">A six-digit code from an app on your phone</span>
                </Choice>
              ) : null}
              <Choice
                name="second-way"
                value="passkey"
                checked={(choice ?? (appOffered ? '' : 'passkey')) === 'passkey'}
                onChange={() => {
                  setChoice('passkey');
                }}
              >
                A passkey
                <br />
                <span className="help">
                  Your phone’s or computer’s own lock, a fingerprint or face
                </span>
              </Choice>
            </Choices>
            <div className="acts">
              <Btn look="ink" sm flat type="submit" disabled={appOffered && choice === null}>
                Next
              </Btn>
            </div>
          </form>
        )}
        {way === 'app' && <AddAuthenticatorApp onAdded={added} />}
        {way === 'passkey' && <AddPasskey onAdded={added} />}
        {way !== null && (
          <div className="acts">
            <Btn
              look="ghost"
              sm
              flat
              onClick={() => {
                setWay(null);
              }}
            >
              Choose another way
            </Btn>
          </div>
        )}
      </div>
    </section>
  );
}

/** Mock-up sign-in.html, the second step: its heading, then a panel with the proof. */
function VerifyAfterEmail() {
  useBodyClass('light', 'form');
  const client = useQueryClient();
  const me = useMe();
  const signOut = useSignOut();
  const email = me.data?.signedIn ? me.data.email : null;
  return (
    <div data-bleed>
      <div className="wrap" style={{ paddingTop: 30 }}>
        <section className="form-stack" style={{ maxWidth: 460 }} aria-labelledby="verify-heading">
          <span className="eyebrow">Sign in · step 2 of 2</span>
          <h1 id="verify-heading" className="h-page">
            One more step
          </h1>
          <p className="muted">
            Your account has a role on this site. Prove it is you with your second factor.
          </p>
          <div className="panel">
            <ProveIt
              intro={null}
              submitLabel="Continue"
              onProved={async () => {
                await client.invalidateQueries({ queryKey: ['identity'] });
              }}
            />
            {email ? (
              <p className="muted">
                Signed in as <span className="mono">{email}</span>.{' '}
                <a
                  href="/access/sign-in"
                  onClick={(e) => {
                    e.preventDefault();
                    signOut.mutate();
                  }}
                >
                  Not you? Start again
                </a>
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
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
