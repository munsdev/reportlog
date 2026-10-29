/**
 * /home: the dashboard every signed-in person lands on (mock-up s-home.html).
 * One `.area-card` for each thing this person has (their reports and account
 * always; review, the desk, an organization, site administration when they
 * hold them), each with a sentence and a link or two.
 *
 * It asks for nothing the frame has not already asked: the waiting totals
 * are the header's own query (useWaiting), so there is no new call. Nothing
 * on it moves on its own; a total changes only when the page is reloaded
 * or the person does something that changes it.
 */
import { Link } from '@tanstack/react-router';
import type { LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { StaffPage } from '../nav/StaffPage.tsx';
import { SignInPrompt } from '../identity/SignInPrompt.tsx';
import { rolesLabel, useMe } from '../identity/session.ts';
import { mayOpen } from '../staff-nav/entries.ts';
import { useWaiting } from '../nav/waiting.ts';

type To = NonNullable<LinkProps['to']>;

function Tile({
  title,
  children,
  links,
}: {
  title: string;
  children: ReactNode;
  links: readonly { to: To; label: string; n?: number | undefined; words?: string }[];
}) {
  return (
    <section className="area-card">
      <h3>{title}</h3>
      {children}
      <ul>
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to}>
              {l.label}
              {l.n ? (
                <>
                  <span aria-hidden="true"> · {l.n}</span>
                  <span className="sr-only">, {l.words}</span>
                </>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HomePage() {
  const meQuery = useMe();
  const me = meQuery.data?.signedIn ? meQuery.data : undefined;
  const waiting = useWaiting(me);
  if (meQuery.isPending) return <p role="status">Reading your account…</p>;
  if (!me) return <SignInPrompt next="/home" />;

  const moderator = mayOpen({ for: ['moderator', 'admin'] }, me);
  const admin = mayOpen({ for: ['admin'] }, me);
  const journalist = mayOpen({ for: ['journalist'] }, me);
  const organization = mayOpen({ for: ['organization'] }, me);
  const grants = mayOpen({ for: ['admin', 'access_manager'] }, me);
  const waitingLine = waiting
    ? [
        waiting.reports
          ? `${String(waiting.reports)} ${waiting.reports === 1 ? 'report' : 'reports'}`
          : '',
        waiting.list_entries
          ? `${String(waiting.list_entries)} list ${waiting.list_entries === 1 ? 'entry' : 'entries'}`
          : '',
      ].filter(Boolean)
    : [];

  return (
    <StaffPage
      area="Account"
      title="Your dashboard"
      lede="Everything you can do here, in one place."
    >
      {/* The mock-up's figures row: only what the waiting totals already say. */}
      {moderator && waiting ? (
        <div className="stats">
          <div className="mini-stat">
            <b>{waiting.reports}</b>
            <span>reports waiting</span>
          </div>
          <div className="mini-stat">
            <b>{waiting.list_entries}</b>
            <span>list entries waiting</span>
          </div>
        </div>
      ) : null}
      <div className="areas">
        {moderator ? (
          <Tile
            title="Review"
            links={[
              // The two queues (moderation-unified.md): a report's written
              // account, links and files are decided on its page.
              {
                to: '/moderate',
                label: 'Reports queue',
                n: waiting?.reports,
                words: 'reports waiting for a moderator',
              },
              {
                to: '/lists/review',
                label: 'List entries',
                n: waiting?.list_entries,
                words: 'list entries waiting for review',
              },
            ]}
          >
            <p>
              {waiting
                ? waitingLine.length > 0
                  ? `Work is waiting: ${waitingLine.join(', ')}.`
                  : 'Nothing is waiting for review.'
                : 'Reports and list entries wait here until a moderator decides.'}
            </p>
          </Tile>
        ) : null}
        <Tile
          title="Your reports"
          links={[
            { to: '/mine', label: 'My reports' },
            { to: '/notifications', label: 'Email updates' },
          ]}
        >
          <p>Reports you filed while signed in, and how you hear about them.</p>
        </Tile>
        <Tile
          title="Your account"
          links={[
            { to: '/account', label: 'Your account' },
            ...(me.heldRoles.length > 0
              ? [{ to: '/access/security' as const, label: 'Signing in' }]
              : []),
          ]}
        >
          <p>
            Signed in as {me.email}. {rolesLabel(me.roles)}.
          </p>
        </Tile>
        {journalist ? (
          <Tile title="Journalist desk" links={[{ to: '/desk', label: 'Open the desk' }]}>
            <p>Checked links, written accounts and sources for vetted journalists.</p>
          </Tile>
        ) : null}
        {/* One card per organization: the listing and members pages are an
            organization's own, so the menu, which cannot name one, leaves
            them to these cards. */}
        {organization
          ? me.memberships.map((m) => (
              <section className="area-card" key={m.organization_id}>
                <h3>{m.name}</h3>
                <p>You {m.role === 'manager' ? 'manage' : 'coordinate'} this organization.</p>
                <ul>
                  <li>
                    <Link to="/intake">Intake</Link>
                  </li>
                  <li>
                    <Link to="/intake/links">Volunteer links</Link>
                  </li>
                  <li>
                    <Link
                      to="/organizations/$id/listing"
                      params={{ id: String(m.organization_id) }}
                    >
                      Directory listing
                    </Link>
                  </li>
                  {/* The server admits a manager of this organization only. */}
                  {m.role === 'manager' ? (
                    <li>
                      <Link to="/access/orgs/$id" params={{ id: String(m.organization_id) }}>
                        Members
                      </Link>
                    </li>
                  ) : null}
                </ul>
              </section>
            ))
          : null}
        {/* Access Managers had no card of their own here before. */}
        {grants ? (
          <Tile
            title="People"
            links={[
              { to: '/people', label: 'People' },
              { to: '/access/orgs', label: 'Organizations' },
            ]}
          >
            <p>Who holds a role, a flag or a place in an organization, and what they may do.</p>
          </Tile>
        ) : null}
        {admin ? (
          <Tile
            title="Site administration"
            links={[
              { to: '/logbooks', label: 'Logbooks' },
              { to: '/settings/switches', label: 'Switches' },
              { to: '/transparency-log', label: 'Transparency log' },
            ]}
          >
            <p>Logbooks, the site’s switches and the public record.</p>
          </Tile>
        ) : null}
      </div>
    </StaffPage>
  );
}
