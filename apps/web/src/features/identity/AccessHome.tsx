/**
 * /access: your own account, and for those who grant access, the people and
 * their roles, the owner's seat and the site password.
 *
 * The roles offered are the ones @reportlog/access says this person may hand
 * out, so the form never offers what the server would refuse. The server
 * checks again regardless.
 */
import { MAY_GRANT, hasAdminAuthority } from '@reportlog/access';
import {
  acceptHandover,
  cancelHandover,
  getOwner,
  getSiteAccessSettings,
  listPeople,
  offerHandover,
  requestHandoverCode,
  resetSecondFactor,
  setSystemRole,
  updateSiteAccess,
} from '@reportlog/contracts';
import type { SystemRoleName } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { call } from '../../lib/api.ts';
import { desksFor } from './desks.ts';
import { ROLE_EXPLAINED, ROLE_LABELS, useIdentityChanged, useMe } from './session.ts';
import type { SignedInMe } from './session.ts';
import { SecondFactorGate } from './secondFactor.tsx';
import { SignInPrompt } from './SignInPrompt.tsx';
import { Done, ErrorText, Panel, TextField } from './ui.tsx';

export function AccessHome() {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next="/access" />;
  const user = me.data;
  return (
    <SecondFactorGate>
      <div className="space-y-8">
        <h1 className="font-display text-3xl font-bold">
          {user.grantsAccess ? 'Access' : 'Your account'}
        </h1>
        <YourAccount me={user} />
        <OwnerSeat me={user} />
        {user.grantsAccess && (
          <>
            <nav aria-label="Access" className="flex flex-wrap gap-4">
              <Link to="/access/orgs" className="underline">
                Organizations
              </Link>
              <Link to="/access/roster" className="underline">
                Roster
              </Link>
              <Link to="/access/audit" className="underline">
                Who changed what
              </Link>
            </nav>
            <GrantRole me={user} />
            <People />
          </>
        )}
        {user.role === 'owner' && <ResetSecondFactor />}
        {hasAdminAuthority(user.role) && <SitePassword />}
      </div>
    </SecondFactorGate>
  );
}

function YourAccount({ me }: { me: SignedInMe }) {
  return (
    <Panel title="You">
      <p>
        Signed in as <strong>{me.email}</strong>.
      </p>
      <p>
        Role: <strong>{ROLE_LABELS[me.role]}</strong>. {ROLE_EXPLAINED[me.role]}
      </p>
      {me.memberships.length > 0 && (
        <ul className="list-disc space-y-1 pl-6">
          {me.memberships.map((m) => (
            <li key={m.organization_id}>
              {m.role === 'manager' ? (
                <Link
                  to="/access/orgs/$id"
                  params={{ id: String(m.organization_id) }}
                  className="underline"
                >
                  {m.name}
                </Link>
              ) : (
                m.name
              )}{' '}
              ({m.role === 'manager' ? 'manager' : 'coordinator'})
            </li>
          ))}
        </ul>
      )}
      {me.secondFactor === 'done' && (
        <p>
          Your role asks for a second factor when you sign in.{' '}
          <Link to="/access/security" className="underline">
            Your authenticator app, passkeys and recovery codes
          </Link>
          .
        </p>
      )}
      {me.tester && <p>You are a tester: you can open the feedback tracker.</p>}
      {me.teamMember && <TeamDesks me={me} />}
    </Panel>
  );
}

/** Being on the team, and where each of your desks suggests you start. Display only. */
function TeamDesks({ me }: { me: SignedInMe }) {
  const desks = desksFor(me.desks, me);
  return (
    <div className="space-y-2">
      <p>You are on the team. That opens the team’s guides; it opens no report.</p>
      {desks.length > 0 && (
        <>
          <h3 className="font-semibold">Your desks</h3>
          <ul className="list-disc space-y-1 pl-6">
            {desks.map((d) => (
              <li key={d.id}>
                {d.label}
                {d.start && (
                  <>
                    {': start at '}
                    <Link to={d.start.to} className="underline">
                      {d.start.label}
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function GrantRole({ me }: { me: SignedInMe }) {
  const client = useQueryClient();
  const changed = useIdentityChanged();
  const roleId = useId();
  const grantable = MAY_GRANT[me.role];
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<SystemRoleName>(grantable[1] ?? 'user');
  const grant = useMutation({
    mutationFn: () => call(setSystemRole, { body: { email, role } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['identity', 'people'] });
      await changed();
    },
  });
  return (
    <Panel title="Give somebody a role">
      <p className="text-ink-alt">
        They do not need an account yet: the role waits for them and is theirs the first time they
        sign in. To take a role away, give them “No role”.
      </p>
      <form
        className="flex flex-col gap-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          grant.mutate();
        }}
      >
        <TextField
          className="flex-1"
          label="Their email address"
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            grant.reset();
          }}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor={roleId} className="font-semibold">
            Role
          </label>
          <select
            id={roleId}
            value={role}
            onChange={(e) => {
              const next = grantable.find((r) => r === e.target.value);
              if (next) setRole(next);
            }}
            className="rounded-card border border-line bg-surface px-3 py-2"
          >
            {grantable.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={grant.isPending}>
          Save
        </Button>
      </form>
      <p className="text-sm text-muted">{ROLE_EXPLAINED[role]}</p>
      <ErrorText error={grant.error} />
      {grant.isSuccess && (
        <Done>
          {grant.data.unchanged
            ? `${email.trim()} already had that role.`
            : `${email.trim()} is now: ${ROLE_LABELS[role]}.`}
        </Done>
      )}
    </Panel>
  );
}

function People() {
  const people = useQuery({
    queryKey: ['identity', 'people'],
    queryFn: ({ signal }) => call(listPeople, { signal }),
  });
  return (
    <Panel title="People with a role">
      <ErrorText error={people.error} />
      {people.data?.people.length === 0 && <p>Nobody holds a role yet.</p>}
      {people.data && people.data.people.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">People with a role</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-4">
                  Address
                </th>
                <th scope="col" className="py-2 pr-4">
                  Role
                </th>
                <th scope="col" className="py-2">
                  Organizations
                </th>
              </tr>
            </thead>
            <tbody>
              {people.data.people.map((p) => (
                <tr key={p.email} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4 break-all">{p.email}</td>
                  <td className="py-2 pr-4">{ROLE_LABELS[p.role]}</td>
                  <td className="py-2">
                    {p.organizations.map((o) => `${o.name} (${o.role})`).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/**
 * The owner's seat. The owner hands it on in three deliberate steps: the
 * address, a code sent to the OWNER naming that address, then the offer.
 * Nothing moves until the other person accepts.
 */
function OwnerSeat({ me }: { me: SignedInMe }) {
  const client = useQueryClient();
  const changed = useIdentityChanged();
  const owner = useQuery({
    queryKey: ['identity', 'owner'],
    queryFn: ({ signal }) => call(getOwner, { signal }),
  });
  const [to, setTo] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ['identity', 'owner'] });

  const askCode = useMutation({
    mutationFn: () => call(requestHandoverCode, { body: { email: to } }),
    onSuccess: () => {
      setCodeSent(true);
    },
  });
  const offer = useMutation({
    mutationFn: () => call(offerHandover, { body: { email: to, code } }),
    onSuccess: async () => {
      setCodeSent(false);
      setCode('');
      await refresh();
    },
  });
  const cancel = useMutation({ mutationFn: () => call(cancelHandover), onSuccess: refresh });
  const accept = useMutation({
    mutationFn: () => call(acceptHandover),
    onSuccess: async () => {
      await changed();
    },
  });

  const o = owner.data;
  if (!o) return <ErrorText error={owner.error} />;

  if (o.awaitingMyAcceptance) {
    return (
      <Panel title="You have been offered this deployment">
        <p>
          The owner has offered to hand this deployment to you. If you accept, you become its owner:
          the one person who appoints administrators and can hand it on again. The current owner
          becomes an administrator.
        </p>
        <ErrorText error={accept.error} />
        {accept.isSuccess ? (
          <Done>You are now the owner.</Done>
        ) : (
          <Button
            type="button"
            disabled={accept.isPending}
            onClick={() => {
              accept.mutate();
            }}
          >
            Accept ownership
          </Button>
        )}
      </Panel>
    );
  }
  if (!me.grantsAccess) return null;

  return (
    <Panel title="The owner">
      <p>
        {o.iAmOwner ? (
          'You own this deployment.'
        ) : (
          <>
            This deployment is owned by <strong>{o.owner ?? 'nobody yet'}</strong>.
          </>
        )}
      </p>
      {o.pending && (
        <div className="space-y-2">
          <p>
            Offered to <strong>{o.pending.to}</strong>, waiting for them to accept, until{' '}
            {new Date(o.pending.expiresAt).toUTCString()}.
          </p>
          {o.iAmOwner && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                cancel.mutate();
              }}
            >
              Withdraw the offer
            </Button>
          )}
        </div>
      )}
      {o.iAmOwner && !codeSent && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            askCode.mutate();
          }}
        >
          <p className="text-ink-alt">
            Handing the deployment on cannot be undone once the other person accepts: only they can
            appoint administrators afterwards. We will email you a code that works for this address
            and no other.
          </p>
          <TextField
            label="Hand it to (email address)"
            type="email"
            required
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
          />
          <ErrorText error={askCode.error} />
          <Button type="submit" variant="secondary" disabled={askCode.isPending}>
            Email me a code
          </Button>
        </form>
      )}
      {o.iAmOwner && codeSent && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            offer.mutate();
          }}
        >
          <p>
            A code is on its way to your own address. It offers the deployment to{' '}
            <strong>{to.trim()}</strong> only.
          </p>
          <TextField
            label="The code from the email"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ''));
            }}
          />
          <ErrorText error={offer.error} />
          <div className="flex flex-wrap gap-4">
            <Button type="submit" variant="secondary" disabled={offer.isPending}>
              Offer the deployment
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setCodeSent(false);
              }}
            >
              Change the address
            </Button>
          </div>
        </form>
      )}
      {offer.isSuccess && <Done>Offered. Nothing changes until they accept.</Done>}
    </Panel>
  );
}

function SitePassword() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ['identity', 'site-access'],
    queryFn: ({ signal }) => call(getSiteAccessSettings, { signal }),
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const save = useMutation({
    mutationFn: (body: { enabled?: boolean; password?: string; passwordConfirm?: string }) =>
      call(updateSiteAccess, { body }),
    onSuccess: async () => {
      setPassword('');
      setConfirm('');
      await client.invalidateQueries({ queryKey: ['identity', 'site-access'] });
    },
  });
  const s = settings.data;
  if (!s) return <ErrorText error={settings.error} />;
  const on = s.enabled && s.hasPassword;
  return (
    <Panel title="The site password">
      <p>
        {on
          ? 'The site is behind a password. Only people who have it can see anything.'
          : 'The site is open: there is no password in front of it.'}
      </p>
      {s.hasPassword && (
        <Button
          type="button"
          variant="secondary"
          disabled={save.isPending}
          onClick={() => {
            save.mutate({ enabled: !s.enabled });
          }}
        >
          {s.enabled ? 'Turn the password off' : 'Turn the password back on'}
        </Button>
      )}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ password, passwordConfirm: confirm });
        }}
      >
        <TextField
          label={s.hasPassword ? 'New site password' : 'Site password'}
          hint={`At least ${String(s.minPassword)} characters. Setting one turns the password on.`}
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
        <ErrorText error={save.error} />
        <Button type="submit" variant="secondary" disabled={save.isPending || !password}>
          Set the password
        </Button>
      </form>
    </Panel>
  );
}

/**
 * The owner clears somebody else's second factor (plan E, E3): for the
 * person who lost their phone and their recovery codes. Asks for the
 * owner's own factor first, and is recorded in "Who changed what". The
 * owner's own is reset only on the server.
 */
function ResetSecondFactor() {
  const [email, setEmail] = useState('');
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const reset = useMutation({
    mutationFn: () => call(resetSecondFactor, { body: { email } }),
    onSuccess: () => {
      setDoneFor(email.trim());
      setEmail('');
    },
  });
  return (
    <Panel title="Reset somebody's second factor">
      <p>
        For somebody who has lost their authenticator app, their passkeys and their recovery codes.
        It signs them out everywhere; their next sign-in sets a new one up. Your own is reset only
        on the server: <code>sudo reportlog reset-2fa</code> and your address.
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setDoneFor(null);
          reset.mutate();
        }}
      >
        <TextField
          label="Whose second factor to reset (an email address)"
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <ErrorText error={reset.error} />
        {doneFor && (
          <Done>Reset. {doneFor} sets a new second factor up when they next sign in.</Done>
        )}
        <Button type="submit" variant="secondary" disabled={reset.isPending}>
          Reset their second factor
        </Button>
      </form>
    </Panel>
  );
}
