/**
 * /access: your own account, and for those who grant access, the people and
 * their roles, the owner's seat and the site password.
 *
 * The roles offered are the ones @reportlog/access says this person may hand
 * out, so the form never offers what the server would refuse. The server
 * checks again regardless.
 */
import { canGrantSystemRole, hasAdminAuthority } from '@reportlog/access';
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
import type { HeldRoleName } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { call } from '../../lib/api.ts';
import { Btn } from '@/mockup/Btn.tsx';
import { Choice, Choices } from '../../mockup/Choice.tsx';
import { Dl } from '../../mockup/Dl.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Panel } from '../../mockup/Panel.tsx';
import { Saved } from '../../mockup/Saved.tsx';
import { Switch } from '../../mockup/Switch.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import { TextField } from '../../mockup/Fields.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { DeleteAccount } from './DeleteAccount.tsx';
import { desksFor } from './desks.ts';
import { ROLE_LABELS, rolesLabel, useIdentityChanged, useMe } from './session.ts';
import type { SignedInMe } from './session.ts';
import { SecondFactorGate } from './secondFactor.tsx';
import { SignInPrompt } from './SignInPrompt.tsx';

export function AccessHome() {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next="/access" />;
  const user = me.data;
  return (
    <SecondFactorGate>
      <StaffPage
        title={user.grantsAccess ? 'People and roles' : 'Your account'}
        {...(user.grantsAccess ? {} : { area: 'Account' })}
        lede={
          user.grantsAccess
            ? 'Who can do what on this site.'
            : 'Your role on this site and how you sign in.'
        }
      >
        {/* settings-and-admin.md §12: in this order, each only to whom may use
            it. Organizations, the roster and the record are the area's tabs. */}
        <YourAccount me={user} />
        {user.grantsAccess && (
          <>
            <People />
            <GrantRole me={user} />
          </>
        )}
        {user.roles.includes('owner') && <ResetSecondFactor />}
        {/* An anchor of its own: the staff sidebar links straight here. */}
        {hasAdminAuthority(user.roles) && <SitePassword />}
        {/* An anchor of its own: "Delete your account" sends the owner here. */}
        <OwnerSeat me={user} />
        <DeleteAccount me={user} />
      </StaffPage>
    </SecondFactorGate>
  );
}

function YourAccount({ me }: { me: SignedInMe }) {
  const desks = me.teamMember ? desksFor(me.desks, me) : [];
  const items: [ReactNode, ReactNode][] = [
    ['Signed in as', me.email],
    ['Roles', rolesLabel(me.heldRoles)],
  ];
  if (me.memberships.length > 0) {
    items.push([
      'Organizations',
      me.memberships.map((m, i) => (
        <span key={m.organization_id}>
          {i > 0 ? ', ' : ''}
          {m.role === 'manager' ? (
            <Link to="/access/orgs/$id" params={{ id: String(m.organization_id) }}>
              {m.name}
            </Link>
          ) : (
            m.name
          )}{' '}
          ({m.role === 'manager' ? 'manager' : 'coordinator'})
        </span>
      )),
    ]);
  }
  if (me.secondFactor === 'done' || me.secondFactor === 'optional') {
    items.push([
      'Second factor',
      <>
        {me.secondFactor === 'done'
          ? 'Asked for when you sign in · '
          : 'Optional for journalists, and we encourage it · '}
        <Link to="/access/security">Signing in</Link>
      </>,
    ]);
  }
  if (me.tester) items.push(['Tester', 'You can open the feedback tracker.']);
  if (me.teamMember) {
    items.push([
      'The team',
      'You are on the team. That opens the team’s guides; it opens no report.',
    ]);
    if (desks.length > 0) {
      items.push([
        'Your desks',
        desks.map((d, i) => (
          <span key={d.id}>
            {i > 0 ? '; ' : ''}
            {d.label}
            {d.start && (
              <>
                {': start at '}
                <Link to={d.start.to}>{d.start.label}</Link>
              </>
            )}
          </span>
        )),
      ]);
    }
  }
  return (
    <Panel title="You">
      <Dl items={items} />
    </Panel>
  );
}

/** The staff roles offered as boxes. The journalist is shown apart: it is never ticked here. */
const STAFF_CHOICES = ['moderator', 'access_manager', 'admin'] as const;

const peopleQuery = {
  queryKey: ['identity', 'people'],
  queryFn: ({ signal }: { signal: AbortSignal }) => call(listPeople, { signal }),
};

/**
 * Roles are granted and revoked one at a time (decision 70). The boxes show
 * what the person holds now; Save sends one call for each box that changed,
 * each its own line in the record. Only roles this person may hand out
 * (packages/access, MAY_GRANT) can be changed: the server checks again.
 */
function GrantRole({ me }: { me: SignedInMe }) {
  const client = useQueryClient();
  const changed = useIdentityChanged();
  const people = useQuery(peopleQuery);
  const [email, setEmail] = useState('');
  // null follows what the person holds now; a list is what has been ticked.
  const [picked, setPicked] = useState<readonly HeldRoleName[] | null>(null);
  const typed = email.trim().toLowerCase();
  const current: readonly HeldRoleName[] =
    people.data?.people.find((p) => p.email.toLowerCase() === typed)?.roles ?? [];
  const wanted = picked ?? current;
  const isJournalist = current.includes('journalist');
  const isMe = typed === me.email.toLowerCase();
  const changes = STAFF_CHOICES.filter((r) => current.includes(r) !== wanted.includes(r));

  const save = useMutation({
    mutationFn: async () => {
      let roles: readonly HeldRoleName[] = current;
      for (const r of changes) {
        const out = await call(setSystemRole, {
          body: { email: typed, role: r, action: wanted.includes(r) ? 'grant' : 'revoke' },
        });
        roles = out.roles;
      }
      return roles;
    },
    onSuccess: async () => {
      setPicked(null);
      await client.invalidateQueries({ queryKey: ['identity', 'people'] });
      await changed();
    },
  });

  return (
    <Panel title="Give somebody a role">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <TextField
          label="Their email address"
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setPicked(null);
            save.reset();
          }}
        />
        <Choices>
          {STAFF_CHOICES.map((r) => {
            // A journalist holds no staff role, and nobody changes their own roles.
            const allowed = canGrantSystemRole(me.roles, r) && !isJournalist && !isMe;
            return (
              <Choice
                multi
                key={r}
                name="roles"
                checked={wanted.includes(r)}
                disabled={!allowed}
                onChange={(e) => {
                  setPicked(e.target.checked ? [...wanted, r] : wanted.filter((x) => x !== r));
                  save.reset();
                }}
              >
                {ROLE_LABELS[r]}
              </Choice>
            );
          })}
        </Choices>
        <p className="m">
          {isMe
            ? 'You cannot change your own roles.'
            : isJournalist
              ? 'This person is a journalist, and a journalist cannot also hold a staff role.'
              : 'A role waits for somebody without an account and is theirs when they first sign in. To take a role away, untick it. A journalist role comes only from approving a request.'}
        </p>
        <ErrorLine error={save.error} />
        {save.isSuccess && (
          <Saved>
            {save.data.length
              ? `${typed} now holds: ${rolesLabel(save.data)}.`
              : `${typed} now holds no role.`}
          </Saved>
        )}
        <Btn sm flat look="ink" type="submit" disabled={!changes.length || save.isPending}>
          {save.isPending ? 'Saving…' : 'Give the role'}
        </Btn>
      </form>
    </Panel>
  );
}

function People() {
  const people = useQuery(peopleQuery);
  return (
    <Panel title="People with a role">
      <ErrorLine error={people.error} />
      {people.data?.people.length === 0 && <p>Nobody holds a role yet.</p>}
      {people.data && people.data.people.length > 0 && (
        <Tbl
          cols={['Address', 'Role', 'Organizations']}
          rows={people.data.people.map((p) => ({
            key: p.email,
            cells: [
              p.email,
              rolesLabel(p.roles),
              p.organizations.map((o) => `${o.name} (${o.role})`).join(', '),
            ],
          }))}
        />
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
  if (!o) return <ErrorLine error={owner.error} />;

  if (o.awaitingMyAcceptance) {
    return (
      <Panel title="You have been offered this deployment" id="owner-seat">
        <p>
          The owner has offered to hand this deployment to you. If you accept, you become its owner:
          the one person who appoints administrators and can hand it on again. The current owner
          becomes an administrator.
        </p>
        <ErrorLine error={accept.error} />
        {accept.isSuccess ? (
          <Saved>You are now the owner.</Saved>
        ) : (
          <Btn sm flat
            look="ink"
            disabled={accept.isPending}
            onClick={() => {
              accept.mutate();
            }}
          >
            Accept ownership
          </Btn>
        )}
      </Panel>
    );
  }
  if (!me.grantsAccess) return null;

  return (
    <Panel title="The owner" id="owner-seat">
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
        <>
          <p>
            Offered to <strong>{o.pending.to}</strong>, waiting for them to accept, until{' '}
            {new Date(o.pending.expiresAt).toUTCString()}.
          </p>
          {o.iAmOwner && (
            <Btn sm flat
              onClick={() => {
                cancel.mutate();
              }}
            >
              Withdraw the offer
            </Btn>
          )}
        </>
      )}
      {o.iAmOwner && (
        <ol className="steps">
          <li>
            <span>
              <b>Hand it to</b>Their email address
            </span>
          </li>
          <li>
            <span>
              <b>Email me a code</b>Confirms it is you
            </span>
          </li>
          <li>
            <span>
              <b>Offer the deployment</b>They accept on their account
            </span>
          </li>
        </ol>
      )}
      {o.iAmOwner && !codeSent && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            askCode.mutate();
          }}
        >
          <p className="m">
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
          <ErrorLine error={askCode.error} />
          <Btn sm flat type="submit" disabled={askCode.isPending}>
            Start the hand-over
          </Btn>
        </form>
      )}
      {o.iAmOwner && codeSent && (
        <form
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
          <ErrorLine error={offer.error} />
          <div className="acts">
            <Btn sm flat look="ink" type="submit" disabled={offer.isPending}>
              Offer the deployment
            </Btn>
            <Btn sm flat
              look="ghost"
              onClick={() => {
                setCodeSent(false);
              }}
            >
              Change the address
            </Btn>
          </div>
        </form>
      )}
      {offer.isSuccess && <Saved>Offered. Nothing changes until they accept.</Saved>}
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
  if (!s) return <ErrorLine error={settings.error} />;
  const on = s.enabled && s.hasPassword;
  return (
    <Panel title="The site password" id="site-password">
      {s.hasPassword && (
        <Switch
          title="Password on"
          sub={
            on
              ? 'Everyone but the open forms needs the password.'
              : 'The site is open: there is no password in front of it.'
          }
          on={on}
          disabled={save.isPending}
          onChange={(next) => {
            save.mutate({ enabled: next });
          }}
        />
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ password, passwordConfirm: confirm });
        }}
      >
        <TextField
          label={s.hasPassword ? 'New site password' : 'Site password'}
          help={`At least ${String(s.minPassword)} characters. Setting one turns the password on.`}
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
        <ErrorLine error={save.error} />
        <Btn sm flat look="ink" type="submit" disabled={save.isPending || !password}>
          Set the password
        </Btn>
      </form>
    </Panel>
  );
}

/**
 * The owner clears somebody else's second factor (plan E, E3): for the
 * person who lost their phone and their recovery codes. Asks for the
 * owner's own factor first, and is recorded in "Who granted what". The
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setDoneFor(null);
          reset.mutate();
        }}
      >
        <TextField
          label="Their email address"
          help={
            <>
              For somebody who has lost their authenticator app, their passkeys and their recovery
              codes. It signs them out everywhere; their next sign-in sets a new one up. Your own is
              reset only on the server: <code>sudo reportlog reset-2fa</code> and your address.
            </>
          }
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <ErrorLine error={reset.error} />
        {doneFor && (
          <Saved>Reset. {doneFor} sets a new second factor up when they next sign in.</Saved>
        )}
        <Btn sm flat type="submit" disabled={reset.isPending}>
          Reset their second factor
        </Btn>
      </form>
    </Panel>
  );
}
