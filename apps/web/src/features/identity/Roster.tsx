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
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { CheckOption } from '@/components/ui/choice.tsx';
import { Empty } from '@/components/ui/empty.tsx';
import { Select } from '@/components/ui/select.tsx';
import { CountLine } from '@/components/ui/type.tsx';
import { call } from '../../lib/api.ts';
import { StaffPage } from '../nav/StaffPage.tsx';
import { deskLabel } from './desks.ts';
import { rolesLabel, useIdentityChanged } from './session.ts';
import { StaffOnly } from './StaffOnly.tsx';
import { Done, ErrorText, TextField } from './ui.tsx';
import { ScrollX } from '@/components/ui/scroll-x.tsx';

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

  // Sorted by address, whatever order the server keeps: nobody is ranked.
  const people = [...(roster.data?.people ?? [])].sort((a, b) => a.email.localeCompare(b.email));

  return (
    <StaffPage
      title="Who is doing what"
      lede="Everybody with a role, a flag or an organization. The numbers are reports typed up through intake: by the person themselves, and by anybody for the organizations they belong to. Nothing here is flagged for volume; filing a lot is what a coordinator is for."
    >
      <TeamForm key={editing.email} initial={editing} panelRef={formRef} />

      <Card heading="People">
        <div className="flex max-w-xs flex-col gap-1.5">
          <label htmlFor={periodId} className="label-face text-xs text-ink">
            Count reports from the last
          </label>
          <Select
            id={periodId}
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
          </Select>
        </div>
        <ErrorText error={roster.error} />
        {roster.isPending ? <p role="status">Reading the roster…</p> : null}
        {roster.data?.people.length === 0 && (
          <Empty title="Nobody yet">
            Nobody holds a role, a flag or a membership yet. Give a role on the Roles page.
          </Empty>
        )}
        {roster.data && people.length > 0 && (
          <>
            <CountLine
              parts={[
                `${String(people.length)} ${people.length === 1 ? 'person' : 'people'}`,
                'sorted by address',
                `reports from the last ${roster.data.days === 365 ? 'year' : `${String(roster.data.days)} days`}`,
              ]}
            />
            <ScrollX label="Who is doing what">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  The roster, counting reports from the last {String(roster.data.days)} days
                </caption>
                <thead>
                  <tr className="border-b border-ink-alt">
                    <th scope="col" className="py-2 pr-4 label-face text-xs">
                      Address
                    </th>
                    <th scope="col" className="py-2 pr-4 label-face text-xs">
                      Role and flags
                    </th>
                    <th scope="col" className="py-2 pr-4 label-face text-xs">
                      Organizations
                    </th>
                    <th scope="col" className="py-2 pr-4 label-face text-xs">
                      Typed up by them
                    </th>
                    <th scope="col" className="py-2 pr-4 label-face text-xs">
                      For their organizations
                    </th>
                    <th scope="col" className="py-2 pr-4 label-face text-xs">
                      Last acted as staff
                    </th>
                    <th scope="col" className="py-2">
                      <span className="sr-only">Change</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.email} className="border-b border-line align-top last:border-0">
                      <td className="py-2 pr-4 font-mono break-all">{p.email}</td>
                      <td className="py-2 pr-4">
                        {[
                          p.roles.length ? rolesLabel(p.roles) : null,
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
                      <td className="py-2 pr-4 font-mono">{p.filedByThem}</td>
                      <td className="py-2 pr-4 font-mono">{p.filedForTheirOrganizations}</td>
                      <td className="py-2 pr-4 font-mono whitespace-nowrap">
                        {p.lastStaffAction ? (
                          <time dateTime={p.lastStaffAction}>{p.lastStaffAction.slice(0, 10)}</time>
                        ) : (
                          <span className="font-sans text-ink-alt">Never</span>
                        )}
                      </td>
                      <td className="py-1">
                        <Button
                          type="button"
                          variant="quiet"
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
            </ScrollX>
          </>
        )}
      </Card>
      <p>
        The tester flag is given on the{' '}
        <Link to="/feedback/testers" className="underline">
          testers page
        </Link>
        .
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
      <Card heading="The team">
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
          <CheckOption
            id={teamId}
            label="On the team"
            checked={team}
            onCheckedChange={(on) => {
              setTeam(on === true);
              save.reset();
            }}
          />
          <fieldset className="space-y-2" disabled={!team}>
            <legend className="label-face text-xs text-ink">Desks</legend>
            {!team && (
              <p className="text-sm text-muted">Somebody not on the team holds no desks.</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {DESKS.map((d) => (
                <CheckOption
                  key={d.id}
                  label={d.label}
                  disabled={!team}
                  checked={team && desks.includes(d.id)}
                  onCheckedChange={(on) => {
                    setDesks((now) =>
                      on === true ? [...now, d.id] : now.filter((x) => x !== d.id),
                    );
                    save.reset();
                  }}
                />
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
      </Card>
    </section>
  );
}
