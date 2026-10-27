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
import { roleSatisfies } from '@reportlog/access';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { FileDrop } from '@/components/ui/file-drop.tsx';
import { ApiRequestError, call, pathFor } from '../../lib/api.ts';
import { Back } from '../../mockup/Back.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { Choice, Choices } from '../../mockup/Choice.tsx';
import { Chip } from '../../mockup/Chip.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { TextField } from '@/mockup/Field.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Saved } from '../../mockup/Saved.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { useMe } from './session.ts';
import { SignInPrompt } from './SignInPrompt.tsx';

const ROW_COLS = { '--cols': '1fr auto' } as CSSProperties;

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
      lede="Groups whose members file through their own links and see their reports first."
    >
      <ErrorLine error={orgs.error} />
      {orgs.isPending ? <p role="status">Reading the organizations…</p> : null}
      {orgs.data && list.length === 0 ? (
        <Empty title="No organizations yet">
          {me.data.grantsAccess
            ? 'Make the first one below. Its manager can then invite its coordinators.'
            : 'You do not belong to an organization.'}
        </Empty>
      ) : null}
      {list.length > 0 ? (
        <div className="rows">
          {list.map((o) => (
            <Link
              key={o.id}
              className="row"
              to="/access/orgs/$id"
              params={{ id: String(o.id) }}
              style={ROW_COLS}
            >
              <span className="t">{o.name}</span>
              <span>{o.role ? <Chip>You are its {o.role}</Chip> : null}</span>
            </Link>
          ))}
        </div>
      ) : null}
      {me.data.grantsAccess && (
        <Panel title="Make an organization">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <TextField
              label="Its name"
              help="An organization files reports under its own name. It needs a manager to run it from the start; they can invite its coordinators themselves."
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
            <ErrorLine error={create.error} />
            {create.isSuccess && <Saved>Made {create.data.organization.name}.</Saved>}
            <Btn sm flat look="ink" type="submit" disabled={create.isPending}>
              Make it
            </Btn>
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
  if (org.isError) return <ErrorLine error={org.error} />;
  if (!org.data) return <p role="status">Loading…</p>;
  const { organization, members, youGrantAccess } = org.data;

  const listingAllowed =
    me.data.memberships.some((m) => m.organization_id === id && m.role === 'manager') ||
    roleSatisfies(me.data.roles, 'admin');

  return (
    <StaffPage title={organization.name} lede={organization.details ?? undefined}>
      <Back to="/access/orgs">All organizations</Back>
      <Panel title="Who is in it">
        {members.length === 0 ? (
          <p>Nobody belongs to it yet.</p>
        ) : (
          <Tbl
            cols={['Who', 'Role', '']}
            widths="1fr 1fr auto"
            rows={members.map((m) => ({
              key: m.email,
              cells: [
                m.email,
                <>
                  <Chip>{m.role}</Chip>
                  {m.pending ? <Chip kind="off">Not joined yet</Chip> : null}
                </>,
                <Btn sm flat
                  look="ghost"
                  aria-label={`Remove ${m.email}`}
                  onClick={() => {
                    remove.mutate(m.email);
                  }}
                >
                  Remove
                </Btn>,
              ],
            }))}
          />
        )}
        <ErrorLine error={remove.error} />
        {remove.isSuccess && (
          <Saved>Removed. Everything they filed stays filed under {organization.name}.</Saved>
        )}
      </Panel>

      <InvitePanel id={id} youGrantAccess={youGrantAccess} onChange={refresh} />

      {invites.data && invites.data.invitations.length > 0 && (
        <Panel title="Invitations waiting">
          {invites.data.invitations.map((i) => (
            <InvitationRow
              key={i.email}
              id={id}
              invitation={i}
              youGrantAccess={youGrantAccess}
              onChange={refresh}
            />
          ))}
        </Panel>
      )}

      {youGrantAccess && <AddDirectly id={id} onChange={refresh} />}

      {/* Workstream G2: the organization's own decision to be in the public directory. */}
      {listingAllowed ? (
        <Panel title="The public directory">
          <p>
            Whether it is listed among the participating organizations, and what the listing says,
            is the organization’s own decision.
          </p>
          <p>
            <Link to="/organizations/$id/listing" params={{ id: String(id) }}>
              Listing in the public directory
            </Link>
          </p>
        </Panel>
      ) : null}
      {org.data.youManageIt || youGrantAccess ? (
        <LogoPanel id={id} logo={organization.logo} onChange={refresh} />
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
    <Panel title="Logo">
      <p className="m">
        Shown beside the organization’s name in the public directory, while it is listed. Until then
        only its managers and the people who grant access see it. A PNG, JPEG or WebP image of at
        most {String(LOGO_MAX_BYTES / 1024 / 1024)} MB. It is copied without anything but the
        picture: no location, camera or author.
      </p>
      {logo ? (
        <img
          src={logo}
          alt="The organization’s logo as it is now"
          width={96}
          height={96}
          style={{ objectFit: 'contain' }}
        />
      ) : (
        <p>There is no logo yet.</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (file) save.mutate(file);
        }}
      >
        <p id={`${inputId}-label`} className="lbl">
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
        {file ? <p className="m">Chosen: {file.name}</p> : null}
        <div className="acts">
          <Btn sm flat type="submit" disabled={!file || save.isPending}>
            {save.isPending ? 'Saving…' : 'Use this image'}
          </Btn>
          {logo && (
            <Btn sm flat
              look="ghost"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate();
              }}
            >
              Remove the logo
            </Btn>
          )}
        </div>
      </form>
      <ErrorLine error={save.error ?? remove.error} />
      {save.isSuccess && <Saved>Saved.</Saved>}
      {remove.isSuccess && <Saved>Removed.</Saved>}
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate();
        }}
      >
        <TextField
          label="Their email address"
          help={`One address at a time. They are emailed a link that works once, shows them what the role can and cannot do, and does nothing until they accept.${
            youGrantAccess
              ? ''
              : ' Inviting another manager waits for an administrator to approve it.'
          }`}
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <Choices>
          <Choice
            name="ir"
            checked={role === 'coordinator'}
            onChange={() => {
              setRole('coordinator');
            }}
          >
            Coordinator
          </Choice>
          <Choice
            name="ir"
            checked={role === 'manager'}
            onChange={() => {
              setRole('manager');
            }}
          >
            Manager
          </Choice>
        </Choices>
        <ErrorLine error={invite.error} />
        {invite.isSuccess && <Saved>{invite.data.message}</Saved>}
        <Btn sm flat look="ink" type="submit" disabled={invite.isPending}>
          Send the invitation
        </Btn>
      </form>
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
    <>
      <p>
        <span className="mono">{i.email}</span> as {i.role}: {state}.
      </p>
      <div className="acts">
        {i.status === 'pending' && (
          <Btn sm flat
            onClick={() => {
              resend.mutate();
            }}
          >
            Send a new link
          </Btn>
        )}
        {i.status === 'awaiting_approval' && youGrantAccess && (
          <Btn sm flat
            onClick={() => {
              approve.mutate();
            }}
          >
            Approve and send
          </Btn>
        )}
        <Btn sm flat
          look="ghost"
          onClick={() => {
            withdraw.mutate();
          }}
        >
          Withdraw
        </Btn>
      </div>
      <ErrorLine error={resend.error ?? approve.error ?? withdraw.error} />
    </>
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <TextField
          label="Manager’s email address"
          help="Without an invitation, for an organization’s first manager or a repair. Everybody else should be invited, so they can read what the role means before they have it."
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <ErrorLine error={add.error} />
        <Btn sm flat type="submit" disabled={add.isPending}>
          Add as manager
        </Btn>
      </form>
    </Panel>
  );
}
