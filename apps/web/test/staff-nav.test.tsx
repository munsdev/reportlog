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
        'Written accounts',
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
      'Written accounts',
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
    const keys = STAFF_ENTRIES.filter((e) => !e.alias).map((e) => `${e.to}#${e.hash ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Only an alias may share an address with another entry.
    const real = STAFF_ENTRIES.filter((e) => !e.alias).map((e) => e.to);
    expect(new Set(real).size).toBe(real.length);
    for (const path of [
      '/access',
      '/logbooks',
      '/logbooks/pages',
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

  it('the settings overview is a page of the Site area, and the front page’s tab is the page for pages', () => {
    expect(entryAt('/settings')?.label).toBe('Site settings');
    expect(areaAt('/settings')?.id).toBe('site');
    expect(inFrame('/settings')).toBe(true);
    expect(entryAt('/logbooks/front-page')?.label).toBe('Front page and pages');
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

/** The site menu: a dialog that is always drawn, and shown by its `open` attribute (site.css). */
const siteMenu = () => screen.getByRole('dialog', { name: 'Site menu' });
const menuIsOpen = () => siteMenu().hasAttribute('open');

describe('the header', () => {
  it('is the wordmark and the MENU button, closed, with nothing else in the bar', async () => {
    open({ signedIn: false });
    page('/');
    const banner = await screen.findByRole('banner');
    expect(within(banner).getByRole('link', { name: 'ReportLog, home' })).toHaveAttribute(
      'href',
      '/',
    );
    const menu = within(banner).getByRole('button', { name: 'MENU' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveAttribute('aria-controls', 'menu');
    expect(siteMenu()).toHaveAttribute('id', 'menu');
    expect(menuIsOpen()).toBe(false);
    // The old bars are gone: no session links, no staff bar.
    expect(screen.queryByRole('navigation', { name: 'Staff' })).toBeNull();
    expect(within(banner).queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('on a door shows no MENU button and asks nothing beyond the gate', async () => {
    const asked = server({
      '/api/site-access/status': { locked: true, dev_mode_until: null, look: DESK },
      '/api/auth/me': ME('admin'),
    });
    page('/file/some-logbook');
    const banner = await screen.findByRole('banner');
    await settle();
    expect(within(banner).getByRole('link', { name: 'ReportLog, home' })).toBeInTheDocument();
    expect(within(banner).queryByRole('button')).toBeNull();
    expect(asked()).toEqual(['/api/site-access/status']);
  });

  it('counts the reports waiting for a moderator on the button, in words', async () => {
    open(ME('moderator'), { '/api/menu/waiting': { reports: 7, list_entries: 3, tip_links: 2 } });
    page('/');
    // The figure is hidden; the words are said after the button's own name.
    const menu = await screen.findByRole('button', {
      name: /^MENU\.\s*7 reports waiting for a moderator$/,
    });
    expect(within(menu).getByText('7')).toHaveAttribute('aria-hidden', 'true');
  });

  it('asks nobody without a role or a flag for waiting totals, and shows no count', async () => {
    const asked = open(ME('user'));
    page('/');
    await screen.findByRole('button', { name: 'MENU' });
    await settle();
    expect(asked()).not.toContain('/api/menu/waiting');
  });
});

describe('the menu on a desktop', () => {
  it('opens with focus on CLOSE, keeps focus inside, and Escape closes it back onto the button', async () => {
    phoneWidth(false);
    open(ME('admin'), { '/api/menu/waiting': { reports: 2 } });
    page('/');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: /^MENU/ });
    await user.click(button);
    const menu = siteMenu();
    expect(menuIsOpen()).toBe(true);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const close = within(menu).getByRole('button', { name: 'CLOSE' });
    expect(close).toHaveFocus();
    const nav = within(menu).getByRole('navigation', { name: 'Menu' });
    expect(within(nav).getByRole('link', { name: 'File a report' })).toBeInTheDocument();
    // Shift+Tab from CLOSE reaches the wordmark, the first thing in the sheet,
    // and on round to the last; Tab from the last goes back to the first.
    await user.tab({ shift: true });
    expect(within(menu).getByRole('link', { name: 'ReportLog, home' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(menu.contains(document.activeElement)).toBe(true);
    expect(within(menu).getByRole('button', { name: 'Sign out' })).toHaveFocus();
    await user.tab();
    expect(within(menu).getByRole('link', { name: 'ReportLog, home' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(menuIsOpen()).toBe(false);
    expect(screen.getByRole('button', { name: /^MENU/ })).toHaveFocus();
  });

  it('offers an administrator one way into the dashboard, with the waiting count, and no staff page', async () => {
    phoneWidth(false);
    open(ME('admin'), { '/api/menu/waiting': { reports: 2, list_entries: 1, feedback: 4 } });
    page('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^MENU/ }));
    const menu = siteMenu();
    expect(
      await within(menu).findByRole('link', {
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
      expect(within(menu).queryByRole('link', { name })).toBeNull();
    expect(within(menu).getByText(/admin@example\.org/)).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('closes when a link is chosen, and the page changes', async () => {
    phoneWidth(false);
    open(ME('admin'), { '/api/menu/waiting': {} });
    const router = page('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'MENU' }));
    expect(menuIsOpen()).toBe(true);
    await user.click(within(siteMenu()).getByRole('link', { name: 'Your dashboard' }));
    await settle();
    expect(router.state.location.pathname).toBe('/home');
    // The dashboard is in the staff frame, which has no public menu to leave open.
    expect(screen.queryByRole('dialog', { name: 'Site menu' })).toBeNull();
  });

  it('takes a journalist to the dashboard, like everybody signed in', async () => {
    phoneWidth(false);
    open(ME('journalist'));
    page('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'MENU' }));
    const menu = siteMenu();
    expect(within(menu).getByRole('link', { name: 'Your dashboard' })).toHaveAttribute(
      'href',
      '/home',
    );
    expect(within(menu).getByRole('link', { name: 'Your account' })).toBeInTheDocument();
  });

  it('offers a visitor the public links and Sign in, and nothing staff', async () => {
    phoneWidth(false);
    open({ signedIn: false });
    page('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'MENU' }));
    const menu = siteMenu();
    for (const name of [
      'File a report',
      'Reports',
      'About',
      'Get involved',
      'For journalists',
      'How it works',
      'Check a report',
    ])
      expect(within(menu).getByRole('link', { name })).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/access/sign-in',
    );
    expect(within(menu).queryByRole('heading', { name: 'Staff' })).toBeNull();
    expect(within(menu).queryByRole('link', { name: /^Your dashboard/ })).toBeNull();
    expect(within(menu).queryByRole('link', { name: 'Your account' })).toBeNull();
    expect(within(menu).queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('offers a role holder who has not proved a second factor the way to it, and the dashboard', async () => {
    phoneWidth(false);
    open(ME('user', { heldRoles: ['moderator'], secondFactor: 'set-up' }));
    page('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'MENU' }));
    const menu = siteMenu();
    // One account page; a role holder's lands on its security part.
    expect(within(menu).getByRole('link', { name: 'Your account' })).toHaveAttribute(
      'href',
      '/access/security',
    );
    expect(within(menu).getByRole('link', { name: 'Your dashboard' })).toBeInTheDocument();
  });
});

/** A sidebar section: the <details> under a heading. */
function sectionOf(side: HTMLElement, name: string): HTMLDetailsElement {
  const details = within(side).getByRole('heading', { level: 3, name }).closest('details');
  if (!details) throw new Error(`no section called ${name}`);
  return details;
}

describe('the staff area', () => {
  it('draws a staff page in the app frame: top bar, sidebar of the person’s pages, current one marked once', async () => {
    phoneWidth(false);
    open(ME('admin'), { '/api/menu/waiting': { reports: 3 } });
    page('/moderate/flood');
    const side = await screen.findByRole('navigation', { name: 'Staff areas' });
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
      expect(sectionOf(side, area)).toBeInTheDocument();
    // Each section folds. Only the one being read, and any with work waiting,
    // start open; the rest open when their heading is pressed.
    expect(sectionOf(side, 'Review').open).toBe(true);
    expect(sectionOf(side, 'Content').open).toBe(false);
    await userEvent.setup().click(within(sectionOf(side, 'Content')).getByText('Content'));
    expect(sectionOf(side, 'Content').open).toBe(true);
    expect(within(side).getByRole('link', { name: 'Maps' })).toHaveAttribute('href', '/maps');
    expect(
      await within(side).findByRole('link', {
        name: 'Reports queue, 3 reports waiting for a moderator',
      }),
    ).toBeInTheDocument();
    const here = within(side).getAllByRole('link', { current: 'page' });
    expect(here.map((l) => l.textContent)).toEqual(['Flood screen']);
    // The top bar: the wordmark, the public site, the account (one link).
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'View the public site' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(
      within(banner).getByRole('link', { name: 'Your account, admin@example.org' }),
    ).toHaveAttribute('href', '/access');
    // The public site menu is not drawn in the staff frame.
    expect(screen.queryByRole('dialog', { name: 'Site menu' })).toBeNull();
    // No row of area tabs: the sidebar is the list.
    expect(screen.queryByRole('navigation', { name: 'Moderation' })).toBeNull();
  });

  it('shows a moderator only the moderation pages and the guides', async () => {
    phoneWidth(false);
    open(ME('moderator'), { '/api/menu/waiting': {} });
    page('/moderate');
    const side = await screen.findByRole('navigation', { name: 'Staff areas' });
    await settle();
    expect(
      within(side)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['You', 'Review', 'Help']);
    expect(within(side).queryByRole('link', { name: 'Look' })).toBeNull();
    expect(within(side).getByRole('link', { name: 'Reports queue' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('on a phone keeps the sidebar in a drawer: focus in, kept in, Escape gives it back', async () => {
    phoneWidth(true);
    open(ME('admin'), { '/api/menu/waiting': {} });
    page('/moderate/flood');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'MENU' });
    await settle();
    expect(screen.queryByRole('dialog', { name: 'Staff menu' })).toBeNull();
    await user.click(button);
    // A full-screen dialog with its own CLOSE; focus lands on its first control.
    const dialog = screen.getByRole('dialog', { name: 'Staff menu' });
    expect(dialog).toHaveAttribute('open');
    expect(within(dialog).getByRole('link', { name: 'ReportLog, your dashboard' })).toHaveFocus();
    // The way back to the public site and Sign out come before the sections.
    const controls = within(dialog)
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(controls.indexOf('View the public site')).toBe(1);
    expect(within(dialog).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    const side = within(dialog).getByRole('navigation', { name: 'Staff areas' });
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(button).not.toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole('link', { name: 'ReportLog, your dashboard' })).toHaveFocus();
    expect(side).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Staff menu' })).toBeNull();
    expect(button).toHaveFocus();
    // Choosing a page closes it.
    await user.click(button);
    const again = within(screen.getByRole('dialog', { name: 'Staff menu' }));
    await user.click(again.getByText('Site'));
    await user.click(again.getByRole('link', { name: 'Look' }));
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Look' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Staff menu' })).toBeNull();
  });

  it('is not drawn for somebody signed out: the public header, and the page’s own guard', async () => {
    phoneWidth(false);
    open({ signedIn: false });
    page('/settings/name');
    await screen.findByText('the page');
    await settle();
    expect(screen.queryByRole('navigation', { name: 'Staff areas' })).toBeNull();
    expect(screen.getByRole('button', { name: 'MENU' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Site menu' })).toBeInTheDocument();
  });

  it('is not drawn on a public page, even for staff', async () => {
    phoneWidth(false);
    open(ME('admin'), { '/api/menu/waiting': {} });
    page('/');
    await screen.findByRole('button', { name: /^MENU/ });
    await settle();
    expect(screen.queryByRole('navigation', { name: 'Staff areas' })).toBeNull();
  });
});
