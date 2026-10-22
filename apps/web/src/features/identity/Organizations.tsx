/**
 * Organizations: the list (and making one) for those who grant access, and
 * one organization's people and invitations for its managers too.
 *
 * Silence is the only answer an invitee gives (there is deliberately no
 * decline button), so the invitations list shows what is still waiting, with
 * resend and withdraw, and a typo is recoverable from here alone.
 */
import {
  ApiError,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  addMember,
  approveInvitation,
  createInvitation,
  createOrganization,
  getOrganization,
  listInvitations,
  listOrganizations,
  removeMember,
  removeOrganizationLogo,
  resendInvitation,
  uploadOrganizationLogo,
  withdrawInvitation,
} from '@reportlog/contracts';
import type { OrgRoleName } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Chip } from '@/components/ui/chip.tsx';
import { Empty } from '@/components/ui/empty.tsx';
import { FileDrop } from '@/components/ui/file-drop.tsx';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';
import { CountLine } from '@/components/ui/type.tsx';
import { ApiRequestError, call, pathFor } from '../../lib/api.ts';
import { StaffPage } from '../nav/StaffPage.tsx';
import { useMe } from './session.ts';
import { SignInPrompt } from './SignInPrompt.tsx';
import { Done, ErrorText, Panel, Section, TextField } from './ui.tsx';

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
  const list = orgs.data?.organizations ?? [];

  return (
    <StaffPage
      title="Organizations"
      lede="Groups that file reports under their own name: their managers and coordinators, their invitations, and how they appear in the public directory."
    >
      <ErrorText error={orgs.error} />
      {orgs.isPending ? <p role="status">Reading the organizations…</p> : null}
      {orgs.data && list.length === 0 ? (
        <Empty title="No organizations yet">
          {me.data.grantsAccess
            ? 'Make the first one below. Its manager can then invite its coordinators.'
            : 'You do not belong to an organization.'}
        </Empty>
      ) : null}
      {list.length > 0 ? (
        <>
          <CountLine
            parts={[
              `${String(list.length)} ${list.length === 1 ? 'organization' : 'organizations'}`,
            ]}
          />
          <ul className="flex flex-col gap-3">
            {list.map((o) => (
              <li key={o.id}>
                <Card className="flex-row flex-wrap items-center gap-3 py-3">
                  <Link
                    to="/access/orgs/$id"
                    params={{ id: String(o.id) }}
                    className="min-h-11 flex-1 content-center font-display text-lg font-bold underline"
                  >
                    {o.name}
                  </Link>
                  {o.role ? <Chip tone="tag">You are its {o.role}</Chip> : null}
                </Card>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {me.data.grantsAccess && (
        <Panel title="Make an organization">
          <p className="text-ink-alt">
            An organization files reports under its own name. It needs a manager to run it from the
            start; they can invite its coordinators themselves.
          </p>
          <form
            className="flex flex-col gap-4"
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
            <div>
              <Button type="submit" disabled={create.isPending}>
                Make it
              </Button>
            </div>
            {create.isSuccess && <Done>Made {create.data.organization.name}.</Done>}
          </form>
        </Panel>
      )}
    </StaffPage>
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

  const listingAllowed =
    me.data.memberships.some((m) => m.organization_id === id && m.role === 'manager') ||
    me.data.role === 'admin' ||
    me.data.role === 'owner';

  return (
    <StaffPage title={organization.name} lede={organization.details ?? undefined}>
      <p>
        <Link to="/access/orgs" className="underline">
          ← All organizations
        </Link>
      </p>
      <Section title="People">
        <Panel title="Who is in it" level={3}>
          <CountLine
            parts={[
              `${String(organization.manager_count)} ${organization.manager_count === 1 ? 'manager' : 'managers'}`,
              `${String(organization.coordinator_count)} ${organization.coordinator_count === 1 ? 'coordinator' : 'coordinators'}`,
            ]}
          />
          {members.length === 0 ? (
            <p>Nobody belongs to it yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {members.map((m) => (
                <li key={m.email} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="flex-1 font-mono text-sm break-all">{m.email}</span>
                  <Chip tone="tag">{m.role}</Chip>
                  {m.pending ? <Chip tone="open">Not joined yet</Chip> : null}
                  <Button
                    type="button"
                    variant="quiet"
                    aria-label={`Remove ${m.email}`}
                    onClick={() => {
                      remove.mutate(m.email);
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <ErrorText error={remove.error} />
          {remove.isSuccess && (
            <Done>Removed. Everything they filed stays filed under {organization.name}.</Done>
          )}
        </Panel>

        <InvitePanel id={id} youGrantAccess={youGrantAccess} onChange={refresh} />

        {invites.data && (
          <Panel title="Invitations waiting" level={3}>
            {invites.data.invitations.length === 0 ? (
              <p>Nothing is waiting.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
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
      </Section>

      {listingAllowed || org.data.youManageIt || youGrantAccess ? (
        <Section title="How it appears">
          {/* Workstream G2: the organization's own decision to be in the public directory. */}
          {listingAllowed ? (
            <Panel title="The public directory" level={3}>
              <p>
                Whether it is listed among the participating organizations, and what the listing
                says, is the organization’s own decision.
              </p>
              <p>
                <Link
                  to="/organizations/$id/listing"
                  params={{ id: String(id) }}
                  className="underline"
                >
                  Listing in the public directory
                </Link>
              </p>
            </Panel>
          ) : null}
          {(org.data.youManageIt || youGrantAccess) && (
            <LogoPanel id={id} logo={organization.logo} onChange={refresh} />
          )}
        </Section>
      ) : null}
    </StaffPage>
  );
}

/**
 * The organization's logo. It is re-encoded on the server, so what is kept
 * is the picture alone, and the public sees it only while the organization
 * is listed in the directory.
 */
function LogoPanel({
  id,
  logo,
  onChange,
}: {
  id: number;
  logo: string | null;
  onChange: () => Promise<void>;
}) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: (chosen: File) => uploadLogo(id, chosen),
    onSuccess: async () => {
      setFile(null);
      await onChange();
    },
  });
  const remove = useMutation({
    mutationFn: () => call(removeOrganizationLogo, { params: { id } }),
    onSuccess: onChange,
  });
  return (
    <Panel title="Logo" level={3}>
      <p className="text-ink-alt">
        Shown beside the organization’s name in the public directory, while it is listed. Until then
        only its managers and the people who grant access see it. A PNG, JPEG or WebP image of at
        most {String(LOGO_MAX_BYTES / 1024 / 1024)} MB. It is copied without anything but the
        picture: no location, camera or author.
      </p>
      {logo ? (
        <img
          src={logo}
          alt="The organization’s logo as it is now"
          className="h-24 w-24 rounded-card border border-line object-contain"
        />
      ) : (
        <p>There is no logo yet.</p>
      )}
      <form
        className="flex flex-col gap-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (file) save.mutate(file);
        }}
      >
        <div className="flex flex-col gap-1">
          <p id={`${inputId}-label`} className="label-face text-xs text-ink">
            {logo ? 'A new logo' : 'A logo'}
          </p>
          <FileDrop
            labelledBy={`${inputId}-label`}
            accept={LOGO_TYPES.join(',')}
            buttonLabel="Choose an image"
            onFiles={(files) => {
              setFile(files[0] ?? null);
              save.reset();
            }}
          />
          {file ? <p className="text-sm text-ink-alt">Chosen: {file.name}</p> : null}
        </div>
        <Button type="submit" disabled={!file || save.isPending}>
          {save.isPending ? 'Saving…' : 'Use this image'}
        </Button>
        {logo && (
          <Button
            type="button"
            variant="quiet"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate();
            }}
          >
            Remove the logo
          </Button>
        )}
      </form>
      <ErrorText error={save.error ?? remove.error} />
      {save.isSuccess && <Done>Saved.</Done>}
      {remove.isSuccess && <Done>Removed.</Done>}
    </Panel>
  );
}

/** The body is the image itself, not JSON, so this is the one call that does not go through `call`. */
async function uploadLogo(id: number, file: File) {
  const res = await fetch(pathFor(uploadOrganizationLogo.path, { id }), {
    method: uploadOrganizationLogo.method,
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
    credentials: 'same-origin',
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(json);
    throw err.success
      ? new ApiRequestError(res.status, err.data.error.code, err.data.error.message)
      : new ApiRequestError(res.status, 'unknown', `The server answered ${String(res.status)}.`);
  }
  return uploadOrganizationLogo.response.parse(json);
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
    <Panel title="Invite somebody" level={3}>
      <p className="text-ink-alt">
        One address at a time. They are emailed a link that works once, shows them what the role can
        and cannot do, and does nothing until they accept.
        {!youGrantAccess && ' Inviting another manager waits for an administrator to approve it.'}
      </p>
      <form
        className="flex flex-col gap-4"
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
        <div className="flex flex-col gap-1.5">
          <p id={roleId} className="label-face text-xs text-ink">
            As
          </p>
          <RadioGroup
            aria-labelledby={roleId}
            value={role}
            onValueChange={(v) => {
              setRole(v === 'manager' ? 'manager' : 'coordinator');
            }}
            className="sm:flex-row"
          >
            <RadioOption value="coordinator" label="Coordinator" hint="Files for it." />
            <RadioOption value="manager" label="Manager" hint="Files for it and runs it." />
          </RadioGroup>
        </div>
        <div>
          <Button type="submit" disabled={invite.isPending}>
            Send the invitation
          </Button>
        </div>
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
    <li className="flex flex-col gap-2 py-2">
      <p>
        <span className="font-mono text-sm break-all">{i.email}</span> as {i.role}: {state}.
      </p>
      <div className="flex flex-wrap gap-2">
        {i.status === 'pending' && (
          <Button
            type="button"

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
    <Panel title="Add a manager directly" level={3}>
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
