/**
 * EVERY STAFF SCREEN HAS A DOOR (CLAUDE.md, "staff screens wrap their layout
 * in <StaffOnly>").
 *
 * The server refusing every staff route is the real guarantee (the route
 * sweep in apps/api/test/db/invariants.test.ts). This is the courtesy on top:
 * a stranger or somebody without the role sees "Sign in first" or "Not for
 * this account", not a staff screen full of errors, and not a staff screen
 * that happens to render something before its calls fail.
 *
 * The set is read off the real route tree (src/routeTree.gen.ts), so a page
 * added tomorrow is walked without anybody remembering to. Every page must be
 * decided: a page in the `(staff)` group is a staff screen unless OPEN says
 * otherwise, and a page outside it must be named in STAFF_ELSEWHERE or OPEN.
 * A new page outside the group fails until somebody decides which it is.
 *
 * Each staff screen is rendered twice by the real router, signed out and
 * signed in with no role. The three doors (StaffOnly, OnlyFor, ReviewersOnly)
 * are wrapped here so that each marks where it stands; the refusal must be
 * inside one of them.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as StaffOnlyModule from '../src/features/identity/StaffOnly.tsx';
import type * as ListAdminModule from '../src/features/lists/ListAdmin.tsx';
import type * as OnlyForModule from '../src/features/staff-nav/OnlyFor.tsx';
import { routeTree } from '../src/routeTree.gen.ts';
import { DESK } from './look-fixture.ts';

vi.mock('../src/features/identity/StaffOnly.tsx', async (original) => {
  const m = await original<typeof StaffOnlyModule>();
  return {
    ...m,
    StaffOnly: (props: ComponentProps<typeof m.StaffOnly>) => (
      <div data-door="StaffOnly">
        <m.StaffOnly {...props} />
      </div>
    ),
  };
});
vi.mock('../src/features/staff-nav/OnlyFor.tsx', async (original) => {
  const m = await original<typeof OnlyForModule>();
  return {
    ...m,
    OnlyFor: (props: ComponentProps<typeof m.OnlyFor>) => (
      <div data-door="OnlyFor">
        <m.OnlyFor {...props} />
      </div>
    ),
  };
});
vi.mock('../src/features/lists/ListAdmin.tsx', async (original) => {
  const m = await original<typeof ListAdminModule>();
  return {
    ...m,
    ReviewersOnly: (props: ComponentProps<typeof m.ReviewersOnly>) => (
      <div data-door="ReviewersOnly">
        <m.ReviewersOnly {...props} />
      </div>
    ),
  };
});

/** Pages in the `(staff)` folder that anybody may open, and why. */
const OPEN_IN_STAFF = {
  '/(staff)/access/sign-in': 'signing in is how anybody becomes staff',
  '/(staff)/access/invitation/$token':
    'an invitee with no account reads what they are invited to before signing in',
  '/(staff)/access/':
    'every signed-in person\'s own account page ("Your account"); its staff parts show only to those who grant access',
  '/(staff)/account':
    "every signed-in person's own account page, with nothing on it about anybody else (staff-nav/menu.ts)",
  '/(staff)/access/security':
    "every signed-in person's own second factor; it says so to an account that needs none (plan E, E3)",
} as const;

/** Staff screens outside the `(staff)` folder. */
const STAFF_ELSEWHERE = [
  '/feedback/',
  '/feedback/testers',
  '/desk/',
  '/desk/texts',
  '/desk/sources',
  '/desk/alerts',
] as const;

/** Every other page: for anybody, or for any signed-in person (not staff). */
const OPEN = [
  '/',
  // The components page: development builds only, and not found in a
  // production one (routes/dev.components.tsx). It shows no data.
  '/dev/components',
  '/about',
  '/how',
  '/home',
  '/legal',
  '/notifications',
  '/public-api',
  '/standards',
  '/submit',
  '/board/$ref',
  '/board/maps',
  '/board/numbers',
  // Plan E (PE3): arrivals, declines and the switch log, public.
  '/board/activity',
  '/board/press',
  '/board/',
  '/docs/checking',
  '/docs/first-logbook',
  '/docs/',
  '/evidence/$token',
  '/file/$slug',
  '/file/confirm/$token',
  '/file/erase/$token',
  '/illegal-content/',
  '/illegal-content/status/$token',
  '/terms',
  // Get involved: the open lists, public like the front page.
  '/get-involved',
  '/list/$slug',
  '/$slug',
  '/map/$slug',
  '/maps/$slug',
  '/mine/$threadId',
  '/mine/',
  '/mine/declaration/$threadId',
  '/verify/$ref',
  // The bare form for checking a reference (public.md §06): asks for nothing.
  '/verify/',
  '/organizations/',
  '/organizations/$id/listing',
  // Plan E (PE3): any signed-in person joins by an organization's intake link.
  '/organizations/join/$token',
  '/notifications_/stop/$token',
  '/journalists',
  '/journalists_/alerts',
  '/journalists_/confirm/$token',
  '/journalists_/stop/$token',
  '/journalists_/settings/$token',
  '/journalists_/access',
  '/journalists_/access_/$token',
] as const;

const PARAMS: Record<string, string> = {
  id: '1',
  ref: 'RL-0000-0000',
  threadId: '00000000-0000-4000-8000-000000000000',
  token: 'a-token',
  slug: 'demo',
};

const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Every page (a route with no children) in the generated tree, by route id. */
function everyPage(): { id: string; path: string }[] {
  const router = createRouter({ routeTree, context: { queryClient: queryClient() } });
  const routes = Object.values(router.routesById) as {
    id: string;
    fullPath: string;
    children?: unknown[];
  }[];
  return routes
    .filter((r) => r.id !== '__root__' && !r.children?.length)
    .map((r) => ({ id: r.id, path: r.fullPath }));
}

function address(path: string): string {
  return path.replace(/\$(\w+)/g, (_m, name: string) => {
    const value = PARAMS[name];
    if (value === undefined) throw new Error(`${path}: give $${name} a value in PARAMS`);
    return value;
  });
}

const SIGNED_OUT = { signedIn: false };
const NO_ROLE = {
  signedIn: true,
  email: 'somebody@example.org',
  roles: [],
  memberships: [],
  grantsAccess: false,
  tester: false,
  teamMember: false,
  desks: [],
  secondFactor: 'not-needed',
  heldRoles: [],
  stepUpUntil: null,
};

/** A server that knows who is asking and refuses everything else as a staff route would. */
function server(me: unknown, more: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, 'http://localhost').pathname;
      const answers: Record<string, unknown> = {
        '/api/auth/me': me,
        '/api/setup/status': { needed: false, hasOwner: true, minPassword: 8 },
        '/api/site-access/status': { locked: false, dev_mode_until: null, look: DESK },
        ...more,
      };
      const body = answers[path];
      return Promise.resolve(
        body === undefined
          ? new Response(
              JSON.stringify({ error: { code: 'forbidden', message: 'Not for this account.' } }),
              { status: 403 },
            )
          : new Response(JSON.stringify(body), { status: 200 }),
      );
    }),
  );
}

function open(pathname: string) {
  const client = queryClient();
  const router = createRouter({
    routeTree,
    context: { queryClient: client },
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/** The refusal's heading, and the door it stands behind. */
async function refusedBehindADoor(heading: string) {
  const h = await screen.findByRole('heading', { level: 1, name: heading });
  const door = h.closest('[data-door]');
  expect(door, `"${heading}" is not inside StaffOnly, OnlyFor or ReviewersOnly`).not.toBeNull();
  // Nothing else is drawn as the page's own heading: the screen stayed shut.
  expect(screen.getAllByRole('heading', { level: 1 }).map((x) => x.textContent)).toEqual([heading]);
  return door?.getAttribute('data-door');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const PAGES = everyPage();
const STAFF = PAGES.filter(
  (p) =>
    (p.id.startsWith('/(staff)/') && !(p.id in OPEN_IN_STAFF)) ||
    (STAFF_ELSEWHERE as readonly string[]).includes(p.id),
);

describe('the staff screens in the route tree', () => {
  it('every page is decided: a staff screen, or open for a reason', () => {
    // A floor, so a change to the tree's shape cannot empty the walk.
    expect(PAGES.length).toBeGreaterThan(60);
    expect(STAFF.length).toBeGreaterThan(35);
    const ids = PAGES.map((p) => p.id);
    const undecided = ids.filter(
      (id) =>
        !id.startsWith('/(staff)/') &&
        !(STAFF_ELSEWHERE as readonly string[]).includes(id) &&
        !(OPEN as readonly string[]).includes(id),
    );
    expect(undecided, 'decide whether each is a staff screen or open').toEqual([]);
    // And nothing named here has gone, so a list cannot outlive its pages.
    for (const id of [...Object.keys(OPEN_IN_STAFF), ...STAFF_ELSEWHERE, ...OPEN])
      expect(ids, id).toContain(id);
  });

  describe.each(STAFF)('$path', ({ path }) => {
    it('signed out, shows "Sign in first" behind a door', async () => {
      server(SIGNED_OUT);
      open(address(path));
      await refusedBehindADoor('Sign in first');
    });

    it('signed in with no role, shows "Not for this account" behind a door', async () => {
      server(NO_ROLE);
      open(address(path));
      // The desk (decision 80) offers an account without the role a way to ask, not a refusal.
      await refusedBehindADoor(path.startsWith('/desk') ? 'Journalist desk' : 'Not for this account');
    });
  });
});

/**
 * The three access screens this walk found with no door (R8). The doors
 * were added to match the server: requireGranter for the audit and the
 * organizations, requireOrgAuthority for one organization. So the people
 * the server admits must still see the screen, not a refusal.
 */
describe('the access screens open for the people the server admits', () => {
  const signedIn = (role: string, memberships: unknown[] = []) => ({
    ...NO_ROLE,
    roles: role === 'user' ? [] : [role],
    memberships,
    grantsAccess: role === 'admin' || role === 'owner' || role === 'access_manager',
  });
  const ORG = {
    organization: {
      id: 1,
      name: 'Harbour Residents',
      details: null,
      logo: null,
      manager_count: 1,
      coordinator_count: 0,
    },
    members: [],
    youManageIt: true,
    youGrantAccess: false,
  };

  it.each(['owner', 'admin', 'access_manager'])(
    '/access/audit and /access/orgs/ open for the %s',
    async (role) => {
      server(signedIn(role), { '/api/access/audit': { entries: [] } });
      open('/access/audit');
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Who granted what' }),
      ).toBeInTheDocument();
      cleanup();
      server(signedIn(role), { '/api/orgs': { organizations: [] } });
      open('/access/orgs/');
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Organizations' }),
      ).toBeInTheDocument();
    },
  );

  it.each(['moderator'])('/access/audit and /access/orgs/ refuse a %s', async (role) => {
    server(signedIn(role));
    open('/access/audit');
    await refusedBehindADoor('Not for this account');
    cleanup();
    server(signedIn(role));
    open('/access/orgs/');
    await refusedBehindADoor('Not for this account');
  });

  it('/access/orgs/$id opens for a manager of that organization with no system role', async () => {
    server(signedIn('user', [{ organization_id: 1, name: 'Harbour Residents', role: 'manager' }]), {
      '/api/orgs/1': ORG,
      '/api/orgs/1/invitations': { invitations: [] },
    });
    open('/access/orgs/1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Harbour Residents' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Not for this account' })).toBeNull();
  });

  it('/access/orgs/$id opens for an Access Manager', async () => {
    server(signedIn('access_manager'), {
      '/api/orgs/1': { ...ORG, youManageIt: false, youGrantAccess: true },
      '/api/orgs/1/invitations': { invitations: [] },
    });
    open('/access/orgs/1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Harbour Residents' }),
    ).toBeInTheDocument();
  });
});
