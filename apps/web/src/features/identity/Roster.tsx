/**
 * /access/roster: everybody with a role, a flag or an organization, how
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
import { Button } from '@/components/ui/button.tsx';
import { call } from '../../lib/api.ts';
import { deskLabel } from './desks.ts';
import { ROLE_LABELS, useIdentityChanged } from './session.ts';
import { StaffOnly } from './StaffOnly.tsx';
import { Done, ErrorText, Panel, TextField } from './ui.tsx';

const PERIODS = [7, 30, 90, 365] as const;

export function RosterPage() {
  return (
    <StaffOnly needs={['admin', 'access_manager']}>
      <Roster />
    </StaffOnly>
  );
}

function Roster() {
  const periodId = useId();
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

  return (
    <div className="space-y-8">
      <h1 className="font-display text-title font-bold">Roster</h1>
      <p className="text-ink-alt">
        Everybody with a role, a flag or an organization. The numbers are reports typed up through
        intake: by the person themselves, and by anybody for the organizations they belong to.
        Nothing here is flagged for volume; filing a lot is what a coordinator is for.
      </p>

      <TeamForm key={editing.email} initial={editing} panelRef={formRef} />

      <Panel title="People">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <label htmlFor={periodId} className="font-semibold">
            Count reports from the last
          </label>
          <select
            id={periodId}
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
            }}
            className="rounded-card border border-line bg-surface px-3 py-2"
          >
            {PERIODS.map((d) => (
              <option key={d} value={d}>
                {d === 365 ? 'year' : `${String(d)} days`}
              </option>
            ))}
          </select>
        </div>
        <ErrorText error={roster.error} />
        {roster.data?.people.length === 0 && (
          <p>Nobody holds a role, a flag or a membership yet.</p>
        )}
        {roster.data && roster.data.people.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                The roster, counting reports from the last {String(roster.data.days)} days
              </caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-4">
                    Address
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Role and flags
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Organizations
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Typed up by them
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    For their organizations
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Last acted as staff
                  </th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">Change</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {roster.data.people.map((p) => (
                  <tr key={p.email} className="border-b border-line align-top last:border-0">
                    <td className="py-2 pr-4 break-all">{p.email}</td>
                    <td className="py-2 pr-4">
                      {[
                        ROLE_LABELS[p.role],
                        p.tester ? 'tester' : null,
                        p.teamMember
                          ? `team${p.desks.length ? ` (${p.desks.map((d) => deskLabel(d) ?? d).join(', ')})` : ''}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </td>
                    <td className="py-2 pr-4">
                      {p.organizations.map((o) => `${o.name} (${o.role})`).join(', ')}
                    </td>
                    <td className="py-2 pr-4">{p.filedByThem}</td>
                    <td className="py-2 pr-4">{p.filedForTheirOrganizations}</td>
                    <td className="py-2 pr-4">
                      {p.lastStaffAction ? (
                        <time dateTime={p.lastStaffAction}>
                          {new Date(p.lastStaffAction).toLocaleDateString(undefined, {
                            dateStyle: 'medium',
                          })}
                        </time>
                      ) : (
                        'Never'
                      )}
                    </td>
                    <td className="py-2">
                      <Button
                        type="button"
                        variant="quiet"
                        size="sm"
                        aria-label={`Change the team and desks of ${p.email}`}
                        onClick={() => {
                          setEditing({ email: p.email, team: p.teamMember, desks: p.desks });
                          formRef.current?.scrollIntoView({ block: 'start' });
                        }}
                      >
                        Team and desks
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p>
        The tester flag is given on the{' '}
        <Link to="/feedback/testers" className="underline">
          testers page
        </Link>
        .
      </p>
    </div>
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
  const teamId = useId();
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
        <p className="text-ink-alt">
          Being on the team opens the team’s guides and nothing else: no report, no role. Desks say
          what somebody does, so their account page can suggest where they start. A desk grants
          nothing.
        </p>
        <form
          className="space-y-4"
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
              save.reset();
            }}
          />
          <div className="flex items-center gap-2">
            <input
              id={teamId}
              type="checkbox"
              className="size-5"
              checked={team}
              onChange={(e) => {
                setTeam(e.target.checked);
                save.reset();
              }}
            />
            <label htmlFor={teamId} className="font-semibold">
              On the team
            </label>
          </div>
          <fieldset className="space-y-2" disabled={!team}>
            <legend className="font-semibold">Desks</legend>
            {!team && (
              <p className="text-sm text-muted">Somebody not on the team holds no desks.</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {DESKS.map((d) => (
                <label key={d.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={team && desks.includes(d.id)}
                    onChange={(e) => {
                      setDesks((now) =>
                        e.target.checked ? [...now, d.id] : now.filter((x) => x !== d.id),
                      );
                      save.reset();
                    }}
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" disabled={save.isPending}>
            Save
          </Button>
        </form>
        <ErrorText error={save.error} />
        {save.isSuccess && (
          <Done>
            {save.data.unchanged
              ? `Nothing changed for ${email.trim()}.`
              : team
                ? `${email.trim()} is on the team${save.data.desks.length ? `: ${save.data.desks.map((d) => deskLabel(d) ?? d).join(', ')}` : ''}.`
                : `${email.trim()} is not on the team.`}
          </Done>
        )}
      </Panel>
    </section>
  );
}
