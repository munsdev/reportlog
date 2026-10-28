/**
 * /people: everybody with a role, a flag or a place in an organization, in
 * one table, and one place to change a person (menu.ts). It does what four
 * pages did between them: People and roles (the table and "Give somebody a
 * role"), Who is doing what (team, desks, activity), Testers (the flag) and
 * Who granted what (now /people/history and each person's own lines).
 *
 * Nothing new on the server: the table is the roster's (getRoster), and a
 * change is the same calls those pages made, one per thing changed, so each
 * is its own line in the record. What may be offered is asked of
 * @reportlog/access, as there, and the server checks again regardless.
 *
 * Sorted by address and never by volume: filing a lot is what a coordinator
 * is for (Roster.tsx says the same).
 */
import { canChangeSubject, canGrantSystemRole, canSetFlag } from '@reportlog/access';
import {
  DESKS,
  getRoster,
  listAudit,
  resetSecondFactor,
  setSystemRole,
  setTeamMember,
  setTester,
} from '@reportlog/contracts';
import type { HeldRoleName } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../lib/api.ts';
import { Btn } from '@/mockup/Btn.tsx';
import { Choice, Choices } from '@/mockup/Choice.tsx';
import { Empty } from '@/mockup/Empty.tsx';
import { ErrorLine } from '@/mockup/ErrorLine.tsx';
import { TextField } from '@/mockup/Field.tsx';
import { Filters } from '@/mockup/Filters.tsx';
import { Modal } from '@/mockup/Modal.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Saved } from '@/mockup/Saved.tsx';
import { Tbl } from '@/mockup/Tbl.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { auditSentence } from '../identity/AuditPage.tsx';
import { deskLabel } from '../identity/desks.ts';
import { ROLE_LABELS, rolesLabel, useIdentityChanged, useMe } from '../identity/session.ts';
import type { SignedInMe } from '../identity/session.ts';
import { StaffOnly } from '../identity/StaffOnly.tsx';
import { PeopleTabs } from './PeopleTabs.tsx';

type RosterPerson = Awaited<ReturnType<typeof fetchRoster>>['people'][number];
const fetchRoster = (signal: AbortSignal) => call(getRoster, { query: { days: 30 }, signal });
const rosterQuery = {
  queryKey: ['identity', 'roster', 30],
  queryFn: ({ signal }: { signal: AbortSignal }) => fetchRoster(signal),
};
const auditQuery = {
  queryKey: ['identity', 'audit'],
  queryFn: ({ signal }: { signal: AbortSignal }) => call(listAudit, { signal }),
};

// As the other forms draw a group of boxes (LimitsForm.tsx, CardFrame.tsx).
const FIELDSET = { border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 } as const;

/** The staff roles offered as boxes. A journalist's comes only from approving a request. */
const STAFF_CHOICES = ['moderator', 'access_manager', 'admin'] as const;

type Show = 'everyone' | 'staff' | 'journalists' | 'testers' | 'team' | 'organizations';

const isStaff = (p: RosterPerson) => p.roles.some((r) => r !== 'journalist');
const SHOWS: Record<Show, (p: RosterPerson) => boolean> = {
  everyone: () => true,
  staff: isStaff,
  journalists: (p) => p.roles.includes('journalist'),
  testers: (p) => p.tester,
  team: (p) => p.teamMember,
  organizations: (p) => p.organizations.length > 0,
};

export function PeoplePage() {
  return (
    <StaffOnly needs={['admin', 'access_manager']}>
      <People />
    </StaffOnly>
  );
}

/** "Moderator, tester, team (Testing)": what a person holds, in one line. */
export function holds(p: RosterPerson): string {
  return [
    p.roles.length ? rolesLabel(p.roles) : null,
    p.tester ? 'tester' : null,
    p.teamMember
      ? `team${p.desks.length ? ` (${p.desks.map((d) => deskLabel(d) ?? d).join(', ')})` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function People() {
  const me = useMe();
  const roster = useQuery(rosterQuery);
  const [show, setShow] = useState<Show>('everyone');
  const [search, setSearch] = useState('');
  // The person being changed: an address, '' for somebody new, null for nobody.
  const [editing, setEditing] = useState<string | null>(null);
  const user = me.data?.signedIn ? me.data : null;

  const all = [...(roster.data?.people ?? [])].sort((a, b) => a.email.localeCompare(b.email));
  const typed = search.trim().toLowerCase();
  const people = all.filter((p) => SHOWS[show](p) && (!typed || p.email.includes(typed)));
  const count = (s: Show) => all.filter(SHOWS[s]).length;

  return (
    <StaffPage
      title="People"
      lede="Everyone who holds a role, a flag or a place in an organization, and what they may do."
      tabs={<PeopleTabs />}
      actions={
        <Btn
          sm
          flat
          look="ink"
          onClick={() => {
            setEditing('');
          }}
        >
          Give somebody access
        </Btn>
      }
    >
      <Panel title="Everyone">
        <div className="toolbar">
          <Filters<Show>
            label="Show"
            value={show}
            onChange={setShow}
            options={[
              { value: 'everyone', label: 'Everyone', n: count('everyone') },
              { value: 'staff', label: 'Staff', n: count('staff') },
              { value: 'journalists', label: 'Journalists', n: count('journalists') },
              { value: 'testers', label: 'Testers', n: count('testers') },
              { value: 'team', label: 'The team', n: count('team') },
              { value: 'organizations', label: 'Organizations', n: count('organizations') },
            ]}
          />
          <div className="search grow">
            <input
              type="search"
              aria-label="Find by address"
              placeholder="Find by address"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          </div>
        </div>
        <ErrorLine error={roster.error} />
        {roster.isPending ? <p role="status">Reading who is here…</p> : null}
        {roster.data && all.length === 0 ? (
          <Empty title="Nobody yet">
            Nobody holds a role, a flag or a membership yet. Give somebody access to start.
          </Empty>
        ) : null}
        {roster.data && all.length > 0 && people.length === 0 ? (
          <p className="m">Nobody matches.</p>
        ) : null}
        {people.length > 0 ? (
          <Tbl
            cols={[
              'Address',
              'Roles and flags',
              'Organizations',
              'Typed up, 30 days',
              'Last acted',
              '',
            ]}
            widths="1.4fr 1.4fr 1.2fr .7fr .8fr auto"
            rows={people.map((p) => ({
              key: p.email,
              cells: [
                p.email,
                holds(p) || '—',
                p.organizations.map((o) => `${o.name} (${o.role})`).join(', ') || '—',
                p.filedByThem,
                p.lastStaffAction ? (
                  <time dateTime={p.lastStaffAction}>{p.lastStaffAction.slice(0, 10)}</time>
                ) : (
                  'Never'
                ),
                <Btn
                  sm
                  flat
                  look="ghost"
                  aria-label={`Change ${p.email}`}
                  onClick={() => {
                    setEditing(p.email);
                  }}
                >
                  Change
                </Btn>,
              ],
            }))}
          />
        ) : null}
      </Panel>
      {user && editing !== null ? (
        <PersonEditor
          key={editing}
          me={user}
          person={all.find((p) => p.email === editing) ?? null}
          onClose={() => {
            setEditing(null);
          }}
        />
      ) : null}
    </StaffPage>
  );
}

/**
 * One person: their roles, the tester flag, the team and desks, their own
 * lines in the record, and (for the owner) resetting their second factor.
 * Save sends one call per thing that changed.
 */
function PersonEditor({
  me,
  person,
  onClose,
}: {
  me: SignedInMe;
  person: RosterPerson | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const changed = useIdentityChanged();
  const audit = useQuery(auditQuery);
  const [email, setEmail] = useState(person?.email ?? '');
  const was = {
    roles: person?.roles ?? ([] as readonly HeldRoleName[]),
    tester: person?.tester ?? false,
    team: person?.teamMember ?? false,
    desks: person?.desks ?? ([] as readonly string[]),
  };
  const [roles, setRoles] = useState<readonly HeldRoleName[]>(was.roles);
  const [tester, setTesterOn] = useState(was.tester);
  const [team, setTeam] = useState(was.team);
  const [desks, setDesks] = useState<readonly string[]>(was.desks);

  const typed = email.trim().toLowerCase();
  const isMe = typed === me.email.toLowerCase();
  const isOwner = was.roles.includes('owner');
  const isJournalist = was.roles.includes('journalist');
  const mayRole = (r: (typeof STAFF_CHOICES)[number]) =>
    !isMe &&
    !isOwner &&
    !isJournalist &&
    canGrantSystemRole(me.roles, r) &&
    (!was.roles.includes(r) || canChangeSubject(me.roles, r));
  const roleChanges = STAFF_CHOICES.filter((r) => was.roles.includes(r) !== roles.includes(r));
  const teamDesks = team ? desks : [];
  const teamChanged =
    team !== was.team ||
    teamDesks.length !== was.desks.length ||
    teamDesks.some((d) => !was.desks.includes(d));
  const anything = roleChanges.length > 0 || tester !== was.tester || teamChanged;

  const save = useMutation({
    mutationFn: async () => {
      for (const r of roleChanges) {
        await call(setSystemRole, {
          body: { email: typed, role: r, action: roles.includes(r) ? 'grant' : 'revoke' },
        });
      }
      if (tester !== was.tester) await call(setTester, { body: { email: typed, tester } });
      if (teamChanged) {
        await call(setTeamMember, {
          body: { email: typed, teamMember: team, desks: [...teamDesks] },
        });
      }
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['identity'] }),
        client.invalidateQueries({ queryKey: ['feedback', 'testers'] }),
      ]);
      await changed();
      onClose();
    },
  });
  const reset = useMutation({
    mutationFn: () => call(resetSecondFactor, { body: { email: typed } }),
  });

  const lines = (audit.data?.entries ?? []).filter(
    (e) => e.subject_email.toLowerCase() === typed && typed !== '',
  );

  return (
    <Modal
      open
      title={person ? person.email : 'Give somebody access'}
      description={
        person
          ? 'What this person may do here. Each change is its own line in the record.'
          : 'Somebody without an account gets what you give when they first sign in.'
      }
      onClose={onClose}
      onSubmit={() => {
        save.mutate();
      }}
      buttons={
        <>
          <Btn sm flat look="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn sm flat look="ink" type="submit" disabled={!typed || !anything || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Btn>
        </>
      }
    >
      {person ? null : (
        <TextField
          label="Their email address"
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            save.reset();
          }}
        />
      )}
      <fieldset style={FIELDSET}>
        <legend className="lbl">Roles</legend>
        {isOwner ? (
          <p className="m">
            The owner’s seat is not given or taken here. It moves only by a hand-over, on the
            Ownership page.
          </p>
        ) : (
          <>
            <Choices>
              {STAFF_CHOICES.map((r) => (
                <Choice
                  multi
                  key={r}
                  name="roles"
                  checked={roles.includes(r)}
                  disabled={!mayRole(r)}
                  onChange={(e) => {
                    setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r));
                    save.reset();
                  }}
                >
                  {ROLE_LABELS[r]}
                </Choice>
              ))}
            </Choices>
            <p className="m">
              {isMe
                ? 'You cannot change your own roles.'
                : isJournalist
                  ? 'This person is a journalist, and a journalist cannot also hold a staff role.'
                  : 'Only the owner gives or takes the administrator role. A journalist’s role comes only from approving their request, on the Journalists page.'}
            </p>
          </>
        )}
      </fieldset>
      <fieldset style={FIELDSET}>
        <legend className="lbl">Flags</legend>
        <Choices>
          <Choice
            multi
            name="tester"
            checked={tester}
            disabled={!canSetFlag(me.roles, 'tester')}
            onChange={(e) => {
              setTesterOn(e.target.checked);
              save.reset();
            }}
          >
            Tester: may file feedback from any page
          </Choice>
          <Choice
            multi
            name="team"
            checked={team}
            disabled={!canSetFlag(me.roles, 'team_member')}
            onChange={(e) => {
              setTeam(e.target.checked);
              save.reset();
            }}
          >
            On the team: opens the team’s guides, and no report
          </Choice>
        </Choices>
        {team ? (
          <Choices>
            {DESKS.map((d) => (
              <Choice
                multi
                key={d.id}
                name="desk"
                checked={desks.includes(d.id)}
                onChange={(e) => {
                  setDesks(e.target.checked ? [...desks, d.id] : desks.filter((x) => x !== d.id));
                  save.reset();
                }}
              >
                {d.label}
              </Choice>
            ))}
          </Choices>
        ) : null}
      </fieldset>
      {person && person.organizations.length > 0 ? (
        <p className="m">
          Organizations: {person.organizations.map((o) => `${o.name} (${o.role})`).join(', ')}.
          Members are changed on the organization’s own page.
        </p>
      ) : null}
      {person ? (
        <fieldset style={FIELDSET}>
          <legend className="lbl">In the record</legend>
          {lines.length === 0 ? (
            <p className="m">No change to this person is recorded yet.</p>
          ) : (
            <ul className="m">
              {lines.slice(0, 8).map((e, i) => (
                <li key={`${e.created_at}-${String(i)}`}>
                  <time dateTime={e.created_at}>{e.created_at.slice(0, 10)}</time>:{' '}
                  {auditSentence(e)}
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      ) : null}
      {person && me.roles.includes('owner') && !isOwner && !isMe ? (
        <fieldset style={FIELDSET}>
          <legend className="lbl">Second factor</legend>
          <p className="m">
            For somebody who lost their authenticator app, passkeys and recovery codes. It signs
            them out everywhere; their next sign-in sets a new one up.
          </p>
          <ErrorLine error={reset.error} />
          {reset.isSuccess ? <Saved>Reset.</Saved> : null}
          <Btn
            sm
            flat
            disabled={reset.isPending || reset.isSuccess}
            onClick={() => {
              reset.mutate();
            }}
          >
            Reset their second factor
          </Btn>
        </fieldset>
      ) : null}
      <ErrorLine error={save.error} />
    </Modal>
  );
}
