/**
 * Organizations: the list (and making one) for those who grant access, and
 * one organization's people and invitations for its managers too.
 *
 * Silence is the only answer an invitee gives (there is deliberately no
 * decline button), so the invitations list shows what is still waiting, with
 * resend and withdraw, and a typo is recoverable from here alone.
 */
import {
  addMember,
  approveInvitation,
  createInvitation,
  createOrganization,
  getOrganization,
  listInvitations,
  listOrganizations,
  removeMember,
  resendInvitation,
  withdrawInvitation,
} from '@reportlog/contracts';
import type { OrgRoleName } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { call } from '../../lib/api.ts';
import { useMe } from './session.ts';
import { SignInPrompt } from './SignInPrompt.tsx';
import { Done, ErrorText, Panel, TextField } from './ui.tsx';

export function OrganizationsPage() {
  const me = useMe();
  const client = useQueryClient();
  const orgs = useQuery({
    queryKey: ['identity', 'orgs'],
    queryFn: ({ signal }) => call(listOrganizations, { signal }),
    enabled: me.data?.signedIn === true,
  });
  const [name, setName] = useState('');
  const [manager, setManager] = useState('');
  const create = useMutation({
    mutationFn: () => call(createOrganization, { body: { name, managerEmails: [manager] } }),
    onSuccess: async () => {
      setName('');
      setManager('');
      await client.invalidateQueries({ queryKey: ['identity', 'orgs'] });
    },
  });

  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next="/access/orgs" />;

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl font-bold">Organizations</h1>
      <ErrorText error={orgs.error} />
      {orgs.data && (
        <ul className="space-y-2">
          {orgs.data.organizations.length === 0 && <li>There are no organizations yet.</li>}
          {orgs.data.organizations.map((o) => (
            <li key={o.id}>
              <Link to="/access/orgs/$id" params={{ id: String(o.id) }} className="underline">
                {o.name}
              </Link>
              {o.role && <span className="text-muted"> · you are its {o.role}</span>}
            </li>
          ))}
        </ul>
      )}
      {me.data.grantsAccess && (
        <Panel title="Make an organization">
          <p className="text-ink-alt">
            An organization files reports under its own name. It needs a manager to run it from the
            start; they can invite its coordinators themselves.
          </p>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <TextField
              label="Its name"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
            <TextField
              label="Its first manager’s email address"
              type="email"
              required
              value={manager}
              onChange={(e) => {
                setManager(e.target.value);
              }}
            />
            <ErrorText error={create.error} />
            <Button type="submit" disabled={create.isPending}>
              Make it
            </Button>
            {create.isSuccess && <Done>Made {create.data.organization.name}.</Done>}
          </form>
        </Panel>
      )}
    </div>
  );
}

export function OrganizationPage({ id }: { id: number }) {
  const me = useMe();
  const client = useQueryClient();
  const org = useQuery({
    queryKey: ['identity', 'org', id],
    queryFn: ({ signal }) => call(getOrganization, { params: { id }, signal }),
    enabled: me.data?.signedIn === true,
  });
  const invites = useQuery({
    queryKey: ['identity', 'org', id, 'invitations'],
    queryFn: ({ signal }) => call(listInvitations, { params: { id }, signal }),
    enabled: org.isSuccess,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['identity', 'org', id] });
  const remove = useMutation({
    mutationFn: (email: string) => call(removeMember, { params: { id, email } }),
    onSuccess: refresh,
  });

  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next={`/access/orgs/${String(id)}`} />;
  if (org.isError) return <ErrorText error={org.error} />;
  if (!org.data) return <p role="status">Loading…</p>;
  const { organization, members, youGrantAccess } = org.data;

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl font-bold">{organization.name}</h1>
      {organization.details && <p className="text-ink-alt">{organization.details}</p>}
      {/* Workstream G2: the organization's own decision to be in the public directory. */}
      {me.data.memberships.some((m) => m.organization_id === id && m.role === 'manager') ||
      me.data.role === 'admin' ||
      me.data.role === 'owner' ? (
        <p>
          <Link to="/organizations/$id/listing" params={{ id: String(id) }} className="underline">
            Listing in the public directory
          </Link>
        </p>
      ) : null}

      <Panel title="People">
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.email} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="break-all">{m.email}</span>
              <span className="text-muted">
                {m.role}
                {m.pending ? ', not joined yet' : ''}
              </span>
              <Button
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => {
                  remove.mutate(m.email);
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <ErrorText error={remove.error} />
        {remove.isSuccess && (
          <Done>Removed. Everything they filed stays filed under {organization.name}.</Done>
        )}
      </Panel>

      <InvitePanel id={id} youGrantAccess={youGrantAccess} onChange={refresh} />

      {invites.data && (
        <Panel title="Invitations waiting">
          {invites.data.invitations.length === 0 ? (
            <p>Nothing is waiting.</p>
          ) : (
            <ul className="space-y-3">
              {invites.data.invitations.map((i) => (
                <InvitationRow
                  key={i.email}
                  id={id}
                  invitation={i}
                  youGrantAccess={youGrantAccess}
                  onChange={refresh}
                />
              ))}
            </ul>
          )}
        </Panel>
      )}

      {youGrantAccess && <AddDirectly id={id} onChange={refresh} />}
    </div>
  );
}

function InvitePanel({
  id,
  youGrantAccess,
  onChange,
}: {
  id: number;
  youGrantAccess: boolean;
  onChange: () => Promise<void>;
}) {
  const roleId = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRoleName>('coordinator');
  const invite = useMutation({
    mutationFn: () => call(createInvitation, { params: { id }, body: { email, role } }),
    onSuccess: async () => {
      setEmail('');
      await onChange();
    },
  });
  return (
    <Panel title="Invite somebody">
      <p className="text-ink-alt">
        One address at a time. They are emailed a link that works once, shows them what the role can
        and cannot do, and does nothing until they accept.
        {!youGrantAccess && ' Inviting another manager waits for an administrator to approve it.'}
      </p>
      <form
        className="flex flex-col gap-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate();
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
          }}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor={roleId} className="font-semibold">
            As
          </label>
          <select
            id={roleId}
            value={role}
            onChange={(e) => {
              setRole(e.target.value === 'manager' ? 'manager' : 'coordinator');
            }}
            className="rounded-card border border-line bg-surface px-3 py-2"
          >
            <option value="coordinator">Coordinator</option>
            <option value="manager">Manager</option>
          </select>
        </div>
        <Button type="submit" disabled={invite.isPending}>
          Send the invitation
        </Button>
      </form>
      <ErrorText error={invite.error} />
      {invite.isSuccess && <Done>{invite.data.message}</Done>}
    </Panel>
  );
}

function InvitationRow({
  id,
  invitation: i,
  youGrantAccess,
  onChange,
}: {
  id: number;
  invitation: {
    email: string;
    role: OrgRoleName;
    status: 'awaiting_approval' | 'pending' | 'joins_on_sign_in';
    expired: boolean;
  };
  youGrantAccess: boolean;
  onChange: () => Promise<void>;
}) {
  const params = { id, email: i.email };
  const resend = useMutation({
    mutationFn: () => call(resendInvitation, { params }),
    onSuccess: onChange,
  });
  const withdraw = useMutation({
    mutationFn: () => call(withdrawInvitation, { params }),
    onSuccess: onChange,
  });
  const approve = useMutation({
    mutationFn: () => call(approveInvitation, { params }),
    onSuccess: onChange,
  });
  const state =
    i.status === 'awaiting_approval'
      ? 'waiting for an administrator to approve it; nothing has been sent'
      : i.status === 'joins_on_sign_in'
        ? 'joins the first time they sign in'
        : i.expired
          ? 'the link has expired'
          : 'link sent, not accepted yet';
  return (
    <li className="space-y-1">
      <p>
        <span className="break-all font-semibold">{i.email}</span> as {i.role}: {state}.
      </p>
      <div className="flex flex-wrap gap-2">
        {i.status === 'pending' && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              resend.mutate();
            }}
          >
            Send a new link
          </Button>
        )}
        {i.status === 'awaiting_approval' && youGrantAccess && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              approve.mutate();
            }}
          >
            Approve and send
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="quiet"
          onClick={() => {
            withdraw.mutate();
          }}
        >
          Withdraw
        </Button>
      </div>
      <ErrorText error={resend.error ?? approve.error ?? withdraw.error} />
    </li>
  );
}

function AddDirectly({ id, onChange }: { id: number; onChange: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const add = useMutation({
    mutationFn: () => call(addMember, { params: { id }, body: { email, role: 'manager' } }),
    onSuccess: async () => {
      setEmail('');
      await onChange();
    },
  });
  return (
    <Panel title="Add a manager directly">
      <p className="text-ink-alt">
        Without an invitation, for an organization’s first manager or a repair. Everybody else
        should be invited, so they can read what the role means before they have it.
      </p>
      <form
        className="flex flex-col gap-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <TextField
          className="flex-1"
          label="Manager’s email address"
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <Button type="submit" variant="secondary" disabled={add.isPending}>
          Add as manager
        </Button>
      </form>
      <ErrorText error={add.error} />
    </Panel>
  );
}
