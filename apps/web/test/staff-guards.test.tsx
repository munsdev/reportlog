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
import type { AnyRoute } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../src/routeTree.gen.ts';

vi.mock('../src/features/identity/StaffOnly.tsx', async (original) => {
  const m = await original<typeof import('../src/features/identity/StaffOnly.tsx')>();
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
  const m = await original<typeof import('../src/features/staff-nav/OnlyFor.tsx')>();
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
  const m = await original<typeof import('../src/features/lists/ListAdmin.tsx')>();
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
} as const;

/**
 * Staff screens with no door, found by this walk and reported (R8). Each
 * checks only that somebody is signed in, with a bare SignInPrompt, so a
 * signed-in account with no role is shown the staff screen and its calls
 * fail one by one. The server refuses them (requireGranter,
 * requireOrgAuthority), so nothing leaks; the courtesy is missing. Their
 * walk is skipped, and the test below fails once a door is added, so the
 * entry is removed with the gap.
 */
const KNOWN_GAPS = {
  '/(staff)/access/audit': 'AuditPage has no door: a signed-in account with no role sees it',
  '/(staff)/access/orgs/':
    'OrganizationsPage has no door: a signed-in account with no role sees it',
  '/(staff)/access/orgs/$id':
    'OrganizationPage has no door: a signed-in account with no role sees it',
} as const;

/** Staff screens outside the `(staff)` folder. */
const STAFF_ELSEWHERE = ['/feedback/', '/feedback/testers'] as const;

/** Every other page: for anybody, or for any signed-in person (not staff). */
const OPEN = [
  '/',
  '/about',
  '/how',
  '/legal',
  '/notifications',
  '/public-api',
  '/standards',
  '/submit',
  '/board/$ref',
  '/board/maps',
  '/board/numbers',
  '/board/press',
  '/board/',
  '/docs/checking',
  '/docs/first-logbook',
  '/docs/',
  '/evidence/$token',
  '/file/$slug',
  '/file/confirm/$token',
  '/list/$slug',
  '/map/$slug',
  '/mine/$threadId',
  '/mine/',
  '/mine/declaration/$threadId',
  '/verify/$ref',
  '/organizations/',
  '/organizations/$id/listing',
  '/notifications_/stop/$token',
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
  return (Object.values(router.routesById) as AnyRoute[])
    .filter((r) => r.id !== '__root__' && !(r.children as unknown[] | undefined)?.length)
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
  role: 'user',
  memberships: [],
  grantsAccess: false,
  tester: false,
  teamMember: false,
  desks: [],
};

/** A server that knows who is asking and refuses everything else as a staff route would. */
function server(me: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, 'http://localhost').pathname;
      const answers: Record<string, unknown> = {
        '/api/auth/me': me,
        '/api/setup/status': { needed: false, hasOwner: true, minPassword: 8 },
        '/api/site-access/status': { locked: false, dev_mode_until: null },
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
    for (const id of [
      ...Object.keys(OPEN_IN_STAFF),
      ...Object.keys(KNOWN_GAPS),
      ...STAFF_ELSEWHERE,
      ...OPEN,
    ])
      expect(ids, id).toContain(id);
  });

  it.each(STAFF.filter((p) => p.id in KNOWN_GAPS))(
    '$path is still a known gap (remove it from KNOWN_GAPS once it has a door)',
    async ({ path }) => {
      server(NO_ROLE);
      open(address(path));
      // Settled: the page drew something of its own and is no longer loading.
      await waitFor(() => {
        expect(screen.getByRole('main').textContent).not.toBe('');
        expect(screen.queryByText(/Loading…|Reading/)).toBeNull();
      });
      expect(screen.queryByRole('heading', { level: 1, name: 'Not for this account' })).toBeNull();
    },
  );

  describe.each(STAFF)('$path', ({ id, path }) => {
    const gap = (KNOWN_GAPS as Record<string, string>)[id];
    // Skipped for the reason in KNOWN_GAPS: a real gap this walk found.
    const it_ = gap ? it.skip : it;

    it_('signed out, shows "Sign in first" behind a door', async () => {
      server(SIGNED_OUT);
      open(address(path));
      await refusedBehindADoor('Sign in first');
    });

    it_('signed in with no role, shows "Not for this account" behind a door', async () => {
      server(NO_ROLE);
      open(address(path));
      await refusedBehindADoor('Not for this account');
    });
  });
});
