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
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { KeyValueList } from '@/components/ui/key-value-list.tsx';
import type { KeyValue } from '@/components/ui/key-value-list.tsx';
import { Eyebrow, Lede } from '@/components/ui/type.tsx';
import { BrandName, useSite } from '@/components/ui/site.tsx';
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
import { ErrorText } from './ui.tsx';

function Heading() {
  const site = useSite();
  return (
    <>
      <Eyebrow>{site.data ? <BrandName parts={site.data.name_parts} /> : 'ReportLog'}</Eyebrow>
      <h1 className="font-display text-title font-bold">Signing in</h1>
    </>
  );
}

export function SecurityPage() {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next="/access/security" />;
  if (me.data.secondFactor === 'not-needed') {
    return (
      <section className="flex max-w-prose flex-col gap-3">
        <Heading />
        <Lede>
          Your account has no role on this site, so it signs in with the emailed code alone. A
          second factor is asked of everybody with a role.
        </Lede>
      </section>
    );
  }
  return (
    <SecondFactorGate>
      <Factors />
    </SecondFactorGate>
  );
}

type PanelId = 'app' | 'passkeys' | 'codes';

/** A panel: closed, its summary and Open; open, its content and Close. */
function FactorPanel({
  id,
  title,
  summary,
  open,
  onOpen,
  onClose,
  children,
}: {
  id: PanelId;
  title: string;
  summary: readonly KeyValue[];
  open: PanelId | null;
  onOpen: (id: PanelId) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const isOpen = open === id;
  return (
    <Card heading={title}>
      <KeyValueList items={summary} />
      {isOpen ? (
        <>
          {children}
          <div>
            <Button type="button" variant="quiet" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button
            type="button"
            variant="secondary"
            aria-label={`Change ${title}`}
            onClick={() => {
              onOpen(id);
            }}
          >
            Change
          </Button>
        </div>
      )}
    </Card>
  );
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function Factors() {
  const client = useQueryClient();
  const status = useQuery(secondFactorQuery);
  const [open, setOpen] = useState<PanelId | null>(null);
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
    setOpen(null);
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
      setOpen(null);
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
  const openPanel = (id: PanelId) => {
    setAdding(null);
    setSaid(null);
    setOpen(id);
  };
  const close = () => {
    setAdding(null);
    setOpen(null);
  };

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Heading />
        {optional ? (
          <Lede>
            A second factor is optional for journalists, and we encourage it. Your desk shows links
            people sent in, and an email code alone is the only thing between a stranger and your
            inbox. With one set up, sign-in asks for a code from your authenticator app or a passkey
            after the emailed code. You can add one now and remove it later.
          </Lede>
        ) : (
          <Lede>
            After the emailed code, your account asks for a second factor: a code from your
            authenticator app or one of your passkeys. Either works wherever one is asked for.
          </Lede>
        )}
      </div>
      {said ? (
        <div ref={done} tabIndex={-1} className="outline-none">
          <Alert tone="done" title={said} />
        </div>
      ) : null}

      <FactorPanel
        id="app"
        title="Authenticator app"
        summary={[{ key: 'Authenticator app', value: s.totp ? 'Set up' : 'Not set up' }]}
        open={open}
        onOpen={openPanel}
        onClose={close}
      >
        {adding === 'app' ? (
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
        ) : (
          <div className="flex flex-wrap gap-3">
            {s.totpAvailable ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setAdding('app');
                }}
              >
                {s.totp ? 'Move it to another app' : 'Set up an authenticator app'}
              </Button>
            ) : (
              <p>
                This server has no key for authenticator apps set up, so it offers passkeys only.
              </p>
            )}
            {s.totp && ways > 1 ? (
              <Button
                type="button"
                variant="quiet"
                busy={dropApp.isPending}
                onClick={() => {
                  dropApp.mutate();
                }}
              >
                Stop using it
              </Button>
            ) : null}
          </div>
        )}
        {s.totp && ways === 1 ? (
          <p className="text-sm text-ink-alt">
            This is your only way to sign in, so it cannot be removed. Add another first.
          </p>
        ) : null}
        <ErrorText error={dropApp.error} />
      </FactorPanel>

      <FactorPanel
        id="passkeys"
        title="Passkeys"
        summary={[
          {
            key: 'Passkeys',
            value:
              s.passkeys.length === 0
                ? 'None yet'
                : s.passkeys.length === 1
                  ? '1 passkey'
                  : `${String(s.passkeys.length)} passkeys`,
          },
        ]}
        open={open}
        onOpen={openPanel}
        onClose={close}
      >
        {s.passkeys.length > 0 ? (
          <KeyValueList
            items={s.passkeys.map((p) => ({
              key: <strong className="text-ink">{p.name}</strong>,
              value: (
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink-alt">
                    added {day(p.created_at)}
                    {p.last_used_at ? `, last used ${day(p.last_used_at)}` : ''}
                  </span>
                  {ways > 1 ? (
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() => {
                        dropPasskey.reset();
                        setRemoving({ id: p.id, name: p.name });
                      }}
                    >
                      Remove {p.name}
                    </Button>
                  ) : null}
                </span>
              ),
            }))}
          />
        ) : null}
        {ways === 1 && s.passkeys.length === 1 ? (
          <p className="text-sm text-ink-alt">
            This is your only way to sign in, so it cannot be removed. Add another first.
          </p>
        ) : null}
        {adding === 'passkey' ? (
          <AddPasskey
            onAdded={async (fresh) => {
              if (fresh) {
                setCodes(fresh);
                setFirstCodes(true);
              }
              await changed('Done. Added.');
            }}
          />
        ) : (
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAdding('passkey');
              }}
            >
              Add a passkey
            </Button>
          </div>
        )}
      </FactorPanel>

      <FactorPanel
        id="codes"
        title="Recovery codes"
        summary={[
          {
            key: 'Recovery codes',
            value:
              s.recoveryLeft === 1
                ? 'One recovery code left.'
                : `${String(s.recoveryLeft)} recovery codes left.`,
          },
        ]}
        open={open}
        onOpen={openPanel}
        onClose={close}
      >
        <p>Making new ones stops the old ones working.</p>
        <div>
          <Button
            type="button"
            variant="secondary"
            busy={remake.isPending}
            onClick={() => {
              remake.mutate();
            }}
          >
            Make new recovery codes
          </Button>
        </div>
        <ErrorText error={remake.error} />
      </FactorPanel>

      <Dialog
        open={removing !== null}
        onOpenChange={(on) => {
          if (!on && !dropPasskey.isPending) setRemoving(null);
        }}
      >
        {removing ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove this passkey?</DialogTitle>
              <DialogDescription>
                “{removing.name}” stops working for this site. You can add it again later.
              </DialogDescription>
            </DialogHeader>
            <ErrorText error={dropPasskey.error} />
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setRemoving(null);
                }}
              >
                Keep it
              </Button>
              <Button
                type="button"
                variant="secondary"
                busy={dropPasskey.isPending}
                onClick={() => {
                  dropPasskey.mutate(removing.id);
                }}
              >
                Remove it
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </section>
  );
}
