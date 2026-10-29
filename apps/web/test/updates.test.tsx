/**
 * The Updates screen.
 *
 * THE PROMISES UNDER TEST:
 *   - it says what is installed: version, commit, date, and the branch it
 *     came from;
 *   - one button: "Check for update", which becomes "Install update" once a
 *     check found one, and installing asks first, naming what;
 *   - eight presses on the version add a branch selector beside that button
 *     (main, beta, alpha), and a server not following main always has it;
 *   - Roll back shows only while it can be used, and after the eight presses
 *     offers every release the server keeps; both ask first, naming where to.
 *   - nothing is sent before the confirmation's own button is pressed.
 */
import type { ReleasePoint, UpdatesView } from '@reportlog/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdatesPage } from '../src/features/updates/UpdatesPage.tsx';

const CUR = 'b'.repeat(40);
const TIP = 'a'.repeat(40);

const point = (id: string, c: string, branch: string | null, version: string | null) => ({
  id,
  installed_at: `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T10:00:00Z`,
  commit: c.repeat(40),
  branch,
  version,
});
const RUNNING: ReleasePoint = point('20261022T100000Z-bbbbbbbbbbbb', 'b', 'main', 'v0.2.0');
const BEFORE: ReleasePoint = point('20261021T100000Z-cccccccccccc', 'c', 'main', 'v0.1.1');
const OLDEST: ReleasePoint = point('20261020T100000Z-dddddddddddd', 'd', 'beta', 'v0.1.0');

const UP_TO_DATE: UpdatesView = {
  checked_at: '2026-10-22T11:00:00Z',
  ref: 'main',
  following: 'main',
  installed: RUNNING,
  current: CUR,
  tip: CUR,
  current_version: 'v0.2.0',
  available_version: 'v0.2.0',
  behind: 0,
  ahead: 0,
  commits: [],
  releases: [],
  fetch_failed: null,
  roll_back_to: null,
  release_points: [BEFORE, OLDEST],
  waiting: false,
  last: null,
};

const OFFER: UpdatesView = {
  ...UP_TO_DATE,
  tip: TIP,
  available_version: 'v0.3.0',
  behind: 4,
  commits: ['aaaaaaa Better things'],
};

interface Sent {
  method: string;
  body: unknown;
}

function serve(view: UpdatesView) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      sent.push({
        method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return Promise.resolve(
        new Response(JSON.stringify({ ...view, waiting: method === 'POST' }), { status: 200 }),
      );
    }),
  );
  return () => sent.filter((s) => s.method === 'POST').map((s) => s.body);
}

function wrap() {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <UpdatesPage /> }),
    history: createMemoryHistory({ initialEntries: ['/updates'] }),
  });
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

async function pressVersion(user: ReturnType<typeof userEvent.setup>, times = 8) {
  const v = await screen.findByRole('button', { name: 'v0.2.0' });
  for (let i = 0; i < times; i += 1) await user.click(v);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what is installed', () => {
  it('says the version, commit, date and branch, and has one button to check', async () => {
    const user = userEvent.setup();
    const posts = serve(UP_TO_DATE);
    wrap();
    expect(await screen.findByRole('button', { name: 'v0.2.0' })).toBeInTheDocument();
    expect(screen.getByText('bbbbbbbbbbbb')).toBeInTheDocument();
    expect(screen.getByText('From branch').nextSibling).toHaveTextContent('main');
    expect(screen.getByText('Installed').nextSibling?.textContent).not.toBe('not recorded');
    // One status line beside the one button says where things stand.
    expect(screen.getByRole('status')).toHaveTextContent(
      'No update needed. This is the newest version on main.',
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Roll back/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check for update' }));
    expect(posts()).toEqual([{ action: 'check' }]);
  });
});

describe('installing', () => {
  it('the same button becomes Install update, and only Install in the confirmation sends', async () => {
    const user = userEvent.setup();
    const posts = serve(OFFER);
    wrap();
    expect(await screen.findByText('Update available: v0.3.0 on main.')).toHaveAttribute(
      'role',
      'status',
    );
    expect(screen.getByText(/4 changes newer than this site/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check for update' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Install update' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('v0.3.0 (aaaaaaaaaaaa) from main');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(posts()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Install update' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Install' }),
    );
    expect(posts()).toEqual([{ action: 'apply', sha: TIP }]);
  });
});

describe('the eight presses', () => {
  it('add a branch selector; choosing a branch then checking asks about that branch', async () => {
    const user = userEvent.setup();
    const posts = serve(OFFER);
    wrap();
    await pressVersion(user, 7);
    expect(screen.queryByRole('combobox', { name: /Branch/ })).not.toBeInTheDocument();
    await pressVersion(user, 1);
    const select = screen.getByRole('combobox', { name: /Branch/ });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['main', 'beta', 'alpha']);
    await user.selectOptions(select, 'beta');
    // What is on offer was found on main, so for beta the button checks first.
    expect(screen.getByRole('status')).toHaveTextContent('Not checked against beta yet.');
    await user.click(screen.getByRole('button', { name: 'Check for update' }));
    expect(posts()).toEqual([{ action: 'check', branch: 'beta' }]);
  });

  it('installing from the chosen branch names it, and says the server will follow it', async () => {
    const user = userEvent.setup();
    const posts = serve({ ...OFFER, ref: 'beta' });
    wrap();
    await pressVersion(user);
    await user.selectOptions(screen.getByRole('combobox', { name: /Branch/ }), 'beta');
    await user.click(screen.getByRole('button', { name: 'Install update' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Install an update from beta?');
    expect(dialog).toHaveTextContent('From then on it follows beta');
    expect(dialog).toHaveTextContent('Only install it on a test server');
    await user.click(within(dialog).getByRole('button', { name: 'Install' }));
    expect(posts()).toEqual([{ action: 'apply', sha: TIP, branch: 'beta' }]);
  });

  it('a server not following main always shows the selector, its own branch first', async () => {
    const user = userEvent.setup();
    const posts = serve({ ...OFFER, ref: 'test', following: 'test' });
    wrap();
    const select = await screen.findByRole('combobox', { name: /Branch/ });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['test (followed now)', 'main', 'beta', 'alpha']);
    expect(screen.getByText('Follows').nextSibling).toHaveTextContent('test');
    // Its own branch is never named in a request: the server knows which it follows.
    await user.click(screen.getByRole('button', { name: 'Install update' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Install' }),
    );
    expect(posts()).toEqual([{ action: 'apply', sha: TIP }]);
  });
});

describe('rolling back', () => {
  it('shows only while it can be used, and asks first naming where to', async () => {
    const user = userEvent.setup();
    const posts = serve({ ...UP_TO_DATE, roll_back_to: BEFORE });
    wrap();
    await user.click(await screen.findByRole('button', { name: 'Roll back to v0.1.1' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('v0.1.1 (cccccccccccc) from main');
    expect(dialog).toHaveTextContent('This can be done once');
    await user.click(within(dialog).getByRole('button', { name: 'Roll back' }));
    expect(posts()).toEqual([{ action: 'rollback' }]);
  });

  it('after the eight presses offers every kept release, newest first', async () => {
    const user = userEvent.setup();
    const posts = serve(UP_TO_DATE);
    wrap();
    await pressVersion(user);
    const select = screen.getByRole('combobox', { name: /Release/ });
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toHaveLength(2);
    expect(options[0]).toMatch(/^v0\.1\.1 \(cccccccccccc\) from main, installed /);
    expect(options[1]).toMatch(/^v0\.1\.0 \(dddddddddddd\) from beta, installed /);
    await user.selectOptions(select, OLDEST.id);
    await user.click(screen.getByRole('button', { name: 'Roll back' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('v0.1.0 (dddddddddddd) from beta');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(posts()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Roll back' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Roll back' }),
    );
    expect(posts()).toEqual([{ action: 'rollback', release: OLDEST.id }]);
  });
});
