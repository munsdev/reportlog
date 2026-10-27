/**
 * /access/security: your own second factor (plan E, E3; account.md §05).
 * The authenticator app, your passkeys and your recovery codes: add,
 * replace, remove.
 *
 * Three panels, each showing what is set before it is opened, one open at
 * a time. Not setting panels with a Save bar: nothing here is a form to
 * save, each change is its own action (scan a code, make a passkey, remove
 * one), and each asks for the factor again first (the server says so and
 * the step-up dialog asks). The last way to sign in cannot be removed, and
 * the page says why rather than hiding the button without a word.
 *
 * After a change, a "Done" alert at the top of the page, with focus moved
 * to it so a screen reader hears it.
 */
import { newRecoveryCodes, removePasskey, removeTotp } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { StaffPage } from '../nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { SmBtn as Btn } from '../../mockup/SmBtn.tsx';
import { Chip } from '../../mockup/Chip.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Modal } from '../../mockup/Modal.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Panel } from '../../mockup/Panel.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import {
  AddAuthenticatorApp,
  AddPasskey,
  RecoveryCodes,
  SecondFactorGate,
  secondFactorQuery,
} from './secondFactor.tsx';
import { useMe } from './session.ts';
import { SignInPrompt } from './SignInPrompt.tsx';

export function SecurityPage() {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next="/access/security" />;
  if (me.data.secondFactor === 'not-needed') {
    return (
      <StaffPage
        area="Account"
        title="Signing in"
        width="prose"
        lede="Your account has no role on this site, so it signs in with the emailed code alone. A second factor is asked of everybody with a role."
      />
    );
  }
  return (
    <SecondFactorGate>
      <Factors />
    </SecondFactorGate>
  );
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function Factors() {
  const client = useQueryClient();
  const status = useQuery(secondFactorQuery);
  const [adding, setAdding] = useState<'app' | 'passkey' | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  // The codes shown after a journalist's first factor, which was their choice.
  const [firstCodes, setFirstCodes] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: number; name: string } | null>(null);
  const done = useRef<HTMLDivElement>(null);
  const refresh = () => client.invalidateQueries({ queryKey: secondFactorQuery.queryKey });

  // Focus to the sentence that says it worked, so it is heard.
  useEffect(() => {
    if (said) done.current?.focus();
  }, [said]);

  const changed = async (sentence: string) => {
    setAdding(null);
    setSaid(sentence);
    await refresh();
  };
  const dropApp = useMutation({
    mutationFn: () => call(removeTotp),
    onSuccess: () => changed('Your authenticator app is no longer used for this site.'),
  });
  const dropPasskey = useMutation({
    mutationFn: (id: number) => call(removePasskey, { params: { id } }),
    onSuccess: async () => {
      setRemoving(null);
      await changed('That passkey is removed.');
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
          setFirstCodes(false);
          setSaid(
            firstCodes
              ? 'Done. Keep the recovery codes safe; each works once.'
              : 'New recovery codes made. The old ones no longer work.',
          );
        }}
      />
    );
  }
  if (!status.data) return <p role="status">Loading…</p>;
  const s = status.data;
  const optional = s.state === 'optional';
  const ways = (s.totp ? 1 : 0) + s.passkeys.length;
  return (
    <StaffPage
      area="Account"
      title="Signing in"
      lede={
        optional
          ? 'A second factor is optional for journalists, and we encourage it. Your desk shows links people sent in, and an email code alone is the only thing between a stranger and your inbox. With one set up, sign-in asks for a code from your authenticator app or a passkey after the emailed code. You can add one now and remove it later.'
          : 'Staff confirm with an authenticator app or a passkey after the emailed code. Either works wherever one is asked for.'
      }
    >
      {said ? (
        <div ref={done} tabIndex={-1} style={{ outline: 'none' }}>
          <Note>
            <b>{said}</b>
          </Note>
        </div>
      ) : null}

      <Panel title="Authenticator app">
        <div>
          <Chip kind={s.totp ? 'ok' : 'off'}>{s.totp ? 'Set up' : 'Not set up'}</Chip>
        </div>
        <p className="muted">Codes from your app confirm it is you.</p>
        {adding === 'app' ? (
          <div className="dlg" role="dialog" aria-label="Set up an authenticator app">
            <h3>Set up an authenticator app</h3>
            <AddAuthenticatorApp
              onAdded={async (fresh) => {
                // Somebody's first factor brings recovery codes, shown once.
                if (fresh) {
                  setCodes(fresh);
                  setFirstCodes(true);
                }
                await changed('Done. Your authenticator app is set up.');
              }}
            />
            <div className="acts">
              <Btn
                kind="ghost"
                onClick={() => {
                  setAdding(null);
                }}
              >
                Cancel
              </Btn>
            </div>
          </div>
        ) : (
          <div className="acts">
            {s.totpAvailable ? (
              <Btn
                onClick={() => {
                  setSaid(null);
                  setAdding('app');
                }}
              >
                {s.totp ? 'Move it to another app' : 'Set up an authenticator app'}
              </Btn>
            ) : (
              <p>
                This server has no key for authenticator apps set up, so it offers passkeys only.
              </p>
            )}
            {s.totp && ways > 1 ? (
              <Btn
                kind="ghost"
                disabled={dropApp.isPending}
                onClick={() => {
                  dropApp.mutate();
                }}
              >
                Stop using it
              </Btn>
            ) : null}
          </div>
        )}
        {s.totp && ways === 1 ? (
          <p className="m">
            This is your only way to sign in, so it cannot be removed. Add another first.
          </p>
        ) : null}
        <ErrorLine error={dropApp.error} />
      </Panel>

      <Panel title="Passkeys">
        {s.passkeys.length > 0 ? (
          <Tbl
            cols={['Name', 'Added', '']}
            widths="1fr 1fr auto"
            rows={s.passkeys.map((p) => ({
              key: p.id,
              cells: [
                p.name,
                <>
                  {day(p.created_at)}
                  {p.last_used_at ? `, last used ${day(p.last_used_at)}` : ''}
                </>,
                ways > 1 ? (
                  <Btn
                    kind="ghost"
                    onClick={() => {
                      dropPasskey.reset();
                      setRemoving({ id: p.id, name: p.name });
                    }}
                  >
                    Remove<span className="sr-only"> {p.name}</span>
                  </Btn>
                ) : null,
              ],
            }))}
          />
        ) : (
          <p className="muted">None yet.</p>
        )}
        {ways === 1 && s.passkeys.length === 1 ? (
          <p className="m">
            This is your only way to sign in, so it cannot be removed. Add another first.
          </p>
        ) : null}
        {adding === 'passkey' ? (
          <div className="dlg" role="dialog" aria-label="Add a passkey">
            <h3>Add a passkey</h3>
            <AddPasskey
              onAdded={async (fresh) => {
                if (fresh) {
                  setCodes(fresh);
                  setFirstCodes(true);
                }
                await changed('Done. Added.');
              }}
            />
            <div className="acts">
              <Btn
                kind="ghost"
                onClick={() => {
                  setAdding(null);
                }}
              >
                Cancel
              </Btn>
            </div>
          </div>
        ) : (
          <div className="acts">
            <Btn
              onClick={() => {
                setSaid(null);
                setAdding('passkey');
              }}
            >
              Add a passkey
            </Btn>
          </div>
        )}
      </Panel>

      <Panel title="Recovery codes">
        <p className="muted">
          Ten one-time codes for when you lose your phone.{' '}
          {s.recoveryLeft === 1
            ? 'One recovery code is left.'
            : `${String(s.recoveryLeft)} are left.`}{' '}
          Making new ones stops the old ones working.
        </p>
        <div className="acts">
          <Btn
            disabled={remake.isPending}
            onClick={() => {
              remake.mutate();
            }}
          >
            Make new recovery codes
          </Btn>
        </div>
        <ErrorLine error={remake.error} />
      </Panel>

      <Modal
        open={removing !== null}
        onClose={() => {
          if (!dropPasskey.isPending) setRemoving(null);
        }}
        title="Remove this passkey?"
        text={
          removing
            ? `“${removing.name}” stops working for this site. You can add it again later.`
            : undefined
        }
        buttons={
          <>
            <Btn
              kind="ghost"
              onClick={() => {
                setRemoving(null);
              }}
            >
              Keep it
            </Btn>
            <Btn
              kind="ink"
              disabled={dropPasskey.isPending}
              onClick={() => {
                if (removing) dropPasskey.mutate(removing.id);
              }}
            >
              Remove it
            </Btn>
          </>
        }
      >
        <ErrorLine error={dropPasskey.error} />
      </Modal>
    </StaffPage>
  );
}
