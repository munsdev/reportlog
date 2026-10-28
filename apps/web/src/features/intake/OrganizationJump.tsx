/**
 * Members and Directory listing in the menu (staff-nav/menu.ts). Each is an
 * organization's own page, at an address that names the organization, which
 * a menu line cannot; they were reached only from the dashboard's cards.
 * This page goes on to the one organization somebody has, or asks which when
 * they have several.
 */
import { Link, Navigate } from '@tanstack/react-router';
import { Empty } from '@/mockup/Empty.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { useMe } from '../identity/session.ts';

type Where = 'members' | 'listing';

const TITLE: Record<Where, string> = { members: 'Members', listing: 'Directory listing' };

export function OrganizationJump({ where }: { where: Where }) {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading…</p>;
  const all = me.data?.signedIn ? me.data.memberships : [];
  // Changing members is for an organization's managers; the server refuses a coordinator.
  const orgs = where === 'members' ? all.filter((m) => m.role === 'manager') : all;
  const only = orgs.length === 1 ? orgs[0] : undefined;
  if (only) {
    const id = String(only.organization_id);
    return where === 'members' ? (
      <Navigate to="/access/orgs/$id" params={{ id }} replace />
    ) : (
      <Navigate to="/organizations/$id/listing" params={{ id }} replace />
    );
  }
  return (
    <StaffPage title={TITLE[where]} area="Your organization">
      {orgs.length === 0 ? (
        <Empty title="No organization to show">
          {where === 'members'
            ? 'Only an organization’s managers change who is in it.'
            : 'You are not in an organization.'}
        </Empty>
      ) : (
        <Panel title="Which organization?">
          <ul>
            {orgs.map((m) => {
              const id = String(m.organization_id);
              return (
                <li key={id}>
                  {where === 'members' ? (
                    <Link to="/access/orgs/$id" params={{ id }}>
                      {m.name}
                    </Link>
                  ) : (
                    <Link to="/organizations/$id/listing" params={{ id }}>
                      {m.name}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </StaffPage>
  );
}
