/**
 * Navigation (stage 3, docs/design/navigation.md and checks.md section 02):
 * who sees which staff page, which page an address is, and the header, the
 * menu and the staff area's frame as they render in the real root route.
 *
 * The browser suite checks the same at real widths (e2e/navigation.spec.ts);
 * these pin the rules down without one.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/react-router';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteGate } from '../src/features/identity/gate.tsx';
import { mainAction } from '../src/features/nav/Menu.tsx';
import { HeaderProgress } from '../src/features/nav/progress.tsx';
import {
  STAFF_AREAS,
  STAFF_ENTRIES,
  areaAt,
  areasFor,
  entriesFor,
  entryAt,
  groupsFor,
  inFrame,
} from '../src/features/staff-nav/entries.ts';
import type { Viewer } from '../src/features/staff-nav/entries.ts';
import { Route as RootRoute } from '../src/routes/__root.tsx';
import { DESK } from './look-fixture.ts';

const as = (role: Viewer['roles'][number] | 'user', tester = false): Viewer => ({
  roles: role === 'user' ? [] : [role],
  tester,
});
const shape = (v: Viewer) =>
  Object.fromEntries(areasFor(v).map((a) => [a.label, a.pages.map((p) => p.label)]));
const others = (v: Viewer) => groupsFor(v).flatMap((g) => g.pages.map((p) => p.label));
const YOU = ['Your dashboard', 'My reports', 'Email updates'];

describe('who sees which staff area and page', () => {
  it('somebody with no role and no flag sees no area, only their own pages', () => {
    expect(areasFor(as('user'))).toEqual([]);
    expect(others(as('user'))).toEqual(YOU);
  });

  it('a moderator sees Review without the administrator’s pages, and the guides', () => {
    expect(shape(as('moderator'))).toEqual({
      Review: [
        'Reports queue',
        'Links',
        'List entries',
        'Files',
        'Illegal content notices',
        'Flood screen',
      ],
      Help: ['Guides'],
    });
    expect(others(as('moderator'))).toEqual([...YOU, 'Signing in']);
  });

  it('an administrator sees every area, without the owner’s pages', () => {
    const admin = shape(as('admin'));
    expect(Object.keys(admin)).toEqual([
      'Review',
      'Content',
      'Site',
      'Rules',
      'People',
      'Logs and system',
      'Help',
    ]);
    expect(admin.Content).toContain('Maps');
    expect(admin.People).not.toContain('Journalist requests');
    expect(admin.Rules).not.toContain('Journalist agreement');
    expect(admin['Logs and system']).toEqual([
      'Transparency log',
      'Who granted what',
      'Who opened protected data',
      'Updates',
    ]);
    expect(admin.Help).toEqual(['Guides', 'Feedback', 'Feedback queue']);
  });

  it('the owner satisfies administrator, plus backups and vetting journalists', () => {
    const owner = shape(as('owner'));
    expect(owner['Logs and system']).toContain('Backups and exports');
    expect(owner.People).toContain('Journalist requests');
    expect(owner.Rules).toContain('Journalist agreement');
  });

  it('a screen for moderators alone is not shown to an administrator (admin is not moderator)', () => {
    const modOnly = [
      { to: '/lists/review' as const, label: 'Mod only', for: ['moderator'] as const },
    ];
    expect(entriesFor(as('admin'), modOnly)).toEqual([]);
  });

  it('an Access Manager sees People without journalist requests, and feedback and guides', () => {
    expect(shape(as('access_manager'))).toEqual({
      People: ['People and roles', 'Organizations', 'Testers', 'Who is doing what'],
      'Logs and system': ['Who granted what'],
      Help: ['Guides', 'Feedback'],
    });
  });

  it('a journalist sees the desk and no area', () => {
    expect(areasFor(as('journalist'))).toEqual([]);
    expect(others(as('journalist'))).toEqual([
      ...YOU,
      'Signing in',
      'Checked links',
      'Sources',
      'Your alerts',
    ]);
  });

  it('the tester flag shows feedback, whatever the role, and not the testers page', () => {
    expect(shape(as('user', true))).toEqual({ Help: ['Feedback'] });
  });

  it('an organization’s coordinator sees their own group, by membership', () => {
    const coordinator = {
      roles: [] as const,
      tester: false,
      memberships: [{ role: 'coordinator' }],
    };
    expect(groupsFor(coordinator).map((g) => [g.label, g.pages.map((p) => p.label)])).toEqual([
      ['You', YOU],
      ['Your organization', ['Filing for an organization', 'Volunteer links']],
    ]);
  });

  it('lists every staff screen once, and /maps for the first time', () => {
    // The site password entry is an alias of /access and shares its address
    // on purpose.
    const keys = STAFF_ENTRIES.filter((e) => !e.alias).map(
      (e) => `${e.to}#${e.hash ?? ''}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    // Only an alias may share an address with another entry.
    const real = STAFF_ENTRIES.filter((e) => !e.alias).map((e) => e.to);
    expect(new Set(real).size).toBe(real.length);
    for (const path of [
      '/access',
      '/logbooks',
      '/logbooks/front-page',
      '/home',
      '/lists',
      '/lists/review',
      '/lists/links',
      '/moderate',
      '/moderate/settings',
      '/transparency-log',
      '/backups',
      '/files',
      '/files/settings',
      '/maps',
      '/feedback/testers',
    ]) {
      expect(STAFF_ENTRIES.map((e) => e.to)).toContain(path);
    }
  });
});

describe('which page an address is', () => {
  it.each([
    ['/moderate', 'Reports queue'],
    ['/moderate/', 'Reports queue'],
    ['/moderate/3f0e2a3c-1111-4b4b-8c8c-000000000000', 'Reports queue'],
    ['/moderate/flood', 'Flood screen'],
    ['/moderate/settings', 'Moderation settings'],
    ['/lists/review/12', 'List entries'],
    ['/lists/12', 'Lists'],
    ['/lists/links', 'Links'],
    ['/files/RL-ABCD', 'Files'],
    ['/files/settings', 'File limits'],
    ['/access/orgs/4', 'Organizations'],
    ['/access/journalists/agreement', 'Journalist agreement'],
    ['/settings/look', 'Look'],
    ['/intake/7', 'Filing for an organization'],
  ])('%s is %s', (path, label) => {
    expect(entryAt(path)?.label).toBe(label);
  });

  it.each(['/', '/board', '/access/sign-in', '/access/invitation/x'])(
    '%s is no staff page',
    (path) => {
      expect(entryAt(path)).toBeNull();
      expect(areaAt(path)).toBeNull();
    },
  );

  it.each([
    ['/home', 'Your dashboard'],
    ['/mine/abc', 'My reports'],
    ['/access/security', 'Signing in'],
  ])('%s is %s, in the frame for everybody', (path, label) => {
    expect(entryAt(path)?.label).toBe(label);
    expect(areaAt(path)).toBeNull();
    expect(inFrame(path)).toBe(true);
  });

  it('the old settings overview keeps its route in the frame without a menu entry', () => {
    expect(entryAt('/settings')).toBeNull();
    expect(inFrame('/settings')).toBe(true);
    expect(inFrame('/access/sign-in')).toBe(false);
  });

  it('an alias is never the page you are on', () => {
    // No entry is an alias today (the access log has its own page); the rule
    // is kept for the next second way to a page.
    const page = { to: '/moderate/settings' as const, label: 'Settings', for: ['admin'] as const };
    const alias = { ...page, hash: 'part', label: 'A part of it', alias: true };
    expect(entryAt('/moderate/settings', [alias, page])?.label).toBe('Settings');
    expect(entryAt('/moderate/settings', [alias])).toBeNull();
    expect(entryAt('/who-opened-what')?.label).toBe('Who opened protected data');
  });

  it('every area page belongs to its area', () => {
    for (const area of STAFF_AREAS)
      for (const p of area.pages.filter((e) => !e.alias)) expect(areaAt(p.to)?.id).toBe(area.id);
  });
});

describe('the menu’s main action', () => {
  const button = (over: Record<string, unknown>) => ({
    kind: 'builtin' as const,
    ref: 'submit',
    label: 'Submit a Report',
    title: 'Submit a Report',
    href: '/submit',
    action: null,
    blurb: null,
    help: null,
    accent: true,
    ...over,
  });

  it('is "Submit a report" while nothing is known, or for the built-in under its own name', () => {
    expect(mainAction(undefined)).toEqual({ label: 'Submit a report', href: '/submit' });
    expect(mainAction([button({})])).toEqual({ label: 'Submit a report', href: '/submit' });
  });

  it('is the operator’s first button that goes somewhere, under their name for it', () => {
    expect(mainAction([button({ label: 'Tell us what happened' })])).toEqual({
      label: 'Tell us what happened',
      href: '/submit',
    });
    expect(
      mainAction([
        button({ kind: 'list', ref: 'alerts', href: null, label: 'Get alerts' }),
        button({
          kind: 'logbook',
          ref: 'votes',
          label: 'Report a problem voting',
          href: '/file/votes',
        }),
      ]),
    ).toEqual({ label: 'Report a problem voting', href: '/file/votes' });
  });
});

// ── the header and the menu, in the real root route ─────────────────────

const ME = (role: string, extra: Record<string, unknown> = {}) => ({
  signedIn: true,
  email: `${role}@example.org`,
  roles: role === 'user' ? [] : [role],
  memberships: [],
  grantsAccess: role === 'admin' || role === 'owner' || role === 'access_manager',
  tester: false,
  teamMember: false,
  desks: [],
  secondFactor: role === 'user' ? 'not-needed' : 'done',
  heldRoles: role === 'user' ? [] : [role],
  stepUpUntil: null,
  ...extra,
});

/** Answers these paths; anything else is not found (never "locked", which would re-ask the gate). */
function server(answers: Record<string, unknown>) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = answers[url.split('?')[0] ?? url];
    return Promise.resolve(
      body === undefined
        ? new Response(JSON.stringify({ error: { code: 'not_found', message: 'No.' } }), {
            status: 404,
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

const open = (me: unknown, extra: Record<string, unknown> = {}) =>
  server({
    '/api/site-access/status': { locked: false, dev_mode_until: null, look: DESK },
    '/api/setup/status': { needed: false, hasOwner: true, minPassword: 8 },
    '/api/auth/me': me,
    ...extra,
  });

function Stub() {
  return <h1>the page</h1>;
}
function SettingsStub() {
  return <h1>Look</h1>;
}
function FilingStub() {
  return <HeaderProgress percent={40} />;
}
const routeTree = RootRoute.addChildren([
  createRoute({ getParentRoute: () => RootRoute, path: '/', component: Stub }),
  createRoute({ getParentRoute: () => RootRoute, path: '/moderate', component: Stub }),
  createRoute({ getParentRoute: () => RootRoute, path: '/moderate/flood', component: Stub }),
  createRoute({ getParentRoute: () => RootRoute, path: '/settings/look', component: SettingsStub }),
  createRoute({ getParentRoute: () => RootRoute, path: '/settings/name', component: Stub }),
  createRoute({ getParentRoute: () => RootRoute, path: '/file/$slug', component: FilingStub }),
]);

function page(pathname: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  const history = { block: vi.fn(() => vi.fn()) } as unknown as RouterHistory;
  render(
    <QueryClientProvider client={queryClient}>
      <SiteGate history={history} pathname={pathname}>
        <RouterProvider router={router} />
      </SiteGate>
    </QueryClientProvider>,
  );
  return router;
}

function phoneWidth(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: phone,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 50)));

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.overflow = '';
});

describe('the header', () => {
  it('is the wordmark and the Menu button, closed, with nothing else in the bar', async () => {
    open({ signedIn: false });
    page('/');
    const banner = await screen.findByRole('banner');
    expect(within(banner).getByRole('link', { name: 'ReportLog' })).toHaveAttribute('href', '/');
    const menu = within(banner).getByRole('button', { name: 'Menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveAttribute('aria-controls', 'site-menu');
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).toBeNull();
    // The old bars are gone: no session links, no staff bar.
    expect(screen.queryByRole('navigation', { name: 'Staff' })).toBeNull();
    expect(within(banner).queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('on a door shows no Menu button and asks nothing beyond the gate', async () => {
    const asked = server({
      '/api/site-access/status': { locked: true, dev_mode_until: null, look: DESK },
      '/api/auth/me': ME('admin'),
    });
    page('/file/some-logbook');
    const banner = await screen.findByRole('banner');
    await settle();
    expect(within(banner).getByRole('link', { name: 'ReportLog' })).toBeInTheDocument();
    expect(within(banner).queryByRole('button')).toBeNull();
    expect(asked()).toEqual(['/api/site-access/status']);
  });

  it('counts the reports waiting for a moderator on the button, in words', async () => {
    open(ME('moderator'), { '/api/menu/waiting': { reports: 7, list_entries: 3, tip_links: 2 } });
    page('/');
    // The figure is hidden; the words are said, then the button's own name.
    const menu = await screen.findByRole('button', {
      name: /^7 reports waiting for a moderator\.\s*Menu$/,
    });
    expect(within(menu).getByText('7')).toHaveAttribute('aria-hidden', 'true');
  });

  it('asks nobody without a role or a flag for waiting totals, and shows no count', async () => {
    const asked = open(ME('user'));
    page('/');
    await screen.findByRole('button', { name: 'Menu' });
    await settle();
    expect(asked()).not.toContain('/api/menu/waiting');
  });

  it('turns its bottom rule into the progress track on a filing card', async () => {
    open({ signedIn: false });
    page('/file/votes');
    const banner = await screen.findByRole('banner');
    await settle();
    expect(banner.querySelector('[data-progress]')).toHaveAttribute('data-progress', '40');
  });
});

describe('the menu on a desktop', () => {
  it('opens with focus on its first link, keeps focus inside, and Escape closes it back onto the button', async () => {
    phoneWidth(false);
    open(ME('admin'), { '/api/menu/waiting': { reports: 2 } });
    page('/');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: /Menu$/ });
    await user.click(button);
    const nav = await screen.findByRole('navigation', { name: 'Main menu' });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(nav).getByRole('link', { name: 'Submit a report' })).toHaveFocus();
    // Shift+Tab from the first link goes to Close, and on round to the last.
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(nav.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).toBeNull();
    expect(screen.getByRole('button', { name: /Menu$/ })).toHaveFocus();
  });

  it('offers an administrator one way into the dashboard, with the waiting count, and no staff page', async () => {
    phoneWidth(false);
    open(ME('admin'), { '/api/menu/waiting': { reports: 2, list_entries: 1, feedback: 4 } });
    page('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Menu$/ }));
    const nav = await screen.findByRole('navigation', { name: 'Main menu' });
    expect(
      await within(nav).findByRole('link', {
        name: 'Your dashboard, 2 reports waiting for a moderator',
      }),
    ).toHaveAttribute('href', '/home');
    for (const name of [
      'Reports queue',
      'Flood screen',
      'Look',
      'Maps',
      'Roles',
      'Transparency log',
    ])
      expect(within(nav).queryByRole('link', { name })).toBeNull();
    expect(within(nav).getByText('admin@example.org')).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('closes when a link is chosen, and the page changes', async () => {
    phoneWidth(false);
    open(ME('admin'), { '/api/menu/waiting': {} });
    const router = page('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Menu' }));
    const nav = await screen.findByRole('navigation', { name: 'Main menu' });
    await user.click(within(nav).getByRole('link', { name: 'Your dashboard' }));
    await settle();
    expect(router.state.location.pathname).toBe('/home');
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).toBeNull();
  });

  it('takes a journalist to the dashboard, like everybody signed in', async () => {
    phoneWidth(false);
    open(ME('journalist'));
    page('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Menu' }));
    const nav = await screen.findByRole('navigation', { name: 'Main menu' });
    expect(within(nav).getByRole('link', { name: 'Your dashboard' })).toHaveAttribute(
      'href',
      '/home',
    );
    expect(within(nav).getByRole('link', { name: 'Your account' })).toBeInTheDocument();
  });

  it('offers a visitor the public links and Sign in, and nothing staff', async () => {
    phoneWidth(false);
    open({ signedIn: false });
    page('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Menu' }));
    const nav = await screen.findByRole('navigation', { name: 'Main menu' });
    for (const name of ['Board', 'How to use', 'About', 'Home'])
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/access/sign-in',
    );
    expect(within(nav).queryByRole('heading', { name: 'Staff' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Your dashboard' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('offers a role holder who has not proved a second factor the way to it, and the dashboard', async () => {
    phoneWidth(false);
    open(ME('user', { heldRoles: ['moderator'], secondFactor: 'set-up' }));
    page('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Menu' }));
    const nav = await screen.findByRole('navigation', { name: 'Main menu' });
    expect(within(nav).getByRole('link', { name: 'Account and security' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Your dashboard' })).toBeInTheDocument();
  });
});

describe('the staff area', () => {
  it('draws a staff page in the app frame: top bar, sidebar of the person’s pages, current one marked once', async () => {
    phoneWidth(false);
    open(ME('admin'), { '/api/menu/waiting': { reports: 3 } });
    page('/moderate/flood');
    const side = await screen.findByRole('navigation', { name: 'Your pages' });
    await settle();
    for (const area of [
      'You',
      'Review',
      'Content',
      'Site',
      'Rules',
      'People',
      'Logs and system',
      'Help',
    ])
      expect(within(side).getByRole('list', { name: area })).toBeInTheDocument();
    expect(within(side).getByRole('link', { name: 'Maps' })).toHaveAttribute('href', '/maps');
    expect(
      await within(side).findByRole('link', {
        name: 'Reports queue, 3 reports waiting for a moderator',
      }),
    ).toBeInTheDocument();
    const here = within(side).getAllByRole('link', { current: 'page' });
    expect(here.map((l) => l.textContent)).toEqual(['Flood screen']);
    // The top bar: the wordmark, the public site, the account; no public Menu.
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'View the public site' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(within(banner).queryByRole('button', { name: /Menu$/ })).toBeNull();
    expect(
      within(banner).getByRole('button', { name: /^Account:.*admin@example\.org/ }),
    ).toBeInTheDocument();
    // No row of area tabs: the sidebar is the list.
    expect(screen.queryByRole('navigation', { name: 'Moderation' })).toBeNull();
  });

  it('shows a moderator only the moderation pages and the guides', async () => {
    phoneWidth(false);
    open(ME('moderator'), { '/api/menu/waiting': {} });
    page('/moderate');
    const side = await screen.findByRole('navigation', { name: 'Your pages' });
    await settle();
    expect(
      within(side)
        .getAllByRole('list')
        .map((l) => l.getAttribute('aria-labelledby'))
        .filter(Boolean),
    ).toEqual(['staff-area-you', 'staff-area-review', 'staff-area-help']);
    expect(within(side).queryByRole('link', { name: 'Look' })).toBeNull();
    expect(within(side).getByRole('link', { name: 'Reports queue' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('opens the account menu with the person’s links and Sign out; Escape closes it', async () => {
    phoneWidth(false);
    open(ME('admin'), { '/api/menu/waiting': {} });
    page('/settings/name');
    const user = userEvent.setup();
    const account = await screen.findByRole('button', { name: /^Account:/ });
    await user.click(account);
    expect(account).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(account).toHaveFocus();
  });

  it('on a phone keeps the sidebar in a drawer: focus in, kept in, Escape gives it back', async () => {
    phoneWidth(true);
    open(ME('admin'), { '/api/menu/waiting': {} });
    page('/moderate/flood');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Menu' });
    await settle();
    expect(screen.queryByRole('navigation', { name: 'Your pages' })).toBeNull();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const side = screen.getByRole('navigation', { name: 'Your pages' });
    expect(side.contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(button).toHaveFocus();
    await user.tab();
    expect(side.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Your pages' })).toBeNull();
    expect(button).toHaveFocus();
    // Choosing a page closes it.
    await user.click(button);
    await user.click(
      within(screen.getByRole('navigation', { name: 'Your pages' })).getByRole('link', {
        name: 'Look',
      }),
    );
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Look' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Your pages' })).toBeNull();
  });

  it('is not drawn for somebody signed out: the public header, and the page’s own guard', async () => {
    phoneWidth(false);
    open({ signedIn: false });
    page('/settings/name');
    await screen.findByText('the page');
    await settle();
    expect(screen.queryByRole('navigation', { name: 'Your pages' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });

  it('is not drawn on a public page, even for staff', async () => {
    phoneWidth(false);
    open(ME('admin'), { '/api/menu/waiting': {} });
    page('/');
    await screen.findByRole('button', { name: /Menu$/ });
    await settle();
    expect(screen.queryByRole('navigation', { name: 'Your pages' })).toBeNull();
  });
});
