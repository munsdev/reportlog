/**
 * The lock screen (decisions.md §3) and the development badge in front of
 * the password.
 *
 * The lock screen shows the site's name and the operator's paragraph, both
 * from the password check itself, and asks nothing behind the gate to get
 * them. The badge shows there and on a door, from the same answer.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteGate } from '../src/features/identity/gate.tsx';
import { Route as RootRoute } from '../src/routes/__root.tsx';
import { DESK } from './look-fixture.ts';

/** Answers these paths; anything else is refused as locked. Returns what was asked. */
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

const history = { block: vi.fn(() => vi.fn()) } as unknown as RouterHistory;
const settle = () => new Promise((r) => setTimeout(r, 100));
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

const SITE = {
  name_parts: [
    { text: 'Harbour', mark: '' },
    { text: 'Watch', mark: 'a' },
  ],
  plain_name: 'HarbourWatch',
};

function lockScreen(pathname = '/board') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SiteGate history={history} pathname={pathname}>
        <p>behind the curtain</p>
      </SiteGate>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the lock screen', () => {
  it('shows the site’s name and the operator’s paragraph, line breaks kept', async () => {
    const asked = server({
      '/api/site-access/status': {
        locked: true,
        site: { ...SITE, intro: 'Run by the harbour residents.\nAsk at the office.' },
        dev_mode_until: null,
        look: DESK,
      },
      '/api/doors': { doors: [] },
    });
    lockScreen();
    expect(
      await screen.findByRole('heading', { name: 'This site needs a password' }),
    ).toBeVisible();
    expect(screen.getByText('Harbour')).toBeVisible();
    expect(screen.getByText('Watch')).toBeVisible();
    const intro = document.querySelector('[data-copy="lock_intro"]');
    expect(intro?.textContent).toBe('Run by the harbour residents.\nAsk at the office.');
    await settle();
    // Nothing behind the gate was asked to draw it.
    expect(asked().sort()).toEqual(['/api/doors', '/api/site-access/status']);
    expect(screen.queryByText('behind the curtain')).toBeNull();
  });

  it('with no paragraph written shows none', async () => {
    server({
      '/api/site-access/status': { locked: true, site: SITE, dev_mode_until: null, look: DESK },
      '/api/doors': { doors: [] },
    });
    lockScreen();
    expect(await screen.findByText('Harbour')).toBeVisible();
    expect(document.querySelector('[data-copy="lock_intro"]')).toBeNull();
  });

  it('wears the development badge while the notice is on, still asking nothing more', async () => {
    const asked = server({
      '/api/site-access/status': {
        locked: true,
        site: SITE,
        dev_mode_until: inAnHour(),
        look: DESK,
      },
      '/api/doors': { doors: [] },
    });
    lockScreen();
    expect(await screen.findByRole('button', { name: 'Notices: 1' })).toBeVisible();
    await settle();
    expect(asked().sort()).toEqual(['/api/doors', '/api/site-access/status']);
  });

  it('wears no badge when the notice is off', async () => {
    server({
      '/api/site-access/status': { locked: true, site: SITE, dev_mode_until: null, look: DESK },
      '/api/doors': { doors: [] },
    });
    lockScreen();
    expect(await screen.findByText('Harbour')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Notices: 1' })).toBeNull();
  });
});

describe('the lock screen’s look (decision 60)', () => {
  afterEach(() => {
    for (const a of ['data-palette', 'data-theme', 'data-panel-head', 'data-texture'])
      document.documentElement.removeAttribute(a);
    localStorage.clear();
  });

  it('wears the site’s look, from the password check, asking nothing behind the gate', async () => {
    const asked = server({
      '/api/site-access/status': {
        locked: true,
        site: SITE,
        dev_mode_until: null,
        look: { palette: 'flint', theme: 'signal', panel_head: 'plain', texture: 'none' },
      },
      '/api/doors': { doors: [] },
    });
    lockScreen();
    expect(await screen.findByText('Harbour')).toBeVisible();
    const html = document.documentElement;
    expect(html).toHaveAttribute('data-palette', 'flint');
    expect(html).toHaveAttribute('data-theme', 'signal');
    expect(html).toHaveAttribute('data-panel-head', 'plain');
    await settle();
    expect(asked().sort()).toEqual(['/api/doors', '/api/site-access/status']);
  });
});

describe('the development badge on a door', () => {
  const Page = () => <p>the page behind the door</p>;
  const routeTree = RootRoute.addChildren([
    createRoute({ getParentRoute: () => RootRoute, path: '/file/$slug', component: Page }),
  ]);

  it('shows from the password check’s answer, and the door asks nothing beyond it', async () => {
    // The root layout puts the badge in the corner dock, which index.html
    // carries and a test document does not.
    const slot = document.createElement('div');
    slot.id = 'fab-notice';
    document.body.append(slot);
    const asked = server({
      '/api/site-access/status': {
        locked: true,
        site: SITE,
        dev_mode_until: inAnHour(),
        look: DESK,
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history: createMemoryHistory({ initialEntries: ['/file/demo'] }),
    });
    render(
      <QueryClientProvider client={queryClient}>
        <SiteGate history={history} pathname="/file/demo">
          <RouterProvider router={router} />
        </SiteGate>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('the page behind the door')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Notices: 1' })).toBeVisible();
    await settle();
    expect(asked()).toEqual(['/api/site-access/status']);
    slot.remove();
  });
});
