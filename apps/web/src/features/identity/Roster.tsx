/**
 * /access/roster, "Who is doing what": everybody with a role, a flag or an organization, how
 * much they filed, and when they last acted as staff. Administrators and
 * Access Managers.
 *
 * NOTHING HERE FLAGS VOLUME. Filing a lot is what a coordinator is for. This
 * page is for a person to read, not a score.
 *
 * Putting somebody on the team (and their desks) is done here. The tester
 * flag has its own page beside the feedback tracker.
 */
import { DESKS, getRoster, setTeamMember } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { call } from '../../lib/api.ts';
import { SmBtn as Btn } from '../../mockup/SmBtn.tsx';
import { Choice, Choices } from '../../mockup/Choice.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { TextField } from '../../mockup/Fields.tsx';
import { Panel } from '../../mockup/Panel.tsx';
import { Saved } from '../../mockup/Saved.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { deskLabel } from './desks.ts';
import { rolesLabel, useIdentityChanged } from './session.ts';
import { StaffOnly } from './StaffOnly.tsx';

const PERIODS = [7, 30, 90, 365] as const;

export function RosterPage() {
  return (
    <StaffOnly needs={['admin', 'access_manager']}>
      <Roster />
    </StaffOnly>
  );
}

function Roster() {
  const [days, setDays] = useState<number>(30);
  const roster = useQuery({
    queryKey: ['identity', 'roster', days],
    queryFn: ({ signal }) => call(getRoster, { query: { days }, signal }),
  });
  const [editing, setEditing] = useState<{ email: string; team: boolean; desks: string[] }>({
    email: '',
    team: true,
    desks: [],
  });
  const formRef = useRef<HTMLElement>(null);

  // Sorted by address, whatever order the server keeps: nobody is ranked.
  const people = [...(roster.data?.people ?? [])].sort((a, b) => a.email.localeCompare(b.email));

  return (
    <StaffPage title="Who is doing what" lede="Who is on the team and what they have done lately.">
      <TeamForm key={editing.email} initial={editing} panelRef={formRef} />

      <Panel title="People">
        <div className="toolbar">
          <label className="select">
            Count reports from the last{' '}
            <select
              value={days}
              onChange={(e) => {
                setDays(Number(e.target.value));
              }}
            >
              {PERIODS.map((d) => (
                <option key={d} value={d}>
                  {d === 365 ? 'year' : `${String(d)} days`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ErrorLine error={roster.error} />
        {roster.isPending ? <p role="status">Reading the roster…</p> : null}
        {roster.data?.people.length === 0 && (
          <Empty title="Nobody yet">
            Nobody holds a role, a flag or a membership yet. Give a role on the Roles page.
          </Empty>
        )}
        {roster.data && people.length > 0 && (
          <Tbl
            cols={[
              'Address',
              'Role and flags',
              'Organizations',
              'Typed up by them',
              'For their organizations',
              'Last acted as staff',
              '',
            ]}
            widths="1.4fr 1.2fr 1.2fr .8fr .8fr .8fr auto"
            rows={people.map((p) => ({
              key: p.email,
              cells: [
                p.email,
                [
                  p.roles.length ? rolesLabel(p.roles) : null,
                  p.tester ? 'tester' : null,
                  p.teamMember
                    ? `team${p.desks.length ? ` (${p.desks.map((d) => deskLabel(d) ?? d).join(', ')})` : ''}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(', '),
                p.organizations.map((o) => `${o.name} (${o.role})`).join(', '),
                p.filedByThem,
                p.filedForTheirOrganizations,
                p.lastStaffAction ? (
                  <time dateTime={p.lastStaffAction}>{p.lastStaffAction.slice(0, 10)}</time>
                ) : (
                  'Never'
                ),
                <Btn
                  kind="ghost"
                  aria-label={`Change the team and desks of ${p.email}`}
                  onClick={() => {
                    setEditing({ email: p.email, team: p.teamMember, desks: p.desks });
                    formRef.current?.scrollIntoView({ block: 'start' });
                  }}
                >
                  Team and desks
                </Btn>,
              ],
            }))}
          />
        )}
      </Panel>
      <p className="m">
        The tester flag is given on the <Link to="/feedback/testers">testers page</Link>.
      </p>
    </StaffPage>
  );
}

function TeamForm({
  initial,
  panelRef,
}: {
  initial: { email: string; team: boolean; desks: string[] };
  panelRef: RefObject<HTMLElement | null>;
}) {
  const client = useQueryClient();
  const changed = useIdentityChanged();
  const [email, setEmail] = useState(initial.email);
  const [team, setTeam] = useState(initial.team);
  const [desks, setDesks] = useState<string[]>(initial.desks);
  const save = useMutation({
    mutationFn: () => call(setTeamMember, { body: { email, teamMember: team, desks } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['identity', 'roster'] });
      await changed();
    },
  });
  return (
    <section ref={panelRef}>
      <Panel title="The team">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <TextField
            label="Their email address"
            help="Being on the team opens the team’s guides and nothing else: no report, no role. Desks say what somebody does, so their account page can suggest where they start. A desk grants nothing."
            type="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              save.reset();
            }}
          />
          <Choices>
            <Choice
              multi
              name="team"
              checked={team}
              onChange={(e) => {
                setTeam(e.target.checked);
                save.reset();
              }}
            >
              On the team
            </Choice>
          </Choices>
          {!team && <p className="m">Somebody not on the team holds no desks.</p>}
          <Choices>
            {DESKS.map((d) => (
              <Choice
                multi
                key={d.id}
                name="desk"
                disabled={!team}
                checked={team && desks.includes(d.id)}
                onChange={(e) => {
                  setDesks((now) =>
                    e.target.checked ? [...now, d.id] : now.filter((x) => x !== d.id),
                  );
                  save.reset();
                }}
              >
                {d.label}
              </Choice>
            ))}
          </Choices>
          <ErrorLine error={save.error} />
          {save.isSuccess && (
            <Saved>
              {save.data.unchanged
                ? `Nothing changed for ${email.trim()}.`
                : team
                  ? `${email.trim()} is on the team${save.data.desks.length ? `: ${save.data.desks.map((d) => deskLabel(d) ?? d).join(', ')}` : ''}.`
                  : `${email.trim()} is not on the team.`}
            </Saved>
          )}
          <Btn kind="ink" type="submit" disabled={save.isPending}>
            Save
          </Btn>
        </form>
      </Panel>
    </section>
  );
}
