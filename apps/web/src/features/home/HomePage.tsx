/**
 * /home: the dashboard every signed-in person lands on. One card for each
 * thing this person has (their reports and account always; review, the
 * desk, an organization, site administration when they hold them), each
 * with a sentence and a link or two.
 *
 * It asks for nothing the frame has not already asked: the waiting totals
 * are the header's own query (useWaiting), so there is no new call. Nothing
 * on it moves on its own; a total changes only when the page is reloaded
 * or the person does something that changes it.
 */
import { Link } from '@tanstack/react-router';
import type { LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card.tsx';
import { Count } from '@/components/ui/count.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { SignInPrompt } from '../identity/SignInPrompt.tsx';
import { useMe } from '../identity/session.ts';
import { mayOpen } from '../staff-nav/entries.ts';
import { useWaiting, waitingWords } from '../nav/waiting.ts';

const LINK = 'inline-flex min-h-11 items-center text-ink underline underline-offset-4';

type To = NonNullable<LinkProps['to']>;

function Tile({
  title,
  children,
  links,
}: {
  title: string;
  children: ReactNode;
  links: readonly { to: To; label: string; count?: ReactNode }[];
}) {
  return (
    <Card heading={title} className="gap-3 p-4">
      <div className="text-ink-alt">{children}</div>
      <ul className="flex flex-wrap gap-x-5">
        {links.map((l) => (
          <li key={l.to} className="flex items-center gap-2">
            <Link to={l.to} className={LINK}>
              {l.label}
            </Link>
            {l.count}
          </li>
        ))}
      </ul>
    </Card>
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
  const total = (waiting?.reports ?? 0) + (waiting?.list_entries ?? 0) + (waiting?.tip_links ?? 0);

  return (
    <StaffPage
      area="Account"
      title="Your dashboard"
      lede="Everything you can do here, in one place."
    >
      {/* The mock-up's figures row: only what the waiting totals already say. */}
      {moderator && waiting ? (
        <ul aria-label="Waiting now" className="flex flex-wrap gap-3">
          {[
            [waiting.reports, 'reports waiting'],
            [waiting.tip_links, 'links waiting'],
            [waiting.list_entries, 'list entries waiting'],
          ].map(([n, what]) => (
            <li
              key={what}
              className="min-w-[8.5rem] flex-1 rounded-card border border-line bg-surface px-3.5 py-3 sm:max-w-[11.25rem]"
            >
              <span className="block font-display text-[1.75rem] leading-none font-bold">{n}</span>
              <span className="mt-1 block text-sm text-muted">{what}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Tile
          title="Your reports"
          links={[
            { to: '/mine', label: 'My reports' },
            { to: '/notifications', label: 'Email updates' },
          ]}
        >
          <p>The reports you have filed, and the emails you have asked for about them.</p>
        </Tile>
        <Tile
          title="Your account"
          links={[
            { to: '/access', label: 'Your account' },
            ...(me.heldRoles.length > 0
              ? [{ to: '/access/security' as const, label: 'Signing in' }]
              : []),
          ]}
        >
          <p>Your address, how you sign in, and what you may do here.</p>
        </Tile>
        {moderator ? (
          <Tile
            title="Review"
            links={[
              {
                to: '/moderate',
                label: 'Reports queue',
                count: waiting?.reports ? (
                  <Count
                    value={waiting.reports}
                    label={`, ${waitingWords('reports', waiting.reports)}`}
                  />
                ) : null,
              },
              {
                to: '/lists/review',
                label: 'List entries',
                count: waiting?.list_entries ? (
                  <Count
                    value={waiting.list_entries}
                    label={`, ${waitingWords('list_entries', waiting.list_entries)}`}
                  />
                ) : null,
              },
              {
                to: '/lists/links',
                label: 'Links',
                count: waiting?.tip_links ? (
                  <Count
                    value={waiting.tip_links}
                    label={`, ${waitingWords('tip_links', waiting.tip_links)}`}
                  />
                ) : null,
              },
            ]}
          >
            <p>
              {waiting
                ? total > 0
                  ? 'Work is waiting for a moderator.'
                  : 'Nothing is waiting for review.'
                : 'Reports, tip links and list entries wait here until a moderator decides.'}
            </p>
          </Tile>
        ) : null}
        {journalist ? (
          <Tile title="Journalist desk" links={[{ to: '/desk', label: 'Open the desk' }]}>
            <p>The checked links you may read.</p>
          </Tile>
        ) : null}
        {/* One card per organization: the listing and members pages are an
            organization's own, so the menu, which cannot name one, leaves
            them to these cards. */}
        {organization
          ? me.memberships.map((m) => (
              <Card key={m.organization_id} heading={m.name} className="gap-3 p-4">
                <p className="text-ink-alt">
                  You are its {m.role}. Reports your volunteers bring in, the links they use, and
                  how the organization appears in the directory.
                </p>
                <ul className="flex flex-wrap gap-x-5">
                  <li>
                    <Link to="/intake" className={LINK}>
                      Filing for an organization
                    </Link>
                  </li>
                  <li>
                    <Link to="/intake/links" className={LINK}>
                      Volunteer links
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/organizations/$id/listing"
                      params={{ id: String(m.organization_id) }}
                      className={LINK}
                    >
                      Directory listing
                    </Link>
                  </li>
                  {/* The server admits a manager of this organization only. */}
                  {m.role === 'manager' ? (
                    <li>
                      <Link
                        to="/access/orgs/$id"
                        params={{ id: String(m.organization_id) }}
                        className={LINK}
                      >
                        Members
                      </Link>
                    </li>
                  ) : null}
                </ul>
              </Card>
            ))
          : null}
        {admin ? (
          <Tile
            title="Site administration"
            links={[
              { to: '/logbooks', label: 'Logbooks' },
              { to: '/settings/name', label: 'Site settings' },
              { to: '/transparency-log', label: 'Transparency log' },
            ]}
          >
            <p>Run the site: what it collects, how it looks, and the records it keeps.</p>
          </Tile>
        ) : null}
      </div>
    </StaffPage>
  );
}
