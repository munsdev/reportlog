import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteGate } from '../src/features/identity/gate.tsx';
import { STAFF_ENTRIES, entriesFor } from '../src/features/staff-nav/entries.ts';
import type { Viewer } from '../src/features/staff-nav/entries.ts';
import { StaffNav } from '../src/features/staff-nav/StaffNav.tsx';

const labels = (v: Viewer) => entriesFor(v).map((e) => e.label);
const as = (role: Viewer['role'], tester = false): Viewer => ({ role, tester });

describe('who sees which staff screen', () => {
  it('somebody with no role and no flag sees none, so no bar at all', () => {
    expect(labels(as('user'))).toEqual([]);
  });

  it('a moderator sees list review, moderation, files and the guides, and nothing an administrator runs', () => {
    expect(labels(as('moderator'))).toEqual([
      'List review',
      'Link checks',
      'Moderation',
      'Flood screen',
      'Files',
      'Guides',
    ]);
  });

  it('an administrator does not become a moderator, but list review names both', () => {
    const admin = labels(as('admin'));
    expect(admin).toEqual([
      'Access',
      'Logbooks',
      'Front page',
      'Lists',
      'List review',
      'Link checks',
      'Moderation',
      'Flood screen',
      'Moderation settings',
      'Transparency log',
      'Files',
      'File settings',
      'Settings',
      'Feedback',
      'Guides',
    ]);
    // A screen for moderators alone is not shown to an administrator.
    const modOnly = [
      { to: '/lists/review' as const, label: 'Mod only', for: ['moderator'] as const },
    ];
    expect(entriesFor(as('admin'), modOnly)).toEqual([]);
  });

  it('a journalist sees the desk and no staff screen', () => {
    expect(labels(as('journalist'))).toEqual(['Journalist desk']);
  });

  it('the owner satisfies administrator, and sees what an administrator sees, plus the owner’s own', () => {
    // Backups and exports are the whole archive in a file: the owner's alone.
    // So is vetting journalists (J7b).
    const owner = labels(as('owner'));
    const ownersOwn = ['Backups and exports', 'Journalists'];
    expect(owner.filter((l) => !ownersOwn.includes(l))).toEqual(labels(as('admin')));
    for (const l of ownersOwn) expect(owner).toContain(l);
    expect(labels(as('admin'))).not.toContain('Backups and exports');
  });

  it('an Access Manager sees access, feedback and the guides', () => {
    expect(labels(as('access_manager'))).toEqual(['Access', 'Feedback', 'Guides']);
  });

  it('the tester flag shows feedback, whatever the role', () => {
    expect(labels(as('user', true))).toEqual(['Feedback']);
    expect(labels(as('moderator', true))).toEqual([
      'List review',
      'Link checks',
      'Moderation',
      'Flood screen',
      'Files',
      'Feedback',
      'Guides',
    ]);
  });

  it('lists every screen that exists now, each once', () => {
    const to = STAFF_ENTRIES.map((e) => e.to);
    expect(new Set(to).size).toBe(to.length);
    for (const path of [
      '/access',
      '/logbooks',
      '/logbooks/front-page',
      '/settings',
      '/lists',
      '/lists/review',
      '/moderate',
      '/moderate/settings',
      '/transparency-log',
      '/backups',
      '/files',
      '/files/settings',
    ]) {
      expect(to).toContain(path);
    }
  });
});

/** Answers these paths; anything else is refused as locked, as a door's server would. */
function server(answers: Record<string, unknown>) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = answers[url.split('?')[0] ?? url];
    return Promise.resolve(
      body === undefined
        ? new Response(JSON.stringify({ error: { code: 'locked', message: 'Locked.' } }), {
            status: 401,
          })
        : new Response(JSON.stringify(body), { status: 200 }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const ADMIN_ME = {
  signedIn: true,
  email: 'admin@example.org',
  role: 'admin',
  memberships: [],
  grantsAccess: true,
  tester: false,
  teamMember: false,
  desks: [],
};

function page(pathname: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({ component: StaffNav }),
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  const history = { block: vi.fn(() => vi.fn()) } as unknown as RouterHistory;
  return render(
    <QueryClientProvider client={client}>
      <SiteGate history={history} pathname={pathname}>
        <RouterProvider router={router} />
      </SiteGate>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the staff menu on a page', () => {
  it('shows a signed-in administrator their screens', async () => {
    server({
      '/api/site-access/status': { locked: false, dev_mode_until: null },
      '/api/setup/status': { needed: false, hasOwner: true, minPassword: 8 },
      '/api/auth/me': ADMIN_ME,
    });
    page('/');
    const nav = await screen.findByRole('navigation', { name: 'Staff' });
    expect(within(nav).getByRole('link', { name: 'Logbooks' })).toHaveAttribute(
      'href',
      '/logbooks',
    );
    expect(within(nav).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('on a door renders nothing and asks the server nothing beyond the gate’s own question', async () => {
    const fetchMock = server({
      '/api/site-access/status': { locked: true, dev_mode_until: null },
      '/api/auth/me': ADMIN_ME,
    });
    page('/file/some-logbook');
    // The router mounts on a door; give it a moment to render, and the menu its chance to ask.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('navigation', { name: 'Staff' })).toBeNull();
    const asked = fetchMock.mock.calls.map(([input]) =>
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    expect(asked).toEqual(['/api/site-access/status']);
  });
});
