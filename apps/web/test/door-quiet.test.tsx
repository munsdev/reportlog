/**
 * THE SITE'S OWN FRAME STAYS QUIET ON A DOOR (I7).
 *
 * A door page may call only the filing calls; anything else is refused as
 * locked and sends the visitor back to the password screen. The page itself
 * is tested for that (filing.test.tsx). This is about what wraps every page:
 * `__root.tsx`, with its header (the site's name through `useSite`, the
 * session menu), the staff menu and the footer. If any of them fetched on a
 * door, the door would close on whoever opened it.
 *
 * The real root route renders here, inside the real gate, with a stand-in
 * page under it that asks nothing. So every request seen is the frame's.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOOR_PATHS, SiteGate, isDoorPath } from '../src/features/identity/gate.tsx';
import { Route as RootRoute } from '../src/routes/__root.tsx';
import { DESK } from './look-fixture.ts';

const ADMIN_ME = {
  signedIn: true,
  email: 'admin@example.org',
  role: 'admin',
  memberships: [],
  grantsAccess: true,
  tester: false,
};

/** Answers these paths; anything else is refused as locked, as a locked server would. */
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
  return () =>
    fetchMock.mock.calls.map(([input]) =>
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
}

// A page at each door's shape, asking nothing, so the frame is all that can.
const Page = () => <p>the page behind the door</p>;
const routeTree = RootRoute.addChildren([
  createRoute({ getParentRoute: () => RootRoute, path: '/', component: Page }),
  createRoute({ getParentRoute: () => RootRoute, path: '/file/$slug', component: Page }),
  createRoute({ getParentRoute: () => RootRoute, path: '/file/confirm/$token', component: Page }),
  createRoute({ getParentRoute: () => RootRoute, path: '/file/erase/$token', component: Page }),
  createRoute({
    getParentRoute: () => RootRoute,
    path: '/illegal-content/status/$token',
    component: Page,
  }),
  createRoute({ getParentRoute: () => RootRoute, path: '/list/$slug', component: Page }),
  createRoute({ getParentRoute: () => RootRoute, path: '/evidence/$token', component: Page }),
  createRoute({
    getParentRoute: () => RootRoute,
    path: '/notifications/stop/$token',
    component: Page,
  }),
  createRoute({
    getParentRoute: () => RootRoute,
    path: '/journalists/confirm/$token',
    component: Page,
  }),
  createRoute({
    getParentRoute: () => RootRoute,
    path: '/journalists/stop/$token',
    component: Page,
  }),
  createRoute({
    getParentRoute: () => RootRoute,
    path: '/journalists/settings/$token',
    component: Page,
  }),
  createRoute({
    getParentRoute: () => RootRoute,
    path: '/journalists/access/$token',
    component: Page,
  }),
]);

function page(pathname: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  const history = { block: vi.fn(() => vi.fn()) } as unknown as RouterHistory;
  return render(
    <QueryClientProvider client={queryClient}>
      <SiteGate history={history} pathname={pathname}>
        <RouterProvider router={router} />
      </SiteGate>
    </QueryClientProvider>,
  );
}

/** Long enough for every query the frame would start to have started. */
const settle = () => new Promise((r) => setTimeout(r, 100));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the frame around every page, on a door', () => {
  // One address of each door shape the gate knows. If a shape is added to
  // DOOR_PATHS, this list must grow with it.
  const DOORS = [
    '/file/some-logbook',
    '/file/confirm/a-token',
    '/list/some-list',
    '/evidence/a-token',
    '/notifications/stop/a-token',
    '/file/erase/a-token',
    '/illegal-content/status/a-token',
    '/journalists/confirm/a-token',
    '/journalists/stop/a-token',
    '/journalists/settings/a-token',
    '/journalists/access/a-token',
  ];

  it('covers every door shape the gate knows', () => {
    for (const shape of DOOR_PATHS)
      expect(
        DOORS.some((d) => shape.test(d)),
        String(shape),
      ).toBe(true);
    for (const d of DOORS) expect(isDoorPath(d)).toBe(true);
  });

  it.each(DOORS)(
    'on %s renders the header and footer and asks nothing beyond the gate',
    async (door) => {
      const asked = server({
        '/api/site-access/status': { locked: true, dev_mode_until: null, look: DESK },
        // Answered as if signed in, so nothing stays quiet for want of a session.
        '/api/auth/me': ADMIN_ME,
      });
      page(door);
      // The frame really rendered: the page, the header's name and the footer.
      expect(await screen.findByText('the page behind the door')).toBeInTheDocument();
      expect(
        within(screen.getByRole('banner')).getByRole('link', { name: 'ReportLog' }),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Imprint and privacy' }),
      ).toBeInTheDocument();
      await settle();
      expect(asked()).toEqual(['/api/site-access/status']);
      // And nothing was refused, which is what would have shut the door.
      expect(screen.queryByRole('heading', { name: /password/i })).toBeNull();
    },
  );

  it('and the same frame past the password DOES ask, so the test above would see it', async () => {
    const asked = server({
      '/api/site-access/status': { locked: false, dev_mode_until: null, look: DESK },
      '/api/setup/status': { needed: false, hasOwner: true, minPassword: 8 },
      '/api/auth/me': ADMIN_ME,
    });
    page('/');
    expect(await screen.findByText('the page behind the door')).toBeInTheDocument();
    await settle();
    const calls = asked();
    expect(calls).toContain('/api/site');
    expect(calls).toContain('/api/auth/me');
  });
});
